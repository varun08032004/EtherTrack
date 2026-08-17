// backend/routes/certificatePDF.js
// Serves retirement certificates as proper server-generated PDFs.
// Replaces the unreliable jsPDF client-side generation.
//
// Wire in server.js:
//   const certPDFRoutes = require('./routes/certificatePDF');
//   app.use('/api/certificates', certPDFRoutes);
//
// Frontend calls:
//   window.open(`/api/certificates/${certId}/pdf`);

const express    = require('express');
const { safeQuery: query }          = require('../db/pool');
const { authenticate }              = require('../middleware/auth');
const { pdfQueue } = require('../services/pdfQueue');

const router = express.Router();

/**
 * GET /api/certificates/:certId/pdf
 * Returns a proper A4 PDF of the retirement certificate.
 * Auth required — user must own the retirement or be in the same org.
 */
router.get('/:certId/pdf', authenticate, async (req, res) => {
  const { certId } = req.params;

  try {
    // Fetch retirement data
    const { rows } = await query(
      `SELECT
         r.certificate_id, r.serial_number, r.project_name, r.standard,
         r.vintage_year, r.amount, r.retire_scope, r.tx_hash,
         r.beneficiary_name, r.beneficiary_entity, r.beneficiary_gstin,
         r.reporting_standard, r.purpose, r.corresponding_adjustment,
         r.retired_at, r.approved_by, r.org_id,
         r.country, r.project_type,
         cb.cbam_eligible, cb.sdg_tags, cb.token_id, cb.methodology_id,
         cb.registry_link,
         u.full_name AS retired_by_name,
         au.full_name AS approved_by_name,
         -- verifier if org has one connected
         ov.verifier_name, ov.verifier_code
       FROM retirements r
       LEFT JOIN carbon_batches cb ON cb.registry_serial = r.serial_number
       LEFT JOIN users u  ON u.id = r.retired_by
       LEFT JOIN users au ON au.id = r.approved_by
       LEFT JOIN org_verifiers ov ON ov.org_id = r.org_id AND ov.status = 'connected'
       WHERE r.certificate_id = $1`,
      [certId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    const row = rows[0];

    // Auth check — user must own or be in same org
    const isOwner = row.retired_by === req.user.id;
    const isOrg   = row.org_id && req.user.org_id === row.org_id;
    if (!isOwner && !isOrg && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const certData = {
      certId:                  row.certificate_id,
      tokenId:                 row.token_id
        ? `0x${Number(row.token_id).toString(16).padStart(8, '0').toUpperCase()}`
        : '—',
      projectName:             row.project_name,
      serialNumber:            row.serial_number,
      standard:                row.standard,
      vintageYear:             row.vintage_year,
      amount:                  row.amount,
      retireScope:             row.retire_scope,
      correspondingAdjustment: row.corresponding_adjustment || 'None',
      beneficiaryName:         row.beneficiary_name,
      beneficiaryEntity:       row.beneficiary_entity,
      beneficiaryGstin:        row.beneficiary_gstin,
      reportingStandard:       row.reporting_standard || 'GHG Protocol',
      purpose:                 row.purpose || 'Voluntary Offset',
      cbamEligible:            row.cbam_eligible,
      sdgTags:                 typeof row.sdg_tags === 'string'
        ? JSON.parse(row.sdg_tags || '[]')
        : (row.sdg_tags || []),
      txHash:                  row.tx_hash,
      verifyUrl:               `${process.env.FRONTEND_URL}/verify/${certId}`,
      retiredByName:           row.retired_by_name,
      approvedByName:          row.approved_by_name,
      verifier:                row.verifier_name
        ? { verifier_name: row.verifier_name, verifier_code: row.verifier_code }
        : null,
    };

    const pdfBuffer = await pdfQueue.generateCertificate(certData);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${certId}.pdf"`
    );
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);

  } catch (err) {
    console.error('[GET /api/certificates/:certId/pdf]', err.message);
    res.status(500).json({ error: 'PDF generation failed', detail: err.message });
  }
});

/**
 * GET /api/certificates/:certId
 * Returns certificate data as JSON (for the verify page)
 * Public — no auth required
 */
router.get('/:certId', async (req, res) => {
  const { certId } = req.params;
  try {
    const { rows } = await query(
      `SELECT
         r.certificate_id, r.project_name, r.standard, r.vintage_year,
         r.amount, r.retire_scope, r.tx_hash, r.retired_at,
         r.beneficiary_name, r.beneficiary_entity,
         r.reporting_standard, r.purpose, r.serial_number,
         r.corresponding_adjustment, r.country,
         cb.icvcm_ccp_eligible, cb.sdg_tags,
         ov.verifier_name
       FROM retirements r
       LEFT JOIN carbon_batches cb ON cb.registry_serial = r.serial_number
       LEFT JOIN org_verifiers ov ON ov.org_id = r.org_id AND ov.status = 'connected'
       WHERE r.certificate_id = $1`,
      [certId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    const row = rows[0];
    res.json({
      certId:          row.certificate_id,
      projectName:     row.project_name,
      standard:        row.standard,
      vintageYear:     row.vintage_year,
      amount:          row.amount,
      retireScope:     row.retire_scope,
      txHash:          row.tx_hash,
      retiredAt:       row.retired_at,
      beneficiaryName: row.beneficiary_name,
      reportingStd:    row.reporting_standard,
      serialNumber:    row.serial_number,
      country:         row.country,
      sdgTags:         typeof row.sdg_tags === 'string'
        ? JSON.parse(row.sdg_tags || '[]')
        : (row.sdg_tags || []),
      icvcmCcp:        row.icvcm_ccp_eligible,
      verifierName:    row.verifier_name || null,
      isValid:         true,
    });
  } catch (err) {
    console.error('[GET /api/certificates/:certId]', err.message);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

module.exports = router;