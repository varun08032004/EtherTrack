// routes/watchlist.js — EtherTrack (Merged v3, production-ready)
// ─────────────────────────────────────────────────────────────────────────
// Mounted at /api/portfolio/watchlist in server.js
//
// Schema: portfolio_watchlist(id, user_id, listing_id, token_id,
//           project_name, created_at)
// See migration 001_production_hardening.sql
//
// WHAT'S IN HERE AND WHY:
//
// [W1]  ipKeyGenerator (Code 10) — Code 11 used req.ip directly, which
//       throws ERR_ERL_KEY_GEN_IPV6 on express-rate-limit v7+.
//
// [W2]  parseId helper — NaN + negative guard (Code 10 pattern). Code 11
//       used bare parseInt with no negative check; a negative listingId
//       would pass validation and hit the DB.
//
// [W3]  LIMIT at DB level on GET (Code 10) — Code 11 had no LIMIT,
//       so a user who somehow had >50 rows (e.g. via a data migration)
//       could get an unbounded result set.
//
// [W4]  tokenId support on POST (Code 11) — allows watchlisting by token
//       instead of listing, needed when a listing has been delisted but
//       the token still exists on-chain.
//
// [W5]  project_name stored on the row (Code 11) — denormalized so the
//       watchlist stays readable even if the listing is deleted from
//       market_listings.
//
// [W6]  deleted_at IS NULL on the carbon_batches JOIN (Code 11) — soft-
//       deleted batches would otherwise return a stale current_price.
//
// [W7]  available_credits and project_type in GET response (Code 11) —
//       needed by the watchlist UI to show stock and category.
//
// [W8]  RETURNING * on INSERT (Code 11) — returns the full row so the
//       frontend can optimistically update without a second fetch.
//
// [W9]  alreadyExists: true on conflict (Code 10) — lets the frontend
//       distinguish "just added" from "was already there" without
//       treating it as an error.
//
// [W10] Count cap inside try/catch (both versions missed this) — a DB
//       error on the count check would throw an unhandled rejection
//       instead of returning a clean 500.
//
// [NEW] MAX_WATCHLIST_ITEMS constant (Code 10) — no magic numbers.
// [NEW] parseInt(..., 10) with explicit radix throughout.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const router = require('express').Router();
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { safeQuery: query } = require('../db/pool');
const { authenticate }     = require('../middleware/auth');

const MAX_WATCHLIST_ITEMS = 50;

// ── [W1] Rate limiter — IPv6-safe ─────────────────────────────────
const watchlistLimiter = rateLimit({
  windowMs:     60 * 1000,
  max:          60,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req),
  handler: (req, res) =>
    res.status(429).json({ error: 'Too many watchlist requests. Try again shortly.' }),
});

// ── [W2] ID parser — NaN + negative guard ─────────────────────────
const parseId = (raw) => {
  const n = parseInt(raw, 10);
  return (!isNaN(n) && n >= 0) ? n : null;
};

// ── GET /api/portfolio/watchlist ──────────────────────────────────
// [W3] LIMIT enforced at DB level.
// [W6] deleted_at IS NULL on carbon_batches JOIN.
// [W7] available_credits, project_type included in response.
router.get('/', authenticate, watchlistLimiter, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         w.id,
         w.listing_id,
         w.token_id,
         w.project_name,
         w.created_at,
         cb.price_per_credit_inr AS current_price,
         cb.available_credits,
         cb.standard,
         cb.project_type,
         cb.vintage_year,
         cb.country,
         cb.credit_type
       FROM portfolio_watchlist w
       LEFT JOIN carbon_batches cb
         ON  cb.token_id     = w.token_id
         AND cb.admin_status = 'approved'
         AND cb.deleted_at  IS NULL
       WHERE w.user_id = $1
       ORDER BY w.created_at DESC
       LIMIT $2`,
      [req.user.id, MAX_WATCHLIST_ITEMS]
    );
    res.json({ items: rows });
  } catch (e) {
    console.error('[watchlist/GET]', e.message);
    res.status(500).json({ error: 'Failed to fetch watchlist.' });
  }
});

// ── POST /api/portfolio/watchlist ─────────────────────────────────
// [W4] Accepts listingId OR tokenId (or both).
// [W5] project_name stored on the row for durable display.
// [W8] RETURNING * — full row returned so frontend skips a refetch.
// [W9] alreadyExists flag on conflict.
// [W10] Count cap inside try/catch.
router.post('/', authenticate, watchlistLimiter, async (req, res) => {
  const { listingId, tokenId, projectName } = req.body;

  const parsedListingId = listingId != null ? parseId(listingId) : null;
  const parsedTokenId   = tokenId   != null ? parseId(tokenId)   : null;

  if (parsedListingId === null && parsedTokenId === null) {
    return res.status(400).json({
      error: 'listingId or tokenId required (must be a non-negative integer).',
    });
  }

  try {
    // [W10] Count check inside try/catch — DB error returns 500, not a crash
    const { rows: countRows } = await query(
      `SELECT COUNT(*) AS cnt FROM portfolio_watchlist WHERE user_id = $1`,
      [req.user.id]
    );
    if (parseInt(countRows[0].cnt, 10) >= MAX_WATCHLIST_ITEMS) {
      return res.status(400).json({
        error: `Watchlist limit reached (${MAX_WATCHLIST_ITEMS} items max).`,
      });
    }

    const { rows } = await query(
      `INSERT INTO portfolio_watchlist
         (user_id, listing_id, token_id, project_name, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, listing_id) DO NOTHING
       RETURNING *`,
      [
        req.user.id,
        parsedListingId,
        parsedTokenId,
        projectName || null,
      ]
    );

    // [W9] Conflict = already in watchlist — not an error, just inform the frontend
    if (!rows.length) {
      return res.status(200).json({
        message:       'Already in watchlist.',
        alreadyExists: true,
        item:          null,
      });
    }

    res.status(201).json({ message: 'Added to watchlist.', item: rows[0] });
  } catch (e) {
    console.error('[watchlist/POST]', e.message);
    res.status(500).json({ error: 'Failed to add to watchlist.' });
  }
});

// ── DELETE /api/portfolio/watchlist/:listingId ────────────────────
// [W2] parseId guard — rejects negative and non-integer params.
router.delete('/:listingId', authenticate, watchlistLimiter, async (req, res) => {
  const listingId = parseId(req.params.listingId);
  if (listingId === null) {
    return res.status(400).json({ error: 'listingId must be a non-negative integer.' });
  }

  try {
    const { rowCount } = await query(
      `DELETE FROM portfolio_watchlist WHERE user_id = $1 AND listing_id = $2`,
      [req.user.id, listingId]
    );
    if (!rowCount) {
      return res.status(404).json({ error: 'Item not found in watchlist.' });
    }
    res.json({ message: 'Removed from watchlist.' });
  } catch (e) {
    console.error('[watchlist/DELETE]', e.message);
    res.status(500).json({ error: 'Failed to remove from watchlist.' });
  }
});

module.exports = router;