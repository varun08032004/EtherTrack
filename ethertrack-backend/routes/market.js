// routes/market.js — Public market listings endpoint
// No authentication required — market is universal and visible to all users
const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');

// ── GET /api/market/listings ──────────────────────────────────────
// Returns only credits that are ACTIVELY LISTED on the marketplace
// listing_id_onchain IS NOT NULL means the seller has called listCredit()
// on the smart contract — these are the only ones visible in the market.
// Tokenised but unlisted credits (in portfolio but not listed) are excluded.
// This is a PUBLIC endpoint — no wallet or KYC required.
router.get('/listings', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         cb.id,
         cb.project_name,
         cb.project_location,
         cb.standard,
         cb.project_type,
         cb.developer,
         cb.vintage_year,
         cb.registry_serial,
         cb.available_credits,
         cb.price_per_credit_inr,
         cb.last_traded_price_inr,
         cb.token_id,
         cb.listing_id_onchain,
         cb.updated_at,
         u.wallet_address AS seller_wallet
       FROM carbon_batches cb
       JOIN users u ON u.id = cb.user_id
       WHERE cb.admin_status = 'approved'
         AND cb.available_credits > 0
         AND cb.listing_id_onchain IS NOT NULL
       ORDER BY cb.updated_at DESC
       LIMIT 100`,
      []
    );

    res.json({ listings: rows, count: rows.length });
  } catch (e) {
    console.error('Market listings error:', e);
    res.status(500).json({ error: 'Failed to fetch listings' });
  }
});

// ── GET /api/market/stats ─────────────────────────────────────────
// Public market stats — no auth needed
router.get('/stats', async (req, res) => {
  try {
    const [volume, count, listings] = await Promise.all([
      query(`SELECT COALESCE(SUM(subtotal_inr), 0) AS total FROM trades WHERE status = 'completed'`),
      query(`SELECT COUNT(*) FROM trades WHERE status = 'completed'`),
      query(`SELECT COUNT(*) FROM carbon_batches WHERE admin_status = 'approved' AND available_credits > 0 AND listing_id_onchain IS NOT NULL`),
    ]);

    res.json({
      totalVolumeINR: parseFloat(volume.rows[0].total),
      totalTrades:    parseInt(count.rows[0].count),
      activeListings: parseInt(listings.rows[0].count),
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch market stats' });
  }
});

module.exports = router;