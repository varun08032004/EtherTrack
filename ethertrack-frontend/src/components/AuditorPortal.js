// src/pages/AuditorPortal.jsx
// Public auditor-facing verification portal
// Accessed via /verify-audit/:token — no EtherTrack login required
// Auditor: reviews cycle info → uploads signed PDF → gets seal confirmation
//
// Add to your router:
//   <Route path="/verify-audit/:token" element={<AuditorPortal />} />

import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';

const CHAIN_EXPLORER = 'https://sepolia.etherscan.io/tx';
const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #040806;
    --surf: #070d0a;
    --surf2: #0a1410;
    --brd: #0f2018;
    --brd2: #162a1f;
    --grn: #22c55e;
    --grn2: #16a34a;
    --grn-dim: #10b98166;
    --txt: #edf5f0;
    --mut: #4a7a5a;
    --mut2: #2a4a35;
    --red: #ef4444;
    --ylw: #f59e0b;
    --eth: #627eea;
    --pur: #a855f7;
  }

  body {
    background: var(--bg);
    color: var(--txt);
    font-family: 'IBM Plex Sans', sans-serif;
    font-size: 14px;
    line-height: 1.6;
    min-height: 100vh;
  }

  /* ── layout ── */
  .ap-wrap {
    max-width: 680px;
    margin: 0 auto;
    padding: 40px 24px 80px;
  }

  /* ── top bar ── */
  .ap-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 24px;
    border-bottom: 1px solid var(--brd);
    background: var(--surf);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .ap-topbar-brand {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    color: var(--grn);
    letter-spacing: .12em;
    font-weight: 600;
  }
  .ap-topbar-tag {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: var(--mut);
    letter-spacing: .1em;
  }

  /* ── header ── */
  .ap-header {
    padding: 36px 0 28px;
    border-bottom: 1px solid var(--brd);
    margin-bottom: 28px;
  }
  .ap-header-eyebrow {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    letter-spacing: .18em;
    color: var(--grn);
    margin-bottom: 10px;
    text-transform: uppercase;
  }
  .ap-header-title {
    font-family: 'IBM Plex Sans', sans-serif;
    font-size: 26px;
    font-weight: 700;
    color: var(--txt);
    line-height: 1.2;
    margin-bottom: 8px;
  }
  .ap-header-sub {
    font-size: 13px;
    color: var(--mut);
    line-height: 1.7;
  }

  /* ── cards ── */
  .ap-card {
    background: var(--surf);
    border: 1px solid var(--brd);
    border-radius: 10px;
    padding: 20px 22px;
    margin-bottom: 14px;
  }
  .ap-card-title {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    letter-spacing: .14em;
    color: var(--mut);
    margin-bottom: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ap-card-title::before {
    content: '';
    width: 12px;
    height: 1px;
    background: var(--grn);
    flex-shrink: 0;
  }

  /* ── entity info ── */
  .ap-entity-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .ap-field {
    background: var(--surf2);
    border: 1px solid var(--brd);
    border-radius: 7px;
    padding: 10px 13px;
  }
  .ap-field-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    letter-spacing: .12em;
    color: var(--mut);
    margin-bottom: 4px;
    text-transform: uppercase;
  }
  .ap-field-value {
    font-size: 13px;
    font-weight: 600;
    color: var(--txt);
  }
  .ap-field-value.grn { color: var(--grn); }
  .ap-field-value.eth { color: var(--eth); }

  /* ── steps ── */
  .ap-steps { display: flex; flex-direction: column; gap: 0; }
  .ap-step {
    display: grid;
    grid-template-columns: 32px 1fr;
    gap: 14px;
    padding: 14px 0;
    border-bottom: 1px solid var(--brd2);
    position: relative;
  }
  .ap-step:last-child { border-bottom: none; }
  .ap-step-num {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1px solid var(--grn-dim);
    color: var(--grn);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .ap-step-num.done {
    background: var(--grn);
    border-color: var(--grn);
    color: #040806;
  }
  .ap-step-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--txt);
    margin-bottom: 3px;
  }
  .ap-step-desc {
    font-size: 12px;
    color: var(--mut);
    line-height: 1.6;
  }

  /* ── upload zone ── */
  .ap-upload-zone {
    border: 2px dashed var(--brd2);
    border-radius: 10px;
    padding: 32px 24px;
    text-align: center;
    cursor: pointer;
    transition: all .2s;
    background: var(--surf2);
    position: relative;
  }
  .ap-upload-zone:hover, .ap-upload-zone.drag {
    border-color: var(--grn-dim);
    background: #0a1a10;
  }
  .ap-upload-zone input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
    width: 100%;
    height: 100%;
  }
  .ap-upload-icon { font-size: 32px; margin-bottom: 10px; }
  .ap-upload-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--txt);
    margin-bottom: 5px;
  }
  .ap-upload-sub { font-size: 12px; color: var(--mut); }
  .ap-upload-file {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    background: #0a1a10;
    border: 1px solid var(--grn-dim);
    border-radius: 8px;
    margin-top: 14px;
    text-align: left;
  }
  .ap-upload-file-name { font-size: 12px; color: var(--grn); font-weight: 600; flex: 1; }
  .ap-upload-file-size { font-size: 11px; color: var(--mut); }

  /* ── inputs ── */
  .ap-fg { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
  .ap-lbl {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    letter-spacing: .1em;
    color: var(--mut);
    text-transform: uppercase;
  }
  .ap-inp {
    padding: 10px 13px;
    border-radius: 7px;
    background: var(--surf2);
    border: 1px solid var(--brd2);
    color: var(--txt);
    font-family: 'IBM Plex Sans', sans-serif;
    font-size: 13px;
    outline: none;
    width: 100%;
    transition: border-color .2s;
  }
  .ap-inp:focus { border-color: var(--grn-dim); }
  .ap-inp::placeholder { color: var(--mut); opacity: .7; }
  .ap-inp.err { border-color: #ef444466; }

  /* ── buttons ── */
  .ap-btn {
    padding: 12px 22px;
    border-radius: 7px;
    border: none;
    cursor: pointer;
    font-family: 'IBM Plex Sans', sans-serif;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: .02em;
    transition: all .2s;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .ap-btn:disabled { opacity: .45; cursor: not-allowed; }
  .ap-btn-grn {
    background: var(--grn);
    color: #040806;
    width: 100%;
    justify-content: center;
  }
  .ap-btn-grn:hover:not(:disabled) { background: var(--grn2); }
  .ap-btn-g {
    background: var(--surf2);
    border: 1px solid var(--brd2);
    color: var(--txt);
  }
  .ap-btn-g:hover:not(:disabled) { border-color: var(--grn-dim); }

  /* ── progress bar ── */
  .ap-progress {
    height: 3px;
    background: var(--brd2);
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 16px;
  }
  .ap-progress-fill {
    height: 100%;
    background: var(--grn);
    border-radius: 2px;
    transition: width .4s ease;
  }

  /* ── alerts ── */
  .ap-alert {
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 12px;
    display: flex;
    gap: 10px;
    line-height: 1.7;
    margin-bottom: 14px;
  }
  .ap-alert-grn { background: #10b98108; border: 1px solid #10b98133; color: #10b981; }
  .ap-alert-ylw { background: #f59e0b08; border: 1px solid #f59e0b33; color: #f59e0b; }
  .ap-alert-red { background: #ef444408; border: 1px solid #ef444433; color: #ef4444; }
  .ap-alert-eth { background: #627eea08; border: 1px solid #627eea33; color: #8da4f5; }

  /* ── seal confirmation ── */
  .ap-seal {
    border-radius: 12px;
    padding: 28px 24px;
    background: #040f08;
    border: 1px solid #10b98133;
    text-align: center;
    margin-top: 8px;
  }
  .ap-seal-icon { font-size: 48px; margin-bottom: 14px; }
  .ap-seal-title {
    font-family: 'IBM Plex Sans', sans-serif;
    font-size: 20px;
    font-weight: 700;
    color: #10b981;
    margin-bottom: 8px;
  }
  .ap-seal-sub { font-size: 13px; color: var(--mut); line-height: 1.7; margin-bottom: 20px; }
  .ap-hash-box {
    background: var(--surf2);
    border: 1px solid var(--brd2);
    border-radius: 7px;
    padding: 10px 14px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: var(--grn);
    word-break: break-all;
    text-align: left;
    margin-bottom: 10px;
  }
  .ap-hash-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 9px;
    letter-spacing: .12em;
    color: var(--mut);
    margin-bottom: 4px;
    text-transform: uppercase;
  }
  .ap-etherscan-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 9px 18px;
    border-radius: 7px;
    background: #627eea12;
    border: 1px solid #627eea33;
    color: var(--eth);
    font-size: 12px;
    font-weight: 600;
    text-decoration: none;
    transition: all .2s;
    margin-top: 6px;
  }
  .ap-etherscan-link:hover { background: #627eea22; }

  /* ── status badge ── */
  .ap-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    padding: 4px 10px;
    border-radius: 4px;
    letter-spacing: .08em;
    font-weight: 600;
  }
  .ap-badge-grn { background: #10b98112; color: #10b981; border: 1px solid #10b98133; }
  .ap-badge-ylw { background: #f59e0b12; color: #f59e0b; border: 1px solid #f59e0b33; }
  .ap-badge-blu { background: #3b82f612; color: #3b82f6; border: 1px solid #3b82f633; }
  .ap-badge-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }

  /* ── expired / error states ── */
  .ap-error-wrap {
    padding: 60px 24px;
    text-align: center;
  }
  .ap-error-icon { font-size: 48px; margin-bottom: 16px; }
  .ap-error-title { font-size: 20px; font-weight: 700; color: var(--txt); margin-bottom: 8px; }
  .ap-error-sub { font-size: 13px; color: var(--mut); line-height: 1.7; }

  /* ── loading ── */
  .ap-loading {
    padding: 80px 24px;
    text-align: center;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    letter-spacing: .14em;
    color: var(--mut);
  }

  /* ── footer ── */
  .ap-footer {
    margin-top: 48px;
    padding-top: 20px;
    border-top: 1px solid var(--brd);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: var(--mut2);
    letter-spacing: .08em;
    line-height: 1.8;
    text-align: center;
  }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .fade-up { animation: fadeUp .4s ease both; }

  @media (max-width: 600px) {
    .ap-entity-grid { grid-template-columns: 1fr; }
    .ap-wrap { padding: 24px 16px 60px; }
    .ap-header-title { font-size: 20px; }
  }
`;

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';

const fmtSize = (bytes) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const PACKAGE_LABELS = {
  standard: 'Standard Assurance (ISO 14064-3 Limited)',
  brsr:     'BRSR Core Audit Package (SEBI)',
  full:     'Full Forensic Package (Reasonable Assurance)',
};

export default function AuditorPortal() {
  const { token } = useParams();

  const [state,        setState]       = useState('loading'); // loading | ready | expired | error | sealed | done
  const [cycle,        setCycle]       = useState(null);
  const [entity,       setEntity]      = useState(null);
  const [errorMsg,     setErrorMsg]    = useState('');

  // upload form
  const [file,         setFile]        = useState(null);
  const [drag,         setDrag]        = useState(false);
  const [auditorName,  setAuditorName] = useState('');
  const [auditorEmail, setAuditorEmail]= useState('');
  const [notes,        setNotes]       = useState('');
  const [uploading,    setUploading]   = useState(false);
  const [uploadPct,    setUploadPct]   = useState(0);
  const [result,       setResult]      = useState(null); // seal result
  const [fieldErr,     setFieldErr]    = useState({});

  const fileRef = useRef(null);

  // ── fetch cycle info on mount ─────────────────────────────────────────
  useEffect(() => {
    if (!token || !token.startsWith('et_verify_')) {
      setState('error');
      setErrorMsg('Invalid verification link.');
      return;
    }

    fetch(`${API_BASE}/api/audit/verify/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          if (data.error.toLowerCase().includes('expired')) {
            setState('expired');
          } else if (data.error.toLowerCase().includes('not found')) {
            setState('error');
            setErrorMsg('This verification link does not exist.');
          } else {
            setState('error');
            setErrorMsg(data.error);
          }
          return;
        }

        setCycle(data.cycle);
        setEntity(data.entity);

        if (data.sealed || data.cycle?.status === 'sealed') {
          setState('sealed');
        } else {
          setState('ready');
        }
      })
      .catch(() => {
        setState('error');
        setErrorMsg('Failed to load verification details. Please try again.');
      });
  }, [token]);

  // ── drag & drop ───────────────────────────────────────────────────────
  const handleDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && dropped.type === 'application/pdf') {
      setFile(dropped);
    } else {
      alert('Please upload a PDF file.');
    }
  };

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (f) setFile(f);
  };

  // ── validate ──────────────────────────────────────────────────────────
  const validate = () => {
    const errs = {};
    if (!file)         errs.file  = 'Please upload your signed PDF';
    if (!auditorName.trim()) errs.name = 'Your name is required';
    if (!auditorEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(auditorEmail)) {
      errs.email = 'Valid email is required';
    }
    setFieldErr(errs);
    return Object.keys(errs).length === 0;
  };

  // ── upload signed PDF ─────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!validate() || uploading) return;

    setUploading(true);
    setUploadPct(10);

    try {
      const formData = new FormData();
      formData.append('signed_pdf',    file);
      formData.append('auditor_name',  auditorName.trim());
      formData.append('auditor_email', auditorEmail.trim().toLowerCase());
      formData.append('notes',         notes.trim());

      setUploadPct(30);

      const res = await fetch(`${API_BASE}/api/audit/verify/${token}/upload`, {
        method: 'POST',
        body:   formData,
      });

      setUploadPct(75);

      const data = await res.json();

      setUploadPct(100);

      if (!res.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      setResult(data);
      setState('done');

    } catch (err) {
      setFieldErr({ submit: err.message || 'Upload failed. Please try again.' });
      setUploading(false);
      setUploadPct(0);
    }
  };

  // ── renders ───────────────────────────────────────────────────────────

  const TopBar = () => (
    <div className="ap-topbar">
      <div className="ap-topbar-brand">⬡ ETHERTRACK</div>
      <div className="ap-topbar-tag">AUDITOR VERIFICATION PORTAL</div>
    </div>
  );

  if (state === 'loading') return (
    <>
      <style>{CSS}</style>
      <TopBar />
      <div className="ap-loading">LOADING VERIFICATION DETAILS…</div>
    </>
  );

  if (state === 'expired') return (
    <>
      <style>{CSS}</style>
      <TopBar />
      <div className="ap-wrap">
        <div className="ap-error-wrap fade-up">
          <div className="ap-error-icon">⏱</div>
          <div className="ap-error-title">This link has expired</div>
          <div className="ap-error-sub">
            Verification links are valid for 30 days.<br/>
            Ask the company to generate a new verification package from their EtherTrack dashboard.
          </div>
        </div>
      </div>
    </>
  );

  if (state === 'error') return (
    <>
      <style>{CSS}</style>
      <TopBar />
      <div className="ap-wrap">
        <div className="ap-error-wrap fade-up">
          <div className="ap-error-icon">✕</div>
          <div className="ap-error-title">Link not found</div>
          <div className="ap-error-sub">
            {errorMsg || 'This verification link does not exist or has been cancelled.'}<br/>
            If you believe this is an error, contact the company that sent you this link.
          </div>
        </div>
      </div>
    </>
  );

  if (state === 'sealed') return (
    <>
      <style>{CSS}</style>
      <TopBar />
      <div className="ap-wrap fade-up">
        <div className="ap-header">
          <div className="ap-header-eyebrow">ISO 14064-3 · GHG PROTOCOL · SEPOLIA</div>
          <div className="ap-header-title">Inventory Already Sealed</div>
          <div className="ap-header-sub">
            This GHG inventory has been verified and sealed on-chain. No further action required.
          </div>
        </div>

        <div className="ap-seal">
          <div className="ap-seal-icon">🔒</div>
          <div className="ap-seal-title">Sealed on Ethereum</div>
          <div className="ap-seal-sub">
            {entity?.companyName && <><strong style={{ color: 'var(--txt)' }}>{entity.companyName}</strong> · </>}
            FY {cycle?.year} · {PACKAGE_LABELS[cycle?.package_type] || cycle?.package_type}
          </div>
          {cycle?.sealTxHash && (
            <>
              <div className="ap-hash-label">ON-CHAIN TRANSACTION</div>
              <div className="ap-hash-box">{cycle.sealTxHash}</div>
              <a href={`${CHAIN_EXPLORER}/${cycle.sealTxHash}`}
                target="_blank" rel="noreferrer"
                className="ap-etherscan-link">
                ⬡ Verify on Etherscan ↗
              </a>
            </>
          )}
        </div>
      </div>
    </>
  );

  if (state === 'done' && result) return (
    <>
      <style>{CSS}</style>
      <TopBar />
      <div className="ap-wrap fade-up">
        <div className="ap-header">
          <div className="ap-header-eyebrow">ISO 14064-3 · GHG PROTOCOL · SEPOLIA</div>
          <div className="ap-header-title">Verification Complete</div>
          <div className="ap-header-sub">
            Your signed document has been received{result.sealed ? ' and anchored on Ethereum' : ''}.
          </div>
        </div>

        <div className="ap-seal">
          <div className="ap-seal-icon">{result.sealed ? '⬡' : '✓'}</div>
          <div className="ap-seal-title">
            {result.sealed ? 'Sealed on Ethereum' : 'Document Received'}
          </div>
          <div className="ap-seal-sub">
            {result.sealed
              ? 'The SHA-256 hash of your signed document is permanently anchored on Sepolia. This seal is immutable and independently verifiable by anyone.'
              : 'Your document has been saved. The company will anchor the hash on-chain shortly.'}
          </div>

          <div style={{ textAlign: 'left' }}>
            <div className="ap-hash-label">DOCUMENT SHA-256 HASH</div>
            <div className="ap-hash-box">{result.fileHash}</div>

            {result.sealTxHash && (
              <>
                <div className="ap-hash-label" style={{ marginTop: 12 }}>ON-CHAIN TRANSACTION</div>
                <div className="ap-hash-box">{result.sealTxHash}</div>
                <a href={`${CHAIN_EXPLORER}/${result.sealTxHash}`}
                  target="_blank" rel="noreferrer"
                  className="ap-etherscan-link">
                  ⬡ Verify on Etherscan ↗
                </a>
              </>
            )}
          </div>

          <div style={{ marginTop: 20, padding: '12px 16px', background: 'var(--surf2)', borderRadius: 8, textAlign: 'left' }}>
            <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: 10, letterSpacing: '.1em', color: 'var(--mut)', marginBottom: 8 }}>
              WHAT THIS MEANS
            </div>
            <div style={{ fontSize: 12, color: 'var(--mut)', lineHeight: 1.8 }}>
              The company's BRSR, CDP, and TCFD reports can now reference this verification seal.
              The Etherscan link above is the publicly verifiable proof — anyone can open it and
              confirm the document hash matches the signed PDF you uploaded.
            </div>
          </div>
        </div>
      </div>
    </>
  );

  // ── main ready state ──────────────────────────────────────────────────
  return (
    <>
      <style>{CSS}</style>
      <TopBar />
      <div className="ap-wrap fade-up">

        {/* header */}
        <div className="ap-header">
          <div className="ap-header-eyebrow">ISO 14064-3 · GHG PROTOCOL · BLOCKCHAIN-VERIFIED</div>
          <div className="ap-header-title">GHG Inventory Verification</div>
          <div className="ap-header-sub">
            You've been invited to verify and seal the GHG inventory below.
            Review the data, sign the verification document, and upload it here.
            Your signature will be hashed and permanently anchored on Ethereum.
          </div>
        </div>

        {/* entity info */}
        <div className="ap-card">
          <div className="ap-card-title">REPORTING ENTITY</div>
          <div className="ap-entity-grid">
            <div className="ap-field">
              <div className="ap-field-label">Company</div>
              <div className="ap-field-value">{entity?.companyName || '—'}</div>
            </div>
            <div className="ap-field">
              <div className="ap-field-label">CIN</div>
              <div className="ap-field-value">{entity?.companyCin || '—'}</div>
            </div>
            <div className="ap-field">
              <div className="ap-field-label">Reporting Year</div>
              <div className="ap-field-value grn">FY {cycle?.year}</div>
            </div>
            <div className="ap-field">
              <div className="ap-field-label">Industry</div>
              <div className="ap-field-value">{entity?.industry || '—'}</div>
            </div>
            <div className="ap-field" style={{ gridColumn: '1 / -1' }}>
              <div className="ap-field-label">Verification Package</div>
              <div className="ap-field-value">{PACKAGE_LABELS[cycle?.package_type] || cycle?.package_type}</div>
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="ap-badge ap-badge-blu">
              <span className="ap-badge-dot"/>
              UNDER REVIEW
            </span>
            <span style={{ fontSize: 11, color: 'var(--mut)' }}>
              Link expires {fmtDate(cycle?.expiresAt)}
            </span>
          </div>
        </div>

        {/* instructions */}
        <div className="ap-card">
          <div className="ap-card-title">WHAT YOU NEED TO DO</div>
          <div className="ap-steps">
            {[
              {
                title: 'Receive the verification package',
                desc:  'The company has emailed you the GHG inventory report PDF. This is the document you will sign.',
              },
              {
                title: 'Review the GHG data',
                desc:  'Verify the emission records, methodologies, emission factors, and scope boundaries against the evidence the company provided.',
              },
              {
                title: 'Sign using your DSC / emSigner',
                desc:  'Open the PDF in emSigner (or your firm\'s signing tool — Leegality, SignDesk, etc.). Apply your Digital Signature Certificate. Save the signed PDF.',
              },
              {
                title: 'Upload the signed PDF below',
                desc:  'Upload your signed PDF using the form below. The backend will compute a SHA-256 hash and anchor it on Ethereum Sepolia as the immutable seal.',
              },
            ].map((step, i) => (
              <div key={i} className="ap-step">
                <div className="ap-step-num">{i + 1}</div>
                <div>
                  <div className="ap-step-title">{step.title}</div>
                  <div className="ap-step-desc">{step.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* upload form */}
        <div className="ap-card">
          <div className="ap-card-title">UPLOAD SIGNED VERIFICATION DOCUMENT</div>

          {/* drop zone */}
          <div
            className={`ap-upload-zone${drag ? ' drag' : ''}`}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleFileChange}
              onClick={e => e.stopPropagation()}
            />
            {!file ? (
              <>
                <div className="ap-upload-icon">📄</div>
                <div className="ap-upload-title">Drop your signed PDF here</div>
                <div className="ap-upload-sub">or click to browse · PDF only · max 20MB</div>
              </>
            ) : (
              <>
                <div className="ap-upload-icon">✓</div>
                <div className="ap-upload-title" style={{ color: 'var(--grn)' }}>File ready</div>
                <div className="ap-upload-file" onClick={e => e.stopPropagation()}>
                  <span style={{ fontSize: 18 }}>📑</span>
                  <span className="ap-upload-file-name">{file.name}</span>
                  <span className="ap-upload-file-size">{fmtSize(file.size)}</span>
                  <button
                    style={{ background: 'none', border: 'none', color: 'var(--mut)', cursor: 'pointer', fontSize: 16 }}
                    onClick={e => { e.stopPropagation(); setFile(null); }}>
                    ✕
                  </button>
                </div>
              </>
            )}
          </div>
          {fieldErr.file && (
            <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 6 }}>{fieldErr.file}</div>
          )}

          {/* auditor details */}
          <div style={{ height: 18 }}/>
          <div className="ap-fg">
            <label className="ap-lbl">YOUR FULL NAME *</label>
            <input
              className={`ap-inp${fieldErr.name ? ' err' : ''}`}
              type="text"
              placeholder="e.g. Rahul Sharma"
              value={auditorName}
              onChange={e => { setAuditorName(e.target.value); setFieldErr(f => ({ ...f, name: '' })); }}
              maxLength={200}
            />
            {fieldErr.name && <div style={{ fontSize: 11, color: 'var(--red)' }}>{fieldErr.name}</div>}
          </div>

          <div className="ap-fg">
            <label className="ap-lbl">YOUR EMAIL *</label>
            <input
              className={`ap-inp${fieldErr.email ? ' err' : ''}`}
              type="email"
              placeholder="auditor@bv.com"
              value={auditorEmail}
              onChange={e => { setAuditorEmail(e.target.value); setFieldErr(f => ({ ...f, email: '' })); }}
              maxLength={254}
            />
            {fieldErr.email && <div style={{ fontSize: 11, color: 'var(--red)' }}>{fieldErr.email}</div>}
          </div>

          <div className="ap-fg">
            <label className="ap-lbl">VERIFICATION NOTES (optional)</label>
            <input
              className="ap-inp"
              type="text"
              placeholder="e.g. Limited assurance — ISO 14064-3 Type 1 · Engagement ref: BV-IN-2025-4821"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              maxLength={500}
            />
          </div>

          {/* progress */}
          {uploading && (
            <div className="ap-progress" style={{ marginTop: 4 }}>
              <div className="ap-progress-fill" style={{ width: `${uploadPct}%` }}/>
            </div>
          )}

          {/* submit error */}
          {fieldErr.submit && (
            <div className="ap-alert ap-alert-red" style={{ marginBottom: 12 }}>
              <span>✕</span>
              <span>{fieldErr.submit}</span>
            </div>
          )}

          {/* what happens note */}
          <div className="ap-alert ap-alert-eth" style={{ marginBottom: 16 }}>
            <span>⬡</span>
            <div>
              When you submit, a SHA-256 hash of your signed PDF is computed server-side and written
              as a transaction to Ethereum Sepolia. The raw PDF is stored securely. Neither the hash
              nor the blockchain record can be altered after submission.
            </div>
          </div>

          <button
            className="ap-btn ap-btn-grn"
            onClick={handleUpload}
            disabled={uploading || !file}>
            {uploading
              ? `UPLOADING${uploadPct < 100 ? ` — ${uploadPct}%` : '…'}`
              : '⬡ SUBMIT SIGNED DOCUMENT + SEAL ON ETHEREUM'}
          </button>
        </div>

        {/* footer */}
        <div className="ap-footer">
          ETHERTRACK TECHNOLOGIES PRIVATE LIMITED<br/>
          ISO 14064-3 · GHG Protocol · SEBI BRSR · Ethereum Sepolia<br/>
          This portal is secure and does not require an EtherTrack account.
        </div>

      </div>
    </>
  );
}