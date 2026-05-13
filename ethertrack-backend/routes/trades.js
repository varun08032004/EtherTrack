// routes/trades.js — EtherTrack Production Settlement Engine
// FIXES APPLIED:
//   1. Idempotency key on /record — prevents double-settlement on retry
//   2. INR path now atomic: deduct + settle in ONE transaction (no two-call window)
//   3. ETH trade DB miss logged to error table instead of silently swallowed
//   4. Duplicate tx_hash check on record — prevents double-record on ETH trades
const router  = require('express').Router();
const { safeQuery: query, withTransaction } = require('../db/pool');
const { authenticate, requireKYC } = require('../middleware/auth');
const { createNotification } = require('./notifications');

// ── Live ETH/INR rate cache ───────────────────────────────────────
let _cachedRate    = 280000;
let _lastFetchedAt = 0;
const RATE_TTL_MS  = 5 * 60 * 1000;

const getLiveETHRate = async () => {
  const now = Date.now();
  if (now - _lastFetchedAt < RATE_TTL_MS) return _cachedRate;
  try {
    const res  = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=inr');
    const data = await res.json();
    if (data?.ethereum?.inr) {
      _cachedRate    = data.ethereum.inr;
      _lastFetchedAt = now;
      await query(
        `INSERT INTO eth_inr_rates (rate, source) VALUES ($1, 'coingecko')`,
        [_cachedRate]
      ).catch(() => {});
      console.log(`💱 ETH rate updated: ₹${_cachedRate}`);
    }
  } catch (e) {
    console.warn('ETH rate fetch failed, using cached:', _cachedRate);
  }
  return _cachedRate;
};

// ── GET /api/trades/eth-rate ──────────────────────────────────────
router.get('/eth-rate', async (req, res) => {
  try {
    const rate = await getLiveETHRate();
    res.json({ rate, source: 'coingecko', cachedAt: new Date(_lastFetchedAt).toISOString() });
  } catch (e) {
    res.json({ rate: _cachedRate, source: 'cache' });
  }
});

// ── GET /api/trades/price-suggestion ─────────────────────────────
router.get('/price-suggestion', async (req, res) => {
  const { standard, projectType, vintageYear } = req.query;
  if (!standard || !projectType || !vintageYear)
    return res.status(400).json({ error: 'standard, projectType, vintageYear required' });
  try {
    const { rows } = await query(
      `SELECT * FROM get_suggested_price($1, $2, $3)`,
      [standard, projectType, parseInt(vintageYear)]
    );
    const ethRate   = await getLiveETHRate();
    const s         = rows[0] || { suggested_price: 850, min_price: 650, max_price: 1200, source: 'fallback' };
    const { rows: comparables } = await query(
      `SELECT cb.project_name, cb.price_per_credit_inr, cb.vintage_year,
              cb.available_credits, cb.standard
       FROM carbon_batches cb
       WHERE cb.standard = $1 AND cb.project_type = $2
         AND cb.admin_status = 'approved' AND cb.available_credits > 0
         AND cb.price_per_credit_inr IS NOT NULL
       ORDER BY cb.updated_at DESC LIMIT 5`,
      [standard, projectType]
    );
    res.json({
      suggestedPrice:     parseFloat(s.suggested_price),
      minPrice:           parseFloat(s.min_price),
      maxPrice:           parseFloat(s.max_price),
      source:             s.source,
      ethRate,
      suggestedPriceEth:  parseFloat(s.suggested_price) / ethRate,
      comparableListings: comparables,
    });
  } catch (e) {
    console.error('Price suggestion error:', e);
    res.status(500).json({ error: 'Failed to get price suggestion' });
  }
});

// ── GET /api/trades/history ───────────────────────────────────────
router.get('/history', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM user_trade_history
       WHERE buyer_id = $1 OR seller_id = $1
       ORDER BY created_at DESC LIMIT 100`,
      [req.user.id]
    );
    res.json({ trades: rows });
  } catch (e) {
    console.error('Trade history error:', e);
    res.status(500).json({ error: 'Failed to fetch trade history' });
  }
});

// ── POST /api/trades/record ───────────────────────────────────────
// ✅ FIX 1: Idempotency key — if the same (buyer, batchId, qty, txHash/idempotency)
//    comes in twice (network retry), return the existing trade instead of double-settling.
// ✅ FIX 2: INR path is now FULLY ATOMIC inside withTransaction — no two-call window.
//    Frontend no longer calls /deduct separately for INR trades.
// ✅ FIX 3: ETH tx_hash uniqueness check — prevents double-record on ETH retries.
router.post('/record', authenticate, requireKYC, async (req, res) => {
  const {
    listingId,
    batchId,
    quantity,
    paymentMode,
    txHash,
    pricePerCreditINR,
    idempotencyKey,    // ✅ NEW — frontend sends uuid per trade attempt
  } = req.body;

  if (!batchId || !quantity || !paymentMode || !pricePerCreditINR)
    return res.status(400).json({ error: 'batchId, quantity, paymentMode, pricePerCreditINR required' });

  if (!['inr', 'eth'].includes(paymentMode))
    return res.status(400).json({ error: 'paymentMode must be "inr" or "eth"' });

  const qty = parseInt(quantity);
  if (!qty || qty <= 0)
    return res.status(400).json({ error: 'Invalid quantity' });

  const pricePerCredit = parseFloat(pricePerCreditINR);
  if (!pricePerCredit || pricePerCredit <= 0)
    return res.status(400).json({ error: 'Invalid pricePerCreditINR' });

  // ── ✅ FIX 1: Idempotency check ───────────────────────────────
  // If we've already processed this exact trade, return the cached result.
  if (idempotencyKey) {
    try {
      const { rows: existing } = await query(
        `SELECT id, buyer_pays_inr, seller_receives_inr, quantity
         FROM trades
         WHERE buyer_id = $1 AND idempotency_key = $2 AND status = 'completed'
         LIMIT 1`,
        [req.user.id, idempotencyKey]
      );
      if (existing.length) {
        console.log(`⚡ Idempotent trade return for key ${idempotencyKey}`);
        const { rows: buyerRow } = await query('SELECT inr_balance FROM users WHERE id = $1', [req.user.id]);
        return res.json({
          success:      true,
          tradeId:      existing[0].id,
          idempotent:   true,
          buyerBalance: parseFloat(buyerRow[0]?.inr_balance || 0),
          message:      'Trade already completed (idempotent return)',
        });
      }
    } catch (e) {
      // idempotency_key column may not exist yet — non-fatal, continue
    }
  }

  // ── ✅ FIX 3: ETH tx_hash dedup ───────────────────────────────
  // Prevent double-recording the same on-chain transaction.
  if (paymentMode === 'eth' && txHash) {
    try {
      const { rows: dupTx } = await query(
        `SELECT id FROM trades WHERE tx_hash = $1 LIMIT 1`,
        [txHash]
      );
      if (dupTx.length) {
        console.log(`⚡ Duplicate ETH tx_hash ${txHash} — skipping double-record`);
        return res.json({ success: true, tradeId: dupTx[0].id, idempotent: true, message: 'ETH trade already recorded' });
      }
    } catch (e) { /* non-fatal */ }
  }

  try {
    const ethRate = await getLiveETHRate();

    // ── Fetch batch + seller ──────────────────────────────────────
    const { rows: batches } = await query(
      `SELECT cb.*, u.id AS seller_id, u.wallet_address AS seller_wallet,
              u.email AS seller_email, u.full_name AS seller_name,
              u.inr_balance AS seller_inr_balance
       FROM carbon_batches cb
       JOIN users u ON u.id = cb.user_id
       WHERE cb.id = $1`,
      [batchId]
    );
    if (!batches.length) return res.status(404).json({ error: 'Batch not found' });
    const batch    = batches[0];
    const sellerId = batch.seller_id;

    if (sellerId === req.user.id)
      return res.status(400).json({ error: 'Cannot buy your own listing' });

    if (batch.available_credits < qty)
      return res.status(400).json({ error: `Only ${batch.available_credits} credits available` });

    // ── Fee calculation ───────────────────────────────────────────
    const subtotalINR   = parseFloat((pricePerCredit * qty).toFixed(2));
    const buyerFeeINR   = parseFloat((subtotalINR * 0.005).toFixed(2));
    const sellerFeeINR  = parseFloat((subtotalINR * 0.005).toFixed(2));
    const totalFeeINR   = parseFloat((buyerFeeINR + sellerFeeINR).toFixed(2));
    const buyerPaysINR  = parseFloat((subtotalINR + buyerFeeINR).toFixed(2));
    const sellerGetsINR = parseFloat((subtotalINR - sellerFeeINR).toFixed(2));
    const totalETH      = subtotalINR / ethRate;
    const feeETH        = totalFeeINR / ethRate;

    let tradeId;

    await withTransaction(async (client) => {

      // ── ✅ FIX 2: INR balance check INSIDE transaction ────────
      // For INR trades: check + deduct happen atomically — no two-call window.
      if (paymentMode === 'inr') {
        const { rows: buyerRows } = await client.query(
          'SELECT inr_balance FROM users WHERE id = $1 FOR UPDATE',  // row lock
          [req.user.id]
        );
        const buyerBalance = parseFloat(buyerRows[0]?.inr_balance || 0);
        if (buyerBalance < buyerPaysINR) {
          throw Object.assign(new Error('Insufficient INR balance'), {
            statusCode: 400,
            required:   buyerPaysINR,
            available:  buyerBalance,
          });
        }

        // Deduct buyer INR atomically inside the same transaction
        await client.query(
          `UPDATE users SET inr_balance = inr_balance - $1, updated_at = NOW() WHERE id = $2`,
          [buyerPaysINR, req.user.id]
        );
        await client.query(
          `INSERT INTO wallet_transactions
           (user_id, type, method, amount, status, notes, trade_type)
           VALUES ($1, 'debit', 'inr', $2, 'success', $3, 'buy_credit')`,
          [
            req.user.id, buyerPaysINR,
            `Purchase of ${qty} × ${batch.project_name} @ ₹${pricePerCredit}/credit (incl. 0.5% fee)`,
          ]
        );
      }

      // ── 1. Insert trade record ──────────────────────────────────
      const { rows: tradeRows } = await client.query(
        `INSERT INTO trades (
          buyer_id, seller_id, buyer_wallet, seller_wallet,
          batch_id, token_id, listing_id_onchain, quantity,
          price_per_credit_inr, subtotal_inr,
          buyer_fee_inr, seller_fee_inr, total_fee_inr,
          buyer_pays_inr, seller_receives_inr,
          price_per_credit_eth, total_eth, eth_inr_rate, fee_eth,
          payment_mode, status,
          tx_hash, buyer_inr_deducted, seller_inr_credited,
          inr_settlement_at, completed_at, idempotency_key
        ) VALUES (
          $1,$2,$3,$4,
          $5,$6,$7,$8,
          $9,$10,
          $11,$12,$13,
          $14,$15,
          $16,$17,$18,$19,
          $20,$21,
          $22,$23,$24,
          $25,$26,$27
        ) RETURNING id`,
        [
          req.user.id, sellerId,
          req.user.wallet_address || null, batch.seller_wallet,
          batchId, batch.token_id, listingId || null, qty,
          pricePerCredit, subtotalINR,
          buyerFeeINR, sellerFeeINR, totalFeeINR,
          buyerPaysINR, sellerGetsINR,
          pricePerCredit / ethRate, totalETH, ethRate, feeETH,
          paymentMode, 'completed',
          txHash || null,
          paymentMode === 'inr',
          paymentMode === 'inr',
          paymentMode === 'inr' ? new Date() : null,
          new Date(),
          idempotencyKey || null,
        ]
      );
      tradeId = tradeRows[0].id;

      // ── 2. Credit seller INR (both payment modes) ────────────────
      await client.query(
        `UPDATE users SET inr_balance = inr_balance + $1, updated_at = NOW() WHERE id = $2`,
        [sellerGetsINR, sellerId]
      );
      await client.query(
        `INSERT INTO wallet_transactions
         (user_id, type, method, amount, status, notes, trade_id, trade_type)
         VALUES ($1, 'credit', $2, $3, 'success', $4, $5, 'sell_credit')`,
        [
          sellerId,
          paymentMode === 'inr' ? 'inr' : 'eth',
          sellerGetsINR,
          `Sale of ${qty} × ${batch.project_name} @ ₹${pricePerCredit}/credit (after 0.5% fee)`,
          tradeId,
        ]
      );

      // ── 3. Platform fee ────────────────────────────────────────
      await client.query(
        `INSERT INTO platform_fees
         (trade_id, buyer_fee_inr, seller_fee_inr, total_fee_inr,
          fee_eth, eth_rate, payment_mode, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'collected')
         ON CONFLICT DO NOTHING`,
        [tradeId, buyerFeeINR, sellerFeeINR, totalFeeINR, feeETH, ethRate, paymentMode]
      ).catch(async () => {
        await client.query(
          `INSERT INTO wallet_transactions
           (user_id, type, method, amount, status, notes, trade_id, trade_type)
           VALUES (NULL, 'credit', 'system', $1, 'collected', $2, $3, 'platform_fee')`,
          [totalFeeINR, `Platform fee — trade ${tradeId}`, tradeId]
        ).catch(() => {});
      });

      // ── 4. Update batch available_credits ──────────────────────
      await client.query(
        `UPDATE carbon_batches
         SET available_credits     = GREATEST(0, available_credits - $1),
             last_traded_price_inr = $2,
             updated_at            = NOW()
         WHERE id = $3`,
        [qty, pricePerCredit, batchId]
      );

      // ── 5. Registry transaction record ─────────────────────────
      await client.query(
        `INSERT INTO registry_transactions
         (type, token_id, batch_id, listing_id, trade_id,
          from_wallet, to_wallet, from_user_id, to_user_id,
          amount, price_eth, price_inr, fee_eth, fee_inr,
          buyer_fee_inr, seller_fee_inr,
          total_price_inr, payment_mode, tx_hash, project_name, standard)
         VALUES
         ('TRADE', $1, $2, $3, $4,
          $5, $6, $7, $8,
          $9, $10, $11, $12, $13,
          $14, $15,
          $16, $17, $18, $19, $20)`,
        [
          batch.token_id, batchId, listingId || null, tradeId,
          batch.seller_wallet, req.user.wallet_address || null,
          sellerId, req.user.id,
          qty, pricePerCredit / ethRate, pricePerCredit,
          feeETH, totalFeeINR,
          buyerFeeINR, sellerFeeINR,
          subtotalINR, paymentMode, txHash || null,
          batch.project_name, batch.standard,
        ]
      );
    });

    // ── Notifications ─────────────────────────────────────────────
    await Promise.all([
      createNotification(
        req.user.id, 'TRADE', '✅ Purchase Complete',
        `${qty} × ${batch.project_name} — ₹${buyerPaysINR.toLocaleString('en-IN')} paid`,
        '/portfolio',
        { tradeId, quantity: qty, projectName: batch.project_name }
      ).catch(() => {}),
      createNotification(
        sellerId, 'TRADE', '💰 Credits Sold',
        `${qty} × ${batch.project_name} — ₹${sellerGetsINR.toLocaleString('en-IN')} credited`,
        '/wallet',
        { tradeId, quantity: qty, projectName: batch.project_name }
      ).catch(() => {}),
    ]);

    const { rows: updatedBuyer }  = await query('SELECT inr_balance FROM users WHERE id = $1', [req.user.id]);
    const { rows: updatedSeller } = await query('SELECT inr_balance FROM users WHERE id = $1', [sellerId]);

    res.json({
      success:          true,
      tradeId,
      quantity:         qty,
      pricePerCredit,
      subtotalINR,
      buyerFeeINR,
      sellerFeeINR,
      totalFeeINR,
      buyerPaysINR,
      sellerGetsINR,
      ethRate,
      txHash,
      buyerBalance:     parseFloat(updatedBuyer[0]?.inr_balance  || 0),
      sellerBalance:    parseFloat(updatedSeller[0]?.inr_balance || 0),
      message:          `Trade completed — ${qty} credits purchased`,
    });

  } catch (e) {
    console.error('Trade record error:', e);

    // ── ✅ FIX 4: ETH trade DB miss is no longer silent ──────────
    // Log failed DB record to a separate table so blockchain listener can retry.
    if (e.statusCode !== 400 && txHash) {
      query(
        `INSERT INTO failed_trade_records (tx_hash, buyer_id, batch_id, quantity, error, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (tx_hash) DO NOTHING`,
        [txHash, req.user.id, batchId, qty, e.message]
      ).catch(() => {});
    }

    const statusCode = e.statusCode || 500;
    res.status(statusCode).json({
      error:     e.message || 'Trade settlement failed',
      required:  e.required,
      available: e.available,
    });
  }
});

// ── POST /api/trades/deduct ───────────────────────────────────────
// ✅ DEPRECATED for INR trades — deduction now happens atomically inside /record.
// Kept for backwards compatibility but returns a deprecation warning.
// Frontend should call /record directly with paymentMode='inr'.
router.post('/deduct', authenticate, requireKYC, async (req, res) => {
  console.warn('⚠️  /api/trades/deduct is deprecated. Use /api/trades/record with paymentMode=inr instead.');
  res.status(410).json({
    error:      'This endpoint is deprecated.',
    message:    'INR deduction now happens atomically inside /api/trades/record. Call /record directly.',
    deprecated: true,
  });
});

// ── POST /api/trades/refund ───────────────────────────────────────
router.post('/refund', authenticate, async (req, res) => {
  const { tradeId, amount, reason } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  try {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE users SET inr_balance = inr_balance + $1, updated_at = NOW() WHERE id = $2`,
        [amount, req.user.id]
      );
      await client.query(
        `INSERT INTO wallet_transactions
         (user_id, type, method, amount, status, notes, trade_id, trade_type)
         VALUES ($1, 'credit', 'system', $2, 'success', $3, $4, 'refund')`,
        [req.user.id, amount, reason || `Trade refund — ${tradeId || 'failed tx'}`, tradeId || null]
      );
      if (tradeId) {
        await client.query(
          `UPDATE trades SET status = 'refunded', updated_at = NOW() WHERE id = $1`,
          [tradeId]
        );
      }
    });

    const { rows } = await query('SELECT inr_balance FROM users WHERE id = $1', [req.user.id]);
    res.json({ success: true, balance: parseFloat(rows[0].inr_balance), refunded: amount });
  } catch (e) {
    console.error('Refund error:', e);
    res.status(500).json({ error: 'Refund failed' });
  }
});

// ── GET /api/trades/stats ─────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [volume, count, avgPrice, fees] = await Promise.all([
      query(`SELECT COALESCE(SUM(subtotal_inr), 0) AS total FROM trades WHERE status = 'completed'`),
      query(`SELECT COUNT(*) FROM trades WHERE status = 'completed'`),
      query(`SELECT COALESCE(AVG(price_per_credit_inr), 0) AS avg FROM trades WHERE status = 'completed' AND created_at > NOW() - INTERVAL '30 days'`),
      query(`SELECT COALESCE(SUM(total_fee_inr), 0) AS total FROM trades WHERE status = 'completed'`),
    ]);
    const ethRate = await getLiveETHRate();
    res.json({
      totalVolumeINR:    parseFloat(volume.rows[0].total),
      totalTrades:       parseInt(count.rows[0].count),
      avgPriceINR:       parseFloat(avgPrice.rows[0].avg),
      totalPlatformFees: parseFloat(fees.rows[0].total),
      ethRate,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ── GET /api/trades/my-fees ───────────────────────────────────────
router.get('/my-fees', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         SUM(CASE WHEN buyer_id = $1 THEN buyer_fee_inr ELSE 0 END)  AS total_paid_as_buyer,
         SUM(CASE WHEN seller_id = $1 THEN seller_fee_inr ELSE 0 END) AS total_paid_as_seller,
         COUNT(*)                                                       AS total_trades
       FROM trades
       WHERE (buyer_id = $1 OR seller_id = $1) AND status = 'completed'`,
      [req.user.id]
    );
    res.json({
      feesPaidAsBuyer:  parseFloat(rows[0].total_paid_as_buyer  || 0),
      feesPaidAsSeller: parseFloat(rows[0].total_paid_as_seller || 0),
      totalTrades:      parseInt(rows[0].total_trades || 0),
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch fees' });
  }
});

module.exports = router;
module.exports.getLiveETHRate = getLiveETHRate;