// src/components/AuditTrail.jsx — Blockchain-anchored GHG Audit Trail v2
// ── Production fixes:
//    [FIX-API-WIRE]     All apiFetch calls replaced with auditAPI methods
//    [FIX-ABORT]        Abort controller on load — no state updates after unmount
//    [FIX-LOAD-ERROR]   Load failure shows retry prompt
//    [FIX-BLOB-REVOKE]  Blob URL properly revoked after CSV export
//    [FIX-YEAR-DYNAMIC] Year dropdown dynamic (current year ±2)
//    [FIX-SANITISE]     Comment trimmed and length-capped before submit
//    [FIX-EMAIL-VALID]  Client-side email validation on verifier form
//    [FIX-CHAIN-API]    chain-status, lock, verify-chain, retry all in auditAPI

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../services/api';

// ── auditAPI — inline since api.js may not be updated yet in all envs ─────────
// These map directly to routes/audit.js endpoints
const auditAPI = {
  getLogs:         (year)        => apiFetch(`/api/audit/log?year=${year}`),
  addLog:          (body)        => apiFetch('/api/audit/log',                   { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  getVerifiers:    (year)        => apiFetch(`/api/audit/verifiers?year=${year}`),
  addVerifier:     (body)        => apiFetch('/api/audit/verifiers',             { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  updateVerifier:  (id, body)    => apiFetch(`/api/audit/verifiers/${id}`,       { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  removeVerifier:  (id)          => apiFetch(`/api/audit/verifiers/${id}`,       { method: 'DELETE' }),
  retryChain:      (id)          => apiFetch(`/api/audit/retry-chain/${id}`,     { method: 'POST', headers: { 'Content-Type': 'application/json' } }),
  chainStatus:     ()            => apiFetch('/api/audit/chain-status'),
  verifyChain:     (year)        => apiFetch(`/api/audit/verify-chain?year=${year}`),
  lockInventory:   (year)        => apiFetch('/api/audit/lock',                  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year }) }),
  getStatements:   (year)        => apiFetch(`/api/audit/statements?year=${year}`),
  uploadStatement: (formData)    => apiFetch('/api/audit/statements',            { method: 'POST', body: formData }),
};

const ASSURANCE_LEVELS = [
  { level: 'limited',    label: 'Limited Assurance',    desc: 'ISO 14064-3 Type 1 — Verifier reviews methodology & spot checks data', color: '#f59e0b' },
  { level: 'reasonable', label: 'Reasonable Assurance', desc: 'ISO 14064-3 Type 2 — Full data trail + evidence review',               color: '#3b82f6' },
  { level: 'high',       label: 'High Assurance',       desc: 'ISO 14064-3 Type 3 — On-site visit + complete evidence package',       color: '#10b981' },
];

const VERIFIERS = [
  'Bureau Veritas (BV)', 'DNV', 'Ernst & Young (EY)',
  'KPMG', 'Deloitte', 'SGS India', 'TUV SUD', 'BSI Group',
  'RINA', 'Intertek', 'Other (specify)',
];

const ACTION_COLORS = {
  CREATE:  '#10b981', UPDATE:  '#f59e0b', DELETE:  '#ef4444',
  VERIFY:  '#a855f7', SIGN:    '#3b82f6', LOCK:    '#f97316',
  IMPORT:  '#22d3ee', COMMENT: '#6366f1',
};

const CHAIN = {
  name:        'sepolia',
  explorerTx:  'https://sepolia.etherscan.io/tx',
  explorerAddr:'https://sepolia.etherscan.io/address',
  label:       'Sepolia Testnet',
  color:       '#627eea',
};

// [FIX-YEAR-DYNAMIC] Dynamic year range
const REPORT_YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);

const fmtDate   = d  => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const truncHash = h  => h ? `${h.slice(0, 8)}…${h.slice(-6)}` : '—';
const truncTx   = h  => h ? `${h.slice(0, 10)}…${h.slice(-8)}` : null;
const sanitise  = (s, max = 2000) => String(s || '').replace(/<[^>]*>/g, '').trim().slice(0, max);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap');
:root{
  --bg:#060809;--surf:#0e1318;--brd:#1a2d3a;--brd2:#253545;
  --txt:#eef4ff;--mut:#4a6a7a;--grn:#10b981;--red:#ef4444;
  --ylw:#f59e0b;--s2:#3b82f6;--pur:#a855f7;--org:#f97316;
  --eth:#627eea;
}
.at{min-height:100vh;background:var(--bg);font-family:'Space Mono',monospace;color:var(--txt);}
.at-in{max-width:1200px;margin:0 auto;padding:28px 24px;}
.at-hd{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:22px;padding-bottom:16px;border-bottom:1px solid var(--brd);}
.at-title{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;}
.at-title span{color:var(--grn);}
.at-sub{font-size:10px;color:var(--mut);letter-spacing:.1em;margin-top:3px;}
.at-label{font-size:10px;letter-spacing:.18em;color:var(--mut);margin-bottom:3px;}
.at-card{background:var(--surf);border:1px solid var(--brd);border-radius:10px;padding:18px 20px;margin-bottom:12px;animation:fU .4s ease both;}
.at-ctit{font-size:10px;letter-spacing:.14em;color:var(--mut);margin-bottom:14px;display:flex;align-items:center;gap:8px;}
.at-ctit::before{content:'';width:10px;height:1px;background:var(--grn);}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}
.at-fg{display:flex;flex-direction:column;gap:5px;margin-bottom:10px;}
.at-lbl{font-size:10px;letter-spacing:.1em;color:var(--mut);}
.at-inp,.at-sel,.at-ta{padding:9px 11px;border-radius:6px;background:#080c10;border:1px solid var(--brd);color:var(--txt);font-family:'Space Mono',monospace;font-size:12px;outline:none;transition:border-color .2s;width:100%;box-sizing:border-box;}
.at-inp:focus,.at-sel:focus,.at-ta:focus{border-color:#10b98144;}
.at-inp::placeholder,.at-ta::placeholder{color:var(--mut);opacity:.7;}
.at-inp.err{border-color:#ef444466;}
.at-field-err{font-size:10px;color:#ef4444;margin-top:3px;}
.btn{padding:9px 17px;border-radius:6px;border:none;cursor:pointer;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.1em;font-weight:700;transition:all .2s;}
.btn:disabled{opacity:.4;cursor:not-allowed;}
.btn-p{background:linear-gradient(135deg,#10b981,#059669);color:#fff;}
.btn-p:hover:not(:disabled){opacity:.85;transform:translateY(-1px);}
.btn-g{background:var(--surf);border:1px solid var(--brd2);color:var(--txt);}
.btn-g:hover:not(:disabled){border-color:#10b98144;color:var(--grn);}
.btn-pur{background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;}
.btn-red{background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;}
.btn-eth{background:linear-gradient(135deg,#627eea,#4c63d2);color:#fff;}
.btn-sm{padding:6px 12px;font-size:10px;}
.btn-xs{padding:4px 9px;font-size:9px;letter-spacing:.06em;}
.chain-banner{display:flex;align-items:center;gap:12px;padding:10px 16px;border-radius:8px;margin-bottom:14px;font-size:11px;flex-wrap:wrap;}
.chain-ok{background:#10b98108;border:1px solid #10b98133;color:var(--grn);}
.chain-warn{background:#f59e0b08;border:1px solid #f59e0b33;color:var(--ylw);}
.chain-off{background:#ef444408;border:1px solid #ef444433;color:var(--red);}
.chain-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
.chain-dot-ok{background:#10b981;box-shadow:0 0 8px #10b98166;animation:pulse 2s ease infinite;}
.chain-dot-off{background:#ef4444;}
.chain{display:flex;flex-direction:column;gap:0;}
.chain-entry{display:grid;grid-template-columns:20px 1fr;gap:0;}
.chain-line{display:flex;flex-direction:column;align-items:center;}
.chain-dot-entry{width:10px;height:10px;border-radius:50%;flex-shrink:0;margin-top:12px;position:relative;z-index:1;}
.chain-bar{width:2px;flex:1;background:var(--brd);margin:2px 0;}
.chain-body{padding:10px 0 10px 14px;border-bottom:1px solid var(--brd)22;}
.chain-hd{display:flex;align-items:center;gap:8px;margin-bottom:5px;flex-wrap:wrap;}
.chain-action{font-size:10px;padding:3px 8px;border-radius:3px;letter-spacing:.06em;font-weight:700;}
.chain-ts{font-size:10px;color:var(--mut);}
.chain-msg{font-size:12px;color:var(--txt);margin-bottom:5px;line-height:1.5;}
.chain-proof{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px;}
.chain-proof-confirmed{padding:3px 9px;border-radius:3px;font-size:9px;background:#10b98112;color:#10b981;border:1px solid #10b98133;letter-spacing:.06em;display:inline-flex;align-items:center;gap:5px;}
.chain-proof-pending{padding:3px 9px;border-radius:3px;font-size:9px;background:#f59e0b12;color:#f59e0b;border:1px solid #f59e0b33;letter-spacing:.06em;}
.chain-proof-failed{padding:3px 9px;border-radius:3px;font-size:9px;background:#ef444412;color:#ef4444;border:1px solid #ef444433;letter-spacing:.06em;display:inline-flex;align-items:center;gap:5px;cursor:pointer;}
.chain-proof-failed:hover{background:#ef444422;}
.etherscan-link{color:var(--eth);font-size:9px;font-family:'Space Mono',monospace;text-decoration:none;letter-spacing:.04em;display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:3px;background:#627eea10;border:1px solid #627eea33;transition:all .2s;}
.etherscan-link:hover{background:#627eea22;color:#8da4f5;}
.chain-hash-row{font-size:9px;color:var(--mut);font-family:'Space Mono',monospace;letter-spacing:.03em;margin-top:3px;}
.chain-hash-row span{color:#3b82f644;margin:0 4px;}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;}
.stat-tile{background:#080c10;border-radius:8px;padding:12px;border:1px solid var(--brd);}
.stat-val{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;margin-bottom:2px;}
.stat-lbl{font-size:10px;color:var(--mut);letter-spacing:.08em;}
.coverage-bar{height:4px;background:var(--brd);border-radius:2px;margin-top:8px;overflow:hidden;}
.coverage-fill{height:100%;background:linear-gradient(90deg,#10b981,#627eea);border-radius:2px;transition:width 1s ease;}
.ver-card{border-radius:8px;padding:14px 16px;border:1px solid;margin-bottom:10px;}
.ver-pending{background:#f59e0b06;border-color:#f59e0b33;}
.ver-verified{background:#10b98106;border-color:#10b98133;}
.ver-rejected{background:#ef444406;border-color:#ef444433;}
.pill{display:inline-flex;align-items:center;gap:4px;font-size:10px;padding:3px 9px;border-radius:3px;letter-spacing:.05em;}
.pill-grn{background:#10b98114;color:#10b981;border:1px solid #10b98133;}
.pill-ylw{background:#f59e0b14;color:#f59e0b;border:1px solid #f59e0b33;}
.pill-red{background:#ef444414;color:#ef4444;border:1px solid #ef444433;}
.pill-pur{background:#a855f714;color:#a855f7;border:1px solid #a855f733;}
.pill-dot{width:5px;height:5px;border-radius:50%;}
.ass-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px;}
.ass-opt{padding:12px;border-radius:8px;border:1px solid var(--brd);cursor:pointer;transition:all .2s;background:var(--bg);}
.ass-opt.sel{border-color:var(--ac);background:color-mix(in srgb,var(--ac) 8%,transparent);}
.ass-opt-lbl{font-size:11px;font-weight:700;margin-bottom:4px;}
.ass-opt-desc{font-size:10px;color:var(--mut);line-height:1.5;}
.at-alert{padding:10px 14px;border-radius:7px;font-size:11px;display:flex;gap:8px;margin-bottom:12px;line-height:1.6;}
.al-g{background:#10b98108;border:1px solid #10b98133;color:var(--grn);}
.al-y{background:#f59e0b08;border:1px solid #f59e0b33;color:var(--ylw);}
.al-r{background:#ef444408;border:1px solid #ef444433;color:var(--red);}
.al-e{background:#627eea08;border:1px solid #627eea33;color:#8da4f5;}
.at-tabs{display:flex;gap:0;margin-bottom:18px;border-bottom:1px solid var(--brd);overflow-x:auto;}
.at-tab{padding:9px 15px;font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.08em;cursor:pointer;border:none;background:none;color:var(--mut);border-bottom:2px solid transparent;transition:all .2s;margin-bottom:-1px;white-space:nowrap;flex-shrink:0;}
.at-tab.on{color:var(--grn);border-bottom-color:var(--grn);}
.at-confirm-overlay{position:fixed;inset:0;z-index:1000;background:#00000088;display:flex;align-items:center;justify-content:center;}
.at-confirm-box{background:var(--surf);border:1px solid var(--brd2);border-radius:10px;padding:24px;max-width:400px;width:90%;}
.locked-banner{padding:12px 16px;border-radius:8px;background:#f9731606;border:1px solid #f9731633;font-size:11px;color:#f97316;display:flex;align-items:center;gap:10px;margin-bottom:14px;}
.notif{position:fixed;top:76px;right:24px;z-index:9999;padding:11px 18px;border-radius:8px;font-family:'Space Mono',monospace;font-size:11px;box-shadow:0 8px 32px #00000066;animation:fU .3s ease;max-width:420px;}
.notif-ok{background:#0b2a1e;border:1px solid #10b98133;color:#10b981;}
.notif-err{background:#450a0a;border:1px solid #ef444433;color:#f87171;}
.notif-warn{background:#2a1f00;border:1px solid #f59e0b33;color:#f59e0b;}
.divider{height:1px;background:var(--brd);margin:12px 0;}
@keyframes fU{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(.85)}}
@media(max-width:900px){.g2,.g3,.stats,.ass-grid{grid-template-columns:1fr 1fr;}}
@media(max-width:600px){.stats,.ass-grid{grid-template-columns:1fr;}}
`;

export default function AuditTrail({ year: propYear, profile, emissions = [] }) {
  const [year,               setYear]              = useState(propYear || new Date().getFullYear());
  const [tab,                setTab]               = useState('log');
  const [entries,            setEntries]           = useState([]);
  const [verifiers,          setVerifiers]         = useState([]);
  const [locked,             setLocked]            = useState(false);
  const [lockTxHash,         setLockTxHash]        = useState(null);
  const [loading,            setLoading]           = useState(true);
  const [loadError,          setLoadError]         = useState(false);  // [FIX-LOAD-ERROR]
  const [notif,              setNotif]             = useState(null);
  const [page,               setPage]              = useState(1);
  const [filterAct,          setFilterAct]         = useState('ALL');
  const [showLockConfirm,    setShowLockConfirm]   = useState(false);
  const [chainStatus,        setChainStatus]       = useState(null);
  const [retrying,           setRetrying]          = useState(null);
  const [submittingVerifier, setSubmittingVerifier]= useState(false);
  const [submittingComment,  setSubmittingComment] = useState(false);
  const [emailErr,           setEmailErr]          = useState('');  // [FIX-EMAIL-VALID]

  const abortRef = useRef(null);  // [FIX-ABORT]
  const PER_PAGE = 15;

  const [vform, setVform] = useState({
    verifier_name: '', verifier_org: '', verifier_email: '',
    assurance_level: 'limited', scope: '1+2+3',
    notes: '', engagement_ref: '',
  });
  const [comment, setComment] = useState('');

  const toast = (msg, type = 'ok') => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 4500);
  };

  // ── [FIX-ABORT] Load with abort controller ────────────────────────────────
  const load = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;

    setLoading(true);
    setLoadError(false);

    try {
      const [logRes, verRes, chainRes] = await Promise.all([
        auditAPI.getLogs(year).catch(() => null),
        auditAPI.getVerifiers(year).catch(() => null),
        auditAPI.chainStatus().catch(() => null),
      ]);

      if (ctl.signal.aborted) return;

      if (logRes?.entries)    setEntries(logRes.entries);
      if (verRes?.verifiers)  setVerifiers(verRes.verifiers);
      if (logRes?.locked)     setLocked(logRes.locked);
      if (logRes?.lockTxHash) setLockTxHash(logRes.lockTxHash);
      if (chainRes)           setChainStatus(chainRes);

      // [FIX-LOAD-ERROR] If all three failed, show error
      if (!logRes && !verRes && !chainRes) setLoadError(true);

    } catch {
      if (!ctl.signal.aborted) setLoadError(true);
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  // ── [FIX-EMAIL-VALID] Validate email on blur ──────────────────────────────
  const handleEmailBlur = () => {
    if (vform.verifier_email && !EMAIL_RE.test(vform.verifier_email)) {
      setEmailErr('Invalid email format');
    } else {
      setEmailErr('');
    }
  };

  // ── Add comment ───────────────────────────────────────────────────────────
  const handleComment = async () => {
    const clean = sanitise(comment, 2000);  // [FIX-SANITISE]
    if (!clean) return;
    if (submittingComment) return;
    setSubmittingComment(true);
    try {
      const res = await auditAPI.addLog({ year, action: 'COMMENT', message: clean });
      if (res?.entry) {
        setEntries(e => [res.entry, ...e]);
        setComment('');
        toast(res.onChain
          ? `Comment anchored on-chain · tx: ${truncTx(res.entry.tx_hash)}`
          : 'Comment saved — chain anchor pending', res.onChain ? 'ok' : 'warn');
      }
    } catch (err) {
      toast('Failed to log comment: ' + (err.message || 'Please try again'), 'err');
    } finally {
      setSubmittingComment(false);
    }
  };

  // ── Invite verifier ───────────────────────────────────────────────────────
  const handleInviteVerifier = async (e) => {
    e.preventDefault();
    if (submittingVerifier) return;
    // [FIX-EMAIL-VALID] Final validation before submit
    if (!EMAIL_RE.test(vform.verifier_email)) {
      setEmailErr('Invalid email format');
      return;
    }
    setEmailErr('');
    setSubmittingVerifier(true);
    try {
      const res = await auditAPI.addVerifier({ year, ...vform });
      if (res?.verifier) {
        setVerifiers(v => [res.verifier, ...v]);
        if (res.auditEntry) setEntries(e => [res.auditEntry, ...e]);
        setVform(f => ({ ...f, verifier_name: '', verifier_org: '', verifier_email: '', notes: '', engagement_ref: '' }));
        toast(res.onChain
          ? `Verifier invited + anchored on-chain · ${truncTx(res.auditEntry?.tx_hash)}`
          : 'Verifier invited — chain anchor pending', res.onChain ? 'ok' : 'warn');
      }
    } catch (err) {
      toast('Failed to invite verifier: ' + (err.message || 'Please try again'), 'err');
    } finally {
      setSubmittingVerifier(false);
    }
  };

  // ── Lock inventory ────────────────────────────────────────────────────────
  const handleLockConfirm = async () => {
    setShowLockConfirm(false);
    try {
      const res = await auditAPI.lockInventory(year);
      setLocked(true);
      if (res.auditEntry) setEntries(e => [res.auditEntry, ...e]);
      if (res.onChain) {
        setLockTxHash(res.lockTxHash);
        toast(`Inventory locked on-chain · tx: ${truncTx(res.lockTxHash)}`);
      } else {
        toast(res.chainLockError
          ? `Inventory locked (DB only) — chain error: ${res.chainLockError}`
          : 'Inventory locked (DB only) — chain anchor pending', 'warn');
      }
    } catch (err) {
      toast('Lock failed: ' + (err.message || 'Please try again'), 'err');
    }
  };

  // ── Retry failed chain entry ──────────────────────────────────────────────
  const handleRetry = async (entryId) => {
    if (retrying) return;
    setRetrying(entryId);
    try {
      const res = await auditAPI.retryChain(entryId);
      if (res?.entry) {
        setEntries(prev => prev.map(e => e.id === entryId
          ? { ...e, ...res.entry, explorerUrl: res.explorerUrl }
          : e));
        toast(`Anchored on-chain · tx: ${truncTx(res.txHash)}`);
      }
    } catch (err) {
      toast('Retry failed: ' + (err.message || 'Please try again'), 'err');
    } finally {
      setRetrying(null);
    }
  };

  // ── Run chain integrity check ─────────────────────────────────────────────
  const verifyChain = async () => {
    try {
      const res = await auditAPI.verifyChain(year);
      if (res?.database?.intact && res?.blockchain?.intact) {
        toast(`Chain intact — DB: ${res.database.total} entries · On-chain: ${res.blockchain.totalOnChain} entries · ${res.summary.coverage} anchored`);
      } else if (res?.database?.intact) {
        toast(`DB chain intact · On-chain: ${res.blockchain?.error || 'check failed'} · ${res.summary?.coverage} anchored`, 'warn');
      } else {
        toast(`${res?.database?.broken} hash mismatch(es) in DB chain — possible tampering`, 'err');
      }
    } catch (err) {
      toast('Chain verify failed: ' + (err.message || 'Please try again'), 'err');
    }
  };

  // ── [FIX-BLOB-REVOKE] Export CSV with proper blob URL revoke ─────────────
  const handleExportCSV = () => {
    const rows = [
      'Timestamp,Action,Message,Hash,Prev Hash,Chain Status,Tx Hash,Block,Etherscan URL',
      ...entries.map(e => [
        `"${e.created_at}"`,
        `"${e.action}"`,
        `"${(e.message || '').replace(/"/g, '""')}"`,
        `"${e.hash || ''}"`,
        `"${e.prev_hash || ''}"`,
        `"${e.chain_status || ''}"`,
        `"${e.tx_hash || ''}"`,
        `"${e.block_number || ''}"`,
        `"${e.tx_hash ? `${CHAIN.explorerTx}/${e.tx_hash}` : ''}"`,
      ].join(',')),
    ].join('\n');

    const blobUrl = URL.createObjectURL(new Blob([rows], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href     = blobUrl;
    a.download = `ethertrack_audit_fy${year}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);  // [FIX-BLOB-REVOKE]
    toast('Audit log exported with on-chain references');
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const filtered       = entries.filter(e => filterAct === 'ALL' || e.action === filterAct);
  const totalPages     = Math.ceil(filtered.length / PER_PAGE);
  const pageEntries    = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const actionTypes    = ['ALL', ...new Set(entries.map(e => e.action))];
  const confirmedCount = entries.filter(e => e.chain_status === 'confirmed').length;
  const pendingCount   = entries.filter(e => e.chain_status === 'pending').length;
  const failedCount    = entries.filter(e => e.chain_status === 'failed').length;
  const coveragePct    = entries.length > 0 ? Math.round(confirmedCount / entries.length * 100) : 0;
  const verifiedCount  = verifiers.filter(v => v.status === 'verified').length;

  return (
    <>
      <style>{CSS}</style>

      {notif && <div className={`notif notif-${notif.type}`}>{notif.msg}</div>}

      {/* ── Lock confirm modal ──────────────────────────────────────────── */}
      {showLockConfirm && (
        <div className="at-confirm-overlay" onClick={() => setShowLockConfirm(false)}>
          <div className="at-confirm-box" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt)', marginBottom: 8 }}>
              LOCK GHG INVENTORY — FY {year}
            </div>
            <div style={{ fontSize: 11, color: 'var(--mut)', lineHeight: 1.7, marginBottom: 16 }}>
              This puts the inventory into <strong style={{ color: '#f97316' }}>ISO 14064-3 data freeze</strong> and
              writes a lock transaction to <strong style={{ color: CHAIN.color }}>Sepolia blockchain</strong>.
              After lock, corrections require verifier approval and are logged as amendments.
              This cannot be undone without contacting your assigned verifier.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-red" style={{ flex: 1 }} onClick={handleLockConfirm}>
                LOCK + ANCHOR ON-CHAIN
              </button>
              <button className="btn btn-g" style={{ flex: 1 }} onClick={() => setShowLockConfirm(false)}>
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="at">
        <div className="at-in">

          {/* ── Chain status banner ─────────────────────────────────────── */}
          {chainStatus && (
            <div className={`chain-banner ${chainStatus.ready ? 'chain-ok' : 'chain-off'}`}>
              <div className={`chain-dot ${chainStatus.ready ? 'chain-dot-ok' : 'chain-dot-off'}`}/>
              {chainStatus.ready ? (
                <>
                  <span style={{ fontWeight: 700, color: CHAIN.color }}>⬡ {CHAIN.label}</span>
                  <span>·</span>
                  <span>Relayer: <span style={{ color: 'var(--txt)' }}>{chainStatus.relayer?.slice(0, 10)}…</span></span>
                  <span>·</span>
                  <span>Balance: <span style={{ color: chainStatus.lowBalance ? '#f59e0b' : 'var(--grn)' }}>{chainStatus.balance} {chainStatus.symbol}</span></span>
                  {chainStatus.lowBalance && <span style={{ color: '#f59e0b' }}>⚠ Low — top up faucet</span>}
                  <span>·</span>
                  <a href={chainStatus.explorerUrl} target="_blank" rel="noreferrer"
                    style={{ color: CHAIN.color, fontSize: 10, textDecoration: 'none' }}>
                    View contract ↗
                  </a>
                </>
              ) : (
                <>
                  <span style={{ fontWeight: 700 }}>⬡ Chain offline</span>
                  <span>·</span>
                  <span>{chainStatus.reason}</span>
                  <span>· Entries stored in DB with retry option</span>
                </>
              )}
            </div>
          )}

          {/* ── Header ─────────────────────────────────────────────────── */}
          <div className="at-hd">
            <div>
              <div className="at-label">ISO 14064-3 · GHG PROTOCOL · {CHAIN.label.toUpperCase()}</div>
              <div className="at-title">GHG Audit <span>Trail</span></div>
              <div className="at-sub">Every entry is a real blockchain transaction · Hash-chained · Verifier workflow</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {/* [FIX-YEAR-DYNAMIC] Dynamic year dropdown */}
              <select className="at-sel" style={{ width: 'auto', padding: '7px 11px', fontSize: 11 }}
                value={year} onChange={e => { setYear(parseInt(e.target.value)); setPage(1); }}>
                {REPORT_YEARS.map(y => <option key={y}>{y}</option>)}
              </select>
              {!locked
                ? <button className="btn btn-red btn-sm" onClick={() => setShowLockConfirm(true)}>LOCK INVENTORY</button>
                : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="pill pill-ylw">LOCKED</span>
                    {lockTxHash && (
                      <a href={`${CHAIN.explorerTx}/${lockTxHash}`} target="_blank" rel="noreferrer"
                        className="etherscan-link">⬡ Lock tx ↗</a>
                    )}
                  </div>
                )
              }
              <button className="btn btn-g btn-sm" onClick={verifyChain}>VERIFY CHAIN</button>
              <button className="btn btn-g btn-sm" onClick={handleExportCSV}>EXPORT LOG</button>
            </div>
          </div>

          {/* ── [FIX-LOAD-ERROR] Load error state ──────────────────────── */}
          {loadError && !loading && (
            <div className="at-alert al-r" style={{ cursor: 'pointer' }} onClick={load}>
              <span>✕</span>
              <span>Failed to load audit trail. <strong>Click to retry.</strong></span>
            </div>
          )}

          {locked && (
            <div className="locked-banner">
              <span style={{ fontSize: 18 }}>🔒</span>
              <div style={{ flex: 1 }}>
                <strong>Inventory Locked — FY {year}</strong>
                <div style={{ fontSize: 10, marginTop: 2, opacity: .8 }}>
                  ISO 14064-3 data freeze active. Corrections require verifier approval.
                  {lockTxHash && (
                    <span style={{ marginLeft: 8 }}>
                      <a href={`${CHAIN.explorerTx}/${lockTxHash}`} target="_blank" rel="noreferrer"
                        className="etherscan-link" style={{ verticalAlign: 'middle' }}>
                        ⬡ View lock transaction ↗
                      </a>
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Stats ──────────────────────────────────────────────────── */}
          {!loadError && (
            <div className="stats">
              {[
                { label: 'AUDIT ENTRIES',    val: entries.length,  color: '#10b981' },
                { label: 'ON-CHAIN',         val: confirmedCount,  color: CHAIN.color },
                { label: 'PENDING / FAILED', val: `${pendingCount} / ${failedCount}`, color: failedCount > 0 ? '#ef4444' : '#f59e0b' },
                { label: 'VERIFIERS',        val: verifiers.length, color: verifiedCount > 0 ? '#10b981' : '#a855f7' },
              ].map(({ label, val, color }) => (
                <div key={label} className="stat-tile">
                  <div className="stat-val" style={{ color }}>{val}</div>
                  <div className="stat-lbl">{label}</div>
                  {label === 'ON-CHAIN' && (
                    <>
                      <div className="coverage-bar">
                        <div className="coverage-fill" style={{ width: `${coveragePct}%` }}/>
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--mut)', marginTop: 4 }}>{coveragePct}% anchored</div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {verifiedCount > 0 && (
            <div className="at-alert al-g">
              <span>✓</span>
              <span>{verifiedCount} verifier(s) signed off — ISO 14064-3 assurance active. BRSR, CDP, TCFD submission ready.</span>
            </div>
          )}
          {failedCount > 0 && (
            <div className="at-alert al-y">
              <span>⚠</span>
              <span>{failedCount} entries failed to anchor on-chain. Go to the audit log and click RETRY on failed entries.</span>
            </div>
          )}

          {/* ── Tabs ───────────────────────────────────────────────────── */}
          <div className="at-tabs">
            {[
              ['log',      'AUDIT LOG'],
              ['verifier', `VERIFIER (${verifiers.length})`],
              ['comment',  'ADD COMMENT'],
              ['chain',    'CHAIN INTEGRITY'],
            ].map(([k, v]) => (
              <button key={k} className={`at-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{v}</button>
            ))}
          </div>

          {loading && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--mut)', fontSize: 11, letterSpacing: '.1em' }}>
              LOADING AUDIT TRAIL
            </div>
          )}

          {!loading && !loadError && (
            <>
              {/* ── LOG TAB ─────────────────────────────────────────────── */}
              {tab === 'log' && (
                <div className="at-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <div className="at-ctit" style={{ marginBottom: 0 }}>
                      HASH-CHAINED AUDIT LOG · FY {year} · {filtered.length} ENTRIES
                    </div>
                    <select className="at-sel" style={{ width: 'auto', padding: '6px 10px', fontSize: 10 }}
                      value={filterAct} onChange={e => { setFilterAct(e.target.value); setPage(1); }}>
                      {actionTypes.map(a => <option key={a}>{a}</option>)}
                    </select>
                  </div>

                  {pageEntries.length === 0 ? (
                    <div style={{ padding: 32, textAlign: 'center', color: 'var(--mut)', fontSize: 11, lineHeight: 1.8 }}>
                      No audit entries yet.<br/>
                      Every emission log, edit, import, and verifier action appears here automatically,
                      anchored to {CHAIN.label}.
                    </div>
                  ) : (
                    <div className="chain">
                      {pageEntries.map((e, i) => {
                        const color       = ACTION_COLORS[e.action] || '#5a7a8a';
                        const isConfirmed = e.chain_status === 'confirmed';
                        const isFailed    = e.chain_status === 'failed';
                        const isPending   = e.chain_status === 'pending' || !e.chain_status;
                        const explorerUrl = e.tx_hash ? `${CHAIN.explorerTx}/${e.tx_hash}` : e.explorerUrl;

                        return (
                          <div key={e.id || i} className="chain-entry">
                            <div className="chain-line">
                              <div className="chain-dot-entry" style={{
                                background: color,
                                boxShadow: isConfirmed ? `0 0 8px ${color}66` : 'none',
                              }}/>
                              {i < pageEntries.length - 1 && <div className="chain-bar"/>}
                            </div>
                            <div className="chain-body">
                              <div className="chain-hd">
                                <span className="chain-action" style={{ background: `${color}18`, color, border: `1px solid ${color}33` }}>
                                  {e.action}
                                </span>
                                <span className="chain-ts">{fmtDate(e.created_at)}</span>
                                {e.meta?.user && <span style={{ fontSize: 10, color: 'var(--mut)' }}>· {e.meta.user}</span>}
                              </div>
                              <div className="chain-msg">{e.message}</div>
                              <div className="chain-proof">
                                {isConfirmed && (
                                  <>
                                    <span className="chain-proof-confirmed">⬡ ON-CHAIN</span>
                                    {explorerUrl && (
                                      <a href={explorerUrl} target="_blank" rel="noreferrer" className="etherscan-link">
                                        ⬡ {truncTx(e.tx_hash)} ↗
                                      </a>
                                    )}
                                    {e.block_number && <span style={{ fontSize: 9, color: 'var(--mut)' }}>Block #{e.block_number}</span>}
                                    {e.gas_used && <span style={{ fontSize: 9, color: 'var(--mut)' }}>Gas: {Number(e.gas_used).toLocaleString()}</span>}
                                  </>
                                )}
                                {isPending && !isFailed && (
                                  <span className="chain-proof-pending">CHAIN PENDING</span>
                                )}
                                {isFailed && (
                                  <span className="chain-proof-failed"
                                    onClick={() => handleRetry(e.id)}
                                    title={e.chain_error || 'Click to retry'}>
                                    CHAIN FAILED — {retrying === e.id ? 'RETRYING' : 'CLICK TO RETRY'}
                                  </span>
                                )}
                                {isFailed && e.chain_error && (
                                  <span style={{ fontSize: 9, color: '#ef4444', opacity: .7 }}>{e.chain_error.slice(0, 60)}</span>
                                )}
                              </div>
                              <div className="chain-hash-row">
                                HASH: {truncHash(e.hash)}
                                <span>←</span>
                                PREV: {truncHash(e.prev_hash)}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {totalPages > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 14 }}>
                      <button className="btn btn-g btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>PREV</button>
                      <span style={{ fontSize: 11, color: 'var(--mut)' }}>PAGE {page} / {totalPages}</span>
                      <button className="btn btn-g btn-sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>NEXT</button>
                    </div>
                  )}
                </div>
              )}

              {/* ── VERIFIER TAB ────────────────────────────────────────── */}
              {tab === 'verifier' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {verifiers.map((v, i) => (
                    <div key={v.id || i} className={`ver-card ver-${v.status || 'pending'}`}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{v.verifier_name} · {v.verifier_org}</div>
                          <div style={{ fontSize: 11, color: 'var(--mut)' }}>{v.verifier_email}</div>
                        </div>
                        <span className={`pill pill-${v.status === 'verified' ? 'grn' : v.status === 'rejected' ? 'red' : 'ylw'}`}>
                          <span className="pill-dot" style={{ background: v.status === 'verified' ? '#10b981' : v.status === 'rejected' ? '#ef4444' : '#f59e0b' }}/>
                          {(v.status || 'PENDING').toUpperCase()}
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 11 }}>
                        <div><span style={{ color: 'var(--mut)' }}>Assurance: </span><span>{v.assurance_level}</span></div>
                        <div><span style={{ color: 'var(--mut)' }}>Scope: </span><span>{v.scope}</span></div>
                        <div><span style={{ color: 'var(--mut)' }}>Ref: </span><span>{v.engagement_ref || '—'}</span></div>
                      </div>
                      {v.status === 'verified' && (
                        <div className="at-alert al-g" style={{ marginTop: 10, marginBottom: 0 }}>
                          <span>✓</span>
                          <span>ISO 14064-3 third-party verification confirmed. BRSR, CDP, TCFD submission ready.</span>
                        </div>
                      )}
                    </div>
                  ))}

                  <div className="at-card">
                    <div className="at-ctit">INVITE THIRD-PARTY VERIFIER — ISO 14064-3</div>
                    <div style={{ fontSize: 10, letterSpacing: '.1em', color: 'var(--mut)', marginBottom: 10 }}>SELECT ASSURANCE LEVEL</div>
                    <div className="ass-grid">
                      {ASSURANCE_LEVELS.map(al => (
                        <div key={al.level}
                          className={`ass-opt${vform.assurance_level === al.level ? ' sel' : ''}`}
                          style={{ '--ac': al.color }}
                          onClick={() => setVform(f => ({ ...f, assurance_level: al.level }))}>
                          <div className="ass-opt-lbl" style={{ color: vform.assurance_level === al.level ? al.color : 'var(--txt)' }}>
                            {al.label}
                          </div>
                          <div className="ass-opt-desc">{al.desc}</div>
                        </div>
                      ))}
                    </div>
                    <form onSubmit={handleInviteVerifier}>
                      <div className="g3">
                        <div className="at-fg">
                          <label className="at-lbl">VERIFIER ORGANISATION</label>
                          <select className="at-sel" value={vform.verifier_org}
                            onChange={e => setVform(f => ({ ...f, verifier_org: e.target.value }))}>
                            <option value="">Select</option>
                            {VERIFIERS.map(v => <option key={v}>{v}</option>)}
                          </select>
                        </div>
                        <div className="at-fg">
                          <label className="at-lbl">CONTACT NAME</label>
                          <input className="at-inp" type="text" placeholder="e.g. Rahul Sharma"
                            value={vform.verifier_name}
                            onChange={e => setVform(f => ({ ...f, verifier_name: e.target.value }))}
                            required maxLength={200}/>
                        </div>
                        <div className="at-fg">
                          <label className="at-lbl">VERIFIER EMAIL</label>
                          {/* [FIX-EMAIL-VALID] */}
                          <input
                            className={`at-inp${emailErr ? ' err' : ''}`}
                            type="email"
                            placeholder="verifier@bv.com"
                            value={vform.verifier_email}
                            onChange={e => { setVform(f => ({ ...f, verifier_email: e.target.value })); setEmailErr(''); }}
                            onBlur={handleEmailBlur}
                            required maxLength={200}/>
                          {emailErr && <div className="at-field-err">{emailErr}</div>}
                        </div>
                      </div>
                      <div className="g3">
                        <div className="at-fg">
                          <label className="at-lbl">SCOPE COVERAGE</label>
                          <select className="at-sel" value={vform.scope}
                            onChange={e => setVform(f => ({ ...f, scope: e.target.value }))}>
                            {['1+2+3', '1+2', '1 only', '2 only', '3 only'].map(s => <option key={s}>{s}</option>)}
                          </select>
                        </div>
                        <div className="at-fg">
                          <label className="at-lbl">ENGAGEMENT REF</label>
                          <input className="at-inp" type="text" placeholder="e.g. BV-IN-2025-4821"
                            value={vform.engagement_ref}
                            onChange={e => setVform(f => ({ ...f, engagement_ref: e.target.value }))}
                            maxLength={100}/>
                        </div>
                        <div className="at-fg">
                          <label className="at-lbl">NOTES</label>
                          <input className="at-inp" type="text" placeholder="Instructions"
                            value={vform.notes}
                            onChange={e => setVform(f => ({ ...f, notes: e.target.value }))}
                            maxLength={500}/>
                        </div>
                      </div>
                      <button type="submit" className="btn btn-pur" disabled={submittingVerifier || !!emailErr}>
                        {submittingVerifier ? 'INVITING' : 'INVITE VERIFIER'}
                      </button>
                    </form>
                  </div>
                </div>
              )}

              {/* ── COMMENT TAB ─────────────────────────────────────────── */}
              {tab === 'comment' && (
                <div className="at-card">
                  <div className="at-ctit">ADD AUDITOR COMMENT TO TRAIL</div>
                  <div style={{ fontSize: 11, color: 'var(--mut)', marginBottom: 14, lineHeight: 1.7 }}>
                    Comments are written to {CHAIN.label} as a real transaction and stored permanently.
                    Use for methodology notes, data quality comments, boundary clarifications, or corrections.
                  </div>
                  <div className="at-fg">
                    <label className="at-lbl">COMMENT / METHODOLOGY NOTE</label>
                    <textarea className="at-ta" rows={5}
                      placeholder="e.g. Scope 2 electricity factor updated from 0.82 to 0.727 kgCO2e/kWh per CEA V20.0 Dec 2024."
                      value={comment}
                      onChange={e => setComment(e.target.value)}
                      style={{ resize: 'vertical' }}
                      maxLength={2000}
                      disabled={locked}
                    />
                    <div style={{ fontSize: 9, color: 'var(--mut)', textAlign: 'right', marginTop: 3 }}>
                      {comment.length}/2000
                    </div>
                  </div>
                  {locked && (
                    <div className="at-alert al-y" style={{ marginBottom: 10 }}>
                      <span>🔒</span>
                      <span>Inventory locked — comments still allowed but data changes require verifier approval.</span>
                    </div>
                  )}
                  <button className="btn btn-p" onClick={handleComment}
                    disabled={!comment.trim() || submittingComment}>
                    {submittingComment ? 'SAVING' : 'LOG TO AUDIT TRAIL + ANCHOR ON-CHAIN'}
                  </button>
                  <div className="divider" style={{ marginTop: 20 }}/>
                  <div style={{ fontSize: 10, color: 'var(--mut)', letterSpacing: '.1em', marginBottom: 12 }}>TEMPLATES</div>
                  {[
                    'Emission factor updated per [source] from [old] to [new] kgCO2e/[unit]. All affected records recalculated.',
                    'Data gap for [period] — estimated using [methodology]. Evidence: [reference].',
                    'Scope 3 Cat [X] excluded — materiality threshold not met (< 1% of total). Documented per GHG Protocol.',
                    'Third-party data received from [supplier] for Scope 3 Cat 1. Factor: [X] kgCO2e/[unit].',
                    'Correction: [activity] on [date] had data entry error. Original: [X], Corrected: [Y]. Evidence: [ref].',
                  ].map((t, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--brd)22' }}>
                      <span style={{ fontSize: 11, color: 'var(--mut)', flex: 1, lineHeight: 1.5 }}>{t}</span>
                      <button className="btn btn-g btn-xs" style={{ marginLeft: 10, flexShrink: 0 }}
                        onClick={() => setComment(t)}>USE</button>
                    </div>
                  ))}
                </div>
              )}

              {/* ── CHAIN INTEGRITY TAB ──────────────────────────────────── */}
              {tab === 'chain' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="at-card">
                    <div className="at-ctit">BLOCKCHAIN INTEGRITY VERIFICATION</div>
                    <div style={{ fontSize: 11, color: 'var(--mut)', marginBottom: 14, lineHeight: 1.7 }}>
                      Runs two checks simultaneously: DB hash chain and on-chain contract state.
                      Anyone can independently verify by calling verifyChain() on the contract.
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                      <button className="btn btn-p" onClick={verifyChain}>RUN INTEGRITY CHECK</button>
                      {chainStatus?.ready && (
                        <a href={`${CHAIN.explorerAddr}/${process.env.REACT_APP_AUDIT_CONTRACT_ADDRESS || ''}`}
                          target="_blank" rel="noreferrer"
                          className="btn btn-eth" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          ⬡ VIEW CONTRACT ON ETHERSCAN
                        </a>
                      )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 20 }}>
                      {[
                        { label: 'DB ENTRIES', val: entries.length,  color: 'var(--grn)' },
                        { label: 'ON-CHAIN',   val: confirmedCount,  color: CHAIN.color },
                        { label: 'COVERAGE',   val: `${coveragePct}%`, color: coveragePct === 100 ? 'var(--grn)' : coveragePct > 80 ? '#f59e0b' : '#ef4444' },
                      ].map(({ label, val, color }) => (
                        <div key={label} style={{ background: '#080c10', borderRadius: 8, padding: 12, border: '1px solid var(--brd)', textAlign: 'center' }}>
                          <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 20, fontWeight: 800, color, marginBottom: 4 }}>{val}</div>
                          <div style={{ fontSize: 10, color: 'var(--mut)', letterSpacing: '.08em' }}>{label}</div>
                        </div>
                      ))}
                    </div>
                    {entries.slice(0, 8).map((e, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--brd)22' }}>
                        <div style={{ flexShrink: 0 }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 4,
                            background: e.chain_status === 'confirmed' ? '#10b981' : e.chain_status === 'failed' ? '#ef4444' : '#f59e0b' }}/>
                          {i < 7 && <div style={{ width: 2, height: 28, background: 'var(--brd)', margin: '2px auto' }}/>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 10, color: ACTION_COLORS[e.action] || '#5a7a8a', fontWeight: 700 }}>{e.action}</span>
                            <span style={{ fontSize: 10, color: 'var(--mut)' }}>{fmtDate(e.created_at)}</span>
                            {e.chain_status === 'confirmed' && e.tx_hash && (
                              <a href={`${CHAIN.explorerTx}/${e.tx_hash}`} target="_blank" rel="noreferrer" className="etherscan-link">
                                ⬡ {truncTx(e.tx_hash)} ↗
                              </a>
                            )}
                            {e.chain_status === 'failed' && (
                              <span style={{ fontSize: 9, color: '#ef4444' }}>⚠ {e.chain_error?.slice(0, 50)}</span>
                            )}
                          </div>
                          <div style={{ fontSize: 9, fontFamily: 'Space Mono', color: 'var(--mut)', wordBreak: 'break-all' }}>
                            <span style={{ color: '#10b98144' }}>HASH:</span> {e.hash || '—'}
                          </div>
                        </div>
                      </div>
                    ))}
                    {entries.length > 8 && (
                      <div style={{ fontSize: 11, color: 'var(--mut)', textAlign: 'center', paddingTop: 8 }}>
                        {entries.length - 8} more entries. Export CSV for full chain with all tx hashes.
                      </div>
                    )}
                  </div>

                  <div className="at-card">
                    <div className="at-ctit">HOW THE BLOCKCHAIN AUDIT TRAIL WORKS</div>
                    {[
                      ['Server-side SHA-256',       'Each entry hashed in Node.js — same result as browser crypto.subtle'],
                      ['Hash chain linkage',         "Every entry stores the previous entry's hash — immutable linked list"],
                      ['On-chain anchoring',         `Every entry is a real ${CHAIN.label} transaction via relayer wallet`],
                      ['Etherscan verification',     "Anyone can open any entry's tx hash on Etherscan — no trust required"],
                      ['Contract verifyChain()',     'Public read function — verifiers call it directly, no login needed'],
                      ['Postgres fallback',          'If chain is down, entries saved with chain_status=pending for retry'],
                      ['Lock on-chain',              'Inventory lock writes a lockInventory() tx — permanent, uneditable'],
                      ['Polygon migration',          'Same contract, redeploy to Polygon Mainnet — gas drops to fractions'],
                    ].map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--brd)22', fontSize: 11 }}>
                        <span style={{ color: 'var(--grn)' }}>✓ {k}</span>
                        <span style={{ color: 'var(--mut)', textAlign: 'right', maxWidth: '60%' }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}