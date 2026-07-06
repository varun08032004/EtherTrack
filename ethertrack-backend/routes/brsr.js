'use strict';
/**
 * routes/brsr.js — EtherTrack SEBI BRSR Core + ESG Summary
 * ─────────────────────────────────────────────────────────────────────────────
 * EXISTING ROUTES (unchanged):
 *   GET  /api/brsr/environmental        — fetch saved data
 *   POST /api/brsr/environmental        — save energy/water/waste data
 *   GET  /api/brsr/summary              — completeness + KPIs
 *
 * NEW ROUTES ADDED:
 *   GET  /api/brsr/auto-populate/:year  — pre-fill BRSR from trades + emissions
 *   GET  /api/brsr/esg-summary/:year    — full CFO dashboard (trades + emissions
 *                                         + BRSR + retirements in one response)
 *
 * DB tables confirmed in Supabase:
 *   brsr_environmental  ✅ (id, user_id, year, energy, water, waste, created_at, updated_at)
 *   emission_activities ✅ (id, user_id, date, scope, co2e, org_id, ...)
 *   retirements         ✅ (id, retired_by, amount, retire_year, retire_scope, ...)
 *   trades              ✅ (buyer_id, quantity, buyer_pays_inr, status, created_at, ...)
 *   pat_profiles        ❌ not in DB — ESG summary skips gracefully
 *   ccts_profiles       ❌ not in DB — ESG summary skips gracefully
 */

const router = require('express').Router();
const { safeQuery: query, withTransaction } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const crypto = require('crypto');

// ── Rate limiter (in-memory, replace with Redis for multi-instance) ───────────
const saveRateLimiter = (() => {
  const map = new Map();
  const WINDOW_MS = 60_000;
  const MAX_SAVES = 10;
  return (userId) => {
    const now   = Date.now();
    const entry = map.get(userId);
    if (!entry || now > entry.resetAt) {
      map.set(userId, { count: 1, resetAt: now + WINDOW_MS });
      return false;
    }
    if (entry.count >= MAX_SAVES) return true;
    entry.count++;
    return false;
  };
})();

// ── Helpers ───────────────────────────────────────────────────────────────────
const sanitiseText = (val, maxLen = 500) =>
  String(val || '').replace(/<[^>]*>/g, '').replace(/['"`;\\]/g, '').trim().slice(0, maxLen);

const safeYear = (val, fallback = null) => {
  const n = parseInt(val, 10);
  if (!Number.isFinite(n) || n < 2000 || n > 2100) return fallback;
  return n;
};

const safeFloat = (val, min = 0, max = 1e12) => {
  if (val === null || val === undefined) return null;
  const n = parseFloat(val);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

const isPureObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const dbErr = (res, context = 'Operation', err = null) => {
  if (err) console.error(`[BRSR] ${context} error:`, err.message);
  const msg = process.env.NODE_ENV !== 'production'
    ? `${context} failed: ${err?.message || 'unknown error'}`
    : 'An error occurred. Please try again.';
  return res.status(500).json({ error: msg });
};

// ── Hash-chained audit entry ──────────────────────────────────────────────────
const sha256 = (str) => crypto.createHash('sha256').update(str).digest('hex');

const getPrevHash = async (client, userId, year) => {
  const { rows } = await client.query(
    `SELECT hash FROM audit_log
     WHERE user_id = $1 AND year = $2
     ORDER BY created_at DESC LIMIT 1
     FOR UPDATE SKIP LOCKED`,
    [userId, year]
  );
  return rows[0]?.hash || '0'.repeat(64);
};

const insertAuditEntry = async (client, userId, year, action, message, meta = {}) => {
  const prevHash  = await getPrevHash(client, userId, year);
  const ts        = new Date().toISOString();
  const hashInput = JSON.stringify({ userId, year, action, message, meta, ts, prevHash });
  const hash      = sha256(hashInput);
  const { rows } = await client.query(
    `INSERT INTO audit_log
       (user_id, year, action, message, meta, hash, prev_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [userId, year, action, message, JSON.stringify(meta), hash, prevHash, ts]
  );
  return rows[0];
};

// ── Numeric field whitelists ───────────────────────────────────────────────────
const ENERGY_NUMERIC_KEYS = [
  'coal_gj','oil_gj','gas_gj','grid_gj',
  'solar_gj','wind_gj','biomass_gj','hydro_gj','other_ren_gj',
  'prev_total_gj','prev_renewable_gj','prev_intensity_gj_cr',
  'total_gj','renewable_gj','intensity_gj_cr','intensity_gj_ppp_m','ppp_rate',
];
const WATER_NUMERIC_KEYS = [
  'surface_kl','groundwater_kl','thirdparty_kl','seawater_kl',
  'rainwater_kl','municipal_kl','consumption_kl','recycled_kl','intensity_kl_cr',
  'prev_withdrawal_kl','prev_consumption_kl','withdrawal_kl','intensity_kl_ppp_m',
];
const WASTE_NUMERIC_KEYS = [
  'hazardous_kg','ewaste_kg','plastic_kg','biomedical_kg','construction_kg',
  'battery_kg','radioactive_kg','non_hazardous_kg','recycled_kg','landfill_kg',
  'composted_kg','incinerated_kg','coprocessed_kg','prev_total_kg','total_kg',
];

const cleanNumericObj = (obj, numericKeys, maxVal = 1e12) => {
  if (!isPureObject(obj)) return {};
  const clean = {};
  for (const key of numericKeys) clean[key] = safeFloat(obj[key], 0, maxVal);
  for (const key of Object.keys(obj)) {
    if (numericKeys.includes(key) || key === '_meta') continue;
    if (typeof obj[key] === 'string')  { clean[key] = sanitiseText(obj[key], 1000); continue; }
    if (typeof obj[key] === 'boolean') { clean[key] = Boolean(obj[key]);            continue; }
    if (Array.isArray(obj[key])) {
      clean[key] = obj[key].filter(v => typeof v === 'string')
        .map(v => sanitiseText(v, 100)).slice(0, 20);
    }
  }
  return clean;
};

const JSON_SIZE_LIMIT = 10 * 1024;
const checkPayloadSize = (obj, name) => {
  const size = Buffer.byteLength(JSON.stringify(obj), 'utf8');
  if (size > JSON_SIZE_LIMIT) return `${name} payload too large (max 10KB)`;
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/brsr/environmental?year=2025
// ─────────────────────────────────────────────────────────────────────────────
router.get('/environmental', authenticate, async (req, res) => {
  const year = safeYear(req.query.year, new Date().getFullYear());
  if (req.query.year !== undefined && safeYear(req.query.year) === null)
    return res.status(400).json({ error: 'Invalid year — must be 2000–2100' });
  try {
    const { rows } = await query(
      `SELECT id, year, energy, water, waste, updated_at
       FROM brsr_environmental WHERE user_id = $1 AND year = $2`,
      [req.user.id, year]
    );
    res.json({ data: rows[0] || null, year });
  } catch (err) { dbErr(res, 'Fetch BRSR environmental', err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/brsr/environmental
// ─────────────────────────────────────────────────────────────────────────────
router.post('/environmental', authenticate, async (req, res) => {
  if (saveRateLimiter(req.user.id))
    return res.status(429).json({ error: 'Too many saves — please wait a moment' });

  const year = safeYear(req.body.year, new Date().getFullYear());
  if (req.body.year !== undefined && safeYear(req.body.year) === null)
    return res.status(400).json({ error: 'Invalid year — must be 2000–2100' });

  const rawEnergy = isPureObject(req.body.energy) ? req.body.energy : {};
  const rawWater  = isPureObject(req.body.water)  ? req.body.water  : {};
  const rawWaste  = isPureObject(req.body.waste)  ? req.body.waste  : {};

  const energyClean = cleanNumericObj(rawEnergy, ENERGY_NUMERIC_KEYS);
  const waterClean  = cleanNumericObj(rawWater,  WATER_NUMERIC_KEYS);
  const wasteClean  = cleanNumericObj(rawWaste,  WASTE_NUMERIC_KEYS);

  energyClean._meta = {
    gridEmissionFactor: 0.727,
    gridEFSource:       'CEA V20.0 Dec 2024 (FY 2023-24 weighted average)',
    pppRate:            27.3,
    pppRateSource:      'IMF WEO April 2025',
    reportingStandard:  'SEBI BRSR Core — ISF Dec 2024 circular',
    savedAt:            new Date().toISOString(),
  };

  const sizeErr =
    checkPayloadSize(energyClean, 'energy') ||
    checkPayloadSize(waterClean,  'water')  ||
    checkPayloadSize(wasteClean,  'waste');
  if (sizeErr) return res.status(400).json({ error: sizeErr });

  try {
    const savedRow = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO brsr_environmental
           (user_id, year, energy, water, waste, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id, year) DO UPDATE SET
           energy = EXCLUDED.energy, water = EXCLUDED.water,
           waste  = EXCLUDED.waste,  updated_at = NOW()
         RETURNING id, year, energy, water, waste, updated_at`,
        [req.user.id, year,
         JSON.stringify(energyClean), JSON.stringify(waterClean), JSON.stringify(wasteClean)]
      );

      await insertAuditEntry(client, req.user.id, year, 'UPDATE',
        `BRSR P6 saved — Energy: ${energyClean.total_gj ?? 'not entered'} GJ, ` +
        `Water: ${waterClean.withdrawal_kl ?? 'not entered'} KL, ` +
        `Waste: ${wasteClean.total_kg ?? 'not entered'} kg`,
        {
          has_energy: energyClean.total_gj !== null,
          has_water:  waterClean.withdrawal_kl !== null,
          has_waste:  wasteClean.total_kg !== null,
          energy_is_zero: energyClean.total_gj === 0,
          water_is_zero:  waterClean.withdrawal_kl === 0,
          waste_is_zero:  wasteClean.total_kg === 0,
          grid_ef_used: 0.727,
        }
      );
      return rows[0];
    });
    res.json({ message: 'BRSR environmental data saved', data: savedRow });
  } catch (err) { dbErr(res, 'Save BRSR environmental', err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/brsr/summary?year=2025
// ─────────────────────────────────────────────────────────────────────────────
router.get('/summary', authenticate, async (req, res) => {
  const year = safeYear(req.query.year, new Date().getFullYear());
  if (req.query.year !== undefined && safeYear(req.query.year) === null)
    return res.status(400).json({ error: 'Invalid year — must be 2000–2100' });
  try {
    const { rows } = await query(
      `SELECT
         energy->>'total_gj'      AS total_gj_raw,
         water->>'withdrawal_kl'  AS withdrawal_kl_raw,
         waste->>'total_kg'       AS total_waste_kg_raw,
         (energy->>'total_gj')::numeric          AS total_gj,
         (energy->>'renewable_gj')::numeric       AS renewable_gj,
         (energy->>'intensity_gj_cr')::numeric    AS energy_intensity,
         (energy->>'intensity_gj_ppp_m')::numeric AS energy_intensity_ppp,
         (water->>'withdrawal_kl')::numeric        AS withdrawal_kl,
         (water->>'recycled_kl')::numeric          AS recycled_kl,
         (water->>'intensity_kl_cr')::numeric      AS water_intensity,
         (water->>'intensity_kl_ppp_m')::numeric   AS water_intensity_ppp,
         (waste->>'total_kg')::numeric             AS total_waste_kg,
         (waste->>'hazardous_kg')::numeric         AS hazardous_kg,
         updated_at
       FROM brsr_environmental
       WHERE user_id = $1 AND year = $2`,
      [req.user.id, year]
    );

    if (!rows.length) return res.json({ data: null, year, completeness: 0 });

    const r        = rows[0];
    const hasEnergy = r.total_gj_raw !== null;
    const hasWater  = r.withdrawal_kl_raw !== null;
    const hasWaste  = r.total_waste_kg_raw !== null;
    const completeness = Math.round(
      ([hasEnergy, hasWater, hasWaste].filter(Boolean).length / 3) * 100
    );

    res.json({
      data: r, year, completeness,
      dataStatus: {
        energy: hasEnergy ? (parseFloat(r.total_gj_raw)      === 0 ? 'zero' : 'entered') : 'not_entered',
        water:  hasWater  ? (parseFloat(r.withdrawal_kl_raw) === 0 ? 'zero' : 'entered') : 'not_entered',
        waste:  hasWaste  ? (parseFloat(r.total_waste_kg_raw)=== 0 ? 'zero' : 'entered') : 'not_entered',
      },
    });
  } catch (err) { dbErr(res, 'BRSR summary', err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/brsr/auto-populate/:year
// Pulls actual trade + emission data → returns ready-to-use BRSR P6 values
// Frontend can call this to pre-fill the environmental form automatically
// ─────────────────────────────────────────────────────────────────────────────
router.get('/auto-populate/:year', authenticate, async (req, res) => {
  const year = safeYear(req.params.year);
  if (!year) return res.status(400).json({ error: 'Invalid year' });

  try {
    const [tradeRows, emissionRows, brsrRows] = await Promise.all([

      // Carbon credits bought = voluntary offsets this year
      // Uses confirmed DB: trades.buyer_id, trades.quantity, trades.buyer_pays_inr
      query(
        `SELECT
           COALESCE(SUM(quantity), 0)       AS total_credits,
           COALESCE(SUM(buyer_pays_inr), 0) AS total_spend_inr,
           COUNT(*)                          AS trade_count
         FROM trades
         WHERE buyer_id = $1
           AND status = 'completed'
           AND EXTRACT(YEAR FROM created_at) = $2`,
        [req.user.id, year]
      ),

      // Gross emissions — uses confirmed DB: emission_activities.user_id, scope, co2e, date
      query(
        `SELECT
           COALESCE(SUM(co2e), 0)                           AS total,
           COALESCE(SUM(co2e) FILTER (WHERE scope = 1), 0) AS scope1,
           COALESCE(SUM(co2e) FILTER (WHERE scope = 2), 0) AS scope2,
           COALESCE(SUM(co2e) FILTER (WHERE scope = 3), 0) AS scope3,
           COUNT(*) AS activity_count
         FROM emission_activities
         WHERE user_id = $1
           AND EXTRACT(YEAR FROM date) = $2`,
        [req.user.id, year]
      ),

      // Existing BRSR data for this year — keep energy/water/waste as-is
      query(
        `SELECT energy, water, waste, updated_at
         FROM brsr_environmental
         WHERE user_id = $1 AND year = $2`,
        [req.user.id, year]
      ),
    ]);

    const t  = tradeRows.rows[0];
    const e  = emissionRows.rows[0];
    const existing = brsrRows.rows[0] || null;

    const grossEmissions  = parseFloat(e.total  || 0);
    const offsetPurchased = parseFloat(t.total_credits || 0); // 1 credit = 1 tCO2e
    const netEmissions    = grossEmissions - offsetPurchased;

    res.json({
      year,
      brsr_section:   'Principle 6 — Environment',
      disclosure:     'E1 — GHG Emissions',
      auto_populated: true,
      source:         'EtherTrack Trade History + Emission Activities',

      // GHG data
      gross_emissions_tco2e:   +grossEmissions.toFixed(4),
      scope1_tco2e:            +parseFloat(e.scope1 || 0).toFixed(4),
      scope2_tco2e:            +parseFloat(e.scope2 || 0).toFixed(4),
      scope3_tco2e:            +parseFloat(e.scope3 || 0).toFixed(4),
      activity_count:          parseInt(e.activity_count || 0),

      // Offsets
      offsets_purchased_tco2e: +offsetPurchased.toFixed(4),
      offset_spend_inr:        +parseFloat(t.total_spend_inr || 0).toFixed(2),
      trade_count:             parseInt(t.trade_count || 0),

      // Net
      net_emissions_tco2e:     +netEmissions.toFixed(4),
      carbon_neutral:          netEmissions <= 0,

      // Existing BRSR data so frontend can merge
      existing_brsr: existing,

      // Ready-to-POST values for /api/brsr/environmental
      suggested_form_values: {
        year,
        energy: existing?.energy || {},
        water:  existing?.water  || {},
        waste:  existing?.waste  || {},
        // GHG sub-fields for the BRSR form
        ghg_scope1: +parseFloat(e.scope1 || 0).toFixed(4),
        ghg_scope2: +parseFloat(e.scope2 || 0).toFixed(4),
        ghg_scope3: +parseFloat(e.scope3 || 0).toFixed(4),
        ghg_offset: +offsetPurchased.toFixed(4),
        ghg_net:    +netEmissions.toFixed(4),
      },
    });

  } catch (err) { dbErr(res, 'BRSR auto-populate', err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/brsr/esg-summary/:year
// Full CFO dashboard — trades + emissions + BRSR + retirements in one call
// Gracefully skips pat_profiles / ccts_profiles if tables don't exist
// ─────────────────────────────────────────────────────────────────────────────
router.get('/esg-summary/:year', authenticate, async (req, res) => {
  const year = safeYear(req.params.year);
  if (!year) return res.status(400).json({ error: 'Invalid year' });

  try {
    // Run all queries in parallel, skip tables that may not exist
    const [tradeRows, emissionRows, brsrRows, retirementRows, prevYearRows] =
      await Promise.all([

        // Trades — confirmed columns: buyer_id, quantity, buyer_pays_inr, status, created_at, chain_status
        query(
          `SELECT
             COALESCE(SUM(quantity), 0)       AS offset_tco2e,
             COALESCE(SUM(buyer_pays_inr), 0) AS spend_inr,
             COUNT(*)                          AS trade_count,
             COALESCE(SUM(quantity) FILTER (WHERE chain_status = 'confirmed'), 0) AS on_chain_tco2e
           FROM trades
           WHERE buyer_id = $1
             AND status = 'completed'
             AND EXTRACT(YEAR FROM created_at) = $2`,
          [req.user.id, year]
        ),

        // Emissions — confirmed columns: user_id, date, scope, co2e
        query(
          `SELECT
             COALESCE(SUM(co2e), 0)                           AS total,
             COALESCE(SUM(co2e) FILTER (WHERE scope = 1), 0) AS scope1,
             COALESCE(SUM(co2e) FILTER (WHERE scope = 2), 0) AS scope2,
             COALESCE(SUM(co2e) FILTER (WHERE scope = 3), 0) AS scope3,
             COUNT(*) AS activity_count
           FROM emission_activities
           WHERE user_id = $1
             AND EXTRACT(YEAR FROM date) = $2`,
          [req.user.id, year]
        ),

        // BRSR filed — confirmed columns: user_id, year, updated_at
        query(
          `SELECT updated_at FROM brsr_environmental
           WHERE user_id = $1 AND year = $2`,
          [req.user.id, year]
        ),

        // Retirements — confirmed columns: retired_by, amount, retire_year, retire_scope
        // retire_year exists in DB (confirmed above)
        query(
          `SELECT
             COUNT(*) AS cert_count,
             COALESCE(SUM(amount), 0) AS retired_tco2e
           FROM retirements
           WHERE retired_by = $1
             AND retire_year = $2`,
          [req.user.id, year]
        ).catch(() => ({ rows: [{ cert_count: 0, retired_tco2e: 0 }] })),

        // Previous year emissions for YoY
        query(
          `SELECT COALESCE(SUM(co2e), 0) AS total
           FROM emission_activities
           WHERE user_id = $1
             AND EXTRACT(YEAR FROM date) = $2`,
          [req.user.id, year - 1]
        ),
      ]);

    const t  = tradeRows.rows[0];
    const e  = emissionRows.rows[0];
    const r  = retirementRows.rows[0];
    const py = prevYearRows.rows[0];

    const grossEmissions  = parseFloat(e.total  || 0);
    const offsetPurchased = parseFloat(t.offset_tco2e || 0);
    const netEmissions    = grossEmissions - offsetPurchased;
    const prevTotal       = parseFloat(py.total || 0);
    const yoyChange       = prevTotal > 0
      ? +((grossEmissions - prevTotal) / prevTotal * 100).toFixed(1)
      : null;

    res.json({
      year,
      generated_at: new Date().toISOString(),

      emissions: {
        gross_tco2e:     +grossEmissions.toFixed(4),
        scope1_tco2e:    +parseFloat(e.scope1 || 0).toFixed(4),
        scope2_tco2e:    +parseFloat(e.scope2 || 0).toFixed(4),
        scope3_tco2e:    +parseFloat(e.scope3 || 0).toFixed(4),
        activity_count:  parseInt(e.activity_count || 0),
        prev_year_tco2e: +prevTotal.toFixed(4),
        yoy_change_pct:  yoyChange,
      },

      offsets: {
        purchased_tco2e: +offsetPurchased.toFixed(4),
        spend_inr:       +parseFloat(t.spend_inr || 0).toFixed(2),
        trade_count:     parseInt(t.trade_count || 0),
        on_chain_tco2e:  +parseFloat(t.on_chain_tco2e || 0).toFixed(4),
        retired_tco2e:   +parseFloat(r.retired_tco2e || 0).toFixed(4),
        cert_count:      parseInt(r.cert_count || 0),
      },

      net: {
        net_emissions_tco2e: +netEmissions.toFixed(4),
        carbon_neutral:      netEmissions <= 0,
        offset_ratio_pct:    grossEmissions > 0
          ? +((offsetPurchased / grossEmissions) * 100).toFixed(1)
          : 0,
      },

      brsr: {
        filed:      brsrRows.rows.length > 0,
        updated_at: brsrRows.rows[0]?.updated_at || null,
        section:    'SEBI BRSR Core — Principle 6',
      },

      // pat and ccts skipped — tables not in DB yet
      pat:  null,
      ccts: null,

      frameworks:            ['GHG Protocol', 'SEBI BRSR', 'CDP', 'TCFD', 'ISO 14064-3'],
      ready_for_submission:  brsrRows.rows.length > 0 && grossEmissions > 0,
    });

  } catch (err) { dbErr(res, 'ESG summary', err); }
});

module.exports = router;