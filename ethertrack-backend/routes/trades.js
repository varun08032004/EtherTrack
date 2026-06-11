// routes/trades.js — EtherTrack Production Settlement Engine
// FIX-IPv6: tradeLimiter and readLimiter keyGenerators use ipKeyGenerator(req)
//           instead of req.ip — fixes ERR_ERL_KEY_GEN_IPV6 from express-rate-limit v7+
'use strict';

const router    = require('express').Router();
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { safeQuery: query, withTransaction, getClient } = require('../db/pool');
const { authenticate, requireKYC } = require('../middleware/auth');
const { createNotification } = require('./notifications');

// ── Rate limiting ─────────────────────────────────────────────────
const tradeLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => req.user?.id ?? ipKeyGenerator(req),
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many trade attempts. Please wait before retrying.' });
  },
});

const readLimiter = rateLimit({
  windowMs:     60 * 1000,
  max:          120,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req),
});

// ── ETH/INR rate — 60s TTL + slippage guard ──────────────────────
let _cachedRate    = 280000;
let _lastFetchedAt = 0;
const RATE_TTL_MS  = 60 * 1000;
const MAX_SLIPPAGE = 0.01;

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
      const newRate = data.ethereum.inr;
      if (_lastFetchedAt > 0) {
        const drift = Math.abs(newRate - _cachedRate) / _cachedRate;
        if (drift > MAX_SLIPPAGE) {
          console.warn(`[trades] ETH rate moved ${(drift * 100).toFixed(2)}%: ${_cachedRate} → ${newRate}`);
        }
      }
      _cachedRate    = newRate;
      _lastFetchedAt = now;
      await query(
        `INSERT INTO eth_inr_rates (rate, source) VALUES ($1, 'coingecko')`,
        [_cachedRate]
      ).catch(() => {});
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      console.warn('[trades] ETH rate fetch failed, using cached:', _cachedRate, e.message);
    } else {
      console.warn('[trades] ETH rate fetch timed out, using cached:', _cachedRate);
    }
  }
  return _cachedRate;
};

// ── GET /api/trades/eth-rate ──────────────────────────────────────
router.get('/eth-rate', readLimiter, async (req, res) => {
  try {
    const rate = await getLiveETHRate();
    res.json({ rate, source: 'coingecko', cachedAt: new Date(_lastFetchedAt).toISOString() });
  } catch (e) {
    res.json({ rate: _cachedRate, source: 'cache' });
  }
});

// ── GET /api/trades/price-suggestion ─────────────────────────────
router.get('/price-suggestion', readLimiter, async (req, res) => {
  const { standard, projectType, vintageYear } = req.query;
  if (!standard || !projectType || !vintageYear)
    return res.status(400).json({ error: 'standard, projectType, vintageYear required' });
  try {
    let suggestionRow;
    try {
      const { rows } = await query(
        `SELECT * FROM get_suggested_price($1, $2, $3)`,
        [standard, projectType, parseInt(vintageYear)]
      );
      suggestionRow = rows[0];
    } catch {
      suggestionRow = { suggested_price: 850, min_price: 650, max_price: 1200, source: 'fallback' };
    }

    const ethRate = await getLiveETHRate();
    const s       = suggestionRow || { suggested_price: 850, min_price: 650, max_price: 1200, source: 'fallback' };

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
    console.error('[trades/price-suggestion]', e.message);
    res.status(500).json({ error: 'Failed to get price suggestion' });
  }
});

// ── GET /api/trades/history ───────────────────────────────────────
router.get('/history', authenticate, readLimiter, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT t.*,
              cb.project_name, cb.standard,
              cb.registry_serial AS serial_number,
              cb.project_type,
              cb.project_location AS location
       FROM trades t
       LEFT JOIN carbon_batches cb ON cb.id = t.batch_id
       WHERE t.buyer_id = $1 OR t.seller_id = $1
       ORDER BY t.created_at DESC LIMIT 100`,
      [req.user.id]
    );
    res.json({ trades: rows });
  } catch (e) {
    console.error('[trades/history]', e.message);
    res.status(500).json({ error: 'Failed to fetch trade history' });
  }
});

// ── POST /api/trades/record ───────────────────────────────────────
router.post('/record', authenticate, requireKYC, tradeLimiter, async (req, res) => {
  const {
    listingId, batchId, quantity, paymentMode, txHash,
    pricePerCreditINR, idempotencyKey, clientEthRate,
  } = req.body;

  if (!batchId || !quantity || !paymentMode || !pricePerCreditINR)
    return res.status(400).json({ error: 'batchId, quantity, paymentMode, pricePerCreditINR required' });
  if (!['inr', 'eth'].includes(paymentMode))
    return res.status(400).json({ error: 'paymentMode must be "inr" or "eth"' });

  const qty = parseInt(quantity);
  if (!qty || qty <= 0) return res.status(400).json({ error: 'Invalid quantity' });

  const pricePerCredit = parseFloat(pricePerCreditINR);
  if (!pricePerCredit || pricePerCredit <= 0)
    return res.status(400).json({ error: 'Invalid pricePerCreditINR' });

  const ethRate = await getLiveETHRate();
  if (paymentMode === 'eth' && clientEthRate) {
    const drift = Math.abs(ethRate - parseFloat(clientEthRate)) / parseFloat(clientEthRate);
    if (drift > MAX_SLIPPAGE) {
      return res.status(400).json({
        error: 'ETH/INR rate changed significantly since your quote. Please refresh and retry.',
        serverRate: ethRate, clientRate: clientEthRate, driftPct: (drift * 100).toFixed(2),
      });
    }
  }

  if (idempotencyKey) {
    try {
      const { rows: existing } = await query(
        `SELECT id, buyer_pays_inr, quantity FROM trades
         WHERE buyer_id = $1 AND idempotency_key = $2 AND status = 'completed' LIMIT 1`,
        [req.user.id, idempotencyKey]
      );
      if (existing.length) {
        const { rows: buyerRow } = await query('SELECT inr_balance FROM users WHERE id = $1', [req.user.id]);
        return res.json({
          success: true, tradeId: existing[0].id, idempotent: true,
          buyerBalance: (buyerRow[0]?.inr_balance || '0').toString(),
          message: 'Trade already completed (idempotent return)',
        });
      }
    } catch { /* non-fatal */ }
  }

  if (paymentMode === 'eth' && txHash) {
    try {
      const { rows: dupTx } = await query(`SELECT id FROM trades WHERE tx_hash = $1 LIMIT 1`, [txHash]);
      if (dupTx.length) return res.json({ success: true, tradeId: dupTx[0].id, idempotent: true, message: 'ETH trade already recorded' });
    } catch { /* non-fatal */ }
  }

  try {
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

    if (listingId) {
      const { rows: listingRows } = await query(
        `SELECT price_per_credit_inr FROM market_listings WHERE listing_id = $1`, [listingId]
      );
      if (listingRows.length) {
        const canonicalPrice = parseFloat(listingRows[0].price_per_credit_inr);
        const priceDrift     = Math.abs(pricePerCredit - canonicalPrice) / canonicalPrice;
        if (priceDrift > 0.01) {
          return res.status(400).json({
            error: 'Price mismatch. The listing price has changed. Please refresh and retry.',
            expectedPrice: canonicalPrice, submittedPrice: pricePerCredit, code: 'PRICE_MISMATCH',
          });
        }
      }
    }

    if (batch.available_credits < qty)
      return res.status(400).json({ error: `Only ${batch.available_credits} credits available` });

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
      const { rows: batchLocked } = await client.query(
        `SELECT available_credits FROM carbon_batches WHERE id = $1 FOR UPDATE`, [batchId]
      );
      if (!batchLocked.length || batchLocked[0].available_credits < qty) {
        throw Object.assign(
          new Error(`Only ${batchLocked[0]?.available_credits || 0} credits available`),
          { statusCode: 400 }
        );
      }

      if (paymentMode === 'inr') {
        const { rows: buyerRows } = await client.query(
          'SELECT inr_balance FROM users WHERE id = $1 FOR UPDATE', [req.user.id]
        );
        const buyerBalance = parseFloat(buyerRows[0]?.inr_balance || 0);
        if (buyerBalance < buyerPaysINR) {
          throw Object.assign(new Error('Insufficient INR balance'), {
            statusCode: 400, required: buyerPaysINR, available: buyerBalance,
          });
        }
        await client.query(
          `UPDATE users SET inr_balance = inr_balance - $1, updated_at = NOW() WHERE id = $2`,
          [buyerPaysINR, req.user.id]
        );
        await client.query(
          `INSERT INTO wallet_transactions (user_id, type, method, amount, status, notes, trade_type)
           VALUES ($1, 'debit', 'inr', $2, 'success', $3, 'buy_credit')`,
          [req.user.id, buyerPaysINR,
           `Purchase of ${qty} x ${batch.project_name} @ ₹${pricePerCredit}/credit (incl. 0.5% fee)`]
        );
      }

      const { rows: tradeRows } = await client.query(
        `INSERT INTO trades (
          buyer_id, seller_id, buyer_wallet, seller_wallet,
          batch_id, token_id, listing_id_onchain, quantity,
          price_per_credit_inr, subtotal_inr,
          buyer_fee_inr, seller_fee_inr, total_fee_inr,
          buyer_pays_inr, seller_receives_inr,
          price_per_credit_eth, total_eth, eth_inr_rate, fee_eth,
          payment_mode, status, tx_hash, buyer_inr_deducted, seller_inr_credited,
          inr_settlement_at, completed_at, idempotency_key
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18,$19,
          $20,'completed',$21,$22,$23,$24,NOW(),$25
        ) RETURNING id`,
        [
          req.user.id, sellerId, req.user.wallet_address || null, batch.seller_wallet,
          batchId, batch.token_id, listingId || null, qty,
          pricePerCredit, subtotalINR,
          buyerFeeINR, sellerFeeINR, totalFeeINR,
          buyerPaysINR, sellerGetsINR,
          pricePerCredit / ethRate, totalETH, ethRate, feeETH,
          paymentMode, txHash || null,
          paymentMode === 'inr', paymentMode === 'inr',
          paymentMode === 'inr' ? new Date() : null,
          idempotencyKey || null,
        ]
      );
      tradeId = tradeRows[0].id;

      if (paymentMode === 'inr') {
        await client.query(
          `UPDATE users SET inr_balance = inr_balance + $1, updated_at = NOW() WHERE id = $2`,
          [sellerGetsINR, sellerId]
        );
        await client.query(
          `INSERT INTO wallet_transactions (user_id, type, method, amount, status, notes, trade_id, trade_type)
           VALUES ($1, 'credit', 'inr', $2, 'success', $3, $4, 'sell_credit')`,
          [sellerId, sellerGetsINR,
           `Sale of ${qty} x ${batch.project_name} @ ₹${pricePerCredit}/credit (after 0.5% fee)`,
           tradeId]
        );
      } else {
        await client.query(
          `INSERT INTO pending_seller_credits (trade_id, seller_id, amount_inr, eth_rate, tx_hash)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT (trade_id) DO NOTHING`,
          [tradeId, sellerId, sellerGetsINR, ethRate, txHash]
        ).catch(async () => {
          await client.query(
            `INSERT INTO wallet_transactions (user_id, type, method, amount, status, notes, trade_id, trade_type)
             VALUES ($1, 'credit', 'eth_pending', $2, 'pending', $3, $4, 'sell_credit')`,
            [sellerId, sellerGetsINR,
             `Pending ETH settlement for sale of ${qty} x ${batch.project_name} | txHash: ${txHash}`,
             tradeId]
          );
        });
      }

      await client.query(
        `INSERT INTO platform_fees (trade_id, buyer_fee_inr, seller_fee_inr, total_fee_inr, fee_eth, eth_rate, payment_mode, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'collected') ON CONFLICT DO NOTHING`,
        [tradeId, buyerFeeINR, sellerFeeINR, totalFeeINR, feeETH, ethRate, paymentMode]
      ).catch(() => {});

      await client.query(
        `UPDATE carbon_batches
         SET available_credits = GREATEST(0, available_credits - $1),
             last_traded_price_inr = $2, updated_at = NOW()
         WHERE id = $3`,
        [qty, pricePerCredit, batchId]
      );

      await client.query(
        `INSERT INTO registry_transactions
           (type, token_id, batch_id, listing_id, trade_id,
            from_wallet, to_wallet, from_user_id, to_user_id,
            amount, price_eth, price_inr, fee_eth, fee_inr,
            buyer_fee_inr, seller_fee_inr, total_price_inr,
            payment_mode, tx_hash, project_name, standard)
         VALUES ('TRADE',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [
          batch.token_id, batchId, listingId || null, tradeId,
          batch.seller_wallet, req.user.wallet_address || null,
          sellerId, req.user.id,
          qty, pricePerCredit / ethRate, pricePerCredit,
          feeETH, totalFeeINR, buyerFeeINR, sellerFeeINR,
          subtotalINR, paymentMode, txHash || null,
          batch.project_name, batch.standard,
        ]
      );

      await client.query(
        `INSERT INTO audit_log (user_id, action, entity, entity_id, new_value, ip_address, created_at)
         VALUES ($1, 'TRADE_EXECUTED', 'trade', $2, $3, $4, NOW())`,
        [req.user.id, String(tradeId),
         JSON.stringify({ qty, pricePerCredit, paymentMode, batchId, sellerId }), req.ip]
      ).catch(() => {});
    });

    await Promise.all([
      createNotification(req.user.id, 'TRADE', 'Purchase Complete',
        `${qty} x ${batch.project_name} — ₹${buyerPaysINR.toLocaleString('en-IN')} paid`,
        '/portfolio', { tradeId, quantity: qty, projectName: batch.project_name }
      ).catch(() => {}),
      createNotification(sellerId, 'TRADE',
        paymentMode === 'inr' ? 'Credits Sold' : 'Credits Sold (ETH pending)',
        paymentMode === 'inr'
          ? `${qty} x ${batch.project_name} — ₹${sellerGetsINR.toLocaleString('en-IN')} credited`
          : `${qty} x ${batch.project_name} — INR credit pending on-chain confirmation`,
        '/wallet', { tradeId, quantity: qty, projectName: batch.project_name }
      ).catch(() => {}),
    ]);

    const { rows: updatedBuyer }  = await query('SELECT inr_balance FROM users WHERE id = $1', [req.user.id]);
    const { rows: updatedSeller } = await query('SELECT inr_balance FROM users WHERE id = $1', [sellerId]);

    res.json({
      success: true, tradeId, quantity: qty, pricePerCredit, subtotalINR,
      buyerFeeINR, sellerFeeINR, totalFeeINR, buyerPaysINR, sellerGetsINR,
      ethRate, txHash,
      buyerBalance:  (updatedBuyer[0]?.inr_balance  || '0').toString(),
      sellerBalance: (updatedSeller[0]?.inr_balance || '0').toString(),
      message: `Trade completed — ${qty} credits purchased`,
    });

  } catch (e) {
    console.error('[trades/record]', e.message);
    if (e.statusCode !== 400 && txHash) {
      query(
        `INSERT INTO failed_trade_records (tx_hash, buyer_id, batch_id, quantity, error)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tx_hash) DO NOTHING`,
        [txHash, req.user.id, batchId, qty, e.message.slice(0, 500)]
      ).catch(() => {});
    }
    res.status(e.statusCode || 500).json({
      error: e.message || 'Trade settlement failed',
      required: e.required, available: e.available,
    });
  }
});

// ── POST /api/trades/deduct — DEPRECATED ─────────────────────────
router.post('/deduct', authenticate, requireKYC, async (req, res) => {
  res.status(410).json({
    error: 'This endpoint is deprecated.',
    message: 'INR deduction now happens atomically inside /api/trades/record.',
    deprecated: true,
  });
});

// ── POST /api/trades/refund ───────────────────────────────────────
router.post('/refund', authenticate, async (req, res) => {
  const { tradeId, amount, reason } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  if (!tradeId)               return res.status(400).json({ error: 'tradeId required' });

  try {
    const { rows: tradeRows } = await query(
      `SELECT id, buyer_pays_inr, status, buyer_id FROM trades WHERE id = $1 AND buyer_id = $2`,
      [tradeId, req.user.id]
    );
    if (!tradeRows.length)
      return res.status(403).json({ error: 'Trade not found or does not belong to you' });

    const trade = tradeRows[0];
    if (trade.status !== 'failed')
      return res.status(400).json({ error: 'Refund only permitted for failed trades' });

    const maxRefund = parseFloat(trade.buyer_pays_inr || 0);
    if (parseFloat(amount) > maxRefund)
      return res.status(400).json({ error: `Refund cannot exceed original payment of ₹${maxRefund}` });

    await withTransaction(async (client) => {
      const { rows: locked } = await client.query(
        `SELECT status FROM trades WHERE id = $1 AND buyer_id = $2 FOR UPDATE`,
        [tradeId, req.user.id]
      );
      if (!locked.length || locked[0].status !== 'failed') {
        throw Object.assign(new Error('Trade is no longer eligible for refund'), { statusCode: 400 });
      }
      await client.query(
        `UPDATE users SET inr_balance = inr_balance + $1, updated_at = NOW() WHERE id = $2`,
        [amount, req.user.id]
      );
      await client.query(
        `INSERT INTO wallet_transactions (user_id, type, method, amount, status, notes, trade_id, trade_type)
         VALUES ($1, 'credit', 'system', $2, 'success', $3, $4, 'refund')`,
        [req.user.id, amount, reason || `Trade refund — failed tx ${tradeId}`, tradeId]
      );
      await client.query(
        `UPDATE trades SET status = 'refunded', updated_at = NOW() WHERE id = $1`, [tradeId]
      );
      await client.query(
        `INSERT INTO audit_log (user_id, action, entity, entity_id, new_value, ip_address, created_at)
         VALUES ($1, 'REFUND_ISSUED', 'trade', $2, $3, $4, NOW())`,
        [req.user.id, String(tradeId), JSON.stringify({ amount, reason }), req.ip]
      ).catch(() => {});
    });

    const { rows } = await query('SELECT inr_balance FROM users WHERE id = $1', [req.user.id]);
    res.json({ success: true, balance: (rows[0].inr_balance || '0').toString(), refunded: amount });
  } catch (e) {
    console.error('[trades/refund]', e.message);
    res.status(e.statusCode || 500).json({ error: e.message || 'Refund failed' });
  }
});

// ── GET /api/trades/stats ─────────────────────────────────────────
router.get('/stats', readLimiter, async (req, res) => {
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
router.get('/my-fees', authenticate, readLimiter, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         SUM(CASE WHEN buyer_id  = $1 THEN buyer_fee_inr  ELSE 0 END) AS total_paid_as_buyer,
         SUM(CASE WHEN seller_id = $1 THEN seller_fee_inr ELSE 0 END) AS total_paid_as_seller,
         COUNT(*) AS total_trades
       FROM trades WHERE (buyer_id = $1 OR seller_id = $1) AND status = 'completed'`,
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

// ── creditSellerFromChain — called by blockchain listener ─────────
const creditSellerFromChain = async ({ txHash, sellerId, sellerGetsINR, tradeId }) => {
  try {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE trades SET seller_inr_credited = true, inr_settlement_at = NOW()
         WHERE id = $1 AND seller_inr_credited = false`, [tradeId]
      );
      await client.query(
        `UPDATE users SET inr_balance = inr_balance + $1, updated_at = NOW() WHERE id = $2`,
        [sellerGetsINR, sellerId]
      );
      await client.query(
        `INSERT INTO wallet_transactions (user_id, type, method, amount, status, notes, trade_id, trade_type)
         VALUES ($1, 'credit', 'eth', $2, 'success', $3, $4, 'sell_credit')`,
        [sellerId, sellerGetsINR, `ETH sale confirmed on-chain | txHash: ${txHash}`, tradeId]
      );
      await client.query(
        `UPDATE pending_seller_credits SET status = 'settled', settled_at = NOW() WHERE trade_id = $1`,
        [tradeId]
      ).catch(() => {});
    });
    console.log(`[trades] Seller ${sellerId} credited ₹${sellerGetsINR} for ETH trade ${tradeId}`);
  } catch (e) {
    console.error('[trades/creditSellerFromChain] failed:', e.message, { txHash, tradeId });
  }
};

module.exports = router;
module.exports.getLiveETHRate        = getLiveETHRate;
module.exports.creditSellerFromChain = creditSellerFromChain;