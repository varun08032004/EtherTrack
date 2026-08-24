'use strict';
/**
 * routes/trades.js -- EtherTrack Production Settlement Engine v4 (MERGED)
 * -----------------------------------------------------------------------------
 * [CERT-OWNERSHIP] [NEW] Every completed purchase now issues a Certificate
 *                  of Ownership (see services/certificates.js), not just
 *                  retirements. Covers wallet-based (real transfer) and
 *                  ledger-based (wallet-free, pooled custody) buyers alike.
 * -----------------------------------------------------------------------------
 */

const router      = require('express').Router();
const Razorpay    = require('razorpay');
const crypto      = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { safeQuery: query, withTransaction } = require('../db/pool');
const { authenticate, requireKYC }          = require('../middleware/auth');
const { createNotification }                = require('./notifications');
const chainLogger                           = require('../services/chainLogger');
const { generateTradeInvoice, generateTradeBill, serveTradeInvoice, getGSTType } = require('../services/invoice');
const { pdfQueue } = require('../services/pdfQueue');
const { sendCreditsSoldEmail } = require('../services/email');
const { issueOwnershipCertificate } = require('../services/certificates');
const { generateIdempotencyLockKey, acquireAdvisoryLockInt } = require('../lib/advisoryLock');
const { SettlementEngine } = require('../src/services/settlement/SettlementEngine');
const { TradeService } = require('../src/services/trade/TradeService');
const { ListingService } = require('../src/services/listing/ListingService');

const settlementEngine = new SettlementEngine();
const tradeService = new TradeService(settlementEngine, new ListingService());

const logger = require('../services/logger');

// ── Request logger middleware with correlation ID ───────────────────────────────
router.use((req, _res, next) => {
  req.log = logger.child({
    requestId: req.requestId,
    userId: req.user?.id,
    path: req.path,
    method: req.method,
  });
  next();
});

// ── Razorpay with circuit breaker ────────────────────────────────────
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

const PLATFORM_FEE_BPS  = 100;
const GST_RATE          = 0.18;
const COMPANY_USER_ID   = process.env.COMPANY_USER_ID;
const MAX_SLIPPAGE      = 0.01;

const tradeLimiter = rateLimit({
  windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => req.user?.id ?? ipKeyGenerator(req),
  handler: (req, res) =>
    res.status(429).json({ error: 'Too many trade attempts. Please wait.' }),
});
const readLimiter = rateLimit({
  windowMs: 60_000, max: 120,
  keyGenerator: req => req.user?.id ?? ipKeyGenerator(req),
});

let _cachedRate    = 280000;
let _lastFetchedAt = 0;
const RATE_TTL_MS  = 60_000;

const getLiveETHRate = async () => {
  const now = Date.now();
  if (now - _lastFetchedAt < RATE_TTL_MS) return _cachedRate;
  try {
    const ctrl    = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 3000);
    const res     = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=inr',
      { signal: ctrl.signal }
    );
    clearTimeout(timeout);
    const data = await res.json();
    if (data?.ethereum?.inr) {
      _cachedRate    = data.ethereum.inr;
      _lastFetchedAt = now;
      await query(`INSERT INTO eth_inr_rates (rate, source) VALUES ($1, 'coingecko')`,
        [_cachedRate]).catch(() => {});
    }
  } catch {}
  return _cachedRate;
};

function calcFees(subtotalINR) {
  const buyerFeeINR    = parseFloat((subtotalINR * PLATFORM_FEE_BPS / 2 / 10000).toFixed(2));
  const sellerFeeINR   = parseFloat((subtotalINR * PLATFORM_FEE_BPS / 2 / 10000).toFixed(2));
  const totalFeeINR    = parseFloat((buyerFeeINR + sellerFeeINR).toFixed(2));
  const gstINR         = parseFloat((totalFeeINR * GST_RATE).toFixed(2));
  const buyerPaysINR   = parseFloat((subtotalINR + buyerFeeINR + gstINR / 2).toFixed(2));
  const sellerGetsINR  = parseFloat((subtotalINR - sellerFeeINR - gstINR / 2).toFixed(2));
  const platformNetINR = parseFloat((totalFeeINR - gstINR).toFixed(2));
  return { buyerFeeINR, sellerFeeINR, totalFeeINR, gstINR, buyerPaysINR, sellerGetsINR, platformNetINR };
}

async function checkIdempotency(userId, key, client) {
  if (!key) return null;
  const target = client || query;
  const { rows } = await target(
    `SELECT id, buyer_pays_inr FROM trades
     WHERE buyer_id = $1 AND idempotency_key = $2 AND status = 'completed' LIMIT 1`,
    [userId, key]
  );
  return rows[0] || null;
}

async function fireTradeInvoice({ tradeId, buyerId, projectName, standard, registrySerial, qty, subtotalINR, fees, paymentMode }) {
  try {
    const { rows: userRows } = await query(
      `SELECT full_name, email FROM users WHERE id = $1`, [buyerId]
    );
    const user = userRows[0] || {};
    await pdfQueue.generateTradeInvoice({
      tradeId,
      buyerName:   user.full_name || '',
      buyerEmail:  user.email     || '',
      projectName,
      standard,
      registrySerial,
      qty,
      subtotalINR,
      buyerFeeINR:   fees.buyerFeeINR,
      gstINR:        fees.gstINR,
      totalPaidINR:  fees.buyerPaysINR,
      paymentMode,
    });
  } catch (err) {
    req.log.error('[trades/fireTradeInvoice] failed (trade unaffected):', err.message);
  }
}

async function fireTradeBill({ tradeId, buyerId, projectName, standard, registrySerial, qty, subtotalINR, fees, txHash, ethRate, totalETH }) {
  try {
    const { rows: userRows } = await query(
      `SELECT full_name, email FROM users WHERE id = $1`, [buyerId]
    );
    const user = userRows[0] || {};
    await pdfQueue.generateTradeBill({
      tradeId,
      buyerName:   user.full_name || '',
      buyerEmail:  user.email     || '',
      projectName,
      standard,
      registrySerial,
      qty,
      subtotalINR,
      buyerFeeINR:  fees.buyerFeeINR,
      totalPaidINR: fees.buyerPaysINR,
      txHash,
      ethRate,
      totalETH,
    });
  } catch (err) {
    req.log.error('[trades/fireTradeBill] failed (trade unaffected):', err.message);
  }
}

router.get('/eth-rate', readLimiter, async (req, res) => {
  try {
    const rate = await getLiveETHRate();
    res.json({ rate, source: 'coingecko', cachedAt: new Date(_lastFetchedAt).toISOString() });
  } catch {
    res.json({ rate: _cachedRate, source: 'cache' });
  }
});

router.post('/record', (req, res) => {
  res.status(410).json({
    error: 'Deprecated. Use /api/trades/checkout-order + /api/trades/checkout-verify',
    migration: 'https://docs.ethertrack.in/migration/settlement-engine'
  });
});

router.post('/checkout-order', authenticate, requireKYC, tradeLimiter, async (req, res) => {
  const { batchId, listingId, quantity, pricePerCreditINR } = req.body;

  if (!batchId || !quantity || !pricePerCreditINR)
    return res.status(400).json({ error: 'batchId, quantity, pricePerCreditINR required' });

  if (listingId == null) {
    return res.status(400).json({
      error: 'This batch is not yet listed on-chain. Ask the seller to list it before it can be purchased.',
    });
  }

  const qty          = parseInt(quantity);
  const pricePerCredit = parseFloat(pricePerCreditINR);
  if (!qty || qty <= 0)               return res.status(400).json({ error: 'Invalid quantity' });
  if (!pricePerCredit || pricePerCredit <= 0) return res.status(400).json({ error: 'Invalid price' });

  try {
    const { rows: batches } = await query(
      `SELECT cb.*, u.id AS seller_id, u.wallet_address AS seller_wallet,
              u.razorpay_contact_id, u.razorpay_fund_account_id
       FROM carbon_batches cb JOIN users u ON u.id = cb.user_id
       WHERE cb.id = $1`, [batchId]
    );
    if (!batches.length) return res.status(404).json({ error: 'Batch not found' });
    const batch = batches[0];

    if (batch.seller_id === req.user.id)
      return res.status(400).json({ error: 'Cannot buy your own listing' });
    if (batch.available_credits < qty)
      return res.status(400).json({ error: `Only ${batch.available_credits} credits available` });

    const subtotalINR = parseFloat((pricePerCredit * qty).toFixed(2));
    const fees        = calcFees(subtotalINR);

    const transfers = [];
    if (batch.razorpay_fund_account_id) {
      transfers.push({
        account:  batch.razorpay_fund_account_id,
        amount:   Math.round(fees.sellerGetsINR * 100),
        currency: 'INR',
        notes: { trade_batch_id: batchId, project_name: batch.project_name, quantity: String(qty) },
        on_hold: 0,
      });
    }

    const order = await withRazorpay((rzp) => rzp.orders.create({
      amount:   Math.round(fees.buyerPaysINR * 100),
      currency: 'INR',
      transfers,
      notes: {
        buyer_id: String(req.user.id), seller_id: String(batch.seller_id),
        batch_id: String(batchId), quantity: String(qty),
        price_per_credit: String(pricePerCredit), payment_mode: 'direct_razorpay',
      },
    }));

    await query(
      `INSERT INTO razorpay_checkout_orders
         (razorpay_order_id, buyer_id, seller_id, batch_id, listing_id,
          quantity, price_per_credit_inr, subtotal_inr,
          buyer_pays_inr, seller_gets_inr, total_fee_inr, gst_inr,
          status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',NOW())`,
      [order.id, req.user.id, batch.seller_id, batchId, listingId || null,
       qty, pricePerCredit, subtotalINR,
       fees.buyerPaysINR, fees.sellerGetsINR, fees.totalFeeINR, fees.gstINR]
    );

    return res.json({
      orderId: order.id, amount: order.amount, currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      buyerPaysINR: fees.buyerPaysINR, sellerGetsINR: fees.sellerGetsINR,
      totalFeeINR: fees.totalFeeINR, gstINR: fees.gstINR,
    });
  } catch (e) {
    req.log.error('[trades/checkout-order]', e.message);
    return res.status(500).json({ error: e.message || 'Failed to create order' });
  }
});

router.post('/checkout-verify', authenticate, requireKYC, tradeLimiter, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, idempotencyKey } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
    return res.status(400).json({ error: 'razorpay_order_id, razorpay_payment_id, razorpay_signature required' });

  const expectedSig = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');
  if (expectedSig !== razorpay_signature)
    return res.status(400).json({ error: 'Invalid payment signature' });

  const { rows: orders } = await query(
    `SELECT * FROM razorpay_checkout_orders WHERE razorpay_order_id = $1 AND buyer_id = $2`,
    [razorpay_order_id, req.user.id]
  );
  if (!orders.length) return res.status(404).json({ error: 'Order not found' });
  const order = orders[0];
  if (order.status === 'completed')
    return res.json({ success: true, tradeId: order.trade_id, idempotent: true });

  const existing = await checkIdempotency(req.user.id, idempotencyKey);
  if (existing) return res.json({ success: true, tradeId: existing.id, idempotent: true });

  // Use advisory lock to prevent concurrent trades on the same batch
  const batchLockKey = parseInt(order.batch_id.replace(/-/g, ''), 16) % 2147483647;
  await query(`SELECT pg_advisory_xact_lock($1)`, [batchLockKey]);

  await withTransaction(async (client) => {
      // Lock the batch row FIRST -- eliminates race window
      const { rows: batchLocked } = await client.query(
        `SELECT cb.*, u.id AS seller_id, u.wallet_address AS seller_wallet,
                u.email AS seller_email, u.full_name AS seller_name
         FROM carbon_batches cb JOIN users u ON u.id = cb.user_id
         WHERE cb.id = $1 FOR UPDATE`, [order.batch_id]
      );
      if (!batchLocked.length) throw Object.assign(new Error('Batch not found'), { statusCode: 404 });
      const batch    = batchLocked[0];
      const sellerId = batch.seller_id;

      const { rows: bl } = await client.query(
        `SELECT available_credits, listed_quantity FROM carbon_batches WHERE id = $1 FOR UPDATE`, [order.batch_id]
      );
      if (!bl.length || bl[0].available_credits < qty)
        throw Object.assign(new Error(`Only ${bl[0]?.available_credits || 0} credits available`), { statusCode: 400 });

      const { rows: tr } = await client.query(
        `INSERT INTO trades (
          buyer_id, seller_id, buyer_wallet, seller_wallet,
          batch_id, token_id, listing_id_onchain, quantity,
          price_per_credit_inr, subtotal_inr,
          buyer_fee_inr, seller_fee_inr, total_fee_inr, gst_inr,
          buyer_pays_inr, seller_receives_inr, platform_net_inr,
          price_per_credit_eth, total_eth, eth_inr_rate, fee_eth,
          payment_mode, status, razorpay_payment_id, razorpay_order_id,
          buyer_inr_deducted, seller_inr_credited,
          inr_settlement_at, completed_at, idempotency_key, chain_status
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
          'direct_razorpay','completed',$22,$23,
          true, true, NOW(), NOW(), $24, 'pending'
        ) RETURNING id`,
        [
          req.user.id, sellerId, req.user.wallet_address || null, batch.seller_wallet,
          order.batch_id, batch.token_id, order.listing_id || null, qty,
          pricePerCredit, subtotal,
          fees.buyerFeeINR, fees.sellerFeeINR, fees.totalFeeINR, fees.gstINR,
          fees.buyerPaysINR, fees.sellerGetsINR, fees.platformNetINR,
          pricePerCredit / ethRate, subtotal / ethRate, ethRate, fees.totalFeeINR / ethRate,
          razorpay_payment_id, razorpay_order_id,
          idempotencyKey || null,
        ]
      );
      tradeId = tr[0].id;

      if (COMPANY_USER_ID) {
        await client.query(
          `UPDATE users SET inr_balance = inr_balance + $1, updated_at = NOW() WHERE id = $2`,
          [fees.totalFeeINR, COMPANY_USER_ID]
        );
        await client.query(
          `INSERT INTO wallet_transactions (user_id, type, method, amount, status, notes, trade_id, trade_type)
           VALUES ($1,'credit','inr',$2,'success',$3,$4,'platform_fee')`,
          [COMPANY_USER_ID, fees.totalFeeINR, `Razorpay checkout fee: trade ${tradeId}`, tradeId]
        );
      }

      const cgstInr2 = fees.gstINR / 2;
      const sgstInr2 = fees.gstINR / 2;

      await client.query(
        `INSERT INTO platform_fees
           (trade_id, buyer_fee_inr, seller_fee_inr, total_fee_inr, gst_inr,
            platform_net_inr, fee_eth, eth_rate, payment_mode, status, razorpay_payment_id,
            gst_type, cgst_inr, sgst_inr, igst_inr)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'direct_razorpay','collected',$9,'cgst_sgst',$10,$11,0)
         ON CONFLICT DO NOTHING`,
        [tradeId, fees.buyerFeeINR, fees.sellerFeeINR, fees.totalFeeINR, fees.gstINR,
         fees.platformNetINR, fees.totalFeeINR / ethRate, ethRate, razorpay_payment_id,
         cgstInr2, sgstInr2]
      ).catch(() => {});

      await client.query(
        `UPDATE carbon_batches
         SET available_credits = GREATEST(0, available_credits - $1),
             listed_quantity   = GREATEST(0, listed_quantity - $1),
             last_traded_price_inr = $2, updated_at = NOW()
         WHERE id = $3`,
        [qty, pricePerCredit, order.batch_id]
      );

      await client.query(
        `UPDATE razorpay_checkout_orders
         SET status = 'completed', trade_id = $1, razorpay_payment_id = $2, completed_at = NOW()
         WHERE razorpay_order_id = $3`,
        [tradeId, razorpay_payment_id, razorpay_order_id]
      );

      await client.query(
        `INSERT INTO registry_transactions
           (type, token_id, batch_id, trade_id, from_user_id, to_user_id,
            amount, price_inr, fee_inr, total_price_inr, payment_mode, project_name, standard)
         VALUES ('TRADE',$1,$2,$3,$4,$5,$6,$7,$8,$9,'direct_razorpay',$10,$11)`,
        [batch.token_id, order.batch_id, tradeId, sellerId, req.user.id,
         qty, pricePerCredit, fees.totalFeeINR, subtotal, batch.project_name, batch.standard]
      );
    });

    let chainTxHash = null, chainBlockNumber = null, custodyModel = 'wallet';
    try {
      if (req.user.wallet_address) {
        const { settleINRTradeOnChain } = require('../services/minter');
        const result = await settleINRTradeOnChain({
          listingIdOnchain : order.listing_id,
          buyerWallet      : req.user.wallet_address,
          amount           : qty,
          priceINRPaise    : Math.round(pricePerCredit * 100),
          dbTradeId        : tradeId,
          payMode          : 'razorpay',
          timestamp        : Math.floor(Date.now() / 1000),
        });

        await query(
          `UPDATE trades SET chain_status = 'confirmed', chain_tx_hash = $1, chain_block = $2 WHERE id = $3`,
          [result.txHash, result.blockNumber, tradeId]
        );
        chainTxHash = result.txHash; chainBlockNumber = result.blockNumber; custodyModel = 'wallet';
        req.log.info(`[checkout-verify] Trade ${tradeId} settled on-chain (wallet) -- TX: ${result.txHash}`);
      } else {
        const { logOwnershipChangeOnChain } = require('../services/creditLedger');
        const result = await logOwnershipChangeOnChain({
          userId      : req.user.id,
          tokenId     : batch.token_id,
          amountDelta : qty,
          actionType  : 'BUY',
          refTable    : 'trades',
          refId       : tradeId,
          note        : `Purchase -- ${batch.project_name}`,
        });

        await query(
          `UPDATE trades SET chain_status = 'confirmed', chain_tx_hash = $1, chain_block = $2 WHERE id = $3`,
          [result.txHash, result.blockNumber, tradeId]
        );
        chainTxHash = result.txHash; chainBlockNumber = result.blockNumber; custodyModel = 'pooled';
req.log.info(`[checkout-verify] Trade ${tradeId} logged on-chain (ledger, no wallet) -- TX: ${result.txHash}`);
      }
    } catch (chainErr) {
      await query(
        `UPDATE trades SET chain_status = 'failed' WHERE id = $1`,
        [tradeId]
      ).catch(() => {});
      await query(
        `INSERT INTO admin_audit_log (admin_id, action, target_user_id, details)
         VALUES ($1,$2,$3,$4)`,
        [req.user.id, 'INR_TRADE_ONCHAIN_SETTLEMENT_FAILED', req.user.id,
         `Trade ${tradeId} -- payment captured but on-chain settlement failed: ${chainErr.message}`]
      ).catch(() => {});
      req.log.error(`[checkout-verify] [WARNING] On-chain settlement FAILED for trade ${tradeId} -- payment already captured. Needs manual remediation:`, chainErr.message);
    }

    // [CERT-OWNERSHIP] Issue Certificate of Ownership regardless of which
    // branch above ran -- covers both real wallet transfer and ledger log.
    let ownershipCertId = null;
    try {
      ownershipCertId = await issueOwnershipCertificate({
        userId: req.user.id,
        tokenId: batch.token_id,
        quantity: qty,
        tradeId,
        txHash: chainTxHash,
        blockNumber: chainBlockNumber,
        custodyModel,
      });
    } catch (certErr) {
      req.log.error('[checkout-verify] certificate issuance failed (trade unaffected):', certErr.message);
    }

    fireTradeInvoice({
      tradeId,
      buyerId:     req.user.id,
      projectName: batch.project_name,
      standard:       batch.standard,
      registrySerial: batch.registry_serial,
      qty,
      subtotalINR: subtotal,
      fees,
      paymentMode: 'direct_razorpay',
    });

    await Promise.all([
      createNotification(req.user.id, 'TRADE', 'Purchase Complete',
        `${qty} x ${batch.project_name} -- Rs.${fees.buyerPaysINR.toLocaleString('en-IN')} via Razorpay`,
        '/portfolio', { tradeId, quantity: qty }).catch(() => {}),
      createNotification(sellerId, 'TRADE', 'Credits Sold via Razorpay',
        `${qty} x ${batch.project_name} -- Rs.${fees.sellerGetsINR.toLocaleString('en-IN')} to your bank`,
        '/wallet', { tradeId, quantity: qty }).catch(() => {}),
    ]);

    if (batch.seller_email) {
      sendCreditsSoldEmail(batch.seller_email, {
        name: batch.seller_name, projectName: batch.project_name, quantity: qty,
        amountINR: fees.sellerGetsINR.toLocaleString('en-IN'), pending: false,
        walletUrl: `${process.env.FRONTEND_URL}/wallet`,
      }).catch(e => req.log.warn('[trades/checkout-verify] seller email failed:', e.message));
    }

    // Invalidate portfolio cache for both buyer and seller
    const cacheStrategy = require('../services/cacheStrategy');
    cacheStrategy.invalidate(cacheStrategy.KEYS.portfolioCredits(req.user.id));
    cacheStrategy.invalidate(cacheStrategy.KEYS.portfolioBought(req.user.id));
    cacheStrategy.invalidate(cacheStrategy.KEYS.portfolioCredits(sellerId));
    cacheStrategy.invalidate(cacheStrategy.KEYS.portfolioBought(sellerId));

    return res.json({
      success: true, tradeId, quantity: qty,
      pricePerCredit, subtotalINR: subtotal,
      ...fees, ethRate,
      razorpayPaymentId: razorpay_payment_id,
      chainLogging:      'queued',
      invoiceQueued:     true,
      ownershipCertId,
      message: `Trade completed -- ${qty} credits purchased via Razorpay`,
});
});

router.post('/wallet-checkout', authenticate, requireKYC, tradeLimiter, async (req, res) => {
  const { listingId, quantity, pricePerCreditINR, idempotencyKey } = req.body;

  if (!listingId || !quantity || !pricePerCreditINR)
    return res.status(400).json({ error: 'listingId, quantity, pricePerCreditINR required' });

  const qty = parseInt(quantity);
  const pricePerCredit = parseFloat(pricePerCreditINR);
  if (!qty || qty <= 0) return res.status(400).json({ error: 'Invalid quantity' });
  if (!pricePerCredit || pricePerCredit <= 0) return res.status(400).json({ error: 'Invalid pricePerCreditINR' });

  // Generate idempotency key if not provided
  const idemKey = idempotencyKey || `wallet:${req.user.id}:${listingId}:${qty}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

  // Check for existing trade with same idempotency key
  const existing = await checkIdempotency(req.user.id, idemKey);
  if (existing) {
    return res.json({ success: true, tradeId: existing.id, idempotent: true });
  }

  try {
    // Generate quote
    const quote = await settlementEngine.generateQuote(listingId, qty, req.user.id, 'inr_wallet');
    
    // Create trade from quote
    const trade = await tradeService.createTrade(quote, req.user.id, { paymentMode: 'inr_wallet', idempotencyKey: idemKey });
    
    // Execute full settlement synchronously for INR wallet
    await settlementEngine.transitionToFundsReserved(trade.tradeId);
    await settlementEngine.transitionToCreditsReserved(trade.tradeId);
    await settlementEngine.transitionToSettlementPending(trade.tradeId);
    
    // For INR wallet, payment is already reserved in transitionToFundsReserved
    await settlementEngine.transitionToPaymentSettled(trade.tradeId, { 
      providerReference: `wallet_${trade.paymentId}`, 
      capturedAt: new Date() 
    });
    
    await settlementEngine.transitionToFeesCollected(trade.tradeId);
    await settlementEngine.transitionToSellerPaid(trade.tradeId);
    await settlementEngine.transitionToBuyerCredited(trade.tradeId);
    await settlementEngine.transitionToSettled(trade.tradeId);

    // Fetch updated trade
    const updatedTrade = await tradeService.getTrade(trade.tradeId);
    
    // Update user's INR balance
    const { rows: buyerRows } = await query('SELECT inr_balance FROM users WHERE id = $1', [req.user.id]);
    
    return res.json({
      success: true,
      tradeId: trade.tradeId,
      quantity: qty,
      pricePerCredit,
      ...updatedTrade,
      buyerBalance: buyerRows[0]?.inr_balance?.toString(),
      message: `Trade completed -- ${qty} credits purchased from INR wallet`,
    });
  } catch (e) {
    req.log.error('[trades/wallet-checkout]', e.message);
    return res.status(e.statusCode || 500).json({ error: e.message || 'Trade settlement failed' });
  }
});

router.post('/record-eth', authenticate, requireKYC, tradeLimiter, async (req, res) => {
  const { batchId, listingId, quantity, txHash, pricePerCreditINR, idempotencyKey } = req.body;

  if (!batchId || !quantity || !txHash || !pricePerCreditINR)
    return res.status(400).json({ error: 'batchId, quantity, txHash, pricePerCreditINR required' });

  const qty = parseInt(quantity);
  const pricePerCredit = parseFloat(pricePerCreditINR);
  if (!qty || qty <= 0) return res.status(400).json({ error: 'Invalid quantity' });
  if (!pricePerCredit || pricePerCredit <= 0) return res.status(400).json({ error: 'Invalid pricePerCreditINR' });

  const idemKey = idempotencyKey || `eth:${req.user.id}:${batchId}:${qty}:${txHash}`;

  // Check for existing trade with same idempotency key
  const existing = await checkIdempotency(req.user.id, idemKey);
  if (existing) {
    return res.json({ success: true, tradeId: existing.id, idempotent: true });
  }

  // Verify the on-chain transaction first
  const verification = await chainLogger.verifyTradeOnChain({
    dbTradeId: null,
    tokenId: 0, // Will be fetched from batch
    quantity: qty,
    pricePerCreditINR: pricePerCredit,
    paymentMode: 'eth',
    buyerWallet: req.user.wallet_address,
    sellerWallet: null, // Will be fetched from batch
    settledAt: new Date(),
  });

  if (!verification.valid) {
    return res.status(400).json({ error: `On-chain verification failed: ${verification.error}` });
  }

  try {
    const { rows: batches } = await query(
      `SELECT cb.*, u.id AS seller_id, u.wallet_address AS seller_wallet
       FROM carbon_batches cb JOIN users u ON u.id = cb.user_id
       WHERE cb.id = $1`, [batchId]
    );
    if (!batches.length) return res.status(404).json({ error: 'Batch not found' });
    const batch = batches[0];

    if (batch.seller_id === req.user.id)
      return res.status(400).json({ error: 'Cannot buy your own listing' });
    if (batch.available_credits < qty)
      return res.status(400).json({ error: `Only ${batch.available_credits} credits available` });

    const ethRate = await getLiveETHRate();
    const subtotalINR = parseFloat((pricePerCredit * qty).toFixed(2));
    const fees = calcFees(subtotalINR);

    // Generate quote and create trade via SettlementEngine
    const quote = await settlementEngine.generateQuote(listingId, qty, req.user.id, 'eth');
    const trade = await tradeService.createTrade(quote, req.user.id, { 
      paymentMode: 'eth', 
      ethTxHash: txHash, 
      idempotencyKey: idemKey 
    });

    // Execute settlement (chain already confirmed)
    await settlementEngine.transitionToFundsReserved(trade.tradeId);
    await settlementEngine.transitionToCreditsReserved(trade.tradeId);
    await settlementEngine.transitionToSettlementPending(trade.tradeId);
    await settlementEngine.transitionToCreditTransferSubmitted(trade.tradeId, []);
    await settlementEngine.transitionToCreditTransferConfirmed(trade.tradeId);
    await settlementEngine.transitionToPaymentSettled(trade.tradeId, { 
      providerReference: txHash, 
      capturedAt: new Date() 
    });
    await settlementEngine.transitionToFeesCollected(trade.tradeId);
    await settlementEngine.transitionToSellerPaid(trade.tradeId);
    await settlementEngine.transitionToBuyerCredited(trade.tradeId);
    await settlementEngine.transitionToSettled(trade.tradeId);

    // Update chain status
    await query(
      `UPDATE trades SET chain_status = 'confirmed', chain_tx_hash = $1, chain_block = $2 WHERE id = $3`,
      [verification.loggedAtBlock || 0, verification.loggedAtBlock || 0, trade.tradeId]
    );

    const { rows: buyerRows } = await query('SELECT inr_balance FROM users WHERE id = $1', [req.user.id]);

    return res.json({
      success: true,
      tradeId: trade.tradeId,
      quantity: qty,
      pricePerCredit,
      subtotalINR,
      ...fees,
      ethRate,
      txHash,
      chainLogging: 'verified',
      message: `Trade completed -- ${qty} credits purchased via ETH`,
    });
  } catch (e) {
    req.log.error('[trades/record-eth]', e.message);
    return res.status(e.statusCode || 500).json({ error: e.message || 'Trade settlement failed' });
  }
});

router.get('/:id/verify', readLimiter, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT t.*, cb.token_id FROM trades t
       LEFT JOIN carbon_batches cb ON cb.id = t.batch_id
       WHERE t.id = $1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Trade not found' });
    const t = rows[0];

    const result = await chainLogger.verifyTradeOnChain({
      dbTradeId:         t.id,
      tokenId:           t.token_id,
      quantity:          t.quantity,
      pricePerCreditINR: t.price_per_credit_inr,
      paymentMode:       t.payment_mode,
      buyerWallet:       t.buyer_wallet,
      sellerWallet:      t.seller_wallet,
      settledAt:         t.inr_settlement_at || t.created_at,
    });

    return res.json({
      tradeId:     t.id,
      paymentMode: t.payment_mode,
      quantity:    t.quantity,
      priceINR:    t.price_per_credit_inr,
      status:      t.status,
      chainStatus: t.chain_status,
      chainTxHash: t.chain_tx_hash,
      chainBlock:  t.chain_block,
      onChainVerification: result,
      verifiedAt:  new Date().toISOString(),
    });
  } catch (e) {
    req.log.error('[trades/verify]', e.message);
    return res.status(500).json({ error: 'Verification failed', detail: e.message });
  }
});

router.get('/:id/invoice', authenticate, readLimiter, async (req, res) => {
  await serveTradeInvoice(req, res);
});

router.get('/history', authenticate, readLimiter, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT t.*,
              CASE WHEN t.buyer_id = $1 THEN 'Buy' ELSE 'Sell' END AS type,
              cb.project_name, cb.standard, cb.registry_serial AS serial_number,
              cb.project_type, cb.project_location AS location,
              t.chain_tx_hash, t.chain_status, t.chain_block,
              t.trade_invoice_number IS NOT NULL AS has_invoice,
              t.trade_invoice_generated_at
       FROM trades t
       LEFT JOIN carbon_batches cb ON cb.id = t.batch_id
       WHERE t.buyer_id = $1 OR t.seller_id = $1
       ORDER BY t.created_at DESC LIMIT 100`,
      [req.user.id]
    );
    res.json({ trades: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch trade history' });
  }
});

router.get('/stats', readLimiter, async (req, res) => {
  try {
    const [volume, count, avgPrice, fees, chainStats] = await Promise.all([
      query(`SELECT COALESCE(SUM(subtotal_inr),0) AS total FROM trades WHERE status='completed'`),
      query(`SELECT COUNT(*) FROM trades WHERE status='completed'`),
      query(`SELECT COALESCE(AVG(price_per_credit_inr),0) AS avg FROM trades WHERE status='completed' AND created_at > NOW()-INTERVAL '30 days'`),
      query(`SELECT COALESCE(SUM(total_fee_inr),0) AS total, COALESCE(SUM(gst_inr),0) AS gst FROM trades WHERE status='completed'`),
      query(`SELECT COUNT(*) AS on_chain FROM trades WHERE chain_status='confirmed'`),
    ]);
    const ethRate = await getLiveETHRate();
    res.json({
      totalVolumeINR:    parseFloat(volume.rows[0].total),
      totalTrades:       parseInt(count.rows[0].count),
      avgPriceINR:       parseFloat(avgPrice.rows[0].avg),
      totalPlatformFees: parseFloat(fees.rows[0].total),
      totalGSTCollected: parseFloat(fees.rows[0].gst),
      tradesOnChain:     parseInt(chainStats.rows[0].on_chain),
      ethRate,
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

router.get('/my-fees', authenticate, readLimiter, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         SUM(CASE WHEN buyer_id=$1 THEN buyer_fee_inr ELSE 0 END)  AS total_paid_as_buyer,
         SUM(CASE WHEN seller_id=$1 THEN seller_fee_inr ELSE 0 END) AS total_paid_as_seller,
         COUNT(*) AS total_trades
       FROM trades WHERE (buyer_id=$1 OR seller_id=$1) AND status='completed'`,
      [req.user.id]
    );
    res.json({
      feesPaidAsBuyer:  parseFloat(rows[0].total_paid_as_buyer  || 0),
      feesPaidAsSeller: parseFloat(rows[0].total_paid_as_seller || 0),
      totalTrades:      parseInt(rows[0].total_trades || 0),
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch fees' });
  }
});

const creditSellerFromChain = async ({ txHash, sellerId, sellerGetsINR, tradeId }) => {
  try {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE trades SET seller_inr_credited=true, inr_settlement_at=NOW(),
                           chain_status='confirmed'
         WHERE id=$1 AND seller_inr_credited=false`, [tradeId]
      );
      await client.query(
        `UPDATE users SET inr_balance=inr_balance+$1, updated_at=NOW() WHERE id=$2`,
        [sellerGetsINR, sellerId]
      );
      await client.query(
        `INSERT INTO wallet_transactions (user_id,type,method,amount,status,notes,trade_id,trade_type)
         VALUES ($1,'credit','eth',$2,'success',$3,$4,'sell_credit')`,
        [sellerId, sellerGetsINR, `ETH sale confirmed | txHash: ${txHash}`, tradeId]
      );
      await client.query(
        `UPDATE pending_seller_credits SET status='settled', settled_at=NOW() WHERE trade_id=$1`,
        [tradeId]
      ).catch(() => {});
    });
    req.log.info(`[trades] Seller ${sellerId} credited Rs.${sellerGetsINR} for ETH trade ${tradeId}`);
  } catch (e) {
    req.log.error('[creditSellerFromChain]', e.message, { txHash, tradeId });
  }
};

router.post('/deduct', authenticate, requireKYC, (req, res) => {
  res.status(410).json({
    error: 'Deprecated. INR deduction is atomic inside /api/trades/record.',
    deprecated: true,
  });
});

module.exports = router;
module.exports.getLiveETHRate        = getLiveETHRate;
module.exports.creditSellerFromChain = creditSellerFromChain;