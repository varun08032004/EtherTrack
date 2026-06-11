// routes/pat.js — BEE PAT Scheme Profile
// ── Updates v2:
//    [FIX-SECTOR-ID]     paper_pulp corrected to pulp_paper (matches BEE official name + frontend)
//    [FIX-SOURCE-SPLIT]  energy_sources JSONB field added (BEE Form 1 source-wise breakup)
//    [FIX-AUDITOR]       auditor_name, auditor_firm, auditor_reg_number, audit_date, audit_verified added
//    [FIX-ESCERT-DEFICIT] escert_deficit field added
//    [FIX-ORG-SUPPORT]   Profile now scoped to org_id when user belongs to an org,
//                        falls back to user_id for solo users
//    [FIX-GET-FIELDS]    GET now returns all new fields
//    [FIX-MIGRATION]     Migration SQL provided at bottom as comment
// ── Security:
//    All string fields sanitised
//    All numeric fields validated with bounds
//    Sector and cycle validated against whitelists
//    Monthly array validated as exactly 12 non-negative numbers
//    energy_sources validated key-by-key against allowed source IDs
//    No DB internals leaked to client in production

'use strict';

const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate }     = require('../middleware/auth');

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const sanitiseText = (val, maxLen = 200) =>
  String(val || '').replace(/<[^>]*>/g, '').replace(/['"`;\\]/g, '').trim().slice(0, maxLen);

const safeFloat = (val, min = 0, max = 1e12) => {
  const n = parseFloat(val);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

const safeInt = (val, min = 0, max = 2_147_483_647) => {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

const validateMonthlyArray = (arr, maxVal = 1e12) => {
  if (!Array.isArray(arr)) return null;
  if (arr.length !== 12)   return null;
  return arr.map(v => safeFloat(v, 0, maxVal) ?? 0);
};

const dbErr = (res, context = 'Operation') =>
  res.status(500).json({
    error: process.env.NODE_ENV !== 'production'
      ? `${context} failed`
      : 'An error occurred. Please try again.',
  });

// ─────────────────────────────────────────────────────────────────────────────
// WHITELISTS
// [FIX-SECTOR-ID] pulp_paper corrected from paper_pulp
// ─────────────────────────────────────────────────────────────────────────────
const ALLOWED_PAT_SECTORS = [
  'aluminium', 'cement', 'chlor_alkali', 'fertiliser', 'iron_steel',
  'pulp_paper',           // [FIX-SECTOR-ID] was paper_pulp
  'petrochemical', 'railways', 'textile', 'thermal_power',
  'refineries', 'commercial', 'other',
];

const ALLOWED_PAT_CYCLES = ['I', 'II', 'III', 'IV', 'V'];

// [FIX-SOURCE-SPLIT] Allowed energy source IDs — must match frontend ENERGY_SOURCES
const ALLOWED_ENERGY_SOURCES = [
  'coal', 'lignite', 'fuelOil', 'hsd', 'lpg',
  'naturalGas', 'electricity', 'renewable', 'other',
];

// BEE-accredited verifier firms — matches frontend BEE_VERIFIERS
const ALLOWED_AUDITOR_FIRMS = [
  'Bureau Veritas (BV)',
  'DNV GL',
  'TUV SUD',
  'TUV Rheinland',
  'RITES Ltd',
  'MECON Ltd',
  'EIL (Engineers India Ltd)',
  'PDIL',
  'Other BEE-accredited Energy Auditor',
  '', // allow empty
];

// ─────────────────────────────────────────────────────────────────────────────
// [FIX-ORG-SUPPORT] Helper — resolve the scope key for this user
// Corporate users belong to an org; profile is shared across the org.
// Solo users fall back to user_id scope.
// ─────────────────────────────────────────────────────────────────────────────
const resolveScope = async (userId) => {
  const { rows } = await query(
    `SELECT org_id FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  const orgId = rows[0]?.org_id || null;
  return { orgId, scopeCol: orgId ? 'org_id' : 'user_id', scopeVal: orgId || userId };
};

// ─────────────────────────────────────────────────────────────────────────────
// [FIX-SOURCE-SPLIT] Validate and sanitise energy_sources object
// Returns a clean object with only allowed keys and non-negative floats.
// Unknown keys are dropped silently — prevents arbitrary JSON injection.
// ─────────────────────────────────────────────────────────────────────────────
const validateEnergySources = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const clean = {};
  for (const key of ALLOWED_ENERGY_SOURCES) {
    const val = safeFloat(raw[key], 0, 1e12);
    clean[key] = val ?? 0;
  }
  return clean;
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pat/profile
// Returns full PAT profile including all new v2 fields
// ─────────────────────────────────────────────────────────────────────────────
router.get('/profile', authenticate, async (req, res) => {
  try {
    const { scopeCol, scopeVal } = await resolveScope(req.user.id);

    const { rows } = await query(
      `SELECT
         id, sector, cycle, dc_name, dc_number,
         baseline_sec, target_sec, target_reduction_pct,
         gate_capacity, reporting_year,
         monthly_gj,
         energy_sources,
         current_sec, energy_saved_gj, escerts, escert_deficit,
         auditor_name, auditor_firm, auditor_reg_number,
         audit_date, audit_verified,
         updated_at
       FROM pat_profile
       WHERE ${scopeCol} = $1
       LIMIT 1`,
      [scopeVal]
    );

    const row = rows[0] || null;
    if (row) {
      // Parse JSONB fields if returned as string
      if (typeof row.monthly_gj === 'string') {
        try { row.monthly_gj = JSON.parse(row.monthly_gj); } catch { row.monthly_gj = Array(12).fill(0); }
      }
      if (typeof row.energy_sources === 'string') {
        try { row.energy_sources = JSON.parse(row.energy_sources); } catch { row.energy_sources = null; }
      }
    }

    res.json({ data: row });
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('[GET /api/pat/profile]', err.message);
    dbErr(res, 'Fetch PAT profile');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/pat/profile
// Upsert — creates or updates PAT profile for the user/org
// ─────────────────────────────────────────────────────────────────────────────
router.post('/profile', authenticate, async (req, res) => {
  const {
    sector, cycle,
    dc_name, dc_number,
    baseline_sec, target_sec, target_reduction_pct,
    gate_capacity, reporting_year,
    monthly_gj:      rawMonthly,
    energy_sources:  rawSources,
    current_sec, energy_saved_gj, escerts, escert_deficit,
    auditor_name, auditor_firm, auditor_reg_number,
    audit_date, audit_verified,
  } = req.body;

  // ── Sector + cycle whitelists ─────────────────────────────────────────────
  const cleanSector = ALLOWED_PAT_SECTORS.includes(sector) ? sector : 'cement';
  const cleanCycle  = ALLOWED_PAT_CYCLES.includes(cycle)   ? cycle  : 'IV';

  // ── Monthly GJ array — exactly 12 non-negative numbers ───────────────────
  const cleanMonthly = validateMonthlyArray(rawMonthly, 1e12);
  if (!cleanMonthly) {
    return res.status(400).json({
      error: 'monthly_gj must be an array of exactly 12 non-negative numbers (Apr–Mar order)',
    });
  }

  // ── [FIX-SOURCE-SPLIT] Energy sources — validate key-by-key ──────────────
  const cleanSources = validateEnergySources(rawSources);
  // cleanSources may be null if not provided — that's fine, we preserve existing

  // ── Numeric fields ─────────────────────────────────────────────────────────
  const cleanBaselineSec   = safeFloat(baseline_sec,         0, 1e6);
  const cleanTargetSec     = safeFloat(target_sec,           0, 1e6);
  const cleanReductionPct  = safeFloat(target_reduction_pct, 0, 100);
  const cleanCapacity      = safeFloat(gate_capacity,        0, 1e9);
  const cleanReportingYear = safeInt(reporting_year,      2000, 2100) ?? new Date().getFullYear();
  const cleanCurrentSec    = safeFloat(current_sec,          0, 1e6);
  const cleanEnergySavedGJ = safeFloat(energy_saved_gj,      0, 1e12);
  const cleanEscerts       = safeInt(escerts,                0, 10_000_000) ?? 0;
  const cleanEscertDeficit = safeInt(escert_deficit,         0, 10_000_000) ?? 0;

  // ── [FIX-SEC-VALIDATE] Server-side: target must be < baseline if both provided
  if (cleanBaselineSec !== null && cleanTargetSec !== null && cleanTargetSec >= cleanBaselineSec) {
    return res.status(400).json({
      error: 'target_sec must be less than baseline_sec — energy intensity must decrease under PAT.',
    });
  }

  // ── String fields ──────────────────────────────────────────────────────────
  const cleanDcName          = sanitiseText(dc_name,              200) || null;
  const cleanDcNumber        = sanitiseText(dc_number,            100) || null;
  const cleanAuditorName     = sanitiseText(auditor_name,         200) || null;
  const cleanAuditorFirm     = ALLOWED_AUDITOR_FIRMS.includes(auditor_firm)
    ? auditor_firm
    : sanitiseText(auditor_firm, 200) || null;
  const cleanAuditorRegNo    = sanitiseText(auditor_reg_number,   100) || null;
  const cleanAuditDate       = audit_date
    ? (/^\d{4}-\d{2}-\d{2}$/.test(audit_date) ? audit_date : null)
    : null;
  const cleanAuditVerified   = !!audit_verified;

  try {
    const { orgId, scopeCol, scopeVal } = await resolveScope(req.user.id);

    const { rows } = await query(
      `INSERT INTO pat_profile (
         user_id, org_id,
         sector, cycle, dc_name, dc_number,
         baseline_sec, target_sec, target_reduction_pct,
         gate_capacity, reporting_year,
         monthly_gj, energy_sources,
         current_sec, energy_saved_gj, escerts, escert_deficit,
         auditor_name, auditor_firm, auditor_reg_number,
         audit_date, audit_verified,
         updated_at
       ) VALUES (
         $1, $2,
         $3, $4, $5, $6,
         $7, $8, $9,
         $10, $11,
         $12, $13,
         $14, $15, $16, $17,
         $18, $19, $20,
         $21, $22,
         NOW()
       )
       ON CONFLICT (${scopeCol}) DO UPDATE SET
         sector               = EXCLUDED.sector,
         cycle                = EXCLUDED.cycle,
         dc_name              = EXCLUDED.dc_name,
         dc_number            = EXCLUDED.dc_number,
         baseline_sec         = EXCLUDED.baseline_sec,
         target_sec           = EXCLUDED.target_sec,
         target_reduction_pct = EXCLUDED.target_reduction_pct,
         gate_capacity        = EXCLUDED.gate_capacity,
         reporting_year       = EXCLUDED.reporting_year,
         monthly_gj           = EXCLUDED.monthly_gj,
         energy_sources       = COALESCE(EXCLUDED.energy_sources, pat_profile.energy_sources),
         current_sec          = EXCLUDED.current_sec,
         energy_saved_gj      = EXCLUDED.energy_saved_gj,
         escerts              = EXCLUDED.escerts,
         escert_deficit       = EXCLUDED.escert_deficit,
         auditor_name         = EXCLUDED.auditor_name,
         auditor_firm         = EXCLUDED.auditor_firm,
         auditor_reg_number   = EXCLUDED.auditor_reg_number,
         audit_date           = EXCLUDED.audit_date,
         audit_verified       = EXCLUDED.audit_verified,
         updated_at           = NOW()
       RETURNING *`,
      [
        req.user.id,
        orgId,
        cleanSector,
        cleanCycle,
        cleanDcName,
        cleanDcNumber,
        cleanBaselineSec   ?? null,
        cleanTargetSec     ?? null,
        cleanReductionPct  ?? null,
        cleanCapacity      ?? null,
        cleanReportingYear,
        JSON.stringify(cleanMonthly),
        cleanSources ? JSON.stringify(cleanSources) : null,
        cleanCurrentSec    ?? null,
        cleanEnergySavedGJ ?? null,
        cleanEscerts,
        cleanEscertDeficit,
        cleanAuditorName,
        cleanAuditorFirm,
        cleanAuditorRegNo,
        cleanAuditDate,
        cleanAuditVerified,
      ]
    );

    const saved = rows[0];
    // Parse JSONB fields before returning
    if (typeof saved.monthly_gj === 'string') {
      try { saved.monthly_gj = JSON.parse(saved.monthly_gj); } catch { saved.monthly_gj = Array(12).fill(0); }
    }
    if (typeof saved.energy_sources === 'string') {
      try { saved.energy_sources = JSON.parse(saved.energy_sources); } catch { saved.energy_sources = null; }
    }

    res.json({ message: 'PAT profile saved', data: saved });
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('[POST /api/pat/profile]', err.message);
    dbErr(res, 'Save PAT profile');
  }
});

module.exports = router;

/*
── MIGRATION SQL ──────────────────────────────────────────────────────────────
Run this migration to add the new columns to pat_profile.
If the table does not exist yet, use the CREATE TABLE below instead.

-- Option A: ALTER existing table (if pat_profile already exists)
ALTER TABLE pat_profile
  ADD COLUMN IF NOT EXISTS org_id          UUID        REFERENCES organisations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS energy_sources  JSONB,
  ADD COLUMN IF NOT EXISTS escert_deficit  INTEGER     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auditor_name    VARCHAR(200),
  ADD COLUMN IF NOT EXISTS auditor_firm    VARCHAR(200),
  ADD COLUMN IF NOT EXISTS auditor_reg_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS audit_date      DATE,
  ADD COLUMN IF NOT EXISTS audit_verified  BOOLEAN     DEFAULT FALSE;

-- Fix sector value for existing rows with old paper_pulp ID
UPDATE pat_profile SET sector = 'pulp_paper' WHERE sector = 'paper_pulp';

-- Drop old unique constraint and add org-aware one
-- (only if your existing constraint is on user_id alone)
ALTER TABLE pat_profile DROP CONSTRAINT IF EXISTS pat_profile_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS pat_profile_scope_idx
  ON pat_profile (COALESCE(org_id::text, user_id::text));

-- Option B: CREATE TABLE from scratch
CREATE TABLE IF NOT EXISTS pat_profile (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id               UUID        REFERENCES organisations(id)  ON DELETE SET NULL,
  sector               VARCHAR(50) NOT NULL DEFAULT 'cement',
  cycle                VARCHAR(10) NOT NULL DEFAULT 'IV',
  dc_name              VARCHAR(200),
  dc_number            VARCHAR(100),
  baseline_sec         NUMERIC(12, 4),
  target_sec           NUMERIC(12, 4),
  target_reduction_pct NUMERIC(6,  2),
  gate_capacity        NUMERIC(18, 2),
  reporting_year       INTEGER     NOT NULL DEFAULT EXTRACT(YEAR FROM NOW()),
  monthly_gj           JSONB       NOT NULL DEFAULT '[0,0,0,0,0,0,0,0,0,0,0,0]',
  energy_sources       JSONB,
  current_sec          NUMERIC(12, 4),
  energy_saved_gj      NUMERIC(18, 2),
  escerts              INTEGER     DEFAULT 0,
  escert_deficit       INTEGER     DEFAULT 0,
  auditor_name         VARCHAR(200),
  auditor_firm         VARCHAR(200),
  auditor_reg_number   VARCHAR(100),
  audit_date           DATE,
  audit_verified       BOOLEAN     DEFAULT FALSE,
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT pat_profile_scope_idx UNIQUE (COALESCE(org_id::text, user_id::text))
);

CREATE INDEX IF NOT EXISTS pat_profile_user_idx ON pat_profile (user_id);
CREATE INDEX IF NOT EXISTS pat_profile_org_idx  ON pat_profile (org_id);
──────────────────────────────────────────────────────────────────────────────
*/