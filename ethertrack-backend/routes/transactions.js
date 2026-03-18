// routes/transactions.js
const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate } = require('../middleware/auth');

// ── GET /api/transactions/stats ───────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [trades, retired, volume, users] = await Promise.all([
      query(`SELECT COUNT(*) FROM registry_transactions
             WHERE tx_type IN ('buy','sell')
                OR type::text IN ('buy','sell')`),
      query(`SELECT COALESCE(SUM(retired_credits),0) AS total FROM carbon_batches`),
      query(`SELECT COALESCE(SUM(total_price_inr),0) AS total
             FROM registry_transactions
             WHERE tx_type IN ('buy','sell')`),
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
// ✅ Reads from registry_transactions (where actual retirements are stored)
// ✅ Normalizes cert_id → certificate_id for frontend consistency
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
         rt.created_at             AS retired_at
       FROM registry_transactions rt
       WHERE (rt.from_user_id=$1 OR rt.user_id=$1)
         AND (rt.tx_type='retire' OR rt.type::text='retire')
       ORDER BY rt.created_at DESC NULLS LAST`,
      [req.user.id]
    );

    const retirements = rows.map(r => ({
      id:               r.id,
      certificate_id:   r.cert_id || r.certificate_id,
      cert_id:          r.cert_id,
      token_id:         r.token_id,
      amount:           parseInt(r.amount) || 0,
      tx_hash:          r.tx_hash,
      block_number:     r.block_number,
      project_name:     r.project_name || '—',
      project_type:     r.project_type || '—',
      standard:         r.standard || 'VCS',
      serial_number:    r.serial_number || '—',
      developer:        r.developer || '—',
      location:         r.location || '—',
      beneficiary:      r.beneficiary || '',
      beneficiary_name: r.beneficiary || '',
      retire_scope:     '1',
      retired_at:       r.created_at,
      created_at:       r.created_at,
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
  } = req.body;

  try {
    const certId = `CERT-${(tokenId||'').toString().slice(0,8)||'XXXXXX'}-${Date.now().toString(36).toUpperCase()}`;
    const { rows } = await query(
      `INSERT INTO registry_transactions
         (user_id, from_user_id, tx_hash, tx_type, token_id, amount,
          project_name, standard, cert_id, beneficiary,
          serial_number, developer, location, project_type, total_price_inr)
       VALUES ($1,$1,$2,'retire',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0)
       ON CONFLICT (tx_hash) DO NOTHING
       RETURNING id, cert_id`,
      [
        req.user.id, txHash, tokenId, credits,
        projectName, standard, certId, beneficiary||null,
        serialNumber||null, developer||null, location||null, projectType||null,
      ]
    );
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