const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate } = require('../middleware/auth');

// ── GET /api/emissions/my ─────────────────────────────────────────
router.get('/my', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT * FROM emission_reports WHERE user_id = $1 ORDER BY reporting_year DESC',
      [req.user.id]
    );
    res.json({ reports: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch emission reports' });
  }
});

// ── POST /api/emissions ───────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  try {
    const { companyName, reportingYear, industry, scope1, scope2, scope3 } = req.body;

    if (!reportingYear) return res.status(400).json({ error: 'reportingYear required' });

    const total = (parseFloat(scope1) || 0) + (parseFloat(scope2) || 0) + (parseFloat(scope3) || 0);

    // Check for existing report for same year
    const { rows: existing } = await query(
      'SELECT id FROM emission_reports WHERE user_id = $1 AND reporting_year = $2',
      [req.user.id, reportingYear]
    );
    if (existing.length) {
      return res.status(409).json({ error: `Report for ${reportingYear} already exists. Use PUT to update.` });
    }

    const { rows } = await query(
      `INSERT INTO emission_reports
         (user_id, company_name, reporting_year, industry, scope1, scope2, scope3, total_emissions, net_emissions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       RETURNING *`,
      [req.user.id, companyName, reportingYear, industry,
       scope1 || 0, scope2 || 0, scope3 || 0, total]
    );
    res.status(201).json({ report: rows[0] });
  } catch (e) {
    console.error('Create emission report error:', e);
    res.status(500).json({ error: 'Failed to create report' });
  }
});

// ── PUT /api/emissions/:id ────────────────────────────────────────
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { scope1, scope2, scope3, creditsOffset, companyName, industry } = req.body;
    const total  = (parseFloat(scope1) || 0) + (parseFloat(scope2) || 0) + (parseFloat(scope3) || 0);
    const offset = parseFloat(creditsOffset) || 0;
    const net    = Math.max(0, total - offset);

    const { rows } = await query(
      `UPDATE emission_reports
       SET scope1 = $1, scope2 = $2, scope3 = $3, total_emissions = $4,
           credits_offset = $5, net_emissions = $6,
           company_name = COALESCE($7, company_name),
           industry = COALESCE($8, industry),
           updated_at = NOW()
       WHERE id = $9 AND user_id = $10
       RETURNING *`,
      [scope1 || 0, scope2 || 0, scope3 || 0, total, offset, net, companyName, industry, req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Report not found' });
    res.json({ report: rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update report' });
  }
});

router.get('/my', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         COALESCE(SUM(total_emissions),0) AS total_emitted,
         COALESCE(SUM(credits_offset),0)  AS total_offset,
         COALESCE(SUM(net_emissions),0)   AS net_emissions,
         COUNT(*) AS report_count
       FROM emission_reports
       WHERE user_id=$1`,
      [req.user.id]
    );
    res.json({
      totalEmitted: parseFloat(rows[0].total_emitted),
      totalOffset:  parseInt(rows[0].total_offset),
      netEmissions: parseFloat(rows[0].net_emissions),
      reportCount:  parseInt(rows[0].report_count),
    });
  } catch (e) {
    console.error('Emissions my error:', e.message);
    res.status(500).json({ error: 'Failed to fetch emissions' });
  }
});
 
module.exports = router;
