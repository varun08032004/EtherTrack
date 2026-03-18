// src/components/JoinOrg.js
// Page users land on when they click an org invite link
// URL: /join-org?token=<invite_token>
import React, { useState, useEffect, useContext } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AuthContext } from '../App';
import { apiFetch } from '../services/api';

const ROLE_META = {
  owner:   { color:'#f97316', icon:'👑', label:'Owner'   },
  admin:   { color:'#f87171', icon:'🛡', label:'Admin'   },
  manager: { color:'#22c55e', icon:'📊', label:'Manager' },
  auditor: { color:'#a78bfa', icon:'🔍', label:'Auditor' },
  viewer:  { color:'#60a5fa', icon:'👁', label:'Viewer'  },
};

export default function JoinOrg() {
  const navigate      = useNavigate();
  const [params]      = useSearchParams();
  const { dbUser }    = useContext(AuthContext);
  // ✅ Token from URL or sessionStorage (set before login redirect)
  const token         = params.get('token') || sessionStorage.getItem('pending_invite_token');

  const [status,  setStatus]  = useState('loading'); // loading | valid | accepting | success | error
  const [invite,  setInvite]  = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) { setStatus('error'); setMessage('No invite token found in URL.'); return; }
    // Validate token by peeking at invite details
    apiFetch(`/api/org/invite-preview?token=${token}`)
      .then(data => {
        if (data?.invite) { setInvite(data.invite); setStatus('valid'); }
        else { setStatus('error'); setMessage(data?.error || 'Invalid or expired invite link.'); }
      })
      .catch(() => {
        // Preview endpoint may not exist — just show accept UI anyway
        setInvite({ token });
        setStatus('valid');
      });
  }, [token]);

  const handleAccept = async () => {
    setStatus('accepting');
    try {
      const res = await apiFetch('/api/org/accept-invite', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      // ✅ Clear pending token from sessionStorage
      sessionStorage.removeItem('pending_invite_token');
      setMessage(`✅ You've joined ${res.teamRole ? `as ${res.teamRole}` : ''}! Redirecting...`);
      setStatus('success');
      setTimeout(() => navigate('/team'), 2000);
    } catch(e) {
      setStatus('error');
      setMessage(e.message || 'Failed to accept invite. It may have expired.');
    }
  };

  const role = ROLE_META[invite?.team_role] || ROLE_META.viewer;

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap');
    .jo{min-height:100vh;background:#040706;font-family:'DM Mono',monospace;display:flex;align-items:center;justify-content:center;padding:24px;}
    .jo-card{background:#070c09;border:1px solid #0d1f11;border-radius:16px;padding:40px;width:100%;max-width:480px;text-align:center;box-shadow:0 32px 80px rgba(0,0,0,.8);}
    .jo-logo{font-size:32px;margin-bottom:20px;}
    .jo-brand{font-size:10px;color:#86efac44;letter-spacing:.2em;margin-bottom:8px;}
    .jo-title{font-family:'Syne',sans-serif;font-size:24px;font-weight:800;color:#f0fdf4;margin-bottom:4px;}
    .jo-title span{color:#22c55e;}
    .jo-sub{font-size:11px;color:#86efac33;letter-spacing:.08em;margin-bottom:28px;}
    .jo-invite-box{background:#060a07;border:1px solid #0d1f11;border-radius:10px;padding:20px;margin-bottom:24px;text-align:left;}
    .jo-invite-label{font-size:9px;color:#86efac44;letter-spacing:.14em;margin-bottom:12px;}
    .jo-role-badge{display:inline-flex;align-items:center;gap:6px;padding:'6px 14px';border-radius:6px;font-size:12px;font-weight:700;margin-bottom:12px;}
    .jo-field{margin-bottom:10px;}
    .jo-field-label{font-size:9px;color:#86efac33;letter-spacing:.1em;margin-bottom:3px;}
    .jo-field-val{font-size:11px;color:#f0fdf4;}
    .jo-btn{width:100%;padding:14px;border-radius:8px;border:none;background:linear-gradient(135deg,#14532d,#166534);color:#d1fae5;cursor:pointer;font-family:'DM Mono',monospace;font-size:12px;font-weight:700;letter-spacing:.1em;transition:all .2s;margin-bottom:10px;}
    .jo-btn:hover{background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;transform:translateY(-1px);}
    .jo-btn:disabled{opacity:.4;cursor:not-allowed;transform:none;}
    .jo-btn-sec{width:100%;padding:12px;border-radius:8px;border:1px solid #0d1f11;background:transparent;color:#86efac44;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.08em;transition:all .2s;}
    .jo-btn-sec:hover{border-color:#22c55e22;color:#86efac88;}
    .jo-msg{padding:14px 16px;border-radius:8px;font-size:11px;margin-bottom:16px;line-height:1.7;}
    .jo-msg.success{background:#051409;border:1px solid #22c55e33;color:#22c55e88;}
    .jo-msg.error{background:#1a0707;border:1px solid #f8717133;color:#f8717188;}
    .jo-spinner{width:32px;height:32px;border:3px solid #22c55e11;border-top-color:#22c55e44;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 20px;}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes fu{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
    .jo-card{animation:fu .4s ease both;}
  `;

  return (
    <>
      <style>{CSS}</style>
      <div className="jo">
        <div className="jo-card">
          <div className="jo-logo">🌿</div>
          <div className="jo-brand">ETHERTRACK CARBON EXCHANGE</div>
          <div className="jo-title">Join <span>Organisation</span></div>
          <div className="jo-sub">You've been invited to collaborate on carbon credits & ESG reporting</div>

          {status === 'loading' && (
            <div className="jo-spinner"/>
          )}

          {status === 'error' && (
            <>
              <div className="jo-msg error">⚠️ {message || 'This invite link is invalid or has expired.'}</div>
              <button className="jo-btn-sec" onClick={() => navigate('/dashboard')}>← BACK TO DASHBOARD</button>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="jo-msg success">{message}</div>
              <button className="jo-btn" onClick={() => navigate('/team')}>GO TO TEAM →</button>
            </>
          )}

          {(status === 'valid' || status === 'accepting') && (
            <>
              <div className="jo-invite-box">
                <div className="jo-invite-label">INVITE DETAILS</div>

                {invite?.team_role && (
                  <div style={{marginBottom:14}}>
                    <div className="jo-field-label">YOUR ROLE</div>
                    <div className="jo-role-badge" style={{
                      background:`${role.color}11`,
                      border:`1px solid ${role.color}44`,
                      color:role.color,
                      padding:'6px 14px',
                      display:'inline-flex',
                    }}>
                      {role.icon} {role.label}
                    </div>
                  </div>
                )}

                {invite?.org_name && (
                  <div className="jo-field">
                    <div className="jo-field-label">ORGANISATION</div>
                    <div className="jo-field-val">{invite.org_name}</div>
                  </div>
                )}

                <div className="jo-field">
                  <div className="jo-field-label">JOINING AS</div>
                  <div className="jo-field-val">{dbUser?.email || '—'}</div>
                </div>

                {/* Role permissions preview */}
                <div style={{marginTop:14,padding:'10px 12px',background:'#0a1628',borderRadius:6,border:'1px solid #60a5fa22'}}>
                  <div style={{fontSize:9,color:'#60a5fa88',letterSpacing:'.12em',marginBottom:8}}>
                    {invite?.team_role?.toUpperCase() || 'YOUR'} ROLE PERMISSIONS
                  </div>
                  {({
                    owner:   ['Full control — billing, team, all data'],
                    admin:   ['Manage team','Approve credits','Read/write all data'],
                    manager: ['Emissions tracking','Portfolio management','Export reports'],
                    auditor: ['Read-only access','Export PDF reports','Verify retirements'],
                    viewer:  ['Read-only dashboard','View portfolio & emissions'],
                  }[invite?.team_role] || ['View dashboard and reports']).map(p => (
                    <div key={p} style={{fontSize:10,color:'#86efac88',marginBottom:4}}>✓ {p}</div>
                  ))}
                </div>
              </div>

              {status === 'accepting'
                ? <button className="jo-btn" disabled>⟳ JOINING ORGANISATION...</button>
                : <button className="jo-btn" onClick={handleAccept}>ACCEPT INVITATION →</button>
              }
              <button className="jo-btn-sec" onClick={() => navigate('/dashboard')} disabled={status==='accepting'}>
                DECLINE
              </button>

              <div style={{marginTop:16,fontSize:9,color:'#86efac22',letterSpacing:'.06em',lineHeight:1.8}}>
                By accepting, you agree to collaborate on EtherTrack's carbon credit platform.
                You can leave the organisation at any time from Team Settings.
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}