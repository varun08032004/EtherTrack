// routes/transactions.js
const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate } = require('../middleware/auth');

// ── GET /api/transactions/stats ───────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [trades, retired, volume, users] = await Promise.all([
      // count buys/sells using real 'type' column
      query(`SELECT COUNT(*) FROM registry_transactions
             WHERE tx_type IN ('buy','sell')
                OR type::text IN ('buy','sell')`),
      // total retired — sum from carbon_batches real column
      query(`SELECT COALESCE(SUM(retired_credits),0) AS total FROM carbon_batches`),
      // volume from our added column
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
              p.name AS project_name,
              p.standard::text AS standard
       FROM registry_transactions rt
       LEFT JOIN projects p ON p.id = rt.project_id
       WHERE rt.from_user_id = $1 OR rt.to_user_id = $1 OR rt.user_id = $1
       ORDER BY rt.created_at DESC NULLS LAST
       LIMIT 50`,
      [req.user.id]
    );
    // normalise field names for frontend
    const transactions = rows.map(r => ({
      ...r,
      tx_type:       r.tx_type || r.type,
      quantity:      r.amount  || r.quantity || 0,
      project_name:  r.project_name || '—',
      standard:      r.standard || '—',
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
      `SELECT rt.*,
              p.name AS project_name_joined
       FROM registry_transactions rt
       LEFT JOIN projects p ON p.id = rt.project_id
       WHERE (rt.from_user_id=$1 OR rt.user_id=$1)
         AND (rt.tx_type='retire' OR rt.type::text='retire')
       ORDER BY rt.created_at DESC NULLS LAST`,
      [req.user.id]
    );
    res.json({ retirements: rows });
  } catch (e) {
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
        projectName, standard, certId, beneficiary,
        serialNumber, developer, location, projectType,
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
    res.json({ certificate: rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch certificate' });
  }
});

module.exports = router;