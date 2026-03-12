// routes/portfolio.js
const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate, requireKYC } = require('../middleware/auth');

// ── POST /api/portfolio/submit-credit ─────────────────────────────
// carbon_batches doesn't have user_id natively — we added it via migration
// developer_id is for the projects table; user_id is our added column
router.post('/submit-credit', authenticate, requireKYC, async (req, res) => {
  const {
    projectName, projectLocation, country, standard, registryName,
    projectType, developer, quantity, vintageYear, expiryDate,
    registrySerial, docIpfsHash,
  } = req.body;

  if (!projectName || !registrySerial || !quantity || !docIpfsHash) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Check duplicate serial for this user
    const { rows: dup } = await query(
      `SELECT id FROM carbon_batches
       WHERE registry_serial=$1 AND user_id=$2`,
      [registrySerial, req.user.id]
    );
    if (dup.length) {
      return res.status(409).json({ error: 'You already submitted this serial number' });
    }

    const { rows } = await query(
      `INSERT INTO carbon_batches
         (user_id, project_name, project_location, country, standard,
          registry_name, project_type, developer, quantity,
          vintage_year, expiry_date, registry_serial,
          doc_ipfs_hash, admin_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending')
       RETURNING id`,
      [
        req.user.id, projectName, projectLocation, country, standard,
        registryName, projectType, developer, quantity,
        vintageYear, expiryDate || null, registrySerial, docIpfsHash,
      ]
    );

    res.json({ message: 'Credit submitted for verification', id: rows[0].id });
  } catch (e) {
    console.error('Credit submit error:', e.message);
    res.status(500).json({ error: 'Submission failed' });
  }
});

// ── GET /api/portfolio/my-submissions ─────────────────────────────
router.get('/my-submissions', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, project_name, project_location, country, standard,
              registry_name, project_type, developer, quantity,
              vintage_year, expiry_date, registry_serial,
              doc_ipfs_hash, admin_status, admin_notes, created_at
       FROM carbon_batches
       WHERE user_id=$1
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ submissions: rows });
  } catch (e) {
    console.error('My submissions error:', e.message);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

module.exports = router;