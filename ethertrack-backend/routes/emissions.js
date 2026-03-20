// routes/emissions.js — with notification triggers
const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { createNotification } = require('./notifications');

router.get('/my', authenticate, async (req, res) => {
  try {
    const { rows } = await query(`SELECT COALESCE(SUM(total_emissions),0) AS total_emitted, COALESCE(SUM(credits_offset),0) AS total_offset, COALESCE(SUM(net_emissions),0) AS net_emissions, COUNT(*) AS report_count FROM emission_reports WHERE user_id=$1`, [req.user.id]);
    res.json({ totalEmitted: parseFloat(rows[0].total_emitted), totalOffset: parseInt(rows[0].total_offset), netEmissions: parseFloat(rows[0].net_emissions), reportCount: parseInt(rows[0].report_count) });
  } catch (e) { console.error('Emissions my error:', e.message); res.status(500).json({ error: 'Failed to fetch emissions' }); }
});

router.get('/activities', authenticate, async (req, res) => {
  const { scope, from, to, limit = 500 } = req.query;
  try {
    let q = `SELECT * FROM emission_activities WHERE user_id=$1`;
    const params = [req.user.id];
    if (scope) { params.push(parseInt(scope)); q += ` AND scope=$${params.length}`; }
    if (from)  { params.push(from);            q += ` AND date >= $${params.length}`; }
    if (to)    { params.push(to);              q += ` AND date <= $${params.length}`; }
    params.push(parseInt(limit));
    q += ` ORDER BY date DESC LIMIT $${params.length}`;
    const { rows } = await query(q, params);
    res.json({ activities: rows, count: rows.length });
  } catch (e) { console.error('Activities fetch error:', e.message); res.status(500).json({ error: 'Failed to fetch activities' }); }
});

router.post('/log', authenticate, async (req, res) => {
  const { date, activity, quantity, unit, scope, category, factor, co2e, notes } = req.body;
  if (!date || !activity || quantity == null) return res.status(400).json({ error: 'date, activity, quantity required' });
  try {
    const { rows } = await query(
      `INSERT INTO emission_activities (user_id,date,activity,quantity,unit,scope,category,factor,co2e,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.id, date, activity, quantity, unit||null, scope||null, category||null, factor||null, co2e||null, notes||null]
    );

    // ── NOTIFICATION: Emission logged (only for significant entries ≥ 0.1 tCO₂e) ──
    const co2eVal = parseFloat(co2e || 0);
    if (co2eVal >= 0.1) {
      await createNotification(
        req.user.id, 'EMISSION', '🌿 Emission Logged',
        `${activity} — ${quantity} ${unit || ''} = ${co2eVal.toFixed(2)} tCO₂e added to GHG ledger (Scope ${scope || '?'})`,
        '/emission-tracking',
        { activity, co2e: co2eVal, scope, date }
      );
    }

    res.json({ message: 'Activity logged', activity: rows[0] });
  } catch (e) { console.error('Log error:', e.message); res.status(500).json({ error: 'Failed to log activity' }); }
});

router.post('/bulk', authenticate, async (req, res) => {
  const { records } = req.body;
  if (!Array.isArray(records) || !records.length) return res.status(400).json({ error: 'records array required' });
  try {
    let inserted = 0;
    for (const r of records) {
      if (!r.date || !r.activity || r.quantity == null) continue;
      await query(
        `INSERT INTO emission_activities (user_id,date,activity,quantity,unit,scope,category,factor,co2e,notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
        [req.user.id, r.date, r.activity, r.quantity, r.unit||null, r.scope||null, r.category||null, r.factor||null, r.co2e||null, r.notes||null]
      );
      inserted++;
    }

    // ── NOTIFICATION: Bulk import ──
    if (inserted > 0) {
      await createNotification(
        req.user.id, 'EMISSION', '📊 Bulk Emissions Imported',
        `${inserted} emission record${inserted !== 1 ? 's' : ''} imported to your GHG ledger`,
        '/emission-tracking', { count: inserted }
      );
    }

    res.json({ message: `Imported ${inserted} records`, inserted });
  } catch (e) { console.error('Bulk import error:', e.message); res.status(500).json({ error: 'Bulk import failed' }); }
});

router.delete('/activities/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await query(`DELETE FROM emission_activities WHERE id=$1 AND user_id=$2 RETURNING id`, [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted', id: rows[0].id });
  } catch (e) { res.status(500).json({ error: 'Failed to delete' }); }
});

router.get('/summary', authenticate, async (req, res) => {
  const { year = new Date().getFullYear() } = req.query;
  try {
    const [scopeRows, monthRows, catRows, prevYear] = await Promise.all([
      query(`SELECT scope, COALESCE(SUM(co2e),0) AS total_co2e, COUNT(*) AS records FROM emission_activities WHERE user_id=$1 AND EXTRACT(YEAR FROM date)=$2 GROUP BY scope ORDER BY scope`, [req.user.id, year]),
      query(`SELECT EXTRACT(MONTH FROM date)::int AS month, scope, COALESCE(SUM(co2e),0) AS total_co2e FROM emission_activities WHERE user_id=$1 AND EXTRACT(YEAR FROM date)=$2 GROUP BY month,scope ORDER BY month,scope`, [req.user.id, year]),
      query(`SELECT category, COALESCE(SUM(co2e),0) AS total_co2e FROM emission_activities WHERE user_id=$1 AND EXTRACT(YEAR FROM date)=$2 AND category IS NOT NULL GROUP BY category ORDER BY total_co2e DESC LIMIT 10`, [req.user.id, year]),
      query(`SELECT COALESCE(SUM(co2e),0) AS total_co2e FROM emission_activities WHERE user_id=$1 AND EXTRACT(YEAR FROM date)=$2`, [req.user.id, parseInt(year)-1]),
    ]);
    const s = (sc) => parseFloat(scopeRows.rows.find(r=>r.scope===sc)?.total_co2e || 0);
    const scope1 = s(1), scope2 = s(2), scope3 = s(3);
    const total  = scope1 + scope2 + scope3;
    const prevTotal = parseFloat(prevYear.rows[0]?.total_co2e || 0);
    const yoyChange = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;
    res.json({ year: parseInt(year), scope1, scope2, scope3, total, creditsNeeded: Math.ceil(total), yoyChange, prevYearTotal: prevTotal, scopeBreakdown: scopeRows.rows, monthlyTrend: monthRows.rows, categoryBreakdown: catRows.rows });
  } catch (e) { console.error('Summary error:', e.message); res.status(500).json({ error: 'Failed to fetch summary' }); }
});

router.get('/profile', authenticate, async (req, res) => {
  try {
    const { rows } = await query(`SELECT * FROM emission_profiles WHERE user_id=$1`, [req.user.id]);
    res.json({ profile: rows[0] || null });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch profile' }); }
});

router.post('/profile', authenticate, async (req, res) => {
  const { companyName, industry, revenueCr, employees, floorSqft, netZeroYear, netZeroTargetCo2e, reportingYear } = req.body;
  try {
    const { rows } = await query(
      `INSERT INTO emission_profiles (user_id,company_name,industry,revenue_cr,employees,floor_sqft,net_zero_year,net_zero_target_co2e,reporting_year,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT (user_id) DO UPDATE SET company_name=$2, industry=$3, revenue_cr=$4, employees=$5, floor_sqft=$6, net_zero_year=$7, net_zero_target_co2e=$8, reporting_year=$9, updated_at=NOW()
       RETURNING *`,
      [req.user.id, companyName||null, industry||null, revenueCr||0, employees||0, floorSqft||0, netZeroYear||2050, netZeroTargetCo2e||0, reportingYear||2025]
    );
    res.json({ message: 'Profile saved', profile: rows[0] });
  } catch (e) { console.error('Profile save error:', e.message); res.status(500).json({ error: 'Failed to save profile' }); }
});

module.exports = router;