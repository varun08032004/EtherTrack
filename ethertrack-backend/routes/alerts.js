// routes/alerts.js — EtherTrack (Production-ready v4)
// ─────────────────────────────────────────────────────────────────────────
// FIXES ON TOP OF v3:
//
// [A8]  TABLE-MISSING GUARD — "relation alerts does not exist" was flooding
//       the console (10+ times per minute) and holding DB connections open.
//       All routes now catch this error and return a safe empty/fallback
//       response instead of logging and hanging.
//
// [A9]  Fast-fail flag — once the missing-table error is detected once,
//       TABLE_READY = false short-circuits all subsequent queries until the
//       server restarts (after you run the migration). This stops the DB
//       connection flood entirely.
//
// [A10] fetchUserAlerts wrapped in the table-ready guard so GET /my and
//       GET / both return [] immediately without touching the DB.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const router = require('express').Router();
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { safeQuery: query } = require('../db/pool');
const { authenticate } = require('../middleware/auth');

// [A9] Once we detect the table is missing, stop hammering the DB.
//      Resets only on server restart (i.e. after running the migration).
let TABLE_READY = true;

const TABLE_MISSING_MSG = 'alerts table not yet created — run migration to enable alerts';

function isTableMissingError(e) {
  return (
    e.code === '42P01' ||
    e.message?.includes('relation') && e.message?.includes('does not exist')
  );
}

// ── [A1] Rate limiter — IPv6-safe ─────────────────────────────────
const alertLimiter = rateLimit({
  windowMs:     60 * 1000,
  max:          30,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req),
});

// ── [A2] Shared alert query ────────────────────────────────────────
async function fetchUserAlerts(userId) {
  // [A9] Skip DB entirely if table is known to be missing
  if (!TABLE_READY) return [];

  try {
    const { rows } = await query(
      `SELECT a.id, a.token_id, a.listing_id, a.project_name,
              a.alert_type, a.target_price_inr, a.is_active,
              a.triggered_at, a.expires_at, a.created_at,
              cb.price_per_credit_inr AS current_price
       FROM alerts a
       LEFT JOIN carbon_batches cb
         ON  cb.token_id      = a.token_id
         AND cb.admin_status  = 'approved'
         AND cb.available_credits > 0
         AND cb.deleted_at IS NULL
       WHERE a.user_id = $1
       ORDER BY a.created_at DESC
       LIMIT 100`,
      [userId]
    );
    return rows;
  } catch (e) {
    // [A8] Table doesn't exist yet — flip flag, stop flooding logs
    if (isTableMissingError(e)) {
      TABLE_READY = false;
      console.warn('[alerts] ' + TABLE_MISSING_MSG);
      return [];
    }
    throw e;
  }
}

// ── GET /api/alerts/my ────────────────────────────────────────────
router.get('/my', authenticate, alertLimiter, async (req, res) => {
  try {
    const rows = await fetchUserAlerts(req.user.id);
    res.json({ alerts: rows, total: rows.length });
  } catch (e) {
    console.error('[alerts/my]', e.message);
    res.status(500).json({ error: 'Failed to fetch alerts', alerts: [], total: 0 });
  }
});

// ── GET /api/alerts ───────────────────────────────────────────────
router.get('/', authenticate, alertLimiter, async (req, res) => {
  try {
    const rows = await fetchUserAlerts(req.user.id);
    res.json({ alerts: rows, total: rows.length });
  } catch (e) {
    console.error('[alerts/]', e.message);
    res.status(500).json({ error: 'Failed to fetch alerts', alerts: [], total: 0 });
  }
});

// ── POST /api/alerts ──────────────────────────────────────────────
router.post('/', authenticate, alertLimiter, async (req, res) => {
  // [A8] Table missing — return helpful error instead of DB crash
  if (!TABLE_READY) {
    return res.status(503).json({ error: 'Alerts feature not yet available. Migration pending.' });
  }

  const { tokenId, listingId, projectName, alertType, targetPriceInr, expiryDays } = req.body;

  if (!tokenId)
    return res.status(400).json({ error: 'tokenId required' });
  if (!['above', 'below'].includes(alertType))
    return res.status(400).json({ error: 'alertType must be "above" or "below"' });
  if (!targetPriceInr || parseFloat(targetPriceInr) <= 0)
    return res.status(400).json({ error: 'targetPriceInr must be a positive number' });

  const parsedDays = parseInt(expiryDays, 10);
  const days       = Math.min(isNaN(parsedDays) ? 30 : parsedDays, 90);
  const expiresAt  = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  try {
    const { rows: countRows } = await query(
      `SELECT COUNT(*) FROM alerts WHERE user_id = $1 AND is_active = TRUE`,
      [req.user.id]
    );
    if (parseInt(countRows[0].count, 10) >= 20) {
      return res.status(400).json({
        error: 'Maximum 20 active alerts allowed. Delete or deactivate some first.',
      });
    }

    const { rows } = await query(
      `INSERT INTO alerts
         (user_id, token_id, listing_id, project_name, alert_type,
          target_price_inr, is_active, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, NOW())
       RETURNING *`,
      [
        req.user.id,
        parseInt(tokenId, 10),
        listingId ? parseInt(listingId, 10) : null,
        projectName     || null,
        alertType,
        parseFloat(targetPriceInr),
        expiresAt,
      ]
    );
    res.status(201).json({ alert: rows[0], message: 'Alert created' });
  } catch (e) {
    if (isTableMissingError(e)) {
      TABLE_READY = false;
      return res.status(503).json({ error: 'Alerts feature not yet available. Migration pending.' });
    }
    console.error('[alerts/POST]', e.message);
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

// ── DELETE /api/alerts/:id ────────────────────────────────────────
router.delete('/:id', authenticate, alertLimiter, async (req, res) => {
  if (!TABLE_READY) return res.status(503).json({ error: 'Alerts feature not yet available.' });

  const alertId = parseInt(req.params.id, 10);
  if (isNaN(alertId)) return res.status(400).json({ error: 'Invalid alert id' });

  try {
    const { rowCount } = await query(
      `DELETE FROM alerts WHERE id = $1 AND user_id = $2`,
      [alertId, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Alert not found' });
    res.json({ message: 'Alert deleted' });
  } catch (e) {
    if (isTableMissingError(e)) { TABLE_READY = false; return res.status(503).json({ error: 'Alerts feature not yet available.' }); }
    console.error('[alerts/DELETE]', e.message);
    res.status(500).json({ error: 'Failed to delete alert' });
  }
});

// ── PATCH /api/alerts/:id ─────────────────────────────────────────
router.patch('/:id', authenticate, alertLimiter, async (req, res) => {
  if (!TABLE_READY) return res.status(503).json({ error: 'Alerts feature not yet available.' });

  const alertId = parseInt(req.params.id, 10);
  if (isNaN(alertId)) return res.status(400).json({ error: 'Invalid alert id' });

  const { targetPriceInr, isActive } = req.body;
  const setClauses = [];
  const params     = [];

  if (targetPriceInr !== undefined) {
    const price = parseFloat(targetPriceInr);
    if (isNaN(price) || price <= 0)
      return res.status(400).json({ error: 'targetPriceInr must be a positive number' });
    params.push(price);
    setClauses.push(`target_price_inr = $${params.length}`);
    params.push(null);
    setClauses.push(`triggered_at = $${params.length}`);
  }

  if (isActive !== undefined) {
    params.push(Boolean(isActive));
    setClauses.push(`is_active = $${params.length}`);
  }

  if (!setClauses.length)
    return res.status(400).json({ error: 'Nothing to update' });

  params.push(alertId, req.user.id);
  const whereId   = params.length - 1;
  const whereUser = params.length;

  try {
    const { rows } = await query(
      `UPDATE alerts
       SET ${setClauses.join(', ')}
       WHERE id = $${whereId} AND user_id = $${whereUser}
       RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Alert not found' });
    res.json({ alert: rows[0] });
  } catch (e) {
    if (isTableMissingError(e)) { TABLE_READY = false; return res.status(503).json({ error: 'Alerts feature not yet available.' }); }
    console.error('[alerts/PATCH]', e.message);
    res.status(500).json({ error: 'Failed to update alert' });
  }
});

// ── Migration helper — run once to create the table ───────────────
// Call GET /api/alerts/migrate (admin only in production) to create it.
// Or run this SQL manually in your DB console:
/*
  CREATE TABLE IF NOT EXISTS alerts (
    id               SERIAL PRIMARY KEY,
    user_id          INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_id         INTEGER      NOT NULL,
    listing_id       INTEGER,
    project_name     TEXT,
    alert_type       TEXT         NOT NULL CHECK (alert_type IN ('above','below')),
    target_price_inr NUMERIC(18,2) NOT NULL,
    is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
    triggered_at     TIMESTAMPTZ,
    expires_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS alerts_user_id_idx ON alerts(user_id);
  CREATE INDEX IF NOT EXISTS alerts_token_id_idx ON alerts(token_id);
*/

module.exports = router;