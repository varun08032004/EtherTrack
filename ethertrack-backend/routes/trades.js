// routes/trades.js — EtherTrack Production Settlement Engine
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
// Called AFTER on-chain tx succeeds — records trade + settles INR/ETH balances
router.post('/record', authenticate, requireKYC, async (req, res) => {
  const {
    listingId,         // on-chain listing ID
    batchId,           // DB carbon_batches UUID
    quantity,          // number of credits traded
    paymentMode,       // 'inr' | 'eth'
    txHash,            // on-chain tx hash
    pricePerCreditINR, // INR price per credit
  } = req.body;

  if (!batchId || !quantity || !paymentMode || !pricePerCreditINR)
    return res.status(400).json({ error: 'batchId, quantity, paymentMode, pricePerCreditINR required' });

  // ✅ FIX 1: Validate paymentMode is a known value before hitting the DB
  if (!['inr', 'eth'].includes(paymentMode))
    return res.status(400).json({ error: 'paymentMode must be "inr" or "eth"' });

  const qty = parseInt(quantity);
  if (!qty || qty <= 0)
    return res.status(400).json({ error: 'Invalid quantity' });

  const pricePerCredit = parseFloat(pricePerCreditINR);
  if (!pricePerCredit || pricePerCredit <= 0)
    return res.status(400).json({ error: 'Invalid pricePerCreditINR' });

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

    // ── Fee calculation: 0.5% buyer + 0.5% seller = 1% total ─────
    const subtotalINR   = parseFloat((pricePerCredit * qty).toFixed(2));
    const buyerFeeINR   = parseFloat((subtotalINR * 0.005).toFixed(2));
    const sellerFeeINR  = parseFloat((subtotalINR * 0.005).toFixed(2));
    const totalFeeINR   = parseFloat((buyerFeeINR + sellerFeeINR).toFixed(2));
    const buyerPaysINR  = parseFloat((subtotalINR + buyerFeeINR).toFixed(2));
    const sellerGetsINR = parseFloat((subtotalINR - sellerFeeINR).toFixed(2));

    // ETH equivalents
    const totalETH      = subtotalINR / ethRate;
    const feeETH        = totalFeeINR / ethRate;

    // ── INR payment: validate buyer balance first ────────────────
    if (paymentMode === 'inr') {
      const { rows: buyerRows } = await query(
        'SELECT inr_balance FROM users WHERE id = $1', [req.user.id]
      );
      const buyerBalance = parseFloat(buyerRows[0]?.inr_balance || 0);
      if (buyerBalance < buyerPaysINR) {
        return res.status(400).json({
          error:     'Insufficient INR balance',
          required:  buyerPaysINR,
          available: buyerBalance,
        });
      }
    }

    let tradeId;

    await withTransaction(async (client) => {

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
          inr_settlement_at, completed_at
        ) VALUES (
          $1,$2,$3,$4,
          $5,$6,$7,$8,
          $9,$10,
          $11,$12,$13,
          $14,$15,
          $16,$17,$18,$19,
          $20,$21,
          $22,$23,$24,
          $25,$26
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
        ]
      );
      tradeId = tradeRows[0].id;

      // ── 2. Deduct buyer INR (INR payment only) ─────────────────
      if (paymentMode === 'inr') {
        await client.query(
          `UPDATE users
           SET inr_balance = inr_balance - $1,
               updated_at  = NOW()
           WHERE id = $2`,
          [buyerPaysINR, req.user.id]
        );
        // ✅ FIX 2: method changed from 'trade' → 'inr'
        // 'trade' is not in the wallet_transactions_method_check constraint
        await client.query(
          `INSERT INTO wallet_transactions
           (user_id, type, method, amount, status, notes, trade_id, trade_type)
           VALUES ($1, 'debit', 'inr', $2, 'success', $3, $4, 'buy_credit')`,
          [
            req.user.id, buyerPaysINR,
            `Purchase of ${qty} × ${batch.project_name} @ ₹${pricePerCredit}/credit (incl. 0.5% fee)`,
            tradeId,
          ]
        );
      }

      // ── 3. Credit seller INR wallet (BOTH payment modes) ────────
      await client.query(
        `UPDATE users
         SET inr_balance = inr_balance + $1,
             updated_at  = NOW()
         WHERE id = $2`,
        [sellerGetsINR, sellerId]
      );
      // ✅ FIX 3: method changed from 'trade' / 'trade_eth_equivalent' → 'inr' / 'eth'
      // Both 'trade' and 'trade_eth_equivalent' violate the method check constraint
      await client.query(
        `INSERT INTO wallet_transactions
         (user_id, type, method, amount, status, notes, trade_id, trade_type)
         VALUES ($1, 'credit', $2, $3, 'success', $4, $5, 'sell_credit')`,
        [
          sellerId,
          paymentMode === 'inr' ? 'inr' : 'eth',   // ✅ was: 'trade' / 'trade_eth_equivalent'
          sellerGetsINR,
          `Sale of ${qty} × ${batch.project_name} @ ₹${pricePerCredit}/credit (after 0.5% fee)`,
          tradeId,
        ]
      );

      // ── 4. Record platform fee ─────────────────────────────────
      await client.query(
        `INSERT INTO platform_fees
         (trade_id, buyer_fee_inr, seller_fee_inr, total_fee_inr,
          fee_eth, eth_rate, payment_mode, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'collected')
         ON CONFLICT DO NOTHING`,
        [tradeId, buyerFeeINR, sellerFeeINR, totalFeeINR, feeETH, ethRate, paymentMode]
      ).catch(async () => {
        // platform_fees table might not exist yet — log to wallet_transactions instead
        // ✅ FIX 4: method changed from paymentMode ('inr'/'eth') — already valid here,
        //    but type 'platform_fee' may not be in the type check constraint either.
        //    Using 'credit' type and 'system' method as a safe fallback.
        await client.query(
          `INSERT INTO wallet_transactions
           (user_id, type, method, amount, status, notes, trade_id, trade_type)
           VALUES (NULL, 'credit', 'system', $1, 'collected', $2, $3, 'platform_fee')`,
          [totalFeeINR, `Platform fee — trade ${tradeId}`, tradeId]
        ).catch(() => {});
      });

      // ── 5. Update batch available_credits ──────────────────────
      await client.query(
        `UPDATE carbon_batches
         SET available_credits     = GREATEST(0, available_credits - $1),
             last_traded_price_inr = $2,
             updated_at            = NOW()
         WHERE id = $3`,
        [qty, pricePerCredit, batchId]
      );

      // ── 6. Record in registry_transactions ─────────────────────
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
        `${qty} × ${batch.project_name} — ₹${buyerPaysINR.toLocaleString('en-IN')} paid (incl. 0.5% fee)`,
        '/portfolio',
        { tradeId, quantity: qty, projectName: batch.project_name }
      ).catch(() => {}),
      createNotification(
        sellerId, 'TRADE', '💰 Credits Sold',
        `${qty} × ${batch.project_name} — ₹${sellerGetsINR.toLocaleString('en-IN')} credited to your wallet (after 0.5% fee)`,
        '/wallet',
        { tradeId, quantity: qty, projectName: batch.project_name }
      ).catch(() => {}),
    ]);

    // ── Fetch updated balances to return ──────────────────────────
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
    res.status(500).json({ error: e.message || 'Trade settlement failed' });
  }
});

// ── POST /api/trades/deduct ───────────────────────────────────────
// Called BEFORE on-chain tx — deducts buyer INR wallet
router.post('/deduct', authenticate, requireKYC, async (req, res) => {
  const { amount, listingId, tokenId, quantity, projectName, standard } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  try {
    const { rows } = await query('SELECT inr_balance FROM users WHERE id = $1', [req.user.id]);
    const balance  = parseFloat(rows[0]?.inr_balance || 0);
    if (balance < amount) {
      return res.status(400).json({
        error:     'Insufficient INR balance',
        required:  amount,
        available: balance,
      });
    }

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE users SET inr_balance = inr_balance - $1, updated_at = NOW() WHERE id = $2`,
        [amount, req.user.id]
      );
      // ✅ FIX 5: method changed from 'inr_trade_hold' → 'inr'
      // 'inr_trade_hold' is not in the wallet_transactions_method_check constraint
      await client.query(
        `INSERT INTO wallet_transactions
         (user_id, type, method, amount, status, notes, trade_type)
         VALUES ($1, 'debit', 'inr', $2, 'pending', $3, 'buy_credit')`,
        [req.user.id, amount, `INR hold for ${quantity} × ${projectName || 'carbon credits'}`]
      );
    });

    const { rows: updated } = await query('SELECT inr_balance FROM users WHERE id = $1', [req.user.id]);
    res.json({ success: true, balance: parseFloat(updated[0].inr_balance) });
  } catch (e) {
    console.error('Deduct error:', e);
    res.status(500).json({ error: 'Deduction failed' });
  }
});

// ── POST /api/trades/refund ───────────────────────────────────────
// Called if on-chain tx fails AFTER INR was deducted
router.post('/refund', authenticate, async (req, res) => {
  const { tradeId, amount, reason } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  try {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE users SET inr_balance = inr_balance + $1, updated_at = NOW() WHERE id = $2`,
        [amount, req.user.id]
      );
      // 'system' method is used here — already correct, no change needed
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