// src/components/BRSRPrincipleForm.jsx
// Generic renderer for SEBI BRSR Section C principles (P1-P5, P7-P9).
// Driven entirely by a schema object (see src/data/brsrPrincipleSchemas.js)
// so one component covers 8 principles instead of 8 near-duplicate files.
// P6 stays on its own bespoke BRSREnvironmental.jsx — not rendered here.
//
// Input/data-capture layer only — saves to /api/brsr/principle/:id.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../services/api';

const currentYear = new Date().getFullYear();
const REPORT_YEARS = Array.from({ length: 5 }, (_, i) => currentYear - 3 + i);
const sanitise = (str = '', max = 1000) => String(str).replace(/<[^>]*>/g, '').replace(/['"`;]/g, '').trim().slice(0, max);
const safeNum = (val, min = 0, max = 1e12) => {
  if (val === null || val === undefined || val === '') return null;
  const n = parseFloat(val);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
};
const uid = () => Math.random().toString(36).slice(2, 10);

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;700;800&display=swap');
:root{--bg:#060809;--surf:#0e1318;--brd:#1e3040;--brd2:#2e3d50;--txt:#f0f6ff;--mut:#5a7a8a;--grn:#10b981;--red:#ef4444;--ylw:#f59e0b;--pur:#a855f7;}
.brsr{min-height:100vh;background:var(--bg);font-family:'Space Mono',monospace;color:var(--txt);}
.brsr-in{max-width:1200px;margin:0 auto;padding:28px 24px;}
.brsr-hd{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid var(--brd);}
.brsr-label{font-size:10px;letter-spacing:.18em;color:var(--mut);margin-bottom:4px;}
.brsr-title{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;margin-bottom:2px;}
.brsr-title span{color:var(--grn);}
.brsr-sub{font-size:11px;color:var(--mut);letter-spacing:.06em;}
.brsr-yr{display:flex;gap:6px;align-items:center;}
.brsr-sel{padding:7px 12px;border-radius:5px;background:#0a1018;border:1px solid var(--brd2);color:var(--txt);font-family:'Space Mono',monospace;font-size:11px;outline:none;}
.brsr-card{background:var(--surf);border:1px solid var(--brd);border-radius:10px;padding:20px;margin-bottom:14px;}
.brsr-ctit{font-size:10px;letter-spacing:.15em;color:var(--mut);margin-bottom:16px;display:flex;align-items:center;gap:8px;}
.brsr-ctit::before{content:'';width:10px;height:1px;background:var(--grn);}
.brsr-fg{display:flex;flex-direction:column;gap:5px;margin-bottom:14px;}
.brsr-lbl{font-size:11px;letter-spacing:.03em;color:var(--txt2,var(--txt));line-height:1.5;}
.brsr-inp{padding:9px 11px;border-radius:6px;background:#0a1018;border:1px solid var(--brd);color:var(--txt);font-family:'Space Mono',monospace;font-size:12px;outline:none;width:100%;box-sizing:border-box;}
.brsr-inp:focus{border-color:#10b98144;box-shadow:0 0 0 2px #10b98108;}
.brsr-sel-full{width:100%;}
.btn{padding:9px 18px;border-radius:6px;border:none;cursor:pointer;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.1em;font-weight:700;}
.btn:disabled{opacity:.5;cursor:not-allowed;}
.btn-p{background:linear-gradient(135deg,#10b981,#059669);color:#fff;}
.btn-g{background:var(--surf);border:1px solid var(--brd2);color:var(--txt);}
.btn-sm{padding:6px 13px;font-size:10px;}
.brsr-tabs{display:flex;gap:0;margin-bottom:18px;border-bottom:1px solid var(--brd);}
.brsr-tab{padding:9px 16px;font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.08em;cursor:pointer;border:none;background:none;color:var(--mut);border-bottom:2px solid transparent;}
.brsr-tab.on{color:var(--grn);border-bottom-color:var(--grn);}
.brsr-alert{padding:10px 14px;border-radius:7px;font-size:11px;display:flex;gap:8px;margin-bottom:12px;line-height:1.6;}
.al-g{background:#10b98108;border:1px solid #10b98133;color:var(--grn);}
.al-y{background:#f59e0b08;border:1px solid #f59e0b33;color:var(--ylw);}
.radio-row{display:flex;gap:16px;}
.radio-opt{display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;}
.radio-opt input{accent-color:var(--grn);width:13px;height:13px;}
.brsr-table-row{display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--brd)44;}
.brsr-table-head{font-size:9px;letter-spacing:.08em;color:var(--mut);border-bottom:1px solid var(--brd);padding-bottom:8px;}
.brsr-remove-row{background:none;border:none;color:#ef444466;cursor:pointer;font-size:13px;padding:4px;}
.brsr-remove-row:hover{color:#ef4444;}
.field-count-badge{font-size:8px;padding:1px 6px;border-radius:3px;letter-spacing:.04em;}
.fcb-ess{background:#3b82f614;color:#60a5fa;border:1px solid #3b82f630;}
.fcb-lead{background:#a855f714;color:#c084fc;border:1px solid #a855f730;}
@media(max-width:600px){.brsr-table-row{flex-wrap:wrap;}}
`;

function NumericField({ label, value, onChange, unit = '', maxVal = 1e12 }) {
  const [localVal, setLocalVal] = useState(value === null ? '' : String(value));
  useEffect(() => { setLocalVal(value === null ? '' : String(value)); }, [value]);
  return (
    <div className="brsr-fg">
      <label className="brsr-lbl">{label}{unit ? ` (${unit})` : ''}</label>
      <input className="brsr-inp" type="number" step="0.01" min="0" max={maxVal}
        placeholder="NOT ENTERED" value={localVal}
        onChange={e => { const raw = e.target.value; setLocalVal(raw); onChange(raw === '' ? null : parseFloat(raw)); }}/>
    </div>
  );
}

function TextField({ label, value, onChange, textarea = false, rows = 2, maxLength = 1000 }) {
  const Tag = textarea ? 'textarea' : 'input';
  return (
    <div className="brsr-fg">
      <label className="brsr-lbl">{label}</label>
      <Tag className="brsr-inp" type={textarea ? undefined : 'text'} rows={textarea ? rows : undefined}
        maxLength={maxLength} value={value || ''} onChange={e => onChange(e.target.value)}
        style={textarea ? { resize: 'vertical' } : {}}/>
    </div>
  );
}

function RadioField({ label, value, onChange }) {
  return (
    <div className="brsr-fg">
      <label className="brsr-lbl">{label}</label>
      <div className="radio-row">
        <label className="radio-opt"><input type="radio" checked={value === true} onChange={() => onChange(true)}/><span>Yes</span></label>
        <label className="radio-opt"><input type="radio" checked={value === false} onChange={() => onChange(false)}/><span>No</span></label>
      </div>
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div className="brsr-fg">
      <label className="brsr-lbl">{label}</label>
      <select className="brsr-sel brsr-sel-full" value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">— select —</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function TableField({ label, columns, rows, onChange }) {
  const addRow = () => {
    const blank = { id: uid() };
    columns.forEach(c => { blank[c.key] = c.type === 'number' ? null : ''; });
    onChange([...rows, blank]);
  };
  const removeRow = (id) => onChange(rows.filter(r => r.id !== id));
  const updateCell = (id, key, val) => onChange(rows.map(r => r.id === id ? { ...r, [key]: val } : r));

  return (
    <div className="brsr-fg">
      <label className="brsr-lbl">{label}</label>
      <div className="brsr-table-row brsr-table-head">
        {columns.map(c => <span key={c.key} style={{ flex: c.width || 1 }}>{c.label}</span>)}
        <span style={{ width: 28 }}/>
      </div>
      {rows.length === 0 && <div style={{ padding: '12px 0', textAlign: 'center', color: 'var(--mut)', fontSize: 11 }}>No rows yet — add one below</div>}
      {rows.map(row => (
        <div key={row.id} className="brsr-table-row">
          {columns.map(c => (
            <span key={c.key} style={{ flex: c.width || 1 }}>
              {c.type === 'select' ? (
                <select className="brsr-sel brsr-sel-full" value={row[c.key] || ''} onChange={e => updateCell(row.id, c.key, e.target.value)}>
                  <option value="">—</option>
                  {c.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : c.type === 'number' ? (
                <input className="brsr-inp" type="number" step="0.01" min="0"
                  value={row[c.key] === null || row[c.key] === undefined ? '' : row[c.key]}
                  onChange={e => updateCell(row.id, c.key, e.target.value === '' ? null : parseFloat(e.target.value))}/>
              ) : (
                <input className="brsr-inp" type="text" maxLength={300} value={row[c.key] || ''} onChange={e => updateCell(row.id, c.key, e.target.value)}/>
              )}
            </span>
          ))}
          <span style={{ width: 28, textAlign: 'center' }}>
            <button type="button" className="brsr-remove-row" onClick={() => removeRow(row.id)} aria-label="Remove row">✕</button>
          </span>
        </div>
      ))}
      <button type="button" className="btn btn-g btn-sm" style={{ marginTop: 8 }} onClick={addRow}>+ ADD ROW</button>
    </div>
  );
}

function defaultValueFor(field) {
  if (field.type === 'table') return [];
  if (field.type === 'number' || field.type === 'percent') return null;
  return field.type === 'radio' ? null : '';
}

function defDataFromSchema(schema) {
  const data = {};
  [...(schema.essential || []), ...(schema.leadership || [])].forEach(f => { data[f.key] = defaultValueFor(f); });
  return data;
}

function fieldVisible(field, data) {
  if (!field.showIf) return true;
  const dependVal = data[field.showIf.key];
  if (field.showIf.equals === 'gt0') return typeof dependVal === 'number' && dependVal > 0;
  return dependVal === field.showIf.equals;
}

function renderField(field, data, setField) {
  if (!fieldVisible(field, data)) return null;
  const value = data[field.key];
  const onChange = (v) => setField(field.key, v);
  switch (field.type) {
    case 'radio':    return <RadioField key={field.key} label={field.label} value={value} onChange={onChange}/>;
    case 'number':    return <NumericField key={field.key} label={field.label} value={value} onChange={onChange}/>;
    case 'percent':   return <NumericField key={field.key} label={field.label} unit="%" maxVal={100} value={value} onChange={onChange}/>;
    case 'text':      return <TextField key={field.key} label={field.label} value={value} onChange={onChange}/>;
    case 'textarea':  return <TextField key={field.key} label={field.label} textarea rows={3} value={value} onChange={onChange}/>;
    case 'select':    return <SelectField key={field.key} label={field.label} options={field.options} value={value} onChange={onChange}/>;
    case 'table':     return <TableField key={field.key} label={field.label} columns={field.columns} rows={value || []} onChange={onChange}/>;
    default:          return null;
  }
}

function isFieldAnswered(field, data) {
  if (!fieldVisible(field, data)) return true; // hidden conditional fields don't block completeness
  const v = data[field.key];
  if (field.type === 'table') return Array.isArray(v) && v.length > 0;
  if (field.type === 'radio') return v === true || v === false;
  if (field.type === 'number' || field.type === 'percent') return v !== null;
  return typeof v === 'string' && v.trim().length > 0;
}

export default function BRSRPrincipleForm({ profile, year: propYear, onDataReady, schema, principleLabel, principleSub }) {
  const sectionLabel = principleLabel || schema?.label || 'Principle';
  const sectionSub = principleSub || schema?.name || '';
  const principleSlug = (sectionLabel || 'p').toLowerCase();

  const [year, setYear] = useState(propYear || new Date().getFullYear());
  const [tab, setTab] = useState('essential');
  const [notif, setNotif] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [data, setData] = useState(() => defDataFromSchema(schema || { essential: [], leadership: [] }));

  const abortRef = useRef(null);
  const toast = (msg, type = 'ok') => { setNotif({ msg, type }); setTimeout(() => setNotif(null), 3800); };

  const loadData = useCallback(async (yr) => {
    if (!schema) return;
    if (abortRef.current) abortRef.current.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/brsr/principle/${principleSlug}?year=${yr}`, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      setData(res?.data ? { ...defDataFromSchema(schema), ...res.data } : defDataFromSchema(schema));
      setDirty(false);
    } catch (e) {
      if (e.name !== 'AbortError') toast('Failed to load saved data', 'err');
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, [schema, principleSlug]);

  useEffect(() => { loadData(year); return () => { abortRef.current?.abort(); }; }, [loadData, year]);

  const setField = (key, val) => { setData(d => ({ ...d, [key]: val })); setDirty(true); };

  const essentialFields = schema?.essential || [];
  const leadershipFields = schema?.leadership || [];
  const essentialAnswered = essentialFields.filter(f => isFieldAnswered(f, data)).length;
  const compPct = essentialFields.length ? Math.round(essentialAnswered / essentialFields.length * 100) : 0;

  const sanitiseValueForPayload = (field, val) => {
    if (field.type === 'textarea' || field.type === 'text') return sanitise(val, 2000);
    if (field.type === 'table') {
      return (val || []).map(row => {
        const clean = {};
        field.columns.forEach(c => {
          clean[c.key] = c.type === 'number' ? safeNum(row[c.key]) : sanitise(row[c.key] || '', 300);
        });
        return clean;
      });
    }
    if (field.type === 'number' || field.type === 'percent') return safeNum(val, 0, field.type === 'percent' ? 100 : 1e12);
    return val;
  };

  const handleSave = useCallback(async () => {
    if (saving || !schema) return;
    setSaving(true);
    try {
      const payload = {};
      [...essentialFields, ...leadershipFields].forEach(f => { payload[f.key] = sanitiseValueForPayload(f, data[f.key]); });
      await apiFetch(`/api/brsr/principle/${principleSlug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, data: payload }),
      });
      toast(`✓ ${sectionLabel} saved`);
      setDirty(false);
      onDataReady?.(payload);
    } catch {
      toast('Save failed. Please try again.', 'err');
    } finally {
      setSaving(false);
    }
  }, [saving, schema, essentialFields, leadershipFields, data, year, principleSlug, sectionLabel, onDataReady]);

  if (!schema) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--mut)', fontSize: 12 }}>No schema provided for this principle.</div>;
  }

  return (
    <>
      <style>{CSS}</style>
      {notif && (
        <div style={{ position: 'fixed', top: 76, right: 24, zIndex: 9999, padding: '11px 18px', borderRadius: 8,
          background: notif.type === 'err' ? '#450a0a' : '#0b2a1e',
          border: `1px solid ${notif.type === 'err' ? '#ef444433' : '#10b98133'}`,
          color: notif.type === 'err' ? '#f87171' : '#10b981', fontFamily: 'Space Mono,monospace', fontSize: 11 }}>
          {notif.msg}
        </div>
      )}
      <div className="brsr">
        <div className="brsr-in">
          <div className="brsr-hd">
            <div>
              <div className="brsr-label">SEBI BRSR CORE · SECTION C · {sectionLabel}</div>
              <div className="brsr-title">{sectionLabel} <span>{sectionSub}</span></div>
              <div className="brsr-sub">
                <span className="field-count-badge fcb-ess" style={{ marginRight: 6 }}>{essentialFields.length} Essential</span>
                <span className="field-count-badge fcb-lead">{leadershipFields.length} Leadership</span>
                {profile?.company_name && ` · ${profile.company_name}`}
              </div>
            </div>
            <div className="brsr-yr">
              <label className="brsr-lbl">FY</label>
              <select className="brsr-sel" value={year} onChange={e => setYear(parseInt(e.target.value, 10))}>
                {REPORT_YEARS.map(y => <option key={y}>{y}</option>)}
              </select>
              {dirty && <span style={{ fontSize: 10, color: '#f59e0b', marginLeft: 6 }}>UNSAVED</span>}
              <button className="btn btn-p btn-sm" onClick={handleSave} disabled={saving}>{saving ? 'SAVING…' : 'SAVE ALL →'}</button>
            </div>
          </div>

          <div className="brsr-alert al-y">
            <span>📋</span>
            <span>{sectionLabel} completeness: <strong style={{ color: compPct >= 75 ? '#10b981' : '#f59e0b' }}>{compPct}%</strong> — {essentialAnswered}/{essentialFields.length} essential indicators answered.</span>
          </div>

          <div className="brsr-tabs">
            {[['essential', `ESSENTIAL INDICATORS (${essentialFields.length})`], ['leadership', `LEADERSHIP INDICATORS (${leadershipFields.length})`], ['summary', 'SUMMARY']].map(([k, v]) => (
              <button key={k} className={`brsr-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{v}</button>
            ))}
          </div>

          {loading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--mut)', fontSize: 11 }}>LOADING…</div>}

          {!loading && tab === 'essential' && (
            <div className="brsr-card">
              <div className="brsr-ctit">ESSENTIAL INDICATORS — MANDATORY</div>
              {essentialFields.length === 0
                ? <div style={{ color: 'var(--mut)', fontSize: 11 }}>No essential indicators defined.</div>
                : essentialFields.map(f => renderField(f, data, setField))}
            </div>
          )}

          {!loading && tab === 'leadership' && (
            <div className="brsr-card">
              <div className="brsr-ctit">LEADERSHIP INDICATORS — VOLUNTARY</div>
              {leadershipFields.length === 0
                ? <div style={{ color: 'var(--mut)', fontSize: 11 }}>No leadership indicators defined.</div>
                : leadershipFields.map(f => renderField(f, data, setField))}
            </div>
          )}

          {!loading && tab === 'summary' && (
            <div className="brsr-card">
              <div className="brsr-ctit">{sectionLabel} COMPLETION STATUS</div>
              {essentialFields.map(f => (
                <div key={f.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--brd)44', fontSize: 12 }}>
                  <span style={{ color: 'var(--mut)' }}>{f.label}</span>
                  <span style={{ color: isFieldAnswered(f, data) ? '#10b981' : '#f59e0b' }}>{isFieldAnswered(f, data) ? '✓' : '⚠ not answered'}</span>
                </div>
              ))}
              <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 8, background: '#10b98108', border: '1px solid #10b98122', fontSize: 11, lineHeight: 1.9 }}>
                {sectionLabel} completeness: <strong style={{ color: compPct >= 75 ? '#10b981' : '#f59e0b' }}>{compPct}%</strong>
              </div>
              <button className="btn btn-p" style={{ marginTop: 14 }} onClick={handleSave} disabled={saving}>{saving ? 'SAVING…' : '✓ SAVE & CONTINUE →'}</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}