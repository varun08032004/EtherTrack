'use strict';
/**
 * routes/brsrDataRoutes.js — EtherTrack BRSR Disclosures Data Layer
 * ─────────────────────────────────────────────────────────────────────────────
 * Mounted at /api/brsr in server.js (AFTER existing routes/brsr.js).
 * P6 Environmental stays in routes/brsr.js — not duplicated here.
 *
 * ROUTES:
 *   GET  /api/brsr/section-a
 *   POST /api/brsr/section-a
 *   GET  /api/brsr/section-b
 *   POST /api/brsr/section-b
 *   GET  /api/brsr/principle/:principleId   (p1–p5, p7–p9)
 *   POST /api/brsr/principle/:principleId
 *   GET  /api/brsr/all/:year               — full snapshot for PDF generation
 *
 * DB TABLES REQUIRED:
 *   brsr_section_a   (org_id, year, entity jsonb, business jsonb,
 *                     workforce jsonb, structure jsonb, grievance jsonb)
 *   brsr_section_b   (org_id, year, policy_matrix jsonb,
 *                     non_coverage jsonb, governance jsonb)
 *   brsr_principles  (org_id, year, principle_id text, data jsonb)
 *
 * CREATE TABLE IF NOT EXISTS brsr_section_a (
 *   id         BIGSERIAL PRIMARY KEY,
 *   org_id     UUID NOT NULL,
 *   year       INT  NOT NULL,
 *   entity     JSONB NOT NULL DEFAULT '{}',
 *   business   JSONB NOT NULL DEFAULT '{}',
 *   workforce  JSONB NOT NULL DEFAULT '{}',
 *   structure  JSONB NOT NULL DEFAULT '{}',
 *   grievance  JSONB NOT NULL DEFAULT '{}',
 *   updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 *   UNIQUE (org_id, year)
 * );
 *
 * CREATE TABLE IF NOT EXISTS brsr_section_b (
 *   id            BIGSERIAL PRIMARY KEY,
 *   org_id        UUID NOT NULL,
 *   year          INT  NOT NULL,
 *   policy_matrix JSONB NOT NULL DEFAULT '{}',
 *   non_coverage  JSONB NOT NULL DEFAULT '{}',
 *   governance    JSONB NOT NULL DEFAULT '{}',
 *   updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
 *   UNIQUE (org_id, year)
 * );
 *
 * CREATE TABLE IF NOT EXISTS brsr_principles (
 *   id           BIGSERIAL PRIMARY KEY,
 *   org_id       UUID NOT NULL,
 *   year         INT  NOT NULL,
 *   principle_id TEXT NOT NULL,
 *   data         JSONB NOT NULL DEFAULT '{}',
 *   updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
 *   UNIQUE (org_id, year, principle_id)
 * );
 */

const express  = require('express');
const { Pool } = require('pg');
const { authenticate } = require('../middleware/auth');
const { hasPermission } = require('../middleware/rbac');

const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const VALID_PRINCIPLES  = ['p1','p2','p3','p4','p5','p7','p8','p9'];
const CORPORATE_PLANS   = ['corporate', 'enterprise'];

// ── Helpers ───────────────────────────────────────────────────────────────────

const parseYear = (raw) => {
  const y = parseInt(raw, 10);
  return Number.isFinite(y) && y > 2000 && y < 2100 ? y : null;
};

// Section A/B/principles are keyed by org_id — for business accounts this
// resolves to the shared org scope (routes/org.js), so every team member
// sees and edits the SAME BRSR filing. Individual accounts (no org) keep
// today's behaviour of a scope private to themselves.
// NOTE: brsr_environmental (P6) has no org_id column — it stays scoped to
// req.user.id specifically wherever it's queried below, never to orgId.
const getOrgId = (req) => req.user?.org_id || req.user?.id || null;

// reports:read / reports:generate mirror the write/read split used for the
// emissions ledger (owner/admin/manager write, +viewer/auditor read-only).
// Individuals (no org) are unrestricted on their own data, same as before.
const canAccessBrsr = (req, action) => {
  if (!req.user.org_id) return true;
  const permission = action === 'write' ? 'reports:generate' : 'reports:read';
  return hasPermission(req.user.team_role || 'viewer', permission);
};

const dbErr = (res, ctx, err) => {
  console.error(`[brsrData/${ctx}]`, err?.message || err);
  return res.status(500).json({ error: `Failed to ${ctx}` });
};

// Merge import data into existing — existing user edits win over imported values.
// Only fills keys that are null/undefined in existing.
const mergeImport = (existing = {}, incoming = {}) => {
  const merged = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (merged[k] === null || merged[k] === undefined || merged[k] === '') {
      merged[k] = v;
    }
  }
  return merged;
};

// ── Auth + Plan gate ──────────────────────────────────────────────────────────

router.use(authenticate);

router.use((req, res, next) => {
  if (!CORPORATE_PLANS.includes(req.user?.subscription_plan)) {
    return res.status(403).json({
      error: 'BRSR Disclosures requires Corporate plan or above',
      code:  'PLAN_REQUIRED',
    });
  }
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION A
// ─────────────────────────────────────────────────────────────────────────────

router.get('/section-a', async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: 'Not authenticated' });
  if (!canAccessBrsr(req, 'read')) return res.status(403).json({ error: 'Your role does not have access to BRSR data' });
  const year = parseYear(req.query.year);
  if (!year) return res.status(400).json({ error: 'Valid year required (e.g. ?year=2025)' });

  try {
    const { rows } = await pool.query(
      `SELECT entity, business, workforce, structure, grievance, updated_at
       FROM brsr_section_a
       WHERE org_id = $1 AND year = $2`,
      [orgId, year]
    );
    return res.json({ data: rows[0] || null, year });
  } catch (err) { return dbErr(res, 'load section-a', err); }
});

router.post('/section-a', async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: 'Not authenticated' });
  if (!canAccessBrsr(req, 'write')) return res.status(403).json({ error: 'Your role cannot edit BRSR data — ask an org admin or manager' });
  const { year, entity, business, workforce, structure, grievance, _import } = req.body || {};
  const validYear = parseYear(year);
  if (!validYear) return res.status(400).json({ error: 'Valid year is required' });

  try {
    let entityFinal    = entity    || {};
    let businessFinal  = business  || {};
    let workforceFinal = workforce || {};
    let structureFinal = structure || {};
    let grievanceFinal = grievance || {};

    // If this is an import call, merge with existing so user edits are preserved
    if (_import) {
      const { rows } = await pool.query(
        `SELECT entity, business, workforce, structure, grievance
         FROM brsr_section_a WHERE org_id = $1 AND year = $2`,
        [orgId, validYear]
      );
      if (rows[0]) {
        entityFinal    = mergeImport(rows[0].entity,    entityFinal);
        businessFinal  = mergeImport(rows[0].business,  businessFinal);
        workforceFinal = mergeImport(rows[0].workforce, workforceFinal);
        structureFinal = mergeImport(rows[0].structure, structureFinal);
        grievanceFinal = mergeImport(rows[0].grievance, grievanceFinal);
      }
    }

    await pool.query(
      `INSERT INTO brsr_section_a
         (org_id, year, entity, business, workforce, structure, grievance, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (org_id, year) DO UPDATE SET
         entity     = EXCLUDED.entity,
         business   = EXCLUDED.business,
         workforce  = EXCLUDED.workforce,
         structure  = EXCLUDED.structure,
         grievance  = EXCLUDED.grievance,
         updated_at = EXCLUDED.updated_at`,
      [orgId, validYear,
       JSON.stringify(entityFinal),
       JSON.stringify(businessFinal),
       JSON.stringify(workforceFinal),
       JSON.stringify(structureFinal),
       JSON.stringify(grievanceFinal)]
    );
    return res.json({ ok: true, year: validYear });
  } catch (err) { return dbErr(res, 'save section-a', err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION B
// ─────────────────────────────────────────────────────────────────────────────

router.get('/section-b', async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: 'Not authenticated' });
  if (!canAccessBrsr(req, 'read')) return res.status(403).json({ error: 'Your role does not have access to BRSR data' });
  const year = parseYear(req.query.year);
  if (!year) return res.status(400).json({ error: 'Valid year required' });

  try {
    const { rows } = await pool.query(
      `SELECT policy_matrix AS "policyMatrix",
              non_coverage  AS "nonCoverage",
              governance,
              updated_at
       FROM brsr_section_b
       WHERE org_id = $1 AND year = $2`,
      [orgId, year]
    );
    return res.json({ data: rows[0] || null, year });
  } catch (err) { return dbErr(res, 'load section-b', err); }
});

router.post('/section-b', async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: 'Not authenticated' });
  if (!canAccessBrsr(req, 'write')) return res.status(403).json({ error: 'Your role cannot edit BRSR data — ask an org admin or manager' });
  const { year, policyMatrix, nonCoverage, governance, _import } = req.body || {};
  const validYear = parseYear(year);
  if (!validYear) return res.status(400).json({ error: 'Valid year is required' });

  try {
    let pmFinal  = policyMatrix  || {};
    let ncFinal  = nonCoverage   || {};
    let govFinal = governance    || {};

    if (_import) {
      const { rows } = await pool.query(
        `SELECT policy_matrix, non_coverage, governance
         FROM brsr_section_b WHERE org_id = $1 AND year = $2`,
        [orgId, validYear]
      );
      if (rows[0]) {
        pmFinal  = mergeImport(rows[0].policy_matrix, pmFinal);
        ncFinal  = mergeImport(rows[0].non_coverage,  ncFinal);
        govFinal = mergeImport(rows[0].governance,    govFinal);
      }
    }

    await pool.query(
      `INSERT INTO brsr_section_b
         (org_id, year, policy_matrix, non_coverage, governance, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (org_id, year) DO UPDATE SET
         policy_matrix = EXCLUDED.policy_matrix,
         non_coverage  = EXCLUDED.non_coverage,
         governance    = EXCLUDED.governance,
         updated_at    = EXCLUDED.updated_at`,
      [orgId, validYear,
       JSON.stringify(pmFinal),
       JSON.stringify(ncFinal),
       JSON.stringify(govFinal)]
    );
    return res.json({ ok: true, year: validYear });
  } catch (err) { return dbErr(res, 'save section-b', err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION C — PRINCIPLES P1–P5, P7–P9  (P6 = /api/brsr/environmental)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/principle/:principleId', async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: 'Not authenticated' });
  if (!canAccessBrsr(req, 'read')) return res.status(403).json({ error: 'Your role does not have access to BRSR data' });
  const { principleId } = req.params;
  if (!VALID_PRINCIPLES.includes(principleId))
    return res.status(400).json({ error: `Unknown principle "${principleId}". Valid: ${VALID_PRINCIPLES.join(', ')}` });
  const year = parseYear(req.query.year);
  if (!year) return res.status(400).json({ error: 'Valid year required' });

  try {
    const { rows } = await pool.query(
      `SELECT data, updated_at
       FROM brsr_principles
       WHERE org_id = $1 AND year = $2 AND principle_id = $3`,
      [orgId, year, principleId]
    );
    return res.json({ data: rows[0]?.data || null, year, principleId });
  } catch (err) { return dbErr(res, `load principle ${principleId}`, err); }
});

router.post('/principle/:principleId', async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: 'Not authenticated' });
  if (!canAccessBrsr(req, 'write')) return res.status(403).json({ error: 'Your role cannot edit BRSR data — ask an org admin or manager' });
  const { principleId } = req.params;
  if (!VALID_PRINCIPLES.includes(principleId))
    return res.status(400).json({ error: `Unknown principle "${principleId}"` });
  const { year, data, _import } = req.body || {};
  const validYear = parseYear(year);
  if (!validYear) return res.status(400).json({ error: 'Valid year is required' });

  try {
    let dataFinal = data || {};

    if (_import) {
      const { rows } = await pool.query(
        `SELECT data FROM brsr_principles
         WHERE org_id = $1 AND year = $2 AND principle_id = $3`,
        [orgId, validYear, principleId]
      );
      if (rows[0]?.data) {
        dataFinal = mergeImport(rows[0].data, dataFinal);
      }
    }

    await pool.query(
      `INSERT INTO brsr_principles (org_id, year, principle_id, data, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (org_id, year, principle_id) DO UPDATE SET
         data       = EXCLUDED.data,
         updated_at = EXCLUDED.updated_at`,
      [orgId, validYear, principleId, JSON.stringify(dataFinal)]
    );
    return res.json({ ok: true, year: validYear, principleId });
  } catch (err) { return dbErr(res, `save principle ${principleId}`, err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/brsr/all/:year — full snapshot for PDF generation
// Aggregates Section A + B + all principles + environmental in one call
// Used by the report generator before calling buildBRSRHTML()
// ─────────────────────────────────────────────────────────────────────────────

router.get('/all/:year', async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(401).json({ error: 'Not authenticated' });
  if (!canAccessBrsr(req, 'read')) return res.status(403).json({ error: 'Your role does not have access to BRSR data' });
  const year = parseYear(req.params.year);
  if (!year) return res.status(400).json({ error: 'Invalid year' });

  try {
    const [secA, secB, principles, environmental] = await Promise.all([
      pool.query(
        `SELECT entity, business, workforce, structure, grievance
         FROM brsr_section_a WHERE org_id = $1 AND year = $2`,
        [orgId, year]
      ),
      pool.query(
        `SELECT policy_matrix AS "policyMatrix", non_coverage AS "nonCoverage", governance
         FROM brsr_section_b WHERE org_id = $1 AND year = $2`,
        [orgId, year]
      ),
      pool.query(
        `SELECT principle_id, data FROM brsr_principles
         WHERE org_id = $1 AND year = $2`,
        [orgId, year]
      ),
      pool.query(
        `SELECT energy, water, waste FROM brsr_environmental
         WHERE user_id = $1 AND year = $2`,
        [req.user.id, year], // P6 has no org_id column — always the requester's own row
      ),
    ]);

    // Build principle map: { p1: {...}, p2: {...}, ... }
    const principleMap = {};
    for (const row of principles.rows) {
      principleMap[row.principle_id] = row.data;
    }

    // Inject P6 from environmental table
    const env = environmental.rows[0];
    if (env) {
      principleMap.p6 = {
        energyData: env.energy,
        waterData:  env.water,
        wasteData:  env.waste,
      };
    }

    return res.json({
      year,
      sectionA:   secA.rows[0]  || null,
      sectionB:   secB.rows[0]  || null,
      principles: principleMap,
      completeness: {
        sectionA:     !!secA.rows[0],
        sectionB:     !!secB.rows[0],
        environmental:!!env,
        principlesFilled: Object.keys(principleMap).length,
      },
    });
  } catch (err) { return dbErr(res, 'load all brsr data', err); }
});

module.exports = router;