// routes/verify.js — PUBLIC route, no authentication required
const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');

// ── GET /api/verify/:certId — public, no auth ─────────────────────
router.get('/:certId', async (req, res) => {
  const { certId } = req.params;
  if (!certId) return res.status(400).json({ error: 'Certificate ID required' });

  try {
    // ✅ Check registry_transactions first (where actual retirements live)
    const { rows: txRows } = await query(
      `SELECT
         rt.id,
         rt.cert_id              AS certificate_id,
         rt.tx_hash,
         rt.block_number,
         rt.amount,
         '1'                     AS retire_scope,
         rt.created_at           AS retired_at,
         rt.project_name,
         rt.project_type,
         NULL                    AS vintage_year,
         rt.serial_number,
         rt.developer,
         rt.location,
         NULL                    AS country,
         rt.standard,
         NULL                    AS corresponding_adjustment,
         rt.beneficiary          AS beneficiary_name,
         NULL                    AS beneficiary_entity,
         NULL                    AS beneficiary_gstin,
         rt.from_wallet          AS wallet_address,
         u.wallet_address        AS user_wallet
       FROM registry_transactions rt
       LEFT JOIN users u ON u.id = COALESCE(rt.from_user_id, rt.user_id)
       WHERE rt.cert_id = $1
       LIMIT 1`,
      [certId]
    );

    if (txRows.length) {
      const r = txRows[0];
      return res.json({
        certificate_id:           r.certificate_id || certId,
        tx_hash:                  r.tx_hash,
        block_number:             r.block_number,
        amount:                   r.amount,
        retire_scope:             r.retire_scope || '1',
        retired_at:               r.retired_at,
        project_name:             r.project_name || '—',
        project_type:             r.project_type || '—',
        vintage_year:             r.vintage_year,
        serial_number:            r.serial_number || '—',
        developer:                r.developer || '—',
        location:                 r.location || '—',
        country:                  r.country || '—',
        standard:                 r.standard || 'VCS',
        corresponding_adjustment: r.corresponding_adjustment || 'none',
        beneficiary_name:         r.beneficiary_name || '',
        beneficiary_entity:       r.beneficiary_entity || '',
        beneficiary_gstin:        r.beneficiary_gstin || '',
        wallet_address:           r.wallet_address || r.user_wallet || '',
        source:                   'registry_transactions',
      });
    }

    // ✅ Fall back to retirements table (future / migrated records)
    const { rows: retRows } = await query(
      `SELECT
         r.id, r.certificate_id, r.tx_hash, r.block_number,
         r.amount, r.retire_scope, r.retired_at, r.created_at,
         r.project_name, r.project_type, r.vintage_year,
         r.serial_number, r.developer, r.location, r.country,
         r.standard, r.corresponding_adjustment,
         r.beneficiary_name, r.beneficiary_entity, r.beneficiary_gstin,
         r.wallet_address,
         u.wallet_address AS retired_by_wallet
       FROM retirements r
       LEFT JOIN users u ON u.id = r.retired_by
       WHERE r.certificate_id = $1
       LIMIT 1`,
      [certId]
    );

    if (!retRows.length) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    const r = retRows[0];
    res.json({
      certificate_id:           r.certificate_id,
      tx_hash:                  r.tx_hash,
      block_number:             r.block_number,
      amount:                   r.amount,
      retire_scope:             r.retire_scope,
      retired_at:               r.retired_at,
      project_name:             r.project_name,
      project_type:             r.project_type,
      vintage_year:             r.vintage_year,
      serial_number:            r.serial_number,
      developer:                r.developer,
      location:                 r.location,
      country:                  r.country,
      standard:                 r.standard,
      corresponding_adjustment: r.corresponding_adjustment,
      beneficiary_name:         r.beneficiary_name,
      beneficiary_entity:       r.beneficiary_entity,
      beneficiary_gstin:        r.beneficiary_gstin,
      wallet_address:           r.wallet_address || r.retired_by_wallet,
      source:                   'retirements',
    });

  } catch (e) {
    console.error('Verify cert error:', e.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

module.exports = router;