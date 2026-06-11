import React, { useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../App';
import { useNotifications } from '../context/NotificationContext';
import useWallet from '../hooks/useWallet';
import { walletAPI } from '../services/api';

// ── Lightweight MetaMask-only header (no INR logic here)
// All INR wallet functionality lives in /wallet page

// ── Subscription tier helpers (mirrors App.jsx) ────────────────────────────
const TIER_RANK = { free: 0, starter: 1, growth: 2, corporate: 3 };

function getPlanTier(plan) {
  if (!plan) return 'free';
  const p = plan.toLowerCase();
  if (p.includes('corporate')) return 'corporate';
  if (p.includes('growth'))    return 'growth';
  if (p.includes('starter'))   return 'starter';
  return 'free';
}

function tierRank(plan) {
  return TIER_RANK[getPlanTier(plan)] ?? 0;
}

const PLAN_INFO = {
  starter: {
    name:  'Starter',
    price: '₹1,499/mo',
    color: '#3b82f6',
    features: [
      'Everything in Free',
      'Portfolio management',
      'List & sell credits',
      'Credit retirement',
      'Portfolio export',
      '3 seats',
    ],
  },
  growth: {
    name:  'Growth',
    price: '₹7,999/mo',
    color: '#a855f7',
    features: [
      'Everything in Starter',
      'Scope 1 + 2 full tracking',
      'Basic Scope 3 (5 categories)',
      'GHG inventory ledger',
      'CSV export + analytics dashboard',
      'Carbon intensity metrics',
      'Basic decarbonisation scenarios',
      'GHG Protocol PDF report',
      '10 seats',
    ],
  },
  corporate: {
    name:  'Corporate',
    price: 'Contact Sales',
    color: '#f59e0b',
    features: [
      'Everything in Growth',
      'Full Scope 3 (all 15 categories)',
      'BRSR / CDP / TCFD / GHG PDF reports',
      'Audit trail + verifier integration',
      'GEI / BEE / PAT / CCTS compliance',
      '5-year decarbonisation plan',
      'MRV calendar + SBTi target setting',
      'Supplier data portal',
      'Multi-entity consolidation',
      'Carbon neutrality certificate',
      'Regulatory deadline alerts',
      'Custom seats',
    ],
  },
};

// ── Upgrade Modal ─────────────────────────────────────────────────────────────
function UpgradeModal({ requiredPlan, onClose }) {
  const info = PLAN_INFO[requiredPlan];
  if (!info) return null;
  const isCorporate = requiredPlan === 'corporate';

  return (
    <div
      onClick={onClose}
      style={{
        position:       'fixed',
        inset:          0,
        background:     'rgba(0,0,0,0.80)',
        backdropFilter: 'blur(5px)',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        zIndex:         9999,
        padding:        '20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background:   '#0a0f0c',
          border:       `1px solid ${info.color}55`,
          borderRadius: '14px',
          padding:      '36px 32px',
          maxWidth:     '420px',
          width:        '100%',
          fontFamily:   "'DM Mono', monospace",
          position:     'relative',
          boxShadow:    `0 0 60px ${info.color}18, 0 24px 64px rgba(0,0,0,.7)`,
          animation:    'upgradeModalIn 0.22s ease',
        }}
      >
        <style>{`@keyframes upgradeModalIn{from{opacity:0;transform:translateY(-12px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}`}</style>

        {/* Close */}
        <button onClick={onClose} style={{
          position: 'absolute', top: '14px', right: '14px',
          background: 'none', border: 'none', color: '#4b5563',
          fontSize: '16px', cursor: 'pointer', lineHeight: 1,
          transition: 'color 0.2s',
        }}>✕</button>

        {/* Lock icon */}
        <div style={{ fontSize: '34px', marginBottom: '14px' }}>🔒</div>

        {/* Plan badge */}
        <div style={{
          display: 'inline-block', fontSize: '9px', letterSpacing: '0.18em',
          color: info.color, border: `1px solid ${info.color}44`,
          borderRadius: '4px', padding: '3px 8px', marginBottom: '10px',
          background: `${info.color}11`,
        }}>
          {info.name.toUpperCase()} PLAN REQUIRED
        </div>

        <h2 style={{ color: '#f0fdf4', margin: '0 0 8px', fontSize: '18px', fontWeight: 700 }}>
          Upgrade to {info.name}
        </h2>
        <p style={{ color: '#86efac66', margin: '0 0 20px', fontSize: '12px', lineHeight: 1.7 }}>
          This feature is available on the{' '}
          <strong style={{ color: info.color }}>{info.name}</strong> plan
          {!isCorporate && <> — starting at <strong style={{ color: '#f0fdf4' }}>{info.price}</strong></>}.
        </p>

        {/* Features */}
        <ul style={{ margin: '0 0 24px', padding: 0, listStyle: 'none' }}>
          {info.features.map((f) => (
            <li key={f} style={{
              display: 'flex', alignItems: 'flex-start', gap: '8px',
              color: '#d1fae5', fontSize: '12px', marginBottom: '7px',
            }}>
              <span style={{ color: info.color, flexShrink: 0, marginTop: '1px' }}>✓</span>
              {f}
            </li>
          ))}
        </ul>

        {/* CTA */}
        {isCorporate ? (
          <a
            href="https://mail.google.com/mail/?view=cm&to=support@ethertrack.in" target="_blank" rel="noreferrer"
            style={{
              display: 'block', textAlign: 'center', padding: '12px',
              background: info.color, color: '#000', borderRadius: '7px',
              fontWeight: 'bold', fontSize: '13px', textDecoration: 'none',
              letterSpacing: '0.06em',
            }}
          >
            Contact Sales → support@ethertrack.in
          </a>
        ) : (
          <a
            href="/billing"
            style={{
              display: 'block', textAlign: 'center', padding: '12px',
              background: info.color, color: '#000', borderRadius: '7px',
              fontWeight: 'bold', fontSize: '13px', textDecoration: 'none',
              letterSpacing: '0.06em',
            }}
          >
            Upgrade to {info.name} →
          </a>
        )}

        <p style={{ color: '#374151', fontSize: '10px', textAlign: 'center', margin: '10px 0 0' }}>
          Cancel anytime · Billed monthly
        </p>
      </div>
    </div>
  );
}

// ── Nav link definitions with required plan ───────────────────────────────────
// requiredPlan: undefined = free (always accessible), otherwise the minimum plan needed
const NAV_LINKS = [
  { to: '/dashboard',         label: 'DASHBOARD',  requiredPlan: undefined   },
  { to: '/portfolio',         label: 'PORTFOLIO',  requiredPlan: 'starter'   },
  { to: '/carbon-credits',    label: 'MARKET',     requiredPlan: undefined   },
  { to: '/trading-history',   label: 'HISTORY',    requiredPlan: undefined   },
  { to: '/wallet',            label: 'WALLET',     requiredPlan: undefined   },
  { to: '/emission-tracking', label: 'EMISSIONS',  requiredPlan: 'growth'    },
  { to: '/compliance',        label: 'COMPLIANCE', requiredPlan: 'corporate' },
  { to: '/team',              label: 'TEAM',       requiredPlan: 'corporate' },
  { to: '/profile',           label: 'PROFILE',    requiredPlan: undefined   },
];

// ── Header ─────────────────────────────────────────────────────────────────────
const Header = () => {
  const { isAuthenticated, handleLogout, dbUser, setDbUser } = useContext(AuthContext);
  const { notifications, unreadCount, markRead, markAllRead, deleteOne, getTypeMeta, timeAgo } = useNotifications();
  const { address, shortAddress, isConnected, isConnecting, balance, balanceINR, network, connect, disconnect } = useWallet();

  const navigate  = useNavigate();
  const location  = useLocation();

  const [menuOpen,      setMenuOpen]      = useState(false);
  const [bellOpen,      setBellOpen]      = useState(false);
  const [walletOpen,    setWalletOpen]    = useState(false);
  const [scrolled,      setScrolled]      = useState(false);
  const [binding,       setBinding]       = useState(false);
  const [bindDone,      setBindDone]      = useState(false);

  // Upgrade modal state
  const [upgradeModal,  setUpgradeModal]  = useState(null); // null | 'starter' | 'growth' | 'corporate'

  const bellRef   = useRef(null);
  const walletRef = useRef(null);

  const userPlan = dbUser?.subscription_plan || 'free';

  // Check if user has access to a given required plan
  const hasAccess = useCallback((requiredPlan) => {
    if (!requiredPlan) return true;
    return tierRank(userPlan) >= tierRank(requiredPlan);
  }, [userPlan]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false); setBellOpen(false); setWalletOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handler = (e) => {
      if (bellRef.current   && !bellRef.current.contains(e.target))   setBellOpen(false);
      if (walletRef.current && !walletRef.current.contains(e.target)) setWalletOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const silentBind = async (walletAddress) => {
    if (dbUser?.wallet_address || bindDone) return;
    setBinding(true);
    try {
      const challengeRes = await walletAPI.challenge(walletAddress);
      const message = challengeRes?.message || challengeRes?.data?.message;
      if (!message) return;
      const signature = await window.ethereum.request({ method: 'personal_sign', params: [message, walletAddress] });
      const bindRes   = await walletAPI.bind({ walletAddress, signature, message });
      if (bindRes?.user) setDbUser?.(bindRes.user);
      setBindDone(true);
    } catch (e) { console.warn('Auto wallet bind skipped:', e?.message || e); }
    finally { setBinding(false); }
  };

  const handleConnect = async () => {
    try {
      await connect();
      if (window.ethereum) {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts?.[0]) silentBind(accounts[0]);
      }
    } catch (e) { console.error('Connect failed:', e?.message); }
  };

  useEffect(() => {
    if (isConnected && address && !dbUser?.wallet_address && !bindDone) silentBind(address);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);

  const handleLogoutClick = () => { disconnect(); handleLogout(); navigate('/login'); };
  const isActive = (path) => location.pathname === path;

  // Handle nav link click — intercept locked routes
  const handleNavClick = useCallback((e, link) => {
    if (!hasAccess(link.requiredPlan)) {
      e.preventDefault();
      setUpgradeModal(link.requiredPlan);
    }
  }, [hasAccess]);

  const walletBound = !!dbUser?.wallet_address || bindDone;

  // Lock badge colors per tier
  const lockColor = { starter: '#3b82f6', growth: '#a855f7', corporate: '#f59e0b' };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
        .et-header{position:fixed;top:0;left:0;right:0;z-index:1000;font-family:'DM Mono',monospace;background:#080c0aee;border-bottom:1px solid #0f2a1a;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);transition:box-shadow 0.3s;height:60px;display:flex;align-items:center;}
        .et-header.scrolled{box-shadow:0 4px 32px rgba(0,0,0,0.5);}
        .et-header-inner{max-width:1200px;margin:0 auto;padding:0 24px;width:100%;display:flex;align-items:center;justify-content:space-between;gap:24px;}
        .et-header-brand{display:flex;align-items:center;gap:10px;text-decoration:none;flex-shrink:0;}
        .et-header-nav{display:flex;align-items:center;gap:4px;flex:1;justify-content:center;}

        /* ── Unlocked nav link ── */
        .et-nav-link{padding:6px 14px;border-radius:5px;font-size:11px;letter-spacing:0.1em;font-weight:500;color:#4ade8066;text-decoration:none;transition:color 0.2s,background 0.2s;white-space:nowrap;position:relative;display:inline-flex;align-items:center;gap:5px;}
        .et-nav-link:hover{color:#22c55e;background:#0d2e1f;}
        .et-nav-link.active{color:#22c55e;background:#0d2e1f;border:1px solid #16a34a22;}

        /* ── Locked nav link ── */
        .et-nav-link.locked{color:#4ade8033;cursor:pointer;}
        .et-nav-link.locked:hover{background:#0f1a10;color:#4ade8055;}
        .et-nav-link.locked .et-lock-badge{
          display:inline-flex;align-items:center;gap:2px;
          font-size:8px;letter-spacing:0.06em;padding:1px 5px;
          border-radius:3px;font-weight:700;opacity:0.85;
        }
        /* Tier-specific lock badge colors applied via inline style */

        .et-header-right{display:flex;align-items:center;gap:10px;flex-shrink:0;}
        .et-header-divider{width:1px;height:20px;background:#0f2a1a;flex-shrink:0;}
        .et-live{display:flex;align-items:center;gap:5px;font-size:10px;color:#4ade8055;letter-spacing:0.1em;position:relative;cursor:default;}
        .et-live:hover .et-live-tooltip{opacity:1;pointer-events:auto;}
        .et-live-dot{width:5px;height:5px;border-radius:50%;background:#22c55e;animation:livePulse 1.5s infinite;}
        .et-live-tooltip{position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%);background:#0a0f0c;border:1px solid #0f2a1a;border-radius:6px;padding:6px 10px;white-space:nowrap;font-size:9px;color:#86efac88;letter-spacing:0.06em;opacity:0;pointer-events:none;transition:opacity 0.2s;z-index:2000;line-height:1.6;}
        .et-live-tooltip::before{content:'';position:absolute;bottom:100%;left:50%;transform:translateX(-50%);border:4px solid transparent;border-bottom-color:#0f2a1a;}
        @keyframes livePulse{0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,0.4);}50%{box-shadow:0 0 0 3px rgba(34,197,94,0);}}
        .et-inr-chip{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:6px;border:1px solid #22c55e33;background:#0d2e1f22;text-decoration:none;transition:all 0.2s;white-space:nowrap;}
        .et-inr-chip:hover{background:#0d2e1f;border-color:#22c55e55;}
        .et-inr-chip-flag{font-size:12px;}
        .et-inr-chip-bal{font-size:11px;font-weight:700;color:#22c55e;letter-spacing:0.04em;}
        .et-meta-pill{display:flex;align-items:center;gap:5px;padding:6px 12px;border-radius:6px;border:1px solid #0f2a1a;background:transparent;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:0.06em;color:#4ade8044;transition:all 0.2s;white-space:nowrap;}
        .et-meta-pill:hover{background:#0d2e1f;border-color:#22c55e44;color:#22c55e;}
        .et-meta-pill.connected{border-color:#22c55e33;color:#22c55e88;}
        .et-meta-pill.connected:hover{background:#0d2e1f;border-color:#22c55e;color:#22c55e;}
        .et-meta-dot{width:5px;height:5px;border-radius:50%;}
        .et-meta-dot.on{background:#22c55e;}
        .et-meta-dot.off{background:#4ade8033;}
        .et-meta-wrap{position:relative;}
        .et-meta-dropdown{position:absolute;top:calc(100% + 10px);right:0;width:240px;background:#0a0f0c;border:1px solid #0f2a1a;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,0.7);z-index:2000;animation:dropIn 0.2s ease;overflow:hidden;}
        .et-meta-drop-hdr{padding:12px 14px;border-bottom:1px solid #0f2a1a;display:flex;align-items:center;justify-content:space-between;}
        .et-meta-drop-title{font-size:10px;color:#f0fdf4;font-weight:700;letter-spacing:0.1em;}
        .et-meta-drop-status{font-size:9px;padding:2px 7px;border-radius:4px;letter-spacing:0.06em;}
        .et-meta-drop-status.on{background:#0d2e1f;color:#22c55e;border:1px solid #22c55e33;}
        .et-meta-drop-status.off{background:#1a0a0a;color:#f87171;border:1px solid #f8717133;}
        .et-meta-drop-body{padding:12px 14px;}
        .et-meta-addr{font-size:9px;color:#4ade8055;word-break:break-all;padding:6px 8px;background:#040706;border-radius:5px;margin-bottom:10px;line-height:1.6;}
        .et-meta-stat{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #0f2a1a18;}
        .et-meta-stat:last-of-type{border-bottom:none;}
        .et-meta-stat-label{font-size:9px;color:#4ade8033;letter-spacing:0.08em;}
        .et-meta-stat-val{font-size:10px;color:#f0fdf4;font-weight:600;}
        .et-meta-stat-val.g{color:#22c55e;}
        .et-meta-drop-foot{padding:10px 14px;border-top:1px solid #0f2a1a;}
        .et-meta-connect-btn{width:100%;padding:9px;border-radius:7px;border:none;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;font-weight:700;letter-spacing:0.08em;transition:opacity 0.2s;}
        .et-meta-connect-btn:hover{opacity:0.85;}
        .et-meta-connect-btn:disabled{opacity:0.5;cursor:not-allowed;}
        .et-meta-disc-btn{width:100%;padding:8px;border-radius:6px;border:1px solid #dc262633;background:transparent;color:#f8717155;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:0.08em;transition:all 0.2s;}
        .et-meta-disc-btn:hover{background:#450a0a;border-color:#dc2626;color:#f87171;}
        .et-meta-not-conn{padding:14px;text-align:center;}
        .et-meta-not-conn-icon{font-size:26px;margin-bottom:8px;}
        .et-meta-not-conn-desc{font-size:9px;color:#4ade8044;letter-spacing:0.06em;line-height:1.7;margin-bottom:12px;}
        .et-bell-wrap{position:relative;}
        .et-bell-btn{position:relative;width:34px;height:34px;border-radius:7px;border:1px solid #0f2a1a;background:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.2s;font-size:15px;}
        .et-bell-btn:hover{border-color:#22c55e44;background:#0d2e1f;}
        .et-bell-badge{position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;border-radius:8px;padding:0 3px;background:#dc2626;border:2px solid #080c0a;font-size:9px;color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;}
        .et-bell-dropdown{position:absolute;top:calc(100% + 10px);right:0;width:340px;background:#0a0f0c;border:1px solid #0f2a1a;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,0.7);z-index:2000;animation:dropIn 0.2s ease;overflow:hidden;}
        .et-bell-top{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #0f2a1a;}
        .et-bell-top-title{font-size:11px;color:#f0fdf4;font-weight:700;letter-spacing:0.1em;}
        .et-bell-mark-all{font-size:10px;color:#22c55e88;cursor:pointer;background:none;border:none;font-family:inherit;letter-spacing:0.06em;padding:0;}
        .et-bell-mark-all:hover{color:#22c55e;}
        .et-bell-list{max-height:300px;overflow-y:auto;}
        .et-bell-list::-webkit-scrollbar{width:3px;}
        .et-bell-list::-webkit-scrollbar-thumb{background:#0f2a1a;border-radius:2px;}
        .et-bell-item{display:flex;align-items:flex-start;gap:10px;padding:12px 16px;border-bottom:1px solid #0f2a1a18;cursor:pointer;transition:background 0.15s;position:relative;}
        .et-bell-item:hover{background:#0f1a1255;}
        .et-bell-item.unread{background:#0d2e1f22;}
        .et-bell-item-icon{width:30px;height:30px;border-radius:8px;flex-shrink:0;background:#060a07;border:1px solid #0f2a1a;display:flex;align-items:center;justify-content:center;font-size:13px;}
        .et-bell-item-body{flex:1;min-width:0;}
        .et-bell-item-title{font-size:11px;color:#f0fdf4;font-weight:700;margin-bottom:2px;}
        .et-bell-item-msg{font-size:10px;color:#4ade8066;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .et-bell-item-time{font-size:9px;color:#4ade8033;margin-top:3px;}
        .et-bell-unread-dot{width:6px;height:6px;border-radius:50%;background:#22c55e;flex-shrink:0;margin-top:4px;}
        .et-bell-del{position:absolute;top:10px;right:10px;background:none;border:none;cursor:pointer;font-size:11px;color:#4ade8022;opacity:0;transition:opacity 0.2s;}
        .et-bell-item:hover .et-bell-del{opacity:1;}
        .et-bell-del:hover{color:#f87171;}
        .et-bell-empty{padding:32px;text-align:center;font-size:11px;color:#4ade8033;}
        .et-bell-footer{padding:12px 16px;border-top:1px solid #0f2a1a;text-align:center;}
        .et-bell-footer a{font-size:11px;color:#22c55e88;text-decoration:none;letter-spacing:0.08em;}
        .et-bell-footer a:hover{color:#22c55e;}
        .et-login-btn{padding:7px 16px;border-radius:6px;border:1px solid #0f2a1a;background:transparent;color:#4ade8088;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:0.08em;transition:all 0.2s;text-decoration:none;display:inline-flex;align-items:center;}
        .et-login-btn:hover{color:#22c55e;border-color:#22c55e44;background:#0d2e1f;}
        .et-signup-btn{padding:7px 16px;border-radius:6px;border:1px solid #22c55e55;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:0.08em;transition:opacity 0.2s;text-decoration:none;display:inline-flex;align-items:center;}
        .et-signup-btn:hover{opacity:0.85;}
        .et-logout-btn{padding:7px 14px;border-radius:6px;border:1px solid #dc262633;background:transparent;color:#f8717166;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:0.08em;transition:all 0.2s;}
        .et-logout-btn:hover{background:#450a0a;border-color:#dc2626;color:#f87171;}
        .et-hamburger{display:none;flex-direction:column;gap:4px;cursor:pointer;padding:4px;background:none;border:none;}
        .et-hamburger span{display:block;width:20px;height:2px;background:#4ade8088;border-radius:2px;transition:all 0.3s;}
        .et-hamburger.open span:nth-child(1){transform:rotate(45deg) translate(4px,4px);}
        .et-hamburger.open span:nth-child(2){opacity:0;}
        .et-hamburger.open span:nth-child(3){transform:rotate(-45deg) translate(4px,-4px);}
        .et-mobile-menu{position:fixed;top:60px;left:0;right:0;background:#080c0af5;border-bottom:1px solid #0f2a1a;backdrop-filter:blur(12px);padding:16px 24px 20px;display:flex;flex-direction:column;gap:4px;z-index:999;animation:menuSlide 0.2s ease;}
        .et-mobile-nav-link{padding:12px 16px;border-radius:6px;font-size:12px;letter-spacing:0.1em;color:#4ade8077;text-decoration:none;transition:all 0.2s;border:1px solid transparent;display:flex;align-items:center;justify-content:space-between;}
        .et-mobile-nav-link:hover,.et-mobile-nav-link.active{color:#22c55e;background:#0d2e1f;border-color:#16a34a22;}
        .et-mobile-nav-link.locked{color:#4ade8033;cursor:pointer;}
        .et-mobile-nav-link.locked:hover{background:#0f1a10;color:#4ade8044;}
        .et-mobile-divider{height:1px;background:#0f2a1a;margin:8px 0;}
        @keyframes dropIn{from{opacity:0;transform:translateY(-8px);}to{opacity:1;transform:translateY(0);}}
        @keyframes menuSlide{from{opacity:0;transform:translateY(-8px);}to{opacity:1;transform:translateY(0);}}
        @media(max-width:768px){.et-header-nav{display:none;}.et-hamburger{display:flex;}.et-live{display:none;}.et-header-divider{display:none;}.et-bell-dropdown{width:300px;right:-40px;}.et-meta-dropdown{right:-20px;width:220px;}}
        @media(min-width:769px){.et-mobile-menu{display:none !important;}}
        .et-header-spacer{height:60px;}
      `}</style>

      <header className={`et-header${scrolled ? ' scrolled' : ''}`}>
        <div className="et-header-inner">

          {/* Brand */}
          <Link to={isAuthenticated ? '/dashboard' : '/'} className="et-header-brand">
            <img src={require('../Images/et_logo_bg.png')} alt="EtherTrack"
              style={{ height:'42px', width:'auto', objectFit:'contain', mixBlendMode:'screen' }}/>
          </Link>

          {/* Nav — desktop */}
          {isAuthenticated && (
            <nav className="et-header-nav">
              {NAV_LINKS.map(({ to, label, requiredPlan }) => {
                const accessible = hasAccess(requiredPlan);
                const color = requiredPlan ? lockColor[requiredPlan] : undefined;

                if (accessible) {
                  return (
                    <Link
                      key={to}
                      to={to}
                      className={`et-nav-link${isActive(to) ? ' active' : ''}`}
                    >
                      {label}
                    </Link>
                  );
                }

                // Locked — render as a div (prevents navigation), show badge
                return (
                  <div
                    key={to}
                    className="et-nav-link locked"
                    onClick={() => setUpgradeModal(requiredPlan)}
                    title={`Requires ${PLAN_INFO[requiredPlan]?.name} plan`}
                  >
                    {label}
                    <span style={{ fontSize: '9px', opacity: 0.7 }}>🔒</span>
                  </div>
                );
              })}
            </nav>
          )}

          <div className="et-header-right">
            {isAuthenticated ? (
              <>
                <span className="et-live">
                  <span className="et-live-dot"/>
                  LIVE
                  <span className="et-live-tooltip">
                    🟢 Connected to EtherTrack backend<br/>
                    ⛓ Ethereum Sepolia testnet active<br/>
                    📡 Real-time price feeds running
                  </span>
                </span>
                <div className="et-header-divider"/>

                {/* Bell */}
                <div className="et-bell-wrap" ref={bellRef}>
                  <button className="et-bell-btn" onClick={() => { setBellOpen(o => !o); setWalletOpen(false); }}>
                    🔔
                    {unreadCount > 0 && <span className="et-bell-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
                  </button>
                  {bellOpen && (
                    <div className="et-bell-dropdown">
                      <div className="et-bell-top">
                        <span className="et-bell-top-title">NOTIFICATIONS{unreadCount > 0 ? ` (${unreadCount})` : ''}</span>
                        {unreadCount > 0 && <button className="et-bell-mark-all" onClick={markAllRead}>Mark all read</button>}
                      </div>
                      <div className="et-bell-list">
                        {notifications.slice(0, 5).length === 0
                          ? <div className="et-bell-empty">🎉 All caught up!</div>
                          : notifications.slice(0, 5).map(n => {
                              const meta = getTypeMeta(n.type);
                              return (
                                <div key={n.id} className={`et-bell-item${!n.read ? ' unread' : ''}`} onClick={() => markRead(n.id)}>
                                  <div className="et-bell-item-icon">{meta.icon}</div>
                                  <div className="et-bell-item-body">
                                    <div className="et-bell-item-title">{n.title}</div>
                                    <div className="et-bell-item-msg">{n.message}</div>
                                    <div className="et-bell-item-time">{timeAgo(n.time)}</div>
                                  </div>
                                  {!n.read && <div className="et-bell-unread-dot"/>}
                                  <button className="et-bell-del" onClick={e => { e.stopPropagation(); deleteOne(n.id); }}>✕</button>
                                </div>
                              );
                            })
                        }
                      </div>
                      <div className="et-bell-footer">
                        <Link to="/notifications" onClick={() => setBellOpen(false)}>VIEW ALL NOTIFICATIONS →</Link>
                      </div>
                    </div>
                  )}
                </div>

                <div className="et-header-divider"/>

                {/* MetaMask status pill + mini dropdown */}
                <div className="et-meta-wrap" ref={walletRef}>
                  <button
                    className={`et-meta-pill${isConnected ? ' connected' : ''}`}
                    onClick={() => { setWalletOpen(o => !o); setBellOpen(false); }}>
                    <span className={`et-meta-dot ${isConnected ? 'on' : 'off'}`}/>
                    {isConnected ? `🦊 ${shortAddress}` : '🦊 METAMASK'}
                  </button>

                  {walletOpen && (
                    <div className="et-meta-dropdown">
                      <div className="et-meta-drop-hdr">
                        <span className="et-meta-drop-title">METAMASK</span>
                        <span className={`et-meta-drop-status ${isConnected ? 'on' : 'off'}`}>
                          {isConnected ? '● LIVE' : '○ OFF'}
                        </span>
                      </div>

                      {!isConnected ? (
                        <div className="et-meta-not-conn">
                          <div className="et-meta-not-conn-icon">🦊</div>
                          <div className="et-meta-not-conn-desc">
                            Required for tokenizing &amp;<br/>
                            retiring credits on-chain.<br/>
                            <strong style={{ color: '#22c55e88' }}>Not needed for INR trading.</strong>
                          </div>
                          <button className="et-meta-connect-btn" onClick={handleConnect} disabled={isConnecting}>
                            {isConnecting ? 'CONNECTING...' : 'CONNECT →'}
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="et-meta-drop-body">
                            <div className="et-meta-addr">📍 {address}</div>
                            {[
                              { label: 'ETH BALANCE', value: `${balance} ETH`,   g: true },
                              { label: 'VALUE (INR)',  value: `₹${balanceINR}`          },
                              { label: 'NETWORK',      value: network || 'Unknown'       },
                              { label: 'ACCOUNT LINK', value: walletBound ? '✅ BOUND' : binding ? '⟳ LINKING...' : '✗ NOT LINKED', g: walletBound },
                            ].map(r => (
                              <div key={r.label} className="et-meta-stat">
                                <span className="et-meta-stat-label">{r.label}</span>
                                <span className={`et-meta-stat-val${r.g ? ' g' : ''}`}>{r.value}</span>
                              </div>
                            ))}
                          </div>
                          <div className="et-meta-drop-foot">
                            <button className="et-meta-disc-btn" onClick={() => { disconnect(); setWalletOpen(false); }}>
                              DISCONNECT
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="et-header-divider"/>
                <button className="et-logout-btn" onClick={handleLogoutClick}>LOGOUT</button>
                <button className={`et-hamburger${menuOpen ? ' open' : ''}`} onClick={() => setMenuOpen(o => !o)}>
                  <span/><span/><span/>
                </button>
              </>
            ) : (
              <>
                <Link to="/login"  className="et-login-btn">LOGIN</Link>
                <Link to="/signup" className="et-signup-btn">GET STARTED →</Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Mobile menu */}
      {isAuthenticated && menuOpen && (
        <div className="et-mobile-menu">
          {NAV_LINKS.map(({ to, label, requiredPlan }) => {
            const accessible = hasAccess(requiredPlan);
            const color = requiredPlan ? lockColor[requiredPlan] : undefined;

            if (accessible) {
              return (
                <Link
                  key={to}
                  to={to}
                  className={`et-mobile-nav-link${isActive(to) ? ' active' : ''}`}
                >
                  {label}
                </Link>
              );
            }

            return (
              <div
                key={to}
                className="et-mobile-nav-link locked"
                onClick={() => { setUpgradeModal(requiredPlan); setMenuOpen(false); }}
              >
                <span>{label}</span>
                <span style={{ fontSize: '11px', opacity: 0.5 }}>🔒</span>
              </div>
            );
          })}
          <div className="et-mobile-divider"/>
          <button
            className="et-mobile-nav-link"
            style={{ background:'none', border:'none', cursor:'pointer', textAlign:'left', color:'#f8717166', fontFamily:'inherit', letterSpacing:'0.1em', fontSize:'12px' }}
            onClick={handleLogoutClick}>
            LOGOUT
          </button>
        </div>
      )}

      <div className="et-header-spacer"/>

      {/* Upgrade modal — rendered at root level so it overlays everything */}
      {upgradeModal && (
        <UpgradeModal
          requiredPlan={upgradeModal}
          onClose={() => setUpgradeModal(null)}
        />
      )}
    </>
  );
};

export default Header;