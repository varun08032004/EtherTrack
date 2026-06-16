// src/components/SBTiModule.jsx - 28/05/2026

import React, { useState, useCallback } from 'react';
import { apiFetch } from '../services/api';

const PATHWAYS = {
  '1.5C': {
    label: '1.5°C (SBTi Ambitious)',
    desc: 'Highest ambition — aligns with Paris 1.5°C limit. Requires ~4.2% absolute reduction per year.',
    nearTermReduction: 42,   // % reduction from base year by 2030 (10-year near-term)
    longTermReduction: 90,   // % reduction from base year by 2050 (net-zero standard)
    annualRate: 4.2,         // % per year
    color: '#10b981',
    cdpLevel: 'A',
  },
  'WB2C': {
    label: 'Well-Below 2°C',
    desc: 'Strong ambition — aligns with Paris well-below 2°C. Requires ~2.5% absolute reduction per year.',
    nearTermReduction: 25,
    longTermReduction: 90,
    annualRate: 2.5,
    color: '#3b82f6',
    cdpLevel: 'A-',
  },
  '2C': {
    label: '2°C',
    desc: 'Minimum ambition — Paris 2°C alignment. 1.5% absolute reduction per year.',
    nearTermReduction: 15,
    longTermReduction: 90,
    annualRate: 1.5,
    color: '#f59e0b',
    cdpLevel: 'B',
  },
};

// SBTi sector classifications (simplified)
const SBTI_SECTORS = {
  'Manufacturing':  'Industry',
  'IT/Software':    'Services',
  'Finance':        'Financial Institutions',
  'Healthcare':     'Services',
  'Retail':         'Retail',
  'Logistics':      'Transport',
  'Construction':   'Buildings',
  'Energy':         'Power',
  'Agriculture':    'Agriculture, Forestry & Land Use',
  'Education':      'Services',
  'Other':          'Other',
};

const fmt = (n, d = 2) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });

const sanitise = (s = '', max = 200) =>
  String(s).replace(/<[^>]*>/g, '').replace(/['"`;]/g, '').trim().slice(0, max);

// ─────────────────────────────────────────────────────────────────────────────
// CSS
// ─────────────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap');
:root{--bg:#04060a;--surf:#080c12;--brd:#182030;--brd2:#1e2a3a;--txt:#e8f0ff;--mut:#3a5070;--grn:#10b981;--red:#ef4444;--ylw:#f59e0b;--blu:#3b82f6;--pur:#a855f7;}
.sbti{min-height:100vh;background:var(--bg);font-family:'Space Mono',monospace;color:var(--txt);}
.sbti-in{max-width:1200px;margin:0 auto;padding:28px 24px 80px;}
.sbti-hd{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--brd);}
.sbti-label{font-size:9px;letter-spacing:.2em;color:var(--mut);}
.sbti-title{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;margin-top:3px;}
.sbti-title span{color:#10b981;}
.sbti-card{background:var(--surf);border:1px solid var(--brd);border-radius:10px;padding:18px 20px;margin-bottom:14px;}
.sbti-ctit{font-size:9px;letter-spacing:.15em;color:var(--mut);margin-bottom:14px;display:flex;align-items:center;gap:8px;}
.sbti-ctit::before{content:'';width:10px;height:1px;background:var(--grn);}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}
.g4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}
.fg{display:flex;flex-direction:column;gap:5px;margin-bottom:12px;}
.lbl{font-size:10px;letter-spacing:.1em;color:var(--mut);}
.inp,.sel{padding:9px 11px;border-radius:6px;background:#060a10;border:1px solid var(--brd);color:var(--txt);font-family:'Space Mono',monospace;font-size:12px;outline:none;transition:border-color .2s;width:100%;box-sizing:border-box;}
.inp:focus,.sel:focus{border-color:#10b98144;}
.inp::placeholder{color:var(--mut);opacity:.7;}
.btn{padding:9px 17px;border-radius:6px;border:none;cursor:pointer;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.1em;font-weight:700;transition:all .2s;}
.btn:disabled{opacity:.5;cursor:not-allowed;}
.btn-grn{background:linear-gradient(135deg,#10b981,#059669);color:#fff;}
.btn-grn:hover:not(:disabled){opacity:.85;transform:translateY(-1px);}
.btn-g{background:var(--surf);border:1px solid var(--brd2);color:var(--txt);}
.btn-g:hover:not(:disabled){border-color:#10b98144;color:var(--grn);}
.btn-sm{padding:6px 12px;font-size:10px;}
/* Pathway selector */
.pw-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px;}
.pw-opt{padding:16px;border-radius:10px;border:1px solid var(--brd);cursor:pointer;transition:all .2s;background:var(--bg);}
.pw-opt.sel{background:color-mix(in srgb, var(--ac) 8%, transparent);}
.pw-label{font-size:12px;font-weight:700;margin-bottom:6px;}
.pw-desc{font-size:10px;color:var(--mut);line-height:1.5;margin-bottom:8px;}
.pw-rate{font-size:11px;font-weight:700;}
/* Milestone timeline */
.timeline{display:flex;flex-direction:column;gap:0;}
.tl-row{display:flex;align-items:flex-start;gap:14px;padding:12px 0;border-bottom:1px solid var(--brd)22;}
.tl-dot{width:28px;height:28px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;margin-top:2px;}
.tl-year{font-size:13px;font-weight:700;margin-bottom:3px;}
.tl-desc{font-size:11px;color:var(--mut);line-height:1.6;}
.tl-target{font-family:'Syne',sans-serif;font-size:18px;font-weight:800;margin-top:4px;}
/* Progress bars */
.prog-row{margin-bottom:12px;}
.prog-hd{display:flex;justify-content:space-between;font-size:11px;margin-bottom:5px;}
.prog-track{height:8px;border-radius:4px;background:var(--brd);overflow:hidden;}
.prog-fill{height:100%;border-radius:4px;transition:width 1s ease;}
/* Stats */
.stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;}
.stat{background:#060a10;border-radius:8px;padding:14px;border:1px solid var(--brd);}
.stat-val{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;margin-bottom:2px;}
.stat-lbl{font-size:9px;color:var(--mut);letter-spacing:.1em;}
/* Tabs */
.sbti-tabs{display:flex;gap:0;margin-bottom:18px;border-bottom:1px solid var(--brd);}
.sbti-tab{padding:9px 15px;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.09em;cursor:pointer;border:none;background:none;color:var(--mut);border-bottom:2px solid transparent;transition:all .2s;margin-bottom:-1px;}
.sbti-tab.on{color:var(--grn);border-bottom-color:var(--grn);}
.al{padding:10px 14px;border-radius:7px;font-size:11px;display:flex;gap:8px;margin-bottom:12px;line-height:1.6;}
.al-g{background:#10b98108;border:1px solid #10b98133;color:var(--grn);}
.al-y{background:#f59e0b08;border:1px solid #f59e0b33;color:var(--ylw);}
.al-b{background:#3b82f608;border:1px solid #3b82f633;color:var(--blu);}
.drow{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--brd)22;font-size:11px;}
.drow:last-child{border-bottom:none;}
.pill{display:inline-flex;align-items:center;gap:4px;font-size:9px;padding:3px 9px;border-radius:3px;letter-spacing:.05em;}
.pill-grn{background:#10b98114;color:#10b981;border:1px solid #10b98133;}
.pill-ylw{background:#f59e0b14;color:#f59e0b;border:1px solid #f59e0b33;}
.pill-red{background:#ef444414;color:#ef4444;border:1px solid #ef444433;}
.pill-blu{background:#3b82f614;color:#3b82f6;border:1px solid #3b82f633;}
.notif{position:fixed;top:76px;right:24px;z-index:9999;padding:11px 18px;border-radius:8px;font-family:'Space Mono',monospace;font-size:11px;box-shadow:0 8px 32px #00000088;animation:fU .3s ease;}
.notif-ok{background:#0b2a1e;border:1px solid #10b98133;color:#10b981;}
.notif-err{background:#450a0a;border:1px solid #ef444433;color:#f87171;}
@keyframes fU{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:900px){.g2,.g3,.g4,.stat-row,.pw-grid{grid-template-columns:1fr 1fr;}}
@media(max-width:600px){.stat-row,.pw-grid{grid-template-columns:1fr;}}
`;

// ─────────────────────────────────────────────────────────────────────────────
export default function SBTiModule({ profile, emissions = [], year = new Date().getFullYear() }) {
  const [tab,           setTab]          = useState('setup');
  const [pathway,       setPathway]      = useState('1.5C');
  const [baseYear,      setBaseYear]     = useState(parseInt(profile?.base_year) || 2024);
  const [nearTermYear,  setNearTermYear] = useState(2030);
  const [longTermYear,  setLongTermYear] = useState(2050);
  const [scope1Base,    setScope1Base]   = useState(0);
  const [scope2Base,    setScope2Base]   = useState(0);
  const [scope3Base,    setScope3Base]   = useState(0);
  const [scope3Covered, setScope3Covered]= useState(false); // whether Scope 3 target set
  const [companyName,   setCompanyName]  = useState(sanitise(profile?.company_name || ''));
  const [industry,      setIndustry]     = useState(sanitise(profile?.industry || ''));
  const [contactName,   setContactName]  = useState('');
  const [contactTitle,  setContactTitle] = useState('');
  const [saving,        setSaving]       = useState(false);
  const [notif,         setNotif]        = useState(null);

  const toast = (msg, type = 'ok') => { setNotif({ msg, type }); setTimeout(() => setNotif(null), 4000); };

  const pw = PATHWAYS[pathway];
  const sbtiSector = SBTI_SECTORS[industry] || 'Other';

  // ── Current emissions from ledger ─────────────────────────────────────────
  const currentScope1 = emissions.filter(r => r.scope === 1).reduce((s, r) => s + parseFloat(r.co2e || 0), 0);
  const currentScope2 = emissions.filter(r => r.scope === 2).reduce((s, r) => s + parseFloat(r.co2e || 0), 0);
  const currentScope3 = emissions.filter(r => r.scope === 3).reduce((s, r) => s + parseFloat(r.co2e || 0), 0);

  // Use entered base year values, fall back to current year if not entered
  const baseS1 = scope1Base > 0 ? scope1Base : currentScope1;
  const baseS2 = scope2Base > 0 ? scope2Base : currentScope2;
  const baseS3 = scope3Base > 0 ? scope3Base : currentScope3;
  const baseTotal12 = baseS1 + baseS2;
  const baseTotal   = baseTotal12 + (scope3Covered ? baseS3 : 0);

  const yearsFromBase     = nearTermYear - baseYear;
  const yearsToNetZero    = longTermYear - baseYear;
  const yearsElapsed      = year - baseYear;

  // ── Target calculations ───────────────────────────────────────────────────
  // Near-term target (absolute contraction approach)
  const nearTermTarget12   = baseTotal12 * (1 - pw.nearTermReduction / 100);
  const nearTermTargetS3   = scope3Covered ? baseS3 * (1 - pw.nearTermReduction * 0.67 / 100) : null; // Scope 3 = 2/3 of Scope 1+2 rate per SBTi
  const longTermTarget     = baseTotal * (1 - pw.longTermReduction / 100);   // 90% reduction for net-zero

  // Current vs target progress
  const currentTotal12 = currentScope1 + currentScope2;
  const requiredByNow  = baseTotal12 * Math.pow(1 - pw.annualRate / 100, yearsElapsed);
  const onTrack        = currentTotal12 <= requiredByNow;
  const gapToNow       = Math.max(0, currentTotal12 - requiredByNow);

  // Annual reduction required
  const annualReductionS12 = baseTotal12 * pw.annualRate / 100;

  // ── Generate milestones ───────────────────────────────────────────────────
  const milestones = [];
  for (let y = baseYear; y <= longTermYear; y += 5) {
    const yearsOut  = y - baseYear;
    const target    = baseTotal12 * Math.pow(1 - pw.annualRate / 100, yearsOut);
    const pct       = ((baseTotal12 - target) / baseTotal12 * 100).toFixed(1);
    milestones.push({ year: y, target, pct, isBase: y === baseYear, isNear: y === nearTermYear, isLong: y === longTermYear });
  }
  // Ensure near-term and long-term years are in milestones
  if (!milestones.find(m => m.year === nearTermYear)) {
    const yearsOut = nearTermYear - baseYear;
    const target   = baseTotal12 * Math.pow(1 - pw.annualRate / 100, yearsOut);
    milestones.push({ year: nearTermYear, target, pct: ((baseTotal12 - target) / baseTotal12 * 100).toFixed(1), isNear: true });
    milestones.sort((a, b) => a.year - b.year);
  }

  // ── Export SBTi commitment letter ─────────────────────────────────────────
  const exportCommitmentLetter = () => {
    const doc = {
      document_type:       'SBTi Commitment Letter',
      sbti_standard:       'SBTi Corporate Standard v2.0 (2023)',
      net_zero_standard:   'SBTi Net-Zero Standard v1.1 (2023)',
      generated_at:        new Date().toISOString(),
      organisation: {
        name:              sanitise(companyName),
        cin:               sanitise(profile?.company_cin || ''),
        gstin:             sanitise(profile?.company_gstin || ''),
        industry:          sanitise(industry),
        sbti_sector:       sbtiSector,
        contact_name:      sanitise(contactName),
        contact_title:     sanitise(contactTitle),
      },
      commitment: {
        pathway:           pw.label,
        temperature_goal:  pathway === '1.5C' ? '1.5°C' : pathway === 'WB2C' ? 'Well-below 2°C' : '2°C',
        base_year:         baseYear,
        scope_coverage:    scope3Covered ? 'Scope 1, 2, and 3' : 'Scope 1 and 2',
        ghg_protocol_boundary: 'Operational Control',
      },
      base_year_emissions: {
        scope1_tco2e:      baseS1,
        scope2_tco2e:      baseS2,
        scope3_tco2e:      scope3Covered ? baseS3 : null,
        total_s12_tco2e:   baseTotal12,
        data_source:       `FY ${baseYear} GHG inventory — EtherTrack Carbon Intelligence`,
      },
      near_term_target: {
        target_year:       nearTermYear,
        description:       `Reduce absolute Scope 1 and 2 GHG emissions ${pw.nearTermReduction}% by ${nearTermYear} from a ${baseYear} base year`,
        scope12_target_tco2e:   nearTermTarget12,
        scope3_target_tco2e:    nearTermTargetS3,
        annual_reduction_rate:  `${pw.annualRate}% per year (Absolute Contraction Approach)`,
        sbti_validation_status: 'COMMITTED — pending SBTi validation',
        cdp_equivalent:        `CDP ${pw.cdpLevel}-list`,
      },
      long_term_target: {
        target_year:       longTermYear,
        description:       `Reach net-zero GHG emissions across Scope 1, 2, and 3 by ${longTermYear}`,
        total_target_tco2e: longTermTarget,
        reduction_pct:     pw.longTermReduction,
        residual_emissions: longTermTarget,
        offset_strategy:   'Residual emissions to be offset via carbon credits — EtherTrack retirement workflow',
        sbti_validation_status: 'COMMITTED — pending SBTi validation',
      },
      india_ndc_alignment: {
        india_ndc_2030:    '45% emissions intensity reduction by 2030 vs 2005 baseline (India NDC 2022)',
        alignment_note:    pathway === '1.5C' ? 'This target exceeds India NDC ambition and aligns with IPCC AR6 1.5°C pathway' : 'This target meets India NDC ambition',
      },
      current_performance: {
        reporting_year:    year,
        current_scope1_tco2e: currentScope1,
        current_scope2_tco2e: currentScope2,
        current_scope3_tco2e: currentScope3,
        on_track_near_term: onTrack,
        gap_to_pathway:    gapToNow > 0 ? `${fmt(gapToNow, 2)} tCO₂e above pathway trajectory` : 'On track',
      },
      submission_instructions: [
        '1. Go to sciencebasedtargets.org/companies-taking-action',
        '2. Click "Commit to a science-based target"',
        '3. Complete the online commitment form using the data above',
        '4. Submit targets for SBTi validation (typically 6-9 months)',
        '5. Once validated, targets appear on the SBTi company dashboard',
        '6. Report progress annually via CDP climate questionnaire (C4 section)',
      ],
    };

    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
    const a   = document.createElement('a');
    a.href    = url;
    a.download = `SBTi_Commitment_${sanitise(companyName).replace(/\s+/g, '_') || 'entity'}_${baseYear}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast('✓ SBTi commitment letter exported — submit at sciencebasedtargets.org');
  };

  const exportCSV = () => {
    const rows = [
      'Milestone Year,Target Scope 1+2 (tCO₂e),% Reduction from Base,Notes',
      ...milestones.map(m => `${m.year},${m.target.toFixed(2)},${m.pct}%,${m.isBase ? 'Base Year' : m.isNear ? 'Near-Term Target' : m.isLong ? 'Net Zero Target' : 'Interim milestone'}`),
    ].join('\n');
    const url = URL.createObjectURL(new Blob([rows], { type: 'text/csv' }));
    const a   = document.createElement('a');
    a.href    = url;
    a.download = `SBTi_Pathway_${pathway}_${baseYear}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast('✓ SBTi pathway CSV exported');
  };

  const progressPct = baseTotal12 > 0 ? Math.min(100, Math.max(0, (baseTotal12 - currentTotal12) / baseTotal12 * 100)) : 0;
  const requiredPct = baseTotal12 > 0 ? Math.min(100, Math.max(0, (baseTotal12 - requiredByNow) / baseTotal12 * 100)) : 0;

  return (
    <>
      <style>{CSS}</style>
      {notif && <div className={`notif notif-${notif.type}`}>{notif.msg}</div>}

      <div className="sbti">
        <div className="sbti-in">

          {/* Header */}
          <div className="sbti-hd">
            <div>
              <div className="sbti-label">SCIENCE BASED TARGETS INITIATIVE · SBTi CORPORATE STANDARD v2.0 · NET-ZERO STANDARD v1.1</div>
              <div className="sbti-title">SBTi <span>Target Setting</span></div>
              <div style={{ fontSize:10, color:'var(--mut)', marginTop:2 }}>
                Near-term + Long-term targets · Absolute Contraction Approach · CDP C4 · Paris 1.5°C / WB2°C
                {companyName && ` · ${companyName}`}
              </div>
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'flex-end' }}>
              <span className={`pill ${pathway === '1.5C' ? 'pill-grn' : pathway === 'WB2C' ? 'pill-blu' : 'pill-ylw'}`}>
                {pw.label}
              </span>
              <span className={`pill ${onTrack ? 'pill-grn' : 'pill-red'}`}>
                {baseTotal12 > 0 ? (onTrack ? 'ON TRACK ✓' : 'BELOW PATHWAY') : 'ENTER BASE YEAR'}
              </span>
              <button className="btn btn-grn btn-sm" onClick={exportCommitmentLetter}>EXPORT COMMITMENT LETTER →</button>
              <button className="btn btn-g btn-sm" onClick={exportCSV}>EXPORT PATHWAY CSV</button>
            </div>
          </div>

          {/* Alert */}
          <div className="al al-b">
            <span>ℹ</span>
            <span>
              <strong>SBTi submission process:</strong> Set your targets below → export the commitment letter → submit at sciencebasedtargets.org. SBTi validation typically takes 6-9 months. Once validated, your targets will appear on the SBTi company dashboard and qualify for CDP A-list scoring.
            </span>
          </div>

          {/* Stats */}
          <div className="stat-row">
            <div className="stat">
              <div className="stat-lbl">BASE YEAR S1+S2</div>
              <div className="stat-val" style={{ color:'#ef4444' }}>{fmt(baseTotal12, 1)}</div>
              <div style={{ fontSize:9, color:'var(--mut)' }}>tCO₂e · FY {baseYear}</div>
            </div>
            <div className="stat">
              <div className="stat-lbl">NEAR-TERM TARGET ({nearTermYear})</div>
              <div className="stat-val" style={{ color:'#3b82f6' }}>{baseTotal12 > 0 ? fmt(nearTermTarget12, 1) : '—'}</div>
              <div style={{ fontSize:9, color:'var(--mut)' }}>tCO₂e · -{pw.nearTermReduction}%</div>
            </div>
            <div className="stat">
              <div className="stat-lbl">NET ZERO TARGET ({longTermYear})</div>
              <div className="stat-val" style={{ color:'#10b981' }}>{baseTotal12 > 0 ? fmt(longTermTarget, 1) : '—'}</div>
              <div style={{ fontSize:9, color:'var(--mut)' }}>tCO₂e · -{pw.longTermReduction}%</div>
            </div>
            <div className="stat">
              <div className="stat-lbl">CDP EQUIVALENT</div>
              <div className="stat-val" style={{ color: pathway === '1.5C' ? '#10b981' : '#3b82f6', fontSize:28 }}>{pw.cdpLevel}</div>
              <div style={{ fontSize:9, color:'var(--mut)' }}>CDP climate score</div>
            </div>
          </div>

          {/* Progress */}
          {baseTotal12 > 0 && (
            <div className="sbti-card" style={{ padding:'14px 18px', marginBottom:14 }}>
              <div className="prog-row">
                <div className="prog-hd">
                  <span style={{ color:'var(--mut)' }}>ACTUAL REDUCTION FROM BASE YEAR</span>
                  <span style={{ color: progressPct >= requiredPct ? '#10b981' : '#ef4444' }}>
                    {fmt(progressPct, 1)}% achieved
                  </span>
                </div>
                <div className="prog-track">
                  <div className="prog-fill" style={{ width:`${progressPct}%`, background: progressPct >= requiredPct ? 'linear-gradient(90deg,#10b981,#34d399)' : 'linear-gradient(90deg,#ef4444,#f59e0b)' }}/>
                </div>
              </div>
              <div className="prog-row">
                <div className="prog-hd">
                  <span style={{ color:'var(--mut)' }}>REQUIRED REDUCTION BY {year} (PATHWAY)</span>
                  <span style={{ color:'#3b82f6' }}>{fmt(requiredPct, 1)}% required</span>
                </div>
                <div className="prog-track">
                  <div className="prog-fill" style={{ width:`${requiredPct}%`, background:'linear-gradient(90deg,#3b82f6,#60a5fa)' }}/>
                </div>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--mut)', marginTop:8 }}>
                <span>Base: {fmt(baseTotal12, 1)} tCO₂e (FY {baseYear})</span>
                <span style={{ color: onTrack ? '#10b981' : '#ef4444' }}>
                  {onTrack ? `✓ ${fmt(requiredByNow - currentTotal12, 1)} tCO₂e ahead of pathway` : `⚠ ${fmt(gapToNow, 1)} tCO₂e behind pathway`}
                </span>
                <span>Near-term: {fmt(nearTermTarget12, 1)} tCO₂e (FY {nearTermYear})</span>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="sbti-tabs">
            {[
              ['setup',      'TARGET SETUP'],
              ['pathway',    'PATHWAY & MILESTONES'],
              ['commitment', 'COMMITMENT LETTER'],
              ['cdp',        'CDP C4 MAPPING'],
            ].map(([k, v]) => (
              <button key={k} className={`sbti-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{v}</button>
            ))}
          </div>

          {/* ══ SETUP ══ */}
          {tab === 'setup' && (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

              {/* Pathway selection */}
              <div className="sbti-card">
                <div className="sbti-ctit">SELECT TEMPERATURE PATHWAY — SBTi CORPORATE STANDARD v2.0</div>
                <div className="pw-grid">
                  {Object.entries(PATHWAYS).map(([key, p]) => (
                    <div key={key}
                      className={`pw-opt${pathway === key ? ' sel' : ''}`}
                      style={{ '--ac': p.color, borderColor: pathway === key ? p.color : undefined }}
                      onClick={() => setPathway(key)}>
                      <div className="pw-label" style={{ color: pathway === key ? p.color : 'var(--txt)' }}>
                        {pathway === key && '✓ '}{p.label}
                      </div>
                      <div className="pw-desc">{p.desc}</div>
                      <div className="pw-rate" style={{ color: p.color }}>
                        -{p.annualRate}%/yr · CDP {p.cdpLevel}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Target configuration */}
              <div className="sbti-card">
                <div className="sbti-ctit">TARGET CONFIGURATION</div>
                <div className="g3">
                  <div className="fg">
                    <label className="lbl">BASE YEAR</label>
                    <select className="sel" value={baseYear} onChange={e => setBaseYear(parseInt(e.target.value))}>
                      {[2019,2020,2021,2022,2023,2024].map(y => <option key={y}>{y}</option>)}
                    </select>
                  </div>
                  <div className="fg">
                    <label className="lbl">NEAR-TERM TARGET YEAR</label>
                    <select className="sel" value={nearTermYear} onChange={e => setNearTermYear(parseInt(e.target.value))}>
                      {[2028,2029,2030,2031,2032].map(y => <option key={y}>{y}</option>)}
                    </select>
                  </div>
                  <div className="fg">
                    <label className="lbl">LONG-TERM (NET ZERO) YEAR</label>
                    <select className="sel" value={longTermYear} onChange={e => setLongTermYear(parseInt(e.target.value))}>
                      {[2045,2050,2055].map(y => <option key={y}>{y}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ marginBottom:12 }}>
                  <label className="lbl" style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                    <input type="checkbox" checked={scope3Covered} onChange={e => setScope3Covered(e.target.checked)} style={{ accentColor:'var(--grn)' }}/>
                    <span>Include Scope 3 in target boundary (recommended for large companies)</span>
                  </label>
                  <div style={{ fontSize:10, color:'var(--mut)', marginTop:4, marginLeft:24 }}>SBTi requires Scope 3 if it exceeds 40% of total emissions. You can still commit without Scope 3 initially.</div>
                </div>
              </div>

              {/* Base year emissions */}
              <div className="sbti-card">
                <div className="sbti-ctit">BASE YEAR EMISSIONS — FY {baseYear}</div>
                <div className="al al-b">
                  <span>ℹ</span>
                  <span>Current year values auto-populated from your GHG ledger. Enter your base year values if different (e.g. your base year is 2019 but current year is 2024).</span>
                </div>
                <div className="g3">
                  <div className="fg">
                    <label className="lbl">SCOPE 1 — FY {baseYear} (tCO₂e)</label>
                    <input className="inp" type="number" step="0.1" min="0"
                      placeholder={`Current year: ${fmt(currentScope1, 2)}`}
                      value={scope1Base || ''} onChange={e => setScope1Base(parseFloat(e.target.value) || 0)}/>
                  </div>
                  <div className="fg">
                    <label className="lbl">SCOPE 2 — FY {baseYear} (tCO₂e)</label>
                    <input className="inp" type="number" step="0.1" min="0"
                      placeholder={`Current year: ${fmt(currentScope2, 2)}`}
                      value={scope2Base || ''} onChange={e => setScope2Base(parseFloat(e.target.value) || 0)}/>
                  </div>
                  {scope3Covered && (
                    <div className="fg">
                      <label className="lbl">SCOPE 3 — FY {baseYear} (tCO₂e)</label>
                      <input className="inp" type="number" step="0.1" min="0"
                        placeholder={`Current year: ${fmt(currentScope3, 2)}`}
                        value={scope3Base || ''} onChange={e => setScope3Base(parseFloat(e.target.value) || 0)}/>
                    </div>
                  )}
                </div>

                {/* Company details for commitment letter */}
                <div style={{ borderTop:'1px solid var(--brd)', paddingTop:14, marginTop:8 }}>
                  <div style={{ fontSize:10, letterSpacing:'.1em', color:'var(--mut)', marginBottom:12 }}>FOR COMMITMENT LETTER EXPORT</div>
                  <div className="g2">
                    <div className="fg">
                      <label className="lbl">AUTHORISED SIGNATORY NAME</label>
                      <input className="inp" type="text" maxLength={200} placeholder="CEO / MD / CSO name"
                        value={contactName} onChange={e => setContactName(e.target.value)}/>
                    </div>
                    <div className="fg">
                      <label className="lbl">TITLE / DESIGNATION</label>
                      <input className="inp" type="text" maxLength={200} placeholder="Chief Executive Officer"
                        value={contactTitle} onChange={e => setContactTitle(e.target.value)}/>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══ PATHWAY & MILESTONES ══ */}
          {tab === 'pathway' && (
            <div className="sbti-card">
              <div className="sbti-ctit">EMISSION REDUCTION PATHWAY — {pw.label} — BASE YEAR FY {baseYear}</div>
              {baseTotal12 === 0 ? (
                <div className="al al-y"><span>⚠</span><span>Enter base year Scope 1+2 emissions in Target Setup to see pathway milestones.</span></div>
              ) : (
                <div className="timeline">
                  {milestones.map(m => {
                    const color = m.isBase ? '#ef4444' : m.isNear ? '#3b82f6' : m.isLong ? '#10b981' : 'var(--mut)';
                    return (
                      <div key={m.year} className="tl-row">
                        <div className="tl-dot" style={{ background: `${color}18`, border:`1px solid ${color}44`, color }}>
                          {m.isBase ? '●' : m.isNear ? '◆' : m.isLong ? '★' : '○'}
                        </div>
                        <div style={{ flex:1 }}>
                          <div className="tl-year" style={{ color }}>
                            FY {m.year}
                            {m.isBase && ' — Base Year'}
                            {m.isNear && ' — Near-Term SBTi Target'}
                            {m.isLong && ' — Net Zero (Long-Term SBTi Target)'}
                          </div>
                          <div className="tl-target" style={{ color }}>
                            {fmt(m.target, 1)} tCO₂e
                          </div>
                          <div className="tl-desc">
                            -{m.pct}% from base year · Annual reduction: {fmt(annualReductionS12, 1)} tCO₂e/yr ({pw.annualRate}% ACA)
                            {scope3Covered && nearTermTargetS3 && m.isNear && ` · Scope 3 target: ${fmt(nearTermTargetS3, 1)} tCO₂e`}
                          </div>
                        </div>
                        <div style={{ textAlign:'right', fontSize:10, color:'var(--mut)' }}>
                          <span className={`pill ${m.isBase ? 'pill-red' : m.isLong ? 'pill-grn' : 'pill-blu'}`}>
                            {m.isBase ? 'BASE' : m.isLong ? 'NET ZERO' : `${m.pct}% ↓`}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ══ COMMITMENT LETTER ══ */}
          {tab === 'commitment' && (
            <div className="sbti-card">
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                <div className="sbti-ctit" style={{ marginBottom:0 }}>SBTi COMMITMENT LETTER — READY TO SUBMIT</div>
                <button className="btn btn-grn btn-sm" onClick={exportCommitmentLetter}>EXPORT JSON →</button>
              </div>
              {[
                ['Company',                   sanitise(companyName) || '—'],
                ['SBTi Sector Classification', sbtiSector],
                ['Temperature Pathway',        pw.label],
                ['Base Year',                  `FY ${baseYear}`],
                ['Near-Term Target Year',      String(nearTermYear)],
                ['Long-Term (Net Zero) Year',  String(longTermYear)],
                ['Scope Coverage',             scope3Covered ? 'Scope 1, 2, and 3' : 'Scope 1 and 2'],
                ['Base Year S1+S2 Emissions',  `${fmt(baseTotal12, 2)} tCO₂e`],
                ['Near-Term S1+S2 Target',     baseTotal12 > 0 ? `${fmt(nearTermTarget12, 2)} tCO₂e (-${pw.nearTermReduction}%)` : '—'],
                scope3Covered && nearTermTargetS3 ? ['Near-Term Scope 3 Target', `${fmt(nearTermTargetS3, 2)} tCO₂e`] : null,
                ['Long-Term (Net Zero) Target', baseTotal12 > 0 ? `${fmt(longTermTarget, 2)} tCO₂e (-${pw.longTermReduction}%)` : '—'],
                ['Annual Reduction Rate',       `${pw.annualRate}% per year (Absolute Contraction Approach)`],
                ['CDP Equivalent Score',        `CDP ${pw.cdpLevel}`],
                ['India NDC Alignment',         pathway === '1.5C' ? 'Exceeds India NDC — aligned with IPCC AR6 1.5°C' : 'Meets India NDC ambition'],
                ['Current Year Performance',    onTrack && baseTotal12 > 0 ? '✓ On track' : baseTotal12 > 0 ? `⚠ ${fmt(gapToNow, 1)} tCO₂e behind pathway` : '—'],
                ['Authorised Signatory',        sanitise(contactName) || '—'],
                ['Submission URL',              'sciencebasedtargets.org/companies-taking-action'],
              ].filter(Boolean).map(([k, v]) => (
                <div key={k} className="drow">
                  <span style={{ color:'var(--mut)' }}>{k}</span>
                  <span style={{ color: String(v).startsWith('✓') ? '#10b981' : String(v).startsWith('⚠') ? '#f59e0b' : 'var(--txt)' }}>{v}</span>
                </div>
              ))}
              <div className="al al-g" style={{ marginTop:14 }}>
                <span>ℹ</span>
                <span>After export, submit the commitment at <strong>sciencebasedtargets.org</strong>. SBTi validation takes 6-9 months. Your targets will be publicly listed on the SBTi dashboard once validated.</span>
              </div>
            </div>
          )}

          {/* ══ CDP C4 MAPPING ══ */}
          {tab === 'cdp' && (
            <div className="sbti-card">
              <div className="sbti-ctit">CDP CLIMATE C4 — EMISSIONS REDUCTION TARGETS MAPPING</div>
              <div className="al al-b">
                <span>📋</span>
                <span>Use the values below to complete CDP questionnaire Section C4. These map directly to CDP's required fields for targets disclosure.</span>
              </div>
              {[
                ['C4.1a — Target type',                    'Absolute emissions reduction target'],
                ['C4.1a — Coverage',                       scope3Covered ? 'Scope 1, 2, and 3' : 'Scope 1 and 2'],
                ['C4.1a — Base year',                      String(baseYear)],
                ['C4.1a — Target year',                    String(nearTermYear)],
                ['C4.1a — Base year emissions',            `${fmt(baseTotal12, 2)} tCO₂e`],
                ['C4.1a — Targeted reduction',             `${pw.nearTermReduction}%`],
                ['C4.1a — Target emissions in target year', baseTotal12 > 0 ? `${fmt(nearTermTarget12, 2)} tCO₂e` : '—'],
                ['C4.1a — SBTi status',                    'Committed — pending validation'],
                ['C4.1a — Temperature classification',      pw.label],
                ['C4.2 — Long-term target year',           String(longTermYear)],
                ['C4.2 — Long-term target',                `${pw.longTermReduction}% reduction from base year`],
                ['C4.2 — Net zero commitment',             `Net zero by ${longTermYear}`],
                ['C4.3 — Annual reduction (Scope 1+2)',    baseTotal12 > 0 ? `${fmt(annualReductionS12, 2)} tCO₂e/year` : '—'],
                ['C4.3 — Currently on track',              baseTotal12 > 0 ? (onTrack ? 'Yes' : 'No') : 'N/A'],
              ].map(([k, v]) => (
                <div key={k} className="drow">
                  <span style={{ color:'var(--mut)', fontSize:10 }}>{k}</span>
                  <span style={{ color:'var(--txt)' }}>{v}</span>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
    </>
  );
}
