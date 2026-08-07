// routes/entities.js
// Multi-entity GHG consolidation + RBAC
// ── Security fixes:
//    equity_pct validated 0–100 (was unbounded — could produce negative consolidated emissions)
//    Email normalised to lowercase, validated against RFC-5322 pattern
//    Entity count per user capped at 100 to prevent unbounded growth
//    PATCH allowed-fields whitelist enforced (was already present, now also type-checked)
//    User ID validated as integer on all routes
//    Role validated against whitelist on all write routes
//    No DB error details leaked to client
//    /users routes correctly registered before /:id (already correct — preserved)

'use strict';

const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { entityActionLimiter } = require('../middleware/rateLimit');

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const sanitiseText = (val, maxLen = 200) =>
  String(val || '').replace(/<[^>]*>/g, '').replace(/['"`;\\]/g, '').trim().slice(0, maxLen);

const safeInt = (val, min = 0, max = 2_147_483_647) => {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

const safeFloat = (val, min = 0, max = 1e12) => {
  const n = parseFloat(val);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

// equity_pct: 0.00–100.00 — anything outside is a data error
const safeEquity = (val) => {
  const n = parseFloat(val);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100; // 2 decimal places max
};

// Normalise and validate email — RFC-5322 simplified pattern
const safeEmail = (val) => {
  const email = String(val || '').toLowerCase().trim().slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
};

const dbErr = (res, context = 'Operation') =>
  res.status(500).json({
    error: process.env.NODE_ENV !== 'production'
      ? `${context} failed`
      : 'An error occurred. Please try again.',
  });

const VALID_ROLES = ['admin', 'editor', 'verifier', 'viewer'];

const VALID_ENTITY_TYPES = [
  'Wholly-owned Subsidiary',
  'Majority-owned Subsidiary (>50%)',
  'Joint Venture',
  'Associate Company',
  'Branch Office',
  'Project Site',
  'Leased Facility',
  'Parent Company',
];

const VALID_CONSOLIDATION_METHODS = ['operational', 'financial', 'equity'];

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/entities
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         id, name, type, cin, gstin, equity_pct,
         operational_control, financial_control, included,
         country, industry, employees, revenue_cr, notes, created_at
       FROM entities
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [req.user.id]
    );
    res.json({ entities: rows });
  } catch {
    dbErr(res, 'Fetch entities');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/entities
// ── Entity count capped at 100 per user
// ── equity_pct validated 0–100
// ── entity type validated against whitelist
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', authenticate, entityActionLimiter, async (req, res) => {
  const {
    name, type, cin, gstin, equity_pct,
    operational_control, financial_control, included,
    country, industry, employees, revenue_cr, notes,
  } = req.body;

  // ── Input validation ──────────────────────────────────────────────
  const cleanName = sanitiseText(name, 200);
  if (!cleanName) return res.status(400).json({ error: 'name is required' });

  const cleanType = VALID_ENTITY_TYPES.includes(type) ? type : 'Wholly-owned Subsidiary';

  // Validate CIN and GSTIN format if provided
  const cleanCin   = String(cin   || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 21);
  const cleanGstin = String(gstin || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);

  if (cleanCin   && !/^[A-Z]{1}[0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9A-Z]{6}$/.test(cleanCin)) {
    return res.status(400).json({ error: 'Invalid CIN format' });
  }
  if (cleanGstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(cleanGstin)) {
    return res.status(400).json({ error: 'Invalid GSTIN format' });
  }

  const cleanEquity    = safeEquity(equity_pct ?? 100);
  if (cleanEquity === null) return res.status(400).json({ error: 'equity_pct must be between 0 and 100' });

  const cleanEmployees = safeInt(employees,   0, 10_000_000) ?? null;
  const cleanRevenue   = safeFloat(revenue_cr, 0, 100_000_000) ?? null;
  const cleanCountry   = sanitiseText(country,  100) || 'India';
  const cleanIndustry  = sanitiseText(industry, 100) || null;
  const cleanNotes     = sanitiseText(notes,    500) || null;

  try {
    // ── Cap entities at 100 per user ──────────────────────────────────
    const { rows: countRows } = await query(
      `SELECT COUNT(*) AS cnt FROM entities WHERE user_id = $1`,
      [req.user.id]
    );
    if (parseInt(countRows[0].cnt, 10) >= 100) {
      return res.status(400).json({ error: 'Maximum 100 entities per account. Please remove unused entities.' });
    }

    const { rows } = await query(
      `INSERT INTO entities
         (user_id, name, type, cin, gstin, equity_pct,
          operational_control, financial_control, included,
          country, industry, employees, revenue_cr, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING
         id, name, type, cin, gstin, equity_pct,
         operational_control, financial_control, included,
         country, industry, employees, revenue_cr, notes, created_at`,
      [
        req.user.id,
        cleanName,
        cleanType,
        cleanCin   || null,
        cleanGstin || null,
        cleanEquity,
        operational_control !== false,
        financial_control   !== false,
        included            !== false,
        cleanCountry,
        cleanIndustry,
        cleanEmployees,
        cleanRevenue,
        cleanNotes,
      ]
    );
    res.status(201).json({ message: 'Entity added', entity: rows[0] });
  } catch {
    dbErr(res, 'Add entity');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// NOTE: /users routes MUST be registered BEFORE /:id — preserved from original
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/entities/users
router.get('/users', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, name, email, role, entity_id, status, created_at
       FROM entity_users
       WHERE owner_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ users: rows });
  } catch {
    dbErr(res, 'Fetch entity users');
  }
});

// POST /api/entities/users
// ── Email validated and normalised to lowercase
// ── Role validated against whitelist
// ── User count capped at 50 per account
router.post('/users', authenticate, entityActionLimiter, async (req, res) => {
  const { name, email, role, entity } = req.body;

  const cleanName  = sanitiseText(name, 200);
  const cleanEmail = safeEmail(email);
  const cleanRole  = VALID_ROLES.includes(role) ? role : 'viewer';

  if (!cleanName)  return res.status(400).json({ error: 'name is required' });
  if (!cleanEmail) return res.status(400).json({ error: 'A valid email address is required' });

  // entity must be 'all' or a valid integer entity ID belonging to this user
  let cleanEntityId = 'all';
  if (entity && entity !== 'all') {
    const eid = safeInt(entity, 1);
    if (!eid) return res.status(400).json({ error: 'Invalid entity ID' });
    // Verify entity belongs to this user
    const { rows: entCheck } = await query(
      `SELECT id FROM entities WHERE id = $1 AND user_id = $2`,
      [eid, req.user.id]
    );
    if (!entCheck.length) return res.status(400).json({ error: 'Entity not found' });
    cleanEntityId = String(eid);
  }

  try {
    // Cap users at 50 per account
    const { rows: countRows } = await query(
      `SELECT COUNT(*) AS cnt FROM entity_users WHERE owner_id = $1`,
      [req.user.id]
    );
    if (parseInt(countRows[0].cnt, 10) >= 50) {
      return res.status(400).json({ error: 'Maximum 50 users per account' });
    }

    const { rows } = await query(
      `INSERT INTO entity_users (owner_id, name, email, role, entity_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, role, entity_id, created_at`,
      [req.user.id, cleanName, cleanEmail, cleanRole, cleanEntityId]
    );
    res.status(201).json({ message: 'User invited', user: rows[0] });
  } catch (err) {
    // Handle unique constraint on email per owner
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This email has already been invited' });
    }
    dbErr(res, 'Invite user');
  }
});

// PATCH /api/entities/users/:id
router.patch('/users/:id', authenticate, entityActionLimiter, async (req, res) => {
  const id = safeInt(req.params.id, 1);
  if (!id) return res.status(400).json({ error: 'Invalid user ID' });

  const { role, status } = req.body;
  const updates = [];
  const params  = [id, req.user.id];

  if (role !== undefined) {
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    }
    params.push(role);
    updates.push(`role = $${params.length}`);
  }

  const validStatuses = ['active', 'suspended', 'pending'];
  if (status !== undefined) {
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
    }
    params.push(status);
    updates.push(`status = $${params.length}`);
  }

  if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' });

  try {
    const { rows } = await query(
      `UPDATE entity_users
       SET ${updates.join(', ')}
       WHERE id = $1 AND owner_id = $2
       RETURNING id, name, email, role, entity_id`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found or not owned by you' });
    res.json({ message: 'User updated', user: rows[0] });
  } catch {
    dbErr(res, 'Update user');
  }
});

// DELETE /api/entities/users/:id
router.delete('/users/:id', authenticate, entityActionLimiter, async (req, res) => {
  const id = safeInt(req.params.id, 1);
  if (!id) return res.status(400).json({ error: 'Invalid user ID' });

  try {
    const { rows } = await query(
      `DELETE FROM entity_users
       WHERE id = $1 AND owner_id = $2
       RETURNING id`,
      [id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found or not owned by you' });
    res.json({ message: 'User removed', id: rows[0].id });
  } catch {
    dbErr(res, 'Remove user');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// /:id routes — AFTER /users (Express route order matters)
// ─────────────────────────────────────────────────────────────────────────────

// PATCH /api/entities/:id
router.patch('/:id', authenticate, entityActionLimiter, async (req, res) => {
  const id = safeInt(req.params.id, 1);
  if (!id) return res.status(400).json({ error: 'Invalid entity ID' });

  // Allowed fields with their types and validators
  const ALLOWED_FIELDS = {
    name:                 (v) => { const s = sanitiseText(v, 200); return s || null; },
    type:                 (v) => VALID_ENTITY_TYPES.includes(v) ? v : null,
    cin:                  (v) => { const s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 21); return s || null; },
    gstin:                (v) => { const s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15); return s || null; },
    equity_pct:           (v) => safeEquity(v),
    operational_control:  (v) => typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : null,
    financial_control:    (v) => typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : null,
    included:             (v) => typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : null,
    country:              (v) => sanitiseText(v, 100) || null,
    industry:             (v) => sanitiseText(v, 100) || null,
    employees:            (v) => safeInt(v, 0, 10_000_000),
    revenue_cr:           (v) => safeFloat(v, 0, 100_000_000),
    notes:                (v) => sanitiseText(v, 500) || null,
  };

  const updates = [];
  const params  = [id, req.user.id];

  for (const [field, validator] of Object.entries(ALLOWED_FIELDS)) {
    if (field in req.body) {
      const cleaned = validator(req.body[field]);
      // equity_pct null means invalid — reject
      if (field === 'equity_pct' && cleaned === null) {
        return res.status(400).json({ error: 'equity_pct must be between 0 and 100' });
      }
      params.push(cleaned);
      updates.push(`${field} = $${params.length}`);
    }
  }

  if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' });

  try {
    const { rows } = await query(
      `UPDATE entities
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id, name, type, cin, gstin, equity_pct, operational_control,
                 financial_control, included, country, industry, employees, revenue_cr, notes`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Entity not found or not owned by you' });
    res.json({ message: 'Entity updated', entity: rows[0] });
  } catch {
    dbErr(res, 'Update entity');
  }
});

// DELETE /api/entities/:id
router.delete('/:id', authenticate, entityActionLimiter, async (req, res) => {
  const id = safeInt(req.params.id, 1);
  if (!id) return res.status(400).json({ error: 'Invalid entity ID' });

  try {
    const { rows } = await query(
      `DELETE FROM entities
       WHERE id = $1 AND user_id = $2
       RETURNING id, name`,
      [id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Entity not found or not owned by you' });
    res.json({ message: 'Entity removed', id: rows[0].id, name: rows[0].name });
  } catch {
    dbErr(res, 'Delete entity');
  }
});

module.exports = router;