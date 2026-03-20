// routes/notifications.js
// EtherTrack — Real-time notification system
// ─────────────────────────────────────────────────────────────────
// This file exports:
//   router          — Express router mounted at /api/notifications
//   createNotification(userId, type, title, message, link, meta)
//                  — Helper called from ALL other routes to persist notifications
// ─────────────────────────────────────────────────────────────────

const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate } = require('../middleware/auth');

// ── SSE clients map — userId → [res, res, ...] ────────────────────
// Allows pushing real-time events to connected browser tabs
const sseClients = new Map();

function addSSEClient(userId, res) {
  if (!sseClients.has(userId)) sseClients.set(userId, []);
  sseClients.get(userId).push(res);
}

function removeSSEClient(userId, res) {
  if (!sseClients.has(userId)) return;
  const clients = sseClients.get(userId).filter(r => r !== res);
  if (clients.length === 0) sseClients.delete(userId);
  else sseClients.set(userId, clients);
}

function pushToUser(userId, data) {
  const clients = sseClients.get(userId);
  if (!clients?.length) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => {
    try { res.write(payload); } catch {}
  });
}

// ─────────────────────────────────────────────────────────────────
// HELPER — createNotification
// Called from wallet.js, admin.js, compliance.js, org.js, etc.
// ─────────────────────────────────────────────────────────────────
async function createNotification(userId, type, title, message, link = null, meta = {}) {
  if (!userId || !title || !message) return null;
  try {
    const { rows } = await query(
      `INSERT INTO notifications (user_id, type, title, message, link, meta)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, type || 'SYSTEM', title, message, link, JSON.stringify(meta)]
    );
    const notif = rows[0];
    // Push real-time to any open SSE connections
    if (notif) pushToUser(userId, { event: 'notification', data: notif });
    return notif;
  } catch (e) {
    // Never crash other routes — notifications are non-critical
    console.warn('createNotification failed (non-fatal):', e.message);
    return null;
  }
}

module.exports.createNotification = createNotification;

// ─────────────────────────────────────────────────────────────────
// GET /api/notifications/stream — SSE real-time stream
// Browser connects once, receives events as they happen
// EventSource API doesn't support custom headers so token is passed as query param
// ─────────────────────────────────────────────────────────────────
router.get('/stream',
  // Accept token from query param (EventSource can't set headers)
  (req, res, next) => {
    if (req.query.token) req.headers.authorization = `Bearer ${req.query.token}`;
    next();
  },
  authenticate,
  (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx: disable buffering
  res.flushHeaders();

  // Send initial ping so browser knows connection is alive
  res.write(`data: ${JSON.stringify({ event: 'connected', userId: req.user.id })}\n\n`);

  addSSEClient(req.user.id, res);

  // Heartbeat every 25s to prevent proxy timeout
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeSSEClient(req.user.id, res);
  });
});

// ─────────────────────────────────────────────────────────────────
// GET /api/notifications — fetch all notifications for current user
// ─────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit  || '50'), 100);
    const offset = parseInt(req.query.offset || '0');
    const unreadOnly = req.query.unread === 'true';

    let sql = `
      SELECT id, type, title, message, read, link, meta, created_at
      FROM notifications
      WHERE user_id = $1
    `;
    const params = [req.user.id];

    if (unreadOnly) {
      params.push(false);
      sql += ` AND read = $${params.length}`;
    }

    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await query(sql, params);

    // Unread count
    const { rows: countRows } = await query(
      'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read = false',
      [req.user.id]
    );

    res.json({
      notifications: rows,
      unreadCount:   parseInt(countRows[0].count),
      total:         rows.length,
    });
  } catch (e) {
    console.error('Fetch notifications error:', e);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// ─────────────────────────────────────────────────────────────────
// PUT /api/notifications/:id/read — mark one as read
// ─────────────────────────────────────────────────────────────────
router.put('/:id/read', authenticate, async (req, res) => {
  try {
    await query(
      'UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to mark read' });
  }
});

// ─────────────────────────────────────────────────────────────────
// PUT /api/notifications/read-all — mark all as read
// ─────────────────────────────────────────────────────────────────
router.put('/read-all', authenticate, async (req, res) => {
  try {
    await query(
      'UPDATE notifications SET read = true WHERE user_id = $1 AND read = false',
      [req.user.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to mark all read' });
  }
});

// ─────────────────────────────────────────────────────────────────
// DELETE /api/notifications/:id — delete one
// ─────────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await query(
      'DELETE FROM notifications WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// ─────────────────────────────────────────────────────────────────
// DELETE /api/notifications — clear all
// ─────────────────────────────────────────────────────────────────
router.delete('/', authenticate, async (req, res) => {
  try {
    await query('DELETE FROM notifications WHERE user_id = $1', [req.user.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
});

module.exports.router = router;