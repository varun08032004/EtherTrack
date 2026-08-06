'use strict';
// services/coupons.js
//
// Coupon codes are managed from the ERP (etpl_ops) Product/Sales section —
// see routes/opsIntegrationCoupons.js for the write surface that pushes new
// codes here, and routes/subscription.js for where a code gets applied at
// checkout. EARLYBIRD50 (flat 50% off, Starter/Growth, annual only, once
// per account, first paid subscription only) is seeded by the migration in
// db/manual-migrations/2026-07-29-pricing-coupons-corporate.sql — everything
// else works the same way for any coupon the ERP creates later.
//
// Deliberately excludes Corporate: applicable_plans on a coupon can never
// include 'corporate' (enforced both at the DB default and re-checked here)
// since Corporate is sold and priced manually, never through a checkout
// discount code.

const { safeQuery: query } = require('../db/pool');

// validateCoupon — read-only check, doesn't record anything. Returns
// { valid: true, coupon } or { valid: false, reason }.
async function validateCoupon(code, { userId, plan, cycle }) {
  if (!code) return { valid: false, reason: 'No coupon code provided' };
  const normalized = String(code).trim().toUpperCase();

  const { rows } = await query(`SELECT * FROM coupons WHERE code = $1`, [normalized]);
  const coupon = rows[0];
  if (!coupon) return { valid: false, reason: 'Invalid coupon code' };
  if (!coupon.active) return { valid: false, reason: 'This coupon is no longer active' };
  if (coupon.valid_from && new Date(coupon.valid_from) > new Date())
    return { valid: false, reason: 'This coupon is not active yet' };
  if (coupon.valid_until && new Date(coupon.valid_until) < new Date())
    return { valid: false, reason: 'This coupon has expired' };

  if (plan === 'corporate' || !coupon.applicable_plans.includes(plan))
    return { valid: false, reason: `${normalized} isn't valid for this plan` };
  if (!coupon.applicable_cycles.includes(cycle))
    return { valid: false, reason: `${normalized} only applies to the ${coupon.applicable_cycles.join('/')} billing cycle` };

  if (coupon.max_redemptions != null) {
    const { rows: [{ count }] } = await query(`SELECT COUNT(*)::int FROM coupon_redemptions WHERE coupon_id = $1`, [coupon.id]);
    if (count >= coupon.max_redemptions)
      return { valid: false, reason: 'This coupon has reached its usage limit' };
  }

  const { rows: [{ count: userUses }] } = await query(
    `SELECT COUNT(*)::int FROM coupon_redemptions WHERE coupon_id = $1 AND user_id = $2`,
    [coupon.id, userId]
  );
  if (userUses >= coupon.per_user_limit)
    return { valid: false, reason: 'You have already used this coupon' };

  if (coupon.first_time_only) {
    // "First paid subscription ever" — any prior successful, non-free payment
    // disqualifies them, matching the GTM intent (EARLYBIRD50 is a
    // new-customer-only offer, not a renewal discount).
    const { rows: [{ count: priorPaid }] } = await query(
      `SELECT COUNT(*)::int FROM subscription_payments WHERE user_id = $1 AND status = 'success'`,
      [userId]
    );
    if (priorPaid > 0)
      return { valid: false, reason: `${normalized} is only valid on your first subscription` };
  }

  return { valid: true, coupon };
}

// computeDiscount — pure math, given a validated coupon and the base price.
function computeDiscount(coupon, basePricePaise) {
  if (coupon.discount_type === 'percent') {
    return Math.round((basePricePaise * Number(coupon.discount_value)) / 100);
  }
  // 'flat' — discount_value is stored directly in paise
  return Math.min(Math.round(Number(coupon.discount_value)), basePricePaise);
}

// recordRedemption — called once payment actually succeeds (not at order
// creation), so an abandoned checkout never burns a user's one-time use.
async function recordRedemption({ couponId, userId, subscriptionPaymentId, discountPaise }) {
  await query(
    `INSERT INTO coupon_redemptions (coupon_id, user_id, subscription_payment_id, discount_paise)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (coupon_id, user_id) DO NOTHING`,
    [couponId, userId, subscriptionPaymentId, discountPaise]
  );
}

module.exports = { validateCoupon, computeDiscount, recordRedemption };