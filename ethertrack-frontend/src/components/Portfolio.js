// PortfolioV3.jsx — EtherTrack Enterprise Carbon Portfolio
// PRODUCTION HARDENED
//
// [FIX-SHARED-PRICING] REFERENCE_PRICES / STANDARD_PREMIUM / INDIA_CCTS_FLOOR /
//   INDIA_CCTS_CEILING / getReferencePrice used to be defined locally in this
//   file AND separately (differently) inside PortfolioContext's `stats` calc,
//   which is why the Dashboard's PORTFOLIO VALUE card never matched this
//   page's PORTFOLIO VALUE stat. All pricing logic now lives in
//   utils/creditPricing.js and is imported here; `marketBuckets` (a live
//   supply/demand/trade-price snapshot) comes from usePortfolio() — the same
//   object PortfolioContext's `stats` uses internally — so this page and the
//   Dashboard always reconcile.
// [FIX-DEMAND-BADGE] Credit cards and the metadata modal now show a live
//   🔥 HIGH DEMAND / 📉 OVERSUPPLIED / ● BALANCED badge from the same
//   marketBuckets snapshot used for pricing.
'use strict';

import React, {
  useState, useContext, useEffect, useRef,
  useMemo, useCallback,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../App';
import { usePortfolio, vintagePenalty } from '../context/PortfolioContext';
import {
  getReferencePrice, getDemandSupplyBadge,
  INDIA_CCTS_FLOOR, INDIA_CCTS_CEILING,
} from '../utils/creditPricing';
import { txAPI, apiFetch, apiFetchMultipart } from '../services/api';
import { generateReport } from '../services/ReportPDF';
import ErrorBoundary from '../components/ErrorBoundary';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line, Legend,
} from 'recharts';

// ── RBAC ─────────────────────────────────────────────────────────
const PERMISSIONS = {
  'portfolio:read'          : ['owner','admin','manager','auditor','viewer'],
  'portfolio:write'         : ['owner','admin','manager'],
  'portfolio:submit_credit' : ['owner','admin','manager'],
  'portfolio:retire'        : ['owner','admin'],
  'portfolio:retire_request': ['owner','admin','manager'],
  'portfolio:approve_retire': ['owner','admin'],
  'portfolio:export'        : ['owner','admin','manager','auditor'],
  'portfolio:list'          : ['owner','admin','manager'],
  'emissions:read'          : ['owner','admin','manager','auditor','viewer'],
  'emissions:write'         : ['owner','admin','manager'],
  'emissions:export'        : ['owner','admin','manager','auditor'],
  'reports:generate'        : ['owner','admin','manager','auditor'],
  'reports:export_pdf'      : ['owner','admin','manager','auditor'],
  'team:invite'             : ['owner','admin'],
  'team:remove'             : ['owner','admin'],
  'team:change_role'        : ['owner','admin'],
  'verifier:connect'        : ['owner','admin'],
  'org:billing'             : ['owner'],
};

// ── Constants ─────────────────────────────────────────────────────
const REGISTRIES = {
  VCS : { label:'Verra VCS',                color:'#22c55e', bg:'#0d2e1f', link:'https://registry.verra.org/app/projectDetail/VCS/' },
  GS  : { label:'Gold Standard',            color:'#facc15', bg:'#1a1500', link:'https://registry.goldstandard.org/projects/details/' },
  CDM : { label:'Clean Dev. Mechanism',     color:'#60a5fa', bg:'#0a1628', link:'https://cdm.unfccc.int/Projects/DB/details?id=' },
  ACR : { label:'American Carbon Registry', color:'#a78bfa', bg:'#120a28', link:'https://acr2.apx.com/mymodule/reg/prjView.asp?id1=' },
  BEE : { label:'BEE India (CCTS)',         color:'#f97316', bg:'#1a0a00', link:'https://beeindia.gov.in/en/ccts/' },
};

const ROLE_META = {
  owner   : { color:'#f97316', bg:'#1a0a00', border:'#f9731633', label:'OWNER',   icon:'👑' },
  admin   : { color:'#f87171', bg:'#1a0707', border:'#f8717133', label:'ADMIN',   icon:'🛡' },
  manager : { color:'#22c55e', bg:'#0d2e1f', border:'#22c55e33', label:'MANAGER', icon:'📊' },
  auditor : { color:'#a78bfa', bg:'#120a28', border:'#a78bfa33', label:'AUDITOR', icon:'🔍' },
  viewer  : { color:'#60a5fa', bg:'#060e18', border:'#60a5fa33', label:'VIEWER',  icon:'👁' },
};

const PLAN_LIMITS = {
  free       : { credits:0,        exports:[],                       label:'FREE',       color:'#86efac44' },
  starter    : { credits:Infinity, exports:['csv'],                  label:'STARTER',    color:'#60a5fa'   },
  growth     : { credits:Infinity, exports:['csv','pdf'],            label:'GROWTH',     color:'#22c55e'   },
  corporate  : { credits:Infinity, exports:['csv','pdf','verifier'], label:'CORPORATE',  color:'#f59e0b'   },
};

// [FIX-SHARED-PRICING] REFERENCE_PRICES / STANDARD_PREMIUM / INDIA_CCTS_FLOOR /
// INDIA_CCTS_CEILING removed from here — now imported from
// utils/creditPricing.js so this page and PortfolioContext's `stats` always
// use identical pricing constants.

const CHART_COLORS      = ['#22c55e','#60a5fa','#facc15','#a78bfa','#f97316','#f87171','#34d399'];
const VERIFY_BASE_URL   = 'https://ethertrackapp.vercel.app/verify';
const MAX_FILE_SIZE_MB  = 5;

const CA_OPTIONS = [
  { value:'none',        label:'None — voluntary only',             color:'#86efac44' },
  { value:'host_issued', label:'Host country CA issued (Art. 6.2)', color:'#22c55e'   },
  { value:'itmo',        label:'ITMO authorised (Art. 6.4)',        color:'#60a5fa'   },
  { value:'pending',     label:'CA pending confirmation',           color:'#f59e0b'   },
];

const SDG_OPTIONS = [
  { id:1, label:'No Poverty'        }, { id:3,  label:'Good Health'       },
  { id:6, label:'Clean Water'       }, { id:7,  label:'Clean Energy'      },
  { id:8, label:'Decent Work'       }, { id:11, label:'Sustainable Cities' },
  { id:13,label:'Climate Action'    }, { id:14, label:'Life Below Water'   },
  { id:15,label:'Life on Land'      },
];

const PROJECT_TYPES = [
  'Renewable Energy (BEE)','Green Hydrogen (BEE)','Industrial Energy Efficiency (BEE)',
  'Landfill Methane Recovery (BEE)','Mangrove Afforestation (BEE)',
  'Renewable Energy with Storage (BEE)','Offshore Wind (BEE)','Compressed Biogas (BEE)',
  'Renewable Energy','Reforestation','REDD+','Methane Capture',
  'Energy Efficiency','Blue Carbon','Cookstoves','Soil Carbon','Industrial Gas','Avoided Deforestation',
];

const CREDIT_TYPES = [
  { value:'voluntary',  label:'Voluntary (VCU)',  color:'#22c55e', desc:'Voluntary Carbon Unit' },
  { value:'compliance', label:'Compliance (CCC)', color:'#f97316', desc:'Carbon Credit Certificate — India CCTS' },
];

const VERIFICATION_STATUSES = [
  { value:'pending',     label:'Not Verified'  },
  { value:'in_progress', label:'In Progress'   },
  { value:'verified',    label:'Verified'      },
];

const VALID_REGISTRY_URL_PREFIXES = [
  'https://registry.verra.org',
  'https://registry.goldstandard.org',
  'https://cdm.unfccc.int',
  'https://acr2.apx.com',
  'https://beeindia.gov.in',
];

const emptyForm = {
  projectName:'', location:'', country:'', standard:'VCS', projectType:'',
  developer:'', credits:'', vintageYear:'', expiryDate:'', serialNumber:'',
  projectId:'', docFile:null, pincode:'', creditType:'voluntary',
  cbamEligible:false, acvaName:'', acvaDate:'', acvaStatus:'pending',
  icmRegistryId:'', bankingStatus:'available', sdgTags:[],
  correspondingAdjustment:'none', icvcmCcpEligible:false, icvcmCcpLabel:'',
  icvcmCcpDate:'', registryLink:'', methodologyId:'', additionalityType:'not_specified',
  permanenceRating:'not_rated', coBenefitsVerified:false,
};

// ── Pure helpers ──────────────────────────────────────────────────
// [FIX-SHARED-PRICING] getReferencePrice(projectType, standard, vintageYear)
// removed from here — now imported from utils/creditPricing.js as
// getReferencePrice(projectType, standard, vintageYear, creditType,
// marketBuckets), which additionally factors in live supply/demand and
// recent trade prices instead of a pure static lookup. Every call site
// below has been updated to pass the extra two args.

const getDaysUntilExpiry = (expiryDate) => {
  if (!expiryDate) return null;
  return Math.ceil((new Date(expiryDate).getTime() - Date.now()) / 86400000);
};

const getCAMeta = (value) => CA_OPTIONS.find(o => o.value === value) || CA_OPTIONS[0];

const safeNum = (v, fallback = 0) => {
  const n = Number(v);
  return isNaN(n) || !isFinite(n) ? fallback : n;
};

// Sanitise a string for safe display (strip HTML tags)
const sanitise = (s) =>
  typeof s === 'string' ? s.replace(/<[^>]*>/g, '').trim() : '';

// ── useToast ─────────────────────────────────────────────────────
function useToast(duration = 4500) {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  const showToast = useCallback((msg, type = 'success') => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ msg: sanitise(String(msg)), type });
    timerRef.current = setTimeout(() => {
      setToast(null);
      timerRef.current = null;
    }, duration);
  }, [duration]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return { toast, showToast };
}

// ── useModal — Escape key + focus trap ───────────────────────────
function useModal(isOpen, onClose) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);
}

// ── useRBAC ──────────────────────────────────────────────────────
function useRBAC() {
  const [teamRole,    setTeamRole]    = useState(null);
  const [org,         setOrg]         = useState(null);
  const [orgMembers,  setOrgMembers]  = useState([]);
  const [verifiers,   setVerifiers]   = useState([]);
  const [rbacLoaded,  setRbacLoaded]  = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    apiFetch('/api/org/me')
      .then(data => {
        if (!mountedRef.current) return;
        if (data?.org) {
          setOrg(data.org);
          setTeamRole(data.teamRole || 'viewer');
          Promise.allSettled([
            apiFetch(`/api/org/${data.org.id}/members`),
            apiFetch(`/api/org/${data.org.id}/verifiers`),
          ]).then(([m, v]) => {
            if (!mountedRef.current) return;
            setOrgMembers(m.status === 'fulfilled' ? m.value?.members || [] : []);
            setVerifiers(v.status === 'fulfilled'  ? v.value?.verifiers || [] : []);
          });
        }
      })
      .catch(() => {})
      .finally(() => { if (mountedRef.current) setRbacLoaded(true); });
  }, []);

  const can = useCallback((perm) => {
    if (!teamRole) return true; // solo user — full access
    return (PERMISSIONS[perm] || []).includes(teamRole);
  }, [teamRole]);

  const planLimit = useMemo(
    () => PLAN_LIMITS[org?.subscription_plan?.toLowerCase()] || PLAN_LIMITS.starter,
    [org]
  );

  return { teamRole, org, orgMembers, verifiers, rbacLoaded, can, planLimit };
}

// ─────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────

function RoleBadge({ role }) {
  const m = ROLE_META[role];
  if (!m) return null;
  return (
    <span style={{ fontSize:9, padding:'3px 9px', borderRadius:3, letterSpacing:'.08em',
      fontWeight:700, background:m.bg, color:m.color, border:`1px solid ${m.border}` }}>
      {m.icon} {m.label}
    </span>
  );
}

function LockedAction({ label, reason }) {
  const [tip, setTip] = useState(false);
  return (
    <div style={{ position:'relative', flex:1 }}>
      <button
        aria-label={`${label} — locked: ${reason}`}
        onMouseEnter={() => setTip(true)}
        onMouseLeave={() => setTip(false)}
        onFocus={() => setTip(true)}
        onBlur={() => setTip(false)}
        style={{ width:'100%', padding:'10px 6px', borderRadius:6, fontSize:11,
          cursor:'not-allowed', border:'1px solid #1a1a1a', background:'#080808',
          color:'#86efac22', fontFamily:'DM Mono,monospace', letterSpacing:'.06em' }}>
        🔒 {label}
      </button>
      {tip && (
        <div role="tooltip" style={{ position:'absolute', bottom:'calc(100% + 6px)',
          left:'50%', transform:'translateX(-50%)', background:'#0a0f0c',
          border:'1px solid #22c55e22', borderRadius:6, padding:'6px 10px',
          fontSize:9, color:'#f59e0b88', whiteSpace:'nowrap', zIndex:100, pointerEvents:'none' }}>
          {reason || 'Requires higher role'}
        </div>
      )}
    </div>
  );
}

function KYCExpiryBanner({ navigate }) {
  const [kycInfo, setKycInfo] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    apiFetch('/api/portfolio/kyc-status')
      .then(d => { if (mountedRef.current) setKycInfo(d); })
      .catch(() => {});
    return () => { mountedRef.current = false; };
  }, []);

  if (!kycInfo?.needsRenewal) return null;
  const isExpired = kycInfo.isExpired;
  const days      = kycInfo.daysUntilExpiry;

  return (
    <div role="alert" style={{ marginBottom:20, padding:'14px 18px',
      background:isExpired?'#1a0707':'#110a00',
      border:`1px solid ${isExpired?'#f8717133':'#f59e0b33'}`,
      borderRadius:10, display:'flex', alignItems:'center',
      justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
      <div>
        <div style={{ fontSize:12, color:isExpired?'#f87171':'#f59e0b', fontWeight:700, marginBottom:3 }}>
          {isExpired ? '⛔ KYC EXPIRED — Trading suspended'
                     : `⚠️ KYC expires in ${days} days`}
        </div>
        <div style={{ fontSize:10, color:isExpired?'#f8717166':'#f59e0b66', letterSpacing:'.06em' }}>
          {isExpired
            ? 'Your KYC has expired. Submit renewal to restore trading access.'
            : `Valid until ${new Date(kycInfo.kycExpiresAt).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}. Renew before it expires.`
          }
        </div>
      </div>
      <button onClick={() => navigate('/kyc')}
        style={{ padding:'8px 18px', borderRadius:6, border:'none',
          background:isExpired?'#dc2626':'#f59e0b', color:'#fff', cursor:'pointer',
          fontFamily:'DM Mono,monospace', fontSize:10, fontWeight:700,
          letterSpacing:'.1em', flexShrink:0 }}>
        {isExpired ? 'RENEW KYC NOW →' : 'RENEW KYC →'}
      </button>
    </div>
  );
}

function PortfolioAnalytics({ allCredits, myRetirements }) {
  const byStandard = useMemo(() => {
    const map = {};
    allCredits.filter(c => c.status !== 'RETIRED').forEach(c => {
      map[c.standard] = (map[c.standard] || 0) + safeNum(c.heldCredits ?? c.credits);
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [allCredits]);

  const byVintage = useMemo(() => {
    const map = {};
    allCredits.filter(c => c.status !== 'RETIRED' && c.vintageYear).forEach(c => {
      const yr = String(c.vintageYear);
      map[yr] = (map[yr] || 0) + safeNum(c.heldCredits ?? c.credits);
    });
    return Object.entries(map).sort((a,b) => a[0]-b[0])
      .map(([year, credits]) => ({ year, credits }));
  }, [allCredits]);

  const byType = useMemo(() => {
    const map = {};
    allCredits.filter(c => c.status !== 'RETIRED').forEach(c => {
      const t = (c.projectType || 'Other').split(' ')[0];
      map[t] = (map[t] || 0) + safeNum(c.heldCredits ?? c.credits);
    });
    return Object.entries(map).sort((a,b) => b[1]-a[1]).slice(0,7)
      .map(([name, credits]) => ({ name, credits }));
  }, [allCredits]);

  const retirementTimeline = useMemo(() => {
    const map = {};
    myRetirements.forEach(r => {
      const d = (r.created_at || r.retired_at || '').slice(0,7);
      if (d) map[d] = (map[d] || 0) + safeNum(r.amount);
    });
    return Object.entries(map).sort((a,b) => a[0].localeCompare(b[0]))
      .map(([month, tco2]) => ({ month, tco2 }));
  }, [myRetirements]);

  const tp = {
    contentStyle : { background:'#070c09', border:'1px solid #0d1f11', borderRadius:6, fontSize:10 },
    labelStyle   : { color:'#86efac88' },
  };

  const empty = (
    <div style={{ height:160, display:'flex', alignItems:'center', justifyContent:'center',
      color:'#86efac22', fontSize:10 }}>No data yet</div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
        {[
          { l:'UNIQUE PROJECTS', v:new Set(allCredits.map(c=>c.projectId)).size,   c:'#60a5fa' },
          { l:'CCP ELIGIBLE',    v:`${allCredits.length
              ? Math.round(allCredits.filter(c=>c.icvcm_ccp_eligible).length/allCredits.length*100)
              : 0}%`,                                                               c:'#84cc16' },
          { l:'STANDARDS',       v:new Set(allCredits.map(c=>c.standard)).size,    c:'#a78bfa' },
        ].map(({ l, v, c }) => (
          <div key={l} style={{ background:'#070c09', border:'1px solid #0d1f11',
            borderRadius:12, padding:'16px 18px' }}>
            <div style={{ fontSize:9, color:'#86efac55', letterSpacing:'.12em', marginBottom:8 }}>{l}</div>
            <div style={{ fontSize:22, fontWeight:800, color:c, fontFamily:'Syne,sans-serif' }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        {[
          {
            title: 'BY REGISTRY STANDARD',
            content: byStandard.length === 0 ? empty : (
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={byStandard} cx="50%" cy="50%" innerRadius={50}
                    outerRadius={75} paddingAngle={3} dataKey="value">
                    {byStandard.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]}/>)}
                  </Pie>
                  <Tooltip {...tp} formatter={(v,n) => [`${v} tCO₂`,n]}/>
                  <Legend iconType="circle" iconSize={8}
                    formatter={v => <span style={{ color:'#86efac88', fontSize:9 }}>{v}</span>}/>
                </PieChart>
              </ResponsiveContainer>
            ),
          },
          {
            title: 'BY VINTAGE YEAR',
            content: byVintage.length === 0 ? empty : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={byVintage} margin={{ top:0,right:4,bottom:0,left:-20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#0d1f11"/>
                  <XAxis dataKey="year" tick={{ fill:'#86efac44',fontSize:9 }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ fill:'#86efac44',fontSize:9 }} axisLine={false} tickLine={false}/>
                  <Tooltip {...tp} formatter={v => [`${v} tCO₂`,'Credits']}/>
                  <Bar dataKey="credits" fill="#22c55e" radius={[3,3,0,0]} maxBarSize={32}/>
                </BarChart>
              </ResponsiveContainer>
            ),
          },
          {
            title: 'BY PROJECT TYPE',
            content: byType.length === 0 ? empty : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={byType} layout="vertical" margin={{ top:0,right:4,bottom:0,left:60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#0d1f11" horizontal={false}/>
                  <XAxis type="number" tick={{ fill:'#86efac44',fontSize:9 }} axisLine={false} tickLine={false}/>
                  <YAxis type="category" dataKey="name" tick={{ fill:'#86efac66',fontSize:9 }}
                    axisLine={false} tickLine={false} width={60}/>
                  <Tooltip {...tp} formatter={v => [`${v} tCO₂`,'Credits']}/>
                  <Bar dataKey="credits" fill="#60a5fa" radius={[0,3,3,0]} maxBarSize={16}/>
                </BarChart>
              </ResponsiveContainer>
            ),
          },
          {
            title: 'RETIREMENT TIMELINE',
            content: retirementTimeline.length < 2 ? (
              <div style={{ height:160, display:'flex', alignItems:'center',
                justifyContent:'center', color:'#86efac22', fontSize:10,
                textAlign:'center', padding:20 }}>Retire credits to see timeline</div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={retirementTimeline} margin={{ top:4,right:4,bottom:0,left:-20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#0d1f11"/>
                  <XAxis dataKey="month" tick={{ fill:'#86efac44',fontSize:9 }} axisLine={false} tickLine={false}/>
                  <YAxis tick={{ fill:'#86efac44',fontSize:9 }} axisLine={false} tickLine={false}/>
                  <Tooltip {...tp} formatter={v => [`${v} tCO₂`,'Retired']}/>
                  <Line type="monotone" dataKey="tco2" stroke="#a78bfa" strokeWidth={2}
                    dot={{ fill:'#a78bfa',r:3 }}/>
                </LineChart>
              </ResponsiveContainer>
            ),
          },
        ].map(({ title, content }) => (
          <div key={title} style={{ background:'#070c09', border:'1px solid #0d1f11',
            borderRadius:12, padding:18 }}>
            <div style={{ fontSize:9, color:'#86efac55', letterSpacing:'.12em', marginBottom:14 }}>{title}</div>
            {content}
          </div>
        ))}
      </div>
    </div>
  );
}

function AuditTrailPanel({ orgId }) {
  const [logs,    setLogs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('ALL');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!orgId) { setLoading(false); return; }
    apiFetch(`/api/org/${orgId}/audit-log?limit=100`)
      .then(d => { if (mountedRef.current) setLogs(d?.logs || []); })
      .catch(() => {})
      .finally(() => { if (mountedRef.current) setLoading(false); });
  }, [orgId]);

  const ACTION_META = {
    CREDIT_SUBMITTED : { color:'#60a5fa', icon:'📤', label:'Credit Submitted'     },
    CREDIT_APPROVED  : { color:'#22c55e', icon:'✅', label:'Credit Approved'      },
    CREDIT_REJECTED  : { color:'#f87171', icon:'❌', label:'Credit Rejected'      },
    CREDIT_LISTED    : { color:'#facc15', icon:'📈', label:'Listed on Market'     },
    CREDIT_DELISTED  : { color:'#f97316', icon:'📉', label:'Delisted from Market' },
    RETIRE_REQUESTED : { color:'#a78bfa', icon:'🔥', label:'Retirement Requested' },
    RETIRE_APPROVED  : { color:'#22c55e', icon:'🔥', label:'Retirement Approved'  },
    RETIRE_REJECTED  : { color:'#f87171', icon:'↩',  label:'Retirement Rejected'  },
    RETIRE_EXECUTED  : { color:'#f87171', icon:'🔥', label:'Retirement Executed'  },
    MEMBER_INVITED   : { color:'#60a5fa', icon:'👤', label:'Member Invited'       },
    MEMBER_REMOVED   : { color:'#f87171', icon:'👤', label:'Member Removed'       },
    ROLE_CHANGED     : { color:'#f97316', icon:'🔄', label:'Role Changed'         },
    REPORT_EXPORTED  : { color:'#84cc16', icon:'📊', label:'Report Exported'      },
  };

  const FILTERS = ['ALL','CREDIT','RETIRE','TEAM','REPORT'];
  const filtered = logs.filter(l => {
    if (filter === 'ALL')    return true;
    if (filter === 'CREDIT') return l.action?.startsWith('CREDIT');
    if (filter === 'RETIRE') return l.action?.startsWith('RETIRE');
    if (filter === 'TEAM')   return l.action?.startsWith('MEMBER') || l.action?.startsWith('ROLE');
    if (filter === 'REPORT') return l.action?.startsWith('REPORT');
    return true;
  });

  return (
    <div>
      {!orgId && (
        <div style={{ padding:'14px 18px', background:'#060e18',
          border:'1px solid #60a5fa22', borderRadius:10, marginBottom:16,
          fontSize:10, color:'#60a5fa88', lineHeight:1.8 }}>
          ℹ️ <strong style={{ color:'#60a5fa' }}>Audit log is an organisation feature.</strong><br/>
          Create or join an organisation to enable real-time audit logging across your team.
        </div>
      )}
      {orgId && (
        <>
          <div style={{ display:'flex', gap:6, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
            {FILTERS.map(f => (
              <button key={f} onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                style={{ padding:'5px 12px', borderRadius:4,
                  border:`1px solid ${filter===f?'#22c55e44':'#0d1f11'}`,
                  background:filter===f?'#0d2e1f':'transparent',
                  color:filter===f?'#22c55e':'#86efac44',
                  cursor:'pointer', fontFamily:'DM Mono,monospace', fontSize:9 }}>
                {f}
              </button>
            ))}
            <span style={{ marginLeft:'auto', fontSize:9, color:'#86efac33' }}>
              {filtered.length} entries
            </span>
          </div>
          {loading ? (
            <div style={{ textAlign:'center', padding:32, color:'#86efac33', fontSize:11 }}>
              Loading audit log…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign:'center', padding:40, color:'#86efac33', fontSize:11 }}>
              <div style={{ fontSize:32, marginBottom:12 }}>📋</div>
              No audit entries for this filter.
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {filtered.map((log, i) => {
                const m  = ACTION_META[log.action] || { color:'#86efac44', icon:'•', label:log.action };
                const rm = ROLE_META[log.actor_role] || ROLE_META.viewer;
                const ts = new Date(log.created_at);
                const diff = Date.now() - ts.getTime();
                const timeAgo = diff < 3600000 ? `${Math.round(diff/60000)}m ago`
                              : diff < 86400000 ? `${Math.round(diff/3600000)}h ago`
                              : ts.toLocaleDateString('en-IN',{day:'2-digit',month:'short'});
                return (
                  <div key={log.id || i} style={{ display:'flex', alignItems:'flex-start',
                    gap:12, padding:'12px 14px', background:'#070c09',
                    border:`1px solid ${m.color}22`, borderRadius:10 }}>
                    <div style={{ width:28, height:28, borderRadius:6, background:`${m.color}11`,
                      border:`1px solid ${m.color}33`, display:'flex', alignItems:'center',
                      justifyContent:'center', fontSize:13, flexShrink:0 }}>
                      {m.icon}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3, flexWrap:'wrap' }}>
                        <span style={{ fontSize:11, color:m.color, fontWeight:700 }}>{m.label}</span>
                        <span style={{ fontSize:9, padding:'2px 7px', borderRadius:3,
                          background:rm.bg, color:rm.color, border:`1px solid ${rm.border}` }}>
                          {rm.icon} {sanitise(log.actor_name || 'Unknown')}
                        </span>
                      </div>
                      <div style={{ fontSize:10, color:'#86efac55', lineHeight:1.5 }}>
                        {sanitise(log.meta || '')}
                      </div>
                    </div>
                    <div style={{ fontSize:9, color:'#86efac33', flexShrink:0 }}>{timeAgo}</div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RetireModal({ credit, onConfirm, onClose, loading }) {
  const [qty, setQty] = useState(credit.heldCredits ?? credit.credits);
  const [scope,             setScope]             = useState('1');
  const [beneficiaryName,   setBeneficiaryName]   = useState('');
  const [beneficiaryEntity, setBeneficiaryEntity] = useState('');
  const [beneficiaryGstin,  setBeneficiaryGstin]  = useState('');
  const [reportingStd,      setReportingStd]      = useState('GHG_PROTOCOL');
  const [purpose,           setPurpose]           = useState('voluntary_offset');

  useModal(true, () => !loading && onClose());

  const REPORTING_STDS = [
    { value:'GHG_PROTOCOL', label:'GHG Protocol' },
    { value:'CDP',          label:'CDP'           },
    { value:'BRSR',         label:'SEBI BRSR'     },
    { value:'TCFD',         label:'TCFD'          },
    { value:'ISO_14064',    label:'ISO 14064-3'   },
  ];
  const PURPOSES = [
    { value:'voluntary_offset', label:'Voluntary offset'            },
    { value:'compliance',       label:'Regulatory compliance'       },
    { value:'net_zero',         label:'Net zero commitment'         },
    { value:'supply_chain',     label:'Supply chain decarbonisation'},
  ];

  return (
    <div role="dialog" aria-modal="true" aria-label="Retire Credit"
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.88)',
        backdropFilter:'blur(6px)', zIndex:3000, display:'flex',
        alignItems:'center', justifyContent:'center', padding:24 }}
      onClick={e => e.target === e.currentTarget && !loading && onClose()}>
      <div style={{ background:'#070c09', border:'1px solid #0d1f11', borderRadius:16,
        width:'100%', maxWidth:520, maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ padding:'20px 24px', borderBottom:'1px solid #0d1f11',
          display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontSize:13, fontWeight:700, color:'#f0fdf4', letterSpacing:'.1em' }}>
            RETIRE CREDIT — DIRECT (OWNER/ADMIN)
          </span>
          <button aria-label="Close dialog" onClick={() => !loading && onClose()}
            style={{ background:'none', border:'none', color:'#86efac44', cursor:'pointer', fontSize:18 }}>
            ✕
          </button>
        </div>
        <div style={{ padding:24 }}>
          <div style={{ background:'#060a07', borderRadius:8, padding:'12px 14px',
            marginBottom:16, border:'1px solid #0d1f11' }}>
            <div style={{ fontSize:12, color:'#f0fdf4', fontWeight:700, marginBottom:4 }}>
              {sanitise(credit.projectName)}
            </div>
            <div style={{ fontSize:10, color:'#86efac44' }}>
              {credit.standard} · {Number(credit.credits).toLocaleString()} tCO₂ · Vintage {credit.vintageYear}
            </div>
          </div>

          <div style={{ marginBottom:16 }}>
            <label htmlFor="retire-qty" style={{ fontSize:9, color:'#86efac88',
              letterSpacing:'.12em', display:'block', marginBottom:6 }}>
              QUANTITY (tCO₂)
            </label>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <input id="retire-qty-slider" type="range" min={1} max={credit.credits}
                step={1} value={qty} onChange={e => setQty(Number(e.target.value))}
                style={{ flex:1, accentColor:'#f87171', cursor:'pointer' }}/>
              <input id="retire-qty" type="number" min={1} max={credit.credits}
                value={qty}
                onChange={e => setQty(Math.min(credit.credits, Math.max(1, Number(e.target.value))))}
                style={{ width:80, padding:'8px 10px', borderRadius:6, border:'1px solid #0d1f11',
                  background:'#040706', color:'#f0fdf4', fontFamily:'DM Mono,monospace',
                  fontSize:11, outline:'none' }}/>
            </div>
          </div>

          <div style={{ marginBottom:16 }}>
            <p style={{ fontSize:9, color:'#86efac88', letterSpacing:'.12em', marginBottom:6 }}>
              OFFSET SCOPE
            </p>
            <div role="group" aria-label="Offset scope"
              style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
              {[{val:'1',label:'Scope 1',color:'#f97316'},{val:'2',label:'Scope 2',color:'#3b82f6'},{val:'3',label:'Scope 3',color:'#a855f7'}]
                .map(({val,label,color}) => (
                  <button key={val} type="button" aria-pressed={scope===val}
                    onClick={() => setScope(val)}
                    style={{ padding:'10px', borderRadius:8,
                      border:`1px solid ${scope===val?color+'66':'#0d1f11'}`,
                      background:scope===val?`${color}11`:'#060a07', cursor:'pointer' }}>
                    <span style={{ fontSize:11, color:scope===val?color:'#86efac44', fontWeight:700 }}>
                      {label}
                    </span>
                  </button>
                ))}
            </div>
          </div>

          <div style={{ background:'#0a1628', border:'1px solid #60a5fa22', borderRadius:8,
            padding:14, marginBottom:16 }}>
            <div style={{ fontSize:9, color:'#60a5fa88', letterSpacing:'.14em', marginBottom:10 }}>
              CORPORATE BENEFICIARY
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
              <div>
                <label htmlFor="bene-name" style={{ fontSize:9, color:'#86efac88',
                  letterSpacing:'.12em', display:'block', marginBottom:5 }}>NAME</label>
                <input id="bene-name" value={beneficiaryName}
                  onChange={e => setBeneficiaryName(e.target.value.slice(0,255))}
                  placeholder="Rahul Sharma"
                  style={{ width:'100%', padding:'9px 10px', borderRadius:6, border:'1px solid #0d1f11',
                    background:'#040706', color:'#f0fdf4', fontFamily:'DM Mono,monospace',
                    fontSize:11, outline:'none' }}/>
              </div>
              <div>
                <label htmlFor="bene-entity" style={{ fontSize:9, color:'#86efac88',
                  letterSpacing:'.12em', display:'block', marginBottom:5 }}>COMPANY</label>
                <input id="bene-entity" value={beneficiaryEntity}
                  onChange={e => setBeneficiaryEntity(e.target.value.slice(0,255))}
                  placeholder="Acme Corp Pvt Ltd"
                  style={{ width:'100%', padding:'9px 10px', borderRadius:6, border:'1px solid #0d1f11',
                    background:'#040706', color:'#f0fdf4', fontFamily:'DM Mono,monospace',
                    fontSize:11, outline:'none' }}/>
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <div>
                <label htmlFor="bene-gstin" style={{ fontSize:9, color:'#86efac88',
                  letterSpacing:'.12em', display:'block', marginBottom:5 }}>GSTIN</label>
                <input id="bene-gstin" value={beneficiaryGstin}
                  onChange={e => setBeneficiaryGstin(e.target.value.toUpperCase().slice(0,15))}
                  maxLength={15} pattern="[0-9A-Z]{15}"
                  style={{ width:'100%', padding:'9px 10px', borderRadius:6, border:'1px solid #0d1f11',
                    background:'#040706', color:'#f0fdf4', fontFamily:'DM Mono,monospace',
                    fontSize:11, outline:'none' }}/>
              </div>
              <div>
                <label htmlFor="retire-purpose" style={{ fontSize:9, color:'#86efac88',
                  letterSpacing:'.12em', display:'block', marginBottom:5 }}>PURPOSE</label>
                <select id="retire-purpose" value={purpose} onChange={e => setPurpose(e.target.value)}
                  style={{ width:'100%', padding:'9px 10px', borderRadius:6, border:'1px solid #0d1f11',
                    background:'#040706', color:'#f0fdf4', fontFamily:'DM Mono,monospace',
                    fontSize:11, outline:'none' }}>
                  {PURPOSES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div style={{ marginBottom:16 }}>
            <p style={{ fontSize:9, color:'#86efac88', letterSpacing:'.12em', marginBottom:6 }}>
              REPORTING FRAMEWORK
            </p>
            <div role="group" aria-label="Reporting framework"
              style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {REPORTING_STDS.map(s => (
                <button key={s.value} type="button" aria-pressed={reportingStd===s.value}
                  onClick={() => setReportingStd(s.value)}
                  style={{ padding:'6px 12px', borderRadius:6,
                    border:`1px solid ${reportingStd===s.value?'#22c55e44':'#0d1f11'}`,
                    background:reportingStd===s.value?'#0d2e1f':'#060a07', cursor:'pointer',
                    fontSize:9, color:reportingStd===s.value?'#22c55e':'#86efac44',
                    fontFamily:'DM Mono,monospace' }}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div role="alert" style={{ padding:'10px 12px', background:'#0e0505', borderRadius:6,
            border:'1px solid #f8717122', fontSize:10, color:'#f8717188' }}>
            ⚠️ <strong style={{ color:'#f87171aa' }}>Irreversible.</strong> Token permanently burned on-chain.
          </div>
        </div>

        <div style={{ padding:'16px 24px', borderTop:'1px solid #0d1f11',
          display:'flex', gap:10, background:'#050809' }}>
          <button onClick={onClose} disabled={loading}
            style={{ flex:1, padding:'12px', borderRadius:8, border:'1px solid #0d1f11',
              background:'#060a07', color:'#86efac66', cursor:loading?'not-allowed':'pointer',
              fontFamily:'DM Mono,monospace', fontSize:12 }}>CANCEL</button>
          <button
            onClick={() => onConfirm(credit, qty, scope, {
              beneficiaryName, beneficiaryEntity, beneficiaryGstin,
              reportingStandard: reportingStd, purpose,
            })}
            disabled={loading || qty < 1 || qty > credit.credits}
            style={{ flex:2, padding:'12px', borderRadius:8, border:'1px solid #f8717133',
              background:'#0e0505', color:'#f87171', cursor:loading?'not-allowed':'pointer',
              fontFamily:'DM Mono,monospace', fontSize:12, fontWeight:700 }}>
            {loading ? '⟳ BURNING ON-CHAIN…'
                     : `RETIRE ${Number(qty).toLocaleString()} tCO₂ (S${scope}) →`}
          </button>
        </div>
      </div>
    </div>
  );
}

function QRCodeImg({ value, size = 120 }) {
  const [failed, setFailed] = useState(false);
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}&bgcolor=0a0f0c&color=22c55e&margin=2`;
  if (failed) return (
    <div style={{ width:size, height:size, display:'flex', alignItems:'center',
      justifyContent:'center', fontSize:9, color:'#86efac22' }}>QR unavailable</div>
  );
  return (
    <div style={{ textAlign:'center' }}>
      <img src={url} alt={`QR code to verify: ${value}`} width={size} height={size}
        style={{ borderRadius:8, border:'1px solid #22c55e22', background:'#0a0f0c' }}
        onError={() => setFailed(true)}/>
      <div style={{ fontSize:9, color:'#86efac66', marginTop:4, letterSpacing:'.08em' }}>
        SCAN TO VERIFY
      </div>
    </div>
  );
}

function RetirementCertificate({ credit, txHash, onClose }) {
  const [pdfLoading, setPdfLoading] = useState(false);
  const date         = new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'});
  const tokenDisplay = credit.tokenHex || (credit.tokenId != null
    ? `0x${Number(credit.tokenId).toString(16).padStart(8,'0').toUpperCase()}` : '—');
  const certId    = credit.certId || credit.certificate_id;
  const verifyUrl = certId ? `${VERIFY_BASE_URL}/${certId}` : null;
  const reg       = REGISTRIES[credit.standard] || REGISTRIES.VCS;
  const caLabel   = CA_OPTIONS.find(o => o.value === credit.correspondingAdjustment)?.label || 'None';
  const sdgList   = (credit.sdgTags || credit.sdg_tags || []).join(', ') || '—';

  const handleDownloadPDF = async () => {
    setPdfLoading(true);
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
      const W = 210, ml = 20, tw = W - 40;
      let y = 20;

      doc.setFillColor(4,7,6); doc.rect(0,0,W,297,'F');
      doc.setFillColor(13,46,31); doc.rect(0,0,W,40,'F');
      doc.setTextColor(34,197,94); doc.setFontSize(8); doc.setFont('helvetica','normal');
      doc.text('ETHERTRACK CARBON EXCHANGE — RETIREMENT CERTIFICATE', W/2, y, { align:'center' });
      y += 7;
      doc.setFontSize(16); doc.setFont('helvetica','bold'); doc.setTextColor(240,253,244);
      doc.text('Carbon Retirement Certificate', W/2, y, { align:'center' });
      y += 6;
      doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(134,239,172);
      doc.text('ISO 14064-3 · GHG PROTOCOL · BRSR · CDP · TCFD · ETHEREUM SEPOLIA', W/2, y, { align:'center' });
      y += 12;

      const fields = [
        ['CERTIFICATE ID',   certId || 'PENDING'                                  ],
        ['TOKEN ID',         tokenDisplay                                          ],
        ['PROJECT NAME',     sanitise(credit.projectName || '—')                  ],
        ['SERIAL NO.',       sanitise(credit.serialNumber || '—')                 ],
        ['REGISTRY',         reg.label                                            ],
        ['STANDARD',         credit.standard || '—'                              ],
        ['CREDITS RETIRED',  `${Number(credit.retiredQty||credit.credits).toLocaleString()} tCO₂e`],
        ['VINTAGE YEAR',     String(credit.vintageYear || '—')                   ],
        ['OFFSET SCOPE',     credit.retireScope ? `Scope ${credit.retireScope}` : 'Scope 1/2/3'],
        ['ARTICLE 6 / CA',   caLabel                                              ],
        ['SDG CO-BENEFITS',  sdgList                                              ],
        ['BENEFICIARY',      sanitise(credit.beneficiaryName || '—')             ],
        ['COMPANY',          sanitise(credit.beneficiaryEntity || '—')           ],
        ['GSTIN',            sanitise(credit.beneficiaryGstin || '—')            ],
        ['REPORTING STD',    credit.reportingStandard || 'GHG Protocol'          ],
        ['PURPOSE',          credit.purpose || 'Voluntary Offset'                ],
        ['CBAM ELIGIBLE',    credit.cbamEligible ? 'YES — EU CBAM Article 7' : 'NO'],
        ['RETIREMENT DATE',  date                                                 ],
      ];

      const colW = (tw - 6) / 2;
      fields.forEach(([label, value], i) => {
        const col = i % 2;
        const x   = ml + col * (colW + 6);
        if (col === 0 && i > 0) y += 16;
        doc.setFillColor(10,15,12); doc.roundedRect(x,y,colW,14,1.5,1.5,'F');
        doc.setDrawColor(15,42,26); doc.roundedRect(x,y,colW,14,1.5,1.5,'S');
        doc.setFontSize(6.5); doc.setFont('helvetica','normal'); doc.setTextColor(134,239,172);
        doc.text(label, x+3, y+4.5);
        doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(240,253,244);
        doc.text(doc.splitTextToSize(String(value || '—'), colW - 6)[0], x+3, y+10);
      });
      y += 20;

      if (txHash) {
        doc.setFillColor(10,22,40); doc.roundedRect(ml,y,tw,14,2,2,'F');
        doc.setFontSize(6.5); doc.setTextColor(134,239,172);
        doc.text('BLOCKCHAIN TX HASH', ml+3, y+4.5);
        doc.setFontSize(7); doc.setTextColor(96,165,250);
        doc.text(doc.splitTextToSize(txHash, tw-6)[0], ml+3, y+10);
        y += 18;
      }

      if (verifyUrl) {
        doc.setFillColor(6,10,7); doc.roundedRect(ml,y,tw,14,2,2,'F');
        doc.setFontSize(6.5); doc.setTextColor(134,239,172);
        doc.text('PUBLIC VERIFICATION URL', ml+3, y+4.5);
        doc.setFontSize(7.5); doc.setTextColor(34,197,94);
        doc.text(verifyUrl, ml+3, y+10);
        y += 18;
      }

      doc.setFontSize(7); doc.setTextColor(134,239,172);
      doc.text(
        "ETHERTRACK · INDIA'S CARBON EXCHANGE · ISO 14064-3 · PARIS AGREEMENT ART.6",
        W/2, y, { align:'center' }
      );

      doc.save(`${certId || 'certificate'}.pdf`);
    } catch (err) {
      console.error('[PDF generation]', err);
      const content = `EtherTrack Retirement Certificate\nCert: ${certId}\nCredits: ${credit.retiredQty||credit.credits} tCO2e\nVerify: ${verifyUrl||'N/A'}`;
      const blob = new Blob([content], { type:'text/plain' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `${certId||'cert'}.txt`; a.click();
      URL.revokeObjectURL(url);
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div style={{ background:'linear-gradient(135deg,#060a07,#0a1209,#060a07)',
      border:'1px solid #22c55e44', borderRadius:16, padding:28 }}>
      <div style={{ textAlign:'center', marginBottom:20 }}>
        <div style={{ fontSize:9, color:'#22c55e88', letterSpacing:'.2em', marginBottom:6 }}>
          ETHERTRACK CARBON EXCHANGE
        </div>
        <div style={{ fontSize:20, fontWeight:700, color:'#f0fdf4', fontFamily:'Syne,sans-serif' }}>
          Carbon Retirement Certificate
        </div>
        <div style={{ fontSize:9, color:'#86efac44', marginTop:4 }}>
          ISO 14064-3 · GHG PROTOCOL · BRSR · CDP · TCFD
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:16 }}>
        {[
          { l:'CERTIFICATE ID',  v:certId||'PENDING',                                            c:'#22c55e' },
          { l:'TOKEN ID',        v:tokenDisplay,                                                 c:'#60a5fa' },
          { l:'PROJECT',         v:sanitise(credit.projectName||'—'),                            c:'#f0fdf4' },
          { l:'CREDITS RETIRED', v:`${Number(credit.retiredQty||credit.credits).toLocaleString()} tCO₂e`, c:'#22c55e' },
          { l:'OFFSET SCOPE',    v:credit.retireScope?`Scope ${credit.retireScope}`:'—',         c:'#a78bfa' },
          { l:'ARTICLE 6',       v:caLabel,                                                      c:'#22c55e' },
          { l:'REGISTRY',        v:reg.label,                                                    c:reg.color },
          { l:'DATE',            v:date,                                                         c:'#f0fdf4' },
          { l:'BENEFICIARY',     v:sanitise(credit.beneficiaryName||'—'),                        c:'#f0fdf4' },
          { l:'ENTITY',          v:sanitise(credit.beneficiaryEntity||'—'),                      c:'#f0fdf4' },
        ].map(({l,v,c}) => (
          <div key={l} style={{ background:'#0a0f0c88', borderRadius:7, padding:'9px 12px',
            border:'1px solid #0f2a1a' }}>
            <div style={{ fontSize:8, color:'#86efac44', letterSpacing:'.1em', marginBottom:3 }}>{l}</div>
            <div style={{ fontSize:11, color:c, fontWeight:600, wordBreak:'break-all' }}>{v}</div>
          </div>
        ))}
      </div>

      {txHash && (
        <div style={{ background:'#0a0f0c88', borderRadius:7, padding:'9px 12px',
          border:'1px solid #0f2a1a', marginBottom:12 }}>
          <div style={{ fontSize:8, color:'#86efac44', letterSpacing:'.1em', marginBottom:3 }}>
            BLOCKCHAIN TX HASH
          </div>
          <a href={`https://sepolia.etherscan.io/tx/${txHash}`}
            target="_blank" rel="noreferrer noopener"
            style={{ fontSize:10, color:'#60a5fa', fontFamily:'monospace',
              wordBreak:'break-all', textDecoration:'none' }}>
            {txHash}
          </a>
        </div>
      )}

      {verifyUrl && (
        <div style={{ background:'#060a07', border:'1px solid #22c55e22', borderRadius:8,
          padding:14, marginBottom:14, display:'flex', alignItems:'center',
          gap:16, flexWrap:'wrap' }}>
          <QRCodeImg value={verifyUrl} size={90}/>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:9, color:'#22c55e88', letterSpacing:'.1em', marginBottom:5 }}>
              VERIFICATION URL
            </div>
            <div style={{ fontSize:10, color:'#22c55e66', wordBreak:'break-all', fontFamily:'monospace' }}>
              {verifyUrl}
            </div>
          </div>
        </div>
      )}

      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        {verifyUrl && (
          <a href={verifyUrl} target="_blank" rel="noreferrer noopener"
            style={{ flex:1, padding:'9px', borderRadius:6, border:'1px solid #60a5fa33',
              background:'#060e18', color:'#60a5fa88', fontFamily:'DM Mono,monospace',
              fontSize:10, textDecoration:'none', textAlign:'center' }}>
            🔗 VERIFY
          </a>
        )}
        <button onClick={handleDownloadPDF} disabled={pdfLoading}
          style={{ flex:1, padding:'9px', borderRadius:6, border:'1px solid #22c55e44',
            background:'#051409', color:pdfLoading?'#86efac33':'#22c55e88',
            cursor:pdfLoading?'not-allowed':'pointer',
            fontFamily:'DM Mono,monospace', fontSize:10 }}>
          {pdfLoading ? '⟳ GENERATING PDF…' : '↓ DOWNLOAD PDF'}
        </button>
        <button onClick={onClose}
          style={{ flex:1, padding:'9px', borderRadius:6, border:'1px solid #22c55e44',
            background:'#0d2e1f', color:'#22c55e', cursor:'pointer',
            fontFamily:'DM Mono,monospace', fontSize:10 }}>
          CLOSE ✕
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────
export default function PortfolioV3() {
  const navigate = useNavigate();
  const { user, dbUser } = useContext(AuthContext);
  const {
    myCredits, myBoughtCredits, myRetirements, stats, loading,
    walletAddress, isKYCVerified,
    listCredit, delistCredit, retireCredit,
    loadMyCredits, refreshKYC, refreshRetirements, refreshBoughtCredits,
    // [FIX-SHARED-PRICING] same market snapshot PortfolioContext's `stats`
    // uses to compute totalValue — pricing/badges here are guaranteed to
    // reconcile with the Dashboard because both read this exact object.
    marketBuckets,
  } = usePortfolio();

  const { teamRole, org, orgMembers, verifiers, rbacLoaded, can, planLimit } = useRBAC();

  const [section,       setSection]       = useState('OVERVIEW');
  const [activeTab,     setActiveTab]     = useState('ALL');
  const [showForm,      setShowForm]      = useState(false);
  const [showRetire,    setShowRetire]    = useState(null);
  const [showList,      setShowList]      = useState(null);
  const [showCert,      setShowCert]      = useState(null);
  const [listPrice,     setListPrice]     = useState('');
  const [listQty,       setListQty]       = useState('');
  const [listPriceWarn, setListPriceWarn] = useState('');
  const [form,          setForm]          = useState(emptyForm);
  const [formErrors,    setFormErrors]    = useState({});
  const [txPending,     setTxPending]     = useState('');
  const [submitting,    setSubmitting]    = useState(false);
  const [pincodeLoading,setPincodeLoading]= useState(false);
  const [pincodeError,  setPincodeError]  = useState('');
  const [pendingCredits,setPendingCredits]= useState([]);
  const [emissionsData, setEmissionsData] = useState(null);
  const [retireSteps,   setRetireSteps]   = useState(null);
  const [ethPriceInr,   setEthPriceInr]   = useState(null);
  const [watchlist,     setWatchlist]     = useState([]);
  const [watchlistError,setWatchlistError]= useState(false);
  const [showDelist,    setShowDelist]    = useState(null);
  const [delistQty,     setDelistQty]     = useState('');
  const mountedRef     = useRef(true);
  const kycIntervalRef = useRef(null);
  const [hoveredStat, setHoveredStat] = useState(null);
  const [expandedCard, setExpandedCard] = useState(null);
  const [hoveredCard, setHoveredCard] = useState(null);
  const { toast, showToast } = useToast(4500);
  const [selectedCard, setSelectedCard] = useState(null);

  const [searchQuery,    setSearchQuery]    = useState('');
  const [filterStandard, setFilterStandard] = useState([]);
  const [filterType,     setFilterType]     = useState('');
  const [filterVintage,  setFilterVintage]  = useState([1990, new Date().getFullYear()]);
  const [filterCreditType, setFilterCreditType] = useState('');
  const [sortBy,         setSortBy]         = useState('default');
  const [sortDir,        setSortDir]        = useState('desc');
  const [showFilters,    setShowFilters]    = useState(false);

  const [bulkMode,      setBulkMode]      = useState(false);
  const [selectedCards, setSelectedCards] = useState(new Set());
  const [bulkAction,    setBulkAction]    = useState(null);
  const [bulkPrice,     setBulkPrice]     = useState('');
  const [bulkProgress,  setBulkProgress]  = useState(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (kycIntervalRef.current) clearInterval(kycIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (!walletAddress || !refreshKYC) return;
    refreshKYC();
    if (!isKYCVerified) {
      kycIntervalRef.current = setInterval(refreshKYC, 15000);
    }
    return () => { if (kycIntervalRef.current) clearInterval(kycIntervalRef.current); };
  }, [walletAddress, refreshKYC, isKYCVerified]);

  useEffect(() => {
    if (isKYCVerified && kycIntervalRef.current) {
      clearInterval(kycIntervalRef.current);
      kycIntervalRef.current = null;
    }
  }, [isKYCVerified]);

useEffect(() => {
  loadPendingCredits();
  loadEmissionsData();
  fetchEthPrice();
  refreshBoughtCredits && refreshBoughtCredits();
  const ethInterval = setInterval(fetchEthPrice, 5 * 60 * 1000);
  return () => clearInterval(ethInterval);
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [refreshBoughtCredits]);

useEffect(() => {
  if (!user) return;
  loadWatchlist();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [user]);

  const fetchEthPrice = async () => {
    try {
      const r = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=inr',
        { signal: AbortSignal.timeout(5000) }
      );
      const d = await r.json();
      if (d?.ethereum?.inr && mountedRef.current) setEthPriceInr(d.ethereum.inr);
    } catch {}
  };

  const loadPendingCredits = async () => {
    try {
      const d = await apiFetch('/api/portfolio/my-submissions');
      if (mountedRef.current) setPendingCredits(d.submissions || []);
    } catch {}
  };

  const loadEmissionsData = async () => {
    try {
      const year = new Date().getFullYear();
      const d    = await apiFetch(`/api/portfolio/emissions-summary?year=${year}`);
      if (d && mountedRef.current) setEmissionsData({ ...d, year });
    } catch {}
  };

  const loadWatchlist = async () => {
    try {
      const d = await apiFetch('/api/portfolio/watchlist');
      if (mountedRef.current) {
        setWatchlist(d?.items || []);
        setWatchlistError(false);
      }
    } catch {
      if (mountedRef.current) {
        setWatchlist([]);
        setWatchlistError(true);
      }
    }
  };

  const ownedCredits = useMemo(() => {
    const approved = myCredits;
    const pendingMapped = pendingCredits
      .filter(p => !myCredits.find(c => c.serialNumber === p.registry_serial))
      .map(p => ({
        id           : p.id,
        projectName  : p.project_name,
        location     : p.project_location || '—',
        country      : p.country || '—',
        standard     : p.standard || 'VCS',
        projectType  : p.project_type || '—',
        developer    : p.developer || '—',
        credits      : p.quantity,
        heldCredits  : p.quantity,
        listedCredits: 0,
        vintageYear  : p.vintage_year,
        serialNumber : p.registry_serial,
        projectId    : p.project_id || '—',
        status       : 'PENDING',
        admin_status : p.admin_status,
        admin_notes  : p.admin_notes,
        doc_ipfs_hash: p.doc_ipfs_hash,
        creditType   : p.credit_type || 'voluntary',
        cbamEligible : p.cbam_eligible || false,
        sdg_tags     : p.sdg_tags || [],
        correspondingAdjustment : p.corresponding_adjustment || 'none',
        icvcm_ccp_eligible : p.icvcm_ccp_eligible || false,
        methodologyId: p.methodology_id || '',
        registryLink : p.registry_link || '',
        expiryDate   : p.expiry_date || '',
        coBenefitsVerified : p.co_benefits_verified || false,
        isPending    : true,
        isRejected   : p.admin_status === 'rejected',
      }));
    return [...approved, ...pendingMapped];
  }, [myCredits, pendingCredits]);

  const normalisedBought = useMemo(() =>
    (myBoughtCredits || []).map(b => ({
      ...b,
      status       : 'HELD',
      isBought     : true,
      heldCredits  : safeNum(b.quantity || b.credits),
      credits      : safeNum(b.quantity || b.credits),
      listedCredits: 0,
      isOnChain    : true,
      admin_status : 'approved',
      tokenId      : b.tokenId ?? b.token_id ?? null,
      pricePerCredit: safeNum(b.pricePerCredit ?? b.price_per_credit ?? b.totalPaid / (b.quantity || b.credits || 1)),
      projectType   : b.projectType   ?? b.project_type   ?? '',
      standard      : b.standard      ?? b.standard_type  ?? 'VCS',
      vintageYear   : b.vintageYear   ?? b.vintage_year   ?? null,
    })),
  [myBoughtCredits]);

  const allCredits = useMemo(
    () => [...ownedCredits, ...normalisedBought],
    [ownedCredits, normalisedBought]
  );

  const tabCounts = useMemo(() => ({
    ALL     : allCredits.length,
    HELD    : ownedCredits.filter(c => c.status==='HELD'||c.status==='PARTIAL').reduce((s,c)=>s+safeNum(c.heldCredits??c.credits),0) + normalisedBought.reduce((s,c)=>s+safeNum(c.heldCredits??c.credits),0),
    LISTED  : ownedCredits.filter(c => c.status==='LISTED'||c.status==='PARTIAL').reduce((s,c)=>s+safeNum(c.listedCredits),0),
    BOUGHT  : normalisedBought.length,
    RETIRED : myRetirements.length,
    PENDING : ownedCredits.filter(c => c.isPending && !c.isRejected).length,
    REJECTED: ownedCredits.filter(c => c.isRejected).length,
  }), [allCredits, ownedCredits, normalisedBought, myRetirements]);

  // [FIX-SHARED-PRICING] getReferencePrice calls include (creditType,
  // marketBuckets) so this reconciles with PortfolioContext's
  // `stats.totalValue` shown on the Dashboard.
  const statTotals = useMemo(() => {
  const active = allCredits.filter(c => !c.isPending && !c.isRejected && c.status !== 'RETIRED');

  const totalTco2 = active.reduce((s, c) => s + safeNum(c.heldCredits ?? c.credits), 0);

  const listedTco2 = active
    .filter(c => c.status === 'LISTED' || c.status === 'PARTIAL')
    .reduce((s, c) => s + safeNum(c.listedCredits), 0);

  const portfolioValue = active.reduce((s, c) =>
    s + safeNum(c.heldCredits ?? c.credits) *
      getReferencePrice(c.projectType, c.standard, c.vintageYear, c.creditType, marketBuckets),
  0);

  const retiredTco2 = myRetirements.reduce((s, r) => s + safeNum(r.amount), 0);

  const totalInvested = normalisedBought.reduce((s, c) =>
    s + safeNum(c.pricePerCredit) * safeNum(c.heldCredits ?? c.credits), 0);

  const totalCurrentValue = normalisedBought.reduce((s, c) =>
    s + getReferencePrice(c.projectType, c.standard, c.vintageYear, c.creditType, marketBuckets)
      * safeNum(c.heldCredits ?? c.credits), 0);

  const pnl    = totalCurrentValue - totalInvested;
  const pnlPct = totalInvested > 0 ? ((pnl / totalInvested) * 100).toFixed(1) : 0;

  return { totalTco2, listedTco2, portfolioValue, retiredTco2, pnl, pnlPct };
}, [allCredits, myRetirements, normalisedBought, marketBuckets]);

  const filtered = useMemo(() => {
  let result = allCredits.filter(c => {
    if (activeTab === 'ALL')      { /* pass */ }
    else if (activeTab === 'HELD')     { if (!(c.status==='HELD'||c.status==='PARTIAL'||c.isBought)) return false; }
    else if (activeTab === 'LISTED')   { if (!(c.status==='LISTED'||c.status==='PARTIAL')) return false; }
    else if (activeTab === 'BOUGHT')   { if (!c.isBought) return false; }
    else if (activeTab === 'RETIRED')  { return false; }
    else if (activeTab === 'PENDING')  { if (!(c.isPending&&!c.isRejected)) return false; }
    else if (activeTab === 'REJECTED') { if (!c.isRejected) return false; }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        (c.projectName  ||'').toLowerCase().includes(q) ||
        (c.serialNumber ||'').toLowerCase().includes(q) ||
        (c.developer    ||'').toLowerCase().includes(q) ||
        (c.projectId    ||'').toLowerCase().includes(q) ||
        (c.location     ||'').toLowerCase().includes(q);
      if (!match) return false;
    }

    if (filterStandard.length > 0 && !filterStandard.includes(c.standard)) return false;
    if (filterType && c.projectType !== filterType) return false;

    if (c.vintageYear) {
      const yr = safeNum(c.vintageYear);
      if (yr < filterVintage[0] || yr > filterVintage[1]) return false;
    }

    if (filterCreditType && (c.creditType||'voluntary') !== filterCreditType) return false;

    return true;
  });

  // [FIX-SHARED-PRICING] getReferencePrice calls updated with creditType +
  // marketBuckets so sort-by-value/price uses live market pricing.
  result = [...result].sort((a, b) => {
    let valA, valB;
    switch (sortBy) {
      case 'value':
        valA = getReferencePrice(a.projectType, a.standard, a.vintageYear, a.creditType, marketBuckets) * safeNum(a.heldCredits??a.credits);
        valB = getReferencePrice(b.projectType, b.standard, b.vintageYear, b.creditType, marketBuckets) * safeNum(b.heldCredits??b.credits);
        break;
      case 'credits':
        valA = safeNum(a.heldCredits??a.credits);
        valB = safeNum(b.heldCredits??b.credits);
        break;
      case 'vintage':
        valA = safeNum(a.vintageYear);
        valB = safeNum(b.vintageYear);
        break;
      case 'expiry':
        valA = a.expiryDate ? new Date(a.expiryDate).getTime() : 0;
        valB = b.expiryDate ? new Date(b.expiryDate).getTime() : 0;
        break;
      case 'price':
        valA = getReferencePrice(a.projectType, a.standard, a.vintageYear, a.creditType, marketBuckets);
        valB = getReferencePrice(b.projectType, b.standard, b.vintageYear, b.creditType, marketBuckets);
        break;
      default:
        return 0;
    }
    return sortDir === 'asc' ? valA - valB : valB - valA;
  });

  return result;
}, [allCredits, activeTab, searchQuery, filterStandard, filterType,
    filterVintage, filterCreditType, sortBy, sortDir, marketBuckets]);

  const creditLimitReached = useMemo(() => {
    const owned = ownedCredits.filter(c => !c.isRejected).length;
    return owned >= planLimit.credits;
  }, [ownedCredits, planLimit]);

  const activeFilterCount = useMemo(() => {
  let count = 0;
  if (filterStandard.length > 0) count++;
  if (filterType)                count++;
  if (filterCreditType)          count++;
  if (filterVintage[0] !== 1990 || filterVintage[1] !== new Date().getFullYear()) count++;
  return count;
}, [filterStandard, filterType, filterCreditType, filterVintage]);

const clearAllFilters = () => {
  setSearchQuery('');
  setFilterStandard([]);
  setFilterType('');
  setFilterVintage([1990, new Date().getFullYear()]);
  setFilterCreditType('');
  setSortBy('default');
  setSortDir('desc');
  setShowFilters(false);
};

const toggleBulkSelect = (creditId) => {
  setSelectedCards(prev => {
    const next = new Set(prev);
    if (next.has(creditId)) {
      next.delete(creditId);
    } else {
      if (next.size >= 10) {
        showToast('Max 10 credits selectable at once', 'error');
        return prev;
      }
      next.add(creditId);
    }
    return next;
  });
};

const clearBulkMode = () => {
  setBulkMode(false);
  setSelectedCards(new Set());
  setBulkAction(null);
  setBulkPrice('');
  setBulkProgress(null);
};

useEffect(() => {
  clearBulkMode();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [activeTab]);

  const validateForm = () => {
    const e = {};
    if (!form.projectName.trim())                       e.projectName  = 'Required';
    if (!form.location.trim())                          e.location     = 'Required';
    if (!form.country.trim())                           e.country      = 'Required';
    if (!form.projectType)                              e.projectType  = 'Required';
    if (!form.developer.trim())                         e.developer    = 'Required';
    if (!form.credits || safeNum(form.credits) <= 0)   e.credits      = 'Must be > 0';
    if (!form.vintageYear || isNaN(form.vintageYear))  e.vintageYear  = 'Required';
    if (safeNum(form.vintageYear) > new Date().getFullYear())
                                                        e.vintageYear  = 'Cannot be in the future';
    if (!form.expiryDate)                               e.expiryDate   = 'Required';
    if (form.expiryDate && new Date(form.expiryDate) <= new Date())
                                                        e.expiryDate   = 'Must be a future date';
    if (!form.serialNumber.trim())                      e.serialNumber = 'Required';
    if (!form.projectId.trim())                         e.projectId    = 'Required';
    if (!form.docFile)                                  e.docFile      = 'Ownership proof required';
    if (form.standard === 'GS' && form.sdgTags.length === 0)
                                                        e.sdgTags      = 'Gold Standard requires ≥ 1 SDG tag';
    if (form.registryLink && !/^https?:\/\//.test(form.registryLink))
                                                        e.registryLink = 'Must be a valid URL (https://)';
    setFormErrors(e);
    return Object.keys(e).length === 0;
  };

  const handlePincode = async (pin) => {
    setForm(f => ({ ...f, pincode: pin }));
    setPincodeError('');
    if (pin.length !== 6 || isNaN(pin)) return;
    setPincodeLoading(true);
    try {
      const res  = await fetch(`https://api.postalpincode.in/pincode/${pin}`,
        { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      if (data[0]?.Status === 'Success') {
        const p = data[0].PostOffice[0];
        setForm(f => ({
          ...f, pincode:pin,
          location : sanitise(`${p.Name}, ${p.District}, ${p.State}`),
          country  : 'India',
        }));
      } else {
        setPincodeError('Invalid pincode');
      }
    } catch {
      setPincodeError('Could not fetch location');
    } finally {
      if (mountedRef.current) setPincodeLoading(false);
    }
  };

  const toggleSdg = (id) => setForm(f => ({
    ...f,
    sdgTags: f.sdgTags.includes(id)
      ? f.sdgTags.filter(s => s !== id)
      : [...f.sdgTags, id],
  }));

  const uploadDocToIPFS = async (file) => {
  const fd = new FormData();
  fd.append('file', file);
  const res = await apiFetchMultipart('/api/ipfs/pin', fd);
  if (!res?.ipfsHash) throw new Error('IPFS upload failed — no hash returned');
  return res.ipfsHash;
};

  const handleRegister = async () => {
    if (!validateForm()) return;
    if (!isKYCVerified) { showToast('Complete KYC first', 'error'); return; }
    if (!can('portfolio:submit_credit')) { showToast('No permission to submit credits', 'error'); return; }
    if (creditLimitReached) {
      showToast(`Credit limit reached (${planLimit.credits}) — upgrade plan`, 'error');
      return;
    }

    setSubmitting(true);
    setTxPending('Uploading ownership document to IPFS…');
    try {
      const docIpfsHash = await uploadDocToIPFS(form.docFile);
      setTxPending('Submitting for admin verification…');
      await apiFetch('/api/portfolio/submit-credit', {
        method : 'POST',
        body   : JSON.stringify({
          projectName     : form.projectName.trim(),
          projectLocation : form.location.trim(),
          country         : form.country.trim(),
          standard        : form.standard,
          projectId       : form.projectId.trim(),
          projectType     : form.projectType,
          developer       : form.developer.trim(),
          quantity        : parseInt(form.credits, 10),
          vintageYear     : parseInt(form.vintageYear, 10),
          expiryDate      : form.expiryDate,
          registrySerial  : form.serialNumber.trim(),
          docIpfsHash,
          creditType           : form.creditType,
          cbamEligible         : form.cbamEligible,
          acvaName             : form.acvaName || null,
          acvaDate             : form.acvaDate || null,
          acvaStatus           : form.acvaStatus,
          sdgTags              : form.sdgTags,
          correspondingAdjustment : form.correspondingAdjustment,
          icvcmCcpEligible     : form.icvcmCcpEligible,
          icvcmCcpLabel        : form.icvcmCcpLabel || null,
          icvcmCcpDate         : form.icvcmCcpDate || null,
          registryLink         : form.registryLink || null,
          methodologyId        : form.methodologyId || null,
          additionalityType    : form.additionalityType,
          permanenceRating     : form.permanenceRating,
          coBenefitsVerified   : form.coBenefitsVerified,
          orgId : org?.id ? Number(org.id) : null,
        }),
      });

      setShowForm(false);
      setForm(emptyForm);
      setFormErrors({});
      setPincodeError('');
      showToast('Submitted! Approval takes 1–2 business days.');
      await loadPendingCredits();
    } catch (e) {
      showToast(e.message || 'Submission failed', 'error');
    } finally {
      if (mountedRef.current) {
        setSubmitting(false);
        setTxPending('');
      }
    }
  };

  const handleListPriceChange = (val, credit) => {
    setListPrice(val);
    const p = safeNum(val);
    if (!p || !credit) { setListPriceWarn(''); return; }
    if (credit.creditType === 'compliance' && (p < INDIA_CCTS_FLOOR || p > INDIA_CCTS_CEILING)) {
      setListPriceWarn(`⚠ ₹${p.toLocaleString()}/t outside India CCTS band (₹${INDIA_CCTS_FLOOR}–₹${INDIA_CCTS_CEILING})`);
    } else {
      setListPriceWarn('');
    }
  };

 const handleListForSale = async (credit) => {
  if (!can('portfolio:list')) { showToast('No permission to list credits', 'error'); return; }
  if (!credit.tokenId && credit.tokenId !== 0) { showToast('Credit not yet minted on-chain', 'error'); return; }
  const price = safeNum(listPrice);
  if (!price || price <= 0) { showToast('Enter a valid price', 'error'); return; }
  const qty = parseInt(listQty, 10) || credit.credits;
  if (qty <= 0 || qty > credit.credits) {
    showToast(`Quantity must be between 1 and ${credit.credits}`, 'error');
    return;
  }
  try {
    setTxPending(`Listing "${sanitise(credit.projectName)}"…`);
    const rate     = ethPriceInr || 210000;
    const priceEth = (price / rate).toFixed(6);
    const result   = await listCredit(credit.tokenId, qty, priceEth, price);

    const { listingId } = result;
    if (listingId !== null && listingId !== undefined) {
      try {
        await apiFetch('/api/portfolio/confirm-listing', {
          method : 'POST',
          body   : JSON.stringify({
            batchId          : credit.id,
            listingIdOnchain : listingId,
            txHash           : result.txHash || null,
            pricePerCreditInr: price,
          }),
        });
      } catch (dbErr) {
        console.error('[confirm-listing] DB sync failed:', dbErr?.message);
        showToast('Listed on-chain but market sync failed — refresh in a moment', 'error');
      }
    } else {
      console.warn('[handleListForSale] listingId not returned from contract — market may lag');
    }

    setShowList(null);
    setListPrice('');
    setListQty('');
    setListPriceWarn('');
    setActiveTab('LISTED');
    showToast('Listed on marketplace!');
    await loadMyCredits();
  } catch (e) {
    showToast(e.message || 'Transaction failed', 'error');
  } finally {
    if (mountedRef.current) setTxPending('');
  }
};

const handleDelist = async (credit, qty) => {
  if (!can('portfolio:list')) { showToast('No permission', 'error'); return; }
  try {
    setTxPending('Cancelling listing…');
    const onchainListingId = credit.listingIdOnchain ?? credit.listingId;

    if (qty && qty < credit.listedCredits) {
      await delistCredit(onchainListingId);

      try {
        await apiFetch('/api/portfolio/confirm-delisting', {
          method : 'POST',
          body   : JSON.stringify({ batchId: credit.id }),
        });
      } catch (e) { console.error('[confirm-delisting]', e?.message); }

      const remainingQty = credit.listedCredits - qty;
      const rate         = ethPriceInr || 210000;
      const priceEth     = (credit.pricePerCredit / rate).toFixed(6);
      const relistResult = await listCredit(credit.tokenId, remainingQty, priceEth, credit.pricePerCredit);

      if (relistResult?.listingId !== null && relistResult?.listingId !== undefined) {
        try {
          await apiFetch('/api/portfolio/confirm-listing', {
            method : 'POST',
            body   : JSON.stringify({
              batchId          : credit.id,
              listingIdOnchain : relistResult.listingId,
              txHash           : relistResult.txHash || null,
              pricePerCreditInr: credit.pricePerCredit,
            }),
          });
        } catch (e) { console.error('[confirm-listing relist]', e?.message); }
      }

      showToast(`${qty} credits delisted. ${remainingQty} still listed.`);
    } else {
      await delistCredit(onchainListingId);

      try {
        await apiFetch('/api/portfolio/confirm-delisting', {
          method : 'POST',
          body   : JSON.stringify({ batchId: credit.id }),
        });
      } catch (e) { console.error('[confirm-delisting]', e?.message); }

      showToast('All credits removed from marketplace.');
    }
    await loadMyCredits();
  } catch (e) {
    showToast(e.message || 'Transaction failed', 'error');
  } finally {
    if (mountedRef.current) setTxPending('');
    setShowDelist(null);
    setDelistQty('');
  }
};

const handleBulkList = async () => {
  if (!can('portfolio:list')) { showToast('No permission', 'error'); return; }
  const price = safeNum(bulkPrice);
  if (!price || price <= 0) { showToast('Enter a valid price', 'error'); return; }

  const selectedCredits = filtered.filter(c =>
    selectedCards.has(c.id || c.tokenId) && c.tokenId != null
  );

  if (!selectedCredits.length) { showToast('No valid credits selected', 'error'); return; }

  setBulkProgress({ total: selectedCredits.length, done: 0, failed: 0, status: 'listing' });

  const rate = ethPriceInr || 210000;
  const priceEth = (price / rate).toFixed(6);

  for (let i = 0; i < selectedCredits.length; i++) {
    const credit = selectedCredits[i];
    try {
      await listCredit(credit.tokenId, credit.heldCredits ?? credit.credits, priceEth, price);
      setBulkProgress(p => ({ ...p, done: p.done + 1 }));
    } catch (e) {
      setBulkProgress(p => ({ ...p, failed: p.failed + 1 }));
      console.error('[bulkList]', credit.projectName, e.message);
    }
  }

  setBulkProgress(p => ({ ...p, status: 'done' }));
  await loadMyCredits();
  showToast(`Bulk listed ${selectedCredits.length} credits!`);
  clearBulkMode();
};

const handleBulkRetire = async () => {
  if (!can('portfolio:retire')) { showToast('No permission', 'error'); return; }

  const selectedCredits = filtered.filter(c =>
    selectedCards.has(c.id || c.tokenId) && c.tokenId != null
  );

  if (!selectedCredits.length) { showToast('No valid credits selected', 'error'); return; }

  setBulkProgress({ total: selectedCredits.length, done: 0, failed: 0, status: 'retiring' });

  for (let i = 0; i < selectedCredits.length; i++) {
    const credit = selectedCredits[i];
    try {
      await retireCredit(credit.tokenId, credit.heldCredits ?? credit.credits, '1', {});
      setBulkProgress(p => ({ ...p, done: p.done + 1 }));
    } catch (e) {
      setBulkProgress(p => ({ ...p, failed: p.failed + 1 }));
      console.error('[bulkRetire]', credit.projectName, e.message);
    }
  }

  setBulkProgress(p => ({ ...p, status: 'done' }));
  await loadMyCredits();
  showToast(`Bulk retired ${selectedCredits.length} credits!`);
  clearBulkMode();
};

  const handleRetireConfirm = async (credit, qty, scope, corporateData) => {
    try {
      setTxPending('Checking for duplicate retirement…');
      const dupCheck = await apiFetch(
        `/api/portfolio/check-duplicate-retirement?serial=${encodeURIComponent(credit.serialNumber)}`
      );
      if (dupCheck?.found) {
        showToast('Serial number already retired.', 'error');
        setTxPending('');
        return;
      }

      setTxPending('Burning tokens on blockchain…');
if (credit.tokenId == null) {
  showToast('Credit not yet minted on-chain — cannot retire', 'error');
  setTxPending('');
  return;
}
const result = await retireCredit(credit.tokenId, qty);
      const retiredAt  = Date.now();
      const rawTokenId = credit.tokenId != null
        ? String(credit.tokenId).padStart(8, '0') : 'XXXXXXXX';
      let certId = `CERT-${rawTokenId}-${retiredAt.toString(36).toUpperCase().slice(-6)}`;

      try {
        const retirementRes = await txAPI.recordRetirement({
          tokenId        : credit.tokenHex || credit.tokenId,
          projectName    : credit.projectName,
          standard       : credit.standard,
          credits        : qty,
          vintageYear    : credit.vintageYear,
          serialNumber   : credit.serialNumber,
          developer      : credit.developer,
          location       : credit.location,
          country        : credit.country,
          projectType    : credit.projectType,
          txHash         : result.txHash,
          blockNumber    : result.blockNumber || null,
          beneficiary    : user?.email || walletAddress,
          retireScope    : scope,
          correspondingAdjustment : credit.correspondingAdjustment,
          walletAddress,
          beneficiaryName    : corporateData?.beneficiaryName   || '',
          beneficiaryEntity  : corporateData?.beneficiaryEntity || '',
          beneficiaryGstin   : corporateData?.beneficiaryGstin  || '',
          reportingStandard  : corporateData?.reportingStandard || 'GHG_PROTOCOL',
          purpose            : corporateData?.purpose           || 'voluntary_offset',
          orgId              : org?.id,
          approvedBy         : dbUser?.id,
        });
        if (retirementRes?.certId) certId = retirementRes.certId;
      } catch (backendErr) {
        console.error('[retirement backend sync]', backendErr?.message);
      }

      setShowRetire(null);
      if (mountedRef.current) {
        setRetireSteps({
          show: true, qty, scope, credit,
          txHash   : result.txHash,
          certId,
          retiredAt,
          corporateData,
        });
      }

      await Promise.allSettled([
        loadEmissionsData(),
        loadMyCredits(),
        refreshRetirements && refreshRetirements(),
      ]);
    } catch (e) {
      showToast(e.message || 'Transaction failed', 'error');
    } finally {
      if (mountedRef.current) setTxPending('');
    }
  };

  const handleRefresh = async () => {
    try {
      await Promise.allSettled([
        loadMyCredits(),
        loadPendingCredits(),
        loadEmissionsData(),
        refreshBoughtCredits && refreshBoughtCredits(),
      ]);
      showToast('Portfolio refreshed');
    } catch {
      showToast('Refresh failed', 'error');
    }
  };

  const handleExportCSV = () => {
    if (!can('portfolio:export')) { showToast('No export permission', 'error'); return; }

    const csvEscape = v => {
      const s = String(v == null ? '' : v).replace(/^[=+\-@\t\r\n]/g, "'$&");
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const headers = [
      'Project Name','Standard','Credit Type','Project Type','Country',
      'Credits (tCO₂)','Vintage','Status','Serial','CBAM','Developer','Methodology','CA Status',
    ];
    const rows = allCredits.map(c => [
      c.projectName, c.standard, c.creditType || 'voluntary',
      c.projectType, c.country, c.credits, c.vintageYear,
      c.isPending ? (c.isRejected ? 'REJECTED' : 'PENDING') : c.status,
      c.serialNumber, c.cbamEligible ? 'YES' : 'NO',
      c.developer || '', c.methodologyId || '', c.correspondingAdjustment || 'none',
    ]);

    const csv  = [headers, ...rows].map(r => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type:'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `ethertrack_portfolio_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Portfolio exported as CSV');
  };

  const handleCancelSubmission = async (id) => {
    try {
      await apiFetch(`/api/portfolio/submissions/${id}`, { method:'DELETE' });
      showToast('Submission cancelled.');
      await loadPendingCredits();
    } catch (e) {
      showToast(e.message || 'Could not cancel', 'error');
    }
  };

  const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
*{box-sizing:border-box;}
.pt{min-height:100vh;background:#040706;font-family:'DM Mono',monospace;position:relative;overflow-x:hidden;}
.pt::before{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;
  background-image:linear-gradient(rgba(34,197,94,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(34,197,94,.025) 1px,transparent 1px);
  background-size:40px 40px;}
.ptw{position:relative;z-index:1;max-width:1200px;margin:0 auto;padding:32px 24px 80px;}
.pt-hdr{margin-bottom:28px;animation:fu .4s ease both;}
.pt-hdr-label{font-size:11px;color:#86efac88;letter-spacing:.2em;margin-bottom:6px;}
.pt-hdr-title{font-family:'Syne',sans-serif;font-size:30px;font-weight:800;color:#f0fdf4;margin-bottom:4px;}
.pt-hdr-title span{color:#22c55e;}
.pt-topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px;}
.pt-reg-btn{padding:11px 22px;border-radius:8px;border:none;background:linear-gradient(135deg,#14532d,#166534);color:#d1fae5;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.1em;transition:all .2s;}
.pt-reg-btn:hover:not(:disabled){background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;transform:translateY(-1px);}
.pt-reg-btn:disabled{opacity:.3;cursor:not-allowed;transform:none;}
.pt-btn-sm{padding:9px 16px;border-radius:7px;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.08em;transition:all .2s;}
.pt-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px;}
.pt-stat{background:#070c09;border:1px solid #0d1f11;border-radius:12px;padding:18px;position:relative;overflow:hidden;transition:border-color .2s;}
.pt-stat:hover{border-color:#22c55e22;}
.pt-stat-label{font-size:10px;color:#86efac77;letter-spacing:.14em;margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pt-stat-val{font-family:'Syne',sans-serif;font-size:clamp(14px,2vw,24px);font-weight:800;line-height:1.1;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;}
.pt-stat-sub{font-size:10px;color:#86efac55;letter-spacing:.06em;}
.pt-section-tabs{display:flex;gap:4px;margin-bottom:24px;border-bottom:1px solid #0d1f11;flex-wrap:wrap;}
.pt-section-tab{padding:10px 18px;border:none;border-bottom:2px solid transparent;background:transparent;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.1em;color:#86efac44;transition:all .2s;margin-bottom:-1px;}
.pt-section-tab:hover{color:#86efac88;}
.pt-section-tab.active{color:#22c55e;border-bottom-color:#22c55e;}
.pt-tabs{display:flex;gap:5px;margin-bottom:20px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch;}
.pt-tab{padding:8px 14px;border-radius:6px;border:1px solid #1a2e1a;background:#0a0f0a;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;color:#86efacaa;transition:all .2s;display:flex;align-items:center;gap:6px;white-space:nowrap;flex-shrink:0;}
.pt-tab:hover{border-color:#22c55e44;color:#86efacdd;}
.pt-tab.active{border-color:#22c55e;color:#4ade80;background:#0d1f0d;}
.pt-tab.rejected-tab.active{border-color:#f87171;color:#fca5a5;background:#1a0707;}
.pt-tab-count{font-size:10px;background:#1a2e1a;color:#86efacaa;padding:1px 7px;border-radius:10px;}
.pt-tab.active .pt-tab-count{background:#22c55e33;color:#4ade80;}
.pt-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;}
.pt-card{background:#070c09;border:1px solid #0d1f11;border-radius:14px;overflow:hidden;transition:all .25s;position:relative;}
.pt-card:hover{border-color:#22c55e22;transform:translateY(-2px);box-shadow:0 8px 32px rgba(0,0,0,.5);}
.pt-card.pending-approval{border-color:#f59e0b22;}
.pt-card.rejected{border-color:#f8717133;opacity:.85;}
.pt-ribbon{position:absolute;top:12px;right:12px;z-index:2;font-size:8px;padding:3px 10px;border-radius:3px;letter-spacing:.12em;font-weight:700;}
.pt-card-hdr{padding:16px 16px 12px;border-bottom:1px solid #0d1f1122;}
.pt-card-name{font-size:14px;font-weight:700;color:#f0fdf4;line-height:1.4;margin-bottom:5px;padding-right:70px;}
.pt-card-loc{font-size:11px;color:#86efac99;margin-bottom:8px;}
.pt-card-badges{display:flex;gap:5px;flex-wrap:wrap;align-items:center;}
.pt-badge{font-size:9px;padding:2px 7px;border-radius:3px;letter-spacing:.04em;}
.pt-meta{display:grid;grid-template-columns:1fr 1fr;}
.pt-meta-cell{padding:9px 14px;border-bottom:1px solid #0d1f1114;border-right:1px solid #0d1f1114;}
.pt-meta-cell:nth-child(even){border-right:none;}
.pt-meta-cell:nth-last-child(-n+2){border-bottom:none;}
.pt-meta-label{font-size:10px;color:#86efac77;letter-spacing:.1em;margin-bottom:4px;}
.pt-meta-val{font-size:13px;color:#f0fdf4;font-weight:600;}
.pt-meta-val.green{color:#4ade80;}.pt-meta-val.blue{color:#93c5fd;}
.pt-meta-full{grid-column:1/-1;border-right:none!important;}
.pt-card-actions{display:flex;gap:6px;padding:12px 14px;border-top:1px solid #0d1f11;background:#050809;flex-wrap:wrap;}
.pt-act-btn{flex:1;padding:10px 6px;border-radius:6px;font-size:11px;cursor:pointer;font-family:'DM Mono',monospace;border:1px solid #1a2e1a;background:#0a0f0a;color:#86efacc0;transition:all .2s;font-weight:600;white-space:nowrap;text-align:center;}
.pt-act-btn:hover:not(:disabled){border-color:#22c55e55;color:#4ade80;background:#0d1a0d;}
.pt-act-btn.sell{background:#0e1200;border-color:#facc1544;color:#fde04799;}
.pt-act-btn.retire{background:#0e0505;border-color:#f8717144;color:#fca5a599;}
.pt-act-btn.delist{background:#0e0800;border-color:#f9731644;color:#fdba7499;}
.pt-act-btn.cert{background:#0c0828;border-color:#a78bfa44;color:#c4b5fdaa;}
.pt-act-btn.market{background:#060e18;border-color:#60a5fa44;color:#93c5fdaa;}
.pt-act-btn.cancel{background:#110500;border-color:#f9731644;color:#fdba7499;}
.pt-act-btn:disabled{opacity:.25;cursor:not-allowed;}
.pt-empty{grid-column:1/-1;text-align:center;padding:72px 24px;background:#070c09;border:1px solid #0d1f11;border-radius:14px;}
.pt-skel{background:linear-gradient(90deg,#0d1f11 25%,#0a1a0e 50%,#0d1f11 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:6px;}
.pt-tx-banner{position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:4000;background:#070c09;border:1px solid #22c55e33;border-radius:8px;padding:12px 24px;font-size:12px;color:#22c55ecc;font-family:'DM Mono',monospace;display:flex;align-items:center;gap:10px;box-shadow:0 8px 32px rgba(0,0,0,.8);white-space:nowrap;}
.pt-spinner{width:14px;height:14px;border:2px solid #22c55e11;border-top-color:#22c55e88;border-radius:50%;animation:spin 1s linear infinite;flex-shrink:0;}
.pt-toast{position:fixed;bottom:24px;right:24px;z-index:9999;background:#070c09;border-radius:8px;padding:12px 20px;font-size:12px;font-family:'DM Mono',monospace;letter-spacing:.06em;box-shadow:0 8px 32px rgba(0,0,0,.8);}
.pt-upload-box{position:relative;border:1px dashed #0d1f11;border-radius:8px;padding:20px;text-align:center;background:#040706;cursor:pointer;transition:border-color .2s;}
.pt-upload-box:hover{border-color:#22c55e22;}
.pt-upload-box.err{border-color:#dc2626;}
.pt-toggle{display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border-radius:7px;border:1px solid #0d1f11;background:#040706;}
.pt-toggle-box{width:36px;height:20px;border-radius:10px;background:#0d1f11;position:relative;transition:background .2s;flex-shrink:0;}
.pt-toggle-box.on{background:#14532d;}
.pt-toggle-knob{width:14px;height:14px;border-radius:50%;background:#86efac44;position:absolute;top:3px;left:3px;transition:all .2s;}
.pt-toggle-box.on .pt-toggle-knob{left:19px;background:#22c55e;}
.pt-sdg-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;}
.pt-sdg-tag{padding:6px 10px;border-radius:6px;border:1px solid #0d1f11;background:#060a07;cursor:pointer;transition:all .2s;text-align:center;font-size:9px;color:#86efac55;}
.pt-sdg-tag.on{border-color:#60a5fa44;background:#060e18;color:#60a5facc;}
.pt-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.pt-form-full{grid-column:1/-1;}
.pt-field{display:flex;flex-direction:column;gap:5px;}
.pt-label{font-size:11px;color:#86efacaa;letter-spacing:.12em;}
.pt-input{padding:10px 12px;border-radius:7px;border:1px solid #1a2e1a;background:#040706;color:#f0fdf4;font-family:'DM Mono',monospace;font-size:12px;outline:none;transition:border-color .2s;width:100%;}
.pt-input:focus{border-color:#22c55e55;}.pt-input.err{border-color:#dc2626;}
.pt-err{font-size:10px;color:#fca5a5;}
.pt-section-divider{font-size:9px;color:#86efac44;letter-spacing:.14em;padding:10px 0 6px;border-top:1px solid #0d1f1166;margin-top:6px;grid-column:1/-1;}
.pt-card-extra{padding:8px 14px;border-top:1px solid #0d1f1122;display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
.pt-card.bulk-selected{border-color:#22c55e44 !important;background:#0a1a0a;}
@keyframes fu{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
@keyframes slideIn{from{opacity:0;transform:translateX(20px);}to{opacity:1;transform:translateX(0);}}
@keyframes spin{to{transform:rotate(360deg);}}
@keyframes shimmer{0%{background-position:200% 0;}100%{background-position:-200% 0;}}
@media(max-width:1024px){.pt-grid{grid-template-columns:repeat(2,1fr);}}
@media(max-width:680px){.pt-grid{grid-template-columns:1fr;}.pt-stats{grid-template-columns:repeat(2,1fr);}.pt-form-grid{grid-template-columns:1fr;}}
`;

  return (
    <>
      <style>{CSS}</style>
      <div className="pt">
        <div className="ptw">

          <div className="pt-hdr">
            <div className="pt-hdr-label">
              MY CARBON ASSETS · ETHEREUM SEPOLIA · INDIA CCTS · PARIS AGREEMENT ART.6 · GHG PROTOCOL · BRSR · CDP · ISO 14064-3 · CBAM
            </div>
            <h1 className="pt-hdr-title">
              Carbon Credits <span>Portfolio</span>
            </h1>
            <div style={{ fontSize:11, color:'#86efac66', letterSpacing:'.1em', display:'flex',
              alignItems:'center', gap:12, flexWrap:'wrap' }}>
              {rbacLoaded && teamRole && (
                <span style={{ marginLeft:8 }}>
                  <RoleBadge role={teamRole}/>
                  {org && <span style={{ marginLeft:8, color:'#86efac44' }}>· {sanitise(org.name)}</span>}
                </span>
              )}
            </div>
          </div>

          <KYCExpiryBanner navigate={navigate}/>

          {walletAddress && !isKYCVerified && (
            <div role="alert" style={{ marginBottom:20, padding:'12px 16px', background:'#110a00',
              border:'1px solid #f59e0b33', borderRadius:8, fontSize:11, color:'#f59e0b88',
              display:'flex', alignItems:'center', gap:10 }}>
              ⚠️ KYC not verified.{' '}
              <button onClick={() => refreshKYC && refreshKYC()}
                style={{ background:'none', border:'none', color:'#f59e0b',
                  cursor:'pointer', fontSize:11, textDecoration:'underline', padding:0 }}>
                Refresh KYC status
              </button>
            </div>
          )}

          {creditLimitReached && (
            <div role="alert" style={{ marginBottom:20, padding:'12px 16px', background:'#110a00',
              border:'1px solid #f97316cc', borderRadius:8, fontSize:11, color:'#f97316',
              display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
              <span>🔒 Credit limit reached for <strong>{planLimit.label}</strong> plan ({planLimit.credits} max)</span>
              <button onClick={() => navigate('/team')}
                style={{ padding:'6px 12px', borderRadius:6, border:'none', background:'#f97316',
                  color:'#fff', cursor:'pointer', fontFamily:'DM Mono,monospace',
                  fontSize:10, fontWeight:700 }}>
                UPGRADE →
              </button>
            </div>
          )}

          <div className="pt-topbar">
            <div style={{ fontSize:11, color:'#86efac77', display:'flex',
              alignItems:'center', gap:12, flexWrap:'wrap' }}>
              {loading.credits
                ? <span style={{ color:'#22c55e88' }}>⟳ Loading from blockchain…</span>
                : <span style={{ color:'#86efac99' }}>
                    {myCredits.filter(c => c.status !== 'RETIRED').length} active tokens
                  </span>
              }
              {walletAddress && (
                <a href={`https://sepolia.etherscan.io/address/${walletAddress}`}
                  target="_blank" rel="noreferrer noopener"
                  style={{ color:'#60a5fa88', textDecoration:'none', fontSize:11 }}>
                  🔗 {walletAddress.slice(0,6)}…{walletAddress.slice(-4)} ↗
                </a>
              )}
              {ethPriceInr && (
                <span style={{ fontSize:10, color:'#22c55e77' }}>
                  ETH ₹{ethPriceInr.toLocaleString()}
                </span>
              )}
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
              {can('portfolio:export')
                ? <button className="pt-btn-sm" data-testid="export-csv" onClick={handleExportCSV}
                    style={{ border:'1px solid #60a5fa44', background:'#060e18', color:'#60a5fa99' }}>
                    ↓ CSV
                  </button>
                : <LockedAction label="CSV" reason="Requires Manager role or higher"/>
              }
              <button className="pt-btn-sm" data-testid="refresh-btn" onClick={handleRefresh}
                disabled={loading.credits}
                style={{ border:'1px solid #22c55e33', background:'#060a07', color:'#86efac88' }}>
                {loading.credits ? '⟳' : '↻ REFRESH'}
              </button>
              {can('portfolio:submit_credit')
                ? <button className="pt-reg-btn" data-testid="tokenize-btn"
                    onClick={() => setShowForm(true)}
                    disabled={submitting || !isKYCVerified || creditLimitReached}
                    title={!isKYCVerified ? 'Complete KYC to submit credits' : undefined}>
                    ⊕ TOKENIZE NEW CREDIT
                  </button>
                : <LockedAction label="TOKENIZE NEW CREDIT" reason="Requires Manager role or higher"/>
              }
            </div>
          </div>

<div className="pt-stats" role="region" aria-label="Portfolio statistics">

  <div className="pt-stat" key="TOTAL CREDITS"
    style={{ cursor:'pointer' }}
    onMouseEnter={() => setHoveredStat('credits')}
    onMouseLeave={() => setHoveredStat(null)}
    onTouchStart={() => setHoveredStat(h => h==='credits' ? null : 'credits')}>
    <div style={{ position:'absolute', top:0, left:0, right:0, height:2,
      background:'linear-gradient(90deg,#052e16,#16a34a)', borderRadius:'12px 12px 0 0' }}/>
    {hoveredStat === 'credits' ? (
      <div style={{ animation:'fu .2s ease' }}>
        <div style={{ fontSize:9, color:'#86efac77', letterSpacing:'.14em', marginBottom:10 }}>
          TOTAL CREDITS BREAKDOWN
        </div>
        {[
          { label:'HELD',    val: allCredits.filter(c=>c.status==='HELD'||c.status==='PARTIAL').reduce((s,c)=>s+safeNum(c.heldCredits??c.credits),0), color:'#22c55e' },
          { label:'LISTED',  val: allCredits.filter(c=>c.status==='LISTED'||c.status==='PARTIAL').reduce((s,c)=>s+safeNum(c.listedCredits),0),         color:'#facc15' },
          { label:'BOUGHT',  val: normalisedBought.reduce((s,c)=>s+safeNum(c.heldCredits??c.credits),0),                                               color:'#60a5fa' },
          { label:'RETIRED', val: myRetirements.reduce((s,r)=>s+safeNum(r.amount),0),                                                                  color:'#a78bfa' },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ display:'flex', justifyContent:'space-between',
            alignItems:'center', marginBottom:6 }}>
            <span style={{ fontSize:9, color:'#86efac55', letterSpacing:'.1em' }}>{label}</span>
            <span style={{ fontSize:11, color, fontWeight:700, fontFamily:'Syne,sans-serif' }}>
              {val.toLocaleString()} t
            </span>
          </div>
        ))}
        <div style={{ borderTop:'1px solid #0d1f11', marginTop:6, paddingTop:6,
          display:'flex', justifyContent:'space-between' }}>
          <span style={{ fontSize:9, color:'#86efac44' }}>STANDARDS</span>
          <span style={{ fontSize:9, color:'#22c55e88' }}>
            {[...new Set(allCredits.map(c=>c.standard))].join(' · ')}
          </span>
        </div>
      </div>
    ) : (
      <>
        <div className="pt-stat-label">TOTAL CREDITS</div>
        <div className="pt-stat-val" style={{ color:'#22c55e' }}>
          {loading.credits ? '…' : `${statTotals.totalTco2.toLocaleString()} t`}
        </div>
        <div className="pt-stat-sub">held + listed + bought tCO₂</div>
        <div style={{ fontSize:8, color:'#22c55e33', marginTop:6, letterSpacing:'.08em' }}>
          HOVER FOR BREAKDOWN
        </div>
      </>
    )}
  </div>

  <div className="pt-stat"
    style={{ cursor:'pointer' }}
    onMouseEnter={() => setHoveredStat('value')}
    onMouseLeave={() => setHoveredStat(null)}
    onTouchStart={() => setHoveredStat(h => h==='value' ? null : 'value')}>
    <div style={{ position:'absolute', top:0, left:0, right:0, height:2,
      background:'linear-gradient(90deg,#0c1a2e,#3b82f6)', borderRadius:'12px 12px 0 0' }}/>
    {hoveredStat === 'value' ? (
      <div style={{ animation:'fu .2s ease' }}>
        <div style={{ fontSize:9, color:'#86efac77', letterSpacing:'.14em', marginBottom:10 }}>
          PORTFOLIO VALUE BREAKDOWN
        </div>
        {[
          {
            label : 'MINTED VALUE',
            val   : `₹${(ownedCredits.filter(c=>!c.isPending&&!c.isRejected).reduce((s,c)=>s+safeNum(c.heldCredits??c.credits)*getReferencePrice(c.projectType,c.standard,c.vintageYear,c.creditType,marketBuckets),0)/100000).toFixed(1)}L`,
            color : '#22c55e',
          },
          {
            label : 'BOUGHT VALUE',
            val   : `₹${(normalisedBought.reduce((s,c)=>s+safeNum(c.heldCredits??c.credits)*getReferencePrice(c.projectType,c.standard,c.vintageYear,c.creditType,marketBuckets),0)/100000).toFixed(1)}L`,
            color : '#60a5fa',
          },
          {
            label : 'AVG PRICE/tCO₂',
            val   : `₹${statTotals.totalTco2 > 0 ? Math.round(statTotals.portfolioValue / statTotals.totalTco2).toLocaleString() : 0}`,
            color : '#f0fdf4',
          },
          {
            label : 'TOTAL',
            val   : `₹${(statTotals.portfolioValue/100000).toFixed(1)}L`,
            color : '#60a5fa',
          },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ display:'flex', justifyContent:'space-between',
            alignItems:'center', marginBottom:6 }}>
            <span style={{ fontSize:9, color:'#86efac55', letterSpacing:'.1em' }}>{label}</span>
            <span style={{ fontSize:11, color, fontWeight:700, fontFamily:'Syne,sans-serif' }}>{val}</span>
          </div>
        ))}
      </div>
    ) : (
      <>
        <div className="pt-stat-label">PORTFOLIO VALUE</div>
        <div className="pt-stat-val" style={{ color:'#60a5fa' }}>
          {loading.credits ? '…' : `₹${(statTotals.portfolioValue/100000).toFixed(1)}L`}
        </div>
        <div className="pt-stat-sub">vintage-adjusted</div>
        <div style={{ fontSize:8, color:'#60a5fa33', marginTop:6, letterSpacing:'.08em' }}>
          HOVER FOR BREAKDOWN
        </div>
      </>
    )}
  </div>

  <div className="pt-stat"
    style={{ cursor:'pointer' }}
    onMouseEnter={() => setHoveredStat('pnl')}
    onMouseLeave={() => setHoveredStat(null)}
    onTouchStart={() => setHoveredStat(h => h==='pnl' ? null : 'pnl')}>
    <div style={{ position:'absolute', top:0, left:0, right:0, height:2,
      background: statTotals.pnl >= 0
        ? 'linear-gradient(90deg,#052e16,#16a34a)'
        : 'linear-gradient(90deg,#1a0707,#dc2626)',
      borderRadius:'12px 12px 0 0' }}/>
    {hoveredStat === 'pnl' ? (
      <div style={{ animation:'fu .2s ease' }}>
        <div style={{ fontSize:9, color:'#86efac77', letterSpacing:'.14em', marginBottom:10 }}>
          P&L BREAKDOWN
        </div>
        {[
          {
            label : 'INVESTED',
            val   : `₹${(normalisedBought.reduce((s,c)=>s+safeNum(c.pricePerCredit)*safeNum(c.heldCredits??c.credits),0)/100000).toFixed(1)}L`,
            color : '#86efac88',
          },
          {
            label : 'CURRENT VALUE',
            val   : `₹${(normalisedBought.reduce((s,c)=>s+getReferencePrice(c.projectType,c.standard,c.vintageYear,c.creditType,marketBuckets)*safeNum(c.heldCredits??c.credits),0)/100000).toFixed(1)}L`,
            color : '#60a5fa',
          },
          {
            label : 'UNREALISED P&L',
            val   : `${statTotals.pnl>=0?'+':''}₹${(statTotals.pnl/100000).toFixed(1)}L`,
            color : statTotals.pnl >= 0 ? '#22c55e' : '#f87171',
          },
          {
            label : 'RETURN',
            val   : `${statTotals.pnlPct>=0?'+':''}${statTotals.pnlPct}%`,
            color : statTotals.pnlPct >= 0 ? '#22c55e' : '#f87171',
          },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ display:'flex', justifyContent:'space-between',
            alignItems:'center', marginBottom:6 }}>
            <span style={{ fontSize:9, color:'#86efac55', letterSpacing:'.1em' }}>{label}</span>
            <span style={{ fontSize:11, color, fontWeight:700, fontFamily:'Syne,sans-serif' }}>{val}</span>
          </div>
        ))}
        <div style={{ borderTop:'1px solid #0d1f11', marginTop:6, paddingTop:6,
          display:'flex', justifyContent:'space-between' }}>
          <span style={{ fontSize:9, color:'#86efac44' }}>BOUGHT CREDITS</span>
          <span style={{ fontSize:9, color:'#60a5fa88' }}>
            {normalisedBought.length} positions
          </span>
        </div>
      </div>
    ) : (
      <>
        <div className="pt-stat-label">UNREALISED P&L</div>
        <div className="pt-stat-val" style={{
          color: statTotals.pnl >= 0 ? '#22c55e' : '#f87171' }}>
          {loading.credits ? '…' : `${statTotals.pnl>=0?'+':''}₹${(statTotals.pnl/100000).toFixed(1)}L`}
        </div>
        <div className="pt-stat-sub" style={{
          color: statTotals.pnlPct >= 0 ? '#22c55e66' : '#f8717166' }}>
          {statTotals.pnlPct>=0?'+':''}{statTotals.pnlPct}% · bought credits only
        </div>
        <div style={{ fontSize:8, color:'#86efac33', marginTop:6, letterSpacing:'.08em' }}>
          HOVER FOR BREAKDOWN
        </div>
      </>
    )}
  </div>

  <div className="pt-stat"
    style={{ cursor:'pointer' }}
    onMouseEnter={() => setHoveredStat('retired')}
    onMouseLeave={() => setHoveredStat(null)}
    onTouchStart={() => setHoveredStat(h => h==='retired' ? null : 'retired')}>
    <div style={{ position:'absolute', top:0, left:0, right:0, height:2,
      background:'linear-gradient(90deg,#0f0520,#7c3aed)', borderRadius:'12px 12px 0 0' }}/>
    {hoveredStat === 'retired' ? (
      <div style={{ animation:'fu .2s ease' }}>
        <div style={{ fontSize:9, color:'#86efac77', letterSpacing:'.14em', marginBottom:10 }}>
          RETIREMENT BREAKDOWN
        </div>
        {[
          {
            label : 'TOTAL RETIRED',
            val   : `${statTotals.retiredTco2.toLocaleString()} t`,
            color : '#a78bfa',
          },
          {
            label : 'CERTIFICATES',
            val   : myRetirements.length,
            color : '#f0fdf4',
          },
          {
            label : 'LAST RETIRED',
            val   : myRetirements.length > 0
              ? new Date(myRetirements[myRetirements.length-1].created_at||myRetirements[myRetirements.length-1].retired_at)
                  .toLocaleDateString('en-IN',{day:'2-digit',month:'short'})
              : '—',
            color : '#86efac88',
          },
          {
            label : 'SCOPES',
            val   : [...new Set(myRetirements.map(r=>r.retire_scope).filter(Boolean))].map(s=>`S${s}`).join(' · ') || '—',
            color : '#a78bfa88',
          },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ display:'flex', justifyContent:'space-between',
            alignItems:'center', marginBottom:6 }}>
            <span style={{ fontSize:9, color:'#86efac55', letterSpacing:'.1em' }}>{label}</span>
            <span style={{ fontSize:11, color, fontWeight:700, fontFamily:'Syne,sans-serif' }}>{val}</span>
          </div>
        ))}
      </div>
    ) : (
      <>
        <div className="pt-stat-label">PERMANENTLY RETIRED</div>
        <div className="pt-stat-val" style={{ color:'#a78bfa' }}>
          {loading.credits ? '…' : `${statTotals.retiredTco2.toLocaleString()} t`}
        </div>
        <div className="pt-stat-sub">tCO₂ offset on-chain</div>
        <div style={{ fontSize:8, color:'#a78bfa33', marginTop:6, letterSpacing:'.08em' }}>
          HOVER FOR BREAKDOWN
        </div>
      </>
    )}
  </div>

</div>

          <div className="pt-section-tabs" role="tablist">
            {[['OVERVIEW','📊 OVERVIEW'],['ANALYTICS','📈 ANALYTICS'],['AUDIT','📋 AUDIT LOG']].map(([key,label]) => (
              <button key={key} role="tab" aria-selected={section===key}
                className={`pt-section-tab${section===key?' active':''}`}
                onClick={() => setSection(key)}>
                {label}
              </button>
            ))}
          </div>

          {section === 'OVERVIEW' && (
            <ErrorBoundary>
              {watchlistError && (
                <div role="alert" style={{ background:'#0a0f0c', border:'1px solid #f8717122',
                  borderRadius:14, padding:'14px 22px', marginBottom:24,
                  fontSize:10, color:'#f8717166', display:'flex', alignItems:'center', gap:10 }}>
                  ⚠️ Watchlist unavailable.
                  <button onClick={() => user && loadWatchlist()}
                    style={{ marginLeft:'auto', padding:'5px 12px', borderRadius:5,
                      border:'1px solid #f8717133', background:'transparent',
                      color:'#f8717188', cursor:'pointer',
                      fontFamily:'DM Mono,monospace', fontSize:9 }}>
                    RETRY
                  </button>
                </div>
              )}
              {!watchlistError && watchlist.length > 0 && (
                <div style={{ background:'#0a0f0c', border:'1px solid #0f2a1a',
                  borderRadius:14, padding:'18px 22px', marginBottom:24 }}>
                  <div style={{ fontSize:9, color:'#86efac77', letterSpacing:'.14em', marginBottom:12 }}>
                    WATCHLIST ({watchlist.length})
                  </div>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    {watchlist.map(w => (
                      <div key={w.id} style={{ background:'#070c09', border:'1px solid #0d1f11',
                        borderRadius:8, padding:'8px 12px', display:'flex', alignItems:'center', gap:10 }}>
                        <div>
                          <div style={{ fontSize:11, color:'#f0fdf4', fontWeight:600 }}>
                            {sanitise(w.name)}
                          </div>
                          <div style={{ fontSize:9, color:'#86efac44' }}>
                            {w.standard} · ₹{Number(w.price||0).toLocaleString()}
                          </div>
                        </div>
                        <button onClick={() => navigate('/carbon-credits')}
                          style={{ padding:'4px 8px', borderRadius:4, border:'1px solid #22c55e33',
                            background:'#0d2e1f', color:'#22c55e88', cursor:'pointer',
                            fontFamily:'DM Mono,monospace', fontSize:9 }}>BUY</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-tabs" role="tablist">
                {[
                  { key:'ALL',      label:'ALL',       cls:'' },
                  { key:'HELD',     label:'HELD',      cls:'' },
                  { key:'LISTED',   label:'LISTED',    cls:'' },
                  { key:'BOUGHT',   label:'🛒 BOUGHT', cls:'' },
                  { key:'RETIRED',  label:'RETIRED',   cls:'' },
                  { key:'PENDING',  label:'PENDING',   cls:'' },
                  { key:'REJECTED', label:'REJECTED',  cls:'rejected-tab' },
                ].map(({ key, label, cls }) => (
                  <button key={key} role="tab" aria-selected={activeTab===key}
                    className={`pt-tab ${cls}${activeTab===key?' active':''}`}
                    onClick={() => setActiveTab(key)}>
                    {label}
                    <span className="pt-tab-count"
                      style={key==='PENDING'&&tabCounts.PENDING>0?{background:'#f59e0b22',color:'#f59e0b'}
                            :key==='REJECTED'&&tabCounts.REJECTED>0?{background:'#f8717122',color:'#f87171'}:{}}>
                      {tabCounts[key]}
                    </span>
                  </button>
                ))}
              </div>
{activeTab === 'HELD' && (
  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16 }}>
    <button
      onClick={() => { setBulkMode(b => !b); setSelectedCards(new Set()); }}
      style={{ padding:'7px 14px', borderRadius:6, cursor:'pointer',
        fontFamily:'DM Mono,monospace', fontSize:10, letterSpacing:'.08em',
        border:`1px solid ${bulkMode?'#22c55e44':'#1a2e1a'}`,
        background:bulkMode?'#0d2e1f':'#040706',
        color:bulkMode?'#22c55e':'#86efac55' }}>
      {bulkMode ? '✓ SELECT MODE ON' : '⊡ SELECT MODE'}
    </button>
    {bulkMode && (
      <span style={{ fontSize:10, color:'#86efac44' }}>
        {selectedCards.size} / 10 selected · click cards to select
      </span>
    )}
    {bulkMode && selectedCards.size > 0 && (
      <button onClick={() => setSelectedCards(new Set())}
        style={{ padding:'7px 12px', borderRadius:6, cursor:'pointer',
          fontFamily:'DM Mono,monospace', fontSize:9,
          border:'1px solid #f8717122', background:'#0e0505', color:'#f8717188' }}>
        CLEAR
      </button>
    )}
  </div>
)}

<div style={{ marginBottom:16 }}>

  <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>

    <div style={{ flex:1, minWidth:200, position:'relative' }}>
      <span style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)',
        fontSize:12, color:'#86efac44', pointerEvents:'none' }}>🔍</span>
      <input
        type="text"
        placeholder="Search project, serial, developer..."
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        style={{ width:'100%', padding:'9px 10px 9px 30px', borderRadius:7,
          border:'1px solid #1a2e1a', background:'#040706', color:'#f0fdf4',
          fontFamily:'DM Mono,monospace', fontSize:11, outline:'none',
          transition:'border-color .2s' }}
        onFocus={e => e.target.style.borderColor='#22c55e55'}
        onBlur={e => e.target.style.borderColor='#1a2e1a'}
      />
      {searchQuery && (
        <button onClick={() => setSearchQuery('')}
          style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)',
            background:'none', border:'none', color:'#86efac44', cursor:'pointer', fontSize:14 }}>
          ✕
        </button>
      )}
    </div>

    <div style={{ display:'flex', gap:4, alignItems:'center' }}>
      <select value={sortBy} onChange={e => setSortBy(e.target.value)}
        style={{ padding:'9px 10px', borderRadius:7, border:'1px solid #1a2e1a',
          background:'#040706', color:'#f0fdf4', fontFamily:'DM Mono,monospace',
          fontSize:10, outline:'none', cursor:'pointer' }}>
        <option value="default">SORT BY</option>
        <option value="value">VALUE</option>
        <option value="credits">CREDITS QTY</option>
        <option value="vintage">VINTAGE</option>
        <option value="expiry">EXPIRY DATE</option>
        <option value="price">REF. PRICE</option>
      </select>
      <button onClick={() => setSortDir(d => d==='asc'?'desc':'asc')}
        title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
        style={{ padding:'9px 12px', borderRadius:7, border:'1px solid #1a2e1a',
          background:'#040706', color:'#86efac88', cursor:'pointer',
          fontFamily:'DM Mono,monospace', fontSize:11 }}>
        {sortDir === 'asc' ? '↑' : '↓'}
      </button>
    </div>

    <button onClick={() => setShowFilters(f => !f)}
      style={{ padding:'9px 14px', borderRadius:7, cursor:'pointer',
        fontFamily:'DM Mono,monospace', fontSize:10, letterSpacing:'.08em',
        border:`1px solid ${showFilters||activeFilterCount>0?'#22c55e44':'#1a2e1a'}`,
        background:showFilters||activeFilterCount>0?'#0d2e1f':'#040706',
        color:showFilters||activeFilterCount>0?'#22c55e':'#86efac66',
        display:'flex', alignItems:'center', gap:6 }}>
      ⚙ FILTERS
      {activeFilterCount > 0 && (
        <span style={{ background:'#22c55e', color:'#040706', borderRadius:10,
          fontSize:9, padding:'1px 6px', fontWeight:700 }}>
          {activeFilterCount}
        </span>
      )}
    </button>

    {(activeFilterCount > 0 || searchQuery || sortBy !== 'default') && (
      <button onClick={clearAllFilters}
        style={{ padding:'9px 12px', borderRadius:7, cursor:'pointer',
          fontFamily:'DM Mono,monospace', fontSize:10,
          border:'1px solid #f8717122', background:'#0e0505', color:'#f8717188' }}>
        ✕ CLEAR
      </button>
    )}
  </div>

  {showFilters && (
    <div style={{ marginTop:10, padding:16, background:'#070c09',
      border:'1px solid #0d1f11', borderRadius:10, animation:'fu .2s ease' }}>

      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:9, color:'#86efac55', letterSpacing:'.14em', marginBottom:8 }}>
          REGISTRY STANDARD
        </div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {['VCS','GS','CDM','ACR','BEE'].map(s => (
            <button key={s} onClick={() => setFilterStandard(prev =>
                prev.includes(s) ? prev.filter(x=>x!==s) : [...prev, s]
              )}
              style={{ padding:'5px 12px', borderRadius:5, cursor:'pointer',
                fontFamily:'DM Mono,monospace', fontSize:10,
                border:`1px solid ${filterStandard.includes(s)
                  ? (REGISTRIES[s]?.color||'#22c55e')+'66'
                  : '#0d1f11'}`,
                background: filterStandard.includes(s)
                  ? (REGISTRIES[s]?.bg||'#0d2e1f')
                  : '#060a07',
                color: filterStandard.includes(s)
                  ? (REGISTRIES[s]?.color||'#22c55e')
                  : '#86efac44' }}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>

        <div>
          <div style={{ fontSize:9, color:'#86efac55', letterSpacing:'.14em', marginBottom:6 }}>
            PROJECT TYPE
          </div>
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            style={{ width:'100%', padding:'8px 10px', borderRadius:6,
              border:'1px solid #1a2e1a', background:'#040706', color:'#f0fdf4',
              fontFamily:'DM Mono,monospace', fontSize:10, outline:'none' }}>
            <option value="">ALL TYPES</option>
            {PROJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div>
          <div style={{ fontSize:9, color:'#86efac55', letterSpacing:'.14em', marginBottom:6 }}>
            CREDIT TYPE
          </div>
          <div style={{ display:'flex', gap:6 }}>
            {[{value:'',label:'ALL'},{value:'voluntary',label:'VCU'},{value:'compliance',label:'CCC'}]
              .map(ct => (
                <button key={ct.value} onClick={() => setFilterCreditType(ct.value)}
                  style={{ flex:1, padding:'8px 6px', borderRadius:6, cursor:'pointer',
                    fontFamily:'DM Mono,monospace', fontSize:9,
                    border:`1px solid ${filterCreditType===ct.value?'#22c55e44':'#0d1f11'}`,
                    background:filterCreditType===ct.value?'#0d2e1f':'#060a07',
                    color:filterCreditType===ct.value?'#22c55e':'#86efac44' }}>
                  {ct.label}
                </button>
              ))}
          </div>
        </div>

        <div>
          <div style={{ fontSize:9, color:'#86efac55', letterSpacing:'.14em', marginBottom:6 }}>
            VINTAGE YEAR — {filterVintage[0]} → {filterVintage[1]}
          </div>
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            <input type="number" min={1990} max={filterVintage[1]}
              value={filterVintage[0]}
              onChange={e => setFilterVintage(v => [Math.min(Number(e.target.value),v[1]), v[1]])}
              style={{ width:'70px', padding:'7px 8px', borderRadius:6,
                border:'1px solid #1a2e1a', background:'#040706', color:'#f0fdf4',
                fontFamily:'DM Mono,monospace', fontSize:10, outline:'none' }}/>
            <span style={{ color:'#86efac33', fontSize:10 }}>→</span>
            <input type="number" min={filterVintage[0]} max={new Date().getFullYear()}
              value={filterVintage[1]}
              onChange={e => setFilterVintage(v => [v[0], Math.max(Number(e.target.value),v[0])])}
              style={{ width:'70px', padding:'7px 8px', borderRadius:6,
                border:'1px solid #1a2e1a', background:'#040706', color:'#f0fdf4',
                fontFamily:'DM Mono,monospace', fontSize:10, outline:'none' }}/>
          </div>
        </div>

      </div>

      <div style={{ marginTop:12, fontSize:9, color:'#86efac44', letterSpacing:'.08em' }}>
        SHOWING {filtered.length} OF {allCredits.length} CREDITS
      </div>
    </div>
  )}
</div>

              <div className="pt-grid" role="region" aria-label="Credit cards">
                {activeTab === 'RETIRED' ? (
                  myRetirements.length === 0 ? (
                    <div className="pt-empty">
                      <div style={{ fontSize:40, marginBottom:16 }}>🔥</div>
                      <div style={{ fontSize:14, color:'#f0fdf4', fontWeight:700 }}>No retirements yet</div>
                    </div>
                  ) : myRetirements.map((ret, i) => {
                    const certId    = ret.cert_id || ret.certificate_id || ret.certId;
                    const verifyUrl = certId ? `${VERIFY_BASE_URL}/${certId}` : null;
                    return (
                      <div key={ret.id || i} style={{ background:'#070c09', border:'1px solid #22c55e22',
                        borderRadius:14, overflow:'hidden' }}>
                        <div style={{ padding:'14px 16px 10px', borderBottom:'1px solid #0d1f11',
                          display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8 }}>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:9, color:'#f8717188', letterSpacing:'.14em', marginBottom:4 }}>
                              🔥 PERMANENTLY RETIRED ON-CHAIN
                            </div>
                            <div style={{ fontSize:12, color:'#f0fdf4', fontWeight:700,
                              whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                              {sanitise(ret.project_name || ret.projectName || '—')}
                            </div>
                            <div style={{ fontSize:9, color:'#86efac44', marginTop:3 }}>
                              {ret.standard || 'VCS'} · {(ret.created_at||ret.retired_at||'').slice(0,10)||'—'}
                            </div>
                          </div>
                          <div style={{ textAlign:'right', flexShrink:0 }}>
                            <div style={{ fontSize:22, fontWeight:800, color:'#f87171',
                              fontFamily:'Syne,sans-serif', lineHeight:1 }}>
                              {Number(ret.amount || 0).toLocaleString()}
                            </div>
                            <div style={{ fontSize:9, color:'#f8717144' }}>tCO₂e</div>
                          </div>
                        </div>
                        <div style={{ padding:'12px 16px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                          {[
                            { l:'CERTIFICATE ID', v:certId?.slice(0,20)||'—', color:'#22c55e' },
                            { l:'OFFSET SCOPE',   v:ret.retire_scope?`Scope ${ret.retire_scope}`:'—', color:'#a78bfa' },
                          ].map(({ l, v, color }) => (
                            <div key={l} style={{ background:'#060a07', border:'1px solid #0d1f11',
                              borderRadius:6, padding:'8px 10px' }}>
                              <div style={{ fontSize:8, color:'#86efac44', letterSpacing:'.1em', marginBottom:3 }}>{l}</div>
                              <div style={{ fontSize:10, color, fontWeight:600, wordBreak:'break-all' }}>{sanitise(String(v))}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ padding:'10px 16px', borderTop:'1px solid #0d1f11', display:'flex', gap:8 }}>
                          {verifyUrl && (
                            <a href={verifyUrl} target="_blank" rel="noreferrer noopener"
                              style={{ flex:1, padding:'8px 12px', borderRadius:6,
                                border:'1px solid #22c55e33', background:'#051409',
                                color:'#22c55e88', fontFamily:'DM Mono,monospace',
                                fontSize:10, textAlign:'center', textDecoration:'none' }}>
                              🔍 CERTIFICATE
                            </a>
                          )}
                          {ret.tx_hash && (
                            <a href={`https://sepolia.etherscan.io/tx/${ret.tx_hash}`}
                              target="_blank" rel="noreferrer noopener"
                              style={{ flex:1, padding:'8px 12px', borderRadius:6,
                                border:'1px solid #60a5fa33', background:'#060e18',
                                color:'#60a5fa88', fontFamily:'DM Mono,monospace',
                                fontSize:10, textAlign:'center', textDecoration:'none' }}>
                              ⛓ ETHERSCAN ↗
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : loading.credits && allCredits.length === 0 ? (
                  [1,2,3].map(i => (
                    <div key={i} style={{ background:'#070c09', border:'1px solid #0d1f11',
                      borderRadius:14, padding:20 }}>
                      <div className="pt-skel" style={{ height:14, width:'70%', marginBottom:10 }}/>
                      <div className="pt-skel" style={{ height:10, width:'40%' }}/>
                    </div>
                  ))
                ) : filtered.length === 0 ? (
                  <div className="pt-empty">
                    <div style={{ fontSize:40, marginBottom:16 }}>🌿</div>
                    <div style={{ fontSize:14, color:'#f0fdf4', fontWeight:700, marginBottom:8 }}>
                      {activeTab==='HELD'   ?'No held credits yet'
                      :activeTab==='LISTED' ?'No listed credits yet'
                      :activeTab==='BOUGHT' ?'No purchased credits yet'
                      :activeTab==='PENDING'?'No pending submissions'
                      :activeTab==='REJECTED'?'No rejected submissions'
                      :'No credits found'}
                    </div>
                    {activeTab === 'BOUGHT' && (
                      <button onClick={() => navigate('/carbon-credits')}
                        style={{ marginTop:16, padding:'10px 20px', borderRadius:8,
                          border:'1px solid #22c55e44', background:'#0d2e1f',
                          color:'#22c55e', cursor:'pointer',
                          fontFamily:'DM Mono,monospace', fontSize:11 }}>
                        GO TO MARKET →
                      </button>
                    )}
                  </div>
                ) : filtered.map((credit, cardIdx) => {
                  const reg          = REGISTRIES[credit.standard] || REGISTRIES.VCS;
                  const dep          = vintagePenalty(credit.vintageYear);
                  // [FIX-SHARED-PRICING] bought-credit refPrice previously
                  // showed purchase price. Always show live market price
                  // here; purchase price shown separately as "BOUGHT AT".
                  const refPrice     = getReferencePrice(credit.projectType, credit.standard, credit.vintageYear, credit.creditType, marketBuckets);
                  // [FIX-DEMAND-BADGE] Live demand/supply badge from the
                  // same bucket data used for refPrice above.
                  const demandBadge  = getDemandSupplyBadge(credit.projectType, credit.standard, marketBuckets);
                  const isMinted     = credit.isOnChain !== false && credit.tokenId != null;
                  const daysLeft     = getDaysUntilExpiry(credit.expiryDate);
                  const expiryUrgent = daysLeft !== null && daysLeft <= 90 && daysLeft > 0;
                  const expired      = daysLeft !== null && daysLeft <= 0;
                  const ctMeta       = CREDIT_TYPES.find(t => t.value === (credit.creditType||'voluntary')) || CREDIT_TYPES[0];
                  const caMeta       = getCAMeta(credit.correspondingAdjustment || 'none');

                  const statusStyle = credit.isRejected
                    ? { bg:'#1a0707', color:'#f87171', border:'#f8717133', label:'✕ REJECTED' }
                    : credit.isPending
                    ? { bg:'#1a0e00', color:'#f59e0b', border:'#f59e0b33', label:'⏳ PENDING'  }
                    : ({
                        HELD    : { bg:'#051409', color:'#22c55e', border:'#22c55e22', label:'● HELD'   },
                        PARTIAL : { bg:'#051409', color:'#facc15', border:'#facc1522', label:'◑ PARTIAL' },
                        LISTED  : { bg:'#110e00', color:'#facc15', border:'#facc1522', label:'◆ LISTED'  },
                        BOUGHT  : { bg:'#060e18', color:'#60a5fa', border:'#60a5fa22', label:'🛒 BOUGHT' },
                        RETIRED : { bg:'#0c0520', color:'#a78bfa', border:'#a78bfa22', label:'✓ RETIRED' },
                      }[credit.status] || { bg:'#051409', color:'#22c55e', border:'#22c55e22', label:'● HELD' });

                  return (
                    <article key={credit.id || cardIdx}
  className={`pt-card${credit.isPending&&!credit.isRejected?' pending-approval':''}${credit.isRejected?' rejected':''}${bulkMode&&selectedCards.has(credit.id||credit.tokenId)?' bulk-selected':''}`}
  aria-label={`Credit: ${credit.projectName}`}
  style={ bulkMode ? { overflow:'visible' } : undefined }>

  <div className="pt-ribbon"
    style={{ background:statusStyle.bg, color:statusStyle.color, border:`1px solid ${statusStyle.border}` }}>
    {statusStyle.label}
  </div>

  {bulkMode && activeTab === 'HELD' && !credit.isPending && !credit.isRejected && credit.tokenId != null && (() => {
  const isSelected = selectedCards.has(credit.id || credit.tokenId);
  return (
    <div
      onClick={e => { e.stopPropagation(); toggleBulkSelect(credit.id || credit.tokenId); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 14px',
        background: isSelected ? '#0d2e1f' : '#060a07',
        borderBottom: '1px solid #0d1f11',
        cursor: 'pointer',
        transition: 'background .15s',
      }}>
      <div style={{
        width: 18, height: 18, borderRadius: 4, flexShrink: 0,
        border: `2px solid ${isSelected ? '#22c55e' : '#86efac33'}`,
        background: isSelected ? '#22c55e' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, color: '#040706',
      }}>
        {isSelected && '✓'}
      </div>
      <span style={{
        fontSize: 10, fontFamily: 'DM Mono,monospace',
        color: isSelected ? '#22c55e' : '#86efac44',
        letterSpacing: '.08em',
      }}>
        {isSelected ? 'SELECTED' : 'SELECT'}
      </span>
    </div>
  );
})()}

  <div className="pt-card-hdr"
    onClick={() => setSelectedCard(credit)}
    style={{ cursor:'pointer' }}>
    <div className="pt-card-name" title={credit.projectName}>
      {sanitise(credit.projectName)}
    </div>
    <div className="pt-card-loc">📍 {sanitise(credit.location||credit.country||'—')}</div>
    <div className="pt-card-badges">
      <span className="pt-badge"
        style={{ background:reg.bg, color:reg.color, border:`1px solid ${reg.color}22` }}>
        {credit.standard}
      </span>
      <span className="pt-badge"
        style={{ background:`${ctMeta.color}11`, color:ctMeta.color, border:`1px solid ${ctMeta.color}33` }}>
        {credit.creditType === 'compliance' ? 'CCC' : 'VCU'}
      </span>
      {credit.icvcm_ccp_eligible && (
        <span className="pt-badge" style={{ background:'#0e1a00', color:'#84cc16', border:'1px solid #84cc1633' }}>
          🏅 CCP
        </span>
      )}
      {demandBadge && (
        <span className="pt-badge" style={{ background:demandBadge.bg, color:demandBadge.color, border:`1px solid ${demandBadge.border}` }}>
          {demandBadge.label}
        </span>
      )}
      {credit.isRejected
        ? <span className="pt-badge" style={{ background:'#1a0707', color:'#f87171' }}>✕ Rejected</span>
        : credit.isPending
        ? <span className="pt-badge" style={{ background:'#1a0e00', color:'#f59e0b' }}>⏳ Review</span>
        : isMinted
        ? <span className="pt-badge" style={{ background:'#22c55e0d', color:'#22c55e66' }}>⛓ On-Chain</span>
        : <span className="pt-badge" style={{ background:'#0a1628', color:'#60a5fa88' }}>⏳ Minting</span>
      }
      {credit.cbamEligible && (
        <span className="pt-badge" style={{ background:'#060e18', color:'#60a5fa88' }}>🇪🇺 CBAM</span>
      )}
      {dep > 0 && (
        <span className="pt-badge" style={{ background:'#111000', color:'#facc1566' }}>↓{dep}%</span>
      )}
      {credit.correspondingAdjustment && credit.correspondingAdjustment !== 'none' && (
        <span className="pt-badge" style={{ background:'#060e18', color:'#60a5fa', border:'1px solid #60a5fa22' }}>
          🌐 {credit.correspondingAdjustment === 'itmo' ? 'Art.6.4' : 'Art.6.2'}
        </span>
      )}
      {expired && (
        <span className="pt-badge" style={{ background:'#1a0707', color:'#f87171', border:'1px solid #f8717133' }}>
          ⛔ EXPIRED
        </span>
      )}
      {!expired && expiryUrgent && (
        <span className="pt-badge" style={{ background:'#110a00', color:'#f59e0b', border:'1px solid #f59e0b33' }}>
          ⚠ {daysLeft}d
        </span>
      )}
      <span style={{ fontSize:8, color:'#22c55e33', letterSpacing:'.08em', marginLeft:'auto' }}>
        TAP FOR DETAILS →
      </span>
    </div>
  </div>

  {credit.isRejected && (
    <div role="alert" style={{ margin:'8px 14px 0', padding:'10px 12px',
      background:'#1a0707', border:'1px solid #f8717122', borderRadius:6,
      fontSize:10, color:'#f8717188' }}>
      <div style={{ fontWeight:700, color:'#f87171aa', marginBottom:4 }}>✕ Rejected</div>
      <div>{sanitise(credit.admin_notes || 'Contact support for details.')}</div>
    </div>
  )}
  {credit.isPending && !credit.isRejected && (
    <div style={{ margin:'8px 14px 0', padding:'8px 12px', background:'#110a00',
      border:'1px solid #f59e0b22', borderRadius:6, fontSize:10, color:'#f59e0b88' }}>
      🔍 Under admin verification. 1–2 business days.
    </div>
  )}

  <div className="pt-meta">
    {!credit.isPending && (
      <div className="pt-meta-cell">
        <div className="pt-meta-label">TOKEN ID</div>
        <div className="pt-meta-val blue" style={{ fontSize:10, fontFamily:'monospace' }}>
          {isMinted ? (credit.tokenHex || credit.tokenId) : '⏳ Pending'}
        </div>
      </div>
    )}
    <div className={`pt-meta-cell${credit.isPending?' pt-meta-full':''}`}>
      <div className="pt-meta-label">
        {activeTab === 'LISTED' ? 'LISTED' : 'HELD'} (tCO₂)
      </div>
      <div className="pt-meta-val green">
        {activeTab === 'LISTED'
          ? safeNum(credit.listedCredits).toLocaleString()
          : safeNum(credit.heldCredits ?? credit.credits).toLocaleString()}
      </div>
    </div>
    <div className="pt-meta-cell">
      <div className="pt-meta-label">VINTAGE</div>
      <div className="pt-meta-val">{credit.vintageYear || '—'}</div>
    </div>
    {!credit.isPending && (
      <div className="pt-meta-cell">
        <div className="pt-meta-label">REF. PRICE</div>
        <div className="pt-meta-val">₹{refPrice.toLocaleString()}</div>
      </div>
    )}
    {credit.expiryDate && (
      <div className="pt-meta-cell"
        style={{ borderColor:expired?'#f8717122':expiryUrgent?'#f59e0b22':undefined }}>
        <div className="pt-meta-label">EXPIRY</div>
        <div className="pt-meta-val"
          style={{ color:expired?'#f87171':expiryUrgent?'#f59e0b':'#f0fdf4', fontSize:11 }}>
          {new Date(credit.expiryDate).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}
          {daysLeft !== null && daysLeft > 0 && (
            <span style={{ fontSize:9, marginLeft:4, opacity:.6 }}>({daysLeft}d)</span>
          )}
        </div>
      </div>
    )}
    <div className="pt-meta-cell pt-meta-full" style={{ borderBottom:'none' }}>
      <div className="pt-meta-label">SERIAL NO.</div>
      <div className="pt-meta-val blue" style={{ fontSize:10 }}>
        {sanitise(credit.serialNumber || '—')}
      </div>
    </div>
  </div>

  <div className="pt-card-actions">
    {credit.isRejected ? (
      <>
        <button className="pt-act-btn"
          onClick={() => {
            setForm({
              ...emptyForm,
              projectName : credit.projectName,
              location    : credit.location,
              country     : credit.country,
              standard    : credit.standard,
              projectType : credit.projectType,
              developer   : credit.developer,
              credits     : String(credit.credits),
              vintageYear : String(credit.vintageYear),
              serialNumber: credit.serialNumber,
            });
            setShowForm(true);
          }}
          style={{ background:'#060e18', borderColor:'#60a5fa44', color:'#93c5fdaa' }}>
          ↺ RESUBMIT
        </button>
        <button className="pt-act-btn cancel"
          onClick={() => handleCancelSubmission(credit.id)}>
          ✕ DELETE
        </button>
      </>
    ) : credit.isPending ? (
      <>
        <button className="pt-act-btn" disabled
          style={{ color:'#f59e0b44', borderColor:'#f59e0b11', background:'#0e0900', flex:2 }}>
          ⏳ AWAITING APPROVAL
        </button>
        <button className="pt-act-btn cancel"
          onClick={() => handleCancelSubmission(credit.id)}>
          ✕ CANCEL
        </button>
      </>
    ) : credit.status !== 'RETIRED' ? (
      <>
        {activeTab === 'LISTED'
          ? can('portfolio:list')
            ? <button className="pt-act-btn delist"
                onClick={() => { setShowDelist(credit); setDelistQty(String(credit.listedCredits)); }}
                disabled={loading.tx}>
                DELIST
              </button>
            : <LockedAction label="DELIST" reason="Manager role required"/>
          : <>
              {can('portfolio:list')
                ? <button className="pt-act-btn sell"
                    onClick={() => {
                      setShowList(credit);
                      setListPrice(String(refPrice));
                      setListQty(String(credit.heldCredits ?? credit.credits));
                      setListPriceWarn('');
                    }}
                    disabled={loading.tx || !isMinted}
                    title={!isMinted ? 'Credit not yet minted on-chain' : undefined}>
                    LIST
                  </button>
                : <LockedAction label="LIST" reason="Manager role required"/>
              }
              <button className="pt-act-btn market"
                onClick={() => navigate('/carbon-credits')} disabled={loading.tx}>
                MARKET
              </button>
              {can('portfolio:retire')
                ? <button className="pt-act-btn retire"
                    onClick={() => setShowRetire(credit)}
                    disabled={loading.tx || !isMinted}
                    title={!isMinted ? 'Credit not yet minted on-chain' : undefined}>
                    🔥 RETIRE
                  </button>
                : <LockedAction label="RETIRE" reason="Admin role required"/>
              }
            </>
        }
      </>
    ) : (
      <>
        <button className="pt-act-btn cert" onClick={() => setShowCert(credit)}>
          📜 CERTIFICATE
        </button>
        <a href={`https://sepolia.etherscan.io/address/${walletAddress}`}
          target="_blank" rel="noreferrer noopener"
          className="pt-act-btn market"
          style={{ textDecoration:'none', display:'flex', alignItems:'center',
            justifyContent:'center' }}>
          ETHERSCAN ↗
        </a>
      </>
    )}
  </div>

</article>
                  );
                })}
              </div>
            </ErrorBoundary>
          )}

          {section === 'ANALYTICS' && (
            <ErrorBoundary>
              {can('portfolio:read')
                ? <PortfolioAnalytics allCredits={allCredits} myRetirements={myRetirements}/>
                : <div style={{ padding:40, textAlign:'center', color:'#86efac33', fontSize:11 }}>
                    🔒 Analytics requires portfolio read access
                  </div>
              }
            </ErrorBoundary>
          )}

          {section === 'AUDIT' && (
            <ErrorBoundary>
              {can('portfolio:read')
                ? <AuditTrailPanel orgId={org?.id}/>
                : <div style={{ padding:40, textAlign:'center', color:'#86efac33', fontSize:11 }}>
                    🔒 Audit log requires portfolio read access
                  </div>
              }
            </ErrorBoundary>
          )}
        </div>
      </div>

{bulkMode && selectedCards.size > 0 && !bulkProgress && (
  <div style={{ position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)',
    zIndex:4000, background:'#070c09', border:'1px solid #22c55e33',
    borderRadius:12, padding:'14px 20px', display:'flex', alignItems:'center',
    gap:12, boxShadow:'0 8px 32px rgba(0,0,0,.8)', flexWrap:'wrap' }}>
    <div style={{ fontSize:11, color:'#86efac88', fontFamily:'DM Mono,monospace' }}>
      <span style={{ color:'#22c55e', fontWeight:700 }}>{selectedCards.size}</span> credits selected
    </div>
    <div style={{ width:1, height:20, background:'#0d1f11' }}/>

    {can('portfolio:list') && (
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <input
          type="number" min="1" placeholder="₹ price"
          value={bulkPrice}
          onChange={e => setBulkPrice(e.target.value)}
          style={{ width:100, padding:'7px 10px', borderRadius:6,
            border:'1px solid #1a2e1a', background:'#040706', color:'#f0fdf4',
            fontFamily:'DM Mono,monospace', fontSize:10, outline:'none' }}/>
        <button onClick={handleBulkList} disabled={!bulkPrice || loading.tx}
          style={{ padding:'8px 14px', borderRadius:6, cursor:'pointer',
            fontFamily:'DM Mono,monospace', fontSize:10, fontWeight:700,
            border:'1px solid #facc1544', background:'#0e1200', color:'#fde04799',
            opacity:!bulkPrice?0.4:1 }}>
          📈 LIST ALL
        </button>
      </div>
    )}

    {can('portfolio:retire') && (
      <button onClick={handleBulkRetire} disabled={loading.tx}
        style={{ padding:'8px 14px', borderRadius:6, cursor:'pointer',
          fontFamily:'DM Mono,monospace', fontSize:10, fontWeight:700,
          border:'1px solid #f8717144', background:'#0e0505', color:'#fca5a599' }}>
        🔥 RETIRE ALL
      </button>
    )}

    <button onClick={clearBulkMode}
      style={{ padding:'8px 12px', borderRadius:6, cursor:'pointer',
        fontFamily:'DM Mono,monospace', fontSize:10,
        border:'1px solid #86efac22', background:'transparent', color:'#86efac44' }}>
      ✕ CANCEL
    </button>
  </div>
)}

{bulkProgress && (
  <div style={{ position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)',
    zIndex:4000, background:'#070c09', border:'1px solid #22c55e33',
    borderRadius:12, padding:'16px 24px', minWidth:320,
    boxShadow:'0 8px 32px rgba(0,0,0,.8)' }}>
    <div style={{ fontSize:11, color:'#86efac88', fontFamily:'DM Mono,monospace',
      marginBottom:10, letterSpacing:'.08em' }}>
      {bulkProgress.status === 'done'
        ? `✓ DONE — ${bulkProgress.done} succeeded · ${bulkProgress.failed} failed`
        : `${bulkProgress.status === 'listing' ? '📈 LISTING' : '🔥 RETIRING'} ${bulkProgress.done + bulkProgress.failed} / ${bulkProgress.total}…`
      }
    </div>
    <div style={{ height:4, background:'#0d1f11', borderRadius:2, overflow:'hidden' }}>
      <div style={{
        height:'100%', borderRadius:2,
        background: bulkProgress.failed > 0 ? '#f97316' : '#22c55e',
        width:`${((bulkProgress.done + bulkProgress.failed) / bulkProgress.total) * 100}%`,
        transition:'width .3s ease'
      }}/>
    </div>
    {bulkProgress.status === 'done' && (
      <button onClick={clearBulkMode}
        style={{ marginTop:10, width:'100%', padding:'8px', borderRadius:6,
          border:'1px solid #22c55e33', background:'#0d2e1f', color:'#22c55e',
          cursor:'pointer', fontFamily:'DM Mono,monospace', fontSize:10, fontWeight:700 }}>
        CLOSE
      </button>
    )}
  </div>
)}

      {txPending && (
        <div className="pt-tx-banner" role="status" aria-live="polite">
          <div className="pt-spinner" aria-hidden="true"/>
          {txPending}
        </div>
      )}

      {showForm && (
        <div role="dialog" aria-modal="true" aria-label="Submit Carbon Credit"
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.88)',
            backdropFilter:'blur(6px)', zIndex:3000, display:'flex',
            alignItems:'center', justifyContent:'center', padding:24 }}
          onClick={e => e.target===e.currentTarget && !submitting && setShowForm(false)}>
          <div style={{ background:'#070c09', border:'1px solid #0d1f11', borderRadius:16,
            width:'100%', maxWidth:580, maxHeight:'90vh', overflowY:'auto' }}>
            <div style={{ padding:'20px 24px', borderBottom:'1px solid #0d1f11',
              display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:14, fontWeight:700, color:'#f0fdf4', letterSpacing:'.1em' }}>
                ⊕ SUBMIT CARBON CREDIT
              </span>
              <button aria-label="Close form" onClick={() => !submitting && setShowForm(false)}
                style={{ background:'none', border:'none', color:'#86efac44', cursor:'pointer', fontSize:18 }}>
                ✕
              </button>
            </div>
            <div style={{ padding:24 }}>
              {creditLimitReached && (
                <div role="alert" style={{ padding:'10px 14px', background:'#110a00',
                  border:'1px solid #f9731633', borderRadius:8, fontSize:10,
                  color:'#f97316', marginBottom:16 }}>
                  🔒 Credit limit reached for {planLimit.label} plan. Upgrade to add more credits.
                </div>
              )}
              <div style={{ fontSize:10, color:'#f59e0b88', marginBottom:20, padding:'10px 12px',
                background:'#110a00', borderRadius:6, border:'1px solid #f59e0b22', lineHeight:1.7 }}>
                ⏳ Reviewed within <strong style={{ color:'#f59e0b' }}>1–2 business days</strong>.
              </div>

              <div className="pt-form-grid">
                <div className="pt-field pt-form-full">
                  <label htmlFor="f-projectName" className="pt-label">PROJECT NAME *</label>
                  <input id="f-projectName" className={`pt-input${formErrors.projectName?' err':''}`}
                    placeholder="e.g. Sundarbans Mangrove Restoration"
                    value={form.projectName}
                    onChange={e => setForm(f => ({ ...f, projectName:e.target.value.slice(0,255) }))}/>
                  {formErrors.projectName && <span className="pt-err" role="alert">{formErrors.projectName}</span>}
                </div>

                <div className="pt-field">
                  <label htmlFor="f-pincode" className="pt-label">PINCODE (AUTO-FILL)</label>
                  <input id="f-pincode" className="pt-input" placeholder="e.g. 422013"
                    maxLength={6} inputMode="numeric"
                    value={form.pincode || ''}
                    onChange={e => handlePincode(e.target.value.replace(/\D/g,''))}/>
                  {pincodeLoading && <span style={{ fontSize:9, color:'#60a5fa88' }}>⟳ Detecting…</span>}
                  {pincodeError  && <span className="pt-err" role="alert">{pincodeError}</span>}
                </div>

                <div className="pt-field">
                  <label htmlFor="f-location" className="pt-label">LOCATION *</label>
                  <input id="f-location" className={`pt-input${formErrors.location?' err':''}`}
                    placeholder="e.g. Igatpuri, Nashik, Maharashtra"
                    value={form.location}
                    onChange={e => setForm(f => ({ ...f, location:e.target.value.slice(0,255) }))}/>
                  {formErrors.location && <span className="pt-err" role="alert">{formErrors.location}</span>}
                </div>

                <div className="pt-field">
                  <label htmlFor="f-country" className="pt-label">COUNTRY *</label>
                  <input id="f-country" className={`pt-input${formErrors.country?' err':''}`}
                    placeholder="e.g. India"
                    value={form.country}
                    onChange={e => setForm(f => ({ ...f, country:e.target.value.slice(0,100) }))}/>
                  {formErrors.country && <span className="pt-err" role="alert">{formErrors.country}</span>}
                </div>

                <div className="pt-field">
                  <label htmlFor="f-standard" className="pt-label">REGISTRY / STANDARD *</label>
                  <select id="f-standard" className="pt-input"
                    value={form.standard}
                    onChange={e => setForm(f => ({ ...f, standard:e.target.value, sdgTags:[] }))}>
                    <option value="VCS">VCS — Verra</option>
                    <option value="GS">GS — Gold Standard</option>
                    <option value="CDM">CDM — Clean Dev. Mechanism</option>
                    <option value="ACR">ACR — American Carbon Registry</option>
                    <option value="BEE">BEE — India CCTS</option>
                  </select>
                </div>

                <div className="pt-field">
                  <label htmlFor="f-projectId" className="pt-label">PROJECT ID *</label>
                  <input id="f-projectId" className={`pt-input${formErrors.projectId?' err':''}`}
                    placeholder="e.g. VCS-1234"
                    value={form.projectId}
                    onChange={e => setForm(f => ({ ...f, projectId:e.target.value.slice(0,100) }))}/>
                  {formErrors.projectId && <span className="pt-err" role="alert">{formErrors.projectId}</span>}
                </div>

                <div className="pt-field">
                  <label htmlFor="f-projectType" className="pt-label">PROJECT TYPE *</label>
                  <select id="f-projectType" className={`pt-input${formErrors.projectType?' err':''}`}
                    value={form.projectType}
                    onChange={e => setForm(f => ({ ...f, projectType:e.target.value }))}>
                    <option value="">Select type</option>
                    <optgroup label="── BEE India CCTS ──">
                      {PROJECT_TYPES.filter(t => t.includes('(BEE)')).map(t =>
                        <option key={t} value={t}>{t}</option>
                      )}
                    </optgroup>
                    <optgroup label="── Global VCM ──">
                      {PROJECT_TYPES.filter(t => !t.includes('(BEE)')).map(t =>
                        <option key={t} value={t}>{t}</option>
                      )}
                    </optgroup>
                  </select>
                  {formErrors.projectType && <span className="pt-err" role="alert">{formErrors.projectType}</span>}
                </div>

                <div className="pt-field pt-form-full">
                  <label htmlFor="f-developer" className="pt-label">PROJECT DEVELOPER *</label>
                  <input id="f-developer" className={`pt-input${formErrors.developer?' err':''}`}
                    placeholder="Organization name"
                    value={form.developer}
                    onChange={e => setForm(f => ({ ...f, developer:e.target.value.slice(0,255) }))}/>
                  {formErrors.developer && <span className="pt-err" role="alert">{formErrors.developer}</span>}
                </div>

                <div className="pt-field">
                  <label htmlFor="f-credits" className="pt-label">QUANTITY (tCO₂) *</label>
                  <input id="f-credits" type="number" min="1" max="10000000"
                    className={`pt-input${formErrors.credits?' err':''}`}
                    placeholder="e.g. 500" value={form.credits}
                    onChange={e => setForm(f => ({ ...f, credits:e.target.value }))}/>
                  {formErrors.credits && <span className="pt-err" role="alert">{formErrors.credits}</span>}
                </div>

                <div className="pt-field">
                  <label htmlFor="f-vintageYear" className="pt-label">VINTAGE YEAR *</label>
                  <input id="f-vintageYear" type="number" min="1990"
                    max={new Date().getFullYear()}
                    className={`pt-input${formErrors.vintageYear?' err':''}`}
                    placeholder={String(new Date().getFullYear()-1)}
                    value={form.vintageYear}
                    onChange={e => setForm(f => ({ ...f, vintageYear:e.target.value }))}/>
                  {formErrors.vintageYear && <span className="pt-err" role="alert">{formErrors.vintageYear}</span>}
                  {form.vintageYear && !isNaN(form.vintageYear) && (
                    <span style={{ fontSize:9, color:vintagePenalty(+form.vintageYear)>0?'#facc1566':'#22c55e66' }}>
                      {vintagePenalty(+form.vintageYear) > 0
                        ? `↓ ${vintagePenalty(+form.vintageYear)}% vintage depreciation`
                        : '✓ No depreciation'}
                    </span>
                  )}
                </div>

                <div className="pt-field">
                  <label htmlFor="f-expiryDate" className="pt-label">EXPIRY DATE *</label>
                  <input id="f-expiryDate" type="date"
                    className={`pt-input${formErrors.expiryDate?' err':''}`}
                    min={new Date().toISOString().slice(0,10)}
                    value={form.expiryDate}
                    onChange={e => setForm(f => ({ ...f, expiryDate:e.target.value }))}/>
                  {formErrors.expiryDate && <span className="pt-err" role="alert">{formErrors.expiryDate}</span>}
                </div>

                <div className="pt-field pt-form-full">
                  <label htmlFor="f-serialNumber" className="pt-label">SERIAL / CERTIFICATE NUMBER *</label>
                  <input id="f-serialNumber"
                    className={`pt-input${formErrors.serialNumber?' err':''}`}
                    placeholder="e.g. VCS-2023-IN-00412"
                    value={form.serialNumber}
                    onChange={e => setForm(f => ({ ...f, serialNumber:e.target.value.slice(0,200) }))}/>
                  {formErrors.serialNumber && <span className="pt-err" role="alert">{formErrors.serialNumber}</span>}
                </div>

                <div className="pt-field">
                  <label htmlFor="f-methodologyId" className="pt-label">METHODOLOGY ID</label>
                  <input id="f-methodologyId" className="pt-input"
                    placeholder="e.g. VM0047"
                    value={form.methodologyId}
                    onChange={e => setForm(f => ({ ...f, methodologyId:e.target.value.slice(0,100) }))}/>
                </div>

                <div className="pt-field">
                  <label htmlFor="f-registryLink" className="pt-label">REGISTRY LINK</label>
                  <input id="f-registryLink"
                    className={`pt-input${formErrors.registryLink?' err':''}`}
                    placeholder="https://registry.verra.org/..."
                    value={form.registryLink}
                    onChange={e => setForm(f => ({ ...f, registryLink:e.target.value.slice(0,500) }))}/>
                  {formErrors.registryLink && <span className="pt-err" role="alert">{formErrors.registryLink}</span>}
                </div>

                <div className="pt-section-divider">COMPLIANCE & SDG</div>

                <div className="pt-field pt-form-full">
                  <p className="pt-label">CREDIT TYPE</p>
                  <div role="group" aria-label="Credit type"
                    style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                    {CREDIT_TYPES.map(ct => (
                      <button key={ct.value} type="button" aria-pressed={form.creditType===ct.value}
                        onClick={() => setForm(f => ({ ...f, creditType:ct.value }))}
                        style={{ padding:'10px 12px', borderRadius:8, textAlign:'left',
                          border:`1px solid ${form.creditType===ct.value?ct.color+'66':'#0d1f11'}`,
                          background:form.creditType===ct.value?`${ct.color}11`:'#060a07',
                          cursor:'pointer' }}>
                        <div style={{ fontSize:11, color:form.creditType===ct.value?ct.color:'#86efac44', fontWeight:700 }}>
                          {ct.label}
                        </div>
                        <div style={{ fontSize:9, color:'#86efac22' }}>{ct.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-field pt-form-full">
                  <p className="pt-label">
                    SDG CO-BENEFITS
                    {form.standard === 'GS' && <span style={{ color:'#f59e0b' }}> — REQUIRED FOR GOLD STANDARD</span>}
                  </p>
                  <div className="pt-sdg-grid" role="group" aria-label="SDG tags">
                    {SDG_OPTIONS.map(s => (
                      <button key={s.id} type="button"
                        aria-pressed={form.sdgTags.includes(s.id)}
                        className={`pt-sdg-tag${form.sdgTags.includes(s.id)?' on':''}`}
                        onClick={() => toggleSdg(s.id)}>
                        <div style={{ fontWeight:700, marginBottom:2 }}>SDG {s.id}</div>
                        <div style={{ fontSize:8, opacity:.7 }}>{s.label}</div>
                      </button>
                    ))}
                  </div>
                  {formErrors.sdgTags && <span className="pt-err" role="alert">{formErrors.sdgTags}</span>}
                </div>

                <div className="pt-field pt-form-full">
                  <p className="pt-label">CBAM ELIGIBILITY (EU)</p>
                  <button type="button" className="pt-toggle"
                    aria-pressed={form.cbamEligible}
                    onClick={() => setForm(f => ({ ...f, cbamEligible:!f.cbamEligible }))}>
                    <div className={`pt-toggle-box${form.cbamEligible?' on':''}`} aria-hidden="true">
                      <div className="pt-toggle-knob"/>
                    </div>
                    <div style={{ fontSize:11, color:form.cbamEligible?'#60a5fa':'#86efac44' }}>
                      {form.cbamEligible ? '✓ CBAM Eligible — EU Article 7 compliant' : 'Not CBAM eligible'}
                    </div>
                  </button>
                </div>

                <div className="pt-field pt-form-full">
                  <label htmlFor="f-doc" className="pt-label">OWNERSHIP PROOF *</label>
                  <div className={`pt-upload-box${formErrors.docFile?' err':''}`}>
                    {form.docFile
                      ? <div style={{ fontSize:11, color:'#22c55e88' }}>✓ {form.docFile.name}</div>
                      : <>
                          <div style={{ fontSize:28, marginBottom:6 }}>📄</div>
                          <div style={{ fontSize:11, color:'#86efac33', marginBottom:4 }}>
                            Click to upload ownership proof
                          </div>
                          <div style={{ fontSize:9, color:'#86efac22' }}>
                            PDF, JPG, PNG — max {MAX_FILE_SIZE_MB}MB · Pinned to IPFS permanently
                          </div>
                        </>
                    }
                    <input id="f-doc" type="file" accept="image/*,.pdf"
                      aria-label="Upload ownership proof document"
                      style={{ position:'absolute', inset:0, opacity:0, cursor:'pointer' }}
                      onChange={e => {
                        const f = e.target.files[0];
                        if (!f) return;
                        if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
                          showToast(`File too large. Max ${MAX_FILE_SIZE_MB}MB.`, 'error');
                          return;
                        }
                        if (!['application/pdf','image/jpeg','image/png','image/webp'].includes(f.type)) {
                          showToast('Only PDF, JPG, PNG files are accepted.', 'error');
                          return;
                        }
                        setForm(prev => ({ ...prev, docFile:f }));
                      }}/>
                  </div>
                  {formErrors.docFile && <span className="pt-err" role="alert">{formErrors.docFile}</span>}
                </div>
              </div>
            </div>

            <div style={{ padding:'16px 24px', borderTop:'1px solid #0d1f11',
              display:'flex', gap:10, background:'#050809' }}>
              <button onClick={() => { setShowForm(false); setFormErrors({}); setForm(emptyForm); setPincodeError(''); }}
                disabled={submitting}
                style={{ flex:1, padding:'12px', borderRadius:8, border:'1px solid #0d1f11',
                  background:'#060a07', color:'#86efac66', cursor:submitting?'not-allowed':'pointer',
                  fontFamily:'DM Mono,monospace', fontSize:12 }}>
                CANCEL
              </button>
              <button onClick={handleRegister} disabled={submitting || creditLimitReached}
                style={{ flex:2, padding:'12px', borderRadius:8, border:'none',
                  background:'linear-gradient(135deg,#14532d,#166534)', color:'#d1fae5',
                  cursor:submitting||creditLimitReached?'not-allowed':'pointer',
                  fontFamily:'DM Mono,monospace', fontSize:12, fontWeight:700,
                  opacity:creditLimitReached?.4:1 }}>
                {submitting ? `⟳ ${txPending || 'SUBMITTING…'}` : 'SUBMIT FOR VERIFICATION →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRetire && (
        <RetireModal
          credit={showRetire}
          onConfirm={handleRetireConfirm}
          onClose={() => setShowRetire(null)}
          loading={loading.tx}
        />
      )}

      {retireSteps?.show && (
        <div role="dialog" aria-modal="true" aria-label="Retirement complete"
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.88)',
            backdropFilter:'blur(6px)', zIndex:3000, display:'flex',
            alignItems:'center', justifyContent:'center', padding:24 }}
          onClick={e => e.target===e.currentTarget && setRetireSteps(null)}>
          <div style={{ background:'#070c09', border:'1px solid #0d1f11', borderRadius:16,
            width:'100%', maxWidth:480 }}>
            <div style={{ padding:'20px 24px', borderBottom:'1px solid #0d1f11' }}>
              <span style={{ fontSize:14, fontWeight:700, color:'#f0fdf4' }}>🌿 RETIREMENT COMPLETE</span>
            </div>
            <div style={{ padding:24 }}>
              {[
                `${Number(retireSteps.qty).toLocaleString()} tCO₂e permanently burned on Ethereum Sepolia`,
                `Certificate ${retireSteps.certId} issued`,
                `Offset recorded — Scope ${retireSteps.scope} · ${retireSteps.corporateData?.reportingStandard||'GHG Protocol'}`,
              ].map((label, i) => (
                <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:12,
                  padding:'12px 14px', borderRadius:8, marginBottom:8,
                  background:'#051409', border:'1px solid #22c55e22' }}>
                  <div style={{ width:22, height:22, borderRadius:'50%', background:'#0d2e1f',
                    border:'1px solid #22c55e44', display:'flex', alignItems:'center',
                    justifyContent:'center', flexShrink:0, fontSize:11, color:'#22c55e' }}>✓</div>
                  <span style={{ fontSize:11, color:'#86efac88', lineHeight:1.6 }}>{label}</span>
                </div>
              ))}
              {retireSteps.txHash && (
                <div style={{ marginTop:12, padding:'10px 14px', background:'#060e18',
                  border:'1px solid #60a5fa22', borderRadius:8 }}>
                  <div style={{ fontSize:8, color:'#60a5fa66', letterSpacing:'.12em', marginBottom:4 }}>
                    BLOCKCHAIN TX HASH
                  </div>
                  <a href={`https://sepolia.etherscan.io/tx/${retireSteps.txHash}`}
                    target="_blank" rel="noreferrer noopener"
                    style={{ fontSize:10, color:'#60a5fa', fontFamily:'monospace',
                      wordBreak:'break-all', textDecoration:'none' }}>
                    {retireSteps.txHash}
                  </a>
                </div>
              )}
            </div>
            <div style={{ padding:'16px 24px', borderTop:'1px solid #0d1f11',
              display:'flex', gap:10, background:'#050809' }}>
              <button onClick={() => setRetireSteps(null)}
                style={{ flex:1, padding:'12px', borderRadius:8, border:'1px solid #0d1f11',
                  background:'#060a07', color:'#86efac66', cursor:'pointer',
                  fontFamily:'DM Mono,monospace', fontSize:12 }}>
                CLOSE
              </button>
              <button onClick={() => {
                setShowCert({
                  ...retireSteps.credit,
                  txHash            : retireSteps.txHash,
                  retiredQty        : retireSteps.qty,
                  retireScope       : retireSteps.scope,
                  certId            : retireSteps.certId,
                  beneficiaryName   : retireSteps.corporateData?.beneficiaryName,
                  beneficiaryEntity : retireSteps.corporateData?.beneficiaryEntity,
                  beneficiaryGstin  : retireSteps.corporateData?.beneficiaryGstin,
                  reportingStandard : retireSteps.corporateData?.reportingStandard,
                  purpose           : retireSteps.corporateData?.purpose,
                });
                setRetireSteps(null);
              }}
                style={{ flex:2, padding:'12px', borderRadius:8, border:'none',
                  background:'linear-gradient(135deg,#14532d,#166534)', color:'#d1fae5',
                  cursor:'pointer', fontFamily:'DM Mono,monospace', fontSize:12, fontWeight:700 }}>
                📜 VIEW CERTIFICATE →
              </button>
            </div>
          </div>
        </div>
      )}

      {showList && (
        <div role="dialog" aria-modal="true" aria-label="List credit for sale"
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.88)',
            backdropFilter:'blur(6px)', zIndex:3000, display:'flex',
            alignItems:'center', justifyContent:'center', padding:24 }}
          onClick={e => e.target===e.currentTarget && setShowList(null)}>
          <div style={{ background:'#070c09', border:'1px solid #0d1f11', borderRadius:16,
            width:'100%', maxWidth:440 }}>
            <div style={{ padding:'20px 24px', borderBottom:'1px solid #0d1f11',
              display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:13, fontWeight:700, color:'#f0fdf4' }}>LIST FOR SALE</span>
              <button aria-label="Close" onClick={() => setShowList(null)}
                style={{ background:'none', border:'none', color:'#86efac44', cursor:'pointer', fontSize:18 }}>✕</button>
            </div>
            <div style={{ padding:24 }}>
              <div style={{ background:'#060a07', borderRadius:8, padding:'12px 14px',
                marginBottom:14, border:'1px solid #0d1f11' }}>
                <div style={{ fontSize:12, color:'#f0fdf4', fontWeight:700, marginBottom:4 }}>
                  {sanitise(showList.projectName)}
                </div>
                <div style={{ fontSize:10, color:'#86efac44' }}>
                  {Number(showList.credits).toLocaleString()} tCO₂ · {showList.standard} · Vintage {showList.vintageYear}
                </div>
              </div>

              <div style={{ marginBottom:14 }}>
                <label htmlFor="list-qty" style={{ fontSize:9, color:'#86efac88',
                  letterSpacing:'.12em', display:'block', marginBottom:6 }}>
                  QUANTITY TO LIST
                </label>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <input type="range" min="1" max={showList.credits} step="1"
                    aria-label="Quantity slider"
                    value={listQty || showList.credits}
                    onChange={e => setListQty(e.target.value)}
                    style={{ flex:1, accentColor:'#22c55e', cursor:'pointer' }}/>
                  <input id="list-qty" type="number" min="1" max={showList.credits}
                    value={listQty || showList.credits}
                    onChange={e => setListQty(Math.min(showList.credits, Math.max(1, parseInt(e.target.value,10)||1)))}
                    style={{ width:80, padding:'8px 10px', borderRadius:6, border:'1px solid #0d1f11',
                      background:'#040706', color:'#f0fdf4', fontFamily:'DM Mono,monospace',
                      fontSize:11, outline:'none' }}/>
                </div>
              </div>

              <div style={{ marginBottom:8 }}>
                <label htmlFor="list-price" style={{ fontSize:9, color:'#86efac88',
                  letterSpacing:'.12em', display:'block', marginBottom:6 }}>
                  ASKING PRICE PER CREDIT (₹)
                </label>
                <input id="list-price" type="number" min="1" placeholder="e.g. 850"
                  value={listPrice}
                  onChange={e => handleListPriceChange(e.target.value, showList)}
                  style={{ width:'100%', padding:'10px 12px', borderRadius:7, border:'1px solid #1a2e1a',
                    background:'#040706', color:'#f0fdf4', fontFamily:'DM Mono,monospace',
                    fontSize:12, outline:'none' }}/>
                <span style={{ fontSize:9, color:'#86efac22', marginTop:4, display:'block' }}>
                  Suggested: ₹{getReferencePrice(showList.projectType, showList.standard, showList.vintageYear, showList.creditType, marketBuckets).toLocaleString()}
                </span>
              </div>

              {listPriceWarn && (
                <div role="alert" style={{ padding:'8px 12px', background:'#110a00',
                  border:'1px solid #f59e0b22', borderRadius:6, marginBottom:10,
                  fontSize:9, color:'#f59e0b88' }}>
                  {listPriceWarn}
                </div>
              )}

              {listPrice && !isNaN(listPrice) && safeNum(listPrice) > 0 && (
                <div style={{ background:'#040706', borderRadius:6, padding:'10px 12px',
                  fontSize:10, color:'#86efac66', border:'1px solid #0d1f11', marginTop:10 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                    <span>Listing value</span>
                    <span style={{ color:'#22c55e88' }}>
                      ₹{(safeNum(listPrice) * (parseInt(listQty,10)||showList.credits)).toLocaleString()}
                    </span>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between' }}>
                    <span>On-chain price</span>
                    <span style={{ color:'#60a5fa66' }}>
                      {(safeNum(listPrice) / (ethPriceInr||210000)).toFixed(6)} ETH/credit
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div style={{ padding:'16px 24px', borderTop:'1px solid #0d1f11',
              display:'flex', gap:10, background:'#050809' }}>
              <button onClick={() => { setShowList(null); setListPriceWarn(''); }}
                style={{ flex:1, padding:'12px', borderRadius:8, border:'1px solid #0d1f11',
                  background:'#060a07', color:'#86efac66', cursor:'pointer',
                  fontFamily:'DM Mono,monospace', fontSize:12 }}>
                CANCEL
              </button>
              <button onClick={() => handleListForSale(showList)} disabled={loading.tx}
                style={{ flex:2, padding:'12px', borderRadius:8, border:'none',
                  background:'linear-gradient(135deg,#14532d,#166534)', color:'#d1fae5',
                  cursor:loading.tx?'not-allowed':'pointer',
                  fontFamily:'DM Mono,monospace', fontSize:12, fontWeight:700 }}>
                {loading.tx ? '⟳ LISTING…' : 'LIST ON MARKETPLACE →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCert && (
        <div role="dialog" aria-modal="true" aria-label="Retirement certificate"
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.88)',
            backdropFilter:'blur(6px)', zIndex:3000, display:'flex',
            alignItems:'center', justifyContent:'center', padding:24 }}
          onClick={e => e.target===e.currentTarget && setShowCert(null)}>
          <div style={{ background:'#070c09', border:'1px solid #0d1f11', borderRadius:16,
            width:'100%', maxWidth:680, maxHeight:'90vh', overflowY:'auto' }}>
            <div style={{ padding:'20px 24px', borderBottom:'1px solid #0d1f11',
              display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:14, fontWeight:700, color:'#f0fdf4' }}>📜 RETIREMENT CERTIFICATE</span>
              <button aria-label="Close" onClick={() => setShowCert(null)}
                style={{ background:'none', border:'none', color:'#86efac44', cursor:'pointer', fontSize:18 }}>✕</button>
            </div>
            <div style={{ padding:24 }}>
              <RetirementCertificate
                credit={showCert}
                txHash={showCert.txHash}
                onClose={() => setShowCert(null)}
              />
            </div>
          </div>
        </div>
      )}


      {showDelist && (
  <div role="dialog" aria-modal="true" aria-label="Delist credits"
    style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.88)',
      backdropFilter:'blur(6px)', zIndex:3000, display:'flex',
      alignItems:'center', justifyContent:'center', padding:24 }}
    onClick={e => e.target===e.currentTarget && setShowDelist(null)}>
    <div style={{ background:'#070c09', border:'1px solid #0d1f11', borderRadius:16,
      width:'100%', maxWidth:420 }}>
      <div style={{ padding:'20px 24px', borderBottom:'1px solid #0d1f11',
        display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <span style={{ fontSize:13, fontWeight:700, color:'#f0fdf4' }}>DELIST CREDITS</span>
        <button aria-label="Close" onClick={() => setShowDelist(null)}
          style={{ background:'none', border:'none', color:'#86efac44', cursor:'pointer', fontSize:18 }}>✕</button>
      </div>
      <div style={{ padding:24 }}>
        <div style={{ background:'#060a07', borderRadius:8, padding:'12px 14px',
          marginBottom:16, border:'1px solid #0d1f11' }}>
          <div style={{ fontSize:12, color:'#f0fdf4', fontWeight:700, marginBottom:4 }}>
            {sanitise(showDelist.projectName)}
          </div>
          <div style={{ fontSize:10, color:'#86efac44' }}>
            {Number(showDelist.listedCredits).toLocaleString()} tCO₂ currently listed
          </div>
        </div>

        <div style={{ marginBottom:16 }}>
          <label htmlFor="delist-qty" style={{ fontSize:9, color:'#86efac88',
            letterSpacing:'.12em', display:'block', marginBottom:6 }}>
            QUANTITY TO DELIST
          </label>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <input type="range" min="1" max={showDelist.listedCredits} step="1"
              value={delistQty || showDelist.listedCredits}
              onChange={e => setDelistQty(e.target.value)}
              style={{ flex:1, accentColor:'#f97316', cursor:'pointer' }}/>
            <input id="delist-qty" type="number" min="1" max={showDelist.listedCredits}
              value={delistQty}
              onChange={e => setDelistQty(Math.min(showDelist.listedCredits, Math.max(1, Number(e.target.value))))}
              style={{ width:80, padding:'8px 10px', borderRadius:6, border:'1px solid #0d1f11',
                background:'#040706', color:'#f0fdf4', fontFamily:'DM Mono,monospace',
                fontSize:11, outline:'none' }}/>
          </div>
        </div>

        <div style={{ background:'#040706', borderRadius:6, padding:'10px 12px',
          fontSize:10, color:'#86efac66', border:'1px solid #0d1f11' }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
            <span>Delisting</span>
            <span style={{ color:'#f97316' }}>{Number(delistQty||showDelist.listedCredits).toLocaleString()} tCO₂</span>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <span>Remaining listed</span>
            <span style={{ color:'#facc15' }}>
              {(showDelist.listedCredits - Number(delistQty||showDelist.listedCredits)).toLocaleString()} tCO₂
            </span>
          </div>
        </div>
      </div>

      <div style={{ padding:'16px 24px', borderTop:'1px solid #0d1f11',
        display:'flex', gap:10, background:'#050809' }}>
        <button onClick={() => { setShowDelist(null); setDelistQty(''); }}
          style={{ flex:1, padding:'12px', borderRadius:8, border:'1px solid #0d1f11',
            background:'#060a07', color:'#86efac66', cursor:'pointer',
            fontFamily:'DM Mono,monospace', fontSize:12 }}>
          CANCEL
        </button>
        <button
          onClick={() => handleDelist(showDelist, Number(delistQty))}
          disabled={loading.tx}
          style={{ flex:2, padding:'12px', borderRadius:8, border:'1px solid #f9731644',
            background:'#0e0800', color:'#fdba74', cursor:loading.tx?'not-allowed':'pointer',
            fontFamily:'DM Mono,monospace', fontSize:12, fontWeight:700 }}>
          {loading.tx ? '⟳ DELISTING…'
            : Number(delistQty) === showDelist.listedCredits
              ? 'DELIST ALL →'
              : `DELIST ${Number(delistQty).toLocaleString()} CREDITS →`}
        </button>
      </div>
    </div>
  </div>
)}

{selectedCard && (() => {
  const c         = selectedCard;
  const reg       = REGISTRIES[c.standard] || REGISTRIES.VCS;
  const dep       = vintagePenalty(c.vintageYear);
  // [FIX-SHARED-PRICING] Always compute refPrice from current market data
  // via the shared getMarketPrice. Purchase price (c.pricePerCredit) is
  // shown separately in the "BOUGHT AT" field of the P&L box below.
  const refPrice  = getReferencePrice(c.projectType, c.standard, c.vintageYear, c.creditType, marketBuckets);
  // [FIX-DEMAND-BADGE] Live demand/supply signal shown as MARKET SIGNAL row
  const demandBadge = getDemandSupplyBadge(c.projectType, c.standard, marketBuckets);
  const ctMeta    = CREDIT_TYPES.find(t => t.value === (c.creditType||'voluntary')) || CREDIT_TYPES[0];
  const daysLeft  = getDaysUntilExpiry(c.expiryDate);
  const expired   = daysLeft !== null && daysLeft <= 0;
  const expiryUrgent = daysLeft !== null && daysLeft <= 90 && daysLeft > 0;
  const isMinted  = c.isOnChain !== false && c.tokenId != null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Credit metadata"
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.88)',
        backdropFilter:'blur(6px)', zIndex:3000, display:'flex',
        alignItems:'center', justifyContent:'center', padding:24 }}
      onClick={e => e.target===e.currentTarget && setSelectedCard(null)}>
      <div style={{ background:'#070c09', border:'1px solid #0d1f11', borderRadius:16,
        width:'100%', maxWidth:620, maxHeight:'90vh', overflowY:'auto' }}>

        <div style={{ padding:'20px 24px', borderBottom:'1px solid #0d1f11',
          display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12 }}>
          <div>
            <div style={{ fontSize:9, color:'#86efac55', letterSpacing:'.14em', marginBottom:4 }}>
              CREDIT METADATA
            </div>
            <div style={{ fontSize:15, fontWeight:700, color:'#f0fdf4', lineHeight:1.3 }}>
              {sanitise(c.projectName)}
            </div>
            <div style={{ fontSize:10, color:'#86efac66', marginTop:3 }}>
              📍 {sanitise(c.location||c.country||'—')}
            </div>
          </div>
          <button aria-label="Close" onClick={() => setSelectedCard(null)}
            style={{ background:'none', border:'none', color:'#86efac44',
              cursor:'pointer', fontSize:20, flexShrink:0 }}>✕</button>
        </div>

        <div style={{ padding:24 }}>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:16 }}>
            {[
              { label:'TOKEN ID',      value: isMinted ? (c.tokenHex||c.tokenId) : '⏳ Pending',     color:'#60a5fa'    },
              { label:'SERIAL NO.',    value: c.serialNumber || '—',                                  color:'#60a5fa'    },
              { label:'PROJECT ID',    value: c.projectId    || '—',                                  color:'#86efac88'  },
              { label:'HELD (tCO₂)',   value: safeNum(c.heldCredits??c.credits).toLocaleString(),     color:'#22c55e'    },
              { label:'LISTED (tCO₂)', value: safeNum(c.listedCredits||0).toLocaleString(),           color:'#facc15'    },
              { label:'RETIRED (tCO₂)',value: safeNum(c.totalRetired||0).toLocaleString(),            color:'#a78bfa'    },
              { label:'VINTAGE',       value: c.vintageYear || '—',                                   color:'#f0fdf4'    },
              { label:'REF. PRICE',    value: `₹${refPrice.toLocaleString()}`,                        color:'#f0fdf4'    },
              { label:'MARKET SIGNAL', value: demandBadge?.label || 'No data yet',                    color: demandBadge?.color || '#86efac33' },
              { label:'VINTAGE DEP.',  value: dep > 0 ? `↓${dep}%` : '✓ None',                       color: dep>0?'#facc1566':'#22c55e66' },
              { label:'EXPIRY',
                value: c.expiryDate
                  ? new Date(c.expiryDate).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})
                  : '—',
                color: expired?'#f87171':expiryUrgent?'#f59e0b':'#f0fdf4'
              },
              { label:'DAYS LEFT',
                value: daysLeft !== null && daysLeft > 0 ? `${daysLeft}d` : expired ? 'EXPIRED' : '—',
                color: expired?'#f87171':expiryUrgent?'#f59e0b':'#86efac88'
              },
              { label:'ON-CHAIN',
                value: isMinted ? '✓ Minted' : '⏳ Pending',
                color: isMinted?'#22c55e':'#60a5fa88'
              },
              { label:'DEVELOPER',     value: c.developer    || '—',   color:'#86efac88'  },
              { label:'PROJECT TYPE',  value: c.projectType  || '—',   color:'#86efac88'  },
              { label:'METHODOLOGY',   value: c.methodologyId|| '—',   color:'#60a5fa'    },
              { label:'STANDARD',      value: reg.label,                color: reg.color   },
              { label:'CREDIT TYPE',   value: ctMeta.label,             color: ctMeta.color},
              { label:'COUNTRY',       value: c.country      || '—',   color:'#86efac88'  },
              { label:'CBAM',
                value: c.cbamEligible ? '✓ EU CBAM Art.7' : 'Not eligible',
                color: c.cbamEligible?'#60a5fa':'#86efac33'
              },
              { label:'ICVCM CCP',
                value: c.icvcm_ccp_eligible
                  ? `✓ ${c.icvcm_ccp_label||'Eligible'}`
                  : 'Not eligible',
                color: c.icvcm_ccp_eligible?'#84cc16':'#86efac33'
              },
              { label:'ART.6 / CA',
                value: CA_OPTIONS.find(o=>o.value===(c.correspondingAdjustment||'none'))?.label||'None',
                color:'#86efac88'
              },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background:'#060a07', borderRadius:6,
                padding:'8px 10px', border:'1px solid #0d1f11' }}>
                <div style={{ fontSize:8, color:'#86efac44', letterSpacing:'.1em', marginBottom:3 }}>
                  {label}
                </div>
                <div style={{ fontSize:10, color, fontWeight:600,
                  whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}
                  title={String(value)}>
                  {sanitise(String(value))}
                </div>
              </div>
            ))}
          </div>

          {(c.sdg_tags||c.sdgTags||[]).length > 0 && (
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:9, color:'#86efac55', letterSpacing:'.14em', marginBottom:8 }}>
                SDG CO-BENEFITS
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                {(c.sdg_tags||c.sdgTags||[]).map(id => (
                  <span key={id} style={{ fontSize:9, padding:'3px 10px', borderRadius:3,
                    background:'#060e18', color:'#60a5fa88', border:'1px solid #60a5fa22' }}>
                    SDG {id} — {SDG_OPTIONS.find(s=>s.id===id)?.label||''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {c.isBought && c.pricePerCredit > 0 && (
            <div style={{ marginBottom:14, padding:'12px 14px', borderRadius:8,
              background: refPrice >= c.pricePerCredit ? '#051409' : '#0e0505',
              border:`1px solid ${refPrice >= c.pricePerCredit ? '#22c55e22' : '#f8717122'}` }}>
              <div style={{ fontSize:9, color:'#86efac55', letterSpacing:'.14em', marginBottom:8 }}>
                P&L THIS CREDIT
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
                {[
                  { label:'BOUGHT AT',     value:`₹${safeNum(c.pricePerCredit).toLocaleString()}`,  color:'#86efac88' },
                  { label:'CURRENT PRICE', value:`₹${refPrice.toLocaleString()}`,                   color:'#60a5fa'   },
                  { label:'UNREALISED P&L',
                    value:`${refPrice>=c.pricePerCredit?'+':''}₹${((refPrice-c.pricePerCredit)*safeNum(c.heldCredits??c.credits)).toLocaleString()}`,
                    color: refPrice>=c.pricePerCredit?'#22c55e':'#f87171'
                  },
                ].map(({label,value,color}) => (
                  <div key={label} style={{ background:'#040706', borderRadius:6,
                    padding:'8px 10px', border:'1px solid #0d1f11' }}>
                    <div style={{ fontSize:8, color:'#86efac44', letterSpacing:'.1em', marginBottom:3 }}>{label}</div>
                    <div style={{ fontSize:11, color, fontWeight:700 }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(c.registryLink || (reg.link && c.projectId && c.projectId !== '—')) && (
            <div style={{ marginBottom:14 }}>
              <a href={c.registryLink || `${reg.link}${c.projectId}`}
                target="_blank" rel="noreferrer noopener"
                style={{ fontSize:10, color:`${reg.color}88`, textDecoration:'none',
                  display:'inline-flex', alignItems:'center', gap:6, padding:'6px 14px',
                  borderRadius:6, border:`1px solid ${reg.color}22`, background:reg.bg }}>
                🔗 VIEW ON {c.standard} REGISTRY ↗
              </a>
            </div>
          )}

          {isMinted && (
            <div>
              <a href={`https://sepolia.etherscan.io/address/${walletAddress}`}
                target="_blank" rel="noreferrer noopener"
                style={{ fontSize:10, color:'#60a5fa88', textDecoration:'none',
                  display:'inline-flex', alignItems:'center', gap:6, padding:'6px 14px',
                  borderRadius:6, border:'1px solid #60a5fa22', background:'#060e18' }}>
                ⛓ VIEW ON ETHERSCAN ↗
              </a>
            </div>
          )}

        </div>

        <div style={{ padding:'14px 24px', borderTop:'1px solid #0d1f11',
          background:'#050809', display:'flex', justifyContent:'flex-end' }}>
          <button onClick={() => setSelectedCard(null)}
            style={{ padding:'9px 20px', borderRadius:7, border:'1px solid #22c55e33',
              background:'#0d2e1f', color:'#22c55e', cursor:'pointer',
              fontFamily:'DM Mono,monospace', fontSize:11, fontWeight:700 }}>
            CLOSE ✕
          </button>
        </div>

      </div>
    </div>
  );
})()}

      {toast && (
        <div role="status" aria-live="polite" className="pt-toast"
          style={{ border:`1px solid ${toast.type==='error'?'#f8717122':'#22c55e22'}`,
            color:toast.type==='error'?'#f8717199':'#22c55e88',
            animation:'slideIn .3s ease' }}>
          {toast.msg}
        </div>
      )}
    </>
  );
}