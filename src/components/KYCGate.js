import React, { useContext, useEffect } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthContext } from '../App';

const KYCGate = ({ children }) => {
  const { isAuthenticated, kycCompleted, dbUser } = useContext(AuthContext);
  const location = useLocation();
  const navigate = useNavigate();

  // Inject Google Font once
  useEffect(() => {
    const id = 'dm-mono-font';
    if (!document.getElementById(id)) {
      const link = document.createElement('link');
      link.id   = id;
      link.rel  = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap';
      document.head.appendChild(link);
    }
  }, []);

  // Not logged in
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const status = dbUser?.kyc_status;

  // ── Fully verified — let through ─────────────────────────────
  if (kycCompleted || status === 'verified') return children;

  // ── Submitted — waiting for admin ────────────────────────────
  if (status === 'submitted') {
    return (
      <>
        <style>{`@keyframes kycFadeUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}`}</style>
        <div style={styles.page}>
          <div style={styles.card}>
            <div style={styles.icon}>⏳</div>
            <div style={{ fontSize:9, color:'#facc1577', letterSpacing:'.2em', marginBottom:8 }}>KYC UNDER REVIEW</div>
            <div style={styles.title}>Verification <span style={{ color:'#facc15' }}>Pending</span></div>
            <div style={styles.sub}>
              Your KYC submission is being reviewed by our compliance team.
              This typically takes <strong style={{ color:'#facc15' }}>1–2 business days</strong>.
            </div>

            {/* Status steps */}
            <div style={{ textAlign:'left', marginBottom:20 }}>
              {[
                { icon:'✅', label:'KYC Submitted',        done:true  },
                { icon:'🔍', label:'Admin Verification',   done:false },
                { icon:'📧', label:'Email Notification',   done:false },
                { icon:'🚀', label:'Full Access Unlocked', done:false },
              ].map(({ icon, label, done }) => (
                <div key={label} style={{
                  display:'flex', alignItems:'center', gap:12,
                  padding:'10px 14px', borderRadius:7, marginBottom:6,
                  background: done ? '#0d2e1f22' : '#060a07',
                  border: `1px solid ${done ? '#22c55e22' : '#0f2a1a'}`,
                }}>
                  <span style={{ fontSize:16 }}>{icon}</span>
                  <span style={{ flex:1, fontSize:11, color: done ? '#22c55e' : '#86efac44' }}>{label}</span>
                  <span style={{ fontSize:9, letterSpacing:'.08em', color: done ? '#22c55e77' : '#86efac22' }}>
                    {done ? 'DONE' : 'PENDING'}
                  </span>
                </div>
              ))}
            </div>

            <div style={styles.notice}>
              📧 You'll receive an email at <strong style={{ color:'#86efac88' }}>{dbUser?.email}</strong> once verified.
              Until then, trading features remain locked.
            </div>
            <button style={styles.btnOutline} onClick={() => navigate('/dashboard')}>
              ← BACK TO DASHBOARD
            </button>
          </div>
        </div>
      </>
    );
  }

  // ── Rejected — ask to resubmit ───────────────────────────────
  if (status === 'rejected') {
    return (
      <>
        <style>{`@keyframes kycFadeUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}`}</style>
        <div style={styles.page}>
          <div style={styles.card}>
            <div style={styles.icon}>❌</div>
            <div style={{ fontSize:9, color:'#f8717177', letterSpacing:'.2em', marginBottom:8 }}>KYC REJECTED</div>
            <div style={styles.title}>Resubmission <span style={{ color:'#f87171' }}>Required</span></div>
            <div style={styles.sub}>
              Your KYC submission was not approved. Please check your email for the reason and resubmit with the correct information.
            </div>
            <button style={styles.btn} onClick={() => navigate('/kyc')}>
              RESUBMIT KYC →
            </button>
            <button style={{ ...styles.btnOutline, marginTop:10 }} onClick={() => navigate('/dashboard')}>
              ← BACK TO DASHBOARD
            </button>
          </div>
        </div>
      </>
    );
  }

  // ── Not submitted yet ─────────────────────────────────────────
  return (
    <>
      <style>{`@keyframes kycFadeUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}`}</style>
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.icon}>🔐</div>
          <div style={styles.title}>KYC Verification Required</div>
          <div style={styles.sub}>
            You need to complete KYC verification before accessing trading features.
            This is mandatory for all users.
          </div>
          <div style={{ textAlign:'left', marginBottom:28 }}>
            {[
              'Provide your personal identity details',
              'Upload a government-issued ID document',
              'Verify your mobile phone number via OTP',
            ].map((s, i) => (
              <div key={i} style={styles.step}>
                <div style={styles.stepNum}>{i + 1}</div>
                <span>{s}</span>
              </div>
            ))}
          </div>
          <button
            style={styles.btn}
            onMouseOver={e => e.target.style.opacity = '0.85'}
            onMouseOut={e  => e.target.style.opacity = '1'}
            onClick={() => navigate('/kyc')}
          >
            COMPLETE KYC VERIFICATION →
          </button>
          <div style={styles.note}>⚡ Takes less than 5 minutes · Your data is secure</div>
        </div>
      </div>
    </>
  );
};

const styles = {
  page: {
    minHeight: '100vh',
    background: '#080c0a',
    fontFamily: "'DM Mono', monospace",
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    backgroundImage:
      'linear-gradient(rgba(34,197,94,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(34,197,94,0.03) 1px, transparent 1px)',
    backgroundSize: '40px 40px',
  },
  card: {
    position: 'relative',
    zIndex: 1,
    background: '#0a0f0c',
    border: '1px solid #0f2a1a',
    borderRadius: '14px',
    padding: '48px 40px',
    maxWidth: '440px',
    width: '100%',
    textAlign: 'center',
    boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
    animation: 'kycFadeUp 0.5s ease both',
  },
  icon:  { fontSize: '40px', marginBottom: '16px' },
  title: { fontSize: '20px', fontWeight: 700, color: '#f0fdf4', marginBottom: '8px', letterSpacing: '0.04em' },
  sub:   { fontSize: '12px', color: '#86efac66', marginBottom: '24px', lineHeight: 1.8, letterSpacing: '0.03em' },
  step: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '10px 14px', borderRadius: '7px',
    background: '#060a07', border: '1px solid #0f2a1a',
    marginBottom: '8px', fontSize: '12px', color: '#e2e8e4',
  },
  stepNum: {
    width: '22px', height: '22px', borderRadius: '50%',
    background: '#0d2e1f', border: '1px solid #22c55e33',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '10px', color: '#22c55e', flexShrink: 0,
  },
  notice: {
    fontSize: '10px', color: '#86efac44', lineHeight: 1.8,
    marginBottom: '20px', padding: '12px',
    background: '#040706', borderRadius: '8px', border: '1px solid #0f2a1a',
  },
  btn: {
    width: '100%', padding: '14px', borderRadius: '8px', border: 'none',
    background: 'linear-gradient(135deg, #16a34a, #15803d)',
    color: '#fff', cursor: 'pointer', fontFamily: "'DM Mono', monospace",
    fontSize: '13px', fontWeight: 700, letterSpacing: '0.1em', transition: 'opacity 0.2s',
  },
  btnOutline: {
    width: '100%', padding: '13px', borderRadius: '8px',
    border: '1px solid #0f2a1a', background: 'transparent',
    color: '#86efac44', cursor: 'pointer', fontFamily: "'DM Mono', monospace",
    fontSize: '12px', letterSpacing: '0.08em',
  },
  note: { fontSize: '10px', color: '#4ade8033', marginTop: '14px', letterSpacing: '0.06em' },
};

export default KYCGate;