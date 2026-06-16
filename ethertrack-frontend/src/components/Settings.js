// src/components/Settings.jsx — EtherTrack (PRODUCTION-HARDENED)
// ─────────────────────────────────────────────────────────────────────────────
// FIXES APPLIED:
//
// [FIX-1]  All settings now persist to backend via /api/user/preferences.
//          Notifications, preferences, and security settings are saved and
//          loaded on mount. No more reset on refresh.
//
// [FIX-2]  Danger zone buttons now have confirmation modals with password
//          re-entry before any destructive action fires. DELETE requires
//          typing "DELETE" AND entering password. All three actions call
//          real API endpoints.
//
// [FIX-3]  2FA toggle removed from simple boolean — replaced with a proper
//          setup flow gate. Enabling navigates to /settings/2fa-setup.
//          Disabling requires password confirmation. Until 2FA is set up,
//          the toggle shows correct "not configured" state.
//
// [FIX-4]  Session timeout enforced via an idle activity tracker that calls
//          auth.signOut() after the selected idle period.
//
// [FIX-5]  ErrorBoundary added — no blank screen on crash.
//
// [FIX-6]  Loading state on mount — preferences fetched before render.
//
// REQUIRED backend routes (add to routes/user.js):
//   GET  /api/user/preferences        → return saved prefs
//   POST /api/user/preferences        → save prefs
//   POST /api/user/deactivate         → deactivate account
//   POST /api/user/delete             → delete account (password verified)
//   POST /api/user/disable-2fa        → disable 2FA (password verified)

import React, {
  useState, useEffect, useRef, useContext, useCallback, Component,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../App';
import { apiFetch } from '../services/api';
import { auth } from '../firebaseConfigure';
import {
  signOut, reauthenticateWithCredential, EmailAuthProvider,
} from 'firebase/auth';

// ── [FIX-5] Error Boundary ────────────────────────────────────────────────────
class SettingsErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(e, i) { console.error('[EtherTrack] Settings crash:', e, i); }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', background: '#080c0a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Mono',monospace" }}>
        <div style={{ textAlign: 'center', maxWidth: 400, padding: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <div style={{ fontSize: 15, color: '#f0fdf4', fontWeight: 700, marginBottom: 8 }}>Settings failed to load</div>
          <div style={{ fontSize: 12, color: '#86efac66', marginBottom: 24, lineHeight: 1.7 }}>Please refresh and try again.</div>
          <button onClick={() => window.location.reload()}
            style={{ padding: '10px 28px', borderRadius: 8, border: 'none', background: '#22c55e', color: '#060a07', cursor: 'pointer', fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700, letterSpacing: '.1em' }}
          >RELOAD</button>
        </div>
      </div>
    );
  }
}

// ── Confirmation Modal ────────────────────────────────────────────────────────
function ConfirmModal({ config, onConfirm, onCancel, loading }) {
  const [password,    setPassword]    = useState('');
  const [deleteWord,  setDeleteWord]  = useState('');
  const [localErr,    setLocalErr]    = useState('');

  if (!config) return null;

  const handleConfirm = () => {
    setLocalErr('');
    if (config.requirePassword && !password.trim()) {
      setLocalErr('Please enter your password to confirm.'); return;
    }
    if (config.requireDeleteWord && deleteWord !== 'DELETE') {
      setLocalErr('Type DELETE in uppercase to confirm.'); return;
    }
    onConfirm({ password, deleteWord });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.88)', backdropFilter: 'blur(6px)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => e.target === e.currentTarget && !loading && onCancel()}
    >
      <div style={{ background: '#0a0f0c', border: `1px solid ${config.borderColor || '#dc262633'}`, borderRadius: 14, width: '100%', maxWidth: 400, padding: 32, fontFamily: "'DM Mono',monospace" }}>
        <div style={{ fontSize: 32, marginBottom: 16, textAlign: 'center' }}>{config.icon}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#f0fdf4', marginBottom: 8, textAlign: 'center' }}>{config.title}</div>
        <div style={{ fontSize: 11, color: '#86efac66', marginBottom: 20, lineHeight: 1.7, textAlign: 'center' }}>{config.description}</div>

        {config.requireDeleteWord && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: '#f8717177', marginBottom: 6, letterSpacing: '.08em' }}>TYPE "DELETE" TO CONFIRM</div>
            <input
              value={deleteWord}
              onChange={e => setDeleteWord(e.target.value)}
              placeholder="DELETE"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 7, border: `1px solid ${deleteWord === 'DELETE' ? '#22c55e33' : '#dc262633'}`, background: '#060a07', color: '#f87171', fontFamily: "'DM Mono',monospace", fontSize: 13, letterSpacing: '.1em', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
        )}

        {config.requirePassword && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: '#86efac55', marginBottom: 6, letterSpacing: '.08em' }}>CONFIRM YOUR PASSWORD</div>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter your password"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 7, border: '1px solid #0f2a1a', background: '#060a07', color: '#f0fdf4', fontFamily: "'DM Mono',monospace", fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
        )}

        {localErr && (
          <div style={{ fontSize: 10, color: '#f87171', padding: '8px 12px', background: '#1a0707', borderRadius: 6, border: '1px solid #f8717122', marginBottom: 12 }}>
            ⚠️ {localErr}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={onCancel} disabled={loading}
            style={{ flex: 1, padding: '11px', borderRadius: 8, border: '1px solid #0f2a1a', background: 'transparent', color: '#86efac55', cursor: 'pointer', fontFamily: "'DM Mono',monospace", fontSize: 11, letterSpacing: '.08em' }}
          >CANCEL</button>
          <button onClick={handleConfirm} disabled={loading}
            style={{ flex: 1, padding: '11px', borderRadius: 8, border: 'none', background: config.confirmBg || '#dc2626', color: '#fff', cursor: 'pointer', fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 700, letterSpacing: '.08em', opacity: loading ? 0.6 : 1 }}
          >{loading ? 'PROCESSING...' : config.confirmLabel || 'CONFIRM'}</button>
        </div>
      </div>
    </div>
  );
}

// ── SettingsInner ─────────────────────────────────────────────────────────────
function SettingsInner() {
  const { user, dbUser, setDbUser } = useContext(AuthContext);
  const navigate = useNavigate();

  const [pageLoading, setPageLoading] = useState(true); // [FIX-6]
  const [saving,      setSaving]      = useState('');
  const [saveErr,     setSaveErr]     = useState('');
  const [toast,       setToast]       = useState('');
  const toastTimer = useRef(null);

  // [FIX-2] Confirmation modal state
  const [confirmConfig,  setConfirmConfig]  = useState(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmErr,     setConfirmErr]     = useState('');

  const [notifications, setNotifications] = useState({
    tradeConfirm:   true,
    priceAlerts:    true,
    emissionAlerts: false,
    newsletter:     false,
    kycUpdates:     true,
  });

  const [preferences, setPreferences] = useState({
    currency:    'INR',
    language:    'English',
    timezone:    'Asia/Kolkata',
    priceFormat: 'Indian',
  });

  const [security, setSecurity] = useState({
    twoFactorEnabled: false, // [FIX-3] renamed from twoFactor
    loginAlerts:      true,
    sessionTimeout:   '30',
  });

  // [FIX-6] Load preferences on mount
  useEffect(() => {
    apiFetch('/api/user/preferences')
      .then(d => {
        if (!d) return;
        if (d.notifications) setNotifications(prev => ({ ...prev, ...d.notifications }));
        if (d.preferences)   setPreferences(prev  => ({ ...prev, ...d.preferences   }));
        if (d.security)      setSecurity(prev     => ({ ...prev, ...d.security       }));
      })
      .catch(() => { /* keep defaults */ })
      .finally(() => setPageLoading(false));
  }, []);

  // [FIX-4] Idle session timeout enforcement
  useEffect(() => {
    const ms = parseInt(security.sessionTimeout) * 60 * 1000;
    if (!ms) return; // "Never"
    let idleTimer;
    const reset = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        signOut(auth).catch(() => {});
      }, ms);
    };
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset(); // start timer
    return () => {
      clearTimeout(idleTimer);
      events.forEach(e => window.removeEventListener(e, reset));
    };
  }, [security.sessionTimeout]);

  const showToast = useCallback((msg, isErr = false) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    setSaveErr(isErr ? msg : '');
    toastTimer.current = setTimeout(() => { setToast(''); setSaveErr(''); }, 4000);
  }, []);

  // [FIX-1] Save to backend
  const saveNotifications = async () => {
    setSaving('notifications');
    try {
      await apiFetch('/api/user/preferences', {
        method: 'POST',
        body: JSON.stringify({ notifications }),
      });
      showToast('✅ Notification preferences saved!');
    } catch { showToast('❌ Failed to save. Try again.', true); }
    finally  { setSaving(''); }
  };

  const savePreferences = async () => {
    setSaving('preferences');
    try {
      await apiFetch('/api/user/preferences', {
        method: 'POST',
        body: JSON.stringify({ preferences }),
      });
      showToast('✅ Preferences saved!');
    } catch { showToast('❌ Failed to save. Try again.', true); }
    finally  { setSaving(''); }
  };

  const saveSecuritySettings = async () => {
    setSaving('security');
    try {
      await apiFetch('/api/user/preferences', {
        method: 'POST',
        body: JSON.stringify({ security: { loginAlerts: security.loginAlerts, sessionTimeout: security.sessionTimeout } }),
      });
      showToast('✅ Security settings saved!');
    } catch { showToast('❌ Failed to save. Try again.', true); }
    finally  { setSaving(''); }
  };

  const toggleNotif = (key) => setNotifications(prev => ({ ...prev, [key]: !prev[key] }));

  // [FIX-3] 2FA — navigate to setup or show disable confirmation
  const handle2FAToggle = () => {
    if (!security.twoFactorEnabled) {
      navigate('/settings/2fa-setup');
    } else {
      setConfirmConfig({
        icon:            '🔐',
        title:           'Disable 2-Factor Authentication',
        description:     'This will remove the extra security layer from your account. Enter your password to confirm.',
        requirePassword: true,
        confirmLabel:    'DISABLE 2FA',
        confirmBg:       '#dc2626',
        borderColor:     '#dc262633',
        action:          'disable-2fa',
      });
    }
  };

  // [FIX-2] Danger zone handlers
  const handleResetKYC = () => {
    setConfirmConfig({
      icon:            '🔄',
      title:           'Reset KYC Verification',
      description:     'This will open a support ticket to reset your KYC. Our compliance team will contact you within 1 business day. You cannot self-reset KYC — it requires manual review.',
      requirePassword: false,
      confirmLabel:    'OPEN SUPPORT TICKET',
      confirmBg:       '#f59e0b',
      borderColor:     '#f59e0b33',
      action:          'reset-kyc',
    });
  };

  const handleDeactivate = () => {
    setConfirmConfig({
      icon:            '⏸️',
      title:           'Deactivate Account',
      description:     'Your account will be temporarily disabled. You cannot trade or access your portfolio while deactivated. Enter your password to confirm.',
      requirePassword: true,
      confirmLabel:    'DEACTIVATE',
      confirmBg:       '#f59e0b',
      borderColor:     '#f59e0b33',
      action:          'deactivate',
    });
  };

  const handleDeleteAccount = () => {
    setConfirmConfig({
      icon:             '🗑️',
      title:            'Permanently Delete Account',
      description:      'This is irreversible. All your data, portfolio history, and emission records will be permanently deleted. You must withdraw all funds first. Type DELETE and enter your password to confirm.',
      requirePassword:  true,
      requireDeleteWord: true,
      confirmLabel:     'PERMANENTLY DELETE',
      confirmBg:        '#dc2626',
      borderColor:      '#dc262633',
      action:           'delete',
    });
  };

  // Re-authenticate helper
  const reauth = async (password) => {
    const credential = EmailAuthProvider.credential(
      auth.currentUser.email, password
    );
    await reauthenticateWithCredential(auth.currentUser, credential);
  };

  const handleConfirmAction = async ({ password }) => {
    setConfirmLoading(true);
    setConfirmErr('');
    const action = confirmConfig.action;
    try {
      if (action === 'disable-2fa') {
        await reauth(password);
        await apiFetch('/api/user/disable-2fa', { method: 'POST' });
        setSecurity(s => ({ ...s, twoFactorEnabled: false }));
        showToast('✅ 2FA disabled.');
        setConfirmConfig(null);
      }

      if (action === 'reset-kyc') {
        await apiFetch('/api/support/ticket', {
          method: 'POST',
          body: JSON.stringify({ type: 'kyc_reset', message: 'User requested KYC reset from Settings page.' }),
        });
        showToast('✅ Support ticket opened. We\'ll contact you within 1 business day.');
        setConfirmConfig(null);
      }

      if (action === 'deactivate') {
        await reauth(password);
        await apiFetch('/api/user/deactivate', { method: 'POST' });
        showToast('Account deactivated.');
        setConfirmConfig(null);
        setTimeout(() => signOut(auth), 2000);
      }

      if (action === 'delete') {
        await reauth(password);
        await apiFetch('/api/user/delete', { method: 'POST' });
        setConfirmConfig(null);
        await signOut(auth);
        navigate('/');
      }
    } catch (e) {
      const msg = e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential'
        ? 'Incorrect password. Please try again.'
        : e.message || 'Action failed. Please try again.';
      setConfirmErr(msg);
      showToast(`❌ ${msg}`, true);
    } finally {
      setConfirmLoading(false);
    }
  };

  if (pageLoading) {
    return (
      <div style={{ minHeight: '100vh', background: '#080c0a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Mono',monospace" }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 24, height: 24, border: '2px solid #22c55e22', borderTopColor: '#22c55e', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
          <div style={{ fontSize: 10, color: '#86efac44', letterSpacing: '.1em' }}>LOADING SETTINGS...</div>
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
        .et-set{min-height:100vh;background:#080c0a;font-family:'DM Mono',monospace;position:relative;}
        .et-set::before{content:'';position:fixed;inset:0;z-index:0;background-image:linear-gradient(rgba(34,197,94,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(34,197,94,0.03) 1px,transparent 1px);background-size:40px 40px;pointer-events:none;}
        .et-set-wrap{position:relative;z-index:1;max-width:820px;margin:0 auto;padding:40px 24px;}
        .et-set-label{font-size:10px;color:#4ade8066;letter-spacing:.15em;margin-bottom:8px;}
        .et-set-title{font-size:26px;font-weight:700;color:#f0fdf4;margin-bottom:4px;}
        .et-set-title span{color:#22c55e;}
        .et-set-sub{font-size:11px;color:#4ade8044;letter-spacing:.08em;margin-bottom:32px;}
        .et-set-toast{position:fixed;top:80px;right:24px;z-index:9999;padding:12px 20px;border-radius:8px;background:#0d2e1f;border:1px solid #16a34a44;color:#22c55e;font-size:12px;box-shadow:0 8px 32px rgba(0,0,0,.4);animation:slideIn .3s ease;font-family:'DM Mono',monospace;}
        @keyframes slideIn{from{transform:translateX(20px);opacity:0;}to{transform:translateX(0);opacity:1;}}
        .et-set-card{background:#0a0f0c;border:1px solid #0f2a1a;border-radius:12px;padding:24px;margin-bottom:16px;animation:fadeUp .4s ease both;}
        .et-set-card:nth-child(2){animation-delay:.05s;}.et-set-card:nth-child(3){animation-delay:.10s;}.et-set-card:nth-child(4){animation-delay:.15s;}
        .et-set-card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding-bottom:14px;border-bottom:1px solid #0f2a1a;}
        .et-set-card-title{font-size:11px;color:#4ade8088;letter-spacing:.14em;}
        .et-set-row{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #0f2a1a18;}
        .et-set-row:last-child{border-bottom:none;padding-bottom:0;}
        .et-set-row-info{flex:1;}
        .et-set-row-label{font-size:12px;color:#e2e8e4;margin-bottom:2px;}
        .et-set-row-desc{font-size:10px;color:#4ade8044;letter-spacing:.04em;}
        .et-toggle{position:relative;width:40px;height:22px;flex-shrink:0;cursor:pointer;}
        .et-toggle input{opacity:0;width:0;height:0;}
        .et-toggle-slider{position:absolute;inset:0;border-radius:22px;background:#0f2a1a;border:1px solid #16a34a22;transition:all .3s;}
        .et-toggle-slider::before{content:'';position:absolute;width:14px;height:14px;border-radius:50%;left:3px;top:3px;background:#4ade8044;transition:all .3s;}
        .et-toggle input:checked + .et-toggle-slider{background:#16a34a;border-color:#22c55e44;}
        .et-toggle input:checked + .et-toggle-slider::before{transform:translateX(18px);background:#fff;}
        .et-toggle input:disabled + .et-toggle-slider{opacity:.4;cursor:not-allowed;}
        .et-set-select,.et-set-input{padding:8px 12px;border-radius:6px;background:#060a07;border:1px solid #0f2a1a;color:#e2e8e4;font-family:'DM Mono',monospace;font-size:12px;outline:none;transition:border-color .2s;min-width:140px;}
        .et-set-select:focus,.et-set-input:focus{border-color:#22c55e44;}
        .et-set-pref-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
        .et-set-pref-group{display:flex;flex-direction:column;gap:6px;}
        .et-set-pref-label{font-size:10px;color:#4ade8088;letter-spacing:.12em;}
        .et-set-danger{border-color:#dc262622;}
        .et-set-danger .et-set-card-title{color:#f8717166;}
        .et-set-danger-row{display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid #dc262611;}
        .et-set-danger-row:last-child{border-bottom:none;}
        .et-set-danger-label{font-size:12px;color:#e2e8e4;}
        .et-set-danger-desc{font-size:10px;color:#4ade8033;margin-top:2px;}
        .et-set-btn-danger{padding:8px 16px;border-radius:6px;border:1px solid #dc262633;background:transparent;color:#f8717166;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.08em;transition:all .2s;white-space:nowrap;}
        .et-set-btn-danger:hover{background:#450a0a;border-color:#dc2626;color:#f87171;}
        .et-set-save-row{display:flex;justify-content:flex-end;margin-top:8px;}
        .et-set-btn-save{padding:11px 28px;border-radius:7px;border:none;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;cursor:pointer;font-family:'DM Mono',monospace;font-size:12px;font-weight:700;letter-spacing:.1em;transition:opacity .2s,transform .1s;}
        .et-set-btn-save:hover:not(:disabled){opacity:.88;transform:translateY(-1px);}
        .et-set-btn-save:disabled{opacity:.5;cursor:not-allowed;}
        .twofa-badge{font-size:10px;padding:3px 9px;border-radius:4px;letter-spacing:.08em;font-weight:700;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}
        @media(max-width:600px){.et-set-pref-grid{grid-template-columns:1fr;}}
      `}</style>

      {toast && (
        <div className="et-set-toast" style={{ borderColor: saveErr ? '#f8717144' : '#16a34a44', color: saveErr ? '#f87171' : '#22c55e' }}>
          {toast}
        </div>
      )}

      {/* [FIX-2] Confirmation modal */}
      <ConfirmModal
        config={confirmConfig}
        onConfirm={handleConfirmAction}
        onCancel={() => { setConfirmConfig(null); setConfirmErr(''); }}
        loading={confirmLoading}
      />

      <div className="et-set">
        <div className="et-set-wrap">
          <div className="et-set-label">ACCOUNT CONFIGURATION</div>
          <div className="et-set-title">Account <span>Settings</span></div>
          <div className="et-set-sub">MANAGE YOUR PREFERENCES AND SECURITY</div>

          {/* Notifications */}
          <div className="et-set-card">
            <div className="et-set-card-header">
              <span className="et-set-card-title">🔔 NOTIFICATION PREFERENCES</span>
            </div>
            {[
              { key: 'tradeConfirm',   label: 'Trade Confirmations',  desc: 'Get notified when a trade is executed'        },
              { key: 'priceAlerts',    label: 'Price Alerts',          desc: 'Alerts when credits hit your target price'    },
              { key: 'emissionAlerts', label: 'Emission Reminders',    desc: 'Monthly reminders to log emission data'       },
              { key: 'kycUpdates',     label: 'KYC Status Updates',    desc: 'Updates on your verification status'         },
              { key: 'newsletter',     label: 'Market Newsletter',     desc: 'Weekly carbon market insights and news'       },
            ].map(({ key, label, desc }) => (
              <div key={key} className="et-set-row">
                <div className="et-set-row-info">
                  <div className="et-set-row-label">{label}</div>
                  <div className="et-set-row-desc">{desc}</div>
                </div>
                <label className="et-toggle">
                  <input type="checkbox" checked={notifications[key]} onChange={() => toggleNotif(key)} />
                  <span className="et-toggle-slider" />
                </label>
              </div>
            ))}
            {/* [FIX-1] Real save button */}
            <div className="et-set-save-row" style={{ marginTop: 16 }}>
              <button className="et-set-btn-save" onClick={saveNotifications} disabled={saving === 'notifications'}>
                {saving === 'notifications' ? 'SAVING...' : 'SAVE NOTIFICATIONS →'}
              </button>
            </div>
          </div>

          {/* Preferences */}
          <div className="et-set-card">
            <div className="et-set-card-header">
              <span className="et-set-card-title">⚙️ PLATFORM PREFERENCES</span>
            </div>
            <div className="et-set-pref-grid">
              <div className="et-set-pref-group">
                <label className="et-set-pref-label">CURRENCY</label>
                <select className="et-set-select" value={preferences.currency}
                  onChange={e => setPreferences(p => ({ ...p, currency: e.target.value }))}>
                  <option value="INR">INR (₹)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                </select>
              </div>
              <div className="et-set-pref-group">
                <label className="et-set-pref-label">LANGUAGE</label>
                <select className="et-set-select" value={preferences.language}
                  onChange={e => setPreferences(p => ({ ...p, language: e.target.value }))}>
                  <option value="English">English</option>
                  <option value="Hindi">Hindi</option>
                  <option value="Marathi">Marathi</option>
                </select>
              </div>
              <div className="et-set-pref-group">
                <label className="et-set-pref-label">TIMEZONE</label>
                <select className="et-set-select" value={preferences.timezone}
                  onChange={e => setPreferences(p => ({ ...p, timezone: e.target.value }))}>
                  <option value="Asia/Kolkata">IST (Asia/Kolkata)</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>
              <div className="et-set-pref-group">
                <label className="et-set-pref-label">PRICE FORMAT</label>
                <select className="et-set-select" value={preferences.priceFormat}
                  onChange={e => setPreferences(p => ({ ...p, priceFormat: e.target.value }))}>
                  <option value="Indian">Indian (1,00,000)</option>
                  <option value="International">International (100,000)</option>
                </select>
              </div>
            </div>
            <div className="et-set-save-row" style={{ marginTop: 20 }}>
              <button className="et-set-btn-save" onClick={savePreferences} disabled={saving === 'preferences'}>
                {saving === 'preferences' ? 'SAVING...' : 'SAVE PREFERENCES →'}
              </button>
            </div>
          </div>

          {/* Security */}
          <div className="et-set-card">
            <div className="et-set-card-header">
              <span className="et-set-card-title">🔐 SECURITY SETTINGS</span>
            </div>

            {/* [FIX-3] 2FA — proper gated toggle */}
            <div className="et-set-row">
              <div className="et-set-row-info">
                <div className="et-set-row-label">
                  2-Factor Authentication
                  <span className="twofa-badge" style={{ marginLeft: 8, background: security.twoFactorEnabled ? '#0d2e1f' : '#1a0e00', color: security.twoFactorEnabled ? '#22c55e' : '#f59e0b', border: `1px solid ${security.twoFactorEnabled ? '#22c55e22' : '#f59e0b22'}` }}>
                    {security.twoFactorEnabled ? 'ENABLED' : 'NOT SET UP'}
                  </span>
                </div>
                <div className="et-set-row-desc">
                  {security.twoFactorEnabled ? 'Your account has an extra security layer' : 'Click to set up — takes 2 minutes'}
                </div>
              </div>
              <label className="et-toggle">
                <input type="checkbox" checked={security.twoFactorEnabled} onChange={handle2FAToggle} />
                <span className="et-toggle-slider" />
              </label>
            </div>

            <div className="et-set-row">
              <div className="et-set-row-info">
                <div className="et-set-row-label">Login Alerts</div>
                <div className="et-set-row-desc">Email alerts on new device logins</div>
              </div>
              <label className="et-toggle">
                <input type="checkbox" checked={security.loginAlerts}
                  onChange={() => setSecurity(s => ({ ...s, loginAlerts: !s.loginAlerts }))} />
                <span className="et-toggle-slider" />
              </label>
            </div>

            {/* [FIX-4] Session timeout — now actually enforced */}
            <div className="et-set-row">
              <div className="et-set-row-info">
                <div className="et-set-row-label">Session Timeout</div>
                <div className="et-set-row-desc">Auto logout after inactivity — enforced in this browser tab</div>
              </div>
              <select className="et-set-select" value={security.sessionTimeout}
                onChange={e => setSecurity(s => ({ ...s, sessionTimeout: e.target.value }))}>
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="60">1 hour</option>
                <option value="0">Never</option>
              </select>
            </div>

            <div className="et-set-save-row" style={{ marginTop: 16 }}>
              <button className="et-set-btn-save" onClick={saveSecuritySettings} disabled={saving === 'security'}>
                {saving === 'security' ? 'SAVING...' : 'SAVE SECURITY →'}
              </button>
            </div>
          </div>

          {/* Danger Zone — [FIX-2] all three wired with confirmation */}
          <div className="et-set-card et-set-danger">
            <div className="et-set-card-header">
              <span className="et-set-card-title">⚠️ DANGER ZONE</span>
            </div>
            <div className="et-set-danger-row">
              <div>
                <div className="et-set-danger-label">Reset KYC Verification</div>
                <div className="et-set-danger-desc">Opens a support ticket — compliance team will contact you</div>
              </div>
              <button className="et-set-btn-danger" onClick={handleResetKYC}>RESET KYC</button>
            </div>
            <div className="et-set-danger-row">
              <div>
                <div className="et-set-danger-label">Deactivate Account</div>
                <div className="et-set-danger-desc">Temporarily disable your trading account — requires password</div>
              </div>
              <button className="et-set-btn-danger" onClick={handleDeactivate}>DEACTIVATE</button>
            </div>
            <div className="et-set-danger-row">
              <div>
                <div className="et-set-danger-label">Delete Account</div>
                <div className="et-set-danger-desc">Permanently delete all data — irreversible — withdraw funds first</div>
              </div>
              <button className="et-set-btn-danger" onClick={handleDeleteAccount}>DELETE ACCOUNT</button>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}

export default function Settings() {
  return (
    <SettingsErrorBoundary>
      <SettingsInner />
    </SettingsErrorBoundary>
  );
}