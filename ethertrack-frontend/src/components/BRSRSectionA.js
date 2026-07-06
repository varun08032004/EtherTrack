// src/components/BRSRSectionA.jsx
// SEBI BRSR Core — Section A: General Disclosures
//
// PRE-FILL STRATEGY (v2):
// On first load with no saved data, pre-fills entity.cin, entity.companyName,
// and structure.turnoverRs from the `profile` prop (/api/emissions/profile).
// This means users who already filled TeamManagement don't re-enter identity data.
// BRSR-specific extras (website, contact, assurance, activities, workforce) are
// captured here and saved to /api/brsr/section-a — a separate endpoint.
// The BRSR PDF renderer pulls from BOTH endpoints.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../services/api';

const currentYear = new Date().getFullYear();
const REPORT_YEARS = Array.from({ length: 5 }, (_, i) => currentYear - 3 + i);

const fmt = (n, d = 2) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
const sanitise = (str = '', max = 1000) =>
  String(str).replace(/<[^>]*>/g, '').replace(/['"`;]/g, '').trim().slice(0, max);
const safeNum = (val, min = 0, max = 1e12) => {
  if (val === null || val === undefined || val === '') return null;
  const n = parseFloat(val);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
};
const safeNumForPayload = (val, min = 0, max = 1e12) => safeNum(val, min, max);
const uid = () => Math.random().toString(36).slice(2, 10);

const ASSURANCE_TYPES = ['None', 'Limited Assurance', 'Reasonable Assurance'];
const ENTITY_TYPES = ['Holding Company', 'Subsidiary', 'Associate', 'Joint Venture'];
const STAKEHOLDER_GROUPS = ['Communities', 'Investors / Shareholders', 'Employees & Workers', 'Customers', 'Value Chain Partners', 'Government / Regulatory Bodies'];

const defEntity = () => ({
  cin: '', companyName: '', yearIncorporation: null,
  regOfficeAddress: '', corpOfficeAddress: '', sameAsRegOffice: false,
  email: '', telephone: '', website: '', paidUpCapital: null,
  listedNSE: false, listedBSE: false,
  contactName: '', contactDesignation: '', contactTelephone: '', contactEmail: '',
  reportingBoundary: 'standalone',
  assuranceProvider: '', assuranceType: 'None',
});

const defBusiness = () => ({
  activities: [], products: [],
  nationalPlants: null, nationalOffices: null,
  internationalPlants: null, internationalOffices: null,
  nationalLocations: null, internationalLocations: null,
  exportsPct: null, customerTypes: '',
});

const defWorkforce = () => ({
  empPermMale: null, empPermFemale: null, empPermOther: null,
  empOtherMale: null, empOtherFemale: null, empOtherOther: null,
  workerPermMale: null, workerPermFemale: null, workerPermOther: null,
  workerOtherMale: null, workerOtherFemale: null, workerOtherOther: null,
  diffAbledEmp: null, diffAbledWorker: null,
  womenBoardPct: null, womenKmpPct: null,
  turnoverEmpPerm: null, turnoverWorkerPerm: null,
});

const defStructure = () => ({
  entities: [],
  csrApplicable: null,
  turnoverRs: null, netWorthRs: null,
  csrSpentRs: null, csrUnspentRs: null,
});

const defGrievance = () => ({
  hasGrievanceMechanism: null,
  rows: [],
});

// ─────────────────────────────────────────────────────────────────────────────
// Build a pre-filled entity from the emissions profile
// Only fills fields that directly map — user still completes the rest
// ─────────────────────────────────────────────────────────────────────────────
const prefillFromProfile = (profile) => {
  const entity = defEntity();
  if (!profile) return entity;
  entity.companyName = sanitise(profile.company_name || '');
  entity.cin         = sanitise(profile.company_cin  || '');
  // email / telephone not in emissions profile — leave blank
  return entity;
};

const prefillStructureFromProfile = (profile) => {
  const structure = defStructure();
  if (!profile) return structure;
  if (profile.revenue_cr) structure.turnoverRs = parseFloat(profile.revenue_cr);
  return structure;
};

// ─────────────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;700;800&display=swap');
:root{
  --bg:#050709;--surf:#0b0f14;--surf2:#0f1419;--surf3:#131920;
  --brd:#1c2836;--brd2:#243348;
  --txt:#eef4ff;--txt2:#c8d8ea;--mut:#5a7a96;
  --grn:#10b981;--grn2:#059669;--red:#ef4444;--ylw:#f59e0b;
  --s2:#3b82f6;--pur:#a855f7;--org:#f97316;
}
.brsr{min-height:100vh;background:var(--bg);font-family:'Space Mono',monospace;color:var(--txt);}
.brsr-in{max-width:1200px;margin:0 auto;padding:24px 24px 40px;}
.brsr-hd{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--brd);}
.brsr-label{font-size:9px;letter-spacing:.18em;color:var(--mut);margin-bottom:4px;text-transform:uppercase;}
.brsr-title{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;letter-spacing:-.01em;}
.brsr-title span{color:var(--grn);}
.brsr-sub{font-size:10px;color:var(--mut);letter-spacing:.04em;margin-top:3px;line-height:1.6;}
.brsr-yr{display:flex;gap:8px;align-items:center;}
.brsr-sel{padding:7px 12px;border-radius:6px;background:var(--surf2);border:1px solid var(--brd2);color:var(--txt);font-family:'Space Mono',monospace;font-size:11px;outline:none;transition:border-color .2s;}
.brsr-sel:focus{border-color:#10b98150;}
.brsr-prog{display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr;gap:8px;margin-bottom:18px;}
.brsr-prog-item{padding:10px 14px;border-radius:8px;border:1px solid var(--brd);background:var(--surf2);cursor:pointer;transition:all .2s;}
.brsr-prog-item:hover{border-color:var(--brd2);}
.brsr-prog-item.active{border-color:var(--grn);background:#10b98110;}
.brsr-prog-item.done{border-color:#10b98133;background:#10b98108;}
.brsr-prog-label{font-size:9px;letter-spacing:.1em;color:var(--mut);margin-bottom:4px;text-transform:uppercase;}
.brsr-prog-status{font-size:10px;margin-top:2px;}
.brsr-card{background:var(--surf);border:1px solid var(--brd);border-radius:10px;padding:22px;margin-bottom:14px;animation:fadeUp .4s ease both;}
.brsr-ctit{font-size:9px;letter-spacing:.16em;color:var(--mut);margin-bottom:16px;display:flex;align-items:center;gap:8px;text-transform:uppercase;}
.brsr-ctit::before{content:'';width:12px;height:1px;background:var(--grn);}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}
.g4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;}
.brsr-fg{display:flex;flex-direction:column;gap:5px;margin-bottom:12px;}
.brsr-lbl{font-size:9px;letter-spacing:.1em;color:var(--mut);text-transform:uppercase;}
.brsr-inp{padding:9px 12px;border-radius:6px;background:var(--surf3);border:1px solid var(--brd);color:var(--txt);font-family:'Space Mono',monospace;font-size:12px;outline:none;transition:border-color .2s,box-shadow .2s;width:100%;box-sizing:border-box;}
.brsr-inp:focus{border-color:#10b98150;box-shadow:0 0 0 3px #10b98108;}
.brsr-inp::placeholder{color:var(--mut);opacity:.6;}
.brsr-inp.err{border-color:#ef444466;}
.brsr-inp.prefilled{border-color:#3b82f633;background:#3b82f608;}
.brsr-inp.confirmed-zero{border-color:#10b98133;background:#10b98108;}
.field-err{font-size:10px;color:var(--red);margin-top:2px;}
.field-hint{font-size:10px;color:var(--mut);margin-top:2px;}
.zero-confirm{display:flex;align-items:center;gap:5px;margin-top:4px;font-size:10px;color:var(--mut);cursor:pointer;}
.zero-confirm input{accent-color:var(--grn);}
.btn{padding:9px 18px;border-radius:7px;border:none;cursor:pointer;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.1em;font-weight:700;transition:all .2s;}
.btn:disabled{opacity:.4;cursor:not-allowed;}
.btn-p{background:linear-gradient(135deg,var(--grn),var(--grn2));color:#fff;box-shadow:0 4px 16px #10b98120;}
.btn-p:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 20px #10b98130;}
.btn-g{background:var(--surf2);border:1px solid var(--brd2);color:var(--txt2);}
.btn-g:hover:not(:disabled){border-color:var(--grn);color:var(--grn);}
.btn-sm{padding:6px 13px;font-size:10px;}
.brsr-tabs{display:flex;gap:0;margin-bottom:18px;border-bottom:1px solid var(--brd);}
.brsr-tab{padding:10px 16px;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.08em;cursor:pointer;border:none;background:none;color:var(--mut);border-bottom:2px solid transparent;transition:all .2s;margin-bottom:-1px;white-space:nowrap;}
.brsr-tab.on{color:var(--grn);border-bottom-color:var(--grn);}
.brsr-tab:hover{color:var(--txt);}
.chk-row{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:12px;cursor:pointer;}
.chk-row input{accent-color:var(--grn);width:14px;height:14px;}
.notif{position:fixed;top:76px;right:24px;z-index:9999;padding:11px 18px;border-radius:8px;font-family:'Space Mono',monospace;font-size:11px;box-shadow:0 8px 32px #00000066;animation:fadeUp .3s ease;}
.notif-ok{background:#0b2a1e;border:1px solid #10b98133;color:#10b981;}
.notif-err{background:#450a0a;border:1px solid #ef444433;color:#f87171;}
.notif-warn{background:#1a1200;border:1px solid #f59e0b33;color:#f59e0b;}
.divider{height:1px;background:var(--brd);margin:16px 0;}
.brsr-alert{padding:10px 14px;border-radius:7px;font-size:11px;display:flex;gap:8px;margin-bottom:14px;line-height:1.6;align-items:flex-start;}
.al-g{background:#10b98108;border:1px solid #10b98128;color:#34d399;}
.al-y{background:#f59e0b08;border:1px solid #f59e0b28;color:#fbbf24;}
.al-b{background:#3b82f608;border:1px solid #3b82f628;color:#60a5fa;}
.al-r{background:#ef444408;border:1px solid #ef444428;color:#f87171;}
.save-progress{height:2px;border-radius:2px;background:var(--brd);margin-bottom:14px;overflow:hidden;}
.save-progress-bar{height:100%;background:linear-gradient(90deg,var(--grn),#34d399);transition:width .4s ease;}
.radio-row{display:flex;gap:16px;margin-bottom:4px;}
.radio-opt{display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;}
.radio-opt input{accent-color:var(--grn);width:13px;height:13px;}
.brsr-table-wrap{margin-bottom:6px;}
.brsr-table-row{display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--brd)44;}
.brsr-table-head{font-size:9px;letter-spacing:.08em;color:var(--mut);border-bottom:1px solid var(--brd);padding-bottom:8px;text-transform:uppercase;}
.brsr-remove-row{background:none;border:none;color:#ef444466;cursor:pointer;font-size:13px;padding:4px;transition:color .15s;}
.brsr-remove-row:hover{color:#ef4444;}
.year-switch-modal{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:#00000099;backdrop-filter:blur(4px);}
.year-switch-box{background:var(--surf);border:1px solid var(--brd2);border-radius:12px;padding:28px;max-width:360px;width:90%;box-shadow:0 24px 80px #000000aa;}
.year-switch-title{font-family:'Syne',sans-serif;font-size:16px;font-weight:700;margin-bottom:8px;}
.year-switch-sub{font-size:11px;color:var(--mut);margin-bottom:20px;line-height:1.6;}
.year-switch-btns{display:flex;gap:8px;justify-content:flex-end;}
@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:900px){.g2,.g3,.g4,.brsr-prog{grid-template-columns:1fr 1fr;}}
@media(max-width:600px){.g2,.g3,.g4,.brsr-prog{grid-template-columns:1fr;}}
`;

// ─────────────────────────────────────────────────────────────────────────────
function NumericField({ label, value, onChange, unit = '', color, hint, maxVal = 1e12 }) {
  const [localVal, setLocalVal] = useState(value === null ? '' : String(value));
  const [confirmedZero, setConfirmedZero] = useState(value === 0);
  const [error, setError] = useState(null);

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
    if (!err) onChange(raw === '' ? null : parseFloat(raw));
  };

  const handleConfirmZero = (checked) => {
    setConfirmedZero(checked);
    if (checked) { setLocalVal('0'); setError(null); onChange(0); }
    else { setLocalVal(''); onChange(null); }
  };

  const isNotEntered = value === null && !confirmedZero;

  return (
    <div className="brsr-fg">
      <label className="brsr-lbl" style={color ? { color } : {}}>{label}{unit ? ` (${unit})` : ''}</label>
      <input
        className={`brsr-inp${error ? ' err' : ''}${confirmedZero ? ' confirmed-zero' : ''}`}
        type="number" step="0.01" min="0" max={maxVal}
        placeholder={isNotEntered ? 'Not entered' : '0'}
        value={localVal} onChange={handleChange}
      />
      {error && <span className="field-err">⚠ {error}</span>}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {isNotEntered && (
        <label className="zero-confirm">
          <input type="checkbox" checked={confirmedZero} onChange={e => handleConfirmZero(e.target.checked)}/>
          <span>Confirm: this value is genuinely zero</span>
        </label>
      )}
    </div>
  );
}

function TextField({ label, value, onChange, placeholder = '', maxLength = 300, textarea = false, rows = 2, prefilled = false }) {
  const Tag = textarea ? 'textarea' : 'input';
  return (
    <div className="brsr-fg">
      <label className="brsr-lbl">{label}{prefilled && <span style={{marginLeft:6,fontSize:8,color:'#60a5fa',letterSpacing:'.06em'}}>AUTO-FILLED</span>}</label>
      <Tag
        className={`brsr-inp${prefilled ? ' prefilled' : ''}`}
        type={textarea ? undefined : 'text'} rows={textarea ? rows : undefined}
        maxLength={maxLength} placeholder={placeholder} value={value || ''}
        onChange={e => onChange(e.target.value)} style={textarea ? { resize: 'vertical' } : {}}
      />
    </div>
  );
}

function RadioGroup({ label, value, onChange, options }) {
  return (
    <div className="brsr-fg">
      <label className="brsr-lbl">{label}</label>
      <div className="radio-row">
        {options.map(({ val, lbl }) => (
          <label key={String(val)} className="radio-opt">
            <input type="radio" checked={value === val} onChange={() => onChange(val)}/>
            <span>{lbl}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function DynamicTable({ columns, rows, onChange, addLabel = '+ ADD ROW' }) {
  const addRow = () => {
    const blank = { id: uid() };
    columns.forEach(c => { blank[c.key] = c.type === 'number' ? null : ''; });
    onChange([...rows, blank]);
  };
  const removeRow = (id) => onChange(rows.filter(r => r.id !== id));
  const updateCell = (id, key, val) => onChange(rows.map(r => r.id === id ? { ...r, [key]: val } : r));

  return (
    <div className="brsr-table-wrap">
      <div className="brsr-table-row brsr-table-head">
        {columns.map(c => <span key={c.key} style={{ flex: c.width || 1, fontSize: 9 }}>{c.label}</span>)}
        <span style={{ width: 28 }}/>
      </div>
      {rows.length === 0 && (
        <div style={{ padding: '14px 0', textAlign: 'center', color: 'var(--mut)', fontSize: 11 }}>No rows yet</div>
      )}
      {rows.map(row => (
        <div key={row.id} className="brsr-table-row">
          {columns.map(c => (
            <span key={c.key} style={{ flex: c.width || 1 }}>
              {c.type === 'select' ? (
                <select className="brsr-sel" style={{ width: '100%' }} value={row[c.key] || ''}
                  onChange={e => updateCell(row.id, c.key, e.target.value)}>
                  <option value="">—</option>
                  {c.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : c.type === 'number' ? (
                <input className="brsr-inp" type="number" step="0.01" min="0"
                  value={row[c.key] === null || row[c.key] === undefined ? '' : row[c.key]}
                  onChange={e => updateCell(row.id, c.key, e.target.value === '' ? null : parseFloat(e.target.value))}/>
              ) : c.type === 'boolean' ? (
                <select className="brsr-sel" style={{ width: '100%' }}
                  value={row[c.key] === true ? 'yes' : row[c.key] === false ? 'no' : ''}
                  onChange={e => updateCell(row.id, c.key, e.target.value === 'yes')}>
                  <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
                </select>
              ) : (
                <input className="brsr-inp" type="text" maxLength={300} value={row[c.key] || ''}
                  onChange={e => updateCell(row.id, c.key, e.target.value)}/>
              )}
            </span>
          ))}
          <span style={{ width: 28, textAlign: 'center' }}>
            <button type="button" className="brsr-remove-row" onClick={() => removeRow(row.id)} aria-label="Remove">✕</button>
          </span>
        </div>
      ))}
      <button type="button" className="btn btn-g btn-sm" style={{ marginTop: 8 }} onClick={addRow}>{addLabel}</button>
    </div>
  );
}

function YearSwitchModal({ targetYear, onSaveAndSwitch, onDiscardAndSwitch, onCancel, saving }) {
  return (
    <div className="year-switch-modal">
      <div className="year-switch-box">
        <div className="year-switch-title">Unsaved Changes</div>
        <div className="year-switch-sub">You have unsaved changes for the current year. Save before switching to FY {targetYear}?</div>
        <div className="year-switch-btns">
          <button className="btn btn-g btn-sm" onClick={onCancel}>STAY</button>
          <button className="btn btn-g btn-sm" style={{ color: 'var(--red)' }} onClick={onDiscardAndSwitch}>DISCARD</button>
          <button className="btn btn-p btn-sm" onClick={onSaveAndSwitch} disabled={saving}>{saving ? 'SAVING…' : 'SAVE & SWITCH →'}</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function BRSRSectionA({ profile, year: propYear, onDataReady, devMode = false }) {
  const [year, setYear] = useState(propYear || new Date().getFullYear());
  const [tab, setTab] = useState('entity');
  const [notif, setNotif] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [yearSwitchModal, setYearSwitchModal] = useState(null);
  const [wasPreFilled, setWasPreFilled] = useState(false);

  const [entity, setEntity] = useState(defEntity());
  const [business, setBusiness] = useState(defBusiness());
  const [workforce, setWorkforce] = useState(defWorkforce());
  const [structure, setStructure] = useState(defStructure());
  const [grievance, setGrievance] = useState(defGrievance());

  const abortRef = useRef(null);
  const saveDebounce = useRef(null);
  const lastSaveTime = useRef(0);

  const toast = (msg, type = 'ok') => { setNotif({ msg, type }); setTimeout(() => setNotif(null), 3800); };

  // ── Load: try saved BRSR data first, fall back to profile pre-fill ─────────
  const loadData = useCallback(async (yr) => {
    if (abortRef.current) abortRef.current.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/brsr/section-a?year=${yr}`, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      if (res?.data && (res.data.entity || res.data.business)) {
        // Saved data exists — use it
        if (res.data.entity)    setEntity(e => ({ ...defEntity(),    ...res.data.entity }));
        if (res.data.business)  setBusiness(b => ({ ...defBusiness(), ...res.data.business }));
        if (res.data.workforce) setWorkforce(w => ({ ...defWorkforce(), ...res.data.workforce }));
        if (res.data.structure) setStructure(s => ({ ...defStructure(), ...res.data.structure }));
        if (res.data.grievance) setGrievance(g => ({ ...defGrievance(), ...res.data.grievance }));
        setWasPreFilled(false);
      } else {
        // No saved BRSR data — pre-fill identity fields from emissions profile
        setEntity(prefillFromProfile(profile));
        setStructure(prefillStructureFromProfile(profile));
        setBusiness(defBusiness());
        setWorkforce(defWorkforce());
        setGrievance(defGrievance());
        setWasPreFilled(!!(profile?.company_name || profile?.company_cin));
      }
      setDirty(false);
    } catch (e) {
      if (e.name !== 'AbortError') toast('Failed to load Section A data', 'err');
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, [profile]);

  useEffect(() => { loadData(year); return () => { abortRef.current?.abort(); }; }, [loadData, year]);

  const handleYearChange = (newYear) => { if (dirty) { setYearSwitchModal(newYear); return; } setYear(newYear); };
  const markDirty = () => setDirty(true);

  const setEntityField    = (key, val) => { setEntity(e    => ({ ...e, [key]: val })); markDirty(); };
  const setBusinessField  = (key, val) => { setBusiness(b  => ({ ...b, [key]: val })); markDirty(); };
  const setWorkforceField = (key, val) => { setWorkforce(w => ({ ...w, [key]: val })); markDirty(); };
  const setStructureField = (key, val) => { setStructure(s => ({ ...s, [key]: val })); markDirty(); };
  const setGrievanceField = (key, val) => { setGrievance(g => ({ ...g, [key]: val })); markDirty(); };

  const totalEmployees = ['empPermMale','empPermFemale','empPermOther','empOtherMale','empOtherFemale','empOtherOther']
    .reduce((s, k) => s + (workforce[k] ?? 0), 0);
  const totalWorkers = ['workerPermMale','workerPermFemale','workerPermOther','workerOtherMale','workerOtherFemale','workerOtherOther']
    .reduce((s, k) => s + (workforce[k] ?? 0), 0);
  const hasWorkforceData = Object.keys(defWorkforce()).some(k => workforce[k] !== null && typeof workforce[k] === 'number');

  const entityComplete    = !!(entity.cin && entity.companyName && entity.yearIncorporation && entity.regOfficeAddress && entity.email && entity.telephone);
  const businessComplete  = business.activities.length > 0 && business.products.length > 0 && (business.nationalPlants !== null || business.nationalOffices !== null);
  const workforceComplete = hasWorkforceData && workforce.womenBoardPct !== null;
  const structureComplete = structure.csrApplicable !== null;
  const grievanceComplete = grievance.hasGrievanceMechanism !== null;

  const sectionsDone = [entityComplete, businessComplete, workforceComplete, structureComplete, grievanceComplete].filter(Boolean).length;
  const compPct = Math.round(sectionsDone / 5 * 100);

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (saving) return;
    const now = Date.now();
    if (now - lastSaveTime.current < 500) return;
    lastSaveTime.current = now;
    if (saveDebounce.current) clearTimeout(saveDebounce.current);

    return new Promise((resolve) => {
      saveDebounce.current = setTimeout(async () => {
        setSaving(true); setSaveProgress(15);

        const cin = sanitise(entity.cin).toUpperCase();
        if (cin && !/^[A-Z]{1}[0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9A-Z]{6}$/.test(cin)) {
          toast('Invalid CIN format', 'err'); setSaving(false); setSaveProgress(0); resolve(false); return;
        }
        if (entity.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entity.email)) {
          toast('Invalid email format', 'err'); setSaving(false); setSaveProgress(0); resolve(false); return;
        }

        const entityPayload = {
          cin, companyName: sanitise(entity.companyName, 200),
          yearIncorporation: safeNumForPayload(entity.yearIncorporation, 1800, currentYear),
          regOfficeAddress: sanitise(entity.regOfficeAddress, 500),
          corpOfficeAddress: sanitise(entity.sameAsRegOffice ? entity.regOfficeAddress : entity.corpOfficeAddress, 500),
          email: sanitise(entity.email, 200), telephone: sanitise(entity.telephone, 30),
          website: sanitise(entity.website, 200), paidUpCapital: safeNumForPayload(entity.paidUpCapital, 0, 1e9),
          listedNSE: Boolean(entity.listedNSE), listedBSE: Boolean(entity.listedBSE),
          contactName: sanitise(entity.contactName, 100), contactDesignation: sanitise(entity.contactDesignation, 100),
          contactTelephone: sanitise(entity.contactTelephone, 30), contactEmail: sanitise(entity.contactEmail, 200),
          reportingBoundary: entity.reportingBoundary,
          assuranceProvider: sanitise(entity.assuranceProvider, 200), assuranceType: entity.assuranceType,
        };
        setSaveProgress(30);

        const businessPayload = {
          activities: business.activities.map(a => ({
            mainActivity: sanitise(a.mainActivity, 200), businessActivity: sanitise(a.businessActivity, 200),
            turnoverPct: safeNumForPayload(a.turnoverPct, 0, 100),
          })),
          products: business.products.map(p => ({
            productDescription: sanitise(p.productDescription, 200), nicCode: sanitise(p.nicCode, 20),
            turnoverPct: safeNumForPayload(p.turnoverPct, 0, 100),
          })),
          nationalPlants: safeNumForPayload(business.nationalPlants, 0, 1e5),
          nationalOffices: safeNumForPayload(business.nationalOffices, 0, 1e5),
          internationalPlants: safeNumForPayload(business.internationalPlants, 0, 1e5),
          internationalOffices: safeNumForPayload(business.internationalOffices, 0, 1e5),
          nationalLocations: safeNumForPayload(business.nationalLocations, 0, 1e5),
          internationalLocations: safeNumForPayload(business.internationalLocations, 0, 1e5),
          exportsPct: safeNumForPayload(business.exportsPct, 0, 100),
          customerTypes: sanitise(business.customerTypes, 500),
        };
        setSaveProgress(50);

        const workforcePayload = Object.fromEntries(
          Object.keys(defWorkforce()).map(k => [k, safeNumForPayload(workforce[k], 0, 1e7)])
        );
        workforcePayload.totalEmployees = totalEmployees;
        workforcePayload.totalWorkers = totalWorkers;
        setSaveProgress(65);

        const structurePayload = {
          entities: structure.entities.map(en => ({
            name: sanitise(en.name, 200), cinOrForeign: sanitise(en.cinOrForeign, 100),
            type: en.type, sharesPct: safeNumForPayload(en.sharesPct, 0, 100),
            participatesBR: Boolean(en.participatesBR),
          })),
          csrApplicable: structure.csrApplicable,
          turnoverRs: safeNumForPayload(structure.turnoverRs, 0, 1e14),
          netWorthRs: safeNumForPayload(structure.netWorthRs, 0, 1e14),
          csrSpentRs: safeNumForPayload(structure.csrSpentRs, 0, 1e12),
          csrUnspentRs: safeNumForPayload(structure.csrUnspentRs, 0, 1e12),
        };
        setSaveProgress(80);

        const grievancePayload = {
          hasGrievanceMechanism: grievance.hasGrievanceMechanism,
          rows: grievance.rows.map(r => ({
            stakeholderGroup: r.stakeholderGroup,
            filedFY: safeNumForPayload(r.filedFY, 0, 1e6),
            pendingFY: safeNumForPayload(r.pendingFY, 0, 1e6),
            remarks: sanitise(r.remarks, 300),
          })),
        };
        setSaveProgress(90);

        try {
          await apiFetch('/api/brsr/section-a', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ year, entity: entityPayload, business: businessPayload, workforce: workforcePayload, structure: structurePayload, grievance: grievancePayload }),
          });
          setSaveProgress(95);
          toast('✓ Section A saved');
          setDirty(false);
          setWasPreFilled(false);
          onDataReady?.({ entity: entityPayload, business: businessPayload, workforce: workforcePayload, structure: structurePayload, grievance: grievancePayload });
          setSaveProgress(100);
          setTimeout(() => setSaveProgress(0), 1200);
          resolve(true);
        } catch (err) {
          const fieldErrors = err?.body?.fieldErrors;
          if (fieldErrors) Object.entries(fieldErrors).forEach(([f, msg]) => toast(`${f}: ${msg}`, 'err'));
          else toast('Save failed. Please try again.', 'err');
          setSaveProgress(0);
          resolve(false);
        } finally { setSaving(false); }
      }, 500);
    });
  }, [saving, year, entity, business, workforce, structure, grievance, totalEmployees, totalWorkers, onDataReady]);

  const handleSaveAndSwitch = async () => {
    const ok = await handleSave();
    if (ok !== false) { setYear(yearSwitchModal); setYearSwitchModal(null); }
  };
  const handleDiscardAndSwitch = () => { setYear(yearSwitchModal); setYearSwitchModal(null); setDirty(false); };

  // ── Detect which fields were pre-filled from profile ──────────────────────
  const cinPreFilled  = wasPreFilled && !!entity.cin;
  const namePreFilled = wasPreFilled && !!entity.companyName;

  return (
    <>
      <style>{CSS}</style>

      {yearSwitchModal && (
        <YearSwitchModal targetYear={yearSwitchModal} onSaveAndSwitch={handleSaveAndSwitch}
          onDiscardAndSwitch={handleDiscardAndSwitch} onCancel={() => setYearSwitchModal(null)} saving={saving}/>
      )}
      {notif && <div className={`notif notif-${notif.type}`}>{notif.msg}</div>}

      <div className="brsr">
        <div className="brsr-in">
          {saveProgress > 0 && <div className="save-progress"><div className="save-progress-bar" style={{ width: `${saveProgress}%` }}/></div>}

          {/* Header */}
          <div className="brsr-hd">
            <div>
              <div className="brsr-label">SEBI BRSR CORE · SECTION A · GENERAL DISCLOSURES</div>
              <div className="brsr-title">Section A <span>General Disclosures</span></div>
              <div className="brsr-sub">
                Entity details · Business activities · Employees & workforce · Holding/subsidiary & CSR · Grievance compliance
                {profile?.company_name && ` · ${profile.company_name}`}
              </div>
            </div>
            <div className="brsr-yr">
              <label className="brsr-label">FY</label>
              <select className="brsr-sel" value={year} onChange={e => handleYearChange(parseInt(e.target.value, 10))}>
                {REPORT_YEARS.map(y => <option key={y}>{y}</option>)}
              </select>
              {dirty && <span style={{ fontSize: 10, color: '#f59e0b', marginLeft: 4 }}>UNSAVED</span>}
              <button className="btn btn-p btn-sm" onClick={() => handleSave()} disabled={saving}>{saving ? 'SAVING…' : 'SAVE ALL →'}</button>
            </div>
          </div>

          {/* Pre-fill notice */}
          {wasPreFilled && (
            <div className="brsr-alert al-b">
              <span style={{ flexShrink: 0 }}>ℹ</span>
              <span>
                <strong>Company name and CIN pre-filled from your organisation profile.</strong>{' '}
                Review below and add BRSR-specific details (contact person, registered address, 
                business activities, workforce). Save when ready.
                {' '}<button onClick={() => setWasPreFilled(false)} style={{ background:'none', border:'none', color:'#60a5fa', cursor:'pointer', fontSize:10, textDecoration:'underline', fontFamily:'Space Mono,monospace' }}>dismiss</button>
              </span>
            </div>
          )}

          {/* Completeness alert */}
          <div className={`brsr-alert ${compPct >= 75 ? 'al-g' : 'al-y'}`}>
            <span>📋</span>
            <span>Section A completeness: <strong style={{ color: compPct >= 75 ? '#10b981' : '#f59e0b' }}>{compPct}%</strong>
              {compPct < 100 && ' — complete all five sub-sections before this feeds the BRSR PDF.'}</span>
          </div>

          {/* Progress cards */}
          <div className="brsr-prog">
            {[
              { key: 'entity',    label: 'ENTITY DETAILS',        done: entityComplete,    color: '#f97316' },
              { key: 'business',  label: 'BUSINESS & OPS',        done: businessComplete,  color: '#3b82f6' },
              { key: 'workforce', label: 'EMPLOYEES',             done: workforceComplete, color: '#a855f7' },
              { key: 'structure', label: 'HOLDING & CSR',         done: structureComplete, color: '#10b981' },
              { key: 'grievance', label: 'GRIEVANCE',             done: grievanceComplete, color: '#ef4444' },
            ].map(({ key, label, done, color }) => (
              <div key={key} className={`brsr-prog-item${tab === key ? ' active' : ''}${done ? ' done' : ''}`} onClick={() => setTab(key)}>
                <div className="brsr-prog-label">{label}</div>
                <div className="brsr-prog-status" style={{ color: done ? '#10b981' : '#f59e0b' }}>{done ? '✓ COMPLETE' : '⚠ INCOMPLETE'}</div>
              </div>
            ))}
          </div>

          {/* Sub-tabs */}
          <div className="brsr-tabs">
            {[['entity','ENTITY DETAILS'],['business','BUSINESS & OPERATIONS'],['workforce','EMPLOYEES & WORKFORCE'],['structure','HOLDING & CSR'],['grievance','GRIEVANCE COMPLIANCE'],['summary','SUMMARY']].map(([k,v]) => (
              <button key={k} className={`brsr-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{v}</button>
            ))}
          </div>

          {loading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--mut)', fontSize: 11, letterSpacing: '.1em' }}>LOADING SECTION A DATA…</div>}

          {/* ── ENTITY TAB ── */}
          {!loading && tab === 'entity' && (
            <div className="brsr-card">
              <div className="brsr-ctit">CORPORATE IDENTITY</div>
              <div className="g2">
                <TextField label="CIN (Corporate Identity Number)" value={entity.cin}
                  onChange={v => setEntityField('cin', v.toUpperCase())}
                  placeholder="U72200KA2015PTC123456" prefilled={cinPreFilled}/>
                <TextField label="Company Name" value={entity.companyName}
                  onChange={v => setEntityField('companyName', v)} prefilled={namePreFilled}/>
              </div>
              <div className="g3">
                <NumericField label="Year of Incorporation" value={entity.yearIncorporation}
                  onChange={v => setEntityField('yearIncorporation', v)} maxVal={currentYear}/>
                <NumericField label="Paid-up Capital (₹ Lakh)" value={entity.paidUpCapital}
                  onChange={v => setEntityField('paidUpCapital', v)}/>
                <div className="brsr-fg">
                  <label className="brsr-lbl">Listed on Stock Exchange(s)</label>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <label className="chk-row"><input type="checkbox" checked={entity.listedNSE} onChange={e => setEntityField('listedNSE', e.target.checked)}/><span>NSE</span></label>
                    <label className="chk-row"><input type="checkbox" checked={entity.listedBSE} onChange={e => setEntityField('listedBSE', e.target.checked)}/><span>BSE</span></label>
                  </div>
                </div>
              </div>
              <div className="divider"/>
              <div className="brsr-ctit">ADDRESS & CONTACT</div>
              <TextField label="Registered Office Address" textarea rows={2} value={entity.regOfficeAddress}
                onChange={v => setEntityField('regOfficeAddress', v)} maxLength={500}/>
              <label className="chk-row" style={{ marginBottom: 8 }}>
                <input type="checkbox" checked={entity.sameAsRegOffice} onChange={e => setEntityField('sameAsRegOffice', e.target.checked)}/>
                <span>Corporate office same as registered office</span>
              </label>
              {!entity.sameAsRegOffice && (
                <TextField label="Corporate Office Address" textarea rows={2} value={entity.corpOfficeAddress}
                  onChange={v => setEntityField('corpOfficeAddress', v)} maxLength={500}/>
              )}
              <div className="g3">
                <TextField label="Email" value={entity.email} onChange={v => setEntityField('email', v)}/>
                <TextField label="Telephone" value={entity.telephone} onChange={v => setEntityField('telephone', v)}/>
                <TextField label="Website" value={entity.website} onChange={v => setEntityField('website', v)}/>
              </div>
              <div className="divider"/>
              <div className="brsr-ctit">PERSON RESPONSIBLE FOR BRSR DISCLOSURES</div>
              <div className="g2">
                <TextField label="Name" value={entity.contactName} onChange={v => setEntityField('contactName', v)}/>
                <TextField label="Designation" value={entity.contactDesignation} onChange={v => setEntityField('contactDesignation', v)}/>
                <TextField label="Telephone" value={entity.contactTelephone} onChange={v => setEntityField('contactTelephone', v)}/>
                <TextField label="Email" value={entity.contactEmail} onChange={v => setEntityField('contactEmail', v)}/>
              </div>
              <div className="divider"/>
              <div className="g2">
                <RadioGroup label="Reporting Boundary" value={entity.reportingBoundary} onChange={v => setEntityField('reportingBoundary', v)}
                  options={[{ val: 'standalone', lbl: 'Standalone' }, { val: 'consolidated', lbl: 'Consolidated' }]}/>
                <div className="brsr-fg">
                  <label className="brsr-lbl">Assurance Type</label>
                  <select className="brsr-sel" style={{ width: '100%' }} value={entity.assuranceType}
                    onChange={e => setEntityField('assuranceType', e.target.value)}>
                    {ASSURANCE_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              {entity.assuranceType !== 'None' && (
                <TextField label="Assurance Provider Name" value={entity.assuranceProvider}
                  onChange={v => setEntityField('assuranceProvider', v)}/>
              )}
            </div>
          )}

          {/* ── BUSINESS TAB ── */}
          {!loading && tab === 'business' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="brsr-card">
                <div className="brsr-ctit">BUSINESS ACTIVITIES (by % of turnover)</div>
                <DynamicTable
                  columns={[
                    { key: 'mainActivity', label: 'MAIN ACTIVITY', width: 2 },
                    { key: 'businessActivity', label: 'BUSINESS ACTIVITY', width: 2 },
                    { key: 'turnoverPct', label: '% TURNOVER', type: 'number', width: 1 },
                  ]}
                  rows={business.activities} onChange={rows => setBusinessField('activities', rows)} addLabel="+ ADD ACTIVITY"
                />
              </div>
              <div className="brsr-card">
                <div className="brsr-ctit">PRODUCTS / SERVICES (by % of total turnover)</div>
                <DynamicTable
                  columns={[
                    { key: 'productDescription', label: 'PRODUCT / SERVICE', width: 2 },
                    { key: 'nicCode', label: 'NIC CODE', width: 1 },
                    { key: 'turnoverPct', label: '% TURNOVER', type: 'number', width: 1 },
                  ]}
                  rows={business.products} onChange={rows => setBusinessField('products', rows)} addLabel="+ ADD PRODUCT"
                />
              </div>
              <div className="brsr-card">
                <div className="brsr-ctit">OPERATIONS FOOTPRINT</div>
                <div className="g4">
                  <NumericField label="National Plants" value={business.nationalPlants} onChange={v => setBusinessField('nationalPlants', v)}/>
                  <NumericField label="National Offices" value={business.nationalOffices} onChange={v => setBusinessField('nationalOffices', v)}/>
                  <NumericField label="International Plants" value={business.internationalPlants} onChange={v => setBusinessField('internationalPlants', v)}/>
                  <NumericField label="International Offices" value={business.internationalOffices} onChange={v => setBusinessField('internationalOffices', v)}/>
                </div>
              </div>
              <div className="brsr-card">
                <div className="brsr-ctit">MARKETS SERVED</div>
                <div className="g3">
                  <NumericField label="Locations — National" value={business.nationalLocations} onChange={v => setBusinessField('nationalLocations', v)}/>
                  <NumericField label="Locations — International" value={business.internationalLocations} onChange={v => setBusinessField('internationalLocations', v)}/>
                  <NumericField label="Exports as % of Turnover" unit="%" maxVal={100} value={business.exportsPct} onChange={v => setBusinessField('exportsPct', v)}/>
                </div>
                <TextField label="Types of Customers" value={business.customerTypes}
                  onChange={v => setBusinessField('customerTypes', v)}
                  placeholder="e.g. B2B manufacturers, B2C retail, government contracts" maxLength={500}/>
              </div>
            </div>
          )}

          {/* ── WORKFORCE TAB ── */}
          {!loading && tab === 'workforce' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="brsr-card">
                <div className="brsr-ctit">EMPLOYEES — TOTAL: {fmt(totalEmployees, 0)}</div>
                <div style={{ fontSize: 10, color: 'var(--grn)', marginBottom: 8 }}>PERMANENT</div>
                <div className="g3">
                  <NumericField label="Male" value={workforce.empPermMale} onChange={v => setWorkforceField('empPermMale', v)}/>
                  <NumericField label="Female" value={workforce.empPermFemale} onChange={v => setWorkforceField('empPermFemale', v)}/>
                  <NumericField label="Other" value={workforce.empPermOther} onChange={v => setWorkforceField('empPermOther', v)}/>
                </div>
                <div className="divider"/>
                <div style={{ fontSize: 10, color: '#f97316', marginBottom: 8 }}>OTHER THAN PERMANENT</div>
                <div className="g3">
                  <NumericField label="Male" value={workforce.empOtherMale} onChange={v => setWorkforceField('empOtherMale', v)}/>
                  <NumericField label="Female" value={workforce.empOtherFemale} onChange={v => setWorkforceField('empOtherFemale', v)}/>
                  <NumericField label="Other" value={workforce.empOtherOther} onChange={v => setWorkforceField('empOtherOther', v)}/>
                </div>
              </div>
              <div className="brsr-card">
                <div className="brsr-ctit">WORKERS — TOTAL: {fmt(totalWorkers, 0)}</div>
                <div style={{ fontSize: 10, color: 'var(--grn)', marginBottom: 8 }}>PERMANENT</div>
                <div className="g3">
                  <NumericField label="Male" value={workforce.workerPermMale} onChange={v => setWorkforceField('workerPermMale', v)}/>
                  <NumericField label="Female" value={workforce.workerPermFemale} onChange={v => setWorkforceField('workerPermFemale', v)}/>
                  <NumericField label="Other" value={workforce.workerPermOther} onChange={v => setWorkforceField('workerPermOther', v)}/>
                </div>
                <div className="divider"/>
                <div style={{ fontSize: 10, color: '#f97316', marginBottom: 8 }}>OTHER THAN PERMANENT</div>
                <div className="g3">
                  <NumericField label="Male" value={workforce.workerOtherMale} onChange={v => setWorkforceField('workerOtherMale', v)}/>
                  <NumericField label="Female" value={workforce.workerOtherFemale} onChange={v => setWorkforceField('workerOtherFemale', v)}/>
                  <NumericField label="Other" value={workforce.workerOtherOther} onChange={v => setWorkforceField('workerOtherOther', v)}/>
                </div>
              </div>
              <div className="brsr-card">
                <div className="brsr-ctit">DIFFERENTLY ABLED, REPRESENTATION & TURNOVER</div>
                <div className="g4">
                  <NumericField label="Differently Abled Employees" value={workforce.diffAbledEmp} onChange={v => setWorkforceField('diffAbledEmp', v)}/>
                  <NumericField label="Differently Abled Workers" value={workforce.diffAbledWorker} onChange={v => setWorkforceField('diffAbledWorker', v)}/>
                  <NumericField label="Women on Board (%)" maxVal={100} value={workforce.womenBoardPct} onChange={v => setWorkforceField('womenBoardPct', v)}/>
                  <NumericField label="Women in KMP (%)" maxVal={100} value={workforce.womenKmpPct} onChange={v => setWorkforceField('womenKmpPct', v)}/>
                </div>
                <div className="g2">
                  <NumericField label="Permanent Employee Turnover (%)" maxVal={100} value={workforce.turnoverEmpPerm} onChange={v => setWorkforceField('turnoverEmpPerm', v)}/>
                  <NumericField label="Permanent Worker Turnover (%)" maxVal={100} value={workforce.turnoverWorkerPerm} onChange={v => setWorkforceField('turnoverWorkerPerm', v)}/>
                </div>
              </div>
            </div>
          )}

          {/* ── STRUCTURE TAB ── */}
          {!loading && tab === 'structure' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="brsr-card">
                <div className="brsr-ctit">HOLDING / SUBSIDIARY / ASSOCIATE / JOINT VENTURE COMPANIES</div>
                <DynamicTable
                  columns={[
                    { key: 'name', label: 'NAME', width: 2 },
                    { key: 'cinOrForeign', label: 'CIN / FOREIGN CO.', width: 2 },
                    { key: 'type', label: 'TYPE', type: 'select', options: ENTITY_TYPES, width: 1.4 },
                    { key: 'sharesPct', label: '% SHARES', type: 'number', width: 1 },
                    { key: 'participatesBR', label: 'BR INITIATIVES', type: 'boolean', width: 1.4 },
                  ]}
                  rows={structure.entities} onChange={rows => setStructureField('entities', rows)} addLabel="+ ADD ENTITY"
                />
              </div>
              <div className="brsr-card">
                <div className="brsr-ctit">CSR APPLICABILITY (Section 135, Companies Act 2013)</div>
                <RadioGroup label="Is CSR applicable to the company?" value={structure.csrApplicable}
                  onChange={v => setStructureField('csrApplicable', v)}
                  options={[{ val: true, lbl: 'Yes' }, { val: false, lbl: 'No' }]}/>
                {structure.csrApplicable && (
                  <>
                    <div className="g2">
                      <NumericField label="Turnover (₹ Cr)" value={structure.turnoverRs} onChange={v => setStructureField('turnoverRs', v)}/>
                      <NumericField label="Net Worth (₹ Cr)" value={structure.netWorthRs} onChange={v => setStructureField('netWorthRs', v)}/>
                    </div>
                    <div className="g2">
                      <NumericField label="CSR Amount Spent (₹ Lakh)" value={structure.csrSpentRs} onChange={v => setStructureField('csrSpentRs', v)}/>
                      <NumericField label="CSR Amount Unspent (₹ Lakh)" value={structure.csrUnspentRs} onChange={v => setStructureField('csrUnspentRs', v)}/>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── GRIEVANCE TAB ── */}
          {!loading && tab === 'grievance' && (
            <div className="brsr-card">
              <div className="brsr-ctit">TRANSPARENCY & DISCLOSURE COMPLIANCE</div>
              <RadioGroup label="Does a grievance redressal mechanism exist for stakeholders?"
                value={grievance.hasGrievanceMechanism} onChange={v => setGrievanceField('hasGrievanceMechanism', v)}
                options={[{ val: true, lbl: 'Yes' }, { val: false, lbl: 'No' }]}/>
              <div className="divider"/>
              <div style={{ fontSize: 10, color: 'var(--mut)', marginBottom: 8 }}>COMPLAINTS / GRIEVANCES BY STAKEHOLDER GROUP — FY {year}</div>
              <DynamicTable
                columns={[
                  { key: 'stakeholderGroup', label: 'STAKEHOLDER GROUP', type: 'select', options: STAKEHOLDER_GROUPS, width: 2 },
                  { key: 'filedFY', label: 'FILED THIS FY', type: 'number', width: 1 },
                  { key: 'pendingFY', label: 'PENDING RESOLUTION', type: 'number', width: 1 },
                  { key: 'remarks', label: 'REMARKS', width: 2 },
                ]}
                rows={grievance.rows} onChange={rows => setGrievanceField('rows', rows)} addLabel="+ ADD STAKEHOLDER GROUP"
              />
            </div>
          )}

          {/* ── SUMMARY TAB ── */}
          {!loading && tab === 'summary' && (
            <div className="brsr-card">
              <div className="brsr-ctit">SECTION A COMPLETION STATUS</div>
              {[
                { label: 'Entity Details (CIN, address, contact)', ok: entityComplete },
                { label: 'Business Activities & Operations Footprint', ok: businessComplete },
                { label: 'Employees & Workforce Composition', ok: workforceComplete },
                { label: 'Holding/Subsidiary Structure & CSR Applicability', ok: structureComplete },
                { label: 'Grievance & Transparency Compliance', ok: grievanceComplete },
              ].map(({ label, ok }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--brd)44', fontSize: 11 }}>
                  <span style={{ color: 'var(--mut)' }}>{label}</span>
                  <span style={{ color: ok ? 'var(--grn)' : '#f59e0b' }}>{ok ? '✓ Complete' : '⚠ Incomplete'}</span>
                </div>
              ))}
              <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 8, background: '#10b98108', border: '1px solid #10b98122', fontSize: 11, lineHeight: 1.9 }}>
                Section A completeness: <strong style={{ color: compPct >= 75 ? 'var(--grn)' : '#f59e0b' }}>{compPct}%</strong>
                {compPct === 100 ? ' — ready for Section B and BRSR PDF.' : ' — finish remaining sub-sections above.'}
              </div>
              {devMode && (
                <pre style={{ marginTop: 14, fontSize: 9, color: 'var(--grn)', background: 'var(--surf3)', borderRadius: 6, padding: 12, overflowX: 'auto' }}>
                  {JSON.stringify({ entity, business, workforce, structure, grievance }, null, 2)}
                </pre>
              )}
              <button className="btn btn-p" style={{ marginTop: 14, width: '100%' }} onClick={() => handleSave()} disabled={saving}>
                {saving ? 'SAVING…' : '✓ SAVE & CONTINUE →'}
              </button>
            </div>
          )}

        </div>
      </div>
    </>
  );
}