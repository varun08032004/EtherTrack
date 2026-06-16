// src/components/FiveYearActionPlan.jsx - 28/05/2026

import React, { useState } from 'react';
import { apiFetch } from '../services/api';

const CEA_GRID_EF  = 0.727;
const GJ_PER_MTOE  = 41_868;
const CCC_PRICE    = 1_200;
const PENALTY_MULT = 2.0;

const fmt = (n, d = 2) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
const sanitise = (s = '', max = 500) =>
  String(s).replace(/<[^>]*>/g, '').replace(/['"`;]/g, '').trim().slice(0, max);

// ── MRV Calendar deadlines ────────────────────────────────────────────────
const MRV_DEADLINES = [
  { id: 'entity_reg',    label: 'Entity Registration (Form A)',           deadline: '2026-07-31', form: 'Form A',  status_key: 'form_a',  critical: true  },
  { id: 'baseline_decl', label: 'Baseline Declaration (Form B)',          deadline: '2026-04-30', form: 'Form B',  status_key: 'form_b',  critical: true  },
  { id: 'annual_gei',    label: 'Annual GEI Activity Report (Form C)',    deadline: '2026-07-31', form: 'Form C',  status_key: 'form_c',  critical: true  },
  { id: 'acva_verify',   label: 'ACVA Verification Statement (Form D)',   deadline: '2026-07-31', form: 'Form D',  status_key: 'form_d',  critical: true  },
  { id: 'mrv_plan',      label: 'MRV Plan & Methodology (Form E2)',       deadline: '2026-07-31', form: 'Form E2', status_key: 'form_e2', critical: true  },
  { id: 'ccc_trading',   label: 'CCC Trading Opens on IEX/PXIL',         deadline: '2026-10-01', form: null,      status_key: null,      critical: false },
  { id: 'fy27_form_b',   label: 'FY 2026-27 Form B Baseline',            deadline: '2027-04-30', form: 'Form B',  status_key: null,      critical: false },
  { id: 'fy27_form_c',   label: 'FY 2026-27 Annual GEI Report (Form C)', deadline: '2027-07-31', form: 'Form C',  status_key: null,      critical: false },
];

// ── Five-year reduction levers ────────────────────────────────────────────
const LEVERS = [
  { id: 'renewable',   label: 'Switch to Renewable Electricity (RECs/PPA)', scope: 2, maxPct: 96,  unit: '% of grid consumption' },
  { id: 'efficiency',  label: 'Energy Efficiency (LED, HVAC, VFDs)',         scope: 1, maxPct: 20,  unit: '% of Scope 1' },
  { id: 'fuel_switch', label: 'Fuel Switching (coal → gas → hydrogen)',       scope: 1, maxPct: 40,  unit: '% of Scope 1' },
  { id: 'process',     label: 'Process Optimisation / Waste Heat Recovery',  scope: 1, maxPct: 15,  unit: '% of Scope 1' },
  { id: 'supply_chain',label: 'Supply Chain Decarbonisation (Scope 3)',       scope: 3, maxPct: 30,  unit: '% of Scope 3' },
  { id: 'offsets',     label: 'Carbon Credit Retirement (CCCs / VCUs)',       scope: 0, maxPct: 100, unit: '% of residual' },
];

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap');
:root{--bg:#04080a;--surf:#080f12;--brd:#182430;--brd2:#1e3040;--txt:#e8f4f0;--mut:#3a6070;--grn:#10b981;--red:#ef4444;--ylw:#f59e0b;--org:#f97316;--teal:#14b8a6;--blu:#3b82f6;}
.fyp{min-height:100vh;background:var(--bg);font-family:'Space Mono',monospace;color:var(--txt);}
.fyp-in{max-width:1300px;margin:0 auto;padding:28px 24px 80px;}
.fyp-hd{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--brd);}
.fyp-label{font-size:9px;letter-spacing:.2em;color:var(--mut);}
.fyp-title{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;margin-top:3px;}
.fyp-title span{color:var(--org);}
.fyp-card{background:var(--surf);border:1px solid var(--brd);border-radius:10px;padding:18px 20px;margin-bottom:14px;}
.fyp-ctit{font-size:9px;letter-spacing:.15em;color:var(--mut);margin-bottom:14px;display:flex;align-items:center;gap:8px;}
.fyp-ctit::before{content:'';width:10px;height:1px;background:var(--org);}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}
.fg{display:flex;flex-direction:column;gap:5px;margin-bottom:10px;}
.lbl{font-size:10px;letter-spacing:.1em;color:var(--mut);}
.inp,.sel{padding:9px 11px;border-radius:6px;background:#060c10;border:1px solid var(--brd);color:var(--txt);font-family:'Space Mono',monospace;font-size:12px;outline:none;transition:border-color .2s;width:100%;box-sizing:border-box;}
.inp:focus,.sel:focus{border-color:#f9731644;}
.inp::placeholder{color:var(--mut);opacity:.7;}
.btn{padding:9px 17px;border-radius:6px;border:none;cursor:pointer;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.1em;font-weight:700;transition:all .2s;}
.btn:disabled{opacity:.5;cursor:not-allowed;}
.btn-org{background:linear-gradient(135deg,#f97316,#ea580c);color:#fff;}
.btn-org:hover:not(:disabled){opacity:.85;transform:translateY(-1px);}
.btn-g{background:var(--surf);border:1px solid var(--brd2);color:var(--txt);}
.btn-g:hover:not(:disabled){border-color:#f9731644;color:var(--org);}
.btn-sm{padding:6px 12px;font-size:10px;}
/* Lever sliders */
.lever-row{padding:14px 0;border-bottom:1px solid var(--brd)22;}
.lever-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
.lever-lbl{font-size:12px;color:var(--txt);}
.lever-scope{font-size:10px;padding:2px 8px;border-radius:3px;margin-left:8px;}
.lever-val{font-size:14px;font-weight:700;}
.lever-slider{-webkit-appearance:none;appearance:none;width:100%;height:4px;border-radius:2px;background:var(--brd);outline:none;}
.lever-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;border-radius:50%;background:var(--org);cursor:pointer;border:2px solid #0a0f12;}
.lever-impact{font-size:10px;color:var(--mut);margin-top:4px;}
/* Timeline */
.cal-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;}
.cal-tile{border-radius:8px;padding:14px;border:1px solid var(--brd);background:#060c10;}
.cal-tile.overdue{border-color:#ef444444;background:#ef444408;}
.cal-tile.due-soon{border-color:#f59e0b44;background:#f59e0b08;}
.cal-tile.upcoming{border-color:#3b82f644;background:#3b82f608;}
.cal-tile.done{border-color:#10b98144;background:#10b98108;}
.cal-tile.milestone{border-color:#14b8a644;background:#14b8a608;}
/* PAT-CCC */
.pat-ccc-box{border-radius:10px;padding:18px;border:1px solid #14b8a633;background:#14b8a608;margin-bottom:14px;}
/* Scenario table */
.sc-tbl{width:100%;border-collapse:collapse;font-size:11px;}
.sc-tbl th{text-align:left;padding:8px 10px;font-size:9px;letter-spacing:.1em;color:var(--mut);border-bottom:1px solid var(--brd);background:#060c10;}
.sc-tbl td{padding:9px 10px;border-bottom:1px solid var(--brd)22;}
.sc-tbl tr:hover td{background:#14b8a608;}
/* Tabs */
.fyp-tabs{display:flex;gap:0;margin-bottom:18px;border-bottom:1px solid var(--brd);overflow-x:auto;}
.fyp-tab{padding:9px 15px;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.09em;cursor:pointer;border:none;background:none;color:var(--mut);border-bottom:2px solid transparent;transition:all .2s;margin-bottom:-1px;white-space:nowrap;}
.fyp-tab.on{color:var(--org);border-bottom-color:var(--org);}
.al{padding:10px 14px;border-radius:7px;font-size:11px;display:flex;gap:8px;margin-bottom:12px;line-height:1.6;}
.al-g{background:#10b98108;border:1px solid #10b98133;color:var(--grn);}
.al-y{background:#f59e0b08;border:1px solid #f59e0b33;color:var(--ylw);}
.al-t{background:#14b8a608;border:1px solid #14b8a633;color:var(--teal);}
.al-b{background:#3b82f608;border:1px solid #3b82f633;color:var(--blu);}
.drow{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--brd)22;font-size:11px;}
.drow:last-child{border-bottom:none;}
.pill{display:inline-flex;align-items:center;gap:4px;font-size:9px;padding:3px 9px;border-radius:3px;letter-spacing:.05em;}
.pill-grn{background:#10b98114;color:#10b981;border:1px solid #10b98133;}
.pill-ylw{background:#f59e0b14;color:#f59e0b;border:1px solid #f59e0b33;}
.pill-red{background:#ef444414;color:#ef4444;border:1px solid #ef444433;}
.pill-teal{background:#14b8a614;color:#14b8a6;border:1px solid #14b8a633;}
.notif{position:fixed;top:76px;right:24px;z-index:9999;padding:11px 18px;border-radius:8px;font-family:'Space Mono',monospace;font-size:11px;box-shadow:0 8px 32px #00000088;animation:fU .3s ease;}
.notif-ok{background:#0b2a1e;border:1px solid #10b98133;color:#10b981;}
.notif-err{background:#450a0a;border:1px solid #ef444433;color:#f87171;}
@keyframes fU{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:1000px){.g2,.g3,.cal-grid{grid-template-columns:1fr 1fr;}}
@media(max-width:600px){.cal-grid{grid-template-columns:1fr;}}
`;

export default function FiveYearActionPlan({ profile, emissions = [], cctsData, patData }) {
  const [tab,       setTab]      = useState('plan');
  const [levers,    setLevers]   = useState({ renewable: 0, efficiency: 0, fuel_switch: 0, process: 0, supply_chain: 0, offsets: 0 });
  const [formDone,  setFormDone] = useState({ form_a: cctsData?.form_a || false, form_b: cctsData?.form_b || false, form_c: cctsData?.form_c || false, form_d: cctsData?.form_d || false, form_e2: cctsData?.form_e2 || false });
  const [patEscerts,   setPatEscerts]   = useState(parseFloat(patData?.escerts || 0));
  const [escertPrice,  setEscertPrice]  = useState(1200);
  const [notif,        setNotif]        = useState(null);

  const toast = (msg, type = 'ok') => { setNotif({ msg, type }); setTimeout(() => setNotif(null), 4000); };

  const scope1 = emissions.filter(r => r.scope === 1).reduce((s, r) => s + parseFloat(r.co2e || 0), 0);
  const scope2 = emissions.filter(r => r.scope === 2).reduce((s, r) => s + parseFloat(r.co2e || 0), 0);
  const scope3 = emissions.filter(r => r.scope === 3).reduce((s, r) => s + parseFloat(r.co2e || 0), 0);
  const total  = scope1 + scope2 + scope3;

  // ── Lever impact calculations ─────────────────────────────────────────────
  const renewableReduction  = scope2  * (levers.renewable   / 100) * 0.96;
  const efficiencyReduction = scope1  * (levers.efficiency  / 100);
  const fuelSwitchReduction = scope1  * (levers.fuel_switch / 100);
  const processReduction    = scope1  * (levers.process     / 100);
  const supplyChainReduction= scope3  * (levers.supply_chain/ 100);
  const totalReduction      = renewableReduction + efficiencyReduction + fuelSwitchReduction + processReduction + supplyChainReduction;
  const residualAfterLevers = Math.max(0, total - totalReduction);
  const offsetNeeded        = residualAfterLevers * (levers.offsets / 100);
  const netEmissions        = Math.max(0, residualAfterLevers - offsetNeeded);
  const reductionPct        = total > 0 ? (totalReduction / total * 100) : 0;

  // Five-year projection (linear reduction of each lever over 5 years)
  const fiveYearPlan = Array.from({ length: 6 }, (_, i) => {
    const yr      = new Date().getFullYear() + i;
    const ramp    = i / 5;
    const redYear = (renewableReduction + efficiencyReduction + fuelSwitchReduction + processReduction + supplyChainReduction) * ramp;
    const net     = Math.max(0, total - redYear);
    const cccNeeded = Math.ceil(net * (levers.offsets / 100));
    return { yr, net: net.toFixed(1), cccNeeded, redPct: total > 0 ? ((total - net) / total * 100).toFixed(1) : '0.0' };
  });

  // ── PAT → CCC transition (Gap 4) ─────────────────────────────────────────
  // BEE circular: existing ESCerts can be surrendered for CCCs at 1:1 ratio
  // (pending final CERC notification — use with caution)
  const patToCcc     = Math.floor(patEscerts);
  const patCccValue  = patToCcc * CCC_PRICE;
  const patEscertVal = patEscerts * escertPrice;

  // ── MRV Calendar ─────────────────────────────────────────────────────────
  const today = new Date();
  const getDeadlineStatus = (deadlineStr) => {
    const d    = new Date(deadlineStr);
    const diff = (d - today) / (1000 * 60 * 60 * 24);
    if (diff < 0)   return 'overdue';
    if (diff < 60)  return 'due-soon';
    if (diff < 180) return 'upcoming';
    return 'future';
  };
  const getDaysLeft = (deadlineStr) => {
    const diff = (new Date(deadlineStr) - today) / (1000 * 60 * 60 * 24);
    if (diff < 0) return `${Math.abs(Math.ceil(diff))} days overdue`;
    return `${Math.ceil(diff)} days left`;
  };

  // ── Export BEE five-year plan ─────────────────────────────────────────────
  const exportFiveYearPlan = () => {
    const plan = {
      document_type:     'BEE CCTS Five-Year Decarbonisation Action Plan',
      regulatory_basis:  'Energy Conservation (Amendment) Act 2022',
      generated_at:      new Date().toISOString(),
      entity: {
        name:            sanitise(profile?.company_name || ''),
        cin:             sanitise(profile?.company_cin  || ''),
        industry:        sanitise(profile?.industry     || ''),
      },
      base_emissions: {
        scope1_tco2e:    parseFloat(scope1.toFixed(3)),
        scope2_tco2e:    parseFloat(scope2.toFixed(3)),
        scope3_tco2e:    parseFloat(scope3.toFixed(3)),
        total_tco2e:     parseFloat(total.toFixed(3)),
      },
      reduction_levers: LEVERS.map(l => ({
        lever:           l.label,
        scope:           l.scope,
        target_pct:      levers[l.id],
        annual_reduction_tco2e: parseFloat(
          l.id === 'renewable'    ? renewableReduction.toFixed(3) :
          l.id === 'efficiency'   ? efficiencyReduction.toFixed(3) :
          l.id === 'fuel_switch'  ? fuelSwitchReduction.toFixed(3) :
          l.id === 'process'      ? processReduction.toFixed(3) :
          l.id === 'supply_chain' ? supplyChainReduction.toFixed(3) : '0'
        ),
      })),
      five_year_trajectory: fiveYearPlan,
      total_reduction_tco2e:   parseFloat(totalReduction.toFixed(3)),
      residual_emissions_tco2e: parseFloat(residualAfterLevers.toFixed(3)),
      offset_strategy:         `${levers.offsets}% of residual via CCC/VCU retirement on EtherTrack`,
      net_zero_trajectory:     `Net emissions ${fmt(netEmissions, 1)} tCO₂e with selected levers`,
      pat_to_ccc_transition: {
        existing_escerts:     patEscerts,
        ccc_equivalent:       patToCcc,
        note:                 'ESCert → CCC 1:1 ratio per BEE circular (pending final CERC notification). Verify with your BEE desk before surrender.',
      },
      mrv_deadlines:           MRV_DEADLINES.map(d => ({
        activity:              d.label,
        deadline:              d.deadline,
        status:                formDone[d.status_key] ? 'COMPLETE' : getDeadlineStatus(d.deadline).toUpperCase(),
        days_remaining:        getDaysLeft(d.deadline),
      })),
    };

    const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }));
    const a   = document.createElement('a');
    a.href    = url;
    a.download = `BEE_FiveYearPlan_${sanitise(profile?.company_cin || 'entity')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast('✓ BEE five-year action plan exported');
  };

  return (
    <>
      <style>{CSS}</style>
      {notif && <div className={`notif notif-${notif.type}`}>{notif.msg}</div>}

      <div className="fyp">
        <div className="fyp-in">

          <div className="fyp-hd">
            <div>
              <div className="fyp-label">BEE CCTS · FIVE-YEAR DECARBONISATION PLAN · MRV CALENDAR · PAT→CCC TRANSITION</div>
              <div className="fyp-title">Five-Year <span>Action Plan</span></div>
              <div style={{ fontSize:10, color:'var(--mut)', marginTop:2 }}>
                Gap 9: BEE mandatory 5-year plan · Gap 6: MRV deadline calendar · Gap 4: PAT→CCC transition mapping
              </div>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button className="btn btn-org btn-sm" onClick={exportFiveYearPlan}>EXPORT BEE PLAN →</button>
            </div>
          </div>

          <div className="fyp-tabs">
            {[
              ['plan',       'DECARBONISATION PLAN'],
              ['calendar',   'MRV DEADLINE CALENDAR'],
              ['pat_ccc',    'PAT → CCC TRANSITION'],
              ['projection', 'FIVE-YEAR PROJECTION'],
            ].map(([k, v]) => (
              <button key={k} className={`fyp-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{v}</button>
            ))}
          </div>

          {/* ══ DECARBONISATION PLAN ══ */}
          {tab === 'plan' && (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div className="al al-t">
                <span>📋</span>
                <span><strong>Gap 9 closed:</strong> BEE requires obligated entities to submit a five-year decarbonisation action plan. Set your reduction levers below — EtherTrack generates the BEE-format plan automatically.</span>
              </div>

              <div className="fyp-card">
                <div className="fyp-ctit">CURRENT EMISSIONS BASELINE</div>
                <div className="g3">
                  {[
                    { l:'SCOPE 1', v: fmt(scope1, 2), c:'#f97316' },
                    { l:'SCOPE 2', v: fmt(scope2, 2), c:'#3b82f6' },
                    { l:'SCOPE 3', v: fmt(scope3, 2), c:'#a855f7' },
                  ].map(({ l, v, c }) => (
                    <div key={l} style={{ background:'#060c10', borderRadius:8, padding:14, border:'1px solid var(--brd)' }}>
                      <div style={{ fontSize:9, color:'var(--mut)', letterSpacing:'.1em', marginBottom:4 }}>{l}</div>
                      <div style={{ fontFamily:'Syne,sans-serif', fontSize:20, fontWeight:800, color:c }}>{v}</div>
                      <div style={{ fontSize:9, color:'var(--mut)', marginTop:2 }}>tCO₂e</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="fyp-card">
                <div className="fyp-ctit">REDUCTION LEVERS — DRAG TO SET TARGET</div>
                {LEVERS.map(lever => {
                  const impact = lever.id === 'renewable'    ? renewableReduction
                               : lever.id === 'efficiency'   ? efficiencyReduction
                               : lever.id === 'fuel_switch'  ? fuelSwitchReduction
                               : lever.id === 'process'      ? processReduction
                               : lever.id === 'supply_chain' ? supplyChainReduction
                               : offsetNeeded;
                  const scopeColor = lever.scope === 1 ? '#f97316' : lever.scope === 2 ? '#3b82f6' : lever.scope === 3 ? '#a855f7' : '#10b981';
                  return (
                    <div key={lever.id} className="lever-row">
                      <div className="lever-hd">
                        <div>
                          <span className="lever-lbl">{lever.label}</span>
                          <span className="lever-scope" style={{ background:`${scopeColor}14`, color:scopeColor, border:`1px solid ${scopeColor}33` }}>
                            {lever.scope === 0 ? 'OFFSET' : `S${lever.scope}`}
                          </span>
                        </div>
                        <span className="lever-val" style={{ color: levers[lever.id] > 0 ? '#10b981' : 'var(--mut)' }}>
                          {levers[lever.id]}% → {fmt(impact, 1)} tCO₂e saved
                        </span>
                      </div>
                      <input type="range" className="lever-slider" min="0" max={lever.maxPct} step="1"
                        value={levers[lever.id]}
                        onChange={e => setLevers(l => ({ ...l, [lever.id]: parseInt(e.target.value) }))}
                        style={{ accentColor: scopeColor }}
                      />
                      <div className="lever-impact">
                        0% ←——— {lever.unit} ———→ {lever.maxPct}%
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="fyp-card" style={{ border: netEmissions < total * 0.1 ? '1px solid #10b98133' : '1px solid var(--brd)' }}>
                <div className="fyp-ctit">PLAN SUMMARY</div>
                {[
                  ['Total Reduction from Levers',  `${fmt(totalReduction, 2)} tCO₂e (${fmt(reductionPct, 1)}%)`, '#10b981'],
                  ['Residual After Levers',         `${fmt(residualAfterLevers, 2)} tCO₂e`, '#f59e0b'],
                  ['Offsets (CCC/VCU retirement)',  `${fmt(offsetNeeded, 2)} tCO₂e`, '#a855f7'],
                  ['NET EMISSIONS',                 `${fmt(netEmissions, 2)} tCO₂e`, netEmissions < total * 0.1 ? '#10b981' : '#ef4444'],
                  ['Annual CCC cost (est.)',         offsetNeeded > 0 ? `₹${fmt(offsetNeeded * CCC_PRICE / 100000, 2)} Lakh` : '₹0', 'var(--txt)'],
                ].map(([k, v, c]) => (
                  <div key={k} className="drow">
                    <span style={{ color:'var(--mut)' }}>{k}</span>
                    <span style={{ color: c, fontWeight: k === 'NET EMISSIONS' ? 700 : 400 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══ MRV CALENDAR — Gap 6 ══ */}
          {tab === 'calendar' && (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div className="al al-t">
                <span>📅</span>
                <span><strong>Gap 6 closed:</strong> All CCTS MRV deadlines with days remaining. Click any tile to mark as complete. Critical deadlines in red.</span>
              </div>

              <div className="cal-grid">
                {MRV_DEADLINES.map(d => {
                  const done   = d.status_key ? formDone[d.status_key] : false;
                  const status = done ? 'done' : d.deadline === '2026-10-01' ? 'milestone' : getDeadlineStatus(d.deadline);
                  const daysLeft = getDaysLeft(d.deadline);
                  const dateStr  = new Date(d.deadline).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
                  return (
                    <div key={d.id} className={`cal-tile ${status}`}
                      onClick={() => d.status_key && setFormDone(f => ({ ...f, [d.status_key]: !f[d.status_key] }))
                      } style={{ cursor: d.status_key ? 'pointer' : 'default' }}>
                      <div style={{ fontSize:20, marginBottom:6 }}>
                        {done ? '✅' : status === 'overdue' ? '🔴' : status === 'due-soon' ? '🟡' : status === 'milestone' ? '🏁' : '📋'}
                      </div>
                      <div style={{ fontSize:11, fontWeight:700, marginBottom:4, color: done ? '#10b981' : status === 'overdue' ? '#ef4444' : status === 'due-soon' ? '#f59e0b' : status === 'milestone' ? '#14b8a6' : 'var(--txt)' }}>
                        {d.form || 'MILESTONE'}
                      </div>
                      <div style={{ fontSize:10, color:'var(--mut)', lineHeight:1.4, marginBottom:6 }}>{d.label}</div>
                      <div style={{ fontSize:11, fontWeight:700, color: done ? '#10b981' : status === 'overdue' ? '#ef4444' : '#f59e0b' }}>
                        {done ? '✓ COMPLETE' : dateStr}
                      </div>
                      <div style={{ fontSize:10, color:'var(--mut)', marginTop:2 }}>
                        {done ? 'Click to unmark' : daysLeft}
                      </div>
                      {d.critical && !done && <div style={{ fontSize:9, color:'#ef4444', marginTop:4, letterSpacing:'.06em' }}>MANDATORY SUBMISSION</div>}
                    </div>
                  );
                })}
              </div>

              <div className="fyp-card">
                <div className="fyp-ctit">UPCOMING ACTIONS CHECKLIST</div>
                {[
                  { deadline: '2026-04-30', action: 'Submit Form B (Baseline Declaration) to BEE via ICM Portal', done: formDone.form_b },
                  { deadline: '2026-07-31', action: 'Submit Form A (Entity Registration) via ICM Portal', done: formDone.form_a },
                  { deadline: '2026-07-31', action: 'Submit Form C (Annual GEI Activity Report) via ICM Portal', done: formDone.form_c },
                  { deadline: '2026-07-31', action: 'Obtain ACVA verified Form D and submit via ICM Portal', done: formDone.form_d },
                  { deadline: '2026-07-31', action: 'Submit Form E2 (MRV Plan) via ICM Portal', done: formDone.form_e2 },
                  { deadline: '2026-10-01', action: 'CCC trading opens — list surplus CCCs on IEX/PXIL via EtherTrack', done: false },
                ].map(({ deadline, action, done }) => (
                  <div key={action} className="drow" style={{ alignItems:'flex-start' }}>
                    <span style={{ color: done ? '#10b981' : getDeadlineStatus(deadline) === 'overdue' ? '#ef4444' : '#f59e0b', marginRight:8, flexShrink:0 }}>
                      {done ? '✓' : getDeadlineStatus(deadline) === 'overdue' ? '✕' : '○'}
                    </span>
                    <span style={{ flex:1, color: done ? 'var(--mut)' : 'var(--txt)', textDecoration: done ? 'line-through' : 'none' }}>{action}</span>
                    <span style={{ color:'var(--mut)', flexShrink:0, marginLeft:12, fontSize:10 }}>
                      {new Date(deadline).toLocaleDateString('en-IN', { day:'2-digit', month:'short' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══ PAT → CCC TRANSITION — Gap 4 ══ */}
          {tab === 'pat_ccc' && (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div className="al al-y">
                <span>⚠</span>
                <span><strong>Gap 4 closed (with caveat):</strong> ESCert → CCC conversion mapping below. BEE has indicated a 1:1 conversion ratio but the final CERC notification has not been issued as of May 2026. Verify with your BEE desk before surrendering ESCerts.</span>
              </div>

              <div className="pat-ccc-box">
                <div style={{ fontSize:9, letterSpacing:'.15em', color:'#14b8a6', marginBottom:10 }}>PAT → CCTS TRANSITION CALCULATOR</div>
                <div className="g2">
                  <div className="fg">
                    <label className="lbl">YOUR EXISTING ESCERTS (from PAT Scheme)</label>
                    <input className="inp" type="number" step="1" min="0" placeholder="from PAT Scheme tab"
                      value={patEscerts || ''} onChange={e => setPatEscerts(parseFloat(e.target.value) || 0)}/>
                    <span style={{ fontSize:10, color:'var(--mut)' }}>1 ESCert = 1 MTOE = 41,868 GJ</span>
                  </div>
                  <div className="fg">
                    <label className="lbl">ESCert CURRENT MARKET PRICE (₹/ESCert)</label>
                    <input className="inp" type="number" step="1" min="0" placeholder="₹400–₹7,500 (PXIL/IEX)"
                      value={escertPrice || ''} onChange={e => setEscertPrice(parseInt(e.target.value) || 1200)}/>
                    <span style={{ fontSize:10, color:'var(--mut)' }}>Range: ₹400–₹7,500 (PXIL/IEX 2024)</span>
                  </div>
                </div>

                {[
                  ['Your ESCerts',                  `${fmt(patEscerts, 0)} ESCerts`, '#14b8a6'],
                  ['PAT→CCC conversion (1:1)',       `${fmt(patToCcc, 0)} CCCs (pending CERC notification)`, '#14b8a6'],
                  ['Current ESCert value',           `₹${fmt(patEscertVal / 100_000, 2)} Lakh @ ₹${fmt(escertPrice, 0)}/ESCert`, '#f97316'],
                  ['Equivalent CCC value (est.)',    `₹${fmt(patToCcc * CCC_PRICE / 100_000, 2)} Lakh @ ₹${fmt(CCC_PRICE, 0)}/CCC`, '#10b981'],
                  ['Value difference',               patToCcc * CCC_PRICE >= patEscertVal ? `+₹${fmt((patToCcc * CCC_PRICE - patEscertVal) / 100_000, 2)} Lakh gain` : `-₹${fmt((patEscertVal - patToCcc * CCC_PRICE) / 100_000, 2)} Lakh loss`, patToCcc * CCC_PRICE >= patEscertVal ? '#10b981' : '#ef4444'],
                  ['Decision',                       patToCcc * CCC_PRICE >= patEscertVal ? 'Convert to CCC — higher value' : 'Hold as ESCert or sell on PXIL/IEX', patToCcc * CCC_PRICE >= patEscertVal ? '#10b981' : '#f59e0b'],
                ].map(([k, v, c]) => (
                  <div key={k} className="drow">
                    <span style={{ color:'var(--mut)' }}>{k}</span>
                    <span style={{ color: c }}>{v}</span>
                  </div>
                ))}
              </div>

              <div className="fyp-card">
                <div className="fyp-ctit">PAT → CCTS TRANSITION PROCESS</div>
                {[
                  { n:'1', t:'Confirm PAT Cycle IV completion', d:'Verify your final ESCert count with BEE/PXIL/IEX registry' },
                  { n:'2', t:'Wait for CERC ESCert→CCC notification', d:'CERC is expected to notify the conversion formula — estimated H2 2026' },
                  { n:'3', t:'Choose: sell ESCerts or convert to CCC', d:'Use the calculator above to determine which is more valuable at current market prices' },
                  { n:'4', t:'Surrender ESCerts via BEE portal', d:'Follow the surrender procedure in the CERC CCC Regulations 2026' },
                  { n:'5', t:'Receive CCCs in Grid-India registry', d:'CCCs credited to your CCTS entity account on ICM Portal' },
                  { n:'6', t:'Trade CCCs on IEX/PXIL via EtherTrack', d:'List your CCCs on EtherTrack marketplace — connected to IEX/PXIL when API live' },
                ].map(({ n, t, d }) => (
                  <div key={n} style={{ display:'flex', gap:12, padding:'10px 0', borderBottom:'1px solid var(--brd)22' }}>
                    <span style={{ width:24, height:24, borderRadius:'50%', background:'#14b8a620', border:'1px solid #14b8a633', color:'#14b8a6', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontSize:10 }}>{n}</span>
                    <div>
                      <div style={{ fontSize:12, fontWeight:700, color:'var(--txt)', marginBottom:2 }}>{t}</div>
                      <div style={{ fontSize:11, color:'var(--mut)' }}>{d}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══ FIVE-YEAR PROJECTION ══ */}
          {tab === 'projection' && (
            <div className="fyp-card">
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                <div className="fyp-ctit" style={{ marginBottom:0 }}>FIVE-YEAR EMISSION TRAJECTORY</div>
                <button className="btn btn-org btn-sm" onClick={exportFiveYearPlan}>EXPORT BEE PLAN →</button>
              </div>
              <div className="al al-g">
                <span>ℹ</span>
                <span>Projection based on linear ramp-up of selected levers. Set levers in the Decarbonisation Plan tab first.</span>
              </div>
              <table className="sc-tbl">
                <thead>
                  <tr>
                    <th>YEAR</th>
                    <th>NET EMISSIONS (tCO₂e)</th>
                    <th>REDUCTION FROM BASE</th>
                    <th>CCCs NEEDED (OFFSET)</th>
                    <th>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {fiveYearPlan.map(({ yr, net, cccNeeded, redPct }) => {
                    const isBase = yr === new Date().getFullYear();
                    return (
                      <tr key={yr}>
                        <td style={{ fontWeight: isBase ? 700 : 400, color: isBase ? '#f97316' : 'var(--txt)' }}>
                          FY {yr}{isBase && ' (current)'}
                        </td>
                        <td style={{ color: parseFloat(net) < total * 0.5 ? '#10b981' : '#f59e0b' }}>{fmt(parseFloat(net), 1)}</td>
                        <td style={{ color:'var(--mut)' }}>{redPct}%</td>
                        <td style={{ color:'#a855f7' }}>{cccNeeded > 0 ? fmt(cccNeeded, 0) : '—'}</td>
                        <td>
                          <span className={`pill ${parseFloat(redPct) >= 42 ? 'pill-grn' : parseFloat(redPct) >= 20 ? 'pill-ylw' : 'pill-red'}`}>
                            {parseFloat(redPct) >= 42 ? 'SBTi 1.5°C' : parseFloat(redPct) >= 20 ? 'Progressing' : 'Action needed'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

        </div>
      </div>
    </>
  );
}

