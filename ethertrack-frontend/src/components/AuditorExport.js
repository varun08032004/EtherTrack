// src/components/AuditorExport.jsx
// Auditor Verification Seal Flow — v2
// ── Status machine: draft → package_ready → under_review → signed_uploaded → sealed
// ── Flow:
//    1. SME selects package type + auditor details → Generate Package
//    2. Backend creates verification cycle + tokenized portal link
//    3. SME downloads PDF + shares portal link with auditor
//    4. Auditor opens link (no login), downloads, signs via emSigner, uploads back
//    5. Backend hashes signed PDF → anchors on Sepolia → status: sealed
//    6. Sealed artifact lives here — BRSR/CDP submission ready

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../services/api';

const sanitise = (str = '') =>
  String(str).replace(/<[^>]*>/g, '').replace(/['"`;]/g, '').trim().slice(0, 500);

const CHAIN_EXPLORER = 'https://sepolia.etherscan.io/tx';

const STATUS_META = {
  draft:           { label: 'DRAFT',            color: '#4a6a7a', bg: '#080c10' },
  package_ready:   { label: 'PACKAGE READY',    color: '#3b82f6', bg: '#060e18' },
  under_review:    { label: 'UNDER REVIEW',      color: '#f59e0b', bg: '#140d00' },
  signed_uploaded: { label: 'SIGNED — PENDING SEAL', color: '#f97316', bg: '#140a00' },
  sealed:          { label: 'SEALED ON-CHAIN',   color: '#10b981', bg: '#040f09' },
};

const AUDIT_PACKAGES = [
  {
    id:    'standard',
    icon:  '📋',
    name:  'Standard Assurance Package',
    desc:  'For ISO 14064-3 limited assurance — covers most common audit requirements',
    color: '#10b981',
    contents: [
      'Full GHG inventory ledger (all scopes)',
      'Emission factor version log',
      'Approval workflow history',
      'Source document references',
      'Calculation formula per record',
      'Year-over-year comparison',
    ],
  },
  {
    id:    'brsr',
    icon:  '🇮🇳',
    name:  'BRSR Core Audit Package',
    desc:  'For SEBI BRSR Core mandatory filing — includes P6 KPIs and intensity metrics',
    color: '#f97316',
    contents: [
      'GHG inventory (Scope 1, 2, 3)',
      'Energy data (P6-E2)',
      'Water data (P6-E3)',
      'Waste data (P6-E4)',
      'PPP-adjusted intensity metrics',
      'Carbon credit retirements (P6-E5)',
      'CIN / GSTIN / regulatory identity',
    ],
  },
  {
    id:    'full',
    icon:  '🔬',
    name:  'Full Forensic Package',
    desc:  'For reasonable assurance or CDP submission — complete lineage and blockchain proof',
    color: '#a855f7',
    contents: [
      'Everything in Standard + BRSR packages',
      'Source-to-number lineage per record',
      'Blockchain transaction hashes',
      'Duplicate detection log',
      'Anomaly flags and overrides',
      'Tracked adjustments history',
    ],
  },
];

const AUDITOR_FIRMS = [
  'Bureau Veritas (BV)', 'DNV', 'Ernst & Young (EY)', 'KPMG',
  'Deloitte', 'PwC', 'SGS India', 'TÜV SÜD', 'BSI Group', 'Intertek', 'Other',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CSS = `
.ae-card{background:var(--surf);border:1px solid var(--brd);border-radius:10px;padding:22px;margin-bottom:14px;animation:fU .4s ease both;}
.ae-ctit{font-size:10px;letter-spacing:.15em;color:var(--mut);margin-bottom:18px;display:flex;align-items:center;gap:8px;}
.ae-ctit::before{content:'';width:12px;height:1px;background:#a855f7;}
.ae-pkg-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;}
.ae-pkg{border-radius:10px;padding:18px;border:1px solid var(--brd);background:#080b0e;cursor:pointer;transition:all .2s;}
.ae-pkg:hover{transform:translateY(-2px);border-color:#a855f744;}
.ae-pkg.sel{border-color:var(--pkg-color);background:color-mix(in srgb,var(--pkg-color) 6%,transparent);}
.ae-pkg-icon{font-size:28px;margin-bottom:8px;}
.ae-pkg-name{font-size:12px;font-weight:700;margin-bottom:4px;}
.ae-pkg-desc{font-size:10px;color:var(--mut);line-height:1.5;margin-bottom:8px;}
.ae-pkg-item{font-size:9px;color:var(--mut);padding:2px 0;border-bottom:1px solid var(--brd)22;}
.ae-pkg-item:last-child{border-bottom:none;}
.ae-g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;}
.ae-fg{display:flex;flex-direction:column;gap:5px;}
.ae-lbl{font-size:10px;letter-spacing:.1em;color:var(--mut);}
.ae-inp,.ae-sel{padding:9px 11px;border-radius:6px;background:#0a1018;border:1px solid var(--brd);color:var(--txt);font-family:'Space Mono',monospace;font-size:11px;outline:none;width:100%;box-sizing:border-box;transition:border-color .2s;}
.ae-inp:focus,.ae-sel:focus{border-color:#a855f744;}
.ae-inp.err{border-color:#ef444466;}
.ae-inp::placeholder{color:var(--mut);opacity:.7;}
.ae-btn{padding:10px 18px;border-radius:6px;border:none;cursor:pointer;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.1em;font-weight:700;transition:all .2s;}
.ae-btn:disabled{opacity:.5;cursor:not-allowed;}
.ae-btn-pur{background:linear-gradient(135deg,#a855f7,#7c3aed);color:#fff;}
.ae-btn-pur:hover:not(:disabled){opacity:.88;transform:translateY(-1px);}
.ae-btn-grn{background:linear-gradient(135deg,#10b981,#059669);color:#fff;}
.ae-btn-grn:hover:not(:disabled){opacity:.88;transform:translateY(-1px);}
.ae-btn-g{background:var(--surf);border:1px solid var(--brd2);color:var(--txt);}
.ae-btn-g:hover:not(:disabled){border-color:#a855f744;color:#a855f7;}
.ae-btn-sm{padding:6px 12px;font-size:9px;}
.ae-cycle-card{border-radius:10px;padding:16px;border:1px solid;margin-bottom:10px;transition:all .2s;}
.ae-status-pill{display:inline-flex;align-items:center;gap:5px;font-size:9px;padding:3px 9px;border-radius:3px;letter-spacing:.08em;font-weight:700;}
.ae-seal-box{padding:16px 20px;border-radius:10px;background:#040f09;border:1px solid #10b98133;margin-bottom:14px;}
.ae-link-box{padding:10px 14px;border-radius:8px;background:#060e18;border:1px solid #3b82f633;font-size:11px;color:#3b82f6;word-break:break-all;margin-top:8px;cursor:pointer;transition:background .2s;}
.ae-link-box:hover{background:#0a1828;}
.ae-check-item{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--brd)22;font-size:11px;}
.ae-check-item:last-child{border-bottom:none;}
.ae-alert{padding:10px 14px;border-radius:7px;font-size:11px;display:flex;gap:8px;margin-bottom:12px;line-height:1.6;}
.ae-alert-g{background:#10b98108;border:1px solid #10b98133;color:#10b981;}
.ae-alert-y{background:#f59e0b08;border:1px solid #f59e0b33;color:#f59e0b;}
.ae-alert-b{background:#3b82f608;border:1px solid #3b82f633;color:#3b82f6;}
.ae-divider{height:1px;background:var(--brd);margin:16px 0;}
.ae-step{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--brd)22;}
.ae-step:last-child{border-bottom:none;}
.ae-step-num{width:22px;height:22px;border-radius:50%;background:#a855f7;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px;}
.ae-toast{position:fixed;top:76px;right:24px;z-index:9999;padding:12px 20px;border-radius:8px;font-family:'Space Mono',monospace;font-size:11px;box-shadow:0 8px 32px #00000066;animation:fU .3s ease;max-width:420px;}
.ae-toast-ok{background:#0b2a1e;border:1px solid #10b98133;color:#10b981;}
.ae-toast-err{background:#450a0a;border:1px solid #ef444433;color:#f87171;}
.ae-toast-warn{background:#2a1f00;border:1px solid #f59e0b33;color:#f59e0b;}
@media(max-width:800px){.ae-pkg-grid,.ae-g2{grid-template-columns:1fr;}}
`;

export default function AuditorExport({ profile, year, records = [], retirements = [] }) {
  const [tab,            setTab]          = useState('new');
  const [cycles,         setCycles]       = useState([]);
  const [loadingCycles,  setLoadingCycles]= useState(false);
  const [selectedPkg,    setSelectedPkg]  = useState('standard');
  const [auditorEmail,   setAuditorEmail] = useState('');
  const [auditorFirm,    setAuditorFirm]  = useState('');
  const [emailErr,       setEmailErr]     = useState('');
  const [generating,     setGenerating]   = useState(false);
  const [activeCycle,    setActiveCycle]  = useState(null); // cycle just created or active
  const [copied,         setCopied]       = useState(false);
  const [notif,          setNotif]        = useState(null);

  const abortRef = useRef(null);

  const toast = (msg, type = 'ok') => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 4500);
  };

  const loadCycles = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoadingCycles(true);
    try {
      const res = await apiFetch(`/api/audit/verification-cycles?year=${year}`);
      if (!ctl.signal.aborted && res?.cycles) {
        setCycles(res.cycles);
        // if there's an active (non-sealed) cycle, surface it
        const active = res.cycles.find(c => c.status !== 'sealed');
        if (active) setActiveCycle(active);
      }
    } catch {
      // silently fail — not critical
    } finally {
      if (!ctl.signal.aborted) setLoadingCycles(false);
    }
  }, [year]);

  useEffect(() => {
    loadCycles();
    return () => abortRef.current?.abort();
  }, [loadCycles]);

  const handleEmailBlur = () => {
    if (auditorEmail && !EMAIL_RE.test(auditorEmail)) {
      setEmailErr('Invalid email format');
    } else {
      setEmailErr('');
    }
  };

  // ── Generate PDF package + create verification cycle ──────────────────
  const handleGenerate = async () => {
    if (generating) return;

    if (!EMAIL_RE.test(auditorEmail)) {
      setEmailErr('Valid auditor email is required');
      return;
    }
    setEmailErr('');

    if (records.length === 0) {
      toast('No emission records to package — log emissions first', 'err');
      return;
    }

    setGenerating(true);
    try {
      // Only create the verification cycle — report PDF is generated separately
      // in the Reports section and shared with the auditor manually
      const cycleRes = await apiFetch('/api/audit/verification-cycles', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          year,
          auditor_email: auditorEmail,
          auditor_firm:  sanitise(auditorFirm, 200),
          package_type:  selectedPkg,
        }),
      });

      if (cycleRes?.cycleId) {
        setActiveCycle({
          id:              cycleRes.cycleId,
          status:          cycleRes.status,
          auditor_email:   auditorEmail,
          auditor_firm:    auditorFirm,
          package_type:    selectedPkg,
          link_expires_at: cycleRes.expiresAt,
          portalUrl:       cycleRes.portalUrl,
        });
        setTab('active');
        await loadCycles();
        toast('Verification cycle created — share the portal link with your auditor');
      }
    } catch (err) {
      toast(`Failed: ${err.message || 'Please try again'}`, 'err');
    } finally {
      setGenerating(false);
    }
  };

  // ── Download JSON package as fallback ─────────────────────────────────
  const handleDownloadJSON = () => {
    const pkg = AUDIT_PACKAGES.find(p => p.id === selectedPkg);
    const auditPackage = {
      document_type:  `EtherTrack ${pkg.name}`,
      generated_at:   new Date().toISOString(),
      generated_for:  auditorFirm || auditorEmail || 'Third-party verifier',
      reporting_year: year,
      standard:       selectedPkg === 'brsr' ? 'SEBI BRSR Core Dec 2024' : 'ISO 14064-3 / GHG Protocol',
      entity: {
        name:     profile?.company_name    || '',
        cin:      profile?.company_cin     || '',
        gstin:    profile?.company_gstin   || '',
        industry: profile?.industry        || '',
      },
      summary: {
        total_records: records.length,
        scope1_tco2e:  records.filter(r => r.scope === 1).reduce((s, r) => s + parseFloat(r.co2e || 0), 0).toFixed(4),
        scope2_tco2e:  records.filter(r => r.scope === 2).reduce((s, r) => s + parseFloat(r.co2e || 0), 0).toFixed(4),
        scope3_tco2e:  records.filter(r => r.scope === 3).reduce((s, r) => s + parseFloat(r.co2e || 0), 0).toFixed(4),
        total_tco2e:   records.reduce((s, r) => s + parseFloat(r.co2e || 0), 0).toFixed(4),
        retirements:   retirements.length,
      },
      emission_records: records.map(r => ({
        id: r.id, date: r.date, activity: r.activity,
        quantity: r.quantity, unit: r.unit, scope: r.scope,
        category: r.category, factor: r.factor, factor_source: r.source,
        ef_version_id: r.ef_version_id || 'CEA-V20-FY2324',
        co2e: r.co2e, approval_state: r.approval_state || 'draft',
        audit_hash: r.audit_hash,
      })),
      retirements: retirements.map(r => ({
        id: r.id, date: r.date, amount: r.amount,
        registry: r.registry, serial_no: r.serial_no,
        project: r.project, vintage: r.vintage,
      })),
      data_quality_notes: [
        'Grid emission factor: CEA V20.0 Dec 2024 — 0.727 tCO₂/MWh (FY 2023-24)',
        'Non-India factors: DEFRA 2024',
        'GWP100: IPCC AR6',
        'Dual Scope 2: location-based + market-based reported separately',
      ],
    };

    const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(auditPackage, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href     = blobUrl;
    a.download = `ethertrack_audit_${selectedPkg}_fy${year}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
    toast('Audit package downloaded');
  };

  const copyPortalLink = (url) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      toast('Portal link copied — share with your auditor');
    });
  };

  const handleCancelCycle = async (cycleId) => {
    if (!window.confirm('Cancel this verification cycle? This cannot be undone.')) return;
    try {
      await apiFetch(`/api/audit/verification-cycles/${cycleId}`, { method: 'DELETE' });
      toast('Verification cycle cancelled');
      setActiveCycle(null);
      await loadCycles();
    } catch (err) {
      toast(`Cancel failed: ${err.message}`, 'err');
    }
  };

  const handleRetryAnchor = async (cycleId) => {
    try {
      const res = await apiFetch(`/api/audit/verification-cycles/${cycleId}/anchor`, { method: 'POST' });
      toast(`Sealed on-chain · tx: ${res.sealTxHash?.slice(0, 12)}…`);
      await loadCycles();
    } catch (err) {
      toast(`Anchor failed: ${err.message}`, 'err');
    }
  };

  const selectedPkgMeta = AUDIT_PACKAGES.find(p => p.id === selectedPkg);

  // ── readiness checklist ───────────────────────────────────────────────
  const checks = [
    { label: 'Emission records logged',   ok: records.length > 0,                                              detail: `${records.length} records` },
    { label: 'Scope 1 data present',      ok: records.some(r => r.scope === 1),                               detail: `${records.filter(r => r.scope === 1).length} records` },
    { label: 'Scope 2 data present',      ok: records.some(r => r.scope === 2),                               detail: `${records.filter(r => r.scope === 2).length} records` },
    { label: 'Company profile complete',  ok: !!(profile?.company_name && profile?.company_cin),              detail: profile?.company_name || 'Missing' },
    { label: 'Records approved/locked',   ok: records.some(r => ['approved','locked'].includes(r.approval_state)), detail: `${records.filter(r => ['approved','locked'].includes(r.approval_state)).length} approved` },
  ];
  const readyCount = checks.filter(c => c.ok).length;
  const isReady    = readyCount >= 4; // allow partial readiness

  return (
    <>
      <style>{CSS}</style>

      {notif && (
        <div className={`ae-toast ae-toast-${notif.type}`}>{notif.msg}</div>
      )}

      {/* ── tabs ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 18, borderBottom: '1px solid var(--brd)' }}>
        {[
          ['new',     'NEW PACKAGE'],
          ['active',  `ACTIVE CYCLE${activeCycle ? ' ●' : ''}`],
          ['history', `HISTORY (${cycles.length})`],
        ].map(([k, v]) => (
          <button key={k}
            style={{
              padding: '9px 15px', fontFamily: 'Space Mono,monospace', fontSize: 11,
              letterSpacing: '.08em', cursor: 'pointer', border: 'none', background: 'none',
              color: tab === k ? '#a855f7' : 'var(--mut)',
              borderBottom: tab === k ? '2px solid #a855f7' : '2px solid transparent',
              marginBottom: -1, transition: 'all .2s',
            }}
            onClick={() => setTab(k)}>
            {v}
          </button>
        ))}
      </div>

      {/* ── NEW PACKAGE TAB ───────────────────────────────────────────── */}
      {tab === 'new' && (
        <div className="ae-card">
          <div className="ae-ctit">GENERATE VERIFICATION PACKAGE — AUDITOR SEAL FLOW</div>

          {/* readiness */}
          <div style={{ fontSize: 10, color: 'var(--mut)', letterSpacing: '.1em', marginBottom: 10 }}>
            AUDIT READINESS — {readyCount}/{checks.length} CHECKS PASSED
          </div>
          <div style={{ marginBottom: 18 }}>
            {checks.map(({ label, ok, detail }) => (
              <div key={label} className="ae-check-item">
                <span style={{ color: ok ? '#10b981' : '#f59e0b', fontSize: 14, flexShrink: 0 }}>
                  {ok ? '✓' : '○'}
                </span>
                <span style={{ flex: 1, color: ok ? 'var(--txt)' : 'var(--mut)' }}>{label}</span>
                <span style={{ fontSize: 10, color: ok ? '#10b981' : 'var(--mut)' }}>{detail}</span>
              </div>
            ))}
          </div>

          {/* package selection */}
          <div style={{ fontSize: 10, color: 'var(--mut)', letterSpacing: '.1em', marginBottom: 12 }}>
            SELECT AUDIT PACKAGE
          </div>
          <div className="ae-pkg-grid">
            {AUDIT_PACKAGES.map(pkg => (
              <div key={pkg.id}
                className={`ae-pkg${selectedPkg === pkg.id ? ' sel' : ''}`}
                style={{ '--pkg-color': pkg.color }}
                onClick={() => setSelectedPkg(pkg.id)}>
                <div className="ae-pkg-icon">{pkg.icon}</div>
                <div className="ae-pkg-name" style={{ color: selectedPkg === pkg.id ? pkg.color : 'var(--txt)' }}>
                  {pkg.name}
                </div>
                <div className="ae-pkg-desc">{pkg.desc}</div>
                <div>
                  {pkg.contents.map(c => (
                    <div key={c} className="ae-pkg-item">
                      <span style={{ color: pkg.color, marginRight: 6 }}>✓</span>{c}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* auditor details */}
          <div style={{ fontSize: 10, color: 'var(--mut)', letterSpacing: '.1em', marginBottom: 12 }}>
            AUDITOR DETAILS
          </div>
          <div className="ae-g2">
            <div className="ae-fg">
              <label className="ae-lbl">AUDITOR FIRM</label>
              <select className="ae-sel" value={auditorFirm} onChange={e => setAuditorFirm(e.target.value)}>
                <option value="">Select firm…</option>
                {AUDITOR_FIRMS.map(f => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div className="ae-fg">
              <label className="ae-lbl">AUDITOR EMAIL *</label>
              <input
                className={`ae-inp${emailErr ? ' err' : ''}`}
                type="email"
                placeholder="auditor@bv.com"
                value={auditorEmail}
                onChange={e => { setAuditorEmail(e.target.value); setEmailErr(''); }}
                onBlur={handleEmailBlur}
                maxLength={254}
              />
              {emailErr && <div style={{ fontSize: 10, color: '#ef4444', marginTop: 3 }}>{emailErr}</div>}
            </div>
          </div>

          {/* how it works */}
          <div style={{ fontSize: 10, color: 'var(--mut)', letterSpacing: '.1em', marginBottom: 10 }}>
            HOW THE SEAL FLOW WORKS
          </div>
          <div style={{ marginBottom: 18 }}>
            {[
              ['Create verification cycle', 'Generates a tokenized auditor portal link (no auditor login needed). Share your report PDF separately from the Reports section.'],
              ['Share with auditor', 'Send the portal link to your auditor — they open it, review the data, download the package'],
              ['Auditor signs offline', 'Auditor signs the PDF via emSigner, Leegality, or their firm\'s DSC tool'],
              ['Auditor uploads back', 'Auditor uploads the signed PDF through the portal link — no EtherTrack account needed'],
              ['Hash anchored on-chain', 'Backend SHA-256 hashes the signed PDF and anchors it on Sepolia — this is the immutable seal'],
            ].map(([title, desc], i) => (
              <div key={i} className="ae-step">
                <div className="ae-step-num">{i + 1}</div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt)', marginBottom: 3 }}>{title}</div>
                  <div style={{ fontSize: 10, color: 'var(--mut)', lineHeight: 1.6 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>

          {activeCycle && activeCycle.status !== 'sealed' && (
            <div className="ae-alert ae-alert-y" style={{ marginBottom: 12 }}>
              <span>⚠</span>
              <span>
                An active verification cycle exists (status: {STATUS_META[activeCycle.status]?.label}).
                Cancel it first or switch to the Active Cycle tab to continue.
              </span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="ae-btn ae-btn-pur"
              onClick={handleGenerate}
              disabled={generating || !!emailErr || !auditorEmail || (!!activeCycle && activeCycle.status !== 'sealed')}>
              {generating ? '⟳ GENERATING…' : '⬡ CREATE VERIFICATION CYCLE + GET PORTAL LINK'}
            </button>
            <button className="ae-btn ae-btn-g ae-btn-sm" onClick={handleDownloadJSON}
              disabled={records.length === 0}>
              ↓ DOWNLOAD JSON PACKAGE
            </button>
          </div>
        </div>
      )}

      {/* ── ACTIVE CYCLE TAB ──────────────────────────────────────────── */}
      {tab === 'active' && (
        <div className="ae-card">
          <div className="ae-ctit">ACTIVE VERIFICATION CYCLE — FY {year}</div>

          {!activeCycle ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--mut)', fontSize: 11 }}>
              No active verification cycle for FY {year}.<br/>
              Go to NEW PACKAGE to generate one.
            </div>
          ) : (
            <>
              {/* status banner */}
              {(() => {
                const sm = STATUS_META[activeCycle.status] || STATUS_META.draft;
                return (
                  <div style={{
                    padding: '12px 16px', borderRadius: 8, marginBottom: 16,
                    background: sm.bg, border: `1px solid ${sm.color}33`,
                    display: 'flex', alignItems: 'center', gap: 12,
                  }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: sm.color, flexShrink: 0 }}/>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: sm.color }}>{sm.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--mut)', marginTop: 2 }}>
                        {activeCycle.auditor_firm || activeCycle.auditor_email} ·
                        {AUDIT_PACKAGES.find(p => p.id === activeCycle.package_type)?.name || activeCycle.package_type}
                      </div>
                    </div>
                    {activeCycle.status === 'sealed' && activeCycle.seal_tx_hash && (
                      <a href={`${CHAIN_EXPLORER}/${activeCycle.seal_tx_hash}`}
                        target="_blank" rel="noreferrer"
                        style={{ marginLeft: 'auto', fontSize: 10, color: '#10b981', textDecoration: 'none' }}>
                        ⬡ View on Etherscan ↗
                      </a>
                    )}
                  </div>
                );
              })()}

              {/* sealed confirmation */}
              {activeCycle.status === 'sealed' && (
                <div className="ae-seal-box">
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#10b981', marginBottom: 8 }}>
                    ✓ INVENTORY SEALED — ISO 14064-3 VERIFICATION COMPLETE
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--mut)', lineHeight: 1.7 }}>
                    The signed verification document has been hashed (SHA-256) and permanently anchored
                    on Ethereum Sepolia. This seal is immutable and independently verifiable.
                    Your BRSR, CDP, and TCFD reports can now include this as verified evidence.
                  </div>
                  {activeCycle.seal_tx_hash && (
                    <div style={{ marginTop: 10, fontSize: 10 }}>
                      <span style={{ color: 'var(--mut)' }}>TX HASH: </span>
                      <span style={{ color: '#10b981', fontFamily: 'Space Mono,monospace' }}>
                        {activeCycle.seal_tx_hash}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* portal link */}
              {activeCycle.portalUrl && activeCycle.status !== 'sealed' && (
                <>
                  <div style={{ fontSize: 10, color: 'var(--mut)', letterSpacing: '.1em', marginBottom: 8 }}>
                    AUDITOR PORTAL LINK — SHARE THIS WITH {(activeCycle.auditor_firm || 'YOUR AUDITOR').toUpperCase()}
                  </div>
                  <div className="ae-link-box" onClick={() => copyPortalLink(activeCycle.portalUrl)}>
                    {activeCycle.portalUrl}
                    <span style={{ marginLeft: 10, fontSize: 9, opacity: .7 }}>
                      {copied ? '✓ COPIED' : 'CLICK TO COPY'}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--mut)', marginTop: 6, lineHeight: 1.7 }}>
                    Link expires: {new Date(activeCycle.link_expires_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} ·
                    Auditor can upload their signed PDF directly — no EtherTrack account needed.
                  </div>

                  <div className="ae-alert ae-alert-b" style={{ marginTop: 14 }}>
                    <span>ℹ</span>
                    <span>
                      The auditor should sign the PDF using <strong>emSigner</strong> or their firm's DSC tool,
                      then upload via the portal link above. The signed PDF will be hashed and anchored on Ethereum.
                    </span>
                  </div>
                </>
              )}

              {/* signed_uploaded — chain pending */}
              {activeCycle.status === 'signed_uploaded' && (
                <>
                  <div className="ae-alert ae-alert-y" style={{ marginTop: 14 }}>
                    <span>⚠</span>
                    <span>
                      Signed PDF uploaded but blockchain anchor failed.
                      Click RETRY ANCHOR to seal on-chain.
                    </span>
                  </div>
                  <button className="ae-btn ae-btn-grn ae-btn-sm"
                    style={{ marginTop: 10 }}
                    onClick={() => handleRetryAnchor(activeCycle.id)}>
                    RETRY ANCHOR ON-CHAIN
                  </button>
                </>
              )}

              {/* cancel */}
              {activeCycle.status !== 'sealed' && (
                <>
                  <div className="ae-divider"/>
                  <button className="ae-btn ae-btn-g ae-btn-sm"
                    style={{ border: '1px solid #ef444433', color: '#ef4444' }}
                    onClick={() => handleCancelCycle(activeCycle.id)}>
                    CANCEL CYCLE
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ── HISTORY TAB ───────────────────────────────────────────────── */}
      {tab === 'history' && (
        <div className="ae-card">
          <div className="ae-ctit">VERIFICATION HISTORY — ALL CYCLES</div>

          {loadingCycles ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--mut)', fontSize: 11 }}>
              LOADING
            </div>
          ) : cycles.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--mut)', fontSize: 11 }}>
              No verification cycles yet. Generate a package to start.
            </div>
          ) : (
            cycles.map(cycle => {
              const sm = STATUS_META[cycle.status] || STATUS_META.draft;
              return (
                <div key={cycle.id}
                  className="ae-cycle-card"
                  style={{ borderColor: `${sm.color}33`, background: sm.bg }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt)', marginBottom: 3 }}>
                        {cycle.auditor_firm || cycle.auditor_email}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--mut)' }}>
                        FY {cycle.year} · {AUDIT_PACKAGES.find(p => p.id === cycle.package_type)?.name || cycle.package_type}
                      </div>
                    </div>
                    <span className="ae-status-pill" style={{ background: `${sm.color}14`, color: sm.color, border: `1px solid ${sm.color}33` }}>
                      {sm.label}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 10 }}>
                    <div>
                      <span style={{ color: 'var(--mut)' }}>Created: </span>
                      <span>{new Date(cycle.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                    </div>
                    {cycle.signed_at && (
                      <div>
                        <span style={{ color: 'var(--mut)' }}>Signed: </span>
                        <span>{new Date(cycle.signed_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                      </div>
                    )}
                    {cycle.sealed_at && (
                      <div>
                        <span style={{ color: 'var(--mut)' }}>Sealed: </span>
                        <span style={{ color: '#10b981' }}>{new Date(cycle.sealed_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                      </div>
                    )}
                  </div>
                  {cycle.seal_tx_hash && (
                    <div style={{ marginTop: 8 }}>
                      <a href={`${CHAIN_EXPLORER}/${cycle.seal_tx_hash}`}
                        target="_blank" rel="noreferrer"
                        style={{ fontSize: 9, color: '#10b981', textDecoration: 'none', fontFamily: 'Space Mono,monospace' }}>
                        ⬡ {cycle.seal_tx_hash.slice(0, 14)}…{cycle.seal_tx_hash.slice(-8)} ↗
                      </a>
                    </div>
                  )}
                  {cycle.signed_pdf_hash && (
                    <div style={{ marginTop: 6, fontSize: 9, color: 'var(--mut)', fontFamily: 'Space Mono,monospace' }}>
                      DOC SHA-256: {cycle.signed_pdf_hash.slice(0, 16)}…
                    </div>
                  )}
                  {cycle.status === 'signed_uploaded' && (
                    <button className="ae-btn ae-btn-grn ae-btn-sm"
                      style={{ marginTop: 10 }}
                      onClick={() => handleRetryAnchor(cycle.id)}>
                      RETRY ANCHOR
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </>
  );
}