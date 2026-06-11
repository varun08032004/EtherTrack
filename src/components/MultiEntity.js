// src/components/MultiEntity.jsx
// Multi-entity GHG consolidation — Phase 3
// ── Security & correctness fixes:
//    window.confirm replaced with inline modal — non-blocking
//    Optimistic delete rollback on failure
//    CSV export fixed (was generating stub data) + blob URL revoked
//    Abort controller on load
//    equity_pct validated 0–100 client-side
//    Email validated before invite
//    Entity count shown so user knows they're approaching cap
//    submitting flag prevents double-submit on all forms

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../services/api';

const fmt = (n, d = 2) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });

const sanitise = (str = '', max = 200) =>
  String(str).replace(/<[^>]*>/g, '').replace(/['"`;]/g, '').trim().slice(0, max);

const safeEmail = (val) => {
  const e = String(val || '').toLowerCase().trim().slice(0, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
};

const safeEquity = (val) => {
  const n = parseFloat(val);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
};

const CONSOLIDATION_METHODS = [
  { id: 'operational', label: 'Operational Control', desc: 'Include 100% of emissions from operations you have operational control over. Most common for BRSR/GHG Protocol.', color: '#10b981' },
  { id: 'financial',   label: 'Financial Control',   desc: 'Include 100% of emissions where you have financial control (majority shareholder / ability to direct policies).', color: '#3b82f6' },
  { id: 'equity',      label: 'Equity Share',         desc: 'Include emissions proportional to your equity share in each entity. Required for some CDP / IFRS S2 disclosures.', color: '#a855f7' },
];

const ENTITY_TYPES = [
  'Wholly-owned Subsidiary', 'Majority-owned Subsidiary (>50%)',
  'Joint Venture', 'Associate Company', 'Branch Office',
  'Project Site', 'Leased Facility', 'Parent Company',
];

const ROLES = [
  { id: 'admin',    label: 'Admin',    desc: 'Full access — manage entities, users, data, exports', color: '#ef4444' },
  { id: 'editor',   label: 'Editor',   desc: 'Log emissions, edit records, manage BRSR data',      color: '#f97316' },
  { id: 'verifier', label: 'Verifier', desc: 'Read-only + audit trail + sign-off capability',      color: '#a855f7' },
  { id: 'viewer',   label: 'Viewer',   desc: 'Read-only access to reports and dashboards',         color: '#3b82f6' },
];

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap');
:root{--bg:#060809;--surf:#0e1318;--brd:#1e3040;--brd2:#2e3d50;--txt:#f0f6ff;--mut:#5a7a8a;--grn:#10b981;--red:#ef4444;--ylw:#f59e0b;--s2:#3b82f6;--pur:#a855f7;--org:#f97316;}
.me{min-height:100vh;background:var(--bg);font-family:'Space Mono',monospace;color:var(--txt);}
.me-in{max-width:1300px;margin:0 auto;padding:28px 24px;}
.me-hd{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:22px;padding-bottom:16px;border-bottom:1px solid var(--brd);}
.me-label{font-size:10px;letter-spacing:.18em;color:var(--mut);}
.me-title{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;margin-top:3px;}
.me-title span{color:var(--grn);}
.me-card{background:var(--surf);border:1px solid var(--brd);border-radius:10px;padding:18px 20px;margin-bottom:12px;animation:fU .4s ease both;}
.me-ctit{font-size:10px;letter-spacing:.14em;color:var(--mut);margin-bottom:14px;display:flex;align-items:center;gap:8px;}
.me-ctit::before{content:'';width:10px;height:1px;background:var(--grn);}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}
.g4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}
.me-fg{display:flex;flex-direction:column;gap:5px;margin-bottom:10px;}
.me-lbl{font-size:10px;letter-spacing:.1em;color:var(--mut);}
.me-inp,.me-sel{padding:9px 11px;border-radius:6px;background:#080c10;border:1px solid var(--brd);color:var(--txt);font-family:'Space Mono',monospace;font-size:12px;outline:none;transition:border-color .2s;width:100%;box-sizing:border-box;}
.me-inp:focus,.me-sel:focus{border-color:#10b98144;}
.me-inp::placeholder{color:var(--mut);opacity:.7;}
.btn{padding:9px 17px;border-radius:6px;border:none;cursor:pointer;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.1em;font-weight:700;transition:all .2s;}
.btn:disabled{opacity:.5;cursor:not-allowed;}
.btn-p{background:linear-gradient(135deg,#10b981,#059669);color:#fff;}
.btn-p:hover:not(:disabled){opacity:.85;transform:translateY(-1px);}
.btn-g{background:var(--surf);border:1px solid var(--brd2);color:var(--txt);}
.btn-g:hover:not(:disabled){border-color:#10b98144;color:var(--grn);}
.btn-sm{padding:6px 12px;font-size:10px;}
.btn-xs{padding:4px 8px;font-size:9px;}
.btn-danger-xs{background:#ef444414;color:#ef4444;border:1px solid #ef444433;}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;}
.stat-tile{background:#080c10;border-radius:8px;padding:14px;border:1px solid var(--brd);}
.stat-val{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;margin-bottom:2px;}
.stat-lbl{font-size:10px;color:var(--mut);letter-spacing:.08em;}
.stat-sub{font-size:10px;color:var(--mut);margin-top:2px;}
.me-tabs{display:flex;gap:0;margin-bottom:18px;border-bottom:1px solid var(--brd);}
.me-tab{padding:9px 15px;font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.08em;cursor:pointer;border:none;background:none;color:var(--mut);border-bottom:2px solid transparent;transition:all .2s;margin-bottom:-1px;}
.me-tab.on{color:var(--grn);border-bottom-color:var(--grn);}
.entity-grid{display:flex;flex-direction:column;gap:10px;}
.entity-card{border-radius:10px;border:1px solid var(--brd);background:var(--surf);overflow:hidden;transition:border-color .2s;}
.entity-card.included{border-color:#10b98133;}
.entity-card.excluded{border-color:#ef444422;opacity:.7;}
.entity-hd{display:grid;grid-template-columns:1fr auto auto auto auto;gap:12px;align-items:center;padding:14px 16px;}
.entity-body{padding:0 16px 14px;}
.entity-emissions{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:10px;}
.entity-em-tile{background:#080c10;border-radius:6px;padding:10px;border:1px solid var(--brd);}
.entity-em-val{font-size:14px;font-weight:700;font-family:'Syne',sans-serif;}
.entity-em-lbl{font-size:9px;color:var(--mut);margin-top:2px;}
.cm-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px;}
.cm-opt{padding:14px;border-radius:8px;border:1px solid var(--brd);cursor:pointer;transition:all .2s;background:var(--bg);}
.cm-opt.sel{border-color:var(--ac);}
.rollup-bar{height:8px;border-radius:4px;background:var(--brd);overflow:hidden;margin:6px 0;display:flex;}
.scope-bar-wrap{margin:8px 0;}
.scope-bar-row{display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:11px;}
.scope-bar-track{flex:1;height:4px;background:var(--brd);border-radius:2px;overflow:hidden;}
.scope-bar-fill{height:100%;border-radius:2px;}
.user-row{display:grid;grid-template-columns:1fr 120px 120px 80px;gap:8px;align-items:center;padding:10px 0;border-bottom:1px solid var(--brd)22;font-size:12px;}
.pill{display:inline-flex;align-items:center;gap:4px;font-size:10px;padding:3px 9px;border-radius:3px;letter-spacing:.05em;}
.pill-grn{background:#10b98114;color:#10b981;border:1px solid #10b98133;}
.pill-ylw{background:#f59e0b14;color:#f59e0b;border:1px solid #f59e0b33;}
.pill-red{background:#ef444414;color:#ef4444;border:1px solid #ef444433;}
.pill-pur{background:#a855f714;color:#a855f7;border:1px solid #a855f733;}
.pill-blu{background:#3b82f614;color:#3b82f6;border:1px solid #3b82f633;}
.pill-org{background:#f9731614;color:#f97316;border:1px solid #f9731633;}
.me-alert{padding:10px 14px;border-radius:7px;font-size:11px;display:flex;gap:8px;margin-bottom:12px;line-height:1.6;}
.al-g{background:#10b98108;border:1px solid #10b98133;color:var(--grn);}
.al-y{background:#f59e0b08;border:1px solid #f59e0b33;color:var(--ylw);}
.divider{height:1px;background:var(--brd);margin:14px 0;}
.notif{position:fixed;top:76px;right:24px;z-index:9999;padding:11px 18px;border-radius:8px;font-family:'Space Mono',monospace;font-size:11px;box-shadow:0 8px 32px #00000066;animation:fU .3s ease;}
.notif-ok{background:#0b2a1e;border:1px solid #10b98133;color:#10b981;}
.notif-err{background:#450a0a;border:1px solid #ef444433;color:#f87171;}
.confirm-overlay{position:fixed;inset:0;z-index:1000;background:#00000088;display:flex;align-items:center;justify-content:center;}
.confirm-box{background:var(--surf);border:1px solid var(--brd2);border-radius:10px;padding:24px;max-width:340px;width:90%;}
@keyframes fU{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:1000px){.stats,.g4,.entity-emissions{grid-template-columns:1fr 1fr;}.cm-grid{grid-template-columns:1fr;}}
@media(max-width:700px){.g2,.g3{grid-template-columns:1fr;}.entity-hd{grid-template-columns:1fr auto;}}
`;

const defEntity = () => ({
  name: '', type: 'Wholly-owned Subsidiary', cin: '', gstin: '',
  equity_pct: 100, operational_control: true, financial_control: true,
  included: true, country: 'India', industry: '', employees: '', revenue_cr: '', notes: '',
});

const defUser = () => ({ name: '', email: '', role: 'viewer', entity: 'all' });

export default function MultiEntity({ profile, year }) {
  const [tab,            setTab]           = useState('entities');
  const [entities,       setEntities]      = useState([]);
  const [users,          setUsers]         = useState([]);
  const [method,         setMethod]        = useState('operational');
  const [entityEmissions,setEntityEmissions]= useState({});
  const [loading,        setLoading]       = useState(true);
  const [notif,          setNotif]         = useState(null);
  const [showAddEntity,  setShowAddEntity] = useState(false);
  const [showAddUser,    setShowAddUser]   = useState(false);
  const [eform,          setEform]         = useState(defEntity());
  const [uform,          setUform]         = useState(defUser());
  const [saving,         setSaving]        = useState(false);
  const [expandedEntity, setExpandedEntity]= useState(null);
  // Inline delete confirm — replaces blocking window.confirm
  const [deleteConfirm,  setDeleteConfirm] = useState(null); // { id, name, type: 'entity'|'user' }

  const abortRef = useRef(null);
  const toast = (msg, type = 'ok') => { setNotif({ msg, type }); setTimeout(() => setNotif(null), 3800); };

  // ── Load with abort controller ─────────────────────────────────────
  const load = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;

    setLoading(true);
    try {
      const [entRes, userRes] = await Promise.all([
        apiFetch('/api/entities',       { signal: ctl.signal }).catch(() => null),
        apiFetch('/api/entities/users', { signal: ctl.signal }).catch(() => null),
      ]);
      if (ctl.signal.aborted) return;
      if (entRes?.entities) setEntities(entRes.entities);
      if (userRes?.users)   setUsers(userRes.users);

      if (entRes?.entities?.length) {
        const emPromises = entRes.entities.map(e =>
          apiFetch(`/api/emissions/summary?year=${year}&entity_id=${e.id}`, { signal: ctl.signal })
            .then(d => ({ id: e.id, s1: d?.scope1 || 0, s2: d?.scope2 || 0, s3: d?.scope3 || 0 }))
            .catch(() => ({ id: e.id, s1: 0, s2: 0, s3: 0 }))
        );
        const results = await Promise.all(emPromises);
        if (ctl.signal.aborted) return;
        const map = {};
        results.forEach(r => { map[r.id] = r; });
        setEntityEmissions(map);
      }
    } catch (e) {
      if (e.name !== 'AbortError') toast('Failed to load entities', 'err');
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, [year]);

  useEffect(() => { load(); return () => { abortRef.current?.abort(); }; }, [load]);

  // ── Consolidation ──────────────────────────────────────────────────
  const includedEntities = entities.filter(e => e.included !== false);

  const consolidate = (entityId, scope) => {
    const em  = entityEmissions[entityId] || { s1: 0, s2: 0, s3: 0 };
    const ent = entities.find(e => e.id === entityId);
    if (!ent) return 0;
    const raw = scope === 1 ? em.s1 : scope === 2 ? em.s2 : em.s3;
    if (method === 'equity')    return raw * (safeEquity(ent.equity_pct) ?? 100) / 100;
    if (method === 'financial') return ent.financial_control !== false ? raw : 0;
    return ent.operational_control !== false ? raw : 0; // operational (default)
  };

  const totalS1    = includedEntities.reduce((s, e) => s + consolidate(e.id, 1), 0);
  const totalS2    = includedEntities.reduce((s, e) => s + consolidate(e.id, 2), 0);
  const totalS3    = includedEntities.reduce((s, e) => s + consolidate(e.id, 3), 0);
  const grandTotal = totalS1 + totalS2 + totalS3;

  // ── Add entity — validated ─────────────────────────────────────────
  const handleAddEntity = async (ev) => {
    ev.preventDefault();
    if (saving) return;

    const cleanName   = sanitise(eform.name, 200);
    if (!cleanName) { toast('Entity name is required', 'err'); return; }

    const cleanEquity = safeEquity(eform.equity_pct);
    if (cleanEquity === null) { toast('Equity % must be between 0 and 100', 'err'); return; }

    const cleanType  = ENTITY_TYPES.includes(eform.type) ? eform.type : 'Wholly-owned Subsidiary';
    const cleanCin   = String(eform.cin   || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 21);
    const cleanGstin = String(eform.gstin || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);

    if (entities.length >= 100) { toast('Maximum 100 entities per account', 'err'); return; }

    setSaving(true);
    try {
      const res = await apiFetch('/api/entities', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cleanName, type: cleanType, cin: cleanCin || null, gstin: cleanGstin || null,
          equity_pct: cleanEquity,
          operational_control: Boolean(eform.operational_control),
          financial_control:   Boolean(eform.financial_control),
          included:            Boolean(eform.included),
          country:  sanitise(eform.country, 100) || 'India',
          industry: sanitise(eform.industry, 100) || null,
          employees: parseInt(eform.employees, 10) || null,
          revenue_cr: parseFloat(eform.revenue_cr) || null,
          notes: sanitise(eform.notes, 500) || null,
        }),
      });
      if (res?.entity) {
        setEntities(prev => [...prev, res.entity]);
        setEntityEmissions(prev => ({ ...prev, [res.entity.id]: { s1: 0, s2: 0, s3: 0 } }));
        setEform(defEntity());
        setShowAddEntity(false);
        toast(`✓ ${res.entity.name} added to group`);
      }
    } catch { toast('Failed to add entity. Please try again.', 'err'); }
    finally { setSaving(false); }
  };

  // ── Toggle entity inclusion — optimistic ───────────────────────────
  const toggleInclude = async (entityId, included) => {
    const prev = entities.find(e => e.id === entityId);
    setEntities(ents => ents.map(e => e.id === entityId ? { ...e, included } : e));
    try {
      await apiFetch(`/api/entities/${entityId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ included }),
      });
    } catch {
      // Rollback on failure
      if (prev) setEntities(ents => ents.map(e => e.id === entityId ? prev : e));
      toast('Failed to update entity', 'err');
    }
  };

  // ── Delete entity — inline confirm + optimistic rollback ───────────
  const handleDeleteEntityRequest = (id, name) => setDeleteConfirm({ id, name, type: 'entity' });
  const handleDeleteUserRequest   = (id, name) => setDeleteConfirm({ id, name, type: 'user'   });

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm) return;
    const { id, name, type } = deleteConfirm;
    setDeleteConfirm(null);

    if (type === 'entity') {
      const rollback = entities.find(e => e.id === id);
      setEntities(prev => prev.filter(e => e.id !== id));
      try {
        await apiFetch(`/api/entities/${id}`, { method: 'DELETE' });
        toast(`${name} removed from group`);
      } catch {
        if (rollback) setEntities(prev => [...prev, rollback]);
        toast('Failed to remove entity', 'err');
      }
    } else {
      const rollback = users.find(u => u.id === id);
      setUsers(prev => prev.filter(u => u.id !== id));
      try {
        await apiFetch(`/api/entities/users/${id}`, { method: 'DELETE' });
        toast(`${name} removed`);
      } catch {
        if (rollback) setUsers(prev => [...prev, rollback]);
        toast('Failed to remove user', 'err');
      }
    }
  };

  // ── Invite user — validated ────────────────────────────────────────
  const handleInviteUser = async (ev) => {
    ev.preventDefault();
    if (saving) return;

    const cleanName  = sanitise(uform.name, 200);
    const cleanEmail = safeEmail(uform.email);
    const cleanRole  = ROLES.map(r => r.id).includes(uform.role) ? uform.role : 'viewer';

    if (!cleanName)  { toast('Name is required', 'err');              return; }
    if (!cleanEmail) { toast('Valid email address is required', 'err'); return; }
    if (users.length >= 50) { toast('Maximum 50 users per account', 'err'); return; }

    setSaving(true);
    try {
      const res = await apiFetch('/api/entities/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cleanName, email: cleanEmail, role: cleanRole, entity: uform.entity }),
      });
      if (res?.user) {
        setUsers(prev => [...prev, res.user]);
        setUform(defUser());
        setShowAddUser(false);
        toast(`✓ ${res.user.name} invited as ${cleanRole}`);
      }
    } catch (e) {
      toast(e?.message?.includes('409') ? 'This email has already been invited' : 'Failed to invite user', 'err');
    } finally { setSaving(false); }
  };

  // ── Update user role — optimistic ──────────────────────────────────
  const updateUserRole = async (userId, role) => {
    if (!ROLES.map(r => r.id).includes(role)) return;
    const prev = users.find(u => u.id === userId);
    setUsers(ents => ents.map(u => u.id === userId ? { ...u, role } : u));
    try {
      await apiFetch(`/api/entities/users/${userId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      toast('✓ Role updated');
    } catch {
      if (prev) setUsers(ents => ents.map(u => u.id === userId ? prev : u));
      toast('Failed to update role', 'err');
    }
  };

  // ── CSV Export — FIXED: uses actual entity emission data + blob revoke ──
  const handleExportCSV = () => {
    const rows = [
      'Entity,Type,Equity%,S1 tCO2e,S2 tCO2e,S3 tCO2e,Total tCO2e,Included,CIN,Revenue ₹Cr',
      ...entities.map(e => {
        const a1 = consolidate(e.id, 1);
        const a2 = consolidate(e.id, 2);
        const a3 = consolidate(e.id, 3);
        return [
          `"${sanitise(e.name)}"`,
          `"${e.type}"`,
          e.equity_pct || 100,
          a1.toFixed(3), a2.toFixed(3), a3.toFixed(3),
          (a1 + a2 + a3).toFixed(3),
          e.included !== false,
          e.cin || '—',
          e.revenue_cr || '—',
        ].join(',');
      }),
      // Consolidated totals row
      `"CONSOLIDATED TOTAL","${CONSOLIDATION_METHODS.find(m => m.id === method)?.label}",,${totalS1.toFixed(3)},${totalS2.toFixed(3)},${totalS3.toFixed(3)},${grandTotal.toFixed(3)},,,`,
    ].join('\n');

    const url = URL.createObjectURL(new Blob([rows], { type: 'text/csv' }));
    const a   = document.createElement('a');
    a.href    = url;
    a.download = `ethertrack_consolidated_ghg_fy${year}_${method}.csv`;
    a.click();
    // Revoke to prevent memory leak
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast('✓ Consolidated GHG exported');
  };

  const rolePill = (role) => {
    const cls = { admin: 'pill-red', editor: 'pill-org', verifier: 'pill-pur', viewer: 'pill-blu' };
    return <span className={`pill ${cls[role] || 'pill-ylw'}`}>{(role || '—').toUpperCase()}</span>;
  };

  // ─────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{CSS}</style>

      {/* ── Inline delete confirm modal ── */}
      {deleteConfirm && (
        <div className="confirm-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="confirm-box" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 13, marginBottom: 6, color: 'var(--txt)' }}>
              Remove <strong>{deleteConfirm.name}</strong>?
            </div>
            <div style={{ fontSize: 11, color: 'var(--mut)', marginBottom: 16 }}>
              {deleteConfirm.type === 'entity'
                ? 'Emission data will not be deleted — only the entity record.'
                : 'Their access will be revoked immediately.'}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-danger-xs btn-sm" style={{ flex: 1 }} onClick={handleDeleteConfirm}>REMOVE</button>
              <button className="btn btn-g btn-sm" style={{ flex: 1 }} onClick={() => setDeleteConfirm(null)}>CANCEL</button>
            </div>
          </div>
        </div>
      )}

      {notif && <div className={`notif notif-${notif.type}`}>{notif.msg}</div>}

      <div className="me">
        <div className="me-in">

          {/* ── Header ──────────────────────────────────────────────── */}
          <div className="me-hd">
            <div>
              <div className="me-label">GHG PROTOCOL · ORGANISATIONAL BOUNDARY · CONSOLIDATION · RBAC</div>
              <div className="me-title">Multi-Entity <span>Consolidation</span></div>
              <div style={{ fontSize: 10, color: 'var(--mut)', marginTop: 2 }}>
                Subsidiaries · JVs · Branch offices · Equity share rollup · Role-based access
                {profile?.company_name && ` · Parent: ${profile.company_name}`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-p btn-sm" onClick={() => setShowAddEntity(true)}>+ ADD ENTITY</button>
              <button className="btn btn-g btn-sm" onClick={() => setTab('rbac')}>MANAGE USERS</button>
            </div>
          </div>

          {/* ── Consolidated stats ───────────────────────────────────── */}
          <div className="stats">
            {[
              { label: 'ENTITIES IN GROUP',    val: entities.length,         sub: `${includedEntities.length} in boundary · max 100`, color: '#10b981' },
              { label: 'CONSOLIDATED SCOPE 1', val: `${fmt(totalS1)} t`,     sub: 'tCO₂e — direct',   color: '#f97316' },
              { label: 'CONSOLIDATED SCOPE 2', val: `${fmt(totalS2)} t`,     sub: 'tCO₂e — energy',   color: '#3b82f6' },
              { label: 'CONSOLIDATED TOTAL',   val: `${fmt(grandTotal)} t`,  sub: 'tCO₂e all scopes', color: grandTotal > 0 ? '#10b981' : '#5a7a8a' },
            ].map(({ label, val, sub, color }) => (
              <div key={label} className="stat-tile">
                <div className="stat-lbl">{label}</div>
                <div className="stat-val" style={{ color }}>{val}</div>
                <div className="stat-sub">{sub}</div>
              </div>
            ))}
          </div>

          {/* ── Consolidated rollup bar ──────────────────────────────── */}
          {grandTotal > 0 && (
            <div className="me-card" style={{ padding: '14px 18px', marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--mut)', marginBottom: 8 }}>
                <span>CONSOLIDATED GHG — {CONSOLIDATION_METHODS.find(m => m.id === method)?.label.toUpperCase()}</span>
                <span style={{ color: 'var(--grn)', fontWeight: 700 }}>{fmt(grandTotal)} tCO₂e total</span>
              </div>
              <div className="rollup-bar">
                <div style={{ width: `${grandTotal > 0 ? totalS1 / grandTotal * 100 : 0}%`, background: '#f97316' }}/>
                <div style={{ width: `${grandTotal > 0 ? totalS2 / grandTotal * 100 : 0}%`, background: '#3b82f6' }}/>
                <div style={{ flex: 1, background: '#a855f7' }}/>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 10, color: 'var(--mut)' }}>
                <span style={{ color: '#f97316' }}>S1: {fmt(totalS1)} t ({fmt(grandTotal > 0 ? totalS1 / grandTotal * 100 : 0, 1)}%)</span>
                <span style={{ color: '#3b82f6' }}>S2: {fmt(totalS2)} t ({fmt(grandTotal > 0 ? totalS2 / grandTotal * 100 : 0, 1)}%)</span>
                <span style={{ color: '#a855f7' }}>S3: {fmt(totalS3)} t ({fmt(grandTotal > 0 ? totalS3 / grandTotal * 100 : 0, 1)}%)</span>
              </div>
            </div>
          )}

          {/* ── Tabs ─────────────────────────────────────────────────── */}
          <div className="me-tabs">
            {[
              ['entities',      'ENTITIES'],
              ['consolidation', 'CONSOLIDATION METHOD'],
              ['rollup',        'ROLLUP TABLE'],
              ['rbac',          `USERS & ACCESS (${users.length})`],
            ].map(([k, v]) => (
              <button key={k} className={`me-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{v}</button>
            ))}
          </div>

          {loading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--mut)', fontSize: 11 }}>LOADING ENTITIES…</div>}

          {!loading && (
            <>
              {/* ══ ENTITIES TAB ════════════════════════════════════════ */}
              {tab === 'entities' && (
                <div>
                  {showAddEntity && (
                    <div className="me-card" style={{ border: '1px solid #10b98133', marginBottom: 14 }}>
                      <div className="me-ctit">ADD ENTITY TO GROUP</div>
                      <form onSubmit={handleAddEntity}>
                        <div className="g3">
                          <div className="me-fg">
                            <label className="me-lbl">ENTITY NAME</label>
                            <input className="me-inp" type="text" maxLength={200} placeholder="e.g. Acme Logistics Pvt Ltd" required
                              value={eform.name} onChange={e => setEform(f => ({ ...f, name: e.target.value }))}/>
                          </div>
                          <div className="me-fg">
                            <label className="me-lbl">ENTITY TYPE</label>
                            <select className="me-sel" value={eform.type} onChange={e => setEform(f => ({ ...f, type: e.target.value }))}>
                              {ENTITY_TYPES.map(t => <option key={t}>{t}</option>)}
                            </select>
                          </div>
                          <div className="me-fg">
                            <label className="me-lbl">EQUITY SHARE (0–100%)</label>
                            <input className="me-inp" type="number" min="0" max="100" step="0.01"
                              value={eform.equity_pct}
                              onChange={e => setEform(f => ({ ...f, equity_pct: parseFloat(e.target.value) }))}/>
                          </div>
                        </div>
                        <div className="g3">
                          <div className="me-fg">
                            <label className="me-lbl">CIN (optional)</label>
                            <input className="me-inp" type="text" maxLength={21} placeholder="U72900MH2020PTC340021"
                              value={eform.cin} onChange={e => setEform(f => ({ ...f, cin: e.target.value.toUpperCase() }))}/>
                          </div>
                          <div className="me-fg">
                            <label className="me-lbl">GSTIN (optional)</label>
                            <input className="me-inp" type="text" maxLength={15} placeholder="27AAPFU0939F1ZV"
                              value={eform.gstin} onChange={e => setEform(f => ({ ...f, gstin: e.target.value.toUpperCase() }))}/>
                          </div>
                          <div className="me-fg">
                            <label className="me-lbl">ANNUAL REVENUE (₹ Cr)</label>
                            <input className="me-inp" type="number" step="0.1" min="0" max="100000000" placeholder="0"
                              value={eform.revenue_cr} onChange={e => setEform(f => ({ ...f, revenue_cr: e.target.value }))}/>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
                          {[
                            ['operational_control', 'Operational control'],
                            ['financial_control',   'Financial control'],
                            ['included',            'Include in boundary'],
                          ].map(([field, label]) => (
                            <label key={field} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                              <input type="checkbox" checked={Boolean(eform[field])}
                                onChange={e => setEform(f => ({ ...f, [field]: e.target.checked }))}
                                style={{ accentColor: 'var(--grn)' }}/>
                              {label}
                            </label>
                          ))}
                        </div>
                        <div className="me-fg">
                          <label className="me-lbl">NOTES</label>
                          <input className="me-inp" type="text" maxLength={500}
                            placeholder="e.g. Acquired Jan 2024 — full year included"
                            value={eform.notes} onChange={e => setEform(f => ({ ...f, notes: e.target.value }))}/>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button type="submit" className="btn btn-p" disabled={saving}>{saving ? 'ADDING…' : 'ADD ENTITY →'}</button>
                          <button type="button" className="btn btn-g" onClick={() => setShowAddEntity(false)}>CANCEL</button>
                        </div>
                      </form>
                    </div>
                  )}

                  {entities.length === 0 ? (
                    <div className="me-card" style={{ textAlign: 'center', padding: 40 }}>
                      <div style={{ fontSize: 32, marginBottom: 12 }}>🏢</div>
                      <div style={{ fontSize: 13, color: 'var(--txt)', marginBottom: 6 }}>No entities in group yet</div>
                      <div style={{ fontSize: 11, color: 'var(--mut)', marginBottom: 16, lineHeight: 1.7 }}>
                        Add subsidiaries, JVs, and branch offices to track consolidated GHG emissions across your corporate group per GHG Protocol organisational boundary requirements.
                      </div>
                      <button className="btn btn-p" onClick={() => setShowAddEntity(true)}>+ ADD FIRST ENTITY →</button>
                    </div>
                  ) : (
                    <div className="entity-grid">
                      {entities.map(entity => {
                        const em       = entityEmissions[entity.id] || { s1: 0, s2: 0, s3: 0 };
                        const total    = em.s1 + em.s2 + em.s3;
                        const adj1     = consolidate(entity.id, 1);
                        const adj2     = consolidate(entity.id, 2);
                        const adj3     = consolidate(entity.id, 3);
                        const adjTotal = adj1 + adj2 + adj3;
                        const isExpanded = expandedEntity === entity.id;
                        const included   = entity.included !== false;

                        return (
                          <div key={entity.id} className={`entity-card ${included ? 'included' : 'excluded'}`}>
                            <div className="entity-hd">
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 700 }}>{entity.name}</div>
                                <div style={{ fontSize: 10, color: 'var(--mut)', marginTop: 2 }}>
                                  {entity.type}
                                  {entity.cin && <span style={{ marginLeft: 8, fontSize: 9 }}>CIN: {entity.cin}</span>}
                                </div>
                              </div>
                              <span className={`pill ${included ? 'pill-grn' : 'pill-red'}`}>{included ? 'IN BOUNDARY' : 'EXCLUDED'}</span>
                              <span style={{ fontSize: 11, color: 'var(--mut)' }}>{entity.equity_pct || 100}% equity</span>
                              <span style={{ fontSize: 13, fontWeight: 700, color: adjTotal > 0 ? '#10b981' : 'var(--mut)' }}>
                                {fmt(adjTotal)} t
                              </span>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button className="btn btn-g btn-xs" onClick={() => setExpandedEntity(isExpanded ? null : entity.id)}>
                                  {isExpanded ? 'HIDE' : 'DETAIL'}
                                </button>
                                <button className="btn btn-g btn-xs" onClick={() => toggleInclude(entity.id, !included)}>
                                  {included ? 'EXCLUDE' : 'INCLUDE'}
                                </button>
                                <button className="btn btn-xs btn-danger-xs" onClick={() => handleDeleteEntityRequest(entity.id, entity.name)}>✕</button>
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="entity-body">
                                <div className="divider" style={{ marginTop: 0 }}/>
                                <div className="entity-emissions">
                                  {[
                                    { label: 'SCOPE 1', adj: adj1, color: '#f97316' },
                                    { label: 'SCOPE 2', adj: adj2, color: '#3b82f6' },
                                    { label: 'SCOPE 3', adj: adj3, color: '#a855f7' },
                                    { label: 'TOTAL',   adj: adjTotal, color: '#10b981' },
                                  ].map(({ label, adj, color }) => (
                                    <div key={label} className="entity-em-tile">
                                      <div className="entity-em-lbl">{label}</div>
                                      <div className="entity-em-val" style={{ color }}>{fmt(adj)} t</div>
                                      {method === 'equity' && (entity.equity_pct || 100) < 100 && (
                                        <div style={{ fontSize: 9, color: 'var(--mut)', marginTop: 2 }}>
                                          {entity.equity_pct}% of raw
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                                {total > 0 && (
                                  <div className="scope-bar-wrap">
                                    {[{ label: 'S1', val: adj1, color: '#f97316' }, { label: 'S2', val: adj2, color: '#3b82f6' }, { label: 'S3', val: adj3, color: '#a855f7' }].map(({ label, val, color }) => (
                                      <div key={label} className="scope-bar-row">
                                        <span style={{ width: 24, color: 'var(--mut)', fontSize: 10 }}>{label}</span>
                                        <div className="scope-bar-track">
                                          <div className="scope-bar-fill" style={{ width: `${adjTotal > 0 ? val / adjTotal * 100 : 0}%`, background: color }}/>
                                        </div>
                                        <span style={{ width: 60, textAlign: 'right', color, fontSize: 10 }}>{fmt(val)} t</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: 'var(--mut)', marginTop: 8 }}>
                                  {entity.gstin      && <span>GSTIN: {entity.gstin}</span>}
                                  {entity.revenue_cr && <span>Revenue: ₹{entity.revenue_cr} Cr</span>}
                                  <span>Op. control: {entity.operational_control !== false ? '✓' : '✗'}</span>
                                  <span>Fin. control: {entity.financial_control   !== false ? '✓' : '✗'}</span>
                                  {entity.notes && <span>{entity.notes}</span>}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ══ CONSOLIDATION METHOD TAB ════════════════════════════ */}
              {tab === 'consolidation' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="me-card">
                    <div className="me-ctit">SELECT CONSOLIDATION METHOD — GHG PROTOCOL CHAPTER 3</div>
                    <div className="me-alert al-y">
                      <span>ℹ</span>
                      <span>Once chosen, apply consistently across all reporting periods. BRSR Core and GHG Protocol require disclosing the method used.</span>
                    </div>
                    <div className="cm-grid">
                      {CONSOLIDATION_METHODS.map(cm => (
                        <div key={cm.id} className={`cm-opt${method === cm.id ? ' sel' : ''}`}
                          style={{ '--ac': cm.color, borderColor: method === cm.id ? cm.color : undefined, background: method === cm.id ? `${cm.color}08` : undefined }}
                          onClick={() => setMethod(cm.id)}>
                          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4, color: method === cm.id ? cm.color : 'var(--txt)' }}>
                            {method === cm.id ? '✓ ' : ''}{cm.label}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--mut)', lineHeight: 1.5 }}>{cm.desc}</div>
                        </div>
                      ))}
                    </div>

                    <div style={{ fontSize: 10, letterSpacing: '.1em', color: 'var(--mut)', marginBottom: 10 }}>
                      ENTITY IMPACT — {CONSOLIDATION_METHODS.find(m => m.id === method)?.label.toUpperCase()}
                    </div>
                    {entities.map(entity => {
                      const rawTotal = (entityEmissions[entity.id]?.s1 || 0) + (entityEmissions[entity.id]?.s2 || 0) + (entityEmissions[entity.id]?.s3 || 0);
                      const adjTotal = consolidate(entity.id, 1) + consolidate(entity.id, 2) + consolidate(entity.id, 3);
                      const pct      = rawTotal > 0 ? adjTotal / rawTotal * 100 : 0;
                      return (
                        <div key={entity.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--brd)22', fontSize: 12, alignItems: 'center' }}>
                          <div>
                            <span>{entity.name}</span>
                            <span style={{ fontSize: 10, color: 'var(--mut)', marginLeft: 8 }}>{entity.type} · {entity.equity_pct || 100}%</span>
                          </div>
                          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                            <span style={{ fontSize: 10, color: 'var(--mut)' }}>Raw: {fmt(rawTotal)} t</span>
                            <span style={{ color: '#10b981', fontWeight: 700 }}>Consolidated: {fmt(adjTotal)} t</span>
                            <span className={`pill ${pct >= 100 ? 'pill-grn' : pct > 0 ? 'pill-ylw' : 'pill-red'}`}>{fmt(pct, 0)}% incl.</span>
                          </div>
                        </div>
                      );
                    })}
                    {entities.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: 'var(--mut)', fontSize: 11 }}>Add entities to see consolidation impact.</div>}
                  </div>
                </div>
              )}

              {/* ══ ROLLUP TABLE TAB ════════════════════════════════════ */}
              {tab === 'rollup' && (
                <div className="me-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <div className="me-ctit" style={{ marginBottom: 0 }}>
                      CONSOLIDATED GHG ROLLUP — FY {year} — {CONSOLIDATION_METHODS.find(m => m.id === method)?.label}
                    </div>
                    <button className="btn btn-g btn-sm" onClick={handleExportCSV}>EXPORT CSV</button>
                  </div>

                  {/* Header */}
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 70px 90px 90px 90px 100px 80px', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--brd)', fontSize: 10, color: 'var(--mut)', letterSpacing: '.06em' }}>
                    <span>ENTITY</span><span>TYPE</span><span>EQUITY</span>
                    <span style={{ color: '#f97316' }}>SCOPE 1</span>
                    <span style={{ color: '#3b82f6' }}>SCOPE 2</span>
                    <span style={{ color: '#a855f7' }}>SCOPE 3</span>
                    <span style={{ color: '#10b981' }}>TOTAL</span>
                    <span>STATUS</span>
                  </div>

                  {entities.map(entity => {
                    const a1 = consolidate(entity.id, 1);
                    const a2 = consolidate(entity.id, 2);
                    const a3 = consolidate(entity.id, 3);
                    const aT = a1 + a2 + a3;
                    const inc = entity.included !== false;
                    return (
                      <div key={entity.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 70px 90px 90px 90px 100px 80px', gap: 8, padding: '9px 0', borderBottom: '1px solid var(--brd)22', fontSize: 12, alignItems: 'center', opacity: inc ? 1 : 0.5 }}>
                        <div>
                          <div>{entity.name}</div>
                          {entity.cin && <div style={{ fontSize: 9, color: 'var(--mut)' }}>CIN: {entity.cin}</div>}
                        </div>
                        <span style={{ fontSize: 10, color: 'var(--mut)' }}>{entity.type}</span>
                        <span style={{ color: 'var(--mut)' }}>{entity.equity_pct || 100}%</span>
                        <span style={{ color: '#f97316' }}>{fmt(a1, 3)}</span>
                        <span style={{ color: '#3b82f6' }}>{fmt(a2, 3)}</span>
                        <span style={{ color: '#a855f7' }}>{fmt(a3, 3)}</span>
                        <span style={{ color: '#10b981', fontWeight: 700 }}>{fmt(aT, 3)}</span>
                        <span className={`pill ${inc ? 'pill-grn' : 'pill-red'}`} style={{ fontSize: 9 }}>
                          {inc ? 'INCLUDED' : 'EXCLUDED'}
                        </span>
                      </div>
                    );
                  })}

                  {/* Totals row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 70px 90px 90px 90px 100px 80px', gap: 8, padding: '12px 0', borderTop: '1px solid var(--brd)', fontSize: 12, fontWeight: 700 }}>
                    <span style={{ color: 'var(--grn)' }}>CONSOLIDATED TOTAL</span>
                    <span/><span/>
                    <span style={{ color: '#f97316' }}>{fmt(totalS1, 3)}</span>
                    <span style={{ color: '#3b82f6' }}>{fmt(totalS2, 3)}</span>
                    <span style={{ color: '#a855f7' }}>{fmt(totalS3, 3)}</span>
                    <span style={{ color: '#10b981' }}>{fmt(grandTotal, 3)}</span>
                    <span/>
                  </div>

                  <div style={{ marginTop: 14, fontSize: 11, color: 'var(--mut)', lineHeight: 1.8 }}>
                    Method: <strong style={{ color: 'var(--txt)' }}>{CONSOLIDATION_METHODS.find(m => m.id === method)?.label}</strong> ·
                    FY {year} · GHG Protocol Corporate Standard — Chapter 3 Organisational Boundary
                    {entities.length - includedEntities.length > 0 && ` · ${entities.length - includedEntities.length} entities excluded.`}
                  </div>
                </div>
              )}

              {/* ══ RBAC TAB ════════════════════════════════════════════ */}
              {tab === 'rbac' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="me-card">
                    <div className="me-ctit">ROLE DEFINITIONS</div>
                    <div className="g4">
                      {ROLES.map(r => (
                        <div key={r.id} style={{ padding: 12, borderRadius: 8, border: `1px solid ${r.color}33`, background: `${r.color}06` }}>
                          <div style={{ fontWeight: 700, color: r.color, fontSize: 12, marginBottom: 4 }}>{r.label}</div>
                          <div style={{ fontSize: 10, color: 'var(--mut)', lineHeight: 1.5 }}>{r.desc}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {showAddUser && (
                    <div className="me-card" style={{ border: '1px solid #10b98133' }}>
                      <div className="me-ctit">INVITE USER</div>
                      <form onSubmit={handleInviteUser}>
                        <div className="g3">
                          <div className="me-fg">
                            <label className="me-lbl">FULL NAME</label>
                            <input className="me-inp" type="text" maxLength={200} placeholder="e.g. Priya Sharma" required
                              value={uform.name} onChange={e => setUform(f => ({ ...f, name: e.target.value }))}/>
                          </div>
                          <div className="me-fg">
                            <label className="me-lbl">EMAIL</label>
                            <input className="me-inp" type="email" maxLength={254} placeholder="priya@acme.co.in" required
                              value={uform.email} onChange={e => setUform(f => ({ ...f, email: e.target.value }))}/>
                          </div>
                          <div className="me-fg">
                            <label className="me-lbl">ROLE</label>
                            <select className="me-sel" value={uform.role} onChange={e => setUform(f => ({ ...f, role: e.target.value }))}>
                              {ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                            </select>
                          </div>
                        </div>
                        <div className="me-fg">
                          <label className="me-lbl">ENTITY ACCESS</label>
                          <select className="me-sel" value={uform.entity} onChange={e => setUform(f => ({ ...f, entity: e.target.value }))}>
                            <option value="all">All entities (Group-wide)</option>
                            {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                          </select>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button type="submit" className="btn btn-p" disabled={saving}>{saving ? 'INVITING…' : 'SEND INVITE →'}</button>
                          <button type="button" className="btn btn-g" onClick={() => setShowAddUser(false)}>CANCEL</button>
                        </div>
                      </form>
                    </div>
                  )}

                  <div className="me-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                      <div className="me-ctit" style={{ marginBottom: 0 }}>USERS & ACCESS — {users.length} / 50 MEMBERS</div>
                      <button className="btn btn-p btn-sm" onClick={() => setShowAddUser(true)}>+ INVITE USER</button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px 80px', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--brd)', fontSize: 10, color: 'var(--mut)', letterSpacing: '.08em' }}>
                      <span>NAME / EMAIL</span><span>ROLE</span><span>ENTITY ACCESS</span><span>ACTIONS</span>
                    </div>

                    {users.length === 0 ? (
                      <div style={{ padding: 24, textAlign: 'center', color: 'var(--mut)', fontSize: 11 }}>
                        No users yet — invite team members to collaborate on GHG data.
                      </div>
                    ) : (
                      users.map(u => (
                        <div key={u.id} className="user-row">
                          <div>
                            <div style={{ fontSize: 12 }}>{u.name}</div>
                            <div style={{ fontSize: 10, color: 'var(--mut)' }}>{u.email}</div>
                          </div>
                          <div>
                            <select className="me-sel" style={{ padding: '4px 8px', fontSize: 10 }}
                              value={u.role} onChange={e => updateUserRole(u.id, e.target.value)}>
                              {ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                            </select>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--mut)' }}>
                            {u.entity === 'all' ? 'All entities' : entities.find(e => String(e.id) === String(u.entity))?.name || '—'}
                          </div>
                          <div>
                            <button className="btn btn-xs btn-danger-xs"
                              onClick={() => handleDeleteUserRequest(u.id, u.name)}>REMOVE</button>
                          </div>
                        </div>
                      ))
                    )}

                    {/* Permission matrix */}
                    <div className="divider"/>
                    <div style={{ fontSize: 10, letterSpacing: '.1em', color: 'var(--mut)', marginBottom: 10 }}>PERMISSION MATRIX</div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--mut)', fontWeight: 400, borderBottom: '1px solid var(--brd)' }}>PERMISSION</th>
                            {ROLES.map(r => (
                              <th key={r.id} style={{ padding: '6px 12px', color: r.color, fontWeight: 700, borderBottom: '1px solid var(--brd)', textAlign: 'center' }}>{r.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            ['View dashboards & reports',      true,  true,  true,  true ],
                            ['Log emission activities',         false, true,  false, true ],
                            ['Edit / delete records',           false, true,  false, true ],
                            ['Manage BRSR environmental data',  false, true,  false, true ],
                            ['Add audit trail comments',        false, true,  true,  true ],
                            ['Sign off inventory (verify)',     false, false, true,  true ],
                            ['Export PDFs (BRSR/CDP/TCFD)',     false, true,  true,  true ],
                            ['Manage entities',                 false, false, false, true ],
                            ['Invite / remove users',           false, false, false, true ],
                            ['Change consolidation method',     false, false, false, true ],
                          ].map(([perm, viewer, editor, verifier, admin]) => (
                            <tr key={perm}>
                              <td style={{ padding: '7px 8px', color: 'var(--mut)', borderBottom: '1px solid var(--brd)11' }}>{perm}</td>
                              {[viewer, editor, verifier, admin].map((has, i) => (
                                <td key={i} style={{ textAlign: 'center', padding: '7px 12px', borderBottom: '1px solid var(--brd)11' }}>
                                  <span style={{ color: has ? '#10b981' : '#ef444444', fontSize: 14 }}>{has ? '✓' : '✗'}</span>
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
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