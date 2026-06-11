// routes/ccts.js
// India Carbon Credit Trading Scheme (CCTS)
// Legal basis: Energy Conservation (Amendment) Act 2022 · Gazette G.S.R. 234(E)
// ── Regulatory compliance:
//    9 sectors per BEE Oct 2025 + Jan 2026 gazette notifications
//    CCC formula per gazette:
//      Surplus = max(0, GEI_baseline - GEI_actual) × production
//      Deficit = max(0, GEI_actual - GEI_target)   × production
//    Penalty: Environmental Compensation = 2× average CCC price (CPCB)
//    Covered GHGs: CO₂ and PFCs only (per BEE July 2024 procedure doc)
//    Form A deadline: July 2026 (ICM portal launched 21 March 2026)
//    Grid EF: CEA V20.0 Dec 2024 — 0.727 tCO₂/MWh
// ── v2 fixes:
//    [FIX-DOUBLE-COUNT] totalProd, totalS1, elecKwh no longer sum
//                       monthly arrays AND annual figure simultaneously.
//                       Monthly array takes precedence if any non-zero value
//                       exists; falls back to annual scalar otherwise.
//                       Previous code did reduce(...) + scalar unconditionally
//                       → wrong GEI when both monthly and annual were filled.
//    [FIX-FACILITY-GEI] facility_baseline_gei and facility_target_gei now
//                       saved and returned. DB migration required — see bottom.
//    [FIX-CCC-SERVER]   CCC surplus/deficit now recalculated server-side when
//                       facility baseline/target are available; client values
//                       used as fallback when facility targets not yet set.
//    [FIX-GET-FIELDS]   GET /profile now returns facility GEI fields.

'use strict';

const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate }     = require('../middleware/auth');

// ─────────────────────────────────────────────────────────────────────────────
// REGULATORY CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const CEA_GRID_EF_2024   = 0.727; // tCO₂/MWh — CEA V20.0 Dec 2024 FY 2023-24
const PENALTY_MULTIPLIER = 2.0;   // MoEFCC GEI Target Rules 2025 (not 1.3×)
const EST_CCC_PRICE      = 1_200; // ₹/CCC estimated — CERC floor not yet notified

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const sanitiseText = (val, maxLen = 200) =>
  String(val || '').replace(/<[^>]*>/g, '').replace(/['"`;\\]/g, '').trim().slice(0, maxLen);

const safeFloat = (val, min = 0, max = 1e12) => {
  const n = parseFloat(val);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

const safeInt = (val, min = 0, max = 2_147_483_647) => {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

const dbErr = (res, context = 'Operation') =>
  res.status(500).json({
    error: process.env.NODE_ENV !== 'production'
      ? `${context} failed`
      : 'An error occurred. Please try again.',
  });

// Validate monthly array — exactly 12 non-negative finite numbers
const validateMonthlyArray = (arr, maxVal = 1e12) => {
  if (!Array.isArray(arr) || arr.length !== 12) return null;
  return arr.map(v => safeFloat(v, 0, maxVal) ?? 0);
};

// [FIX-DOUBLE-COUNT] Resolve annual value from monthly array vs scalar.
// Monthly array takes precedence if ANY month has a non-zero value.
// Falls back to the annual scalar if all monthly values are zero/empty.
// Prevents double-counting when both monthly and annual fields are filled.
const resolveAnnual = (monthlyArr, annualScalar) => {
  const monthlySum = monthlyArr.reduce((s, v) => s + v, 0);
  return monthlyArr.some(v => v > 0) ? monthlySum : (annualScalar || 0);
};

// Whitelist validation
const ALLOWED_SECTORS = [
  'aluminium', 'cement', 'chlor_alkali', 'pulp_paper',
  'iron_steel', 'fertiliser', 'petroleum_refining',
  'petrochemical', 'textile',
];

const ALLOWED_SUBSECTORS = {
  aluminium:          ['primary', 'secondary'],
  cement:             ['opc', 'ppc', 'psc'],
  chlor_alkali:       ['membrane', 'mercury'],
  pulp_paper:         ['integrated', 'rcf', 'specialty'],
  iron_steel:         ['bf_bof', 'dri_eaf_coal', 'dri_eaf_gas', 'eaf_scrap'],
  fertiliser:         ['urea', 'ammonia', 'dap_complex'],
  petroleum_refining: ['complex', 'simple'],
  petrochemical:      ['ethylene', 'aromatic'],
  textile:            ['integrated', 'processing'],
};

const ALLOWED_ACVA_STAGES = [
  'not_started', 'mrv_submitted', 'desk_review',
  'site_visit', 'draft_report', 'verified', 'rejected',
];

const ALLOWED_COMPLIANCE_YEARS = ['2025-26', '2026-27'];

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ccts/profile
// [FIX-GET-FIELDS] Returns facility_baseline_gei and facility_target_gei
// ─────────────────────────────────────────────────────────────────────────────
router.get('/profile', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         id, sector_id, subsector_id, entity_name, entity_cin, entity_gstin,
         bee_dc_number, ccts_entity_id, baseline_year, compliance_year,
         gate_capacity_yr, scope1_emissions, scope2_emissions, purchased_elec_kwh,
         facility_baseline_gei, facility_target_gei,
         acva_name, acva_accred_no, acva_stage,
         form_a, form_b, form_c, form_d, form_e2,
         mrv_plan_url, notes, monthly_prod, monthly_s1, monthly_elec,
         current_gei, total_emissions, ccc_surplus, ccc_deficit, total_production,
         updated_at
       FROM ccts_profile
       WHERE user_id = $1`,
      [req.user.id]
    );
    res.json({ data: rows[0] || null });
  } catch {
    dbErr(res, 'Fetch CCTS profile');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ccts/profile
// ─────────────────────────────────────────────────────────────────────────────
router.post('/profile', authenticate, async (req, res) => {
  const {
    sector_id, subsector_id, entity_name, entity_cin, entity_gstin,
    bee_dc_number, ccts_entity_id, baseline_year, compliance_year,
    gate_capacity_yr, scope1_emissions, scope2_emissions, purchased_elec_kwh,
    facility_baseline_gei, facility_target_gei,
    acva_name, acva_accred_no, acva_stage, mrv_plan_url, notes,
    form_a, form_b, form_c, form_d, form_e2,
    monthly_prod: rawProd, monthly_s1: rawS1, monthly_elec: rawElec,
  } = req.body;

  // ── Whitelist validation ──────────────────────────────────────────
  const cleanSector      = ALLOWED_SECTORS.includes(sector_id) ? sector_id : 'cement';
  const validSubsectors  = ALLOWED_SUBSECTORS[cleanSector] || [];
  const cleanSubsector   = validSubsectors.includes(subsector_id) ? subsector_id : validSubsectors[0];
  const cleanCompYear    = ALLOWED_COMPLIANCE_YEARS.includes(compliance_year) ? compliance_year : '2025-26';
  const cleanAcvaStage   = ALLOWED_ACVA_STAGES.includes(acva_stage) ? acva_stage : 'not_started';

  // ── Monthly array validation ──────────────────────────────────────
  const monthlyProd = validateMonthlyArray(rawProd,  1e9);
  const monthlyS1   = validateMonthlyArray(rawS1,    1e9);
  const monthlyElec = validateMonthlyArray(rawElec,  1e12);

  if (!monthlyProd || !monthlyS1 || !monthlyElec) {
    return res.status(400).json({
      error: 'monthly_prod, monthly_s1, monthly_elec must each be arrays of exactly 12 non-negative numbers',
    });
  }

  // ── Numeric validation ────────────────────────────────────────────
  const cleanCapacity          = safeFloat(gate_capacity_yr,     0, 1e9);
  const cleanS1Annual          = safeFloat(scope1_emissions,     0, 1e9);
  const cleanS2Override        = safeFloat(scope2_emissions,     0, 1e9);
  const cleanElecKwhAnnual     = safeFloat(purchased_elec_kwh,   0, 1e13);
  // [FIX-FACILITY-GEI] validate facility-specific GEI fields
  const cleanFacilityBaseline  = safeFloat(facility_baseline_gei, 0, 1e6);
  const cleanFacilityTarget    = safeFloat(facility_target_gei,   0, 1e6);

  // ── [FIX-DOUBLE-COUNT] Resolve annual totals ──────────────────────
  // Monthly array wins if any month has data; otherwise use annual scalar.
  const totalProd  = resolveAnnual(monthlyProd, cleanCapacity);
  const totalS1    = resolveAnnual(monthlyS1,   cleanS1Annual);
  const totalElec  = resolveAnnual(monthlyElec, cleanElecKwhAnnual);

  // Scope 2: use override if provided, else calculate from electricity
  const computedS2     = cleanS2Override ?? (totalElec * CEA_GRID_EF_2024 / 1000);
  const totalEmissions = totalS1 + computedS2;

  // GEI = total emissions / production
  const gei = totalProd > 0 ? totalEmissions / totalProd : 0;

  // ── [FIX-CCC-SERVER] Server-side CCC recalculation ────────────────
  // Use facility-specific baseline/target if provided (from BEE DC letter).
  // Falls back to client-supplied ccc_surplus/deficit if not available,
  // since we don't maintain the full sector target table server-side.
  let cccSurplus, cccDeficit;

  if (cleanFacilityBaseline && cleanFacilityTarget && totalProd > 0) {
    // Recalculate server-side using gazette formula
    cccSurplus = gei < cleanFacilityBaseline
      ? Math.floor(Math.max(0, cleanFacilityBaseline - gei) * totalProd)
      : 0;
    cccDeficit = gei > cleanFacilityTarget
      ? Math.ceil(Math.max(0, gei - cleanFacilityTarget) * totalProd)
      : 0;
  } else {
    // Trust client-supplied values — facility targets not yet set server-side
    cccSurplus = safeInt(req.body.ccc_surplus, 0, 10_000_000) ?? 0;
    cccDeficit = safeInt(req.body.ccc_deficit, 0, 10_000_000) ?? 0;
  }

  // ── String sanitisation ───────────────────────────────────────────
  const cleanEntityName    = sanitiseText(entity_name,    200);
  const cleanCin           = String(entity_cin   || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 21);
  const cleanGstin         = String(entity_gstin || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
  const cleanBeeDC         = sanitiseText(bee_dc_number,  100);
  const cleanCctsId        = sanitiseText(ccts_entity_id, 100);
  const cleanBaseYear      = String(baseline_year || '2023-24').replace(/[^0-9\-]/g, '').slice(0, 10);
  const cleanAcvaName      = sanitiseText(acva_name,      200);
  const cleanAcvaAccredNo  = sanitiseText(acva_accred_no, 100);
  const cleanMrvUrl        = sanitiseText(mrv_plan_url,   500).replace(/[<>'"]/g, '');
  const cleanNotes         = sanitiseText(notes,          1000);

  try {
    const { rows } = await query(
      `INSERT INTO ccts_profile (
         user_id, sector_id, subsector_id, entity_name, entity_cin, entity_gstin,
         bee_dc_number, ccts_entity_id, baseline_year, compliance_year,
         gate_capacity_yr, scope1_emissions, scope2_emissions, purchased_elec_kwh,
         facility_baseline_gei, facility_target_gei,
         acva_name, acva_accred_no, acva_stage,
         form_a, form_b, form_c, form_d, form_e2,
         mrv_plan_url, notes,
         monthly_prod, monthly_s1, monthly_elec,
         current_gei, total_emissions, ccc_surplus, ccc_deficit, total_production,
         updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
         $11,$12,$13,$14,$15,$16,$17,$18,$19,
         $20,$21,$22,$23,$24,$25,$26,
         $27,$28,$29,$30,$31,$32,$33,$34, NOW()
       )
       ON CONFLICT (user_id) DO UPDATE SET
         sector_id             = $2,  subsector_id          = $3,
         entity_name           = $4,  entity_cin            = $5,
         entity_gstin          = $6,  bee_dc_number         = $7,
         ccts_entity_id        = $8,  baseline_year         = $9,
         compliance_year       = $10, gate_capacity_yr      = $11,
         scope1_emissions      = $12, scope2_emissions      = $13,
         purchased_elec_kwh    = $14,
         facility_baseline_gei = $15, facility_target_gei   = $16,
         acva_name             = $17, acva_accred_no        = $18,
         acva_stage            = $19, form_a                = $20,
         form_b                = $21, form_c                = $22,
         form_d                = $23, form_e2               = $24,
         mrv_plan_url          = $25, notes                 = $26,
         monthly_prod          = $27, monthly_s1            = $28,
         monthly_elec          = $29, current_gei           = $30,
         total_emissions       = $31, ccc_surplus           = $32,
         ccc_deficit           = $33, total_production      = $34,
         updated_at            = NOW()
       RETURNING *`,
      [
        req.user.id,
        cleanSector,
        cleanSubsector,
        cleanEntityName       || null,
        cleanCin              || null,
        cleanGstin            || null,
        cleanBeeDC            || null,
        cleanCctsId           || null,
        cleanBaseYear         || '2023-24',
        cleanCompYear,
        cleanCapacity         ?? null,
        cleanS1Annual         ?? null,
        cleanS2Override       ?? null,
        cleanElecKwhAnnual    ?? null,
        cleanFacilityBaseline ?? null,  // $15
        cleanFacilityTarget   ?? null,  // $16
        cleanAcvaName         || null,
        cleanAcvaAccredNo     || null,
        cleanAcvaStage,
        Boolean(form_a),
        Boolean(form_b),
        Boolean(form_c),
        Boolean(form_d),
        Boolean(form_e2),
        cleanMrvUrl           || null,
        cleanNotes            || null,
        JSON.stringify(monthlyProd),
        JSON.stringify(monthlyS1),
        JSON.stringify(monthlyElec),
        gei                   || null,
        totalEmissions        || null,
        cccSurplus,
        cccDeficit,
        totalProd             || null,
      ]
    );
    res.json({ message: 'CCTS profile saved', data: rows[0] });
  } catch {
    dbErr(res, 'Save CCTS profile');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ccts/summary
// ─────────────────────────────────────────────────────────────────────────────
router.get('/summary', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         sector_id, subsector_id, current_gei, total_emissions,
         ccc_surplus, ccc_deficit, total_production,
         facility_baseline_gei, facility_target_gei,
         acva_stage, compliance_year,
         (form_a AND form_b AND form_c AND form_d AND form_e2) AS all_forms_complete,
         updated_at
       FROM ccts_profile
       WHERE user_id = $1`,
      [req.user.id]
    );

    if (!rows.length) return res.json({ summary: null });

    const r       = rows[0];
    const surplus = parseInt(r.ccc_surplus || 0, 10);
    const deficit = parseInt(r.ccc_deficit || 0, 10);

    const penaltyEstimate = deficit > 0
      ? deficit * EST_CCC_PRICE * PENALTY_MULTIPLIER
      : 0;

    res.json({
      summary: {
        ...r,
        ccc_surplus:       surplus,
        ccc_deficit:       deficit,
        penalty_estimate:  penaltyEstimate,
        penalty_basis:     `${PENALTY_MULTIPLIER}× average CCC price per MoEFCC GEI Target Rules 2025`,
        grid_ef_used:      CEA_GRID_EF_2024,
        grid_ef_source:    'CEA V20.0 Dec 2024 (FY 2023-24)',
        covered_ghgs:      'CO₂ and PFCs only (per BEE July 2024 procedure document)',
        form_a_deadline:   'July 2026 (per ICM Portal — launched 21 March 2026)',
      },
    });
  } catch {
    dbErr(res, 'CCTS summary');
  }
});

module.exports = router;

// ─────────────────────────────────────────────────────────────────────────────
// DB MIGRATION — run once
// ─────────────────────────────────────────────────────────────────────────────
// ALTER TABLE ccts_profile
//   ADD COLUMN IF NOT EXISTS facility_baseline_gei NUMERIC,
//   ADD COLUMN IF NOT EXISTS facility_target_gei   NUMERIC;