// backend/routes/retirementApproval.js
// Replaces the retirement approval logic inside routes/org.js
// Key fix: wraps the entire approve flow in a serializable transaction
// so concurrent approvals of the same request are impossible at DB level.
//
// Wire into your org router:
//   router.post('/:orgId/retirement-queue/:itemId/approve', authenticate, requireOrgRole('admin','owner'), approveRetirement);
//   router.post('/:orgId/retirement-queue/:itemId/reject',  authenticate, requireOrgRole('admin','owner','manager'), rejectRetirement);

const { safeQuery: query, withTransaction } = require('../db/pool');
const { authenticate }                = require('../middleware/auth');

/**
 * POST /api/org/:orgId/retirement-queue/:itemId/approve
 * Atomically:
 *   1. Locks the retirement request row (FOR UPDATE)
 *   2. Checks it's still pending (idempotent — safe to call twice)
 *   3. Checks the serial hasn't already been retired (race condition guard)
 *   4. Inserts into retirements with a unique serial constraint
 *   5. Updates the request status to 'approved'
 *   6. Logs to audit trail
 * If any step fails the whole transaction rolls back.
 */
const approveRetirement = async (req, res) => {
  const { orgId, itemId } = req.params;
  const approverId        = req.user.id;
  const approverName      = req.user.full_name || req.user.email;

  try {
    await withTransaction(async (client) => {
      // Step 1: Lock the request row — prevents two admins approving simultaneously
      const { rows: reqRows } = await client.query(
        `SELECT rr.*, cb.registry_serial, cb.project_name, cb.standard,
                  cb.vintage_year, cb.country, cb.project_type
         FROM retirement_requests rr
         JOIN carbon_batches cb ON cb.id = rr.batch_id
         WHERE rr.id = $1 AND rr.org_id = $2
         FOR UPDATE`,               // ← row-level lock
        [itemId, orgId]
      );

      if (!reqRows.length) {
        throw Object.assign(new Error('Retirement request not found'), { statusCode: 404 });
      }

      const rr = reqRows[0];

      // Step 2: Idempotency check — already approved/rejected
      if (rr.status !== 'pending') {
        throw Object.assign(new Error(`Request already ${rr.status}`), { statusCode: 409 });
      }

      // Step 3: Race condition guard — check serial not already retired
      // The UNIQUE constraint on retirements.serial_number also catches this,
      // but checking here gives a cleaner error message
      const { rows: dupRows } = await client.query(
        `SELECT id FROM retirements WHERE serial_number = $1`,
        [rr.registry_serial]
      );

      if (dupRows.length) {
        throw Object.assign(new Error('This serial number has already been retired'), { statusCode: 409 });
      }

      // Step 4: Generate certificate ID
      const certId = `CERT-${String(rr.token_id || rr.batch_id).padStart(8, '0')}-${Date.now().toString(36).toUpperCase().slice(-6)}`;

      // Step 5: Insert retirement record
      // If a concurrent transaction already inserted (race), the UNIQUE constraint
      // on serial_number will throw here and we catch + rollback cleanly
      await client.query(
        `INSERT INTO retirements
           (batch_id, token_id, serial_number, project_name, standard, vintage_year,
            country, project_type, amount, retire_scope, retired_by, org_id,
            beneficiary_name, beneficiary_entity, beneficiary_gstin,
            reporting_standard, purpose, certificate_id,
            approved_by, approved_at, status, retired_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW(),'completed',NOW())`,
        [
          rr.batch_id, rr.token_id, rr.registry_serial,
          rr.project_name, rr.standard, rr.vintage_year,
          rr.country, rr.project_type, rr.qty, rr.scope,
          rr.requester_id, orgId,
          rr.beneficiary_name, rr.beneficiary_entity, rr.beneficiary_gstin,
          rr.reporting_standard || 'GHG_PROTOCOL',
          rr.purpose || 'voluntary_offset',
          certId,
          approverId,
        ]
      );

      // Step 6: Update request status
      await client.query(
        `UPDATE retirement_requests
         SET status='approved', approved_by=$1, approved_at=NOW(), cert_id=$2
         WHERE id=$3`,
        [approverId, certId, itemId]
      );

      // Step 7: Deduct from batch available_credits
      await client.query(
        `UPDATE carbon_batches
         SET available_credits = GREATEST(0, available_credits - $1),
             retired_credits   = COALESCE(retired_credits, 0) + $2,
             updated_at        = NOW()
         WHERE id = $3`,
        [rr.qty, rr.qty, rr.batch_id]
      );

      // Step 8: Audit log
      await client.query(
        `INSERT INTO audit_logs (org_id, actor_id, actor_role, action, meta, created_at)
         VALUES ($1,$2,$3,'RETIRE_APPROVED',$4,NOW())`,
        [orgId, approverId, req.user.role,
         `${rr.qty} tCO₂ retired from ${rr.project_name} — cert ${certId}`]
      );

      return res.json({
        success:  true,
        certId,
        message:  `Retirement approved — ${rr.qty} tCO₂ burned`,
      });
    });
  } catch (err) {
    // Unique constraint violation = concurrent retirement of same serial
    if (err.code === '23505' && err.constraint === 'unique_serial_retired') {
      return res.status(409).json({
        error: 'Retirement already processed by another admin',
      });
    }

    req.log.error('[approveRetirement]', err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message || 'Approval failed',
    });
  }
};

/**
 * POST /api/org/:orgId/retirement-queue/:itemId/reject
 */
const rejectRetirement = async (req, res) => {
  const { orgId, itemId } = req.params;
  const { reason }        = req.body;
  const rejectorId        = req.user.id;

  if (!reason?.trim()) {
    return res.status(400).json({ error: 'Rejection reason is required for audit trail' });
  }

  try {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, status, project_name, qty
         FROM retirement_requests
         WHERE id=$1 AND org_id=$2 FOR UPDATE`,
        [itemId, orgId]
      );

      if (!rows.length) {
        throw Object.assign(new Error('Request not found'), { statusCode: 404 });
      }

      if (rows[0].status !== 'pending') {
        throw Object.assign(new Error(`Request already ${rows[0].status}`), { statusCode: 409 });
      }

      await client.query(
        `UPDATE retirement_requests
         SET status='rejected', rejected_by=$1, rejected_at=NOW(), rejection_reason=$2
         WHERE id=$3`,
        [rejectorId, reason.trim(), itemId]
      );

      await client.query(
        `INSERT INTO audit_logs (org_id, actor_id, actor_role, action, meta, created_at)
         VALUES ($1,$2,$3,'RETIRE_REJECTED',$4,NOW())`,
        [orgId, rejectorId, req.user.role,
         `Rejected: ${rows[0].project_name} — ${rows[0].qty} tCO₂. Reason: ${reason.trim()}`]
      );

      return res.json({ success: true, message: 'Retirement request rejected' });
    });
  } catch (err) {
    req.log.error('[rejectRetirement]', err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message || 'Rejection failed',
    });
  }
};

module.exports = { approveRetirement, rejectRetirement };