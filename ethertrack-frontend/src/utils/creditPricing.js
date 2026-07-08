// utils/creditPricing.js
//
// Shared, real supply/demand pricing engine for carbon credits.
//
// WHY THIS FILE EXISTS:
// Previously `getReferencePrice()` lived as two separate, drifting copies
// (one in PortfolioContext's `stats`, one in PortfolioV3.jsx) and was a pure
// static lookup table — a project type showed the exact same "value"
// whether it had never traded once or was being actively bid up. This file
// replaces that with getMarketPrice(), which prices each (projectType,
// standard) bucket from LIVE listings / trades / buy-orders, and only falls
// back to the static table when a bucket has genuinely never traded.
//
// EVERY screen (Dashboard stats, PortfolioV3 stats/cards/sorting, market
// listing cards) must call getMarketPrice() with the SAME `marketBuckets`
// snapshot (built once per render via buildMarketBuckets in
// PortfolioContext and exposed through usePortfolio()). Never re-derive
// price locally again, or the numbers will silently drift apart like
// PORTFOLIO VALUE did before.

const safeNum = (v, fallback = 0) => {
  const n = Number(v);
  return isNaN(n) || !isFinite(n) ? fallback : n;
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── Quality anchors ────────────────────────────────────────────────────
// NOT a market price. Used only as (a) a cold-start fallback for buckets
// with zero live market data, and (b) the "premium" multiplier for
// standard/project quality that sits underneath the live demand signal.
export const REFERENCE_PRICES = {
  'Renewable Energy (BEE)'             : 700,
  'Green Hydrogen (BEE)'               : 1400,
  'Industrial Energy Efficiency (BEE)' : 600,
  'Landfill Methane Recovery (BEE)'    : 950,
  'Mangrove Afforestation (BEE)'       : 1800,
  'Renewable Energy with Storage (BEE)': 900,
  'Offshore Wind (BEE)'                : 800,
  'Compressed Biogas (BEE)'            : 750,
  'Renewable Energy'                   : 650,
  'Reforestation'                      : 1200,
  'REDD+'                              : 1100,
  'Avoided Deforestation'              : 1050,
  'Blue Carbon'                        : 2100,
  'Methane Capture'                    : 900,
  'Energy Efficiency'                  : 550,
  'Cookstoves'                         : 750,
  'Soil Carbon'                        : 950,
  'Industrial Gas'                     : 450,
};

export const STANDARD_PREMIUM = { VCS: 1.0, GS: 1.15, CDM: 0.85, ACR: 1.05, BEE: 1.0 };

// India CCTS is a regulated compliance market, not free-floating voluntary —
// clamp compliance credit prices to this band regardless of what the
// demand/supply multiplier alone would produce.
export const INDIA_CCTS_FLOOR   = 600;
export const INDIA_CCTS_CEILING = 1200;

// ── Vintage depreciation ─────────────────────────────────────────────────
// Single source of truth. Re-exported from PortfolioContext for backward
// compatibility with existing `import { vintagePenalty } from
// '../context/PortfolioContext'` call sites — do not duplicate this
// function anywhere else.
export const vintagePenalty = (year) => {
  const age = new Date().getFullYear() - Number(year);
  if (age <= 1) return 0;
  if (age <= 2) return 3;
  if (age <= 3) return 8;
  if (age <= 4) return 15;
  return 25;
};

// ── Tuning knobs ─────────────────────────────────────────────────────────
const TRADE_LOOKBACK_DAYS   = 30;   // ignore trades older than this for price discovery
const TRADE_HALF_LIFE_DAYS  = 7;    // recency decay — a trade from today matters
                                     // ~2x more than one from 7 days ago
const MAX_DEMAND_PREMIUM    = 0.50; // demand can push price up at most +50%
const MAX_SUPPLY_DISCOUNT   = 0.35; // oversupply can push price down at most -35%
const IMBALANCE_SENSITIVITY = 0.25; // how aggressively the imbalance ratio moves price

// Minimum total activity (supply + demand qty) a bucket needs before the
// imbalance multiplier is allowed to move the price at all. Without this,
// a thin bucket with e.g. 2 credits listed and 1 buy order for 3 credits
// would swing straight to the +50% cap on almost no real signal. Below
// this threshold we still show the trade-price / static baseline, just
// with multiplier locked at 1 (no demand/supply adjustment yet).
const MIN_BUCKET_QTY_FOR_IMBALANCE = 25;

// Demand/supply ratio thresholds for the UI badge (getDemandSupplyBadge).
const BADGE_THRESHOLDS = {
  highDemand : 1.4,  // demandQty / supplyQty >= this → "high demand"
  oversupply : 0.5,  // demandQty / supplyQty <= this → "oversupplied"
};

const bucketKey = (projectType, standard) => `${projectType || '?'}||${standard || '?'}`;

// ── Build tokenId → {projectType, standard, vintageYear} lookup ──────────
// Sourced from anything that carries full metadata: all active listings
// (any seller, not just the current user), plus the current user's own
// owned/bought credits. A token that's never been listed by anyone and
// isn't owned/bought by this user won't resolve — its trades/buy-orders
// simply won't count toward that bucket's demand/trade signal. Acceptable
// gap for a client-side v1; a backend aggregate endpoint would close it.
export function buildTokenMetaMap({ listings = [], myCredits = [], myBoughtCredits = [] }) {
  const map = new Map();
  const add = (tokenId, meta) => {
    if (tokenId == null) return;
    if (!map.has(tokenId)) map.set(tokenId, meta);
  };
  listings.forEach(l => add(l.tokenId, { projectType: l.projectType, standard: l.standard, vintageYear: l.vintageYear }));
  myCredits.forEach(c => add(c.tokenId, { projectType: c.projectType, standard: c.standard, vintageYear: c.vintageYear }));
  myBoughtCredits.forEach(c => add(c.tokenId, { projectType: c.projectType, standard: c.standard, vintageYear: c.vintageYear }));
  return map;
}

// ── Build per-bucket market data from live listings/trades/buy-orders ────
// Call this ONCE per render (memoized) in PortfolioContext, and expose the
// result through usePortfolio() so every screen prices off the identical
// snapshot of the market. Never rebuild this locally in a component.
export function buildMarketBuckets({ listings = [], tradeHistory = [], buyOrders = [] }, tokenMetaMap) {
  const buckets = {}; // key -> { supplyQty, demandQty, tradeSamples: [{price, weight}] }
  const ensure = (key) => {
    if (!buckets[key]) buckets[key] = { supplyQty: 0, demandQty: 0, tradeSamples: [] };
    return buckets[key];
  };

  // Supply side — active listings carry full metadata directly.
  listings.forEach(l => {
    if (l.active === false) return;
    const key = bucketKey(l.projectType, l.standard);
    ensure(key).supplyQty += safeNum(l.amount, 0);
  });

  // Demand side — buy orders only carry tokenId, resolve via the meta map.
  buyOrders.forEach(o => {
    const meta = tokenMetaMap.get(o.tokenId);
    if (!meta) return; // unresolvable token — skip rather than guess
    const key = bucketKey(meta.projectType, meta.standard);
    ensure(key).demandQty += safeNum(o.remaining ?? o.amount, 0);
  });

  // Price discovery — recent trades, resolved via the same meta map,
  // weighted by recency (exponential decay). Requires `rawCreatedAt` (ISO
  // timestamp) on trade rows — see normaliseTradeRow in PortfolioContext.
  const now = Date.now();
  const lookbackMs = TRADE_LOOKBACK_DAYS * 86400000;
  tradeHistory.forEach(t => {
    const meta = tokenMetaMap.get(t.tokenId);
    if (!meta) return;
    const price = safeNum(t.priceINR ?? t.price_per_credit_inr, 0);
    if (price <= 0) return;

    const tradeTimeMs = t.rawCreatedAt ? new Date(t.rawCreatedAt).getTime() : now;
    const ageMs = now - tradeTimeMs;
    if (ageMs > lookbackMs || ageMs < 0) return;

    const halfLifeMs = TRADE_HALF_LIFE_DAYS * 86400000;
    const weight = Math.pow(0.5, ageMs / halfLifeMs);

    const key = bucketKey(meta.projectType, meta.standard);
    ensure(key).tradeSamples.push({ price, weight });
  });

  return buckets;
}

// ── Get the live market price for a given credit's bucket ────────────────
// Falls back gracefully: recent trades > static table (as baseline), then
// applies the supply/demand imbalance multiplier (only once the bucket has
// enough volume to trust), vintage depreciation, and — for compliance
// credits — the regulated CCTS band clamp.
//
// Returns { price, hasLiveSignal } — hasLiveSignal is true when the price
// is backed by real trades, so UI can optionally show "LIVE" vs "EST."
export function getMarketPrice(projectType, standard, vintageYear, creditType, marketBuckets) {
  const key    = bucketKey(projectType, standard);
  const bucket = marketBuckets?.[key];

  const staticBase = (REFERENCE_PRICES[projectType] || 850) * (STANDARD_PREMIUM[standard] || 1.0);

  let baseline;
  let hasLiveSignal = false;

  if (bucket?.tradeSamples?.length) {
    // Recency-weighted average trade price — the strongest signal.
    const totalWeight = bucket.tradeSamples.reduce((s, x) => s + x.weight, 0);
    baseline = bucket.tradeSamples.reduce((s, x) => s + x.price * x.weight, 0) / totalWeight;
    hasLiveSignal = true;
  } else {
    // No trades yet for this bucket — anchor on the static quality table.
    // (Aggregate listing qty alone doesn't give us an ask price here; the
    // imbalance multiplier below still reacts to listing/buy-order volume.)
    baseline = staticBase;
  }

  // Supply/demand imbalance multiplier — gated by a minimum sample size so
  // a thin bucket (e.g. 2 listed, 1 buy order) doesn't whipsaw straight to
  // the cap on noise.
  let multiplier = 1;
  if (bucket) {
    const totalQty = bucket.supplyQty + bucket.demandQty;
    if (totalQty >= MIN_BUCKET_QTY_FOR_IMBALANCE) {
      const supply = Math.max(bucket.supplyQty, 1); // avoid divide-by-zero
      const ratio  = bucket.demandQty / supply;       // >1 = more demand than supply
      multiplier = 1 + clamp((ratio - 1) * IMBALANCE_SENSITIVITY, -MAX_SUPPLY_DISCOUNT, MAX_DEMAND_PREMIUM);
    }
  }

  let price = baseline * multiplier;

  // Vintage depreciation — a quality decay, applied after market pricing.
  const dep = vintagePenalty(vintageYear) / 100;
  price = price * (1 - dep);

  // Compliance credits (India CCTS) are a regulated band, not free-floating.
  if (creditType === 'compliance') {
    price = clamp(price, INDIA_CCTS_FLOOR, INDIA_CCTS_CEILING);
  }

  return { price: Math.round(price), hasLiveSignal };
}

// ── Backward-compatible plain-number wrapper ──────────────────────────────
// For call sites that just want a number (e.g. sort comparators, quick
// display) and don't need the hasLiveSignal flag. Prefer getMarketPrice()
// directly wherever you can, since it's the same cost either way.
export function getReferencePrice(projectType, standard, vintageYear, creditType, marketBuckets) {
  return getMarketPrice(projectType, standard, vintageYear, creditType, marketBuckets).price;
}

// ── Demand/supply badge for listing / portfolio cards ─────────────────────
// Reads the SAME marketBuckets used for pricing, so the badge and the price
// number are always telling the same story. Returns null when there isn't
// enough data yet to say anything meaningful (no guessing).
export function getDemandSupplyBadge(projectType, standard, marketBuckets) {
  const key    = bucketKey(projectType, standard);
  const bucket = marketBuckets?.[key];

  if (!bucket || (bucket.supplyQty === 0 && bucket.demandQty === 0)) {
    return null;
  }
  if (bucket.supplyQty + bucket.demandQty < MIN_BUCKET_QTY_FOR_IMBALANCE) {
    return null; // not enough volume to label with confidence
  }

  const supply = Math.max(bucket.supplyQty, 1);
  const ratio  = bucket.demandQty / supply;

  if (bucket.demandQty > 0 && ratio >= BADGE_THRESHOLDS.highDemand) {
    return { label: '🔥 HIGH DEMAND', color: '#f97316', bg: '#1a0a00', border: '#f9731633' };
  }
  if (bucket.supplyQty > 0 && ratio <= BADGE_THRESHOLDS.oversupply) {
    return { label: '📉 OVERSUPPLIED', color: '#60a5fa', bg: '#0a1628', border: '#60a5fa33' };
  }
  return { label: '● BALANCED', color: '#22c55e', bg: '#0d2e1f', border: '#22c55e33' };
}