// routes/verify.js — PUBLIC route, no authentication required
const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');

// ── GET /api/verify/:certId — public, no auth ─────────────────────
router.get('/:certId', async (req, res) => {
  const { certId } = req.params;
  if (!certId) return res.status(400).json({ error: 'Certificate ID required' });

  try {
    // ✅ Check retirements table FIRST — has full corporate data
    const { rows: retRows } = await query(
      `SELECT
         r.id, r.certificate_id, r.tx_hash, r.block_number,
         r.amount, r.retire_scope, r.retired_at,
         r.project_name, r.project_type, r.vintage_year,
         r.serial_number, r.developer, r.location, r.country,
         r.standard, r.corresponding_adjustment,
         r.beneficiary_name, r.beneficiary_entity, r.beneficiary_gstin,
         r.reporting_standard, r.purpose,
         r.icvcm_ccp_eligible,
         r.wallet_address,
         u.wallet_address AS user_wallet
       FROM retirements r
       LEFT JOIN users u ON u.id = r.retired_by
       WHERE r.certificate_id = $1
       LIMIT 1`,
      [certId]
    );

    if (retRows.length) {
      const r = retRows[0];
      return res.json({
        certificate_id:           r.certificate_id,
        tx_hash:                  r.tx_hash,
        block_number:             r.block_number,
        amount:                   r.amount,
        retire_scope:             r.retire_scope || '1',
        retired_at:               r.retired_at,
        project_name:             r.project_name || '—',
        project_type:             r.project_type || '—',
        vintage_year:             r.vintage_year || '—',
        serial_number:            r.serial_number || '—',
        developer:                r.developer || '—',
        location:                 r.location || '—',
        country:                  r.country || '—',
        standard:                 r.standard || 'VCS',
        corresponding_adjustment: r.corresponding_adjustment || 'none',
        beneficiary_name:         r.beneficiary_name || '',
        beneficiary_entity:       r.beneficiary_entity || '',
        beneficiary_gstin:        r.beneficiary_gstin || '',
        reporting_standard:       r.reporting_standard || '',
        purpose:                  r.purpose || '',
        icvcm_ccp_eligible:       r.icvcm_ccp_eligible || false,
        wallet_address:           r.wallet_address || r.user_wallet || '',
        source:                   'retirements',
      });
    }

    // ✅ Fall back to registry_transactions + carbon_batches join
    const { rows: txRows } = await query(
      `SELECT
         rt.cert_id              AS certificate_id,
         rt.tx_hash, rt.block_number, rt.amount,
         '1'                     AS retire_scope,
         rt.created_at           AS retired_at,
         rt.project_name, rt.project_type, rt.serial_number,
         rt.developer, rt.location, rt.standard,
         rt.beneficiary          AS beneficiary_name,
         cb.vintage_year, cb.country,
         cb.corresponding_adjustment, cb.icvcm_ccp_eligible,
         COALESCE(rt.from_wallet, u.wallet_address) AS wallet_address
       FROM registry_transactions rt
       LEFT JOIN carbon_batches cb ON cb.token_id = rt.token_id
       LEFT JOIN users u ON u.id = COALESCE(rt.from_user_id, rt.user_id)
       WHERE rt.cert_id = $1
       LIMIT 1`,
      [certId]
    );

    if (!txRows.length) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    const r = txRows[0];
    res.json({
      certificate_id:           r.certificate_id || certId,
      tx_hash:                  r.tx_hash,
      block_number:             r.block_number,
      amount:                   r.amount,
      retire_scope:             '1',
      retired_at:               r.retired_at,
      project_name:             r.project_name || '—',
      project_type:             r.project_type || '—',
      vintage_year:             r.vintage_year || '—',
      serial_number:            r.serial_number || '—',
      developer:                r.developer || '—',
      location:                 r.location || '—',
      country:                  r.country || '—',
      standard:                 r.standard || 'VCS',
      corresponding_adjustment: r.corresponding_adjustment || 'none',
      beneficiary_name:         r.beneficiary_name || '',
      beneficiary_entity:       '',
      beneficiary_gstin:        '',
      reporting_standard:       '',
      purpose:                  '',
      icvcm_ccp_eligible:       r.icvcm_ccp_eligible || false,
      wallet_address:           r.wallet_address || '',
      source:                   'registry_transactions',
    });

  } catch (e) {
    console.error('Verify cert error:', e.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

module.exports = router;