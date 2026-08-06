'use strict';
// routes/opsIntegrationCoupons.js
//
// WRITE surface for the ERP (etpl_ops) Product/Sales section to create and
// manage coupon codes — same isolation pattern as
// routes/opsIntegrationCorporate.js: its own route file, its own env-var
// token (PLATFORM_SYNC_COUPON_WRITE_TOKEN), so it can't be reached with the
// read-only sync token or the corporate-write token.
//
// Coupons here can only ever target Starter/Growth — Corporate is excluded
// both by the DB default on coupons.applicable_plans and re-checked at
// creation time below, since Corporate pricing is always a manual sales
// negotiation, never a checkout discount code.

const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { requireServiceTokenFor } = require('../middleware/serviceAuth');
const { safeQuery: query } = require('../db/pool');

const couponOpsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — slow down' },
});

router.use(couponOpsLimiter);
router.use(requireServiceTokenFor('PLATFORM_SYNC_COUPON_WRITE_TOKEN'));

router.use((req, res, next) => {
  console.log(`[ops-integration-coupons] ${req.method} ${req.originalUrl} — service call authorized`);
  next();
});

const VALID_PLANS_FOR_COUPONS = ['starter', 'growth']; // never 'corporate'
const VALID_CYCLES = ['monthly', 'annual'];

// POST /api/ops-integration-coupons
// body: { code, discountType, discountValue, applicablePlans, applicableCycles,
//         firstTimeOnly, perUserLimit, maxRedemptions, validFrom, validUntil, createdBy }
router.post('/', async (req, res) => {
  try {
    const {
      code, discountType = 'percent', discountValue,
      applicablePlans = ['starter', 'growth'],
      applicableCycles = ['annual'],
      firstTimeOnly = true, perUserLimit = 1, maxRedemptions = null,
      validFrom = null, validUntil = null, createdBy = null,
    } = req.body;

    if (!code || typeof code !== 'string' || !code.trim())
      return res.status(400).json({ error: 'code is required' });
    if (!['percent', 'flat'].includes(discountType))
      return res.status(400).json({ error: "discountType must be 'percent' or 'flat'" });
    if (discountValue == null || isNaN(discountValue) || Number(discountValue) <= 0)
      return res.status(400).json({ error: 'discountValue must be a positive number' });
    if (discountType === 'percent' && Number(discountValue) > 100)
      return res.status(400).json({ error: 'A percent discount cannot exceed 100' });

    const plans = (Array.isArray(applicablePlans) ? applicablePlans : [applicablePlans])
      .filter(p => VALID_PLANS_FOR_COUPONS.includes(p));
    if (!plans.length)
      return res.status(400).json({ error: 'applicablePlans must include at least one of: starter, growth (never corporate)' });

    const cycles = (Array.isArray(applicableCycles) ? applicableCycles : [applicableCycles])
      .filter(c => VALID_CYCLES.includes(c));
    if (!cycles.length)
      return res.status(400).json({ error: 'applicableCycles must include at least one of: monthly, annual' });

    const normalizedCode = code.trim().toUpperCase();

    const { rows: [coupon] } = await query(
      `INSERT INTO coupons
         (code, discount_type, discount_value, applicable_plans, applicable_cycles,
          first_time_only, per_user_limit, max_redemptions, valid_from, valid_until, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,NOW()),$10,$11)
       RETURNING *`,
      [
        normalizedCode, discountType, discountValue, plans, cycles,
        !!firstTimeOnly, perUserLimit || 1, maxRedemptions || null,
        validFrom, validUntil, createdBy,
      ]
    );

    res.status(201).json({ ok: true, coupon });
  } catch (e) {
    if (e.code === '23505') // unique_violation on code
      return res.status(409).json({ error: 'A coupon with that code already exists' });
    console.error('[ops-integration-coupons:create]', e.message);
    res.status(500).json({ error: 'Failed to create coupon' });
  }
});

// GET /api/ops-integration-coupons — list all coupons with redemption counts
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT c.*,
              COUNT(r.id)::int AS redemption_count,
              COALESCE(SUM(r.discount_paise), 0)::bigint AS total_discount_paise
       FROM coupons c
       LEFT JOIN coupon_redemptions r ON r.coupon_id = c.id
       GROUP BY c.id
       ORDER BY c.created_at DESC`
    );
    res.json({ coupons: rows });
  } catch (e) {
    console.error('[ops-integration-coupons:list]', e.message);
    res.status(500).json({ error: 'Failed to fetch coupons' });
  }
});

// PATCH /api/ops-integration-coupons/:code
// body: { active?, validUntil?, maxRedemptions? } — for toggling off / adjusting
// an existing coupon. To change the discount amount, deactivate and create a
// new code instead — keeps the redemption history unambiguous per code.
router.patch('/:code', async (req, res) => {
  const code = String(req.params.code).trim().toUpperCase();
  const { active, validUntil, maxRedemptions } = req.body;
  try {
    const { rows: [existing] } = await query(`SELECT id FROM coupons WHERE code = $1`, [code]);
    if (!existing) return res.status(404).json({ error: 'Coupon not found' });

    const sets = [];
    const vals = [];
    if (active != null)         { vals.push(!!active);          sets.push(`active = $${vals.length}`); }
    if (validUntil !== undefined) { vals.push(validUntil || null); sets.push(`valid_until = $${vals.length}`); }
    if (maxRedemptions !== undefined) { vals.push(maxRedemptions || null); sets.push(`max_redemptions = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    sets.push(`updated_at = NOW()`);
    vals.push(code);
    const { rows: [updated] } = await query(
      `UPDATE coupons SET ${sets.join(', ')} WHERE code = $${vals.length} RETURNING *`,
      vals
    );
    res.json({ ok: true, coupon: updated });
  } catch (e) {
    console.error('[ops-integration-coupons:patch]', e.message);
    res.status(500).json({ error: 'Failed to update coupon' });
  }
});

module.exports = router;