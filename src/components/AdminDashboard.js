// AdminDashboard.jsx — EtherTrack Admin Console (Full Power Edition)
import React, { useState, useEffect, useContext, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../App';
import { apiFetch as globalApiFetch } from '../services/api';

const PINATA_GW = process.env.REACT_APP_PINATA_GATEWAY || 'https://gateway.pinata.cloud/ipfs';
const apiFetch = (path, opts = {}) => globalApiFetch(path, opts);

const TABS = [
  { id: 'overview',      label: '⚡ Overview'      },
  { id: 'kyc',           label: '🔍 KYC Queue'     },
  { id: 'credits',       label: '🌿 Credits'       },
  { id: 'retirements',   label: '🔥 Retirements'   },
  { id: 'listings',      label: '📋 Listings'      },
  { id: 'accounts',      label: '👤 Accounts'      },
  { id: 'projects',      label: '🗂 Projects'      },
  { id: 'revenue',       label: '💰 Revenue'       },
  { id: 'health',        label: '🩺 Chain Health'  },
  { id: 'blacklist',     label: '🚫 Blacklist'      },
  { id: 'announcements', label: '📢 Announce'       },
  { id: 'disputes',      label: '⚖️ Disputes'      },
  { id: 'audit',         label: '📋 Audit Log'     },
  { id: 'compliance',    label: '🛡 Compliance'    },
];

const Modal = ({ title, children, onClose, wide }) => (
  <div style={M.overlay}>
    <div style={{ ...M.box, ...(wide ? { maxWidth: 760 } : {}) }}>
      <div style={M.mTitle}>{title}</div>
      <div style={{ overflowY: 'auto', maxHeight: 'calc(80vh - 120px)' }}>{children}</div>
      <button style={M.closeBtn} onClick={onClose}>✕ CLOSE</button>
    </div>
  </div>
);

export default function AdminDashboard() {
  const { dbUser, handleLogout } = useContext(AuthContext);
  const navigate = useNavigate();

  const [tab,           setTab]           = useState('overview');
  const [stats,         setStats]         = useState(null);
  const [kyc,           setKyc]           = useState([]);
  const [credits,       setCredits]       = useState([]);
  const [retirements,   setRetirements]   = useState([]);
  const [users,         setUsers]         = useState([]);
  const [disputes,      setDisputes]      = useState([]);
  const [audit,         setAudit]         = useState([]);
  const [blacklist,     setBlacklist]     = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [listings,      setListings]      = useState([]);
  const [revenue,       setRevenue]       = useState(null);
  const [health,        setHealth]        = useState(null);
  const [projects,      setProjects]      = useState([]);
  const [retirementSearch, setRetirementSearch] = useState('');
  const [retirementResults, setRetirementResults] = useState(null);
  const [mintDiag,      setMintDiag]      = useState(null);
  const [revPeriod,     setRevPeriod]     = useState('30');
  const [healthLoading, setHealthLoading] = useState(false);
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
  const [kycExpiring,   setKycExpiring]   = useState([]);

  // modal-specific state
  const [manualTokenId,    setManualTokenId]    = useState('');
  const [newWallet,        setNewWallet]        = useState('');
  const [newQty,           setNewQty]           = useState('');
  const [userCredits,      setUserCredits]      = useState([]);
  const [userTrades,       setUserTrades]       = useState([]);
  const [userDataLoading,  setUserDataLoading]  = useState(false);
  const [deletingUserId,   setDeletingUserId]   = useState(null);
  const [syncingId,        setSyncingId]        = useState(null);
  const [msgSubject,       setMsgSubject]       = useState('');
  const [msgBody,          setMsgBody]          = useState('');
  const [annTitle,         setAnnTitle]         = useState('');
  const [annMsg,           setAnnMsg]           = useState('');
  const [annType,          setAnnType]          = useState('info');
  const [annEmail,         setAnnEmail]         = useState(false);
  const [newSerial,        setNewSerial]        = useState('');
  const [priceOverride,    setPriceOverride]    = useState('');
  const [assignWallet,     setAssignWallet]     = useState('');
  const [selectedKycIds,   setSelectedKycIds]   = useState([]);
  const [broadcasting,     setBroadcasting]     = useState(false);

  // compliance
  const [compTab,       setCompTab]       = useState('flags');
  const [compFlags,     setCompFlags]     = useState([]);
  const [compTDS,       setCompTDS]       = useState([]);
  const [compFEMA,      setCompFEMA]      = useState([]);
  const [compConfig,    setCompConfig]    = useState([]);
  const [compLoading,   setCompLoading]   = useState(false);
  const [flagFilter,    setFlagFilter]    = useState('open');
  const [flagSeverity,  setFlagSeverity]  = useState('');
  const [fyFilter,      setFyFilter]      = useState('');
  const [editingConfig, setEditingConfig] = useState({});
  const [compStats,     setCompStats]     = useState({ openFlags:0, criticalFlags:0, totalTds:0, totalConversions:0 });

  const showToast = (msg, duration = 3500) => { setToast(msg); setTimeout(() => setToast(''), duration); };

  // ── Loaders ───────────────────────────────────────────────────
  const loadStats      = useCallback(async () => { try { setStats(await apiFetch('/api/admin/stats')); } catch {} }, []);
  const loadKYC        = useCallback(async () => { setLoading(true); try { const d = await apiFetch(`/api/admin/kyc?status=${kycFilter}`); setKyc(d.submissions); } catch {} finally { setLoading(false); } }, [kycFilter]);
  const loadCredits    = useCallback(async () => { setLoading(true); try { const d = await apiFetch(`/api/admin/credits?status=${creditFilter}`); setCredits(d.credits); setFailedMints(d.credits.filter(c => c.admin_status === 'approved' && !c.token_id)); } catch {} finally { setLoading(false); } }, [creditFilter]);
  const loadRetirements = useCallback(async () => { setLoading(true); try { const d = await apiFetch('/api/admin/retirements'); setRetirements(d.retirements || []); } catch {} finally { setLoading(false); } }, []);
  const loadUsers      = useCallback(async () => { setLoading(true); try { const params = new URLSearchParams(); if (search) params.set('search', search); if (userFilter) params.set('status', userFilter); const d = await apiFetch(`/api/admin/users?${params}`); setUsers(d.users); } catch {} finally { setLoading(false); } }, [search, userFilter]);
  const loadDisputes   = useCallback(async () => { setLoading(true); try { const d = await apiFetch('/api/admin/disputes'); setDisputes(d.disputes); } catch {} finally { setLoading(false); } }, []);
  const loadAudit      = useCallback(async () => { setLoading(true); try { const d = await apiFetch('/api/admin/audit'); setAudit(d.logs); } catch {} finally { setLoading(false); } }, []);
  const loadBlacklist  = useCallback(async () => { setLoading(true); try { const d = await apiFetch('/api/admin/serials/blacklist'); setBlacklist(d.blacklist || []); } catch {} finally { setLoading(false); } }, []);
  const loadAnnouncements = useCallback(async () => { try { const d = await apiFetch('/api/admin/announcements'); setAnnouncements(d.announcements || []); } catch {} }, []);
  const loadListings   = useCallback(async () => { setLoading(true); try { const d = await apiFetch('/api/admin/listings'); setListings(d.listings || []); } catch {} finally { setLoading(false); } }, []);
  const loadRevenue    = useCallback(async (period='30') => { setLoading(true); try { const d = await apiFetch(`/api/admin/revenue?period=${period}`); setRevenue(d); } catch {} finally { setLoading(false); } }, []);
  const loadHealth     = useCallback(async () => { setHealthLoading(true); try { const d = await apiFetch('/api/admin/health/onchain'); setHealth(d); } catch {} finally { setHealthLoading(false); } }, []);
  const loadProjects   = useCallback(async () => { setLoading(true); try { const d = await apiFetch('/api/admin/projects'); setProjects(d.projects || []); } catch {} finally { setLoading(false); } }, []);
  const loadKycExpiry  = useCallback(async () => { try { const d = await apiFetch('/api/admin/kyc-expiring'); setKycExpiring(d.users || []); } catch {} }, []);
  const loadCompFlags  = useCallback(async () => { setCompLoading(true); try { const params = new URLSearchParams(); if (flagFilter && flagFilter !== 'all') params.set('status', flagFilter); if (flagSeverity) params.set('severity', flagSeverity); params.set('limit', '100'); const d = await apiFetch(`/api/compliance/flags?${params}`); setCompFlags(d.flags || []); setCompStats(p => ({ ...p, openFlags: (d.flags||[]).filter(f=>f.status==='open').length, criticalFlags: (d.flags||[]).filter(f=>f.severity==='critical'&&f.status==='open').length })); } catch {} finally { setCompLoading(false); } }, [flagFilter, flagSeverity]);
  const loadCompTDS    = useCallback(async () => { setCompLoading(true); try { const params = new URLSearchParams(); if (fyFilter) params.set('fy', fyFilter); const d = await apiFetch(`/api/compliance/tds?${params}`); setCompTDS(d.records||[]); setCompStats(p=>({...p,totalTds:d.totalTds||0})); } catch {} finally { setCompLoading(false); } }, [fyFilter]);
  const loadCompFEMA   = useCallback(async () => { setCompLoading(true); try { const d = await apiFetch('/api/compliance/fema'); setCompFEMA(d.conversions||[]); setCompStats(p=>({...p,totalConversions:d.totalTx||0})); } catch {} finally { setCompLoading(false); } }, []);
  const loadCompConfig = useCallback(async () => { setCompLoading(true); try { const d = await apiFetch('/api/compliance/config'); setCompConfig(d.config||[]); } catch {} finally { setCompLoading(false); } }, []);

  const loadUserData = useCallback(async (userId) => {
    setUserDataLoading(true);
    try {
      const [cr, tr] = await Promise.all([
        apiFetch(`/api/admin/users/${userId}/credits`),
        apiFetch(`/api/admin/users/${userId}/trades`),
      ]);
      setUserCredits(cr.credits || []);
      setUserTrades(tr.trades || []);
    } catch { setUserCredits([]); setUserTrades([]); }
    finally { setUserDataLoading(false); }
  }, []);

  useEffect(() => { loadStats(); loadKycExpiry(); loadAnnouncements(); }, [loadStats, loadKycExpiry, loadAnnouncements]);
  useEffect(() => {
    if (tab === 'kyc')           loadKYC();
    if (tab === 'credits')       loadCredits();
    if (tab === 'retirements')   loadRetirements();
    if (tab === 'listings')      loadListings();
    if (tab === 'accounts')      { loadUsers(); loadKycExpiry(); }
    if (tab === 'projects')      loadProjects();
    if (tab === 'revenue')       loadRevenue(revPeriod);
    if (tab === 'health')        loadHealth();
    if (tab === 'blacklist')     loadBlacklist();
    if (tab === 'announcements') loadAnnouncements();
    if (tab === 'disputes')      loadDisputes();
    if (tab === 'audit')         loadAudit();
    if (tab === 'compliance')    { loadCompFlags(); loadCompTDS(); loadCompFEMA(); loadCompConfig(); }
  }, [tab, loadKYC, loadCredits, loadRetirements, loadUsers, loadDisputes, loadAudit, loadBlacklist, loadAnnouncements, loadCompFlags, loadCompTDS, loadCompFEMA, loadCompConfig, loadKycExpiry]);

  useEffect(() => { if (tab === 'compliance' && compTab === 'flags') loadCompFlags(); }, [flagFilter, flagSeverity]);
  useEffect(() => { if (tab === 'compliance' && compTab === 'tds') loadCompTDS(); }, [fyFilter]);

  // ── Actions ───────────────────────────────────────────────────
  const kycAction = async (id, action) => { try { await apiFetch(`/api/admin/kyc/${id}/${action}`, { method:'POST', body:JSON.stringify({ reason }) }); showToast(`KYC ${action}d`); setModal(null); setReason(''); loadKYC(); loadStats(); } catch (e) { showToast(`❌ ${e.message}`); } };
  const creditAction = async (id, action) => { try { await apiFetch(`/api/admin/credits/${id}/${action}`, { method:'POST', body:JSON.stringify(action==='approve'?{notes:reason}:{reason}) }); showToast(`Credit ${action}d`); setModal(null); setReason(''); loadCredits(); loadStats(); } catch (e) { showToast(`❌ ${e.message}`); } };
  const freezeAction = async (id, action) => { try { await apiFetch(`/api/admin/users/${id}/${action}`, { method:'POST', body:JSON.stringify({ reason }) }); showToast(`Account ${action}d`); setModal(null); setReason(''); loadUsers(); loadStats(); } catch (e) { showToast(`❌ ${e.message}`); } };
  const resolveDispute = async (id) => { try { await apiFetch(`/api/admin/disputes/${id}/resolve`, { method:'POST', body:JSON.stringify({ resolution:reason }) }); showToast('Dispute resolved'); setModal(null); setReason(''); loadDisputes(); loadStats(); } catch (e) { showToast(`❌ ${e.message}`); } };

  const retryMint = async (batchId) => { setRetryingId(batchId); try { const r = await apiFetch(`/api/admin/credits/${batchId}/retry-mint`, { method:'POST' }); if (r.success) showToast(`✅ Token #${r.tokenId} minted`); else showToast(`❌ ${r.error}`); loadCredits(); loadStats(); } catch (e) { showToast(`❌ ${e.message}`); } finally { setRetryingId(null); } };
  const retryAllMints = async () => { if (!failedMints.length) return; setRetryingAll(true); let ok=0,fail=0; for (const b of failedMints) { try { const r = await apiFetch(`/api/admin/credits/${b.id}/retry-mint`,{method:'POST'}); if(r.success) ok++; else fail++; } catch { fail++; } } showToast(`✅ ${ok} minted · ❌ ${fail} failed`,5000); setRetryingAll(false); loadCredits(); loadStats(); };

  const handleManualTokenSync = async (batchId) => { const tid=parseInt(manualTokenId); if(isNaN(tid)||tid<0){showToast('❌ Invalid token ID');return;} setSyncingId(batchId); try { await apiFetch(`/api/admin/credits/${batchId}/set-token-id`,{method:'POST',body:JSON.stringify({tokenId:tid})}); showToast(`✅ Token #${tid} synced`); setModal(null); setManualTokenId(''); loadCredits(); } catch(e){showToast(`❌ ${e.message}`);} finally{setSyncingId(null);} };
  const handleQtyCorrection = async (batchId) => { const qty=parseInt(newQty); if(!qty||qty<=0){showToast('❌ Invalid quantity');return;} try { await apiFetch(`/api/admin/credits/${batchId}/correct-quantity`,{method:'POST',body:JSON.stringify({quantity:qty,reason})}); showToast(`✅ Quantity corrected to ${qty}`); setModal(null); setNewQty(''); setReason(''); loadCredits(); } catch(e){showToast(`❌ ${e.message}`);} };
  const handleWalletReassign = async (userId) => { if(!newWallet||!newWallet.startsWith('0x')||newWallet.length!==42){showToast('❌ Invalid wallet address');return;} try { await apiFetch(`/api/admin/users/${userId}/reassign-wallet`,{method:'POST',body:JSON.stringify({walletAddress:newWallet,reason})}); showToast('✅ Wallet reassigned'); setModal(null); setNewWallet(''); setReason(''); loadUsers(); } catch(e){showToast(`❌ ${e.message}`);} };
  const handleDeleteUser = async (userId) => { setDeletingUserId(userId); try { await apiFetch(`/api/admin/users/${userId}/delete`,{method:'POST',body:JSON.stringify({reason})}); showToast('✅ User deleted'); setModal(null); setReason(''); loadUsers(); loadStats(); } catch(e){showToast(`❌ ${e.message}`);} finally{setDeletingUserId(null);} };
  const handleKycReminder = async (userId,email) => { try { await apiFetch(`/api/admin/users/${userId}/kyc-reminder`,{method:'POST'}); showToast(`✅ Reminder sent to ${email}`); } catch(e){showToast(`❌ ${e.message}`);} };
  const handleResyncPortfolio = async (userId) => { try { await apiFetch(`/api/admin/users/${userId}/resync-portfolio`,{method:'POST'}); showToast('✅ Portfolio resync triggered'); setModal(null); } catch(e){showToast(`❌ ${e.message}`);} };
  const handleSendMessage = async (userId) => { if(!msgSubject||!msgBody){showToast('❌ Subject and message required');return;} try { await apiFetch(`/api/admin/users/${userId}/send-message`,{method:'POST',body:JSON.stringify({subject:msgSubject,message:msgBody})}); showToast('✅ Message sent'); setModal(null); setMsgSubject(''); setMsgBody(''); } catch(e){showToast(`❌ ${e.message}`);} };
  const handleBroadcast = async () => { if(!annTitle||!annMsg){showToast('❌ Title and message required');return;} setBroadcasting(true); try { const r = await apiFetch('/api/admin/announcements/broadcast',{method:'POST',body:JSON.stringify({subject:annTitle,message:annMsg,sendEmail:annEmail})}); showToast(`✅ Sent to ${r.sent} users · ❌ ${r.failed} failed`,5000); setModal(null); setAnnTitle(''); setAnnMsg(''); setAnnEmail(false); } catch(e){showToast(`❌ ${e.message}`);} finally{setBroadcasting(false);} };
  const handleSaveAnnouncement = async () => { if(!annTitle||!annMsg){showToast('❌ Title and message required');return;} try { await apiFetch('/api/admin/announcements',{method:'POST',body:JSON.stringify({title:annTitle,message:annMsg,type:annType})}); showToast('✅ Announcement saved'); loadAnnouncements(); setAnnTitle(''); setAnnMsg(''); } catch(e){showToast(`❌ ${e.message}`);} };
  const handleDeleteAnnouncement = async (id) => { try { await apiFetch(`/api/admin/announcements/${id}`,{method:'DELETE'}); showToast('✅ Announcement removed'); loadAnnouncements(); } catch(e){showToast(`❌ ${e.message}`);} };
  const handleBlacklistSerial = async () => { if(!newSerial||!reason){showToast('❌ Serial and reason required');return;} try { const r = await apiFetch('/api/admin/serials/blacklist',{method:'POST',body:JSON.stringify({serial:newSerial,reason})}); showToast(`✅ Blacklisted · ${r.affectedBatches} batch(es) auto-rejected`); setNewSerial(''); setReason(''); loadBlacklist(); } catch(e){showToast(`❌ ${e.message}`);} };
  const handleUnblacklist = async (serial) => { try { await apiFetch(`/api/admin/serials/blacklist/${encodeURIComponent(serial)}`,{method:'DELETE'}); showToast('✅ Serial removed from blacklist'); loadBlacklist(); } catch(e){showToast(`❌ ${e.message}`);} };
  const handleForceDelist = async (listingId) => { if(!reason){showToast('❌ Reason required');return;} try { await apiFetch(`/api/admin/listings/${listingId}/force-delist`,{method:'POST',body:JSON.stringify({reason})}); showToast('✅ Listing force-delisted'); setModal(null); setReason(''); loadListings(); } catch(e){showToast(`❌ ${e.message}`);} };
  const handleRequireRekyc = async (userId) => { if(!reason){showToast('❌ Reason required');return;} try { await apiFetch(`/api/admin/users/${userId}/require-rekyc`,{method:'POST',body:JSON.stringify({reason})}); showToast('✅ Re-KYC required — user notified'); setModal(null); setReason(''); loadUsers(); } catch(e){showToast(`❌ ${e.message}`);} };
  const handleSearchRetirements = async () => { if(!retirementSearch.trim()){return;} try { const d = await apiFetch(`/api/admin/retirements/search?q=${encodeURIComponent(retirementSearch)}`); setRetirementResults(d.retirements||[]); } catch(e){showToast(`❌ ${e.message}`);} };
  const handleLoadMintDiag = async (batchId) => { try { const d = await apiFetch(`/api/admin/credits/${batchId}/mint-errors`); setMintDiag(d); setModal({type:'mint_diag',data:d}); } catch(e){showToast(`❌ ${e.message}`);} };
  const handleUnflagRetirement = async (id) => { try { await apiFetch(`/api/admin/retirements/${id}/unflag`,{method:'POST'}); showToast('✅ Retirement dispute cleared'); loadRetirements(); } catch(e){showToast(`❌ ${e.message}`);} };

  // ✅ FIX: handleFlagRetirement was missing — now defined
  const handleFlagRetirement = async (id) => {
    try {
      await apiFetch(`/api/admin/retirements/${id}/flag`, { method:'POST', body:JSON.stringify({ reason }) });
      showToast('✅ Retirement flagged as disputed');
      setModal(null);
      setReason('');
      loadRetirements();
    } catch(e) {
      showToast(`❌ ${e.message}`);
    }
  };

  const handlePriceOverride = async (listingId) => { if(!priceOverride||!reason){showToast('❌ Price and reason required');return;} try { await apiFetch(`/api/admin/listings/${listingId}/override-price`,{method:'POST',body:JSON.stringify({priceInr:priceOverride,reason})}); showToast(`✅ Price updated to ₹${priceOverride}`); setModal(null); setPriceOverride(''); setReason(''); } catch(e){showToast(`❌ ${e.message}`);} };
  const handleAssignWalletAndMint = async (batchId) => { if(!assignWallet||!assignWallet.startsWith('0x')||assignWallet.length!==42){showToast('❌ Invalid wallet address');return;} setSyncingId(batchId); try { const r = await apiFetch(`/api/admin/credits/${batchId}/assign-wallet-and-mint`,{method:'POST',body:JSON.stringify({walletAddress:assignWallet})}); showToast(`✅ Wallet assigned + Token #${r.tokenId} minted`); setModal(null); setAssignWallet(''); loadCredits(); } catch(e){showToast(`❌ ${e.message}`);} finally{setSyncingId(null);} };
  const handleBulkKycApprove = async () => { if(!selectedKycIds.length){showToast('❌ Select at least one submission');return;} try { const r = await apiFetch('/api/admin/kyc/bulk-approve',{method:'POST',body:JSON.stringify({ids:selectedKycIds})}); showToast(`✅ ${r.approved} approved · ❌ ${r.failed} failed`); setSelectedKycIds([]); loadKYC(); loadStats(); } catch(e){showToast(`❌ ${e.message}`);} };
  const handleExportAudit = () => { window.open(`${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/admin/audit/export`, '_blank'); };

  const reviewFlag = async (flagId, status, notes) => { try { await apiFetch(`/api/compliance/flags/${flagId}`,{method:'PUT',body:JSON.stringify({status,reviewNotes:notes})}); showToast(`Flag marked ${status}`); setModal(null); setReason(''); loadCompFlags(); } catch(e){showToast(`❌ ${e.message}`);} };
  const saveConfig = async (key, value) => { try { await apiFetch(`/api/compliance/config/${key}`,{method:'PUT',body:JSON.stringify({value})}); showToast(`✅ ${key} updated`); setEditingConfig(p=>{const n={...p};delete n[key];return n;}); loadCompConfig(); } catch(e){showToast(`❌ ${e.message}`);} };

  const fmt     = (d) => d ? new Date(d).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';
  const fmtTime = (d) => d ? new Date(d).toLocaleString('en-IN') : '—';
  const fmtINR  = (n) => `₹${parseFloat(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  const Badge = ({ status }) => {
    const color = {pending:'#f59e0b',approved:'#22c55e',verified:'#22c55e',rejected:'#f87171',frozen:'#f87171',open:'#f59e0b',resolved:'#22c55e',cleared:'#22c55e',reviewed:'#60a5fa',escalated:'#f87171',low:'#22c55e',medium:'#f59e0b',high:'#f97316',critical:'#f87171',active:'#22c55e'}[status]||'#86efac44';
    return <span style={{fontSize:9,padding:'3px 8px',borderRadius:20,border:`1px solid ${color}33`,color,letterSpacing:'.08em'}}>{status?.toUpperCase().replace(/_/g,' ')}</span>;
  };
  const MintBadge = ({ credit }) => {
    if (credit.token_id!=null) return <span style={{fontSize:9,padding:'3px 8px',borderRadius:20,border:'1px solid #22c55e33',color:'#22c55e'}}>✓ #{credit.token_id}</span>;
    if (credit.admin_status==='approved') return <span style={{fontSize:9,padding:'3px 8px',borderRadius:20,border:'1px solid #f8717133',color:'#f87171',animation:'pulse 2s infinite'}}>⚠ FAILED</span>;
    return <span style={{fontSize:9,color:'#86efac33'}}>—</span>;
  };
  const sevColor = {low:'#22c55e',medium:'#f59e0b',high:'#f97316',critical:'#f87171'};
  const flagTypeLabel = {ctr:'🚨 CTR',daily_limit:'📅 DAILY',monthly_limit:'📆 MONTHLY',velocity:'⚡ VELOCITY',structuring:'⚠ STRUCT',inr_crypto_conv:'🔄 FEMA'};

  return (
    <div style={S.page}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      {toast && <div style={S.toast}>{toast}</div>}

      {/* Sidebar */}
      <div style={S.sidebar}>
        <div style={S.sideTop}><div style={S.logo}>⚡ ETHERTRACK</div><div style={S.logoSub}>ADMIN CONSOLE</div></div>
        {TABS.map(t => (
          <button key={t.id} style={{...S.navBtn,...(tab===t.id?S.navBtnActive:{})}} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id==='kyc'           && stats?.pendingKYC     > 0 && <span style={S.badge}>{stats.pendingKYC}</span>}
            {t.id==='credits'       && stats?.pendingCredits > 0 && <span style={S.badge}>{stats.pendingCredits}</span>}
            {t.id==='credits'       && stats?.failedMints    > 0 && <span style={{...S.badge,background:'#f87171'}}>{stats.failedMints}</span>}
            {t.id==='disputes'      && stats?.openDisputes   > 0 && <span style={S.badge}>{stats.openDisputes}</span>}
            {t.id==='accounts'      && kycExpiring.length    > 0 && <span style={{...S.badge,background:'#f59e0b'}}>{kycExpiring.length}</span>}
            {t.id==='compliance'    && compStats.criticalFlags>0 && <span style={{...S.badge,background:'#f87171'}}>{compStats.criticalFlags}</span>}
          </button>
        ))}
        <div style={{marginTop:'auto',padding:'16px'}}>
          <div style={{fontSize:10,color:'#f59e0bbb',marginBottom:6}}>{dbUser?.email}</div>
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
                {label:'PENDING KYC',     value:stats?.pendingKYC??'—',     color:'#f59e0b',icon:'🔍'},
                {label:'PENDING CREDITS', value:stats?.pendingCredits??'—', color:'#60a5fa',icon:'🌿'},
                {label:'FAILED MINTS',    value:stats?.failedMints??'—',    color:'#f87171',icon:'⚠'},
                {label:'TOTAL USERS',     value:stats?.totalUsers??'—',     color:'#22c55e',icon:'👤'},
                {label:'FROZEN ACCOUNTS', value:stats?.frozenAccounts??'—', color:'#f87171',icon:'🔒'},
                {label:'OPEN DISPUTES',   value:stats?.openDisputes??'—',   color:'#a78bfa',icon:'⚖️'},
              ].map(({label,value,color,icon}) => (
                <div key={label} style={S.statCard}>
                  <div style={{fontSize:26,marginBottom:8}}>{icon}</div>
                  <div style={{fontSize:28,fontWeight:700,color,marginBottom:4}}>{value}</div>
                  <div style={{fontSize:9,color:'#f59e0bcc',letterSpacing:'.12em'}}>{label}</div>
                </div>
              ))}
            </div>
            {kycExpiring.length > 0 && (
              <div style={{...S.section,marginTop:20,border:'1px solid #f59e0b44',background:'#110a00'}}>
                <div style={{fontSize:9,color:'#f59e0b',letterSpacing:'.16em',marginBottom:12}}>⚠ KYC EXPIRING SOON — {kycExpiring.length} USER{kycExpiring.length>1?'S':''}</div>
                {kycExpiring.slice(0,4).map(u => (
                  <div key={u.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid #f59e0b11'}}>
                    <div><div style={{fontSize:11,color:'#f0fdf4'}}>{u.full_name} <span style={{color:'#f59e0b88',fontSize:9}}>({u.email})</span></div><div style={{fontSize:9,color:'#f59e0b66',marginTop:2}}>Expires {fmt(u.kyc_expires_at)} · {u.days_left} days left</div></div>
                    <button style={{...S.viewBtn,borderColor:'#f59e0b44',color:'#f59e0b'}} onClick={() => handleKycReminder(u.id,u.email)}>📧 REMIND</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{...S.section,marginTop:16}}>
              <div style={S.sectionTitle}>QUICK ACTIONS</div>
              <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                {[
                  {label:'Review KYC',        action:()=>setTab('kyc')},
                  {label:'Review Credits',    action:()=>setTab('credits')},
                  {label:'Manage Accounts',   action:()=>setTab('accounts')},
                  {label:'Retirements',        action:()=>setTab('retirements')},
                  {label:'Announcements',     action:()=>setTab('announcements')},
                  {label:'Audit Log',         action:()=>setTab('audit')},
                  {label:'Compliance →',      action:()=>setTab('compliance')},
                ].map(({label,action}) => (
                  <button key={label} style={S.quickBtn} onClick={action}>{label} →</button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── KYC QUEUE ── */}
        {tab === 'kyc' && (
          <div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24,flexWrap:'wrap',gap:12}}>
              <div style={S.pageTitle}>KYC Queue</div>
              {selectedKycIds.length > 0 && (
                <button style={{...S.approveBtn,padding:'8px 16px',fontSize:10}} onClick={handleBulkKycApprove}>
                  ✓ BULK APPROVE {selectedKycIds.length} SELECTED
                </button>
              )}
            </div>
            <div style={{display:'flex',gap:8,marginBottom:20}}>
              {['pending','approved','rejected'].map(s => (
                <button key={s} style={{...S.filterBtn,...(kycFilter===s?S.filterBtnActive:{})}} onClick={() => setKycFilter(s)}>{s.toUpperCase()}</button>
              ))}
            </div>
            {loading ? <div style={S.loading}>Loading...</div> : (
              <div style={S.table}>
                <div style={{...S.tableHead,gridTemplateColumns:'32px 2fr 1fr 1fr 1fr 1fr 1.5fr'}}>
                  <div style={S.th}><input type="checkbox" onChange={e => setSelectedKycIds(e.target.checked?kyc.filter(k=>k.status==='pending').map(k=>k.id):[])}/></div>
                  {['USER','ID TYPE','SUBMITTED','STATUS','DOC','ACTIONS'].map(h=><div key={h} style={S.th}>{h}</div>)}
                </div>
                {kyc.length===0&&<div style={S.empty}>No {kycFilter} KYC submissions</div>}
                {kyc.map(k => (
                  <div key={k.id} style={{...S.tableRow,gridTemplateColumns:'32px 2fr 1fr 1fr 1fr 1fr 1.5fr'}}>
                    <div style={S.td}>{k.status==='pending'&&<input type="checkbox" checked={selectedKycIds.includes(k.id)} onChange={e=>setSelectedKycIds(p=>e.target.checked?[...p,k.id]:p.filter(i=>i!==k.id))}/>}</div>
                    <div style={S.td}><div style={{color:'#f0fdf4',fontSize:11}}>{k.full_name}</div><div style={{color:'#f59e0bcc',fontSize:9}}>{k.email}</div></div>
                    <div style={S.td}><Badge status={k.id_type}/></div>
                    <div style={{...S.td,fontSize:10,color:'#f59e0bbb'}}>{fmt(k.submitted_at)}</div>
                    <div style={S.td}><Badge status={k.status}/></div>
                    <div style={S.td}>{k.doc_ipfs_hash?<a href={`${PINATA_GW}/${k.doc_ipfs_hash}`} target="_blank" rel="noreferrer" style={{fontSize:10,color:'#60a5fa',textDecoration:'none'}}>VIEW ↗</a>:'—'}</div>
                    <div style={{...S.td,display:'flex',gap:4}}>
                      <button style={S.viewBtn} onClick={() => setModal({type:'kyc_detail',data:k})}>DETAILS</button>
                      {k.status==='pending'&&<><button style={S.approveBtn} onClick={() => setModal({type:'kyc_approve',data:k})}>✓</button><button style={S.rejectBtn} onClick={() => setModal({type:'kyc_reject',data:k})}>✕</button></>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── CREDITS ── */}
        {tab === 'credits' && (
          <div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24,flexWrap:'wrap',gap:12}}>
              <div style={S.pageTitle}>Carbon Credit Listings</div>
              {failedMints.length>0&&<button style={{padding:'10px 18px',borderRadius:6,border:'1px solid #f8717166',background:retryingAll?'#1a0707':'#f8717111',color:'#f87171',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:11,display:'flex',alignItems:'center',gap:8}} onClick={retryAllMints} disabled={retryingAll}>{retryingAll?<><span style={S.spinner}/>RETRYING...</>:`⚠ RETRY ${failedMints.length} FAILED`}</button>}
            </div>
            <div style={{display:'flex',gap:8,marginBottom:20}}>
              {['pending','approved','rejected'].map(s => (
                <button key={s} style={{...S.filterBtn,...(creditFilter===s?S.filterBtnActive:{})}} onClick={() => setCreditFilter(s)}>{s.toUpperCase()}{s==='approved'&&failedMints.length>0&&<span style={{marginLeft:6,background:'#f87171',color:'#fff',fontSize:8,padding:'1px 5px',borderRadius:8}}>{failedMints.length}</span>}</button>
              ))}
            </div>
            {loading?<div style={S.loading}>Loading...</div>:(
              <div style={S.table}>
                <div style={{...S.tableHead,gridTemplateColumns:'2fr 1fr 1.5fr 1fr 1fr 1fr 1.5fr 2fr'}}>
                  {['USER','REGISTRY','SERIAL','QTY','VINTAGE','PROOF','MINT','ACTIONS'].map(h=><div key={h} style={S.th}>{h}</div>)}
                </div>
                {credits.length===0&&<div style={S.empty}>No {creditFilter} credits</div>}
                {credits.map(c => (
                  <div key={c.id} style={{...S.tableRow,gridTemplateColumns:'2fr 1fr 1.5fr 1fr 1fr 1fr 1.5fr 2fr',...(c.admin_status==='approved'&&!c.token_id?{background:'#1a070711',borderLeft:'2px solid #f8717133'}:{})}}>
                    <div style={S.td}><div style={{color:'#f0fdf4',fontSize:11}}>{c.full_name}</div><div style={{color:'#f59e0bcc',fontSize:9}}>{c.email}</div></div>
                    <div style={{...S.td,fontSize:10}}>{c.standard||'—'}</div>
                    <div style={{...S.td,fontSize:9,color:'#60a5fadd',fontFamily:'monospace'}}>{(c.registry_serial||'—').slice(0,18)}</div>
                    <div style={{...S.td,fontSize:11,color:'#22c55e'}}>{c.quantity}</div>
                    <div style={{...S.td,fontSize:10,color:'#f59e0bbb'}}>{c.vintage_year}</div>
                    <div style={S.td}>{c.doc_ipfs_hash?<a href={`${PINATA_GW}/${c.doc_ipfs_hash}`} target="_blank" rel="noreferrer" style={{fontSize:10,color:'#60a5fa',textDecoration:'none'}}>↗</a>:'—'}</div>
                    <div style={S.td}><MintBadge credit={c}/></div>
                    <div style={{...S.td,display:'flex',gap:4,flexWrap:'wrap'}}>
                      <button style={S.viewBtn} onClick={() => setModal({type:'credit_detail',data:c})}>DETAILS</button>
                      {c.admin_status==='pending'&&<><button style={S.approveBtn} onClick={() => setModal({type:'credit_approve',data:c})}>✓</button><button style={S.rejectBtn} onClick={() => setModal({type:'credit_reject',data:c})}>✕</button><button style={{...S.viewBtn,borderColor:'#a78bfa33',color:'#a78bfaaa'}} onClick={() => {setNewQty(String(c.quantity));setReason('');setModal({type:'qty_correction',data:c});}}>✎ QTY</button></>}
                      {c.admin_status==='approved'&&!c.token_id&&<>
                        <button style={{padding:'4px 8px',borderRadius:4,border:'1px solid #f8717144',background:'#f8717111',color:'#f87171',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:9,display:'flex',alignItems:'center',gap:4}} onClick={() => retryMint(c.id)} disabled={retryingId===c.id}>{retryingId===c.id?<><span style={{...S.spinner,width:8,height:8}}/>...</>:'⟳ RETRY'}</button>
                        <button style={{padding:'4px 8px',borderRadius:4,border:'1px solid #60a5fa44',background:'#60a5fa11',color:'#60a5fa',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:9}} onClick={() => {setManualTokenId('');setModal({type:'manual_token_sync',data:c});}}>✎ SET ID</button>
                        <button style={{padding:'4px 8px',borderRadius:4,border:'1px solid #a78bfa44',background:'#a78bfa11',color:'#a78bfa',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:9}} onClick={() => handleLoadMintDiag(c.id)}>🔍 WHY</button>
                        {!c.user_wallet&&<button style={{padding:'4px 8px',borderRadius:4,border:'1px solid #a78bfa44',background:'#a78bfa11',color:'#a78bfa',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:9}} onClick={() => {setAssignWallet('');setModal({type:'assign_wallet_mint',data:c});}}>🔑+⛓</button>}
                      </>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── RETIREMENTS ── */}
        {tab === 'retirements' && (
          <div>
            <div style={S.pageTitle}>Retirement Records</div>
            {/* Search bar */}
            <div style={{display:'flex',gap:10,marginBottom:20}}>
              <input style={{...S.searchInput,flex:1}} placeholder="Search by certificate ID, serial, email, or name..." value={retirementSearch} onChange={e=>setRetirementSearch(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleSearchRetirements()}/>
              <button style={{...S.quickBtn,borderColor:'#22c55e44',color:'#22c55e'}} onClick={handleSearchRetirements}>🔍 SEARCH</button>
              {retirementResults!==null&&<button style={{...S.filterBtn,borderColor:'#f59e0b33',color:'#f59e0baa'}} onClick={()=>{setRetirementResults(null);setRetirementSearch('');}}>✕ CLEAR</button>}
            </div>
            {loading?<div style={S.loading}>Loading...</div>:(
              <div style={S.table}>
                <div style={{...S.tableHead,gridTemplateColumns:'2fr 1.5fr 1fr 1fr 1fr 1fr 1.5fr'}}>
                  {['USER','CERTIFICATE ID','CREDITS','STANDARD','SCOPE','DISPUTED','ACTIONS'].map(h=><div key={h} style={S.th}>{h}</div>)}
                </div>
                {(retirementResults??retirements).length===0&&<div style={S.empty}>{retirementResults!==null?'No results found':'No retirements'}</div>}
                {(retirementResults??retirements).map(r => (
                  <div key={r.id} style={{...S.tableRow,gridTemplateColumns:'2fr 1.5fr 1fr 1fr 1fr 1fr 1.5fr',...(r.disputed?{background:'#1a070711',borderLeft:'2px solid #f8717133'}:{})}}>
                    <div style={S.td}><div style={{color:'#f0fdf4',fontSize:11}}>{r.full_name||'—'}</div><div style={{color:'#f59e0bcc',fontSize:9}}>{r.email}</div></div>
                    <div style={{...S.td,fontSize:9,color:'#22c55ecc',fontFamily:'monospace'}}>{(r.certificate_id||'—').slice(0,20)}</div>
                    <div style={{...S.td,fontSize:11,color:'#f87171'}}>{r.amount} tCO₂</div>
                    <div style={{...S.td,fontSize:10}}>{r.standard||'—'}</div>
                    <div style={{...S.td,fontSize:10}}>S{r.retire_scope||'—'}</div>
                    <div style={S.td}>{r.disputed?<span style={{fontSize:9,color:'#f87171'}}>⚠ DISPUTED</span>:<span style={{fontSize:9,color:'#22c55e44'}}>—</span>}</div>
                    <div style={{...S.td,display:'flex',gap:4}}>
                      {r.tx_hash&&<a href={`https://sepolia.etherscan.io/tx/${r.tx_hash}`} target="_blank" rel="noreferrer" style={{...S.viewBtn,textDecoration:'none',display:'flex',alignItems:'center'}}>⛓</a>}
                      {!r.disputed?<button style={S.rejectBtn} onClick={() => {setReason('');setModal({type:'flag_retirement',data:r});}}>FLAG</button>:<button style={S.approveBtn} onClick={() => handleUnflagRetirement(r.id)}>CLEAR</button>}
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
            {kycExpiring.length>0&&(
              <div style={{...S.section,marginBottom:20,border:'1px solid #f59e0b33',background:'#0d0800'}}>
                <div style={{fontSize:9,color:'#f59e0b',letterSpacing:'.14em',marginBottom:10}}>⚠ KYC EXPIRING WITHIN 90 DAYS</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:8}}>
                  {kycExpiring.map(u=>(
                    <div key={u.id} style={{padding:'10px 14px',background:'#0a0800',border:'1px solid #f59e0b22',borderRadius:8,display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
                      <div><div style={{fontSize:11,color:'#f0fdf4'}}>{u.full_name}</div><div style={{fontSize:9,color:'#f59e0b88',marginTop:2}}>{u.days_left}d · {fmt(u.kyc_expires_at)}</div></div>
                      <button style={{...S.viewBtn,borderColor:'#f59e0b33',color:'#f59e0b',flexShrink:0}} onClick={() => handleKycReminder(u.id,u.email)}>📧</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{display:'flex',gap:8,marginBottom:20,flexWrap:'wrap'}}>
              <input style={S.searchInput} placeholder="Search by name or email..." value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==='Enter'&&loadUsers()}/>
              {['','frozen','verified','pending'].map(s=><button key={s} style={{...S.filterBtn,...(userFilter===s?S.filterBtnActive:{})}} onClick={()=>setUserFilter(s)}>{s||'ALL'}</button>)}
            </div>
            {loading?<div style={S.loading}>Loading...</div>:(
              <div style={S.table}>
                <div style={{...S.tableHead,gridTemplateColumns:'2fr 1.5fr 1fr 1fr 1fr 2.5fr'}}>{['USER','WALLET','KYC','STATUS','JOINED','ACTIONS'].map(h=><div key={h} style={S.th}>{h}</div>)}</div>
                {users.length===0&&<div style={S.empty}>No users found</div>}
                {users.map(u=>(
                  <div key={u.id} style={{...S.tableRow,gridTemplateColumns:'2fr 1.5fr 1fr 1fr 1fr 2.5fr'}}>
                    <div style={S.td}><div style={{color:u.frozen?'#f87171':'#f0fdf4',fontSize:11}}>{u.full_name||'—'}{u.frozen&&' 🔒'}</div><div style={{color:'#f59e0bcc',fontSize:9}}>{u.email}</div></div>
                    <div style={{...S.td,fontSize:9,color:'#60a5facc',fontFamily:'monospace'}}>{u.wallet_address?`${u.wallet_address.slice(0,6)}...${u.wallet_address.slice(-4)}`:'—'}</div>
                    <div style={S.td}><Badge status={u.kyc_status||'pending'}/></div>
                    <div style={S.td}><Badge status={u.frozen?'frozen':'active'}/></div>
                    <div style={{...S.td,fontSize:10,color:'#f59e0bbb'}}>{fmt(u.created_at)}</div>
                    <div style={{...S.td,display:'flex',gap:4,flexWrap:'wrap'}}>
                      <button style={S.viewBtn} onClick={() => { loadUserData(u.id); setModal({type:'user_detail',data:u}); }}>VIEW</button>
                      <button style={{...S.viewBtn,borderColor:'#22c55e33',color:'#22c55eaa'}} onClick={() => { loadUserData(u.id); setModal({type:'user_history',data:u}); }}>HISTORY</button>
                      <button style={{...S.viewBtn,borderColor:'#f59e0b33',color:'#f59e0baa'}} onClick={() => { setMsgSubject(''); setMsgBody(''); setModal({type:'send_message',data:u}); }}>📧 MSG</button>
                      {!u.frozen?<button style={S.rejectBtn} onClick={() => setModal({type:'freeze',data:u})}>FREEZE</button>:<button style={S.approveBtn} onClick={() => setModal({type:'unfreeze',data:u})}>UNFREEZE</button>}
                      <button style={{...S.viewBtn,borderColor:'#60a5fa33',color:'#60a5faaa'}} onClick={() => { setNewWallet(''); setReason(''); setModal({type:'reassign_wallet',data:u}); }}>🔑</button>
                      <button style={{...S.viewBtn,borderColor:'#a78bfa33',color:'#a78bfaaa'}} onClick={() => handleResyncPortfolio(u.id)}>🔄</button>
                      <button style={{...S.viewBtn,borderColor:'#f59e0b33',color:'#f59e0baa'}} onClick={() => { setReason(''); setModal({type:'require_rekyc',data:u}); }}>↻ KYC</button>
                      <button style={{...S.rejectBtn,fontSize:8,padding:'3px 6px',opacity:.7}} onClick={() => { setReason(''); setModal({type:'delete_user',data:u}); }}>DEL</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── BLACKLIST ── */}
        {tab === 'blacklist' && (
          <div>
            <div style={S.pageTitle}>Serial Number Blacklist</div>
            <div style={{...S.section,marginBottom:20}}>
              <div style={S.sectionTitle}>BLACKLIST NEW SERIAL</div>
              <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                <input style={{...S.searchInput,minWidth:240}} placeholder="Serial number e.g. VCS-2023-IN-00412" value={newSerial} onChange={e=>setNewSerial(e.target.value)}/>
                <input style={{...S.searchInput,flex:1}} placeholder="Reason for blacklisting..." value={reason} onChange={e=>setReason(e.target.value)}/>
                <button style={{...S.quickBtn,borderColor:'#f87171',color:'#f87171'}} onClick={handleBlacklistSerial}>🚫 BLACKLIST</button>
              </div>
            </div>
            {loading?<div style={S.loading}>Loading...</div>:(
              <div style={S.table}>
                <div style={{...S.tableHead,gridTemplateColumns:'2fr 3fr 1.5fr 1fr'}}>{['SERIAL NUMBER','REASON','BLACKLISTED BY','ACTION'].map(h=><div key={h} style={S.th}>{h}</div>)}</div>
                {blacklist.length===0&&<div style={S.empty}>No blacklisted serials</div>}
                {blacklist.map(b=>(
                  <div key={b.serial_number} style={{...S.tableRow,gridTemplateColumns:'2fr 3fr 1.5fr 1fr'}}>
                    <div style={{...S.td,fontSize:10,color:'#f87171',fontFamily:'monospace'}}>{b.serial_number}</div>
                    <div style={{...S.td,fontSize:10,color:'#f59e0bbb'}}>{b.reason}</div>
                    <div style={{...S.td,fontSize:9,color:'#f59e0b88'}}>{b.blacklisted_by_email||'—'}</div>
                    <div style={S.td}><button style={S.approveBtn} onClick={() => handleUnblacklist(b.serial_number)}>REMOVE</button></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ANNOUNCEMENTS ── */}
        {tab === 'announcements' && (
          <div>
            <div style={S.pageTitle}>Announcements & Messaging</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:24}}>
              {/* Broadcast */}
              <div style={S.section}>
                <div style={S.sectionTitle}>📢 BROADCAST TO ALL USERS</div>
                <input style={{...S.searchInput,width:'100%',marginBottom:10}} placeholder="Subject / Title" value={annTitle} onChange={e=>setAnnTitle(e.target.value)}/>
                <textarea style={{...M.textarea,marginBottom:10}} placeholder="Message body..." value={annMsg} onChange={e=>setAnnMsg(e.target.value)}/>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
                  <input type="checkbox" id="annEmail" checked={annEmail} onChange={e=>setAnnEmail(e.target.checked)}/>
                  <label htmlFor="annEmail" style={{fontSize:10,color:'#f59e0bcc'}}>Also send email (slower — sends to every user)</label>
                </div>
                <button style={{...S.quickBtn,borderColor:'#f59e0b66',color:'#f59e0b',width:'100%',textAlign:'center',opacity:broadcasting?.5:1}} onClick={handleBroadcast} disabled={broadcasting}>
                  {broadcasting?'⟳ BROADCASTING...':`📢 BROADCAST${annEmail?' + EMAIL':' (IN-APP ONLY)'}`}
                </button>
              </div>
              {/* Banner */}
              <div style={S.section}>
                <div style={S.sectionTitle}>🪧 PLATFORM BANNER (shown in-app)</div>
                <input style={{...S.searchInput,width:'100%',marginBottom:10}} placeholder="Banner title" value={annTitle} onChange={e=>setAnnTitle(e.target.value)}/>
                <textarea style={{...M.textarea,marginBottom:10,minHeight:60}} placeholder="Banner message..." value={annMsg} onChange={e=>setAnnMsg(e.target.value)}/>
                <select style={{...S.searchInput,width:'100%',marginBottom:12}} value={annType} onChange={e=>setAnnType(e.target.value)}>
                  <option value="info">ℹ Info (blue)</option>
                  <option value="warning">⚠ Warning (yellow)</option>
                  <option value="critical">🚨 Critical (red)</option>
                  <option value="success">✅ Success (green)</option>
                </select>
                <button style={{...S.quickBtn,borderColor:'#60a5fa44',color:'#60a5fa',width:'100%',textAlign:'center'}} onClick={handleSaveAnnouncement}>
                  🪧 SAVE BANNER
                </button>
              </div>
            </div>
            {/* Active banners */}
            <div style={S.sectionTitle}>ACTIVE BANNERS</div>
            {announcements.length===0?<div style={S.empty}>No active banners</div>:announcements.map(a=>(
              <div key={a.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 16px',marginBottom:8,background:'#0d0a00',border:'1px solid #f59e0b22',borderRadius:8}}>
                <div>
                  <div style={{fontSize:11,color:'#f0fdf4',fontWeight:600}}>{a.title}</div>
                  <div style={{fontSize:10,color:'#f59e0baa',marginTop:3}}>{a.message?.slice(0,80)}...</div>
                  <div style={{fontSize:9,color:'#f59e0b44',marginTop:4}}>{fmt(a.created_at)} · {a.type?.toUpperCase()}</div>
                </div>
                <button style={S.rejectBtn} onClick={() => handleDeleteAnnouncement(a.id)}>REMOVE</button>
              </div>
            ))}
          </div>
        )}

        {/* ── LISTINGS ── */}
        {tab === 'listings' && (
          <div>
            <div style={S.pageTitle}>Active Marketplace Listings</div>
            {loading?<div style={S.loading}>Loading...</div>:(
              <div style={S.table}>
                <div style={{...S.tableHead,gridTemplateColumns:'2fr 1.5fr 1fr 1fr 1fr 1fr 1fr 1.5fr'}}>
                  {['SELLER','PROJECT','SERIAL','QTY','PRICE ₹','STANDARD','LISTED','ACTIONS'].map(h=><div key={h} style={S.th}>{h}</div>)}
                </div>
                {listings.length===0&&<div style={S.empty}>No active listings</div>}
                {listings.map(l => (
                  <div key={l.id} style={{...S.tableRow,gridTemplateColumns:'2fr 1.5fr 1fr 1fr 1fr 1fr 1fr 1.5fr'}}>
                    <div style={S.td}><div style={{color:'#f0fdf4',fontSize:11}}>{l.seller_name||'—'}</div><div style={{color:'#f59e0bcc',fontSize:9}}>{l.seller_email}</div></div>
                    <div style={{...S.td,fontSize:10,color:'#f0fdf4'}}>{l.project_name||'—'}</div>
                    <div style={{...S.td,fontSize:9,color:'#60a5facc',fontFamily:'monospace'}}>{(l.registry_serial||'—').slice(0,16)}</div>
                    <div style={{...S.td,fontSize:11,color:'#22c55e'}}>{l.amount_remaining??l.amount??'—'}</div>
                    <div style={{...S.td,fontSize:11,color:'#f0fdf4'}}>₹{parseFloat(l.price_per_credit_inr||0).toLocaleString('en-IN')}</div>
                    <div style={S.td}><Badge status={l.standard||'VCS'}/></div>
                    <div style={{...S.td,fontSize:9,color:'#f59e0baa'}}>{fmt(l.created_at)}</div>
                    <div style={{...S.td,display:'flex',gap:4,flexWrap:'wrap'}}>
                      <button style={{...S.viewBtn,borderColor:'#f59e0b33',color:'#f59e0b'}} onClick={()=>{setPriceOverride('');setReason('');setModal({type:'price_override',data:{listingId:l.id,project_name:l.project_name}});}}>₹ PRICE</button>
                      <button style={S.rejectBtn} onClick={()=>{setReason('');setModal({type:'force_delist',data:l});}}>DELIST</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── PROJECTS ── */}
        {tab === 'projects' && (
          <div>
            <div style={S.pageTitle}>Project Registry</div>
            {loading?<div style={S.loading}>Loading...</div>:(
              <div style={S.table}>
                <div style={{...S.tableHead,gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr 1fr 1fr'}}>
                  {['PROJECT','STANDARD','BATCHES','TOTAL tCO₂','AVAILABLE','RETIRED','MINTED'].map(h=><div key={h} style={S.th}>{h}</div>)}
                </div>
                {projects.length===0&&<div style={S.empty}>No projects</div>}
                {projects.map(p=>(
                  <div key={p.id} style={{...S.tableRow,gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr 1fr 1fr'}}>
                    <div style={S.td}><div style={{color:'#f0fdf4',fontSize:11}}>{p.project_name}</div><div style={{color:'#f59e0bcc',fontSize:9}}>{p.project_code} · {p.developer_name||'—'}</div><div style={{color:'#86efac44',fontSize:9}}>{p.country||'—'}</div></div>
                    <div style={S.td}><Badge status={p.standard}/></div>
                    <div style={{...S.td,fontSize:11}}>{p.batch_count}</div>
                    <div style={{...S.td,fontSize:11,color:'#f0fdf4'}}>{parseInt(p.total_credits).toLocaleString()}</div>
                    <div style={{...S.td,fontSize:11,color:'#22c55e'}}>{parseInt(p.available_credits).toLocaleString()}</div>
                    <div style={{...S.td,fontSize:11,color:'#f87171'}}>{parseInt(p.retired_credits).toLocaleString()}</div>
                    <div style={{...S.td,fontSize:11,color:p.minted_batches>0?'#22c55e':'#f59e0baa'}}>{p.minted_batches}/{p.batch_count}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── REVENUE ── */}
        {tab === 'revenue' && (
          <div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20,flexWrap:'wrap',gap:12}}>
              <div style={S.pageTitle}>Revenue & Fee Dashboard</div>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <span style={{fontSize:10,color:'#f59e0baa'}}>PERIOD:</span>
                {['7','30','90','365'].map(p=>(
                  <button key={p} style={{...S.filterBtn,...(revPeriod===p?S.filterBtnActive:{})}} onClick={()=>{setRevPeriod(p);loadRevenue(p);}}>
                    {p==='365'?'1Y':`${p}D`}
                  </button>
                ))}
              </div>
            </div>
            {loading||!revenue?<div style={S.loading}>Loading...</div>:(
              <>
                {/* Summary cards */}
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:24}}>
                  {[
                    {label:`FEES (${revPeriod}D)`,   value:`₹${parseFloat(revenue.summary?.period_fees_inr||0).toLocaleString('en-IN',{maximumFractionDigits:0})}`, color:'#22c55e'},
                    {label:'TOTAL FEES (ALL)',        value:`₹${parseFloat(revenue.summary?.total_fees_inr||0).toLocaleString('en-IN',{maximumFractionDigits:0})}`, color:'#22c55e'},
                    {label:'TOTAL VOLUME',            value:`₹${parseFloat(revenue.summary?.total_volume_inr||0).toLocaleString('en-IN',{maximumFractionDigits:0})}`, color:'#60a5fa'},
                    {label:'CREDITS TRADED',          value:`${parseInt(revenue.summary?.total_credits_traded||0).toLocaleString()} t`, color:'#f59e0b'},
                    {label:'TOTAL TRADES',            value:revenue.summary?.total_trades||0, color:'#a78bfa'},
                    {label:`ACTIVE USERS (${revPeriod}D)`, value:revenue.activeUsers||0, color:'#34d399'},
                  ].map(({label,value,color})=>(
                    <div key={label} style={{...S.statCard,padding:'14px'}}>
                      <div style={{fontSize:20,fontWeight:700,color,marginBottom:4}}>{value}</div>
                      <div style={{fontSize:9,color:'#f59e0bcc',letterSpacing:'.1em'}}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* Fees by month */}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:20}}>
                  <div style={S.section}>
                    <div style={S.sectionTitle}>FEES BY MONTH</div>
                    {revenue.feesByMonth?.length===0?<div style={{fontSize:10,color:'#f59e0b44'}}>No data</div>:revenue.feesByMonth?.map(m=>(
                      <div key={m.month} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid #f59e0b08'}}>
                        <span style={{fontSize:10,color:'#f59e0bcc'}}>{m.month}</span>
                        <div style={{textAlign:'right'}}>
                          <div style={{fontSize:11,color:'#22c55e'}}>₹{parseFloat(m.fees_inr).toLocaleString('en-IN',{maximumFractionDigits:0})}</div>
                          <div style={{fontSize:9,color:'#f59e0b44'}}>{m.trades} trades</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={S.section}>
                    <div style={S.sectionTitle}>RETIREMENTS BY MONTH</div>
                    {revenue.retirementsByMonth?.length===0?<div style={{fontSize:10,color:'#f59e0b44'}}>No data</div>:revenue.retirementsByMonth?.map(m=>(
                      <div key={m.month} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid #f59e0b08'}}>
                        <span style={{fontSize:10,color:'#f59e0bcc'}}>{m.month}</span>
                        <div style={{textAlign:'right'}}>
                          <div style={{fontSize:11,color:'#f87171'}}>{parseInt(m.tco2).toLocaleString()} tCO₂</div>
                          <div style={{fontSize:9,color:'#f59e0b44'}}>{m.count} certs</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Top traders + credits by standard */}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
                  <div style={S.section}>
                    <div style={S.sectionTitle}>TOP 10 TRADERS BY VOLUME</div>
                    {revenue.topTraders?.map((t,i)=>(
                      <div key={t.email} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 0',borderBottom:'1px solid #f59e0b08'}}>
                        <div><span style={{fontSize:9,color:'#f59e0b44',marginRight:8}}>#{i+1}</span><span style={{fontSize:11,color:'#f0fdf4'}}>{t.full_name||t.email}</span><div style={{fontSize:9,color:'#f59e0b44'}}>{t.trade_count} trades</div></div>
                        <div style={{fontSize:11,color:'#22c55e'}}>₹{parseFloat(t.volume_inr).toLocaleString('en-IN',{maximumFractionDigits:0})}</div>
                      </div>
                    ))}
                  </div>
                  <div style={S.section}>
                    <div style={S.sectionTitle}>CREDITS BY STANDARD</div>
                    {revenue.creditsByStandard?.map(s=>(
                      <div key={s.standard} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 0',borderBottom:'1px solid #f59e0b08'}}>
                        <div><Badge status={s.standard}/><span style={{fontSize:9,color:'#f59e0b44',marginLeft:8}}>{s.batches} batches</span></div>
                        <div style={{fontSize:11,color:'#f0fdf4'}}>{parseInt(s.total_credits).toLocaleString()} t</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── CHAIN HEALTH ── */}
        {tab === 'health' && (
          <div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
              <div style={S.pageTitle}>🩺 On-Chain Health Monitor</div>
              <button style={{...S.quickBtn,borderColor:'#22c55e44',color:'#22c55e'}} onClick={loadHealth} disabled={healthLoading}>
                {healthLoading?'⟳ Checking...':'↻ REFRESH'}
              </button>
            </div>
            {healthLoading&&!health?<div style={S.loading}>Connecting to Sepolia...</div>:health&&(
              <>
                {/* Minter wallet alert */}
                {health.minterWallet&&!health.minterWallet.ok&&(
                  <div style={{padding:'14px 18px',background:'#1a0707',border:'1px solid #f8717133',borderRadius:8,marginBottom:20,display:'flex',alignItems:'center',gap:12}}>
                    <span style={{fontSize:24}}>🚨</span>
                    <div>
                      <div style={{fontSize:13,color:'#f87171',fontWeight:700}}>MINTER WALLET LOW ON ETH — Mints will fail</div>
                      <div style={{fontSize:11,color:'#f8717188',marginTop:4}}>Balance: {health.minterWallet.balanceEth} ETH · Need &gt;0.01 ETH to mint · <a href="https://faucet.sepolia.dev" target="_blank" rel="noreferrer" style={{color:'#60a5fa'}}>Get Sepolia ETH ↗</a></div>
                    </div>
                  </div>
                )}

                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:24}}>
                  {[
                    {label:'RPC CONNECTION',   value:health.rpcConnected?'CONNECTED':'DOWN',         color:health.rpcConnected?'#22c55e':'#f87171',   icon:health.rpcConnected?'✅':'❌'},
                    {label:'MINTER BALANCE',    value:health.minterWallet?.balanceEth!=null?`${health.minterWallet.balanceEth} ETH`:'Unknown', color:health.minterWallet?.ok?'#22c55e':'#f87171', icon:health.minterWallet?.ok?'💰':'⚠'},
                    {label:'CHAIN ID',          value:health.chainId?`#${health.chainId} Sepolia`:'Unknown', color:'#60a5fa', icon:'⛓'},
                    {label:'PENDING MINTS',     value:health.pendingMints??'—',     color:health.pendingMints>0?'#f59e0b':'#22c55e', icon:'⏳'},
                    {label:'FAILED MINTS',      value:health.failedMints??'—',      color:health.failedMints>0?'#f87171':'#22c55e', icon:'❌'},
                    {label:'LAST MINT',         value:health.lastMint?fmt(health.lastMint.tokenised_at):'Never', color:'#f0fdf4', icon:'🕐'},
                  ].map(({label,value,color,icon})=>(
                    <div key={label} style={{...S.statCard,padding:'16px'}}>
                      <div style={{fontSize:22,marginBottom:6}}>{icon}</div>
                      <div style={{fontSize:18,fontWeight:700,color,marginBottom:4}}>{value}</div>
                      <div style={{fontSize:9,color:'#f59e0bcc',letterSpacing:'.1em'}}>{label}</div>
                    </div>
                  ))}
                </div>

                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
                  <div style={S.section}>
                    <div style={S.sectionTitle}>CONTRACT ADDRESSES</div>
                    {[
                      ['Carbon Credit Token', health.contractAddress],
                      ['Marketplace',         health.marketplaceAddress],
                      ['Minter Wallet',       health.minterWallet?.address],
                    ].map(([label,addr])=>(
                      <div key={label} style={{padding:'8px 0',borderBottom:'1px solid #f59e0b08'}}>
                        <div style={{fontSize:9,color:'#f59e0baa',letterSpacing:'.1em',marginBottom:3}}>{label}</div>
                        {addr
                          ? <a href={`https://sepolia.etherscan.io/address/${addr}`} target="_blank" rel="noreferrer" style={{fontSize:10,color:'#60a5fa',fontFamily:'monospace',textDecoration:'none',wordBreak:'break-all'}}>{addr}</a>
                          : <span style={{fontSize:10,color:'#f8717188'}}>Not configured</span>
                        }
                      </div>
                    ))}
                  </div>
                  <div style={S.section}>
                    <div style={S.sectionTitle}>LAST MINTED TOKEN</div>
                    {health.lastMint?(
                      <>
                        <div style={M.row}><span style={M.key}>TOKEN ID</span><span style={{...M.val,color:'#22c55e'}}>#{health.lastMint.token_id}</span></div>
                        <div style={M.row}><span style={M.key}>PROJECT</span><span style={M.val}>{health.lastMint.project_name}</span></div>
                        <div style={M.row}><span style={M.key}>MINTED AT</span><span style={M.val}>{fmtTime(health.lastMint.tokenised_at)}</span></div>
                      </>
                    ):<div style={{fontSize:10,color:'#f59e0b44',padding:'12px 0'}}>No mints recorded yet</div>}
                    <div style={{marginTop:16}}>
                      <div style={S.sectionTitle}>QUICK ACTIONS</div>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                        <a href="https://faucet.sepolia.dev" target="_blank" rel="noreferrer" style={{...S.quickBtn,textDecoration:'none',display:'inline-flex',alignItems:'center',fontSize:10}}>💧 SEPOLIA FAUCET ↗</a>
                        <a href={`https://sepolia.etherscan.io/address/${health.minterWallet?.address}`} target="_blank" rel="noreferrer" style={{...S.quickBtn,textDecoration:'none',display:'inline-flex',alignItems:'center',fontSize:10}}>🔍 MINTER ON ETHERSCAN ↗</a>
                        <button style={{...S.quickBtn,borderColor:'#f87171',color:'#f87171'}} onClick={()=>setTab('credits')}>⚠ VIEW FAILED MINTS</button>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── DISPUTES ── */}
        {tab === 'disputes' && (
          <div>
            <div style={S.pageTitle}>Disputes</div>
            <button style={{...S.quickBtn,marginBottom:20}} onClick={() => setModal({type:'new_dispute'})}>+ OPEN NEW DISPUTE</button>
            {loading?<div style={S.loading}>Loading...</div>:(
              <div style={S.table}>
                <div style={{...S.tableHead,gridTemplateColumns:'repeat(5,1fr)'}}>{['TARGET','REASON','STATUS','OPENED','ACTIONS'].map(h=><div key={h} style={S.th}>{h}</div>)}</div>
                {disputes.length===0&&<div style={S.empty}>No disputes</div>}
                {disputes.map(d=>(
                  <div key={d.id} style={{...S.tableRow,gridTemplateColumns:'repeat(5,1fr)'}}>
                    <div style={S.td}><div style={{color:'#f0fdf4',fontSize:11}}>{d.target_name||'—'}</div><div style={{color:'#f59e0bcc',fontSize:9}}>{d.target_email}</div></div>
                    <div style={{...S.td,fontSize:10,color:'#f59e0bdd'}}>{d.reason?.slice(0,60)}</div>
                    <div style={S.td}><Badge status={d.status}/></div>
                    <div style={{...S.td,fontSize:10,color:'#f59e0bbb'}}>{fmt(d.created_at)}</div>
                    <div style={S.td}>{d.status==='open'&&<button style={S.approveBtn} onClick={() => setModal({type:'resolve_dispute',data:d})}>RESOLVE</button>}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── AUDIT LOG ── */}
        {tab === 'audit' && (
          <div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24}}>
              <div style={S.pageTitle}>Audit Log</div>
              <button style={{...S.quickBtn,borderColor:'#22c55e44',color:'#22c55e'}} onClick={handleExportAudit}>↓ EXPORT CSV</button>
            </div>
            {loading?<div style={S.loading}>Loading...</div>:(
              <div style={S.table}>
                <div style={{...S.tableHead,gridTemplateColumns:'repeat(4,1fr)'}}>{['ACTION','TARGET','DETAILS','TIMESTAMP'].map(h=><div key={h} style={S.th}>{h}</div>)}</div>
                {audit.length===0&&<div style={S.empty}>No audit entries</div>}
                {audit.map(a=>(
                  <div key={a.id} style={{...S.tableRow,gridTemplateColumns:'repeat(4,1fr)'}}>
                    <div style={S.td}><span style={{fontSize:9,padding:'3px 8px',borderRadius:20,background:'#1a0f0066',border:'1px solid #f59e0b66',color:'#f59e0b',letterSpacing:'.06em'}}>{a.action}</span></div>
                    <div style={S.td}><div style={{fontSize:11,color:'#f0fdf4'}}>{a.target_name||'—'}</div><div style={{fontSize:9,color:'#f59e0bcc'}}>{a.target_email}</div></div>
                    <div style={{...S.td,fontSize:10,color:'#f59e0bbb',maxWidth:240}}>{a.details}</div>
                    <div style={{...S.td,fontSize:10,color:'#f59e0baa'}}>{fmtTime(a.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── COMPLIANCE ── */}
        {tab === 'compliance' && (
          <div>
            <div style={S.pageTitle}>🛡 Compliance Dashboard</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:20}}>
              {[{label:'OPEN FLAGS',value:compStats.openFlags,color:'#f59e0b',icon:'🚩'},{label:'CRITICAL',value:compStats.criticalFlags,color:'#f87171',icon:'🚨'},{label:'TOTAL TDS',value:`₹${parseFloat(compStats.totalTds||0).toLocaleString('en-IN',{maximumFractionDigits:0})}`,color:'#60a5fa',icon:'📋'},{label:'FEMA CONV.',value:compStats.totalConversions,color:'#a78bfa',icon:'🔄'}].map(({label,value,color,icon})=>(
                <div key={label} style={S.statCard}><div style={{fontSize:20,marginBottom:6}}>{icon}</div><div style={{fontSize:22,fontWeight:700,color,marginBottom:4}}>{value}</div><div style={{fontSize:9,color:'#f59e0bcc',letterSpacing:'.12em'}}>{label}</div></div>
              ))}
            </div>
            <div style={{display:'flex',gap:6,marginBottom:20,borderBottom:'1px solid #f59e0b11',paddingBottom:0}}>
              {[{id:'flags',label:'🚩 Flags'},{id:'tds',label:'📋 TDS'},{id:'fema',label:'🔄 FEMA'},{id:'config',label:'⚙️ Config'}].map(t=>(
                <button key={t.id} style={{padding:'9px 16px',border:'none',background:'transparent',cursor:'pointer',fontFamily:"'DM Mono',monospace",fontSize:10,letterSpacing:'.08em',borderBottom:`2px solid ${compTab===t.id?'#f59e0b':'transparent'}`,color:compTab===t.id?'#f59e0b':'#f59e0bcc',marginBottom:-1}} onClick={()=>setCompTab(t.id)}>{t.label}</button>
              ))}
            </div>
            {compTab==='flags'&&(
              <div>
                <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
                  {['all','open','reviewed','cleared','escalated'].map(s=><button key={s} style={{...S.filterBtn,...(flagFilter===s?S.filterBtnActive:{})}} onClick={()=>setFlagFilter(s)}>{s.toUpperCase()}</button>)}
                  <span style={{marginLeft:8,fontSize:9,color:'#f59e0baa'}}>SEVERITY:</span>
                  {['','low','medium','high','critical'].map(s=><button key={s} style={{...S.filterBtn,...(flagSeverity===s?S.filterBtnActive:{})}} onClick={()=>setFlagSeverity(s)}>{s||'ALL'}</button>)}
                </div>
                {compLoading?<div style={S.loading}>Loading...</div>:(
                  <div style={S.table}>
                    <div style={{...S.tableHead,gridTemplateColumns:'1.5fr 1fr 1fr 1fr 2fr 1fr 1fr'}}>{['USER','FLAG','AMOUNT','SEVERITY','DESC','STATUS','ACTIONS'].map(h=><div key={h} style={S.th}>{h}</div>)}</div>
                    {compFlags.length===0&&<div style={S.empty}>No flags</div>}
                    {compFlags.map(f=>(
                      <div key={f.id} style={{...S.tableRow,gridTemplateColumns:'1.5fr 1fr 1fr 1fr 2fr 1fr 1fr',...(f.severity==='critical'&&f.status==='open'?{borderLeft:'2px solid #f8717133'}:{})}}>
                        <div style={S.td}><div style={{color:'#f0fdf4',fontSize:11}}>{f.full_name||'—'}</div><div style={{color:'#f59e0bcc',fontSize:9}}>{f.email}</div></div>
                        <div style={S.td}><span style={{fontSize:9,padding:'2px 6px',borderRadius:4,background:'#1a0f0066',border:'1px solid #f59e0b33',color:'#f59e0b'}}>{flagTypeLabel[f.flag_type]||f.flag_type}</span></div>
                        <div style={{...S.td,fontSize:11}}>{f.amount?`₹${parseFloat(f.amount).toLocaleString('en-IN')}`:'—'}</div>
                        <div style={S.td}><span style={{fontSize:9,padding:'2px 6px',borderRadius:4,border:`1px solid ${sevColor[f.severity]||'#f59e0b'}33`,color:sevColor[f.severity]||'#f59e0b'}}>{f.severity?.toUpperCase()}</span></div>
                        <div style={{...S.td,fontSize:9,color:'#f59e0bbb'}}>{f.description?.slice(0,70)}</div>
                        <div style={S.td}><Badge status={f.status}/></div>
                        <div style={{...S.td,display:'flex',gap:4}}>
                          {f.status==='open'&&<><button style={S.approveBtn} onClick={()=>setModal({type:'flag_review',data:f,action:'cleared'})}>CLEAR</button><button style={{...S.rejectBtn,fontSize:8,padding:'3px 6px'}} onClick={()=>setModal({type:'flag_review',data:f,action:'escalated'})}>ESC</button></>}
                          {f.status!=='open'&&<button style={S.viewBtn} onClick={()=>setModal({type:'flag_detail',data:f})}>VIEW</button>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {compTab==='tds'&&(
              <div>
                <div style={{display:'flex',gap:8,marginBottom:14,alignItems:'center'}}>
                  {['','2024-25','2025-26','2026-27'].map(fy=><button key={fy} style={{...S.filterBtn,...(fyFilter===fy?S.filterBtnActive:{})}} onClick={()=>setFyFilter(fy)}>{fy||'ALL'}</button>)}
                </div>
                {compLoading?<div style={S.loading}>Loading...</div>:(
                  <div style={S.table}>
                    <div style={{...S.tableHead,gridTemplateColumns:'1.5fr 1fr 1fr 1fr 1fr 1fr 1fr'}}>{['USER','FY/QTR','GROSS','TDS 1%','NET','PAN','STATUS'].map(h=><div key={h} style={S.th}>{h}</div>)}</div>
                    {compTDS.length===0&&<div style={S.empty}>No TDS records</div>}
                    {compTDS.map(t=>(
                      <div key={t.id} style={{...S.tableRow,gridTemplateColumns:'1.5fr 1fr 1fr 1fr 1fr 1fr 1fr'}}>
                        <div style={S.td}><div style={{fontSize:11,color:'#f0fdf4'}}>{t.full_name||'—'}</div><div style={{fontSize:9,color:'#f59e0bcc'}}>{t.email}</div></div>
                        <div style={S.td}><div style={{fontSize:10}}>{t.financial_year}</div><div style={{fontSize:9,color:'#f59e0bcc'}}>{t.quarter}</div></div>
                        <div style={{...S.td,fontSize:11}}>{fmtINR(t.transaction_amount)}</div>
                        <div style={{...S.td,fontSize:11,color:'#f87171',fontWeight:600}}>{fmtINR(t.tds_amount)}</div>
                        <div style={{...S.td,fontSize:11,color:'#22c55e'}}>{fmtINR(t.net_amount)}</div>
                        <div style={{...S.td,fontSize:10,color:'#60a5facc',fontFamily:'monospace'}}>{t.pan||'—'}</div>
                        <div style={S.td}><Badge status={t.status}/></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {compTab==='fema'&&(
              <div>
                {compLoading?<div style={S.loading}>Loading...</div>:(
                  <div style={S.table}>
                    <div style={{...S.tableHead,gridTemplateColumns:'1.5fr 1fr 1fr 1fr 1fr 1.5fr 1fr'}}>{['USER','INR','ETH','RATE','PURPOSE','TX','DATE'].map(h=><div key={h} style={S.th}>{h}</div>)}</div>
                    {compFEMA.length===0&&<div style={S.empty}>No FEMA records</div>}
                    {compFEMA.map(c=>(
                      <div key={c.id} style={{...S.tableRow,gridTemplateColumns:'1.5fr 1fr 1fr 1fr 1fr 1.5fr 1fr'}}>
                        <div style={S.td}><div style={{fontSize:11,color:'#f0fdf4'}}>{c.full_name||'—'}</div><div style={{fontSize:9,color:'#f59e0bcc'}}>{c.email}</div></div>
                        <div style={{...S.td,fontSize:11,color:'#22c55e',fontWeight:600}}>{fmtINR(c.inr_amount)}</div>
                        <div style={{...S.td,fontSize:11,color:'#60a5fa'}}>{parseFloat(c.crypto_amount).toFixed(6)}</div>
                        <div style={{...S.td,fontSize:10,color:'#f59e0bbb'}}>₹{parseFloat(c.eth_inr_rate).toLocaleString('en-IN')}</div>
                        <div style={{...S.td,fontSize:9,color:'#a78bfacc'}}>{c.purpose?.replace(/_/g,' ').toUpperCase()}</div>
                        <div style={{...S.td,fontSize:9,color:'#60a5fa88',fontFamily:'monospace'}}>{c.tx_hash?`${c.tx_hash.slice(0,8)}...`:'—'}</div>
                        <div style={{...S.td,fontSize:10,color:'#f59e0baa'}}>{fmt(c.created_at)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {compTab==='config'&&(
              <div>
                {compLoading?<div style={S.loading}>Loading...</div>:(
                  <div style={S.table}>
                    <div style={{...S.tableHead,gridTemplateColumns:'2fr 1fr 3fr 1.5fr'}}>{['KEY','VALUE','DESCRIPTION','ACTION'].map(h=><div key={h} style={S.th}>{h}</div>)}</div>
                    {compConfig.length===0&&<div style={S.empty}>No config — run compliance_migration.sql</div>}
                    {compConfig.map(c=>(
                      <div key={c.key} style={{...S.tableRow,gridTemplateColumns:'2fr 1fr 3fr 1.5fr',alignItems:'center'}}>
                        <div style={{...S.td,fontSize:10,color:'#60a5fa',fontFamily:'monospace'}}>{c.key}</div>
                        <div style={S.td}>{editingConfig[c.key]!==undefined?<input style={{...S.searchInput,width:100,padding:'4px 8px',fontSize:11}} value={editingConfig[c.key]} onChange={e=>setEditingConfig(p=>({...p,[c.key]:e.target.value}))} onKeyDown={e=>e.key==='Enter'&&saveConfig(c.key,editingConfig[c.key])} autoFocus/>:<span style={{fontSize:13,color:'#22c55e',fontWeight:700}}>{c.value}</span>}</div>
                        <div style={{...S.td,fontSize:10,color:'#f59e0baa',lineHeight:1.5}}>{c.description}</div>
                        <div style={{...S.td,display:'flex',gap:6}}>{editingConfig[c.key]!==undefined?<><button style={S.approveBtn} onClick={()=>saveConfig(c.key,editingConfig[c.key])}>SAVE</button><button style={S.viewBtn} onClick={()=>setEditingConfig(p=>{const n={...p};delete n[c.key];return n;})}>CANCEL</button></>:<button style={S.viewBtn} onClick={()=>setEditingConfig(p=>({...p,[c.key]:c.value}))}>EDIT</button>}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ════════════════ MODALS ════════════════ */}

      {modal?.type==='kyc_detail'&&<Modal title="KYC Details" onClose={()=>setModal(null)}>{[['Name',modal.data.full_name],['Email',modal.data.email],['ID Type',modal.data.id_type],['Submitted',fmt(modal.data.submitted_at)],['Status',modal.data.status],['Wallet',modal.data.wallet_address||'Not connected']].map(([k,v])=><div key={k} style={M.row}><span style={M.key}>{k}</span><span style={M.val}>{v}</span></div>)}{modal.data.doc_ipfs_hash&&<div style={{marginTop:12}}><a href={`${PINATA_GW}/${modal.data.doc_ipfs_hash}`} target="_blank" rel="noreferrer" style={{fontSize:11,color:'#60a5fa',textDecoration:'none'}}>📄 VIEW IPFS DOC ↗</a></div>}{modal.data.status==='pending'&&<div style={{display:'flex',gap:8,marginTop:16}}><button style={M.approveBtn} onClick={()=>setModal({type:'kyc_approve',data:modal.data})}>APPROVE</button><button style={M.rejectBtn} onClick={()=>setModal({type:'kyc_reject',data:modal.data})}>REJECT</button></div>}</Modal>}
      {modal?.type==='kyc_approve'&&<Modal title="Approve KYC" onClose={()=>{setModal(null);setReason('');}}><div style={M.confirmText}>Approve KYC for <strong style={{color:'#f0fdf4'}}>{modal.data.full_name}</strong>?</div><button style={M.approveBtn} onClick={()=>kycAction(modal.data.id,'approve')}>CONFIRM APPROVE</button></Modal>}
      {modal?.type==='kyc_reject'&&<Modal title="Reject KYC" onClose={()=>{setModal(null);setReason('');}}><textarea style={M.textarea} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Rejection reason..."/><button style={M.rejectBtn} onClick={()=>kycAction(modal.data.id,'reject')} disabled={!reason.trim()}>CONFIRM REJECT</button></Modal>}

      {modal?.type==='credit_detail'&&<Modal title="Credit Details" onClose={()=>setModal(null)}>{[['User',modal.data.full_name],['Email',modal.data.email],['Serial',modal.data.registry_serial],['Project',modal.data.project_name],['Quantity',modal.data.quantity],['Vintage',modal.data.vintage_year],['Standard',modal.data.standard],['Status',modal.data.admin_status],['Token ID',modal.data.token_id!=null?`#${modal.data.token_id}`:'Not minted'],['Wallet',modal.data.user_wallet||'NONE — wallet required']].map(([k,v])=><div key={k} style={M.row}><span style={M.key}>{k}</span><span style={{...M.val,color:k==='Token ID'&&!modal.data.token_id?'#f87171':k==='Wallet'&&!modal.data.user_wallet?'#f87171':undefined}}>{v}</span></div>)}{modal.data.doc_ipfs_hash&&<div style={{marginTop:10}}><a href={`${PINATA_GW}/${modal.data.doc_ipfs_hash}`} target="_blank" rel="noreferrer" style={{fontSize:11,color:'#60a5fa',textDecoration:'none'}}>📄 VIEW PROOF ↗</a></div>}<div style={{display:'flex',gap:8,marginTop:16,flexWrap:'wrap'}}>{modal.data.admin_status==='pending'&&<><button style={M.approveBtn} onClick={()=>setModal({type:'credit_approve',data:modal.data})}>APPROVE</button><button style={M.rejectBtn} onClick={()=>setModal({type:'credit_reject',data:modal.data})}>REJECT</button></>}{modal.data.admin_status==='approved'&&!modal.data.token_id&&<><button style={{...M.approveBtn,background:'linear-gradient(135deg,#dc2626,#b91c1c)'}} onClick={()=>{setModal(null);retryMint(modal.data.id);}}>⟳ RETRY MINT</button><button style={{...M.approveBtn,background:'linear-gradient(135deg,#1d4ed8,#1e40af)'}} onClick={()=>{setManualTokenId('');setModal({type:'manual_token_sync',data:modal.data});}}>✎ SET ID</button>{!modal.data.user_wallet&&<button style={{...M.approveBtn,background:'linear-gradient(135deg,#7c3aed,#6d28d9)'}} onClick={()=>{setAssignWallet('');setModal({type:'assign_wallet_mint',data:modal.data});}}>🔑 ASSIGN WALLET + MINT</button>}</>}</div></Modal>}
      {modal?.type==='credit_approve'&&<Modal title="Approve Credit" onClose={()=>{setModal(null);setReason('');}}><div style={M.confirmText}>Approve <strong style={{color:'#f0fdf4'}}>{modal.data.project_name}</strong> for <strong style={{color:'#22c55e'}}>{modal.data.full_name}</strong>?</div><textarea style={M.textarea} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Optional admin notes..."/><button style={M.approveBtn} onClick={()=>creditAction(modal.data.id,'approve')}>CONFIRM APPROVE</button></Modal>}
      {modal?.type==='credit_reject'&&<Modal title="Reject Credit" onClose={()=>{setModal(null);setReason('');}}><textarea style={M.textarea} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Rejection reason..."/><button style={M.rejectBtn} onClick={()=>creditAction(modal.data.id,'reject')} disabled={!reason.trim()}>CONFIRM REJECT</button></Modal>}

      {modal?.type==='assign_wallet_mint'&&<Modal title="🔑 Assign Wallet + Mint" onClose={()=>{setModal(null);setAssignWallet('');}}><div style={M.confirmText}>User <strong style={{color:'#f0fdf4'}}>{modal.data.full_name}</strong> has no wallet. Provide their wallet address to assign it and mint Token in one step.</div><div style={{fontSize:9,color:'#f59e0baa',letterSpacing:'.12em',marginBottom:6,marginTop:12}}>WALLET ADDRESS (0x...)</div><input style={M.input} placeholder="0x1234...abcd" value={assignWallet} onChange={e=>setAssignWallet(e.target.value)}/><div style={{padding:'10px 12px',background:'#110a00',border:'1px solid #f59e0b22',borderRadius:6,marginBottom:12,fontSize:9,color:'#f59e0baa',lineHeight:1.6}}>This will bind the wallet to the user's account AND mint the credit token to it in a single operation.</div><button style={{...M.approveBtn,opacity:syncingId===modal.data.id?.5:1}} onClick={()=>handleAssignWalletAndMint(modal.data.id)} disabled={!assignWallet||syncingId===modal.data.id}>{syncingId===modal.data.id?'MINTING...':'ASSIGN + MINT →'}</button></Modal>}

      {modal?.type==='manual_token_sync'&&<Modal title="✎ Set Token ID Manually" onClose={()=>{setModal(null);setManualTokenId('');}}><div style={M.confirmText}>Use only if mint succeeded on-chain but DB wasn't updated. Check Etherscan for the correct Token ID first.<br/><span style={{color:'#f87171aa',fontSize:10}}>Project: {modal.data.project_name}</span></div><div style={{fontSize:9,color:'#f59e0baa',letterSpacing:'.12em',marginBottom:6,marginTop:12}}>TOKEN ID (from CreditMinted event)</div><input style={M.input} type="number" min="0" placeholder="e.g. 4" value={manualTokenId} onChange={e=>setManualTokenId(e.target.value)}/><a href="https://sepolia.etherscan.io" target="_blank" rel="noreferrer" style={{fontSize:10,color:'#60a5fa88',textDecoration:'none',display:'block',marginBottom:16}}>🔗 Open Etherscan ↗</a><button style={{...M.approveBtn,background:'linear-gradient(135deg,#1d4ed8,#1e40af)',opacity:syncingId===modal.data.id?.5:1}} onClick={()=>handleManualTokenSync(modal.data.id)} disabled={!manualTokenId||syncingId===modal.data.id}>{syncingId===modal.data.id?'SYNCING...':'CONFIRM SET TOKEN ID'}</button></Modal>}

      {modal?.type==='qty_correction'&&<Modal title="✎ Correct Quantity" onClose={()=>{setModal(null);setNewQty('');setReason('');}}><div style={M.confirmText}>Correct quantity for <strong style={{color:'#f0fdf4'}}>{modal.data.project_name}</strong>. Only available before minting.</div><div style={M.row}><span style={M.key}>Current</span><span style={M.val}>{modal.data.quantity} tCO₂</span></div><div style={{fontSize:9,color:'#f59e0baa',letterSpacing:'.12em',marginBottom:6,marginTop:14}}>NEW QUANTITY (tCO₂)</div><input style={M.input} type="number" min="1" value={newQty} onChange={e=>setNewQty(e.target.value)}/><div style={{fontSize:9,color:'#f59e0baa',letterSpacing:'.12em',marginBottom:6}}>REASON</div><textarea style={M.textarea} value={reason} onChange={e=>setReason(e.target.value)} placeholder="e.g. User submitted 400 instead of 4000"/><button style={M.approveBtn} onClick={()=>handleQtyCorrection(modal.data.id)} disabled={!newQty||!reason.trim()}>CONFIRM CORRECTION</button></Modal>}

      {modal?.type==='flag_retirement'&&<Modal title="⚠ Flag Retirement as Disputed" onClose={()=>{setModal(null);setReason('');}}><div style={M.confirmText}>Flag retirement <strong style={{color:'#f0fdf4'}}>{modal.data.certificate_id}</strong> ({modal.data.amount} tCO₂) as disputed.<br/><span style={{color:'#f87171aa',fontSize:10}}>The certificate will show a dispute warning. The on-chain burn cannot be reversed.</span></div><textarea style={M.textarea} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Reason for dispute e.g. Wrong quantity, wrong scope..."/><button style={M.rejectBtn} onClick={()=>handleFlagRetirement(modal.data.id)} disabled={!reason.trim()}>CONFIRM FLAG</button></Modal>}

      {modal?.type==='user_detail'&&<Modal title="User Details" onClose={()=>setModal(null)}>{[['Name',modal.data.full_name||'—'],['Email',modal.data.email],['Wallet',modal.data.wallet_address||'Not connected'],['KYC',modal.data.kyc_status||'pending'],['Frozen',modal.data.frozen?`Yes — ${modal.data.freeze_reason}`:'No'],['Joined',fmt(modal.data.created_at)]].map(([k,v])=><div key={k} style={M.row}><span style={M.key}>{k}</span><span style={M.val}>{v}</span></div>)}<div style={{display:'flex',gap:8,marginTop:16,flexWrap:'wrap'}}>{!modal.data.frozen?<button style={M.rejectBtn} onClick={()=>setModal({type:'freeze',data:modal.data})}>FREEZE</button>:<button style={M.approveBtn} onClick={()=>setModal({type:'unfreeze',data:modal.data})}>UNFREEZE</button>}<button style={{...M.approveBtn,background:'linear-gradient(135deg,#1d4ed8,#1e40af)'}} onClick={()=>{setNewWallet('');setReason('');setModal({type:'reassign_wallet',data:modal.data});}}>🔑 REASSIGN WALLET</button><button style={{...M.rejectBtn,background:'linear-gradient(135deg,#7c2d12,#991b1b)'}} onClick={()=>{setReason('');setModal({type:'delete_user',data:modal.data});}}>DELETE USER</button></div></Modal>}

      {modal?.type==='user_history'&&(
        <Modal title={`History — ${modal.data.full_name}`} onClose={()=>setModal(null)} wide>
          {userDataLoading?<div style={{padding:24,textAlign:'center',color:'#f59e0baa'}}>Loading...</div>:(
            <>
              <div style={{fontSize:9,color:'#22c55e88',letterSpacing:'.14em',marginBottom:8}}>CREDITS ({userCredits.length})</div>
              {userCredits.length===0?<div style={{fontSize:10,color:'#f59e0b44',marginBottom:16}}>No credits</div>:userCredits.map(c=>(
                <div key={c.id} style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr',gap:8,padding:'8px 0',borderBottom:'1px solid #f59e0b08',alignItems:'center'}}>
                  <div style={{fontSize:11,color:'#f0fdf4'}}>{c.project_name}<div style={{fontSize:9,color:'#f59e0bcc'}}>{c.registry_serial}</div></div>
                  <div style={{fontSize:11,color:'#22c55e'}}>{c.quantity} t</div>
                  <div style={{fontSize:10,color:'#f59e0bbb'}}>{c.vintage_year}</div>
                  <div>{c.token_id!=null?<span style={{fontSize:9,color:'#22c55e'}}>⛓ #{c.token_id}</span>:<span style={{fontSize:9,color:'#f8717188'}}>⏳</span>}</div>
                  <div><Badge status={c.admin_status}/></div>
                </div>
              ))}
              <div style={{fontSize:9,color:'#60a5fa88',letterSpacing:'.14em',margin:'16px 0 8px'}}>TRADES ({userTrades.length})</div>
              {userTrades.length===0?<div style={{fontSize:10,color:'#f59e0b44'}}>No trades</div>:userTrades.slice(0,20).map(t=>(
                <div key={t.id} style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr',gap:8,padding:'8px 0',borderBottom:'1px solid #f59e0b08',alignItems:'center'}}>
                  <div style={{fontSize:10,color:'#f0fdf4'}}>{t.project_name||'—'}</div>
                  <div style={{fontSize:10,color:t.buyer_id===modal.data.id?'#22c55e':'#f87171'}}>{t.buyer_id===modal.data.id?'BOUGHT':'SOLD'}</div>
                  <div style={{fontSize:11,color:'#f0fdf4'}}>{t.quantity} t</div>
                  <div style={{fontSize:10,color:'#22c55e'}}>₹{parseFloat(t.subtotal_inr||0).toLocaleString('en-IN')}</div>
                  <div style={{fontSize:9,color:'#f59e0baa'}}>{fmt(t.created_at)}</div>
                </div>
              ))}
            </>
          )}
        </Modal>
      )}

      {modal?.type==='send_message'&&<Modal title={`📧 Message — ${modal.data.full_name}`} onClose={()=>{setModal(null);setMsgSubject('');setMsgBody('');}}><div style={M.confirmText}>Send email + in-app notification to <strong style={{color:'#f0fdf4'}}>{modal.data.email}</strong></div><div style={{fontSize:9,color:'#f59e0baa',letterSpacing:'.12em',marginBottom:6}}>SUBJECT</div><input style={M.input} placeholder="e.g. Action required on your account" value={msgSubject} onChange={e=>setMsgSubject(e.target.value)}/><div style={{fontSize:9,color:'#f59e0baa',letterSpacing:'.12em',marginBottom:6}}>MESSAGE</div><textarea style={{...M.textarea,minHeight:120}} value={msgBody} onChange={e=>setMsgBody(e.target.value)} placeholder="Write your message here..."/><button style={M.approveBtn} onClick={()=>handleSendMessage(modal.data.id)} disabled={!msgSubject.trim()||!msgBody.trim()}>SEND MESSAGE →</button></Modal>}

      {modal?.type==='reassign_wallet'&&<Modal title="🔑 Reassign Wallet" onClose={()=>{setModal(null);setNewWallet('');setReason('');}}><div style={M.confirmText}>Reassign wallet for <strong style={{color:'#f0fdf4'}}>{modal.data.full_name}</strong>.<br/><span style={{color:'#f87171aa',fontSize:10}}>Current: {modal.data.wallet_address||'None'}</span></div><div style={{fontSize:9,color:'#f59e0baa',letterSpacing:'.12em',marginBottom:6,marginTop:12}}>NEW WALLET (0x...)</div><input style={M.input} placeholder="0x1234...abcd" value={newWallet} onChange={e=>setNewWallet(e.target.value)}/><div style={{fontSize:9,color:'#f59e0baa',letterSpacing:'.12em',marginBottom:6}}>REASON</div><textarea style={M.textarea} value={reason} onChange={e=>setReason(e.target.value)} placeholder="e.g. User lost access to original wallet"/><button style={{...M.approveBtn,background:'linear-gradient(135deg,#1d4ed8,#1e40af)'}} onClick={()=>handleWalletReassign(modal.data.id)} disabled={!newWallet||!reason.trim()}>CONFIRM REASSIGN</button></Modal>}

      {modal?.type==='price_override'&&<Modal title="📝 Override Listing Price" onClose={()=>{setModal(null);setPriceOverride('');setReason('');}}><div style={M.confirmText}>Override price for listing <strong style={{color:'#60a5fa'}}>#{modal.data.listingId}</strong>.</div><div style={{fontSize:9,color:'#f59e0baa',letterSpacing:'.12em',marginBottom:6,marginTop:12}}>NEW PRICE (₹ per credit)</div><input style={M.input} type="number" min="1" placeholder="e.g. 850" value={priceOverride} onChange={e=>setPriceOverride(e.target.value)}/><div style={{fontSize:9,color:'#f59e0baa',letterSpacing:'.12em',marginBottom:6}}>REASON</div><textarea style={M.textarea} value={reason} onChange={e=>setReason(e.target.value)} placeholder="e.g. User listed at ₹8500 instead of ₹850 — typo"/><button style={M.approveBtn} onClick={()=>handlePriceOverride(modal.data.listingId)} disabled={!priceOverride||!reason.trim()}>CONFIRM PRICE OVERRIDE</button></Modal>}

      {modal?.type==='delete_user'&&<Modal title="🗑 Delete User Account" onClose={()=>{setModal(null);setReason('');}}><div style={{padding:'12px 14px',background:'#1a0707',border:'1px solid #f8717133',borderRadius:8,marginBottom:16,fontSize:11,color:'#f87171',lineHeight:1.7}}>⛔ <strong>Irreversible.</strong> Personal data anonymised (GDPR). On-chain tokens remain on the blockchain permanently.</div>{[['Name',modal.data.full_name],['Email',modal.data.email],['Wallet',modal.data.wallet_address||'None']].map(([k,v])=><div key={k} style={M.row}><span style={M.key}>{k}</span><span style={M.val}>{v}</span></div>)}<div style={{fontSize:9,color:'#f59e0baa',letterSpacing:'.12em',marginBottom:6,marginTop:14}}>DELETION REASON (required)</div><textarea style={M.textarea} value={reason} onChange={e=>setReason(e.target.value)} placeholder="e.g. GDPR Art.17 request, fraudulent account..."/><button style={{...M.rejectBtn,background:'linear-gradient(135deg,#7c2d12,#991b1b)',opacity:deletingUserId===modal.data.id?.5:1}} onClick={()=>handleDeleteUser(modal.data.id)} disabled={!reason.trim()||deletingUserId===modal.data.id}>{deletingUserId===modal.data.id?'DELETING...':'CONFIRM DELETE'}</button></Modal>}

      {modal?.type==='freeze'&&<Modal title="Freeze Account" onClose={()=>{setModal(null);setReason('');}}><div style={M.confirmText}>Freeze <strong style={{color:'#f87171'}}>{modal.data.email}</strong>?</div><textarea style={M.textarea} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Reason for freezing..."/><button style={M.rejectBtn} onClick={()=>freezeAction(modal.data.id,'freeze')} disabled={!reason.trim()}>CONFIRM FREEZE</button></Modal>}
      {modal?.type==='unfreeze'&&<Modal title="Unfreeze Account" onClose={()=>{setModal(null);setReason('');}}><div style={M.confirmText}>Unfreeze <strong style={{color:'#22c55e'}}>{modal.data.email}</strong>?</div><button style={M.approveBtn} onClick={()=>freezeAction(modal.data.id,'unfreeze')}>CONFIRM UNFREEZE</button></Modal>}
      {modal?.type==='new_dispute'&&<Modal title="Open Dispute" onClose={()=>{setModal(null);setReason('');}}><input style={M.input} placeholder="Target user ID..." onChange={e=>setModal(m=>({...m,targetId:e.target.value}))}/><textarea style={M.textarea} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Dispute reason..."/><button style={M.approveBtn} onClick={async()=>{try{await apiFetch('/api/admin/disputes',{method:'POST',body:JSON.stringify({targetUserId:modal.targetId,reason,notes:''})});showToast('Dispute opened');setModal(null);setReason('');loadDisputes();}catch(e){showToast(`❌ ${e.message}`);}}} disabled={!reason.trim()}>OPEN DISPUTE</button></Modal>}
      {modal?.type==='resolve_dispute'&&<Modal title="Resolve Dispute" onClose={()=>{setModal(null);setReason('');}}><div style={M.confirmText}>{modal.data.reason}</div><textarea style={M.textarea} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Resolution notes..."/><button style={M.approveBtn} onClick={()=>resolveDispute(modal.data.id)} disabled={!reason.trim()}>MARK RESOLVED</button></Modal>}
      {modal?.type==='flag_review'&&<Modal title={modal.action==='cleared'?'✅ Clear Flag':'🚨 Escalate Flag'} onClose={()=>{setModal(null);setReason('');}}><div style={M.confirmText}>{modal.action==='cleared'?'Clear':'Escalate'} flag for <strong style={{color:'#f0fdf4'}}>{modal.data.email}</strong>?</div><textarea style={M.textarea} value={reason} onChange={e=>setReason(e.target.value)} placeholder={modal.action==='cleared'?'Why is this cleared?':'Escalation reason...'}/><button style={modal.action==='cleared'?M.approveBtn:M.rejectBtn} onClick={()=>reviewFlag(modal.data.id,modal.action,reason)} disabled={!reason.trim()}>CONFIRM {modal.action.toUpperCase()}</button></Modal>}
      {modal?.type==='flag_detail'&&<Modal title="Flag Details" onClose={()=>setModal(null)}>{[['User',modal.data.email],['Type',modal.data.flag_type],['Amount',modal.data.amount?`₹${parseFloat(modal.data.amount).toLocaleString('en-IN')}`:'—'],['Severity',modal.data.severity],['Status',modal.data.status],['Description',modal.data.description],['Review Notes',modal.data.review_notes||'—'],['Created',fmtTime(modal.data.created_at)]].map(([k,v])=><div key={k} style={M.row}><span style={M.key}>{k}</span><span style={{...M.val,maxWidth:300}}>{v||'—'}</span></div>)}</Modal>}

      {modal?.type==='force_delist'&&<Modal title="Force Delist Listing" onClose={()=>{setModal(null);setReason('');}}><div style={M.confirmText}>Force-delist listing from <strong style={{color:'#f0fdf4'}}>{modal.data.seller_name||modal.data.seller_email}</strong>?</div><textarea style={M.textarea} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Reason for delisting..."/><button style={M.rejectBtn} onClick={()=>handleForceDelist(modal.data.id)} disabled={!reason.trim()}>CONFIRM DELIST</button></Modal>}

      {modal?.type==='require_rekyc'&&<Modal title="↻ Require Re-KYC" onClose={()=>{setModal(null);setReason('');}}><div style={M.confirmText}>Require <strong style={{color:'#f0fdf4'}}>{modal.data.full_name}</strong> to re-submit KYC?</div><textarea style={M.textarea} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Reason e.g. KYC document expired, suspicious activity..."/><button style={M.rejectBtn} onClick={()=>handleRequireRekyc(modal.data.id)} disabled={!reason.trim()}>CONFIRM RE-KYC</button></Modal>}
    </div>
  );
}

const S = {
  page:           { display:'flex', minHeight:'100vh', background:'#0a0800', fontFamily:"'DM Mono',monospace", color:'#f0fdf4' },
  sidebar:        { width:200, background:'#0d0a00', borderRight:'1px solid #f59e0b11', display:'flex', flexDirection:'column', flexShrink:0, position:'sticky', top:0, height:'100vh', overflowY:'auto' },
  sideTop:        { padding:'20px 16px 14px', borderBottom:'1px solid #f59e0b11', marginBottom:6 },
  logo:           { fontSize:12, fontWeight:700, color:'#f59e0b', letterSpacing:'.12em' },
  logoSub:        { fontSize:8, color:'#f59e0baa', letterSpacing:'.2em', marginTop:3 },
  navBtn:         { width:'100%', padding:'10px 14px', background:'transparent', border:'none', borderLeft:'2px solid transparent', color:'#f59e0bcc', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:10, textAlign:'left', letterSpacing:'.06em', display:'flex', alignItems:'center', justifyContent:'space-between', gap:4 },
  navBtnActive:   { borderLeft:'2px solid #f59e0b', color:'#f59e0b', background:'#f59e0b18' },
  badge:          { background:'#f59e0b', color:'#0a0800', fontSize:8, fontWeight:700, padding:'2px 5px', borderRadius:10, minWidth:14, textAlign:'center', flexShrink:0 },
  logoutBtn:      { width:'100%', padding:'10px', borderRadius:6, border:'1px solid #f59e0b22', background:'transparent', color:'#f87171ee', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:10, letterSpacing:'.08em' },
  main:           { flex:1, padding:'28px 36px', overflowY:'auto', minWidth:0 },
  pageTitle:      { fontSize:18, fontWeight:500, color:'#f0fdf4', marginBottom:20, letterSpacing:'.04em' },
  statsGrid:      { display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))', gap:12, marginBottom:20 },
  statCard:       { background:'#0d0a00', border:'1px solid #f59e0b33', borderRadius:10, padding:'18px 14px', textAlign:'center' },
  section:        { background:'#0d0a00', border:'1px solid #f59e0b33', borderRadius:10, padding:'18px' },
  sectionTitle:   { fontSize:9, color:'#f59e0bcc', letterSpacing:'.16em', marginBottom:12 },
  quickBtn:       { padding:'9px 16px', borderRadius:6, border:'1px solid #f59e0b66', background:'transparent', color:'#f59e0bdd', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:10, letterSpacing:'.06em' },
  filterBtn:      { padding:'7px 12px', borderRadius:6, border:'1px solid #f59e0b22', background:'transparent', color:'#f59e0bcc', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:10, letterSpacing:'.06em' },
  filterBtnActive:{ borderColor:'#f59e0b', color:'#f59e0b', background:'#f59e0b11' },
  searchInput:    { padding:'8px 12px', borderRadius:6, border:'1px solid #f59e0b22', background:'#0a0800', color:'#f0fdf4', fontFamily:"'DM Mono',monospace", fontSize:11, outline:'none', minWidth:200 },
  table:          { background:'#0d0a00', border:'1px solid #f59e0b33', borderRadius:10, overflow:'hidden' },
  tableHead:      { display:'grid', gridTemplateColumns:'repeat(6,1fr)', background:'#0a0800', padding:'10px 14px', borderBottom:'1px solid #f59e0b11' },
  tableRow:       { display:'grid', gridTemplateColumns:'repeat(6,1fr)', padding:'11px 14px', borderBottom:'1px solid #f59e0b08', alignItems:'center' },
  th:             { fontSize:9, color:'#f59e0baa', letterSpacing:'.1em' },
  td:             { fontSize:11 },
  loading:        { padding:40, textAlign:'center', color:'#f59e0baa', fontSize:12 },
  empty:          { padding:40, textAlign:'center', color:'#f59e0bbb', fontSize:11 },
  viewBtn:        { padding:'4px 9px', borderRadius:4, border:'1px solid #f59e0b22', background:'transparent', color:'#f59e0bdd', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:9 },
  approveBtn:     { padding:'4px 9px', borderRadius:4, border:'1px solid #22c55e44', background:'#22c55e11', color:'#22c55e', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:9 },
  rejectBtn:      { padding:'4px 9px', borderRadius:4, border:'1px solid #f8717144', background:'#f8717111', color:'#f87171', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:9 },
  toast:          { position:'fixed', bottom:24, right:24, background:'#1a1200', border:'1px solid #f59e0b44', color:'#f59e0b', padding:'12px 20px', borderRadius:8, fontSize:12, zIndex:9999, fontFamily:"'DM Mono',monospace" },
  spinner:        { width:12, height:12, border:'2px solid #f8717122', borderTopColor:'#f87171', borderRadius:'50%', animation:'spin 1s linear infinite', display:'inline-block' },
};

const M = {
  overlay:    { position:'fixed', inset:0, background:'rgba(0,0,0,.8)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:20 },
  box:        { background:'#0d0a00', border:'1px solid #f59e0b22', borderRadius:12, padding:'24px 28px', maxWidth:520, width:'100%', maxHeight:'85vh', overflowY:'auto', fontFamily:"'DM Mono',monospace" },
  mTitle:     { fontSize:13, fontWeight:700, color:'#f59e0b', marginBottom:16, letterSpacing:'.08em' },
  row:        { display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid #f59e0b08' },
  key:        { fontSize:10, color:'#f59e0bcc', letterSpacing:'.1em' },
  val:        { fontSize:11, color:'#f0fdf4', maxWidth:280, textAlign:'right', wordBreak:'break-all' },
  confirmText:{ fontSize:11, color:'#f59e0bdd', lineHeight:1.7, marginBottom:12 },
  textarea:   { width:'100%', minHeight:80, padding:'10px 12px', borderRadius:6, border:'1px solid #f59e0b22', background:'#0a0800', color:'#f0fdf4', fontFamily:"'DM Mono',monospace", fontSize:11, outline:'none', resize:'vertical', boxSizing:'border-box', marginBottom:12 },
  input:      { width:'100%', padding:'10px 12px', borderRadius:6, border:'1px solid #f59e0b22', background:'#0a0800', color:'#f0fdf4', fontFamily:"'DM Mono',monospace", fontSize:11, outline:'none', boxSizing:'border-box', marginBottom:12 },
  approveBtn: { padding:'10px 20px', borderRadius:6, border:'none', background:'linear-gradient(135deg,#16a34a,#15803d)', color:'#fff', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:700, letterSpacing:'.08em' },
  rejectBtn:  { padding:'10px 20px', borderRadius:6, border:'none', background:'linear-gradient(135deg,#dc2626,#b91c1c)', color:'#fff', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:700, letterSpacing:'.08em' },
  closeBtn:   { marginTop:14, padding:'7px 14px', borderRadius:6, border:'1px solid #f59e0b22', background:'transparent', color:'#f59e0bcc', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:10 },
};