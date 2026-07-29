// middleware/planGate.js — EtherTrack Subscription Plan Enforcement
// ─────────────────────────────────────────────────────────────────
// Enforces subscription tier on backend routes.
// Mirrors the frontend PlanGate component but cannot be bypassed.
//
// TIER ORDER: free < starter < growth < corporate
//
// USAGE:
//   const { requirePlan } = require('../middleware/planGate');
//
//   // Emissions routes — Growth+
//   router.post('/log',    authenticate, requirePlan('growth'),    handler);
//   router.get('/summary', authenticate, requirePlan('growth'),    handler);
//
//   // Report routes — Growth+ for GHG, Corporate for BRSR/CDP/TCFD
//   router.post('/ghg-pdf',  authenticate, requirePlan('growth'),    handler);
//   router.post('/brsr-pdf', authenticate, requirePlan('corporate'), handler);
//   router.post('/cdp-pdf',  authenticate, requirePlan('corporate'), handler);
//   router.post('/tcfd-pdf', authenticate, requirePlan('corporate'), handler);
//
//   // Audit trail — Corporate only
//   router.get('/audit',   authenticate, requirePlan('corporate'), handler);
// ─────────────────────────────────────────────────────────────────
'use strict';

// Tier rank — higher = more access
const TIER_RANK = {
  free:      0,
  starter:   1,
  growth:    2,
  corporate: 3,
  enterprise: 4, // treated same as corporate for access purposes
};

// Human-readable plan info for error messages
const PLAN_INFO = {
  starter: {
    name:     'Starter',
    price:    '₹1,000/mo',
    features: ['Portfolio management', 'Sell carbon credits', '3 seats'],
  },
  growth: {
    name:     'Growth',
    price:    '₹10,000/mo',
    features: ['Scope 1, 2 & 3 emissions tracking', 'GHG inventory ledger', 'Analytics dashboard', 'GHG Protocol PDF report', '10 seats'],
  },
  corporate: {
    name:     'Corporate',
    price:    'Contact Sales',
    features: ['BRSR / CDP / TCFD reports', 'Audit trail + verifier', 'GEI / PAT / CCTS compliance', 'Multi-entity + supplier portal'],
  },
};

/**
 * getTierRank — normalises plan string to rank
 * Handles null, undefined, and variant names gracefully
 */
function getTierRank(plan) {
  if (!plan) return 0;
  const p = plan.toLowerCase().trim();
  if (p.includes('corporate') || p.includes('enterprise')) return 3;
  if (p.includes('growth'))    return 2;
  if (p.includes('starter'))   return 1;
  return 0;
}

/**
 * requirePlan(minPlan) — middleware factory
 *
 * Reads subscription_plan from req.user (set by authenticate middleware).
 * Returns 403 with a structured error if user's plan is below minPlan.
 *
 * Always run AFTER authenticate middleware.
 *
 * @param {string} minPlan - 'starter' | 'growth' | 'corporate'
 */
const requirePlan = (minPlan) => (req, res, next) => {
  // Platform admins bypass all plan checks
  if (req.user?.role === 'admin') return next();

  // [EXPIRY-FIX] A paid plan whose subscription_renewal_date has passed is
  // treated as 'free' for gating purposes — REGARDLESS of what's still
  // sitting in subscription_plan. Previously this middleware only looked at
  // subscription_plan, so a user (corporate especially, since corporate was
  // also excluded from the auto-downgrade cron) kept full access forever
  // once expired, until/unless a separate cron happened to run and flip the
  // DB column. Checking the date here makes enforcement immediate and
  // correct even if the cron hasn't run yet, is delayed, or is disabled.
  const renewalDate = req.user?.subscription_renewal_date
    ? new Date(req.user.subscription_renewal_date)
    : null;
  const isExpired = renewalDate && renewalDate.getTime() < Date.now();

  const userPlan    = isExpired ? 'free' : (req.user?.subscription_plan || 'free');
  const userRank    = getTierRank(userPlan);
  const requiredRank = TIER_RANK[minPlan] ?? 0;

  if (userRank >= requiredRank) return next();

  const info = PLAN_INFO[minPlan] || {};
  const isCorporate = minPlan === 'corporate';

  return res.status(403).json({
    error:        isExpired ? `Your ${info.name || minPlan} plan has expired` : `${info.name || minPlan} plan required`,
    code:         isExpired ? 'PLAN_EXPIRED' : 'PLAN_REQUIRED',
    requiredPlan: minPlan,
    yourPlan:     userPlan,
    expired:      !!isExpired,
    upgrade: isCorporate
      ? { action: 'contact_sales', email: 'sales@ethertrack.in' }
      : { action: 'upgrade', url: '/billing', price: info.price },
    features: info.features || [],
  });
};

/**
 * requirePlanForReport(reportType) — convenience wrapper for PDF report routes
 *
 * Report gating:
 *   ghg    → growth+
 *   brsr   → corporate
 *   cdp    → corporate
 *   tcfd   → corporate
 */
const requirePlanForReport = (reportType) => {
  const planMap = {
    ghg:  'growth',
    brsr: 'corporate',
    cdp:  'corporate',
    tcfd: 'corporate',
  };
  const required = planMap[reportType?.toLowerCase()];
  if (!required) {
    return (req, res, next) => next(); // unknown report type — don't block
  }
  return requirePlan(required);
};

/**
 * checkPlan(userPlan, minPlan, renewalDate?) — programmatic check (no middleware)
 * Use in service functions where you need a boolean check.
 * Pass renewalDate (optional) so an expired paid plan is treated as 'free',
 * same [EXPIRY-FIX] logic as requirePlan above.
 */
const checkPlan = (userPlan, minPlan, renewalDate = null) => {
  const isExpired = renewalDate && new Date(renewalDate).getTime() < Date.now();
  const effectivePlan = isExpired ? 'free' : userPlan;
  return getTierRank(effectivePlan) >= (TIER_RANK[minPlan] ?? 0);
};

module.exports = { requirePlan, requirePlanForReport, checkPlan, getTierRank };