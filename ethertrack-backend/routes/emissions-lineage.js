// routes/emissions-lineage.js
// ── Source-to-Number Lineage — backend route
// Returns the complete provenance chain for a single emission record:
// file → user → timestamp → EF version → approver → blockchain anchor
//
// This is what makes a tCO2e figure forensically defensible rather than
// just a dashboard statistic. Called by EmissionLineage.jsx.
//
// Mount alongside the other emissions routes:
//   app.use('/api/emissions', require('./routes/emissions-lineage'));
//
// ── Security:
//    Ownership check — caller must own the record OR hold reviewer/
//    approver/admin role. Never leaks other users' data.
//    All IDs validated as UUID before query.

'use strict';

const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate } = require('../middleware/auth');

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const safeUUID = (val) => {
  if (!val || typeof val !== 'string') return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) return null;
  return val;
};

const dbErr = (res, context = 'Operation', err = null) => {
  if (err) console.error(`[Lineage] ${context} error:`, err.message);
  if (process.env.NODE_ENV !== 'production') {
    return res.status(500).json({ error: `${context} failed` });
  }
  return res.status(500).json({ error: 'An error occurred. Please try again.' });
};

const resolveUserRole = async (userId) => {
  try {
    const { rows } = await query(
      `SELECT approval_role FROM user_org_roles WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    const role = rows[0]?.approval_role;
    return ['maker', 'reviewer', 'approver', 'admin'].includes(role) ? role : 'maker';
  } catch {
    return 'maker';
  }
};

// ── EF version lookup — mirrors emissionFactorVersioning.js on the frontend ──
// Kept here too so lineage reports are self-contained even if a record's
// stored ef_version_id is missing (older records pre-dating versioning).
const EF_VERSION_HISTORY = {
  'Electricity India — Location (kWh)': [
    { version_id: 'CEA-V18-FY2122', value: 0.000716, source: 'CEA V18.0 — FY 2021-22', effective_from: '2021-04-01', effective_to: '2022-03-31' },
    { version_id: 'CEA-V19-FY2223', value: 0.000722, source: 'CEA V19.0 — FY 2022-23', effective_from: '2022-04-01', effective_to: '2023-03-31' },
    { version_id: 'CEA-V20-FY2324', value: 0.000727, source: 'CEA V20.0 Dec 2024 — FY 2023-24', effective_from: '2023-04-01', effective_to: null },
  ],
  'Diesel (L)': [
    { version_id: 'DEFRA-2022-DIESEL', value: 0.00260, source: 'DEFRA 2022', effective_from: '2022-01-01', effective_to: '2023-12-31' },
    { version_id: 'DEFRA-2024-DIESEL', value: 0.00268, source: 'DEFRA 2024', effective_from: '2024-01-01', effective_to: null },
  ],
};

const getEFVersionForDate = (activity, date) => {
  const versions = EF_VERSION_HISTORY[activity];
  if (!versions) return null;
  const d = new Date(date);
  return versions.find(v => {
    const from = new Date(v.effective_from);
    const to   = v.effective_to ? new Date(v.effective_to) : new Date('2099-12-31');
    return d >= from && d <= to;
  }) || versions.find(v => !v.effective_to) || versions[versions.length - 1];
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/emissions/activities/:id/lineage
// Returns the full provenance chain for one record
// ─────────────────────────────────────────────────────────────────────────────
router.get('/activities/:id/lineage', authenticate, async (req, res) => {
  const id = safeUUID(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid record ID' });

  try {
    // ── Main record ──────────────────────────────────────────────────────────
    const { rows: recordRows } = await query(
      `SELECT
         id, user_id, date, activity, quantity, unit, scope, category,
         factor, co2e, source, notes, verified, ai_audit,
         approval_state, submitted_by, submitted_at,
         reviewed_by, reviewed_at, approved_by, approved_at,
         locked_by, locked_at, rejection_reason,
         audit_hash, blockchain_tx, created_at, updated_at
       FROM emission_activities
       WHERE id = $1`,
      [id]
    );

    if (!recordRows.length) return res.status(404).json({ error: 'Record not found' });
    const record = recordRows[0];

    // ── Ownership / role check ───────────────────────────────────────────────
    if (record.user_id !== req.user.id) {
      const userRole = await resolveUserRole(req.user.id);
      if (!['reviewer', 'approver', 'admin'].includes(userRole)) {
        return res.status(403).json({ error: 'Not authorised to view this record' });
      }
    }

    // ── Resolve display names for created_by / approved_by / locked_by ──────
    const userIds = [
      record.user_id, record.submitted_by, record.reviewed_by,
      record.approved_by, record.locked_by,
    ].filter(Boolean);

    let userMap = {};
    if (userIds.length) {
      const { rows: userRows } = await query(
        `SELECT id, email, full_name FROM users WHERE id = ANY($1)`,
        [userIds]
      ).catch(() => ({ rows: [] }));
      userMap = userRows.reduce((acc, u) => {
        acc[u.id] = u.full_name || u.email || 'Unknown user';
        return acc;
      }, {});
    }

    // ── Adjustment history ───────────────────────────────────────────────────
    const { rows: adjustments } = await query(
      `SELECT a.id, a.field, a.old_val, a.new_val, a.reason, a.created_at,
              u.email AS adjusted_by_email, u.full_name AS adjusted_by_name
       FROM emission_adjustments a
       LEFT JOIN users u ON u.id = a.adjusted_by
       WHERE a.record_id = $1
       ORDER BY a.created_at ASC`,
      [id]
    ).catch(() => ({ rows: [] }));

    // ── Full audit log for this record (every state transition) ─────────────
    const { rows: auditLog } = await query(
      `SELECT al.id, al.action, al.from_state, al.to_state, al.comment, al.created_at,
              u.email AS user_email, u.full_name AS user_name
       FROM emission_audit_log al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE al.record_id = $1
       ORDER BY al.created_at ASC`,
      [id]
    ).catch(() => ({ rows: [] }));

    // ── Resolve EF version used at the time of calculation ──────────────────
    const efVersion = getEFVersionForDate(record.activity, record.date);

    // ── Determine source intake channel from ai_audit or source field ───────
    const aiAudit = record.ai_audit || null;
    let sourceChannel = 'manual';
    if (aiAudit?.extractionMethod) {
      sourceChannel = aiAudit.extractionMethod.startsWith('ocr') || aiAudit.extractionMethod === 'pdf-text'
        ? 'ai_parser'
        : 'manual';
    } else if (record.source?.toLowerCase().includes('csv')) {
      sourceChannel = 'csv_import';
    } else if (record.source?.toLowerCase().includes('erp')) {
      sourceChannel = 'erp_sync';
    } else if (record.source?.toLowerCase().includes('ai parser')) {
      sourceChannel = 'ai_parser';
    }

    // ── Build the unified lineage response ───────────────────────────────────
    const lineage = {
      record_id:      record.id,
      activity:       record.activity,
      quantity:       parseFloat(record.quantity),
      unit:            record.unit,
      co2e:           parseFloat(record.co2e),
      scope:           record.scope,
      category:        record.category,
      date:            record.date,

      // Data provenance
      source_channel:  sourceChannel,
      source_file:     aiAudit?.sourceFileName || null,
      created_by:      userMap[record.user_id] || 'Unknown user',
      created_at:      record.created_at,

      // AI parser specific audit trail (null if not AI-parsed)
      ai_audit: aiAudit ? {
        extraction_method:    aiAudit.extractionMethod,
        confidence_tier:       aiAudit.confidenceTier,
        ocr_confidence:        aiAudit.ocrConfidence,
        was_edited:            aiAudit.wasEdited,
        auto_extracted_values: aiAudit.autoExtracted,
        recorded_at:           aiAudit.recordedAt,
      } : null,

      // Emission factor version
      ef_version_id:    efVersion?.version_id   || 'CURRENT',
      ef_value:          record.factor,
      ef_source:          efVersion?.source       || record.source,
      ef_effective:      efVersion?.effective_from || null,

      // Approval chain
      approval_state:    record.approval_state || 'draft',
      submitted_by:      userMap[record.submitted_by] || null,
      submitted_at:      record.submitted_at,
      reviewed_by:        userMap[record.reviewed_by]   || null,
      reviewed_at:        record.reviewed_at,
      approved_by:        userMap[record.approved_by]   || null,
      approved_at:        record.approved_at,
      locked_by:          userMap[record.locked_by]     || null,
      locked_at:          record.locked_at,
      rejection_reason:  record.rejection_reason,

      // Tracked adjustments
      adjustments: adjustments.map(a => ({
        id:          a.id,
        field:       a.field,
        old_val:     a.old_val,
        new_val:     a.new_val,
        reason:      a.reason,
        adjusted_by: a.adjusted_by_name || a.adjusted_by_email || 'Unknown',
        created_at:  a.created_at,
      })),

      // Full state transition history
      audit_log: auditLog.map(l => ({
        action:      l.action,
        from_state:  l.from_state,
        to_state:    l.to_state,
        comment:     l.comment,
        user:        l.user_name || l.user_email || 'Unknown',
        created_at:  l.created_at,
      })),

      // Blockchain anchor (if this record was anchored — links to AuditTrail.jsx)
      audit_hash:     record.audit_hash,
      blockchain_tx:  record.blockchain_tx,
    };

    res.json({ lineage });
  } catch (err) {
    dbErr(res, 'Fetch lineage', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/emissions/ef-versions
// Returns the full EF version history — used for audit transparency
// and the "EF Changelog" tooltip in ManualEntry.jsx
// ─────────────────────────────────────────────────────────────────────────────
router.get('/ef-versions', authenticate, async (req, res) => {
  try {
    res.json({ ef_versions: EF_VERSION_HISTORY });
  } catch (err) {
    dbErr(res, 'Fetch EF versions', err);
  }
});

module.exports = router;