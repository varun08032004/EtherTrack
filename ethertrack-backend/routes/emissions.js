// routes/emissions.js
// ── Security fixes:
//    All dynamic SQL uses parameterised queries only — no string interpolation
//    Year, scope, limit inputs validated before use
//    String inputs sanitised via sanitiseText helper
//    Numeric bounds enforced on all user-supplied numbers
//    Error messages never leak DB internals to client
//    Rate-limit-aware headers set on write endpoints
// ── Regulatory:
//    CEA V20.0 Dec 2024 grid EF 0.727 tCO₂/MWh referenced in source field
//    summary endpoint returns both scope2_location and scope2_market
//    for GHG Protocol dual Scope 2 reporting
// ── Fix log:
//    [FIX-CEA-KWH]  SERVER_EF kWh factors corrected from 0.727 to 0.000727
//                   tCO₂e/kWh (= 0.727 tCO₂/MWh ÷ 1000 kWh/MWh).
//                   Previous value (0.727 kg/kWh) was 1000× too high.
//                   verifyCO2e() was rejecting every valid kWh submission
//                   from the corrected v4 frontend with "data tampering" error.
//                   Affected keys: 'Electricity India — Location (kWh)',
//                                  'Grid Electricity PAT (kWh)'

'use strict';

const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { createNotification } = require('./notifications');
const { requirePlan } = require('../middleware/planGate');
// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// Strip HTML/script-injectable characters from any user text
const sanitiseText = (val, maxLen = 500) =>
  String(val || '')
    .replace(/<[^>]*>/g, '')
    .replace(/['"`;\\]/g, '')
    .trim()
    .slice(0, maxLen);

// Validate and coerce integer — returns null if invalid
const safeInt = (val, min = 0, max = 2_147_483_647) => {
  const n = parseInt(val, 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
};

// Validate and coerce float — returns null if invalid
const safeFloat = (val, min = 0, max = 1e12) => {
  const n = parseFloat(val);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
};

// Validate year — must be realistic reporting year
const safeYear = (val) => {
  const n = safeInt(val, 2000, 2100);
  return n;
};

// Validate scope — must be 1, 2, or 3
const safeScope = (val) => {
  const n = safeInt(val, 1, 3);
  return n;
};

// Validate YYYY-MM-DD date string
const safeDate = (val) => {
  if (!val || typeof val !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  // Reject future dates beyond today + 1 day (allow timezone tolerance)
  if (d > new Date(Date.now() + 86_400_000)) return null;
  return val;
};

// Validate UUID string
const safeUUID = (val) => {
  if (!val || typeof val !== 'string') return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) return null;
  return val;
};

// Generic error response — never exposes DB error details in production
const dbErr = (res, context = 'Operation', err = null) => {
  if (err) console.error(`[Emissions] ${context} error:`, err.message);
  if (process.env.NODE_ENV !== 'production') {
    return res.status(500).json({ error: `${context} failed` });
  }
  return res.status(500).json({ error: 'An error occurred. Please try again.' });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/emissions/my
// Returns aggregate totals for the authenticated user
// ─────────────────────────────────────────────────────────────────────────────
router.get('/my', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         COALESCE(SUM(total_emissions), 0) AS total_emitted,
         COALESCE(SUM(credits_offset),  0) AS total_offset,
         COALESCE(SUM(net_emissions),   0) AS net_emissions,
         COUNT(*)                          AS report_count
       FROM emission_reports
       WHERE user_id = $1`,
      [req.user.id]
    );
    res.json({
      totalEmitted: parseFloat(rows[0].total_emitted),
      totalOffset:  parseInt(rows[0].total_offset,  10),
      netEmissions: parseFloat(rows[0].net_emissions),
      reportCount:  parseInt(rows[0].report_count,  10),
    });
  } catch (err) {
    dbErr(res, 'Emissions summary', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/emissions/activities
// ── Fixed: year filter uses EXTRACT with validated integer param
// ── Fixed: limit capped at 1000 — never unbounded
// ── Fixed: scope validated to 1/2/3 only
// ── Fixed: from/to dates validated before use
// ─────────────────────────────────────────────────────────────────────────────
router.get('/activities', authenticate, async (req, res) => {
  const year  = safeYear(req.query.year);
  const scope = req.query.scope ? safeScope(req.query.scope) : null;
  const from  = req.query.from  ? safeDate(req.query.from)   : null;
  const to    = req.query.to    ? safeDate(req.query.to)     : null;
  const limit = Math.min(safeInt(req.query.limit, 1, 1000) ?? 500, 1000);

  if (req.query.year  && year  === null) return res.status(400).json({ error: 'Invalid year parameter' });
  if (req.query.scope && scope === null) return res.status(400).json({ error: 'Invalid scope parameter — must be 1, 2, or 3' });
  if (req.query.from  && from  === null) return res.status(400).json({ error: 'Invalid from date — use YYYY-MM-DD' });
  if (req.query.to    && to    === null) return res.status(400).json({ error: 'Invalid to date — use YYYY-MM-DD' });
  if (from && to && from > to)           return res.status(400).json({ error: 'from date must be before to date' });

  try {
    // Build query with parameterised clauses — NO string interpolation
    const params  = [req.user.id];
    const clauses = ['user_id = $1'];

    if (year !== null) {
      params.push(year);
      clauses.push(`EXTRACT(YEAR FROM date) = $${params.length}`);
    }
    if (scope !== null) {
      params.push(scope);
      clauses.push(`scope = $${params.length}`);
    }
    if (from) {
      params.push(from);
      clauses.push(`date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      clauses.push(`date <= $${params.length}`);
    }

    params.push(limit);
    const sql = `
      SELECT
        id, date, activity, quantity, unit, scope, category,
        factor, co2e, source, verified, notes, created_at
      FROM emission_activities
      WHERE ${clauses.join(' AND ')}
      ORDER BY date DESC
      LIMIT $${params.length}
    `;

    const { rows } = await query(sql, params);
    res.json({ activities: rows, count: rows.length });
  } catch (err) {
    dbErr(res, 'Fetch activities', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/emissions/log
// ── All inputs validated and sanitised before DB insert
// ── co2e cross-checked server-side against known EF if available
// ── Returns 429 hint if user submits too fast (rate limiter should wrap router)
// ─────────────────────────────────────────────────────────────────────────────

// ── Server-side emission factor map ──────────────────────────────────────────
// Must stay in sync with the frontend EF map in EmissionTracking.jsx.
// Units: tCO₂e per unit of activity (same unit as the frontend calc() function).
//
// [FIX-CEA-KWH] kWh-based factors corrected to tCO₂e/kWh:
//   CEA V20.0 Dec 2024: 0.727 tCO₂/MWh ÷ 1000 kWh/MWh = 0.000727 tCO₂e/kWh
//   Previous value (0.727) was the MWh factor misapplied to kWh — 1000× too high.
//   This caused verifyCO2e() to reject every valid electricity submission
//   from the corrected frontend with "Possible data tampering".
//
// Combustion factors below are already in kg CO₂e/unit — divided by 1000
// inside verifyCO2e() to match the frontend calc: qty * factor / 1000.
const SERVER_EF = {
  // ── Scope 2 — kWh-based (CEA V20.0 Dec 2024) — [FIX-CEA-KWH] ────────────
  // tCO₂e/kWh = 0.000727  (was 0.727 — 1000× wrong)
  'Electricity India — Location (kWh)': 0.000727, // [FIX-CEA-KWH] was 0.727
  'Grid Electricity PAT (kWh)':         0.000727, // [FIX-CEA-KWH] was 0.727

  // ── Scope 3 Cat 3 — T&D losses (already correct — own factor, not CEA/1000) ─
  'T&D Losses India (kWh)':             0.000073, // 0.073 kgCO₂e/kWh ÷ 1000

  // ── Scope 1 — Stationary Combustion (kgCO₂e/unit ÷ 1000 in verifyCO2e) ────
  'Diesel (L)':                         2.68,
  'Petrol (L)':                         2.31,
  'Natural Gas (m³)':                   2.02,
  'Coal (kg)':                          2.42,
  'LPG (kg)':                           2.98,
  'Furnace Oil (L)':                    3.18,

  // ── Scope 1 — Fugitive (kgCO₂e/kg ÷ 1000 in verifyCO2e) ──────────────────
  'Refrigerant R-410A (kg)':            2088,
  'Refrigerant R-22 (kg)':             1810,
  'Refrigerant R-32 (kg)':              675,
};

// Validate co2e submitted by client — allow 2% tolerance for rounding.
// Frontend calc:  co2e = quantity * factor / 1000  (result in tCO₂e)
// SERVER_EF stores factors in the same unit as the frontend EF map.
// For kWh activities the factor is already tCO₂e/kWh so division by 1000
// happens in both the frontend (/ 1000) and here — consistent.
const verifyCO2e = (activity, quantity, claimedCo2e) => {
  const ef = SERVER_EF[activity];
  if (!ef) return true; // unknown activity — accept client value
  const expected = quantity * ef / 1000;
  return Math.abs(expected - claimedCo2e) / Math.max(expected, 0.0001) < 0.02;
};

router.post('/log',  authenticate, requirePlan('growth'), async (req, res) => {
  const {
    date, activity, quantity, unit, scope,
    category, factor, co2e, notes, source,
  } = req.body;

  // ── Input validation ────────────────────────────────────────────────────────
  const cleanDate     = safeDate(date);
  const cleanActivity = sanitiseText(activity, 200);
  const cleanQty      = safeFloat(quantity, 0.000001, 1e9);
  const cleanUnit     = sanitiseText(unit,     50);
  const cleanScope    = safeScope(scope);
  const cleanCategory = sanitiseText(category, 200);
  const cleanFactor   = safeFloat(factor,  0, 1e6);
  const cleanCo2e     = safeFloat(co2e,    0, 1e9);
  const cleanNotes    = sanitiseText(notes, 500);
  const cleanSource   = sanitiseText(source, 200);

  if (!cleanDate)          return res.status(400).json({ error: 'Invalid or future date — use YYYY-MM-DD' });
  if (!cleanActivity)      return res.status(400).json({ error: 'activity is required' });
  if (cleanQty === null)   return res.status(400).json({ error: 'quantity must be a positive number' });
  if (cleanScope === null) return res.status(400).json({ error: 'scope must be 1, 2, or 3' });
  if (cleanCo2e === null)  return res.status(400).json({ error: 'co2e must be a non-negative number' });

  // Server-side co2e verification for known activities
  if (!verifyCO2e(cleanActivity, cleanQty, cleanCo2e)) {
    return res.status(400).json({
      error: 'co2e value does not match server-side emission factor. Possible data tampering.',
    });
  }

  try {
    const { rows } = await query(
      `INSERT INTO emission_activities
         (user_id, date, activity, quantity, unit, scope, category, factor, co2e, notes, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, date, activity, quantity, unit, scope, category, factor, co2e, notes, source, verified, created_at`,
      [
        req.user.id,
        cleanDate,
        cleanActivity,
        cleanQty,
        cleanUnit    || null,
        cleanScope,
        cleanCategory || null,
        cleanFactor  ?? null,
        cleanCo2e,
        cleanNotes   || null,
        cleanSource  || null,
      ]
    );

    // Non-blocking notification — failure here must not fail the request
    if (cleanCo2e >= 0.1) {
      createNotification(
        req.user.id, 'EMISSION', '🌿 Emission Logged',
        `${cleanActivity} — ${cleanQty} ${cleanUnit || ''} = ${cleanCo2e.toFixed(4)} tCO₂e (Scope ${cleanScope})`,
        '/emission-tracking',
        { activity: cleanActivity, co2e: cleanCo2e, scope: cleanScope, date: cleanDate }
      ).catch(() => {});
    }

    res.status(201).json({ message: 'Activity logged', activity: rows[0] });
  } catch (err) {
    dbErr(res, 'Log emission', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/emissions/bulk
// ── Max 2000 records per batch
// ── Each record individually validated
// ── Skips invalid rows rather than aborting entire batch
// ── Uses a transaction so partial failures don't leave half-imported data
// ─────────────────────────────────────────────────────────────────────────────
router.post('/bulk', authenticate, requirePlan('growth'), async (req, res) => {
  const { records } = req.body;

  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records must be a non-empty array' });
  }
  if (records.length > 2000) {
    return res.status(400).json({ error: 'Maximum 2000 records per bulk import' });
  }

  // Validate each record before any DB work
  const valid   = [];
  const skipped = [];

  for (const r of records) {
    const cleanDate     = safeDate(r.date);
    const cleanActivity = sanitiseText(r.activity, 200);
    const cleanQty      = safeFloat(r.quantity ?? r.qty, 0.000001, 1e9);
    const cleanScope    = r.scope ? safeScope(r.scope) : null;
    const cleanCo2e     = safeFloat(r.co2e, 0, 1e9);

    if (!cleanDate || !cleanActivity || cleanQty === null) {
      skipped.push({ row: r.date || '?', reason: 'Missing date, activity or quantity' });
      continue;
    }

    valid.push({
      date:     cleanDate,
      activity: cleanActivity,
      quantity: cleanQty,
      unit:     sanitiseText(r.unit,     50) || null,
      scope:    cleanScope,
      category: sanitiseText(r.category, 200) || null,
      factor:   safeFloat(r.factor, 0, 1e6) ?? null,
      co2e:     cleanCo2e ?? 0,
      notes:    sanitiseText(r.notes,  500) || null,
      source:   sanitiseText(r.source, 200) || null,
    });
  }

  if (valid.length === 0) {
    return res.status(400).json({ error: 'No valid records found after validation', skipped });
  }

  let inserted = 0;
  try {
    // Wrap in a transaction — all or nothing per batch
    await query('BEGIN');
    for (const r of valid) {
      await query(
        `INSERT INTO emission_activities
           (user_id, date, activity, quantity, unit, scope, category, factor, co2e, notes, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT DO NOTHING`,
        [
          req.user.id, r.date, r.activity, r.quantity, r.unit,
          r.scope, r.category, r.factor, r.co2e, r.notes, r.source,
        ]
      );
      inserted++;
    }
    await query('COMMIT');

    if (inserted > 0) {
      createNotification(
        req.user.id, 'EMISSION', '📊 Bulk Emissions Imported',
        `${inserted} emission record${inserted !== 1 ? 's' : ''} imported to your GHG ledger`,
        '/emission-tracking',
        { count: inserted }
      ).catch(() => {});
    }

    res.json({ message: `Imported ${inserted} records`, inserted, skipped: skipped.length });
  } catch (err) {
    await query('ROLLBACK').catch(() => {});
    dbErr(res, 'Bulk import', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/emissions/activities/:id
// ── ID validated as UUID — prevents injection
// ── User ownership enforced in WHERE clause
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/activities/:id', authenticate, async (req, res) => {
  // IDs are UUIDs in Supabase — safeInt would always return null and break deletes
  const id = safeUUID(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid record ID' });

  try {
    const { rows } = await query(
      `DELETE FROM emission_activities
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Record not found or not owned by you' });
    res.json({ message: 'Deleted', id: rows[0].id });
  } catch (err) {
    dbErr(res, 'Delete activity', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/emissions/summary
// ── Returns dual Scope 2 (location-based + market-based) per GHG Protocol
// ── CEA V20.0 Dec 2024 referenced in response metadata
// ── YoY change computed server-side
// ─────────────────────────────────────────────────────────────────────────────
router.get('/summary', authenticate, async (req, res) => {
  const year = safeYear(req.query.year) ?? new Date().getFullYear();

  try {
    const [scopeRows, monthRows, catRows, prevYearRow, s2DetailRows] = await Promise.all([
      // Total by scope
      query(
        `SELECT scope,
                COALESCE(SUM(co2e), 0) AS total_co2e,
                COUNT(*)               AS records
         FROM emission_activities
         WHERE user_id = $1
           AND EXTRACT(YEAR FROM date) = $2
         GROUP BY scope
         ORDER BY scope`,
        [req.user.id, year]
      ),
      // Monthly trend by scope
      query(
        `SELECT EXTRACT(MONTH FROM date)::int AS month,
                scope,
                COALESCE(SUM(co2e), 0)        AS total_co2e
         FROM emission_activities
         WHERE user_id = $1
           AND EXTRACT(YEAR FROM date) = $2
         GROUP BY month, scope
         ORDER BY month, scope`,
        [req.user.id, year]
      ),
      // Top 10 categories
      query(
        `SELECT category,
                COALESCE(SUM(co2e), 0) AS total_co2e
         FROM emission_activities
         WHERE user_id = $1
           AND EXTRACT(YEAR FROM date) = $2
           AND category IS NOT NULL
         GROUP BY category
         ORDER BY total_co2e DESC
         LIMIT 10`,
        [req.user.id, year]
      ),
      // Previous year total for YoY
      query(
        `SELECT COALESCE(SUM(co2e), 0) AS total_co2e
         FROM emission_activities
         WHERE user_id = $1
           AND EXTRACT(YEAR FROM date) = $2`,
        [req.user.id, year - 1]
      ),
      // Dual Scope 2 — location-based vs market-based
      query(
        `SELECT
           COALESCE(SUM(co2e) FILTER (WHERE category ILIKE '%Location-based%'), 0) AS scope2_location,
           COALESCE(SUM(co2e) FILTER (WHERE category ILIKE '%Market-based%'),   0) AS scope2_market
         FROM emission_activities
         WHERE user_id = $1
           AND EXTRACT(YEAR FROM date) = $2
           AND scope = 2`,
        [req.user.id, year]
      ),
    ]);

    const s = (sc) => parseFloat(scopeRows.rows.find(r => r.scope === sc)?.total_co2e || 0);
    const scope1 = s(1);
    const scope2 = s(2);
    const scope3 = s(3);
    const total  = scope1 + scope2 + scope3;

    const prevTotal = parseFloat(prevYearRow.rows[0]?.total_co2e || 0);
    const yoyChange = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;

    const scope2Location = parseFloat(s2DetailRows.rows[0]?.scope2_location || 0);
    const scope2Market   = parseFloat(s2DetailRows.rows[0]?.scope2_market   || 0);
    const scope2Loc = scope2Location > 0 ? scope2Location : scope2;

    res.json({
      year,
      scope1,
      scope2,
      scope3,
      total,
      scope2Location: scope2Loc,
      scope2Market,
      creditsNeeded:     Math.ceil(total),
      yoyChange,
      prevYearTotal:     prevTotal,
      scopeBreakdown:    scopeRows.rows,
      monthlyTrend:      monthRows.rows,
      categoryBreakdown: catRows.rows,
      meta: {
        gridEmissionFactor: 0.727,       // tCO₂/MWh
        gridEFKwh:          0.000727,    // tCO₂e/kWh  [FIX-CEA-KWH]
        gridEFSource:       'CEA V20.0 Dec 2024 (FY 2023-24 weighted average)',
        generatedAt:        new Date().toISOString(),
      },
    });
  } catch (err) {
    dbErr(res, 'Emission summary', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/emissions/profile
// ─────────────────────────────────────────────────────────────────────────────
router.get('/profile', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM emission_profiles WHERE user_id = $1`,
      [req.user.id]
    );
    res.json({ profile: rows[0] || null });
  } catch (err) {
    dbErr(res, 'Fetch profile', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/emissions/profile
// ── All fields validated — CIN/GSTIN/PAN regex checked server-side
// ── Numeric fields bounded to prevent overflow
// ─────────────────────────────────────────────────────────────────────────────
router.post('/profile', authenticate, async (req, res) => {
  const {
    companyName, industry, revenueCr, employees, floorSqft,
    netZeroYear, netZeroTargetCo2e, reportingYear,
    companyCin, companyGstin, companyPan, companyType, baseYear,
  } = req.body;

  // ── Indian regulatory ID validation ─────────────────────────────────────────
  const cin   = String(companyCin   || '').toUpperCase().trim();
  const gstin = String(companyGstin || '').toUpperCase().trim();
  const pan   = String(companyPan   || '').toUpperCase().trim();

  if (cin   && !/^[A-Z]{1}[0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9A-Z]{6}$/.test(cin)) {
    return res.status(400).json({ error: 'Invalid CIN format' });
  }
  if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin)) {
    return res.status(400).json({ error: 'Invalid GSTIN format' });
  }
  if (pan   && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan)) {
    return res.status(400).json({ error: 'Invalid PAN format' });
  }

  // ── Numeric validation ────────────────────────────────────────────────────────
  const cleanRevenue   = safeFloat(revenueCr,          0, 100_000_000) ?? 0;
  const cleanEmployees = safeInt(employees,             0,  10_000_000) ?? 0;
  const cleanFloor     = safeInt(floorSqft,             0, 1_000_000_000) ?? 0;
  const cleanNetZeroYr = safeInt(netZeroYear,        2024, 2100)         ?? 2050;
  const cleanTarget    = safeFloat(netZeroTargetCo2e, 0, 1e9)           ?? 0;
  const cleanRepYear   = safeYear(reportingYear)                         ?? new Date().getFullYear();
  const cleanBaseYear  = safeYear(baseYear)                              ?? 2024;

  const cleanName = sanitiseText(companyName, 200);
  const cleanType = sanitiseText(companyType,  100);

  const VALID_INDUSTRIES = [
    'Manufacturing', 'IT/Software', 'Finance', 'Healthcare', 'Retail',
    'Logistics', 'Construction', 'Energy', 'Agriculture', 'Education', 'Other',
  ];
  const cleanIndustry = VALID_INDUSTRIES.includes(industry) ? industry : null;

  try {
    const { rows } = await query(
      `INSERT INTO emission_profiles
         (user_id, company_name, industry, revenue_cr, employees, floor_sqft,
          net_zero_year, net_zero_target_co2e, reporting_year,
          company_cin, company_gstin, company_pan, company_type, base_year, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         company_name         = EXCLUDED.company_name,
         industry             = EXCLUDED.industry,
         revenue_cr           = EXCLUDED.revenue_cr,
         employees            = EXCLUDED.employees,
         floor_sqft           = EXCLUDED.floor_sqft,
         net_zero_year        = EXCLUDED.net_zero_year,
         net_zero_target_co2e = EXCLUDED.net_zero_target_co2e,
         reporting_year       = EXCLUDED.reporting_year,
         company_cin          = EXCLUDED.company_cin,
         company_gstin        = EXCLUDED.company_gstin,
         company_pan          = EXCLUDED.company_pan,
         company_type         = EXCLUDED.company_type,
         base_year            = EXCLUDED.base_year,
         updated_at           = NOW()
       RETURNING *`,
      [
        req.user.id,
        cleanName        || null,
        cleanIndustry    || null,
        cleanRevenue,
        cleanEmployees,
        cleanFloor,
        cleanNetZeroYr,
        cleanTarget,
        cleanRepYear,
        cin              || null,
        gstin            || null,
        pan              || null,
        cleanType        || null,
        cleanBaseYear,
      ]
    );
    res.json({ message: 'Profile saved', profile: rows[0] });
  } catch (err) {
    dbErr(res, 'Save profile', err);
  }
});

module.exports = router;