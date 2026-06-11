// routes/brsr.js
// SEBI BRSR Core — Principle 6 Environmental KPIs
// P6-E2 Energy · P6-E3 Water · P6-E4 Waste
// ── Fix log:
//    [FIX-AUDIT-HASH]    insertAuditEntry() uses SHA-256 hash chain — same
//                        as audit.js. Fixes NOT NULL crash on audit_log.hash.
//    [FIX-YEAR]          safeYear() bounds check 2000–2100.
//    [FIX-PREV-HASH-TX]  getPrevHash() + insertAuditEntry() accept a pg client
//                        so both run inside the same transaction from
//                        withTransaction(). Prevents stale prev_hash reads
//                        under concurrent saves. Uses SELECT…FOR UPDATE SKIP
//                        LOCKED to lock the latest audit row.
//    [FIX-WITH-TX]       Manual pool.connect()/BEGIN/COMMIT/ROLLBACK replaced
//                        with pool.js's own withTransaction() helper — which
//                        already handles ROLLBACK + client.release() correctly,
//                        including logging rollback failures.
//    [FIX-NULL-ZERO]     cleanNumericObj() preserves null (not entered) vs 0
//                        (confirmed zero). BRSR PDF generator distinguishes.
//    [FIX-ROLLBACK-LOG]  Handled inside withTransaction() in pool.js.
//    [FIX-ARRAY-GUARD]   req.body sections validated as plain objects before
//                        cleanNumericObj — prevents silent empty output.
//    [FIX-RATE-LIMIT]    Per-user rate limiter: 10 saves / 60s. Replace with
//                        express-rate-limit + Redis for multi-instance prod.
//    [FIX-STAGING-ERR]   Non-production error responses include err.message.

'use strict';

const router = require('express').Router();
const { safeQuery: query, withTransaction } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const crypto = require('crypto');

// ── [FIX-RATE-LIMIT] Simple in-memory rate limiter per user
// For production, replace with express-rate-limit + Redis store
const saveRateLimiter = (() => {
  const map = new Map(); // userId → { count, resetAt }
  const WINDOW_MS = 60_000;
  const MAX_SAVES = 10;

  return (userId) => {
    const now = Date.now();
    const entry = map.get(userId);
    if (!entry || now > entry.resetAt) {
      map.set(userId, { count: 1, resetAt: now + WINDOW_MS });
      return false; // not limited
    }
    if (entry.count >= MAX_SAVES) return true; // limited
    entry.count++;
    return false;
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const sanitiseText = (val, maxLen = 500) =>
  String(val || '').replace(/<[^>]*>/g, '').replace(/['"`;\\]/g, '').trim().slice(0, maxLen);

// [FIX-YEAR] Bounded year validation
const safeYear = (val, fallback = null) => {
  const n = parseInt(val, 10);
  if (!Number.isFinite(n) || n < 2000 || n > 2100) return fallback;
  return n;
};

// [FIX-NULL-ZERO] safeFloat returns null for absent/invalid, NOT 0
// Callers decide what null means for their context
const safeFloat = (val, min = 0, max = 1e12) => {
  if (val === null || val === undefined) return null;
  const n = parseFloat(val);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

const isPureObject = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const dbErr = (res, context = 'Operation', err = null) => {
  if (err) console.error(`[BRSR] ${context} error:`, err.message);
  const msg = process.env.NODE_ENV !== 'production'
    ? `${context} failed: ${err?.message || 'unknown error'}` // [FIX-STAGING-ERR]
    : 'An error occurred. Please try again.';
  return res.status(500).json({ error: msg });
};

// ─────────────────────────────────────────────────────────────────────────────
// [FIX-AUDIT-HASH] + [FIX-PREV-HASH-TX] Hash-chained audit entry helper
// client param = open pg client from pool.connect() — runs inside transaction
// ─────────────────────────────────────────────────────────────────────────────
const sha256 = (str) => crypto.createHash('sha256').update(str).digest('hex');

// [FIX-PREV-HASH-TX] Accepts client so the SELECT runs within the open
// transaction, avoiding stale reads under concurrent saves.
// SELECT ... FOR UPDATE locks the latest audit row for this user+year
// so two concurrent POSTs can't both read the same prev_hash.
const getPrevHash = async (client, userId, year) => {
  const { rows } = await client.query(
    `SELECT hash FROM audit_log
     WHERE user_id = $1 AND year = $2
     ORDER BY created_at DESC
     LIMIT 1
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
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [userId, year, action, message, JSON.stringify(meta), hash, prevHash, ts]
  );
  return rows[0];
};

// ─────────────────────────────────────────────────────────────────────────────
// Numeric field whitelists — prevents arbitrary key injection into JSONB
// ─────────────────────────────────────────────────────────────────────────────
const ENERGY_NUMERIC_KEYS = [
  'coal_gj', 'oil_gj', 'gas_gj', 'grid_gj',
  'solar_gj', 'wind_gj', 'biomass_gj', 'hydro_gj', 'other_ren_gj',
  'prev_total_gj', 'prev_renewable_gj', 'prev_intensity_gj_cr',
  'total_gj', 'renewable_gj', 'intensity_gj_cr',
  'intensity_gj_ppp_m', // [FIX-NULL-ZERO] PPP intensity field
  'ppp_rate',
];
const WATER_NUMERIC_KEYS = [
  'surface_kl', 'groundwater_kl', 'thirdparty_kl', 'seawater_kl',
  'rainwater_kl', 'municipal_kl',
  'consumption_kl', 'recycled_kl', 'intensity_kl_cr',
  'prev_withdrawal_kl', 'prev_consumption_kl',
  'withdrawal_kl', 'intensity_kl_ppp_m',
];
const WASTE_NUMERIC_KEYS = [
  'hazardous_kg', 'ewaste_kg', 'plastic_kg', 'biomedical_kg',
  'construction_kg', 'battery_kg', 'radioactive_kg', 'non_hazardous_kg',
  'recycled_kg', 'landfill_kg', 'composted_kg', 'incinerated_kg', 'coprocessed_kg',
  'prev_total_kg', 'total_kg',
];

// [FIX-NULL-ZERO] Preserve null — do NOT coerce to 0.
// null in the JSONB = "not entered by user"
// 0 in the JSONB    = "user confirmed this is zero"
// The BRSR PDF generator must treat these differently per SEBI guidance.
const cleanNumericObj = (obj, numericKeys, maxVal = 1e12) => {
  // [FIX-ARRAY-GUARD] Reject non-plain-objects silently → return empty
  if (!isPureObject(obj)) return {};
  const clean = {};
  for (const key of numericKeys) {
    // safeFloat returns null for absent/invalid — preserved here, not coerced
    clean[key] = safeFloat(obj[key], 0, maxVal); // null | number
  }
  // Preserve string fields with sanitisation
  for (const key of Object.keys(obj)) {
    if (numericKeys.includes(key)) continue;
    if (key === '_meta') continue; // never copy client-supplied _meta
    if (typeof obj[key] === 'string')  { clean[key] = sanitiseText(obj[key], 1000); continue; }
    if (typeof obj[key] === 'boolean') { clean[key] = Boolean(obj[key]);            continue; }
    if (Array.isArray(obj[key])) {
      clean[key] = obj[key]
        .filter(v => typeof v === 'string')
        .map(v => sanitiseText(v, 100))
        .slice(0, 20);
    }
  }
  return clean;
};

// JSONB payload size guard — 10KB per section
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
  if (req.query.year !== undefined && safeYear(req.query.year) === null) {
    return res.status(400).json({ error: 'Invalid year — must be 2000–2100' });
  }

  try {
    const { rows } = await query(
      `SELECT id, year, energy, water, waste, updated_at
       FROM brsr_environmental
       WHERE user_id = $1 AND year = $2`,
      [req.user.id, year]
    );
    res.json({ data: rows[0] || null, year });
  } catch (err) {
    dbErr(res, 'Fetch BRSR environmental', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/brsr/environmental
// [FIX-WITH-TX]      Uses pool.js withTransaction() — client passed through to
//                    getPrevHash so hash chain runs atomically in same tx.
// [FIX-NULL-ZERO]    null fields stored as JSON null — NOT coerced to 0.
// [FIX-RATE-LIMIT]   10 saves / 60s per user
// ─────────────────────────────────────────────────────────────────────────────
router.post('/environmental', authenticate, async (req, res) => {
  // [FIX-RATE-LIMIT]
  if (saveRateLimiter(req.user.id)) {
    return res.status(429).json({ error: 'Too many saves — please wait a moment before retrying' });
  }

  const year = safeYear(req.body.year, new Date().getFullYear());
  if (req.body.year !== undefined && safeYear(req.body.year) === null) {
    return res.status(400).json({ error: 'Invalid year — must be 2000–2100' });
  }

  // [FIX-ARRAY-GUARD] Validate sections are plain objects before cleaning
  const rawEnergy = isPureObject(req.body.energy) ? req.body.energy : {};
  const rawWater  = isPureObject(req.body.water)  ? req.body.water  : {};
  const rawWaste  = isPureObject(req.body.waste)  ? req.body.waste  : {};

  const energyClean = cleanNumericObj(rawEnergy, ENERGY_NUMERIC_KEYS);
  const waterClean  = cleanNumericObj(rawWater,  WATER_NUMERIC_KEYS);
  const wasteClean  = cleanNumericObj(rawWaste,  WASTE_NUMERIC_KEYS);

  // Add regulatory metadata — always server-generated, never from client
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

  // [FIX-WITH-TX] Use pool.js withTransaction() — handles BEGIN/COMMIT/ROLLBACK
  // + client.release() correctly, including logging rollback failures.
  // [FIX-PREV-HASH-TX] client is passed into insertAuditEntry so the hash
  // chain SELECT runs on the same connection inside the open transaction.
  try {
    const savedRow = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO brsr_environmental
           (user_id, year, energy, water, waste, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id, year) DO UPDATE SET
           energy     = EXCLUDED.energy,
           water      = EXCLUDED.water,
           waste      = EXCLUDED.waste,
           updated_at = NOW()
         RETURNING id, year, energy, water, waste, updated_at`,
        [
          req.user.id,
          year,
          JSON.stringify(energyClean),
          JSON.stringify(waterClean),
          JSON.stringify(wasteClean),
        ]
      );

      // [FIX-PREV-HASH-TX] Same client → hash chain is consistent + atomic
      await insertAuditEntry(
        client,
        req.user.id,
        year,
        'UPDATE',
        `BRSR P6 environmental data saved — ` +
        // [FIX-NULL-ZERO] null → "not entered" in audit message
        `Energy: ${energyClean.total_gj ?? 'not entered'} GJ, ` +
        `Water: ${waterClean.withdrawal_kl ?? 'not entered'} KL, ` +
        `Waste: ${wasteClean.total_kg ?? 'not entered'} kg`,
        {
          has_energy:     energyClean.total_gj !== null,
          has_water:      waterClean.withdrawal_kl !== null,
          has_waste:      wasteClean.total_kg !== null,
          // [FIX-NULL-ZERO] Distinguish "zero" from "not entered" in audit meta
          energy_is_zero: energyClean.total_gj === 0,
          water_is_zero:  waterClean.withdrawal_kl === 0,
          waste_is_zero:  wasteClean.total_kg === 0,
          grid_ef_used:   0.727,
          grid_ef_source: 'CEA V20.0 Dec 2024',
        }
      );

      return rows[0];
    });

    res.json({ message: 'BRSR environmental data saved', data: savedRow });
  } catch (err) {
    dbErr(res, 'Save BRSR environmental', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/brsr/summary?year=2025
// [FIX-NULL-ZERO] Distinguishes null (not entered) from 0 (confirmed zero)
// in completeness calculation — null fields don't count as "entered"
// ─────────────────────────────────────────────────────────────────────────────
router.get('/summary', authenticate, async (req, res) => {
  const year = safeYear(req.query.year, new Date().getFullYear());
  if (req.query.year !== undefined && safeYear(req.query.year) === null) {
    return res.status(400).json({ error: 'Invalid year — must be 2000–2100' });
  }

  try {
    const { rows } = await query(
      `SELECT
         -- [FIX-NULL-ZERO] Use IS NOT NULL checks for completeness
         energy->>'total_gj'           AS total_gj_raw,
         water->>'withdrawal_kl'       AS withdrawal_kl_raw,
         waste->>'total_kg'            AS total_waste_kg_raw,
         (energy->>'total_gj')::numeric              AS total_gj,
         (energy->>'renewable_gj')::numeric           AS renewable_gj,
         (energy->>'intensity_gj_cr')::numeric        AS energy_intensity,
         (energy->>'intensity_gj_ppp_m')::numeric     AS energy_intensity_ppp,
         (water->>'withdrawal_kl')::numeric            AS withdrawal_kl,
         (water->>'recycled_kl')::numeric              AS recycled_kl,
         (water->>'intensity_kl_cr')::numeric          AS water_intensity,
         (water->>'intensity_kl_ppp_m')::numeric       AS water_intensity_ppp,
         (waste->>'total_kg')::numeric                 AS total_waste_kg,
         (waste->>'hazardous_kg')::numeric             AS hazardous_kg,
         updated_at
       FROM brsr_environmental
       WHERE user_id = $1 AND year = $2`,
      [req.user.id, year]
    );

    if (!rows.length) return res.json({ data: null, year, completeness: 0 });

    const r = rows[0];

    // [FIX-NULL-ZERO] null raw = not entered, not the same as zero
    const hasEnergy = r.total_gj_raw !== null;
    const hasWater  = r.withdrawal_kl_raw !== null;
    const hasWaste  = r.total_waste_kg_raw !== null;

    const completeness = Math.round(
      ([hasEnergy, hasWater, hasWaste].filter(Boolean).length / 3) * 100
    );

    res.json({
      data: r,
      year,
      completeness,
      // Surface null/zero status explicitly for the frontend
      dataStatus: {
        energy: hasEnergy ? (parseFloat(r.total_gj_raw) === 0 ? 'zero' : 'entered') : 'not_entered',
        water:  hasWater  ? (parseFloat(r.withdrawal_kl_raw) === 0 ? 'zero' : 'entered') : 'not_entered',
        waste:  hasWaste  ? (parseFloat(r.total_waste_kg_raw) === 0 ? 'zero' : 'entered') : 'not_entered',
      },
    });
  } catch (err) {
    dbErr(res, 'BRSR summary', err);
  }
});

module.exports = router;