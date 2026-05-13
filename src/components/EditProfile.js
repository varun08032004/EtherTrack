/**
 * EditProfile.jsx — World-class profile editor for EtherTrack
 * Uses apiFetch (JWT-based Express backend) — NO direct Supabase calls
 *
 * Tabs:
 *  1. PROFILE   — Avatar, name, email, company, phone, bio, timezone
 *  2. SECURITY  — Password change with strength meter
 *  3. ALERTS    — Email + push notification toggles
 *  4. SESSIONS  — Active sessions + revoke
 *  5. ACTIVITY  — Last 10 profile events
 *  6. DANGER    — Account deletion request
 */

import React, { useState, useContext, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../App';
import { apiFetch } from '../services/api';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const EMAIL_RE  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE  = /^\+?[\d\s\-()\u2013]{7,16}$/;
const TIMEZONES = (() => {
  try { return Intl.supportedValuesOf('timeZone'); }
  catch { return ['Asia/Kolkata','UTC','America/New_York','Europe/London','Asia/Tokyo']; }
})();

const NOTIF_DEFAULTS = {
  email_trade_executed: true,
  email_price_alert:    true,
  email_kyc_update:     true,
  email_newsletter:     false,
  push_trade_executed:  false,
  push_price_alert:     false,
};

// ─── PASSWORD STRENGTH ────────────────────────────────────────────────────────
const pwStrength = (pw) => {
  if (!pw) return { score: 0, label: '', color: '#0f2a1a' };
  let s = 0;
  if (pw.length >= 8)           s++;
  if (pw.length >= 12)          s++;
  if (/[A-Z]/.test(pw))         s++;
  if (/[0-9]/.test(pw))         s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const levels = [
    { label:'TOO SHORT',  color:'#7f1d1d' },
    { label:'WEAK',       color:'#dc2626' },
    { label:'FAIR',       color:'#f59e0b' },
    { label:'GOOD',       color:'#22c55e' },
    { label:'STRONG',     color:'#22c55e' },
    { label:'EXCELLENT',  color:'#4ade80' },
  ];
  return { score: s, ...levels[Math.min(s, 5)] };
};

// ─── TINY REUSABLE COMPONENTS ─────────────────────────────────────────────────
const Section = ({ title, subtitle, children, delay = 0 }) => (
  <div className="ep-section" style={{ animationDelay:`${delay}ms` }}>
    <div className="ep-section-hdr">
      <div className="ep-section-title">{title}</div>
      {subtitle && <div className="ep-section-sub">{subtitle}</div>}
    </div>
    <div className="ep-section-body">{children}</div>
  </div>
);

const Field = ({ label, optional, error, hint, children }) => (
  <div className="ep-field">
    <label className="ep-field-label">
      {label}
      {optional && <span className="ep-field-opt">OPTIONAL</span>}
    </label>
    {children}
    {hint && !error && <span className="ep-field-hint">{hint}</span>}
    {error && <span className="ep-field-err">{error}</span>}
  </div>
);

const Input = ({ hasError, ...props }) => (
  <input className={`ep-input${hasError ? ' ep-input--err' : ''}`} {...props} />
);

const Toggle = ({ checked, onChange, label, sub }) => (
  <div className="ep-trow">
    <div className="ep-tinfo">
      <div className="ep-tlabel">{label}</div>
      {sub && <div className="ep-tsub">{sub}</div>}
    </div>
    <button role="switch" aria-checked={checked} type="button"
      className={`ep-toggle${checked ? ' ep-toggle--on' : ''}`}
      onClick={() => onChange(!checked)}>
      <span className="ep-toggle-thumb" />
    </button>
  </div>
);

// ═════════════════════════════════════════════════════════════════════════════
const EditProfile = () => {
  const { user, dbUser, setDbUser } = useContext(AuthContext);
  const navigate = useNavigate();
  const fileRef  = useRef();

  // ── Tab ───────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState('profile');

  // ── Profile fields (seeded from dbUser — the real source of truth) ────────
  const [name,     setName]     = useState(dbUser?.full_name    || user?.name  || '');
  const [email,    setEmail]    = useState(dbUser?.email        || user?.email || '');
  const [company,  setCompany]  = useState(dbUser?.company_name || '');
  const [phone,    setPhone]    = useState(dbUser?.phone        || '');
  const [bio,      setBio]      = useState(dbUser?.bio          || '');
  const [timezone, setTimezone] = useState(
    dbUser?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'
  );
  const [avatarFile,    setAvatarFile]    = useState(null);
  const [preview,       setPreview]       = useState(dbUser?.avatar_url || '');
  const [avatarSpinner, setAvatarSpinner] = useState(false);

  // ── Password ──────────────────────────────────────────────────────────────
  const [curPw,     setCurPw]     = useState('');
  const [newPw,     setNewPw]     = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw,    setShowPw]    = useState({ cur:false, new:false, confirm:false });

  // ── Notifications ─────────────────────────────────────────────────────────
  const [notifs, setNotifs] = useState({
    ...NOTIF_DEFAULTS,
    ...(dbUser?.notification_prefs || {}),
  });

  // ── Sessions & activity ───────────────────────────────────────────────────
  const [sessions,  setSessions]  = useState([]);
  const [sessReady, setSessReady] = useState(false);
  const [revoking,  setRevoking]  = useState(null);
  const [actLog,    setActLog]    = useState([]);

  // ── UI ────────────────────────────────────────────────────────────────────
  const [errors,  setErrors]  = useState({});
  const [success, setSuccess] = useState({});
  const [saving,  setSaving]  = useState({});
  const [dirty,   setDirty]   = useState(false);

  const orig = useRef({ name, email, company, phone, bio, timezone });

  // ── Dirty tracking ────────────────────────────────────────────────────────
  useEffect(() => {
    setDirty(
      name     !== orig.current.name     ||
      email    !== orig.current.email    ||
      company  !== orig.current.company  ||
      phone    !== orig.current.phone    ||
      bio      !== orig.current.bio      ||
      timezone !== orig.current.timezone ||
      !!avatarFile
    );
  }, [name, email, company, phone, bio, timezone, avatarFile]);

  useEffect(() => {
    const h = e => {
      if (dirty && tab === 'profile') { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty, tab]);

  // ── Load sessions + activity on mount ─────────────────────────────────────
  useEffect(() => { fetchSessions(); fetchLog(); }, []);

  const fetchSessions = async () => {
    try {
      const data = await apiFetch('/api/auth/sessions');
      setSessions(data?.sessions || []);
    } catch { setSessions([]); }
    setSessReady(true);
  };

  const fetchLog = async () => {
    try {
      const data = await apiFetch('/api/auth/activity-log');
      setActLog(data?.log || []);
    } catch { setActLog([]); }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const clrErr = k => setErrors(p => { const x = { ...p }; delete x[k]; return x; });
  const flash  = (k, msg) => {
    setSuccess(p => ({ ...p, [k]: msg }));
    setTimeout(() => setSuccess(p => { const x = { ...p }; delete x[k]; return x; }), 3500);
  };
  const sv = (k, v) => setSaving(p => ({ ...p, [k]: v }));

  // ── Avatar pick (drag & drop or click) ────────────────────────────────────
  const pickFile = useCallback(e => {
    const file = e.dataTransfer?.files[0] || e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {
      setErrors(p => ({ ...p, avatar: 'Only JPG, PNG, or WebP allowed' })); return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrors(p => ({ ...p, avatar: 'Must be under 5 MB' })); return;
    }
    setAvatarFile(file);
    setPreview(URL.createObjectURL(file));
    clrErr('avatar');
  }, []);

  // ── Save profile ──────────────────────────────────────────────────────────
  const saveProfile = async () => {
    const errs = {};
    if (!name.trim())                    errs.name  = 'Full name is required';
    if (!email.trim())                   errs.email = 'Email is required';
    else if (!EMAIL_RE.test(email))      errs.email = 'Enter a valid email address';
    if (phone && !PHONE_RE.test(phone))  errs.phone = 'Enter a valid phone number';
    if (bio.length > 280)                errs.bio   = 'Bio must be under 280 characters';
    if (Object.keys(errs).length) { setErrors(errs); return; }

    sv('profile', true); setErrors({});

    try {
      let avatarUrl = dbUser?.avatar_url || null;

      // Upload avatar via multipart if changed
      if (avatarFile) {
        setAvatarSpinner(true);
        const form = new FormData();
        form.append('avatar', avatarFile);
        const token = localStorage.getItem('et_access');
        const res = await fetch(
          `${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/auth/upload-avatar`,
          { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.message || 'Avatar upload failed');
        avatarUrl = json.avatar_url;
        setAvatarSpinner(false);
      }

      // ── FIX: only send fields that have actual values ──────────────────────
      // JSON.stringify drops `undefined` keys, so empty optional fields are
      // never sent — backend .optional() validators skip them cleanly instead
      // of failing on empty strings.
      const updated = await apiFetch('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          full_name:    name.trim()    || undefined,
          email:        email.trim()   || undefined,
          company_name: company.trim() || undefined,
          phone:        phone.trim()   || undefined,
          bio:          bio.trim()     || undefined,
          timezone:     timezone       || undefined,
          avatar_url:   avatarUrl      || undefined,
        }),
      });

      // ✅ update dbUser in context so Profile page re-renders
      setDbUser(prev => ({ ...prev, ...updated?.user }));

      orig.current = { name, email, company, phone, bio, timezone };
      setDirty(false);
      setAvatarFile(null);
      flash('profile', '✅ Profile updated successfully!');
      await fetchLog();

    } catch (err) {
      setErrors(p => ({ ...p, profile: err.message || 'Update failed. Please try again.' }));
    } finally {
      sv('profile', false);
      setAvatarSpinner(false);
    }
  };

  // ── Change password ───────────────────────────────────────────────────────
  const changePassword = async () => {
    const errs = {};
    if (!curPw)                           errs.curPw     = 'Current password is required';
    if (!newPw)                           errs.newPw     = 'New password is required';
    else if (newPw.length < 8)            errs.newPw     = 'At least 8 characters required';
    else if (pwStrength(newPw).score < 2) errs.newPw     = 'Password is too weak';
    if (newPw !== confirmPw)              errs.confirmPw = 'Passwords do not match';
    if (Object.keys(errs).length) { setErrors(errs); return; }

    sv('password', true); setErrors({});
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: curPw, newPassword: newPw }),
      });
      setCurPw(''); setNewPw(''); setConfirmPw('');
      flash('password', '✅ Password changed successfully!');
      await fetchLog();
    } catch (err) {
      setErrors(p => ({ ...p, password: err.message || 'Incorrect current password' }));
    } finally { sv('password', false); }
  };

  // ── Save notifications ────────────────────────────────────────────────────
  const saveNotifs = async () => {
    sv('notifs', true);
    try {
      await apiFetch('/api/auth/notification-prefs', {
        method: 'PATCH',
        body: JSON.stringify({ notification_prefs: notifs }),
      });
      setDbUser(prev => ({ ...prev, notification_prefs: notifs }));
      flash('notifs', '✅ Notification preferences saved!');
    } catch (err) {
      setErrors(p => ({ ...p, notifs: err.message || 'Failed to save preferences' }));
    } finally { sv('notifs', false); }
  };

  // ── Revoke session ────────────────────────────────────────────────────────
  const revokeSession = async (id, isCurrent) => {
    if (isCurrent && !window.confirm('This will log you out of the current session. Continue?')) return;
    setRevoking(id);
    try {
      await apiFetch(`/api/auth/sessions/${id}`, { method: 'DELETE' });
      setSessions(p => p.filter(s => s.id !== id));
      if (isCurrent) { window.location.replace('/login'); }
    } catch {}
    setRevoking(null);
  };

  // ── Request account deletion ──────────────────────────────────────────────
  const requestDeletion = async () => {
    if (!window.confirm('Permanently delete your account? All trades, KYC, and wallet data will be erased. This CANNOT be undone.')) return;
    const reason = window.prompt('Reason for deletion (required):');
    if (!reason?.trim()) return;
    try {
      await apiFetch('/api/auth/request-deletion', {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      alert('Request submitted. You will receive an email confirmation within 24 hours. Account will be deleted within 72 hours per DPDP Act 2023 §13.');
    } catch (err) {
      alert('Failed to submit: ' + (err.message || 'Please try again'));
    }
  };

  const strength = pwStrength(newPw);
  const initials = name
    ? name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  const TABS = [
    { id:'profile',  icon:'👤', label:'PROFILE'     },
    { id:'security', icon:'🔐', label:'SECURITY'     },
    { id:'notifs',   icon:'🔔', label:'ALERTS'       },
    { id:'sessions', icon:'⛓',  label:'SESSIONS'    },
    { id:'activity', icon:'📋', label:'ACTIVITY'     },
    { id:'danger',   icon:'⚠️', label:'DANGER ZONE' },
  ];

  const DOT_COLORS = {
    PROFILE_UPDATED:    '#22c55e',
    PASSWORD_CHANGED:   '#60a5fa',
    SESSION_REVOKED:    '#facc15',
    DELETION_REQUESTED: '#f87171',
    NOTIF_PREFS_UPDATED:'#22c55e',
  };

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}

        .ep-root{min-height:100vh;background:#060908;font-family:'DM Mono',monospace;color:#f0fdf4;position:relative;}
        .ep-root::before{content:'';position:fixed;inset:0;z-index:0;
          background-image:linear-gradient(rgba(34,197,94,.022) 1px,transparent 1px),
            linear-gradient(90deg,rgba(34,197,94,.022) 1px,transparent 1px);
          background-size:44px 44px;pointer-events:none;}
        .ep-wrap{position:relative;z-index:1;max-width:780px;margin:0 auto;padding:36px 24px 100px;}

        .ep-pg-label{font-size:9px;color:#4ade8055;letter-spacing:.22em;margin-bottom:6px;}
        .ep-pg-title{font-size:26px;font-weight:500;letter-spacing:.02em;margin-bottom:4px;}
        .ep-pg-title span{color:#22c55e;}
        .ep-pg-sub{font-size:9px;color:#4ade8044;letter-spacing:.1em;margin-bottom:24px;}

        .ep-dirty{display:inline-flex;align-items:center;gap:6px;font-size:9px;color:#facc1577;
          letter-spacing:.08em;padding:4px 10px;border-radius:5px;
          background:#1a150033;border:1px solid #facc1520;margin-bottom:16px;}
        .ep-dirty-dot{width:5px;height:5px;border-radius:50%;background:#facc15;animation:epPulse 1.4s ease infinite;}

        .ep-tabs{display:flex;gap:4px;margin-bottom:18px;overflow-x:auto;padding-bottom:1px;scrollbar-width:none;}
        .ep-tabs::-webkit-scrollbar{display:none;}
        .ep-tab{padding:7px 13px;border-radius:6px;border:1px solid #0f2a1a;background:transparent;
          color:#86efac44;cursor:pointer;font-family:'DM Mono',monospace;font-size:9px;
          letter-spacing:.1em;transition:all .18s;white-space:nowrap;display:flex;align-items:center;gap:5px;}
        .ep-tab:hover{border-color:#22c55e22;color:#86efac88;}
        .ep-tab.on{background:#0d2e1f;border-color:#22c55e44;color:#22c55e;}
        .ep-tab.dng{color:#f8717144;}
        .ep-tab.dng:hover{border-color:#dc262633;color:#f87171;}
        .ep-tab.dng.on{background:#450a0a20;border-color:#dc262644;color:#f87171;}

        .ep-section{background:#080c0a;border:1px solid #0f2a1a;border-radius:14px;
          margin-bottom:14px;overflow:hidden;animation:epFadeUp .3s ease both;}
        .ep-section-hdr{padding:18px 22px 14px;border-bottom:1px solid #0f2a1a;}
        .ep-section-title{font-size:10px;color:#f0fdf4;letter-spacing:.14em;margin-bottom:3px;}
        .ep-section-sub{font-size:9px;color:#86efac44;letter-spacing:.06em;}
        .ep-section-body{padding:20px 22px;}

        .ep-av-zone{display:flex;align-items:center;gap:20px;margin-bottom:20px;
          padding-bottom:20px;border-bottom:1px solid #0f2a1a;}
        .ep-av-drop{width:80px;height:80px;border-radius:50%;flex-shrink:0;
          background:linear-gradient(135deg,#16a34a22,#052e16);border:2px dashed #22c55e33;
          display:flex;align-items:center;justify-content:center;cursor:pointer;
          overflow:hidden;transition:border-color .2s;position:relative;}
        .ep-av-drop:hover{border-color:#22c55e55;}
        .ep-av-drop img{width:100%;height:100%;object-fit:cover;}
        .ep-av-initials{font-size:26px;font-weight:500;color:#22c55e;}
        .ep-av-overlay{position:absolute;inset:0;background:#00000088;display:flex;
          align-items:center;justify-content:center;opacity:0;transition:opacity .2s;font-size:18px;}
        .ep-av-drop:hover .ep-av-overlay{opacity:1;}
        .ep-av-spinner{position:absolute;inset:0;background:#00000088;display:flex;align-items:center;justify-content:center;}
        .ep-spinner{width:18px;height:18px;border:2px solid #22c55e33;border-top-color:#22c55e;
          border-radius:50%;animation:epSpin .7s linear infinite;}
        .ep-av-meta{flex:1;}
        .ep-av-name{font-size:15px;color:#f0fdf4;margin-bottom:3px;}
        .ep-av-hint{font-size:9px;color:#4ade8033;letter-spacing:.06em;margin-bottom:10px;}
        .ep-av-btns{display:flex;gap:8px;}
        .ep-av-upload{padding:6px 13px;border-radius:5px;border:1px solid #0f2a1a;background:#060a07;
          color:#4ade8077;cursor:pointer;font-family:'DM Mono',monospace;font-size:9px;
          letter-spacing:.08em;transition:all .18s;display:inline-block;}
        .ep-av-upload:hover{border-color:#22c55e33;color:#22c55e;}
        .ep-av-remove{padding:6px 13px;border-radius:5px;border:1px solid #7f1d1d33;background:transparent;
          color:#f8717155;cursor:pointer;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.08em;transition:all .18s;}
        .ep-av-remove:hover{border-color:#dc262644;color:#f87171;}

        .ep-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
        .ep-grid .full{grid-column:1/-1;}
        .ep-field{display:flex;flex-direction:column;gap:5px;}
        .ep-field-label{font-size:9px;color:#86efac77;letter-spacing:.12em;display:flex;gap:8px;align-items:center;}
        .ep-field-opt{color:#4ade8033;font-size:8px;}
        .ep-field-hint{font-size:9px;color:#86efac33;letter-spacing:.04em;}
        .ep-field-err{font-size:9px;color:#f87171;letter-spacing:.04em;}
        .ep-input{padding:10px 13px;border-radius:7px;background:#060a07;border:1px solid #0f2a1a;
          color:#e2e8e4;font-family:'DM Mono',monospace;font-size:12px;outline:none;
          transition:border-color .18s,box-shadow .18s;width:100%;}
        .ep-input:focus{border-color:#22c55e44;box-shadow:0 0 0 3px rgba(34,197,94,.05);}
        .ep-input::placeholder{color:#4ade8022;}
        .ep-input--err{border-color:#dc262644!important;}
        .ep-input:disabled{opacity:.4;cursor:not-allowed;}
        .ep-textarea{resize:vertical;min-height:72px;line-height:1.6;}
        .ep-select{appearance:none;
          background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2322c55e55'/%3E%3C/svg%3E");
          background-repeat:no-repeat;background-position:right 12px center;padding-right:32px;cursor:pointer;}
        .ep-char{font-size:8px;color:#4ade8033;text-align:right;margin-top:2px;}

        .ep-pw-wrap{position:relative;}
        .ep-pw-wrap .ep-input{padding-right:40px;}
        .ep-pw-eye{position:absolute;right:10px;top:50%;transform:translateY(-50%);
          background:none;border:none;color:#4ade8044;cursor:pointer;font-size:14px;padding:2px;}
        .ep-pw-eye:hover{color:#22c55e;}
        .ep-strength-bar{height:2px;border-radius:1px;background:#0f2a1a;overflow:hidden;margin-top:6px;}
        .ep-strength-fill{height:100%;border-radius:1px;transition:width .3s,background .3s;}
        .ep-strength-lbl{font-size:8px;letter-spacing:.1em;margin-top:3px;}

        .ep-alert{padding:10px 14px;border-radius:7px;font-size:10px;letter-spacing:.04em;
          margin-bottom:14px;display:flex;align-items:center;gap:8px;}
        .ep-alert.err{background:#450a0a;border:1px solid #dc262633;color:#f87171;}
        .ep-alert.ok{background:#0d2e1f;border:1px solid #16a34a33;color:#22c55e;}
        .ep-alert.info{background:#0a1628;border:1px solid #60a5fa22;color:#60a5fa99;}

        .ep-btn-row{display:flex;gap:10px;margin-top:16px;}
        .ep-btn-p{padding:11px 24px;border-radius:7px;border:none;
          background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;cursor:pointer;
          font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.1em;font-weight:500;transition:opacity .18s;}
        .ep-btn-p:disabled{opacity:.45;cursor:not-allowed;}
        .ep-btn-p:not(:disabled):hover{opacity:.82;}
        .ep-btn-s{padding:11px 18px;border-radius:7px;border:1px solid #0f2a1a;background:transparent;
          color:#86efac55;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.1em;transition:all .18s;}
        .ep-btn-s:hover{border-color:#22c55e33;color:#22c55e;}
        .ep-btn-s:disabled{opacity:.4;cursor:not-allowed;}
        .ep-btn-d{padding:11px 20px;border-radius:7px;border:1px solid #dc262633;background:transparent;
          color:#f8717177;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.1em;transition:all .18s;}
        .ep-btn-d:hover{background:#450a0a;border-color:#dc2626;color:#f87171;}

        .ep-trow{display:flex;align-items:center;justify-content:space-between;
          padding:12px 0;border-bottom:1px solid #0f2a1a0a;}
        .ep-trow:last-child{border-bottom:none;}
        .ep-tinfo{flex:1;}
        .ep-tlabel{font-size:11px;color:#f0fdf4;margin-bottom:2px;}
        .ep-tsub{font-size:9px;color:#86efac44;letter-spacing:.04em;}
        .ep-toggle{width:36px;height:20px;border-radius:10px;border:1px solid #0f2a1a;
          background:#060a07;cursor:pointer;position:relative;transition:background .2s,border-color .2s;flex-shrink:0;}
        .ep-toggle--on{background:#16a34a;border-color:#22c55e44;}
        .ep-toggle-thumb{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:7px;
          background:#86efac55;transition:transform .2s,background .2s;}
        .ep-toggle--on .ep-toggle-thumb{transform:translateX(16px);background:#fff;}
        .ep-notif-ghdr{font-size:9px;color:#4ade8055;letter-spacing:.14em;
          margin:0 0 8px;padding-bottom:6px;border-bottom:1px solid #0f2a1a;}
        .ep-notif-g{margin-bottom:20px;}
        .ep-notif-g:last-child{margin-bottom:0;}

        .ep-sess-item{display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid #0f2a1a0a;}
        .ep-sess-item:last-child{border-bottom:none;}
        .ep-sess-icon{width:36px;height:36px;border-radius:8px;background:#0d2e1f;border:1px solid #0f2a1a;
          display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}
        .ep-sess-meta{flex:1;}
        .ep-sess-name{font-size:11px;color:#f0fdf4;margin-bottom:3px;}
        .ep-sess-detail{font-size:9px;color:#86efac44;letter-spacing:.04em;}
        .ep-sess-badge{font-size:8px;padding:2px 7px;border-radius:3px;background:#0d2e1f;
          color:#22c55e;border:1px solid #22c55e22;letter-spacing:.08em;margin-left:8px;}
        .ep-sess-revoke{padding:5px 10px;border-radius:5px;border:1px solid #dc262622;background:transparent;
          color:#f8717166;cursor:pointer;font-family:'DM Mono',monospace;font-size:8px;letter-spacing:.06em;transition:all .18s;}
        .ep-sess-revoke:hover{background:#450a0a;border-color:#dc262644;color:#f87171;}
        .ep-sess-revoke:disabled{opacity:.4;cursor:not-allowed;}

        .ep-act-item{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #0f2a1a0a;}
        .ep-act-item:last-child{border-bottom:none;}
        .ep-act-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;}
        .ep-act-name{font-size:10px;color:#f0fdf4;margin-bottom:2px;}
        .ep-act-time{font-size:8px;color:#86efac33;letter-spacing:.06em;}

        .ep-irow{display:flex;justify-content:space-between;align-items:center;
          padding:10px 0;border-bottom:1px solid #0f2a1a0a;font-size:10px;}
        .ep-irow:last-child{border-bottom:none;}
        .ep-ikey{color:#86efac55;letter-spacing:.1em;font-size:9px;}
        .ep-ival{color:#f0fdf4;}
        .ep-ival.g{color:#22c55e;} .ep-ival.y{color:#facc15;} .ep-ival.b{color:#60a5fa99;font-family:monospace;font-size:11px;}
        .ep-ilink{color:#22c55e77;cursor:pointer;font-size:9px;letter-spacing:.08em;text-decoration:underline;margin-left:10px;}

        .ep-dbox{padding:18px;border-radius:10px;background:#0d020280;border:1px solid #dc262622;margin-bottom:12px;}
        .ep-dtitle{font-size:10px;color:#f87171;letter-spacing:.12em;margin-bottom:6px;}
        .ep-ddesc{font-size:10px;color:#86efac55;line-height:1.9;margin-bottom:12px;}
        .ep-dwarn{font-size:9px;color:#f8717155;letter-spacing:.04em;padding:8px 12px;border-radius:6px;
          background:#450a0a22;border:1px solid #dc262622;margin-bottom:12px;}

        .ep-empty{text-align:center;padding:30px;color:#86efac33;font-size:10px;letter-spacing:.08em;}

        @keyframes epFadeUp{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}
        @keyframes epPulse{0%,100%{opacity:.4;}50%{opacity:1;}}
        @keyframes epSpin{to{transform:rotate(360deg);}}

        @media(max-width:600px){
          .ep-grid{grid-template-columns:1fr;}
          .ep-grid .full{grid-column:1;}
          .ep-av-zone{flex-direction:column;text-align:center;}
          .ep-av-btns{justify-content:center;}
          .ep-btn-row{flex-direction:column;}
          .ep-tabs{gap:3px;}
          .ep-tab{padding:6px 9px;font-size:8px;}
        }
      `}</style>

      <div className="ep-root">
        <div className="ep-wrap">

          <div className="ep-pg-label">ETHERTRACK · ACCOUNT SETTINGS</div>
          <div className="ep-pg-title">Edit <span>Profile</span></div>
          <div className="ep-pg-sub">MANAGE YOUR IDENTITY, SECURITY &amp; PREFERENCES</div>

          {dirty && tab === 'profile' && (
            <div className="ep-dirty">
              <span className="ep-dirty-dot" />UNSAVED CHANGES
            </div>
          )}

          {/* Tabs */}
          <div className="ep-tabs" role="tablist">
            {TABS.map(t => (
              <button key={t.id} role="tab" aria-selected={tab === t.id}
                className={`ep-tab${tab === t.id ? ' on' : ''}${t.id === 'danger' ? ' dng' : ''}`}
                onClick={() => setTab(t.id)}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* ══════ PROFILE ══════ */}
          {tab === 'profile' && (<>
            <Section title="PROFILE PHOTO" subtitle="DRAG & DROP OR CLICK TO CHANGE" delay={0}>
              <div className="ep-av-zone">
                <div className="ep-av-drop"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={pickFile}>
                  {preview
                    ? <img src={preview} alt="avatar" />
                    : <span className="ep-av-initials">{initials}</span>
                  }
                  <div className="ep-av-overlay">📷</div>
                  {avatarSpinner && <div className="ep-av-spinner"><div className="ep-spinner" /></div>}
                </div>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
                  onChange={pickFile} style={{ display:'none' }} />
                <div className="ep-av-meta">
                  <div className="ep-av-name">{name || 'Your Name'}</div>
                  <div className="ep-av-hint">JPG · PNG · WebP · MAX 5 MB</div>
                  <div className="ep-av-btns">
                    <label className="ep-av-upload" onClick={() => fileRef.current?.click()}>
                      UPLOAD PHOTO
                    </label>
                    {preview && (
                      <button className="ep-av-remove"
                        onClick={() => { setPreview(''); setAvatarFile(null); }}>
                        REMOVE
                      </button>
                    )}
                  </div>
                  {errors.avatar && <div style={{fontSize:9,color:'#f87171',marginTop:5}}>{errors.avatar}</div>}
                </div>
              </div>
            </Section>

            <Section title="PERSONAL INFORMATION" subtitle="STORED SECURELY · NEVER SOLD" delay={60}>
              {errors.profile  && <div className="ep-alert err">⚠ {errors.profile}</div>}
              {success.profile && <div className="ep-alert ok">{success.profile}</div>}

              <div className="ep-grid">
                <Field label="FULL NAME" error={errors.name}>
                  <Input hasError={!!errors.name} type="text" placeholder="Your full name"
                    value={name} onChange={e => { setName(e.target.value); clrErr('name'); }} />
                </Field>

                <Field label="EMAIL ADDRESS" error={errors.email}
                  hint="A confirmation link will be sent if changed">
                  <Input hasError={!!errors.email} type="email" placeholder="your@email.com"
                    value={email} onChange={e => { setEmail(e.target.value); clrErr('email'); }} />
                </Field>

                <Field label="COMPANY / ORGANISATION" optional>
                  <Input type="text" placeholder="Your company name"
                    value={company} onChange={e => setCompany(e.target.value)} />
                </Field>

                <Field label="PHONE NUMBER" optional error={errors.phone}
                  hint="Used for 2FA and critical alerts only">
                  <Input hasError={!!errors.phone} type="tel" placeholder="+91 98765 43210"
                    value={phone} onChange={e => { setPhone(e.target.value); clrErr('phone'); }} />
                </Field>

                <div className="ep-field full">
                  <label className="ep-field-label">TIMEZONE</label>
                  <select className="ep-input ep-select" value={timezone}
                    onChange={e => setTimezone(e.target.value)}>
                    {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                  </select>
                </div>

                <div className="ep-field full">
                  <label className="ep-field-label">
                    BIO <span className="ep-field-opt">OPTIONAL</span>
                  </label>
                  <textarea className="ep-input ep-textarea" maxLength={280}
                    placeholder="Brief description about yourself or your organisation…"
                    value={bio}
                    onChange={e => { setBio(e.target.value); clrErr('bio'); }} />
                  <div className="ep-char">{bio.length}/280</div>
                  {errors.bio && <span className="ep-field-err">{errors.bio}</span>}
                </div>
              </div>

              {/* Read-only KYC + Wallet */}
              <div style={{marginTop:16,padding:'12px 14px',borderRadius:7,background:'#040706',border:'1px solid #0f2a1a0a'}}>
                <div className="ep-irow">
                  <span className="ep-ikey">KYC STATUS</span>
                  <span className={`ep-ival ${dbUser?.kyc_verified ? 'g' : 'y'}`}>
                    {dbUser?.kyc_verified ? '✅ VERIFIED' : '⏳ PENDING'}
                    {!dbUser?.kyc_verified && (
                      <span className="ep-ilink" onClick={() => navigate('/kyc')}>COMPLETE →</span>
                    )}
                  </span>
                </div>
                <div className="ep-irow">
                  <span className="ep-ikey">WALLET</span>
                  <span className="ep-ival b">
                    {dbUser?.wallet_address
                      ? `${dbUser.wallet_address.slice(0,8)}...${dbUser.wallet_address.slice(-4)}`
                      : <span style={{color:'#86efac33'}}>NOT CONNECTED</span>
                    }
                    <span className="ep-ilink" onClick={() => navigate('/wallet')}>MANAGE →</span>
                  </span>
                </div>
              </div>

              <div className="ep-btn-row">
                <button className="ep-btn-s"
                  onClick={() => { if (dirty && !window.confirm('Discard changes?')) return; navigate('/profile'); }}>
                  CANCEL
                </button>
                <button className="ep-btn-p" onClick={saveProfile}
                  disabled={saving.profile || !dirty}>
                  {saving.profile ? 'SAVING…' : 'SAVE CHANGES →'}
                </button>
              </div>
            </Section>
          </>)}

          {/* ══════ SECURITY ══════ */}
          {tab === 'security' && (
            <Section title="CHANGE PASSWORD" subtitle="USE A STRONG, UNIQUE PASSWORD" delay={0}>
              {errors.password  && <div className="ep-alert err">⚠ {errors.password}</div>}
              {success.password && <div className="ep-alert ok">{success.password}</div>}

              {[
                { k:'cur',     label:'CURRENT PASSWORD',     val:curPw,     set:setCurPw,     ek:'curPw',     ph:'Your current password'  },
                { k:'new',     label:'NEW PASSWORD',         val:newPw,     set:setNewPw,     ek:'newPw',     ph:'Min 8 characters'       },
                { k:'confirm', label:'CONFIRM NEW PASSWORD', val:confirmPw, set:setConfirmPw, ek:'confirmPw', ph:'Repeat new password'    },
              ].map(({ k, label, val, set, ek, ph }) => (
                <Field key={k} label={label} error={errors[ek]}>
                  <div className="ep-pw-wrap">
                    <Input hasError={!!errors[ek]}
                      type={showPw[k] ? 'text' : 'password'}
                      placeholder={ph} value={val}
                      onChange={e => { set(e.target.value); clrErr(ek); }} />
                    <button type="button" className="ep-pw-eye"
                      onClick={() => setShowPw(p => ({ ...p, [k]: !p[k] }))}>
                      {showPw[k] ? '🙈' : '👁'}
                    </button>
                  </div>
                  {k === 'new' && newPw && (
                    <>
                      <div className="ep-strength-bar">
                        <div className="ep-strength-fill"
                          style={{ width:`${(strength.score/5)*100}%`, background:strength.color }} />
                      </div>
                      <div className="ep-strength-lbl" style={{ color:strength.color }}>
                        {strength.label}
                      </div>
                    </>
                  )}
                </Field>
              ))}

              <div className="ep-alert info">
                ℹ After changing, all other active sessions will be invalidated.
              </div>
              <div className="ep-btn-row">
                <button className="ep-btn-p" onClick={changePassword}
                  disabled={saving.password || !curPw || !newPw || !confirmPw}>
                  {saving.password ? 'CHANGING…' : 'CHANGE PASSWORD →'}
                </button>
              </div>
            </Section>
          )}

          {/* ══════ NOTIFICATIONS ══════ */}
          {tab === 'notifs' && (
            <Section title="NOTIFICATION PREFERENCES" subtitle="CONTROL WHAT YOU HEAR AND HOW" delay={0}>
              {errors.notifs  && <div className="ep-alert err">⚠ {errors.notifs}</div>}
              {success.notifs && <div className="ep-alert ok">{success.notifs}</div>}

              <div className="ep-notif-g">
                <div className="ep-notif-ghdr">📧 EMAIL NOTIFICATIONS</div>
                <Toggle checked={notifs.email_trade_executed}
                  onChange={v => setNotifs(p => ({ ...p, email_trade_executed: v }))}
                  label="Trade Executed" sub="Email when a buy or sell order is filled" />
                <Toggle checked={notifs.email_price_alert}
                  onChange={v => setNotifs(p => ({ ...p, email_price_alert: v }))}
                  label="Price Alerts" sub="Email when a credit hits your target price" />
                <Toggle checked={notifs.email_kyc_update}
                  onChange={v => setNotifs(p => ({ ...p, email_kyc_update: v }))}
                  label="KYC & Compliance Updates" sub="Regulatory and verification status changes" />
                <Toggle checked={notifs.email_newsletter}
                  onChange={v => setNotifs(p => ({ ...p, email_newsletter: v }))}
                  label="EtherTrack Newsletter" sub="Monthly market insights and platform updates" />
              </div>

              <div className="ep-notif-g">
                <div className="ep-notif-ghdr">🔔 PUSH NOTIFICATIONS</div>
                <Toggle checked={notifs.push_trade_executed}
                  onChange={v => setNotifs(p => ({ ...p, push_trade_executed: v }))}
                  label="Trade Executed" sub="In-app push when an order is filled" />
                <Toggle checked={notifs.push_price_alert}
                  onChange={v => setNotifs(p => ({ ...p, push_price_alert: v }))}
                  label="Price Alerts" sub="Instant push for price threshold breaches" />
              </div>

              <div className="ep-btn-row">
                <button className="ep-btn-p" onClick={saveNotifs} disabled={saving.notifs}>
                  {saving.notifs ? 'SAVING…' : 'SAVE PREFERENCES →'}
                </button>
              </div>
            </Section>
          )}

          {/* ══════ SESSIONS ══════ */}
          {tab === 'sessions' && (
            <Section title="ACTIVE SESSIONS" subtitle="ALL DEVICES CURRENTLY SIGNED IN" delay={0}>
              {!sessReady
                ? <div className="ep-empty">LOADING…</div>
                : sessions.length === 0
                  ? <div className="ep-empty">NO SESSION DATA — add session tracking to your backend to see devices here</div>
                  : sessions.map((s, i) => {
                      const cur  = s.is_current || i === 0;
                      const icon = s.device_type === 'mobile' ? '📱' : s.device_type === 'tablet' ? '📋' : '💻';
                      return (
                        <div className="ep-sess-item" key={s.id}>
                          <div className="ep-sess-icon">{icon}</div>
                          <div className="ep-sess-meta">
                            <div className="ep-sess-name">
                              {s.browser || 'Unknown Browser'} · {s.os || 'Unknown OS'}
                              {cur && <span className="ep-sess-badge">CURRENT</span>}
                            </div>
                            <div className="ep-sess-detail">
                              {s.ip_address ? `IP ${s.ip_address} · ` : ''}
                              Last active: {s.last_active_at ? new Date(s.last_active_at).toLocaleString('en-IN') : '—'}
                            </div>
                          </div>
                          <button className="ep-sess-revoke" disabled={revoking === s.id}
                            onClick={() => revokeSession(s.id, cur)}>
                            {revoking === s.id ? '…' : cur ? 'LOGOUT' : 'REVOKE'}
                          </button>
                        </div>
                      );
                    })
              }
              {sessions.length > 1 && (
                <div className="ep-btn-row" style={{ marginTop:16 }}>
                  <button className="ep-btn-d" onClick={async () => {
                    if (!window.confirm('Revoke all other sessions?')) return;
                    for (const s of sessions.slice(1)) await revokeSession(s.id, false);
                  }}>REVOKE ALL OTHER SESSIONS</button>
                </div>
              )}
            </Section>
          )}

          {/* ══════ ACTIVITY ══════ */}
          {tab === 'activity' && (
            <Section title="ACCOUNT ACTIVITY LOG" subtitle="RECENT SECURITY & PROFILE EVENTS" delay={0}>
              {actLog.length === 0
                ? <div className="ep-empty">NO ACTIVITY RECORDED YET</div>
                : actLog.map(a => (
                    <div className="ep-act-item" key={a.id}>
                      <div className="ep-act-dot"
                        style={{ background: DOT_COLORS[a.action] || '#22c55e' }} />
                      <div>
                        <div className="ep-act-name">{a.action.replace(/_/g, ' ')}</div>
                        <div className="ep-act-time">
                          {new Date(a.created_at).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' })}
                          {a.ip_hint ? ` · ${a.ip_hint}` : ''}
                        </div>
                      </div>
                    </div>
                  ))
              }
            </Section>
          )}

          {/* ══════ DANGER ZONE ══════ */}
          {tab === 'danger' && (
            <Section title="DANGER ZONE" subtitle="IRREVERSIBLE ACTIONS — PROCEED WITH EXTREME CAUTION" delay={0}>
              <div className="ep-dbox">
                <div className="ep-dtitle">⚠ PERMANENTLY DELETE ACCOUNT</div>
                <div className="ep-ddesc">
                  Deletes all personal data, trade history, portfolio records, and KYC information.
                  On-chain transactions cannot be reversed. Wallet associations will be removed from
                  our systems but remain permanently on the Ethereum blockchain.
                </div>
                <div className="ep-dwarn">
                  🔒 Compliant with DPDP Act 2023 §13 · IT Act 2000 §43A · UIDAI Guidelines.
                  Data purged within 72 hours of confirmed request. Email confirmation will be sent.
                </div>
                <button className="ep-btn-d" onClick={requestDeletion}>
                  REQUEST ACCOUNT DELETION →
                </button>
              </div>
              <div style={{fontSize:9,color:'#86efac33',letterSpacing:'.04em',lineHeight:1.9}}>
                To cancel within the 72-hour window, email{' '}
                <span style={{color:'#22c55e77'}}>support@ethertrack.in</span>{' '}
                with subject "CANCEL DELETION REQUEST" and your User ID:{' '}
                <span style={{color:'#86efac55'}}>{dbUser?.id?.slice(0,8).toUpperCase() || '—'}</span>
              </div>
            </Section>
          )}

        </div>
      </div>
    </>
  );
};

export default EditProfile;