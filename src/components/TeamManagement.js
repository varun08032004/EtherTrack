// src/components/TeamManagement.js — EtherTrack RBAC Team UI
import React, { useState, useEffect, useContext } from 'react';
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
  { code:'BV',       name:'Bureau Veritas',  logo:'🔵', desc:'ISO 14065 accredited, India presence' },
  { code:'DNV',      name:'DNV',             logo:'🟢', desc:'Gold Standard & Verra approved verifier' },
  { code:'EY',       name:'EY Climate',      logo:'🟡', desc:'Big 4 ESG assurance, BRSR specialist' },
  { code:'DELOITTE', name:'Deloitte',         logo:'🔷', desc:'Big 4 sustainability assurance' },
  { code:'TUV',      name:'TÜV SÜD',         logo:'🔴', desc:'CDM & VCS methodology expert' },
  { code:'BSI',      name:'BSI Group',        logo:'🟠', desc:'ISO 14064-3 verification body' },
  { code:'KPMG',     name:'KPMG ESG',        logo:'🔵', desc:'TCFD & CDP reporting specialist' },
  { code:'OTHER',    name:'Other Verifier',  logo:'⚪', desc:'Enter verifier details manually' },
];

const PLAN_META = {
  starter:    { label:'STARTER',    color:'#86efac44', seats:3,  price:'₹2,500/mo' },
  growth:     { label:'GROWTH',     color:'#22c55e',   seats:10, price:'₹8,000/mo' },
  enterprise: { label:'ENTERPRISE', color:'#f97316',   seats:50, price:'₹25,000/mo' },
};

export default function TeamManagement() {
  const { dbUser } = useContext(AuthContext);
  const [org,         setOrg]         = useState(null);
  const [teamRole,    setTeamRole]    = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [members,     setMembers]     = useState([]);
  const [verifiers,   setVerifiers]   = useState([]);
  const [tab,         setTab]         = useState('team');
  const [loading,     setLoading]     = useState(true);
  const [toast,       setToast]       = useState(null);

  // Create org form
  const [showCreate,  setShowCreate]  = useState(false);
  const [createForm,  setCreateForm]  = useState({ name:'', cin:'', gstin:'', pan:'', industry:'', companyType:'' });

  // Invite form
  const [showInvite,  setShowInvite]  = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole,  setInviteRole]  = useState('viewer');
  const [inviting,    setInviting]    = useState(false);

  // Verifier request form
  const [showVerifier,    setShowVerifier]    = useState(false);
  const [selectedVerifier, setSelectedVerifier] = useState(null);
  const [verifierContact,  setVerifierContact]  = useState('');
  const [verifierNotes,    setVerifierNotes]    = useState('');

  const showToast = (msg, type='success') => { setToast({msg,type}); setTimeout(()=>setToast(null),4000); };

  const can = (perm) => permissions.includes(perm);

  useEffect(() => { loadOrg(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadOrg = async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/api/org/me');
      if (data.org) {
        setOrg(data.org);
        setTeamRole(data.teamRole);
        setPermissions(data.permissions || []);
        await loadMembers(data.org.id);
        await loadVerifiers(data.org.id);
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

  const loadVerifiers = async (orgId) => {
    try {
      const data = await apiFetch(`/api/org/${orgId}/verifiers`);
      setVerifiers(data.verifiers || []);
    } catch {}
  };

  const handleCreateOrg = async () => {
    if (!createForm.name.trim()) return showToast('Organisation name required', 'error');
    try {
      const data = await apiFetch('/api/org/create', {
        method: 'POST',
        body: JSON.stringify(createForm),
      });
      setOrg(data.org); setTeamRole('owner');
      setPermissions([]); setShowCreate(false);
      showToast('✅ Organisation created!');
      await loadOrg();
    } catch(e) { showToast(`❌ ${e.message}`, 'error'); }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return showToast('Email required', 'error');
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
    if (!selectedVerifier) return showToast('Select a verifier', 'error');
    try {
      await apiFetch(`/api/org/${org.id}/verifiers/request`, {
        method: 'POST',
        body: JSON.stringify({
          verifierName:  selectedVerifier.name,
          verifierCode:  selectedVerifier.code,
          contactEmail:  verifierContact,
          notes:         verifierNotes,
        }),
      });
      showToast(`✅ Request submitted for ${selectedVerifier.name}. We'll reach out to them on your behalf.`);
      setShowVerifier(false); setSelectedVerifier(null); setVerifierContact(''); setVerifierNotes('');
      await loadVerifiers(org.id);
    } catch(e) { showToast(`❌ ${e.message}`, 'error'); }
  };

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
    *{box-sizing:border-box;}
    .tm{min-height:100vh;background:#040706;font-family:'DM Mono',monospace;color:#f0fdf4;padding:32px 24px 80px;}
    .tmw{max-width:1100px;margin:0 auto;}
    .tm-hdr{margin-bottom:28px;}
    .tm-hdr-label{font-size:9px;color:#86efac44;letter-spacing:.2em;margin-bottom:6px;}
    .tm-hdr-title{font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:#f0fdf4;}
    .tm-hdr-title span{color:#22c55e;}
    .tm-hdr-sub{font-size:10px;color:#86efac33;letter-spacing:.1em;margin-top:4px;}
    .tm-tabs{display:flex;gap:5px;margin-bottom:24px;flex-wrap:wrap;}
    .tm-tab{padding:8px 16px;border-radius:6px;border:1px solid #0d1f11;background:#060a07;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.08em;color:#86efac33;transition:all .2s;}
    .tm-tab:hover{border-color:#22c55e22;color:#86efac66;}
    .tm-tab.on{border-color:#22c55e;color:#22c55e;background:#0a1a0e;}
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
    .tm-input{padding:10px 12px;border-radius:7px;border:1px solid #0d1f11;background:#040706;color:#f0fdf4;font-family:'DM Mono',monospace;font-size:11px;outline:none;transition:border-color .2s;width:100%;}
    .tm-input:focus{border-color:#22c55e33;}
    .tm-label{font-size:9px;color:#86efac44;letter-spacing:.12em;margin-bottom:5px;display:block;}
    .tm-field{display:flex;flex-direction:column;gap:5px;margin-bottom:14px;}
    .tm-grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
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
    .tm-plan-card{border-radius:10px;padding:20px;border:1px solid #0d1f11;text-align:center;cursor:pointer;transition:all .2s;}
    .tm-plan-card:hover{transform:translateY(-2px);}
    .tm-plan-card.on{border-color:#22c55e44;background:#0a1a0e;}
    .tm-verifier-card{border-radius:10px;padding:16px;border:1px solid #0d1f11;background:#050809;cursor:pointer;transition:all .2s;margin-bottom:8px;}
    .tm-verifier-card:hover{border-color:#a78bfa33;}
    .tm-verifier-card.on{border-color:#a78bfa66;background:#0d0a1a;}
    .tm-perm-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;}
    .tm-perm-tag{font-size:9px;padding:4px 10px;border-radius:4px;border:1px solid #22c55e22;background:#0a1a0e;color:#22c55e88;letter-spacing:.06em;}
    .tm-toast{position:fixed;bottom:24px;right:24px;z-index:9999;background:#070c09;border-radius:8px;padding:12px 20px;font-size:11px;font-family:'DM Mono',monospace;letter-spacing:.06em;box-shadow:0 8px 32px rgba(0,0,0,.8);}
    @keyframes fu{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
    @media(max-width:680px){.tm-grid2{grid-template-columns:1fr;}.tm-perm-grid{grid-template-columns:1fr;}}
  `;

  if (loading) return (
    <>
      <style>{CSS}</style>
      <div className="tm"><div className="tmw" style={{paddingTop:80,textAlign:'center',color:'#86efac33',fontSize:11,letterSpacing:'.1em'}}>LOADING ORGANISATION…</div></div>
    </>
  );

  // ── No org yet ────────────────────────────────────────────────
  if (!org) return (
    <>
      <style>{CSS}</style>
      <div className="tm">
        <div className="tmw">
          <div className="tm-hdr">
            <div className="tm-hdr-label">ORGANISATION · TEAM · RBAC</div>
            <div className="tm-hdr-title">Team <span>Management</span></div>
          </div>
          <div className="tm-card" style={{textAlign:'center',padding:48}}>
            <div style={{fontSize:48,marginBottom:16}}>🏢</div>
            <div style={{fontSize:16,fontWeight:700,color:'#f0fdf4',marginBottom:8,fontFamily:'Syne,sans-serif'}}>Create your Organisation</div>
            <div style={{fontSize:11,color:'#86efac33',marginBottom:24,lineHeight:1.8}}>
              Set up a workspace to invite your ESG team, assign roles,<br/>
              and collaborate on emissions tracking and carbon credits.
            </div>
            <button className="tm-btn tm-btn-p" onClick={()=>setShowCreate(true)}>⊕ CREATE ORGANISATION →</button>
          </div>
        </div>

        {showCreate&&(
          <div className="tm-overlay" onClick={e=>e.target===e.currentTarget&&setShowCreate(false)}>
            <div className="tm-modal">
              <div className="tm-modal-hdr">
                <span className="tm-modal-title">⊕ CREATE ORGANISATION</span>
                <button className="tm-modal-close" onClick={()=>setShowCreate(false)}>✕</button>
              </div>
              <div className="tm-modal-body">
                <div className="tm-grid2">
                  <div className="tm-field" style={{gridColumn:'1/-1'}}>
                    <label className="tm-label">ORGANISATION NAME *</label>
                    <input className="tm-input" placeholder="e.g. Acme Corp Pvt Ltd" value={createForm.name} onChange={e=>setCreateForm(f=>({...f,name:e.target.value}))}/>
                  </div>
                  <div className="tm-field">
                    <label className="tm-label">CIN (MCA)</label>
                    <input className="tm-input" placeholder="e.g. U72900MH2020PTC340021" value={createForm.cin} onChange={e=>setCreateForm(f=>({...f,cin:e.target.value.toUpperCase()}))} maxLength={21}/>
                  </div>
                  <div className="tm-field">
                    <label className="tm-label">GSTIN</label>
                    <input className="tm-input" placeholder="e.g. 27AAPFU0939F1ZV" value={createForm.gstin} onChange={e=>setCreateForm(f=>({...f,gstin:e.target.value.toUpperCase()}))} maxLength={15}/>
                  </div>
                  <div className="tm-field">
                    <label className="tm-label">INDUSTRY</label>
                    <select className="tm-input" value={createForm.industry} onChange={e=>setCreateForm(f=>({...f,industry:e.target.value}))}>
                      <option value="">Select…</option>
                      {['Manufacturing','IT/Software','Finance','Healthcare','Retail','Logistics','Construction','Energy','Agriculture','Education','Other'].map(i=><option key={i}>{i}</option>)}
                    </select>
                  </div>
                  <div className="tm-field">
                    <label className="tm-label">COMPANY TYPE</label>
                    <select className="tm-input" value={createForm.companyType} onChange={e=>setCreateForm(f=>({...f,companyType:e.target.value}))}>
                      <option value="">Select…</option>
                      {['Private Limited','Public Limited','LLP','Partnership','Sole Proprietorship','OPC','Section 8'].map(t=><option key={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{padding:'10px 14px',background:'#0a1628',border:'1px solid #60a5fa22',borderRadius:8,fontSize:10,color:'#60a5fa88',lineHeight:1.7}}>
                  ℹ️ Your account becomes the <strong style={{color:'#60a5fa'}}>Owner</strong> of this organisation.
                  You can invite team members after creation. Trial plan includes 3 seats free for 30 days.
                </div>
              </div>
              <div className="tm-modal-foot">
                <button className="tm-btn tm-btn-g" onClick={()=>setShowCreate(false)}>CANCEL</button>
                <button className="tm-btn tm-btn-p" onClick={handleCreateOrg}>CREATE ORGANISATION →</button>
              </div>
            </div>
          </div>
        )}

        {toast&&<div className="tm-toast" style={{border:`1px solid ${toast.type==='error'?'#f8717122':'#22c55e22'}`,color:toast.type==='error'?'#f8717199':'#22c55e88'}}>{toast.msg}</div>}
      </div>
    </>
  );

  const plan = PLAN_META[org.subscription_plan] || PLAN_META.starter;
  const activeMembers = members.filter(m=>m.status==='active').length;

  return (
    <>
      <style>{CSS}</style>
      <div className="tm">
        <div className="tmw">

          <div className="tm-hdr">
            <div className="tm-hdr-label">ORGANISATION · TEAM · RBAC · VERIFIER</div>
            <div className="tm-hdr-title">{org.name} <span>Team</span></div>
            <div className="tm-hdr-sub">
              {org.industry} · {activeMembers}/{org.seats_limit} seats ·{' '}
              <span style={{color:plan.color,fontWeight:700}}>{plan.label}</span> plan ·{' '}
              Your role: <span style={{color:ROLE_META[teamRole]?.color||'#22c55e',fontWeight:700}}>{ROLE_META[teamRole]?.icon} {teamRole?.toUpperCase()}</span>
            </div>
          </div>

          {/* Org identity strip */}
          <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:20}}>
            {org.cin&&<span style={{fontSize:9,padding:'4px 10px',borderRadius:4,background:'#0a1628',color:'#60a5fa88',border:'1px solid #60a5fa22'}}>CIN: {org.cin}</span>}
            {org.gstin&&<span style={{fontSize:9,padding:'4px 10px',borderRadius:4,background:'#0a1a0e',color:'#22c55e88',border:'1px solid #22c55e22'}}>GSTIN: {org.gstin}</span>}
            {org.industry&&<span style={{fontSize:9,padding:'4px 10px',borderRadius:4,background:'#0d1f11',color:'#86efac44',border:'1px solid #0d1f11'}}>{org.industry}</span>}
            {org.subscription_status==='trial'&&(
              <span style={{fontSize:9,padding:'4px 10px',borderRadius:4,background:'#110a00',color:'#f59e0b88',border:'1px solid #f59e0b22'}}>
                ⏳ Trial ends {new Date(org.trial_ends_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}
              </span>
            )}
          </div>

          <div className="tm-tabs">
            {[['team','TEAM'],['roles','ROLES & PERMISSIONS'],['verifiers','VERIFIERS'],['plan','PLAN']].map(([k,v])=>(
              <button key={k} className={`tm-tab${tab===k?' on':''}`} onClick={()=>setTab(k)}>{v}</button>
            ))}
          </div>

          {/* ── TEAM TAB ── */}
          {tab==='team'&&(
            <div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:10}}>
                <div style={{fontSize:11,color:'#86efac33'}}>{activeMembers} active · {org.seats_limit - activeMembers} seats remaining</div>
                {can('team:invite')&&(
                  <button className="tm-btn tm-btn-p" onClick={()=>setShowInvite(true)}>⊕ INVITE MEMBER</button>
                )}
              </div>

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
                        {!m.accepted_at&&<span style={{fontSize:9,color:'#f59e0b88',marginLeft:8}}>⏳ invite pending</span>}
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
                      {can('team:change_role')&&!isMe&&m.team_role!=='owner'&&(
                        <select className="tm-role-select" value={m.team_role}
                          onChange={e=>handleChangeRole(m.user_id, e.target.value)}>
                          {['admin','manager','auditor','viewer'].map(r=>(
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      )}
                      {can('team:remove')&&!isMe&&m.team_role!=='owner'&&(
                        <button className="tm-btn tm-btn-r tm-btn-sm"
                          onClick={()=>handleRemoveMember(m.user_id, m.full_name||m.email)}>
                          ✕
                        </button>
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
          {tab==='roles'&&(
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

              {/* Permissions matrix */}
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
                      ].map(([label, perm])=>{
                        const allowed = PERMISSIONS[perm] || [];
                        return (
                          <tr key={perm} style={{borderBottom:'1px solid #0d1f1122'}}>
                            <td style={{padding:'8px 12px',color:'#86efac88'}}>{label}</td>
                            {['owner','admin','manager','auditor','viewer'].map(r=>(
                              <td key={r} style={{padding:'8px 12px',textAlign:'center'}}>
                                {allowed.includes(r)
                                  ? <span style={{color:'#22c55e'}}>✓</span>
                                  : <span style={{color:'#86efac22'}}>—</span>
                                }
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Your current permissions */}
              <div className="tm-card">
                <div className="tm-card-title">YOUR PERMISSIONS AS {teamRole?.toUpperCase()}</div>
                <div className="tm-perm-grid">
                  {permissions.map(p=>(
                    <div key={p} className="tm-perm-tag">✓ {p}</div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── VERIFIERS TAB ── */}
          {tab==='verifiers'&&(
            <div>
              <div style={{padding:'14px 18px',background:'#0d0a1a',border:'1px solid #a78bfa22',borderRadius:10,marginBottom:20,fontSize:11,color:'#a78bfa88',lineHeight:1.8}}>
                🔍 <strong style={{color:'#a78bfa'}}>Third-Party Verification</strong> — Connect an accredited verifier (Bureau Veritas, DNV, EY, etc.)
                to add a verification badge to your PDF reports. Required for Level 2 BRSR assurance and CDP verified submissions.
                <div style={{marginTop:6,fontSize:10,color:'#a78bfa55'}}>
                  Once your product is ready, EtherTrack will contact these verifiers on your behalf to set up API integration.
                </div>
              </div>

              {/* Existing connections */}
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
                        background:v.status==='connected'?'#0d2e1f':v.status==='verified'?'#0d2e1f':'#110a00',
                        color:v.status==='connected'?'#22c55e':v.status==='verified'?'#22c55e':'#f59e0b',
                        border:`1px solid ${v.status==='verified'?'#22c55e33':'#f59e0b22'}`}}>
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

              {/* Available verifiers preview */}
              <div style={{fontSize:9,color:'#86efac44',letterSpacing:'.14em',marginBottom:10}}>AVAILABLE VERIFIERS</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
                {VERIFIER_OPTIONS.filter(v=>v.code!=='OTHER').map(v=>(
                  <div key={v.code} style={{background:'#050809',border:'1px solid #0d1f11',borderRadius:8,padding:14,textAlign:'center'}}>
                    <div style={{fontSize:24,marginBottom:6}}>{v.logo}</div>
                    <div style={{fontSize:10,color:'#f0fdf4',fontWeight:700,marginBottom:4}}>{v.name}</div>
                    <div style={{fontSize:9,color:'#86efac33',lineHeight:1.6}}>{v.desc}</div>
                    <div style={{marginTop:8,fontSize:9,color:'#a78bfa44',fontStyle:'italic'}}>
                      {verifiers.find(c=>c.verifier_code===v.code) ? '✓ Requested' : 'Not connected'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── PLAN TAB ── */}
          {tab==='plan'&&(
            <div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14,marginBottom:20}}>
                {Object.entries(PLAN_META).map(([key,p])=>(
                  <div key={key} className={`tm-plan-card${org.subscription_plan===key?' on':''}`}
                    style={{borderColor:org.subscription_plan===key?`${p.color}44`:'#0d1f11',background:org.subscription_plan===key?`${p.color}08`:'#050809'}}>
                    <div style={{fontSize:10,color:p.color,fontWeight:700,letterSpacing:'.12em',marginBottom:8}}>{p.label}</div>
                    <div style={{fontSize:22,fontWeight:700,color:'#f0fdf4',fontFamily:'Syne,sans-serif',marginBottom:4}}>{p.price}</div>
                    <div style={{fontSize:10,color:'#86efac44',marginBottom:12}}>{p.seats} seats included</div>
                    {({
                        starter:    ['Emissions tracking','Portfolio (5 credits max)','Basic exports (CSV)'],
                        growth:     ['Unlimited emissions','Portfolio (50 credits)','BRSR/CDP/TCFD PDF exports','Team collaboration (10 seats)','Priority support'],
                        enterprise: ['Unlimited everything','50 seats','White-label reports','Verifier API integration','Dedicated account manager','SLA guarantee'],
                      }[key]||[]).map(f=>(
                        <div key={f} style={{fontSize:10,color:'#86efac88',marginBottom:5,textAlign:'left'}}>✓ {f}</div>
                      ))
                    }
                    {org.subscription_plan===key
                      ? <div style={{marginTop:14,fontSize:10,color:p.color,fontWeight:700}}>✓ CURRENT PLAN</div>
                      : <button className="tm-btn tm-btn-p" style={{marginTop:14,width:'100%',opacity:.6}}>
                          UPGRADE → (Coming Soon)
                        </button>
                    }
                  </div>
                ))}
              </div>
              <div style={{padding:'14px 18px',background:'#060e18',border:'1px solid #60a5fa22',borderRadius:10,fontSize:10,color:'#60a5fa88',lineHeight:1.8}}>
                💳 Billing integration coming soon. For enterprise pricing or early access, contact{' '}
                <a href="mailto:hello@ethertrack.in" style={{color:'#60a5fa'}}>hello@ethertrack.in</a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Invite Modal */}
      {showInvite&&(
        <div className="tm-overlay" onClick={e=>e.target===e.currentTarget&&setShowInvite(false)}>
          <div className="tm-modal">
            <div className="tm-modal-hdr">
              <span className="tm-modal-title">⊕ INVITE TEAM MEMBER</span>
              <button className="tm-modal-close" onClick={()=>setShowInvite(false)}>✕</button>
            </div>
            <div className="tm-modal-body">
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
                        <div style={{fontSize:11,color:inviteRole===r?rm.color:'#86efac44',fontWeight:700,marginBottom:3}}>
                          {rm.icon} {rm.label}
                        </div>
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

      {/* Verifier Request Modal */}
      {showVerifier&&(
        <div className="tm-overlay" onClick={e=>e.target===e.currentTarget&&setShowVerifier(false)}>
          <div className="tm-modal" style={{maxWidth:580}}>
            <div className="tm-modal-hdr">
              <span className="tm-modal-title">🔍 REQUEST VERIFIER CONNECTION</span>
              <button className="tm-modal-close" onClick={()=>setShowVerifier(false)}>✕</button>
            </div>
            <div className="tm-modal-body">
              <div style={{fontSize:10,color:'#a78bfa88',marginBottom:16,lineHeight:1.7,padding:'10px 14px',background:'#0d0a1a',borderRadius:8,border:'1px solid #a78bfa22'}}>
                Select a verifier below. EtherTrack will contact them on your behalf to set up verification access for your reports.
                This is a provision — full API integration is in progress.
              </div>
              {VERIFIER_OPTIONS.map(v=>(
                <div key={v.code} className={`tm-verifier-card${selectedVerifier?.code===v.code?' on':''}`}
                  onClick={()=>setSelectedVerifier(v)}>
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
                <label className="tm-label">YOUR CONTACT EMAIL (for verifier)</label>
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
              <button className="tm-btn tm-btn-p" onClick={handleRequestVerifier}>
                SUBMIT REQUEST →
              </button>
            </div>
          </div>
        </div>
      )}

      {toast&&<div className="tm-toast" style={{border:`1px solid ${toast.type==='error'?'#f8717122':'#22c55e22'}`,color:toast.type==='error'?'#f8717199':'#22c55e88'}}>{toast.msg}</div>}
    </>
  );
}