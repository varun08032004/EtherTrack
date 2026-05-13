import React, { useContext, useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthContext } from '../App';
import { authAPI } from '../services/api';

const KYCGate = ({ children }) => {
  const { isAuthenticated, kycCompleted, dbUser, handleKycComplete, setDbUser } = useContext(AuthContext);
  const location = useLocation();
  const navigate = useNavigate();

  const [checking, setChecking] = useState(false);
  const [checked,  setChecked]  = useState(false);

  useEffect(() => {
    // Inject Google Font once
    const id = 'dm-mono-font';
    if (!document.getElementById(id)) {
      const link  = document.createElement('link');
      link.id     = id;
      link.rel    = 'stylesheet';
      link.href   = 'https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap';
      document.head.appendChild(link);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated || checked) return;

    // ── Re-fetch /me on every gate mount to ensure fresh KYC status ──
    // This covers:
    //   1. kycCompleted=false but DB is actually verified (stale React state after refresh)
    //   2. kyc_status='submitted' in state but DB moved to 'verified' (admin approved)
    //   3. dbUser not yet loaded at all
    const needsCheck =
      !kycCompleted ||               // might be stale false
      !dbUser ||                     // dbUser not hydrated yet
      dbUser?.kyc_status === 'submitted'; // could have been approved since last load

    if (needsCheck) {
      setChecking(true);
      authAPI.me()
        .then(me => {
          if (!me) return;
          // Always sync dbUser with fresh server data
          setDbUser(prev => ({ ...prev, ...me }));
          if (me.kyc_verified || me.kyc_status === 'verified') {
            handleKycComplete(true);
          }
        })
        .catch(() => {})
        .finally(() => {
          setChecking(false);
          setChecked(true);
        });
    } else {
      setChecked(true);
    }
  }, [isAuthenticated, kycCompleted, dbUser, checked, handleKycComplete, setDbUser]);

  // Not logged in
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Show spinner while re-checking
  if (checking) {
    return (
      <div style={{
        minHeight:'100vh', background:'#080c0a',
        display:'flex', alignItems:'center', justifyContent:'center',
        fontFamily:"'DM Mono',monospace",
      }}>
        <div style={{ textAlign:'center' }}>
          <div style={{
            width:24, height:24,
            border:'2px solid #22c55e22', borderTopColor:'#22c55e',
            borderRadius:'50%', animation:'spin 1s linear infinite',
            margin:'0 auto 12px',
          }}/>
          <div style={{ fontSize:10, color:'#86efac44', letterSpacing:'.1em' }}>
            VERIFYING ACCESS...
          </div>
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  // Use fresh dbUser from the re-fetch (setDbUser merges it above)
  const status = dbUser?.kyc_status;

  const isVerified =
    kycCompleted ||
    status === 'verified' ||
    dbUser?.kyc_verified === true;

  if (isVerified) return children;

  // ── Submitted — waiting for admin ────────────────────────────
  if (status === 'submitted') {
    return (
      <>
        <style>{ANIM}</style>
        <div style={styles.page}>
          <div style={styles.card}>
            <div style={styles.icon}>⏳</div>
            <div style={{ fontSize:9, color:'#facc1577', letterSpacing:'.2em', marginBottom:8 }}>KYC UNDER REVIEW</div>
            <div style={styles.title}>Verification <span style={{ color:'#facc15' }}>Pending</span></div>
            <div style={styles.sub}>
              Your KYC submission is being reviewed by our compliance team.
              This typically takes <strong style={{ color:'#facc15' }}>1–2 business days</strong>.
            </div>
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
                  border:`1px solid ${done ? '#22c55e22' : '#0f2a1a'}`,
                }}>
                  <span style={{ fontSize:16 }}>{icon}</span>
                  <span style={{ flex:1, fontSize:11, color:done?'#22c55e':'#86efac44' }}>{label}</span>
                  <span style={{ fontSize:9, letterSpacing:'.08em', color:done?'#22c55e77':'#86efac22' }}>
                    {done ? 'DONE' : 'PENDING'}
                  </span>
                </div>
              ))}
            </div>
            <div style={styles.notice}>
              📧 You'll receive an email at <strong style={{ color:'#86efac88' }}>{dbUser?.email}</strong> once verified.
            </div>
            <button style={styles.btnOutline} onClick={() => navigate('/dashboard')}>← BACK TO DASHBOARD</button>
          </div>
        </div>
      </>
    );
  }

  // ── Rejected ─────────────────────────────────────────────────
  if (status === 'rejected') {
    return (
      <>
        <style>{ANIM}</style>
        <div style={styles.page}>
          <div style={styles.card}>
            <div style={styles.icon}>❌</div>
            <div style={{ fontSize:9, color:'#f8717177', letterSpacing:'.2em', marginBottom:8 }}>KYC REJECTED</div>
            <div style={styles.title}>Resubmission <span style={{ color:'#f87171' }}>Required</span></div>
            <div style={styles.sub}>
              Your KYC submission was not approved. Please check your email for the reason and resubmit.
            </div>
            <button style={styles.btn} onClick={() => navigate('/kyc')}>RESUBMIT KYC →</button>
            <button style={{ ...styles.btnOutline, marginTop:10 }} onClick={() => navigate('/dashboard')}>← BACK TO DASHBOARD</button>
          </div>
        </div>
      </>
    );
  }

  // ── Not submitted yet ─────────────────────────────────────────
  return (
    <>
      <style>{ANIM}</style>
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.icon}>🔐</div>
          <div style={styles.title}>KYC Verification Required</div>
          <div style={styles.sub}>
            Complete KYC verification to access trading features. Mandatory for all users.
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
          <button style={styles.btn} onClick={() => navigate('/kyc')}>
            COMPLETE KYC VERIFICATION →
          </button>
          <div style={styles.note}>⚡ Takes less than 5 minutes · Your data is secure</div>
        </div>
      </div>
    </>
  );
};

const ANIM = `@keyframes kycFadeUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}`;

const styles = {
  page: {
    minHeight:'100vh', background:'#080c0a',
    fontFamily:"'DM Mono', monospace",
    display:'flex', alignItems:'center', justifyContent:'center',
    backgroundImage:'linear-gradient(rgba(34,197,94,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(34,197,94,0.03) 1px,transparent 1px)',
    backgroundSize:'40px 40px',
  },
  card: {
    position:'relative', zIndex:1,
    background:'#0a0f0c', border:'1px solid #0f2a1a',
    borderRadius:14, padding:'48px 40px',
    maxWidth:440, width:'100%', textAlign:'center',
    boxShadow:'0 24px 64px rgba(0,0,0,0.6)',
    animation:'kycFadeUp 0.5s ease both',
  },
  icon:  { fontSize:40, marginBottom:16 },
  title: { fontSize:20, fontWeight:700, color:'#f0fdf4', marginBottom:8, letterSpacing:'.04em' },
  sub:   { fontSize:12, color:'#86efac66', marginBottom:24, lineHeight:1.8, letterSpacing:'.03em' },
  step:  {
    display:'flex', alignItems:'center', gap:12,
    padding:'10px 14px', borderRadius:7,
    background:'#060a07', border:'1px solid #0f2a1a',
    marginBottom:8, fontSize:12, color:'#e2e8e4',
  },
  stepNum: {
    width:22, height:22, borderRadius:'50%',
    background:'#0d2e1f', border:'1px solid #22c55e33',
    display:'flex', alignItems:'center', justifyContent:'center',
    fontSize:10, color:'#22c55e', flexShrink:0,
  },
  notice: {
    fontSize:10, color:'#86efac44', lineHeight:1.8,
    marginBottom:20, padding:12,
    background:'#040706', borderRadius:8, border:'1px solid #0f2a1a',
  },
  btn: {
    width:'100%', padding:14, borderRadius:8, border:'none',
    background:'linear-gradient(135deg,#16a34a,#15803d)',
    color:'#fff', cursor:'pointer', fontFamily:"'DM Mono',monospace",
    fontSize:13, fontWeight:700, letterSpacing:'.1em', transition:'opacity .2s',
  },
  btnOutline: {
    width:'100%', padding:13, borderRadius:8,
    border:'1px solid #0f2a1a', background:'transparent',
    color:'#86efac44', cursor:'pointer', fontFamily:"'DM Mono',monospace",
    fontSize:12, letterSpacing:'.08em',
  },
  note: { fontSize:10, color:'#4ade8033', marginTop:14, letterSpacing:'.06em' },
};

export default KYCGate;