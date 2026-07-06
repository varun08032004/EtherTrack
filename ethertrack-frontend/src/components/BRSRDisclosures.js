// src/components/BRSRDisclosures.jsx
// Single entry point for ALL SEBI BRSR Core disclosures.
// Mirrors SEBI's exact 3-section structure:
//
//   Section A — General Disclosures          (BRSRSectionA.jsx)
//   Section B — Management & Process         (BRSRSectionB.jsx)
//   Section C — Principle-wise Performance   (9 principles, each own component)
//                P1  Ethics & Transparency   (BRSRPrincipleForm + schema ✓)
//                P2  Product Lifecycle       (BRSRPrincipleForm + schema ✓)
//                P3  Employee Wellbeing      (BRSRPrincipleForm + schema ✓)
//                P4  Stakeholder Engagement  (BRSRPrincipleForm + schema ✓)
//                P5  Human Rights            (BRSRPrincipleForm + schema ✓)
//                P6  Environment             (BRSREnvironmental.jsx ✓ bespoke)
//                P7  Public Policy           (BRSRPrincipleForm + schema ✓)
//                P8  Inclusive Growth        (BRSRPrincipleForm + schema ✓)
//                P9  Consumer Responsibility (BRSRPrincipleForm + schema ✓)
//
// INPUT LAYER ONLY — captures and saves data via /api/brsr/*.
// PDF/XBRL rendering is handled separately by /api/reports/generate.
//
// [FEAT-BRSR-IMPORT] Added "IMPORT FROM PREVIOUS BRSR" button in header.
//   Renders BRSRImportParser modal — extracts Section A entity fields and
//   P6 environmental values from a previous year's BRSR PDF (EtherTrack-
//   generated or standard SEBI/BharatCarbon numbered-question format).
//   On confirm, POSTs directly to /api/brsr/section-a and /api/brsr/environmental.
//   Sections reload naturally on next navigation — no state threading needed.
//
// onDataReady CONTRACT: every child calls onDataReady(payload, sectionId).
// The parent (EmissionTracking.jsx) MUST merge by sectionId, e.g.
//   setBrsrData(prev => ({ ...prev, [sectionId]: payload }))

import React, { useState } from 'react';
import BRSRSectionA      from './BRSRSectionA';
import BRSRSectionB      from './BRSRSectionB';
import BRSRPrincipleForm from './BRSRPrincipleForm';
import { PRINCIPLE_SCHEMAS } from '../data/brsrPrincipleSchemas';
import BRSREnvironmental from './BRSREnvironmental';
import BRSRImportParser  from './BRSRImportParser'; // [FEAT-BRSR-IMPORT]

const TOP_SECTIONS = [
  {
    id: 'section-a',
    label: 'SECTION A',
    sub: 'General Disclosures',
    desc: 'Entity details · Business activities · Employees & workforce · Holding/subsidiary · CSR · Grievance compliance',
    component: BRSRSectionA,
    status: 'ready',
  },
  {
    id: 'section-b',
    label: 'SECTION B',
    sub: 'Management & Process Disclosures',
    desc: 'Policy matrix (P1–P9) · Board approval · Value chain extension · Governance accountability · Review frequency',
    component: BRSRSectionB,
    status: 'ready',
  },
  {
    id: 'section-c',
    label: 'SECTION C',
    sub: 'Principle-wise Performance',
    desc: '9 NGRBC principles · Essential + Leadership indicators per principle',
    component: null,
    status: 'mixed',
  },
];

const PRINCIPLES = [
  { id: 'p1', label: 'P1', sub: 'Ethics, Transparency & Accountability',        component: BRSRPrincipleForm, status: 'ready', essentialCount: 5,  leadCount: 2 },
  { id: 'p2', label: 'P2', sub: 'Product Lifecycle Sustainability & Safety',     component: BRSRPrincipleForm, status: 'ready', essentialCount: 3,  leadCount: 2 },
  { id: 'p3', label: 'P3', sub: 'Employee & Worker Wellbeing',                   component: BRSRPrincipleForm, status: 'ready', essentialCount: 12, leadCount: 5 },
  { id: 'p4', label: 'P4', sub: 'Stakeholder Engagement',                        component: BRSRPrincipleForm, status: 'ready', essentialCount: 2,  leadCount: 2 },
  { id: 'p5', label: 'P5', sub: 'Human Rights',                                  component: BRSRPrincipleForm, status: 'ready', essentialCount: 7,  leadCount: 3 },
  { id: 'p6', label: 'P6', sub: 'Environment',                                   component: BRSREnvironmental, status: 'ready', essentialCount: 8,  leadCount: 3 },
  { id: 'p7', label: 'P7', sub: 'Responsible Public Policy',                     component: BRSRPrincipleForm, status: 'ready', essentialCount: 2,  leadCount: 1 },
  { id: 'p8', label: 'P8', sub: 'Inclusive Growth & Equitable Development',      component: BRSRPrincipleForm, status: 'ready', essentialCount: 5,  leadCount: 2 },
  { id: 'p9', label: 'P9', sub: 'Consumer Responsibility',                       component: BRSRPrincipleForm, status: 'ready', essentialCount: 5,  leadCount: 2 },
];

const currentYear    = new Date().getFullYear();
const REPORT_YEARS   = Array.from({ length: 5 }, (_, i) => currentYear - 3 + i);
const TOTAL_BLOCKS   = 2 + PRINCIPLES.length;
const READY_SECTIONS = TOP_SECTIONS.filter(s => s.component && s.status === 'ready').length;
const READY_PRINCIPLES = PRINCIPLES.filter(p => p.status === 'ready').length;
const READY_TOTAL    = READY_SECTIONS + READY_PRINCIPLES;

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;700;800&display=swap');

:root {
  --bg:#050709; --surf:#0b0f14; --surf2:#0f1419; --surf3:#131920;
  --brd:#1c2836; --brd2:#243348;
  --txt:#eef4ff; --txt2:#c8d8ea; --mut:#5a7a96;
  --grn:#10b981; --grn2:#059669;
  --red:#ef4444; --ylw:#f59e0b; --s2:#3b82f6; --pur:#a855f7; --org:#f97316;
}

.bd { min-height:100vh; background:var(--bg); font-family:'Space Mono',monospace; color:var(--txt); }
.bd::before {
  content:''; position:fixed; inset:0; z-index:0; pointer-events:none;
  background:
    radial-gradient(ellipse 700px 400px at 15% 0%, #10b98106 0%, transparent 70%),
    radial-gradient(ellipse 500px 300px at 85% 100%, #3b82f604 0%, transparent 70%);
}
.bd-in { position:relative; z-index:1; max-width:1280px; margin:0 auto; padding:24px 28px 0; }

/* Header */
.bd-hd { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:16px; padding-bottom:16px; border-bottom:1px solid var(--brd); }
.bd-label { font-size:9px; letter-spacing:.18em; color:var(--mut); margin-bottom:5px; text-transform:uppercase; }
.bd-title { font-family:'Syne',sans-serif; font-size:22px; font-weight:800; letter-spacing:-.02em; }
.bd-title span { color:var(--grn); }
.bd-title-note { font-size:10px; color:var(--mut); margin-top:4px; letter-spacing:.04em; }
.bd-yr { display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
.bd-yr-sel { padding:7px 12px; border-radius:6px; background:var(--surf2); border:1px solid var(--brd2); color:var(--txt); font-family:'Space Mono',monospace; font-size:11px; outline:none; transition:border-color .2s; }
.bd-yr-sel:focus { border-color:var(--grn); }

/* [FEAT-BRSR-IMPORT] Import button */
.bd-import-btn {
  padding:7px 14px; border-radius:6px; cursor:pointer;
  background:#10b98110; border:1px solid #10b98133;
  color:#10b981; font-family:'Space Mono',monospace;
  font-size:10px; font-weight:700; letter-spacing:.08em;
  transition:all .2s; white-space:nowrap;
}
.bd-import-btn:hover { background:#10b98120; border-color:#10b98166; }

/* Coverage bar */
.bd-coverage {
  display:flex; align-items:center; gap:12px;
  padding:11px 18px; border-radius:8px;
  background:var(--surf); border:1px solid var(--brd);
  margin-bottom:18px; font-size:11px;
}
.bd-cov-label { color:var(--mut); letter-spacing:.08em; font-size:10px; white-space:nowrap; }
.bd-cov-bar { flex:1; height:5px; border-radius:3px; background:var(--brd); overflow:hidden; }
.bd-cov-fill { height:100%; background:linear-gradient(90deg,var(--grn),#34d399); border-radius:3px; transition:width .6s ease; }
.bd-cov-pct { color:var(--grn); font-weight:700; white-space:nowrap; }
.bd-cov-note { font-size:9px; color:var(--mut); }

/* Section picker */
.bd-sections { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:0; }
.bd-sec-card {
  padding:18px 20px; border-radius:10px;
  border:1px solid var(--brd); background:var(--surf2);
  cursor:pointer; transition:all .2s; position:relative; overflow:hidden;
}
.bd-sec-card::before { content:''; position:absolute; inset:0; background:linear-gradient(135deg,var(--ac,#fff)05,transparent 60%); pointer-events:none; }
.bd-sec-card:hover { border-color:var(--ac,var(--brd2)); transform:translateY(-1px); }
.bd-sec-card.on { border-color:var(--ac,var(--grn)); background:var(--surf3); box-shadow:0 0 0 1px var(--ac,var(--grn))18; }
.bd-sec-lbl { font-family:'Syne',sans-serif; font-size:16px; font-weight:800; margin-bottom:3px; }
.bd-sec-sub { font-size:11px; color:var(--txt2); margin-bottom:8px; }
.bd-sec-desc { font-size:9px; color:var(--mut); line-height:1.7; margin-bottom:10px; }
.bd-sec-footer { display:flex; align-items:center; justify-content:space-between; }
.bd-tag { font-size:8px; padding:2px 7px; border-radius:4px; letter-spacing:.06em; font-weight:700; }
.bd-tag-ready   { background:#10b98114; color:var(--grn);  border:1px solid #10b98130; }
.bd-tag-planned { background:#5a7a9614; color:var(--mut);  border:1px solid #5a7a9630; }
.bd-tag-mixed   { background:#f59e0b14; color:var(--ylw);  border:1px solid #f59e0b30; }
.bd-sec-arrow { font-size:14px; color:var(--mut); transition:transform .2s; }
.bd-sec-card.on .bd-sec-arrow { transform:rotate(90deg); color:var(--grn); }

/* Principle picker */
.bd-principles-wrap {
  margin-top:12px; padding:16px 20px 12px;
  background:var(--surf); border:1px solid var(--brd); border-radius:10px;
  animation:fadeUp .25s ease both;
}
.bd-principles-label { font-size:9px; letter-spacing:.16em; color:var(--mut); margin-bottom:12px; text-transform:uppercase; }
.bd-principles { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
.bd-p-card {
  padding:12px 14px; border-radius:8px;
  border:1px solid var(--brd); background:var(--surf2);
  cursor:pointer; transition:all .15s;
}
.bd-p-card:hover { border-color:var(--brd2); background:var(--surf3); }
.bd-p-card.on { border-color:var(--grn); background:#10b98110; }
.bd-p-card.planned { opacity:.6; }
.bd-p-lbl { font-size:12px; font-weight:700; margin-bottom:3px; display:flex; align-items:center; gap:6px; }
.bd-p-sub { font-size:9px; color:var(--mut); line-height:1.5; margin-bottom:8px; }
.bd-p-counts { display:flex; gap:8px; }
.bd-p-count { font-size:8px; padding:1px 6px; border-radius:3px; letter-spacing:.04em; }
.bd-p-ess   { background:#3b82f614; color:#60a5fa; border:1px solid #3b82f630; }
.bd-p-lead  { background:#a855f714; color:#c084fc; border:1px solid #a855f730; }
.bd-p-ready-badge   { font-size:8px; padding:1px 6px; border-radius:3px; background:#10b98114; color:var(--grn); border:1px solid #10b98130; }
.bd-p-planned-badge { font-size:8px; padding:1px 6px; border-radius:3px; background:#5a7a9614; color:var(--mut); border:1px solid #5a7a9630; }

/* Breadcrumb */
.bd-crumb {
  display:flex; align-items:center; gap:6px;
  font-size:10px; color:var(--mut); letter-spacing:.06em;
  margin:16px 0 12px; padding-bottom:12px; border-bottom:1px solid var(--brd);
}
.bd-crumb-sep { opacity:.4; }
.bd-crumb-active { color:var(--grn); }

/* [FEAT-BRSR-IMPORT] Import success banner */
.bd-import-banner {
  display:flex; align-items:center; gap:10px;
  padding:10px 16px; border-radius:8px; margin-bottom:14px;
  background:#10b98108; border:1px solid #10b98133;
  font-size:11px; color:#10b981; animation:fadeUp .3s ease both;
}
.bd-import-banner-close {
  margin-left:auto; background:none; border:none;
  color:#10b98166; cursor:pointer; font-size:14px; padding:0 4px;
}
.bd-import-banner-close:hover { color:#10b981; }

/* Placeholder */
.bd-placeholder {
  padding:64px 40px; text-align:center;
  background:var(--surf); border:1px dashed var(--brd2);
  border-radius:12px; margin:16px 28px 28px; animation:fadeUp .3s ease both;
}
.bd-ph-icon { font-size:36px; margin-bottom:16px; opacity:.5; }
.bd-ph-title { font-family:'Syne',sans-serif; font-size:18px; font-weight:800; margin-bottom:8px; }
.bd-ph-body  { font-size:11px; color:var(--mut); max-width:440px; margin:0 auto 20px; line-height:1.9; }
.bd-ph-meta  { display:flex; gap:8px; justify-content:center; flex-wrap:wrap; }
.bd-content { position:relative; z-index:1; }

@keyframes fadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
@media(max-width:900px) { .bd-sections{grid-template-columns:1fr;} .bd-principles{grid-template-columns:1fr 1fr;} }
@media(max-width:600px) { .bd-principles{grid-template-columns:1fr;} }
`;

function Placeholder({ title, sub, essentialCount, leadCount }) {
  return (
    <div className="bd-placeholder">
      <div className="bd-ph-icon">🛠</div>
      <div className="bd-ph-title">{title}</div>
      <div className="bd-ph-body">
        {sub}<br/>
        This section follows the same Essential / Leadership tab pattern as P6.
        It'll be built out next — data structure and API route will match the existing pattern exactly.
      </div>
      {(essentialCount || leadCount) && (
        <div className="bd-ph-meta">
          {essentialCount && <span style={{fontSize:10,padding:'3px 10px',borderRadius:4,background:'#3b82f614',color:'#60a5fa',border:'1px solid #3b82f630'}}>{essentialCount} Essential Indicators</span>}
          {leadCount      && <span style={{fontSize:10,padding:'3px 10px',borderRadius:4,background:'#a855f714',color:'#c084fc',border:'1px solid #a855f730'}}>{leadCount} Leadership Indicators</span>}
        </div>
      )}
    </div>
  );
}

export default function BRSRDisclosures({ profile, onDataReady }) {
  const [year,          setYear]          = useState(currentYear);
  const [sectionId,     setSectionId]     = useState('section-a');
  const [principleId,   setPrincipleId]   = useState('p6');
  const [showImport,    setShowImport]    = useState(false);    // [FEAT-BRSR-IMPORT]
  const [importBanner,  setImportBanner]  = useState(null);     // [FEAT-BRSR-IMPORT] success message

  const activeSection   = TOP_SECTIONS.find(s => s.id === sectionId) || TOP_SECTIONS[0];
  const activePrinciple = PRINCIPLES.find(p => p.id === principleId) || PRINCIPLES[5];
  const rollupPct       = Math.round((READY_TOTAL / TOTAL_BLOCKS) * 100);

  const sectionColors = { 'section-a': '#f97316', 'section-b': '#3b82f6', 'section-c': '#10b981' };
  const accentFor = (id) => sectionColors[id] || '#10b981';

  const makeOnDataReady = (key) => (payload) => onDataReady?.(payload, key);

  // [FEAT-BRSR-IMPORT] After parser POSTs to the APIs, navigate to the first
  // imported section so the user sees the pre-filled form immediately.
  const handleImportComplete = (importedIds) => {
    setShowImport(false);
    const sectionLabel = importedIds.includes('section-a') ? 'Section A' : 'P6 Environmental';
    setImportBanner(`✓ ${sectionLabel} pre-filled from previous BRSR — review each field and save to confirm`);
    if (importedIds.includes('section-a')) setSectionId('section-a');
    else if (importedIds.includes('environmental')) setSectionId('section-c');
  };

  const renderContent = () => {
    if (sectionId === 'section-a') {
      const Comp = TOP_SECTIONS[0].component;
      return Comp
        ? <div className="bd-content"><Comp profile={profile} year={year} onDataReady={makeOnDataReady('section-a')} /></div>
        : <Placeholder title="Section A — General Disclosures" sub="Entity details, business activities, workforce, structure, grievance."/>;
    }
    if (sectionId === 'section-b') {
      const Comp = TOP_SECTIONS[1].component;
      return Comp
        ? <div className="bd-content"><Comp profile={profile} year={year} onDataReady={makeOnDataReady('section-b')} /></div>
        : <Placeholder title="Section B — Management & Process Disclosures" sub="Policy matrix covering all 9 principles plus governance accountability."/>;
    }
    if (sectionId === 'section-c') {
      const PComp = activePrinciple.component;
      const isGeneric = PComp === BRSRPrincipleForm;
      return PComp
        ? <div className="bd-content">
            <PComp
              profile={profile}
              year={year}
              schema={isGeneric ? PRINCIPLE_SCHEMAS[activePrinciple.id] : undefined}
              principleLabel={isGeneric ? activePrinciple.label : undefined}
              principleSub={isGeneric ? activePrinciple.sub : undefined}
              onDataReady={makeOnDataReady(activePrinciple.id)}
            />
          </div>
        : <Placeholder
            title={`${activePrinciple.label} — ${activePrinciple.sub}`}
            sub="Will follow the same Essential / Leadership tab pattern as P6."
            essentialCount={activePrinciple.essentialCount}
            leadCount={activePrinciple.leadCount}
          />;
    }
    return null;
  };

  return (
    <>
      <style>{CSS}</style>

      {/* [FEAT-BRSR-IMPORT] Parser modal */}
      {showImport && (
        <BRSRImportParser
          year={year}
          onClose={() => setShowImport(false)}
          onImportComplete={handleImportComplete}
        />
      )}

      <div className="bd">
        <div className="bd-in">

          {/* Header */}
          <div className="bd-hd">
            <div>
              <div className="bd-label">SEBI BRSR CORE · DEC 2024 ISF CIRCULAR · INPUT LAYER ONLY</div>
              <div className="bd-title">BRSR <span>Disclosures</span></div>
              <div className="bd-title-note">Section A · Section B · Section C (P1–P9) · PDF rendering via /api/reports/generate</div>
            </div>
            <div className="bd-yr">
              {/* [FEAT-BRSR-IMPORT] Import trigger */}
              <button className="bd-import-btn" onClick={() => setShowImport(true)}>
                ↑ IMPORT FROM PREVIOUS BRSR
              </button>
              <label style={{fontSize:10,color:'var(--mut)',letterSpacing:'.1em'}}>FY</label>
              <select className="bd-yr-sel" value={year} onChange={e => setYear(parseInt(e.target.value, 10))}>
                {REPORT_YEARS.map(y => <option key={y}>{y}</option>)}
              </select>
            </div>
          </div>

          {/* [FEAT-BRSR-IMPORT] Success banner */}
          {importBanner && (
            <div className="bd-import-banner">
              <span>{importBanner}</span>
              <button className="bd-import-banner-close" onClick={() => setImportBanner(null)}>✕</button>
            </div>
          )}

          {/* Coverage bar */}
          <div className="bd-coverage">
            <span className="bd-cov-label">STRUCTURAL COVERAGE</span>
            <div className="bd-cov-bar"><div className="bd-cov-fill" style={{width:`${rollupPct}%`}}/></div>
            <span className="bd-cov-pct">{rollupPct}%</span>
            <span className="bd-cov-note">{READY_TOTAL} / {TOTAL_BLOCKS} building blocks built</span>
          </div>

          {/* Section picker */}
          <div className="bd-sections">
            {TOP_SECTIONS.map(s => {
              const color    = accentFor(s.id);
              const tagClass = s.status === 'ready' ? 'bd-tag-ready' : s.status === 'mixed' ? 'bd-tag-mixed' : 'bd-tag-planned';
              const tagLabel = s.status === 'ready' ? 'READY' : s.status === 'mixed'
                ? `${READY_PRINCIPLES}/${PRINCIPLES.length} BUILT` : 'PLANNED';
              return (
                <div
                  key={s.id}
                  className={`bd-sec-card${sectionId === s.id ? ' on' : ''}`}
                  style={{'--ac': color}}
                  onClick={() => setSectionId(s.id)}
                >
                  <div className="bd-sec-lbl" style={{color}}>{s.label}</div>
                  <div className="bd-sec-sub">{s.sub}</div>
                  <div className="bd-sec-desc">{s.desc}</div>
                  <div className="bd-sec-footer">
                    <span className={`bd-tag ${tagClass}`}>{tagLabel}</span>
                    <span className="bd-sec-arrow">›</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Principle picker (Section C only) */}
          {sectionId === 'section-c' && (
            <div className="bd-principles-wrap">
              <div className="bd-principles-label">SELECT PRINCIPLE</div>
              <div className="bd-principles">
                {PRINCIPLES.map(p => (
                  <div
                    key={p.id}
                    className={`bd-p-card${principleId === p.id ? ' on' : ''}${p.status === 'planned' ? ' planned' : ''}`}
                    onClick={() => setPrincipleId(p.id)}
                  >
                    <div className="bd-p-lbl">
                      {p.label}
                      {p.status === 'ready'
                        ? <span className="bd-p-ready-badge">✓ BUILT</span>
                        : <span className="bd-p-planned-badge">PLANNED</span>
                      }
                    </div>
                    <div className="bd-p-sub">{p.sub}</div>
                    <div className="bd-p-counts">
                      <span className="bd-p-count bd-p-ess">{p.essentialCount} Essential</span>
                      <span className="bd-p-count bd-p-lead">{p.leadCount} Leadership</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Breadcrumb */}
          <div className="bd-crumb">
            <span>BRSR Disclosures</span>
            <span className="bd-crumb-sep">›</span>
            <span>{activeSection.label}</span>
            {sectionId === 'section-c' && (
              <>
                <span className="bd-crumb-sep">›</span>
                <span className="bd-crumb-active">{activePrinciple.label} — {activePrinciple.sub}</span>
              </>
            )}
            {sectionId !== 'section-c' && (
              <>
                <span className="bd-crumb-sep">›</span>
                <span className="bd-crumb-active">{activeSection.sub}</span>
              </>
            )}
          </div>

        </div>

        {renderContent()}
      </div>
    </>
  );
}