// src/components/SupplierPortal.jsx - 28/05/2026

import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../services/api';

const sanitise = (s = '', max = 200) =>
  String(s).replace(/<[^>]*>/g, '').replace(/['"`;]/g, '').trim().slice(0, max);
const fmt = (n, d = 2) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });

const PRODUCT_CATEGORIES = [
  'Steel', 'Aluminium', 'Copper', 'Plastic', 'Glass',
  'Cement', 'Paper / Packaging', 'Electronics / IT Equipment',
  'Chemicals', 'Textiles / Fabric', 'Logistics / Transport',
  'Cloud Computing / IT Services', 'Other',
];

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap');
:root{--bg:#04080a;--surf:#080f12;--brd:#182430;--brd2:#1e3040;--txt:#e8f4f0;--mut:#3a6070;--grn:#10b981;--red:#ef4444;--ylw:#f59e0b;--pur:#a855f7;}
.sp{min-height:100vh;background:var(--bg);font-family:'Space Mono',monospace;color:var(--txt);}
.sp-in{max-width:1200px;margin:0 auto;padding:28px 24px 80px;}
.sp-hd{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--brd);}
.sp-title{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;margin-top:3px;}
.sp-title span{color:var(--pur);}
.sp-card{background:var(--surf);border:1px solid var(--brd);border-radius:10px;padding:18px 20px;margin-bottom:14px;}
.sp-ctit{font-size:9px;letter-spacing:.15em;color:var(--mut);margin-bottom:14px;display:flex;align-items:center;gap:8px;}
.sp-ctit::before{content:'';width:10px;height:1px;background:var(--pur);}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}
.fg{display:flex;flex-direction:column;gap:5px;margin-bottom:10px;}
.lbl{font-size:10px;letter-spacing:.1em;color:var(--mut);}
.inp,.sel{padding:9px 11px;border-radius:6px;background:#060c10;border:1px solid var(--brd);color:var(--txt);font-family:'Space Mono',monospace;font-size:12px;outline:none;transition:border-color .2s;width:100%;box-sizing:border-box;}
.inp:focus,.sel:focus{border-color:#a855f744;}
.inp::placeholder{color:var(--mut);opacity:.7;}
.btn{padding:9px 17px;border-radius:6px;border:none;cursor:pointer;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.1em;font-weight:700;transition:all .2s;}
.btn:disabled{opacity:.5;cursor:not-allowed;}
.btn-pur{background:linear-gradient(135deg,#a855f7,#7c3aed);color:#fff;}
.btn-pur:hover:not(:disabled){opacity:.85;transform:translateY(-1px);}
.btn-g{background:var(--surf);border:1px solid var(--brd2);color:var(--txt);}
.btn-g:hover:not(:disabled){border-color:#a855f744;color:var(--pur);}
.btn-sm{padding:6px 12px;font-size:10px;}
.supplier-row{display:grid;grid-template-columns:2fr 1.5fr 1fr 80px 80px 80px;gap:8px;align-items:center;padding:10px 0;border-bottom:1px solid var(--brd)22;font-size:11px;}
.supplier-hdr{display:grid;grid-template-columns:2fr 1.5fr 1fr 80px 80px 80px;gap:8px;padding:8px 0;border-bottom:1px solid var(--brd);font-size:9px;letter-spacing:.08em;color:var(--mut);}
.status-pill{font-size:9px;padding:3px 8px;border-radius:3px;display:inline-block;text-align:center;}
.pill-grn{background:#10b98114;color:#10b981;border:1px solid #10b98133;}
.pill-ylw{background:#f59e0b14;color:#f59e0b;border:1px solid #f59e0b33;}
.pill-pur{background:#a855f714;color:#a855f7;border:1px solid #a855f733;}
.pill-mut{background:#3a607014;color:#3a6070;border:1px solid #3a607033;}
.sp-tabs{display:flex;gap:0;margin-bottom:18px;border-bottom:1px solid var(--brd);}
.sp-tab{padding:9px 15px;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.09em;cursor:pointer;border:none;background:none;color:var(--mut);border-bottom:2px solid transparent;transition:all .2s;margin-bottom:-1px;}
.sp-tab.on{color:var(--pur);border-bottom-color:var(--pur);}
.al{padding:10px 14px;border-radius:7px;font-size:11px;display:flex;gap:8px;margin-bottom:12px;line-height:1.6;}
.al-g{background:#10b98108;border:1px solid #10b98133;color:var(--grn);}
.al-y{background:#f59e0b08;border:1px solid #f59e0b33;color:var(--ylw);}
.al-pur{background:#a855f708;border:1px solid #a855f733;color:var(--pur);}
.drow{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--brd)22;font-size:11px;}
.notif{position:fixed;top:76px;right:24px;z-index:9999;padding:11px 18px;border-radius:8px;font-family:'Space Mono',monospace;font-size:11px;box-shadow:0 8px 32px #00000088;animation:fU .3s ease;}
.notif-ok{background:#0b2a1e;border:1px solid #10b98133;color:#10b981;}
.notif-err{background:#450a0a;border:1px solid #ef444433;color:#f87171;}
@keyframes fU{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:900px){.g2,.g3{grid-template-columns:1fr 1fr;}.supplier-row,.supplier-hdr{grid-template-columns:1fr 1fr;}}
`;

const defSupplierForm = () => ({
  name: '', email: '', gstin: '', product_category: '', annual_spend_cr: '',
  contact_name: '', notes: '',
});

export default function SupplierPortal({ profile, year = new Date().getFullYear() }) {
  const [tab,       setTab]       = useState('suppliers');
  const [suppliers, setSuppliers] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [showForm,  setShowForm]  = useState(false);
  const [form,      setForm]      = useState(defSupplierForm());
  const [notif,     setNotif]     = useState(null);

  const toast = (msg, type = 'ok') => { setNotif({ msg, type }); setTimeout(() => setNotif(null), 4000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/suppliers').catch(() => null);
      if (res?.suppliers) setSuppliers(res.suppliers);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleInvite = async (e) => {
    e.preventDefault();
    if (saving) return;
    const cleanName  = sanitise(form.name, 200);
    const cleanEmail = String(form.email || '').toLowerCase().trim().slice(0, 254);
    if (!cleanName)  { toast('Supplier name required', 'err'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) { toast('Valid email required', 'err'); return; }

    setSaving(true);
    try {
      const res = await apiFetch('/api/suppliers', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:             cleanName,
          email:            cleanEmail,
          gstin:            sanitise(form.gstin,            15).toUpperCase(),
          product_category: sanitise(form.product_category, 100),
          annual_spend_cr:  parseFloat(form.annual_spend_cr) || null,
          contact_name:     sanitise(form.contact_name,     200),
          notes:            sanitise(form.notes,            500),
        }),
      });
      if (res?.supplier) {
        setSuppliers(s => [res.supplier, ...s]);
        setForm(defSupplierForm());
        setShowForm(false);
        toast(`✓ ${res.supplier.name} invited — they will receive a data survey email`);
      }
    } catch { toast('Failed to invite supplier', 'err'); }
    finally { setSaving(false); }
  };

  // Calculate Scope 3 Cat 1 coverage
  const totalSpend    = suppliers.reduce((s, sup) => s + parseFloat(sup.annual_spend_cr || 0), 0);
  const responded     = suppliers.filter(s => s.status === 'submitted' || s.status === 'verified');
  const coveredSpend  = responded.reduce((s, sup) => s + parseFloat(sup.annual_spend_cr || 0), 0);
  const coveragePct   = totalSpend > 0 ? (coveredSpend / totalSpend * 100) : 0;
  const primaryDataCo2e = responded.reduce((s, sup) => s + parseFloat(sup.reported_co2e || 0), 0);

  const statusColor = (s) => s === 'verified' ? 'pill-grn' : s === 'submitted' ? 'pill-ylw' : s === 'invited' ? 'pill-pur' : 'pill-mut';
  const statusLabel = (s) => s === 'verified' ? 'VERIFIED' : s === 'submitted' ? 'SUBMITTED' : s === 'invited' ? 'INVITED' : 'NOT SENT';

  return (
    <>
      <style>{CSS}</style>
      {notif && <div className={`notif notif-${notif.type}`}>{notif.msg}</div>}

      <div className="sp">
        <div className="sp-in">

          <div className="sp-hd">
            <div>
              <div style={{ fontSize:9, letterSpacing:'.2em', color:'var(--mut)' }}>SCOPE 3 CAT 1 · GHG PROTOCOL PRIMARY DATA · SUPPLIER ENGAGEMENT</div>
              <div className="sp-title">Supplier <span>Data Portal</span></div>
              <div style={{ fontSize:10, color:'var(--mut)', marginTop:2 }}>
                Gap 6: Primary data Scope 3 Category 1 · Supplier carbon surveys · Coverage tracking
              </div>
            </div>
            <button className="btn btn-pur btn-sm" onClick={() => setShowForm(true)}>+ INVITE SUPPLIER</button>
          </div>

          <div className="al al-pur">
            <span>ℹ</span>
            <span>
              <strong>Gap 6 closed (foundation):</strong> GHG Protocol calls primary supplier data the gold standard for Scope 3 Cat 1. No Indian competitor has this. Invite suppliers to submit their product carbon footprints — replace generic emission factors with actual data from your supply chain.
            </span>
          </div>

          {/* Coverage stats */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:16 }}>
            {[
              { l:'SUPPLIERS INVITED',  v: suppliers.length,          c:'#a855f7' },
              { l:'DATA RECEIVED',      v: responded.length,          c:'#10b981' },
              { l:'SPEND COVERAGE',     v: `${fmt(coveragePct, 1)}%`, c:'#3b82f6' },
              { l:'PRIMARY DATA CO₂e',  v: `${fmt(primaryDataCo2e, 2)} t`, c:'#10b981' },
            ].map(({ l, v, c }) => (
              <div key={l} style={{ background:'#060c10', borderRadius:8, padding:14, border:'1px solid var(--brd)' }}>
                <div style={{ fontSize:9, color:'var(--mut)', letterSpacing:'.1em', marginBottom:4 }}>{l}</div>
                <div style={{ fontFamily:'Syne,sans-serif', fontSize:20, fontWeight:800, color:c }}>{v}</div>
              </div>
            ))}
          </div>

          <div className="sp-tabs">
            {[
              ['suppliers', `SUPPLIERS (${suppliers.length})`],
              ['coverage',  'SCOPE 3 COVERAGE'],
              ['how',       'HOW IT WORKS'],
            ].map(([k, v]) => (
              <button key={k} className={`sp-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{v}</button>
            ))}
          </div>

          {/* Invite form */}
          {showForm && (
            <div className="sp-card" style={{ border:'1px solid #a855f733', marginBottom:14 }}>
              <div className="sp-ctit">INVITE SUPPLIER — SCOPE 3 CAT 1 DATA SURVEY</div>
              <form onSubmit={handleInvite}>
                <div className="g3">
                  <div className="fg">
                    <label className="lbl">SUPPLIER NAME</label>
                    <input className="inp" type="text" maxLength={200} placeholder="e.g. Tata Steel Ltd" required
                      value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}/>
                  </div>
                  <div className="fg">
                    <label className="lbl">SUPPLIER EMAIL</label>
                    <input className="inp" type="email" maxLength={254} placeholder="sustainability@supplier.com" required
                      value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}/>
                  </div>
                  <div className="fg">
                    <label className="lbl">GSTIN (optional)</label>
                    <input className="inp" type="text" maxLength={15} placeholder="27AAPFU0939F1ZV"
                      value={form.gstin} onChange={e => setForm(f => ({ ...f, gstin: e.target.value.toUpperCase() }))}/>
                  </div>
                </div>
                <div className="g3">
                  <div className="fg">
                    <label className="lbl">PRODUCT CATEGORY</label>
                    <select className="sel" value={form.product_category} onChange={e => setForm(f => ({ ...f, product_category: e.target.value }))}>
                      <option value="">Select…</option>
                      {PRODUCT_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="fg">
                    <label className="lbl">ANNUAL SPEND (₹ Cr)</label>
                    <input className="inp" type="number" step="0.1" min="0" placeholder="e.g. 12.5"
                      value={form.annual_spend_cr} onChange={e => setForm(f => ({ ...f, annual_spend_cr: e.target.value }))}/>
                  </div>
                  <div className="fg">
                    <label className="lbl">CONTACT PERSON NAME</label>
                    <input className="inp" type="text" maxLength={200} placeholder="e.g. Priya Sharma"
                      value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))}/>
                  </div>
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button type="submit" className="btn btn-pur" disabled={saving}>{saving ? 'INVITING…' : 'SEND SURVEY INVITE →'}</button>
                  <button type="button" className="btn btn-g" onClick={() => setShowForm(false)}>CANCEL</button>
                </div>
              </form>
            </div>
          )}

          {/* ══ SUPPLIERS TAB ══ */}
          {tab === 'suppliers' && (
            <div className="sp-card">
              <div className="sp-ctit">SUPPLIER REGISTRY — SCOPE 3 CAT 1 DATA COLLECTION</div>
              {loading ? (
                <div style={{ padding:32, textAlign:'center', color:'var(--mut)', fontSize:11 }}>LOADING SUPPLIERS…</div>
              ) : suppliers.length === 0 ? (
                <div style={{ padding:32, textAlign:'center' }}>
                  <div style={{ fontSize:32, marginBottom:12 }}>🏭</div>
                  <div style={{ fontSize:13, color:'var(--txt)', marginBottom:8 }}>No suppliers invited yet</div>
                  <div style={{ fontSize:11, color:'var(--mut)', marginBottom:16, lineHeight:1.7, maxWidth:400, margin:'0 auto 16px' }}>
                    Invite your top Scope 3 Category 1 suppliers to submit their product carbon footprints. This replaces generic DEFRA factors with actual primary data — the GHG Protocol gold standard.
                  </div>
                  <button className="btn btn-pur" onClick={() => setShowForm(true)}>+ INVITE FIRST SUPPLIER →</button>
                </div>
              ) : (
                <>
                  <div className="supplier-hdr">
                    <span>SUPPLIER</span><span>PRODUCT</span><span>SPEND (₹ Cr)</span>
                    <span>CO₂e (t)</span><span>STATUS</span><span>ACTION</span>
                  </div>
                  {suppliers.map((s, i) => (
                    <div key={s.id || i} className="supplier-row">
                      <div>
                        <div style={{ fontSize:12, color:'var(--txt)' }}>{s.name}</div>
                        <div style={{ fontSize:10, color:'var(--mut)' }}>{s.email}</div>
                      </div>
                      <div style={{ fontSize:11, color:'var(--mut)' }}>{s.product_category || '—'}</div>
                      <div style={{ fontSize:11 }}>₹{fmt(s.annual_spend_cr, 1)} Cr</div>
                      <div style={{ fontSize:11, color: s.reported_co2e > 0 ? '#10b981' : 'var(--mut)' }}>
                        {s.reported_co2e > 0 ? fmt(s.reported_co2e, 3) : '—'}
                      </div>
                      <div><span className={`status-pill ${statusColor(s.status)}`}>{statusLabel(s.status)}</span></div>
                      <div style={{ fontSize:10, color:'#a855f7', cursor:'pointer' }}>VIEW</div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* ══ COVERAGE TAB ══ */}
          {tab === 'coverage' && (
            <div className="sp-card">
              <div className="sp-ctit">SCOPE 3 CAT 1 COVERAGE ANALYSIS</div>
              <div className="al al-g">
                <span>ℹ</span>
                <span>GHG Protocol requires disclosing the % of Scope 3 Cat 1 covered by primary data vs. spend-based estimates. CDP C6.5 and BRSR both ask for data quality indicators.</span>
              </div>
              {[
                ['Total suppliers invited',      suppliers.length],
                ['Suppliers responded',          responded.length],
                ['Total annual spend tracked',   `₹${fmt(totalSpend, 1)} Cr`],
                ['Spend covered by primary data', `₹${fmt(coveredSpend, 1)} Cr (${fmt(coveragePct, 1)}%)`],
                ['Primary data Scope 3 Cat 1',   `${fmt(primaryDataCo2e, 3)} tCO₂e`],
                ['Data quality',                 coveragePct >= 50 ? 'Primary data — GHG Protocol Tier 1' : 'Spend-based — GHG Protocol Tier 3'],
                ['CDP C6.5 disclosure status',   responded.length > 0 ? 'Primary data available — disclose in C6.5a' : 'Spend-based only — disclose methodology'],
              ].map(([k, v]) => (
                <div key={k} className="drow">
                  <span style={{ color:'var(--mut)' }}>{k}</span>
                  <span style={{ color:'var(--txt)' }}>{String(v)}</span>
                </div>
              ))}
            </div>
          )}

          {/* ══ HOW IT WORKS ══ */}
          {tab === 'how' && (
            <div className="sp-card">
              <div className="sp-ctit">HOW SUPPLIER DATA COLLECTION WORKS</div>
              {[
                { n:'1', t:'Invite supplier',           d:'Enter supplier details above — they receive an automated email with a secure survey link' },
                { n:'2', t:'Supplier completes survey', d:'Supplier enters their product carbon footprint (kgCO₂e/unit) via a simple web form — no EtherTrack account needed' },
                { n:'3', t:'Data validated',            d:'EtherTrack cross-checks submitted factor against DEFRA/IPCC benchmarks and flags outliers for review' },
                { n:'4', t:'Auto-update GHG ledger',    d:'Accepted primary factors replace generic DEFRA factors for that supplier\'s product in your Scope 3 Cat 1 calculations' },
                { n:'5', t:'Disclose in reports',       d:'CDP C6.5a, BRSR, and GHG Protocol reports automatically show "primary data" data quality indicator for covered suppliers' },
              ].map(({ n, t, d }) => (
                <div key={n} style={{ display:'flex', gap:12, padding:'12px 0', borderBottom:'1px solid var(--brd)22' }}>
                  <span style={{ width:26, height:26, borderRadius:'50%', background:'#a855f720', border:'1px solid #a855f733', color:'#a855f7', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontSize:10, fontWeight:700 }}>{n}</span>
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:'var(--txt)', marginBottom:3 }}>{t}</div>
                    <div style={{ fontSize:11, color:'var(--mut)', lineHeight:1.6 }}>{d}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
    </>
  );
}

