// src/components/TeamManagement.js — EtherTrack RBAC Team UI
import React, { useState, useEffect, useContext } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../App';
import { apiFetch } from '../services/api';
import { PERMISSIONS } from '../context/rbac';

const ROLE_META = {
  owner:   { color:'#f97316', bg:'#1a0a00', border:'#f9731633', label:'OWNER',   icon:'👑', desc:'Full control — billing, team, all data' },
  admin:   { color:'#f87171', bg:'#1a0707', border:'#f8717133', label:'ADMIN',   icon:'🛡', desc:'Manage team, approve credits, all data' },
  manager: { color:'#22c55e', bg:'#0d2e1f', border:'#22c55e33', label:'MANAGER', icon:'📊', desc:'Emissions + portfolio read/write, exports' },
  auditor: { color:'#a78bfa', bg:'#120a28', border:'#a78bfa33', label:'AUDITOR', icon:'🔍', desc:'Read-only + exports + verification badge' },
  viewer:  { color:'#60a5fa', bg:'#060e18', border:'#60a5fa33', label:'VIEWER',  icon:'👁', desc:'Read-only dashboard, no exports' },
};

const VERIFIER_OPTIONS = [
  { code:'BV',       name:'Bureau Veritas', logo:'🔵', desc:'ISO 14065 accredited, India presence' },
  { code:'DNV',      name:'DNV',            logo:'🟢', desc:'Gold Standard & Verra approved verifier' },
  { code:'EY',       name:'EY Climate',     logo:'🟡', desc:'Big 4 ESG assurance, BRSR specialist' },
  { code:'DELOITTE', name:'Deloitte',       logo:'🔷', desc:'Big 4 sustainability assurance' },
  { code:'TUV',      name:'TÜV SÜD',       logo:'🔴', desc:'CDM & VCS methodology expert' },
  { code:'BSI',      name:'BSI Group',      logo:'🟠', desc:'ISO 14064-3 verification body' },
  { code:'KPMG',     name:'KPMG ESG',       logo:'🔵', desc:'TCFD & CDP reporting specialist' },
  { code:'OTHER',    name:'Other Verifier', logo:'⚪', desc:'Enter verifier details manually' },
];

// ── Plan definitions ──────────────────────────────────────────
const PLAN_META = {
  free: {
    key:       'free',
    label:     'FREE',
    price:     '₹0',
    priceNote: 'forever',
    color:     '#86efac',
    bg:        '#0a1a0e',
    border:    '#22c55e22',
    seats:     1,
    badge:     '🛒',
    tagline:   'For carbon credit buyers',
    features: [
      { text:'Marketplace browse & buy credits',  on: true  },
      { text:'Portfolio management (sell credits)',on: false },
      { text:'Scope 1, 2 & 3 emissions logging',  on: false },
      { text:'GHG inventory ledger + CSV export',  on: false },
      { text:'Analytics dashboard',               on: false },
      { text:'GHG Protocol PDF report',           on: false },
      { text:'BRSR / CDP / TCFD reports',         on: false },
      { text:'Audit trail + verifier',            on: false },
      { text:'GEI / PAT / CCTS / SBTi',          on: false },
      { text:'Multi-entity + supplier portal',    on: false },
    ],
    cta:       null,
    ctaLabel:  null,
  },
  starter: {
    key:       'starter',
    label:     'STARTER',
    price:     '₹1,000',
    priceNote: 'per month',
    color:     '#60a5fa',
    bg:        '#060e18',
    border:    '#60a5fa22',
    seats:     3,
    badge:     '💼',
    tagline:   'For carbon credit sellers',
    features: [
      { text:'Everything in Free',                on: true  },
      { text:'Portfolio management (sell credits)',on: true  },
      { text:'Credit retirement & export',        on: true  },
      { text:'Scope 1, 2 & 3 emissions logging',  on: false },
      { text:'GHG inventory ledger + CSV export',  on: false },
      { text:'Analytics dashboard',               on: false },
      { text:'GHG Protocol PDF report',           on: false },
      { text:'BRSR / CDP / TCFD reports',         on: false },
      { text:'Audit trail + verifier',            on: false },
      { text:'Multi-entity + supplier portal',    on: false },
    ],
    cta:       '/billing/starter',
    ctaLabel:  'GET STARTED →',
  },
  growth: {
    key:       'growth',
    label:     'GROWTH',
    price:     '₹10,000',
    priceNote: 'per month',
    color:     '#22c55e',
    bg:        '#0d2e1f',
    border:    '#22c55e33',
    seats:     10,
    badge:     '📊',
    tagline:   'For SMEs & mid-cap companies',
    features: [
      { text:'Everything in Starter',             on: true  },
      { text:'Scope 1, 2 & 3 emissions logging',  on: true  },
      { text:'GHG inventory ledger + CSV export',  on: true  },
      { text:'Analytics dashboard',               on: true  },
      { text:'Carbon intensity metrics',          on: true  },
      { text:'GHG Protocol PDF report',           on: true  },
      { text:'BRSR / CDP / TCFD reports',         on: false, locked: true },
      { text:'Audit trail + verifier',            on: false, locked: true },
      { text:'GEI / PAT / CCTS / SBTi',          on: false, locked: true },
      { text:'Multi-entity + supplier portal',    on: false, locked: true },
    ],
    cta:       '/billing/growth',
    ctaLabel:  'UPGRADE TO GROWTH →',
  },
  corporate: {
    key:       'corporate',
    label:     'CORPORATE',
    price:     'Custom',
    priceNote: 'contact sales',
    color:     '#f97316',
    bg:        '#1a0a00',
    border:    '#f9731633',
    seats:     null,
    badge:     '🏛',
    tagline:   'For listed top 1000 & large caps',
    features: [
      { text:'Everything in Growth',              on: true  },
      { text:'BRSR Environmental PDF (E2/E3/E4)', on: true  },
      { text:'CDP disclosure PDF',                on: true  },
      { text:'TCFD report PDF',                   on: true  },
      { text:'Audit trail + 3rd party verifier',  on: true  },
      { text:'GEI compliance + BEE format',       on: true  },
      { text:'PAT scheme + CCTS compliance',      on: true  },
      { text:'5-year plan + SBTi target setting', on: true  },
      { text:'Supplier data portal',              on: true  },
      { text:'Multi-entity consolidation',        on: true  },
    ],
    cta: 'https://mail.google.com/mail/?view=cm&to=sales@ethertrack.in',
    ctaLabel:  '📞 CONTACT SALES →',
  },
};

const PLAN_ORDER = ['free','starter','growth','corporate'];

const INDUSTRIES = ['Manufacturing','IT/Software','Finance','Healthcare','Retail','Logistics','Construction','Energy','Agriculture','Education','Other'];
const REPORT_YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);

const EMPTY_PFORM = {
  companyName:'', industry:'', revenueCr:'', employees:'', floorSqft:'',
  netZeroYear:'2050', netZeroTargetCo2e:'', reportingYear: String(new Date().getFullYear()),
  companyCin:'', companyGstin:'', companyPan:'', companyType:'', baseYear:'2024',
};

export default function TeamManagement() {
  const { dbUser } = useContext(AuthContext);
  const navigate   = useNavigate();
  const location   = useLocation();

  const [org,           setOrg]           = useState(null);
  const [teamRole,      setTeamRole]       = useState(null);
  const [permissions,   setPermissions]    = useState([]);
  const [members,       setMembers]        = useState([]);
  const [verifiers,     setVerifiers]      = useState([]);
  const [tab,           setTab]            = useState('profile');
  const [loading,       setLoading]        = useState(true);
  const [toast,         setToast]          = useState(null);
  const [profile,       setProfile]        = useState(null);
  const [pform,         setPform]          = useState(EMPTY_PFORM);
  const [savingProfile, setSavingProfile]  = useState(false);

  // Invite form
  const [showInvite,  setShowInvite]  = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole,  setInviteRole]  = useState('viewer');
  const [inviting,    setInviting]    = useState(false);

  // Verifier form
  const [showVerifier,     setShowVerifier]     = useState(false);
  const [selectedVerifier, setSelectedVerifier] = useState(null);
  const [verifierContact,  setVerifierContact]  = useState('');
  const [verifierNotes,    setVerifierNotes]    = useState('');

  const showToast = (msg, type='success') => { setToast({msg,type}); setTimeout(()=>setToast(null),4000); };
  const can       = (perm) => permissions.includes(perm);
  const canInvite = can('team:invite') || teamRole==='owner' || teamRole==='admin';
  const canChange = can('team:change_role') || teamRole==='owner';
  const canRemove = can('team:remove') || teamRole==='owner';

  useEffect(() => {
    loadAll();
    const t = new URLSearchParams(location.search).get('tab');
    if (t) setTab(t);
  }, []); // eslint-disable-line

  const loadAll = async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/api/org/me');
      if (data.org) {
        setOrg(data.org);
        setTeamRole(data.teamRole);
        setPermissions(data.permissions || []);
        await Promise.all([
          loadMembers(data.org.id),
          loadVerifiers(data.org.id),
          loadProfile(),
        ]);
        setTab(t => t === 'profile' ? 'team' : t);
      } else {
        await loadProfile();
        setTab('profile');
      }
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  };

  const loadMembers = async (orgId) => {
    try {
      const data = await apiFetch(`/api/org/${orgId}/members`);
      setMembers(data.members || []);
    } catch {}
  };

  const loadProfile = async () => {
    try {
      const res = await apiFetch('/api/emissions/profile');
      if (res?.profile) {
        const p = res.profile;
        setProfile(p);
        setPform({
          companyName:       p.company_name             || '',
          industry:          p.industry                 || '',
          revenueCr:         p.revenue_cr               || '',
          employees:         p.employees                || '',
          floorSqft:         p.floor_sqft               || '',
          netZeroYear:       String(p.net_zero_year      || 2050),
          netZeroTargetCo2e: p.net_zero_target_co2e     || '',
          reportingYear:     String(p.reporting_year    || new Date().getFullYear()),
          companyCin:        p.company_cin              || '',
          companyGstin:      p.company_gstin            || '',
          companyPan:        p.company_pan              || '',
          companyType:       p.company_type             || '',
          baseYear:          String(p.base_year          || 2024),
        });
      }
    } catch {}
  };

  const loadVerifiers = async (orgId) => {
    try {
      const data = await apiFetch(`/api/org/${orgId}/verifiers`);
      setVerifiers(data.verifiers || []);
    } catch {}
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (savingProfile) return;
    if (!pform.companyName.trim()) return showToast('Company name is required', 'error');
    setSavingProfile(true);
    try {
      const res = await apiFetch('/api/emissions/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName:       pform.companyName,
          industry:          pform.industry             || null,
          revenueCr:         parseFloat(pform.revenueCr)         || 0,
          employees:         parseInt(pform.employees)           || 0,
          floorSqft:         parseInt(pform.floorSqft)           || 0,
          netZeroYear:       parseInt(pform.netZeroYear)         || 2050,
          netZeroTargetCo2e: parseFloat(pform.netZeroTargetCo2e) || 0,
          reportingYear:     parseInt(pform.reportingYear)       || new Date().getFullYear(),
          companyCin:        pform.companyCin.toUpperCase()      || null,
          companyGstin:      pform.companyGstin.toUpperCase()    || null,
          companyPan:        pform.companyPan.toUpperCase()      || null,
          companyType:       pform.companyType                   || null,
          baseYear:          parseInt(pform.baseYear)            || 2024,
        }),
      });
      if (res?.profile) setProfile(res.profile);

      if (!org) {
        await apiFetch('/api/org/create', {
          method: 'POST',
          body: JSON.stringify({
            name:        pform.companyName,
            cin:         pform.companyCin   || '',
            gstin:       pform.companyGstin || '',
            industry:    pform.industry     || '',
            companyType: pform.companyType  || '',
          }),
        });
        showToast('✅ Company profile saved & workspace created!');
        await loadAll();
        setTab('team');
      } else {
        showToast('✅ Company profile saved');
      }
    } catch(e) { showToast(`❌ ${e.message || 'Failed to save'}`, 'error'); }
    finally { setSavingProfile(false); }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return showToast('Email required', 'error');
    const currentPlan = PLAN_META[org?.subscription_plan] || PLAN_META.free;
    const seatLimit   = currentPlan.seats;
    const active      = members.filter(m=>m.status==='active').length;
    if (seatLimit !== null && active >= seatLimit) {
      return showToast(`❌ Seat limit reached (${seatLimit} seats on ${currentPlan.label} plan). Upgrade to add more.`, 'error');
    }
    setInviting(true);
    try {
      await apiFetch(`/api/org/${org.id}/invite`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail, teamRole: inviteRole }),
      });
      showToast(`✅ Invite sent to ${inviteEmail}`);
      setInviteEmail(''); setShowInvite(false);
      await loadMembers(org.id);
    } catch(e) { showToast(`❌ ${e.message}`, 'error'); }
    finally { setInviting(false); }
  };

  const handleChangeRole = async (userId, newRole) => {
    try {
      await apiFetch(`/api/org/${org.id}/members/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ teamRole: newRole }),
      });
      showToast(`✅ Role updated to ${newRole}`);
      await loadMembers(org.id);
    } catch(e) { showToast(`❌ ${e.message}`, 'error'); }
  };

  const handleRemoveMember = async (userId, name) => {
    if (!window.confirm(`Remove ${name} from the organisation?`)) return;
    try {
      await apiFetch(`/api/org/${org.id}/members/${userId}`, { method: 'DELETE' });
      showToast(`✅ ${name} removed`);
      await loadMembers(org.id);
    } catch(e) { showToast(`❌ ${e.message}`, 'error'); }
  };

  const handleRequestVerifier = async () => {
    if (!selectedVerifier) return showToast('Please select a verifier', 'error');
    if (!verifierContact.trim()) return showToast('Contact email required', 'error');
    try {
      await apiFetch(`/api/org/${org.id}/verifiers`, {
        method: 'POST',
        body: JSON.stringify({
          verifierCode: selectedVerifier.code,
          verifierName: selectedVerifier.name,
          contactEmail: verifierContact,
          notes:        verifierNotes,
        }),
      });
      showToast('✅ Verifier request submitted');
      setShowVerifier(false); setSelectedVerifier(null);
      setVerifierContact(''); setVerifierNotes('');
      await loadVerifiers(org.id);
    } catch(e) { showToast(`❌ ${e.message}`, 'error'); }
  };

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
    *{box-sizing:border-box;}
    .tm{min-height:100vh;background:#040706;font-family:'DM Mono',monospace;color:#f0fdf4;padding:32px 24px 80px;}
    .tmw{max-width:1200px;margin:0 auto;}
    .tm-hdr{margin-bottom:28px;}
    .tm-hdr-label{font-size:9px;color:#86efac44;letter-spacing:.2em;margin-bottom:6px;}
    .tm-hdr-title{font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:#f0fdf4;}
    .tm-hdr-title span{color:#22c55e;}
    .tm-hdr-sub{font-size:10px;color:#86efac33;letter-spacing:.1em;margin-top:4px;}
    .tm-tabs{display:flex;gap:5px;margin-bottom:24px;flex-wrap:wrap;}
    .tm-tab{padding:8px 16px;border-radius:6px;border:1px solid #0d1f11;background:#060a07;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.08em;color:#86efac33;transition:all .2s;}
    .tm-tab:hover{border-color:#22c55e22;color:#86efac66;}
    .tm-tab.on{border-color:#22c55e;color:#22c55e;background:#0a1a0e;}
    .tm-tab.locked{opacity:.35;cursor:not-allowed;}
    .tm-card{background:#070c09;border:1px solid #0d1f11;border-radius:12px;padding:24px;margin-bottom:16px;}
    .tm-card-title{font-size:9px;color:#86efac44;letter-spacing:.15em;margin-bottom:20px;display:flex;align-items:center;gap:8px;}
    .tm-card-title::before{content:'';width:14px;height:1px;background:#22c55e;}
    .tm-btn{padding:9px 18px;border-radius:7px;border:none;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.1em;font-weight:700;transition:all .2s;}
    .tm-btn-p{background:linear-gradient(135deg,#14532d,#166534);color:#d1fae5;}
    .tm-btn-p:hover{background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;}
    .tm-btn-g{background:#060a07;border:1px solid #0d1f11;color:#86efac44;}
    .tm-btn-g:hover{border-color:#22c55e33;color:#22c55e88;}
    .tm-btn-r{background:#0e0505;border:1px solid #f8717122;color:#f8717166;}
    .tm-btn-r:hover{background:#1a0707;border-color:#f8717166;color:#f87171cc;}
    .tm-btn-sm{padding:6px 12px;font-size:9px;}
    .tm-btn-orange{background:linear-gradient(135deg,#7c2d12,#9a3412);color:#fed7aa;}
    .tm-btn-orange:hover{background:linear-gradient(135deg,#ea580c,#c2410c);color:#fff;}
    .tm-input{padding:10px 12px;border-radius:7px;border:1px solid #0d1f11;background:#040706;color:#f0fdf4;font-family:'DM Mono',monospace;font-size:11px;outline:none;transition:border-color .2s;width:100%;}
    .tm-input:focus{border-color:#22c55e33;}
    .tm-label{font-size:9px;color:#86efac44;letter-spacing:.12em;margin-bottom:5px;display:block;}
    .tm-field{display:flex;flex-direction:column;gap:5px;margin-bottom:14px;}
    .tm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.88);backdrop-filter:blur(6px);z-index:3000;display:flex;align-items:center;justify-content:center;padding:24px;}
    .tm-modal{background:#070c09;border:1px solid #0d1f11;border-radius:16px;width:100%;max-width:540px;max-height:90vh;overflow-y:auto;box-shadow:0 32px 80px rgba(0,0,0,.95);}
    .tm-modal-hdr{padding:20px 24px;border-bottom:1px solid #0d1f11;display:flex;align-items:center;justify-content:space-between;}
    .tm-modal-title{font-size:13px;font-weight:700;color:#f0fdf4;letter-spacing:.1em;}
    .tm-modal-close{background:none;border:none;color:#86efac33;cursor:pointer;font-size:18px;}
    .tm-modal-close:hover{color:#f87171;}
    .tm-modal-body{padding:24px;}
    .tm-modal-foot{padding:16px 24px;border-top:1px solid #0d1f11;display:flex;gap:10px;background:#050809;}
    .tm-role-pill{font-size:9px;padding:3px 10px;border-radius:3px;letter-spacing:.08em;font-weight:700;}
    .tm-member-row{display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:10px;border:1px solid #0d1f11;background:#050809;margin-bottom:8px;transition:border-color .2s;}
    .tm-member-row:hover{border-color:#22c55e11;}
    .tm-avatar{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#14532d,#166534);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;font-weight:700;color:#d1fae5;}
    .tm-member-info{flex:1;min-width:0;}
    .tm-member-name{font-size:12px;color:#f0fdf4;font-weight:600;margin-bottom:2px;}
    .tm-member-email{font-size:10px;color:#86efac44;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .tm-role-select{padding:5px 8px;border-radius:5px;border:1px solid #0d1f11;background:#060a07;color:#f0fdf4;font-family:'DM Mono',monospace;font-size:10px;outline:none;cursor:pointer;}
    .tm-verifier-card{border-radius:10px;padding:16px;border:1px solid #0d1f11;background:#050809;cursor:pointer;transition:all .2s;margin-bottom:8px;}
    .tm-verifier-card:hover{border-color:#a78bfa33;}
    .tm-verifier-card.on{border-color:#a78bfa66;background:#0d0a1a;}
    .tm-perm-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;}
    .tm-perm-tag{font-size:9px;padding:4px 10px;border-radius:4px;border:1px solid #22c55e22;background:#0a1a0e;color:#22c55e88;letter-spacing:.06em;}
    .tm-toast{position:fixed;bottom:24px;right:24px;z-index:9999;background:#070c09;border-radius:8px;padding:12px 20px;font-size:11px;font-family:'DM Mono',monospace;letter-spacing:.06em;box-shadow:0 8px 32px rgba(0,0,0,.8);}
    .tm-plan-card{border-radius:14px;padding:24px;border:2px solid #0d1f11;background:#070c09;transition:all .2s;display:flex;flex-direction:column;gap:0;}
    .tm-plan-card.current{box-shadow:0 0 0 1px currentColor;}
    .tm-feat{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:10px;border-bottom:1px solid #0d1f1122;}
    .tm-feat:last-child{border-bottom:none;}
    .tm-seat-bar{height:6px;border-radius:3px;background:#0d1f11;overflow:hidden;margin-top:4px;}
    .tm-seat-fill{height:100%;border-radius:3px;background:#22c55e;transition:width .4s;}
    @media(max-width:900px){.tm-plan-grid{grid-template-columns:1fr 1fr!important;}}
    @media(max-width:560px){.tm-plan-grid{grid-template-columns:1fr!important;}}
  `;

  if (loading) return (
    <>
      <style>{CSS}</style>
      <div className="tm"><div className="tmw" style={{paddingTop:80,textAlign:'center',color:'#86efac33',fontSize:11,letterSpacing:'.1em'}}>LOADING…</div></div>
    </>
  );

  const currentPlanKey  = org?.subscription_plan || 'free';
  const currentPlan     = PLAN_META[currentPlanKey] || PLAN_META.free;
  const activeMembers   = members.filter(m=>m.status==='active').length;
  const seatLimit       = currentPlan.seats;
  const seatsUsedPct    = seatLimit ? Math.min(100, (activeMembers / seatLimit) * 100) : 0;
  const hasOrg          = !!org;
  const isCorporate     = currentPlanKey === 'corporate';

  const TABS = [
    { key:'profile',   label:'COMPANY PROFILE' },
    { key:'team',      label:'TEAM',                requiresOrg: true },
    { key:'roles',     label:'ROLES & PERMISSIONS', requiresOrg: true },
    { key:'verifiers', label:'VERIFIERS',           requiresOrg: true, requiresPlan:'corporate' },
    { key:'plan',      label:'PLAN & BILLING',      requiresOrg: true },
  ];

  return (
    <>
      <style>{CSS}</style>
      <div className="tm">
        <div className="tmw">

          {/* Header */}
          <div className="tm-hdr">
            <div className="tm-hdr-label">ORGANISATION · TEAM · BILLING</div>
            <div className="tm-hdr-title">
              {hasOrg ? <>{org.name} <span>Workspace</span></> : <>Workspace <span>Setup</span></>}
            </div>
            {hasOrg&&(
              <div className="tm-hdr-sub" style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                <span>{org.industry||'—'}</span>
                <span>·</span>
                <span style={{color:currentPlan.color,fontWeight:700}}>{currentPlan.badge} {currentPlan.label}</span>
                <span>·</span>
                <span>{activeMembers}{seatLimit ? `/${seatLimit}` : ''} seats used</span>
                <span>·</span>
                <span>Your role: <span style={{color:ROLE_META[teamRole]?.color||'#22c55e',fontWeight:700}}>{ROLE_META[teamRole]?.icon} {teamRole?.toUpperCase()}</span></span>
                {org.subscription_status==='trial'&&(
                  <span style={{fontSize:9,padding:'3px 8px',borderRadius:4,background:'#110a00',color:'#f59e0b88',border:'1px solid #f59e0b22'}}>
                    ⏳ Trial ends {new Date(org.trial_ends_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Seat usage bar */}
          {hasOrg && seatLimit && (
            <div style={{marginBottom:20,padding:'12px 16px',background:'#070c09',border:'1px solid #0d1f11',borderRadius:10,display:'flex',alignItems:'center',gap:16}}>
              <div style={{flex:1}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6,fontSize:10}}>
                  <span style={{color:'#86efac44'}}>SEATS USED</span>
                  <span style={{color: seatsUsedPct>=100?'#f87171':seatsUsedPct>=80?'#f59e0b':'#22c55e',fontWeight:700}}>
                    {activeMembers} / {seatLimit}
                  </span>
                </div>
                <div className="tm-seat-bar">
                  <div className="tm-seat-fill" style={{
                    width:`${seatsUsedPct}%`,
                    background: seatsUsedPct>=100?'#f87171':seatsUsedPct>=80?'#f59e0b':'#22c55e'
                  }}/>
                </div>
              </div>
              {seatsUsedPct>=80&&!isCorporate&&(
                <button className="tm-btn tm-btn-orange tm-btn-sm" onClick={()=>setTab('plan')}>
                  ⬆ UPGRADE
                </button>
              )}
            </div>
          )}

          {/* Setup banner for new users */}
          {!hasOrg&&(
            <div style={{padding:'14px 18px',background:'#0a1a0e',border:'1px solid #22c55e33',borderRadius:10,marginBottom:24,display:'flex',alignItems:'center',gap:12,fontSize:11,color:'#22c55e88',lineHeight:1.7}}>
              <div style={{width:22,height:22,borderRadius:'50%',background:'#22c55e',color:'#040706',fontSize:10,fontWeight:800,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>1</div>
              <div><strong style={{color:'#22c55e'}}>Fill in your company profile below</strong> — your workspace will be created automatically when you save. You can then invite your ESG team.</div>
            </div>
          )}

          {/* Tabs */}
          <div className="tm-tabs">
            {TABS.map(({key,label,requiresOrg,requiresPlan})=>{
              const locked = (requiresOrg && !hasOrg) || (requiresPlan && currentPlanKey !== requiresPlan);
              return (
                <button key={key}
                  className={`tm-tab${tab===key?' on':''}${locked?' locked':''}`}
                  onClick={()=>{ if(!locked) setTab(key); }}
                  title={locked && requiresPlan ? `Requires ${requiresPlan} plan` : locked ? 'Complete company profile first' : ''}>
                  {label}{locked?' 🔒':''}
                </button>
              );
            })}
          </div>

          {/* ── COMPANY PROFILE TAB ── */}
          {tab==='profile'&&(
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
              <div className="tm-card">
                <div className="tm-card-title">{hasOrg?'COMPANY PROFILE':'STEP 1 — COMPANY PROFILE'}</div>
                <form onSubmit={handleSaveProfile}>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
                    <div className="tm-field" style={{gridColumn:'1/-1'}}>
                      <label className="tm-label">COMPANY NAME *</label>
                      <input className="tm-input" type="text" placeholder="Acme Corp Pvt Ltd" maxLength={200}
                        value={pform.companyName} onChange={e=>setPform(f=>({...f,companyName:e.target.value}))}/>
                    </div>
                    <div className="tm-field">
                      <label className="tm-label">INDUSTRY</label>
                      <select className="tm-input" value={pform.industry} onChange={e=>setPform(f=>({...f,industry:e.target.value}))}>
                        <option value="">Select…</option>{INDUSTRIES.map(i=><option key={i}>{i}</option>)}
                      </select>
                    </div>
                    <div className="tm-field">
                      <label className="tm-label">COMPANY TYPE</label>
                      <select className="tm-input" value={pform.companyType} onChange={e=>setPform(f=>({...f,companyType:e.target.value}))}>
                        <option value="">Select…</option>
                        {['Private Limited','Public Limited','LLP','Partnership','Sole Proprietorship','OPC','Section 8'].map(t=><option key={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{fontSize:10,color:'#86efac44',letterSpacing:'.12em',borderBottom:'1px solid #0d1f11',paddingBottom:8,marginBottom:12}}>INDIAN REGULATORY IDENTITY</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:14}}>
                    <div className="tm-field">
                      <label className="tm-label">CIN (MCA)</label>
                      <input className="tm-input" placeholder="U72900MH2020PTC340021" value={pform.companyCin}
                        onChange={e=>setPform(f=>({...f,companyCin:e.target.value.toUpperCase()}))} maxLength={21}/>
                    </div>
                    <div className="tm-field">
                      <label className="tm-label">GSTIN</label>
                      <input className="tm-input" placeholder="27AAPFU0939F1ZV" value={pform.companyGstin}
                        onChange={e=>setPform(f=>({...f,companyGstin:e.target.value.toUpperCase()}))} maxLength={15}/>
                    </div>
                    <div className="tm-field">
                      <label className="tm-label">PAN</label>
                      <input className="tm-input" placeholder="AAPFU0939F" value={pform.companyPan}
                        onChange={e=>setPform(f=>({...f,companyPan:e.target.value.toUpperCase()}))} maxLength={10}/>
                    </div>
                  </div>
                  <div style={{fontSize:10,color:'#86efac44',letterSpacing:'.12em',borderBottom:'1px solid #0d1f11',paddingBottom:8,marginBottom:12}}>REPORTING & INTENSITY DENOMINATORS</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:14}}>
                    <div className="tm-field">
                      <label className="tm-label">REPORTING YEAR</label>
                      <select className="tm-input" value={pform.reportingYear} onChange={e=>setPform(f=>({...f,reportingYear:e.target.value}))}>
                        {REPORT_YEARS.map(y=><option key={y}>{y}</option>)}
                      </select>
                    </div>
                    <div className="tm-field">
                      <label className="tm-label">REVENUE (₹ crore)</label>
                      <input className="tm-input" type="number" step="0.1" min="0" placeholder="42.5"
                        value={pform.revenueCr} onChange={e=>setPform(f=>({...f,revenueCr:e.target.value}))}/>
                    </div>
                    <div className="tm-field">
                      <label className="tm-label">EMPLOYEES (FTE)</label>
                      <input className="tm-input" type="number" min="0" placeholder="120"
                        value={pform.employees} onChange={e=>setPform(f=>({...f,employees:e.target.value}))}/>
                    </div>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:20}}>
                    <div className="tm-field">
                      <label className="tm-label">FLOOR AREA (sqft)</label>
                      <input className="tm-input" type="number" min="0" placeholder="18000"
                        value={pform.floorSqft} onChange={e=>setPform(f=>({...f,floorSqft:e.target.value}))}/>
                    </div>
                    <div className="tm-field">
                      <label className="tm-label">BASE YEAR</label>
                      <select className="tm-input" value={pform.baseYear} onChange={e=>setPform(f=>({...f,baseYear:e.target.value}))}>
                        {[2019,2020,2021,2022,2023,2024].map(y=><option key={y}>{y}</option>)}
                      </select>
                    </div>
                    <div className="tm-field">
                      <label className="tm-label">NET ZERO TARGET</label>
                      <select className="tm-input" value={pform.netZeroYear} onChange={e=>setPform(f=>({...f,netZeroYear:e.target.value}))}>
                        {[2030,2035,2040,2045,2050].map(y=><option key={y}>{y}</option>)}
                      </select>
                    </div>
                  </div>
                  <button type="submit" className="tm-btn tm-btn-p" disabled={savingProfile} style={{width:'100%',padding:'12px'}}>
                    {savingProfile ? '⟳ SAVING…' : hasOrg ? 'SAVE PROFILE →' : '✅ SAVE PROFILE & CREATE WORKSPACE →'}
                  </button>
                </form>
              </div>

              <div className="tm-card">
                <div className="tm-card-title">{hasOrg ? 'SAVED PROFILE' : 'WHAT HAPPENS NEXT'}</div>
                {hasOrg && profile ? (
                  <>
                    {[
                      ['Company',        profile.company_name   || '—'],
                      ['Industry',       profile.industry       || '—'],
                      ['Type',           profile.company_type   || '—'],
                      ['Reporting Year', profile.reporting_year || '—'],
                      ['CIN',            profile.company_cin    || '—'],
                      ['GSTIN',          profile.company_gstin  || '—'],
                      ['PAN',            profile.company_pan    || '—'],
                      ['Revenue',        profile.revenue_cr ? `₹${profile.revenue_cr} Cr` : '—'],
                      ['Employees',      profile.employees      || '—'],
                      ['Base Year',      profile.base_year      || 2024],
                      ['Net Zero',       `${profile.net_zero_year || 2050}`],
                    ].map(([k,v])=>(
                      <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #0d1f1133',fontSize:11}}>
                        <span style={{color:'#86efac44'}}>{k}</span>
                        <span style={{color:'#f0fdf4'}}>{v}</span>
                      </div>
                    ))}
                    <div style={{marginTop:16,padding:'10px 14px',borderRadius:8,background:'#0a1a0e',border:'1px solid #22c55e33',fontSize:11,color:'#22c55e'}}>
                      ✓ Profile complete — regulatory exports active
                    </div>
                  </>
                ) : hasOrg && !profile ? (
                  <div style={{padding:32,textAlign:'center',color:'#86efac33',fontSize:11}}>
                    Fill in the form to unlock intensity benchmarks and regulatory exports.
                  </div>
                ) : (
                  <div style={{display:'flex',flexDirection:'column',gap:16}}>
                    {[
                      {n:'1',c:'#22c55e',t:'Fill your company profile',d:'Enter company name, CIN, GSTIN, revenue and ESG targets.'},
                      {n:'2',c:'#22c55e',t:'Workspace auto-created',d:'Organisation workspace is set up instantly — no separate step.'},
                      {n:'3',c:'#60a5fa',t:'Invite your ESG team',d:'Add colleagues, assign roles: Admin, Manager, Auditor, Viewer.'},
                      {n:'4',c:'#a78bfa',t:'Connect a verifier (Corporate)',d:'Link Bureau Veritas, DNV, EY etc. for BRSR Level 2 assurance.'},
                      {n:'5',c:'#f97316',t:'Start tracking emissions',d:'Log Scope 1, 2 & 3 and generate GHG / BRSR / CDP / TCFD PDFs.'},
                    ].map(s=>(
                      <div key={s.n} style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                        <div style={{width:22,height:22,borderRadius:'50%',background:s.c,color:'#040706',fontSize:10,fontWeight:800,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:2}}>{s.n}</div>
                        <div>
                          <div style={{fontSize:11,color:'#f0fdf4',fontWeight:700,marginBottom:3}}>{s.t}</div>
                          <div style={{fontSize:10,color:'#86efac44',lineHeight:1.6}}>{s.d}</div>
                        </div>
                      </div>
                    ))}
                    <div style={{marginTop:4,padding:'10px 14px',borderRadius:8,background:'#0a1628',border:'1px solid #60a5fa22',fontSize:10,color:'#60a5fa88',lineHeight:1.7}}>
                      ℹ️ Free plan includes marketplace access. Upgrade anytime for emissions tracking and reports.
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── TEAM TAB ── */}
          {tab==='team'&&hasOrg&&(
            <div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:10}}>
                <div style={{fontSize:11,color:'#86efac33'}}>
                  {activeMembers} active
                  {seatLimit ? ` · ${seatLimit - activeMembers} seats remaining` : ' · unlimited seats'}
                  {' · '}
                  <span style={{color:currentPlan.color,fontWeight:700}}>{currentPlan.label} plan</span>
                </div>
                <div style={{display:'flex',gap:8}}>
                  {seatLimit && activeMembers >= seatLimit && !isCorporate && (
                    <button className="tm-btn tm-btn-orange tm-btn-sm" onClick={()=>setTab('plan')}>⬆ UPGRADE FOR MORE SEATS</button>
                  )}
                  {canInvite && (!seatLimit || activeMembers < seatLimit) && (
                    <button className="tm-btn tm-btn-p" onClick={()=>setShowInvite(true)}>⊕ INVITE MEMBER</button>
                  )}
                </div>
              </div>

              {/* Seat limit warning */}
              {seatLimit && activeMembers >= seatLimit && (
                <div style={{padding:'10px 16px',borderRadius:8,background:'#110a00',border:'1px solid #f59e0b22',fontSize:11,color:'#f59e0b88',marginBottom:16}}>
                  ⚠ Seat limit reached ({activeMembers}/{seatLimit} on {currentPlan.label} plan).
                  {!isCorporate && <span> <button onClick={()=>setTab('plan')} style={{background:'none',border:'none',color:'#f97316',cursor:'pointer',fontFamily:'DM Mono,monospace',fontSize:11,textDecoration:'underline'}}>Upgrade your plan</button> to add more members.</span>}
                </div>
              )}

              {members.map(m=>{
                const rm   = ROLE_META[m.team_role]||ROLE_META.viewer;
                const init = (m.full_name||m.email||'?')[0].toUpperCase();
                const isMe = m.user_id === dbUser?.id;
                return (
                  <div key={m.id} className="tm-member-row">
                    <div className="tm-avatar">{init}</div>
                    <div className="tm-member-info">
                      <div className="tm-member-name">
                        {m.full_name||'—'}
                        {isMe&&<span style={{fontSize:9,color:'#22c55e88',marginLeft:8}}>(you)</span>}
                        {!m.accepted_at&&<span style={{fontSize:9,color:'#f59e0b88',marginLeft:8}}>⏳ pending</span>}
                      </div>
                      <div className="tm-member-email">{m.email}</div>
                      {m.wallet_address&&(
                        <div style={{fontSize:9,color:'#86efac22',marginTop:2,fontFamily:'monospace'}}>
                          {m.wallet_address.slice(0,8)}...{m.wallet_address.slice(-4)}
                          {m.kyc_verified&&<span style={{color:'#22c55e88',marginLeft:6}}>✓ KYC</span>}
                        </div>
                      )}
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                      <span className="tm-role-pill" style={{background:rm.bg,color:rm.color,border:`1px solid ${rm.border}`}}>
                        {rm.icon} {rm.label}
                      </span>
                      {canChange&&!isMe&&m.team_role!=='owner'&&(
                        <select className="tm-role-select" value={m.team_role}
                          onChange={e=>handleChangeRole(m.user_id, e.target.value)}>
                          {['admin','manager','auditor','viewer'].map(r=><option key={r} value={r}>{r}</option>)}
                        </select>
                      )}
                      {canRemove&&!isMe&&m.team_role!=='owner'&&(
                        <button className="tm-btn tm-btn-r tm-btn-sm"
                          onClick={()=>handleRemoveMember(m.user_id, m.full_name||m.email)}>✕</button>
                      )}
                    </div>
                  </div>
                );
              })}

              {members.length===0&&(
                <div style={{textAlign:'center',padding:40,color:'#86efac33',fontSize:11}}>
                  No members yet. Invite your ESG team to collaborate.
                </div>
              )}
            </div>
          )}

          {/* ── ROLES & PERMISSIONS TAB ── */}
          {tab==='roles'&&hasOrg&&(
            <div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:10,marginBottom:20}}>
                {Object.entries(ROLE_META).map(([role,meta])=>(
                  <div key={role} style={{background:meta.bg,border:`1px solid ${meta.border}`,borderRadius:10,padding:16,textAlign:'center'}}>
                    <div style={{fontSize:24,marginBottom:8}}>{meta.icon}</div>
                    <div style={{fontSize:11,color:meta.color,fontWeight:700,marginBottom:4,letterSpacing:'.08em'}}>{meta.label}</div>
                    <div style={{fontSize:9,color:'#86efac33',lineHeight:1.7}}>{meta.desc}</div>
                  </div>
                ))}
              </div>
              <div className="tm-card">
                <div className="tm-card-title">PERMISSIONS MATRIX</div>
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:10}}>
                    <thead>
                      <tr>
                        <th style={{padding:'8px 12px',textAlign:'left',color:'#86efac44',borderBottom:'1px solid #0d1f11',letterSpacing:'.1em'}}>PERMISSION</th>
                        {['owner','admin','manager','auditor','viewer'].map(r=>(
                          <th key={r} style={{padding:'8px 12px',textAlign:'center',color:ROLE_META[r].color,borderBottom:'1px solid #0d1f11',letterSpacing:'.08em'}}>
                            {ROLE_META[r].icon} {r.toUpperCase()}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ['Portfolio: Read',          'portfolio:read'],
                        ['Portfolio: Write',         'portfolio:write'],
                        ['Portfolio: Submit Credit', 'portfolio:submit_credit'],
                        ['Portfolio: Retire Credit', 'portfolio:retire'],
                        ['Portfolio: Export',        'portfolio:export'],
                        ['Emissions: Read',          'emissions:read'],
                        ['Emissions: Write',         'emissions:write'],
                        ['Emissions: Export',        'emissions:export'],
                        ['Reports: Generate',        'reports:generate'],
                        ['Reports: Export PDF',      'reports:export_pdf'],
                        ['Team: Invite',             'team:invite'],
                        ['Team: Remove',             'team:remove'],
                        ['Team: Change Role',        'team:change_role'],
                        ['Verifier: Connect',        'verifier:connect'],
                        ['Org: Billing',             'org:billing'],
                      ].map(([label,perm])=>{
                        const allowed = PERMISSIONS[perm] || [];
                        return (
                          <tr key={perm} style={{borderBottom:'1px solid #0d1f1122'}}>
                            <td style={{padding:'8px 12px',color:'#86efac88'}}>{label}</td>
                            {['owner','admin','manager','auditor','viewer'].map(r=>(
                              <td key={r} style={{padding:'8px 12px',textAlign:'center'}}>
                                {allowed.includes(r) ? <span style={{color:'#22c55e'}}>✓</span> : <span style={{color:'#86efac22'}}>—</span>}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="tm-card">
                <div className="tm-card-title">YOUR PERMISSIONS AS {teamRole?.toUpperCase()}</div>
                <div className="tm-perm-grid">
                  {permissions.map(p=><div key={p} className="tm-perm-tag">✓ {p}</div>)}
                </div>
              </div>
            </div>
          )}

          {/* ── VERIFIERS TAB (Corporate only) ── */}
          {tab==='verifiers'&&hasOrg&&isCorporate&&(
            <div>
              <div style={{padding:'14px 18px',background:'#0d0a1a',border:'1px solid #a78bfa22',borderRadius:10,marginBottom:20,fontSize:11,color:'#a78bfa88',lineHeight:1.8}}>
                🔍 <strong style={{color:'#a78bfa'}}>Third-Party Verification</strong> — Connect an accredited verifier to add a verification badge to your BRSR/CDP/TCFD reports. Required for Level 2 BRSR assurance.
              </div>
              {verifiers.length>0&&(
                <>
                  <div style={{fontSize:9,color:'#86efac44',letterSpacing:'.14em',marginBottom:10}}>CONNECTED VERIFIERS</div>
                  {verifiers.map(v=>(
                    <div key={v.id} style={{background:'#0d0a1a',border:`1px solid ${v.status==='connected'?'#a78bfa33':'#0d1f11'}`,borderRadius:10,padding:16,marginBottom:8,display:'flex',alignItems:'center',gap:14}}>
                      <div style={{fontSize:24}}>{VERIFIER_OPTIONS.find(o=>o.code===v.verifier_code)?.logo||'🔍'}</div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:12,color:'#f0fdf4',fontWeight:700,marginBottom:2}}>{v.verifier_name}</div>
                        <div style={{fontSize:10,color:'#86efac44'}}>{v.contact_email||'—'}</div>
                      </div>
                      <span style={{fontSize:9,padding:'4px 10px',borderRadius:4,letterSpacing:'.08em',
                        background:v.status==='connected'?'#0d2e1f':'#110a00',
                        color:v.status==='connected'?'#22c55e':'#f59e0b',
                        border:`1px solid ${v.status==='connected'?'#22c55e33':'#f59e0b22'}`}}>
                        {v.status==='pending'?'⏳ PENDING':v.status==='connected'?'✓ CONNECTED':'⏳ REQUESTED'}
                      </span>
                    </div>
                  ))}
                </>
              )}
              {can('verifier:connect')&&(
                <button className="tm-btn tm-btn-p" style={{marginBottom:16}} onClick={()=>setShowVerifier(true)}>
                  🔍 REQUEST VERIFIER CONNECTION →
                </button>
              )}
              <div style={{fontSize:9,color:'#86efac44',letterSpacing:'.14em',marginBottom:10}}>AVAILABLE VERIFIERS</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
                {VERIFIER_OPTIONS.filter(v=>v.code!=='OTHER').map(v=>(
                  <div key={v.code} style={{background:'#050809',border:'1px solid #0d1f11',borderRadius:8,padding:14,textAlign:'center'}}>
                    <div style={{fontSize:24,marginBottom:6}}>{v.logo}</div>
                    <div style={{fontSize:10,color:'#f0fdf4',fontWeight:700,marginBottom:4}}>{v.name}</div>
                    <div style={{fontSize:9,color:'#86efac33',lineHeight:1.6}}>{v.desc}</div>
                    <div style={{marginTop:8,fontSize:9,color:'#a78bfa44',fontStyle:'italic'}}>
                      {verifiers.find(c=>c.verifier_code===v.code)?'✓ Requested':'Not connected'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── PLAN & BILLING TAB ── */}
          {tab==='plan'&&hasOrg&&(
            <div>
              <div style={{fontSize:9,color:'#86efac44',letterSpacing:'.14em',marginBottom:16}}>
                CURRENT PLAN: <span style={{color:currentPlan.color,fontWeight:700}}>{currentPlan.badge} {currentPlan.label}</span>
              </div>
              <div className="tm-plan-grid" style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:24}}>
                {PLAN_ORDER.map(key=>{
                  const p       = PLAN_META[key];
                  const isCurr  = currentPlanKey === key;
                  const isAbove = PLAN_ORDER.indexOf(key) > PLAN_ORDER.indexOf(currentPlanKey);
                  return (
                    <div key={key} className={`tm-plan-card${isCurr?' current':''}`}
                      style={{borderColor: isCurr ? p.color : '#0d1f11', background: isCurr ? p.bg : '#070c09'}}>
                      {/* Badge + label */}
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
                        <span style={{fontSize:20}}>{p.badge}</span>
                        <div>
                          <div style={{fontSize:11,color:p.color,fontWeight:700,letterSpacing:'.1em'}}>{p.label}</div>
                          <div style={{fontSize:9,color:'#86efac33'}}>{p.tagline}</div>
                        </div>
                        {isCurr&&<span style={{marginLeft:'auto',fontSize:9,padding:'2px 8px',borderRadius:3,background:p.bg,color:p.color,border:`1px solid ${p.border}`}}>CURRENT</span>}
                      </div>
                      {/* Price */}
                      <div style={{marginBottom:16,paddingBottom:14,borderBottom:'1px solid #0d1f11'}}>
                        <span style={{fontSize:key==='corporate'?16:22,fontWeight:800,color:'#f0fdf4',fontFamily:'Syne,sans-serif'}}>{p.price}</span>
                        {key!=='corporate'&&<span style={{fontSize:9,color:'#86efac33',marginLeft:6}}>{p.priceNote}</span>}
                        {p.seats&&<div style={{fontSize:9,color:'#86efac44',marginTop:4}}>{p.seats} seat{p.seats>1?'s':''} included</div>}
                        {key==='corporate'&&<div style={{fontSize:9,color:'#86efac44',marginTop:4}}>Custom seats · Custom pricing</div>}
                      </div>
                      {/* Features */}
                      <div style={{flex:1,marginBottom:16}}>
                        {p.features.map((f,i)=>(
                          <div key={i} className="tm-feat">
                            <span style={{fontSize:11,color:f.on?'#22c55e':f.locked?'#f9731622':'#86efac22',flexShrink:0}}>
                              {f.on ? '✓' : f.locked ? '🔒' : '—'}
                            </span>
                            <span style={{color:f.on?'#86efacaa':f.locked?'#f97316aa':'#86efac33'}}>{f.text}</span>
                          </div>
                        ))}
                      </div>
                      {/* CTA */}
                      {p.cta && !isCurr && isAbove && (
                        key==='corporate'
                          ? <a href={p.cta} className="tm-btn tm-btn-orange" style={{display:'block',textAlign:'center',textDecoration:'none',padding:'9px 18px'}}>{p.ctaLabel}</a>
                          : <button className="tm-btn tm-btn-p" style={{width:'100%'}} onClick={()=>navigate(p.cta)}>{p.ctaLabel}</button>
                      )}
                      {isCurr&&<div style={{fontSize:9,color:p.color,textAlign:'center',padding:'8px 0',letterSpacing:'.08em'}}>✓ YOUR CURRENT PLAN</div>}
                    </div>
                  );
                })}
              </div>
              <div style={{padding:'14px 18px',background:'#070c09',border:'1px solid #0d1f11',borderRadius:10,fontSize:11,color:'#86efac44',lineHeight:1.8}}>
                Questions about plans? Email <span style={{color:'#22c55e'}}>sales@ethertrack.in</span> or call <span style={{color:'#22c55e'}}>+91 98765 43210</span>
              </div>
            </div>
          )}

        </div>{/* /tmw */}
      </div>{/* /tm */}

      {/* ── Invite Modal ── */}
      {showInvite&&(
        <div className="tm-overlay" onClick={e=>e.target===e.currentTarget&&setShowInvite(false)}>
          <div className="tm-modal">
            <div className="tm-modal-hdr">
              <span className="tm-modal-title">⊕ INVITE TEAM MEMBER</span>
              <button className="tm-modal-close" onClick={()=>setShowInvite(false)}>✕</button>
            </div>
            <div className="tm-modal-body">
              {seatLimit&&(
                <div style={{padding:'8px 12px',borderRadius:6,background:'#0a1a0e',border:'1px solid #22c55e22',fontSize:10,color:'#22c55e88',marginBottom:14}}>
                  {activeMembers} / {seatLimit} seats used on <strong style={{color:currentPlan.color}}>{currentPlan.label}</strong> plan
                </div>
              )}
              <div className="tm-field">
                <label className="tm-label">EMAIL ADDRESS</label>
                <input className="tm-input" type="email" placeholder="colleague@company.com"
                  value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)}/>
              </div>
              <div className="tm-field">
                <label className="tm-label">ASSIGN ROLE</label>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                  {['admin','manager','auditor','viewer'].map(r=>{
                    const rm = ROLE_META[r];
                    return (
                      <div key={r} onClick={()=>setInviteRole(r)}
                        style={{padding:'12px',borderRadius:8,border:`1px solid ${inviteRole===r?rm.border:'#0d1f11'}`,background:inviteRole===r?rm.bg:'#060a07',cursor:'pointer',transition:'all .2s'}}>
                        <div style={{fontSize:11,color:inviteRole===r?rm.color:'#86efac44',fontWeight:700,marginBottom:3}}>{rm.icon} {rm.label}</div>
                        <div style={{fontSize:9,color:'#86efac33',lineHeight:1.5}}>{rm.desc}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={{padding:'10px 14px',background:'#060e18',border:'1px solid #60a5fa22',borderRadius:8,fontSize:10,color:'#60a5fa88',lineHeight:1.7}}>
                ℹ️ An invite email will be sent. They must have an EtherTrack account to accept.
              </div>
            </div>
            <div className="tm-modal-foot">
              <button className="tm-btn tm-btn-g" onClick={()=>setShowInvite(false)}>CANCEL</button>
              <button className="tm-btn tm-btn-p" onClick={handleInvite} disabled={inviting}>
                {inviting?'⟳ SENDING…':'SEND INVITE →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Verifier Modal ── */}
      {showVerifier&&(
        <div className="tm-overlay" onClick={e=>e.target===e.currentTarget&&setShowVerifier(false)}>
          <div className="tm-modal" style={{maxWidth:580}}>
            <div className="tm-modal-hdr">
              <span className="tm-modal-title">🔍 REQUEST VERIFIER CONNECTION</span>
              <button className="tm-modal-close" onClick={()=>setShowVerifier(false)}>✕</button>
            </div>
            <div className="tm-modal-body">
              <div style={{fontSize:10,color:'#a78bfa88',marginBottom:16,lineHeight:1.7,padding:'10px 14px',background:'#0d0a1a',borderRadius:8,border:'1px solid #a78bfa22'}}>
                Select a verifier. EtherTrack will contact them on your behalf to set up verification access for your reports.
              </div>
              {VERIFIER_OPTIONS.map(v=>(
                <div key={v.code} className={`tm-verifier-card${selectedVerifier?.code===v.code?' on':''}`} onClick={()=>setSelectedVerifier(v)}>
                  <div style={{display:'flex',alignItems:'center',gap:12}}>
                    <span style={{fontSize:20}}>{v.logo}</span>
                    <div>
                      <div style={{fontSize:11,color:'#f0fdf4',fontWeight:700,marginBottom:2}}>{v.name}</div>
                      <div style={{fontSize:9,color:'#86efac33'}}>{v.desc}</div>
                    </div>
                    {selectedVerifier?.code===v.code&&<span style={{marginLeft:'auto',color:'#a78bfa'}}>✓</span>}
                  </div>
                </div>
              ))}
              <div className="tm-field" style={{marginTop:14}}>
                <label className="tm-label">YOUR CONTACT EMAIL</label>
                <input className="tm-input" type="email" placeholder="esg@company.com"
                  value={verifierContact} onChange={e=>setVerifierContact(e.target.value)}/>
              </div>
              <div className="tm-field">
                <label className="tm-label">NOTES (optional)</label>
                <input className="tm-input" placeholder="e.g. Need BRSR Level 2 assurance for FY2025"
                  value={verifierNotes} onChange={e=>setVerifierNotes(e.target.value)}/>
              </div>
            </div>
            <div className="tm-modal-foot">
              <button className="tm-btn tm-btn-g" onClick={()=>setShowVerifier(false)}>CANCEL</button>
              <button className="tm-btn tm-btn-p" onClick={handleRequestVerifier}>SUBMIT REQUEST →</button>
            </div>
          </div>
        </div>
      )}

      {toast&&(
        <div className="tm-toast" style={{border:`1px solid ${toast.type==='error'?'#f8717122':'#22c55e22'}`,color:toast.type==='error'?'#f8717199':'#22c55e88'}}>
          {toast.msg}
        </div>
      )}
    </>
  );
}