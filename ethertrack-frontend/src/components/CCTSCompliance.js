// src/components/CCTSCompliance.jsx
// India Carbon Credit Trading Scheme (CCTS)
// ── Regulatory compliance:
//    9 sectors per BEE Oct 2025 + Jan 2026 gazette notifications
//    Added: Fertiliser (Oct 2025) and Iron & Steel (Jan 2026)
//    CCC formula per gazette:
//      Surplus = max(0, GEI_baseline - GEI_actual) × production
//      Deficit = max(0, GEI_actual - GEI_target)   × production
//    Penalty = Environmental Compensation = 2× average CCC price (CPCB)
//    Covered GHGs: CO₂ and PFCs only (BEE July 2024 procedure document)
//    Form A deadline: July 2026 (ICM Portal launched 21 March 2026)
//    Form B deadline: April 2026 (baseline declaration — unchanged)
//    Forms C, D, E2 deadline: July 2026
//    Grid EF: 0.727 tCO₂/MWh — CEA V20.0 Dec 2024 (FY 2023-24)
// ── v2 changes:
//    [MERGE] BEE FORMAT REPORT tab absorbed from CCTSGEIReport.jsx
//            — exportBEEFormat() (RECPDCL-compatible MRV JSON)
//            — exportCSV()
//            — BEE report read-only view
//            — ACVA verification tab (merged into existing ACVA tab)
//    [REMOVE] CCTSGEIReport.jsx can now be deleted
//    [FIX] safeInt imported but unused — removed
// ── Security:
//    Abort controller on mount
//    Blob URLs revoked after export
//    All inputs sanitised + length-capped
//    Monthly arrays validated as exactly 12 non-negative numbers
//    Double-submit prevented with saving flag

import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../services/api';

const fmt = (n, d = 2) =>
  Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });

const sanitise = (str = '', max = 200) =>
  String(str).replace(/<[^>]*>/g, '').replace(/['"`;]/g, '').trim().slice(0, max);

const safeFloat = (val, min = 0, max = 1e12) => {
  const n = parseFloat(val);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

// ─────────────────────────────────────────────────────────────────────────────
// REGULATORY CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const CEA_GRID_EF        = 0.727;   // tCO₂/MWh — CEA V20.0 Dec 2024
const PENALTY_MULTIPLIER = 2.0;     // MoEFCC GEI Target Rules 2025
const EST_CCC_PRICE      = 1_200;   // ₹/CCC estimated (CERC floor not yet notified)

// ─────────────────────────────────────────────────────────────────────────────
// CCTS SECTOR TARGETS — 9 gazetted sectors
// ─────────────────────────────────────────────────────────────────────────────
const CCTS_SECTORS = {
  aluminium: {
    label: 'Aluminium', gazette_ref: 'BEE Oct 2025 gazette notification',
    covered_ghgs: 'CO₂ and PFCs (per BEE July 2024 procedure document)',
    scope: '1+2', threshold_mtoe: 7_500,
    notes: 'PFCs from anode effects included in Scope 1.',
    subsectors: [
      { id: 'primary',   label: 'Primary Aluminium',   unit: 'tonne Al',  baseline_gei: 14.2,  target_fy26: 13.9,  target_fy27: 13.4  },
      { id: 'secondary', label: 'Secondary Aluminium', unit: 'tonne Al',  baseline_gei: 3.1,   target_fy26: 3.05,  target_fy27: 2.95  },
    ],
  },
  cement: {
    label: 'Cement', gazette_ref: 'BEE Oct 2025 gazette notification',
    covered_ghgs: 'CO₂ only', scope: '1+2', threshold_mtoe: 30_000,
    notes: 'Clinker output as denominator. Process CO₂ from limestone calcination in Scope 1.',
    subsectors: [
      { id: 'opc', label: 'OPC (Ordinary Portland)',  unit: 'tonne clinker', baseline_gei: 0.843, target_fy26: 0.831, target_fy27: 0.812 },
      { id: 'ppc', label: 'PPC (Portland Pozzolana)', unit: 'tonne clinker', baseline_gei: 0.712, target_fy26: 0.702, target_fy27: 0.686 },
      { id: 'psc', label: 'PSC (Portland Slag)',      unit: 'tonne clinker', baseline_gei: 0.634, target_fy26: 0.625, target_fy27: 0.611 },
    ],
  },
  chlor_alkali: {
    label: 'Chlor-Alkali', gazette_ref: 'BEE Oct 2025 gazette notification',
    covered_ghgs: 'CO₂ only', scope: '1+2', threshold_mtoe: 7_500,
    notes: 'Mercury cell plants face stricter reduction schedule.',
    subsectors: [
      { id: 'membrane', label: 'Membrane Cell', unit: 'tonne Cl₂', baseline_gei: 1.42, target_fy26: 1.40, target_fy27: 1.37 },
      { id: 'mercury',  label: 'Mercury Cell',  unit: 'tonne Cl₂', baseline_gei: 2.21, target_fy26: 2.15, target_fy27: 2.08 },
    ],
  },
  pulp_paper: {
    label: 'Pulp & Paper', gazette_ref: 'BEE Oct 2025 gazette notification',
    covered_ghgs: 'CO₂ only', scope: '1+2', threshold_mtoe: 7_500,
    notes: 'Black liquor combustion at IPCC biogenic factor.',
    subsectors: [
      { id: 'integrated', label: 'Integrated (>50k TPY)',      unit: 'tonne paper', baseline_gei: 1.84, target_fy26: 1.80, target_fy27: 1.74 },
      { id: 'rcf',        label: 'RCF / Agro-based (10–50k)', unit: 'tonne paper', baseline_gei: 2.12, target_fy26: 2.08, target_fy27: 2.01 },
      { id: 'specialty',  label: 'Specialty / Writing Paper', unit: 'tonne paper', baseline_gei: 2.45, target_fy26: 2.40, target_fy27: 2.33 },
    ],
  },
  fertiliser: {
    label: 'Fertiliser', gazette_ref: 'BEE Oct 2025 gazette notification — fertiliser sector added',
    covered_ghgs: 'CO₂ only', scope: '1+2', threshold_mtoe: 7_500,
    notes: 'Process CO₂ from steam methane reforming in Scope 1.',
    subsectors: [
      { id: 'urea',        label: 'Urea (naphtha/gas based)',     unit: 'tonne urea', baseline_gei: 2.42, target_fy26: 2.38, target_fy27: 2.31 },
      { id: 'ammonia',     label: 'Ammonia / Complex fertiliser', unit: 'tonne NH₃',  baseline_gei: 2.18, target_fy26: 2.14, target_fy27: 2.08 },
      { id: 'dap_complex', label: 'DAP / Complex fertiliser',     unit: 'tonne DAP',  baseline_gei: 0.84, target_fy26: 0.82, target_fy27: 0.80 },
    ],
  },
  iron_steel: {
    label: 'Iron & Steel', gazette_ref: 'BEE Jan 2026 gazette notification — iron & steel added',
    covered_ghgs: 'CO₂ only', scope: '1+2', threshold_mtoe: 30_000,
    notes: 'Phase 2 coverage — compliance starts FY2025-26.',
    subsectors: [
      { id: 'bf_bof',       label: 'BF-BOF (Integrated)',   unit: 'tonne crude steel', baseline_gei: 2.55, target_fy26: 2.50, target_fy27: 2.43 },
      { id: 'dri_eaf_coal', label: 'DRI-EAF (coal based)',  unit: 'tonne crude steel', baseline_gei: 3.12, target_fy26: 3.06, target_fy27: 2.97 },
      { id: 'dri_eaf_gas',  label: 'DRI-EAF (gas based)',   unit: 'tonne crude steel', baseline_gei: 1.84, target_fy26: 1.80, target_fy27: 1.75 },
      { id: 'eaf_scrap',    label: 'EAF (scrap based)',     unit: 'tonne crude steel', baseline_gei: 0.72, target_fy26: 0.71, target_fy27: 0.69 },
    ],
  },
  petroleum_refining: {
    label: 'Petroleum Refining', gazette_ref: 'BEE Oct 2025 gazette notification',
    covered_ghgs: 'CO₂ only', scope: '1+2', threshold_mtoe: 30_000,
    notes: 'Nelson Complexity Index adjustments apply. Flaring in Scope 1.',
    subsectors: [
      { id: 'complex', label: 'Complex Refinery', unit: 'Crude Throughput (MT)', baseline_gei: 0.234, target_fy26: 0.230, target_fy27: 0.224 },
      { id: 'simple',  label: 'Simple/Topping',   unit: 'Crude Throughput (MT)', baseline_gei: 0.178, target_fy26: 0.175, target_fy27: 0.171 },
    ],
  },
  petrochemical: {
    label: 'Petrochemicals', gazette_ref: 'BEE Oct 2025 gazette notification',
    covered_ghgs: 'CO₂ only', scope: '1+2', threshold_mtoe: 30_000,
    notes: 'Steam cracker process emissions dominate Scope 1.',
    subsectors: [
      { id: 'ethylene', label: 'Ethylene / Olefins', unit: 'tonne product', baseline_gei: 2.31, target_fy26: 2.27, target_fy27: 2.21 },
      { id: 'aromatic', label: 'Aromatics',           unit: 'tonne product', baseline_gei: 1.87, target_fy26: 1.84, target_fy27: 1.79 },
    ],
  },
  textile: {
    label: 'Textile', gazette_ref: 'BEE Oct 2025 gazette notification',
    covered_ghgs: 'CO₂ only', scope: '1+2', threshold_mtoe: 7_500,
    notes: 'Coal-fired thermic fluid heaters are primary Scope 1 source.',
    subsectors: [
      { id: 'integrated', label: 'Integrated (Spinning+Weaving+Processing)', unit: 'tonne fabric', baseline_gei: 3.42, target_fy26: 3.36, target_fy27: 3.27 },
      { id: 'processing', label: 'Processing / Dyeing Only',                 unit: 'tonne fabric', baseline_gei: 2.18, target_fy26: 2.14, target_fy27: 2.08 },
    ],
  },
};

const CCTS_FORMS = [
  { id: 'A',  label: 'Form A',  title: 'Entity Registration & Identification',    status_key: 'form_a',  deadline: 'July 2026'  },
  { id: 'B',  label: 'Form B',  title: 'Emission Intensity Baseline Declaration', status_key: 'form_b',  deadline: 'April 2026' },
  { id: 'C',  label: 'Form C',  title: 'Annual GEI Activity Report',              status_key: 'form_c',  deadline: 'July 2026'  },
  { id: 'D',  label: 'Form D',  title: 'ACVA Third-Party Verification Statement', status_key: 'form_d',  deadline: 'July 2026'  },
  { id: 'E2', label: 'Form E2', title: 'MRV Plan & Monitoring Methodology',       status_key: 'form_e2', deadline: 'July 2026'  },
];

const ACVA_AGENCIES = [
  'RECPDCL (Rural Electrification Corp)', 'Bureau Veritas India', 'DNV India',
  'TÜV SÜD South Asia', 'SGS India', 'Intertek India', 'BSI Group India',
  'EY India', 'KPMG India', 'Deloitte India', 'Other BEE-accredited ACVA',
];

const ACVA_STAGES = [
  { id: 'not_started',   label: 'Not Started',         color: '#4a5278' },
  { id: 'mrv_submitted', label: 'MRV Plan Submitted',  color: '#3b82f6' },
  { id: 'desk_review',   label: 'Desk Review',          color: '#f59e0b' },
  { id: 'site_visit',    label: 'Site Visit Scheduled', color: '#a855f7' },
  { id: 'draft_report',  label: 'Draft Report Issued',  color: '#f97316' },
  { id: 'verified',      label: 'Verified ✓',           color: '#10b981' },
  { id: 'rejected',      label: 'Rejected — Resubmit',  color: '#ef4444' },
];

const MONTHS = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'];

const defForm = () => ({
  sector_id: 'cement', subsector_id: 'opc',
  entity_name: '', entity_cin: '', entity_gstin: '',
  bee_dc_number: '', ccts_entity_id: '',
  baseline_year: '2023-24', compliance_year: '2025-26',
  gate_capacity_yr: '', scope1_emissions: '', scope2_emissions: '',
  purchased_elec_kwh: '', acva_name: '', acva_accred_no: '',
  acva_stage: 'not_started',
  form_a: false, form_b: false, form_c: false, form_d: false, form_e2: false,
  mrv_plan_url: '', notes: '',
  // BEE report fields (from CCTSGEIReport)
  facility_baseline_gei: '', facility_target_gei: '',
});

// ─────────────────────────────────────────────────────────────────────────────
// CSS
// ─────────────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap');
:root{--bg:#04080a;--surf:#0a0f14;--brd:#182030;--brd2:#243248;--txt:#e8f4f0;--mut:#3a5060;--grn:#10b981;--red:#ef4444;--ylw:#f59e0b;--blu:#3b82f6;--pur:#a855f7;--teal:#14b8a6;}
.ccts{min-height:100vh;background:var(--bg);font-family:'Space Mono',monospace;color:var(--txt);position:relative;}
.ccts::before{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(ellipse 60% 40% at 10% 20%,rgba(20,184,166,.04) 0%,transparent 60%),radial-gradient(ellipse 50% 60% at 90% 80%,rgba(16,185,129,.03) 0%,transparent 50%);}
.ccts-in{position:relative;z-index:1;max-width:1300px;margin:0 auto;padding:28px 24px 80px;}
.ccts-hd{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--brd);}
.ccts-label{font-size:9px;letter-spacing:.2em;color:var(--mut);}
.ccts-title{font-family:'Syne',sans-serif;font-size:21px;font-weight:800;margin-top:3px;}
.ccts-title span{color:var(--teal);}
.ccts-tabs{display:flex;gap:0;margin-bottom:20px;border-bottom:1px solid var(--brd);overflow-x:auto;}
.ccts-tab{padding:9px 15px;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.09em;cursor:pointer;border:none;background:none;color:var(--mut);border-bottom:2px solid transparent;transition:all .2s;margin-bottom:-1px;white-space:nowrap;}
.ccts-tab:hover{color:var(--txt);}
.ccts-tab.on{color:var(--teal);border-bottom-color:var(--teal);}
.ccts-card{background:var(--surf);border:1px solid var(--brd);border-radius:10px;padding:18px 20px;margin-bottom:12px;animation:fU .4s ease both;}
.ccts-ctit{font-size:9px;letter-spacing:.15em;color:var(--mut);margin-bottom:14px;display:flex;align-items:center;gap:8px;}
.ccts-ctit::before{content:'';width:10px;height:1px;background:var(--teal);}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}
.g4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;}
.fg{display:flex;flex-direction:column;gap:5px;margin-bottom:10px;}
.lbl{font-size:10px;letter-spacing:.1em;color:var(--mut);}
.inp,.sel{padding:9px 11px;border-radius:6px;background:#060c10;border:1px solid var(--brd);color:var(--txt);font-family:'Space Mono',monospace;font-size:12px;outline:none;transition:border-color .2s;width:100%;box-sizing:border-box;}
.inp:focus,.sel:focus{border-color:#14b8a644;}
.inp::placeholder{color:var(--mut);opacity:.7;}
.btn{padding:9px 17px;border-radius:6px;border:none;cursor:pointer;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.1em;font-weight:700;transition:all .2s;}
.btn:disabled{opacity:.5;cursor:not-allowed;}
.btn-teal{background:linear-gradient(135deg,#14b8a6,#0d9488);color:#fff;}
.btn-teal:hover:not(:disabled){opacity:.85;transform:translateY(-1px);}
.btn-g{background:var(--surf);border:1px solid var(--brd2);color:var(--txt);}
.btn-g:hover:not(:disabled){border-color:#14b8a644;color:var(--teal);}
.btn-sm{padding:6px 12px;font-size:10px;}
.stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;}
.stat-tile{background:#060c10;border-radius:8px;padding:14px;border:1px solid var(--brd);}
.stat-val{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;margin-bottom:2px;}
.stat-lbl{font-size:9px;color:var(--mut);letter-spacing:.1em;}
.stat-sub{font-size:10px;color:var(--mut);margin-top:2px;}
.gei-gauge{height:14px;border-radius:7px;background:var(--brd);overflow:hidden;margin:10px 0;}
.gei-fill{height:100%;border-radius:7px;transition:width .9s ease;}
.ccc-box{border-radius:10px;padding:20px;border:1px solid;margin-bottom:14px;}
.ccc-surplus{background:#10b98108;border-color:#10b98133;}
.ccc-deficit{background:#ef444408;border-color:#ef444433;}
.forms-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:16px;}
.form-tile{border-radius:8px;padding:14px;border:1px solid var(--brd);background:#060c10;cursor:pointer;transition:all .2s;text-align:center;}
.form-tile:hover{border-color:#14b8a644;}
.form-tile.done{border-color:#10b98144;background:#10b98108;}
.form-tile.pending{border-color:#f59e0b44;background:#f59e0b08;}
.acva-timeline{display:flex;flex-direction:column;gap:0;margin:14px 0;}
.acva-step{display:flex;align-items:flex-start;gap:12px;padding:12px 0;position:relative;}
.acva-step:not(:last-child)::after{content:'';position:absolute;left:11px;top:36px;bottom:0;width:1px;background:var(--brd);}
.acva-dot{width:22px;height:22px;border-radius:50%;flex-shrink:0;border:2px solid;display:flex;align-items:center;justify-content:center;font-size:10px;margin-top:1px;}
.acva-dot.active{animation:pulse 2s ease infinite;}
.al{padding:10px 14px;border-radius:7px;font-size:11px;display:flex;gap:8px;margin-bottom:12px;line-height:1.6;}
.al-g{background:#10b98108;border:1px solid #10b98133;color:var(--grn);}
.al-y{background:#f59e0b08;border:1px solid #f59e0b33;color:var(--ylw);}
.al-r{background:#ef444408;border:1px solid #ef444433;color:var(--red);}
.al-t{background:#14b8a608;border:1px solid #14b8a633;color:var(--teal);}
.al-b{background:#3b82f608;border:1px solid #3b82f633;color:var(--blu);}
.pill{display:inline-flex;align-items:center;gap:4px;font-size:9px;padding:3px 8px;border-radius:3px;letter-spacing:.05em;}
.pill-grn{background:#10b98114;color:#10b981;border:1px solid #10b98133;}
.pill-ylw{background:#f59e0b14;color:#f59e0b;border:1px solid #f59e0b33;}
.pill-red{background:#ef444414;color:#ef4444;border:1px solid #ef444433;}
.pill-blu{background:#3b82f614;color:#3b82f6;border:1px solid #3b82f633;}
.pill-teal{background:#14b8a614;color:#14b8a6;border:1px solid #14b8a633;}
.notif{position:fixed;top:76px;right:24px;z-index:9999;padding:11px 18px;border-radius:8px;font-family:'Space Mono',monospace;font-size:11px;box-shadow:0 8px 32px #00000088;animation:fU .3s ease;}
.notif-ok{background:#0b2a1e;border:1px solid #10b98133;color:#10b981;}
.notif-err{background:#450a0a;border:1px solid #ef444433;color:#f87171;}
.drow{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--brd)33;font-size:11px;}
.drow:last-child{border-bottom:none;}
.sector-tbl{width:100%;border-collapse:collapse;font-size:11px;}
.sector-tbl th{text-align:left;padding:8px 10px;font-size:9px;letter-spacing:.1em;color:var(--mut);border-bottom:1px solid var(--brd);background:#060c10;}
.sector-tbl td{padding:10px;border-bottom:1px solid var(--brd)22;}
.sector-tbl tr:hover td{background:#14b8a608;}
.prod-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:6px;margin-bottom:14px;}
.prod-cell{border-radius:5px;padding:8px 4px;text-align:center;border:1px solid var(--brd);background:#060c10;cursor:pointer;transition:all .2s;}
.prod-cell:hover,.prod-cell.active{border-color:#14b8a666;background:#14b8a608;}
.prod-cell-lbl{font-size:9px;color:var(--mut);margin-bottom:3px;}
@keyframes fU{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
@media(max-width:1000px){.g3,.g4,.stat-row{grid-template-columns:1fr 1fr;}.forms-grid{grid-template-columns:repeat(3,1fr);}}
@media(max-width:680px){.g2,.stat-row{grid-template-columns:1fr;}.forms-grid{grid-template-columns:1fr 1fr;}.prod-grid{grid-template-columns:repeat(6,1fr);}}
`;

// ─────────────────────────────────────────────────────────────────────────────
export default function CCTSCompliance({ profile }) {
  const [tab,         setTab]        = useState('gei');
  const [form,        setForm]       = useState(defForm());
  const [saved,       setSaved]      = useState(null);
  const [notif,       setNotif]      = useState(null);
  const [saving,      setSaving]     = useState(false);
  const [loading,     setLoading]    = useState(true);
  const [selMonth,    setSelMonth]   = useState(null);
  const [selType,     setSelType]    = useState('prod');
  const [monthVal,    setMonthVal]   = useState('');

  const [monthlyProd, setMonthlyProd] = useState(Array(12).fill(0));
  const [monthlyS1,   setMonthlyS1]   = useState(Array(12).fill(0));
  const [monthlyElec, setMonthlyElec] = useState(Array(12).fill(0));

  const abortRef = useRef(null);
  const toast = (msg, type = 'ok') => { setNotif({ msg, type }); setTimeout(() => setNotif(null), 4000); };

  const sector    = CCTS_SECTORS[form.sector_id]    || CCTS_SECTORS.cement;
  const subsector = sector.subsectors.find(s => s.id === form.subsector_id) || sector.subsectors[0];

  // ── Load ───────────────────────────────────────────────────────────
  useEffect(() => {
    const ctl = new AbortController();
    abortRef.current = ctl;
    apiFetch('/api/ccts/profile', { signal: ctl.signal })
      .then(res => {
        if (ctl.signal.aborted || !res?.data) return;
        const d = res.data;
        setForm(f => ({ ...f, ...d }));
        setSaved(d);
        if (Array.isArray(d.monthly_prod) && d.monthly_prod.length === 12)
          setMonthlyProd(d.monthly_prod.map(v => parseFloat(v) || 0));
        if (Array.isArray(d.monthly_s1) && d.monthly_s1.length === 12)
          setMonthlyS1(d.monthly_s1.map(v => parseFloat(v) || 0));
        if (Array.isArray(d.monthly_elec) && d.monthly_elec.length === 12)
          setMonthlyElec(d.monthly_elec.map(v => parseFloat(v) || 0));
      })
      .catch(() => {})
      .finally(() => { if (!ctl.signal.aborted) setLoading(false); });
    return () => ctl.abort();
  }, []);

  // Auto-populate from company profile
  useEffect(() => {
    if (profile && !form.entity_name) {
      setForm(f => ({
        ...f,
        entity_name:  sanitise(profile.company_name || '', 200),
        entity_cin:   sanitise(profile.company_cin   || '', 21),
        entity_gstin: sanitise(profile.company_gstin  || '', 15),
      }));
    }
  }, [profile]);

  // ── GEI calculations ───────────────────────────────────────────────
  // Monthly array takes precedence if ANY month has data.
  // Falls back to annual scalar so users can fill either tab and see live GEI.
  // Mirrors resolveAnnual() in backend ccts.js — must stay in sync.
  const totalProd = monthlyProd.some(v => v > 0)
    ? monthlyProd.reduce((s, v) => s + v, 0)
    : parseFloat(form.gate_capacity_yr   || 0);

  const totalS1 = monthlyS1.some(v => v > 0)
    ? monthlyS1.reduce((s, v) => s + v, 0)
    : parseFloat(form.scope1_emissions   || 0);

  const totalElecKwh = monthlyElec.some(v => v > 0)
    ? monthlyElec.reduce((s, v) => s + v, 0)
    : parseFloat(form.purchased_elec_kwh || 0);

  const computedS2     = parseFloat(form.scope2_emissions) > 0
    ? parseFloat(form.scope2_emissions)
    : totalElecKwh * CEA_GRID_EF / 1_000;
  const totalEmissions = totalS1 + computedS2;
  const currentGEI     = totalProd > 0 ? totalEmissions / totalProd : 0;

  // Use facility-specific baseline/target if entered, else sector average
  const baselineGEI = parseFloat(form.facility_baseline_gei) > 0
    ? parseFloat(form.facility_baseline_gei)
    : subsector.baseline_gei;
  const targetGEI   = parseFloat(form.facility_target_gei) > 0
    ? parseFloat(form.facility_target_gei)
    : subsector.target_fy26;

  // CCC formula per gazette
  const cccSurplus = totalProd > 0 && currentGEI < baselineGEI
    ? Math.floor(Math.max(0, baselineGEI - currentGEI) * totalProd)
    : 0;
  const cccDeficit = currentGEI > targetGEI && totalProd > 0
    ? Math.ceil(Math.max(0, currentGEI - targetGEI) * totalProd)
    : 0;

  const penaltyEstimate = cccDeficit * EST_CCC_PRICE * PENALTY_MULTIPLIER;
  const cccValue        = cccSurplus * EST_CCC_PRICE;

  const geiProgress = baselineGEI > targetGEI
    ? Math.min(100, Math.max(0, (baselineGEI - currentGEI) / (baselineGEI - targetGEI) * 100))
    : 0;

  const geiStatus = currentGEI === 0    ? 'nodata'
    : currentGEI <= targetGEI           ? 'compliant'
    : currentGEI <= baselineGEI         ? 'inprogress'
    : 'exceeding';

  const geiColor = geiStatus === 'compliant'   ? '#10b981'
    : geiStatus === 'inprogress'               ? '#f59e0b'
    : geiStatus === 'nodata'                   ? '#3a5060'
    : '#ef4444';

  const formsDone = CCTS_FORMS.filter(f => form[f.status_key]).length;
  const acvaIdx   = ACVA_STAGES.findIndex(s => s.id === form.acva_stage);

  // ── Save ───────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (saving) return;
    const cleanProd = monthlyProd.map(v => safeFloat(v, 0, 1e9)  ?? 0);
    const cleanS1   = monthlyS1.map(v   => safeFloat(v, 0, 1e9)  ?? 0);
    const cleanElec = monthlyElec.map(v => safeFloat(v, 0, 1e12) ?? 0);
    if (cleanProd.length !== 12 || cleanS1.length !== 12 || cleanElec.length !== 12) {
      toast('Monthly arrays must have 12 values each', 'err'); return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/ccts/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sector_id:            form.sector_id,
          subsector_id:         form.subsector_id,
          entity_name:          sanitise(form.entity_name,    200),
          entity_cin:           sanitise(form.entity_cin,      21).toUpperCase(),
          entity_gstin:         sanitise(form.entity_gstin,   15).toUpperCase(),
          bee_dc_number:        sanitise(form.bee_dc_number,  100),
          ccts_entity_id:       sanitise(form.ccts_entity_id, 100),
          baseline_year:        form.baseline_year,
          compliance_year:      form.compliance_year,
          gate_capacity_yr:     safeFloat(form.gate_capacity_yr,     0, 1e9)   ?? null,
          scope1_emissions:     safeFloat(form.scope1_emissions,     0, 1e9)   ?? null,
          scope2_emissions:     safeFloat(form.scope2_emissions,     0, 1e9)   ?? null,
          purchased_elec_kwh:   safeFloat(form.purchased_elec_kwh,   0, 1e13)  ?? null,
          facility_baseline_gei:safeFloat(form.facility_baseline_gei,0, 1e6)   ?? null,
          facility_target_gei:  safeFloat(form.facility_target_gei,  0, 1e6)   ?? null,
          acva_name:            sanitise(form.acva_name,      200),
          acva_accred_no:       sanitise(form.acva_accred_no, 100),
          acva_stage:           form.acva_stage,
          form_a: Boolean(form.form_a), form_b: Boolean(form.form_b),
          form_c: Boolean(form.form_c), form_d: Boolean(form.form_d),
          form_e2: Boolean(form.form_e2),
          mrv_plan_url:         sanitise(form.mrv_plan_url, 500).replace(/[<>'"]/g, ''),
          notes:                sanitise(form.notes, 1000),
          monthly_prod:         cleanProd,
          monthly_s1:           cleanS1,
          monthly_elec:         cleanElec,
          // current_gei, total_emissions recalculated server-side
          // ccc_surplus/deficit recalculated server-side when facility targets set
          ccc_surplus:          cccSurplus,
          ccc_deficit:          cccDeficit,
        }),
      });
      setSaved({ ...form });
      toast('✓ CCTS profile saved');
    } catch {
      toast('Save failed. Please try again.', 'err');
    } finally {
      setSaving(false);
    }
  };

  // ── Month data helpers ─────────────────────────────────────────────
  const setMonthData = (type, idx, val) => {
    const n = safeFloat(val, 0, 1e12) ?? 0;
    if (type === 'prod') setMonthlyProd(prev => { const a = [...prev]; a[idx] = n; return a; });
    if (type === 's1')   setMonthlyS1(prev   => { const a = [...prev]; a[idx] = n; return a; });
    if (type === 'elec') setMonthlyElec(prev => { const a = [...prev]; a[idx] = n; return a; });
  };

  // ── Export form JSON ───────────────────────────────────────────────
  const exportFormData = (formId) => {
    const data = {
      form_id:          formId,
      entity_name:      sanitise(form.entity_name),
      entity_cin:       sanitise(form.entity_cin),
      ccts_entity_id:   sanitise(form.ccts_entity_id),
      bee_dc_number:    sanitise(form.bee_dc_number),
      sector:           sector.label,
      subsector:        subsector.label,
      compliance_year:  form.compliance_year,
      covered_ghgs:     sector.covered_ghgs,
      baseline_gei:     baselineGEI,
      target_gei_fy26:  targetGEI,
      current_gei:      currentGEI.toFixed(4),
      total_production: `${fmt(totalProd, 0)} ${subsector.unit}`,
      scope1_co2e:      `${fmt(totalS1, 3)} tCO₂e`,
      scope2_co2e:      `${fmt(computedS2, 3)} tCO₂e (CEA V20.0 Dec 2024: ${CEA_GRID_EF} tCO₂/MWh)`,
      total_co2e:       `${fmt(totalEmissions, 3)} tCO₂e`,
      ccc_surplus:      cccSurplus,
      ccc_deficit:      cccDeficit,
      penalty_estimate: cccDeficit > 0 ? `₹${(penaltyEstimate/100_000).toFixed(2)}L (${PENALTY_MULTIPLIER}× avg CCC price per MoEFCC GEI Target Rules 2025)` : '0',
      acva_name:        sanitise(form.acva_name),
      acva_accred_no:   sanitise(form.acva_accred_no),
      acva_stage:       form.acva_stage,
      gazette_ref:      sector.gazette_ref,
      generated_at:     new Date().toISOString(),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `CCTS_Form_${formId}_${sanitise(form.entity_cin) || 'entity'}_FY${form.compliance_year.replace('-','')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast(`✓ Form ${formId} data exported`);
  };

  // ── [MERGED] BEE MRV JSON export — from CCTSGEIReport ─────────────
  // RECPDCL-compatible, shares all data already in state
  const exportBEEFormat = () => {
    const facilityBaseline = parseFloat(form.facility_baseline_gei) > 0;
    const facilityTarget   = parseFloat(form.facility_target_gei)   > 0;
    const payload = {
      reporting_schema:   'BEE-CCTS-MRV-v1.0',
      generated_at:       new Date().toISOString(),
      form_reference:     `CCTS-MRV-${sanitise(form.entity_cin)}-${form.compliance_year}`,
      entity: {
        name:              sanitise(form.entity_name),
        cin:               sanitise(form.entity_cin).toUpperCase(),
        bee_dc_number:     sanitise(form.bee_dc_number),
        ccts_entity_id:    sanitise(form.ccts_entity_id),
        sector:            sector.label,
        subsector:         subsector.label,
        compliance_year:   form.compliance_year,
        ghgs_covered:      sector.covered_ghgs,
        gazette_reference: sector.gazette_ref,
      },
      production: {
        annual_output: totalProd || parseFloat(form.gate_capacity_yr || 0),
        unit:          subsector.unit,
      },
      emissions: {
        scope1_tco2e:              totalS1,
        scope2_location_tco2e:     parseFloat(computedS2.toFixed(4)),
        grid_ef_used:              `${CEA_GRID_EF} tCO₂/MWh (CEA V20.0 Dec 2024, FY 2023-24)`,
        purchased_electricity_kwh: totalElecKwh,
        total_s1_s2_tco2e:         parseFloat(totalEmissions.toFixed(4)),
        ghgs_included:             sector.covered_ghgs,
      },
      gei: {
        current_gei:              parseFloat(currentGEI.toFixed(6)),
        unit:                     `tCO₂e / ${subsector.unit}`,
        baseline_gei:             baselineGEI,
        baseline_source:          facilityBaseline ? 'Facility-specific (BEE DC notification)' : 'Sector average (indicative)',
        target_fy26:              targetGEI,
        target_source:            facilityTarget   ? 'Facility-specific (BEE DC notification)' : 'Sector average (indicative)',
        reduction_achieved_pct:   baselineGEI > 0  ? parseFloat(((baselineGEI - currentGEI) / baselineGEI * 100).toFixed(2)) : 0,
        gei_status:               geiStatus,
      },
      ccc_position: {
        surplus_cccs:       cccSurplus,
        deficit_cccs:       cccDeficit,
        formula:            cccSurplus > 0
          ? `Surplus = (${baselineGEI.toFixed(4)} - ${currentGEI.toFixed(4)}) × ${totalProd}`
          : `Deficit = (${currentGEI.toFixed(4)} - ${targetGEI.toFixed(4)}) × ${totalProd}`,
        ccc_price_estimate: `₹${EST_CCC_PRICE}/CCC (indicative — CERC floor/ceiling not yet notified)`,
        penalty_risk:       cccDeficit > 0
          ? `₹${(penaltyEstimate/100_000).toFixed(2)} Lakh (${PENALTY_MULTIPLIER}× avg CCC price per MoEFCC GEI Target Rules 2025)`
          : 'None — compliant',
      },
      verification: {
        acva_name:         sanitise(form.acva_name),
        acva_accreditation:sanitise(form.acva_accred_no),
        acva_stage:        form.acva_stage,
        form_a_submitted:  Boolean(form.form_a),
        form_b_submitted:  Boolean(form.form_b),
        form_c_submitted:  Boolean(form.form_c),
        form_d_submitted:  Boolean(form.form_d),
        form_e2_submitted: Boolean(form.form_e2),
        mrv_deadline:      'July 2026',
        icm_portal:        'icm.grid-india.in',
      },
      regulatory_disclosure: {
        note:             'GEI baseline and targets are sector averages for planning. Facility-specific targets from BEE DC notification letter.',
        ccts_legal_basis: 'Energy Conservation (Amendment) Act 2022 · G.S.R. 234(E)',
        cerc_regulations: 'CERC (Terms and Conditions for Purchase and Sale of CCC) Regulations 2026',
      },
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `BEE_GEI_MRV_${sanitise(form.entity_cin) || 'entity'}_${form.compliance_year.replace('-','')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast('✓ BEE GEI MRV JSON exported — share with ACVA/RECPDCL verifier');
  };

  // ── [MERGED] CSV export — from CCTSGEIReport ──────────────────────
  const exportCSV = () => {
    const rows = [
      'Field,Value',
      `Entity Name,${sanitise(form.entity_name)}`,
      `CIN,${sanitise(form.entity_cin)}`,
      `BEE DC Number,${sanitise(form.bee_dc_number)}`,
      `Sector,${sector.label}`,
      `Sub-sector,${subsector.label}`,
      `Compliance Year,${form.compliance_year}`,
      `Annual Production,${fmt(totalProd, 0)} ${subsector.unit}`,
      `Scope 1 Emissions (tCO₂e),${fmt(totalS1, 3)}`,
      `Scope 2 Emissions (tCO₂e),${fmt(computedS2, 4)}`,
      `Total S1+S2 (tCO₂e),${fmt(totalEmissions, 4)}`,
      `Current GEI,${currentGEI.toFixed(6)} tCO₂e/${subsector.unit}`,
      `Baseline GEI,${baselineGEI}`,
      `Target GEI FY26,${targetGEI}`,
      `CCC Surplus,${cccSurplus}`,
      `CCC Deficit,${cccDeficit}`,
      `Penalty Risk (₹ Lakh),${cccDeficit > 0 ? (penaltyEstimate/100_000).toFixed(2) : '0'}`,
      `GHGs Covered,${sector.covered_ghgs}`,
      `Grid EF Used,${CEA_GRID_EF} tCO₂/MWh (CEA V20.0 Dec 2024)`,
      `ACVA,${sanitise(form.acva_name)}`,
      `Generated At,${new Date().toISOString()}`,
    ].join('\n');
    const url = URL.createObjectURL(new Blob([rows], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `GEI_Report_${sanitise(form.entity_cin) || 'entity'}_${form.compliance_year}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast('✓ GEI report CSV exported');
  };

  // ─────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{CSS}</style>
      {notif && <div className={`notif notif-${notif.type}`}>{notif.msg}</div>}

      <div className="ccts">
        <div className="ccts-in">

          {/* ── Header ──────────────────────────────────────────────── */}
          <div className="ccts-hd">
            <div>
              <div className="ccts-label">BEE · CERC · GRID-INDIA · ENERGY CONSERVATION ACT 2022 · ICM PORTAL · 9 GAZETTED SECTORS</div>
              <div className="ccts-title">
                CCTS <span>Compliance</span>
                <span style={{ marginLeft:10, fontSize:11, padding:'3px 8px', borderRadius:4, background:'#f59e0b14', color:'#f59e0b', border:'1px solid #f59e0b44', letterSpacing:'.08em', fontFamily:'Space Mono,monospace', fontWeight:400, verticalAlign:'middle' }}>BETA</span>
              </div>
              <div style={{ fontSize:10, color:'var(--mut)', marginTop:2 }}>
                9 sectors · GEI Tracker · Forms A–E2 · ACVA Workflow · BEE MRV Export · CCC Position
              </div>
              {saved?.entity_name && (
                <div style={{ fontSize:11, color:'var(--teal)', marginTop:4 }}>
                  {saved.entity_name} · {sector.label} / {subsector.label} · FY {form.compliance_year}
                </div>
              )}
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'flex-start', flexWrap:'wrap', justifyContent:'flex-end' }}>
              <span className={`pill ${formsDone === 5 ? 'pill-grn' : formsDone >= 3 ? 'pill-ylw' : 'pill-red'}`}>
                {formsDone}/5 FORMS
              </span>
              <span className={`pill ${geiStatus === 'compliant' ? 'pill-grn' : geiStatus === 'inprogress' ? 'pill-ylw' : geiStatus === 'nodata' ? 'pill-teal' : 'pill-red'}`}>
                {geiStatus === 'compliant' ? 'GEI COMPLIANT ✓' : geiStatus === 'inprogress' ? 'GEI IN PROGRESS' : geiStatus === 'nodata' ? 'ENTER DATA' : 'GEI ABOVE TARGET'}
              </span>
              <span className={`pill ${ACVA_STAGES[acvaIdx]?.id === 'verified' ? 'pill-grn' : 'pill-blu'}`}>
                ACVA: {ACVA_STAGES[acvaIdx]?.label || '—'}
              </span>
              <button className="btn btn-teal btn-sm" onClick={exportBEEFormat}>BEE MRV JSON →</button>
              <button className="btn btn-g btn-sm" onClick={exportCSV}>CSV</button>
              <button className="btn btn-teal btn-sm" onClick={handleSave} disabled={saving}>
                {saving ? 'SAVING…' : 'SAVE →'}
              </button>
            </div>
          </div>

          {/* ── Disclaimers ──────────────────────────────────────────── */}
          <div className="al al-y">
            <span style={{ fontSize:18, flexShrink:0 }}>⚠️</span>
            <div style={{ fontSize:11, color:'#f59e0b', lineHeight:1.8 }}>
              <strong>BETA — GEI targets are SECTOR AVERAGES (indicative only).</strong>{' '}
              Each Designated Consumer receives a <strong>facility-specific target</strong> from BEE.
              Always use your <strong>BEE DC notification letter</strong> for compliance submissions.
              Penalty = 2× avg CCC price · Form A deadline: July 2026 · Grid EF: CEA V20.0 Dec 2024 — 0.727 tCO₂/MWh.
            </div>
          </div>
          <div className="al al-t">
            <span>⚡</span>
            <span>
              <strong>CCTS measures GEI (Emission Intensity per unit output)</strong> — not absolute emissions.
              Scope 1 + Scope 2 only (no Scope 3). Covered GHGs: CO₂ and PFCs only.
            </span>
          </div>

          {/* ── Penalty / Surplus alert ──────────────────────────────── */}
          {cccDeficit > 0 && (
            <div className="al al-r">
              <span style={{ fontSize:18, flexShrink:0 }}>⚠️</span>
              <div>
                <strong>PENALTY RISK: ₹{(penaltyEstimate/100_000).toFixed(2)} LAKH</strong>
                {' '}({cccDeficit.toLocaleString('en-IN')} CCC deficit × ₹{EST_CCC_PRICE.toLocaleString()} × {PENALTY_MULTIPLIER}× per MoEFCC GEI Target Rules 2025)
                <div style={{ fontSize:10, marginTop:3, opacity:.8 }}>
                  Purchase {cccDeficit.toLocaleString('en-IN')} CCCs on IEX/PXIL before compliance deadline to avoid Environmental Compensation.
                </div>
              </div>
            </div>
          )}
          {cccSurplus > 0 && (
            <div className="al al-g">
              <span style={{ fontSize:18, flexShrink:0 }}>🏆</span>
              <div>
                <strong>CCC SURPLUS: {cccSurplus.toLocaleString('en-IN')} CCCs</strong>
                {' '}· Est. value ₹{(cccValue/100_000).toFixed(2)} Lakh @ ₹{EST_CCC_PRICE.toLocaleString()}/CCC
                <div style={{ fontSize:10, marginTop:3, opacity:.8 }}>
                  Trade surplus CCCs on IEX/PXIL after October 2026 trading launch.
                </div>
              </div>
            </div>
          )}

          {/* ── Stats ────────────────────────────────────────────────── */}
          <div className="stat-row">
            {[
              { label:'CURRENT GEI',      color: geiColor,
                val: currentGEI > 0 ? fmt(currentGEI, 4) : '—',
                sub: `tCO₂e / ${subsector.unit}` },
              { label:'TARGET GEI FY26',  color:'#14b8a6',
                val: fmt(targetGEI, 4),
                sub: `${fmt((1 - targetGEI / baselineGEI) * 100, 2)}% below baseline` },
              { label:'CCC POSITION',     color: cccSurplus > 0 ? '#10b981' : cccDeficit > 0 ? '#ef4444' : '#3a5060',
                val: cccSurplus > 0 ? `+${fmt(cccSurplus, 0)}` : cccDeficit > 0 ? `-${fmt(cccDeficit, 0)}` : '—',
                sub: cccSurplus > 0 ? `~₹${(cccValue/100_000).toFixed(1)}L est.`
                   : cccDeficit > 0 ? `Penalty: ~₹${(penaltyEstimate/100_000).toFixed(1)}L`
                   : 'Enter production data' },
              { label:'TOTAL PRODUCTION', color:'#3b82f6',
                val: totalProd > 0 ? fmt(totalProd, 0) : '—',
                sub: `${subsector.unit}/year` },
            ].map(({ label, val, sub, color }) => (
              <div key={label} className="stat-tile">
                <div className="stat-lbl">{label}</div>
                <div className="stat-val" style={{ color }}>{val}</div>
                <div className="stat-sub">{sub}</div>
              </div>
            ))}
          </div>

          {/* ── GEI progress bar ──────────────────────────────────────── */}
          {baselineGEI > 0 && (
            <div className="ccts-card" style={{ padding:'14px 18px', marginBottom:14 }}>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:8 }}>
                <span style={{ color:'var(--mut)' }}>GEI REDUCTION PROGRESS vs BASELINE</span>
                <span style={{ color: geiColor }}>
                  {currentGEI > 0 ? `${fmt(geiProgress, 1)}% toward FY26 target` : 'No data yet'}
                  {geiStatus === 'compliant' && ' — COMPLIANT ✓'}
                </span>
              </div>
              <div className="gei-gauge">
                <div className="gei-fill" style={{
                  width:`${geiProgress}%`,
                  background: geiProgress >= 100 ? 'linear-gradient(90deg,#10b981,#34d399)'
                    : geiProgress >= 50            ? 'linear-gradient(90deg,#f59e0b,#14b8a6)'
                    :                                'linear-gradient(90deg,#ef4444,#f59e0b)',
                }}/>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', fontSize:10, color:'var(--mut)', marginTop:4 }}>
                <span>Baseline: <strong style={{ color:'#ef4444' }}>{fmt(baselineGEI, 4)}</strong></span>
                <span style={{ textAlign:'center' }}>Current: <strong style={{ color: geiColor }}>{currentGEI > 0 ? fmt(currentGEI, 4) : '—'}</strong></span>
                <span style={{ textAlign:'right' }}>Target FY26: <strong style={{ color:'#14b8a6' }}>{fmt(targetGEI, 4)}</strong></span>
              </div>
            </div>
          )}

          {/* ── CCC result box ────────────────────────────────────────── */}
          {(cccSurplus > 0 || cccDeficit > 0) && (
            <div className={`ccc-box ${cccSurplus > 0 ? 'ccc-surplus' : 'ccc-deficit'}`}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                <div>
                  <div style={{ fontSize:9, letterSpacing:'.14em', color:'var(--mut)', marginBottom:6 }}>
                    {cccSurplus > 0 ? 'CCC SURPLUS — ELIGIBLE TO TRADE ON POWER EXCHANGE' : 'CCC DEFICIT — MUST PURCHASE OR FACE ENVIRONMENTAL COMPENSATION'}
                  </div>
                  <div style={{ fontFamily:'Syne,sans-serif', fontSize:34, fontWeight:800, color: cccSurplus > 0 ? '#10b981' : '#ef4444' }}>
                    {cccSurplus > 0 ? `+${fmt(cccSurplus, 0)}` : `-${fmt(cccDeficit, 0)}`}
                    <span style={{ fontSize:14, fontWeight:400, marginLeft:6 }}>CCCs</span>
                  </div>
                  <div style={{ fontSize:11, color:'var(--mut)', marginTop:4 }}>
                    {cccSurplus > 0
                      ? `~₹${(cccValue/100_000).toFixed(2)}L value @ ₹${EST_CCC_PRICE.toLocaleString()}/CCC (estimated)`
                      : `Environmental Compensation: ~₹${(penaltyEstimate/100_000).toFixed(2)}L (${PENALTY_MULTIPLIER}× avg CCC price per MoEFCC GEI Target Rules 2025)`}
                  </div>
                </div>
                <div style={{ textAlign:'right', fontSize:11, color:'var(--mut)', lineHeight:1.9 }}>
                  <div>Formula (per gazette):</div>
                  <div>{cccSurplus > 0 ? 'Surplus' : 'Deficit'} = {cccSurplus > 0 ? `(${fmt(baselineGEI,4)} − ${fmt(currentGEI,4)})` : `(${fmt(currentGEI,4)} − ${fmt(targetGEI,4)})`} × {fmt(totalProd,0)}</div>
                  <div style={{ color:'#14b8a6' }}>= {fmt(cccSurplus > 0 ? cccSurplus : cccDeficit, 0)} CCCs</div>
                  <div style={{ fontSize:9, marginTop:4 }}>1 CCC = 1 tCO₂e verified reduction · CO₂ + PFCs only</div>
                </div>
              </div>
            </div>
          )}

          {/* ── Tabs ─────────────────────────────────────────────────── */}
          <div className="ccts-tabs">
            {[
              ['gei',        'GEI CALCULATOR'],
              ['monthly',    'MONTHLY DATA'],
              ['forms',      `FORMS A–E2 (${formsDone}/5)`],
              ['acva',       'ACVA WORKFLOW'],
              ['bee-report', 'BEE FORMAT REPORT'],
              ['targets',    'SECTOR TARGETS (9)'],
              ['registry',   'GRID-INDIA REGISTRY'],
            ].map(([k, v]) => (
              <button key={k} className={`ccts-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{v}</button>
            ))}
          </div>

          {!loading && (
            <>
              {/* ══ GEI CALCULATOR ══════════════════════════════════════ */}
              {tab === 'gei' && (
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  <div className="ccts-card">
                    <div className="ccts-ctit">ENTITY & SECTOR SETUP</div>
                    <div className="g3">
                      <div className="fg">
                        <label className="lbl">CCTS SECTOR (9 gazetted)</label>
                        <select className="sel" value={form.sector_id}
                          onChange={e => setForm(f => ({ ...f, sector_id: e.target.value, subsector_id: CCTS_SECTORS[e.target.value]?.subsectors[0]?.id || '' }))}>
                          {Object.entries(CCTS_SECTORS).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
                        </select>
                      </div>
                      <div className="fg">
                        <label className="lbl">SUB-SECTOR / PROCESS TYPE</label>
                        <select className="sel" value={form.subsector_id}
                          onChange={e => setForm(f => ({ ...f, subsector_id: e.target.value }))}>
                          {sector.subsectors.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                        </select>
                      </div>
                      <div className="fg">
                        <label className="lbl">COMPLIANCE YEAR</label>
                        <select className="sel" value={form.compliance_year}
                          onChange={e => setForm(f => ({ ...f, compliance_year: e.target.value }))}>
                          {['2025-26','2026-27'].map(y => <option key={y}>{y}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={{ fontSize:10, color:'var(--teal)', marginBottom:10 }}>
                      Gazette ref: {sector.gazette_ref} · Covered GHGs: {sector.covered_ghgs}
                    </div>
                    <div className="g3">
                      <div className="fg">
                        <label className="lbl">ENTITY NAME (as per BEE)</label>
                        <input className="inp" type="text" maxLength={200}
                          placeholder={profile?.company_name || 'Company name'}
                          value={form.entity_name} onChange={e => setForm(f => ({ ...f, entity_name: e.target.value }))}/>
                      </div>
                      <div className="fg">
                        <label className="lbl">BEE DC NUMBER</label>
                        <input className="inp" type="text" maxLength={100} placeholder="DC/CEM/MH/001"
                          value={form.bee_dc_number} onChange={e => setForm(f => ({ ...f, bee_dc_number: e.target.value }))}/>
                      </div>
                      <div className="fg">
                        <label className="lbl">GRID-INDIA CCTS ENTITY ID</label>
                        <input className="inp" type="text" maxLength={100} placeholder="CCTS-ENT-XXXXXXXX"
                          value={form.ccts_entity_id} onChange={e => setForm(f => ({ ...f, ccts_entity_id: e.target.value }))}/>
                      </div>
                    </div>
                  </div>

                  <div className="ccts-card">
                    <div className="ccts-ctit">EMISSION INPUTS — SCOPE 1 + SCOPE 2 ONLY (CO₂ + PFCs)</div>
                    <div className="al al-b">
                      <span>📋</span>
                      <span>CCTS GEI: Scope 1 + Scope 2 (purchased electricity). Grid EF: <strong>0.727 tCO₂/MWh</strong> (CEA V20.0 Dec 2024). Scope 3 excluded.</span>
                    </div>
                    <div className="g2">
                      <div>
                        <div className="fg">
                          <label className="lbl">ANNUAL PRODUCTION ({subsector.unit})</label>
                          <input className="inp" type="number" step="1" min="0" max="999999999" placeholder="e.g. 500000"
                            value={form.gate_capacity_yr} onChange={e => setForm(f => ({ ...f, gate_capacity_yr: e.target.value }))}/>
                          <span style={{ fontSize:10, color:'var(--mut)' }}>Or use Monthly Data tab for month-wise entry</span>
                        </div>
                        <div className="fg">
                          <label className="lbl">SCOPE 1 EMISSIONS (tCO₂e) — DIRECT</label>
                          <input className="inp" type="number" step="0.001" min="0" max="999999999" placeholder="from GHG ledger"
                            value={form.scope1_emissions} onChange={e => setForm(f => ({ ...f, scope1_emissions: e.target.value }))}/>
                        </div>
                      </div>
                      <div>
                        <div className="fg">
                          <label className="lbl">PURCHASED ELECTRICITY (kWh) — AUTO SCOPE 2</label>
                          <input className="inp" type="number" step="1" min="0" max="9999999999999" placeholder="e.g. 12500000"
                            value={form.purchased_elec_kwh} onChange={e => setForm(f => ({ ...f, purchased_elec_kwh: e.target.value }))}/>
                          <span style={{ fontSize:10, color:'var(--mut)' }}>
                            Auto → {form.purchased_elec_kwh ? `${fmt(parseFloat(form.purchased_elec_kwh) * CEA_GRID_EF / 1000, 3)} tCO₂e @ ${CEA_GRID_EF} tCO₂/MWh` : `${CEA_GRID_EF} tCO₂/MWh — CEA V20.0`}
                          </span>
                        </div>
                        <div className="fg">
                          <label className="lbl">SCOPE 2 OVERRIDE (leave blank for auto)</label>
                          <input className="inp" type="number" step="0.001" min="0" max="999999999" placeholder="auto from kWh × 0.727/1000"
                            value={form.scope2_emissions} onChange={e => setForm(f => ({ ...f, scope2_emissions: e.target.value }))}/>
                        </div>
                      </div>
                    </div>

                    {/* Facility-specific targets */}
                    <div style={{ marginTop:8, borderTop:'1px solid var(--brd)', paddingTop:14 }}>
                      <div style={{ fontSize:10, letterSpacing:'.1em', color:'var(--mut)', marginBottom:10 }}>
                        FACILITY-SPECIFIC TARGETS (from your BEE DC notification letter — overrides sector averages)
                      </div>
                      <div className="g2">
                        <div className="fg">
                          <label className="lbl">YOUR FACILITY BASELINE GEI (tCO₂e/{subsector.unit})</label>
                          <input className="inp" type="number" step="0.0001" min="0"
                            placeholder={`Sector avg: ${subsector.baseline_gei} — enter BEE-assigned value`}
                            value={form.facility_baseline_gei} onChange={e => setForm(f => ({ ...f, facility_baseline_gei: e.target.value }))}/>
                        </div>
                        <div className="fg">
                          <label className="lbl">YOUR FACILITY TARGET GEI FY26 (tCO₂e/{subsector.unit})</label>
                          <input className="inp" type="number" step="0.0001" min="0"
                            placeholder={`Sector avg: ${subsector.target_fy26} — enter BEE-assigned value`}
                            value={form.facility_target_gei} onChange={e => setForm(f => ({ ...f, facility_target_gei: e.target.value }))}/>
                        </div>
                      </div>
                    </div>

                    {/* GEI summary box */}
                    <div style={{ background:'#060c10', borderRadius:8, padding:14, border:'1px solid var(--brd)', marginTop:6 }}>
                      <div style={{ fontSize:9, letterSpacing:'.14em', color:'var(--mut)', marginBottom:10 }}>GEI CALCULATION SUMMARY</div>
                      {[
                        ['Scope 1 (Direct — CO₂ + PFCs)',    `${fmt(form.scope1_emissions ? parseFloat(form.scope1_emissions) : totalS1, 3)} tCO₂e`, '#f97316'],
                        ['Scope 2 (Grid × CEA V20.0 0.727)',  `${fmt(computedS2, 3)} tCO₂e`, '#3b82f6'],
                        ['Total S1+S2',                        `${fmt(totalEmissions, 3)} tCO₂e`, '#f0f4f0'],
                        ['Total Production',                   `${fmt(totalProd || parseFloat(form.gate_capacity_yr || 0), 0)} ${subsector.unit}`, '#14b8a6'],
                        ['Current GEI',                        currentGEI > 0 ? `${fmt(currentGEI, 4)} tCO₂e/${subsector.unit}` : '—', '#f0f4f0'],
                        ['Baseline GEI',                       `${fmt(baselineGEI, 4)} ${parseFloat(form.facility_baseline_gei) > 0 ? '(facility-specific)' : '(sector avg)'}`, '#ef4444'],
                        ['Target GEI FY26',                    `${fmt(targetGEI, 4)} ${parseFloat(form.facility_target_gei) > 0 ? '(facility-specific)' : '(sector avg)'}`, '#14b8a6'],
                        ['GEI vs Target', currentGEI > 0
                          ? currentGEI <= targetGEI
                            ? `✓ ${fmt((targetGEI - currentGEI) / targetGEI * 100, 2)}% below target`
                            : `⚠ ${fmt((currentGEI - targetGEI) / targetGEI * 100, 2)}% above target`
                          : '—',
                          currentGEI > 0 && currentGEI <= targetGEI ? '#10b981' : '#ef4444'],
                      ].map(([k, v, c]) => (
                        <div key={k} className="drow">
                          <span style={{ color:'var(--mut)' }}>{k}</span>
                          <span style={{ color: c || 'var(--txt)', fontWeight: k.includes('GEI') ? 700 : 400 }}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ══ MONTHLY DATA ════════════════════════════════════════ */}
              {tab === 'monthly' && (
                <div className="ccts-card">
                  <div className="ccts-ctit">MONTHLY DATA — FY {form.compliance_year} (APR–MAR)</div>
                  <div className="al al-t" style={{ marginBottom:14 }}>
                    <span>ℹ</span>
                    <span>Indian FY: April to March. Click a cell to edit. Production in {subsector.unit}, Scope 1 in tCO₂e, electricity in kWh.</span>
                  </div>
                  {[
                    { label:`PRODUCTION (${subsector.unit})`, arr:monthlyProd, type:'prod', color:'#14b8a6' },
                    { label:'SCOPE 1 (tCO₂e)',                arr:monthlyS1,   type:'s1',   color:'#f97316' },
                    { label:'ELECTRICITY (kWh)',               arr:monthlyElec, type:'elec', color:'#3b82f6' },
                  ].map(({ label, arr, type, color }) => (
                    <div key={type} style={{ marginBottom:18 }}>
                      <div style={{ fontSize:10, letterSpacing:'.1em', color:'var(--mut)', marginBottom:8 }}>{label}</div>
                      <div className="prod-grid">
                        {MONTHS.map((m, i) => (
                          <div key={m}
                            className={`prod-cell${selMonth === i && selType === type ? ' active' : ''}`}
                            onClick={() => { setSelMonth(i); setSelType(type); setMonthVal(String(arr[i] || '')); }}>
                            <div className="prod-cell-lbl">{m}</div>
                            <div style={{ fontSize:10, fontWeight:700, color: arr[i] > 0 ? color : 'var(--mut)' }}>
                              {arr[i] > 0 ? (arr[i] >= 1_000_000 ? `${(arr[i]/1_000_000).toFixed(1)}M` : arr[i] >= 1_000 ? `${(arr[i]/1_000).toFixed(0)}k` : String(arr[i])) : '—'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {selMonth !== null && (
                    <div style={{ display:'flex', gap:10, alignItems:'flex-end', padding:14, background:'#060c10', borderRadius:8, border:'1px solid var(--brd)', marginBottom:14 }}>
                      <div className="fg" style={{ flex:1, marginBottom:0 }}>
                        <label className="lbl">
                          {selType === 'prod' ? `PRODUCTION — ${MONTHS[selMonth]} (${subsector.unit})`
                            : selType === 's1' ? `SCOPE 1 — ${MONTHS[selMonth]} (tCO₂e)`
                            :                   `ELECTRICITY — ${MONTHS[selMonth]} (kWh)`}
                        </label>
                        <input className="inp" type="number" step="0.1" min="0" max="999999999999" autoFocus
                          value={monthVal} onChange={e => setMonthVal(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { setMonthData(selType, selMonth, monthVal); setSelMonth(null); } }}/>
                      </div>
                      <button className="btn btn-teal btn-sm" onClick={() => { setMonthData(selType, selMonth, monthVal); setSelMonth(null); }}>SET</button>
                      <button className="btn btn-g btn-sm" onClick={() => setSelMonth(null)}>CANCEL</button>
                    </div>
                  )}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginTop:8 }}>
                    {[
                      { label:'Total Production',  val:`${fmt(totalProd, 0)} ${subsector.unit}`,  color:'#14b8a6' },
                      { label:'Total Scope 1',     val:`${fmt(totalS1, 3)} tCO₂e`,               color:'#f97316' },
                      { label:'Total Electricity', val:`${fmt(totalElecKwh/1_000_000, 2)}M kWh → ${fmt(computedS2, 3)} tCO₂e`, color:'#3b82f6' },
                    ].map(({ label, val, color }) => (
                      <div key={label} style={{ background:'#060c10', borderRadius:7, padding:12, border:'1px solid var(--brd)' }}>
                        <div style={{ fontSize:9, color:'var(--mut)', letterSpacing:'.1em', marginBottom:4 }}>{label}</div>
                        <div style={{ fontSize:13, fontWeight:700, color }}>{val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ══ FORMS A–E2 ══════════════════════════════════════════ */}
              {tab === 'forms' && (
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  <div className="al al-r">
                    <span>📅</span>
                    <span>
                      <strong>Deadlines:</strong> Form B (Baseline) → April 2026 · Forms A, C, D, E2 → July 2026.
                      Penalties under Energy Conservation Act 2022.
                    </span>
                  </div>
                  <div className="forms-grid">
                    {CCTS_FORMS.map(f => {
                      const done = form[f.status_key];
                      return (
                        <div key={f.id} className={`form-tile ${done ? 'done' : 'pending'}`}
                          onClick={() => setForm(prev => ({ ...prev, [f.status_key]: !prev[f.status_key] }))}>
                          <div style={{ fontSize:22, marginBottom:6 }}>{done ? '✅' : '📋'}</div>
                          <div style={{ fontSize:12, fontWeight:700, color: done ? '#10b981' : '#f59e0b', marginBottom:4 }}>{f.label}</div>
                          <div style={{ fontSize:9, color:'var(--mut)', lineHeight:1.5 }}>{f.title}</div>
                          <div style={{ fontSize:9, color: done ? '#10b981' : '#ef4444', marginTop:6 }}>
                            {done ? '✓ MARKED DONE' : `Due: ${f.deadline}`}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="ccts-card">
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                      <div className="ccts-ctit" style={{ marginBottom:0 }}>Form B — Baseline Declaration (Due April 2026)</div>
                      <div style={{ display:'flex', gap:8 }}>
                        <span className={`pill ${form.form_b ? 'pill-grn' : 'pill-ylw'}`}>
                          {form.form_b ? 'COMPLETE' : 'DUE APRIL 2026'}
                        </span>
                        <button className="btn btn-teal btn-sm" onClick={() => exportFormData('B')}>EXPORT DATA</button>
                      </div>
                    </div>
                    {[
                      ['Baseline Year',              'FY 2023-24 (BEE assigned)'],
                      ['Baseline GEI',               `${fmt(baselineGEI, 4)} tCO₂e / ${subsector.unit} ${parseFloat(form.facility_baseline_gei) > 0 ? '(facility-specific)' : '(sector avg)'}`],
                      ['Target GEI FY26',             `${fmt(targetGEI, 4)} tCO₂e / ${subsector.unit} ${parseFloat(form.facility_target_gei) > 0 ? '(facility-specific)' : '(sector avg)'}`],
                      ['Target GEI FY27',             `${fmt(subsector.target_fy27, 4)} tCO₂e / ${subsector.unit} (sector avg)`],
                      ['Reduction Required FY26',     `${fmt((1 - targetGEI / baselineGEI) * 100, 2)}%`],
                      ['Scope Coverage',              'Scope 1 + Scope 2 (location-based)'],
                      ['Grid EF Used',                `CEA V20.0 Dec 2024 — ${CEA_GRID_EF} tCO₂/MWh`],
                      ['Covered GHGs',                sector.covered_ghgs],
                      ['Gazette Reference',           sector.gazette_ref],
                    ].map(([k, v]) => (
                      <div key={k} className="drow"><span style={{ color:'var(--mut)' }}>{k}</span><span>{v}</span></div>
                    ))}
                    <div className="al al-y" style={{ marginTop:12 }}>
                      <span>⚠</span>
                      <span>Use your BEE DC notification letter for the actual Form B submission — sector averages shown here are for planning only.</span>
                    </div>
                  </div>
                  {CCTS_FORMS.filter(f => f.id !== 'B').map(cf => (
                    <div key={cf.id} className="ccts-card">
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <div className="ccts-ctit" style={{ marginBottom:0 }}>{cf.label} — {cf.title} (Due {cf.deadline})</div>
                        <div style={{ display:'flex', gap:8 }}>
                          <span className={`pill ${form[cf.status_key] ? 'pill-grn' : 'pill-ylw'}`}>
                            {form[cf.status_key] ? 'COMPLETE' : `DUE ${cf.deadline.toUpperCase()}`}
                          </span>
                          <button className="btn btn-teal btn-sm" onClick={() => exportFormData(cf.id)}>EXPORT DATA</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ══ ACVA WORKFLOW ════════════════════════════════════════ */}
              {tab === 'acva' && (
                <div className="g2">
                  <div className="ccts-card">
                    <div className="ccts-ctit">ACVA VERIFICATION WORKFLOW</div>
                    <div className="al al-y" style={{ marginBottom:14 }}>
                      <span>⚠</span>
                      <span>ACVA = Accredited Carbon Verification Agency. Mandatory for Form D and CCC issuance. BEE has accredited ~50–60 agencies including RECPDCL, Bureau Veritas, DNV, TÜV SÜD.</span>
                    </div>
                    <div className="fg" style={{ marginBottom:14 }}>
                      <label className="lbl">CURRENT ACVA STAGE</label>
                      <select className="sel" value={form.acva_stage}
                        onChange={e => setForm(f => ({ ...f, acva_stage: e.target.value }))}>
                        {ACVA_STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                    </div>
                    <div className="acva-timeline">
                      {ACVA_STAGES.map((stage, i) => {
                        const isDone   = i < acvaIdx;
                        const isActive = i === acvaIdx;
                        return (
                          <div key={stage.id} className="acva-step">
                            <div className={`acva-dot ${isDone ? 'done' : isActive ? 'active' : 'todo'}`}
                              style={{ borderColor: isDone ? '#10b981' : isActive ? stage.color : 'var(--brd2)' }}>
                              {isDone ? '✓' : isActive ? '●' : '○'}
                            </div>
                            <div>
                              <div style={{ fontSize:12, fontWeight: isActive ? 700 : 400, color: isActive ? stage.color : isDone ? '#10b981' : 'var(--mut)' }}>
                                {stage.label}
                              </div>
                              <div style={{ fontSize:10, color:'var(--mut)', marginTop:2 }}>
                                {stage.id === 'not_started'   && 'Submit MRV Plan to BEE-accredited ACVA'}
                                {stage.id === 'mrv_submitted' && 'MRV Plan received — ACVA reviewing methodology'}
                                {stage.id === 'desk_review'   && '7–14 days — ACVA reviews emission data remotely'}
                                {stage.id === 'site_visit'    && 'ACVA team visits facility for evidence verification'}
                                {stage.id === 'draft_report'  && 'Review draft — respond within 15 days'}
                                {stage.id === 'verified'      && 'Form D issued — BEE processes CCC issuance via GRID-India'}
                                {stage.id === 'rejected'      && 'Address findings and resubmit with corrections'}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="fg">
                      <label className="lbl">ACVA AGENCY</label>
                      <select className="sel" value={form.acva_name}
                        onChange={e => setForm(f => ({ ...f, acva_name: e.target.value }))}>
                        <option value="">Select ACVA…</option>
                        {ACVA_AGENCIES.map(a => <option key={a}>{a}</option>)}
                      </select>
                    </div>
                    <div className="fg">
                      <label className="lbl">BEE ACCREDITATION NUMBER</label>
                      <input className="inp" type="text" maxLength={100} placeholder="BEE/ACVA/XXXX/2025"
                        value={form.acva_accred_no} onChange={e => setForm(f => ({ ...f, acva_accred_no: e.target.value }))}/>
                    </div>
                    <div className="fg">
                      <label className="lbl">MRV PLAN URL / REFERENCE</label>
                      <input className="inp" type="text" maxLength={500} placeholder="Drive link or internal reference"
                        value={form.mrv_plan_url} onChange={e => setForm(f => ({ ...f, mrv_plan_url: e.target.value }))}/>
                    </div>
                    <div className="al al-g" style={{ marginTop:12 }}>
                      <span>✓</span>
                      <span>The BEE MRV JSON export (header button) contains all fields required by RECPDCL and other BEE-accredited ACVAs. Share this file directly with your assigned ACVA for verification.</span>
                    </div>
                    <button className="btn btn-teal" onClick={exportBEEFormat} style={{ marginTop:8 }}>
                      EXPORT RECPDCL-COMPATIBLE MRV JSON →
                    </button>
                  </div>

                  <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                    <div className="ccts-card">
                      <div className="ccts-ctit">POST-VERIFICATION — CCC ISSUANCE FLOW</div>
                      {[
                        { step:'1', desc:'ACVA issues verified Form D' },
                        { step:'2', desc:'Submit Forms A, B, C, D, E2 to BEE via ICM Portal (icm.grid-india.in)' },
                        { step:'3', desc:'BEE reviews and recommends to NSCICM' },
                        { step:'4', desc:'GRID-India issues CCCs in registry account' },
                        { step:'5', desc:'CCCs available for trading on IEX / PXIL / EtherTrack' },
                      ].map(({ step, desc }) => (
                        <div key={step} style={{ display:'flex', gap:10, padding:'8px 0', borderBottom:'1px solid var(--brd)22', fontSize:11 }}>
                          <span style={{ width:22, height:22, borderRadius:'50%', background:'#14b8a620', border:'1px solid #14b8a633', color:'#14b8a6', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontSize:10 }}>{step}</span>
                          <span style={{ color:'var(--mut)', alignSelf:'center' }}>{desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ══ BEE FORMAT REPORT ═══════════════════════════════════ */}
              {tab === 'bee-report' && (
                <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                  <div className="ccts-card">
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                      <div className="ccts-ctit" style={{ marginBottom:0 }}>BEE MRV FORMAT REPORT — JULY 2026 SUBMISSION</div>
                      <div style={{ display:'flex', gap:8 }}>
                        <button className="btn btn-teal btn-sm" onClick={exportBEEFormat}>EXPORT BEE MRV JSON →</button>
                        <button className="btn btn-g btn-sm" onClick={exportCSV}>EXPORT CSV</button>
                      </div>
                    </div>
                    {[
                      ['Entity Name',              sanitise(form.entity_name) || '— (set in GEI Calculator)'],
                      ['CIN',                      sanitise(form.entity_cin).toUpperCase() || '—'],
                      ['BEE DC Number',            sanitise(form.bee_dc_number) || '—'],
                      ['CCTS Entity ID (Grid-India)',sanitise(form.ccts_entity_id) || '— (from ICM Portal)'],
                      ['Sector',                   sector.label],
                      ['Sub-sector',               subsector.label],
                      ['Gazette Reference',        sector.gazette_ref],
                      ['Compliance Year',          form.compliance_year],
                      ['GHGs Covered',             sector.covered_ghgs],
                      ['Annual Production',        `${fmt(totalProd || parseFloat(form.gate_capacity_yr || 0), 0)} ${subsector.unit}`],
                      ['Scope 1 Emissions',        `${fmt(totalS1 || parseFloat(form.scope1_emissions || 0), 3)} tCO₂e`],
                      ['Scope 2 (location-based)', `${fmt(computedS2, 3)} tCO₂e`],
                      ['Grid EF Applied',          `${CEA_GRID_EF} tCO₂/MWh (CEA V20.0 Dec 2024)`],
                      ['Total S1+S2',              `${fmt(totalEmissions, 3)} tCO₂e`],
                      ['Current GEI',              currentGEI > 0 ? `${fmt(currentGEI, 6)} tCO₂e/${subsector.unit}` : '— (enter production data)'],
                      ['Baseline GEI',             `${fmt(baselineGEI, 4)} tCO₂e/${subsector.unit} ${parseFloat(form.facility_baseline_gei) > 0 ? '(facility-specific)' : '(sector average)'}`],
                      ['Target GEI FY26',          `${fmt(targetGEI, 4)} tCO₂e/${subsector.unit} ${parseFloat(form.facility_target_gei) > 0 ? '(facility-specific)' : '(sector average)'}`],
                      ['Reduction Required',       `${fmt((1 - targetGEI / baselineGEI) * 100, 2)}%`],
                      ['CCC Surplus',              cccSurplus > 0 ? `${cccSurplus.toLocaleString('en-IN')} CCCs (~₹${(cccValue/100_000).toFixed(2)}L)` : '0'],
                      ['CCC Deficit',              cccDeficit > 0 ? `${cccDeficit.toLocaleString('en-IN')} CCCs` : '0'],
                      ['Penalty Risk',             cccDeficit > 0 ? `₹${(penaltyEstimate/100_000).toFixed(2)} Lakh (${PENALTY_MULTIPLIER}× avg CCC price per MoEFCC GEI Target Rules 2025)` : '₹0 — compliant'],
                      ['ACVA / Verifier',          sanitise(form.acva_name) || '— (set in ACVA Workflow tab)'],
                      ['ACVA Accreditation No.',   sanitise(form.acva_accred_no) || '—'],
                      ['MRV Submission Deadline',  'July 2026 — ICM Portal (icm.grid-india.in)'],
                      ['Form B Deadline',          'April 2026 — Baseline Declaration'],
                      ['Forms Completed',          `${formsDone}/5`],
                    ].map(([k, v]) => (
                      <div key={k} className="drow">
                        <span style={{ color:'var(--mut)' }}>{k}</span>
                        <span style={{ color:
                          String(v).startsWith('₹') && cccDeficit > 0 ? '#ef4444'
                          : String(v).includes('compliant') || String(v).includes('✓') ? '#10b981'
                          : String(v).startsWith('—') ? 'var(--mut)'
                          : 'var(--txt)' }}>{v}</span>
                      </div>
                    ))}
                    <div style={{ marginTop:14, padding:'12px 14px', borderRadius:8, background:'#f59e0b08', border:'1px solid #f59e0b44', fontSize:11, color:'#f59e0b', lineHeight:1.8 }}>
                      <strong>⚠ IMPORTANT:</strong> Baseline and target values above are sector averages unless you entered facility-specific values in the GEI Calculator tab.
                      Always use your <strong>BEE DC notification letter</strong> for Form B and Form C submissions to the ICM Portal.
                    </div>
                  </div>
                </div>
              )}

              {/* ══ SECTOR TARGETS (9 sectors) ══════════════════════════ */}
              {tab === 'targets' && (
                <div className="ccts-card">
                  <div className="ccts-ctit">ALL 9 CCTS SECTOR TARGETS — BEE NOTIFIED OCT 2025 + JAN 2026</div>
                  <div className="al al-b" style={{ marginBottom:14 }}>
                    <span>📊</span>
                    <span>GEI targets in tCO₂e per unit output. Fertiliser added per Oct 2025. Iron &amp; Steel added per Jan 2026. Individual facility targets from BEE DC notification letters.</span>
                  </div>
                  <table className="sector-tbl">
                    <thead>
                      <tr>
                        <th>SECTOR</th><th>SUB-SECTOR</th><th>UNIT</th>
                        <th>BASELINE GEI (FY24)</th><th>TARGET FY26</th><th>TARGET FY27</th>
                        <th>REDUCTION FY26</th><th>GHGs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(CCTS_SECTORS).flatMap(([sId, s]) =>
                        s.subsectors.map((sub, i) => (
                          <tr key={`${sId}-${sub.id}`}
                            style={{ background: form.sector_id === sId && form.subsector_id === sub.id ? '#14b8a608' : '' }}>
                            <td style={{ color:'var(--txt)', fontWeight: i === 0 ? 700 : 400 }}>{i === 0 ? s.label : ''}</td>
                            <td style={{ color:'var(--mut)' }}>{sub.label}</td>
                            <td style={{ color:'var(--mut)', fontSize:10 }}>{sub.unit}</td>
                            <td style={{ color:'#ef4444', fontFamily:'Space Mono' }}>{fmt(sub.baseline_gei, 4)}</td>
                            <td style={{ color:'#14b8a6', fontFamily:'Space Mono' }}>{fmt(sub.target_fy26, 4)}</td>
                            <td style={{ color:'#10b981', fontFamily:'Space Mono' }}>{fmt(sub.target_fy27, 4)}</td>
                            <td><span className="pill pill-ylw">{fmt((1 - sub.target_fy26 / sub.baseline_gei) * 100, 2)}%</span></td>
                            <td style={{ fontSize:9, color:'var(--mut)' }}>{s.covered_ghgs?.split(' ')[0]}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  <div style={{ marginTop:14, padding:'12px 14px', borderRadius:8, background:'#f59e0b08', border:'1px solid #f59e0b44', fontSize:11, color:'#f59e0b', lineHeight:1.9 }}>
                    <strong>⚠ BETA:</strong> Sector averages only. Penalty = {PENALTY_MULTIPLIER}× avg CCC price per MoEFCC GEI Target Rules 2025.
                    Covered GHGs: CO₂ and PFCs only. Grid EF: CEA V20.0 Dec 2024 — 0.727 tCO₂/MWh.
                  </div>
                </div>
              )}

              {/* ══ GRID-INDIA REGISTRY ══════════════════════════════════ */}
              {tab === 'registry' && (
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  <div className="ccts-card">
                    <div className="ccts-ctit">GRID-INDIA REGISTRY — ICM PORTAL (icm.grid-india.in)</div>
                    <div className="al al-y">
                      <span>⚠</span>
                      <span>GRID-India ICM Portal launched 21 March 2026. Full third-party API access not yet available. Track CCC position manually until API integration is live.</span>
                    </div>
                    <div style={{ borderRadius:10, padding:18, border:'1px solid #243248', background:'#060c10', marginBottom:14 }}>
                      <div style={{ fontSize:9, letterSpacing:'.14em', color:'var(--mut)', marginBottom:10 }}>YOUR REGISTRY ACCOUNT STATUS</div>
                      {[
                        ['GRID-India Entity ID',   form.ccts_entity_id || '⚠ Not yet assigned — register at icm.grid-india.in'],
                        ['Account Status',          form.ccts_entity_id ? 'Registered' : 'Pending registration'],
                        ['CCCs Issued',             '— (available post ACVA verification + BEE approval)'],
                        ['CCCs Available',          '—'],
                        ['CCCs Retired',            '—'],
                        ['Registry Sync',           'Manual tracking — ICM Portal API pending (Oct 2026)'],
                        ['Form A Deadline',         'July 2026'],
                        ['Form B Deadline',         'April 2026'],
                        ['Forms C, D, E2 Deadline', 'July 2026'],
                      ].map(([k, v]) => (
                        <div key={k} className="drow">
                          <span style={{ color:'var(--mut)' }}>{k}</span>
                          <span style={{ color: String(v).startsWith('⚠') ? '#f59e0b' : 'var(--txt)' }}>{v}</span>
                        </div>
                      ))}
                    </div>
                    <div className="fg">
                      <label className="lbl">GRID-INDIA CCTS ENTITY ID (update once assigned)</label>
                      <input className="inp" type="text" maxLength={100} placeholder="CCTS-ENT-XXXXXXXX (from ICM Portal)"
                        value={form.ccts_entity_id} onChange={e => setForm(f => ({ ...f, ccts_entity_id: e.target.value }))}/>
                    </div>
                  </div>
                  <div className="ccts-card">
                    <div className="ccts-ctit">ETHERTRACK ↔ CCTS TOKENIZATION BRIDGE</div>
                    {[
                      { icon:'🔗', title:'On-chain provenance', desc:'Each CCC token carries CCTS entity ID, vintage year, sector, ACVA verifier, and gazette reference on-chain' },
                      { icon:'💧', title:'Liquidity',            desc:'Trade CCCs on EtherTrack marketplace alongside Verra VCUs and Gold Standard credits' },
                      { icon:'🇮🇳', title:'INR settlement',      desc:'Buyers pay in INR via EtherTrack wallet — no crypto knowledge needed for Indian corporates' },
                      { icon:'📋', title:'Retirement proof',     desc:'On-chain retirement creates immutable proof for BRSR, CDP, and CBAM reporting' },
                    ].map(({ icon, title, desc }) => (
                      <div key={title} style={{ display:'flex', gap:12, padding:'10px 0', borderBottom:'1px solid var(--brd)22' }}>
                        <span style={{ fontSize:18, flexShrink:0 }}>{icon}</span>
                        <div>
                          <div style={{ fontSize:12, color:'var(--txt)', fontWeight:700, marginBottom:2 }}>{title}</div>
                          <div style={{ fontSize:11, color:'var(--mut)' }}>{desc}</div>
                        </div>
                      </div>
                    ))}
                    <div style={{ marginTop:14, padding:'12px 14px', background:'#14b8a608', border:'1px solid #14b8a633', borderRadius:8, color:'#14b8a6', fontSize:11 }}>
                      EtherTrack will integrate GRID-India ICM Portal API when publicly available (expected post CCC trading launch, Oct 2026).
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {loading && (
            <div style={{ padding:40, textAlign:'center', color:'var(--mut)', fontSize:11, letterSpacing:'.1em' }}>
              LOADING CCTS DATA…
            </div>
          )}

          <div style={{ marginTop:16, display:'flex', justifyContent:'flex-end' }}>
            <button className="btn btn-teal" onClick={handleSave} disabled={saving}>
              {saving ? 'SAVING…' : '✓ SAVE CCTS DATA →'}
            </button>
          </div>

        </div>
      </div>
    </>
  );
}