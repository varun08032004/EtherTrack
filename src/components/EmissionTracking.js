import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS, LineElement, BarElement, ArcElement,
  CategoryScale, LinearScale, PointElement, Tooltip, Legend, Filler
} from 'chart.js';
import { apiFetch } from '../services/api';

ChartJS.register(LineElement, BarElement, ArcElement, CategoryScale, LinearScale, PointElement, Tooltip, Legend, Filler);

// ── GHG Protocol Emission Factors (DEFRA 2024 / IPCC AR6 / IEA 2024) ─
const EF = {
  'Diesel (L)':               { factor:2.68,   unit:'L',     scope:1, cat:'Stationary Combustion' },
  'Petrol (L)':               { factor:2.31,   unit:'L',     scope:1, cat:'Stationary Combustion' },
  'Natural Gas (m³)':         { factor:2.02,   unit:'m³',    scope:1, cat:'Stationary Combustion' },
  'Coal (kg)':                { factor:2.42,   unit:'kg',    scope:1, cat:'Stationary Combustion' },
  'LPG (kg)':                 { factor:2.98,   unit:'kg',    scope:1, cat:'Stationary Combustion' },
  'Furnace Oil (L)':          { factor:3.18,   unit:'L',     scope:1, cat:'Stationary Combustion' },
  'Company Vehicle (km)':     { factor:0.21,   unit:'km',    scope:1, cat:'Mobile Combustion'     },
  'Refrigerant R-410A (kg)':  { factor:2088,   unit:'kg',    scope:1, cat:'Fugitive Emissions'    },
  'Refrigerant R-22 (kg)':    { factor:1810,   unit:'kg',    scope:1, cat:'Fugitive Emissions'    },
  'Electricity India (kWh)':  { factor:0.82,   unit:'kWh',   scope:2, cat:'Purchased Electricity' },
  'Electricity EU (kWh)':     { factor:0.28,   unit:'kWh',   scope:2, cat:'Purchased Electricity' },
  'Electricity US (kWh)':     { factor:0.39,   unit:'kWh',   scope:2, cat:'Purchased Electricity' },
  'Solar/Renewable (kWh)':    { factor:0.041,  unit:'kWh',   scope:2, cat:'Purchased Electricity' },
  'District Heating (kWh)':   { factor:0.18,   unit:'kWh',   scope:2, cat:'Purchased Heat/Steam'  },
  'District Cooling (kWh)':   { factor:0.25,   unit:'kWh',   scope:2, cat:'Purchased Cooling'     },
  'Air Travel Short <3h (km)':{ factor:0.255,  unit:'km',    scope:3, cat:'Business Travel'       },
  'Air Travel Long >3h (km)': { factor:0.195,  unit:'km',    scope:3, cat:'Business Travel'       },
  'Rail Travel (km)':         { factor:0.041,  unit:'km',    scope:3, cat:'Business Travel'       },
  'Hotel Stay (nights)':      { factor:0.031,  unit:'nights',scope:3, cat:'Business Travel'       },
  'Road Freight (tonne·km)':  { factor:0.062,  unit:'t·km',  scope:3, cat:'Upstream Transport'    },
  'Sea Freight (tonne·km)':   { factor:0.010,  unit:'t·km',  scope:3, cat:'Upstream Transport'    },
  'Air Freight (tonne·km)':   { factor:0.602,  unit:'t·km',  scope:3, cat:'Upstream Transport'    },
  'Steel (kg)':               { factor:1.85,   unit:'kg',    scope:3, cat:'Purchased Goods'       },
  'Aluminium (kg)':           { factor:11.5,   unit:'kg',    scope:3, cat:'Purchased Goods'       },
  'Plastic (kg)':             { factor:3.14,   unit:'kg',    scope:3, cat:'Purchased Goods'       },
  'Cement (kg)':              { factor:0.83,   unit:'kg',    scope:3, cat:'Purchased Goods'       },
  'Paper (kg)':               { factor:0.91,   unit:'kg',    scope:3, cat:'Purchased Goods'       },
  'Glass (kg)':               { factor:0.54,   unit:'kg',    scope:3, cat:'Purchased Goods'       },
  'Employee Commute (km)':    { factor:0.14,   unit:'km',    scope:3, cat:'Employee Commuting'    },
  'Landfill Waste (kg)':      { factor:0.58,   unit:'kg',    scope:3, cat:'Waste'                 },
  'Recycled Waste (kg)':      { factor:0.021,  unit:'kg',    scope:3, cat:'Waste'                 },
  'Water (m³)':               { factor:0.344,  unit:'m³',    scope:3, cat:'Water'                 },
};

const SC = { 1:'#f97316', 2:'#3b82f6', 3:'#a855f7' };
const fmt  = (n,d=2) => Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:d,minimumFractionDigits:d});
const calc = (activity, qty) => {
  const e = EF[activity];
  if (!e || !qty) return null;
  return { co2e:(parseFloat(qty)*e.factor/1000), scope:e.scope, cat:e.cat, unit:e.unit, factor:e.factor };
};

const INDUSTRIES = ['Manufacturing','IT/Software','Finance','Healthcare','Retail','Logistics','Construction','Energy','Agriculture','Education','Other'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const CHART_OPTS = {
  responsive:true, maintainAspectRatio:false,
  plugins:{
    legend:{ labels:{ color:'#4a5a6a', font:{ family:'Space Mono',size:10 } } },
    tooltip:{ backgroundColor:'#0b0f12', borderColor:'#1a2028', borderWidth:1,
      titleColor:'#e8eef4', bodyColor:'#4a5a6a',
      titleFont:{family:'Space Mono'}, bodyFont:{family:'Space Mono',size:10} },
  },
  scales:{
    x:{ ticks:{color:'#2a3a4a',font:{family:'Space Mono',size:9}}, grid:{color:'#1a202822'} },
    y:{ ticks:{color:'#2a3a4a',font:{family:'Space Mono',size:9}}, grid:{color:'#1a202844'} },
  },
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;700;800&display=swap');
:root{--bg:#060809;--surf:#0e1318;--brd:#243040;--brd2:#2e3d50;--txt:#f0f6ff;--mut:#8ba3bc;--grn:#10b981;--red:#ef4444;--ylw:#f59e0b;--s1:#f97316;--s2:#3b82f6;--s3:#a855f7;}
.em{min-height:100vh;background:var(--bg);font-family:'Space Mono',monospace;color:var(--txt);position:relative;overflow-x:hidden;}
.em::after{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;
  background-image:linear-gradient(rgba(56,189,248,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(56,189,248,.025) 1px,transparent 1px);
  background-size:48px 48px;}
.em-in{position:relative;z-index:1;max-width:1400px;margin:0 auto;padding:32px 28px;}
/* topbar */
.em-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;padding-bottom:18px;border-bottom:1px solid var(--brd);animation:fU .5s ease both;}
.em-brand-label{font-size:10px;letter-spacing:.15em;color:var(--mut);}
.em-brand-title{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;}
.em-brand-title span{color:var(--grn);}
.em-badge{padding:6px 13px;border-radius:4px;font-size:11px;letter-spacing:.08em;}
.em-badge-grn{border:1px solid #10b98133;color:var(--grn);background:#10b98108;}
.em-badge-mut{border:1px solid var(--brd2);color:var(--txt);background:var(--surf);}
.em-badge-ylw{border:1px solid #f59e0b33;color:var(--ylw);background:#f59e0b08;}
.em-badge-red{border:1px solid #ef444433;color:var(--red);background:#ef444408;}
.em-live{width:7px;height:7px;border-radius:50%;background:var(--grn);box-shadow:0 0 8px var(--grn);animation:pulse 2s ease infinite;}
/* scope cards */
.em-scopes{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px;animation:fU .5s ease .08s both;}
.em-sc-card{border-radius:10px;padding:18px 20px;border:1px solid var(--brd);background:var(--surf);position:relative;overflow:hidden;transition:transform .2s,border-color .2s;}
.em-sc-card:hover{transform:translateY(-2px);}
.em-sc-card::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,var(--ac)08,transparent 60%);}
.em-sc-lbl{font-size:10px;letter-spacing:.12em;color:var(--mut);margin-bottom:10px;position:relative;}
.em-sc-val{font-family:'Syne',sans-serif;font-size:26px;font-weight:800;margin-bottom:2px;position:relative;}
.em-sc-sub{font-size:11px;color:var(--mut);letter-spacing:.08em;position:relative;}
.em-sc-bar{height:3px;border-radius:2px;margin-top:12px;background:var(--brd);position:relative;}
.em-sc-fill{height:100%;border-radius:2px;transition:width .8s ease;}
/* tabs */
.em-tabs{display:flex;gap:0;margin-bottom:20px;border-bottom:1px solid var(--brd);animation:fU .5s ease .12s both;}
.em-tab{padding:10px 18px;font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.1em;cursor:pointer;border:none;background:none;color:var(--mut);border-bottom:2px solid transparent;transition:all .2s;margin-bottom:-1px;}
.em-tab:hover{color:var(--txt);}
.em-tab.on{color:var(--grn);border-bottom-color:var(--grn);}
/* card */
.em-card{background:var(--surf);border:1px solid var(--brd);border-radius:10px;padding:22px;animation:fU .5s ease .16s both;}
.em-ctit{font-size:10px;letter-spacing:.15em;color:var(--mut);margin-bottom:18px;display:flex;align-items:center;gap:8px;}
.em-ctit::before{content:'';width:12px;height:1px;background:var(--grn);}
/* grids */
.em-g2{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.em-g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;}
.em-glog{display:grid;grid-template-columns:2fr 1fr;gap:16px;}
/* form */
.em-fg4{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:12px;margin-bottom:14px;}
.em-fg3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px;}
.em-fg{display:flex;flex-direction:column;gap:5px;}
.em-lbl{font-size:11px;letter-spacing:.1em;color:var(--mut);}
.em-inp,.em-sel{padding:10px 12px;border-radius:6px;background:#0a1018;border:1px solid var(--brd);color:var(--txt);font-family:'Space Mono',monospace;font-size:12px;outline:none;transition:border-color .2s,box-shadow .2s;-webkit-appearance:none;width:100%;box-sizing:border-box;}
.em-inp:focus,.em-sel:focus{border-color:#10b98144;box-shadow:0 0 0 3px #10b98108;}
.em-inp::placeholder{color:var(--mut);opacity:.9;}
/* buttons */
.em-btn{padding:10px 18px;border-radius:6px;border:none;cursor:pointer;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.1em;font-weight:700;transition:all .2s;}
.em-btn-p{background:linear-gradient(135deg,#10b981,#059669);color:#fff;box-shadow:0 4px 14px #10b98122;}
.em-btn-p:hover{opacity:.88;transform:translateY(-1px);}
.em-btn-g{background:var(--surf);border:1px solid var(--brd2);color:var(--txt);}
.em-btn-g:hover{border-color:#10b98144;color:var(--grn);}
.em-btn-sm{padding:7px 14px;font-size:11px;}
/* preview */
.em-prev{padding:14px 16px;border-radius:7px;background:#10b98108;border:1px solid #10b98122;display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}
.em-prev-val{font-family:'Syne',sans-serif;font-size:24px;font-weight:800;color:var(--grn);}
/* ledger */
.em-lh,.em-lr{display:grid;grid-template-columns:96px 1fr 60px 130px 72px 80px 72px;padding:10px 14px;font-size:12px;align-items:center;}
.em-lh{color:var(--mut);letter-spacing:.08em;border-bottom:1px solid var(--brd);font-size:11px;}
.em-lr{border-bottom:1px solid #1a202833;transition:background .15s;border-radius:4px;}
.em-lr:hover{background:#ffffff03;}
.em-pill{font-size:10px;padding:4px 9px;border-radius:3px;letter-spacing:.04em;display:inline-flex;align-items:center;gap:4px;}
.em-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0;}
/* filters */
.em-fps{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;}
.em-fp{padding:6px 16px;border-radius:20px;font-size:11px;border:1px solid var(--brd);background:transparent;color:var(--txt);cursor:pointer;letter-spacing:.06em;font-family:'Space Mono',monospace;transition:all .2s;}
.em-fp.fa{border-color:var(--grn);color:var(--grn);background:#10b98108;}
.em-fp.f1{border-color:var(--s1);color:var(--s1);background:#f9731608;}
.em-fp.f2{border-color:var(--s2);color:var(--s2);background:#3b82f608;}
.em-fp.f3{border-color:var(--s3);color:var(--s3);background:#a855f708;}
/* intensity */
.em-irow{margin-bottom:14px;}
.em-ihr{display:flex;justify-content:space-between;margin-bottom:5px;font-size:12px;}
.em-itrack{height:4px;background:var(--brd);border-radius:2px;}
.em-ifill{height:100%;border-radius:2px;transition:width 1s ease;}
/* alerts */
.em-alert{padding:11px 16px;border-radius:7px;font-size:11px;display:flex;align-items:center;gap:10px;margin-bottom:12px;}
.em-alg{background:#10b98108;border:1px solid #10b98133;color:var(--grn);}
.em-aly{background:#f59e0b08;border:1px solid #f59e0b33;color:var(--ylw);}
.em-alr{background:#ef444408;border:1px solid #ef444433;color:var(--red);}
/* esg */
.em-esg-g{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;}
.em-fw{padding:14px;border-radius:8px;border:1px solid var(--brd);background:#080b0e;text-align:center;transition:all .2s;}
.em-fw:hover{border-color:#10b98144;background:#10b98108;}
/* netzero */
.em-nz{height:16px;border-radius:8px;background:var(--brd);position:relative;overflow:hidden;margin:12px 0;}
.em-nzf{height:100%;border-radius:8px;background:linear-gradient(90deg,var(--red),var(--ylw),var(--grn));transition:width 1s ease;}
/* pagination */
.em-pg{display:flex;align-items:center;justify-content:center;gap:10px;padding-top:16px;}
.em-pgb{padding:7px 16px;border-radius:5px;border:1px solid var(--brd2);background:var(--surf);color:var(--txt);font-family:'Space Mono',monospace;font-size:11px;cursor:pointer;transition:all .2s;}
.em-pgb:hover:not(:disabled){border-color:#10b98144;color:var(--grn);}
.em-pgb:disabled{opacity:.3;cursor:not-allowed;}
/* csv drop zone */
.em-drop{border:2px dashed var(--brd2);border-radius:8px;padding:24px;text-align:center;cursor:pointer;transition:all .2s;margin-bottom:14px;}
.em-drop:hover,.em-drop.over{border-color:#10b98166;background:#10b98108;}
/* yoy badge */
.em-yoy-pos{color:var(--red);font-size:10px;}
.em-yoy-neg{color:var(--grn);font-size:10px;}
@keyframes fU{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.8)}}
@media(max-width:1100px){.em-scopes{grid-template-columns:1fr 1fr;}}
@media(max-width:900px){.em-g2,.em-glog{grid-template-columns:1fr;}.em-fg4{grid-template-columns:1fr 1fr;}.em-lh,.em-lr{grid-template-columns:80px 1fr 50px 70px 60px;}.em-lh span:nth-child(6),.em-lr span:nth-child(6),.em-lh span:nth-child(7),.em-lr span:nth-child(7){display:none;}}
`;

// ── CSV parser for bulk import ────────────────────────────────────
const parseCSV = (text) => {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z_]/g,''));
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const obj  = {};
    headers.forEach((h,i) => { obj[h] = vals[i]?.trim().replace(/^"|"$/g,''); });
    const ef = EF[obj.activity];
    const qty = parseFloat(obj.quantity||obj.qty||0);
    return {
      date:     obj.date,
      activity: obj.activity,
      quantity: qty,
      notes:    obj.notes||'',
      unit:     ef?.unit,
      scope:    ef?.scope || parseInt(obj.scope),
      category: ef?.cat || obj.category,
      factor:   ef?.factor,
      co2e:     ef ? qty*ef.factor/1000 : parseFloat(obj.co2e||0),
    };
  }).filter(r => r.date && r.activity && r.quantity > 0);
};

// ═════════════════════════════════════════════════════════════════
export default function EmissionTracking() {
  const [records,  setRecords]  = useState([]);
  const [summary,  setSummary]  = useState(null);
  const [profile,  setProfile]  = useState(null);
  const [tab,      setTab]      = useState('log');
  const [sfilt,    setSfilt]    = useState('all');
  const [page,     setPage]     = useState(1);
  const [year,     setYear]     = useState(new Date().getFullYear());
  const [notif,    setNotif]    = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [synced,   setSynced]   = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef  = useRef();
  const PER_PAGE = 10;

  // Form
  const [form,  setForm]  = useState({ date:'', activity:'', qty:'', notes:'' });
  // Profile form
  const [pform, setPform] = useState({ companyName:'', industry:'', revenueCr:'', employees:'', floorSqft:'', netZeroYear:'2050', netZeroTargetCo2e:'', reportingYear:String(new Date().getFullYear()) });

  const toast = (msg, type='success') => { setNotif({msg,type}); setTimeout(()=>setNotif(null),4000); };

  // ── Load all data ─────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [acts, sum, prof] = await Promise.all([
        apiFetch(`/api/emissions/activities?limit=500`).catch(()=>null),
        apiFetch(`/api/emissions/summary?year=${year}`).catch(()=>null),
        apiFetch('/api/emissions/profile').catch(()=>null),
      ]);

      if (acts?.activities?.length) {
        setRecords(acts.activities.map(r => ({
          ...r,
          qty:  parseFloat(r.quantity||0),
          co2e: parseFloat(r.co2e||0),
          date: r.date?.slice(0,10),
        })));
        setSynced(true);
      }
      if (sum)  setSummary(sum);
      if (prof?.profile) {
        setProfile(prof.profile);
        setPform({
          companyName:        prof.profile.company_name||'',
          industry:           prof.profile.industry||'',
          revenueCr:          prof.profile.revenue_cr||'',
          employees:          prof.profile.employees||'',
          floorSqft:          prof.profile.floor_sqft||'',
          netZeroYear:        String(prof.profile.net_zero_year||2050),
          netZeroTargetCo2e:  prof.profile.net_zero_target_co2e||'',
          reportingYear:      String(prof.profile.reporting_year||new Date().getFullYear()),
        });
      }
    } catch(e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Reload summary when year changes
  useEffect(() => {
    apiFetch(`/api/emissions/summary?year=${year}`)
      .then(d => setSummary(d))
      .catch(()=>{});
  }, [year]);

  // ── Derived totals (use backend summary if available, else compute locally) ─
  const scope1 = summary?.scope1 ?? records.filter(r=>r.scope===1).reduce((s,r)=>s+r.co2e,0);
  const scope2 = summary?.scope2 ?? records.filter(r=>r.scope===2).reduce((s,r)=>s+r.co2e,0);
  const scope3 = summary?.scope3 ?? records.filter(r=>r.scope===3).reduce((s,r)=>s+r.co2e,0);
  const total  = scope1+scope2+scope3;
  const creditsNeeded = Math.ceil(total);

  const netZeroTarget = parseFloat(profile?.net_zero_target_co2e)||Math.max(50, total*0.6);
  const netZeroPct    = Math.min(100, total>0?(total/netZeroTarget)*100:0);
  const yoyChange     = summary?.yoyChange;

  // Intensity denominators from profile
  const revenueCr = parseFloat(profile?.revenue_cr)||null;
  const employees = parseInt(profile?.employees)||null;
  const floorSqft = parseInt(profile?.floor_sqft)||null;

  // ── Preview calc ──────────────────────────────────────────────
  const preview = calc(form.activity, form.qty);

  // ── Filtered ledger ───────────────────────────────────────────
  const filtered = records
    .filter(r => sfilt==='all' ? true : r.scope===parseInt(sfilt))
    .sort((a,b)=>new Date(b.date)-new Date(a.date));
  const totalPages   = Math.ceil(filtered.length/PER_PAGE);
  const pageRecords  = filtered.slice((page-1)*PER_PAGE, page*PER_PAGE);

  // ── Chart data ────────────────────────────────────────────────
  const byMonthScope = (sc) => MONTHS.map((_,i) => {
    const m = String(i+1).padStart(2,'0');
    if (summary?.monthlyTrend?.length) {
      const row = summary.monthlyTrend.find(r=>r.scope===sc && r.month===(i+1));
      return parseFloat(row?.total_co2e||0);
    }
    return records.filter(r=>r.scope===sc&&r.date?.includes(`${year}-${m}`)).reduce((s,r)=>s+r.co2e,0);
  });

  const trendData = {
    labels: MONTHS,
    datasets:[
      {label:'Scope 1',data:byMonthScope(1),borderColor:'#f97316',backgroundColor:'#f9731612',fill:true,tension:.4,pointBackgroundColor:'#f97316',pointRadius:3},
      {label:'Scope 2',data:byMonthScope(2),borderColor:'#3b82f6',backgroundColor:'#3b82f612',fill:true,tension:.4,pointBackgroundColor:'#3b82f6',pointRadius:3},
      {label:'Scope 3',data:byMonthScope(3),borderColor:'#a855f7',backgroundColor:'#a855f712',fill:true,tension:.4,pointBackgroundColor:'#a855f7',pointRadius:3},
    ],
  };

  const donutData = {
    labels:['Scope 1','Scope 2','Scope 3'],
    datasets:[{
      data:[scope1.toFixed(3),scope2.toFixed(3),scope3.toFixed(3)],
      backgroundColor:['#f9731620','#3b82f620','#a855f720'],
      borderColor:['#f97316','#3b82f6','#a855f7'],borderWidth:2,
    }],
  };

  const catSource = summary?.categoryBreakdown?.length
    ? summary.categoryBreakdown
    : (() => {
        const c={};
        records.forEach(r=>{c[r.category||'Other']=(c[r.category||'Other']||0)+r.co2e;});
        return Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([category,total_co2e])=>({category,total_co2e}));
      })();

  const catData = {
    labels: catSource.map(r=>r.category),
    datasets:[{label:'tCO₂e',data:catSource.map(r=>+parseFloat(r.total_co2e).toFixed(3)),backgroundColor:'#10b98120',borderColor:'#10b981',borderWidth:2,borderRadius:4}],
  };

  // ── Add record ────────────────────────────────────────────────
  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.date||!form.activity||!form.qty) return;
    const p = calc(form.activity, form.qty);
    if (!p) return;
    const tmp = { id:`tmp-${Date.now()}`, date:form.date, activity:form.activity, qty:parseFloat(form.qty), notes:form.notes, verified:false, ...p };
    setRecords(prev=>[tmp,...prev]);
    setForm({date:'',activity:'',qty:'',notes:''});
    toast(`✓ Logged ${p.co2e.toFixed(3)} tCO₂e — Scope ${p.scope}`);
    try {
      const res = await apiFetch('/api/emissions/log',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({date:form.date,activity:form.activity,quantity:parseFloat(form.qty),unit:p.unit,scope:p.scope,category:p.cat,factor:p.factor,co2e:p.co2e,notes:form.notes}),
      });
      if (res?.activity) {
        setRecords(prev=>prev.map(r=>r.id===tmp.id?{...tmp,...res.activity,qty:parseFloat(res.activity.quantity),co2e:parseFloat(res.activity.co2e),date:res.activity.date?.slice(0,10)}:r));
        setSynced(true);
        // Refresh summary
        apiFetch(`/api/emissions/summary?year=${year}`).then(d=>setSummary(d)).catch(()=>{});
      }
    } catch(err){ console.error(err); }
  };

  // ── Delete ────────────────────────────────────────────────────
  const handleDelete = async (id) => {
    setRecords(prev=>prev.filter(r=>r.id!==id));
    try { await apiFetch(`/api/emissions/activities/${id}`,{method:'DELETE'}); } catch{}
    toast('Record removed');
  };

  // ── CSV Export ────────────────────────────────────────────────
  const handleExport = () => {
    const rows = ['Date,Activity,Quantity,Unit,Scope,Category,Factor,tCO2e,Verified,Notes',
      ...records.map(r=>`${r.date},"${r.activity}",${r.qty||r.quantity},${r.unit||''},${r.scope||''},"${r.category||''}",${r.factor||''},${r.co2e?.toFixed(4)||0},${r.verified||false},"${r.notes||''}"`)
    ].join('\n');
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([rows],{type:'text/csv'}));
    a.download=`ethertrack_ghg_${year}.csv`; a.click();
    toast('✓ GHG inventory exported');
  };

  // ── CSV Import ────────────────────────────────────────────────
  const handleCSVImport = async (file) => {
    if (!file) return;
    const text = await file.text();
    const parsed = parseCSV(text);
    if (!parsed.length) { toast('No valid records found in CSV','error'); return; }
    toast(`Importing ${parsed.length} records…`);
    try {
      const res = await apiFetch('/api/emissions/bulk',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({records:parsed}),
      });
      toast(`✓ Imported ${res.inserted} records`);
      loadAll();
    } catch(e){ toast('Import failed','error'); }
  };

  // ── Save profile ──────────────────────────────────────────────
  const handleSaveProfile = async (e) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/emissions/profile',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          companyName:       pform.companyName,
          industry:          pform.industry,
          revenueCr:         parseFloat(pform.revenueCr)||0,
          employees:         parseInt(pform.employees)||0,
          floorSqft:         parseInt(pform.floorSqft)||0,
          netZeroYear:       parseInt(pform.netZeroYear)||2050,
          netZeroTargetCo2e: parseFloat(pform.netZeroTargetCo2e)||0,
          reportingYear:     parseInt(pform.reportingYear)||new Date().getFullYear(),
        }),
      });
      if (res?.profile) { setProfile(res.profile); toast('✓ Company profile saved'); }
    } catch(e){ toast('Failed to save profile','error'); }
  };

  // Intensity metrics — only show if profile set
  const intensities = [
    revenueCr && { label:'Carbon Intensity (Revenue)', val:total/revenueCr,          unit:'tCO₂e/₹Cr',  max:5,   color:total/revenueCr>2?'var(--red)':total/revenueCr>1?'var(--ylw)':'var(--grn)' },
    employees && { label:'Carbon Intensity (FTE)',     val:total/employees,           unit:'tCO₂e/emp',  max:2,   color:total/employees>1?'var(--red)':total/employees>.5?'var(--ylw)':'var(--grn)' },
    floorSqft && { label:'Carbon Intensity (Area)',    val:total/floorSqft*1000,      unit:'kgCO₂e/sqft',max:1,   color:'var(--grn)' },
    total>0   && { label:'Scope 3 Share',              val:scope3/total*100,          unit:'%',          max:100, color:scope3/total>.6?'var(--red)':scope3/total>.4?'var(--ylw)':'var(--grn)' },
  ].filter(Boolean);

  return (
    <>
      <style>{CSS}</style>
      {notif && (
        <div style={{position:'fixed',top:76,right:24,zIndex:9999,padding:'12px 20px',borderRadius:8,
          background:notif.type==='error'?'#450a0a':'#0b2a1e',
          border:`1px solid ${notif.type==='error'?'#ef444433':'#10b98133'}`,
          color:notif.type==='error'?'#f87171':'#10b981',
          fontFamily:'Space Mono,monospace',fontSize:11,boxShadow:'0 8px 32px #00000066',
          animation:'fU .3s ease'}}>
          {notif.msg}
        </div>
      )}

      <div className="em">
        <div className="em-in">

          {/* ── Topbar ── */}
          <div className="em-top">
            <div>
              <div className="em-brand-label">GHG PROTOCOL · ISO 14064-1 · DEFRA 2024</div>
              <div className="em-brand-title">Carbon <span>Intelligence</span></div>
              {profile?.company_name && (
                <div style={{fontSize:12,color:'var(--mut)',marginTop:3,letterSpacing:'.06em'}}>
                  {profile.company_name} · {profile.industry} · FY {profile.reporting_year}
                </div>
              )}
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',justifyContent:'flex-end'}}>
              <div className="em-live" title="Live tracking"/>
              {synced && <span className="em-badge em-badge-grn">DB SYNCED</span>}
              <select className="em-sel" style={{width:'auto',padding:'6px 12px',fontSize:11}}
                value={year} onChange={e=>{setYear(parseInt(e.target.value));setPage(1);}}>
                {[2023,2024,2025,2026].map(y=><option key={y}>{y}</option>)}
              </select>
              <span className="em-badge em-badge-mut" style={{fontSize:10}}>GHG Protocol</span>
              <span className="em-badge em-badge-mut" style={{fontSize:10}}>CDP</span>
              <span className="em-badge em-badge-mut" style={{fontSize:10}}>BRSR</span>
            </div>
          </div>

          {/* ── Alerts ── */}
          {!profile && (
            <div className="em-alert em-aly" style={{cursor:'pointer',fontSize:12}} onClick={()=>setTab('profile')}>
              <span>⚠</span>
              <span>Set up your <strong>company profile</strong> to unlock intensity metrics, net zero targets, and ESG reporting. Click to configure →</span>
            </div>
          )}
          {yoyChange !== null && yoyChange !== undefined && (
            <div className={`em-alert ${yoyChange>0?'em-alr':'em-alg'}`}>
              <span>{yoyChange>0?'↑':'↓'}</span>
              <span>
                Year-over-year emissions: <strong>{yoyChange>0?'+':''}{fmt(yoyChange,1)}%</strong> vs {year-1}.
                {yoyChange>0?' Increase requires attention.' : ' Great progress — keep reducing!'}
              </span>
            </div>
          )}
          {scope3>0 && scope3>scope1+scope2 && (
            <div className="em-alert em-aly">
              <span>⚠</span>
              <span>Scope 3 is <strong>{fmt(scope3/total*100,1)}%</strong> of total — supply chain & procurement require priority action</span>
            </div>
          )}

          {/* ── Scope Cards ── */}
          <div className="em-scopes">
            {[
              {sc:1,lbl:'SCOPE 1 · DIRECT',      sub:'Combustion & Fugitives',    val:scope1,color:'#f97316'},
              {sc:2,lbl:'SCOPE 2 · ENERGY',       sub:'Purchased Electricity/Heat',val:scope2,color:'#3b82f6'},
              {sc:3,lbl:'SCOPE 3 · VALUE CHAIN',  sub:'Supply Chain, Travel, Waste',val:scope3,color:'#a855f7'},
            ].map(({sc,lbl,sub,val,color})=>(
              <div key={sc} className="em-sc-card" style={{'--ac':color}}>
                <div className="em-sc-lbl">{lbl}</div>
                <div style={{fontSize:11,color,marginBottom:8,letterSpacing:'.04em'}}>{sub}</div>
                <div className="em-sc-val" style={{color}}>{fmt(val)}</div>
                <div className="em-sc-sub">tCO₂e · {fmt(total?val/total*100:0,1)}%</div>
                <div className="em-sc-bar">
                  <div className="em-sc-fill" style={{width:`${total?val/total*100:0}%`,background:color}}/>
                </div>
              </div>
            ))}
            {/* Total card */}
            <div className="em-sc-card" style={{'--ac':'#10b981'}}>
              <div className="em-sc-lbl">TOTAL FOOTPRINT · {year}</div>
              <div className="em-sc-val" style={{color:'#10b981',fontSize:30}}>{fmt(total)}</div>
              <div className="em-sc-sub">
                tCO₂e · {creditsNeeded} credits to offset
                {yoyChange!=null && (
                  <span className={yoyChange>0?'em-yoy-pos':'em-yoy-neg'} style={{marginLeft:8}}>
                    ({yoyChange>0?'+':''}{fmt(yoyChange,1)}% YoY)
                  </span>
                )}
              </div>
              <div style={{marginTop:12}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--mut)',marginBottom:5}}>
                  <span>NET ZERO PROGRESS</span>
                  <span style={{color:netZeroPct>80?'var(--red)':netZeroPct>50?'var(--ylw)':'var(--grn)'}}>
                    {fmt(netZeroPct,1)}% of limit
                  </span>
                </div>
                <div className="em-nz">
                  <div className="em-nzf" style={{width:`${netZeroPct}%`}}/>
                </div>
                <div style={{fontSize:11,color:'var(--mut)',textAlign:'right'}}>
                  Limit: {fmt(netZeroTarget)} tCO₂e · Target {profile?.net_zero_year||2050}
                </div>
              </div>
            </div>
          </div>

          {/* ── Tabs ── */}
          <div className="em-tabs">
            {[['log','LOG EMISSION'],['ledger','GHG LEDGER'],['analytics','ANALYTICS'],['intensity','INTENSITY'],['esg','ESG REPORT'],['profile','COMPANY PROFILE']].map(([k,v])=>(
              <button key={k} className={`em-tab${tab===k?' on':''}`} onClick={()=>{setTab(k);setPage(1);}}>
                {v}{k==='profile'&&!profile?' ⚠':''}
              </button>
            ))}
          </div>

          {loading && (
            <div style={{padding:40,textAlign:'center',color:'var(--mut)',fontSize:11,letterSpacing:'.1em'}}>
              LOADING GHG DATA…
            </div>
          )}

          {!loading && (<>

          {/* ══ LOG TAB ══ */}
          {tab==='log' && (
            <div className="em-glog">
              <div className="em-card">
                <div className="em-ctit">LOG NEW EMISSION RECORD</div>

                {preview && (
                  <div className="em-prev">
                    <div>
                      <div style={{fontSize:11,color:'var(--mut)',letterSpacing:'.1em',marginBottom:6}}>CALCULATED CO₂e</div>
                      <div className="em-prev-val">{preview.co2e.toFixed(4)}</div>
                      <div style={{fontSize:11,color:'var(--mut)',marginTop:2}}>
                        tonnes CO₂e · Scope {preview.scope} · {preview.cat}
                      </div>
                    </div>
                    <div style={{fontSize:11,color:'var(--mut)',textAlign:'right',lineHeight:1.9}}>
                      Factor: <strong style={{color:'var(--txt)'}}>{preview.factor} kg CO₂e/{preview.unit}</strong><br/>
                      Source: DEFRA 2024 / IPCC AR6<br/>
                      Method: Activity-based GHG
                    </div>
                  </div>
                )}

                <form onSubmit={handleAdd}>
                  <div className="em-fg4">
                    <div className="em-fg">
                      <label className="em-lbl">EMISSION ACTIVITY</label>
                      <select className="em-sel" value={form.activity}
                        onChange={e=>setForm(f=>({...f,activity:e.target.value}))} required>
                        <option value="">Select activity…</option>
                        {[1,2,3].map(s=>(
                          <optgroup key={s} label={`── SCOPE ${s} ──`}>
                            {Object.entries(EF).filter(([,ef])=>ef.scope===s).map(([name])=>(
                              <option key={name} value={name}>{name}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                    <div className="em-fg">
                      <label className="em-lbl">QUANTITY{EF[form.activity]?` (${EF[form.activity].unit})`:''}</label>
                      <input className="em-inp" type="number" step="0.001" min="0"
                        placeholder="0.000"
                        value={form.qty} onChange={e=>setForm(f=>({...f,qty:e.target.value}))} required/>
                    </div>
                    <div className="em-fg">
                      <label className="em-lbl">DATE</label>
                      <input className="em-inp" type="date"
                        value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} required/>
                    </div>
                    <div className="em-fg">
                      <label className="em-lbl">NOTES</label>
                      <input className="em-inp" type="text" placeholder="Description…"
                        value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/>
                    </div>
                  </div>
                  <div style={{display:'flex',gap:10}}>
                    <button type="submit" className="em-btn em-btn-p">LOG EMISSION →</button>
                    <button type="button" className="em-btn em-btn-g" onClick={handleExport}>EXPORT CSV</button>
                  </div>
                </form>

                {/* CSV Bulk Import */}
                <div style={{marginTop:20,borderTop:'1px solid var(--brd)',paddingTop:18}}>
                  <div className="em-ctit">BULK IMPORT — CSV</div>
                  <div
                    className={`em-drop${dragOver?' over':''}`}
                    onDragOver={e=>{e.preventDefault();setDragOver(true);}}
                    onDragLeave={()=>setDragOver(false)}
                    onDrop={e=>{e.preventDefault();setDragOver(false);handleCSVImport(e.dataTransfer.files[0]);}}
                    onClick={()=>fileRef.current?.click()}
                  >
                    <div style={{fontSize:12,color:'var(--txt)',letterSpacing:'.06em'}}>
                      DROP CSV HERE or CLICK TO UPLOAD
                    </div>
                    <div style={{fontSize:11,color:'var(--mut)',marginTop:6}}>
                      Required columns: date, activity, quantity — optional: notes
                    </div>
                  </div>
                  <input ref={fileRef} type="file" accept=".csv" style={{display:'none'}}
                    onChange={e=>handleCSVImport(e.target.files[0])}/>
                  <a href="data:text/plain,date,activity,quantity,notes" download="ethertrack_template.csv"
                    style={{fontSize:11,color:'var(--grn)',letterSpacing:'.06em'}}>
                    ↓ DOWNLOAD CSV TEMPLATE
                  </a>
                </div>
              </div>

              {/* Factor reference panel */}
              <div className="em-card">
                <div className="em-ctit">EMISSION FACTOR REFERENCE</div>
                <div style={{maxHeight:500,overflowY:'auto'}}>
                  {[1,2,3].map(s=>(
                    <div key={s} style={{marginBottom:16}}>
                      <div style={{fontSize:11,letterSpacing:'.1em',color:SC[s],marginBottom:8,display:'flex',alignItems:'center',gap:6}}>
                        <span style={{width:8,height:1,background:SC[s],display:'inline-block'}}/>SCOPE {s}
                      </div>
                      {Object.entries(EF).filter(([,ef])=>ef.scope===s).map(([name,ef])=>(
                        <div key={name} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid var(--brd)44',fontSize:11}}>
                          <span style={{color:'var(--mut)'}}>{name}</span>
                          <span style={{color:SC[s]}}>{ef.factor} kg/{ef.unit}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div style={{marginTop:10,fontSize:11,color:'var(--mut)',lineHeight:1.9}}>
                  Sources: DEFRA 2024 · IPCC AR6 · IEA 2024 · CEA India 2023
                </div>
              </div>
            </div>
          )}

          {/* ══ LEDGER TAB ══ */}
          {tab==='ledger' && (
            <div className="em-card">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                <div className="em-ctit" style={{marginBottom:0}}>GHG INVENTORY LEDGER · {year}</div>
                <div style={{display:'flex',gap:8}}>
                  <span style={{fontSize:11,color:'var(--mut)',alignSelf:'center'}}>{filtered.length} records</span>
                  <button className="em-btn em-btn-g em-btn-sm" onClick={handleExport}>EXPORT CSV</button>
                </div>
              </div>

              <div className="em-fps">
                {[['all','ALL'],['1','SCOPE 1'],['2','SCOPE 2'],['3','SCOPE 3']].map(([k,v])=>(
                  <button key={k} className={`em-fp${sfilt===k?k==='all'?' fa':` f${k}`:''}`}
                    onClick={()=>{setSfilt(k);setPage(1);}}>
                    {v}
                  </button>
                ))}
              </div>

              <div className="em-lh">
                <span>DATE</span><span>ACTIVITY</span><span>S</span>
                <span>CATEGORY</span><span>QTY</span><span>tCO₂e</span><span>STATUS</span>
              </div>

              {pageRecords.length===0
                ? <div style={{padding:32,textAlign:'center',color:'var(--mut)',fontSize:11}}>No records — log your first emission above</div>
                : pageRecords.map(r=>{
                    const col=SC[r.scope]||'#888';
                    return (
                      <div key={r.id} className="em-lr">
                        <span style={{color:'var(--mut)',fontSize:11}}>{r.date}</span>
                        <span style={{fontSize:10}}>
                          {r.activity}
                          {r.notes&&<span style={{color:'var(--mut)',fontSize:11,display:'block'}}>{r.notes}</span>}
                        </span>
                        <span>
                          <span className="em-pill" style={{background:`${col}14`,color:col,border:`1px solid ${col}33`}}>
                            S{r.scope}
                          </span>
                        </span>
                        <span style={{fontSize:11,color:'var(--mut)'}}>{r.category}</span>
                        <span style={{fontSize:10}}>{fmt(r.qty||r.quantity,1)} <span style={{fontSize:11,color:'var(--mut)'}}>{r.unit}</span></span>
                        <span style={{color:col,fontWeight:700}}>{r.co2e?.toFixed(3)}</span>
                        <span style={{display:'flex',alignItems:'center',gap:6}}>
                          <span className="em-pill" style={{
                            background:r.verified?'#10b98114':'#f59e0b14',
                            color:r.verified?'#10b981':'#f59e0b',
                            border:`1px solid ${r.verified?'#10b98133':'#f59e0b33'}`,
                          }}>
                            <span className="em-dot" style={{background:r.verified?'#10b981':'#f59e0b'}}/>
                            {r.verified?'VERIFIED':'PENDING'}
                          </span>
                          <button onClick={()=>handleDelete(r.id)} style={{background:'none',border:'none',color:'#ef444444',cursor:'pointer',fontSize:12,padding:'0 2px',transition:'color .15s'}}
                            onMouseEnter={e=>e.target.style.color='#ef4444'}
                            onMouseLeave={e=>e.target.style.color='#ef444444'}>✕</button>
                        </span>
                      </div>
                    );
                  })
              }

              {totalPages>1&&(
                <div className="em-pg">
                  <button className="em-pgb" disabled={page===1} onClick={()=>setPage(p=>p-1)}>← PREV</button>
                  <span style={{fontSize:11,color:'var(--mut)'}}>PAGE {page} / {totalPages}</span>
                  <button className="em-pgb" disabled={page===totalPages} onClick={()=>setPage(p=>p+1)}>NEXT →</button>
                </div>
              )}
            </div>
          )}

          {/* ══ ANALYTICS TAB ══ */}
          {tab==='analytics' && (
            <div style={{display:'flex',flexDirection:'column',gap:16}}>
              <div className="em-g2">
                <div className="em-card">
                  <div className="em-ctit">MONTHLY TREND BY SCOPE — {year}</div>
                  <div style={{height:260}}><Line data={trendData} options={CHART_OPTS}/></div>
                </div>
                <div className="em-card">
                  <div className="em-ctit">SCOPE DISTRIBUTION</div>
                  <div style={{height:260,display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <div style={{width:220,height:220}}>
                      <Doughnut data={donutData} options={{...CHART_OPTS,scales:undefined,cutout:'68%'}}/>
                    </div>
                  </div>
                </div>
              </div>
              <div className="em-card">
                <div className="em-ctit">EMISSIONS BY CATEGORY (tCO₂e)</div>
                <div style={{height:220}}><Bar data={catData} options={CHART_OPTS}/></div>
              </div>
              {/* Top emitters */}
              <div className="em-card">
                <div className="em-ctit">TOP 5 EMITTING ACTIVITIES</div>
                {[...records].sort((a,b)=>b.co2e-a.co2e).slice(0,5).map((r,i)=>(
                  <div key={r.id} style={{display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:'1px solid var(--brd)44',fontSize:12}}>
                    <span style={{color:'var(--mut)'}}>
                      <span style={{color:SC[r.scope],marginRight:8,fontSize:11}}>S{r.scope}</span>
                      {r.activity}
                      <span style={{color:'var(--mut)',fontSize:11,display:'block'}}>{r.date} · {r.notes}</span>
                    </span>
                    <span style={{color:SC[r.scope],fontWeight:700,flexShrink:0,marginLeft:12}}>
                      {r.co2e?.toFixed(3)} t
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══ INTENSITY TAB ══ */}
          {tab==='intensity' && (
            <div className="em-g2">
              <div className="em-card">
                <div className="em-ctit">CARBON INTENSITY METRICS</div>
                {intensities.length===0
                  ? <div className="em-alert em-aly" style={{cursor:'pointer',fontSize:12}} onClick={()=>setTab('profile')}>
                      <span>⚠</span>
                      <span>Set up company profile to see intensity metrics →</span>
                    </div>
                  : intensities.map(({label,val,unit,max,color})=>(
                    <div key={label} className="em-irow">
                      <div className="em-ihr">
                        <span style={{color:'var(--mut)',fontSize:11}}>{label}</span>
                        <span style={{color,fontSize:11,fontWeight:700}}>{fmt(val,3)} <span style={{fontSize:11,color:'var(--mut)'}}>{unit}</span></span>
                      </div>
                      <div className="em-itrack">
                        <div className="em-ifill" style={{width:`${Math.min(100,val/max*100)}%`,background:color}}/>
                      </div>
                    </div>
                  ))
                }
                <div style={{marginTop:20,padding:'14px 16px',borderRadius:8,background:'#10b98108',border:'1px solid #10b98122',fontSize:12,color:'var(--txt)',lineHeight:1.9}}>
                  💡 <strong style={{color:'var(--grn)'}}>Key Insight:</strong> Switching your electricity to renewable sources
                  would eliminate <strong style={{color:'var(--grn)'}}>{fmt(scope2*0.96)} tCO₂e</strong> of Scope 2 emissions (96% reduction).
                </div>
              </div>

              <div className="em-card">
                <div className="em-ctit">DECARBONIZATION SCENARIOS</div>
                {[
                  {name:'Baseline (Current)',           val:total,                         pct:100,             color:'var(--red)'},
                  {name:'Renewable Electricity Switch',  val:total-scope2*0.96,             pct:(total-scope2*0.96)/Math.max(total,0.001)*100, color:'var(--ylw)'},
                  {name:'+ Supply Chain Optimisation',  val:total-scope2*0.96-scope3*0.3,  pct:(total-scope2*0.96-scope3*0.3)/Math.max(total,0.001)*100, color:'#10b981'},
                  {name:'Net Zero (Offset Balance)',    val:0,                             pct:0,               color:'var(--s2)'},
                ].map(({name,val,pct,color})=>(
                  <div key={name} className="em-irow">
                    <div className="em-ihr">
                      <span style={{color:'var(--mut)',fontSize:11}}>{name}</span>
                      <span style={{color,fontSize:11,fontWeight:700}}>{fmt(val)} <span style={{fontSize:11,color:'var(--mut)'}}>tCO₂e</span></span>
                    </div>
                    <div className="em-itrack">
                      <div className="em-ifill" style={{width:`${pct}%`,background:color}}/>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══ ESG REPORT TAB ══ */}
          {tab==='esg' && (
            <div style={{display:'flex',flexDirection:'column',gap:16}}>
              {/* Frameworks */}
              <div className="em-card">
                <div className="em-ctit">FRAMEWORK COMPLIANCE STATUS</div>
                <div className="em-esg-g">
                  {[
                    {name:'GHG Protocol', sub:'Corporate Standard',       ok:true,  status:'COMPLIANT'   },
                    {name:'CDP',          sub:'Climate Questionnaire',     ok:false, status:'IN PROGRESS' },
                    {name:'TCFD',         sub:'Climate Risk Disclosure',   ok:false, status:'PARTIAL'     },
                    {name:'GRI 305',      sub:'Emissions Standard',        ok:true,  status:'COMPLIANT'   },
                    {name:'IFRS S2',      sub:'Climate Disclosures',       ok:false, status:'IN PROGRESS' },
                    {name:'BRSR',         sub:'India SEBI Regulatory',     ok:true,  status:'COMPLIANT'   },
                  ].map(({name,sub,ok,status})=>(
                    <div key={name} className="em-fw">
                      <div style={{fontSize:11,fontWeight:700,marginBottom:4}}>{name}</div>
                      <div style={{fontSize:11,color:'var(--mut)',letterSpacing:'.06em',marginBottom:10}}>{sub}</div>
                      <span className="em-pill" style={{
                        background:ok?'#10b98114':'#f59e0b14',
                        color:ok?'#10b981':'#f59e0b',
                        border:`1px solid ${ok?'#10b98133':'#f59e0b33'}`,
                        display:'inline-flex',
                      }}>{status}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="em-g2">
                {/* Annual Summary */}
                <div className="em-card">
                  <div className="em-ctit">ANNUAL GHG INVENTORY — FY {year}</div>
                  {[
                    {label:'Scope 1 — Direct Emissions',      val:fmt(scope1),             unit:'tCO₂e', color:'#f97316'},
                    {label:'Scope 2 — Purchased Energy',      val:fmt(scope2),             unit:'tCO₂e', color:'#3b82f6'},
                    {label:'Scope 3 — Value Chain',           val:fmt(scope3),             unit:'tCO₂e', color:'#a855f7'},
                    {label:'TOTAL GHG EMISSIONS',             val:fmt(total),              unit:'tCO₂e', color:'var(--grn)', bold:true},
                    {label:'Carbon Intensity (per employee)',  val:employees?fmt(total/employees,3):'—', unit:'tCO₂e/FTE', color:'var(--txt)'},
                    {label:'Credits Required to Offset',      val:String(creditsNeeded),   unit:'credits',color:'var(--grn)'},
                    {label:'Offset Cost @ ₹842/credit',       val:`₹${(creditsNeeded*842).toLocaleString('en-IN')}`, unit:'', color:'var(--grn)'},
                  ].map(({label,val,unit,color,bold})=>(
                    <div key={label} style={{display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:'1px solid var(--brd)44',fontSize:bold?12:10,fontWeight:bold?700:400}}>
                      <span style={{color:'var(--mut)'}}>{label}</span>
                      <span style={{color}}>{val} <span style={{fontSize:11,color:'var(--mut)'}}>{unit}</span></span>
                    </div>
                  ))}
                  <div style={{marginTop:14,fontSize:11,color:'var(--mut)',lineHeight:1.9}}>
                    Reporting boundary: Operational control · Base year: {profile?.base_year||2024} ·
                    Methodology: GHG Protocol Corporate Standard · Verification status: Third-party pending
                  </div>
                </div>

                {/* Net Zero Progress */}
                <div className="em-card">
                  <div className="em-ctit">NET ZERO ROADMAP</div>
                  {[
                    {label:`2030 — 50% reduction`,target:total*.5},
                    {label:`2040 — 80% reduction`,target:total*.2},
                    {label:`${profile?.net_zero_year||2050} — Net Zero`,target:0},
                  ].map(({label,target})=>(
                    <div key={label} className="em-irow">
                      <div className="em-ihr">
                        <span style={{color:'var(--mut)',fontSize:11}}>{label}</span>
                        <span style={{color:'var(--grn)',fontSize:11}}>Target: {fmt(target)} t</span>
                      </div>
                      <div className="em-itrack">
                        <div className="em-ifill" style={{width:'2%',background:'var(--grn)'}}/>
                      </div>
                      <div style={{fontSize:11,color:'var(--mut)',marginTop:3}}>
                        Gap: {fmt(Math.max(0,total-target))} tCO₂e to reduce
                      </div>
                    </div>
                  ))}
                  <div style={{marginTop:16,padding:'14px',borderRadius:8,background:'#3b82f608',border:'1px solid #3b82f622',fontSize:12,color:'var(--mut)',lineHeight:1.9}}>
                    <strong style={{color:'#3b82f6'}}>Offset Now:</strong> Purchase{' '}
                    <strong style={{color:'var(--grn)'}}>{creditsNeeded} carbon credits</strong>{' '}
                    on EtherTrack to achieve net-zero for FY {year}.
                    <br/>
                    <a href="/carbon-credits" style={{color:'var(--grn)',textDecoration:'none',fontSize:11,letterSpacing:'.08em'}}>
                      → GO TO MARKETPLACE
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══ PROFILE TAB ══ */}
          {tab==='profile' && (
            <div className="em-g2">
              <div className="em-card">
                <div className="em-ctit">COMPANY PROFILE & REPORTING BOUNDARY</div>
                <form onSubmit={handleSaveProfile}>
                  <div className="em-fg3">
                    <div className="em-fg">
                      <label className="em-lbl">COMPANY NAME</label>
                      <input className="em-inp" type="text" placeholder="Acme Corp"
                        value={pform.companyName} onChange={e=>setPform(f=>({...f,companyName:e.target.value}))}/>
                    </div>
                    <div className="em-fg">
                      <label className="em-lbl">INDUSTRY</label>
                      <select className="em-sel" value={pform.industry} onChange={e=>setPform(f=>({...f,industry:e.target.value}))}>
                        <option value="">Select…</option>
                        {INDUSTRIES.map(i=><option key={i}>{i}</option>)}
                      </select>
                    </div>
                    <div className="em-fg">
                      <label className="em-lbl">REPORTING YEAR</label>
                      <select className="em-sel" value={pform.reportingYear} onChange={e=>setPform(f=>({...f,reportingYear:e.target.value}))}>
                        {[2023,2024,2025,2026].map(y=><option key={y}>{y}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{marginBottom:14,fontSize:11,color:'var(--txt)',letterSpacing:'.1em',borderBottom:'1px solid var(--brd)',paddingBottom:12}}>
                    INTENSITY DENOMINATORS
                  </div>
                  <div className="em-fg3" style={{marginBottom:14}}>
                    <div className="em-fg">
                      <label className="em-lbl">ANNUAL REVENUE (₹ crore)</label>
                      <input className="em-inp" type="number" step="0.1" placeholder="e.g. 42.5"
                        value={pform.revenueCr} onChange={e=>setPform(f=>({...f,revenueCr:e.target.value}))}/>
                    </div>
                    <div className="em-fg">
                      <label className="em-lbl">EMPLOYEES (FTE)</label>
                      <input className="em-inp" type="number" placeholder="e.g. 120"
                        value={pform.employees} onChange={e=>setPform(f=>({...f,employees:e.target.value}))}/>
                    </div>
                    <div className="em-fg">
                      <label className="em-lbl">FLOOR AREA (sqft)</label>
                      <input className="em-inp" type="number" placeholder="e.g. 18000"
                        value={pform.floorSqft} onChange={e=>setPform(f=>({...f,floorSqft:e.target.value}))}/>
                    </div>
                  </div>
                  <div style={{marginBottom:14,fontSize:11,color:'var(--txt)',letterSpacing:'.1em',borderBottom:'1px solid var(--brd)',paddingBottom:12}}>
                    NET ZERO TARGETS
                  </div>
                  <div className="em-fg3" style={{marginBottom:20}}>
                    <div className="em-fg">
                      <label className="em-lbl">NET ZERO TARGET YEAR</label>
                      <select className="em-sel" value={pform.netZeroYear} onChange={e=>setPform(f=>({...f,netZeroYear:e.target.value}))}>
                        {[2030,2035,2040,2045,2050].map(y=><option key={y}>{y}</option>)}
                      </select>
                    </div>
                    <div className="em-fg">
                      <label className="em-lbl">ANNUAL CO₂e LIMIT (tCO₂e)</label>
                      <input className="em-inp" type="number" step="0.1" placeholder="e.g. 80"
                        value={pform.netZeroTargetCo2e} onChange={e=>setPform(f=>({...f,netZeroTargetCo2e:e.target.value}))}/>
                    </div>
                    <div/>
                  </div>
                  <button type="submit" className="em-btn em-btn-p">SAVE PROFILE →</button>
                </form>
              </div>
              <div className="em-card">
                <div className="em-ctit">CURRENT PROFILE</div>
                {profile ? (
                  <>
                    {[
                      ['Company',         profile.company_name||'—'],
                      ['Industry',        profile.industry||'—'],
                      ['Reporting Year',  profile.reporting_year||'—'],
                      ['Revenue',         profile.revenue_cr?`₹${profile.revenue_cr} Cr`:'—'],
                      ['Employees',       profile.employees||'—'],
                      ['Floor Area',      profile.floor_sqft?`${Number(profile.floor_sqft).toLocaleString()} sqft`:'—'],
                      ['Net Zero Target', `${profile.net_zero_year||2050}`],
                      ['Annual CO₂ Limit',profile.net_zero_target_co2e?`${profile.net_zero_target_co2e} tCO₂e`:'—'],
                    ].map(([k,v])=>(
                      <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:'1px solid var(--brd)44',fontSize:12}}>
                        <span style={{color:'var(--mut)'}}>{k}</span>
                        <span>{v}</span>
                      </div>
                    ))}
                    <div style={{marginTop:16}} className="em-alert em-alg">
                      <span>✓</span><span>Profile complete — intensity metrics and ESG targets are active</span>
                    </div>
                  </>
                ) : (
                  <div style={{padding:32,textAlign:'center',color:'var(--mut)',fontSize:11}}>
                    No profile set — fill in the form to unlock intensity metrics and net zero tracking
                  </div>
                )}
              </div>
            </div>
          )}

          </>)}
        </div>
      </div>
    </>
  );
}