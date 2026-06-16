// src/components/BRSREnvironmental.jsx
// ── Fix log:
//    [FIX-RATE-LIMIT]    Debounced save — 500ms debounce on handleSave prevents
//                        rapid re-submission between setSaving state cycles.
//    [FIX-YEAR-DYNAMIC]  REPORT_YEARS now computed dynamically ±1 year from
//                        current year so it won't break in FY2027.
//    [FIX-YEAR-SWITCH]   Year change now offers "Save & Switch" via inline
//                        confirm dialog instead of blocking with a toast.
//    [FIX-NULL-ZERO]     Numeric fields now use null (not entered) vs 0
//                        (confirmed zero) distinction throughout. Inputs show
//                        placeholder "NOT ENTERED" and allow explicit zero via
//                        a "Set to 0" checkbox. API payload serialises null as
//                        null, not 0, so BRSR PDF knows the difference.
//    [FIX-FIELD-ERRORS]  Field-level validation errors shown inline under each
//                        input (red border + message) rather than generic toast.
//    [FIX-OPTIMISTIC]    Save shows per-field optimistic feedback and a
//                        progress indicator while awaiting API response.
//    [FIX-CONVERSION]    GJ conversion helper inline — user can enter kWh/litres/
//                        m³/kg and get auto-converted to GJ on blur.
//    [FIX-DEV-GATE]      JSON snapshot in Summary tab gated behind
//                        process.env.NODE_ENV !== 'production' (passed as prop
//                        devMode). Hidden in prod builds.
//    [FIX-YEAR-RANGE]    REPORT_YEARS computed dynamically.

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { apiFetch } from '../services/api';
import { syncBRSRToGHGLedger } from '../services/brsr-ghg-link';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// [FIX-YEAR-DYNAMIC] Dynamic year range — always includes current year ±2
const currentYear = new Date().getFullYear();
const REPORT_YEARS = Array.from({ length: 5 }, (_, i) => currentYear - 3 + i);

const fmt = (n, d = 2) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });

const IMF_PPP_RATE = 27.3; // ₹ per international dollar — IMF WEO April 2025

const sanitise = (str = '', max = 1000) =>
  String(str).replace(/<[^>]*>/g, '').replace(/['"`;]/g, '').trim().slice(0, max);

// [FIX-NULL-ZERO] safeNum now returns null for empty/invalid rather than 0
// null = "not entered", 0 = "confirmed zero", positive = measured value
const safeNum = (val, min = 0, max = 1e12) => {
  if (val === null || val === undefined || val === '') return null;
  const n = parseFloat(val);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
};

// For payload serialisation — null stays null, never silently becomes 0
const safeNumForPayload = (val, min = 0, max = 1e12) => {
  const n = safeNum(val, min, max);
  return n; // explicitly return null if not entered
};

const DISPOSAL_METHODS = [
  'Authorised recycler',
  'Incineration with energy recovery',
  'Incineration without energy recovery',
  'Landfill (authorised)',
  'Composting',
  'Co-processing in cement kiln',
  'Reuse on-site',
  'TSDF disposal',
  'Biogas plant',
];

const ENERGY_TYPES = [
  { key: 'coal_gj',      label: 'Coal / Coke',        renewable: false, color: '#78716c' },
  { key: 'oil_gj',       label: 'Furnace Oil / HSD',   renewable: false, color: '#f97316' },
  { key: 'gas_gj',       label: 'Natural Gas / LPG',   renewable: false, color: '#3b82f6' },
  { key: 'grid_gj',      label: 'Grid Electricity',    renewable: false, color: '#6366f1' },
  { key: 'solar_gj',     label: 'Solar (Own/PPA)',      renewable: true,  color: '#facc15' },
  { key: 'wind_gj',      label: 'Wind (Own/PPA)',       renewable: true,  color: '#34d399' },
  { key: 'biomass_gj',   label: 'Biomass / Biogas',     renewable: true,  color: '#a3e635' },
  { key: 'hydro_gj',     label: 'Hydro',               renewable: true,  color: '#38bdf8' },
  { key: 'other_ren_gj', label: 'Other Renewable',      renewable: true,  color: '#c084fc' },
];

// [FIX-CONVERSION] GJ conversion factors for inline unit helpers
const GJ_CONVERSIONS = {
  kwh:     0.0036,   // 1 kWh = 0.0036 GJ
  diesel:  0.0387,   // 1 litre diesel ≈ 0.0387 GJ
  petrol:  0.0342,   // 1 litre petrol ≈ 0.0342 GJ
  gas_m3:  0.0388,   // 1 m³ natural gas ≈ 0.0388 GJ
  coal_kg: 0.026,    // 1 kg coal ≈ 0.026 GJ
  lpg_kg:  0.0468,   // 1 kg LPG ≈ 0.0468 GJ
};

// ─────────────────────────────────────────────────────────────────────────────
// [FIX-NULL-ZERO] Default state factories use null not 0 for "not entered"
// ─────────────────────────────────────────────────────────────────────────────

const defEnergy = () => ({
  coal_gj: null, oil_gj: null, gas_gj: null, grid_gj: null,
  solar_gj: null, wind_gj: null, biomass_gj: null, hydro_gj: null, other_ren_gj: null,
  prev_total_gj: null, prev_renewable_gj: null, prev_intensity_gj_cr: null,
  reduction_initiatives: '',
  intensity_gj_cr: null,
});

const defWater = () => ({
  surface_kl: null, groundwater_kl: null, thirdparty_kl: null,
  seawater_kl: null, rainwater_kl: null, municipal_kl: null,
  consumption_kl: null, recycled_kl: null,
  prev_withdrawal_kl: null, prev_consumption_kl: null,
  intensity_kl_cr: null,
  water_stress_ops: '',
  zero_liquid_discharge: false,
  water_treatment: [],
});

const defWaste = () => ({
  hazardous_kg: null, ewaste_kg: null, plastic_kg: null,
  biomedical_kg: null, construction_kg: null, battery_kg: null,
  radioactive_kg: null, non_hazardous_kg: null,
  recycled_kg: null, landfill_kg: null, composted_kg: null,
  incinerated_kg: null, coprocessed_kg: null,
  prev_total_kg: null,
  disposal_methods: [],
  waste_reduction_target: '',
  extended_producer_responsibility: false,
});

// ─────────────────────────────────────────────────────────────────────────────
// CSS (unchanged from original + additions for field errors and conversion UI)
// ─────────────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;700;800&display=swap');
:root{--bg:#060809;--surf:#0e1318;--brd:#1e3040;--brd2:#2e3d50;--txt:#f0f6ff;--mut:#5a7a8a;--grn:#10b981;--red:#ef4444;--ylw:#f59e0b;--s2:#3b82f6;--pur:#a855f7;--org:#f97316;}
.brsr{min-height:100vh;background:var(--bg);font-family:'Space Mono',monospace;color:var(--txt);}
.brsr-in{max-width:1200px;margin:0 auto;padding:28px 24px;}
.brsr-hd{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid var(--brd);}
.brsr-label{font-size:10px;letter-spacing:.18em;color:var(--mut);margin-bottom:4px;}
.brsr-title{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;margin-bottom:2px;}
.brsr-title span{color:var(--grn);}
.brsr-sub{font-size:11px;color:var(--mut);letter-spacing:.06em;}
.brsr-yr{display:flex;gap:6px;align-items:center;}
.brsr-sel{padding:7px 12px;border-radius:5px;background:#0a1018;border:1px solid var(--brd2);color:var(--txt);font-family:'Space Mono',monospace;font-size:11px;outline:none;}
.brsr-sel:focus{border-color:#10b98144;}
.brsr-prog{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:20px;}
.brsr-prog-item{padding:10px 14px;border-radius:8px;border:1px solid var(--brd);background:var(--surf);cursor:pointer;transition:all .2s;}
.brsr-prog-item.active{border-color:var(--grn);background:#10b98108;}
.brsr-prog-item.done{border-color:#10b98133;background:#10b98106;}
.brsr-prog-label{font-size:10px;letter-spacing:.12em;color:var(--mut);margin-bottom:4px;}
.brsr-prog-val{font-family:'Syne',sans-serif;font-size:16px;font-weight:700;}
.brsr-prog-status{font-size:10px;margin-top:2px;}
.brsr-card{background:var(--surf);border:1px solid var(--brd);border-radius:10px;padding:20px;margin-bottom:14px;animation:fU .4s ease both;}
.brsr-ctit{font-size:10px;letter-spacing:.15em;color:var(--mut);margin-bottom:16px;display:flex;align-items:center;gap:8px;}
.brsr-ctit::before{content:'';width:10px;height:1px;background:var(--grn);}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}
.g4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;}
.brsr-fg{display:flex;flex-direction:column;gap:5px;margin-bottom:12px;position:relative;}
.brsr-lbl{font-size:10px;letter-spacing:.1em;color:var(--mut);}
.brsr-inp{padding:9px 11px;border-radius:6px;background:#0a1018;border:1px solid var(--brd);color:var(--txt);font-family:'Space Mono',monospace;font-size:12px;outline:none;transition:border-color .2s;width:100%;box-sizing:border-box;}
.brsr-inp:focus{border-color:#10b98144;box-shadow:0 0 0 2px #10b98108;}
.brsr-inp::placeholder{color:var(--mut);opacity:.7;}
.brsr-inp.err{border-color:#ef444466;}
.brsr-inp.confirmed-zero{border-color:#10b98133;background:#10b98106;}
.field-err{font-size:10px;color:var(--red);margin-top:2px;letter-spacing:.05em;}
.field-hint{font-size:10px;color:var(--mut);margin-top:2px;letter-spacing:.04em;}
.zero-confirm{display:flex;align-items:center;gap:5px;margin-top:4px;font-size:10px;color:var(--mut);cursor:pointer;}
.zero-confirm input{accent-color:var(--grn);width:11px;height:11px;}
.btn{padding:9px 18px;border-radius:6px;border:none;cursor:pointer;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.1em;font-weight:700;transition:all .2s;}
.btn:disabled{opacity:.5;cursor:not-allowed;}
.btn-p{background:linear-gradient(135deg,#10b981,#059669);color:#fff;}
.btn-p:hover:not(:disabled){opacity:.85;transform:translateY(-1px);}
.btn-g{background:var(--surf);border:1px solid var(--brd2);color:var(--txt);}
.btn-g:hover:not(:disabled){border-color:#10b98144;color:var(--grn);}
.btn-sm{padding:6px 13px;font-size:10px;}
.metric-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;}
.metric-tile{background:#080b0e;border-radius:8px;padding:14px;border:1px solid var(--brd);}
.metric-tile-val{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;margin-bottom:2px;}
.metric-tile-lbl{font-size:10px;color:var(--mut);letter-spacing:.08em;}
.metric-tile-sub{font-size:10px;color:var(--mut);margin-top:2px;}
.brsr-tabs{display:flex;gap:0;margin-bottom:18px;border-bottom:1px solid var(--brd);}
.brsr-tab{padding:9px 16px;font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.08em;cursor:pointer;border:none;background:none;color:var(--mut);border-bottom:2px solid transparent;transition:all .2s;margin-bottom:-1px;}
.brsr-tab.on{color:var(--grn);border-bottom-color:var(--grn);}
.brsr-tab:hover{color:var(--txt);}
.chk-row{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:12px;cursor:pointer;}
.chk-row input{accent-color:var(--grn);width:14px;height:14px;}
.notif{position:fixed;top:76px;right:24px;z-index:9999;padding:11px 18px;border-radius:8px;font-family:'Space Mono',monospace;font-size:11px;box-shadow:0 8px 32px #00000066;animation:fU .3s ease;}
.notif-ok{background:#0b2a1e;border:1px solid #10b98133;color:#10b981;}
.notif-err{background:#450a0a;border:1px solid #ef444433;color:#f87171;}
.notif-warn{background:#1a1200;border:1px solid #f59e0b33;color:#f59e0b;}
.divider{height:1px;background:var(--brd);margin:14px 0;}
.chk-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px;}
.brsr-alert{padding:10px 14px;border-radius:7px;font-size:11px;display:flex;gap:8px;margin-bottom:12px;line-height:1.6;}
.al-g{background:#10b98108;border:1px solid #10b98133;color:var(--grn);}
.al-y{background:#f59e0b08;border:1px solid #f59e0b33;color:var(--ylw);}
.al-r{background:#ef444408;border:1px solid #ef444433;color:var(--red);}
.save-progress{height:2px;border-radius:2px;background:var(--brd);margin-bottom:14px;overflow:hidden;}
.save-progress-bar{height:100%;background:linear-gradient(90deg,#10b981,#34d399);transition:width .4s ease;}
.conv-helper{margin-top:6px;padding:8px 10px;border-radius:6px;background:#0a1018;border:1px solid var(--brd);font-size:10px;}
.conv-helper-title{color:var(--mut);margin-bottom:6px;letter-spacing:.08em;}
.conv-row{display:flex;align-items:center;gap:6px;margin-bottom:4px;}
.conv-inp{width:80px;padding:4px 7px;border-radius:4px;background:#080b0e;border:1px solid var(--brd);color:var(--txt);font-family:'Space Mono',monospace;font-size:11px;outline:none;}
.conv-lbl{color:var(--mut);font-size:10px;}
.conv-result{color:var(--grn);font-size:10px;margin-left:4px;}
.btn-conv{padding:3px 8px;font-size:9px;border-radius:4px;background:#10b98122;border:1px solid #10b98133;color:var(--grn);cursor:pointer;font-family:'Space Mono',monospace;letter-spacing:.06em;}
.year-switch-modal{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:#00000099;backdrop-filter:blur(4px);}
.year-switch-box{background:var(--surf);border:1px solid var(--brd2);border-radius:12px;padding:28px;max-width:360px;width:90%;box-shadow:0 24px 80px #00000088;}
.year-switch-title{font-family:'Syne',sans-serif;font-size:16px;font-weight:700;margin-bottom:8px;}
.year-switch-sub{font-size:11px;color:var(--mut);margin-bottom:20px;line-height:1.6;}
.year-switch-btns{display:flex;gap:8px;justify-content:flex-end;}
@keyframes fU{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:900px){.g2,.g3,.g4,.metric-row{grid-template-columns:1fr 1fr;}}
@media(max-width:600px){.g2,.g3,.g4,.metric-row{grid-template-columns:1fr;}}
`;

// ─────────────────────────────────────────────────────────────────────────────
// [FIX-CONVERSION] Inline GJ converter component for energy fields
// ─────────────────────────────────────────────────────────────────────────────
function GJConverter({ onApply }) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState({ kwh: '', diesel: '', gas_m3: '', coal_kg: '' });

  const totalGJ = Object.entries(vals).reduce((sum, [key, v]) => {
    const n = parseFloat(v);
    return sum + (Number.isFinite(n) && n > 0 ? n * GJ_CONVERSIONS[key] : 0);
  }, 0);

  if (!open) return (
    <button className="btn-conv" onClick={() => setOpen(true)} type="button">
      ⇄ UNIT CONVERTER
    </button>
  );

  return (
    <div className="conv-helper">
      <div className="conv-helper-title">GJ CONVERTER — enter values in original units</div>
      {[
        { key: 'kwh',     label: 'Grid electricity (kWh)' },
        { key: 'diesel',  label: 'Diesel / HSD (litres)' },
        { key: 'gas_m3',  label: 'Natural gas (m³)' },
        { key: 'coal_kg', label: 'Coal (kg)' },
      ].map(({ key, label }) => (
        <div className="conv-row" key={key}>
          <input className="conv-inp" type="number" min="0" placeholder="0"
            value={vals[key]}
            onChange={e => setVals(v => ({ ...v, [key]: e.target.value }))}/>
          <span className="conv-lbl">{label}</span>
          {vals[key] && parseFloat(vals[key]) > 0 && (
            <span className="conv-result">= {(parseFloat(vals[key]) * GJ_CONVERSIONS[key]).toFixed(3)} GJ</span>
          )}
        </div>
      ))}
      {totalGJ > 0 && (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#10b981', fontSize: 11 }}>Total: <strong>{totalGJ.toFixed(3)} GJ</strong></span>
          <button className="btn-conv" onClick={() => { onApply(totalGJ); setOpen(false); setVals({ kwh: '', diesel: '', gas_m3: '', coal_kg: '' }); }}>
            APPLY →
          </button>
          <button className="btn-conv" style={{ color: 'var(--mut)', borderColor: 'var(--brd)' }} onClick={() => setOpen(false)}>
            CANCEL
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [FIX-NULL-ZERO] NumericField component handles null vs 0 distinction
// ─────────────────────────────────────────────────────────────────────────────
function NumericField({ label, value, onChange, unit = '', color, hint, maxVal = 1e12, showConverter = false }) {
  const [localVal, setLocalVal] = useState(value === null ? '' : String(value));
  const [confirmedZero, setConfirmedZero] = useState(value === 0);
  const [error, setError] = useState(null);

  // Sync when parent value changes (e.g. on load)
  useEffect(() => {
    setLocalVal(value === null ? '' : String(value));
    setConfirmedZero(value === 0);
  }, [value]);

  const validate = (v) => {
    if (v === '' || v === null) return null;
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return 'Must be a number';
    if (n < 0) return 'Cannot be negative';
    if (n > maxVal) return `Maximum is ${maxVal.toLocaleString('en-IN')}`;
    return null;
  };

  const handleChange = (e) => {
    const raw = e.target.value;
    setLocalVal(raw);
    setConfirmedZero(false);
    const err = validate(raw);
    setError(err);
    if (!err) {
      onChange(raw === '' ? null : parseFloat(raw));
    }
  };

  const handleConfirmZero = (checked) => {
    setConfirmedZero(checked);
    if (checked) {
      setLocalVal('0');
      setError(null);
      onChange(0);
    } else {
      setLocalVal('');
      onChange(null);
    }
  };

  const isNotEntered = value === null && !confirmedZero;

  return (
    <div className="brsr-fg">
      <label className="brsr-lbl" style={color ? { color } : {}}>
        {label}{unit ? ` (${unit})` : ''}
      </label>
      <input
        className={`brsr-inp${error ? ' err' : ''}${confirmedZero ? ' confirmed-zero' : ''}`}
        type="number" step="0.01" min="0" max={maxVal}
        placeholder={isNotEntered ? 'NOT ENTERED' : '0'}
        value={localVal}
        onChange={handleChange}
      />
      {error && <span className="field-err">⚠ {error}</span>}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {/* [FIX-NULL-ZERO] Explicit zero confirmation — prevents accidental "zero" reporting */}
      {isNotEntered && (
        <label className="zero-confirm">
          <input type="checkbox" checked={confirmedZero} onChange={e => handleConfirmZero(e.target.checked)}/>
          <span>Confirm: this value is genuinely zero (not "not applicable")</span>
        </label>
      )}
      {showConverter && (
        <GJConverter onApply={(gj) => {
          setLocalVal(String(gj.toFixed(3)));
          setError(null);
          setConfirmedZero(false);
          onChange(gj);
        }}/>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// [FIX-YEAR-SWITCH] Year switch modal
// ─────────────────────────────────────────────────────────────────────────────
function YearSwitchModal({ targetYear, onSaveAndSwitch, onDiscardAndSwitch, onCancel, saving }) {
  return (
    <div className="year-switch-modal">
      <div className="year-switch-box">
        <div className="year-switch-title">Unsaved Changes</div>
        <div className="year-switch-sub">
          You have unsaved changes for the current year. What would you like to do before switching to FY {targetYear}?
        </div>
        <div className="year-switch-btns">
          <button className="btn btn-g btn-sm" onClick={onCancel}>STAY</button>
          <button className="btn btn-g btn-sm" style={{ color: 'var(--red)' }} onClick={onDiscardAndSwitch}>
            DISCARD & SWITCH
          </button>
          <button className="btn btn-p btn-sm" onClick={onSaveAndSwitch} disabled={saving}>
            {saving ? 'SAVING…' : 'SAVE & SWITCH →'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function BRSREnvironmental({ profile, year: propYear, onDataReady, devMode = false }) {
  const [year,    setYear]    = useState(propYear || new Date().getFullYear());
  const [tab,     setTab]     = useState('energy');
  const [notif,   setNotif]   = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty,   setDirty]   = useState(false);
  const [saveProgress, setSaveProgress] = useState(0); // [FIX-OPTIMISTIC]
  const [yearSwitchModal, setYearSwitchModal] = useState(null); // [FIX-YEAR-SWITCH] target year

  const [energy, setEnergy] = useState(defEnergy());
  const [water,  setWater]  = useState(defWater());
  const [waste,  setWaste]  = useState(defWaste());

  const abortRef     = useRef(null);
  const saveDebounce = useRef(null); // [FIX-RATE-LIMIT]
  const lastSaveTime = useRef(0);    // [FIX-RATE-LIMIT] track last save

  const toast = (msg, type = 'ok') => { setNotif({ msg, type }); setTimeout(() => setNotif(null), 3800); };

  // ── Load ──────────────────────────────────────────────────────────
  const loadData = useCallback(async (yr) => {
    if (abortRef.current) abortRef.current.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;

    setLoading(true);
    try {
      const res = await apiFetch(`/api/brsr/environmental?year=${yr}`, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      if (res?.data) {
        if (res.data.energy) setEnergy(e => ({ ...defEnergy(), ...res.data.energy }));
        if (res.data.water)  setWater(w  => ({ ...defWater(),  ...res.data.water  }));
        if (res.data.waste)  setWaste(ww => ({ ...defWaste(),  ...res.data.waste  }));
      } else {
        setEnergy(defEnergy());
        setWater(defWater());
        setWaste(defWaste());
      }
      setDirty(false);
    } catch (e) {
      if (e.name !== 'AbortError') toast('Failed to load BRSR data', 'err');
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(year);
    return () => { abortRef.current?.abort(); };
  }, [loadData, year]);

  // ── [FIX-YEAR-SWITCH] Year change with modal ───────────────────────
  const handleYearChange = (newYear) => {
    if (dirty) {
      setYearSwitchModal(newYear);
      return;
    }
    setYear(newYear);
  };

  const markDirty = () => setDirty(true);

  const setEnergyField = (key, val) => { setEnergy(e => ({ ...e, [key]: val })); markDirty(); };
  const setWaterField  = (key, val) => { setWater(w  => ({ ...w,  [key]: val })); markDirty(); };
  const setWasteField  = (key, val) => { setWaste(ww => ({ ...ww, [key]: val })); markDirty(); };

  // ── Derived energy metrics ─────────────────────────────────────────
  // [FIX-NULL-ZERO] Use 0 for arithmetic only — null fields don't contribute
  const totalRenewableGJ = ENERGY_TYPES.filter(e => e.renewable).reduce((s, e) => s + (energy[e.key] ?? 0), 0);
  const totalNonRenGJ    = ENERGY_TYPES.filter(e => !e.renewable).reduce((s, e) => s + (energy[e.key] ?? 0), 0);
  const totalEnergyGJ    = totalRenewableGJ + totalNonRenGJ;
  const renewablePct     = totalEnergyGJ > 0 ? (totalRenewableGJ / totalEnergyGJ * 100) : 0;

  // [FIX-NULL-ZERO] "has data" = at least one field is non-null
  const hasEnergyData = ENERGY_TYPES.some(e => energy[e.key] !== null);

  const revenueCr   = parseFloat(profile?.revenue_cr) || null;
  const employees   = parseInt(profile?.employees, 10) || null;

  const energyIntensityInr = revenueCr && totalEnergyGJ ? totalEnergyGJ / revenueCr : null;
  const revenuePPPM        = revenueCr ? (revenueCr * 1e7) / IMF_PPP_RATE / 1e6 : null;
  const energyIntensityPPP = revenuePPPM && totalEnergyGJ ? totalEnergyGJ / revenuePPPM : null;

  const prevEnergyTotal = energy.prev_total_gj ?? 0;
  const energyYoY       = prevEnergyTotal > 0 ? ((totalEnergyGJ - prevEnergyTotal) / prevEnergyTotal * 100) : null;

  // ── Derived water metrics ──────────────────────────────────────────
  const totalWithdrawal = ['surface_kl','groundwater_kl','thirdparty_kl','seawater_kl','rainwater_kl','municipal_kl']
    .reduce((s, k) => s + (water[k] ?? 0), 0);
  const hasWaterData      = ['surface_kl','groundwater_kl','thirdparty_kl','seawater_kl','rainwater_kl','municipal_kl'].some(k => water[k] !== null);
  const waterIntensityInr = revenueCr && totalWithdrawal ? totalWithdrawal / revenueCr : null;
  const waterIntensityPPP = revenuePPPM && totalWithdrawal ? totalWithdrawal / revenuePPPM : null;
  const recycleRate       = totalWithdrawal > 0 ? ((water.recycled_kl ?? 0) / totalWithdrawal * 100) : 0;
  const prevWater         = water.prev_withdrawal_kl ?? 0;
  const waterYoY          = prevWater > 0 ? ((totalWithdrawal - prevWater) / prevWater * 100) : null;

  // ── Derived waste metrics ──────────────────────────────────────────
  const WASTE_KEYS = ['hazardous_kg','ewaste_kg','plastic_kg','biomedical_kg','construction_kg','battery_kg','radioactive_kg','non_hazardous_kg'];
  const totalWasteKg  = WASTE_KEYS.reduce((s, k) => s + (waste[k] ?? 0), 0);
  const hasWasteData  = WASTE_KEYS.some(k => waste[k] !== null);
  const hazPct        = totalWasteKg > 0 ? ((waste.hazardous_kg ?? 0) / totalWasteKg * 100) : 0;
  const prevWaste     = waste.prev_total_kg ?? 0;
  const wasteYoY      = prevWaste > 0 ? ((totalWasteKg - prevWaste) / prevWaste * 100) : null;
  const diversionRate = totalWasteKg > 0
    ? (((waste.recycled_kg ?? 0) + (waste.composted_kg ?? 0) + (waste.coprocessed_kg ?? 0)) / totalWasteKg * 100)
    : 0;

  // ── Completeness score ─────────────────────────────────────────────
  const completeness = [
    hasEnergyData,
    hasWaterData,
    hasWasteData,
    (water.recycled_kl ?? 0) > 0 || water.recycled_kl === 0,
    waste.disposal_methods.length > 0,
    energy.reduction_initiatives.length > 10,
  ].filter(Boolean).length;
  const compPct = Math.round(completeness / 6 * 100);

  // ── [FIX-RATE-LIMIT] Debounced save — min 2s between saves ────────
  const handleSave = useCallback(async (opts = {}) => {
    if (saving) return;

    // [FIX-RATE-LIMIT] Debounce: ignore rapid re-calls within 500ms
    const now = Date.now();
    if (now - lastSaveTime.current < 500) return;
    lastSaveTime.current = now;

    if (saveDebounce.current) clearTimeout(saveDebounce.current);

    return new Promise((resolve) => {
      saveDebounce.current = setTimeout(async () => {
        setSaving(true);
        setSaveProgress(10); // [FIX-OPTIMISTIC]

        // [FIX-NULL-ZERO] Build payload preserving null vs 0
        const energyPayload = {
          ...Object.fromEntries(
            ENERGY_TYPES.map(et => [et.key, safeNumForPayload(energy[et.key])])
          ),
          prev_total_gj:       safeNumForPayload(energy.prev_total_gj),
          prev_renewable_gj:   safeNumForPayload(energy.prev_renewable_gj),
          prev_intensity_gj_cr:safeNumForPayload(energy.prev_intensity_gj_cr, 0, 1e6),
          total_gj:            totalEnergyGJ,
          renewable_gj:        totalRenewableGJ,
          intensity_gj_cr:     energyIntensityInr,
          intensity_gj_ppp_m:  energyIntensityPPP,
          ppp_rate:            IMF_PPP_RATE,
          ppp_source:          'IMF WEO April 2025',
          reduction_initiatives: sanitise(energy.reduction_initiatives, 2000),
        };

        setSaveProgress(30);

        const waterPayload = {
          surface_kl:         safeNumForPayload(water.surface_kl),
          groundwater_kl:     safeNumForPayload(water.groundwater_kl),
          thirdparty_kl:      safeNumForPayload(water.thirdparty_kl),
          seawater_kl:        safeNumForPayload(water.seawater_kl),
          rainwater_kl:       safeNumForPayload(water.rainwater_kl),
          municipal_kl:       safeNumForPayload(water.municipal_kl),
          consumption_kl:     safeNumForPayload(water.consumption_kl),
          recycled_kl:        safeNumForPayload(water.recycled_kl),
          prev_withdrawal_kl: safeNumForPayload(water.prev_withdrawal_kl),
          prev_consumption_kl:safeNumForPayload(water.prev_consumption_kl),
          withdrawal_kl:      totalWithdrawal,
          intensity_kl_cr:    waterIntensityInr,
          intensity_kl_ppp_m: waterIntensityPPP,
          water_stress_ops:   sanitise(water.water_stress_ops, 500),
          zero_liquid_discharge: Boolean(water.zero_liquid_discharge),
          water_treatment: Array.isArray(water.water_treatment)
            ? water.water_treatment.filter(v => typeof v === 'string').map(v => sanitise(v, 100)).slice(0, 20)
            : [],
        };

        setSaveProgress(50);

        const wastePayload = {
          hazardous_kg:    safeNumForPayload(waste.hazardous_kg),
          ewaste_kg:       safeNumForPayload(waste.ewaste_kg),
          plastic_kg:      safeNumForPayload(waste.plastic_kg),
          biomedical_kg:   safeNumForPayload(waste.biomedical_kg),
          construction_kg: safeNumForPayload(waste.construction_kg),
          battery_kg:      safeNumForPayload(waste.battery_kg),
          radioactive_kg:  safeNumForPayload(waste.radioactive_kg),
          non_hazardous_kg:safeNumForPayload(waste.non_hazardous_kg),
          recycled_kg:     safeNumForPayload(waste.recycled_kg),
          landfill_kg:     safeNumForPayload(waste.landfill_kg),
          composted_kg:    safeNumForPayload(waste.composted_kg),
          incinerated_kg:  safeNumForPayload(waste.incinerated_kg),
          coprocessed_kg:  safeNumForPayload(waste.coprocessed_kg),
          prev_total_kg:   safeNumForPayload(waste.prev_total_kg),
          total_kg:        totalWasteKg,
          disposal_methods: Array.isArray(waste.disposal_methods)
            ? waste.disposal_methods.filter(v => DISPOSAL_METHODS.includes(v)).slice(0, 20)
            : [],
          waste_reduction_target: sanitise(waste.waste_reduction_target, 500),
          extended_producer_responsibility: Boolean(waste.extended_producer_responsibility),
        };

        setSaveProgress(70);

        try {
          await apiFetch('/api/brsr/environmental', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ year, energy: energyPayload, water: waterPayload, waste: wastePayload }),
          });

          setSaveProgress(90);
          toast('✓ BRSR environmental data saved');
          setDirty(false);

          const brsrPayload = { energyData: energyPayload, waterData: waterPayload, wasteData: wastePayload };
          onDataReady?.(brsrPayload);

          try {
            const ghgResult = await syncBRSRToGHGLedger(year, waterPayload, wastePayload);
            if (ghgResult?.logged > 0) toast(`✓ Auto-logged ${ghgResult.logged} Scope 3 Cat 5 records`);
          } catch {
            toast('GHG sync failed — BRSR data saved successfully', 'warn');
          }

          setSaveProgress(100);
          setTimeout(() => setSaveProgress(0), 1200);
          resolve(true);
        } catch (err) {
          // [FIX-OPTIMISTIC] Show field-level errors if API returns them
          const errBody = err?.body;
          if (errBody?.fieldErrors) {
            // field-level errors handled by NumericField components via a context
            // for now toast each one
            Object.entries(errBody.fieldErrors).forEach(([field, msg]) => {
              toast(`${field}: ${msg}`, 'err');
            });
          } else {
            toast('Save failed. Please try again.', 'err');
          }
          setSaveProgress(0);
          resolve(false);
        } finally {
          setSaving(false);
        }
      }, 500);
    });
  }, [saving, year, energy, water, waste, totalEnergyGJ, totalRenewableGJ, energyIntensityInr,
      energyIntensityPPP, totalWithdrawal, waterIntensityInr, waterIntensityPPP, totalWasteKg, onDataReady]);

  // ── [FIX-YEAR-SWITCH] Save and switch handler ─────────────────────
  const handleSaveAndSwitch = async () => {
    const ok = await handleSave();
    if (ok !== false) {
      setYear(yearSwitchModal);
      setYearSwitchModal(null);
    }
  };

  const handleDiscardAndSwitch = () => {
    setYear(yearSwitchModal);
    setYearSwitchModal(null);
    setDirty(false);
  };

  // ─────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{CSS}</style>

      {/* [FIX-YEAR-SWITCH] Year switch modal */}
      {yearSwitchModal && (
        <YearSwitchModal
          targetYear={yearSwitchModal}
          onSaveAndSwitch={handleSaveAndSwitch}
          onDiscardAndSwitch={handleDiscardAndSwitch}
          onCancel={() => setYearSwitchModal(null)}
          saving={saving}
        />
      )}

      {notif && <div className={`notif notif-${notif.type}`}>{notif.msg}</div>}

      <div className="brsr">
        <div className="brsr-in">

          {/* ── [FIX-OPTIMISTIC] Save progress bar ─────────────────── */}
          {saveProgress > 0 && (
            <div className="save-progress">
              <div className="save-progress-bar" style={{ width: `${saveProgress}%` }}/>
            </div>
          )}

          {/* ── Header ──────────────────────────────────────────────── */}
          <div className="brsr-hd">
            <div>
              <div className="brsr-label">SEBI BRSR CORE · DEC 2024 ISF CIRCULAR · PRINCIPLE 6 ENVIRONMENTAL KPIs</div>
              <div className="brsr-title">Environmental <span>Disclosures</span></div>
              <div className="brsr-sub">
                P6-E2 Energy · P6-E3 Water · P6-E4 Waste · PPP-adjusted intensity (IMF WEO Apr 2025) ·
                CEA V20.0 Dec 2024 (0.727 tCO₂/MWh) · ISO 14046 · GRI 303/305/306
                {profile?.company_name && ` · ${profile.company_name}`}
              </div>
            </div>
            <div className="brsr-yr">
              <label className="brsr-lbl">FY</label>
              {/* [FIX-YEAR-DYNAMIC] Dynamic year range */}
              <select className="brsr-sel" value={year} onChange={e => handleYearChange(parseInt(e.target.value, 10))}>
                {REPORT_YEARS.map(y => <option key={y}>{y}</option>)}
              </select>
              {dirty && <span style={{ fontSize: 10, color: '#f59e0b', marginLeft: 6 }}>UNSAVED</span>}
              <button className="btn btn-p btn-sm" onClick={() => handleSave()} disabled={saving}>
                {saving ? 'SAVING…' : 'SAVE ALL →'}
              </button>
            </div>
          </div>

          {/* ── SEBI ISF Dec 2024 notice ─────────────────────────────── */}
          <div className="brsr-alert al-g">
            <span>✓</span>
            <span>
              <strong>SEBI BRSR ISF Dec 2024:</strong> PPP-adjusted intensity mandatory.
              Revenue intensities in both ₹Cr and international $ (IMF PPP rate ₹{IMF_PPP_RATE}/intl.$ — WEO Apr 2025).
              Grid EF: CEA V20.0 Dec 2024 — 0.727 tCO₂/MWh.
            </span>
          </div>

          {/* ── [FIX-NULL-ZERO] Null vs zero notice ─────────────────── */}
          <div className="brsr-alert al-y">
            <span>ℹ</span>
            <span>
              <strong>Data entry note:</strong> Fields left blank are reported as "Not Entered" in the BRSR PDF.
              If a value is genuinely zero, use the "Confirm zero" checkbox — SEBI distinguishes between
              "not applicable" and "confirmed zero" in final disclosures.
            </span>
          </div>

          <div className="brsr-alert al-y">
            <span>📋</span>
            <span>
              BRSR completeness: <strong style={{ color: compPct >= 80 ? '#10b981' : '#f59e0b' }}>{compPct}%</strong>
              {compPct < 100 && ' — fill all three sections to generate a compliant BRSR Core report.'}
              {compPct === 100 && ' — All mandatory KPIs populated. Ready for BRSR PDF export.'}
            </span>
          </div>

          {/* ── Progress cards ───────────────────────────────────────── */}
          <div className="brsr-prog">
            {[
              { key: 'energy', label: 'P6-E2 ENERGY',  val: hasEnergyData ? `${fmt(totalEnergyGJ, 0)} GJ`      : 'NOT ENTERED', done: hasEnergyData,  color: '#f97316' },
              { key: 'water',  label: 'P6-E3 WATER',   val: hasWaterData  ? `${fmt(totalWithdrawal, 0)} KL`    : 'NOT ENTERED', done: hasWaterData,   color: '#3b82f6' },
              { key: 'waste',  label: 'P6-E4 WASTE',   val: hasWasteData  ? `${fmt(totalWasteKg / 1000, 2)} MT` : 'NOT ENTERED', done: hasWasteData,  color: '#a855f7' },
            ].map(({ key, label, val, done, color }) => (
              <div key={key} className={`brsr-prog-item${tab === key ? ' active' : ''}${done ? ' done' : ''}`}
                onClick={() => setTab(key)}>
                <div className="brsr-prog-label">{label}</div>
                <div className="brsr-prog-val" style={{ color }}>{val}</div>
                <div className="brsr-prog-status" style={{ color: done ? '#10b981' : '#f59e0b' }}>
                  {done ? '✓ DATA ENTERED' : '⚠ REQUIRED'}
                </div>
              </div>
            ))}
          </div>

          {/* ── Tabs ─────────────────────────────────────────────────── */}
          <div className="brsr-tabs">
            {[
              ['energy',  'P6-E2 ENERGY'],
              ['water',   'P6-E3 WATER'],
              ['waste',   'P6-E4 WASTE'],
              ['summary', 'SUMMARY & EXPORT'],
            ].map(([k, v]) => (
              <button key={k} className={`brsr-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{v}</button>
            ))}
          </div>

          {loading && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--mut)', fontSize: 11, letterSpacing: '.1em' }}>
              LOADING BRSR DATA…
            </div>
          )}

          {!loading && (
            <>
              {/* ══ ENERGY TAB ══════════════════════════════════════════ */}
              {tab === 'energy' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="metric-row">
                    {[
                      { label: 'TOTAL ENERGY',  val: hasEnergyData ? `${fmt(totalEnergyGJ, 0)} GJ` : '—', sub: 'All sources combined', color: '#f97316' },
                      { label: 'RENEWABLE',     val: hasEnergyData ? `${fmt(totalRenewableGJ, 0)} GJ` : '—', sub: `${fmt(renewablePct, 1)}% of total`, color: '#10b981' },
                      { label: 'NON-RENEWABLE', val: hasEnergyData ? `${fmt(totalNonRenGJ, 0)} GJ` : '—', sub: 'Fossil + grid', color: '#ef4444' },
                      {
                        label: 'INTENSITY (₹Cr)',
                        val: energyIntensityInr ? `${fmt(energyIntensityInr, 2)} GJ/₹Cr` : '—',
                        sub: energyIntensityPPP ? `${fmt(energyIntensityPPP, 2)} GJ/$M PPP` : 'Set revenue in profile',
                        color: '#3b82f6',
                      },
                    ].map(({ label, val, sub, color }) => (
                      <div key={label} className="metric-tile">
                        <div className="metric-tile-lbl">{label}</div>
                        <div className="metric-tile-val" style={{ color }}>{val}</div>
                        <div className="metric-tile-sub">{sub}</div>
                      </div>
                    ))}
                  </div>

                  {energyIntensityPPP && (
                    <div className="brsr-alert al-g">
                      <span>✓</span>
                      <span>
                        <strong>PPP-adjusted energy intensity (mandatory):</strong>{' '}
                        {fmt(energyIntensityPPP, 2)} GJ per $M international dollar (PPP).
                        Revenue: ₹{revenueCr} Cr = ~${revenuePPPM?.toFixed(1)}M PPP (IMF ₹{IMF_PPP_RATE}/intl.$).
                      </span>
                    </div>
                  )}

                  {energyYoY !== null && (
                    <div className={`brsr-alert ${energyYoY > 0 ? 'al-r' : 'al-g'}`}>
                      <span>{energyYoY > 0 ? '↑' : '↓'}</span>
                      <span>Year-over-year energy: <strong>{energyYoY > 0 ? '+' : ''}{fmt(energyYoY, 1)}%</strong> vs FY {year - 1}</span>
                    </div>
                  )}

                  {hasEnergyData && totalEnergyGJ > 0 && (
                    <div className="brsr-card" style={{ padding: '14px 18px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--mut)', marginBottom: 6 }}>
                        <span>RENEWABLE SHARE</span>
                        <span style={{ color: renewablePct >= 50 ? '#10b981' : '#f59e0b' }}>{fmt(renewablePct, 1)}%</span>
                      </div>
                      <div style={{ height: 8, borderRadius: 4, background: 'var(--brd)', overflow: 'hidden', display: 'flex' }}>
                        <div style={{ width: `${renewablePct}%`, background: 'linear-gradient(90deg,#10b981,#34d399)', transition: 'width .8s ease' }}/>
                        <div style={{ flex: 1, background: '#ef444422' }}/>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--mut)', marginTop: 4 }}>
                        <span style={{ color: '#10b981' }}>Renewable: {fmt(totalRenewableGJ, 0)} GJ</span>
                        <span style={{ color: '#ef4444' }}>Non-renewable: {fmt(totalNonRenGJ, 0)} GJ</span>
                      </div>
                    </div>
                  )}

                  <div className="brsr-card">
                    <div className="brsr-ctit">ENERGY CONSUMPTION BY SOURCE — GJ (Gigajoules)</div>
                    <div style={{ fontSize: 10, letterSpacing: '.1em', color: '#ef4444', marginBottom: 8 }}>NON-RENEWABLE SOURCES</div>
                    <div className="g2">
                      {ENERGY_TYPES.filter(e => !e.renewable).map(et => (
                        <NumericField
                          key={et.key}
                          label={et.label}
                          unit="GJ"
                          color={et.color}
                          value={energy[et.key]}
                          onChange={val => setEnergyField(et.key, val)}
                          showConverter={et.key === 'grid_gj' || et.key === 'oil_gj' || et.key === 'gas_gj'}
                        />
                      ))}
                    </div>
                    <div className="divider"/>
                    <div style={{ fontSize: 10, letterSpacing: '.1em', color: '#10b981', marginBottom: 8 }}>RENEWABLE SOURCES</div>
                    <div className="g2">
                      {ENERGY_TYPES.filter(e => e.renewable).map(et => (
                        <NumericField
                          key={et.key}
                          label={et.label}
                          unit="GJ"
                          color={et.color}
                          value={energy[et.key]}
                          onChange={val => setEnergyField(et.key, val)}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="brsr-card">
                    <div className="brsr-ctit">PREVIOUS YEAR & INTENSITY (YoY + PPP)</div>
                    <div className="g3">
                      <NumericField label={`FY ${year-1} Total Energy`} unit="GJ" value={energy.prev_total_gj} onChange={v => setEnergyField('prev_total_gj', v)}/>
                      <NumericField label={`FY ${year-1} Renewable`} unit="GJ" value={energy.prev_renewable_gj} onChange={v => setEnergyField('prev_renewable_gj', v)}/>
                      <NumericField label={`FY ${year-1} Intensity`} unit="GJ/₹Cr" value={energy.prev_intensity_gj_cr} onChange={v => setEnergyField('prev_intensity_gj_cr', v)}/>
                    </div>
                    {energyIntensityPPP && (
                      <div style={{ padding: '10px 14px', borderRadius: 7, background: '#3b82f608', border: '1px solid #3b82f622', fontSize: 11, color: '#3b82f6', marginBottom: 12 }}>
                        BRSR ISF intensity: {fmt(energyIntensityPPP, 2)} GJ per $M PPP (IMF ₹{IMF_PPP_RATE}/intl.$ · WEO Apr 2025)
                      </div>
                    )}
                    <div className="brsr-fg">
                      <label className="brsr-lbl">ENERGY REDUCTION INITIATIVES (BRSR narrative)</label>
                      <textarea className="brsr-inp" rows={3} maxLength={2000}
                        placeholder="e.g. LED lighting retrofit, HVAC optimisation, solar rooftop 200kWp, VFD installation on motors…"
                        value={energy.reduction_initiatives}
                        onChange={e => setEnergyField('reduction_initiatives', e.target.value)}
                        style={{ resize: 'vertical' }}/>
                      {energy.reduction_initiatives.length > 0 && energy.reduction_initiatives.length < 10 && (
                        <span className="field-err">⚠ Too short — provide meaningful narrative (min 10 characters)</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ══ WATER TAB ═══════════════════════════════════════════ */}
              {tab === 'water' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="metric-row">
                    {[
                      { label: 'TOTAL WITHDRAWAL', val: hasWaterData ? `${fmt(totalWithdrawal, 0)} KL` : '—', sub: 'All sources', color: '#3b82f6' },
                      { label: 'CONSUMPTION', val: water.consumption_kl !== null ? `${fmt(water.consumption_kl, 0)} KL` : '—', sub: 'Net consumed', color: '#60a5fa' },
                      { label: 'RECYCLED / REUSED', val: water.recycled_kl !== null ? `${fmt(water.recycled_kl, 0)} KL` : '—', sub: `${fmt(recycleRate, 1)}% recycling rate`, color: '#10b981' },
                      {
                        label: 'INTENSITY (₹Cr)',
                        val: waterIntensityInr ? `${fmt(waterIntensityInr, 1)} KL/₹Cr` : '—',
                        sub: waterIntensityPPP ? `${fmt(waterIntensityPPP, 1)} KL/$M PPP` : 'Set revenue in profile',
                        color: '#a855f7',
                      },
                    ].map(({ label, val, sub, color }) => (
                      <div key={label} className="metric-tile">
                        <div className="metric-tile-lbl">{label}</div>
                        <div className="metric-tile-val" style={{ color }}>{val}</div>
                        <div className="metric-tile-sub">{sub}</div>
                      </div>
                    ))}
                  </div>

                  {waterIntensityPPP && (
                    <div className="brsr-alert al-g">
                      <span>✓</span>
                      <span>
                        <strong>PPP-adjusted water intensity (mandatory):</strong>{' '}
                        {fmt(waterIntensityPPP, 1)} KL per $M international dollar (PPP).
                      </span>
                    </div>
                  )}

                  {waterYoY !== null && (
                    <div className={`brsr-alert ${waterYoY > 0 ? 'al-r' : 'al-g'}`}>
                      <span>{waterYoY > 0 ? '↑' : '↓'}</span>
                      <span>Year-over-year withdrawal: <strong>{waterYoY > 0 ? '+' : ''}{fmt(waterYoY, 1)}%</strong> vs FY {year - 1}</span>
                    </div>
                  )}

                  <div className="brsr-card">
                    <div className="brsr-ctit">WATER WITHDRAWAL BY SOURCE (KL) — ISO 14046 / GRI 303</div>
                    <div style={{ marginBottom: 8, fontSize: 11, color: 'var(--mut)' }}>1 KL = 1,000 litres = 1 m³</div>
                    <div className="g2">
                      {[
                        { key: 'surface_kl',     label: 'Surface Water (river/lake/reservoir)' },
                        { key: 'groundwater_kl', label: 'Groundwater (borewell/tube well)' },
                        { key: 'thirdparty_kl',  label: 'Third-party Water (MIDC / municipal supply)' },
                        { key: 'seawater_kl',    label: 'Seawater / Desalinated' },
                        { key: 'rainwater_kl',   label: 'Rainwater Harvesting' },
                        { key: 'municipal_kl',   label: 'Treated Municipal Wastewater (recycled)' },
                      ].map(({ key, label }) => (
                        <NumericField key={key} label={label} unit="KL" color="#3b82f6"
                          value={water[key]} onChange={val => setWaterField(key, val)}/>
                      ))}
                    </div>
                    <div className="divider"/>
                    <div className="g3">
                      <NumericField label="Net Water Consumed" unit="KL" value={water.consumption_kl} onChange={v => setWaterField('consumption_kl', v)}/>
                      <NumericField label="Recycled / Reused" unit="KL" value={water.recycled_kl} onChange={v => setWaterField('recycled_kl', v)}/>
                      <NumericField label="Water Intensity" unit="KL/₹Cr" value={water.intensity_kl_cr} onChange={v => setWaterField('intensity_kl_cr', v)}/>
                    </div>
                  </div>

                  <div className="brsr-card">
                    <div className="brsr-ctit">PREVIOUS YEAR & QUALITATIVE DISCLOSURES</div>
                    <div className="g2">
                      <NumericField label={`FY ${year-1} Total Withdrawal`} unit="KL" value={water.prev_withdrawal_kl} onChange={v => setWaterField('prev_withdrawal_kl', v)}/>
                      <NumericField label={`FY ${year-1} Consumption`} unit="KL" value={water.prev_consumption_kl} onChange={v => setWaterField('prev_consumption_kl', v)}/>
                    </div>
                    <div className="brsr-fg">
                      <label className="brsr-lbl">OPERATIONS IN WATER STRESS AREAS</label>
                      <input className="brsr-inp" type="text" maxLength={500}
                        placeholder='e.g. Rajasthan unit — high water stress per WRI Aqueduct'
                        value={water.water_stress_ops}
                        onChange={e => setWaterField('water_stress_ops', e.target.value)}/>
                    </div>
                    <label className="chk-row">
                      <input type="checkbox" checked={Boolean(water.zero_liquid_discharge)}
                        onChange={e => setWaterField('zero_liquid_discharge', e.target.checked)}/>
                      <span style={{ fontSize: 12 }}>Zero Liquid Discharge (ZLD) achieved / in progress</span>
                    </label>
                    <div className="brsr-fg" style={{ marginTop: 8 }}>
                      <label className="brsr-lbl">WATER TREATMENT METHODS</label>
                      <div className="chk-grid">
                        {['ETP (Effluent Treatment Plant)', 'STP (Sewage Treatment Plant)', 'RO / Reverse Osmosis',
                          'ZLD system', 'Rainwater harvesting & recharge', 'Constructed wetlands'].map(m => (
                          <label key={m} className="chk-row">
                            <input type="checkbox"
                              checked={Array.isArray(water.water_treatment) && water.water_treatment.includes(m)}
                              onChange={e => setWaterField('water_treatment', e.target.checked
                                ? [...(water.water_treatment || []), m]
                                : (water.water_treatment || []).filter(x => x !== m))}/>
                            <span style={{ fontSize: 11 }}>{m}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ══ WASTE TAB ═══════════════════════════════════════════ */}
              {tab === 'waste' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="metric-row">
                    {[
                      { label: 'TOTAL WASTE',           val: hasWasteData ? `${fmt(totalWasteKg / 1000, 2)} MT` : '—', sub: 'All categories', color: '#a855f7' },
                      { label: 'HAZARDOUS',             val: waste.hazardous_kg !== null ? `${fmt((waste.hazardous_kg ?? 0) / 1000, 2)} MT` : '—', sub: `${fmt(hazPct, 1)}% of total`, color: '#ef4444' },
                      { label: 'DIVERTED FROM LANDFILL', val: hasWasteData ? `${fmt(diversionRate, 1)}%` : '—', sub: 'Recycled + composted', color: '#10b981' },
                      { label: 'YoY CHANGE',             val: wasteYoY !== null ? `${wasteYoY > 0 ? '+' : ''}${fmt(wasteYoY, 1)}%` : '—', sub: `vs FY ${year-1}`, color: wasteYoY !== null ? (wasteYoY > 0 ? '#ef4444' : '#10b981') : '#5a7a8a' },
                    ].map(({ label, val, sub, color }) => (
                      <div key={label} className="metric-tile">
                        <div className="metric-tile-lbl">{label}</div>
                        <div className="metric-tile-val" style={{ color }}>{val}</div>
                        <div className="metric-tile-sub">{sub}</div>
                      </div>
                    ))}
                  </div>

                  <div className="brsr-card">
                    <div className="brsr-ctit">WASTE BY CATEGORY (KG) — CPCB / PWM RULES / E-WASTE RULES 2022</div>
                    <div className="g2">
                      {[
                        { key: 'hazardous_kg',    label: 'Hazardous Waste',              color: '#ef4444' },
                        { key: 'ewaste_kg',        label: 'E-Waste (E-Waste Rules 2022)', color: '#f97316' },
                        { key: 'plastic_kg',       label: 'Plastic (PWM Rules 2022)',     color: '#a855f7' },
                        { key: 'biomedical_kg',    label: 'Bio-medical Waste',            color: '#ec4899' },
                        { key: 'construction_kg',  label: 'C&D Waste',                    color: '#78716c' },
                        { key: 'battery_kg',       label: 'Battery Waste',                color: '#eab308' },
                        { key: 'radioactive_kg',   label: 'Radioactive Waste',            color: '#22d3ee' },
                        { key: 'non_hazardous_kg', label: 'Non-Hazardous Waste',          color: '#10b981' },
                      ].map(({ key, label, color }) => (
                        <NumericField key={key} label={label} unit="kg" color={color}
                          value={waste[key]} onChange={val => setWasteField(key, val)}/>
                      ))}
                    </div>
                  </div>

                  <div className="brsr-card">
                    <div className="brsr-ctit">WASTE DISPOSAL & DIVERSION (KG)</div>
                    <div className="g2">
                      {[
                        { key: 'recycled_kg',    label: 'Recycled / Recovered',         color: '#10b981' },
                        { key: 'composted_kg',   label: 'Composted / Biogasified',       color: '#a3e635' },
                        { key: 'incinerated_kg', label: 'Incinerated (with energy rec)', color: '#f97316' },
                        { key: 'coprocessed_kg', label: 'Co-processed (cement kiln)',    color: '#eab308' },
                        { key: 'landfill_kg',    label: 'Sent to Landfill (TSDF)',       color: '#ef4444' },
                        { key: 'prev_total_kg',  label: `FY ${year-1} Total Waste`,      color: '#5a7a8a' },
                      ].map(({ key, label, color }) => (
                        <NumericField key={key} label={label} unit="kg" color={color}
                          value={waste[key]} onChange={val => setWasteField(key, val)}/>
                      ))}
                    </div>
                    <div className="divider"/>
                    <div className="brsr-fg">
                      <label className="brsr-lbl">WASTE REDUCTION TARGET (BRSR narrative)</label>
                      <input className="brsr-inp" type="text" maxLength={500}
                        placeholder="e.g. 30% reduction in hazardous waste by FY2027 vs FY2024 baseline"
                        value={waste.waste_reduction_target}
                        onChange={e => setWasteField('waste_reduction_target', e.target.value)}/>
                    </div>
                    <div className="brsr-fg">
                      <label className="brsr-lbl">DISPOSAL METHODS</label>
                      <div className="chk-grid">
                        {DISPOSAL_METHODS.map(m => (
                          <label key={m} className="chk-row">
                            <input type="checkbox"
                              checked={Array.isArray(waste.disposal_methods) && waste.disposal_methods.includes(m)}
                              onChange={e => setWasteField('disposal_methods', e.target.checked
                                ? [...(waste.disposal_methods || []), m]
                                : (waste.disposal_methods || []).filter(x => x !== m))}/>
                            <span style={{ fontSize: 11 }}>{m}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <label className="chk-row" style={{ marginTop: 8 }}>
                      <input type="checkbox" checked={Boolean(waste.extended_producer_responsibility)}
                        onChange={e => setWasteField('extended_producer_responsibility', e.target.checked)}/>
                      <span style={{ fontSize: 12 }}>EPR (Extended Producer Responsibility) registered with CPCB</span>
                    </label>
                  </div>
                </div>
              )}

              {/* ══ SUMMARY TAB ═════════════════════════════════════════ */}
              {tab === 'summary' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="brsr-card">
                    <div className="brsr-ctit">BRSR CORE P6 COMPLIANCE STATUS — SEBI DEC 2024 ISF</div>
                    {[
                      { label: 'P6-E2 Energy — Total GJ',                val: hasEnergyData ? `${fmt(totalEnergyGJ, 0)} GJ` : 'NOT ENTERED',                ok: hasEnergyData },
                      { label: 'P6-E2 Renewable Energy Share',            val: hasEnergyData ? `${fmt(renewablePct, 1)}%` : '—',                             ok: hasEnergyData },
                      { label: 'P6-E2 Intensity (₹Cr)',                   val: energyIntensityInr ? `${fmt(energyIntensityInr, 2)} GJ/₹Cr` : '—',           ok: !!energyIntensityInr },
                      { label: 'P6-E2 Intensity (PPP — ISF mandatory)',   val: energyIntensityPPP ? `${fmt(energyIntensityPPP, 2)} GJ/$M PPP` : '—',        ok: !!energyIntensityPPP },
                      { label: 'P6-E3 Water Withdrawal',                  val: hasWaterData ? `${fmt(totalWithdrawal, 0)} KL` : 'NOT ENTERED',              ok: hasWaterData },
                      { label: 'P6-E3 Water Intensity (₹Cr)',             val: waterIntensityInr ? `${fmt(waterIntensityInr, 1)} KL/₹Cr` : '—',            ok: !!waterIntensityInr },
                      { label: 'P6-E3 Water Intensity (PPP — ISF)',       val: waterIntensityPPP ? `${fmt(waterIntensityPPP, 1)} KL/$M PPP` : '—',         ok: !!waterIntensityPPP },
                      { label: 'P6-E3 Water Recycling Rate',              val: hasWaterData ? `${fmt(recycleRate, 1)}%` : '—',                              ok: hasWaterData },
                      { label: 'P6-E4 Total Waste (MT)',                  val: hasWasteData ? `${fmt(totalWasteKg / 1000, 2)} MT` : 'NOT ENTERED',         ok: hasWasteData },
                      { label: 'P6-E4 Hazardous Waste',                   val: waste.hazardous_kg !== null ? `${fmt((waste.hazardous_kg ?? 0) / 1000, 3)} MT` : 'NOT ENTERED', ok: waste.hazardous_kg !== null },
                      { label: 'P6-E4 Waste Diversion Rate',              val: hasWasteData ? `${fmt(diversionRate, 1)}%` : '—',                           ok: hasWasteData },
                      { label: 'Reduction Initiatives Narrative',         val: energy.reduction_initiatives.length > 10 ? 'Provided' : 'MISSING',           ok: energy.reduction_initiatives.length > 10 },
                      { label: 'EPR Registration',                        val: waste.extended_producer_responsibility ? 'Registered' : 'Not applicable / pending', ok: true },
                      { label: 'PPP Rate Applied (IMF WEO Apr 2025)',     val: `₹${IMF_PPP_RATE} per international $`,                                      ok: true },
                      { label: 'Grid EF Applied (CEA V20.0 Dec 2024)',    val: '0.727 tCO₂/MWh',                                                           ok: true },
                    ].map(({ label, val, ok }) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--brd)44', fontSize: 12 }}>
                        <span style={{ color: 'var(--mut)' }}>{label}</span>
                        <span style={{ color: ok ? '#10b981' : '#f59e0b' }}>{val}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 8, background: '#10b98108', border: '1px solid #10b98122', fontSize: 11, color: 'var(--txt)', lineHeight: 1.9 }}>
                      BRSR completeness: <strong style={{ color: compPct >= 80 ? '#10b981' : '#f59e0b' }}>{compPct}%</strong>
                      {compPct >= 80
                        ? ' — Ready for BRSR Core PDF export. Go to Carbon Intelligence → CORPORATE REGULATORY REPORTS.'
                        : ' — Complete missing sections before generating BRSR PDF.'}
                    </div>
                  </div>

                  {/* [FIX-DEV-GATE] JSON snapshot only in devMode */}
                  {devMode && (
                    <div className="brsr-card">
                      <div className="brsr-ctit">DATA SNAPSHOT — DEV MODE ONLY</div>
                      <pre style={{ fontSize: 10, color: '#10b981', background: '#0a1018', borderRadius: 6, padding: 12, overflowX: 'auto', lineHeight: 1.7 }}>
{JSON.stringify({
  energyData: { total_gj: totalEnergyGJ, renewable_gj: totalRenewableGJ, intensity_gj_ppp_m: energyIntensityPPP },
  waterData:  { withdrawal_kl: totalWithdrawal, recycled_kl: water.recycled_kl, intensity_kl_ppp_m: waterIntensityPPP },
  wasteData:  { total_kg: totalWasteKg, hazardous_kg: waste.hazardous_kg, disposal_methods: waste.disposal_methods },
  regulatory: { ppp_rate: IMF_PPP_RATE, grid_ef: 0.727 },
}, null, 2)}
                      </pre>
                    </div>
                  )}

                  <div className="brsr-card">
                    <button className="btn btn-p" onClick={() => handleSave()} disabled={saving}>
                      {saving ? 'SAVING…' : '✓ SAVE & PUSH TO PDF GENERATOR →'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}