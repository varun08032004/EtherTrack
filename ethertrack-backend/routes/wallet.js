// routes/wallet.js — EtherTrack (NODAL ACCOUNT MODEL)
// ─────────────────────────────────────────────────────────────────────────────
// ARCHITECTURE: Razorpay holds all user float in a nodal/escrow account.
// EtherTrack's DB is a pure ledger layer — inr_balance reflects what Razorpay
// is holding on behalf of each user, but actual INR never touches our bank.
//
// This means EtherTrack does NOT require a PPI license — Razorpay operates
// under their own PPI authorization. We are a merchant using Razorpay Routes.
//
// Money flow:
//   DEPOSIT:    User → Razorpay checkout → Razorpay nodal account
//               → DB ledger credit (no money in our DB/bank)
//
//   TRADE BUY:  DB ledger debit (user)
//               → Razorpay Transfer: nodal → EtherTrack merchant account
//
//   TRADE SELL: Razorpay Transfer: EtherTrack merchant → nodal (credit user)
//               → DB ledger credit
//
//   WITHDRAW:   DB ledger debit
//               → Razorpay Payout: nodal → user bank account directly
//
// Key change from old wallet.js:
//   adjustBalance()  → pure ledger, no actual money movement
//   deposit/verify   → confirms Razorpay captured; ledger update only
//   withdraw         → fires razorpay.payouts.create() from nodal account
//   trade-deduct     → DB ledger debit + razorpay transfer to merchant account
//   trade-refund     → DB ledger credit + razorpay transfer back to nodal
//
// Requirements:
//   - Razorpay Route enabled on your account (nodal/escrow)
//   - Razorpay Payouts enabled (for withdrawals)
//   - ENV: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
//          RAZORPAY_ACCOUNT_NUMBER (your Razorpay X / nodal account number)
//          RAZORPAY_MERCHANT_ACCOUNT_ID (linked merchant account for trade settlements)
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

require('dotenv').config();
const express    = require('express');
const router     = express.Router();
const { ethers } = require('ethers');
const Razorpay   = require('razorpay');
const crypto     = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const pino       = require('pino');

const { safeQuery: query, pool } = require('../db/pool');
const { authenticate }           = require('../middleware/auth');
const { createNotification }     = require('./notifications');

// ── Compliance stubs ──────────────────────────────────────────────────────────
const runComplianceChecks = async (userId, amount, type) => ({
  allowed:   true,
  tdsAmount: amount > 10000 ? Math.round(amount * 0.01) : 0,
  netAmount: amount > 10000 ? amount - Math.round(amount * 0.01) : amount,
  tdsInfo:   amount > 10000 ? { rate: 0.01, section: '194S' } : null,
  reason:    null,
});
const updateAMLCounter = async () => {};
const recordTDS        = async () => {};

// ── Structured logger ─────────────────────────────────────────────────────────
const log = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      '*.accountNumber', '*.account_number',
      '*.walletAddress', '*.wallet_address',
      '*.signature',     '*.razorpay_signature',
      '*.fund_account',
    ],
    censor: '[REDACTED]',
  },
});

const mask = str =>
  typeof str === 'string' && str.length > 4
    ? '****' + str.slice(-4)
    : '****';

// ── Razorpay lazy init ────────────────────────────────────────────────────────
let _razorpay = null;
const getRazorpay = () => {
  if (_razorpay) return _razorpay;
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET)
    throw new Error('Razorpay keys not configured');
  _razorpay = new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
  return _razorpay;
};

// ── ETH/INR rate cache + circuit breaker ─────────────────────────────────────
let _rateCache   = { inr: 280000, fetchedAt: 0 };
let _cgFailCount = 0;
let _cgOpenUntil = 0;
const CG_FAIL_MAX = 3;
const CG_COOLDOWN = 60 * 1000;

// ── Rate limiters ─────────────────────────────────────────────────────────────
const walletWriteLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    req => req.user?.id ?? ipKeyGenerator(req),
  message: { error: 'Too many requests. Please wait before trying again.' },
});

const walletReadLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             60,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    req => req.user?.id ?? ipKeyGenerator(req),
  message: { error: 'Too many requests.' },
});

// ── Input sanitiser ───────────────────────────────────────────────────────────
const sanitiseText = (str, maxLen = 60) =>
  typeof str === 'string'
    ? str.replace(/[^\x20-\x7E\u0900-\u097F]/g, '').trim().slice(0, maxLen)
    : '';

// ── LEDGER HELPER — pure DB accounting, no money movement ────────────────────
// inr_balance in users table = ledger balance (mirror of what Razorpay nodal holds)
// Actual INR is always in Razorpay nodal account, never in EtherTrack's bank.
async function adjustLedger(userId, amount, type, client) {
  const col = type === 'credit' ? 'inr_balance + $1' : 'inr_balance - $1';
  const { rows } = await client.query(
    `UPDATE users
     SET inr_balance        = ${col},
         inr_balance_paise  = ROUND((${col}) * 100)::bigint,
         updated_at         = NOW()
     WHERE id = $2
       AND inr_balance ${type === 'debit' ? '>= $1' : '> -1'}
     RETURNING inr_balance`,
    [amount, userId]
  );
  if (!rows.length) throw new Error('Insufficient ledger balance or user not found');
  return rows[0].inr_balance;
}

const generateInvoiceNo = txId =>
  `ET-INV-${new Date().getFullYear()}-${String(txId).padStart(6, '0')}`;

const DAILY_WITHDRAWAL_LIMIT = 200000;

// ── Razorpay Payout helper ────────────────────────────────────────────────────
// Creates a contact + fund account + payout from nodal account to user bank.
// Razorpay Payouts API: https://razorpay.com/docs/api/x/payouts/
async function initiateRazorpayPayout({ amount, tdsAmount, accountName, accountNumber, ifsc, reference, userId }) {
  const rzp = getRazorpay();
  const netAmount = amount - (tdsAmount || 0);

  // Step 1: Create contact
  const contact = await rzp.contacts.create({
    name:         sanitiseText(accountName, 60),
    type:         'customer',
    reference_id: `ET_${userId.slice(0, 8)}_${Date.now()}`,
  });

  // Step 2: Create fund account (bank account linked to contact)
  const fundAccount = await rzp.fundAccount.create({
    contact_id:   contact.id,
    account_type: 'bank_account',
    bank_account: {
      name:           sanitiseText(accountName, 60),
      ifsc:           ifsc.toUpperCase(),
      account_number: accountNumber,
    },
  });

  // Step 3: Create payout from nodal account
  // Amount in paise, net of TDS
  const payout = await rzp.payouts.create({
    account_number: process.env.RAZORPAY_ACCOUNT_NUMBER, // nodal account
    fund_account_id: fundAccount.id,
    amount:          Math.round(netAmount * 100),         // paise
    currency:        'INR',
    mode:            'IMPS',
    purpose:         'payout',
    queue_if_low_balance: true,
    reference_id:    reference,
    narration:       `EtherTrack withdrawal ${reference}`,
  });

  return { contact, fundAccount, payout };
}

// ── Razorpay Transfer helper ──────────────────────────────────────────────────
// Moves money between nodal account and EtherTrack merchant account for trades.
// Uses Razorpay Routes transfer API.
async function transferNodalToMerchant(amount, reference) {
  const rzp = getRazorpay();
  // Transfer from nodal to linked merchant account
  return rzp.transfers.create({
    account:    process.env.RAZORPAY_MERCHANT_ACCOUNT_ID,
    amount:     Math.round(amount * 100), // paise
    currency:   'INR',
    notes: {
      reference,
      purpose: 'trade_settlement',
    },
  });
}

async function transferMerchantToNodal(amount, reference) {
  // Reverse transfer — when trade is refunded or sell proceeds go back to user nodal
  // In practice: create a payout from merchant account back to nodal
  // This depends on your Razorpay Route setup; adjust account IDs accordingly.
  const rzp = getRazorpay();
  return rzp.transfers.create({
    account:    process.env.RAZORPAY_NODAL_ACCOUNT_ID || process.env.RAZORPAY_ACCOUNT_NUMBER,
    amount:     Math.round(amount * 100),
    currency:   'INR',
    notes: {
      reference,
      purpose: 'trade_refund',
    },
  });
}

// ════════════════════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════════════════════

// ── Health check ──────────────────────────────────────────────────────────────
router.get('/health', async (req, res) => {
  let dbOk = false;
  try { await query('SELECT 1'); dbOk = true; } catch {}
  const rateAge = Date.now() - _rateCache.fetchedAt;
  res.status(dbOk ? 200 : 503).json({
    ok:           dbOk,
    db:           dbOk ? 'up' : 'down',
    ethRateAge:   rateAge,
    ethRateStale: rateAge > 10 * 60 * 1000,
    nodalModel:   true, // confirms nodal architecture is active
    ts:           new Date().toISOString(),
  });
});

// ── ETH/INR rate ──────────────────────────────────────────────────────────────
router.get('/eth-inr-rate', async (req, res) => {
  const age         = Date.now() - _rateCache.fetchedAt;
  const circuitOpen = Date.now() < _cgOpenUntil;

  if (age < 5 * 60 * 1000 || circuitOpen)
    return res.json({ inr: _rateCache.inr, cached: true });

  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 4000);
    const r = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=inr',
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    const d = await r.json();
    if (d?.ethereum?.inr > 0) {
      _rateCache   = { inr: d.ethereum.inr, fetchedAt: Date.now() };
      _cgFailCount = 0;
    }
  } catch (err) {
    _cgFailCount++;
    if (_cgFailCount >= CG_FAIL_MAX) {
      _cgOpenUntil = Date.now() + CG_COOLDOWN;
      log.warn({ failCount: _cgFailCount }, 'CoinGecko circuit breaker opened');
    }
    log.warn({ err: err?.message }, 'CoinGecko fetch failed — serving stale cache');
  }
  res.json({ inr: _rateCache.inr, cached: _rateCache.fetchedAt > 0 });
});

// ── Withdrawal limits ─────────────────────────────────────────────────────────
router.get('/limits', authenticate, walletReadLimiter, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { rows } = await query(
      `SELECT COALESCE(SUM(amount), 0) AS used
       FROM wallet_transactions
       WHERE user_id  = $1
         AND type     = 'debit'
         AND method   = 'bank'
         AND DATE(created_at) = $2
         AND status  != 'failed'`,
      [req.user.id, today]
    );
    const used      = parseFloat(rows[0].used);
    const remaining = Math.max(0, DAILY_WITHDRAWAL_LIMIT - used);
    res.json({ dailyLimit: DAILY_WITHDRAWAL_LIMIT, used, remaining });
  } catch (err) {
    log.error({ err: err?.message, userId: req.user.id }, 'Limits fetch error');
    res.status(500).json({ error: 'Failed to fetch withdrawal limits' });
  }
});

// ── Balance ───────────────────────────────────────────────────────────────────
router.get('/balance', authenticate, walletReadLimiter, async (req, res) => {
  try {
    const { rows: userRows } = await query(
      'SELECT inr_balance, inr_balance_locked FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!userRows.length) return res.status(404).json({ error: 'User not found' });

    const { rows: txRows } = await query(
      `SELECT id, type, method, amount, status, reference, gst_invoice_no,
              balance_before, balance_after, created_at, notes
       FROM wallet_transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 25`,
      [req.user.id]
    );
    res.json({
      balance:       parseFloat(userRows[0].inr_balance),
      balanceLocked: parseFloat(userRows[0].inr_balance_locked),
      transactions:  txRows,
    });
  } catch (err) {
    log.error({ err: err?.message, userId: req.user.id }, 'Balance fetch error');
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

// ── Transactions (cursor-paginated) ───────────────────────────────────────────
router.get('/transactions', authenticate, walletReadLimiter, async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 25, 100);
  const cursor = req.query.cursor || null;

  try {
    const { rows } = await query(
      `SELECT id, type, method, amount, status, reference, gst_invoice_no,
              balance_before, balance_after, created_at, notes
       FROM wallet_transactions
       WHERE user_id = $1
         ${cursor ? 'AND created_at < $3' : ''}
       ORDER BY created_at DESC
       LIMIT $2`,
      cursor ? [req.user.id, limit + 1, cursor] : [req.user.id, limit + 1]
    );

    const hasMore    = rows.length > limit;
    const txRows     = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? txRows[txRows.length - 1].created_at : null;

    res.json({ transactions: txRows, nextCursor, hasMore });
  } catch (err) {
    log.error({ err: err?.message, userId: req.user.id }, 'Transactions fetch error');
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// ── Deposit: create order ─────────────────────────────────────────────────────
// Creates Razorpay order — money will land in Razorpay nodal account on capture.
router.post('/deposit/create-order', authenticate, walletWriteLimiter, async (req, res) => {
  const { amount, method } = req.body;

  if (!amount || amount < 100 || amount > 100000)
    return res.status(400).json({ error: 'Amount must be between ₹100 and ₹1,00,000' });

  if (!req.user.kyc_verified)
    return res.status(403).json({ error: 'KYC verification required to deposit funds', code: 'KYC_REQUIRED' });

  const compliance = await runComplianceChecks(req.user.id, amount, 'credit');
  if (!compliance.allowed)
    return res.status(403).json({ error: compliance.reason, code: 'COMPLIANCE_BLOCK' });

  try {
    const order = await getRazorpay().orders.create({
      amount:   Math.round(amount * 100),
      currency: 'INR',
      receipt:  `ET_${req.user.id.slice(0, 8)}_${Date.now()}`,
      notes:    { user_id: req.user.id, email: req.user.email },
    });
    await query(
      `INSERT INTO wallet_transactions
         (user_id, type, method, amount, status, razorpay_order_id, notes)
       VALUES ($1, 'credit', $2, $3, 'pending', $4, $5)`,
      [req.user.id, method || 'upi', amount, order.id,
       `Deposit via ${method || 'upi'} — nodal model`]
    );
    res.json({
      orderId:  order.id,
      amount,
      currency: 'INR',
      keyId:    process.env.RAZORPAY_KEY_ID,
      name:     req.user.full_name || req.user.email,
      email:    req.user.email,
    });
  } catch (err) {
    log.error({ err: err?.message, userId: req.user.id }, 'Create order error');
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

// ── Deposit: verify ───────────────────────────────────────────────────────────
// Verifies Razorpay signature, then credits ledger ONLY.
// Money is already in Razorpay nodal — we just update our accounting.
router.post('/deposit/verify', authenticate, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
    return res.status(400).json({ error: 'Missing payment verification fields' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: txRows } = await client.query(
      `SELECT * FROM wallet_transactions
       WHERE razorpay_order_id = $1 AND user_id = $2 AND status = 'pending'
       FOR UPDATE SKIP LOCKED`,
      [razorpay_order_id, req.user.id]
    );

    if (!txRows.length) {
      await client.query('ROLLBACK');
      // Idempotency — return success if already processed
      const { rows: done } = await query(
        `SELECT balance_after, reference, razorpay_payment_id
         FROM wallet_transactions
         WHERE razorpay_order_id = $1 AND user_id = $2 AND status = 'success'`,
        [razorpay_order_id, req.user.id]
      );
      if (done.length) {
        return res.json({
          success:   true,
          message:   'Already processed',
          balance:   done[0].balance_after,
          reference: done[0].reference,
          paymentId: done[0].razorpay_payment_id,
        });
      }
      return res.status(404).json({ error: 'Transaction not found or already processed' });
    }

    const tx = txRows[0];

    // Verify Razorpay signature
    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');
    if (expectedSig !== razorpay_signature) {
      await client.query('ROLLBACK');
      log.warn({ userId: req.user.id, orderId: razorpay_order_id }, 'Signature mismatch on deposit verify');
      return res.status(400).json({ error: 'Payment signature verification failed', code: 'SIG_MISMATCH' });
    }

    // Ledger credit only — Razorpay already holds the money in nodal account
    const { rows: userRows } = await client.query(
      'SELECT inr_balance FROM users WHERE id = $1', [req.user.id]
    );
    const balanceBefore = parseFloat(userRows[0].inr_balance);
    const balanceAfter  = await adjustLedger(req.user.id, tx.amount, 'credit', client);
    const invoiceNo     = generateInvoiceNo(tx.id);

    await client.query(
      `UPDATE wallet_transactions
       SET status = 'success', razorpay_payment_id = $1, razorpay_signature = $2,
           balance_before = $3, balance_after = $4, gst_invoice_no = $5, updated_at = NOW()
       WHERE id = $6`,
      [razorpay_payment_id, razorpay_signature, balanceBefore, balanceAfter, invoiceNo, tx.id]
    );

    await client.query('COMMIT');

    try { await updateAMLCounter(req.user.id, parseFloat(tx.amount), 'credit'); } catch {}
    try {
      await createNotification(
        req.user.id, 'WALLET', '💰 Funds Deposited',
        `₹${parseFloat(tx.amount).toLocaleString('en-IN')} added to your wallet via ${(tx.method || 'UPI').toUpperCase()}`,
        '/wallet', { amount: tx.amount, paymentId: razorpay_payment_id }
      );
    } catch {}

    log.info({ userId: req.user.id, amount: tx.amount }, 'Deposit ledger credited — nodal model');
    res.json({
      success:      true,
      message:      'Funds credited successfully',
      amount:       tx.amount,
      balance:      balanceAfter,
      reference:    tx.reference,
      paymentId:    razorpay_payment_id,
      gstInvoiceNo: invoiceNo,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    log.error({ err: err?.message, userId: req.user.id }, 'Deposit verify error');
    res.status(500).json({ error: 'Payment verification failed' });
  } finally {
    client.release();
  }
});

// ── Webhook ───────────────────────────────────────────────────────────────────
// Fallback for cases where user closes browser before /verify fires.
// Razorpay will POST payment.captured — we credit ledger here idempotently.
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig         = req.headers['x-razorpay-signature'];
  const body        = req.body;
  const expectedSig = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  if (expectedSig !== sig) {
    log.warn('Webhook signature mismatch — rejecting');
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  const event = JSON.parse(body);
  try {
    if (event.event === 'payment.captured') {
      const payment = event.payload.payment.entity;
      const client  = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: txRows } = await client.query(
          `SELECT * FROM wallet_transactions
           WHERE razorpay_order_id = $1 AND status = 'pending'
           FOR UPDATE SKIP LOCKED`,
          [payment.order_id]
        );
        if (!txRows.length) {
          await client.query('ROLLBACK');
          return res.json({ status: 'already_processed' });
        }
        const tx = txRows[0];
        const { rows: userRows } = await client.query(
          'SELECT inr_balance FROM users WHERE id = $1', [tx.user_id]
        );
        const balanceBefore = parseFloat(userRows[0].inr_balance);
        const balanceAfter  = await adjustLedger(tx.user_id, tx.amount, 'credit', client);
        const invoiceNo     = generateInvoiceNo(tx.id);
        await client.query(
          `UPDATE wallet_transactions
           SET status = 'success', razorpay_payment_id = $1,
               balance_before = $2, balance_after = $3, gst_invoice_no = $4, updated_at = NOW()
           WHERE id = $5`,
          [payment.id, balanceBefore, balanceAfter, invoiceNo, tx.id]
        );
        await client.query('COMMIT');
        log.info({ userId: tx.user_id, amount: tx.amount }, 'Deposit via webhook — ledger credited');
        try { await updateAMLCounter(tx.user_id, parseFloat(tx.amount), 'credit'); } catch {}
        try {
          await createNotification(
            tx.user_id, 'WALLET', '💰 Funds Deposited',
            `₹${parseFloat(tx.amount).toLocaleString('en-IN')} added to your wallet`,
            '/wallet', { amount: tx.amount }
          );
        } catch {}
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    if (event.event === 'payment.failed') {
      const payment = event.payload.payment.entity;
      await query(
        `UPDATE wallet_transactions
         SET status = 'failed', updated_at = NOW()
         WHERE razorpay_order_id = $1 AND status = 'pending'`,
        [payment.order_id]
      );
    }

    // Payout webhook — update withdrawal status when Razorpay processes it
    if (event.event === 'payout.processed') {
      const payout = event.payload.payout.entity;
      await query(
        `UPDATE wallet_transactions
         SET status = 'success', updated_at = NOW(),
             notes = notes || ' | Razorpay payout processed'
         WHERE razorpay_payout_id = $1`,
        [payout.id]
      );
      log.info({ payoutId: payout.id }, 'Payout processed via webhook');
    }

    if (event.event === 'payout.failed') {
      const payout = event.payload.payout.entity;
      // Payout failed — reverse the ledger debit and return funds to user
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: txRows } = await client.query(
          `SELECT * FROM wallet_transactions WHERE razorpay_payout_id = $1`,
          [payout.id]
        );
        if (txRows.length) {
          const tx = txRows[0];
          const balanceBefore = parseFloat((await client.query(
            'SELECT inr_balance FROM users WHERE id = $1', [tx.user_id]
          )).rows[0].inr_balance);
          const balanceAfter = await adjustLedger(tx.user_id, tx.amount, 'credit', client);
          await client.query(
            `UPDATE wallet_transactions
             SET status = 'failed', updated_at = NOW(),
                 notes = notes || ' | Payout failed — ledger reversed'
             WHERE id = $1`,
            [tx.id]
          );
          // Record reversal transaction
          await client.query(
            `INSERT INTO wallet_transactions
               (user_id, type, method, amount, status, balance_before, balance_after, notes)
             VALUES ($1, 'credit', 'system', $2, 'success', $3, $4, $5)`,
            [tx.user_id, tx.amount, balanceBefore, balanceAfter,
             `Withdrawal reversal — payout failed: ${payout.id}`]
          );
          await client.query('COMMIT');
          try {
            await createNotification(
              tx.user_id, 'WALLET', '⚠ Withdrawal Failed',
              `₹${parseFloat(tx.amount).toLocaleString('en-IN')} returned — bank payout failed. Please check your bank details.`,
              '/wallet', { amount: tx.amount }
            );
          } catch {}
          log.warn({ userId: tx.user_id, amount: tx.amount, payoutId: payout.id }, 'Payout failed — ledger reversed');
        } else {
          await client.query('ROLLBACK');
        }
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    res.json({ status: 'ok' });
  } catch (err) {
    log.error({ err: err?.message }, 'Webhook processing error');
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ── Withdraw ──────────────────────────────────────────────────────────────────
// Debits ledger, then fires Razorpay Payout from nodal account to user's bank.
// User's money flows: Razorpay nodal → user's bank account directly.
// EtherTrack's bank account is never involved.
router.post('/withdraw', authenticate, walletWriteLimiter, async (req, res) => {
  const { amount, accountNumber, ifsc, accountName } = req.body;

  if (!amount || amount < 100)
    return res.status(400).json({ error: 'Minimum withdrawal is ₹100' });
  if (!accountNumber || !ifsc || !accountName)
    return res.status(400).json({ error: 'Bank account details required' });
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase()))
    return res.status(400).json({ error: 'Invalid IFSC code format' });
  if (!req.user.kyc_verified)
    return res.status(403).json({ error: 'KYC verification required to withdraw', code: 'KYC_REQUIRED' });

  const today = new Date().toISOString().slice(0, 10);
  const { rows: limitRows } = await query(
    `SELECT COALESCE(SUM(amount), 0) AS used
     FROM wallet_transactions
     WHERE user_id = $1 AND type = 'debit' AND method = 'bank'
       AND DATE(created_at) = $2 AND status != 'failed'`,
    [req.user.id, today]
  );
  const usedToday = parseFloat(limitRows[0].used);
  if (usedToday + amount > DAILY_WITHDRAWAL_LIMIT)
    return res.status(400).json({
      error:     `Daily limit reached. Remaining: ₹${(DAILY_WITHDRAWAL_LIMIT - usedToday).toLocaleString('en-IN')}`,
      code:      'DAILY_LIMIT_EXCEEDED',
      remaining: DAILY_WITHDRAWAL_LIMIT - usedToday,
    });

  const compliance = await runComplianceChecks(req.user.id, amount, 'debit');
  if (!compliance.allowed)
    return res.status(403).json({ error: compliance.reason, code: 'COMPLIANCE_BLOCK' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query(
      'SELECT inr_balance, company_pan FROM users WHERE id = $1 FOR UPDATE',
      [req.user.id]
    );
    const currentBalance = parseFloat(userRows[0].inr_balance);
    const userPan        = userRows[0].company_pan;

    if (currentBalance < amount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient balance', available: currentBalance });
    }

    const tdsAmount     = compliance.tdsAmount || 0;
    const netAmount     = compliance.netAmount  || amount;
    const balanceBefore = currentBalance;
    // Debit ledger immediately — payout is async
    const balanceAfter  = await adjustLedger(req.user.id, amount, 'debit', client);

    const { rows: txRows } = await client.query(
      `INSERT INTO wallet_transactions
         (user_id, type, method, amount, status, balance_before, balance_after,
          bank_account_number, bank_ifsc, bank_account_name, notes)
       VALUES ($1, 'debit', 'bank', $2, 'pending', $3, $4, $5, $6, $7, $8)
       RETURNING id, reference`,
      [
        req.user.id, amount, balanceBefore, balanceAfter,
        accountNumber, ifsc.toUpperCase(),
        sanitiseText(accountName, 60),
        `Withdrawal to ${sanitiseText(accountName, 30)} · ${mask(accountNumber)}` +
        (tdsAmount > 0 ? ` | TDS 194S: ₹${tdsAmount}` : '') +
        ' | Razorpay nodal payout',
      ]
    );

    const txId  = txRows[0].id;
    const txRef = txRows[0].reference;

    await client.query('COMMIT');

    // Fire Razorpay Payout from nodal account — async, status updated via webhook
    let payoutId = null;
    try {
      const { payout } = await initiateRazorpayPayout({
        amount, tdsAmount, accountName, accountNumber,
        ifsc: ifsc.toUpperCase(), reference: txRef, userId: req.user.id,
      });
      payoutId = payout.id;
      // Store payout ID for webhook reconciliation
      await query(
        `UPDATE wallet_transactions SET razorpay_payout_id = $1 WHERE id = $2`,
        [payoutId, txId]
      );
      log.info({ userId: req.user.id, amount, txRef, payoutId }, 'Razorpay payout initiated');
    } catch (payoutErr) {
      // Payout failed to initiate — reverse ledger debit
      log.error({ err: payoutErr?.message, userId: req.user.id, txRef }, 'Payout initiation failed — reversing ledger');
      const reverseClient = await pool.connect();
      try {
        await reverseClient.query('BEGIN');
        const { rows: currentUser } = await reverseClient.query(
          'SELECT inr_balance FROM users WHERE id = $1', [req.user.id]
        );
        const reverseBefore = parseFloat(currentUser[0].inr_balance);
        const reverseAfter  = await adjustLedger(req.user.id, amount, 'credit', reverseClient);
        await reverseClient.query(
          `UPDATE wallet_transactions SET status = 'failed', updated_at = NOW() WHERE id = $1`,
          [txId]
        );
        await reverseClient.query(
          `INSERT INTO wallet_transactions
             (user_id, type, method, amount, status, balance_before, balance_after, notes)
           VALUES ($1, 'credit', 'system', $2, 'success', $3, $4, $5)`,
          [req.user.id, amount, reverseBefore, reverseAfter,
           `Auto-reversal — payout initiation failed: ${txRef}`]
        );
        await reverseClient.query('COMMIT');
      } catch (reverseErr) {
        await reverseClient.query('ROLLBACK');
        log.error({ err: reverseErr?.message, userId: req.user.id }, 'CRITICAL: Ledger reversal failed — manual intervention required');
      } finally {
        reverseClient.release();
      }
      return res.status(500).json({ error: 'Withdrawal failed — payout could not be initiated. Funds returned.' });
    }

    try {
      if (tdsAmount > 0 && compliance.tdsInfo)
        await recordTDS(req.user.id, txId, amount, compliance.tdsInfo, userPan);
    } catch {}
    try { await updateAMLCounter(req.user.id, amount, 'debit'); } catch {}
    try {
      await createNotification(
        req.user.id, 'WALLET', '↑ Withdrawal Initiated',
        `₹${parseFloat(amount).toLocaleString('en-IN')} withdrawal initiated via Razorpay Payouts` +
        (tdsAmount > 0 ? `. TDS ₹${tdsAmount.toLocaleString('en-IN')} deducted (Sec 194S).` : ''),
        '/wallet',
        { amount, tdsAmount, netAmount, reference: txRef }
      );
    } catch {}

    res.json({
      success:    true,
      message:    'Withdrawal initiated. Funds will reach your account in 1–2 business days.',
      reference:  txRef,
      gross:      amount,
      tdsAmount,
      netAmount,
      tdsApplied: tdsAmount > 0,
      tdsSection: tdsAmount > 0 ? '194S' : null,
      balance:    balanceAfter,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    log.error({ err: err?.message, userId: req.user.id }, 'Withdrawal error');
    res.status(500).json({ error: 'Withdrawal failed. Please try again.' });
  } finally {
    client.release();
  }
});

// ── Trade deduct ──────────────────────────────────────────────────────────────
// Debits user ledger, then transfers from nodal → EtherTrack merchant account.
// This settles the trade revenue into our operating account.
router.post('/trade-deduct', authenticate, async (req, res) => {
  const { amount, tokenId, quantity, projectName } = req.body;
  if (!amount || amount <= 0)
    return res.status(400).json({ error: 'Invalid amount' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: userRows } = await client.query(
      'SELECT inr_balance FROM users WHERE id = $1 FOR UPDATE', [req.user.id]
    );
    if (parseFloat(userRows[0].inr_balance) < amount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient balance', available: parseFloat(userRows[0].inr_balance) });
    }
    const balanceBefore = parseFloat(userRows[0].inr_balance);
    const balanceAfter  = await adjustLedger(req.user.id, amount, 'debit', client);
    const { rows: txRows } = await client.query(
      `INSERT INTO wallet_transactions
         (user_id, type, method, amount, status, balance_before, balance_after, notes)
       VALUES ($1, 'debit', 'system', $2, 'success', $3, $4, $5)
       RETURNING reference`,
      [req.user.id, amount, balanceBefore, balanceAfter,
       `Trade: ${quantity} × ${sanitiseText(projectName || 'carbon credits', 60)} (Token #${tokenId})`]
    );
    await client.query('COMMIT');

    // Transfer from Razorpay nodal → EtherTrack merchant account (async, non-blocking)
    const txRef = txRows[0].reference;
    try {
      await transferNodalToMerchant(amount, txRef);
      log.info({ userId: req.user.id, amount, tokenId }, 'Trade settled — nodal → merchant transfer done');
    } catch (transferErr) {
      // Non-critical: ledger debit succeeded; transfer can be retried via reconciliation job
      log.error({ err: transferErr?.message, userId: req.user.id, txRef },
        'Nodal→merchant transfer failed — schedule reconciliation');
      // TODO: push txRef to a reconciliation queue (e.g. Redis LPUSH 'pending_transfers' txRef)
    }

    try {
      await createNotification(
        req.user.id, 'TRADE', '🌿 Credit Purchase Paid',
        `₹${parseFloat(amount).toLocaleString('en-IN')} deducted for ${quantity} × ${projectName || 'carbon credits'}`,
        '/portfolio', { amount, quantity, projectName, tokenId }
      );
    } catch {}
    log.info({ userId: req.user.id, amount, tokenId }, 'Trade deducted');
    res.json({ success: true, balance: balanceAfter });
  } catch (err) {
    await client.query('ROLLBACK');
    log.error({ err: err?.message, userId: req.user.id }, 'Trade deduct error');
    res.status(500).json({ error: 'Payment failed' });
  } finally {
    client.release();
  }
});

// ── Trade refund ──────────────────────────────────────────────────────────────
// Credits user ledger, then transfers from EtherTrack merchant → nodal account.
router.post('/trade-refund', authenticate, async (req, res) => {
  const { amount, reference } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  if (!reference)             return res.status(400).json({ error: 'Idempotency reference required' });

  const { rows: existing } = await query(
    `SELECT id FROM wallet_transactions
     WHERE user_id = $1 AND type = 'credit' AND method = 'system'
       AND notes LIKE $2`,
    [req.user.id, `%Refund%${reference}%`]
  );
  if (existing.length)
    return res.json({ success: true, message: 'Already refunded', idempotent: true });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: userRows } = await client.query(
      'SELECT inr_balance FROM users WHERE id = $1 FOR UPDATE', [req.user.id]
    );
    const balanceBefore = parseFloat(userRows[0].inr_balance);
    const balanceAfter  = await adjustLedger(req.user.id, amount, 'credit', client);
    await client.query(
      `INSERT INTO wallet_transactions
         (user_id, type, method, amount, status, balance_before, balance_after, notes)
       VALUES ($1, 'credit', 'system', $2, 'success', $3, $4, $5)`,
      [req.user.id, amount, balanceBefore, balanceAfter,
       `Refund — MetaMask rejected: ${sanitiseText(reference, 40)}`]
    );
    await client.query('COMMIT');

    // Transfer from EtherTrack merchant account back to nodal (replenish user's float)
    try {
      await transferMerchantToNodal(amount, reference);
      log.info({ userId: req.user.id, amount, reference }, 'Refund settled — merchant → nodal transfer done');
    } catch (transferErr) {
      log.error({ err: transferErr?.message, userId: req.user.id, reference },
        'Merchant→nodal transfer failed on refund — schedule reconciliation');
    }

    try {
      await createNotification(
        req.user.id, 'WALLET', '↩ Trade Refunded',
        `₹${parseFloat(amount).toLocaleString('en-IN')} refunded — MetaMask transaction rejected`,
        '/wallet', { amount }
      );
    } catch {}
    log.info({ userId: req.user.id, amount, reference }, 'Trade refunded');
    res.json({ success: true, balance: balanceAfter, refunded: amount });
  } catch (err) {
    await client.query('ROLLBACK');
    log.error({ err: err?.message, userId: req.user.id }, 'Trade refund error');
    res.status(500).json({ error: 'Refund failed' });
  } finally {
    client.release();
  }
});

// ── MetaMask: challenge ───────────────────────────────────────────────────────
router.get('/challenge', authenticate, (req, res) => {
  const ts = Date.now();
  const message = [
    'EtherTrack Wallet Binding',
    `Account: ${req.user.email}`,
    `User ID: ${req.user.id}`,
    `Timestamp: ${ts}`,
    'By signing this message, you are binding this wallet to your EtherTrack account.',
    'This does not initiate a blockchain transaction or cost any gas.',
  ].join('\n');
  res.json({ message, ts });
});

// ── MetaMask: bind wallet ─────────────────────────────────────────────────────
router.post('/bind', authenticate, walletWriteLimiter, async (req, res) => {
  const { walletAddress, signature, message } = req.body;
  if (!walletAddress || !signature || !message)
    return res.status(400).json({ error: 'walletAddress, signature and message required' });

  const tsMatch = message.match(/Timestamp: (\d+)/);
  if (!tsMatch || Date.now() - parseInt(tsMatch[1]) > 5 * 60 * 1000)
    return res.status(400).json({ error: 'Challenge expired. Request a new one.', code: 'CHALLENGE_EXPIRED' });

  const msgHash = crypto.createHash('sha256').update(message).digest('hex');
  try {
    const { rows: replayRows } = await query(
      'SELECT 1 FROM used_challenge_hashes WHERE hash = $1', [msgHash]
    );
    if (replayRows.length)
      return res.status(400).json({ error: 'Challenge already used. Request a new one.', code: 'REPLAY_DETECTED' });
    await query(
      'INSERT INTO used_challenge_hashes (hash, used_at) VALUES ($1, NOW()) ON CONFLICT DO NOTHING',
      [msgHash]
    );
  } catch {
    log.warn('used_challenge_hashes table missing — replay protection degraded');
  }

  try {
    const recoveredAddress = ethers.verifyMessage(message, signature);
    if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase())
      return res.status(400).json({ error: 'Signature verification failed' });

    const { rows: existing } = await query(
      'SELECT id FROM users WHERE LOWER(wallet_address) = LOWER($1) AND id != $2',
      [walletAddress, req.user.id]
    );
    if (existing.length)
      return res.status(409).json({ error: 'Wallet already bound to another account', code: 'WALLET_TAKEN' });

    const { rows: currentUser } = await query(
      'SELECT wallet_address FROM users WHERE id = $1', [req.user.id]
    );
    if (
      currentUser[0]?.wallet_address &&
      currentUser[0].wallet_address.toLowerCase() !== walletAddress.toLowerCase()
    ) {
      return res.status(409).json({
        error: 'You already have a wallet bound. Contact support to change it.',
        code:  'WALLET_ALREADY_BOUND',
      });
    }

    await query(
      'UPDATE users SET wallet_address = $1, wallet_bound_at = NOW(), updated_at = NOW() WHERE id = $2',
      [walletAddress, req.user.id]
    );
    log.info({ userId: req.user.id, wallet: mask(walletAddress) }, 'Wallet bound');
    res.json({ message: 'Wallet bound successfully', walletAddress });
  } catch (err) {
    log.error({ err: err?.message, userId: req.user.id }, 'Wallet bind error');
    res.status(500).json({ error: 'Failed to bind wallet' });
  }
});

// ── Wallet status ─────────────────────────────────────────────────────────────
router.get('/status', authenticate, walletReadLimiter, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT wallet_address, wallet_bound_at, kyc_status, kyc_verified,
              inr_balance, inr_balance_locked FROM users WHERE id = $1`,
      [req.user.id]
    );
    const user = rows[0];
    res.json({
      walletBound:      !!user?.wallet_address,
      walletAddress:    user?.wallet_address,
      boundAt:          user?.wallet_bound_at,
      kycStatus:        user?.kyc_status,
      kycVerified:      !!user?.kyc_verified,
      inrBalance:       parseFloat(user?.inr_balance       || 0),
      inrBalanceLocked: parseFloat(user?.inr_balance_locked || 0),
      nodalModel:       true,
    });
  } catch (err) {
    log.error({ err: err?.message, userId: req.user.id }, 'Status fetch error');
    res.status(500).json({ error: 'Failed to fetch wallet status' });
  }
});

// ── KYC sync ──────────────────────────────────────────────────────────────────
router.post('/kyc', authenticate, async (req, res) => {
  const { kycDataHash, aadhaarHash, panHash } = req.body;
  try {
    if (req.user.wallet_address) {
      let isVerified = false;
      try {
        const provider    = new ethers.JsonRpcProvider(process.env.ALCHEMY_RPC);
        const kycContract = new ethers.Contract(
          process.env.KYC_REGISTRY_ADDRESS,
          ['function isKYCVerified(address wallet) view returns (bool)'],
          provider
        );
        isVerified = await kycContract.isKYCVerified(req.user.wallet_address);
      } catch { isVerified = false; }
      if (!isVerified)
        return res.status(400).json({ error: 'Wallet not KYC verified on-chain', code: 'KYC_NOT_ON_CHAIN' });
    }

    if (aadhaarHash) {
      const { rows } = await query(
        'SELECT id FROM users WHERE kyc_aadhaar_hash = $1 AND id != $2',
        [aadhaarHash, req.user.id]
      );
      if (rows.length) return res.status(409).json({ error: 'duplicate_kyc', code: 'DUPLICATE_KYC' });
    }
    if (panHash) {
      const { rows } = await query(
        'SELECT id FROM users WHERE kyc_pan_hash = $1 AND id != $2',
        [panHash, req.user.id]
      );
      if (rows.length) return res.status(409).json({ error: 'duplicate_kyc', code: 'DUPLICATE_KYC' });
    }

    await query(
      `UPDATE users
       SET kyc_status       = 'pending',
           kyc_verified     = FALSE,
           kyc_data_hash    = $1,
           kyc_aadhaar_hash = COALESCE($2, kyc_aadhaar_hash),
           kyc_pan_hash     = COALESCE($3, kyc_pan_hash),
           kyc_submitted_at = NOW(),
           updated_at       = NOW()
       WHERE id = $4`,
      [kycDataHash || null, aadhaarHash || null, panHash || null, req.user.id]
    );

    try {
      await createNotification(
        req.user.id, 'KYC', '📋 KYC Submitted',
        'Your KYC documents are under review. You will be notified once verified.',
        '/kyc', {}
      );
    } catch {}

    log.info({ userId: req.user.id }, 'KYC submitted');
    res.json({ message: 'KYC submitted for review.', kycStatus: 'pending', kycVerified: false });
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'duplicate_kyc', code: 'DUPLICATE_KYC' });
    log.error({ err: err?.message, userId: req.user.id }, 'KYC sync error');
    res.status(500).json({ error: 'KYC sync failed' });
  }
});

// ── Bank accounts ─────────────────────────────────────────────────────────────
router.get('/bank-accounts', authenticate, walletReadLimiter, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, account_name, account_number, ifsc, bank_name, is_default, created_at
       FROM user_bank_accounts
       WHERE user_id = $1
       ORDER BY is_default DESC, created_at ASC`,
      [req.user.id]
    );
    res.json({ accounts: rows });
  } catch (err) {
    log.error({ err: err?.message, userId: req.user.id }, 'Bank accounts fetch error');
    res.status(500).json({ error: 'Failed to fetch bank accounts' });
  }
});

router.post('/bank-accounts', authenticate, async (req, res) => {
  const { accountName, accountNumber, ifsc, bankName } = req.body;

  if (!accountName || !accountNumber || !ifsc || !bankName)
    return res.status(400).json({ error: 'All bank account fields are required' });
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase()))
    return res.status(400).json({ error: 'Invalid IFSC code format (e.g. HDFC0001234)' });

  const { rows: countRows } = await query(
    'SELECT COUNT(*) FROM user_bank_accounts WHERE user_id = $1', [req.user.id]
  );
  const count   = parseInt(countRows[0].count);
  const isFirst = count === 0;
  if (count >= 5)
    return res.status(400).json({ error: 'Maximum 5 bank accounts allowed' });

  try {
    const { rows } = await query(
      `INSERT INTO user_bank_accounts
         (user_id, account_name, account_number, ifsc, bank_name, is_default)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, account_name, account_number, ifsc, bank_name, is_default, created_at`,
      [req.user.id, sanitiseText(accountName, 60), accountNumber.trim(),
       ifsc.toUpperCase(), sanitiseText(bankName, 60), isFirst]
    );
    log.info({ userId: req.user.id, account: mask(accountNumber) }, 'Bank account added');
    res.json({ success: true, account: rows[0] });
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'This bank account is already saved' });
    log.error({ err: err?.message, userId: req.user.id }, 'Bank account add error');
    res.status(500).json({ error: 'Failed to save bank account' });
  }
});

router.put('/bank-accounts/:id/default', authenticate, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE user_bank_accounts SET is_default = false WHERE user_id = $1', [req.user.id]
    );
    const { rows } = await client.query(
      `UPDATE user_bank_accounts SET is_default = true
       WHERE id = $1 AND user_id = $2
       RETURNING id, account_name, account_number, is_default`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Account not found' });
    }
    await client.query('COMMIT');
    res.json({ success: true, account: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    log.error({ err: err?.message, userId: req.user.id }, 'Set default account error');
    res.status(500).json({ error: 'Failed to update default account' });
  } finally {
    client.release();
  }
});

router.delete('/bank-accounts/:id', authenticate, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `DELETE FROM user_bank_accounts
       WHERE id = $1 AND user_id = $2
       RETURNING id, is_default`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Account not found' });
    }
    if (rows[0].is_default) {
      await client.query(
        `UPDATE user_bank_accounts SET is_default = true
         WHERE id = (
           SELECT id FROM user_bank_accounts
           WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1
         )`,
        [req.user.id]
      );
    }
    await client.query('COMMIT');
    log.info({ userId: req.user.id }, 'Bank account deleted');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    log.error({ err: err?.message, userId: req.user.id }, 'Bank account delete error');
    res.status(500).json({ error: 'Failed to delete bank account' });
  } finally {
    client.release();
  }
});

module.exports = router;