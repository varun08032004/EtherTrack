// src/components/PATScheme.jsx
// BEE PAT Scheme — Perform Achieve Trade — Production v2
// ── All fixes from review applied:
//    [FIX-API-WIRE]      patAPI used for all fetch/save calls
//    [FIX-SECTOR-NAME]   pulp_paper corrected from paper_pulp
//    [FIX-DEFICIT-TILE]  Stats tile shows deficit correctly when escerts=0
//    [FIX-FY-ALIGN]      Monthly grid Apr–Mar (Indian FY)
//    [FIX-SOURCE-SPLIT]  Energy sources tab — BEE Form 1 source-wise split
//    [FIX-AUDITOR]       BEE-accredited Energy Auditor fields + checklist
//    [FIX-LOAD-ERROR]    Load failure shows retry prompt
//    [FIX-SEC-VALIDATE]  target SEC must be < baseline SEC
//    [FIX-BULK-VALIDATE] Each bulk value validated individually
//    [FIX-DEAD-STATE]    Removed unused data state
//    [FIX-PDF-EXPORT]    BEE Form 1 structured CSV export
//    [FIX-EMPTY-MONTHLY] Empty state when all months are 0

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../services/api';

// ── patAPI — inline to avoid import order issues ──────────────────────────────
const patAPI = {
  getProfile:  ()     => apiFetch('/api/pat/profile'),
  saveProfile: (body) => apiFetch('/api/pat/profile', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  }),
};

const fmt = (n, d = 2) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });

const sanitise = (str = '', max = 500) =>
  String(str).replace(/<[^>]*>/g, '').replace(/['"`;]/g, '').trim().slice(0, max);

const safeFloat = (val, min = 0, max = 1e12) => {
  const n = parseFloat(val);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

// ── [FIX-SECTOR-NAME] pulp_paper corrected ───────────────────────────────────
const PAT_SECTORS = [
  { id: 'aluminium',     label: 'Aluminium',                 unit: 'GJ/tonne Al',        gateUnit: 'tonne', threshold: 7500  },
  { id: 'cement',        label: 'Cement',                    unit: 'GJ/tonne cement',     gateUnit: 'tonne', threshold: 30000 },
  { id: 'chlor_alkali',  label: 'Chlor-Alkali',              unit: 'GJ/tonne Cl2',        gateUnit: 'tonne', threshold: 12000 },
  { id: 'fertiliser',    label: 'Fertiliser',                unit: 'GJ/tonne product',    gateUnit: 'tonne', threshold: 30000 },
  { id: 'iron_steel',    label: 'Iron & Steel',              unit: 'GJ/tonne steel',      gateUnit: 'tonne', threshold: 30000 },
  { id: 'pulp_paper',    label: 'Pulp & Paper',              unit: 'GJ/tonne paper',      gateUnit: 'tonne', threshold: 30000 },
  { id: 'petrochemical', label: 'Petrochemical',             unit: 'GJ/tonne product',    gateUnit: 'tonne', threshold: 30000 },
  { id: 'railways',      label: 'Railways',                  unit: 'kWh/GTKM',            gateUnit: 'GTKM',  threshold: null  },
  { id: 'textile',       label: 'Textile',                   unit: 'GJ/tonne product',    gateUnit: 'tonne', threshold: 3000  },
  { id: 'thermal_power', label: 'Thermal Power Plants',      unit: 'kCal/kWh',            gateUnit: 'MU',    threshold: null  },
  { id: 'refineries',    label: 'Petroleum Refineries',      unit: 'MBN (energy index)',  gateUnit: 'unit',  threshold: null  },
  { id: 'commercial',    label: 'Commercial Buildings',      unit: 'kWh/m2/yr',           gateUnit: 'm2',    threshold: null  },
  { id: 'other',         label: 'Other Designated Consumer', unit: 'GJ/tonne',            gateUnit: 'tonne', threshold: 30000 },
];

const PAT_CYCLES = [
  { id: 'I',   label: 'PAT Cycle I',   period: '2012-13 to 2014-15', status: 'Complete' },
  { id: 'II',  label: 'PAT Cycle II',  period: '2016-17 to 2018-19', status: 'Complete' },
  { id: 'III', label: 'PAT Cycle III', period: '2019-20 to 2022-23', status: 'Complete' },
  { id: 'IV',  label: 'PAT Cycle IV',  period: '2023-24 to 2025-26', status: 'Current'  },
  { id: 'V',   label: 'PAT Cycle V',   period: '2026-27 to 2028-29', status: 'Upcoming' },
];

// [FIX-FY-ALIGN] Indian FY: April=0 ... March=11
const FY_MONTHS = [
  { label: 'Apr', calIdx: 3  }, { label: 'May', calIdx: 4  },
  { label: 'Jun', calIdx: 5  }, { label: 'Jul', calIdx: 6  },
  { label: 'Aug', calIdx: 7  }, { label: 'Sep', calIdx: 8  },
  { label: 'Oct', calIdx: 9  }, { label: 'Nov', calIdx: 10 },
  { label: 'Dec', calIdx: 11 }, { label: 'Jan', calIdx: 0  },
  { label: 'Feb', calIdx: 1  }, { label: 'Mar', calIdx: 2  },
];

// 1 ESCert = 1 MTOE = 41,868 GJ (IEA standard)
const GJ_PER_MTOE  = 41_868;
const ESCERT_PRICE = { min: 400, max: 7_500, typical: 1_200 };

// [FIX-SOURCE-SPLIT] BEE Form 1 energy sources
const ENERGY_SOURCES = [
  { id: 'coal',        label: 'Coal',                unit: 'tonne',  gjFactor: 26.0  },
  { id: 'lignite',     label: 'Lignite',             unit: 'tonne',  gjFactor: 15.0  },
  { id: 'fuelOil',     label: 'Fuel Oil / LSHS',    unit: 'kL',     gjFactor: 39.76 },
  { id: 'hsd',         label: 'HSD (Diesel)',        unit: 'kL',     gjFactor: 38.66 },
  { id: 'lpg',         label: 'LPG',                 unit: 'tonne',  gjFactor: 47.54 },
  { id: 'naturalGas',  label: 'Natural Gas',         unit: '000 m3', gjFactor: 38.13 },
  { id: 'electricity', label: 'Electricity (Grid)',  unit: 'MWh',    gjFactor: 3.6   },
  { id: 'renewable',   label: 'Renewable Electricity',unit: 'MWh',   gjFactor: 3.6   },
  { id: 'other',       label: 'Other Fuel',          unit: 'GJ',     gjFactor: 1.0   },
];

const BEE_VERIFIERS = [
  'Bureau Veritas (BV)', 'DNV GL', 'TUV SUD', 'TUV Rheinland',
  'RITES Ltd', 'MECON Ltd', 'EIL (Engineers India Ltd)', 'PDIL',
  'Other BEE-accredited Energy Auditor',
];

const defForm = () => ({
  sector: 'cement', cycle: 'IV',
  dc_name: '', dc_number: '',
  baseline_sec: '', target_sec: '', target_reduction_pct: '',
  gate_capacity: '',
  reporting_year: new Date().getFullYear(),
  auditor_name: '', auditor_firm: '', auditor_reg_number: '',
  audit_date: '', audit_verified: false,
});

const defSources = () =>
  ENERGY_SOURCES.reduce((acc, s) => ({ ...acc, [s.id]: '' }), {});

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap');
:root{--bg:#060609;--surf:#0c0e18;--brd:#1e2540;--brd2:#2a3255;--txt:#f0f0ff;--mut:#4a5278;--org:#f97316;--grn:#10b981;--red:#ef4444;--ylw:#f59e0b;}
.pat{min-height:100vh;background:var(--bg);font-family:'Space Mono',monospace;color:var(--txt);}
.pat-in{max-width:1200px;margin:0 auto;padding:28px 24px;}
.pat-hd{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:22px;padding-bottom:16px;border-bottom:1px solid var(--brd);}
.pat-label{font-size:10px;letter-spacing:.18em;color:var(--mut);}
.pat-title{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;margin-top:3px;}
.pat-title span{color:var(--org);}
.pat-sub{font-size:10px;color:var(--mut);letter-spacing:.06em;margin-top:2px;}
.pat-card{background:var(--surf);border:1px solid var(--brd);border-radius:10px;padding:18px 20px;margin-bottom:12px;animation:fU .4s ease both;}
.pat-ctit{font-size:10px;letter-spacing:.14em;color:var(--mut);margin-bottom:14px;display:flex;align-items:center;gap:8px;}
.pat-ctit::before{content:'';width:10px;height:1px;background:var(--org);}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}
.g4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;}
.pat-fg{display:flex;flex-direction:column;gap:5px;margin-bottom:10px;}
.pat-lbl{font-size:10px;letter-spacing:.1em;color:var(--mut);}
.pat-inp,.pat-sel{padding:9px 11px;border-radius:6px;background:#080810;border:1px solid var(--brd);color:var(--txt);font-family:'Space Mono',monospace;font-size:12px;outline:none;transition:border-color .2s;width:100%;box-sizing:border-box;}
.pat-inp:focus,.pat-sel:focus{border-color:#f9731644;}
.pat-inp::placeholder{color:var(--mut);opacity:.7;}
.pat-inp.err{border-color:#ef444466;}
.pat-field-err{font-size:10px;color:#ef4444;margin-top:3px;}
.btn{padding:9px 17px;border-radius:6px;border:none;cursor:pointer;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.1em;font-weight:700;transition:all .2s;}
.btn:disabled{opacity:.5;cursor:not-allowed;}
.btn-org{background:linear-gradient(135deg,#f97316,#ea580c);color:#fff;}
.btn-org:hover:not(:disabled){opacity:.85;transform:translateY(-1px);}
.btn-g{background:var(--surf);border:1px solid var(--brd2);color:var(--txt);}
.btn-g:hover:not(:disabled){border-color:#f9731644;color:var(--org);}
.btn-grn{background:linear-gradient(135deg,#10b981,#059669);color:#fff;}
.btn-sm{padding:6px 12px;font-size:10px;}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;}
.stat-tile{background:#080810;border-radius:8px;padding:14px;border:1px solid var(--brd);}
.stat-val{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;margin-bottom:2px;}
.stat-lbl{font-size:10px;color:var(--mut);letter-spacing:.08em;}
.stat-sub{font-size:10px;color:var(--mut);margin-top:2px;}
.sec-gauge{height:12px;border-radius:6px;background:var(--brd);overflow:hidden;margin:10px 0;}
.sec-fill{height:100%;border-radius:6px;transition:width .9s ease;}
.escert-box{border-radius:10px;padding:20px;border:1px solid;margin-bottom:14px;}
.escert-surplus{background:#10b98108;border-color:#10b98133;}
.escert-deficit{background:#ef444408;border-color:#ef444433;}
.month-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:6px;margin-bottom:14px;}
.month-cell{border-radius:5px;padding:8px 4px;text-align:center;border:1px solid var(--brd);background:#080810;cursor:pointer;transition:all .2s;}
.month-cell:hover{border-color:#f9731644;}
.month-cell.active{border-color:#f9731666;background:#f9731608;}
.month-cell-lbl{font-size:9px;color:var(--mut);margin-bottom:3px;}
.pat-tabs{display:flex;gap:0;margin-bottom:18px;border-bottom:1px solid var(--brd);overflow-x:auto;}
.pat-tab{padding:9px 15px;font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.08em;cursor:pointer;border:none;background:none;color:var(--mut);border-bottom:2px solid transparent;transition:all .2s;margin-bottom:-1px;white-space:nowrap;flex-shrink:0;}
.pat-tab.on{color:var(--org);border-bottom-color:var(--org);}
.pill{display:inline-flex;align-items:center;gap:4px;font-size:10px;padding:3px 9px;border-radius:3px;letter-spacing:.05em;}
.pill-grn{background:#10b98114;color:#10b981;border:1px solid #10b98133;}
.pill-ylw{background:#f59e0b14;color:#f59e0b;border:1px solid #f59e0b33;}
.pill-red{background:#ef444414;color:#ef4444;border:1px solid #ef444433;}
.pill-org{background:#f9731614;color:#f97316;border:1px solid #f9731633;}
.pat-alert{padding:10px 14px;border-radius:7px;font-size:11px;display:flex;gap:8px;margin-bottom:12px;line-height:1.6;}
.al-g{background:#10b98108;border:1px solid #10b98133;color:var(--grn);}
.al-y{background:#f59e0b08;border:1px solid #f59e0b33;color:var(--ylw);}
.al-r{background:#ef444408;border:1px solid #ef444433;color:var(--red);}
.al-o{background:#f9731608;border:1px solid #f9731633;color:var(--org);}
.notif{position:fixed;top:76px;right:24px;z-index:9999;padding:11px 18px;border-radius:8px;font-family:'Space Mono',monospace;font-size:11px;box-shadow:0 8px 32px #00000066;animation:fU .3s ease;}
.notif-ok{background:#0b2a1e;border:1px solid #10b98133;color:#10b981;}
.notif-err{background:#450a0a;border:1px solid #ef444433;color:#f87171;}
.divider{height:1px;background:var(--brd);margin:14px 0;}
.source-table{width:100%;border-collapse:collapse;}
.source-table th{font-size:9px;letter-spacing:.1em;color:var(--mut);padding:8px 10px;border-bottom:1px solid var(--brd);text-align:left;}
.source-table td{padding:7px 10px;border-bottom:1px solid var(--brd)22;font-size:11px;vertical-align:middle;}
.source-table tr:hover td{background:#ffffff03;}
.auditor-verified{background:#10b98108;border:1px solid #10b98133;border-radius:8px;padding:14px 16px;}
.auditor-pending{background:#f59e0b08;border:1px solid #f59e0b33;border-radius:8px;padding:14px 16px;}
@keyframes fU{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:900px){.g2,.g3,.g4,.stats{grid-template-columns:1fr 1fr;}.month-grid{grid-template-columns:repeat(6,1fr);}}
@media(max-width:600px){.stats{grid-template-columns:1fr 1fr;}}
`;

// ─────────────────────────────────────────────────────────────────────────────
export default function PATScheme({ profile }) {
  const [tab,       setTab]      = useState('setup');
  const [form,      setForm]     = useState(defForm());
  const [monthly,   setMonthly]  = useState(Array(12).fill(0));
  const [sources,   setSources]  = useState(defSources());
  const [selMonth,  setSelMonth] = useState(null);
  const [monthVal,  setMonthVal] = useState('');
  const [notif,     setNotif]    = useState(null);
  const [saving,    setSaving]   = useState(false);
  const [loading,   setLoading]  = useState(true);
  const [loadError, setLoadError]= useState(false);  // [FIX-LOAD-ERROR]
  const [bulkInput, setBulkInput]= useState('');
  const [secErr,    setSecErr]   = useState('');     // [FIX-SEC-VALIDATE]
  const abortRef = useRef(null);

  const toast = (msg, type = 'ok') => { setNotif({ msg, type }); setTimeout(() => setNotif(null), 3800); };
  const sector = PAT_SECTORS.find(s => s.id === form.sector) || PAT_SECTORS[0];

  // ── [FIX-API-WIRE] Load via patAPI ────────────────────────────────────────
  const load = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    setLoadError(false);

    patAPI.getProfile()
      .then(res => {
        if (ctl.signal.aborted) return;
        if (res?.data) {
          const d = res.data;
          setForm(f => ({
            ...f,
            sector:               d.sector               || f.sector,
            cycle:                d.cycle                || f.cycle,
            dc_name:              sanitise(d.dc_name     || ''),
            dc_number:            sanitise(d.dc_number   || ''),
            baseline_sec:         d.baseline_sec         ?? '',
            target_sec:           d.target_sec           ?? '',
            target_reduction_pct: d.target_reduction_pct ?? '',
            gate_capacity:        d.gate_capacity        ?? '',
            reporting_year:       d.reporting_year       || new Date().getFullYear(),
            auditor_name:         sanitise(d.auditor_name         || ''),
            auditor_firm:         sanitise(d.auditor_firm         || ''),
            auditor_reg_number:   sanitise(d.auditor_reg_number   || ''),
            audit_date:           d.audit_date           || '',
            audit_verified:       !!d.audit_verified,
          }));
          if (Array.isArray(d.monthly_gj) && d.monthly_gj.length === 12)
            setMonthly(d.monthly_gj.map(v => parseFloat(v) || 0));
          if (d.energy_sources)
            setSources(s => ({ ...s, ...d.energy_sources }));
        }
      })
      .catch(() => { if (!ctl.signal.aborted) setLoadError(true); })
      .finally(() => { if (!ctl.signal.aborted) setLoading(false); });

    return () => ctl.abort();
  }, []);

  useEffect(() => { const cleanup = load(); return cleanup; }, [load]);

  // Auto-populate dc_name from profile
  useEffect(() => {
    if (profile?.company_name && !form.dc_name)
      setForm(f => ({ ...f, dc_name: profile.company_name }));
  }, [profile, form]);

  // [FIX-SEC-VALIDATE] Real-time validation
  useEffect(() => {
    const b = safeFloat(form.baseline_sec, 0, 1e6);
    const t = safeFloat(form.target_sec,   0, 1e6);
    if (b && t && t >= b)
      setSecErr('Target SEC must be less than Baseline SEC');
    else
      setSecErr('');
  }, [form.baseline_sec, form.target_sec]);

  // ── Derived calculations ──────────────────────────────────────────────────
  const totalEnergyGJ = monthly.reduce((s, v) => s + v, 0);
  const gateCapacity  = safeFloat(form.gate_capacity, 0, 1e9) || 0;
  const currentSEC    = gateCapacity > 0 ? totalEnergyGJ / gateCapacity : 0;
  const baselineSEC   = safeFloat(form.baseline_sec, 0, 1e6) || 0;

  const targetSEC = (() => {
    const direct = safeFloat(form.target_sec, 0, 1e6);
    if (direct && direct < baselineSEC) return direct;
    const pct = safeFloat(form.target_reduction_pct, 0, 100);
    if (pct && baselineSEC) return baselineSEC * (1 - pct / 100);
    return 0;
  })();

  const achieved      = targetSEC > 0 && currentSEC > 0 && currentSEC <= targetSEC;
  const secVsTarget   = targetSEC > 0 ? ((targetSEC - currentSEC) / targetSEC * 100) : null;
  const secVsBase     = baselineSEC > 0 ? ((baselineSEC - currentSEC) / baselineSEC * 100) : null;
  const energySavedGJ = targetSEC > 0 && gateCapacity > 0
    ? Math.max(0, (baselineSEC - currentSEC) * gateCapacity) : 0;
  const escerts       = Math.floor(energySavedGJ / GJ_PER_MTOE);
  // [FIX-DEFICIT-TILE] Deficit properly computed
  const escertDeficit = targetSEC > 0 && currentSEC > targetSEC && gateCapacity > 0
    ? Math.ceil((currentSEC - targetSEC) * gateCapacity / GJ_PER_MTOE) : 0;
  const escertValue   = escerts * ESCERT_PRICE.typical;
  const secProgress   = baselineSEC > 0 && targetSEC > 0
    ? Math.min(100, Math.max(0, ((baselineSEC - currentSEC) / (baselineSEC - targetSEC)) * 100)) : 0;

  const totalSourceGJ = ENERGY_SOURCES.reduce((sum, s) => {
    const qty = safeFloat(sources[s.id], 0, 1e12) || 0;
    return sum + qty * s.gjFactor;
  }, 0);

  // ── [FIX-API-WIRE] Save via patAPI ────────────────────────────────────────
  const handleSave = async () => {
    if (saving) return;
    if (secErr) { toast('Fix SEC validation error before saving', 'err'); return; }
    const cleanMonthly = monthly.map(v => safeFloat(v, 0, 1e12) ?? 0);
    if (cleanMonthly.length !== 12) { toast('Monthly data must have 12 values', 'err'); return; }

    setSaving(true);
    try {
      await patAPI.saveProfile({
        sector:               sanitise(form.sector,     50),
        cycle:                sanitise(form.cycle,      10),
        dc_name:              sanitise(form.dc_name,   200),
        dc_number:            sanitise(form.dc_number, 100),
        baseline_sec:         safeFloat(form.baseline_sec,         0, 1e6) ?? null,
        target_sec:           safeFloat(form.target_sec,           0, 1e6) ?? null,
        target_reduction_pct: safeFloat(form.target_reduction_pct, 0, 100) ?? null,
        gate_capacity:        safeFloat(form.gate_capacity,        0, 1e9) ?? null,
        reporting_year:       parseInt(form.reporting_year, 10) || new Date().getFullYear(),
        monthly_gj:           cleanMonthly,
        energy_sources:       Object.fromEntries(
          ENERGY_SOURCES.map(s => [s.id, safeFloat(sources[s.id], 0, 1e12) ?? 0])
        ),
        current_sec:          currentSEC     || null,
        energy_saved_gj:      energySavedGJ  || null,
        escerts:              escerts        || 0,
        escert_deficit:       escertDeficit  || 0,
        auditor_name:         sanitise(form.auditor_name,         200),
        auditor_firm:         sanitise(form.auditor_firm,         200),
        auditor_reg_number:   sanitise(form.auditor_reg_number,   100),
        audit_date:           form.audit_date || null,
        audit_verified:       !!form.audit_verified,
      });
      toast('PAT profile saved');
    } catch (err) {
      toast(err?.message || 'Save failed. Please try again.', 'err');
    } finally {
      setSaving(false);
    }
  };

  const setMonthEnergy = (i, val) => {
    const n = safeFloat(val, 0, 1e12) ?? 0;
    setMonthly(m => { const nm = [...m]; nm[i] = n; return nm; });
  };

  // [FIX-BULK-VALIDATE] Per-value validation
  const handleBulkEntry = () => {
    const parts = bulkInput.split(',');
    if (parts.length !== 12) { toast('Need exactly 12 comma-separated values (Apr-Mar)', 'err'); return; }
    const badIdx = [];
    const vals   = parts.map((v, i) => {
      const n = safeFloat(v.trim(), 0, 1e12);
      if (n === null) badIdx.push(FY_MONTHS[i].label);
      return n ?? 0;
    });
    if (badIdx.length > 0) toast(`Invalid values for: ${badIdx.join(', ')} — set to 0`, 'err');
    setMonthly(vals);
    setBulkInput('');
    if (badIdx.length === 0) toast('12 monthly values set (Apr-Mar)');
  };

  // [FIX-PDF-EXPORT] BEE Form 1 structured CSV
  const handleExportCSV = () => {
    const fyLabel = `FY${String(form.reporting_year - 1).slice(-2)}-${String(form.reporting_year).slice(-2)}`;
    const rows = [
      '── BEE PAT ANNUAL REPORT (FORM 1) ──',
      `DC Name,"${sanitise(form.dc_name)}"`,
      `DC Number,"${sanitise(form.dc_number)}"`,
      `CIN,"${profile?.company_cin || ''}"`,
      `GSTIN,"${profile?.company_gstin || ''}"`,
      `Sector,"${sector.label}"`,
      `PAT Cycle,${form.cycle}`,
      `Reporting Year,${fyLabel}`,
      '',
      '── SECTION A: SPECIFIC ENERGY CONSUMPTION ──',
      `Baseline SEC,${baselineSEC},${sector.unit}`,
      `BEE Assigned Target SEC,${targetSEC > 0 ? targetSEC.toFixed(4) : ''},${sector.unit}`,
      `Actual Current Year SEC,${currentSEC > 0 ? currentSEC.toFixed(4) : ''},${sector.unit}`,
      `Gate Capacity,${gateCapacity},${sector.gateUnit}/yr`,
      `Target Achieved,${achieved ? 'YES' : 'NO'}`,
      `SEC Reduction vs Baseline,${secVsBase !== null ? secVsBase.toFixed(2) : ''},%`,
      '',
      '── SECTION B: ENERGY BY SOURCE ──',
      'Energy Source,Quantity,Unit,GJ Equivalent',
      ...ENERGY_SOURCES.map(s => {
        const qty = safeFloat(sources[s.id], 0, 1e12) || 0;
        return `"${s.label}",${qty},${s.unit},${(qty * s.gjFactor).toFixed(2)}`;
      }),
      `Total Energy,${totalEnergyGJ.toFixed(2)},GJ,`,
      `Source Split Total,${totalSourceGJ.toFixed(2)},GJ,`,
      '',
      '── SECTION C: ESCert POSITION ──',
      `Energy Saved,${energySavedGJ.toFixed(2)},GJ`,
      `ESCert Formula,GJ saved / 41868 GJ per MTOE,`,
      `ESCerts Earned,${escerts},ESCerts`,
      `ESCert Deficit,${escertDeficit},ESCerts`,
      `Estimated Value (Rs.1200/ESCert),${escerts > 0 ? (escertValue / 100000).toFixed(2) : 0},Lakh`,
      '',
      '── SECTION D: MONTHLY ENERGY LOG (GJ) Apr-Mar ──',
      FY_MONTHS.map(m => m.label).join(','),
      monthly.map(v => v.toFixed(2)).join(','),
      '',
      '── SECTION E: THIRD-PARTY VERIFICATION ──',
      `Energy Auditor,"${sanitise(form.auditor_name)}"`,
      `Auditor Firm,"${sanitise(form.auditor_firm)}"`,
      `BEE Registration No.,"${sanitise(form.auditor_reg_number)}"`,
      `Audit Date,${form.audit_date || ''}`,
      `Verification Status,${form.audit_verified ? 'VERIFIED' : 'PENDING'}`,
    ].join('\n');

    const blobUrl = URL.createObjectURL(new Blob([rows], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href     = blobUrl;
    a.download = `BEE_PAT_Form1_${sanitise(form.dc_name || 'DC', 30)}_${fyLabel}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
    toast('BEE Form 1 CSV exported');
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{CSS}</style>
      {notif && <div className={`notif notif-${notif.type}`}>{notif.msg}</div>}

      <div className="pat">
        <div className="pat-in">

          {/* ── Header ────────────────────────────────────────────────── */}
          <div className="pat-hd">
            <div>
              <div className="pat-label">BEE INDIA · ENERGY CONSERVATION ACT 2001 · PAT SCHEME</div>
              <div className="pat-title">Perform Achieve <span>Trade</span></div>
              <div className="pat-sub">SEC · ESCert (1 ESCert = 1 MTOE = 41,868 GJ) · BEE Form 1 · PXIL/IEX</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-g btn-sm" onClick={handleExportCSV}>EXPORT BEE FORM 1</button>
              <button className="btn btn-org btn-sm" onClick={handleSave}
                disabled={saving || !!secErr}>
                {saving ? 'SAVING' : 'SAVE PAT DATA'}
              </button>
            </div>
          </div>

          <div className="pat-alert al-o">
            <span>⚡</span>
            <span>
              <strong>ESCert:</strong> 1 ESCert = 1 MTOE = 41,868 GJ (IEA/BEE standard).
              ESCerts = Energy saved (GJ) / 41,868.
              BEE filing deadline: 30 September each year. Cycle IV: FY 2023-24 to 2025-26.
            </span>
          </div>

          {/* [FIX-LOAD-ERROR] */}
          {loadError && !loading && (
            <div className="pat-alert al-r" style={{ cursor: 'pointer' }} onClick={load}>
              <span>✕</span>
              <span>Failed to load PAT data. <strong>Click to retry.</strong></span>
            </div>
          )}

          {/* ── Stats ─────────────────────────────────────────────────── */}
          {!loading && !loadError && (
            <>
              <div className="stats">
                {[
                  { label: 'CURRENT SEC',  val: currentSEC > 0  ? fmt(currentSEC, 3)  : '—', sub: sector.unit,       color: '#f97316' },
                  { label: 'BASELINE SEC', val: baselineSEC > 0 ? fmt(baselineSEC, 3) : '—', sub: 'BEE assigned',    color: '#ef4444' },
                  { label: 'TARGET SEC',   val: targetSEC > 0   ? fmt(targetSEC, 3)   : '—',
                    sub: form.target_reduction_pct ? `${form.target_reduction_pct}% reduction` : 'BEE assigned',
                    color: '#f59e0b' },
                  // [FIX-DEFICIT-TILE] Shows deficit correctly
                  {
                    label: 'ESCerts',
                    val: escerts > 0
                      ? `+${fmt(escerts, 0)}`
                      : escertDeficit > 0
                        ? `-${fmt(escertDeficit, 0)}`
                        : '—',
                    sub: escerts > 0
                      ? `~Rs.${(escertValue / 100_000).toFixed(1)}L @ Rs.${ESCERT_PRICE.typical.toLocaleString()}/ESCert`
                      : escertDeficit > 0
                        ? `Deficit — must purchase ${fmt(escertDeficit, 0)} ESCerts`
                        : 'Enter production data',
                    color: escerts > 0 ? '#10b981' : escertDeficit > 0 ? '#ef4444' : '#4a5278',
                  },
                ].map(({ label, val, sub, color }) => (
                  <div key={label} className="stat-tile">
                    <div className="stat-lbl">{label}</div>
                    <div className="stat-val" style={{ color }}>{val}</div>
                    <div className="stat-sub">{sub}</div>
                  </div>
                ))}
              </div>

              {/* SEC progress */}
              {baselineSEC > 0 && targetSEC > 0 && (
                <div className="pat-card" style={{ padding: '14px 18px', marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 6 }}>
                    <span style={{ color: 'var(--mut)' }}>SEC REDUCTION PROGRESS</span>
                    <span style={{ color: achieved ? '#10b981' : '#f59e0b' }}>
                      {fmt(secProgress, 1)}% toward target{achieved && ' — TARGET ACHIEVED'}
                    </span>
                  </div>
                  <div className="sec-gauge">
                    <div className="sec-fill" style={{
                      width: `${secProgress}%`,
                      background: `linear-gradient(90deg,${secProgress >= 100 ? '#10b981,#34d399' : '#f97316,#facc15'})`,
                    }}/>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--mut)' }}>
                    <span>Baseline: {fmt(baselineSEC, 3)}</span>
                    <span style={{ color: achieved ? '#10b981' : '#f97316' }}>Current: {currentSEC > 0 ? fmt(currentSEC, 3) : '—'}</span>
                    <span>Target: {fmt(targetSEC, 3)} {sector.unit}</span>
                  </div>
                </div>
              )}

              {/* ESCert result box */}
              {(escerts > 0 || escertDeficit > 0) && (
                <div className={`escert-box ${escerts > 0 ? 'escert-surplus' : 'escert-deficit'}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--mut)', marginBottom: 6 }}>
                        {escerts > 0 ? 'ESCert SURPLUS — ELIGIBLE TO SELL ON PXIL / IEX' : 'ESCert DEFICIT — MUST PURCHASE TO AVOID PENALTY'}
                      </div>
                      <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 36, fontWeight: 800, color: escerts > 0 ? '#10b981' : '#ef4444' }}>
                        {escerts > 0 ? `+${fmt(escerts, 0)}` : `-${fmt(escertDeficit, 0)}`}
                        <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 6 }}>ESCerts</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--mut)', marginTop: 4 }}>
                        {escerts > 0
                          ? `~Rs.${(escertValue / 100_000).toFixed(2)}L @ Rs.${ESCERT_PRICE.typical.toLocaleString()}/ESCert (typical)`
                          : 'Purchase on PXIL/IEX to avoid Energy Conservation Act penalty'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--mut)', lineHeight: 2 }}>
                      <div>Energy saved: <strong style={{ color: '#10b981' }}>{fmt(energySavedGJ, 0)} GJ</strong></div>
                      <div>Formula: {fmt(energySavedGJ, 0)} / 41,868</div>
                      <div>= <strong style={{ color: '#10b981' }}>{escerts} ESCerts</strong></div>
                      <div style={{ fontSize: 9, marginTop: 4 }}>Range: Rs.{ESCERT_PRICE.min}–Rs.{ESCERT_PRICE.max.toLocaleString()} (PXIL/IEX 2024)</div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Tabs ─────────────────────────────────────────────── */}
              <div className="pat-tabs">
                {[
                  ['setup',   'DC SETUP'],
                  ['monthly', 'MONTHLY ENERGY'],
                  ['sources', 'ENERGY SOURCES'],
                  ['auditor', 'VERIFICATION'],
                  ['escert',  'ESCert DETAIL'],
                  ['report',  'BEE REPORT'],
                ].map(([k, v]) => (
                  <button key={k} className={`pat-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{v}</button>
                ))}
              </div>

              {/* ══ DC SETUP ══════════════════════════════════════════ */}
              {tab === 'setup' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="pat-card">
                    <div className="pat-ctit">DESIGNATED CONSUMER DETAILS</div>
                    <div className="g3">
                      <div className="pat-fg">
                        <label className="pat-lbl">PAT SECTOR</label>
                        <select className="pat-sel" value={form.sector}
                          onChange={e => setForm(f => ({ ...f, sector: e.target.value }))}>
                          {PAT_SECTORS.map(s => (
                            <option key={s.id} value={s.id}>
                              {s.label}{s.threshold ? ` (>=${s.threshold} TOE)` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="pat-fg">
                        <label className="pat-lbl">PAT CYCLE</label>
                        <select className="pat-sel" value={form.cycle}
                          onChange={e => setForm(f => ({ ...f, cycle: e.target.value }))}>
                          {PAT_CYCLES.map(c => (
                            <option key={c.id} value={c.id}>{c.label} ({c.period})</option>
                          ))}
                        </select>
                      </div>
                      <div className="pat-fg">
                        <label className="pat-lbl">REPORTING YEAR</label>
                        <select className="pat-sel" value={form.reporting_year}
                          onChange={e => setForm(f => ({ ...f, reporting_year: parseInt(e.target.value, 10) }))}>
                          {[2022, 2023, 2024, 2025, 2026].map(y => <option key={y}>{y}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="g2">
                      <div className="pat-fg">
                        <label className="pat-lbl">DC NAME (as per BEE registration)</label>
                        <input className="pat-inp" type="text" maxLength={200}
                          placeholder={profile?.company_name || 'Company name'}
                          value={form.dc_name}
                          onChange={e => setForm(f => ({ ...f, dc_name: e.target.value }))}/>
                      </div>
                      <div className="pat-fg">
                        <label className="pat-lbl">DC NUMBER (BEE assigned)</label>
                        <input className="pat-inp" type="text" maxLength={100}
                          placeholder="e.g. DC/CEM/MH/001"
                          value={form.dc_number}
                          onChange={e => setForm(f => ({ ...f, dc_number: e.target.value }))}/>
                      </div>
                    </div>
                    {profile?.company_cin && (
                      <div style={{ fontSize: 11, color: 'var(--mut)', padding: '8px 12px', background: '#080810', borderRadius: 6, border: '1px solid var(--brd)' }}>
                        CIN: <strong style={{ color: 'var(--txt)' }}>{profile.company_cin}</strong>
                        {profile.company_gstin && <span style={{ marginLeft: 16 }}>GSTIN: <strong style={{ color: 'var(--txt)' }}>{profile.company_gstin}</strong></span>}
                      </div>
                    )}
                  </div>

                  <div className="pat-card">
                    <div className="pat-ctit">SEC BASELINE AND TARGET — BEE ASSIGNED VALUES</div>
                    <div className="pat-alert al-y" style={{ marginBottom: 14 }}>
                      <span>ℹ</span>
                      <span>
                        Baseline and target SEC are assigned by BEE in your DC notification letter.
                        <strong> Do not use estimates for official BEE submission.</strong>
                        Reduction % is for planning only — not accepted for BEE filing.
                      </span>
                    </div>
                    <div className="g3">
                      <div className="pat-fg">
                        <label className="pat-lbl">BASELINE SEC ({sector.unit})</label>
                        <input className="pat-inp" type="number" step="0.001" min="0" max="999999"
                          placeholder="from BEE notification letter"
                          value={form.baseline_sec}
                          onChange={e => setForm(f => ({ ...f, baseline_sec: e.target.value }))}/>
                      </div>
                      <div className="pat-fg">
                        <label className="pat-lbl">TARGET SEC ({sector.unit})</label>
                        <input className={`pat-inp${secErr ? ' err' : ''}`}
                          type="number" step="0.001" min="0" max="999999"
                          placeholder="from BEE notification letter"
                          value={form.target_sec}
                          onChange={e => setForm(f => ({ ...f, target_sec: e.target.value, target_reduction_pct: '' }))}/>
                        {secErr && <div className="pat-field-err">{secErr}</div>}
                      </div>
                      <div className="pat-fg">
                        <label className="pat-lbl">OR REDUCTION % (planning only)</label>
                        <input className="pat-inp" type="number" step="0.1" min="0" max="100"
                          placeholder="e.g. 8.7"
                          value={form.target_reduction_pct}
                          onChange={e => setForm(f => ({ ...f, target_reduction_pct: e.target.value, target_sec: '' }))}/>
                      </div>
                    </div>
                    <div className="pat-fg" style={{ maxWidth: 320 }}>
                      <label className="pat-lbl">GATE CAPACITY ({sector.gateUnit}/year)</label>
                      <input className="pat-inp" type="number" step="1" min="0" max="999999999"
                        placeholder="annual production"
                        value={form.gate_capacity}
                        onChange={e => setForm(f => ({ ...f, gate_capacity: e.target.value }))}/>
                    </div>
                    {targetSEC > 0 && baselineSEC > 0 && !secErr && (
                      <div className="pat-alert al-g">
                        <span>✓</span>
                        <span>
                          Target SEC: <strong>{fmt(targetSEC, 3)} {sector.unit}</strong> —
                          Reduction required: <strong>{fmt((1 - targetSEC / baselineSEC) * 100, 2)}%</strong> from baseline
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="pat-card">
                    <div className="pat-ctit">PAT CYCLE REFERENCE</div>
                    <div className="g2">
                      {PAT_CYCLES.map(c => (
                        <div key={c.id} style={{ padding: 12, borderRadius: 7, border: `1px solid ${c.status === 'Current' ? '#f9731444' : 'var(--brd)'}`, background: '#080810' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontWeight: 700, fontSize: 12 }}>{c.label}</span>
                            <span className={`pill ${c.status === 'Current' ? 'pill-org' : c.status === 'Upcoming' ? 'pill-ylw' : 'pill-grn'}`}>
                              {c.status.toUpperCase()}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--mut)' }}>{c.period}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ══ MONTHLY ENERGY ════════════════════════════════════ */}
              {tab === 'monthly' && (
                <div className="pat-card">
                  {/* [FIX-FY-ALIGN] Apr-Mar order */}
                  <div className="pat-ctit">MONTHLY ENERGY CONSUMPTION — GJ (APRIL–MARCH, INDIAN FY)</div>
                  <div style={{ fontSize: 11, color: 'var(--mut)', marginBottom: 14, lineHeight: 1.8 }}>
                    Reporting period: April {form.reporting_year - 1} to March {form.reporting_year}.
                    1 kWh = 0.0036 GJ · 1 kg coal = 0.026 GJ · 1 L diesel = 0.0387 GJ
                  </div>

                  {/* [FIX-EMPTY-MONTHLY] */}
                  {monthly.every(v => v === 0) && (
                    <div className="pat-alert al-y">
                      <span>⚠</span>
                      <span>No monthly energy data entered yet. Click any month cell or use bulk entry below.</span>
                    </div>
                  )}

                  <div className="month-grid">
                    {FY_MONTHS.map((m, i) => {
                      const max = Math.max(...monthly, 1);
                      const pct = (monthly[i] || 0) / max * 100;
                      return (
                        <div key={m.label}
                          className={`month-cell${selMonth === i ? ' active' : ''}`}
                          onClick={() => { setSelMonth(i); setMonthVal(String(monthly[i] || '')); }}>
                          <div className="month-cell-lbl">{m.label}</div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: monthly[i] > 0 ? '#f97316' : 'var(--mut)' }}>
                            {monthly[i] > 0 ? (monthly[i] >= 1000 ? `${(monthly[i] / 1000).toFixed(1)}k` : fmt(monthly[i], 0)) : '—'}
                          </div>
                          <div style={{ height: 3, borderRadius: 2, background: 'var(--brd)', marginTop: 4, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: '#f97316', borderRadius: 2 }}/>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {selMonth !== null && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', padding: 14, background: '#080810', borderRadius: 8, border: '1px solid var(--brd)', marginBottom: 14 }}>
                      <div className="pat-fg" style={{ flex: 1, marginBottom: 0 }}>
                        <label className="pat-lbl">ENERGY FOR {FY_MONTHS[selMonth].label.toUpperCase()} (GJ)</label>
                        <input className="pat-inp" type="number" step="0.1" min="0" max="999999999999" autoFocus
                          value={monthVal}
                          onChange={e => setMonthVal(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { setMonthEnergy(selMonth, monthVal); setSelMonth(null); }}}/>
                      </div>
                      <button className="btn btn-org btn-sm" onClick={() => { setMonthEnergy(selMonth, monthVal); setSelMonth(null); }}>SET</button>
                      <button className="btn btn-g btn-sm" onClick={() => setSelMonth(null)}>CANCEL</button>
                    </div>
                  )}

                  <div className="divider"/>
                  <div style={{ fontSize: 10, letterSpacing: '.1em', color: 'var(--mut)', marginBottom: 10 }}>
                    BULK ENTRY — 12 VALUES (Apr–Mar, GJ)
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="pat-inp" type="text"
                      placeholder="Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec,Jan,Feb,Mar (GJ)"
                      value={bulkInput}
                      onChange={e => setBulkInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleBulkEntry(); }}/>
                    <button className="btn btn-org btn-sm" onClick={handleBulkEntry} style={{ flexShrink: 0 }}>SET ALL</button>
                  </div>
                  <div className="divider"/>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--mut)' }}>Total annual energy</span>
                    <span style={{ color: '#f97316', fontWeight: 700 }}>{fmt(totalEnergyGJ, 0)} GJ</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 6 }}>
                    <span style={{ color: 'var(--mut)' }}>Calculated current SEC</span>
                    <span style={{ color: currentSEC > 0 && currentSEC <= targetSEC && targetSEC > 0 ? '#10b981' : '#f59e0b', fontWeight: 700 }}>
                      {gateCapacity > 0 ? `${fmt(currentSEC, 3)} ${sector.unit}` : '— set gate capacity in DC Setup'}
                    </span>
                  </div>
                </div>
              )}

              {/* ══ [FIX-SOURCE-SPLIT] ENERGY SOURCES ════════════════ */}
              {tab === 'sources' && (
                <div className="pat-card">
                  <div className="pat-ctit">ENERGY BY SOURCE — BEE FORM 1 MANDATORY</div>
                  <div className="pat-alert al-y" style={{ marginBottom: 14 }}>
                    <span>ℹ</span>
                    <span>
                      BEE Form 1 requires source-wise energy split. GJ equivalent auto-calculated.
                      Monthly total: <strong style={{ color: '#f97316' }}>{fmt(totalEnergyGJ, 0)} GJ</strong>
                    </span>
                  </div>
                  <table className="source-table">
                    <thead>
                      <tr>
                        <th>ENERGY SOURCE</th><th>QUANTITY</th><th>UNIT</th><th>CONVERSION</th><th>GJ EQUIV.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ENERGY_SOURCES.map(s => {
                        const qty = safeFloat(sources[s.id], 0, 1e12) || 0;
                        const gj  = qty * s.gjFactor;
                        return (
                          <tr key={s.id}>
                            <td style={{ color: 'var(--txt)' }}>{s.label}</td>
                            <td>
                              <input className="pat-inp" type="number" step="0.01" min="0" placeholder="0"
                                value={sources[s.id]}
                                onChange={e => setSources(sv => ({ ...sv, [s.id]: e.target.value }))}
                                style={{ padding: '6px 8px', fontSize: 11 }}/>
                            </td>
                            <td style={{ color: 'var(--mut)', fontSize: 10 }}>{s.unit}</td>
                            <td style={{ color: 'var(--mut)', fontSize: 10 }}>{s.gjFactor} GJ/{s.unit}</td>
                            <td style={{ color: gj > 0 ? '#f97316' : 'var(--mut)', fontWeight: gj > 0 ? 700 : 400 }}>
                              {gj > 0 ? `${fmt(gj, 1)} GJ` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                      <tr style={{ borderTop: '2px solid var(--brd)' }}>
                        <td colSpan={4} style={{ color: 'var(--mut)', fontWeight: 700, fontSize: 11 }}>SOURCE SPLIT TOTAL</td>
                        <td style={{ color: '#f97316', fontWeight: 700 }}>{fmt(totalSourceGJ, 1)} GJ</td>
                      </tr>
                      <tr>
                        <td colSpan={4} style={{ color: 'var(--mut)', fontSize: 11 }}>MONTHLY LOG TOTAL</td>
                        <td style={{ color: '#f97316', fontWeight: 700 }}>{fmt(totalEnergyGJ, 1)} GJ</td>
                      </tr>
                    </tbody>
                  </table>
                  {Math.abs(totalSourceGJ - totalEnergyGJ) > 10 && totalSourceGJ > 0 && totalEnergyGJ > 0 && (
                    <div className="pat-alert al-r" style={{ marginTop: 14 }}>
                      <span>⚠</span>
                      <span>
                        Source split ({fmt(totalSourceGJ, 0)} GJ) differs from monthly log ({fmt(totalEnergyGJ, 0)} GJ)
                        by {fmt(Math.abs(totalSourceGJ - totalEnergyGJ), 0)} GJ. Reconcile before BEE submission.
                      </span>
                    </div>
                  )}
                  {Math.abs(totalSourceGJ - totalEnergyGJ) <= 10 && totalSourceGJ > 0 && (
                    <div className="pat-alert al-g" style={{ marginTop: 14 }}>
                      <span>✓</span>
                      <span>Source split reconciles with monthly log. BEE Form 1 ready.</span>
                    </div>
                  )}
                </div>
              )}

              {/* ══ [FIX-AUDITOR] VERIFICATION TAB ══════════════════ */}
              {tab === 'auditor' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="pat-card">
                    <div className="pat-ctit">BEE-ACCREDITED ENERGY AUDITOR — THIRD-PARTY VERIFICATION</div>
                    <div className="pat-alert al-y" style={{ marginBottom: 14 }}>
                      <span>ℹ</span>
                      <span>
                        PAT annual reports must be verified by a BEE-accredited Energy Auditor before submission.
                        Unverified reports may be rejected by BEE.
                      </span>
                    </div>
                    <div className={form.audit_verified ? 'auditor-verified' : 'auditor-pending'} style={{ marginBottom: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: form.audit_verified ? '#10b981' : '#f59e0b' }}>
                          {form.audit_verified ? 'VERIFIED BY BEE-ACCREDITED AUDITOR' : 'VERIFICATION PENDING'}
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 11, color: 'var(--mut)' }}>
                          <input type="checkbox"
                            checked={form.audit_verified}
                            onChange={e => setForm(f => ({ ...f, audit_verified: e.target.checked }))}/>
                          Mark as verified
                        </label>
                      </div>
                    </div>
                    <div className="g2">
                      <div className="pat-fg">
                        <label className="pat-lbl">ENERGY AUDITOR NAME</label>
                        <input className="pat-inp" type="text" maxLength={200}
                          placeholder="Full name of BEE-accredited EA"
                          value={form.auditor_name}
                          onChange={e => setForm(f => ({ ...f, auditor_name: e.target.value }))}/>
                      </div>
                      <div className="pat-fg">
                        <label className="pat-lbl">AUDITOR FIRM</label>
                        <select className="pat-sel" value={form.auditor_firm}
                          onChange={e => setForm(f => ({ ...f, auditor_firm: e.target.value }))}>
                          <option value="">Select firm</option>
                          {BEE_VERIFIERS.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="g2">
                      <div className="pat-fg">
                        <label className="pat-lbl">BEE REGISTRATION NUMBER (EA)</label>
                        <input className="pat-inp" type="text" maxLength={100}
                          placeholder="e.g. BEE/EA/2024/XXXXX"
                          value={form.auditor_reg_number}
                          onChange={e => setForm(f => ({ ...f, auditor_reg_number: e.target.value }))}/>
                      </div>
                      <div className="pat-fg">
                        <label className="pat-lbl">AUDIT DATE</label>
                        <input className="pat-inp" type="date"
                          max={new Date().toISOString().slice(0, 10)}
                          value={form.audit_date}
                          onChange={e => setForm(f => ({ ...f, audit_date: e.target.value }))}/>
                      </div>
                    </div>
                    <button className="btn btn-org btn-sm" onClick={handleSave} disabled={saving || !!secErr}>
                      {saving ? 'SAVING' : 'SAVE AUDITOR DETAILS'}
                    </button>
                  </div>

                  <div className="pat-card">
                    <div className="pat-ctit">VERIFICATION CHECKLIST</div>
                    {[
                      { label: 'DC registered with BEE',               ok: !!form.dc_number },
                      { label: 'Baseline SEC entered (from BEE letter)',ok: baselineSEC > 0 },
                      { label: 'Target SEC entered (from BEE letter)',  ok: targetSEC > 0 },
                      { label: 'Gate capacity set',                     ok: gateCapacity > 0 },
                      { label: 'All 12 months of energy data entered',  ok: monthly.every(v => v > 0) },
                      { label: 'Source-wise energy split entered',      ok: totalSourceGJ > 0 },
                      { label: 'Source split reconciles with monthly',  ok: Math.abs(totalSourceGJ - totalEnergyGJ) <= 10 },
                      { label: 'BEE-accredited Energy Auditor assigned',ok: !!form.auditor_name },
                      { label: 'Auditor BEE registration number',       ok: !!form.auditor_reg_number },
                      { label: 'Audit date set',                        ok: !!form.audit_date },
                      { label: 'Third-party verification completed',    ok: form.audit_verified },
                    ].map(({ label, ok }) => (
                      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--brd)22', fontSize: 11 }}>
                        <span style={{ color: ok ? '#10b981' : '#f59e0b', fontSize: 13, flexShrink: 0 }}>{ok ? '✓' : '○'}</span>
                        <span style={{ color: ok ? 'var(--txt)' : 'var(--mut)', flex: 1 }}>{label}</span>
                        <span className={`pill ${ok ? 'pill-grn' : 'pill-ylw'}`}>{ok ? 'DONE' : 'PENDING'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ══ ESCert DETAIL ════════════════════════════════════ */}
              {tab === 'escert' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="pat-card">
                    <div className="pat-ctit">ESCert CALCULATION — BEE FORMULA</div>
                    <div className="pat-alert al-g" style={{ marginBottom: 12 }}>
                      <span>✓</span>
                      <span><strong>1 ESCert = 1 MTOE = 41,868 GJ</strong> (IEA/BEE standard). ESCerts = GJ saved / 41,868.</span>
                    </div>
                    {[
                      ['Baseline SEC',               `${fmt(baselineSEC, 3)} ${sector.unit}`,  '#ef4444'],
                      ['Current SEC',                `${fmt(currentSEC, 3)} ${sector.unit}`,   '#f97316'],
                      ['Target SEC',                 `${fmt(targetSEC, 3)} ${sector.unit}`,    '#f59e0b'],
                      ['SEC reduction vs baseline',  secVsBase  !== null ? `${fmt(secVsBase, 2)}%`  : '—', secVsBase  > 0 ? '#10b981' : '#ef4444'],
                      ['SEC reduction vs target',    secVsTarget !== null ? `${fmt(secVsTarget, 2)}%` : '—', achieved ? '#10b981' : '#f59e0b'],
                      ['Gate capacity',              `${fmt(gateCapacity, 0)} ${sector.gateUnit}`, '#3b82f6'],
                      ['Total energy consumed',      `${fmt(totalEnergyGJ, 0)} GJ`,            '#f97316'],
                      ['Energy saved vs baseline',   `${fmt(energySavedGJ, 0)} GJ`,            '#10b981'],
                      ['GJ per MTOE (IEA)',          '41,868 GJ/MTOE',                         'var(--mut)'],
                      ['ESCerts = saved / 41,868',   `${fmt(escerts, 0)} ESCerts`,             escerts > 0 ? '#10b981' : '#ef4444'],
                      ['ESCert deficit',             escertDeficit > 0 ? `${fmt(escertDeficit, 0)} to purchase` : 'None', escertDeficit > 0 ? '#ef4444' : '#10b981'],
                      ['Value @ Rs.1,200 typical',   escerts > 0 ? `Rs.${(escertValue / 100_000).toFixed(2)} Lakh` : '—', '#10b981'],
                    ].map(([k, v, c]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--brd)33', fontSize: 12 }}>
                        <span style={{ color: 'var(--mut)' }}>{k}</span>
                        <span style={{ color: c || 'var(--txt)', fontWeight: k.includes('ESCerts =') ? 700 : 400 }}>{v}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 8, background: '#f9731608', border: '1px solid #f9731633', fontSize: 11, color: '#f97316', lineHeight: 1.8 }}>
                      <strong>Penalty:</strong> DCs failing SEC target must purchase deficit ESCerts or face penalty under Energy Conservation Act 2001 (amended 2022).
                      Filing deadline: 30 September. ESCerts trade on PXIL and IEX.
                      Range: Rs.{ESCERT_PRICE.min}–Rs.{ESCERT_PRICE.max.toLocaleString()}/ESCert (2024).
                    </div>
                  </div>

                  <div className="pat-card">
                    <div className="pat-ctit">ESCert MARKET VALUE SCENARIOS</div>
                    {[
                      { label: `Minimum (Rs.${ESCERT_PRICE.min}/ESCert)`,     price: ESCERT_PRICE.min     },
                      { label: `Typical (Rs.${ESCERT_PRICE.typical}/ESCert)`, price: ESCERT_PRICE.typical },
                      { label: `Peak 2023 (Rs.${ESCERT_PRICE.max.toLocaleString()}/ESCert)`, price: ESCERT_PRICE.max },
                    ].map(({ label, price }) => {
                      const val    = escerts * price;
                      const defVal = escertDeficit * price;
                      return (
                        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--brd)22', fontSize: 12 }}>
                          <span style={{ color: 'var(--mut)' }}>{label}</span>
                          <span style={{ color: escerts > 0 ? '#10b981' : escertDeficit > 0 ? '#ef4444' : 'var(--mut)', fontWeight: 700 }}>
                            {escerts > 0
                              ? `Rs.${(val / 100_000).toFixed(2)}L revenue`
                              : escertDeficit > 0
                                ? `Rs.${(defVal / 100_000).toFixed(2)}L purchase cost`
                                : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ══ BEE REPORT ═══════════════════════════════════════ */}
              {tab === 'report' && (
                <div className="pat-card">
                  <div className="pat-ctit">BEE PAT ANNUAL REPORT — FORM 1 FORMAT</div>

                  {['A — IDENTITY', 'B — SEC', 'C — ESCert', 'D — VERIFICATION'].map((section, si) => (
                    <div key={section}>
                      <div style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--org)', marginBottom: 10, marginTop: si > 0 ? 16 : 4 }}>
                        SECTION {section}
                      </div>
                      {si === 0 && [
                        ['DC Name',         sanitise(form.dc_name) || profile?.company_name || '—'],
                        ['DC Number',       sanitise(form.dc_number) || '—'],
                        ['CIN',             profile?.company_cin   || '—'],
                        ['GSTIN',           profile?.company_gstin || '—'],
                        ['Sector',          sector.label],
                        ['PAT Cycle',       `Cycle ${form.cycle} (${PAT_CYCLES.find(c => c.id === form.cycle)?.period || '—'})`],
                        ['Reporting Year',  `FY ${form.reporting_year - 1}-${String(form.reporting_year).slice(-2)}`],
                      ].map(([k, v]) => (
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--brd)22', fontSize: 11 }}>
                          <span style={{ color: 'var(--mut)' }}>{k}</span>
                          <span>{v}</span>
                        </div>
                      ))}
                      {si === 1 && [
                        ['Baseline SEC',           `${fmt(baselineSEC, 3)} ${sector.unit}`,  '#ef4444'],
                        ['BEE Target SEC',         `${fmt(targetSEC, 3)} ${sector.unit}`,    '#f59e0b'],
                        ['Actual Current SEC',     currentSEC > 0 ? `${fmt(currentSEC, 3)} ${sector.unit}` : '—', '#f97316'],
                        ['Gate Capacity',          gateCapacity > 0 ? `${fmt(gateCapacity, 0)} ${sector.gateUnit}` : '—', '#3b82f6'],
                        ['Total Energy',           `${fmt(totalEnergyGJ, 0)} GJ`,            '#f97316'],
                        ['Target Achieved',        achieved ? 'YES' : targetSEC > 0 ? 'NO' : '—', achieved ? '#10b981' : '#ef4444'],
                        ['SEC Reduction vs Baseline', secVsBase !== null ? `${fmt(secVsBase, 2)}%` : '—', secVsBase > 0 ? '#10b981' : '#ef4444'],
                      ].map(([k, v, c]) => (
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--brd)22', fontSize: 11 }}>
                          <span style={{ color: 'var(--mut)' }}>{k}</span>
                          <span style={{ color: c || 'var(--txt)' }}>{v}</span>
                        </div>
                      ))}
                      {si === 2 && [
                        ['Energy Saved',           `${fmt(energySavedGJ, 0)} GJ`,      energySavedGJ > 0 ? '#10b981' : 'var(--mut)'],
                        ['ESCerts Earned',         `${fmt(escerts, 0)} ESCerts`,        escerts > 0 ? '#10b981' : 'var(--mut)'],
                        ['ESCert Deficit',         escertDeficit > 0 ? `${fmt(escertDeficit, 0)} ESCerts` : 'None', escertDeficit > 0 ? '#ef4444' : '#10b981'],
                      ].map(([k, v, c]) => (
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--brd)22', fontSize: 11 }}>
                          <span style={{ color: 'var(--mut)' }}>{k}</span>
                          <span style={{ color: c }}>{v}</span>
                        </div>
                      ))}
                      {si === 3 && [
                        ['Energy Auditor',       sanitise(form.auditor_name)       || '—'],
                        ['Auditor Firm',         sanitise(form.auditor_firm)       || '—'],
                        ['BEE Reg. No.',         sanitise(form.auditor_reg_number) || '—'],
                        ['Audit Date',           form.audit_date                   || '—'],
                        ['Verification Status',  form.audit_verified ? 'VERIFIED' : 'PENDING'],
                      ].map(([k, v]) => (
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--brd)22', fontSize: 11 }}>
                          <span style={{ color: 'var(--mut)' }}>{k}</span>
                          <span style={{ color: k === 'Verification Status' ? (form.audit_verified ? '#10b981' : '#f59e0b') : 'var(--txt)' }}>{v}</span>
                        </div>
                      ))}
                    </div>
                  ))}

                  <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                    <button className="btn btn-org" onClick={handleSave} disabled={saving || !!secErr}>
                      {saving ? 'SAVING' : 'SAVE & CONFIRM'}
                    </button>
                    <button className="btn btn-g" onClick={handleExportCSV}>EXPORT BEE FORM 1 CSV</button>
                  </div>
                </div>
              )}
            </>
          )}

          {loading && !loadError && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--mut)', fontSize: 11, letterSpacing: '.1em' }}>
              LOADING PAT DATA
            </div>
          )}
        </div>
      </div>
    </>
  );
}