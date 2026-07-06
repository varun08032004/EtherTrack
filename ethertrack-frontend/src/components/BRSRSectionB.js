// src/components/BRSRSectionB.jsx
// SEBI BRSR Core — Section B: Management & Process Disclosures
// One governance build spanning all 9 NGRBC principles, not nine separate
// components. Covers: per-principle policy & process matrix, reasons for
// non-coverage (where a principle has no policy), and the governance/
// oversight block (responsible director, review frequency, statutory
// notices, independent assessment).
//
// Input/data-capture layer only — saves to /api/brsr/section-b.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../services/api';

const currentYear = new Date().getFullYear();
const REPORT_YEARS = Array.from({ length: 5 }, (_, i) => currentYear - 3 + i);
const sanitise = (str = '', max = 1000) => String(str).replace(/<[^>]*>/g, '').replace(/['"`;]/g, '').trim().slice(0, max);

const PRINCIPLES = [
  { id: 'p1', label: 'P1', name: 'Ethics, Transparency & Accountability' },
  { id: 'p2', label: 'P2', name: 'Product Lifecycle Sustainability & Safety' },
  { id: 'p3', label: 'P3', name: 'Employee & Worker Wellbeing' },
  { id: 'p4', label: 'P4', name: 'Stakeholder Engagement' },
  { id: 'p5', label: 'P5', name: 'Human Rights' },
  { id: 'p6', label: 'P6', name: 'Environment' },
  { id: 'p7', label: 'P7', name: 'Responsible Public Policy' },
  { id: 'p8', label: 'P8', name: 'Inclusive Growth & Equitable Development' },
  { id: 'p9', label: 'P9', name: 'Consumer Responsibility' },
];

const REASON_OPTIONS = [
  'The entity does not consider the principle material to its business',
  'The entity is not at a stage where it can formulate and implement a policy on this principle',
  'The entity does not have the financial, human, or technical resources available for this task',
  'It is planned to be done in the next financial year',
  'Any other reason (specify in notes)',
];

const FREQUENCY_OPTIONS = ['Annually', 'Half-Yearly', 'Quarterly', 'Other', 'Not Reviewed'];

const defPolicyRow = () => ({
  hasPolicy: null, boardApproved: null, weblink: '',
  extendsToValueChain: null, standards: '', commitments: '', performance: '',
});
const defPolicyMatrix = () => PRINCIPLES.reduce((acc, p) => { acc[p.id] = defPolicyRow(); return acc; }, {});
const defNonCoverage = () => PRINCIPLES.reduce((acc, p) => { acc[p.id] = { reason: '', notes: '' }; return acc; }, {});
const defGovernance = () => ({
  directorStatement: '',
  responsibleName: '', responsibleDesignation: '', responsibleDin: '',
  reviewFrequency: PRINCIPLES.reduce((acc, p) => { acc[p.id] = ''; return acc; }, {}),
  statutoryNotices: null, statutoryNoticesDetails: '',
  independentAssessment: null, independentAssessmentAgency: '',
});

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;700;800&display=swap');
:root{--bg:#060809;--surf:#0e1318;--brd:#1e3040;--brd2:#2e3d50;--txt:#f0f6ff;--mut:#5a7a8a;--grn:#10b981;--red:#ef4444;--ylw:#f59e0b;}
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
.g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}
.brsr-fg{display:flex;flex-direction:column;gap:5px;margin-bottom:12px;}
.brsr-lbl{font-size:10px;letter-spacing:.1em;color:var(--mut);}
.brsr-inp{padding:9px 11px;border-radius:6px;background:#0a1018;border:1px solid var(--brd);color:var(--txt);font-family:'Space Mono',monospace;font-size:12px;outline:none;width:100%;box-sizing:border-box;}
.brsr-inp:focus{border-color:#10b98144;box-shadow:0 0 0 2px #10b98108;}
.btn{padding:9px 18px;border-radius:6px;border:none;cursor:pointer;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.1em;font-weight:700;}
.btn:disabled{opacity:.5;cursor:not-allowed;}
.btn-p{background:linear-gradient(135deg,#10b981,#059669);color:#fff;}
.btn-g{background:var(--surf);border:1px solid var(--brd2);color:var(--txt);}
.btn-sm{padding:6px 13px;font-size:10px;}
.brsr-tabs{display:flex;gap:0;margin-bottom:18px;border-bottom:1px solid var(--brd);flex-wrap:wrap;}
.brsr-tab{padding:9px 16px;font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.08em;cursor:pointer;border:none;background:none;color:var(--mut);border-bottom:2px solid transparent;}
.brsr-tab.on{color:var(--grn);border-bottom-color:var(--grn);}
.brsr-alert{padding:10px 14px;border-radius:7px;font-size:11px;display:flex;gap:8px;margin-bottom:12px;line-height:1.6;}
.al-g{background:#10b98108;border:1px solid #10b98133;color:var(--grn);}
.al-y{background:#f59e0b08;border:1px solid #f59e0b33;color:var(--ylw);}
.divider{height:1px;background:var(--brd);margin:14px 0;}
.radio-row{display:flex;gap:16px;}
.radio-opt{display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;}
.radio-opt input{accent-color:var(--grn);width:13px;height:13px;}
.accordion-item{border:1px solid var(--brd);border-radius:8px;margin-bottom:8px;overflow:hidden;}
.accordion-hd{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;cursor:pointer;background:#080b0e;transition:background .15s;}
.accordion-hd:hover{background:#0c1014;}
.accordion-hd.on{background:#10b98108;border-bottom:1px solid var(--brd);}
.accordion-name{font-size:12px;font-weight:700;}
.accordion-sub{font-size:10px;color:var(--mut);margin-top:2px;}
.accordion-status{font-size:9px;padding:2px 7px;border-radius:3px;letter-spacing:.05em;}
.accordion-body{padding:16px;}
.freq-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
.freq-row{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border:1px solid var(--brd);border-radius:6px;background:#080b0e;}
.freq-row-lbl{font-size:11px;}
@media(max-width:900px){.g2,.g3,.freq-grid{grid-template-columns:1fr 1fr;}}
@media(max-width:600px){.g2,.g3,.freq-grid{grid-template-columns:1fr;}}
`;

function TextField({ label, value, onChange, placeholder = '', maxLength = 300, textarea = false, rows = 2 }) {
  const Tag = textarea ? 'textarea' : 'input';
  return (
    <div className="brsr-fg">
      <label className="brsr-lbl">{label}</label>
      <Tag className="brsr-inp" type={textarea ? undefined : 'text'} rows={textarea ? rows : undefined}
        maxLength={maxLength} placeholder={placeholder} value={value || ''}
        onChange={e => onChange(e.target.value)} style={textarea ? { resize: 'vertical' } : {}}/>
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

export default function BRSRSectionB({ profile, year: propYear, onDataReady }) {
  const [year, setYear] = useState(propYear || new Date().getFullYear());
  const [tab, setTab] = useState('matrix');
  const [expanded, setExpanded] = useState('p1');
  const [notif, setNotif] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);

  const [policyMatrix, setPolicyMatrix] = useState(defPolicyMatrix());
  const [nonCoverage, setNonCoverage] = useState(defNonCoverage());
  const [governance, setGovernance] = useState(defGovernance());

  const abortRef = useRef(null);
  const toast = (msg, type = 'ok') => { setNotif({ msg, type }); setTimeout(() => setNotif(null), 3800); };

  const loadData = useCallback(async (yr) => {
    if (abortRef.current) abortRef.current.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/brsr/section-b?year=${yr}`, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      if (res?.data) {
        if (res.data.policyMatrix) setPolicyMatrix(m => ({ ...defPolicyMatrix(), ...res.data.policyMatrix }));
        if (res.data.nonCoverage) setNonCoverage(n => ({ ...defNonCoverage(), ...res.data.nonCoverage }));
        if (res.data.governance) setGovernance(g => ({ ...defGovernance(), ...res.data.governance }));
      } else {
        setPolicyMatrix(defPolicyMatrix()); setNonCoverage(defNonCoverage()); setGovernance(defGovernance());
      }
      setDirty(false);
    } catch (e) {
      if (e.name !== 'AbortError') toast('Failed to load Section B data', 'err');
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(year); return () => { abortRef.current?.abort(); }; }, [loadData, year]);

  const markDirty = () => setDirty(true);
  const setRow = (pid, key, val) => { setPolicyMatrix(m => ({ ...m, [pid]: { ...m[pid], [key]: val } })); markDirty(); };
  const setNonCoverageField = (pid, key, val) => { setNonCoverage(n => ({ ...n, [pid]: { ...n[pid], [key]: val } })); markDirty(); };
  const setGov = (key, val) => { setGovernance(g => ({ ...g, [key]: val })); markDirty(); };
  const setGovFreq = (pid, val) => { setGovernance(g => ({ ...g, reviewFrequency: { ...g.reviewFrequency, [pid]: val } })); markDirty(); };

  const principlesWithoutPolicy = PRINCIPLES.filter(p => policyMatrix[p.id].hasPolicy === false);
  const matrixAnsweredCount = PRINCIPLES.filter(p => policyMatrix[p.id].hasPolicy !== null).length;
  const matrixComplete = matrixAnsweredCount === PRINCIPLES.length;
  const nonCoverageComplete = principlesWithoutPolicy.every(p => nonCoverage[p.id].reason);
  const governanceComplete = !!(governance.directorStatement && governance.responsibleName &&
    governance.statutoryNotices !== null && governance.independentAssessment !== null);

  const sectionsDone = [matrixComplete, nonCoverageComplete, governanceComplete].filter(Boolean).length;
  const compPct = Math.round(sectionsDone / 3 * 100);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const matrixPayload = {};
      PRINCIPLES.forEach(p => {
        const row = policyMatrix[p.id];
        matrixPayload[p.id] = {
          hasPolicy: row.hasPolicy, boardApproved: row.boardApproved,
          weblink: sanitise(row.weblink, 300), extendsToValueChain: row.extendsToValueChain,
          standards: sanitise(row.standards, 500), commitments: sanitise(row.commitments, 1000),
          performance: sanitise(row.performance, 1000),
        };
      });
      const nonCoveragePayload = {};
      PRINCIPLES.forEach(p => {
        nonCoveragePayload[p.id] = { reason: nonCoverage[p.id].reason, notes: sanitise(nonCoverage[p.id].notes, 500) };
      });
      const governancePayload = {
        directorStatement: sanitise(governance.directorStatement, 3000),
        responsibleName: sanitise(governance.responsibleName, 100),
        responsibleDesignation: sanitise(governance.responsibleDesignation, 100),
        responsibleDin: sanitise(governance.responsibleDin, 20),
        reviewFrequency: governance.reviewFrequency,
        statutoryNotices: governance.statutoryNotices,
        statutoryNoticesDetails: sanitise(governance.statutoryNoticesDetails, 1000),
        independentAssessment: governance.independentAssessment,
        independentAssessmentAgency: sanitise(governance.independentAssessmentAgency, 200),
      };

      await apiFetch('/api/brsr/section-b', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, policyMatrix: matrixPayload, nonCoverage: nonCoveragePayload, governance: governancePayload }),
      });
      toast('✓ Section B saved');
      setDirty(false);
      onDataReady?.({ policyMatrix: matrixPayload, nonCoverage: nonCoveragePayload, governance: governancePayload });
    } catch {
      toast('Save failed. Please try again.', 'err');
    } finally {
      setSaving(false);
    }
  }, [saving, year, policyMatrix, nonCoverage, governance, onDataReady]);

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
              <div className="brsr-label">SEBI BRSR CORE · SECTION B · MANAGEMENT & PROCESS DISCLOSURES</div>
              <div className="brsr-title">Section B <span>Management & Process</span></div>
              <div className="brsr-sub">Policy coverage across all 9 NGRBC principles · Governance & oversight · Reasons for non-coverage{profile?.company_name && ` · ${profile.company_name}`}</div>
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
            <span>Section B completeness: <strong style={{ color: compPct >= 75 ? '#10b981' : '#f59e0b' }}>{compPct}%</strong> — {matrixAnsweredCount}/9 principles have a policy status set.</span>
          </div>

          <div className="brsr-tabs">
            {[['matrix','POLICY & PROCESS MATRIX'],['noncoverage', `NON-COVERAGE REASONS${principlesWithoutPolicy.length ? ` (${principlesWithoutPolicy.length})` : ''}`],['governance','GOVERNANCE & OVERSIGHT'],['summary','SUMMARY']].map(([k,v]) => (
              <button key={k} className={`brsr-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{v}</button>
            ))}
          </div>

          {loading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--mut)', fontSize: 11 }}>LOADING SECTION B DATA…</div>}

          {!loading && tab === 'matrix' && (
            <div className="brsr-card">
              <div className="brsr-ctit">POLICY & PROCESS — ONE BLOCK PER PRINCIPLE</div>
              {PRINCIPLES.map(p => {
                const row = policyMatrix[p.id];
                const isOn = expanded === p.id;
                const rowComplete = row.hasPolicy !== null && (row.hasPolicy === false || row.boardApproved !== null);
                return (
                  <div key={p.id} className="accordion-item">
                    <div className={`accordion-hd${isOn ? ' on' : ''}`} onClick={() => setExpanded(isOn ? null : p.id)}>
                      <div>
                        <div className="accordion-name">{p.label} — {p.name}</div>
                        <div className="accordion-sub">{row.hasPolicy === null ? 'Not answered' : row.hasPolicy ? 'Policy in place' : 'No policy'}</div>
                      </div>
                      <span className="accordion-status" style={{
                        background: rowComplete ? '#10b98114' : '#f59e0b14', color: rowComplete ? '#10b981' : '#f59e0b',
                        border: `1px solid ${rowComplete ? '#10b98133' : '#f59e0b33'}`,
                      }}>{rowComplete ? '✓ DONE' : '⚠ INCOMPLETE'}</span>
                    </div>
                    {isOn && (
                      <div className="accordion-body">
                        <RadioGroup label={`Does the entity have a policy covering ${p.label}?`} value={row.hasPolicy}
                          onChange={v => setRow(p.id, 'hasPolicy', v)} options={[{ val: true, lbl: 'Yes' }, { val: false, lbl: 'No' }]}/>
                        {row.hasPolicy && (
                          <>
                            <div className="g3">
                              <RadioGroup label="Board approved?" value={row.boardApproved} onChange={v => setRow(p.id, 'boardApproved', v)}
                                options={[{ val: true, lbl: 'Yes' }, { val: false, lbl: 'No' }]}/>
                              <RadioGroup label="Extends to value chain?" value={row.extendsToValueChain} onChange={v => setRow(p.id, 'extendsToValueChain', v)}
                                options={[{ val: true, lbl: 'Yes' }, { val: false, lbl: 'No' }]}/>
                              <TextField label="Policy weblink (if public)" value={row.weblink} onChange={v => setRow(p.id, 'weblink', v)} placeholder="https://"/>
                            </div>
                            <TextField label="National/international standards or certifications mapped to this principle" value={row.standards}
                              onChange={v => setRow(p.id, 'standards', v)} maxLength={500}/>
                            <TextField label="Specific commitments, goals & targets (with timelines)" textarea rows={2} value={row.commitments}
                              onChange={v => setRow(p.id, 'commitments', v)} maxLength={1000}/>
                            <TextField label="Performance against those targets (note reasons if not met)" textarea rows={2} value={row.performance}
                              onChange={v => setRow(p.id, 'performance', v)} maxLength={1000}/>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!loading && tab === 'noncoverage' && (
            <div className="brsr-card">
              <div className="brsr-ctit">REASONS FOR NON-COVERAGE</div>
              {principlesWithoutPolicy.length === 0 ? (
                <div className="brsr-alert al-g"><span>✓</span><span>Every principle currently has a policy — no reasons needed. This updates automatically if you mark any principle "No" above.</span></div>
              ) : principlesWithoutPolicy.map(p => (
                <div key={p.id} style={{ marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid var(--brd)44' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{p.label} — {p.name}</div>
                  <div className="brsr-fg">
                    <label className="brsr-lbl">Why does no policy exist for this principle?</label>
                    <select className="brsr-sel" style={{ width: '100%' }} value={nonCoverage[p.id].reason}
                      onChange={e => setNonCoverageField(p.id, 'reason', e.target.value)}>
                      <option value="">— select reason —</option>
                      {REASON_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <TextField label="Additional notes (optional)" value={nonCoverage[p.id].notes} onChange={v => setNonCoverageField(p.id, 'notes', v)} maxLength={500}/>
                </div>
              ))}
            </div>
          )}

          {!loading && tab === 'governance' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="brsr-card">
                <div className="brsr-ctit">DIRECTOR'S STATEMENT</div>
                <TextField label="Statement by the director responsible for BRSR, highlighting ESG challenges, targets & achievements" textarea rows={4}
                  value={governance.directorStatement} onChange={v => setGov('directorStatement', v)} maxLength={3000}/>
              </div>
              <div className="brsr-card">
                <div className="brsr-ctit">RESPONSIBLE PERSON / COMMITTEE</div>
                <div className="g3">
                  <TextField label="Name" value={governance.responsibleName} onChange={v => setGov('responsibleName', v)}/>
                  <TextField label="Designation" value={governance.responsibleDesignation} onChange={v => setGov('responsibleDesignation', v)}/>
                  <TextField label="DIN (if Director)" value={governance.responsibleDin} onChange={v => setGov('responsibleDin', v)}/>
                </div>
              </div>
              <div className="brsr-card">
                <div className="brsr-ctit">REVIEW FREQUENCY — PER PRINCIPLE</div>
                <div className="freq-grid">
                  {PRINCIPLES.map(p => (
                    <div key={p.id} className="freq-row">
                      <span className="freq-row-lbl">{p.label}</span>
                      <select className="brsr-sel" style={{ width: 130 }} value={governance.reviewFrequency[p.id] || ''}
                        onChange={e => setGovFreq(p.id, e.target.value)}>
                        <option value="">—</option>
                        {FREQUENCY_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
              <div className="brsr-card">
                <div className="brsr-ctit">STATUTORY NOTICES & INDEPENDENT ASSESSMENT</div>
                <RadioGroup label="Has any statutory/regulatory/judicial body issued notices or penalties for non-compliance with any principle?"
                  value={governance.statutoryNotices} onChange={v => setGov('statutoryNotices', v)} options={[{ val: true, lbl: 'Yes' }, { val: false, lbl: 'No' }]}/>
                {governance.statutoryNotices && (
                  <TextField label="Details & corrective action taken" textarea rows={2} value={governance.statutoryNoticesDetails} onChange={v => setGov('statutoryNoticesDetails', v)} maxLength={1000}/>
                )}
                <div className="divider"/>
                <RadioGroup label="Has an independent external agency assessed/evaluated the working of these policies?"
                  value={governance.independentAssessment} onChange={v => setGov('independentAssessment', v)} options={[{ val: true, lbl: 'Yes' }, { val: false, lbl: 'No' }]}/>
                {governance.independentAssessment && (
                  <TextField label="Name of agency" value={governance.independentAssessmentAgency} onChange={v => setGov('independentAssessmentAgency', v)}/>
                )}
              </div>
            </div>
          )}

          {!loading && tab === 'summary' && (
            <div className="brsr-card">
              <div className="brsr-ctit">SECTION B COMPLETION STATUS</div>
              {[
                { label: 'Policy & Process Matrix (all 9 principles)', ok: matrixComplete, detail: `${matrixAnsweredCount}/9 answered` },
                { label: 'Non-Coverage Reasons', ok: nonCoverageComplete, detail: principlesWithoutPolicy.length === 0 ? 'Not applicable' : `${principlesWithoutPolicy.filter(p => nonCoverage[p.id].reason).length}/${principlesWithoutPolicy.length} explained` },
                { label: 'Governance & Oversight', ok: governanceComplete, detail: governanceComplete ? 'Complete' : 'Missing fields' },
              ].map(({ label, ok, detail }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--brd)44', fontSize: 12 }}>
                  <span style={{ color: 'var(--mut)' }}>{label}</span>
                  <span style={{ color: ok ? '#10b981' : '#f59e0b' }}>{ok ? '✓' : '⚠'} {detail}</span>
                </div>
              ))}
              <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 8, background: '#10b98108', border: '1px solid #10b98122', fontSize: 11, lineHeight: 1.9 }}>
                Section B completeness: <strong style={{ color: compPct >= 75 ? '#10b981' : '#f59e0b' }}>{compPct}%</strong>
              </div>
              <button className="btn btn-p" style={{ marginTop: 14 }} onClick={handleSave} disabled={saving}>{saving ? 'SAVING…' : '✓ SAVE & CONTINUE →'}</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}