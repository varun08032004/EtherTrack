'use strict';
// services/pricing.js
//
// Prices used to be hardcoded paise values in routes/subscription.js's
// PLAN_CONFIG. That's now the FALLBACK only — the ERP (etpl_ops) Product/
// Sales section is the source of truth once it has pushed a price for a
// given (plan, cycle), via PATCH /api/ops-integration-pricing/:plan/:cycle
// (see routes/opsIntegrationPricing.js). Nothing breaks if the ERP hasn't
// pushed anything yet for a given tier — it just keeps using the hardcoded
// default from PLAN_CONFIG until it does.
//
// Corporate is intentionally excluded here — Corporate has never had a
// fixed self-serve price (PLAN_CONFIG.corporate.*_paise is already null,
// "Contact Sales"), and that doesn't change: Corporate pricing is per-deal,
// negotiated by sales and set directly on the user's account via
// activate-corporate / opsIntegrationCorporate.js, never through this table.

const { safeQuery: query } = require('../db/pool');

// Small in-process cache (60s) so a hot checkout path isn't doing a DB
// round-trip on every single price lookup — prices change rarely (an ERP
// push), so a short cache is a fine tradeoff. Cleared automatically on
// expiry; also bypassed entirely by clearPricingCache() right after an ERP
// push so the new price is visible immediately rather than up to 60s late.
let cache = null;       // Map<"plan:cycle", price_paise>
let cacheAt = 0;
const CACHE_MS = 60 * 1000;

async function loadPrices() {
  const { rows } = await query(`SELECT plan, cycle, price_paise FROM plan_prices`);
  const map = new Map();
  for (const r of rows) map.set(`${r.plan}:${r.cycle}`, Number(r.price_paise));
  return map;
}

async function getOverridesMap() {
  if (cache && Date.now() - cacheAt < CACHE_MS) return cache;
  try {
    cache = await loadPrices();
    cacheAt = Date.now();
  } catch (e) {
    console.warn('[pricing] failed to load plan_prices, using hardcoded defaults:', e.message);
    if (!cache) cache = new Map(); // first-ever call failing — fall through to defaults below rather than throw
  }
  return cache;
}

function clearPricingCache() {
  cache = null;
  cacheAt = 0;
}

// getEffectivePricePaise(plan, cycle, PLAN_CONFIG) — PLAN_CONFIG is passed in
// (rather than required here) to avoid a circular require with
// routes/subscription.js, which already owns that object.
async function getEffectivePricePaise(plan, cycle, PLAN_CONFIG) {
  const cfg = PLAN_CONFIG[plan];
  if (!cfg) return null;
  if (plan === 'corporate') return null; // never dynamically priced — always "Contact Sales"

  const overrides = await getOverridesMap();
  const override = overrides.get(`${plan}:${cycle}`);
  if (override !== undefined) return override;

  return cycle === 'annual' ? cfg.annual_paise : cfg.monthly_paise;
}

// getAllEffectivePrices(PLAN_CONFIG) — used by GET /api/subscription/prices
// so the pricing page always reflects whatever the ERP has pushed.
async function getAllEffectivePrices(PLAN_CONFIG) {
  const overrides = await getOverridesMap();
  const out = {};
  for (const [key, cfg] of Object.entries(PLAN_CONFIG)) {
    if (key === 'corporate') {
      out[key] = { monthly: null, annual: null };
      continue;
    }
    const monthlyOverride = overrides.get(`${key}:monthly`);
    const annualOverride  = overrides.get(`${key}:annual`);
    out[key] = {
      monthly: (monthlyOverride !== undefined ? monthlyOverride : cfg.monthly_paise) / 100,
      annual:  (annualOverride  !== undefined ? annualOverride  : cfg.annual_paise)  / 100,
    };
  }
  return out;
}

// setPrice — called by routes/opsIntegrationPricing.js when the ERP pushes
// an update. Upserts and immediately busts the cache.
async function setPrice(plan, cycle, pricePaise, { updatedBy = null, updatedFrom = 'erp' } = {}) {
  await query(
    `INSERT INTO plan_prices (plan, cycle, price_paise, updated_by, updated_from, updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (plan, cycle) DO UPDATE SET
       price_paise = EXCLUDED.price_paise,
       updated_by = EXCLUDED.updated_by,
       updated_from = EXCLUDED.updated_from,
       updated_at = NOW()`,
    [plan, cycle, pricePaise, updatedBy, updatedFrom]
  );
  clearPricingCache();
}

async function listPrices() {
  const { rows } = await query(`SELECT plan, cycle, price_paise, updated_by, updated_from, updated_at FROM plan_prices ORDER BY plan, cycle`);
  return rows;
}

module.exports = {
  getEffectivePricePaise, getAllEffectivePrices,
  setPrice, listPrices, clearPricingCache,
};