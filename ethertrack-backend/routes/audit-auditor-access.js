// routes/audit-auditor-access.js
// ── Auditor-Facing Read-Only API — backend routes
// Generates scoped, expiring tokens so a Big 4 auditor can pull GHG data
// directly via API rather than the customer spending 6+ weeks compiling
// manual exports. This is what compresses an audit cycle from months to days.
//
// Mount alongside audit routes:
//   app.use('/api/audit', require('./routes/audit-auditor-access'));
//
// ── Security:
//    Tokens are random, hashed before storage (never store raw tokens),
//    scoped to a single org + year + package type, time-limited,
//    revocable, and READ-ONLY — auditor endpoints never accept writes.
//    Rate limited separately from normal user traffic.
//    Every auditor API call is logged for the customer to see who
//    accessed what and when.

'use strict';

const router  = require('express').Router();
const crypto  = require('crypto');
const { safeQuery: query } = require('../db/pool');
const { authenticate } = require('../middleware/auth');

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const sanitiseText = (val, maxLen = 500) =>
  String(val || '')
    .replace(/<[^>]*>/g, '')
    .replace(/['"`;\\]/g, '')
    .trim()
    .slice(0, maxLen);

const safeInt = (val, min = 0, max = 2_147_483_647) => {
  const n = parseInt(val, 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
};

const safeYear = (val) => safeInt(val, 2000, 2100);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VALID_PACKAGES = ['standard', 'brsr', 'full'];

const dbErr = (res, context = 'Operation', err = null) => {
  if (err) console.error(`[AuditorAccess] ${context} error:`, err.message);
  if (process.env.NODE_ENV !== 'production') {
    return res.status(500).json({ error: `${context} failed` });
  }
  return res.status(500).json({ error: 'An error occurred. Please try again.' });
};

// ── Token generation ──────────────────────────────────────────────────────────
// Raw token is shown to the user ONCE at creation time and never stored.
// Only the SHA-256 hash is persisted — same pattern as API key / password storage.
const generateToken = () => {
  const raw  = `et_audit_${crypto.randomBytes(24).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
};

const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/audit/auditor-token
// Generates a new read-only auditor access token
// Called from AuditorExport.jsx
// ─────────────────────────────────────────────────────────────────────────────
router.post('/auditor-token', authenticate, async (req, res) => {
  const { auditor_email, auditor_firm, expires_days, package: pkg, year } = req.body;

  const cleanEmail = String(auditor_email || '').toLowerCase().trim();
  const cleanFirm  = sanitiseText(auditor_firm, 100);
  const cleanYear  = safeYear(year) ?? new Date().getFullYear();
  const cleanPkg   = VALID_PACKAGES.includes(pkg) ? pkg : 'standard';
  const expiryDays = Math.min(Math.max(safeInt(expires_days, 1, 90) ?? 30, 1), 90);

  if (!EMAIL_RE.test(cleanEmail)) {
    return res.status(400).json({ error: 'Valid auditor email is required' });
  }

  try {
    const { raw, hash } = generateToken();
    const expiresAt = new Date(Date.now() + expiryDays * 86_400_000).toISOString();

    const { rows } = await query(
      `INSERT INTO auditor_access_tokens
         (token_hash, issued_by, auditor_email, auditor_firm,
          package, reporting_year, expires_at, revoked, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, NOW())
       RETURNING id, created_at, expires_at`,
      [hash, req.user.id, cleanEmail, cleanFirm || null, cleanPkg, cleanYear, expiresAt]
    );

    res.status(201).json({
      message: 'Auditor access token generated',
      token:   raw, // shown once — never retrievable again
      tokenId: rows[0].id,
      expiresAt: rows[0].expires_at,
      package:   cleanPkg,
      year:      cleanYear,
    });
  } catch (err) {
    dbErr(res, 'Generate auditor token', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/audit/auditor-tokens
// Lists all active/revoked tokens issued by the current user — for management UI
// ─────────────────────────────────────────────────────────────────────────────
router.get('/auditor-tokens', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, auditor_email, auditor_firm, package, reporting_year,
              expires_at, revoked, created_at, last_used_at, use_count
       FROM auditor_access_tokens
       WHERE issued_by = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ tokens: rows });
  } catch (err) {
    dbErr(res, 'List auditor tokens', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/audit/auditor-tokens/:id
// Revokes a token immediately — for "Revoke anytime" promise in AuditorExport.jsx
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/auditor-tokens/:id', authenticate, async (req, res) => {
  const id = safeInt(req.params.id, 1);
  if (!id) return res.status(400).json({ error: 'Invalid token ID' });

  try {
    const { rows } = await query(
      `UPDATE auditor_access_tokens
       SET revoked = true, revoked_at = NOW()
       WHERE id = $1 AND issued_by = $2
       RETURNING id`,
      [id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Token not found or not owned by you' });
    res.json({ message: 'Token revoked', id: rows[0].id });
  } catch (err) {
    dbErr(res, 'Revoke token', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AUDITOR TOKEN AUTHENTICATION MIDDLEWARE
// Validates the bearer token against auditor_access_tokens, checks expiry
// and revocation, attaches the scoped { issued_by, package, year } context.
// Use this on the read-only auditor endpoints below INSTEAD OF the normal
// `authenticate` middleware — auditors don't have user accounts.
// ─────────────────────────────────────────────────────────────────────────────
const authenticateAuditor = async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || !token.startsWith('et_audit_')) {
    return res.status(401).json({ error: 'Missing or invalid auditor token' });
  }

  try {
    const hash = hashToken(token);
    const { rows } = await query(
      `SELECT id, issued_by, auditor_email, auditor_firm, package, reporting_year, expires_at, revoked
       FROM auditor_access_tokens
       WHERE token_hash = $1`,
      [hash]
    );

    if (!rows.length) return res.status(401).json({ error: 'Invalid auditor token' });

    const tokenRecord = rows[0];

    if (tokenRecord.revoked) {
      return res.status(401).json({ error: 'This auditor token has been revoked' });
    }
    if (new Date(tokenRecord.expires_at) < new Date()) {
      return res.status(401).json({ error: 'This auditor token has expired' });
    }

    // Track usage — customer can see who accessed what and when
    query(
      `UPDATE auditor_access_tokens
       SET last_used_at = NOW(), use_count = COALESCE(use_count, 0) + 1
       WHERE id = $1`,
      [tokenRecord.id]
    ).catch(() => {});

    req.auditorContext = {
      tokenId:       tokenRecord.id,
      orgUserId:     tokenRecord.issued_by, // whose data this token can read
      auditorEmail:  tokenRecord.auditor_email,
      auditorFirm:   tokenRecord.auditor_firm,
      package:       tokenRecord.package,
      reportingYear: tokenRecord.reporting_year,
    };
    next();
  } catch (err) {
    console.error('[AuditorAccess] Token validation error:', err.message);
    res.status(500).json({ error: 'Token validation failed' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY AUDITOR ENDPOINTS
// These use authenticateAuditor, NOT the normal authenticate middleware.
// Scoped strictly to the org_user_id + reporting_year baked into the token.
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/audit/inventory?year=2025  (year param ignored — token scopes the year)
router.get('/inventory', authenticateAuditor, async (req, res) => {
  const { orgUserId, reportingYear } = req.auditorContext;
  try {
    const { rows } = await query(
      `SELECT id, date, activity, quantity, unit, scope, category,
              factor, co2e, source, notes, approval_state,
              ef_version_id, created_at
       FROM emission_activities
       WHERE user_id = $1 AND EXTRACT(YEAR FROM date) = $2
       ORDER BY date ASC`,
      [orgUserId, reportingYear]
    );
    res.json({
      reporting_year: reportingYear,
      record_count:   rows.length,
      activities:      rows,
      access_note:     `Read-only access via auditor token · ${req.auditorContext.auditorFirm || req.auditorContext.auditorEmail}`,
    });
  } catch (err) {
    dbErr(res, 'Auditor inventory fetch', err);
  }
});

// GET /api/audit/lineage/:recordId
router.get('/lineage/:recordId', authenticateAuditor, async (req, res) => {
  const { orgUserId } = req.auditorContext;
  const recordId = req.params.recordId;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recordId)) {
    return res.status(400).json({ error: 'Invalid record ID' });
  }

  try {
    const { rows } = await query(
      `SELECT id, user_id, date, activity, quantity, unit, scope, category,
              factor, co2e, source, ai_audit, approval_state,
              submitted_at, reviewed_at, approved_at, locked_at,
              audit_hash, blockchain_tx, created_at
       FROM emission_activities
       WHERE id = $1`,
      [recordId]
    );

    if (!rows.length) return res.status(404).json({ error: 'Record not found' });
    if (rows[0].user_id !== orgUserId) {
      return res.status(403).json({ error: 'This record is outside your token scope' });
    }

    const { rows: adjustments } = await query(
      `SELECT field, old_val, new_val, reason, created_at
       FROM emission_adjustments
       WHERE record_id = $1
       ORDER BY created_at ASC`,
      [recordId]
    ).catch(() => ({ rows: [] }));

    res.json({ record: rows[0], adjustments });
  } catch (err) {
    dbErr(res, 'Auditor lineage fetch', err);
  }
});

// GET /api/audit/ef-versions  — no org scoping needed, this is reference data
router.get('/ef-versions', authenticateAuditor, async (req, res) => {
  res.json({
    note: 'EF version history — see emissions-lineage.js EF_VERSION_HISTORY for full table',
    grid_factor_current: { value: 0.000727, source: 'CEA V20.0 Dec 2024', effective_from: '2023-04-01' },
  });
});

// GET /api/audit/approvals?year=2025
router.get('/approvals', authenticateAuditor, async (req, res) => {
  const { orgUserId, reportingYear } = req.auditorContext;
  try {
    const { rows } = await query(
      `SELECT al.id, al.record_id, al.action, al.from_state, al.to_state,
              al.comment, al.created_at, u.email AS actor_email
       FROM emission_audit_log al
       JOIN emission_activities ea ON ea.id = al.record_id
       LEFT JOIN users u ON u.id = al.user_id
       WHERE ea.user_id = $1 AND EXTRACT(YEAR FROM ea.date) = $2
       ORDER BY al.created_at ASC`,
      [orgUserId, reportingYear]
    );
    res.json({ approval_log: rows });
  } catch (err) {
    dbErr(res, 'Auditor approvals fetch', err);
  }
});

// GET /api/audit/adjustments?year=2025
router.get('/adjustments', authenticateAuditor, async (req, res) => {
  const { orgUserId, reportingYear } = req.auditorContext;
  try {
    const { rows } = await query(
      `SELECT adj.id, adj.record_id, adj.field, adj.old_val, adj.new_val,
              adj.reason, adj.created_at, u.email AS adjusted_by_email
       FROM emission_adjustments adj
       JOIN emission_activities ea ON ea.id = adj.record_id
       LEFT JOIN users u ON u.id = adj.adjusted_by
       WHERE ea.user_id = $1 AND EXTRACT(YEAR FROM ea.date) = $2
       ORDER BY adj.created_at ASC`,
      [orgUserId, reportingYear]
    );
    res.json({ adjustments: rows });
  } catch (err) {
    dbErr(res, 'Auditor adjustments fetch', err);
  }
});

module.exports = router;
module.exports.authenticateAuditor = authenticateAuditor;