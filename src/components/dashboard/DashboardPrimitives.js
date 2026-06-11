/**
 * components/dashboard/DashboardPrimitives.jsx
 *
 * Small, purely presentational components used across dashboard cards.
 * All are memo-wrapped. None import from hooks — they receive only props.
 */

import React, { useState, useEffect, useRef, memo } from 'react';
import { createPortal } from 'react-dom';
import s from './Dashboard.module.css';
import { timeAgo } from '../../utils/dashboard';

// ── Clock ─────────────────────────────────────────────────────────────────
export const Clock = memo(function Clock() {
  const [t, setT] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{ textAlign: 'right' }} role="timer" aria-label="Current time">
      <div className={s.clockVal}>
        {t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
      </div>
      <div className={s.clockDate}>
        {t.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}
      </div>
    </div>
  );
});

// ── Spark chart ───────────────────────────────────────────────────────────
export const Spark = memo(function Spark({ data, color }) {
  if (!Array.isArray(data) || data.length < 2) return null;
  const max  = Math.max(...data);
  const min  = Math.min(...data);
  const norm = (v) => 28 - ((v - min) / (max - min || 1)) * 24;
  const pts  = data.map((v, i) => `${(i / (data.length - 1)) * 80},${norm(v)}`).join(' ');
  return (
    <svg width="80" height="28" style={{ display: 'block', flexShrink: 0 }} aria-hidden="true">
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" points={pts} opacity="0.9" />
      <polyline fill={color} fillOpacity="0.1" stroke="none" points={`0,28 ${pts} 80,28`} />
    </svg>
  );
});

// ── Emission arc ──────────────────────────────────────────────────────────
export const EmissionArc = memo(function EmissionArc({ pct, creditsRetiredButNoEmissions }) {
  const r = 50, cx = 64, cy = 64, arcLen = Math.PI * r;
  const fill  = creditsRetiredButNoEmissions ? arcLen : (pct / 100) * arcLen;
  const color = creditsRetiredButNoEmissions ? '#4ade80' : '#22c55e';
  return (
    <svg width="128" height="76" viewBox="0 0 128 80" role="img"
      aria-label={creditsRetiredButNoEmissions
        ? 'Credits retired — log emissions to calculate offset'
        : `Emission offset ${pct}%`}
    >
      <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`} fill="none" stroke="#0f2a1a" strokeWidth="8" strokeLinecap="round" />
      <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${fill} ${arcLen}`}
        style={{ transition: 'stroke-dasharray 1.2s ease' }}
      />
      <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.2" />
    </svg>
  );
});

// ── Error card ────────────────────────────────────────────────────────────
export const ErrorCard = memo(function ErrorCard({ label, onRetry }) {
  return (
    <div style={{ textAlign: 'center', padding: '20px 0' }} role="alert">
      <div style={{ fontSize: 11, color: '#f87171aa', letterSpacing: '.08em', marginBottom: 8 }}>
        ⚠ COULDN'T LOAD {label}
      </div>
      <button onClick={onRetry} aria-label={`Retry loading ${label}`} className={s.retryBtn}>
        RETRY ↻
      </button>
    </div>
  );
});

// ── Connect wallet CTA ────────────────────────────────────────────────────
export const ConnectWalletCTA = memo(function ConnectWalletCTA({ onConnect }) {
  return (
    <div style={{ textAlign: 'center', marginTop: 8 }}>
      <button onClick={onConnect} aria-label="Connect MetaMask wallet" className={s.connectWalletBtn}>
        🦊 CONNECT WALLET
      </button>
    </div>
  );
});

// ── Last refreshed ────────────────────────────────────────────────────────
export const LastRefreshed = memo(function LastRefreshed({ ts }) {
  const label = timeAgo(ts);
  if (!label) return null;
  return <div className={s.lastRefreshed}>Updated {label}</div>;
});

// ── KYC Success banner ────────────────────────────────────────────────────
export const KYCSuccessBanner = memo(function KYCSuccessBanner({ kycCompleted }) {
  const [visible, setVisible] = useState(false);
  const shownRef = useRef(false);
  useEffect(() => {
    if (kycCompleted && !shownRef.current) {
      shownRef.current = true;
      setVisible(true);
      const id = setTimeout(() => setVisible(false), 8_000);
      return () => clearTimeout(id);
    }
  }, [kycCompleted]);
  if (!visible) return null;
  return (
    <div role="status" aria-live="polite" className={s.kycSuccessBanner}>
      <div>
        <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 700, marginBottom: 2 }}>
          ✅ KYC Verified — Full Trading Access Unlocked
        </div>
        <div style={{ fontSize: 11, color: '#22c55e66', letterSpacing: '.06em' }}>
          You can now buy, sell, and retire carbon credits on-chain.
        </div>
      </div>
      <button onClick={() => setVisible(false)} aria-label="Dismiss KYC banner" className={s.dismissBtn}>×</button>
    </div>
  );
});

// ── KYC Expiry warning ────────────────────────────────────────────────────
export const KYCExpiryWarning = memo(function KYCExpiryWarning({ expiresAt, onNavigate }) {
  const { daysUntil } = require('../../utils/dashboard');
  const days = daysUntil(expiresAt);
  const { KYC_EXPIRY_WARN_DAYS } = require('../../constants/dashboard');
  if (days === null || days > KYC_EXPIRY_WARN_DAYS) return null;
  const isExpired = days <= 0;
  return (
    <div role="alert" className={`${s.kycExpiryBanner} ${isExpired ? s.kycExpiryBannerExpired : s.kycExpiryBannerExpiring}`}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>
          {isExpired ? '🔴 KYC Expired — Trading Suspended' : `⏰ KYC Expires in ${days} Day${days === 1 ? '' : 's'}`}
        </div>
        <div style={{ fontSize: 11, letterSpacing: '.06em', opacity: .7 }}>
          {isExpired
            ? 'Your KYC has expired. Re-verify immediately to restore trading access.'
            : 'Renew your KYC before expiry to avoid trading interruption.'}
        </div>
      </div>
      <button className={s.kycRenewBtn} onClick={() => onNavigate('/kyc')}>
        {isExpired ? 'RE-VERIFY →' : 'RENEW →'}
      </button>
    </div>
  );
});

// ── Session expired modal (with focus trap) ───────────────────────────────
export const SessionExpiredModal = memo(function SessionExpiredModal({ visible }) {
  const btnRef = useRef(null);

  // Focus trap
  useEffect(() => {
    if (!visible) return;

    // Store previous focus
    const previousFocus = document.activeElement;

    // Focus the login button
    const frame = requestAnimationFrame(() => btnRef.current?.focus());

    // Trap Tab / Shift+Tab within modal
    const handleKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault(); // only one focusable element — keep focus on it
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [visible]);

  if (!visible) return null;

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-modal-title"
      aria-describedby="session-modal-desc"
      className={s.sessionModalOverlay}
    >
      <div className={s.sessionModalBox}>
        <div style={{ fontSize: 36, marginBottom: 16 }} aria-hidden="true">🔐</div>
        <div id="session-modal-title" style={{ fontSize: 15, color: '#f0fdf4', fontWeight: 700, marginBottom: 8 }}>
          Session Expired
        </div>
        <div id="session-modal-desc" style={{ fontSize: 12, color: '#86efac66', marginBottom: 24, lineHeight: 1.7 }}>
          Your session has expired for security. Please log in again to continue trading.
        </div>
        <button
          ref={btnRef}
          className={s.sessionLoginBtn}
          onClick={() => { window.location.href = '/login'; }}
        >
          LOG IN AGAIN
        </button>
      </div>
    </div>,
    document.body,
  );
});

// ── Empty market state ────────────────────────────────────────────────────
export const EmptyMarketState = memo(function EmptyMarketState({ onAction }) {
  return (
    <div style={{ textAlign: 'center', padding: '28px 0' }} role="status">
      <svg width="64" height="64" viewBox="0 0 64 64" style={{ marginBottom: 12 }} aria-hidden="true">
        <circle cx="32" cy="32" r="28" fill="#0d2e1f" stroke="#22c55e22" strokeWidth="1" />
        <text x="32" y="40" textAnchor="middle" fontSize="26">🌿</text>
      </svg>
      <div style={{ fontSize: 13, color: '#86efac44', marginBottom: 14, lineHeight: 1.7 }}>
        No credits listed yet.<br />Be the first to tokenize and list on-chain.
      </div>
      <button onClick={onAction} className={s.listCreditsBtn}>+ LIST CARBON CREDITS</button>
    </div>
  );
});

// ── Page skeleton loader ──────────────────────────────────────────────────
export function PageSkeleton() {
  const Sh = ({ w, h, style = {} }) => (
    <span className={s.shimmer} style={{ display: 'block', width: w, height: h, borderRadius: 4, ...style }} />
  );
  return (
    <div className={s.grid} aria-busy="true" aria-label="Loading dashboard">
      {[0,1,2,3].map((i) => (
        <div key={i} className={`${s.card} ${s.c3}`}>
          <Sh w={80}  h={11} style={{ marginBottom: 12 }} />
          <Sh w={110} h={32} style={{ marginBottom: 8  }} />
          <Sh w={90}  h={11} />
        </div>
      ))}
      <div className={`${s.card} ${s.c8}`}>
        <Sh w={160} h={11} style={{ marginBottom: 14 }} />
        {[0,1,2,3].map((i) => <Sh key={i} w="100%" h={44} style={{ marginBottom: 8 }} />)}
      </div>
      <div className={`${s.card} ${s.c4}`}>
        <Sh w={100} h={11} style={{ marginBottom: 12 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
          {[0,1,2,3,4,5].map((i) => <Sh key={i} w="100%" h={68} />)}
        </div>
      </div>
      <div className={`${s.card} ${s.c4}`}>
        <Sh w={120} h={11} style={{ marginBottom: 14 }} />
        <Sh w={128} h={76} style={{ margin: '0 auto 10px', borderRadius: 8 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {[0,1,2,3].map((i) => <Sh key={i} w="100%" h={48} />)}
        </div>
      </div>
      <div className={`${s.card} ${s.c4}`}>
        <Sh w={140} h={11} style={{ marginBottom: 14 }} />
        {[0,1,2].map((i) => <Sh key={i} w="100%" h={48} style={{ marginBottom: 10 }} />)}
      </div>
    </div>
  );
}