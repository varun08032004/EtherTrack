'use strict';
/**
 * services/brsrPdfAdapter.js — EtherTrack
 * Transforms saved Section A / B / principles data into the flat `brsr`
 * object that buildBRSRHTML() expects.
 *
 * USAGE (in routes/reports.js):
 *   const { assembleBrsrPayload } = require('./brsrPdfAdapter');
 *   const snapshot = await fetch /api/brsr/all/:year
 *   const { brsr, energyData, waterData, wasteData } =
 *         assembleBrsrPayload(snapshot);
 *   await generateReport('brsr', { ...corePayload, brsr, energyData, waterData, wasteData });
 *
 * [FIX] buildSectionA and buildSectionB now use `sA = sA || {}` instead of
 *       default param `= {}` — default params do NOT fire when null is explicitly
 *       passed, only when undefined is passed. This caused the crash:
 *       "Cannot read properties of null (reading 'entity')" when the user has
 *       not yet filled in BRSR Section A data.
 */

const PRINCIPLE_ORDER = ['p1','p2','p3','p4','p5','p6','p7','p8','p9'];

const yn = (v) => v === true ? 'Yes' : v === false ? 'No' : null;

const pct = (num, den) => {
  if (!den) return null;
  return +((Number(num)||0) / den * 100).toFixed(1);
};

const joinLabelled = (matrixObj, fieldKey) => {
  const parts = PRINCIPLE_ORDER
    .map(pid => ({ pid, val: matrixObj?.[pid]?.[fieldKey] }))
    .filter(({ val }) => val != null && val !== '');
  return parts.length ? parts.map(({ pid, val }) => `${pid.toUpperCase()}: ${val}`).join('; ') : null;
};

const toArray9 = (matrixObj, fieldKey, mapFn = yn) =>
  PRINCIPLE_ORDER.map(pid => mapFn(matrixObj?.[pid]?.[fieldKey] ?? null));

// ─────────────────────────────────────────────────────────────────────────────
// SECTION A → flat brsr fields
// ─────────────────────────────────────────────────────────────────────────────

function buildSectionA(sA) {
  sA = sA || {};  // [FIX] handles null explicitly — default param `= {}` does not
  const e  = sA.entity    || {};
  const b  = sA.business  || {};
  const w  = sA.workforce || {};
  const s  = sA.structure || {};
  const g  = sA.grievance || {};

  const empPermTotal  = (w.empPermMale  ||0)+(w.empPermFemale  ||0)+(w.empPermOther  ||0);
  const empOtherTotal = (w.empOtherMale ||0)+(w.empOtherFemale ||0)+(w.empOtherOther ||0);
  const empTotal      = empPermTotal + empOtherTotal;
  const wkrPermTotal  = (w.workerPermMale  ||0)+(w.workerPermFemale  ||0)+(w.workerPermOther  ||0);
  const wkrOtherTotal = (w.workerOtherMale ||0)+(w.workerOtherFemale ||0)+(w.workerOtherOther ||0);
  const wkrTotal      = wkrPermTotal + wkrOtherTotal;

  return {
    // Entity
    company_cin:        e.cin                     || null,
    registered_address: e.regOfficeAddress        || null,
    corporate_address:  e.corpOfficeAddress       || null,
    email:              e.email                   || null,
    telephone:          e.telephone               || null,
    website:            e.website                 || null,
    stock_exchange:     [e.listedNSE&&'NSE', e.listedBSE&&'BSE'].filter(Boolean).join(', ') || null,
    paid_up_capital:    e.paidUpCapital            ?? null,
    contact_name:       e.contactName             || null,
    contact_designation:e.contactDesignation      || null,
    contact_phone:      e.contactTelephone        || null,
    contact_email:      e.contactEmail            || null,
    reporting_boundary: e.reportingBoundary === 'consolidated' ? 'Consolidated'
                      : e.reportingBoundary === 'standalone'   ? 'Standalone' : null,
    year_of_incorporation: e.yearIncorporation    ?? null,
    industry:           e.industry                || null,

    // Products / business
    business_activities: (b.activities||[]).map(a=>({
      main_activity:     a.mainActivity,
      business_activity: a.businessActivity,
      turnover_pct:      a.turnoverPct,
    })),
    products_services: (b.products||[]).map(p=>({
      product:      p.productDescription,
      nic_code:     p.nicCode,
      turnover_pct: p.turnoverPct,
    })),

    // Operations
    ops_plants_national:  b.nationalPlants      ?? null,
    ops_offices_national: b.nationalOffices     ?? null,
    ops_total_national:   (b.nationalPlants||b.nationalOffices)
                          ? (b.nationalPlants||0)+(b.nationalOffices||0) : null,
    ops_plants_intl:      b.internationalPlants  ?? null,
    ops_offices_intl:     b.internationalOffices ?? null,
    ops_total_intl:       (b.internationalPlants||b.internationalOffices)
                          ? (b.internationalPlants||0)+(b.internationalOffices||0) : null,
    markets_national_states:  b.nationalLocations     ?? null,
    markets_intl_countries:   b.internationalLocations ?? null,
    exports_pct:              b.exportsPct             ?? null,
    customer_types:           b.customerTypes          || null,

    // Employees
    emp_perm_total:      empPermTotal  || null,
    emp_perm_male:       w.empPermMale  ?? null,
    emp_perm_male_pct:   pct(w.empPermMale, empPermTotal),
    emp_perm_female:     w.empPermFemale ?? null,
    emp_perm_female_pct: pct(w.empPermFemale, empPermTotal),
    emp_other_total:     empOtherTotal || null,
    emp_other_male:      w.empOtherMale  ?? null,
    emp_other_male_pct:  pct(w.empOtherMale, empOtherTotal),
    emp_other_female:    w.empOtherFemale ?? null,
    emp_other_female_pct:pct(w.empOtherFemale, empOtherTotal),
    emp_total:           empTotal || null,
    emp_total_male:      (w.empPermMale||0)+(w.empOtherMale||0) || null,
    emp_total_male_pct:  pct((w.empPermMale||0)+(w.empOtherMale||0), empTotal),
    emp_total_female:    (w.empPermFemale||0)+(w.empOtherFemale||0) || null,
    emp_total_female_pct:pct((w.empPermFemale||0)+(w.empOtherFemale||0), empTotal),

    // Workers
    wkr_perm_total:       wkrPermTotal  || null,
    wkr_perm_male:        w.workerPermMale  ?? null,
    wkr_perm_male_pct:    pct(w.workerPermMale, wkrPermTotal),
    wkr_perm_female:      w.workerPermFemale ?? null,
    wkr_perm_female_pct:  pct(w.workerPermFemale, wkrPermTotal),
    wkr_other_total:      wkrOtherTotal || null,
    wkr_other_male:       w.workerOtherMale  ?? null,
    wkr_other_male_pct:   pct(w.workerOtherMale, wkrOtherTotal),
    wkr_other_female:     w.workerOtherFemale ?? null,
    wkr_other_female_pct: pct(w.workerOtherFemale, wkrOtherTotal),
    wkr_total:            wkrTotal || null,
    wkr_total_male:       (w.workerPermMale||0)+(w.workerOtherMale||0) || null,
    wkr_total_male_pct:   pct((w.workerPermMale||0)+(w.workerOtherMale||0), wkrTotal),
    wkr_total_female:     (w.workerPermFemale||0)+(w.workerOtherFemale||0) || null,
    wkr_total_female_pct: pct((w.workerPermFemale||0)+(w.workerOtherFemale||0), wkrTotal),

    // Women representation
    women_bod_total:  w.womenBodTotal ?? null,
    women_bod_no:     w.womenBodNo    ?? null,
    women_bod_pct:    w.womenBoardPct ?? pct(w.womenBodNo, w.womenBodTotal),
    women_kmp_total:  w.womenKmpTotal ?? null,
    women_kmp_no:     w.womenKmpNo    ?? null,
    women_kmp_pct:    w.womenKmpPct   ?? pct(w.womenKmpNo, w.womenKmpTotal),

    // Structure
    subsidiaries: (s.entities||[]).map(ent=>({
      name:         ent.name,
      type:         ent.type,
      shares_pct:   ent.sharesPct,
      br_initiative:yn(ent.participatesBR),
    })),
    csr_applicable: yn(s.csrApplicable),
    csr_turnover:   s.turnoverRs  ?? null,
    csr_net_worth:  s.netWorthRs  ?? null,

    // Grievance (Q25)
    grievance_rows: g.rows || [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION B → flat brsr fields
// ─────────────────────────────────────────────────────────────────────────────

const REASON_OPTIONS = [
  'not_material', 'not_ready', 'no_resources', 'planned_next', 'other',
];

function buildSectionB(sB) {
  sB = sB || {};  // [FIX] handles null explicitly — default param `= {}` does not
  const pm  = sB.policyMatrix || {};
  const nc  = sB.nonCoverage  || {};
  const gov = sB.governance   || {};

  const reviewFreq = PRINCIPLE_ORDER.map(pid => gov.reviewFrequency?.[pid] || null);

  return {
    policy_covers:         toArray9(pm, 'hasPolicy'),
    policy_board_approved: toArray9(pm, 'boardApproved'),
    policy_procedures:     toArray9(pm, 'hasPolicy'),
    policy_value_chain:    toArray9(pm, 'extendsToValueChain'),
    policy_web_link:       joinLabelled(pm, 'weblink'),
    certifications:        joinLabelled(pm, 'standards'),
    commitments_goals:     joinLabelled(pm, 'commitments'),
    commitments_performance:joinLabelled(pm, 'performance'),

    director_statement:      gov.directorStatement || null,
    highest_authority:       [gov.responsibleName, gov.responsibleDesignation].filter(Boolean).join(' — ') || null,
    sustainability_committee:gov.responsibleName ? 'Yes' : null,

    review_performance:         reviewFreq,
    review_frequency:           reviewFreq,
    review_compliance:          reviewFreq,
    review_compliance_frequency:reviewFreq,

    external_assessment: PRINCIPLE_ORDER.map(() => yn(gov.independentAssessment)),

    no_reason_not_material: PRINCIPLE_ORDER.map(pid => nc[pid]?.reason === 'not_material' ? 'Yes' : null),
    no_reason_not_ready:    PRINCIPLE_ORDER.map(pid => nc[pid]?.reason === 'not_ready'    ? 'Yes' : null),
    no_reason_no_resources: PRINCIPLE_ORDER.map(pid => nc[pid]?.reason === 'no_resources' ? 'Yes' : null),
    no_reason_planned_next: PRINCIPLE_ORDER.map(pid => nc[pid]?.reason === 'planned_next' ? 'Yes' : null),
    no_reason_other:        PRINCIPLE_ORDER.map(pid => nc[pid]?.reason === 'other' ? (nc[pid].notes||'Yes') : null),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION C PRINCIPLES → flat brsr fields (P1–P5, P7–P9)
// ─────────────────────────────────────────────────────────────────────────────

function buildPrinciples(principles = {}) {
  const p1 = principles.p1 || {};
  const p2 = principles.p2 || {};
  const p3 = principles.p3 || {};
  const p4 = principles.p4 || {};
  const p5 = principles.p5 || {};
  const p7 = principles.p7 || {};
  const p8 = principles.p8 || {};
  const p9 = principles.p9 || {};

  return {
    // P1
    anti_corruption_policy:  p1.antiCorruptionPolicy  || null,
    accounts_payable_days:   p1.accountsPayableDays   ?? null,

    // P2
    sustainable_sourcing:    p2.sustainableSourcing    || null,
    epr_applicable:          p2.eprApplicable          || null,

    // P3
    ohs_system:              p3.ohsSystem              || null,
    ltifr_employees:         p3.ltifrEmployees         ?? null,
    ltifr_workers:           p3.ltifrWorkers           ?? null,
    fatalities_employees:    p3.fatalitiesEmployees    ?? null,
    fatalities_workers:      p3.fatalitiesWorkers      ?? null,
    wellbeing_spend_pct:     p3.wellbeingSpendPct      ?? null,
    workplace_accessible:    p3.workplaceAccessible    || null,
    equal_opportunity_policy:p3.equalOpportunityPolicy || null,
    life_insurance_emp:      p3.lifeInsuranceEmployees || null,
    life_insurance_wkr:      p3.lifeInsuranceWorkers   || null,
    assessment_hs_pct:       p3.assessmentHealthSafetyPct ?? null,
    assessment_wc_pct:       p3.assessmentWorkingCondsPct ?? null,

    // P4
    stakeholder_process:     p4.stakeholderProcess     || null,

    // P5
    female_wages_pct:        p5.femaleWagesPct         ?? null,
    hr_focal_point:          p5.hrFocalPoint           || null,
    posh_total:              p5.poshTotalComplaints    ?? null,
    posh_pct:                p5.poshPct                ?? null,
    posh_upheld:             p5.poshUpheld             ?? null,
    hr_in_contracts:         p5.hrInContracts          || null,
    assess_child_labour_pct: p5.assessChildLabourPct   ?? null,
    assess_sex_harass_pct:   p5.assessSexHarassPct     ?? null,

    // P7
    trade_affiliations:      p7.tradeAffiliations      ?? null,

    // P8
    msme_sourcing_pct:       p8.msmeSourcingPct        ?? null,
    local_sourcing_pct:      p8.localSourcingPct       ?? null,
    csr_beneficiaries:       p8.csrBeneficiaries       ?? null,

    // P9
    data_breaches:           p9.dataBreaches           ?? null,
    pii_breaches_pct:        p9.piiBreachesPct         ?? null,
    cyber_security_policy:   p9.cyberSecurityPolicy    || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MASTER ASSEMBLER — call this before generateReport('brsr', payload)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} snapshot — response from GET /api/brsr/all/:year
 * @returns {{ brsr, energyData, waterData, wasteData }}
 */
function assembleBrsrPayload(snapshot = {}) {
  const { sectionA = {}, sectionB = {}, principles = {} } = snapshot;

  // P6 energy/water/waste — passed separately to buildBRSRHTML (not inside brsr obj)
  const p6         = principles.p6  || {};
  const energyData = p6.energyData  || null;
  const waterData  = p6.waterData   || null;
  const wasteData  = p6.wasteData   || null;

  const brsr = {
    ...buildSectionA(sectionA),
    ...buildSectionB(sectionB),
    ...buildPrinciples(principles),
    pat_scheme:               principles.p6?.patScheme            || null,
    ghg_reduction_project:    principles.p6?.ghgReductionProject  || null,
    env_compliance:           principles.p6?.envCompliance        || null,
    waste_management_practices: principles.p6?.wasteMgmtPractices || null,
  };

  return { brsr, energyData, waterData, wasteData };
}

module.exports = { assembleBrsrPayload, buildSectionA, buildSectionB, buildPrinciples };