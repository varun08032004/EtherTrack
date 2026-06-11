// routes/suppliers.js — EtherTrack API
// Supplier management: invite, list, update
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const express            = require('express');
const router             = express.Router();
const { safeQuery }      = require('../db/pool');
const { authenticate }   = require('../middleware/auth');

// ── POST /api/suppliers — invite a supplier ───────────────────────────────────
// Body: { name, email, contactPerson?, gstin?, notes? }
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, email, contactPerson, gstin, notes } = req.body;
    const userId = req.user.id;

    if (!name || !email) {
      return res.status(400).json({ error: 'name and email are required.' });
    }

    const existing = await safeQuery(
      `SELECT id FROM suppliers WHERE invited_by = $1 AND email = $2 LIMIT 1`,
      [userId, email.trim().toLowerCase()]
    );
    if (existing.rows.length) {
      return res.status(409).json({ error: 'A supplier with this email already exists.' });
    }

    const { rows } = await safeQuery(
      `INSERT INTO suppliers (name, email, contact_person, gstin, notes, status, invited_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'invited', $6, NOW(), NOW())
       RETURNING *`,
      [name.trim(), email.trim().toLowerCase(), contactPerson || null, gstin || null, notes || null, userId]
    );

    return res.status(201).json({ supplier: rows[0] });
  } catch (err) {
    console.error('[suppliers/POST]', err.message);
    return res.status(500).json({ error: 'Failed to invite supplier.' });
  }
});

// ── GET /api/suppliers — list suppliers invited by the authenticated user ─────
// Query params: status?, page?, limit?
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const status = req.query.status || null;
    const limit  = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const offset = Math.max(parseInt(req.query.page  || '0',  10), 0) * limit;

    const conditions = ['invited_by = $1'];
    const params     = [userId];

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    const where = conditions.join(' AND ');

    const { rows } = await safeQuery(
      `SELECT * FROM suppliers WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    const { rows: countRows } = await safeQuery(
      `SELECT COUNT(*) AS total FROM suppliers WHERE ${where}`,
      params
    );

    return res.json({ suppliers: rows, total: parseInt(countRows[0].total, 10) });
  } catch (err) {
    console.error('[suppliers/GET]', err.message);
    return res.status(500).json({ error: 'Failed to fetch suppliers.' });
  }
});

// ── PATCH /api/suppliers/:id — update supplier status or data ─────────────────
// Body: { status?, name?, contactPerson?, gstin?, notes? }
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const { id }    = req.params;
    const userId    = req.user.id;
    const { status, name, contactPerson, gstin, notes } = req.body;

    // Verify supplier belongs to this user
    const { rows: existing } = await safeQuery(
      `SELECT id FROM suppliers WHERE id = $1 AND invited_by = $2 LIMIT 1`,
      [id, userId]
    );
    if (!existing.length) {
      return res.status(404).json({ error: 'Supplier not found.' });
    }

    const VALID_STATUSES = ['invited', 'active', 'inactive', 'suspended'];
    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}.` });
    }

    const setClauses = [];
    const params     = [];

    const set = (col, val) => {
      if (val !== undefined) {
        params.push(val);
        setClauses.push(`${col} = $${params.length}`);
      }
    };

    set('status',         status);
    set('name',           name?.trim());
    set('contact_person', contactPerson);
    set('gstin',          gstin);
    set('notes',          notes);

    if (!setClauses.length) {
      return res.status(400).json({ error: 'No fields provided to update.' });
    }

    params.push(new Date().toISOString());
    setClauses.push(`updated_at = $${params.length}`);

    params.push(id);
    const { rows } = await safeQuery(
      `UPDATE suppliers SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );

    return res.json({ supplier: rows[0] });
  } catch (err) {
    console.error('[suppliers/PATCH]', err.message);
    return res.status(500).json({ error: 'Failed to update supplier.' });
  }
});

module.exports = router;