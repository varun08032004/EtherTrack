// src/components/KYCGate.jsx — EtherTrack KYC v2 · PRODUCTION-HARDENED - 28/05/2026

import React, { useContext, useEffect, useState, useRef, useCallback, Component } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthContext } from '../App';
import { authAPI } from '../services/api';

// ── Error Boundary ─────────────────────────────────────────────────────────────
class KYCGateErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error) {
    import('@sentry/react').then(S => S.captureException(error, { tags: { component: 'KYCGate' } })).catch(() => {});
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={GATE.page} role="alert" aria-live="assertive">
        <div style={GATE.card}>
          <div style={{ fontSize:40, marginBottom:16, color:'#f87171' }} aria-hidden="true">⚠</div>
          <h1 style={{ fontSize:15, color:'#f0fdf4', fontWeight:700, marginBottom:8 }}>Access check failed</h1>
          <p style={{ fontSize:12, color:'#86efac66', marginBottom:24, lineHeight:1.7 }}>
            Something went wrong verifying your access. Please refresh the page.
          </p>
          <button onClick={() => window.location.reload()} style={GATE.btn} autoFocus>
            Refresh page
          </button>
        </div>
      </div>
    );
  }
}

// ── SSE hook: real-time KYC status push ──────────────────────────────────────
const useKycSseStream = ({ enabled, onApproved, onRejected }) => {
  const esRef       = useRef(null);
  const retryRef    = useRef(0);
  const retryTimer  = useRef(null);

  const connect = useCallback(() => {
    if (!enabled) return;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }

    const es = new EventSource('/api/kyc/stream', { withCredentials: true });
    esRef.current = es;

    es.addEventListener('message', (e) => {
      try {
        const payload = JSON.parse(e.data);
        retryRef.current = 0; // reset backoff on successful message
        if (payload.type === 'kyc.approved') onApproved(payload);
        if (payload.type === 'kyc.rejected') onRejected(payload);
      } catch { /* ignore parse errors */ }
    });

    es.addEventListener('error', () => {
      es.close();
      esRef.current = null;
      // Exponential backoff with jitter: 5s, 10s, 20s, 40s … max 120s
      const base  = Math.min(5000 * Math.pow(2, retryRef.current), 120_000);
      const delay = base + Math.random() * 2000;
      retryRef.current += 1;
      retryTimer.current = setTimeout(connect, delay);
    });
  }, [enabled, onApproved, onRejected]);

  useEffect(() => {
    if (!enabled) return;
    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
      clearTimeout(retryTimer.current);
    };
  }, [enabled, connect]);
};

// ── KYCGateInner ──────────────────────────────────────────────────────────────
const KYCGateInner = ({ children }) => {
  const { isAuthenticated, kycCompleted, dbUser, handleKycComplete, setDbUser } = useContext(AuthContext);
  const location = useLocation();
  const navigate = useNavigate();

  const [checking, setChecking] = useState(false);
  const [checked,  setChecked]  = useState(false);
  const headingRef = useRef(null);

  // On mount: re-fetch /me to get fresh status
  useEffect(() => {
    if (!isAuthenticated || checked) return;
    const needsCheck = !kycCompleted || !dbUser || dbUser?.kyc_status === 'submitted';
    if (!needsCheck) { setChecked(true); return; }

    setChecking(true);
    authAPI.me()
      .then(me => {
        if (!me) return;
        setDbUser(prev => ({ ...prev, ...me }));
        if (me.kyc_verified || me.kyc_status === 'verified') handleKycComplete(true);
      })
      .catch(() => { /* silent — will show gate */ })
      .finally(() => { setChecking(false); setChecked(true); });
  }, [isAuthenticated, kycCompleted, dbUser, checked, handleKycComplete, setDbUser]);

  // SSE push handler
  const handleApproved = useCallback((payload) => {
    authAPI.me().then(me => {
      if (!me) return;
      setDbUser(prev => ({ ...prev, ...me }));
      handleKycComplete(true);
    }).catch(() => {
      // Fallback: trust the SSE payload directly
      setDbUser(prev => ({ ...prev, kyc_status: 'verified', kyc_verified: true, kyc_tier: payload.tier }));
      handleKycComplete(true);
    });
  }, [setDbUser, handleKycComplete]);

  const handleRejected = useCallback(() => {
    setDbUser(prev => ({ ...prev, kyc_status: 'rejected' }));
  }, [setDbUser]);

  // SSE only active when status is 'submitted'
  const sseEnabled = isAuthenticated && dbUser?.kyc_status === 'submitted';
  useKycSseStream({ enabled: sseEnabled, onApproved: handleApproved, onRejected: handleRejected });

  // Focus heading on each gate-state change for screen readers
  useEffect(() => {
    if (!checking) setTimeout(() => headingRef.current?.focus(), 150);
  }, [checking, dbUser?.kyc_status]);

  // ── Guards ───────────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (checking) {
    return (
      <div style={GATE.page} role="status" aria-label="Verifying your access…">
        <div style={{ textAlign:'center' }}>
          <div style={GATE.spinner} aria-hidden="true" />
          <div style={{ fontSize:10, color:'#86efac44', letterSpacing:'.1em', marginTop:12 }}>VERIFYING ACCESS…</div>
        </div>
        <style>{ANIM}</style>
      </div>
    );
  }

  const isVerified =
    kycCompleted ||
    dbUser?.kyc_status === 'verified' ||
    dbUser?.kyc_verified === true;

  if (isVerified) return children;

  // ── Submitted: waiting for admin ────────────────────────────────────────
  if (dbUser?.kyc_status === 'submitted') {
    return (
      <>
        <style>{ANIM}</style>
        <div style={GATE.page} role="main">
          <div style={GATE.card}>
            <div style={{ fontSize:40, marginBottom:16 }} aria-hidden="true">⏳</div>
            <div style={{ fontSize:9, color:'#facc1577', letterSpacing:'.2em', marginBottom:8 }}>KYC UNDER REVIEW</div>
            <h1 ref={headingRef} tabIndex={-1} style={{ ...GATE.title, outline:'none' }}>
              Verification <span style={{ color:'#facc15' }}>Pending</span>
            </h1>
            <p style={GATE.sub}>
              Your submission is being reviewed. This typically takes{' '}
              <strong style={{ color:'#facc15' }}>1–2 business days</strong>.
            </p>

            <div style={{ fontSize:10, color:'#22c55e55', marginBottom:16, padding:'8px 12px', background:'#0d2e1f22', borderRadius:6, border:'1px solid #22c55e11' }} role="note">
              ⚡ This page updates automatically when your KYC is approved — no refresh needed.
            </div>

            <div role="list" aria-label="KYC progress steps" style={{ textAlign:'left', marginBottom:20 }}>
              {[
                { icon:'✅', label:'KYC submitted',       done:true  },
                { icon:'🔍', label:'Admin verification',  done:false },
                { icon:'📧', label:'Email notification',  done:false },
                { icon:'🚀', label:'Full access unlocked', done:false },
              ].map(({ icon, label, done }) => (
                <div key={label} role="listitem" style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', borderRadius:7, marginBottom:6, background: done?'#0d2e1f22':'#060a07', border:`1px solid ${done?'#22c55e22':'#0f2a1a'}` }}>
                  <span style={{ fontSize:16 }} aria-hidden="true">{icon}</span>
                  <span style={{ flex:1, fontSize:11, color: done?'#22c55e':'#86efac44' }}>{label}</span>
                  <span style={{ fontSize:9, letterSpacing:'.08em', color: done?'#22c55e77':'#86efac22' }}>
                    {done ? 'DONE' : 'PENDING'}
                  </span>
                </div>
              ))}
            </div>

            <div style={GATE.notice}>
              📧 You'll receive an email at{' '}
              <strong style={{ color:'#86efac88' }}>{dbUser?.email}</strong> once verified.
            </div>
            <button style={GATE.btnOutline} onClick={() => navigate('/dashboard')}>← Back to dashboard</button>
          </div>
        </div>
      </>
    );
  }

  // ── Rejected ────────────────────────────────────────────────────────────
  if (dbUser?.kyc_status === 'rejected') {
    return (
      <>
        <style>{ANIM}</style>
        <div style={GATE.page} role="main">
          <div style={GATE.card}>
            <div style={{ fontSize:40, marginBottom:16 }} aria-hidden="true">❌</div>
            <div style={{ fontSize:9, color:'#f8717177', letterSpacing:'.2em', marginBottom:8 }}>KYC REJECTED</div>
            <h1 ref={headingRef} tabIndex={-1} style={{ ...GATE.title, color:'#f87171', outline:'none' }}>
              Resubmission Required
            </h1>
            <p style={GATE.sub}>
              Your KYC submission was not approved. Please check your email for the specific reason and resubmit with correct information.
            </p>
            <button style={GATE.btn} onClick={() => navigate('/kyc')} autoFocus>Resubmit KYC →</button>
            <button style={{ ...GATE.btnOutline, marginTop:10 }} onClick={() => navigate('/dashboard')}>← Back to dashboard</button>
          </div>
        </div>
      </>
    );
  }

  // ── Not started ─────────────────────────────────────────────────────────
  return (
    <>
      <style>{ANIM}</style>
      <div style={GATE.page} role="main">
        <div style={GATE.card}>
          <div style={{ fontSize:40, marginBottom:16 }} aria-hidden="true">🔐</div>
          <h1 ref={headingRef} tabIndex={-1} style={{ ...GATE.title, outline:'none' }}>KYC Verification Required</h1>
          <p style={GATE.sub}>
            Complete KYC to access trading features. Required under SEBI and RBI guidelines.
          </p>

          <ol style={{ textAlign:'left', marginBottom:28, listStyle:'none', padding:0 }} aria-label="KYC steps">
            {[
              'Provide your personal identity details',
              'Upload a government-issued ID document',
              'Verify your mobile number via OTP',
            ].map((s, i) => (
              <li key={i} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', borderRadius:7, background:'#060a07', border:'1px solid #0f2a1a', marginBottom:8, fontSize:12, color:'#e2e8e4' }}>
                <div style={{ width:22, height:22, borderRadius:'50%', background:'#0d2e1f', border:'1px solid #22c55e33', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, color:'#22c55e', flexShrink:0 }}>{i + 1}</div>
                <span>{s}</span>
              </li>
            ))}
          </ol>

          <button style={GATE.btn} onClick={() => navigate('/kyc')} autoFocus>
            Complete KYC verification →
          </button>
          <p style={{ fontSize:10, color:'#4ade8033', marginTop:14, letterSpacing:'.06em' }}>
            ⚡ Takes less than 5 minutes · Your data is secure
          </p>
        </div>
      </div>
    </>
  );
};

// ── Styles + animation ────────────────────────────────────────────────────────
const ANIM = `@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}`;

const GATE = {
  page:     { minHeight:'100vh', background:'#080c0a', fontFamily:"'DM Mono',monospace", display:'flex', alignItems:'center', justifyContent:'center', backgroundImage:'linear-gradient(rgba(34,197,94,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(34,197,94,0.03) 1px,transparent 1px)', backgroundSize:'40px 40px', padding:20 },
  card:     { position:'relative', background:'#0a0f0c', border:'1px solid #0f2a1a', borderRadius:14, padding:'48px 40px', maxWidth:440, width:'100%', textAlign:'center', boxShadow:'0 24px 64px rgba(0,0,0,.6)', animation:'fadeUp .5s ease both' },
  title:    { fontSize:20, fontWeight:700, color:'#f0fdf4', marginBottom:8, letterSpacing:'.04em' },
  sub:      { fontSize:12, color:'#86efac66', marginBottom:24, lineHeight:1.8, letterSpacing:'.03em' },
  notice:   { fontSize:10, color:'#86efac44', lineHeight:1.8, marginBottom:20, padding:12, background:'#040706', borderRadius:8, border:'1px solid #0f2a1a' },
  btn:      { width:'100%', padding:14, borderRadius:8, border:'none', background:'linear-gradient(135deg,#16a34a,#15803d)', color:'#fff', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:700, letterSpacing:'.1em', transition:'opacity .2s', display:'block' },
  btnOutline:{ width:'100%', padding:13, borderRadius:8, border:'1px solid #0f2a1a', background:'transparent', color:'#86efac44', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:12, letterSpacing:'.08em', display:'block' },
  spinner:  { width:24, height:24, border:'2px solid #22c55e22', borderTopColor:'#22c55e', borderRadius:'50%', animation:'spin 1s linear infinite', margin:'0 auto' },
};

// ── Export ────────────────────────────────────────────────────────────────────
export default function KYCGate(props) {
  return (
    <KYCGateErrorBoundary>
      <KYCGateInner {...props} />
    </KYCGateErrorBoundary>
  );
}
