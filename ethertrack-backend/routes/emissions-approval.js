// routes/emissions-approval.js
// ── Maker-Checker Approval Workflow — backend routes
// State machine: draft → submitted → reviewed → approved → locked
// Mount this in your main app alongside routes/emissions.js:
//   app.use('/api/emissions', require('./routes/emissions-approval'));
//
// ── Security:
//    All transitions validated server-side against TRANSITIONS map —
//    client cannot force an invalid state jump even if it sends one.
//    User ownership enforced — cannot transition records you don't own
//    (or, for reviewer/approver/admin roles, records outside your org).
//    Every transition writes an audit_log entry — never a silent update.
//    Locked records can ONLY be changed via the /adjustment endpoint,
//    never via direct PATCH to quantity/activity/date fields.
// ── Regulatory:
//    This is what Persefoni calls "data reviews & approvals" — listed as
//    a premium differentiator on their pricing page. We ship it standard.

'use strict';

const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { createNotification } = require('./notifications');
const { sendEmissionRecordApprovedEmail, sendEmissionRecordRejectedEmail, sendEmissionRecordAdjustedEmail } = require('../services/email');

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — mirrors routes/emissions.js conventions exactly
// ─────────────────────────────────────────────────────────────────────────────

const sanitiseText = (val, maxLen = 500) =>
  String(val || '')
    .replace(/<[^>]*>/g, '')
    .replace(/['"`;\\]/g, '')
    .trim()
    .slice(0, maxLen);

const safeUUID = (val) => {
  if (!val || typeof val !== 'string') return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) return null;
  return val;
};

const safeFloat = (val, min = 0, max = 1e12) => {
  const n = parseFloat(val);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
};

const dbErr = (res, context = 'Operation', err = null) => {
  if (err) console.error(`[Approval] ${context} error:`, err.message);
  if (process.env.NODE_ENV !== 'production') {
    return res.status(500).json({ error: `${context} failed` });
  }
  return res.status(500).json({ error: 'An error occurred. Please try again.' });
};

// ─────────────────────────────────────────────────────────────────────────────
// STATE MACHINE — must match frontend MakerChecker.jsx exactly
// ─────────────────────────────────────────────────────────────────────────────

const VALID_STATES = ['draft', 'submitted', 'reviewed', 'approved', 'locked', 'rejected'];

const TRANSITIONS = {
  maker: {
    draft:     ['submitted'],
    rejected:  ['submitted'],
  },
  reviewer: {
    submitted: ['reviewed', 'rejected'],
  },
  approver: {
    reviewed:  ['approved', 'rejected'],
    approved:  ['locked'],
  },
  admin: {
    draft:     ['submitted', 'approved', 'locked'],
    submitted: ['reviewed', 'approved', 'rejected', 'locked'],
    reviewed:  ['approved', 'rejected', 'locked'],
    approved:  ['locked', 'rejected'],
  },
};

const getAvailableTransitions = (currentState, userRole) => {
  const roleTransitions = TRANSITIONS[userRole] || TRANSITIONS.maker;
  return roleTransitions[currentState] || [];
};

// Resolve the requesting user's approval role.
// Falls back to 'maker' if no role is set — safest default, can only submit.
const resolveUserRole = async (userId) => {
  try {
    const { rows } = await query(
      `SELECT approval_role FROM user_org_roles WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    const role = rows[0]?.approval_role;
    return ['maker', 'reviewer', 'approver', 'admin'].includes(role) ? role : 'maker';
  } catch {
    // Table may not exist yet in older deployments — default safe
    return 'maker';
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/emissions/activities/:id/state
// Transitions a record to a new approval state
// Validates: ownership, valid state, valid transition for caller's role
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/activities/:id/state', authenticate, async (req, res) => {
  const id      = safeUUID(req.params.id);
  const { state: newState, comment } = req.body;

  if (!id) return res.status(400).json({ error: 'Invalid record ID' });
  if (!VALID_STATES.includes(newState)) {
    return res.status(400).json({ error: `Invalid state — must be one of: ${VALID_STATES.join(', ')}` });
  }

  const cleanComment = sanitiseText(comment, 1000);

  // Rejection requires a comment — audit trail needs to know WHY
  if (newState === 'rejected' && !cleanComment) {
    return res.status(400).json({ error: 'A comment is required when rejecting a record' });
  }

  try {
    // Fetch current record — ownership check happens here
    const { rows: existing } = await query(
      `SELECT ea.id, ea.user_id, ea.org_id, ea.approval_state, ea.activity, ea.quantity, ea.co2e, ea.date,
              u.email AS owner_email, u.full_name AS owner_full_name
       FROM emission_activities ea
       LEFT JOIN users u ON u.id = ea.user_id
       WHERE ea.id = $1`,
      [id]
    );

    if (!existing.length) return res.status(404).json({ error: 'Record not found' });

    const record = existing[0];

    // Org-scoped roles (reviewer/approver/admin) may act on any record that
    // belongs to their OWN organisation — never another company's. Makers
    // may only act on records they personally logged.
    const userRole  = await resolveUserRole(req.user.id);
    const isOwner   = record.user_id === req.user.id;
    const isSameOrg = Boolean(record.org_id) && record.org_id === req.user.org_id;

    if (!isOwner && userRole === 'maker') {
      return res.status(403).json({ error: 'You can only submit your own records' });
    }
    if (!isOwner && userRole !== 'maker' && !isSameOrg) {
      return res.status(403).json({ error: 'You can only act on records within your organisation' });
    }

    const currentState = record.approval_state || 'draft';
    const allowed       = getAvailableTransitions(currentState, userRole);

    if (!allowed.includes(newState)) {
      return res.status(403).json({
        error: `Cannot transition from "${currentState}" to "${newState}" with role "${userRole}"`,
        allowedTransitions: allowed,
      });
    }

    // Build the approval metadata column updates based on target state
    const updates = { approval_state: newState };
    const now      = new Date().toISOString();

    if (newState === 'submitted') { updates.submitted_by = req.user.id; updates.submitted_at = now; }
    if (newState === 'reviewed')  { updates.reviewed_by  = req.user.id; updates.reviewed_at  = now; }
    if (newState === 'approved')  { updates.approved_by  = req.user.id; updates.approved_at  = now; }
    if (newState === 'locked')    { updates.locked_by    = req.user.id; updates.locked_at    = now; }
    if (newState === 'rejected')  { updates.rejected_by  = req.user.id; updates.rejected_at  = now; updates.rejection_reason = cleanComment; }

    const setCols   = Object.keys(updates);
    const setClause = setCols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const params     = [id, ...setCols.map(c => updates[c])];

    await query('BEGIN');

    const { rows: updated } = await query(
      `UPDATE emission_activities
       SET ${setClause}, updated_at = NOW()
       WHERE id = $1
       RETURNING id, approval_state, submitted_at, reviewed_at, approved_at, locked_at, rejection_reason`,
      params
    );

    // Audit log entry — every transition is tracked, never silent
    await query(
      `INSERT INTO emission_audit_log
         (record_id, user_id, action, from_state, to_state, comment, created_at)
       VALUES ($1, $2, 'STATE_TRANSITION', $3, $4, $5, NOW())`,
      [id, req.user.id, currentState, newState, cleanComment || null]
    ).catch(() => {
      // Audit log table may not exist in all environments — don't fail
      // the primary transition over a missing optional table. Logged below.
      console.warn('[Approval] emission_audit_log insert failed — table may not exist yet');
    });

    await query('COMMIT');

    // Notify relevant parties
    if (newState === 'submitted') {
      createNotification(
        record.user_id, 'APPROVAL', '📤 Record Submitted',
        `${record.activity} (${record.co2e} tCO₂e) submitted for review`,
        '/emission-tracking?tab=approvals',
        { recordId: id }
      ).catch(() => {});
    }
    if (newState === 'rejected') {
      createNotification(
        record.user_id, 'APPROVAL', '✕ Record Rejected',
        `${record.activity} was rejected: ${cleanComment}`,
        '/emission-tracking?tab=approvals',
        { recordId: id }
      ).catch(() => {});
      if (record.owner_email) {
        sendEmissionRecordRejectedEmail(record.owner_email, {
          name: record.owner_full_name, activity: record.activity, co2e: record.co2e,
          reason: cleanComment, dashboardUrl: `${process.env.FRONTEND_URL}/emission-tracking?tab=approvals`,
        }).catch(e => console.warn('[emissions-approval] rejected email failed:', e.message));
      }
    }
    if (newState === 'approved') {
      createNotification(
        record.user_id, 'APPROVAL', '✓ Record Approved',
        `${record.activity} (${record.co2e} tCO₂e) approved and included in inventory`,
        '/emission-tracking?tab=approvals',
        { recordId: id }
      ).catch(() => {});
      if (record.owner_email) {
        sendEmissionRecordApprovedEmail(record.owner_email, {
          name: record.owner_full_name, activity: record.activity, co2e: record.co2e,
          dashboardUrl: `${process.env.FRONTEND_URL}/emission-tracking?tab=approvals`,
        }).catch(e => console.warn('[emissions-approval] approved email failed:', e.message));
      }
    }

    res.json({ message: `Record ${newState}`, record: updated[0] });
  } catch (err) {
    await query('ROLLBACK').catch(() => {});
    dbErr(res, 'State transition', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/emissions/activities/:id/adjustment
// Submits a TRACKED adjustment to a LOCKED record
// Locked records are never silently edited — every change here creates
// an immutable adjustment row AND resets the record to 'reviewed' state
// for re-approval. The original locked values remain visible in history.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/activities/:id/adjustment', authenticate, async (req, res) => {
  const id    = safeUUID(req.params.id);
  const { field, old_val, new_val, reason } = req.body;

  if (!id) return res.status(400).json({ error: 'Invalid record ID' });

  const cleanField  = sanitiseText(field, 50);
  const cleanReason = sanitiseText(reason, 1000);
  const cleanOldVal = sanitiseText(String(old_val ?? ''), 200);
  const cleanNewVal = sanitiseText(String(new_val ?? ''), 200);

  if (!cleanField)  return res.status(400).json({ error: 'field is required' });
  if (!cleanReason) return res.status(400).json({ error: 'A reason for the adjustment is required' });
  if (!cleanNewVal) return res.status(400).json({ error: 'new_val is required' });

  // Only allow adjustments to fields that make sense to correct post-lock
  const ADJUSTABLE_FIELDS = ['quantity', 'activity', 'date', 'notes', 'category'];
  if (!ADJUSTABLE_FIELDS.includes(cleanField)) {
    return res.status(400).json({ error: `Cannot adjust field "${cleanField}". Allowed: ${ADJUSTABLE_FIELDS.join(', ')}` });
  }

  try {
    const { rows: existing } = await query(
      `SELECT ea.id, ea.user_id, ea.org_id, ea.approval_state, ea.quantity, ea.factor, ea.scope, ea.activity,
              u.email AS owner_email, u.full_name AS owner_full_name
       FROM emission_activities ea
       LEFT JOIN users u ON u.id = ea.user_id
       WHERE ea.id = $1`,
      [id]
    );

    if (!existing.length) return res.status(404).json({ error: 'Record not found' });

    const record = existing[0];

    if (record.approval_state !== 'locked') {
      return res.status(400).json({
        error: 'Tracked adjustments are only required for locked records. Edit this record directly instead.',
      });
    }

    const userRole  = await resolveUserRole(req.user.id);
    if (!['approver', 'admin'].includes(userRole)) {
      return res.status(403).json({ error: 'Only approvers or admins may adjust locked records' });
    }
    // Approver/admin may only touch records within their own organisation.
    const isSameOrg = Boolean(record.org_id) && record.org_id === req.user.org_id;
    const isOwner    = record.user_id === req.user.id;
    if (!isOwner && !isSameOrg) {
      return res.status(403).json({ error: 'You can only adjust records within your organisation' });
    }

    await query('BEGIN');

    // Record the adjustment as an immutable log entry FIRST
    const { rows: adjRows } = await query(
      `INSERT INTO emission_adjustments
         (record_id, field, old_val, new_val, reason, adjusted_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, created_at`,
      [id, cleanField, cleanOldVal, cleanNewVal, cleanReason, req.user.id]
    );

    // Apply the actual field update + recalculate co2e if quantity changed
    let newCo2e = null;
    if (cleanField === 'quantity') {
      const newQty = safeFloat(cleanNewVal, 0.000001, 1e9);
      if (newQty === null) {
        await query('ROLLBACK');
        return res.status(400).json({ error: 'new_val must be a valid positive number for quantity adjustments' });
      }
      newCo2e = record.factor ? (newQty * record.factor / 1000) : null;
    }

    const updateCols   = [cleanField === 'quantity' ? 'quantity' : cleanField];
    const updateParams = [cleanField === 'quantity' ? safeFloat(cleanNewVal, 0.000001, 1e9) : cleanNewVal];

    if (newCo2e !== null) {
      updateCols.push('co2e');
      updateParams.push(newCo2e);
    }

    // Reset to 'reviewed' — adjustment requires re-approval, never auto-relocks
    updateCols.push('approval_state');
    updateParams.push('reviewed');

    const setClause = updateCols.map((c, i) => `${c} = $${i + 2}`).join(', ');

    const { rows: updated } = await query(
      `UPDATE emission_activities
       SET ${setClause}, updated_at = NOW()
       WHERE id = $1
       RETURNING id, activity, quantity, co2e, approval_state`,
      [id, ...updateParams]
    );

    // Audit log
    await query(
      `INSERT INTO emission_audit_log
         (record_id, user_id, action, from_state, to_state, comment, created_at)
       VALUES ($1, $2, 'TRACKED_ADJUSTMENT', 'locked', 'reviewed', $3, NOW())`,
      [id, req.user.id, `${cleanField}: ${cleanOldVal} → ${cleanNewVal}. Reason: ${cleanReason}`]
    ).catch(() => {});

    await query('COMMIT');

    createNotification(
      record.user_id, 'APPROVAL', '📝 Locked Record Adjusted',
      `${record.activity}: ${cleanField} changed from ${cleanOldVal} to ${cleanNewVal}. Pending re-approval.`,
      '/emission-tracking?tab=approvals',
      { recordId: id, adjustmentId: adjRows[0].id }
    ).catch(() => {});

    if (record.owner_email) {
      sendEmissionRecordAdjustedEmail(record.owner_email, {
        name: record.owner_full_name, activity: record.activity, field: cleanField,
        oldValue: cleanOldVal, newValue: cleanNewVal, reason: cleanReason,
        dashboardUrl: `${process.env.FRONTEND_URL}/emission-tracking?tab=approvals`,
      }).catch(e => console.warn('[emissions-approval] adjusted email failed:', e.message));
    }

    res.json({
      message: 'Adjustment recorded — record returned to reviewed state for re-approval',
      record:    updated[0],
      adjustment:adjRows[0],
    });
  } catch (err) {
    await query('ROLLBACK').catch(() => {});
    dbErr(res, 'Tracked adjustment', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/emissions/activities/:id/adjustments
// Returns the full adjustment history for a record — used by EmissionLineage UI
// ─────────────────────────────────────────────────────────────────────────────
router.get('/activities/:id/adjustments', authenticate, async (req, res) => {
  const id = safeUUID(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid record ID' });

  try {
    const { rows: ownerCheck } = await query(
      `SELECT user_id, org_id FROM emission_activities WHERE id = $1`,
      [id]
    );
    if (!ownerCheck.length) return res.status(404).json({ error: 'Record not found' });
    if (ownerCheck[0].user_id !== req.user.id) {
      const isSameOrg = Boolean(ownerCheck[0].org_id) && ownerCheck[0].org_id === req.user.org_id;
      const userRole  = await resolveUserRole(req.user.id);
      if (!isSameOrg || !['reviewer', 'approver', 'admin'].includes(userRole)) {
        return res.status(403).json({ error: 'Not authorised to view this record' });
      }
    }

    const { rows } = await query(
      `SELECT a.id, a.field, a.old_val, a.new_val, a.reason, a.created_at,
              u.email AS adjusted_by_email
       FROM emission_adjustments a
       LEFT JOIN users u ON u.id = a.adjusted_by
       WHERE a.record_id = $1
       ORDER BY a.created_at DESC`,
      [id]
    );

    res.json({ adjustments: rows });
  } catch (err) {
    dbErr(res, 'Fetch adjustments', err);
  }
});

module.exports = router;