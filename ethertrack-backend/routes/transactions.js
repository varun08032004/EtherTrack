// routes/transactions.js
const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate } = require('../middleware/auth');

// ── GET /api/transactions/stats ───────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [trades, retired, volume, users] = await Promise.all([
      query(`SELECT COUNT(*) FROM registry_transactions
             WHERE tx_type IN ('BUY','SELL','buy','sell')
                OR type::text IN ('BUY','SELL','buy','sell')`),
      query(`SELECT COALESCE(SUM(retired_credits),0) AS total FROM carbon_batches`),
      query(`SELECT COALESCE(SUM(total_price_inr),0) AS total
             FROM registry_transactions
             WHERE tx_type IN ('BUY','SELL','buy','sell')`),
      query(`SELECT COUNT(*) FROM users WHERE kyc_verified=TRUE`),
    ]);
    res.json({
      totalTrades:    parseInt(trades.rows[0].count),
      totalRetired:   parseInt(retired.rows[0].total),
      totalVolumeINR: parseFloat(volume.rows[0].total),
      verifiedUsers:  parseInt(users.rows[0].count),
    });
  } catch (e) {
    console.error('Stats error:', e.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ── GET /api/transactions/my ──────────────────────────────────────
router.get('/my', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT rt.*,
              p.name AS project_name_joined,
              p.standard::text AS standard_joined
       FROM registry_transactions rt
       LEFT JOIN projects p ON p.id = rt.project_id
       WHERE rt.from_user_id = $1 OR rt.to_user_id = $1 OR rt.user_id = $1
       ORDER BY rt.created_at DESC NULLS LAST
       LIMIT 50`,
      [req.user.id]
    );
    const transactions = rows.map(r => ({
      ...r,
      tx_type:      r.tx_type || r.type,
      quantity:     r.amount  || r.quantity || 0,
      project_name: r.project_name || r.project_name_joined || '—',
      standard:     r.standard     || r.standard_joined     || '—',
    }));
    res.json({ transactions });
  } catch (e) {
    console.error('My transactions error:', e.message);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// ── POST /api/transactions/sync ───────────────────────────────────
router.post('/sync', authenticate, async (req, res) => {
  const { txHash, txType, tokenId, quantity, totalPriceInr, projectName, standard } = req.body;
  if (!txHash || !txType) return res.status(400).json({ error: 'txHash and txType required' });
  try {
    const { rows } = await query(
      `INSERT INTO registry_transactions
         (user_id, from_user_id, tx_hash, tx_type, token_id, amount,
          total_price_inr, project_name, standard)
       VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tx_hash) DO NOTHING
       RETURNING id`,
      [req.user.id, txHash, txType, tokenId||null,
       quantity||0, totalPriceInr||0, projectName||null, standard||null]
    );
    res.json({ message: 'Synced', id: rows[0]?.id || null });
  } catch (e) {
    console.error('Sync error:', e.message);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// ── GET /api/transactions/retirements ─────────────────────────────
router.get('/retirements', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         rt.id,
         rt.cert_id                AS certificate_id,
         rt.cert_id,
         rt.token_id,
         rt.amount,
         rt.tx_hash,
         rt.block_number,
         rt.project_name,
         rt.project_type,
         rt.standard,
         rt.serial_number,
         rt.developer,
         rt.location,
         rt.beneficiary,
         rt.beneficiary            AS beneficiary_name,
         rt.created_at,
         rt.created_at             AS retired_at,
         cb.vintage_year,
         cb.country,
         cb.expiry_date,
         cb.registry_serial,
         cb.icvcm_ccp_eligible,
         cb.corresponding_adjustment,
         cb.sdg_tags,
         cb.credit_type,
         u.wallet_address
       FROM registry_transactions rt
       LEFT JOIN carbon_batches cb ON cb.token_id = rt.token_id
       LEFT JOIN users u ON u.id = rt.user_id
       WHERE (rt.from_user_id=$1 OR rt.user_id=$1)
         AND (rt.tx_type='RETIRE' OR rt.type::text='RETIRE')
       ORDER BY rt.created_at DESC NULLS LAST`,
      [req.user.id]
    );

    const retirements = rows.map(r => ({
      id:                       r.id,
      certificate_id:           r.cert_id || r.certificate_id,
      cert_id:                  r.cert_id,
      token_id:                 r.token_id,
      amount:                   parseInt(r.amount) || 0,
      tx_hash:                  r.tx_hash,
      block_number:             r.block_number,
      project_name:             r.project_name || '—',
      project_type:             r.project_type || '—',
      standard:                 r.standard || 'VCS',
      serial_number:            r.serial_number || r.registry_serial || '—',
      developer:                r.developer || '—',
      location:                 r.location || '—',
      vintage_year:             r.vintage_year || '—',
      country:                  r.country || '—',
      beneficiary:              r.beneficiary || '',
      beneficiary_name:         r.beneficiary || '',
      retire_scope:             '1',
      retired_at:               r.created_at,
      created_at:               r.created_at,
      icvcm_ccp_eligible:       r.icvcm_ccp_eligible || false,
      corresponding_adjustment: r.corresponding_adjustment || 'none',
      credit_type:              r.credit_type || 'voluntary',
      wallet_address:           r.wallet_address || '',
    }));

    res.json({ retirements });
  } catch (e) {
    console.error('Get retirements error:', e.message);
    res.status(500).json({ error: 'Failed to fetch retirements' });
  }
});

// ── POST /api/transactions/retirements ────────────────────────────
router.post('/retirements', authenticate, async (req, res) => {
  const {
    tokenId, projectName, standard, credits, vintageYear,
    serialNumber, developer, location, country, projectType,
    txHash, beneficiary,
    beneficiaryName, beneficiaryEntity, beneficiaryGstin,
    reportingStandard, purpose, retireScope,
    correspondingAdjustment, blockNumber, walletAddress,
  } = req.body;

  try {
    const certId = `CERT-${(tokenId||'').toString().slice(0,8)||'XXXXXX'}-${Date.now().toString(36).toUpperCase()}`;

    // ✅ Write to registry_transactions (primary source for GET /retirements)
    const { rows } = await query(
      `INSERT INTO registry_transactions
         (user_id, from_user_id, tx_hash, tx_type, type, token_id, amount,
          project_name, standard, cert_id, beneficiary,
          serial_number, developer, location, project_type, total_price_inr)
       VALUES ($1,$1,$2,'RETIRE','RETIRE',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0)
       ON CONFLICT (tx_hash) DO NOTHING
       RETURNING id, cert_id`,
      [
        req.user.id, txHash, tokenId, credits,
        projectName, standard, certId, beneficiary||beneficiaryName||null,
        serialNumber||null, developer||null, location||null, projectType||null,
      ]
    );

    // ✅ Also write to retirements table for public verify page
    // Wrapped in try/catch — failure here doesn't block the response
    try {
      await query(
        `INSERT INTO retirements
           (retired_by, wallet_address, token_id, batch_id, amount,
            certificate_id, tx_hash, block_number,
            project_name, project_type, vintage_year, serial_number,
            developer, location, country, standard,
            beneficiary_name, beneficiary_entity, beneficiary_gstin,
            retire_scope, corresponding_adjustment,
            reporting_standard, purpose,
            is_public, retired_at)
         VALUES (
           $1, $2, $3,
           (SELECT id FROM carbon_batches WHERE token_id=$3 AND user_id=$1 LIMIT 1),
           $4, $5, $6, $7,
           $8, $9, $10, $11,
           $12, $13, $14, $15,
           $16, $17, $18,
           $19, $20,
           $21, $22,
           true, NOW()
         )`,
        [
          req.user.id,
          walletAddress || null,
          tokenId,
          credits,
          certId,
          txHash,
          blockNumber || null,
          projectName,
          projectType || null,
          vintageYear || null,
          serialNumber || null,
          developer || null,
          location || null,
          country || null,
          standard,
          beneficiaryName || beneficiary || null,
          beneficiaryEntity || null,
          beneficiaryGstin || null,
          retireScope || '1',
          correspondingAdjustment || 'none',
          reportingStandard || 'GHG_PROTOCOL',
          purpose || 'voluntary_offset',
        ]
      );
    } catch (retErr) {
      console.warn('Retirements table insert failed (non-fatal):', retErr.message);
    }

    // ✅ Update carbon_batches status after retirement
    if (tokenId != null) {
      await query(
        `UPDATE carbon_batches
         SET retired_credits   = COALESCE(retired_credits, 0) + $1,
             available_credits = GREATEST(0, COALESCE(available_credits, quantity) - $1),
             status            = CASE
               WHEN GREATEST(0, COALESCE(available_credits, quantity) - $1) = 0
               THEN 'exhausted'
               ELSE status
             END,
             updated_at = NOW()
         WHERE token_id = $2 AND user_id = $3`,
        [credits, tokenId, req.user.id]
      );
    }

    res.json({ message: 'Retirement recorded', certId, id: rows[0]?.id });
  } catch (e) {
    console.error('Retirement record error:', e.message);
    res.status(500).json({ error: 'Failed to record retirement' });
  }
});

// ── GET /api/transactions/retirements/:certId ─────────────────────
router.get('/retirements/:certId', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM registry_transactions
       WHERE cert_id=$1 AND (user_id=$2 OR from_user_id=$2)`,
      [req.params.certId, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Certificate not found' });
    res.json({ certificate: { ...rows[0], certificate_id: rows[0].cert_id } });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch certificate' });
  }
});

module.exports = router;