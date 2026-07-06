// ─────────────────────────────────────────────────────────────────────────────
// routes/support.js — EtherTrack Support Widget Backend
// ─────────────────────────────────────────────────────────────────────────────
// Uses the same db/pool.js (safeQuery/withTransaction) as the rest of the app —
// no separate SDK, just plain Postgres via `pg`, matching every other route.
//
// Endpoints:
//   POST  /api/support/tickets         — submit a new ticket (optionalAuth — works logged-out too)
//   GET   /api/support/tickets         — list tickets (admin)
//   PATCH /api/support/tickets/:id     — update ticket status/notes (admin)
//   POST  /api/support/feedback        — log 👍/👎 on a KB answer (optionalAuth)
//   POST  /api/support/unanswered      — log a query Ethi couldn't answer (optionalAuth)
//   GET   /api/support/analytics       — dashboard summary (admin)
//
// Wire into server.js:
//   const supportRoutes = require('./routes/support');
//   app.use('/api/support', supportRoutes);
//   // ⚠️ Remove the old line: app.use('/api/support', userRoutes);
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const router = express.Router();
const { safeQuery } = require('../db/pool');
const { sendEmail } = require('../services/email'); // adjust export name if different
const { authenticate, optionalAuth, requireRole } = require('../middleware/auth');

// requireAdmin from middleware/auth.js is requireRole('admin') only — it does
// NOT include 'superadmin'. AdminDashboard.jsx's render guard treats both
// 'admin' and 'superadmin' as admins, so we match that here rather than using
// the narrower built-in requireAdmin.
const requireAdmin = requireRole('admin', 'superadmin');

// ── Helpers ──────────────────────────────────────────────────────────────
function generateTicketNumber() {
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `ET-${rand}`;
}

function isValidEmail(email) {
  return /\S+@\S+\.\S+/.test(email || '');
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/support/tickets — submit a new ticket. Uses optionalAuth: if a
// valid session cookie/token exists, req.user is populated (so we can record
// user_id); if not, the request still proceeds for anonymous visitors.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/tickets', optionalAuth, async (req, res) => {
  try {
    const { name, email, subject, message, page } = req.body;
    const userId = req.user?.id || null; // present if logged in, null otherwise

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'name, email, and message are required' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const ticketNumber = generateTicketNumber();

    const { rows } = await safeQuery(
      `INSERT INTO support_tickets
         (ticket_number, name, email, subject, message, page, user_id, status, priority, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', 'normal', 'chat_widget')
       RETURNING id, ticket_number, status, created_at`,
      [
        ticketNumber,
        name.trim(),
        email.trim().toLowerCase(),
        (subject || '').trim() || null,
        message.trim(),
        page || null,
        userId,
      ]
    );

    const ticket = rows[0];

    // Fire-and-forget emails — never block the response on email delivery
    sendTicketNotificationEmail({ ...ticket, name, email, subject, message, page }).catch((e) =>
      console.error('[support/tickets] Email notification failed:', e.message)
    );
    sendUserConfirmationEmail({ ...ticket, name, email }).catch((e) =>
      console.error('[support/tickets] User confirmation email failed:', e.message)
    );

    return res.status(201).json({
      ticketId: ticket.ticket_number,
      id: ticket.id,
      status: ticket.status,
      createdAt: ticket.created_at,
    });
  } catch (err) {
    console.error('[support/tickets POST] Error:', err.message);
    return res.status(500).json({ error: 'Failed to create ticket' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/support/tickets — list tickets (admin dashboard)
// Query: ?status=open&search=...&page=1&limit=20
// ─────────────────────────────────────────────────────────────────────────────
router.get('/tickets', authenticate, requireAdmin, async (req, res) => {
  try {
    const { status, search } = req.query;
    const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limitNum = Math.min(100, parseInt(req.query.limit, 10) || 20);
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      conditions.push(
        `(ticket_number ILIKE $${idx} OR email ILIKE $${idx} OR name ILIKE $${idx})`
      );
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await safeQuery(
      `SELECT COUNT(*) AS total FROM support_tickets ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    params.push(limitNum, offset);
    const { rows } = await safeQuery(
      `SELECT * FROM support_tickets ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return res.json({
      tickets: rows,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    });
  } catch (err) {
    console.error('[support/tickets GET] Error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/support/tickets/:id — update status/notes (admin)
// Body: { status?, priority?, adminNotes?, assignedTo? }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/tickets/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, priority, adminNotes, assignedTo } = req.body;

    const sets = [];
    const params = [];

    if (status) {
      const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
      }
      params.push(status);
      sets.push(`status = $${params.length}`);
      if (status === 'resolved' || status === 'closed') {
        sets.push(`resolved_at = now()`);
      }
    }
    if (priority) {
      params.push(priority);
      sets.push(`priority = $${params.length}`);
    }
    if (adminNotes !== undefined) {
      params.push(adminNotes);
      sets.push(`admin_notes = $${params.length}`);
    }
    if (assignedTo !== undefined) {
      params.push(assignedTo);
      sets.push(`assigned_to = $${params.length}`);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    params.push(id);
    const { rows } = await safeQuery(
      `UPDATE support_tickets SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    return res.json({ ticket: rows[0] });
  } catch (err) {
    console.error('[support/tickets PATCH] Error:', err.message);
    return res.status(500).json({ error: 'Failed to update ticket' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/support/feedback — log 👍/👎 on a KB answer
// ─────────────────────────────────────────────────────────────────────────────
router.post('/feedback', optionalAuth, async (req, res) => {
  try {
    const { topicId, topicQuestion, helpful, page, userQuery } = req.body;
    const userId = req.user?.id || null;

    if (!topicId || typeof helpful !== 'boolean') {
      return res.status(400).json({ error: 'topicId and helpful (boolean) are required' });
    }

    await safeQuery(
      `INSERT INTO support_feedback (topic_id, topic_question, helpful, page, user_id, user_query)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [topicId, topicQuestion || null, helpful, page || null, userId, userQuery || null]
    );

    return res.status(201).json({ success: true });
  } catch (err) {
    console.error('[support/feedback] Error:', err.message);
    return res.status(500).json({ error: 'Failed to log feedback' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/support/unanswered — log a query Ethi couldn't answer
// ─────────────────────────────────────────────────────────────────────────────
router.post('/unanswered', optionalAuth, async (req, res) => {
  try {
    const { query, page } = req.body;
    const userId = req.user?.id || null;

    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    await safeQuery(
      `INSERT INTO support_unanswered (query, page, user_id) VALUES ($1, $2, $3)`,
      [query.trim(), page || null, userId]
    );

    return res.status(201).json({ success: true });
  } catch (err) {
    console.error('[support/unanswered] Error:', err.message);
    return res.status(500).json({ error: 'Failed to log query' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/support/analytics — dashboard summary (admin)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/analytics', authenticate, requireAdmin, async (req, res) => {
  try {
    const ticketCountsResult = await safeQuery(
      `SELECT status, COUNT(*) AS count FROM support_tickets GROUP BY status`
    );
    const ticketCounts = {};
    let totalTickets = 0;
    ticketCountsResult.rows.forEach((r) => {
      ticketCounts[r.status] = parseInt(r.count, 10);
      totalTickets += parseInt(r.count, 10);
    });

    const feedbackResult = await safeQuery(
      `SELECT topic_id, topic_question,
              COUNT(*) FILTER (WHERE helpful = true)  AS helpful,
              COUNT(*) FILTER (WHERE helpful = false) AS unhelpful
       FROM support_feedback
       GROUP BY topic_id, topic_question
       ORDER BY unhelpful DESC
       LIMIT 20`
    );
    const topicStats = feedbackResult.rows.map((r) => ({
      topicId: r.topic_id,
      question: r.topic_question,
      helpful: parseInt(r.helpful, 10),
      unhelpful: parseInt(r.unhelpful, 10),
    }));

    const totalFeedbackResult = await safeQuery(`SELECT COUNT(*) AS total FROM support_feedback`);
    const totalFeedback = parseInt(totalFeedbackResult.rows[0].total, 10);

    const unansweredResult = await safeQuery(
      `SELECT lower(trim(query)) AS norm_query, COUNT(*) AS count
       FROM support_unanswered
       WHERE created_at > now() - interval '90 days'
       GROUP BY norm_query
       ORDER BY count DESC
       LIMIT 20`
    );
    const topUnanswered = unansweredResult.rows.map((r) => ({
      query: r.norm_query,
      count: parseInt(r.count, 10),
    }));

    return res.json({
      ticketCounts,
      totalTickets,
      topicStats,
      topUnanswered,
      totalFeedback,
    });
  } catch (err) {
    console.error('[support/analytics] Error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Email helpers
// ─────────────────────────────────────────────────────────────────────────────
async function sendTicketNotificationEmail(ticket) {
  const supportEmail = process.env.ADMIN_EMAIL || process.env.SUPPORT_TEAM_EMAIL || 'support@ethertrack.in';

  await sendEmail({
    to: supportEmail,
    subject: `🎫 New Support Ticket — ${ticket.ticket_number}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px;">
        <h2 style="color: #16a34a;">New Support Ticket</h2>
        <p><strong>Ticket ID:</strong> ${ticket.ticket_number}</p>
        <p><strong>From:</strong> ${ticket.name} (${ticket.email})</p>
        <p><strong>Subject:</strong> ${ticket.subject || '(no subject)'}</p>
        <p><strong>Page:</strong> ${ticket.page || 'unknown'}</p>
        <p><strong>Message:</strong></p>
        <div style="background:#f4f4f4; padding:12px; border-radius:8px;">${ticket.message}</div>
        <p style="margin-top:20px; color:#666; font-size:12px;">
          Submitted at ${new Date(ticket.created_at).toLocaleString('en-IN')}
        </p>
      </div>
    `,
  });
}

async function sendUserConfirmationEmail(ticket) {
  await sendEmail({
    to: ticket.email,
    subject: `We've received your request — ${ticket.ticket_number}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px;">
        <h2 style="color: #16a34a;">Thanks for reaching out, ${ticket.name}!</h2>
        <p>We've received your support request. Here's your ticket reference:</p>
        <p style="font-size: 20px; font-weight: bold; letter-spacing: 1px;">${ticket.ticket_number}</p>
        <p>Our team typically responds within 24 hours.</p>
        <p style="margin-top: 24px; color: #666; font-size: 13px;">
          — The EtherTrack Support Team
        </p>
      </div>
    `,
  });
}

module.exports = router;