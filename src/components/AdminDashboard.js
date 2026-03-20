import React, { useState, useEffect, useContext, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../App';
import { apiFetch as globalApiFetch } from '../services/api';

const PINATA_GW = process.env.REACT_APP_PINATA_GATEWAY || 'https://gateway.pinata.cloud/ipfs';
const apiFetch = (path, opts = {}) => globalApiFetch(path, opts);

const TABS = [
  { id: 'overview',    label: '⚡ Overview'    },
  { id: 'kyc',         label: '🔍 KYC Queue'   },
  { id: 'credits',     label: '🌿 Credits'     },
  { id: 'accounts',    label: '👤 Accounts'    },
  { id: 'disputes',    label: '⚖️ Disputes'    },
  { id: 'audit',       label: '📋 Audit Log'   },
  { id: 'compliance',  label: '🛡 Compliance'  },
];

const Modal = ({ title, children, onClose }) => (
  <div style={M.overlay}>
    <div style={M.box}>
      <div style={M.mTitle}>{title}</div>
      {children}
      <button style={M.closeBtn} onClick={onClose}>✕ CLOSE</button>
    </div>
  </div>
);

const AdminDashboard = () => {
  const { dbUser, handleLogout } = useContext(AuthContext);
  const navigate = useNavigate();

  const [tab,           setTab]           = useState('overview');
  const [stats,         setStats]         = useState(null);
  const [kyc,           setKyc]           = useState([]);
  const [credits,       setCredits]       = useState([]);
  const [users,         setUsers]         = useState([]);
  const [disputes,      setDisputes]      = useState([]);
  const [audit,         setAudit]         = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [modal,         setModal]         = useState(null);
  const [reason,        setReason]        = useState('');
  const [search,        setSearch]        = useState('');
  const [userFilter,    setUserFilter]    = useState('');
  const [kycFilter,     setKycFilter]     = useState('pending');
  const [creditFilter,  setCreditFilter]  = useState('pending');
  const [toast,         setToast]         = useState('');
  const [retryingId,    setRetryingId]    = useState(null);
  const [retryingAll,   setRetryingAll]   = useState(false);
  const [failedMints,   setFailedMints]   = useState([]);

  // ── Compliance state ──────────────────────────────────────────
  const [compTab,       setCompTab]       = useState('flags');   // flags | tds | fema | config
  const [compFlags,     setCompFlags]     = useState([]);
  const [compTDS,       setCompTDS]       = useState([]);
  const [compFEMA,      setCompFEMA]      = useState([]);
  const [compConfig,    setCompConfig]    = useState([]);
  const [compLoading,   setCompLoading]   = useState(false);
  const [flagFilter,    setFlagFilter]    = useState('open');     // open | reviewed | cleared | escalated | all
  const [flagSeverity,  setFlagSeverity]  = useState('');
  const [fyFilter,      setFyFilter]      = useState('');
  const [editingConfig, setEditingConfig] = useState({});        // key → new value being edited
  const [compStats,     setCompStats]     = useState({
    openFlags: 0, criticalFlags: 0, totalTds: 0, totalConversions: 0,
  });

  const showToast = (msg, duration = 3000) => {
    setToast(msg);
    setTimeout(() => setToast(''), duration);
  };

  // ── Loaders ───────────────────────────────────────────────────
  const loadStats = useCallback(async () => {
    try { setStats(await apiFetch('/api/admin/stats')); } catch {}
  }, []);

  const loadKYC = useCallback(async () => {
    setLoading(true);
    try { const d = await apiFetch(`/api/admin/kyc?status=${kycFilter}`); setKyc(d.submissions); }
    catch {} finally { setLoading(false); }
  }, [kycFilter]);

  const loadCredits = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiFetch(`/api/admin/credits?status=${creditFilter}`);
      setCredits(d.credits);
      setFailedMints(d.credits.filter(c => c.admin_status === 'approved' && !c.token_id));
    }
    catch {} finally { setLoading(false); }
  }, [creditFilter]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search)     params.set('search', search);
      if (userFilter) params.set('status', userFilter);
      const d = await apiFetch(`/api/admin/users?${params}`);
      setUsers(d.users);
    } catch {} finally { setLoading(false); }
  }, [search, userFilter]);

  const loadDisputes = useCallback(async () => {
    setLoading(true);
    try { const d = await apiFetch('/api/admin/disputes'); setDisputes(d.disputes); }
    catch {} finally { setLoading(false); }
  }, []);

  const loadAudit = useCallback(async () => {
    setLoading(true);
    try { const d = await apiFetch('/api/admin/audit'); setAudit(d.logs); }
    catch {} finally { setLoading(false); }
  }, []);

  // ── Compliance loaders ────────────────────────────────────────
  const loadCompFlags = useCallback(async () => {
    setCompLoading(true);
    try {
      const params = new URLSearchParams();
      if (flagFilter   && flagFilter !== 'all') params.set('status',   flagFilter);
      if (flagSeverity) params.set('severity', flagSeverity);
      params.set('limit', '100');
      const d = await apiFetch(`/api/compliance/flags?${params}`);
      setCompFlags(d.flags || []);
      // derive stats
      const open     = (d.flags||[]).filter(f => f.status === 'open').length;
      const critical = (d.flags||[]).filter(f => f.severity === 'critical' && f.status === 'open').length;
      setCompStats(prev => ({ ...prev, openFlags: open, criticalFlags: critical }));
    } catch {} finally { setCompLoading(false); }
  }, [flagFilter, flagSeverity]);

  const loadCompTDS = useCallback(async () => {
    setCompLoading(true);
    try {
      const params = new URLSearchParams();
      if (fyFilter) params.set('fy', fyFilter);
      const d = await apiFetch(`/api/compliance/tds?${params}`);
      setCompTDS(d.records || []);
      setCompStats(prev => ({ ...prev, totalTds: d.totalTds || 0 }));
    } catch {} finally { setCompLoading(false); }
  }, [fyFilter]);

  const loadCompFEMA = useCallback(async () => {
    setCompLoading(true);
    try {
      const d = await apiFetch('/api/compliance/fema');
      setCompFEMA(d.conversions || []);
      setCompStats(prev => ({ ...prev, totalConversions: d.totalTx || 0 }));
    } catch {} finally { setCompLoading(false); }
  }, []);

  const loadCompConfig = useCallback(async () => {
    setCompLoading(true);
    try {
      const d = await apiFetch('/api/compliance/config');
      setCompConfig(d.config || []);
    } catch {} finally { setCompLoading(false); }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => {
    if (tab === 'kyc')        loadKYC();
    if (tab === 'credits')    loadCredits();
    if (tab === 'accounts')   loadUsers();
    if (tab === 'disputes')   loadDisputes();
    if (tab === 'audit')      loadAudit();
    if (tab === 'compliance') {
      loadCompFlags();
      loadCompTDS();
      loadCompFEMA();
      loadCompConfig();
    }
  }, [tab, loadKYC, loadCredits, loadUsers, loadDisputes, loadAudit, loadCompFlags, loadCompTDS, loadCompFEMA, loadCompConfig]);

  useEffect(() => {
    if (tab === 'compliance' && compTab === 'flags') loadCompFlags();
  }, [flagFilter, flagSeverity]);

  useEffect(() => {
    if (tab === 'compliance' && compTab === 'tds') loadCompTDS();
  }, [fyFilter]);

  // ── Compliance actions ────────────────────────────────────────
  const reviewFlag = async (flagId, status, notes) => {
    try {
      await apiFetch(`/api/compliance/flags/${flagId}`, {
        method: 'PUT',
        body: JSON.stringify({ status, reviewNotes: notes }),
      });
      showToast(`Flag marked as ${status}`);
      setModal(null); setReason('');
      loadCompFlags();
    } catch (e) { showToast(`Error: ${e.message}`); }
  };

  const saveConfig = async (key, value) => {
    try {
      await apiFetch(`/api/compliance/config/${key}`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      });
      showToast(`✅ ${key} updated to ${value}`);
      setEditingConfig(prev => { const n = {...prev}; delete n[key]; return n; });
      loadCompConfig();
    } catch (e) { showToast(`Error: ${e.message}`); }
  };

  // ── Existing actions ──────────────────────────────────────────
  const kycAction = async (id, action) => {
    try {
      await apiFetch(`/api/admin/kyc/${id}/${action}`, { method:'POST', body:JSON.stringify({ reason }) });
      showToast(`KYC ${action}d successfully`);
      setModal(null); setReason('');
      loadKYC(); loadStats();
    } catch (e) { showToast(`Error: ${e.message}`); }
  };

  const creditAction = async (id, action) => {
    try {
      await apiFetch(`/api/admin/credits/${id}/${action}`, {
        method:'POST',
        body: JSON.stringify(action === 'approve' ? { notes: reason } : { reason }),
      });
      showToast(`Credit listing ${action}d`);
      setModal(null); setReason('');
      loadCredits(); loadStats();
    } catch (e) { showToast(`Error: ${e.message}`); }
  };

  const freezeAction = async (id, action) => {
    try {
      await apiFetch(`/api/admin/users/${id}/${action}`, { method:'POST', body:JSON.stringify({ reason }) });
      showToast(`Account ${action}d`);
      setModal(null); setReason('');
      loadUsers(); loadStats();
    } catch (e) { showToast(`Error: ${e.message}`); }
  };

  const resolveDispute = async (id) => {
    try {
      await apiFetch(`/api/admin/disputes/${id}/resolve`, { method:'POST', body:JSON.stringify({ resolution: reason }) });
      showToast('Dispute resolved');
      setModal(null); setReason('');
      loadDisputes(); loadStats();
    } catch (e) { showToast(`Error: ${e.message}`); }
  };

  const retryMint = async (batchId) => {
    setRetryingId(batchId);
    try {
      const res = await apiFetch(`/api/admin/credits/${batchId}/retry-mint`, { method:'POST' });
      if (res.success) showToast(`✅ Mint successful! Token #${res.tokenId}`);
      else showToast(`❌ Mint failed: ${res.error || 'Unknown error'}`);
      loadCredits(); loadStats();
    } catch (e) { showToast(`❌ Retry failed: ${e.message}`); }
    finally { setRetryingId(null); }
  };

  const retryAllMints = async () => {
    if (!failedMints.length) return;
    setRetryingAll(true);
    let success = 0, failed = 0;
    for (const batch of failedMints) {
      try {
        const res = await apiFetch(`/api/admin/credits/${batch.id}/retry-mint`, { method:'POST' });
        if (res.success) success++; else failed++;
      } catch { failed++; }
    }
    showToast(`✅ ${success} minted · ❌ ${failed} failed`, 5000);
    setRetryingAll(false);
    loadCredits(); loadStats();
  };

  const fmt = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—';
  const fmtTime = (d) => d ? new Date(d).toLocaleString('en-IN') : '—';
  const fmtINR  = (n) => `₹${parseFloat(n||0).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 })}`;

  const Badge = ({ status }) => {
    const color = {
      pending:'#f59e0b', approved:'#22c55e', verified:'#22c55e',
      rejected:'#f87171', frozen:'#f87171', open:'#f59e0b',
      resolved:'#22c55e', mint_failed:'#f87171', minted:'#22c55e',
      cleared:'#22c55e', reviewed:'#60a5fa', escalated:'#f87171',
      low:'#22c55e', medium:'#f59e0b', high:'#f97316', critical:'#f87171',
      deducted:'#f59e0b', deposited:'#60a5fa', filed:'#22c55e',
    }[status] || '#86efac44';
    return (
      <span style={{ fontSize:9, padding:'3px 8px', borderRadius:20, border:`1px solid ${color}33`, color, letterSpacing:'.08em' }}>
        {status?.toUpperCase().replace(/_/g,' ')}
      </span>
    );
  };

  const MintBadge = ({ credit }) => {
    if (credit.token_id != null) return (
      <span style={{ fontSize:9, padding:'3px 8px', borderRadius:20, border:'1px solid #22c55e33', color:'#22c55e', letterSpacing:'.08em' }}>
        ✓ TOKEN #{credit.token_id}
      </span>
    );
    if (credit.admin_status === 'approved') return (
      <span style={{ fontSize:9, padding:'3px 8px', borderRadius:20, border:'1px solid #f8717133', color:'#f87171', letterSpacing:'.08em', animation:'pulse 2s infinite' }}>
        ⚠ MINT FAILED
      </span>
    );
    return <span style={{ fontSize:9, color:'#86efac33' }}>—</span>;
  };

  // ── Severity color helper ─────────────────────────────────────
  const sevColor = { low:'#22c55e', medium:'#f59e0b', high:'#f97316', critical:'#f87171' };
  const flagTypeLabel = {
    ctr:           '🚨 CTR',
    daily_limit:   '📅 DAILY LIMIT',
    monthly_limit: '📆 MONTHLY LIMIT',
    velocity:      '⚡ VELOCITY',
    structuring:   '⚠ STRUCTURING',
    inr_crypto_conv: '🔄 FEMA CONV',
  };

  return (
    <div style={S.page}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>

      {toast && <div style={S.toast}>{toast}</div>}

      {/* Sidebar */}
      <div style={S.sidebar}>
        <div style={S.sideTop}>
          <div style={S.logo}>⚡ ETHERTRACK</div>
          <div style={S.logoSub}>ADMIN CONSOLE</div>
        </div>
        {TABS.map(t => (
          <button key={t.id}
            style={{ ...S.navBtn, ...(tab === t.id ? S.navBtnActive : {}) }}
            onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'kyc'        && stats?.pendingKYC     > 0 && <span style={S.badge}>{stats.pendingKYC}</span>}
            {t.id === 'credits'    && stats?.pendingCredits > 0 && <span style={S.badge}>{stats.pendingCredits}</span>}
            {t.id === 'disputes'   && stats?.openDisputes   > 0 && <span style={S.badge}>{stats.openDisputes}</span>}
            {t.id === 'compliance' && compStats.criticalFlags > 0 && (
              <span style={{ ...S.badge, background:'#f87171' }}>{compStats.criticalFlags}</span>
            )}
          </button>
        ))}
        <div style={{ marginTop:'auto', padding:'16px' }}>
          <div style={{ fontSize:10, color:'#f59e0bbb', marginBottom:6 }}>{dbUser?.email}</div>
          <button style={S.logoutBtn} onClick={handleLogout}>LOGOUT</button>
        </div>
      </div>

      {/* Main */}
      <div style={S.main}>

        {/* ── OVERVIEW ── */}
        {tab === 'overview' && (
          <>
            <div style={S.pageTitle}>Platform Overview</div>
            <div style={S.statsGrid}>
              {[
                { label:'PENDING KYC',      value: stats?.pendingKYC     ?? '—', color:'#f59e0b', icon:'🔍' },
                { label:'PENDING CREDITS',  value: stats?.pendingCredits ?? '—', color:'#60a5fa', icon:'🌿' },
                { label:'TOTAL USERS',      value: stats?.totalUsers     ?? '—', color:'#22c55e', icon:'👤' },
                { label:'FROZEN ACCOUNTS',  value: stats?.frozenAccounts ?? '—', color:'#f87171', icon:'🔒' },
                { label:'OPEN DISPUTES',    value: stats?.openDisputes   ?? '—', color:'#a78bfa', icon:'⚖️' },
                { label:'VERIFIED USERS',   value: stats?.verifiedUsers  ?? '—', color:'#34d399', icon:'✅' },
              ].map(({ label, value, color, icon }) => (
                <div key={label} style={S.statCard}>
                  <div style={{ fontSize:28, marginBottom:8 }}>{icon}</div>
                  <div style={{ fontSize:32, fontWeight:700, color, marginBottom:4 }}>{value}</div>
                  <div style={{ fontSize:9, color:'#f59e0bcc', letterSpacing:'.12em' }}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{ ...S.section, marginTop:24 }}>
              <div style={S.sectionTitle}>QUICK ACTIONS</div>
              <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                {[
                  { label:'Review KYC Queue',       action: () => setTab('kyc')        },
                  { label:'Review Credit Listings',  action: () => setTab('credits')    },
                  { label:'Manage Accounts',         action: () => setTab('accounts')   },
                  { label:'View Audit Log',          action: () => setTab('audit')      },
                  { label:'Compliance Dashboard →',  action: () => setTab('compliance') },
                ].map(({ label, action }) => (
                  <button key={label} style={S.quickBtn} onClick={action}>{label} →</button>
                ))}
              </div>
            </div>
            <div style={{ ...S.section, marginTop:16 }}>
              <div style={S.sectionTitle}>PLATFORM HEALTH</div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:10 }}>
                {[
                  { label:'Backend API',     status:'online', note:'Railway'               },
                  { label:'Supabase DB',     status:'online', note:'aws-ap-south-1'        },
                  { label:'Pinata IPFS',     status:'online', note:'ipfs gateway'          },
                  { label:'Ethereum Sepolia',status:'online', note:'alchemy rpc'           },
                  { label:'Email (Resend)',  status:'online', note:'onboarding@resend.dev' },
                ].map(({ label, status, note }) => (
                  <div key={label} style={{ padding:'12px 14px', background:'#0a0800', border:'1px solid #f59e0b22', borderRadius:8 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                      <div style={{ width:7, height:7, borderRadius:'50%', background:status==='online'?'#22c55e':'#f87171', boxShadow:status==='online'?'0 0 6px #22c55e':'0 0 6px #f87171' }}/>
                      <span style={{ fontSize:11, color:'#f0fdf4', fontWeight:500 }}>{label}</span>
                    </div>
                    <div style={{ fontSize:9, color:'#f59e0b88', letterSpacing:'.06em' }}>{note}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── KYC QUEUE ── */}
        {tab === 'kyc' && (
          <div>
            <div style={S.pageTitle}>KYC Queue</div>
            <div style={{ display:'flex', gap:8, marginBottom:20 }}>
              {['pending','approved','rejected'].map(s => (
                <button key={s} style={{ ...S.filterBtn, ...(kycFilter===s ? S.filterBtnActive:{}) }} onClick={() => setKycFilter(s)}>
                  {s.toUpperCase()}
                </button>
              ))}
            </div>
            {loading ? <div style={S.loading}>Loading...</div> : (
              <div style={S.table}>
                <div style={S.tableHead}>
                  {['USER','ID TYPE','SUBMITTED','STATUS','DOC','ACTIONS'].map(h => <div key={h} style={S.th}>{h}</div>)}
                </div>
                {kyc.length === 0 && <div style={S.empty}>No {kycFilter} KYC submissions</div>}
                {kyc.map(k => (
                  <div key={k.id} style={S.tableRow}>
                    <div style={S.td}><div style={{ color:'#f0fdf4', fontSize:11 }}>{k.full_name}</div><div style={{ color:'#f59e0bcc', fontSize:9 }}>{k.email}</div></div>
                    <div style={S.td}><Badge status={k.id_type}/></div>
                    <div style={{ ...S.td, fontSize:10, color:'#f59e0bbb' }}>{fmt(k.submitted_at)}</div>
                    <div style={S.td}><Badge status={k.status}/></div>
                    <div style={S.td}>{k.doc_ipfs_hash ? <a href={`${PINATA_GW}/${k.doc_ipfs_hash}`} target="_blank" rel="noreferrer" style={{ fontSize:10, color:'#60a5fa', textDecoration:'none' }}>VIEW DOC ↗</a> : <span style={{ fontSize:10, color:'#f59e0bdd' }}>—</span>}</div>
                    <div style={{ ...S.td, display:'flex', gap:6 }}>
                      <button style={S.viewBtn} onClick={() => setModal({ type:'kyc_detail', data:k })}>DETAILS</button>
                      {k.status === 'pending' && (<><button style={S.approveBtn} onClick={() => setModal({ type:'kyc_approve', data:k })}>✓</button><button style={S.rejectBtn} onClick={() => setModal({ type:'kyc_reject', data:k })}>✕</button></>)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── CREDIT LISTINGS ── */}
        {tab === 'credits' && (
          <div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24, flexWrap:'wrap', gap:12 }}>
              <div style={S.pageTitle}>Carbon Credit Listings</div>
              {failedMints.length > 0 && (
                <button style={{ padding:'10px 18px', borderRadius:6, border:'1px solid #f8717166', background:retryingAll?'#1a0707':'#f8717111', color:'#f87171', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:11, letterSpacing:'.06em', display:'flex', alignItems:'center', gap:8 }}
                  onClick={retryAllMints} disabled={retryingAll}>
                  {retryingAll ? <><span style={S.spinner}/>RETRYING {failedMints.length} MINTS...</> : <>⚠ RETRY {failedMints.length} FAILED MINT{failedMints.length>1?'S':''}</>}
                </button>
              )}
            </div>
            {failedMints.length > 0 && creditFilter !== 'approved' && (
              <div style={{ padding:'12px 16px', borderRadius:8, marginBottom:16, background:'#1a0707', border:'1px solid #f8717133', display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontSize:16 }}>⚠️</span>
                <div>
                  <div style={{ fontSize:11, color:'#f87171', fontWeight:700 }}>{failedMints.length} credit{failedMints.length>1?'s':''} approved but not yet minted on-chain</div>
                  <div style={{ fontSize:10, color:'#f8717188', marginTop:2 }}>Switch to APPROVED filter to see them, or click "Retry Failed Mints" above</div>
                </div>
                <button style={{ marginLeft:'auto', ...S.filterBtn, borderColor:'#f8717133', color:'#f87171' }} onClick={() => setCreditFilter('approved')}>VIEW →</button>
              </div>
            )}
            <div style={{ display:'flex', gap:8, marginBottom:20 }}>
              {['pending','approved','rejected'].map(s => (
                <button key={s} style={{ ...S.filterBtn, ...(creditFilter===s?S.filterBtnActive:{}), ...(s==='approved'&&failedMints.length>0?{borderColor:'#f8717144',color:'#f87171cc'}:{}) }} onClick={() => setCreditFilter(s)}>
                  {s.toUpperCase()}{s==='approved'&&failedMints.length>0&&<span style={{ marginLeft:6, background:'#f87171', color:'#fff', fontSize:8, padding:'1px 5px', borderRadius:8 }}>{failedMints.length} FAILED</span>}
                </button>
              ))}
            </div>
            {loading ? <div style={S.loading}>Loading...</div> : (
              <div style={S.table}>
                <div style={{ ...S.tableHead, gridTemplateColumns:'2fr 1fr 1.5fr 1fr 1fr 1fr 1.5fr 1.5fr' }}>
                  {['USER','REGISTRY','SERIAL NO.','QUANTITY','VINTAGE','PROOF','MINT STATUS','ACTIONS'].map(h => <div key={h} style={S.th}>{h}</div>)}
                </div>
                {credits.length === 0 && <div style={S.empty}>No {creditFilter} credit listings</div>}
                {credits.map(c => (
                  <div key={c.id} style={{ ...S.tableRow, gridTemplateColumns:'2fr 1fr 1.5fr 1fr 1fr 1fr 1.5fr 1.5fr', ...(c.admin_status==='approved'&&!c.token_id?{background:'#1a070711',borderLeft:'2px solid #f8717133'}:{}) }}>
                    <div style={S.td}><div style={{ color:'#f0fdf4', fontSize:11 }}>{c.full_name}</div><div style={{ color:'#f59e0bcc', fontSize:9 }}>{c.email}</div></div>
                    <div style={{ ...S.td, fontSize:10, color:'#f0fdf4' }}>{c.registry_name||c.standard||'—'}</div>
                    <div style={{ ...S.td, fontSize:10, color:'#60a5fadd', fontFamily:'monospace' }}>{c.registry_serial||'—'}</div>
                    <div style={{ ...S.td, fontSize:11, color:'#22c55e' }}>{c.quantity||'—'}</div>
                    <div style={{ ...S.td, fontSize:10, color:'#f59e0bbb' }}>{c.vintage_year||'—'}</div>
                    <div style={S.td}>{c.doc_ipfs_hash?<a href={`${PINATA_GW}/${c.doc_ipfs_hash}`} target="_blank" rel="noreferrer" style={{ fontSize:10, color:'#60a5fa', textDecoration:'none' }}>VIEW ↗</a>:<span style={{ fontSize:10, color:'#f59e0bdd' }}>—</span>}</div>
                    <div style={S.td}><MintBadge credit={c}/></div>
                    <div style={{ ...S.td, display:'flex', gap:4, flexWrap:'wrap' }}>
                      <button style={S.viewBtn} onClick={() => setModal({ type:'credit_detail', data:c })}>DETAILS</button>
                      {c.admin_status==='pending'&&(<><button style={S.approveBtn} onClick={() => setModal({ type:'credit_approve', data:c })}>✓</button><button style={S.rejectBtn} onClick={() => setModal({ type:'credit_reject', data:c })}>✕</button></>)}
                      {c.admin_status==='approved'&&!c.token_id&&(
                        <button style={{ padding:'4px 8px', borderRadius:4, border:'1px solid #f8717144', background:'#f8717111', color:'#f87171', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:9, display:'flex', alignItems:'center', gap:4, opacity:retryingId===c.id?.6:1 }}
                          onClick={() => retryMint(c.id)} disabled={retryingId===c.id}>
                          {retryingId===c.id?<><span style={{...S.spinner,width:8,height:8}}/>MINTING...</>:<>⟳ RETRY MINT</>}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ACCOUNTS ── */}
        {tab === 'accounts' && (
          <div>
            <div style={S.pageTitle}>Account Management</div>
            <div style={{ display:'flex', gap:8, marginBottom:20, flexWrap:'wrap' }}>
              <input style={S.searchInput} placeholder="Search by name or email..." value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key==='Enter'&&loadUsers()}/>
              {['','frozen','verified','pending'].map(s => (
                <button key={s} style={{ ...S.filterBtn, ...(userFilter===s?S.filterBtnActive:{}) }} onClick={() => setUserFilter(s)}>{s===''?'ALL':s.toUpperCase()}</button>
              ))}
            </div>
            {loading?<div style={S.loading}>Loading...</div>:(
              <div style={S.table}>
                <div style={S.tableHead}>{['USER','WALLET','KYC','STATUS','JOINED','ACTIONS'].map(h=><div key={h} style={S.th}>{h}</div>)}</div>
                {users.length===0&&<div style={S.empty}>No users found</div>}
                {users.map(u=>(
                  <div key={u.id} style={{ ...S.tableRow, ...(u.frozen?{background:'#1a0a0a22'}:{}) }}>
                    <div style={S.td}><div style={{ color:u.frozen?'#f87171':'#f0fdf4', fontSize:11 }}>{u.full_name||'—'} {u.frozen&&'🔒'}</div><div style={{ color:'#f59e0bcc', fontSize:9 }}>{u.email}</div></div>
                    <div style={{ ...S.td, fontSize:9, color:'#60a5facc', fontFamily:'monospace' }}>{u.wallet_address?`${u.wallet_address.slice(0,6)}...${u.wallet_address.slice(-4)}`:'—'}</div>
                    <div style={S.td}><Badge status={u.kyc_status||'pending'}/></div>
                    <div style={S.td}><Badge status={u.frozen?'frozen':'active'}/></div>
                    <div style={{ ...S.td, fontSize:10, color:'#f59e0bbb' }}>{fmt(u.created_at)}</div>
                    <div style={{ ...S.td, display:'flex', gap:6 }}>
                      <button style={S.viewBtn} onClick={() => setModal({ type:'user_detail', data:u })}>VIEW</button>
                      {!u.frozen?<button style={S.rejectBtn} onClick={() => setModal({ type:'freeze', data:u })}>FREEZE</button>:<button style={S.approveBtn} onClick={() => setModal({ type:'unfreeze', data:u })}>UNFREEZE</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── DISPUTES ── */}
        {tab === 'disputes' && (
          <div>
            <div style={S.pageTitle}>Disputes</div>
            <button style={{ ...S.quickBtn, marginBottom:20 }} onClick={() => setModal({ type:'new_dispute' })}>+ OPEN NEW DISPUTE</button>
            {loading?<div style={S.loading}>Loading...</div>:(
              <div style={S.table}>
                <div style={{ ...S.tableHead, gridTemplateColumns:'repeat(5,1fr)' }}>{['TARGET USER','REASON','STATUS','OPENED','ACTIONS'].map(h=><div key={h} style={S.th}>{h}</div>)}</div>
                {disputes.length===0&&<div style={S.empty}>No disputes</div>}
                {disputes.map(d=>(
                  <div key={d.id} style={{ ...S.tableRow, gridTemplateColumns:'repeat(5,1fr)' }}>
                    <div style={S.td}><div style={{ color:'#f0fdf4', fontSize:11 }}>{d.target_name||'—'}</div><div style={{ color:'#f59e0bcc', fontSize:9 }}>{d.target_email}</div></div>
                    <div style={{ ...S.td, fontSize:10, color:'#f59e0bdd', maxWidth:200 }}>{d.reason}</div>
                    <div style={S.td}><Badge status={d.status}/></div>
                    <div style={{ ...S.td, fontSize:10, color:'#f59e0bbb' }}>{fmt(d.created_at)}</div>
                    <div style={S.td}>{d.status==='open'&&<button style={S.approveBtn} onClick={() => setModal({ type:'resolve_dispute', data:d })}>RESOLVE</button>}{d.status==='resolved'&&<span style={{ fontSize:9, color:'#22c55eaa' }}>{d.resolution?.slice(0,40)}...</span>}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── AUDIT LOG ── */}
        {tab === 'audit' && (
          <div>
            <div style={S.pageTitle}>Audit Log</div>
            {loading?<div style={S.loading}>Loading...</div>:(
              <div style={S.table}>
                <div style={{ ...S.tableHead, gridTemplateColumns:'repeat(4,1fr)' }}>{['ACTION','TARGET USER','DETAILS','TIMESTAMP'].map(h=><div key={h} style={S.th}>{h}</div>)}</div>
                {audit.length===0&&<div style={S.empty}>No audit entries</div>}
                {audit.map(a=>(
                  <div key={a.id} style={{ ...S.tableRow, gridTemplateColumns:'repeat(4,1fr)' }}>
                    <div style={S.td}><span style={{ fontSize:9, padding:'3px 8px', borderRadius:20, background:'#1a0f0066', border:'1px solid #f59e0b66', color:'#f59e0b', letterSpacing:'.06em' }}>{a.action}</span></div>
                    <div style={S.td}><div style={{ fontSize:11, color:'#f0fdf4' }}>{a.target_name||'—'}</div><div style={{ fontSize:9, color:'#f59e0bcc' }}>{a.target_email}</div></div>
                    <div style={{ ...S.td, fontSize:10, color:'#f59e0bbb', maxWidth:240 }}>{a.details}</div>
                    <div style={{ ...S.td, fontSize:10, color:'#f59e0baa' }}>{new Date(a.created_at).toLocaleString('en-IN')}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────
            ── COMPLIANCE TAB ──
        ───────────────────────────────────────────────────────── */}
        {tab === 'compliance' && (
          <div>
            <div style={S.pageTitle}>🛡 Compliance Dashboard</div>

            {/* Compliance summary stats */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:24 }}>
              {[
                { label:'OPEN FLAGS',         value: compStats.openFlags,       color:'#f59e0b', icon:'🚩' },
                { label:'CRITICAL FLAGS',     value: compStats.criticalFlags,   color:'#f87171', icon:'🚨' },
                { label:'TOTAL TDS (FY)',     value: `₹${parseFloat(compStats.totalTds||0).toLocaleString('en-IN',{maximumFractionDigits:0})}`, color:'#60a5fa', icon:'📋' },
                { label:'FEMA CONVERSIONS',   value: compStats.totalConversions, color:'#a78bfa', icon:'🔄' },
              ].map(({ label, value, color, icon }) => (
                <div key={label} style={S.statCard}>
                  <div style={{ fontSize:24, marginBottom:8 }}>{icon}</div>
                  <div style={{ fontSize:26, fontWeight:700, color, marginBottom:4 }}>{value}</div>
                  <div style={{ fontSize:9, color:'#f59e0bcc', letterSpacing:'.12em' }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Legal disclaimer banner */}
            <div style={{ padding:'10px 16px', borderRadius:8, marginBottom:20, background:'#0a0800', border:'1px solid #f59e0b33', display:'flex', alignItems:'flex-start', gap:10 }}>
              <span style={{ fontSize:16, flexShrink:0 }}>⚖️</span>
              <div style={{ fontSize:10, color:'#f59e0bbb', lineHeight:1.7 }}>
                <strong style={{ color:'#f59e0b' }}>Legal Note:</strong> This compliance dashboard is a technical implementation.
                TDS deduction records must be deposited with ITNS and filed via TDS return (Form 26Q/27Q) by your CA.
                FEMA conversion logs require legal opinion before mainnet. PPI licence required to hold user funds at scale (RBI MD-PPIs 2021).
              </div>
            </div>

            {/* Sub-tabs */}
            <div style={{ display:'flex', gap:6, marginBottom:20, borderBottom:'1px solid #f59e0b11', paddingBottom:0 }}>
              {[
                { id:'flags',  label:'🚩 AML Flags'        },
                { id:'tds',    label:'📋 TDS Records'      },
                { id:'fema',   label:'🔄 FEMA Log'         },
                { id:'config', label:'⚙️ Limit Config'     },
              ].map(t => (
                <button key={t.id}
                  style={{
                    padding:'9px 16px', border:'none', background:'transparent', cursor:'pointer',
                    fontFamily:"'DM Mono',monospace", fontSize:10, letterSpacing:'.08em',
                    borderBottom:`2px solid ${compTab===t.id?'#f59e0b':'transparent'}`,
                    color: compTab===t.id?'#f59e0b':'#f59e0bcc',
                    marginBottom:-1, transition:'color .2s',
                  }}
                  onClick={() => setCompTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* ── AML FLAGS ── */}
            {compTab === 'flags' && (
              <div>
                {/* Filters */}
                <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
                  <span style={{ fontSize:9, color:'#f59e0baa', letterSpacing:'.1em' }}>STATUS:</span>
                  {['all','open','reviewed','cleared','escalated'].map(s => (
                    <button key={s} style={{ ...S.filterBtn, ...(flagFilter===s?S.filterBtnActive:{}) }} onClick={() => setFlagFilter(s)}>
                      {s.toUpperCase()}
                    </button>
                  ))}
                  <span style={{ fontSize:9, color:'#f59e0baa', letterSpacing:'.1em', marginLeft:8 }}>SEVERITY:</span>
                  {['','low','medium','high','critical'].map(s => (
                    <button key={s} style={{ ...S.filterBtn, ...(flagSeverity===s?S.filterBtnActive:{}), ...(s==='critical'?{borderColor:'#f8717133',color:flagSeverity===s?'#f87171':'#f8717188'}:{}) }}
                      onClick={() => setFlagSeverity(s)}>
                      {s===''?'ALL':s.toUpperCase()}
                    </button>
                  ))}
                </div>

                {compLoading ? <div style={S.loading}>Loading...</div> : (
                  <div style={S.table}>
                    <div style={{ ...S.tableHead, gridTemplateColumns:'1.5fr 1fr 1.2fr 1fr 2fr 1.2fr 1fr' }}>
                      {['USER','FLAG TYPE','AMOUNT','SEVERITY','DESCRIPTION','STATUS','ACTIONS'].map(h => <div key={h} style={S.th}>{h}</div>)}
                    </div>
                    {compFlags.length === 0 && <div style={S.empty}>No compliance flags {flagFilter !== 'all' ? `with status "${flagFilter}"` : ''}</div>}
                    {compFlags.map(f => (
                      <div key={f.id} style={{
                        ...S.tableRow,
                        gridTemplateColumns:'1.5fr 1fr 1.2fr 1fr 2fr 1.2fr 1fr',
                        ...(f.severity==='critical'&&f.status==='open'?{background:'#1a070711',borderLeft:'2px solid #f8717133'}:{}),
                        ...(f.severity==='high'&&f.status==='open'?{background:'#1a0a0011',borderLeft:'2px solid #f9731633'}:{}),
                      }}>
                        <div style={S.td}>
                          <div style={{ color:'#f0fdf4', fontSize:11 }}>{f.full_name||'—'}</div>
                          <div style={{ color:'#f59e0bcc', fontSize:9 }}>{f.email}</div>
                        </div>
                        <div style={S.td}>
                          <span style={{ fontSize:9, padding:'2px 7px', borderRadius:4, background:'#1a0f0066', border:'1px solid #f59e0b33', color:'#f59e0b', letterSpacing:'.06em' }}>
                            {flagTypeLabel[f.flag_type] || f.flag_type}
                          </span>
                        </div>
                        <div style={{ ...S.td, fontSize:11, color:'#f0fdf4' }}>
                          {f.amount ? `₹${parseFloat(f.amount).toLocaleString('en-IN')}` : '—'}
                        </div>
                        <div style={S.td}>
                          <span style={{ fontSize:9, padding:'2px 7px', borderRadius:4, border:`1px solid ${sevColor[f.severity]||'#f59e0b'}33`, color:sevColor[f.severity]||'#f59e0b', letterSpacing:'.06em' }}>
                            {f.severity?.toUpperCase()}
                          </span>
                        </div>
                        <div style={{ ...S.td, fontSize:9, color:'#f59e0bbb', lineHeight:1.5 }}>
                          {f.description?.slice(0, 80)}{f.description?.length > 80 ? '...' : ''}
                        </div>
                        <div style={S.td}><Badge status={f.status}/></div>
                        <div style={{ ...S.td, display:'flex', gap:4, flexWrap:'wrap' }}>
                          {f.status === 'open' && (
                            <>
                              <button style={S.approveBtn} onClick={() => setModal({ type:'flag_review', data:f, action:'cleared' })}>CLEAR</button>
                              <button style={{ ...S.rejectBtn, fontSize:8, padding:'3px 7px' }} onClick={() => setModal({ type:'flag_review', data:f, action:'escalated' })}>ESCALATE</button>
                            </>
                          )}
                          {f.status !== 'open' && (
                            <button style={S.viewBtn} onClick={() => setModal({ type:'flag_detail', data:f })}>VIEW</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── TDS RECORDS ── */}
            {compTab === 'tds' && (
              <div>
                <div style={{ display:'flex', gap:8, marginBottom:16, alignItems:'center', flexWrap:'wrap' }}>
                  <span style={{ fontSize:9, color:'#f59e0baa', letterSpacing:'.1em' }}>FINANCIAL YEAR:</span>
                  {['', '2024-25', '2025-26', '2026-27'].map(fy => (
                    <button key={fy} style={{ ...S.filterBtn, ...(fyFilter===fy?S.filterBtnActive:{}) }} onClick={() => setFyFilter(fy)}>
                      {fy || 'ALL'}
                    </button>
                  ))}
                  <div style={{ marginLeft:'auto', padding:'8px 14px', borderRadius:6, background:'#0d0a00', border:'1px solid #60a5fa33' }}>
                    <span style={{ fontSize:9, color:'#60a5faaa', letterSpacing:'.1em' }}>TOTAL TDS COLLECTED: </span>
                    <span style={{ fontSize:13, color:'#60a5fa', fontWeight:700 }}>
                      ₹{parseFloat(compStats.totalTds||0).toLocaleString('en-IN', { minimumFractionDigits:2 })}
                    </span>
                  </div>
                </div>

                <div style={{ padding:'10px 14px', borderRadius:7, marginBottom:14, background:'#0a0800', border:'1px solid #60a5fa22', fontSize:10, color:'#60a5fa88', lineHeight:1.7 }}>
                  📋 <strong style={{ color:'#60a5fa' }}>Section 194S (VDA):</strong> 1% TDS on withdrawals ≥ ₹10,000.
                  Share this report with your CA for quarterly TDS deposit (challan) and annual return filing (Form 26Q).
                </div>

                {compLoading ? <div style={S.loading}>Loading...</div> : (
                  <div style={S.table}>
                    <div style={{ ...S.tableHead, gridTemplateColumns:'1.5fr 1fr 1fr 1fr 1fr 1fr 1fr' }}>
                      {['USER','FY / QTR','GROSS AMOUNT','TDS @ 1%','NET PAID','PAN','STATUS'].map(h => <div key={h} style={S.th}>{h}</div>)}
                    </div>
                    {compTDS.length === 0 && <div style={S.empty}>No TDS records {fyFilter ? `for FY ${fyFilter}` : ''}</div>}
                    {compTDS.map(t => (
                      <div key={t.id} style={{ ...S.tableRow, gridTemplateColumns:'1.5fr 1fr 1fr 1fr 1fr 1fr 1fr' }}>
                        <div style={S.td}>
                          <div style={{ color:'#f0fdf4', fontSize:11 }}>{t.full_name||'—'}</div>
                          <div style={{ color:'#f59e0bcc', fontSize:9 }}>{t.email}</div>
                        </div>
                        <div style={S.td}>
                          <div style={{ fontSize:10, color:'#f0fdf4' }}>{t.financial_year}</div>
                          <div style={{ fontSize:9, color:'#f59e0bcc' }}>{t.quarter}</div>
                        </div>
                        <div style={{ ...S.td, fontSize:11, color:'#f0fdf4' }}>{fmtINR(t.transaction_amount)}</div>
                        <div style={{ ...S.td, fontSize:11, color:'#f87171', fontWeight:600 }}>{fmtINR(t.tds_amount)}</div>
                        <div style={{ ...S.td, fontSize:11, color:'#22c55e' }}>{fmtINR(t.net_amount)}</div>
                        <div style={{ ...S.td, fontSize:10, color:'#60a5facc', fontFamily:'monospace' }}>{t.pan || t.company_pan || '—'}</div>
                        <div style={S.td}><Badge status={t.status}/></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── FEMA LOG ── */}
            {compTab === 'fema' && (
              <div>
                <div style={{ padding:'10px 14px', borderRadius:7, marginBottom:14, background:'#0a0800', border:'1px solid #a78bfa22', fontSize:10, color:'#a78bfa88', lineHeight:1.7 }}>
                  🔄 <strong style={{ color:'#a78bfa' }}>FEMA Compliance Log:</strong> All INR → ETH conversions for carbon credit purchases.
                  Under FEMA 1999, cross-border crypto transactions may require RBI reporting.
                  Share with your legal counsel before mainnet launch.
                </div>

                {compLoading ? <div style={S.loading}>Loading...</div> : (
                  <div style={S.table}>
                    <div style={{ ...S.tableHead, gridTemplateColumns:'1.5fr 1fr 1fr 1fr 1fr 1.5fr 1fr' }}>
                      {['USER','INR AMOUNT','ETH AMOUNT','ETH RATE','PURPOSE','TX HASH','DATE'].map(h => <div key={h} style={S.th}>{h}</div>)}
                    </div>
                    {compFEMA.length === 0 && <div style={S.empty}>No INR→crypto conversions recorded yet</div>}
                    {compFEMA.map(c => (
                      <div key={c.id} style={{ ...S.tableRow, gridTemplateColumns:'1.5fr 1fr 1fr 1fr 1fr 1.5fr 1fr' }}>
                        <div style={S.td}>
                          <div style={{ color:'#f0fdf4', fontSize:11 }}>{c.full_name||'—'}</div>
                          <div style={{ color:'#f59e0bcc', fontSize:9 }}>{c.email}</div>
                        </div>
                        <div style={{ ...S.td, fontSize:11, color:'#22c55e', fontWeight:600 }}>{fmtINR(c.inr_amount)}</div>
                        <div style={{ ...S.td, fontSize:11, color:'#60a5fa' }}>{parseFloat(c.crypto_amount).toFixed(6)} ETH</div>
                        <div style={{ ...S.td, fontSize:10, color:'#f59e0bbb' }}>₹{parseFloat(c.eth_inr_rate).toLocaleString('en-IN')}</div>
                        <div style={{ ...S.td, fontSize:9, color:'#a78bfacc', letterSpacing:'.04em' }}>
                          {c.purpose?.replace(/_/g,' ').toUpperCase()}
                        </div>
                        <div style={{ ...S.td, fontSize:9, color:'#60a5fa88', fontFamily:'monospace' }}>
                          {c.tx_hash ? `${c.tx_hash.slice(0,8)}...${c.tx_hash.slice(-6)}` : '—'}
                        </div>
                        <div style={{ ...S.td, fontSize:10, color:'#f59e0baa' }}>{fmt(c.created_at)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── LIMIT CONFIG ── */}
            {compTab === 'config' && (
              <div>
                <div style={{ padding:'10px 14px', borderRadius:7, marginBottom:14, background:'#0a0800', border:'1px solid #f59e0b22', fontSize:10, color:'#f59e0bbb', lineHeight:1.7 }}>
                  ⚙️ <strong style={{ color:'#f59e0b' }}>Live Limits:</strong> Changes take effect immediately on next transaction — no redeploy needed.
                  All amounts in ₹. Rate values are decimals (e.g. 0.01 = 1%).
                </div>

                {compLoading ? <div style={S.loading}>Loading...</div> : (
                  <div style={S.table}>
                    <div style={{ ...S.tableHead, gridTemplateColumns:'2fr 1fr 3fr 1.5fr' }}>
                      {['CONFIG KEY','CURRENT VALUE','DESCRIPTION','ACTION'].map(h => <div key={h} style={S.th}>{h}</div>)}
                    </div>
                    {compConfig.length === 0 && <div style={S.empty}>No config found — run compliance_migration.sql in Supabase</div>}
                    {compConfig.map(c => (
                      <div key={c.key} style={{ ...S.tableRow, gridTemplateColumns:'2fr 1fr 3fr 1.5fr', alignItems:'center' }}>
                        <div style={{ ...S.td, fontSize:10, color:'#60a5fa', fontFamily:'monospace', letterSpacing:'.04em' }}>{c.key}</div>
                        <div style={S.td}>
                          {editingConfig[c.key] !== undefined ? (
                            <input
                              style={{ ...S.searchInput, minWidth:0, width:100, padding:'4px 8px', fontSize:11 }}
                              value={editingConfig[c.key]}
                              onChange={e => setEditingConfig(prev => ({ ...prev, [c.key]: e.target.value }))}
                              onKeyDown={e => e.key === 'Enter' && saveConfig(c.key, editingConfig[c.key])}
                              autoFocus
                            />
                          ) : (
                            <span style={{ fontSize:13, color:'#22c55e', fontWeight:700 }}>{c.value}</span>
                          )}
                        </div>
                        <div style={{ ...S.td, fontSize:10, color:'#f59e0baa', lineHeight:1.5 }}>{c.description}</div>
                        <div style={{ ...S.td, display:'flex', gap:6 }}>
                          {editingConfig[c.key] !== undefined ? (
                            <>
                              <button style={S.approveBtn} onClick={() => saveConfig(c.key, editingConfig[c.key])}>SAVE</button>
                              <button style={S.viewBtn} onClick={() => setEditingConfig(prev => { const n={...prev}; delete n[c.key]; return n; })}>CANCEL</button>
                            </>
                          ) : (
                            <button style={S.viewBtn} onClick={() => setEditingConfig(prev => ({ ...prev, [c.key]: c.value }))}>EDIT</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>

      {/* ── MODALS ── */}
      {modal?.type === 'kyc_detail' && (
        <Modal title="KYC Submission Details" onClose={() => setModal(null)}>
          {[['Full Name',modal.data.full_name],['Email',modal.data.email],['ID Type',modal.data.id_type],['Phone',modal.data.phone||'—'],['Submitted',fmt(modal.data.submitted_at)],['Status',modal.data.status],['IPFS Doc',modal.data.doc_ipfs_hash||'—'],['Wallet',modal.data.wallet_address||'Not connected'],['Reviewed',fmt(modal.data.reviewed_at)]].map(([k,v])=>(
            <div key={k} style={M.row}><span style={M.key}>{k}</span><span style={M.val}>{k==='IPFS Doc'&&modal.data.doc_ipfs_hash?<a href={`${PINATA_GW}/${modal.data.doc_ipfs_hash}`} target="_blank" rel="noreferrer" style={{ color:'#60a5fa' }}>VIEW ON IPFS ↗</a>:v}</span></div>
          ))}
          {modal.data.status==='pending'&&(<div style={{ display:'flex', gap:8, marginTop:16 }}><button style={M.approveBtn} onClick={() => setModal({ type:'kyc_approve', data:modal.data })}>APPROVE KYC</button><button style={M.rejectBtn} onClick={() => setModal({ type:'kyc_reject', data:modal.data })}>REJECT KYC</button></div>)}
        </Modal>
      )}
      {modal?.type === 'kyc_approve' && (<Modal title="Approve KYC" onClose={() => { setModal(null); setReason(''); }}><div style={M.confirmText}>Approve KYC for <strong style={{ color:'#f0fdf4' }}>{modal.data.full_name}</strong>? They will receive an email and gain full platform access.</div><button style={M.approveBtn} onClick={() => kycAction(modal.data.id,'approve')}>CONFIRM APPROVE</button></Modal>)}
      {modal?.type === 'kyc_reject' && (<Modal title="Reject KYC" onClose={() => { setModal(null); setReason(''); }}><div style={M.confirmText}>Rejection reason (sent to user via email):</div><textarea style={M.textarea} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Document unclear, ID number mismatch..."/><button style={M.rejectBtn} onClick={() => kycAction(modal.data.id,'reject')} disabled={!reason.trim()}>CONFIRM REJECT</button></Modal>)}

      {modal?.type === 'credit_detail' && (
        <Modal title="Credit Listing Details" onClose={() => setModal(null)}>
          {[['Submitted By',modal.data.full_name],['Email',modal.data.email],['Registry',modal.data.registry_name||modal.data.standard||'—'],['Serial Number',modal.data.registry_serial||'—'],['Quantity',modal.data.quantity||'—'],['Vintage Year',modal.data.vintage_year||'—'],['Project Name',modal.data.project_name||'—'],['Location',modal.data.project_location||'—'],['Project Type',modal.data.project_type||'—'],['Developer',modal.data.developer||'—'],['Admin Status',modal.data.admin_status],['Token ID',modal.data.token_id!=null?`#${modal.data.token_id}`:'⚠ Not minted'],['Ownership Proof',modal.data.doc_ipfs_hash||'—']].map(([k,v])=>(
            <div key={k} style={M.row}><span style={M.key}>{k}</span><span style={{ ...M.val, color:k==='Token ID'&&!modal.data.token_id?'#f87171':undefined }}>{k==='Ownership Proof'&&modal.data.doc_ipfs_hash?<a href={`${PINATA_GW}/${modal.data.doc_ipfs_hash}`} target="_blank" rel="noreferrer" style={{ color:'#60a5fa' }}>VIEW ON IPFS ↗</a>:v}</span></div>
          ))}
          <div style={{ display:'flex', gap:8, marginTop:16, flexWrap:'wrap' }}>
            {modal.data.admin_status==='pending'&&(<><button style={M.approveBtn} onClick={() => setModal({ type:'credit_approve', data:modal.data })}>APPROVE</button><button style={M.rejectBtn} onClick={() => setModal({ type:'credit_reject', data:modal.data })}>REJECT</button></>)}
            {modal.data.admin_status==='approved'&&!modal.data.token_id&&(<button style={{ ...M.approveBtn, background:'linear-gradient(135deg,#dc2626,#b91c1c)' }} onClick={() => { setModal(null); retryMint(modal.data.id); }}>⟳ RETRY MINT</button>)}
          </div>
        </Modal>
      )}
      {modal?.type === 'credit_approve' && (<Modal title="Approve Credit Listing" onClose={() => { setModal(null); setReason(''); }}><div style={M.confirmText}>Approve listing for <strong style={{ color:'#f0fdf4' }}>{modal.data.full_name}</strong>?<br/>Project: <span style={{ color:'#22c55e' }}>{modal.data.project_name||'—'}</span><br/>Serial: <span style={{ color:'#60a5fa' }}>{modal.data.registry_serial||'—'}</span></div>{modal.data.doc_ipfs_hash&&<div style={{ marginBottom:12 }}><a href={`${PINATA_GW}/${modal.data.doc_ipfs_hash}`} target="_blank" rel="noreferrer" style={{ fontSize:10, color:'#60a5fa', textDecoration:'none' }}>📄 VIEW OWNERSHIP PROOF ON IPFS ↗</a></div>}<textarea style={M.textarea} value={reason} onChange={e => setReason(e.target.value)} placeholder="Optional admin notes..."/><button style={M.approveBtn} onClick={() => creditAction(modal.data.id,'approve')}>CONFIRM APPROVE</button></Modal>)}
      {modal?.type === 'credit_reject' && (<Modal title="Reject Credit Listing" onClose={() => { setModal(null); setReason(''); }}><textarea style={M.textarea} value={reason} onChange={e => setReason(e.target.value)} placeholder="Rejection reason e.g. Serial number not found in registry..."/><button style={M.rejectBtn} onClick={() => creditAction(modal.data.id,'reject')} disabled={!reason.trim()}>CONFIRM REJECT</button></Modal>)}

      {modal?.type === 'user_detail' && (<Modal title="User Details" onClose={() => setModal(null)}>{[['Full Name',modal.data.full_name||'—'],['Email',modal.data.email],['Wallet',modal.data.wallet_address||'Not connected'],['KYC Status',modal.data.kyc_status||'pending'],['Role',modal.data.role],['Frozen',modal.data.frozen?`Yes — ${modal.data.freeze_reason}`:'No'],['Joined',fmt(modal.data.created_at)]].map(([k,v])=>(<div key={k} style={M.row}><span style={M.key}>{k}</span><span style={M.val}>{v}</span></div>))}<div style={{ display:'flex', gap:8, marginTop:16 }}>{!modal.data.frozen?<button style={M.rejectBtn} onClick={() => setModal({ type:'freeze', data:modal.data })}>FREEZE ACCOUNT</button>:<button style={M.approveBtn} onClick={() => setModal({ type:'unfreeze', data:modal.data })}>UNFREEZE ACCOUNT</button>}</div></Modal>)}
      {modal?.type === 'freeze' && (<Modal title="Freeze Account" onClose={() => { setModal(null); setReason(''); }}><div style={M.confirmText}>Freeze account of <strong style={{ color:'#f87171' }}>{modal.data.email}</strong>?</div><textarea style={M.textarea} value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for freezing..."/><button style={M.rejectBtn} onClick={() => freezeAction(modal.data.id,'freeze')} disabled={!reason.trim()}>CONFIRM FREEZE</button></Modal>)}
      {modal?.type === 'unfreeze' && (<Modal title="Unfreeze Account" onClose={() => { setModal(null); setReason(''); }}><div style={M.confirmText}>Unfreeze account of <strong style={{ color:'#22c55e' }}>{modal.data.email}</strong>?</div><button style={M.approveBtn} onClick={() => freezeAction(modal.data.id,'unfreeze')}>CONFIRM UNFREEZE</button></Modal>)}

      {modal?.type === 'new_dispute' && (<Modal title="Open New Dispute" onClose={() => { setModal(null); setReason(''); }}><input style={M.input} placeholder="Target user ID..." onChange={e => setModal(m => ({ ...m, targetId: e.target.value }))}/><textarea style={M.textarea} value={reason} onChange={e => setReason(e.target.value)} placeholder="Dispute reason and details..."/><button style={M.approveBtn} onClick={async () => { try { await apiFetch('/api/admin/disputes',{ method:'POST', body:JSON.stringify({ targetUserId:modal.targetId, reason, notes:'' }) }); showToast('Dispute opened'); setModal(null); setReason(''); loadDisputes(); } catch(e){ showToast(`Error: ${e.message}`); } }} disabled={!reason.trim()}>OPEN DISPUTE</button></Modal>)}
      {modal?.type === 'resolve_dispute' && (<Modal title="Resolve Dispute" onClose={() => { setModal(null); setReason(''); }}><div style={M.confirmText}>Dispute against: <strong style={{ color:'#f0fdf4' }}>{modal.data.target_name}</strong></div><div style={{ ...M.confirmText, color:'#f59e0bbb', marginBottom:12 }}>{modal.data.reason}</div><textarea style={M.textarea} value={reason} onChange={e => setReason(e.target.value)} placeholder="Resolution notes..."/><button style={M.approveBtn} onClick={() => resolveDispute(modal.data.id)} disabled={!reason.trim()}>MARK RESOLVED</button></Modal>)}

      {/* ── COMPLIANCE MODALS ── */}
      {modal?.type === 'flag_review' && (
        <Modal title={`${modal.action === 'cleared' ? '✅ Clear' : '🚨 Escalate'} Flag`} onClose={() => { setModal(null); setReason(''); }}>
          <div style={M.confirmText}>
            <strong style={{ color: modal.action==='cleared'?'#22c55e':'#f87171' }}>
              {modal.action==='cleared'?'Clear':'Escalate'}
            </strong> compliance flag for <strong style={{ color:'#f0fdf4' }}>{modal.data.email}</strong>?
          </div>
          <div style={{ ...M.row, marginBottom:12 }}>
            <span style={M.key}>FLAG TYPE</span>
            <span style={M.val}>{flagTypeLabel[modal.data.flag_type]||modal.data.flag_type}</span>
          </div>
          <div style={{ ...M.row, marginBottom:12 }}>
            <span style={M.key}>AMOUNT</span>
            <span style={M.val}>{modal.data.amount?`₹${parseFloat(modal.data.amount).toLocaleString('en-IN')}`:'—'}</span>
          </div>
          <div style={{ fontSize:10, color:'#f59e0bbb', marginBottom:8, lineHeight:1.6 }}>{modal.data.description}</div>
          <textarea style={M.textarea} value={reason} onChange={e => setReason(e.target.value)}
            placeholder={modal.action==='cleared'?'Review notes — why is this cleared?':'Escalation reason and next steps...'}/>
          <button
            style={modal.action==='cleared'?M.approveBtn:M.rejectBtn}
            onClick={() => reviewFlag(modal.data.id, modal.action, reason)}
            disabled={!reason.trim()}>
            CONFIRM {modal.action.toUpperCase()}
          </button>
        </Modal>
      )}

      {modal?.type === 'flag_detail' && (
        <Modal title="Flag Details" onClose={() => setModal(null)}>
          {[
            ['User',        modal.data.email],
            ['Flag Type',   flagTypeLabel[modal.data.flag_type]||modal.data.flag_type],
            ['Amount',      modal.data.amount?`₹${parseFloat(modal.data.amount).toLocaleString('en-IN')}`:'—'],
            ['Severity',    modal.data.severity?.toUpperCase()],
            ['Status',      modal.data.status?.toUpperCase()],
            ['Description', modal.data.description],
            ['Reviewed By', modal.data.reviewed_by||'—'],
            ['Review Notes',modal.data.review_notes||'—'],
            ['Created',     fmtTime(modal.data.created_at)],
            ['Reviewed At', fmtTime(modal.data.reviewed_at)],
          ].map(([k,v])=>(
            <div key={k} style={M.row}><span style={M.key}>{k}</span><span style={{ ...M.val, maxWidth:300 }}>{v||'—'}</span></div>
          ))}
        </Modal>
      )}

    </div>
  );
};

const S = {
  page:           { display:'flex', minHeight:'100vh', background:'#0a0800', fontFamily:"'DM Mono',monospace", color:'#f0fdf4' },
  sidebar:        { width:220, background:'#0d0a00', borderRight:'1px solid #f59e0b11', display:'flex', flexDirection:'column', flexShrink:0, position:'sticky', top:0, height:'100vh' },
  sideTop:        { padding:'24px 16px 16px', borderBottom:'1px solid #f59e0b11', marginBottom:8 },
  logo:           { fontSize:13, fontWeight:700, color:'#f59e0b', letterSpacing:'.12em' },
  logoSub:        { fontSize:9, color:'#f59e0baa', letterSpacing:'.2em', marginTop:4 },
  navBtn:         { width:'100%', padding:'11px 16px', background:'transparent', border:'none', borderLeft:'2px solid transparent', color:'#f59e0bcc', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:11, textAlign:'left', letterSpacing:'.06em', display:'flex', alignItems:'center', justifyContent:'space-between' },
  navBtnActive:   { borderLeft:'2px solid #f59e0b', color:'#f59e0b', background:'#f59e0b18' },
  badge:          { background:'#f59e0b', color:'#0a0800', fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:10, minWidth:16, textAlign:'center' },
  logoutBtn:      { width:'100%', padding:'10px', borderRadius:6, border:'1px solid #f59e0b22', background:'transparent', color:'#f87171ee', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:10, letterSpacing:'.08em' },
  main:           { flex:1, padding:'32px 40px', overflowY:'auto' },
  pageTitle:      { fontSize:20, fontWeight:500, color:'#f0fdf4', marginBottom:24, letterSpacing:'.04em' },
  statsGrid:      { display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:12 },
  statCard:       { background:'#0d0a00', border:'1px solid #f59e0b33', borderRadius:10, padding:'20px 16px', textAlign:'center' },
  section:        { background:'#0d0a00', border:'1px solid #f59e0b33', borderRadius:10, padding:'20px' },
  sectionTitle:   { fontSize:9, color:'#f59e0bcc', letterSpacing:'.16em', marginBottom:14 },
  quickBtn:       { padding:'10px 18px', borderRadius:6, border:'1px solid #f59e0b66', background:'transparent', color:'#f59e0bdd', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:11, letterSpacing:'.06em' },
  filterBtn:      { padding:'8px 14px', borderRadius:6, border:'1px solid #f59e0b22', background:'transparent', color:'#f59e0bcc', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:10, letterSpacing:'.08em' },
  filterBtnActive:{ borderColor:'#f59e0b', color:'#f59e0b', background:'#f59e0b11' },
  searchInput:    { padding:'8px 14px', borderRadius:6, border:'1px solid #f59e0b22', background:'#0a0800', color:'#f0fdf4', fontFamily:"'DM Mono',monospace", fontSize:11, outline:'none', minWidth:240 },
  table:          { background:'#0d0a00', border:'1px solid #f59e0b33', borderRadius:10, overflow:'hidden' },
  tableHead:      { display:'grid', gridTemplateColumns:'repeat(6,1fr)', background:'#0a0800', padding:'10px 16px', borderBottom:'1px solid #f59e0b11' },
  tableRow:       { display:'grid', gridTemplateColumns:'repeat(6,1fr)', padding:'12px 16px', borderBottom:'1px solid #f59e0b08', alignItems:'center' },
  th:             { fontSize:9, color:'#f59e0baa', letterSpacing:'.12em' },
  td:             { fontSize:11 },
  loading:        { padding:40, textAlign:'center', color:'#f59e0baa', fontSize:12 },
  empty:          { padding:40, textAlign:'center', color:'#f59e0bbb', fontSize:11 },
  viewBtn:        { padding:'4px 10px', borderRadius:4, border:'1px solid #f59e0b22', background:'transparent', color:'#f59e0bdd', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:9 },
  approveBtn:     { padding:'4px 10px', borderRadius:4, border:'1px solid #22c55e44', background:'#22c55e11', color:'#22c55e', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:9 },
  rejectBtn:      { padding:'4px 10px', borderRadius:4, border:'1px solid #f8717144', background:'#f8717111', color:'#f87171', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:9 },
  toast:          { position:'fixed', bottom:24, right:24, background:'#1a1200', border:'1px solid #f59e0b44', color:'#f59e0b', padding:'12px 20px', borderRadius:8, fontSize:12, zIndex:9999, fontFamily:"'DM Mono',monospace" },
  spinner:        { width:12, height:12, border:'2px solid #f8717122', borderTopColor:'#f87171', borderRadius:'50%', animation:'spin 1s linear infinite', display:'inline-block' },
};

const M = {
  overlay:    { position:'fixed', inset:0, background:'rgba(0,0,0,.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:20 },
  box:        { background:'#0d0a00', border:'1px solid #f59e0b22', borderRadius:12, padding:'28px 32px', maxWidth:500, width:'100%', maxHeight:'80vh', overflowY:'auto', fontFamily:"'DM Mono',monospace" },
  mTitle:     { fontSize:14, fontWeight:700, color:'#f59e0b', marginBottom:20, letterSpacing:'.08em' },
  row:        { display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #f59e0b08' },
  key:        { fontSize:10, color:'#f59e0bcc', letterSpacing:'.1em' },
  val:        { fontSize:11, color:'#f0fdf4', maxWidth:280, textAlign:'right', wordBreak:'break-all' },
  confirmText:{ fontSize:11, color:'#f59e0bdd', lineHeight:1.7, marginBottom:12 },
  textarea:   { width:'100%', minHeight:80, padding:'10px 12px', borderRadius:6, border:'1px solid #f59e0b22', background:'#0a0800', color:'#f0fdf4', fontFamily:"'DM Mono',monospace", fontSize:11, outline:'none', resize:'vertical', boxSizing:'border-box', marginBottom:12 },
  input:      { width:'100%', padding:'10px 12px', borderRadius:6, border:'1px solid #f59e0b22', background:'#0a0800', color:'#f0fdf4', fontFamily:"'DM Mono',monospace", fontSize:11, outline:'none', boxSizing:'border-box', marginBottom:12 },
  approveBtn: { padding:'10px 20px', borderRadius:6, border:'none', background:'linear-gradient(135deg,#16a34a,#15803d)', color:'#fff', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:700, letterSpacing:'.08em' },
  rejectBtn:  { padding:'10px 20px', borderRadius:6, border:'none', background:'linear-gradient(135deg,#dc2626,#b91c1c)', color:'#fff', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:700, letterSpacing:'.08em' },
  closeBtn:   { marginTop:16, padding:'8px 16px', borderRadius:6, border:'1px solid #f59e0b22', background:'transparent', color:'#f59e0bcc', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:10 },
};

export default AdminDashboard;