// routes/emissions.js
// ── Fix log:
//    [FIX-CEA-KWH]       kWh factors corrected 0.727 → 0.000727 tCO₂e/kWh
//    [FEAT-AI-AUDIT]     Optional AI audit payload on POST /log
//    [FIX-BULK-COUNT]    inserted now tracks actual rowCount, not loop index.
//                        ON CONFLICT DO NOTHING no longer inflates the count.
//                        duplicates returned separately so frontend can show
//                        "847 imported · 12 duplicates skipped · 3 errors"
//    [FIX-BULK-LIMIT]    Raised from 2000 → 20000 rows per batch to match
//                        the frontend's 20k cap.
//    [FEAT-SSE]          GET /stream — Server-Sent Events endpoint.
//                        POST /log and POST /bulk both call broadcastUpdate()
//                        so every connected tab receives a "refresh" event
//                        immediately after a write, making metric cards,
//                        the GHG ledger and analytics update without polling.
//    [FIX-CONFLICT-KEY]  Bulk insert now uses a named unique constraint
//                        (uc_emission_user_date_activity_qty) so ON CONFLICT
//                        targets only true duplicates, not any constraint.
//                        Falls back gracefully if constraint doesn't exist yet.
//    [FEAT-BULK-DELETE]  POST /bulk-delete — deletes multiple records in one
//                        request. Validates all IDs, deletes in one query,
//                        broadcasts SSE delete + bulk_delete events.

'use strict';

const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate }     = require('../middleware/auth');
const { createNotification } = require('./notifications');
const { requirePlan }      = require('../middleware/planGate');
const { writeLimiter }     = require('../middleware/rateLimit');
const { hasPermission }    = require('../middleware/rbac');

// ─────────────────────────────────────────────────────────────────────────────
// [FEAT-ORG-LEDGER] Shared org emissions ledger
// Business accounts (req.user.org_id set) share ONE emissions ledger across
// their team instead of each member having a siloed set of records. Access
// is gated by the existing team_role permission map in middleware/rbac.js:
//   emissions:read   → owner, admin, manager, auditor, viewer (everyone)
//   emissions:write  → owner, admin, manager
//   emissions:delete → owner, admin
// Individual accounts (no org_id) are completely unaffected — they keep
// today's behaviour of managing only their own records, unrestricted.
// ─────────────────────────────────────────────────────────────────────────────
function canAccessEmissions(req, action) {
  if (!req.user.org_id) return true; // solo individual — always allowed on own data
  return hasPermission(req.user.team_role || 'viewer', `emissions:${action}`);
}

// Resolve the WHERE clause + param used to scope a query to "this ledger" —
// the org's shared ledger for business accounts, or just this person's own
// records for individuals. Keeps every route consistent in one place.
function ledgerScope(req, paramIndex = 1) {
  if (req.user.org_id) {
    return { clause: `org_id = $${paramIndex}`, value: req.user.org_id };
  }
  return { clause: `user_id = $${paramIndex}`, value: req.user.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// [FEAT-SSE] In-memory SSE client registry
// ─────────────────────────────────────────────────────────────────────────────
const sseClients = new Map();

function addSseClient(keys, res) {
  const keyArr = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
  for (const k of keyArr) {
    if (!sseClients.has(k)) sseClients.set(k, new Set());
    sseClients.get(k).add(res);
  }
  return () => {
    for (const k of keyArr) {
      sseClients.get(k)?.delete(res);
      if (sseClients.get(k)?.size === 0) sseClients.delete(k);
    }
  };
}

function broadcastUpdate(userId, event = 'emission_update', payload = {}) {
  const clients = sseClients.get(String(userId));
  if (!clients || clients.size === 0) return;
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try { res.write(data); } catch (_) {}
  }
}

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

const safeFloat = (val, min = 0, max = 1e12) => {
  const n = parseFloat(val);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
};

const safeYear  = (val) => safeInt(val, 2000, 2100);
const safeScope = (val) => safeInt(val, 1, 3);

const safeDate = (val) => {
  if (!val || typeof val !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  if (d > new Date(Date.now() + 86_400_000)) return null;
  return val;
};

const safeUUID = (val) => {
  if (!val || typeof val !== 'string') return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) return null;
  return val;
};

const dbErr = (res, context = 'Operation', err = null) => {
  if (err) console.error(`[Emissions] ${context} error:`, err.message);
  return res.status(500).json({
    error: process.env.NODE_ENV !== 'production'
      ? `${context} failed: ${err?.message}`
      : 'An error occurred. Please try again.',
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// [FEAT-AI-AUDIT] Validate and sanitise optional AI audit payload
// ─────────────────────────────────────────────────────────────────────────────
const VALID_EXTRACTION_METHODS = ['manual', 'plain-text', 'pdf-text', 'ocr-image', 'ocr-scanned-pdf'];
const VALID_CONFIDENCE_TIERS   = ['high', 'medium', 'low'];

const buildAiAudit = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const extractionMethod = VALID_EXTRACTION_METHODS.includes(raw.extractionMethod)
    ? raw.extractionMethod : 'manual';
  const confidenceTier = VALID_CONFIDENCE_TIERS.includes(raw.confidenceTier)
    ? raw.confidenceTier : null;
  const ocrConfidence  = (raw.ocrConfidence == null) ? null : safeFloat(raw.ocrConfidence, 0, 100);
  const sourceFileName = raw.sourceFileName ? sanitiseText(raw.sourceFileName, 255) : null;
  const wasEdited      = raw.wasEdited === true;
  let autoExtracted    = null;
  if (raw.autoExtracted && typeof raw.autoExtracted === 'object') {
    autoExtracted = {
      activity: sanitiseText(raw.autoExtracted.activity, 200) || null,
      quantity: safeFloat(raw.autoExtracted.quantity, 0, 1e9),
      date:     safeDate(raw.autoExtracted.date),
      notes:    sanitiseText(raw.autoExtracted.notes, 500) || null,
    };
  }
  return { extractionMethod, confidenceTier, ocrConfidence, sourceFileName, wasEdited, autoExtracted, recordedAt: new Date().toISOString() };
};

// ─────────────────────────────────────────────────────────────────────────────
// Server-side emission factor map — [FIX-CEA-KWH] corrected kWh factors
// ─────────────────────────────────────────────────────────────────────────────
const SERVER_EF = {
  'Electricity India Location (kWh)': 0.000727,
  'Grid Electricity PAT (kWh)':       0.000727,
  'T&D Losses India (kWh)':           0.000073,
  'Diesel (L)':                       2.68,
  'Petrol (L)':                       2.31,
  'Natural Gas (m3)':                 2.02,
  'Coal (kg)':                        2.42,
  'LPG (kg)':                         2.98,
  'Furnace Oil (L)':                  3.18,
  'Refrigerant R-410A (kg)':          2088,
  'Refrigerant R-22 (kg)':            1810,
  'Refrigerant R-32 (kg)':             675,
};

const verifyCO2e = (activity, quantity, claimedCo2e) => {
  const ef = SERVER_EF[activity];
  if (!ef) return true;
  const expected = quantity * ef / 1000;
  return Math.abs(expected - claimedCo2e) / Math.max(expected, 0.0001) < 0.02;
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/emissions/stream
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stream', authenticate, (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write('event: connected\ndata: {"ok":true}\n\n');

  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch (_) { cleanup(); }
  }, 25_000);

  const cleanup = addSseClient(
    [String(req.user.id), req.user.org_id ? String(req.user.org_id) : null],
    res
  );
  req.on('close', () => { clearInterval(heartbeat); cleanup(); });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/emissions/my
// ─────────────────────────────────────────────────────────────────────────────
router.get('/my', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         COALESCE(SUM(total_emissions), 0) AS total_emitted,
         COALESCE(SUM(credits_offset),  0) AS total_offset,
         COALESCE(SUM(net_emissions),   0) AS net_emissions,
         COUNT(*)                          AS report_count
       FROM emission_reports
       WHERE user_id = $1`,
      [req.user.id]
    );
    res.json({
      totalEmitted: parseFloat(rows[0].total_emitted),
      totalOffset:  parseInt(rows[0].total_offset,  10),
      netEmissions: parseFloat(rows[0].net_emissions),
      reportCount:  parseInt(rows[0].report_count,  10),
    });
  } catch (err) { dbErr(res, 'Emissions summary', err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/emissions/activities
// ─────────────────────────────────────────────────────────────────────────────
router.get('/activities', authenticate, async (req, res) => {
  const year  = safeYear(req.query.year);
  const scope = req.query.scope ? safeScope(req.query.scope) : null;
  const from  = req.query.from  ? safeDate(req.query.from)   : null;
  const to    = req.query.to    ? safeDate(req.query.to)     : null;
  const limit = Math.min(safeInt(req.query.limit, 1, 1000) ?? 500, 1000);

  if (req.query.year  && year  === null) return res.status(400).json({ error: 'Invalid year parameter' });
  if (req.query.scope && scope === null) return res.status(400).json({ error: 'Invalid scope — must be 1, 2, or 3' });
  if (req.query.from  && from  === null) return res.status(400).json({ error: 'Invalid from date — use YYYY-MM-DD' });
  if (req.query.to    && to    === null) return res.status(400).json({ error: 'Invalid to date — use YYYY-MM-DD' });
  if (from && to && from > to)           return res.status(400).json({ error: 'from date must be before to date' });

  if (!canAccessEmissions(req, 'read')) {
    return res.status(403).json({ error: 'Your role does not have access to emissions data' });
  }

  try {
    const scope   = ledgerScope(req, 1);
    const params  = [scope.value];
    const clauses = [scope.clause];

    if (year  !== null) { params.push(year);  clauses.push(`EXTRACT(YEAR FROM date) = $${params.length}`); }
    if (scope !== null) { params.push(scope); clauses.push(`scope = $${params.length}`); }
    if (from)           { params.push(from);  clauses.push(`date >= $${params.length}`); }
    if (to)             { params.push(to);    clauses.push(`date <= $${params.length}`); }
    params.push(limit);

    const { rows } = await query(
      `SELECT ea.id, ea.date, ea.activity, ea.quantity, ea.unit, ea.scope, ea.category,
              ea.factor, ea.co2e, ea.source, ea.verified, ea.notes, ea.ai_audit,
              ea.created_at, ea.logged_at, ea.approval_state,
              ea.user_id, u.full_name AS logged_by_name
       FROM emission_activities ea
       LEFT JOIN users u ON u.id = ea.user_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY ea.date DESC
       LIMIT $${params.length}`,
      params
    );
    res.json({ activities: rows, count: rows.length });
  } catch (err) { dbErr(res, 'Fetch activities', err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/emissions/log
// ─────────────────────────────────────────────────────────────────────────────
router.post('/log', authenticate, requirePlan('growth'), writeLimiter, async (req, res) => {
  if (!canAccessEmissions(req, 'write')) {
    return res.status(403).json({ error: 'Your role cannot log emissions — ask an org admin or manager' });
  }

  const { date, activity, quantity, unit, scope, category, factor, co2e, notes, source, aiAudit } = req.body;

  const cleanDate     = safeDate(date);
  const cleanActivity = sanitiseText(activity, 200);
  const cleanQty      = safeFloat(quantity, 0.000001, 1e9);
  const cleanUnit     = sanitiseText(unit,     50);
  const cleanScope    = safeScope(scope);
  const cleanCategory = sanitiseText(category, 200);
  const cleanFactor   = safeFloat(factor,  0, 1e6);
  const cleanCo2e     = safeFloat(co2e,    0, 1e9);
  const cleanNotes    = sanitiseText(notes,  500);
  const cleanSource   = sanitiseText(source, 200);
  const cleanAiAudit  = buildAiAudit(aiAudit);

  if (!cleanDate)          return res.status(400).json({ error: 'Invalid or future date — use YYYY-MM-DD' });
  if (!cleanActivity)      return res.status(400).json({ error: 'activity is required' });
  if (cleanQty === null)   return res.status(400).json({ error: 'quantity must be a positive number' });
  if (cleanScope === null) return res.status(400).json({ error: 'scope must be 1, 2, or 3' });
  if (cleanCo2e === null)  return res.status(400).json({ error: 'co2e must be a non-negative number' });

  if (!verifyCO2e(cleanActivity, cleanQty, cleanCo2e)) {
    return res.status(400).json({ error: 'co2e value does not match server-side emission factor. Possible data tampering.' });
  }

  try {
    const { rows } = await query(
      `INSERT INTO emission_activities
         (user_id, org_id, date, activity, quantity, unit, scope, category, factor, co2e, notes, source, ai_audit, logged_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
       RETURNING id, date, activity, quantity, unit, scope, category, factor, co2e, notes, source, verified, ai_audit, created_at, logged_at`,
      [
        req.user.id, req.user.org_id || null, cleanDate, cleanActivity, cleanQty,
        cleanUnit     || null, cleanScope,
        cleanCategory || null, cleanFactor ?? null, cleanCo2e,
        cleanNotes    || null, cleanSource || null,
        cleanAiAudit  ? JSON.stringify(cleanAiAudit) : null,
      ]
    );

    // Org-shared ledger: broadcast to every team member's connection, not
    // just the person who logged it, so their dashboards live-update too.
    broadcastUpdate(String(req.user.org_id || req.user.id), 'emission_update', {
      action:   'log',
      record:   rows[0],
      co2e:     cleanCo2e,
      scope:    cleanScope,
      activity: cleanActivity,
    });

    if (cleanCo2e >= 0.1) {
      createNotification(
        req.user.id, 'EMISSION', '🌿 Emission Logged',
        `${cleanActivity} — ${cleanQty} ${cleanUnit || ''} = ${cleanCo2e.toFixed(4)} tCO₂e (Scope ${cleanScope})`,
        '/emission-tracking',
        { activity: cleanActivity, co2e: cleanCo2e, scope: cleanScope, date: cleanDate }
      ).catch(() => {});
    }

    res.status(201).json({ message: 'Activity logged', activity: rows[0] });
  } catch (err) { dbErr(res, 'Log emission', err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/emissions/bulk
// ─────────────────────────────────────────────────────────────────────────────
router.post('/bulk', authenticate, requirePlan('growth'), writeLimiter, async (req, res) => {
  if (!canAccessEmissions(req, 'write')) {
    return res.status(403).json({ error: 'Your role cannot log emissions — ask an org admin or manager' });
  }

  const { records } = req.body;

  if (!Array.isArray(records) || records.length === 0)
    return res.status(400).json({ error: 'records must be a non-empty array' });
  if (records.length > 20_000)
    return res.status(400).json({ error: 'Maximum 20,000 records per bulk import' });

  const valid      = [];
  const errSkipped = [];

  for (const r of records) {
    const cleanDate     = safeDate(r.date);
    const cleanActivity = sanitiseText(r.activity, 200);
    const cleanQty      = safeFloat(r.quantity ?? r.qty, 0.000001, 1e9);
    const cleanScope    = r.scope ? safeScope(r.scope) : null;
    const cleanCo2e     = safeFloat(r.co2e, 0, 1e9);

    if (!cleanDate || !cleanActivity || cleanQty === null) {
      errSkipped.push({
        activity: r.activity || '?',
        date:     r.date     || '?',
        reason:   !cleanDate     ? 'Invalid date'
                : !cleanActivity ? 'Missing activity'
                :                  'Invalid quantity',
      });
      continue;
    }

    valid.push({
      date:     cleanDate,
      activity: cleanActivity,
      quantity: cleanQty,
      unit:     sanitiseText(r.unit,     50) || null,
      scope:    cleanScope,
      category: sanitiseText(r.category, 200) || null,
      factor:   safeFloat(r.factor, 0, 1e6) ?? null,
      co2e:     cleanCo2e ?? 0,
      notes:    sanitiseText(r.notes,  500) || null,
      source:   sanitiseText(r.source, 200) || null,
    });
  }

  if (valid.length === 0)
    return res.status(400).json({ error: 'No valid records after validation', errSkipped });

  let inserted   = 0;
  let duplicates = 0;

  try {
    await query('BEGIN');

    for (const r of valid) {
      const { rowCount } = await query(
        `INSERT INTO emission_activities
           (user_id, org_id, date, activity, quantity, unit, scope, category, factor, co2e, notes, source, logged_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
         ON CONFLICT ON CONSTRAINT uc_emission_user_date_activity_qty DO NOTHING
         RETURNING id`,
        [
          req.user.id, req.user.org_id || null, r.date, r.activity, r.quantity, r.unit,
          r.scope, r.category, r.factor, r.co2e, r.notes, r.source,
        ]
      ).catch(async (err) => {
        if (err.code === '42703' || err.message.includes('uc_emission_user_date_activity_qty')) {
          return query(
            `INSERT INTO emission_activities
               (user_id, org_id, date, activity, quantity, unit, scope, category, factor, co2e, notes, source, logged_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [
              req.user.id, req.user.org_id || null, r.date, r.activity, r.quantity, r.unit,
              r.scope, r.category, r.factor, r.co2e, r.notes, r.source,
            ]
          );
        }
        throw err;
      });

      if (rowCount > 0) inserted++;
      else              duplicates++;
    }

    await query('COMMIT');

    broadcastUpdate(String(req.user.org_id || req.user.id), 'emission_update', {
      action:     'bulk',
      inserted,
      duplicates,
      errSkipped: errSkipped.length,
      total:      records.length,
    });

    if (inserted > 0) {
      createNotification(
        req.user.id, 'EMISSION', '📊 Bulk Emissions Imported',
        `${inserted} record${inserted !== 1 ? 's' : ''} imported · ${duplicates} duplicate${duplicates !== 1 ? 's' : ''} skipped`,
        '/emission-tracking',
        { count: inserted, duplicates }
      ).catch(() => {});
    }

    res.json({
      message:    `Imported ${inserted} of ${valid.length} records`,
      inserted,
      duplicates,
      errSkipped: errSkipped.length,
      errDetails: errSkipped,
      total:      records.length,
    });

  } catch (err) {
    await query('ROLLBACK').catch(() => {});
    dbErr(res, 'Bulk import', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/emissions/activities/:id
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/activities/:id', authenticate, writeLimiter, async (req, res) => {
  const id = safeUUID(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid record ID' });

  if (!canAccessEmissions(req, 'delete')) {
    return res.status(403).json({ error: 'Only org owners/admins can delete emissions records' });
  }

  try {
    const scope = ledgerScope(req, 2);
    const { rows } = await query(
      `DELETE FROM emission_activities WHERE id = $1 AND ${scope.clause} RETURNING id`,
      [id, scope.value]
    );
    if (!rows.length) return res.status(404).json({ error: 'Record not found or not in your ledger' });

    broadcastUpdate(String(req.user.org_id || req.user.id), 'emission_update', {
      action: 'delete',
      id:     rows[0].id,
    });

    res.json({ message: 'Deleted', id: rows[0].id });
  } catch (err) { dbErr(res, 'Delete activity', err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/emissions/bulk-delete
// [FEAT-BULK-DELETE] Deletes multiple records in one request.
// Called by GHGLedger.jsx when user confirms bulk deletion via checkboxes.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/bulk-delete', authenticate, writeLimiter, async (req, res) => {
  const { ids } = req.body;

  if (!canAccessEmissions(req, 'delete')) {
    return res.status(403).json({ error: 'Only org owners/admins can delete emissions records' });
  }

  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: 'ids must be a non-empty array' });

  if (ids.length > 500)
    return res.status(400).json({ error: 'Maximum 500 records per bulk delete' });

  const cleanIds = ids.map(id => safeUUID(id)).filter(Boolean);
  if (cleanIds.length !== ids.length)
    return res.status(400).json({ error: 'One or more record IDs are invalid' });

  try {
    const scope = ledgerScope(req, 2);
    const { rows } = await query(
      `DELETE FROM emission_activities
       WHERE id = ANY($1::uuid[]) AND ${scope.clause}
       RETURNING id, activity, co2e, scope`,
      [cleanIds, scope.value]
    );

    if (rows.length === 0)
      return res.status(404).json({
        error: 'No matching records found — they may already be deleted or not in your ledger',
      });

    // Broadcast individual delete events so ledger removes each row live
    for (const r of rows) {
      broadcastUpdate(String(req.user.org_id || req.user.id), 'emission_update', {
        action: 'delete',
        id:     r.id,
      });
    }

    // Also broadcast a bulk_delete summary so summary cards refresh
    broadcastUpdate(String(req.user.org_id || req.user.id), 'emission_update', {
      action:      'bulk_delete',
      deleted:     rows.length,
      notFound:    cleanIds.length - rows.length,
      co2eRemoved: rows.reduce((s, r) => s + parseFloat(r.co2e || 0), 0),
    });

    res.json({
      message:     `${rows.length} record${rows.length !== 1 ? 's' : ''} deleted`,
      deleted:     rows.length,
      notFound:    cleanIds.length - rows.length,
      ids:         rows.map(r => r.id),
      co2eRemoved: rows.reduce((s, r) => s + parseFloat(r.co2e || 0), 0),
    });

  } catch (err) {
    dbErr(res, 'Bulk delete', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/emissions/summary
// ─────────────────────────────────────────────────────────────────────────────
router.get('/summary', authenticate, async (req, res) => {
  if (!canAccessEmissions(req, 'read')) {
    return res.status(403).json({ error: 'Your role does not have access to emissions data' });
  }

  const year = safeYear(req.query.year) ?? new Date().getFullYear();
  const scope = ledgerScope(req, 1); // $1 = org_id or user_id depending on account type

  try {
    const [scopeRows, monthRows, catRows, prevYearRow, s2DetailRows] = await Promise.all([
      query(`SELECT scope, COALESCE(SUM(co2e),0) AS total_co2e, COUNT(*) AS records
             FROM emission_activities WHERE ${scope.clause} AND EXTRACT(YEAR FROM date)=$2
             GROUP BY scope ORDER BY scope`, [scope.value, year]),
      query(`SELECT EXTRACT(MONTH FROM date)::int AS month, scope, COALESCE(SUM(co2e),0) AS total_co2e
             FROM emission_activities WHERE ${scope.clause} AND EXTRACT(YEAR FROM date)=$2
             GROUP BY month, scope ORDER BY month, scope`, [scope.value, year]),
      query(`SELECT category, COALESCE(SUM(co2e),0) AS total_co2e
             FROM emission_activities WHERE ${scope.clause} AND EXTRACT(YEAR FROM date)=$2 AND category IS NOT NULL
             GROUP BY category ORDER BY total_co2e DESC LIMIT 10`, [scope.value, year]),
      query(`SELECT COALESCE(SUM(co2e),0) AS total_co2e
             FROM emission_activities WHERE ${scope.clause} AND EXTRACT(YEAR FROM date)=$2`,
            [scope.value, year - 1]),
      query(`SELECT
               COALESCE(SUM(co2e) FILTER (WHERE category ILIKE '%Location-based%'),0) AS scope2_location,
               COALESCE(SUM(co2e) FILTER (WHERE category ILIKE '%Market-based%'),  0) AS scope2_market
             FROM emission_activities WHERE ${scope.clause} AND EXTRACT(YEAR FROM date)=$2 AND scope=2`,
            [scope.value, year]),
    ]);

    const s    = (sc) => parseFloat(scopeRows.rows.find(r => r.scope === sc)?.total_co2e || 0);
    const scope1 = s(1), scope2 = s(2), scope3 = s(3);
    const total  = scope1 + scope2 + scope3;
    const prevTotal  = parseFloat(prevYearRow.rows[0]?.total_co2e || 0);
    const yoyChange  = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;
    const scope2Location = parseFloat(s2DetailRows.rows[0]?.scope2_location || 0);
    const scope2Market   = parseFloat(s2DetailRows.rows[0]?.scope2_market   || 0);

    res.json({
      year, scope1, scope2, scope3, total,
      scope2Location: scope2Location || scope2, scope2Market,
      creditsNeeded: Math.ceil(total), yoyChange, prevYearTotal: prevTotal,
      scopeBreakdown: scopeRows.rows, monthlyTrend: monthRows.rows,
      categoryBreakdown: catRows.rows,
      meta: {
        gridEmissionFactor: 0.727,
        gridEFKwh:          0.000727,
        gridEFSource:       'CEA V20.0 Dec 2024 (FY 2023-24 weighted average)',
        generatedAt:        new Date().toISOString(),
      },
    });
  } catch (err) { dbErr(res, 'Emission summary', err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/emissions/profile
// ─────────────────────────────────────────────────────────────────────────────
router.get('/profile', authenticate, async (req, res) => {
  try {
    const { rows } = await query(`SELECT * FROM emission_profiles WHERE user_id=$1`, [req.user.id]);
    if (rows[0]) return res.json({ profile: rows[0] });

    // No emission_profiles row saved yet — for business accounts, synthesize
    // a default from the company details captured at signup so the Company
    // Profile tab (and BRSR/report generation) isn't blank on day one. This
    // is NOT persisted until the person explicitly saves the profile.
    if (req.user.is_company_account && req.user.company_name) {
      return res.json({
        profile: {
          user_id:        req.user.id,
          company_name:   req.user.company_name,
          industry:       req.user.industry_sector || null,
          company_cin:    req.user.company_cin     || null,
          company_gstin:  req.user.company_gstin   || null,
          company_pan:    req.user.company_pan     || null,
          company_type:   req.user.company_type    || null,
          revenue_cr:     null,
          employees:      null,
          floor_sqft:     null,
          base_year:      null,
          net_zero_year:  null,
          net_zero_target_co2e: null,
          reporting_year: new Date().getFullYear(),
          is_default:     true, // frontend hint — not yet saved
        },
      });
    }

    res.json({ profile: null });
  } catch (err) { dbErr(res, 'Fetch profile', err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/emissions/profile
// ─────────────────────────────────────────────────────────────────────────────
router.post('/profile', authenticate, writeLimiter, async (req, res) => {
  const {
    companyName, industry, revenueCr, employees, floorSqft,
    netZeroYear, netZeroTargetCo2e, reportingYear,
    companyCin, companyGstin, companyPan, companyType, baseYear,
  } = req.body;

  const cin   = String(companyCin   || '').toUpperCase().trim();
  const gstin = String(companyGstin || '').toUpperCase().trim();
  const pan   = String(companyPan   || '').toUpperCase().trim();

  if (cin   && !/^[A-Z]{1}[0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9A-Z]{6}$/.test(cin))
    return res.status(400).json({ error: 'Invalid CIN format' });
  if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin))
    return res.status(400).json({ error: 'Invalid GSTIN format' });
  if (pan   && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan))
    return res.status(400).json({ error: 'Invalid PAN format' });

  const VALID_INDUSTRIES = ['Manufacturing','IT/Software','Finance','Healthcare','Retail','Logistics','Construction','Energy','Agriculture','Education','Other'];

  try {
    const { rows } = await query(
      `INSERT INTO emission_profiles
         (user_id,company_name,industry,revenue_cr,employees,floor_sqft,
          net_zero_year,net_zero_target_co2e,reporting_year,
          company_cin,company_gstin,company_pan,company_type,base_year,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         company_name=EXCLUDED.company_name, industry=EXCLUDED.industry,
         revenue_cr=EXCLUDED.revenue_cr, employees=EXCLUDED.employees,
         floor_sqft=EXCLUDED.floor_sqft, net_zero_year=EXCLUDED.net_zero_year,
         net_zero_target_co2e=EXCLUDED.net_zero_target_co2e,
         reporting_year=EXCLUDED.reporting_year,
         company_cin=EXCLUDED.company_cin, company_gstin=EXCLUDED.company_gstin,
         company_pan=EXCLUDED.company_pan, company_type=EXCLUDED.company_type,
         base_year=EXCLUDED.base_year, updated_at=NOW()
       RETURNING *`,
      [
        req.user.id,
        sanitiseText(companyName, 200)   || null,
        VALID_INDUSTRIES.includes(industry) ? industry : null,
        safeFloat(revenueCr,        0, 100_000_000)  ?? 0,
        safeInt(employees,          0,  10_000_000)  ?? 0,
        safeInt(floorSqft,          0, 1_000_000_000) ?? 0,
        safeInt(netZeroYear,     2024, 2100)          ?? 2050,
        safeFloat(netZeroTargetCo2e, 0, 1e9)         ?? 0,
        safeYear(reportingYear)                       ?? new Date().getFullYear(),
        cin   || null,
        gstin || null,
        pan   || null,
        sanitiseText(companyType, 100) || null,
        safeYear(baseYear)             ?? 2024,
      ]
    );
    res.json({ message: 'Profile saved', profile: rows[0] });
  } catch (err) { dbErr(res, 'Save profile', err); }
});

module.exports = router;