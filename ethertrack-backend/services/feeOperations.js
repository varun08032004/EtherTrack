'use strict';
// services/feeOperations.js — EtherTrack  [FIXED]
// ─────────────────────────────────────────────────────────────────────────────
// FIX: sweepPlatformFees() — balance check + debit now inside ONE withTransaction
//      call so the FOR UPDATE lock is held continuously until the debit commits.
//      Previously the FOR UPDATE was outside the transaction, meaning the lock
//      released immediately and a concurrent fee credit could race the debit.
//
// TWO JOBS (unchanged):
//
// 1. createSellerFundAccount(userId)
//    Called when a seller saves their bank account.
//    Creates Razorpay Contact + FundAccount for auto-split on direct checkout.
//    Stores razorpay_contact_id and razorpay_fund_account_id on the user.
//
// 2. sweepPlatformFees()
//    Weekly cron — transfers accumulated platform fees from company DB balance
//    to company bank account via Razorpay Payout.
//
// WIRE UP:
//    In routes/wallet.js, after saveBankAccount succeeds, call:
//      createSellerFundAccount(req.user.id).catch(err => console.error(err))
//
//    In server.js:
//      const cron        = require('node-cron');
//      const feeOps      = require('./services/feeOperations');
//      const chainLogger = require('./services/chainLogger');
//
//      cron.schedule('*/5 * * * *', () => chainLogger.retryPendingLogs().catch(console.error));
//      cron.schedule('0 * * * *',   () => chainLogger.batchLogPending().catch(console.error));
//      cron.schedule('30 4 * * 1',  () => feeOps.sweepPlatformFees().catch(console.error));
// ─────────────────────────────────────────────────────────────────────────────

const Razorpay    = require('razorpay');
const { safeQuery: query, withTransaction } = require('../db/pool');
const { getBreaker } = require('../lib/circuitBreaker');
const razorpayBreaker = getBreaker('razorpay', {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 30000
});

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

const withRazorpay = (fn) => razorpayBreaker.execute(async () => {
  const rzp = getRazorpay();
  return fn(rzp);
});

const COMPANY_USER_ID = process.env.COMPANY_USER_ID;

// ─────────────────────────────────────────────────────────────────────────────
// createSellerFundAccount — unchanged
// Called once per seller when they add their bank account.
// ─────────────────────────────────────────────────────────────────────────────
async function createSellerFundAccount(userId) {
  const { rows } = await query(
    `SELECT u.email, u.full_name, u.phone,
            u.razorpay_contact_id, u.razorpay_fund_account_id,
            ba.account_number, ba.ifsc, ba.account_name, ba.bank_name
     FROM users u
     LEFT JOIN bank_accounts ba ON ba.user_id = u.id AND ba.is_default = TRUE
     WHERE u.id = $1`, [userId]
  );

  if (!rows.length) throw new Error('User not found');
  const user = rows[0];

  if (!user.account_number || !user.ifsc)
    throw new Error('No default bank account found. Add a bank account first.');

  // Idempotent — already set up, return existing IDs
  if (user.razorpay_fund_account_id) {
    return {
      contactId:      user.razorpay_contact_id,
      fundAccountId:  user.razorpay_fund_account_id,
      alreadyExisted: true,
    };
  }

  // Create Razorpay Contact
  const contact = await withRazorpay((rzp) => rzp.contacts.create({
    name:         user.account_name || user.full_name,
    email:        user.email,
    contact:      user.phone || undefined,
    type:         'vendor',
    reference_id: String(userId),
    notes: {
      platform: 'ethertrack',
      user_id:  String(userId),
    },
  }));

  // Create Fund Account (bank linked to contact)
  const fundAccount = await withRazorpay((rzp) => rzp.fundAccount.create({
    contact_id:   contact.id,
    account_type: 'bank_account',
    bank_account: {
      name:           user.account_name || user.full_name,
      ifsc:           user.ifsc,
      account_number: user.account_number,
    },
  }));

  // Persist on user row
  await query(
    `UPDATE users
     SET razorpay_contact_id = $1, razorpay_fund_account_id = $2, updated_at = NOW()
     WHERE id = $3`,
    [contact.id, fundAccount.id, userId]
  );

  console.log(`[feeOps] Seller ${userId} — Razorpay fund account created: ${fundAccount.id}`);

  return { contactId: contact.id, fundAccountId: fundAccount.id, alreadyExisted: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// sweepPlatformFees  [FIXED]
//
// FIX: balance check (SELECT FOR UPDATE) and debit (UPDATE users) are now in
//      the SAME withTransaction block. This ensures:
//      1. The row lock is held from read to write — no concurrent credit can
//         sneak between them.
//      2. If the Razorpay payout fails, the transaction is already committed
//         (debit happened) — we restore balance in the catch block as before.
//      3. The sweep log insert is also inside the transaction, so it rolls back
//         automatically if the debit fails.
// ─────────────────────────────────────────────────────────────────────────────
async function sweepPlatformFees() {
  if (!COMPANY_USER_ID) {
    console.error('[feeOps] COMPANY_USER_ID not set — cannot sweep fees');
    return { success: false, error: 'COMPANY_USER_ID not set' };
  }

  // Get period stats (outside tx — read-only, no locking needed)
  const { rows: periodStats } = await query(
    `SELECT COUNT(*) AS cnt,
            MIN(created_at) AS period_start,
            MAX(created_at) AS period_end
     FROM wallet_transactions
     WHERE user_id = $1 AND type = 'credit' AND status = 'success'
       AND created_at > COALESCE(
         (SELECT MAX(completed_at) FROM company_fee_sweeps WHERE status = 'completed'),
         NOW() - INTERVAL '7 days'
       )`,
    [COMPANY_USER_ID]
  );
  const stats = periodStats[0];

  // ── FIX: balance check + debit inside ONE transaction ────────────────────
  let balance, gstOwed, netAmount, sweepId;

  try {
    await withTransaction(async (client) => {
      // Lock the company row — held until transaction commits
      const { rows: companyRows } = await client.query(
        `SELECT inr_balance FROM users WHERE id = $1 FOR UPDATE`,
        [COMPANY_USER_ID]
      );

      if (!companyRows.length) throw new Error('Company user not found');

      balance = parseFloat(companyRows[0].inr_balance);

      if (balance < 500) {
        // Throw a sentinel so we can detect "below threshold" vs real errors
        throw Object.assign(
          new Error('BELOW_THRESHOLD'),
          { belowThreshold: true, balance }
        );
      }

      // GST portion embedded in the collected fees
      gstOwed   = parseFloat((balance * 0.18 / 1.18).toFixed(2));
      netAmount = parseFloat((balance - gstOwed).toFixed(2));

      // Zero out company balance — locked row, no race possible now
      await client.query(
        `UPDATE users SET inr_balance = 0, updated_at = NOW() WHERE id = $1`,
        [COMPANY_USER_ID]
      );

      // Create sweep record inside same transaction — rolls back if debit fails
      const { rows: sweepRow } = await client.query(
        `INSERT INTO company_fee_sweeps
           (amount_inr, gst_inr, net_inr, status,
            sweep_period_start, sweep_period_end, trade_count)
         VALUES ($1,$2,$3,'pending',$4,$5,$6) RETURNING id`,
        [balance, gstOwed, netAmount,
         stats.period_start || new Date(),
         stats.period_end   || new Date(),
         parseInt(stats.cnt || 0)]
      );
      sweepId = sweepRow[0].id;
    });
  } catch (err) {
    if (err.belowThreshold) {
      console.log(`[feeOps] Balance ₹${err.balance} below sweep threshold — skipping`);
      return { success: true, swept: 0, reason: 'below_threshold' };
    }
    console.error('[feeOps] Failed to debit company balance:', err.message);
    return { success: false, error: err.message };
  }

  // ── Razorpay Payout (outside DB transaction — external call) ─────────────
  try {
    const payout = await withRazorpay((rzp) => rzp.payouts.create({
      account_number:       process.env.RAZORPAY_ACCOUNT_NUMBER,
      fund_account_id:      process.env.COMPANY_FUND_ACCOUNT_ID,
      amount:               Math.round(balance * 100), // paise
      currency:             'INR',
      mode:                 balance > 200000 ? 'NEFT' : 'IMPS',
      purpose:              'payout',
      queue_if_low_balance: true,
      notes: {
        sweep_id:    String(sweepId),
        period:      `${stats.period_start} to ${stats.period_end}`,
        trade_count: String(stats.cnt || 0),
        gst_owed:    String(gstOwed),
        platform:    'ethertrack',
      },
    }));

    await query(
      `UPDATE company_fee_sweeps
       SET razorpay_payout_id = $1, status = 'completed', completed_at = NOW()
       WHERE id = $2`,
      [payout.id, sweepId]
    );

    await query(
      `INSERT INTO wallet_transactions
         (user_id, type, method, amount, status, notes, trade_type)
       VALUES ($1, 'debit', 'razorpay_payout', $2, 'success', $3, 'fee_sweep')`,
      [COMPANY_USER_ID, balance,
       `Weekly fee sweep — Razorpay payout ${payout.id} | GST owed: ₹${gstOwed}`]
    );

    console.log(`[feeOps] Swept ₹${balance} → payout ${payout.id} | GST owed: ₹${gstOwed}`);
    return { success: true, swept: balance, gstOwed, netAmount, payoutId: payout.id };

  } catch (err) {
    // Payout failed after debit — restore balance so funds aren't lost
    await query(
      `UPDATE users SET inr_balance = inr_balance + $1, updated_at = NOW() WHERE id = $2`,
      [balance, COMPANY_USER_ID]
    );
    await query(
      `UPDATE company_fee_sweeps SET status = 'failed' WHERE id = $1`, [sweepId]
    );
    console.error('[feeOps] Payout failed — balance restored:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { createSellerFundAccount, sweepPlatformFees };