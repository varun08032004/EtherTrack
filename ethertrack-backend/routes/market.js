// routes/market.js — Public market listings (v5)
// ─────────────────────────────────────────────────────────────────────────
// FIXES ON TOP OF v4:
//
// [M9]  IPv6 rate limiter fix — keyGenerator: (req) => req.ip was throwing
//       ERR_ERL_KEY_GEN_IPV6 validation error from express-rate-limit v7+
//       and crashing the entire server startup. Fixed by using ipKeyGenerator
//       helper, consistent with alerts.js and trades.js.
//
// [M10] eth-inr endpoint hardened — getLiveETHRate timeout was causing the
//       /eth-inr endpoint to hang for 30s before returning 503. Now returns
//       the cached fallback immediately if no fresh rate is available.
//
// [M11] [FIX-LISTED-QTY] `amount` in /listings now = LEAST(available_credits,
//       listed_quantity) instead of raw available_credits. Previously
//       `amount` reflected the seller's ENTIRE remaining wallet balance for
//       that batch (e.g. 960 out of 1000 after 40 sold), not the size of
//       THIS specific on-chain listing (e.g. 60 still listed). That number
//       was then used directly as both the "available" display and the max
//       buy quantity on the frontend, letting buyers attempt to purchase far
//       more than was actually escrowed in the listing contract.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const router     = require('express').Router();
const { rateLimit, ipKeyGenerator } = require('express-rate-limit'); // [M9] import ipKeyGenerator
const { safeQuery: query } = require('../db/pool');
const statsCache = require('../services/statsCache');
const { getLiveETHRate, cacheAge } = require('../services/rateService');

// ── [M9] Rate limiter — IPv6-safe (was crashing server on startup) ─
const publicLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             120,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => ipKeyGenerator(req), // [M9] was: (req) => req.ip
  handler:         (req, res) =>
    res.status(429).json({ error: 'Too many requests', code: 'RATE_LIMITED' }),
});

router.use(publicLimiter);

// ── Public cache headers ──────────────────────────────────────────
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=30');
  next();
});

// ── [M1] ORDER BY allowlist ───────────────────────────────────────
const SORT_ALLOW = {
  priceAsc:  'cb.price_per_credit_inr ASC',
  priceDesc: 'cb.price_per_credit_inr DESC',
  amount:    'LEAST(cb.available_credits, cb.listed_quantity) DESC',
  vintage:   'cb.vintage_year DESC',
  name:      'cb.project_name ASC',
  recent:    'cb.updated_at DESC',
};

// ── [M4] Enum allowlists ──────────────────────────────────────────
const STANDARD_ALLOW  = new Set(['VCS', 'GS', 'CDM', 'ACR', 'ALL']);
const PROJ_TYPE_ALLOW = new Set(['Renewable', 'Forestry', 'Industrial', 'Social', 'ALL']);

const FALLBACK_ETH_INR = 280_000;

// ── GET /api/market/listings ──────────────────────────────────────
router.get('/listings', async (req, res) => {
  try {
    const { standard, projectType, sortBy } = req.query;

    const std   = STANDARD_ALLOW.has(standard)    ? standard    : 'ALL';
    const ptype = PROJ_TYPE_ALLOW.has(projectType) ? projectType : 'ALL';

    const params = [];
    let whereExtra = '';

    if (std !== 'ALL') {
      params.push(std);
      whereExtra += ` AND cb.standard = $${params.length}`;
    }
    if (ptype !== 'ALL') {
      params.push(ptype);
      whereExtra += ` AND cb.project_type = $${params.length}`;
    }

    const orderClause = SORT_ALLOW[sortBy] || SORT_ALLOW.recent;

    const { rows } = await query(
      `SELECT
         cb.id                                       AS "batchId",
         cb.id                                       AS "listingId",
         cb.listing_id_onchain                       AS "listingIdOnchain",
         cb.project_name                             AS "projectName",
         cb.project_location                         AS "location",
         cb.standard,
         cb.project_type                             AS "projectType",
         cb.developer,
         cb.vintage_year                             AS "vintageYear",
         cb.registry_serial                          AS "serialNumber",
         -- [M11] cap displayed/purchasable amount at the smaller of the two:
         -- what's actually escrowed in this listing (listed_quantity) vs
         -- what the batch still has (available_credits, a safety floor in
         -- case of data drift). This is the number buyers should ever see
         -- or be allowed to purchase against for THIS listing.
         LEAST(cb.available_credits, cb.listed_quantity) AS amount,
         cb.price_per_credit_inr                     AS "pricePerUnitINR",
         cb.last_traded_price_inr                    AS "lastTradedPriceINR",
         cb.token_id                                 AS "tokenId",
         COALESCE(cb.vintage_discount, 0)            AS "vintageDiscount",
         COALESCE(cb.total_retired, 0)               AS "totalRetired",
         EXTRACT(EPOCH FROM cb.expires_at)::bigint   AS "expiresAt",
         u.wallet_address                            AS seller,
         cb.updated_at
       FROM carbon_batches cb
       JOIN users u ON u.id = cb.user_id
       WHERE cb.admin_status  = 'approved'
         AND cb.available_credits > 0
         AND cb.listed_quantity > 0
         AND cb.listing_id_onchain IS NOT NULL
         AND cb.deleted_at IS NULL
         AND (cb.expires_at IS NULL OR cb.expires_at > NOW())
         ${whereExtra}
       ORDER BY ${orderClause}
       LIMIT 200`,
      params
    );

    const listings = rows.map(r => ({
      ...r,
      adjPrice: r.pricePerUnitINR ? r.pricePerUnitINR / FALLBACK_ETH_INR : 0,
    }));

    res.json({ listings, count: listings.length });
  } catch (e) {
    console.error('[market/listings]', e);
    res.status(500).json({ error: 'Failed to fetch listings', listings: [], count: 0 });
  }
});

// ── GET /api/market/stats ─────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const cached = statsCache.get('market:stats');
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached);
    }

    res.setHeader('X-Cache', 'MISS');
    const [volume, count, listings, retired] = await Promise.all([
      query(`SELECT COALESCE(SUM(subtotal_inr), 0) AS total FROM trades WHERE status = 'completed'`),
      query(`SELECT COUNT(*) FROM trades WHERE status = 'completed'`),
      query(
        `SELECT COUNT(*) FROM carbon_batches
         WHERE admin_status     = 'approved'
           AND available_credits > 0
           AND listed_quantity > 0
           AND listing_id_onchain IS NOT NULL
           AND deleted_at IS NULL
           AND (expires_at IS NULL OR expires_at > NOW())`
      ),
      query(`SELECT COALESCE(SUM(retired_credits), 0) AS total FROM carbon_batches`),
    ]);

    const stats = {
      totalVolumeINR: parseFloat(volume.rows[0].total),
      totalTrades:    parseInt(count.rows[0].count,    10),
      activeListings: parseInt(listings.rows[0].count, 10),
      totalRetired:   parseInt(retired.rows[0].total,  10),
      cachedAt:       new Date().toISOString(),
    };

    statsCache.set('market:stats', stats, 90);
    res.json(stats);
  } catch (e) {
    console.error('[market/stats]', e);
    res.status(500).json({ error: 'Failed to fetch market stats' });
  }
});

// ── GET /api/market/buy-orders ────────────────────────────────────
router.get('/buy-orders', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         bo.id                                     AS "orderId",
         bo.token_id                               AS "tokenId",
         bo.amount,
         bo.remaining,
         bo.limit_price                            AS "limitPrice",
         bo.status,
         EXTRACT(EPOCH FROM bo.expires_at)::bigint AS "expiresAt",
         bo.eth_escrowed                           AS "ethEscrowed",
         u.wallet_address                          AS buyer
       FROM buy_orders bo
       JOIN users u ON u.id = bo.buyer_id
       WHERE bo.status IN (0, 2)
         AND (bo.expires_at IS NULL OR bo.expires_at > NOW())
       ORDER BY bo.limit_price DESC
       LIMIT 200`
    );
    res.json({ orders: rows });
  } catch (e) {
    console.error('[market/buy-orders]', e);
    res.status(500).json({ error: 'Failed to fetch buy orders', orders: [] });
  }
});

// ── GET /api/market/trade-history ────────────────────────────────
// NOTE: this is the PUBLIC, all-users feed — there is no logged-in "you" to
// compute Buy/Sell relative to, so it intentionally has no `type` field.
// Personal Buy/Sell history lives at GET /api/trades/history (routes/trades.js),
// which computes type per requesting user. If the frontend's "My Trades" or
// "Recent Trades" panel is meant to show the current user's own trades with
// Buy/Sell coloring, it should call tradesAPI.history() instead of this route.
router.get('/trade-history', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         t.id,
         t.token_id             AS "tokenId",
         t.quantity             AS amount,
         t.price_per_credit_inr AS "priceINR",
         t.total_eth            AS "totalEth",
         t.payment_mode         AS "paymentMode",
         t.tx_hash              AS "txHash",
         t.created_at           AS time,
         cb.project_name        AS "projectName"
       FROM trades t
       LEFT JOIN carbon_batches cb ON cb.id = t.batch_id
       WHERE t.status = 'completed'
       ORDER BY t.created_at DESC
       LIMIT 100`
    );
    res.json({ trades: rows });
  } catch (e) {
    console.error('[market/trade-history]', e);
    res.status(500).json({ error: 'Failed to fetch trade history', trades: [] });
  }
});

// ── GET /api/market/eth-inr ───────────────────────────────────────
// [M10] Returns cached fallback immediately if live rate unavailable,
//       instead of hanging for up to 30s before returning 503.
router.get('/eth-inr', async (req, res) => {
  try {
    const rate = await getLiveETHRate();
    res.json({ inr: rate, cachedAt: new Date(Date.now() - cacheAge()).toISOString() });
  } catch (e) {
    console.error('[market/eth-inr]', e.message);
    // [M10] Return fallback instead of 503 — frontend can use this safely
    res.json({ inr: FALLBACK_ETH_INR, cachedAt: null, fallback: true });
  }
});

module.exports = router;