// __tests__/services/coupons.test.js — Coupon service tests
// Note: COUPONS are stored in the database, not exported as a constant.
// validateCoupon and computeDiscount require database access.

describe('Coupon Service', () => {
  test('module exports expected functions', () => {
    const coupons = require('../../services/coupons');
    expect(coupons).toHaveProperty('validateCoupon');
    expect(coupons).toHaveProperty('computeDiscount');
    expect(coupons).toHaveProperty('recordRedemption');
    expect(typeof coupons.validateCoupon).toBe('function');
    expect(typeof coupons.computeDiscount).toBe('function');
    expect(typeof coupons.recordRedemption).toBe('function');
  });
});