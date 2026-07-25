// AdminDashboard.jsx — EtherTrack Admin Console v4
// RESTRUCTURE vs v3:
// [NAV]     18 flat tabs → 4 collapsible nav groups (Operations / Platform / Finance & Legal / System)
//           with group-level badge counts. Active tab state preserved, keyboard accessible.
// [HEADER]  Sticky top bar with platform name, urgent alert pills, and user context.
// [SPACING] Single 8-pt grid (8/12/16/24/32). All padding/gap values snap to it.
// [ACTIONS] All row-action buttons inherit consistent size via S.act* tokens.
//           MoreMenu unchanged but slot-aligned with the new tokens.
// [VISUAL]  Color system split into 4 semantic roles:
//             amber  (#f59e0b) — primary UI chrome / navigation
//             green  (#22c55e) — success / approved / positive values
//             red    (#f87171) — danger / rejected / negative
//             blue   (#60a5fa) — informational / links / chain refs
//           Everything else uses neutral #f0fdf4 at reduced opacity.
// [SECTIONS] Section headers now use a left-border accent + uppercase label,
//            consistent across all tabs, replacing the ad-hoc per-tab headings.
import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { AuthContext } from '../App';
import { apiFetch as globalApiFetch, kycAPI, supportAPI } from '../services/api';

const PG = process.env.REACT_APP_PINATA_GATEWAY || 'https://gateway.pinata.cloud/ipfs';

const api = async (path, opts = {}) => {
  try { return await globalApiFetch(path, opts); }
  catch (err) {
    if (err?.status === 429) throw new Error('Rate limited — please wait a moment');
    if (err?.status === 401) throw new Error('SESSION_EXPIRED');
    if (err?.status === 403) throw new Error('Not authorised for this action');
    throw err;
  }
};

// ── RegistryVerifyPanel ─────────────────────────────────────────────────────
// Fetches GET /api/admin/credits/:id/verify-registry on mount and shows the
// voluntary-registry adapter's result inline in the approve modal — so the
// admin sees format validity + verification tier BEFORE clicking approve,
// instead of having to open a separate tab. Compliance-type (BEE/CCC)
// batches are skipped server-side; this panel just displays whatever the
// backend returns, it makes no policy decisions itself.
function RegistryVerifyPanel({ creditId }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, data: null, error: null });
    api(`/api/admin/credits/${creditId}/verify-registry`)
      .then(data => { if (!cancelled) setState({ loading: false, data, error: null }); })
      .catch(err => { if (!cancelled) setState({ loading: false, data: null, error: err.message || 'Check failed' }); });
    return () => { cancelled = true; };
  }, [creditId]);

  const box = { marginBottom: 12, padding: '10px 12px', borderRadius: 6, fontSize: 10, lineHeight: 1.6 };

  if (state.loading) {
    return <div style={{ ...box, border: '1px solid #f59e0b1a', color: '#f59e0b88' }}>⟳ Checking registry adapter…</div>;
  }
  if (state.error) {
    return <div style={{ ...box, border: '1px solid #f8717133', background: '#1a0707', color: '#f8717188' }}>
      ⚠ Registry check failed: {state.error} — proceed with manual verification only.
    </div>;
  }
  if (state.data?.skipped) {
    return <div style={{ ...box, border: '1px solid #60a5fa22', background: '#060e18', color: '#60a5fa88' }}>
      ℹ {state.data.reason}
    </div>;
  }

  const r = state.data?.result;
  if (!r) return null;

  const confColor = r.confidence === 'VERIFIED_API' ? '#22c55e'
    : r.confidence === 'VERIFIED_MANUAL' ? '#60a5fa' : '#f59e0b';

  return (
    <div style={{ ...box, border: `1px solid ${confColor}33`, background: '#0a0f0c' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ color: '#f59e0bcc', letterSpacing: '.08em' }}>REGISTRY CHECK — {(r.source || '').toUpperCase()}</span>
        <span style={{ color: confColor, fontWeight: 700 }}>{r.confidence}</span>
      </div>
      <div style={{ color: '#f0fdf4dd' }}>{r.notes}</div>
    </div>
  );
}

// ── Navigation groups ─────────────────────────────────────────────────────────
// Each group has an id, label, icon, and list of tab definitions.
// Badge keys reference stats fields or derived counts for group-level rollup.
const NAV_GROUPS = [
  {
    id: 'operations', label: 'Operations', icon: '⚡',
    tabs: [
      { id: 'overview',    label: 'Overview',    icon: '⚡' },
      { id: 'kyc',         label: 'KYC Queue',   icon: '🔍', badgeKey: 'pendingKYC',     badgeColor: 'amber' },
      { id: 'credits',     label: 'Credits',     icon: '🌿', badgeKey: 'pendingCredits', badgeColor: 'amber', badge2Key: 'failedMints', badge2Color: 'red' },
      { id: 'retirements', label: 'Retirements', icon: '🔥' },
      { id: 'listings',    label: 'Listings',    icon: '📋' },
      { id: 'buyorders',   label: 'Buy Orders',  icon: '🛒', badgeKey: 'openBuyOrders',  badgeColor: 'amber' },
      { id: 'trades',      label: 'Trades',      icon: '🔁' },
    ],
  },
  {
    id: 'platform', label: 'Platform', icon: '👤',
    tabs: [
      { id: 'accounts',      label: 'Accounts',     icon: '👤' },
      { id: 'projects',      label: 'Projects',     icon: '🗂' },
      { id: 'disputes',      label: 'Disputes',     icon: '⚖️', badgeKey: 'openDisputes', badgeColor: 'red' },
      { id: 'blacklist',     label: 'Blacklist',    icon: '🚫' },
      { id: 'announcements', label: 'Announce',     icon: '📢' },
      { id: 'support',       label: 'Support',      icon: '🎫', badgeKey: 'openTickets',  badgeColor: 'amber' },
    ],
  },
  {
    id: 'finance', label: 'Finance & Legal', icon: '💰',
    tabs: [
      { id: 'revenue',    label: 'Revenue',    icon: '💰' },
      { id: 'subscriptions', label: 'Subscriptions', icon: '📊' },
      { id: 'compliance', label: 'Compliance', icon: '🛡', critBadge: true },
      { id: 'corporate',  label: 'Corporate',  icon: '🏢', badgeKey: 'corporateAccounts', badgeColor: 'amber' },
    ],
  },
  {
    id: 'system', label: 'System', icon: '🩺',
    tabs: [
      { id: 'health', label: 'Chain Health', icon: '🩺' },
      { id: 'audit',  label: 'Audit Log',   icon: '📋' },
    ],
  },
];

// ── Small reusable components ─────────────────────────────────────────────────
const Dlg = ({ title, children, onClose, wide }) => {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div style={M.ov} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ ...M.bx, ...(wide ? { maxWidth: 760 } : {}) }}>
        <div style={M.tt}>{title}</div>
        <div style={{ overflowY: 'auto', maxHeight: 'calc(80vh - 120px)' }}>{children}</div>
        <button style={M.cl} onClick={onClose}>✕ CLOSE</button>
      </div>
    </div>
  );
};

const ConfirmBar = ({ message, onConfirm, onCancel }) => (
  <div style={{ padding: '10px 14px', background: '#1a0707', border: '1px solid #f8717133', borderRadius: 7, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
    <span style={{ fontSize: 11, color: '#f87171' }}>{message}</span>
    <div style={{ display: 'flex', gap: 7, flexShrink: 0 }}>
      <button style={{ ...S.actApprove, fontSize: 9 }} onClick={onConfirm}>YES, CONFIRM</button>
      <button style={{ ...S.actView, fontSize: 9 }} onClick={onCancel}>CANCEL</button>
    </div>
  </div>
);

const MoreMenu = ({ items }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onEsc); };
  }, [open]);
  if (!items.length) return null;
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button style={S.actView} onClick={() => setOpen(o => !o)}>⋯</button>
      {open && (
        <div style={S.moreMenu}>
          {items.map((it, i) => (
            <button key={i} style={{ ...S.moreMenuItem, color: it.danger ? '#f87171' : '#f0fdf4' }}
              onClick={() => { setOpen(false); it.onClick(); }}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── ConfirmModal — replaces all window.confirm() calls ───────────────────────
// Renders a modal with a message and two buttons. Caller passes onConfirm/onCancel.
// Usage: setConfirm({ message: '...', onConfirm: () => doThing() })
const ConfirmModal = ({ message, detail, confirmLabel = 'CONFIRM', danger = true, onConfirm, onCancel }) => (
  <div style={M.ov} onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
    <div style={{ ...M.bx, maxWidth: 400 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: danger ? '#f87171' : '#f59e0b', marginBottom: 12, letterSpacing: '.08em' }}>
        {danger ? '⚠ Confirm Action' : 'Confirm'}
      </div>
      <div style={{ fontSize: 12, color: '#f0fdf4', lineHeight: 1.7, marginBottom: detail ? 8 : 20 }}>{message}</div>
      {detail && <div style={{ fontSize: 10, color: '#f59e0baa', lineHeight: 1.6, marginBottom: 20, padding: '8px 12px', background: '#0a0800', borderRadius: 6, border: '1px solid #f59e0b1a' }}>{detail}</div>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button style={danger ? M.rPrimary : M.aPrimary} onClick={onConfirm}>{confirmLabel}</button>
        <button style={M.cl} onClick={onCancel}>CANCEL</button>
      </div>
    </div>
  </div>
);

// ── Collapsible nav group ─────────────────────────────────────────────────────
const NavGroup = ({ group, activeTab, onTabSelect, stats, kycExpiring, compStats }) => {
  const [open, setOpen] = useState(group.tabs.some(t => t.id === activeTab));
  useEffect(() => {
    if (group.tabs.some(t => t.id === activeTab)) setOpen(true);
  }, [activeTab, group.tabs]);

  const groupBadge = group.tabs.reduce((acc, t) => {
    if (t.badgeKey && (stats?.[t.badgeKey] ?? 0) > 0) acc += stats[t.badgeKey];
    if (t.badge2Key && (stats?.[t.badge2Key] ?? 0) > 0) acc += stats[t.badge2Key];
    if (t.id === 'accounts' && kycExpiring?.length > 0) acc += kycExpiring.length;
    if (t.critBadge && compStats?.criticalFlags > 0) acc += compStats.criticalFlags;
    return acc;
  }, 0);

  return (
    <div style={{ borderBottom: '1px solid #f59e0b0d' }}>
      <button
        style={S.groupBtn}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12 }}>{group.icon}</span>
          <span style={{ fontSize: 9, letterSpacing: '.14em', color: open ? '#f59e0b' : '#f59e0b88' }}>
            {group.label.toUpperCase()}
          </span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {groupBadge > 0 && <span style={{ ...S.badge, background: '#f87171' }}>{groupBadge}</span>}
          <span style={{ fontSize: 9, color: '#f59e0b44', transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform .15s' }}>›</span>
        </span>
      </button>

      {open && group.tabs.map(t => {
        const isActive = t.id === activeTab;
        const b1 = t.badgeKey ? (stats?.[t.badgeKey] ?? 0) : 0;
        const b2 = t.badge2Key ? (stats?.[t.badge2Key] ?? 0) : 0;
        const kycBadge = t.id === 'accounts' ? (kycExpiring?.length ?? 0) : 0;
        const compBadge = t.critBadge ? (compStats?.criticalFlags ?? 0) : 0;
        return (
          <button
            key={t.id}
            style={{ ...S.navBtn, ...(isActive ? S.navActive : {}) }}
            onClick={() => onTabSelect(t.id)}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, opacity: .7 }}>{t.icon}</span>
              <span>{t.label}</span>
            </span>
            <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {b1 > 0 && <span style={{ ...S.badge, background: t.badgeColor === 'red' ? '#f87171' : '#f59e0b' }}>{b1}</span>}
              {b2 > 0 && <span style={{ ...S.badge, background: '#f87171' }}>{b2}</span>}
              {kycBadge > 0 && <span style={{ ...S.badge, background: '#f59e0b' }}>{kycBadge}</span>}
              {compBadge > 0 && <span style={{ ...S.badge, background: '#f87171' }}>{compBadge}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
};

// ── Badge & mint badge ────────────────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  const c = { pending: '#f59e0b', approved: '#22c55e', verified: '#22c55e', rejected: '#f87171', frozen: '#f87171', open: '#f59e0b', resolved: '#22c55e', cleared: '#22c55e', reviewed: '#60a5fa', escalated: '#f87171', low: '#22c55e', medium: '#f59e0b', high: '#f97316', critical: '#f87171', active: '#22c55e', cancelled: '#f87171', filled: '#22c55e', completed: '#22c55e', corporate: '#f59e0b', in_progress: '#60a5fa', closed: '#86efac88' }[status] || '#86efac44';
  return <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 20, border: `1px solid ${c}33`, color: c }}>{status?.toUpperCase().replace(/_/g, ' ')}</span>;
};
const MintBadge = ({ c }) => {
  if (c.token_id != null) return <span style={{ fontSize: 9, color: '#22c55e' }}>✓#{c.token_id}</span>;
  if (c.admin_status === 'approved') return <span style={{ fontSize: 9, color: '#f87171', animation: 'pulse 2s infinite' }}>⚠FAILED</span>;
  return <span style={{ fontSize: 9, color: '#86efac33' }}>—</span>;
};

// ── Section header — consistent across all tabs ───────────────────────────────
const SecHead = ({ children, action }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #f59e0b14' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 3, height: 14, background: '#f59e0b', borderRadius: 2, flexShrink: 0 }} />
      <span style={{ fontSize: 9, color: '#f59e0bcc', letterSpacing: '.16em', fontFamily: "'DM Mono',monospace" }}>{children}</span>
    </div>
    {action}
  </div>
);

// ── Filter pill row ───────────────────────────────────────────────────────────
const FilterRow = ({ options, value, onChange, style }) => (
  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', ...style }}>
    {options.map(o => (
      <button key={o.value ?? o} style={{ ...S.filterBtn, ...(value === (o.value ?? o) ? S.filterActive : {}) }}
        onClick={() => onChange(o.value ?? o)}>
        {(o.label ?? o).toUpperCase()}
      </button>
    ))}
  </div>
);

export default function AdminDashboard() {
  const { dbUser, handleLogout } = useContext(AuthContext);

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [tab, setTab] = useState('overview');

  // ── Data state ────────────────────────────────────────────────────────────
  const [stats, setStats]                     = useState(null);
  const [kyc, setKyc]                         = useState([]);
  const [credits, setCredits]                 = useState([]);
  const [retirements, setRetirements]         = useState([]);
  const [listings, setListings]               = useState([]);
  const [buyOrders, setBuyOrders]             = useState([]);
  const [trades, setTrades]                   = useState([]);
  const [users, setUsers]                     = useState([]);
  const [disputes, setDisputes]               = useState([]);
  const [audit, setAudit]                     = useState([]);
  const [blacklist, setBlacklist]             = useState([]);
  const [announcements, setAnnouncements]     = useState([]);
  const [revenue, setRevenue]                 = useState(null);
  const [subStats, setSubStats]                = useState(null);
  const [health, setHealth]                   = useState(null);
  const [projects, setProjects]               = useState([]);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [loading, setLoading]                 = useState(false);
  const [healthLoading, setHealthLoading]     = useState(false);
  const [modal, setModal]                     = useState(null);
  const [reason, setReason]                   = useState('');
  const [toast, setToast]                     = useState('');
  const [toastType, setToastType]             = useState('info');
  const [actionLoading, setActionLoading]     = useState(false);
  const [confirm, setConfirm]               = useState(null); // { message, detail?, confirmLabel?, danger?, onConfirm }

  // ── Filter state ──────────────────────────────────────────────────────────
  const [kycFilter, setKycFilter]             = useState('pending');
  const [creditFilter, setCreditFilter]       = useState('pending');
  const [tradeFilter, setTradeFilter]         = useState('completed');
  const [buyOrderFilter, setBuyOrderFilter]   = useState('open');
  const [userSearch, setUserSearch]           = useState('');
  const [userFilter, setUserFilter]           = useState('');
  const [revPeriod, setRevPeriod]             = useState('30');
  const [exportPeriod, setExportPeriod]       = useState('this_month');
  const [retSearch, setRetSearch]             = useState('');
  const [retResults, setRetResults]           = useState(null);

  // ── Mint/token state ──────────────────────────────────────────────────────
  const [retryingId, setRetryingId]           = useState(null);
  const [retryingAll, setRetryingAll]         = useState(false);
  const [failedMints, setFailedMints]         = useState([]);
  const [syncingId, setSyncingId]             = useState(null);
  const [manualTokenId, setManualTokenId]     = useState('');
  const [newQty, setNewQty]                   = useState('');
  const [assignWallet, setAssignWallet]       = useState('');

  // ── User action state ─────────────────────────────────────────────────────
  const [newWallet, setNewWallet]             = useState('');
  const [msgSubject, setMsgSubject]           = useState('');
  const [msgBody, setMsgBody]                 = useState('');
  const [deletingUserId, setDeletingUserId]   = useState(null);
  const [userCredits, setUserCredits]         = useState([]);
  const [userTrades, setUserTrades]           = useState([]);
  const [userOrders, setUserOrders]           = useState([]);
  const [userDataLoading, setUserDataLoading] = useState(false);
  const [kycExpiring, setKycExpiring]         = useState([]);
  const [selectedKycIds, setSelectedKycIds]   = useState([]);
  const [kycTier, setKycTier]                 = useState('full');
  const [kycDetailData, setKycDetailData]     = useState(null);

  // ── Announcement state ────────────────────────────────────────────────────
  const [annTitle, setAnnTitle]               = useState('');
  const [annMsg, setAnnMsg]                   = useState('');
  const [annType, setAnnType]                 = useState('info');
  const [annEmail, setAnnEmail]               = useState(false);
  const [broadcasting, setBroadcasting]       = useState(false);

  // ── Blacklist state ───────────────────────────────────────────────────────
  const [newSerial, setNewSerial]             = useState('');
  const [priceOverride, setPriceOverride]     = useState('');
  const [retCorrect, setRetCorrect]           = useState({});

  // ── Compliance state ──────────────────────────────────────────────────────
  const [compTab, setCompTab]                 = useState('flags');
  const [compFlags, setCompFlags]             = useState([]);
  const [compTDS, setCompTDS]                 = useState([]);
  const [compFEMA, setCompFEMA]               = useState([]);
  const [compConfig, setCompConfig]           = useState([]);
  const [compLoading, setCompLoading]         = useState(false);
  const [flagFilter, setFlagFilter]           = useState('open');
  const [flagSeverity, setFlagSeverity]       = useState('');
  const [fyFilter, setFyFilter]               = useState('');
  const [editingConfig, setEditingConfig]     = useState({});
  const [compStats, setCompStats]             = useState({ openFlags: 0, criticalFlags: 0, totalTds: 0, totalConversions: 0 });

  // ── Corporate state ───────────────────────────────────────────────────────
  const [corpActivations, setCorpActivations]     = useState([]);
  const [corpSearch, setCorpSearch]               = useState('');
  const [corpSearchResults, setCorpSearchResults] = useState(null);
  const [corpSearching, setCorpSearching]         = useState(false);
  const [corpActivating, setCorpActivating]       = useState(false);
  const [corpForm, setCorpForm]                   = useState({ userId: '', email: '', cycle: 'annual', seats: '', customPriceINR: '', renewalMonths: '', notes: '' });
  const [corpRenewalForm, setCorpRenewalForm]     = useState({ userId: '', renewalDate: '', seats: '', notes: '' });
  const [corpRenewing, setCorpRenewing]           = useState(false);

  // ── Support state ─────────────────────────────────────────────────────────
  const [supportTickets, setSupportTickets]         = useState([]);
  const [supportTotal, setSupportTotal]             = useState(0);
  const [supportPage, setSupportPage]               = useState(1);
  const [supportTotalPages, setSupportTotalPages]   = useState(1);
  const [supportStatusFilter, setSupportStatusFilter] = useState('all');
  const [supportSearch, setSupportSearch]           = useState('');
  const [supportAnalytics, setSupportAnalytics]     = useState(null);
  const [supportSubTab, setSupportSubTab]           = useState('tickets');
  const [supportLoading, setSupportLoading]         = useState(false);

  // ── Toast ─────────────────────────────────────────────────────────────────
  const toastTimer = useRef(null);
  const toast_ = useCallback((msg, ms = 3500, type = 'info') => {
    setToast(msg); setToastType(type);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), ms);
  }, []);

  const handleSessionExpiry = useCallback(() => {
    toast_('⚠ Session expired — logging out', 3000, 'error');
    setTimeout(handleLogout, 2500);
  }, [handleLogout, toast_]);

  const safeAction = useCallback(async (fn) => {
    setActionLoading(true);
    try { await fn(); }
    catch (e) {
      if (e.message === 'SESSION_EXPIRED') handleSessionExpiry();
      else toast_(`❌ ${e.message}`, 4500, 'error');
    }
    finally { setActionLoading(false); }
  }, [handleSessionExpiry, toast_]);

  // ── Formatters ────────────────────────────────────────────────────────────
  const fmt    = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtT   = (d) => d ? new Date(d).toLocaleString('en-IN') : '—';
  const fmtINR = (n) => `₹${parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  const sanitize      = (s) => String(s || '').trim();
  const isValidWallet = (w) => /^0x[0-9a-fA-F]{40}$/.test(w);

  // ── Data loaders ──────────────────────────────────────────────────────────
  const loadStats         = useCallback(async () => { try { setStats(await api('/api/admin/stats')); } catch (e) { if (e.message === 'SESSION_EXPIRED') handleSessionExpiry(); } }, [handleSessionExpiry]);
  const loadKYC           = useCallback(async (filter = kycFilter) => { setLoading(true); try { if (filter === 'pending') { const d = await kycAPI.pending(0, 100); setKyc(d?.submissions ?? []); } else { try { const d = await api(`/api/admin/kyc?status=${filter}`); setKyc(d?.submissions ?? []); } catch { setKyc([]); } } } catch (e) { if (e.message === 'SESSION_EXPIRED') handleSessionExpiry(); setKyc([]); } finally { setLoading(false); } }, [kycFilter, handleSessionExpiry]);
  const loadCredits       = useCallback(async (filter = creditFilter) => { setLoading(true); try { const d = await api(`/api/admin/credits?status=${filter}`); const list = d?.credits ?? []; setCredits(list); setFailedMints(list.filter(c => c.admin_status === 'approved' && !c.token_id)); } catch {} finally { setLoading(false); } }, [creditFilter]);
  const loadRetirements   = useCallback(async () => { setLoading(true); try { const d = await api('/api/admin/retirements'); setRetirements(d?.retirements ?? []); } catch {} finally { setLoading(false); } }, []);
  const loadListings      = useCallback(async () => { setLoading(true); try { const d = await api('/api/admin/listings'); setListings(d?.listings ?? []); } catch {} finally { setLoading(false); } }, []);
  const loadBuyOrders     = useCallback(async (status = 'open') => { setLoading(true); try { const d = await api(`/api/admin/buy-orders?status=${status}`); setBuyOrders(d?.orders ?? []); } catch {} finally { setLoading(false); } }, []);
  const loadTrades        = useCallback(async (status = 'completed') => { setLoading(true); try { const d = await api(`/api/admin/trades?status=${status}&limit=100`); setTrades(d?.trades ?? []); } catch {} finally { setLoading(false); } }, []);
  const loadUsers         = useCallback(async (filterOverride) => { setLoading(true); try { const f = filterOverride !== undefined ? filterOverride : userFilter; const p = new URLSearchParams(); if (userSearch) p.set('search', userSearch); if (f) p.set('status', f); const d = await api(`/api/admin/users?${p}`); setUsers(d?.users ?? []); } catch {} finally { setLoading(false); } }, [userSearch, userFilter]);
  const loadDisputes      = useCallback(async () => { setLoading(true); try { const d = await api('/api/admin/disputes'); setDisputes(d?.disputes ?? []); } catch {} finally { setLoading(false); } }, []);
  const loadAudit         = useCallback(async () => { setLoading(true); try { const d = await api('/api/admin/audit'); setAudit(d?.logs ?? []); } catch {} finally { setLoading(false); } }, []);
  const loadBlacklist     = useCallback(async () => { setLoading(true); try { const d = await api('/api/admin/serials/blacklist'); setBlacklist(d?.blacklist ?? []); } catch {} finally { setLoading(false); } }, []);
  const loadAnnouncements = useCallback(async () => { try { const d = await api('/api/admin/announcements'); setAnnouncements(d?.announcements ?? []); } catch {} }, []);
  const loadRevenue       = useCallback(async (p = '30') => { setLoading(true); try { const d = await api(`/api/admin/revenue?period=${p}`); setRevenue(d); } catch {} finally { setLoading(false); } }, []);
  const loadSubStats      = useCallback(async () => { setLoading(true); try { const d = await api('/api/admin/subscriptions/stats'); setSubStats(d); } catch {} finally { setLoading(false); } }, []);
  const loadHealth        = useCallback(async () => { setHealthLoading(true); try { const d = await api('/api/admin/health/onchain'); setHealth(d); } catch {} finally { setHealthLoading(false); } }, []);
  const loadProjects      = useCallback(async () => { setLoading(true); try { const d = await api('/api/admin/projects'); setProjects(d?.projects ?? []); } catch {} finally { setLoading(false); } }, []);
  const loadKycExpiry     = useCallback(async () => { try { const d = await api('/api/admin/kyc-expiring'); setKycExpiring(d?.users ?? []); } catch {} }, []);
  const loadCompFlags     = useCallback(async () => { setCompLoading(true); try { const p = new URLSearchParams(); if (flagFilter && flagFilter !== 'all') p.set('status', flagFilter); if (flagSeverity) p.set('severity', flagSeverity); p.set('limit', '100'); const d = await api(`/api/compliance/flags?${p}`); const flags = d?.flags ?? []; setCompFlags(flags); setCompStats(s => ({ ...s, openFlags: flags.filter(f => f.status === 'open').length, criticalFlags: flags.filter(f => f.severity === 'critical' && f.status === 'open').length })); } catch {} finally { setCompLoading(false); } }, [flagFilter, flagSeverity]);
  const loadCompTDS       = useCallback(async () => { setCompLoading(true); try { const p = new URLSearchParams(); if (fyFilter) p.set('fy', fyFilter); const d = await api(`/api/compliance/tds?${p}`); setCompTDS(d?.records ?? []); setCompStats(s => ({ ...s, totalTds: d?.totalTds ?? 0 })); } catch {} finally { setCompLoading(false); } }, [fyFilter]);
  const loadCompFEMA      = useCallback(async () => { setCompLoading(true); try { const d = await api('/api/compliance/fema'); setCompFEMA(d?.conversions ?? []); setCompStats(s => ({ ...s, totalConversions: d?.totalTx ?? 0 })); } catch {} finally { setCompLoading(false); } }, []);
  const loadCompConfig    = useCallback(async () => { setCompLoading(true); try { const d = await api('/api/compliance/config'); setCompConfig(d?.config ?? []); } catch {} finally { setCompLoading(false); } }, []);
  const loadUserData      = useCallback(async (uid) => { setUserDataLoading(true); try { const [cr, tr, or_] = await Promise.all([api(`/api/admin/users/${uid}/credits`), api(`/api/admin/users/${uid}/trades`), api(`/api/admin/users/${uid}/buy-orders`).catch(() => ({ orders: [] }))]); setUserCredits(cr?.credits ?? []); setUserTrades(tr?.trades ?? []); setUserOrders(or_?.orders ?? []); } catch { setUserCredits([]); setUserTrades([]); setUserOrders([]); } finally { setUserDataLoading(false); } }, []);
  const loadCorpActivations = useCallback(async () => { setLoading(true); try { const d = await api('/api/admin/corporate/activations'); setCorpActivations(d?.activations ?? []); } catch (e) { toast_(`❌ ${e.message}`, 4000, 'error'); } finally { setLoading(false); } }, [toast_]);
  const loadSupportTickets = useCallback(async () => { setSupportLoading(true); try { const p = {}; if (supportStatusFilter !== 'all') p.status = supportStatusFilter; if (supportSearch) p.search = supportSearch; p.page = supportPage; p.limit = 15; const d = await supportAPI.getTickets(p); setSupportTickets(d?.tickets ?? []); setSupportTotal(d?.total ?? 0); setSupportTotalPages(d?.totalPages ?? 1); } catch (e) { if (e.message === 'SESSION_EXPIRED') handleSessionExpiry(); else toast_(`❌ ${e.message}`, 4000, 'error'); } finally { setSupportLoading(false); } }, [supportStatusFilter, supportSearch, supportPage, handleSessionExpiry, toast_]);
  const loadSupportAnalytics = useCallback(async () => { setSupportLoading(true); try { const d = await supportAPI.getAnalytics(); setSupportAnalytics(d); } catch (e) { toast_(`❌ ${e.message}`, 4000, 'error'); } finally { setSupportLoading(false); } }, [toast_]);

  // ── Tab effects ───────────────────────────────────────────────────────────
  // Guard: don't fire data loads until dbUser is confirmed.
  // This fixes the 204 No Content race where the first tab switch fires
  // before the auth token is attached to requests.
  const authReady = Boolean(dbUser?.id);

  useEffect(() => {
    if (!authReady) return;
    loadStats(); loadKycExpiry(); loadAnnouncements();
  }, [authReady, loadStats, loadKycExpiry, loadAnnouncements]);

  useEffect(() => {
    if (!authReady) return;
    if (tab === 'kyc')           loadKYC();
    if (tab === 'credits')       loadCredits();
    if (tab === 'retirements')   loadRetirements();
    if (tab === 'listings')      loadListings();
    if (tab === 'buyorders')     loadBuyOrders(buyOrderFilter);
    if (tab === 'trades')        loadTrades(tradeFilter);
    if (tab === 'accounts')      { loadUsers(); loadKycExpiry(); }
    if (tab === 'projects')      loadProjects();
    if (tab === 'revenue')       loadRevenue(revPeriod);
    if (tab === 'subscriptions') loadSubStats();
    if (tab === 'health')        loadHealth();
    if (tab === 'blacklist')     loadBlacklist();
    if (tab === 'announcements') loadAnnouncements();
    if (tab === 'disputes')      loadDisputes();
    if (tab === 'audit')         loadAudit();
    if (tab === 'compliance')    { loadCompFlags(); loadCompTDS(); loadCompFEMA(); loadCompConfig(); }
    if (tab === 'corporate')     loadCorpActivations();
    if (tab === 'support')       { supportSubTab === 'tickets' ? loadSupportTickets() : loadSupportAnalytics(); }
  }, [tab, authReady]); // eslint-disable-line

  useEffect(() => { if (tab === 'compliance' && compTab === 'flags') loadCompFlags(); }, [flagFilter, flagSeverity]); // eslint-disable-line
  useEffect(() => { if (tab === 'compliance' && compTab === 'tds') loadCompTDS(); }, [fyFilter]); // eslint-disable-line
  useEffect(() => { const id = setInterval(loadStats, 60000); return () => clearInterval(id); }, [loadStats]);
  useEffect(() => { if (tab !== 'support') return; if (supportSubTab === 'tickets') loadSupportTickets(); else loadSupportAnalytics(); }, [supportSubTab, supportStatusFilter, supportPage]); // eslint-disable-line

  // ── Actions (unchanged from v3, condensed) ────────────────────────────────
  const kycAction = (id, action) => safeAction(async () => { await api(`/api/admin/kyc/${id}/${action}`, { method: 'POST', body: JSON.stringify({ reason: sanitize(reason) }) }); toast_(`✅ KYC ${action}d`, 3000, 'success'); setModal(null); setReason(''); loadKYC(); loadStats(); });
  const creditAction = (id, action) => safeAction(async () => { await api(`/api/admin/credits/${id}/${action}`, { method: 'POST', body: JSON.stringify(action === 'approve' ? { notes: sanitize(reason) } : { reason: sanitize(reason) }) }); toast_(`✅ Credit ${action}d`, 3000, 'success'); setModal(null); setReason(''); loadCredits(); loadStats(); });
  const freezeAction = (id, action) => safeAction(async () => { await api(`/api/admin/users/${id}/${action}`, { method: 'POST', body: JSON.stringify({ reason: sanitize(reason) }) }); toast_(`✅ Account ${action}d`, 3000, 'success'); setModal(null); setReason(''); loadUsers(); loadStats(); });
  const resolveDispute = (id) => safeAction(async () => { await api(`/api/admin/disputes/${id}/resolve`, { method: 'POST', body: JSON.stringify({ resolution: sanitize(reason) }) }); toast_('✅ Resolved', 3000, 'success'); setModal(null); setReason(''); loadDisputes(); loadStats(); });
  const reviewFlag = (flagId, status, notes) => safeAction(async () => { await api(`/api/compliance/flags/${flagId}`, { method: 'PUT', body: JSON.stringify({ status, reviewNotes: sanitize(notes) }) }); toast_(`✅ Flag ${status}`, 3000, 'success'); setModal(null); setReason(''); loadCompFlags(); });
  const saveConfig = (key, value) => safeAction(async () => { await api(`/api/compliance/config/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ value }) }); toast_(`✅ ${key} updated`, 3000, 'success'); setEditingConfig(p => { const n = { ...p }; delete n[key]; return n; }); loadCompConfig(); });
  const retryMint = async (id) => { setRetryingId(id); try { const r = await api(`/api/admin/credits/${id}/retry-mint`, { method: 'POST' }); r?.success ? toast_(`✅ Token #${r.tokenId}`, 3500, 'success') : toast_(`❌ ${r?.error || 'Unknown error'}`, 4000, 'error'); loadCredits(); loadStats(); } catch (e) { toast_(`❌ ${e.message}`, 4000, 'error'); } finally { setRetryingId(null); } };
  const retryAllMints = () => setConfirm({
    message: `Retry all ${failedMints.length} failed mints?`,
    detail: 'This submits on-chain transactions for every failed batch. Each costs gas.',
    confirmLabel: `⟳ RETRY ${failedMints.length} MINTS`,
    onConfirm: async () => {
      setConfirm(null);
      setRetryingAll(true);
      let ok = 0, fail = 0;
      for (const b of failedMints) {
        try { const r = await api(`/api/admin/credits/${b.id}/retry-mint`, { method: 'POST' }); r?.success ? ok++ : fail++; }
        catch { fail++; }
      }
      toast_(`✅ ${ok} minted · ❌ ${fail} failed`, 5000, ok > 0 ? 'success' : 'error');
      setRetryingAll(false); loadCredits(); loadStats();
    },
  });
  const handleManualSync = (id) => safeAction(async () => { const tid = parseInt(manualTokenId); if (isNaN(tid) || tid < 0) throw new Error('Invalid token ID'); setSyncingId(id); await api(`/api/admin/credits/${id}/set-token-id`, { method: 'POST', body: JSON.stringify({ tokenId: tid }) }); toast_(`✅ Token #${tid} synced`, 3500, 'success'); setModal(null); setManualTokenId(''); loadCredits(); setSyncingId(null); });
  const handleQtyFix = (id) => safeAction(async () => { const qty = parseInt(newQty); if (!qty || qty <= 0) throw new Error('Invalid quantity'); await api(`/api/admin/credits/${id}/correct-quantity`, { method: 'POST', body: JSON.stringify({ quantity: qty, reason: sanitize(reason) }) }); toast_(`✅ Qty→${qty}`, 3000, 'success'); setModal(null); setNewQty(''); setReason(''); loadCredits(); });
  const handleAssignAndMint = (id) => safeAction(async () => { if (!isValidWallet(assignWallet)) throw new Error('Invalid wallet address'); setSyncingId(id); const r = await api(`/api/admin/credits/${id}/assign-wallet-and-mint`, { method: 'POST', body: JSON.stringify({ walletAddress: assignWallet }) }); toast_(`✅ Token #${r?.tokenId}`, 3500, 'success'); setModal(null); setAssignWallet(''); loadCredits(); setSyncingId(null); });
  const handleLoadMintDiag = async (id) => { try { const d = await api(`/api/admin/credits/${id}/mint-errors`); setModal({ type: 'mint_diag', data: d }); } catch (e) { toast_(`❌ ${e.message}`, 4000, 'error'); } };
  const handleWalletReassign = (id) => safeAction(async () => { if (!isValidWallet(newWallet)) throw new Error('Invalid wallet address'); if (!sanitize(reason)) throw new Error('Reason is required'); await api(`/api/admin/users/${id}/reassign-wallet`, { method: 'POST', body: JSON.stringify({ walletAddress: newWallet, reason: sanitize(reason) }) }); toast_('✅ Wallet reassigned', 3000, 'success'); setModal(null); setNewWallet(''); setReason(''); loadUsers(); });
  const handleDeleteUser = (id) => safeAction(async () => { if (!sanitize(reason)) throw new Error('Deletion reason is required'); setDeletingUserId(id); await api(`/api/admin/users/${id}/delete`, { method: 'POST', body: JSON.stringify({ reason: sanitize(reason) }) }); toast_('✅ User deleted', 3000, 'success'); setModal(null); setReason(''); loadUsers(); loadStats(); setDeletingUserId(null); });
  const handleSendMsg = (id) => safeAction(async () => { if (!sanitize(msgSubject) || !sanitize(msgBody)) throw new Error('Subject and message are required'); await api(`/api/admin/users/${id}/send-message`, { method: 'POST', body: JSON.stringify({ subject: sanitize(msgSubject), message: sanitize(msgBody) }) }); toast_('✅ Message sent', 3000, 'success'); setModal(null); setMsgSubject(''); setMsgBody(''); });
  const handleRekyc = (id) => safeAction(async () => { if (!sanitize(reason)) throw new Error('Reason is required'); await api(`/api/admin/users/${id}/require-rekyc`, { method: 'POST', body: JSON.stringify({ reason: sanitize(reason) }) }); toast_('✅ Re-KYC required', 3000, 'success'); setModal(null); setReason(''); loadUsers(); });
  const handleResync = (id) => safeAction(async () => { await api(`/api/admin/users/${id}/resync-portfolio`, { method: 'POST' }); toast_('✅ Resync triggered', 3000, 'success'); });
  const handleKycReminder = (id, email) => safeAction(async () => { await api(`/api/admin/users/${id}/kyc-reminder`, { method: 'POST' }); toast_(`✅ Reminder sent to ${email}`, 3000, 'success'); });
  const handleBulkKycApprove = () => {
    if (!selectedKycIds.length) { toast_('❌ Select at least one submission', 3000, 'error'); return; }
    setConfirm({
      message: `Bulk-approve ${selectedKycIds.length} KYC submission${selectedKycIds.length > 1 ? 's' : ''}?`,
      detail: `Tier: ${kycTier.toUpperCase()} — this sets kyc_status=verified and sends approval emails to all selected users.`,
      confirmLabel: `✓ APPROVE ${selectedKycIds.length}`,
      onConfirm: () => safeAction(async () => {
        setConfirm(null);
        const r = await api('/api/admin/kyc/bulk-approve', { method: 'POST', body: JSON.stringify({ ids: selectedKycIds }) });
        toast_(`✅ ${r?.approved} approved`, 3000, 'success');
        setSelectedKycIds([]); loadKYC(); loadStats();
      }),
    });
  };
  const loadKycDetail = useCallback(async (id) => { setKycDetailData(null); try { const d = await kycAPI.detail(id); setKycDetailData(d); } catch { setKycDetailData({ error: 'Failed to load detail' }); } }, []);
  const handleForceDelist = (id) => safeAction(async () => { if (!sanitize(reason)) throw new Error('Reason is required'); await api(`/api/admin/listings/${id}/force-delist`, { method: 'POST', body: JSON.stringify({ reason: sanitize(reason) }) }); toast_('✅ Delisted', 3000, 'success'); setModal(null); setReason(''); loadListings(); });
  const handlePriceOverride = (id) => safeAction(async () => { const price = parseFloat(priceOverride); if (isNaN(price) || price <= 0) throw new Error('Invalid price'); if (!sanitize(reason)) throw new Error('Reason is required'); await api(`/api/admin/listings/${id}/override-price`, { method: 'POST', body: JSON.stringify({ priceInr: price, reason: sanitize(reason) }) }); toast_(`✅ Price→₹${price}`, 3000, 'success'); setModal(null); setPriceOverride(''); setReason(''); });
  const handleForceCancelOrder = (id) => safeAction(async () => { if (!sanitize(reason)) throw new Error('Reason is required'); const r = await api(`/api/admin/buy-orders/${id}/force-cancel`, { method: 'POST', body: JSON.stringify({ reason: sanitize(reason) }) }); toast_(`✅ Cancelled · ${r?.ethEscrowed} ETH to refund`, 3500, 'success'); setModal(null); setReason(''); loadBuyOrders(buyOrderFilter); loadStats(); });
  const handleReconcile = (id) => safeAction(async () => { if (!sanitize(reason)) throw new Error('Reason is required'); const r = await api(`/api/admin/trades/${id}/reconcile`, { method: 'POST', body: JSON.stringify({ reason: sanitize(reason) }) }); toast_(`✅ ${r?.creditsAssigned} credits assigned`, 3500, 'success'); setModal(null); setReason(''); });
  const handleRetirementCorrect = (id) => safeAction(async () => { if (!sanitize(reason)) throw new Error('Audit reason is required'); const r = await api(`/api/admin/retirements/${id}/correct`, { method: 'POST', body: JSON.stringify({ reason: sanitize(reason), ...retCorrect }) }); toast_(`✅ ${r?.changes?.join(', ') || 'Saved'}`, 3500, 'success'); setModal(null); setReason(''); setRetCorrect({}); loadRetirements(); });
  const handleFlagRetirement = (id) => safeAction(async () => { if (!sanitize(reason)) throw new Error('Reason is required'); await api(`/api/admin/retirements/${id}/flag`, { method: 'POST', body: JSON.stringify({ reason: sanitize(reason) }) }); toast_('✅ Flagged', 3000, 'success'); setModal(null); setReason(''); loadRetirements(); });
  const handleUnflagRetirement = (id) => safeAction(async () => { await api(`/api/admin/retirements/${id}/unflag`, { method: 'POST' }); toast_('✅ Cleared', 3000, 'success'); loadRetirements(); });
  const handleSearchRetirements = async () => { if (!retSearch.trim()) return; try { const d = await api(`/api/admin/retirements/search?q=${encodeURIComponent(retSearch.trim())}`); setRetResults(d?.retirements ?? []); } catch (e) { toast_(`❌ ${e.message}`, 4000, 'error'); } };
  const handleBlacklistSerial = () => safeAction(async () => { if (!sanitize(newSerial) || !sanitize(reason)) throw new Error('Serial and reason are required'); const r = await api('/api/admin/serials/blacklist', { method: 'POST', body: JSON.stringify({ serial: sanitize(newSerial), reason: sanitize(reason) }) }); toast_(`✅ Blacklisted · ${r?.affectedBatches} auto-rejected`, 3500, 'success'); setNewSerial(''); setReason(''); loadBlacklist(); });
  const handleUnblacklist = (serial) => setConfirm({
    message: `Remove "${serial}" from blacklist?`,
    detail: 'Previously rejected batches with this serial will NOT be auto-reinstated — you must review them manually.',
    confirmLabel: 'REMOVE FROM BLACKLIST',
    onConfirm: () => safeAction(async () => {
      setConfirm(null);
      await api(`/api/admin/serials/blacklist/${encodeURIComponent(serial)}`, { method: 'DELETE' });
      toast_('✅ Removed', 3000, 'success'); loadBlacklist();
    }),
  });
  const handleBroadcast = () => {
    if (!sanitize(annTitle) || !sanitize(annMsg)) { toast_('❌ Title and message are required', 3000, 'error'); return; }
    setConfirm({
      message: `Broadcast to ALL active users${annEmail ? ' + send email' : ' (in-app only)'}?`,
      detail: `Subject: "${annTitle}" — This cannot be undone. Every non-frozen user will receive this notification${annEmail ? ' and an email' : ''}.`,
      confirmLabel: `📢 BROADCAST${annEmail ? ' + EMAIL' : ''}`,
      onConfirm: () => safeAction(async () => {
        setConfirm(null);
        setBroadcasting(true);
        const r = await api('/api/admin/announcements/broadcast', { method: 'POST', body: JSON.stringify({ subject: sanitize(annTitle), message: sanitize(annMsg), sendEmail: annEmail }) });
        toast_(`✅ Sent to ${r?.sent}`, 5000, 'success');
        setAnnTitle(''); setAnnMsg(''); setAnnEmail(false); setBroadcasting(false);
      }),
    });
  };
  const handleSaveBanner = () => safeAction(async () => { if (!sanitize(annTitle) || !sanitize(annMsg)) throw new Error('Title and message are required'); await api('/api/admin/announcements', { method: 'POST', body: JSON.stringify({ title: sanitize(annTitle), message: sanitize(annMsg), type: annType }) }); toast_('✅ Banner saved', 3000, 'success'); loadAnnouncements(); setAnnTitle(''); setAnnMsg(''); });
  const handleDeleteAnn = (id) => setConfirm({
    message: 'Remove this banner?',
    detail: 'The banner will stop showing immediately for all users.',
    confirmLabel: 'REMOVE BANNER',
    onConfirm: () => safeAction(async () => {
      setConfirm(null);
      await api(`/api/admin/announcements/${id}`, { method: 'DELETE' });
      toast_('✅ Removed', 3000, 'success'); loadAnnouncements();
    }),
  });
  const handleExportAudit = async () => {
    // Direct fetch with credentials (httpOnly session cookie) — no token in URL.
    // apiFetch always parses JSON so we bypass it here for the CSV blob download.
    try {
      const base = process.env.REACT_APP_API_URL || '';
      const res  = await fetch(`${base}/api/admin/audit/export`, {
        method: 'GET', credentials: 'include',
      });
      if (res.status === 401) { toast_('❌ Session expired — please log in again', 4000, 'error'); return; }
      if (res.status === 403) { toast_('❌ Not authorised', 3000, 'error'); return; }
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `ethertrack_audit_${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      toast_(`❌ Export failed: ${e.message}`, 4000, 'error');
    }
  };

  // Turns a preset key into concrete from/to dates (YYYY-MM-DD) for the export endpoint.
  const exportDateRange = (preset) => {
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    let from;
    if (preset === 'this_month') {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (preset === 'last_3_months') {
      from = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    } else if (preset === 'last_6_months') {
      from = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    } else if (preset === 'this_year') {
      from = new Date(now.getFullYear(), 0, 1);
    } else if (preset === 'last_12_months') {
      from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    } else {
      return { from: null, to: null }; // 'all_time' — omit params entirely
    }
    return { from: from.toISOString().slice(0, 10), to };
  };

  const handleFinanceExport = async (type, period = 'all_time') => {
    try {
      const base = process.env.REACT_APP_API_URL || '';
      const { from, to } = exportDateRange(period);
      const params = new URLSearchParams({ type });
      if (from) params.set('from', from);
      if (to)   params.set('to', to);
      const res  = await fetch(`${base}/api/admin/finance/export?${params}`, {
        method: 'GET', credentials: 'include',
      });
      if (res.status === 401) { toast_('❌ Session expired — please log in again', 4000, 'error'); return; }
      if (res.status === 403) { toast_('❌ Not authorised', 3000, 'error'); return; }
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `ethertrack_${type}_${period}_${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast_(`✅ ${type} export downloaded`, 2500, 'success');
    } catch (e) {
      toast_(`❌ Export failed: ${e.message}`, 4000, 'error');
    }
  };
  const handleCorpUserSearch = async () => { const q = corpSearch.trim(); if (!q) return; setCorpSearching(true); setCorpSearchResults(null); try { const d = await api(`/api/admin/users?search=${encodeURIComponent(q)}`); setCorpSearchResults(d?.users ?? []); } catch (e) { toast_(`❌ ${e.message}`, 4000, 'error'); } finally { setCorpSearching(false); } };
  const handleCorpActivate = () => safeAction(async () => { if (!corpForm.userId) throw new Error('Select a user first'); setCorpActivating(true); try { const seats = corpForm.seats ? parseInt(corpForm.seats) : null; if (seats !== null && (isNaN(seats) || seats < 1)) throw new Error('Seats must be a positive number'); const body = { cycle: corpForm.cycle, seats, customPriceINR: parseFloat(corpForm.customPriceINR) || 0, renewalMonths: corpForm.renewalMonths ? parseInt(corpForm.renewalMonths) : null, notes: corpForm.notes.trim() }; const r = await api(`/api/admin/users/${corpForm.userId}/activate-corporate`, { method: 'POST', body: JSON.stringify(body) }); toast_(`✅ Corporate activated for ${corpForm.email} · Renews ${new Date(r.renewalDate).toLocaleDateString('en-IN')}`, 5000, 'success'); setCorpForm({ userId: '', email: '', cycle: 'annual', seats: '', customPriceINR: '', renewalMonths: '', notes: '' }); setCorpSearchResults(null); setCorpSearch(''); loadCorpActivations(); loadStats(); } finally { setCorpActivating(false); } });
  const handleCorpRenewal = () => safeAction(async () => { if (!corpRenewalForm.userId) throw new Error('User ID is required'); if (!corpRenewalForm.renewalDate) throw new Error('Renewal date is required'); setCorpRenewing(true); try { await api(`/api/admin/users/${corpRenewalForm.userId}/corporate-renewal`, { method: 'PATCH', body: JSON.stringify({ renewalDate: corpRenewalForm.renewalDate, seats: corpRenewalForm.seats || null, notes: corpRenewalForm.notes }) }); toast_('✅ Renewal date updated', 4000, 'success'); setCorpRenewalForm({ userId: '', renewalDate: '', seats: '', notes: '' }); loadCorpActivations(); } finally { setCorpRenewing(false); } });
  const updateTicketStatus = (id, status) => safeAction(async () => { await supportAPI.updateTicket(id, { status }); toast_(`✅ Ticket marked ${status.replace('_', ' ')}`, 2500, 'success'); loadSupportTickets(); });

  // ── Access guard ──────────────────────────────────────────────────────────
  if (dbUser && dbUser.role !== 'admin' && dbUser.role !== 'superadmin') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0a0800', color: '#f87171', fontFamily: "'DM Mono',monospace", flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 32 }}>⛔</div>
        <div style={{ fontSize: 14 }}>Access Denied — Admin only</div>
        <button style={S.logoutBtn} onClick={handleLogout}>LOGOUT</button>
      </div>
    );
  }

  // ── Urgent alerts for the top bar ─────────────────────────────────────────
  const urgentAlerts = [
    stats?.pendingKYC     > 0 && { label: `${stats.pendingKYC} KYC`, tab: 'kyc', color: '#f59e0b' },
    stats?.failedMints    > 0 && { label: `${stats.failedMints} MINT FAIL`, tab: 'credits', color: '#f87171' },
    stats?.openDisputes   > 0 && { label: `${stats.openDisputes} DISPUTES`, tab: 'disputes', color: '#a78bfa' },
    compStats?.criticalFlags > 0 && { label: `${compStats.criticalFlags} CRITICAL FLAGS`, tab: 'compliance', color: '#f87171' },
  ].filter(Boolean);

  return (
    <div style={S.page}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
        @keyframes spin{to{transform:rotate(360deg)}}
        button:disabled{opacity:.45;cursor:not-allowed!important}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:#0a0800}
        ::-webkit-scrollbar-thumb{background:#f59e0b33;border-radius:2px}
      `}</style>

      {/* Toast */}
      {toast && <div style={{ ...S.toast, borderColor: toastType === 'error' ? '#f8717144' : toastType === 'success' ? '#22c55e44' : '#f59e0b44', color: toastType === 'error' ? '#f87171' : toastType === 'success' ? '#22c55e' : '#f59e0b' }}>{toast}</div>}
      {actionLoading && <div style={{ position: 'fixed', inset: 0, zIndex: 2000, cursor: 'wait' }} />}

      {/* ── Sidebar ── */}
      <aside style={S.sidebar}>
        {/* Logo */}
        <div style={S.sideTop}>
          <div style={S.logo}>⚡ ETHERTRACK</div>
          <div style={S.logoSub}>ADMIN CONSOLE</div>
          {dbUser?.role === 'superadmin' && <div style={{ fontSize: 7, color: '#f87171aa', marginTop: 3, letterSpacing: '.12em' }}>SUPERADMIN</div>}
        </div>

        {/* Grouped nav */}
        <nav style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
          {NAV_GROUPS.map(group => (
            <NavGroup
              key={group.id}
              group={group}
              activeTab={tab}
              onTabSelect={setTab}
              stats={stats}
              kycExpiring={kycExpiring}
              compStats={compStats}
            />
          ))}
        </nav>

        {/* User footer */}
        <div style={S.sideFooter}>
          <div style={{ fontSize: 9, color: '#f59e0bbb', marginBottom: 8, wordBreak: 'break-all', lineHeight: 1.5 }}>{dbUser?.email}</div>
          <button style={S.logoutBtn} onClick={handleLogout}>LOGOUT</button>
        </div>
      </aside>

      {/* ── Main ── */}
      <div style={S.main}>

        {/* Sticky top bar */}
        <div style={S.topBar}>
          <div style={{ fontSize: 13, color: '#f59e0b', fontWeight: 700, letterSpacing: '.06em' }}>
            {NAV_GROUPS.flatMap(g => g.tabs).find(t => t.id === tab)?.icon}{' '}
            {NAV_GROUPS.flatMap(g => g.tabs).find(t => t.id === tab)?.label ?? 'Overview'}
          </div>
          {urgentAlerts.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {urgentAlerts.map(a => (
                <button key={a.label} onClick={() => setTab(a.tab)}
                  style={{ padding: '4px 10px', borderRadius: 20, border: `1px solid ${a.color}44`, background: `${a.color}11`, color: a.color, fontFamily: "'DM Mono',monospace", fontSize: 9, cursor: 'pointer', fontWeight: 700, letterSpacing: '.08em' }}>
                  ⚠ {a.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ══ OVERVIEW ══ */}
        {tab === 'overview' && <>
          <div style={S.statsGrid}>
            {[
              { l: 'PENDING KYC',     v: stats?.pendingKYC      ?? '—', c: '#f59e0b', i: '🔍' },
              { l: 'PENDING CREDITS', v: stats?.pendingCredits   ?? '—', c: '#60a5fa', i: '🌿' },
              { l: 'FAILED MINTS',    v: stats?.failedMints      ?? '—', c: '#f87171', i: '⚠' },
              { l: 'OPEN BUY ORDERS', v: stats?.openBuyOrders    ?? '—', c: '#f59e0b', i: '🛒' },
              { l: 'TOTAL USERS',     v: stats?.totalUsers       ?? '—', c: '#22c55e', i: '👤' },
              { l: 'FROZEN',          v: stats?.frozenAccounts   ?? '—', c: '#f87171', i: '🔒' },
              { l: 'DISPUTES',        v: stats?.openDisputes     ?? '—', c: '#a78bfa', i: '⚖️' },
              { l: 'VERIFIED',        v: stats?.verifiedUsers    ?? '—', c: '#34d399', i: '✅' },
              { l: 'CORPORATE',       v: stats?.corporateAccounts ?? '—', c: '#f59e0b', i: '🏢' },
              { l: 'OPEN TICKETS',    v: stats?.openTickets      ?? '—', c: '#f59e0b', i: '🎫' },
            ].map(({ l, v, c, i }) => (
              <div key={l} style={S.statCard}>
                <div style={{ fontSize: 20, marginBottom: 6 }}>{i}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: c, marginBottom: 2, lineHeight: 1 }}>{v}</div>
                <div style={{ fontSize: 8, color: '#f59e0bcc', letterSpacing: '.12em', marginTop: 4 }}>{l}</div>
              </div>
            ))}
          </div>

          {kycExpiring.length > 0 && (
            <div style={{ ...S.card, marginBottom: 16, borderColor: '#f59e0b33' }}>
              <SecHead>⚠ KYC EXPIRING SOON</SecHead>
              {kycExpiring.slice(0, 4).map(u => (
                <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f59e0b0a' }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#f0fdf4' }}>{u.full_name} <span style={{ fontSize: 9, color: '#f59e0b88' }}>({u.email})</span></div>
                    <div style={{ fontSize: 9, color: '#f59e0b66', marginTop: 2 }}>{u.days_left}d left · {fmt(u.kyc_expires_at)}</div>
                  </div>
                  <button style={{ ...S.actView, borderColor: '#f59e0b44', color: '#f59e0b' }} onClick={() => handleKycReminder(u.id, u.email)}>📧 REMIND</button>
                </div>
              ))}
            </div>
          )}

          <div style={S.card}>
            <SecHead>QUICK JUMP</SecHead>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[['KYC Queue','kyc'],['Credits','credits'],['Buy Orders','buyorders'],['Trades','trades'],['Retirements','retirements'],['Accounts','accounts'],['Revenue','revenue'],['Subscriptions','subscriptions'],['Chain Health','health'],['Compliance','compliance'],['Corporate','corporate'],['Support','support']].map(([l,t]) => (
                <button key={t} style={S.quickBtn} onClick={() => setTab(t)}>{l} →</button>
              ))}
            </div>
          </div>
        </>}

        {/* ══ KYC ══ */}
        {tab === 'kyc' && (
          <div>
            <div style={S.toolbar}>
              <FilterRow options={['pending','approved','rejected']} value={kycFilter} onChange={v => { setKycFilter(v); loadKYC(v); }} />
              {selectedKycIds.length > 0 && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select style={{ ...S.input, width: 90, padding: '5px 8px' }} value={kycTier} onChange={e => setKycTier(e.target.value)}>
                    <option value="phone">Phone</option>
                    <option value="basic">Basic</option>
                    <option value="full">Full</option>
                  </select>
                  <button style={S.actApprove} onClick={handleBulkKycApprove}>✓ BULK APPROVE {selectedKycIds.length}</button>
                </div>
              )}
            </div>
            {loading ? <div style={S.loading}>Loading...</div> : (
              <div style={S.table}>
                <div style={{ ...S.thead, gridTemplateColumns: '32px 2fr 1fr 1fr 1fr 1fr 1.5fr' }}>
                  <div style={S.th}><input type="checkbox" onChange={e => setSelectedKycIds(e.target.checked ? kyc.filter(k => k.status === 'pending').map(k => k.id) : [])} /></div>
                  {['USER', 'ID TYPE', 'SUBMITTED', 'STATUS', 'DOC', 'ACTIONS'].map(h => <div key={h} style={S.th}>{h}</div>)}
                </div>
                {kyc.length === 0 && <div style={S.empty}>No {kycFilter} submissions</div>}
                {kyc.map(k => (
                  <div key={k.id} style={{ ...S.trow, gridTemplateColumns: '32px 2fr 1fr 1fr 1fr 1fr 1.5fr' }}>
                    <div style={S.td}>{k.status === 'pending' && <input type="checkbox" checked={selectedKycIds.includes(k.id)} onChange={e => setSelectedKycIds(p => e.target.checked ? [...p, k.id] : p.filter(i => i !== k.id))} />}</div>
                    <div style={S.td}><div style={{ color: '#f0fdf4', fontSize: 11 }}>{k.full_name}</div><div style={{ color: '#f59e0bcc', fontSize: 9 }}>{k.email}</div></div>
                    <div style={S.td}><StatusBadge status={k.id_type} /></div>
                    <div style={{ ...S.td, fontSize: 9, color: '#f59e0bbb' }}>{fmt(k.submitted_at)}</div>
                    <div style={S.td}><StatusBadge status={k.status} /></div>
                    <div style={S.td}>{k.doc_ipfs_hash ? <a href={`${PG}/${k.doc_ipfs_hash}`} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: '#60a5fa', textDecoration: 'none' }}>VIEW↗</a> : '—'}</div>
                    <div style={{ ...S.td, display: 'flex', gap: 4, alignItems: 'center' }}>
                      <button style={S.actView} onClick={() => { setKycDetailData(null); setModal({ type: 'kyc_detail', data: k }); }}>DETAILS</button>
                      {k.status === 'pending' && <><button style={S.actApprove} onClick={() => setModal({ type: 'kyc_approve', data: k })}>✓</button><button style={S.actReject} onClick={() => setModal({ type: 'kyc_reject', data: k })}>✕</button></>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ CREDITS ══ */}
        {tab === 'credits' && (
          <div>
            <div style={S.toolbar}>
              <FilterRow options={['pending','approved','rejected']} value={creditFilter} onChange={v => { setCreditFilter(v); loadCredits(v); }} />
              {failedMints.length > 0 && (
                <button style={{ ...S.actReject, padding: '6px 12px', fontSize: 10 }} onClick={retryAllMints} disabled={retryingAll}>
                  {retryingAll ? 'RETRYING...' : `⚠ RETRY ${failedMints.length} FAILED`}
                </button>
              )}
            </div>
            {loading ? <div style={S.loading}>Loading...</div> : (
              <div style={S.table}>
                <div style={{ ...S.thead, gridTemplateColumns: '2fr 1fr 1.5fr 1fr 1fr 1fr 1.5fr 2fr' }}>
                  {['USER', 'STD', 'SERIAL', 'QTY', 'VTG', 'DOC', 'MINT', 'ACTIONS'].map(h => <div key={h} style={S.th}>{h}</div>)}
                </div>
                {credits.length === 0 && <div style={S.empty}>No {creditFilter} credits</div>}
                {credits.map(c => {
                  const moreItems = [];
                  if (c.admin_status === 'pending') moreItems.push({ label: '✎ Correct quantity', onClick: () => { setNewQty(String(c.quantity)); setReason(''); setModal({ type: 'qty_fix', data: c }); } });
                  if (c.admin_status === 'approved' && !c.token_id) {
                    moreItems.push({ label: '✎ Set token ID manually', onClick: () => { setManualTokenId(''); setModal({ type: 'manual_sync', data: c }); } });
                    moreItems.push({ label: '🔍 Diagnose mint failure', onClick: () => handleLoadMintDiag(c.id) });
                    if (!c.user_wallet) moreItems.push({ label: '🔑 Assign wallet + mint', onClick: () => { setAssignWallet(''); setModal({ type: 'assign_mint', data: c }); } });
                  }
                  return (
                    <div key={c.id} style={{ ...S.trow, gridTemplateColumns: '2fr 1fr 1.5fr 1fr 1fr 1fr 1.5fr 2fr', ...(c.admin_status === 'approved' && !c.token_id ? { borderLeft: '2px solid #f8717133' } : {}) }}>
                      <div style={S.td}><div style={{ color: '#f0fdf4', fontSize: 11 }}>{c.full_name}</div><div style={{ color: '#f59e0bcc', fontSize: 9 }}>{c.email}</div></div>
                      <div style={{ ...S.td, fontSize: 9 }}>{c.standard}</div>
                      <div style={{ ...S.td, fontSize: 8, color: '#60a5fadd', fontFamily: 'monospace' }}>{(c.registry_serial || '—').slice(0, 14)}</div>
                      <div style={{ ...S.td, fontSize: 11, color: '#22c55e' }}>{c.quantity}</div>
                      <div style={{ ...S.td, fontSize: 9, color: '#f59e0bbb' }}>{c.vintage_year}</div>
                      <div style={S.td}>{c.doc_ipfs_hash ? <a href={`${PG}/${c.doc_ipfs_hash}`} target="_blank" rel="noreferrer" style={{ fontSize: 9, color: '#60a5fa', textDecoration: 'none' }}>↗</a> : '—'}</div>
                      <div style={S.td}><MintBadge c={c} /></div>
                      <div style={{ ...S.td, display: 'flex', gap: 4, alignItems: 'center' }}>
                        <button style={S.actView} onClick={() => setModal({ type: 'credit_detail', data: c })}>DETAILS</button>
                        {c.admin_status === 'pending' && <><button style={S.actApprove} onClick={() => setModal({ type: 'credit_approve', data: c })}>✓</button><button style={S.actReject} onClick={() => setModal({ type: 'credit_reject', data: c })}>✕</button></>}
                        {c.admin_status === 'approved' && !c.token_id && <button style={S.actReject} onClick={() => retryMint(c.id)} disabled={retryingId === c.id}>{retryingId === c.id ? '...' : '⟳'}</button>}
                        <MoreMenu items={moreItems} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══ RETIREMENTS ══ */}
        {tab === 'retirements' && (
          <div>
            <div style={S.toolbar}>
              <input style={{ ...S.input, flex: 1, minWidth: 200 }} placeholder="Search cert ID, serial, email, name..." value={retSearch} onChange={e => setRetSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearchRetirements()} />
              <button style={S.quickBtn} onClick={handleSearchRetirements}>🔍 SEARCH</button>
              {retResults !== null && <button style={S.filterBtn} onClick={() => { setRetResults(null); setRetSearch(''); }}>✕ CLEAR</button>}
            </div>
            {loading ? <div style={S.loading}>Loading...</div> : (
              <div style={S.table}>
                <div style={{ ...S.thead, gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr 1fr 2fr' }}>
                  {['USER', 'CERT ID', 'tCO₂', 'STD', 'SCOPE', 'STATUS', 'ACTIONS'].map(h => <div key={h} style={S.th}>{h}</div>)}
                </div>
                {(retResults ?? retirements).length === 0 && <div style={S.empty}>{retResults !== null ? 'No results' : 'No retirements'}</div>}
                {(retResults ?? retirements).map(r => (
                  <div key={r.id} style={{ ...S.trow, gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr 1fr 2fr', ...(r.disputed ? { borderLeft: '2px solid #f8717133' } : {}) }}>
                    <div style={S.td}><div style={{ color: '#f0fdf4', fontSize: 11 }}>{r.full_name || '—'}</div><div style={{ color: '#f59e0bcc', fontSize: 9 }}>{r.email}</div></div>
                    <div style={{ ...S.td, fontSize: 8, color: '#22c55ecc', fontFamily: 'monospace' }}>{(r.certificate_id || '—').slice(0, 18)}</div>
                    <div style={{ ...S.td, fontSize: 11, color: '#f87171' }}>{r.amount}</div>
                    <div style={{ ...S.td, fontSize: 9 }}>{r.standard || '—'}</div>
                    <div style={{ ...S.td, fontSize: 9 }}>S{r.retire_scope || '—'}</div>
                    <div style={S.td}>{r.disputed ? <span style={{ fontSize: 9, color: '#f87171' }}>⚠ DISP</span> : <span style={{ fontSize: 9, color: '#22c55e44' }}>OK</span>}</div>
                    <div style={{ ...S.td, display: 'flex', gap: 4, alignItems: 'center' }}>
                      <button style={{ ...S.actView, borderColor: '#60a5fa33', color: '#60a5fa' }} onClick={() => { setRetCorrect({ retire_scope: r.retire_scope, beneficiary_name: r.beneficiary_name, beneficiary_entity: r.beneficiary_entity, beneficiary_gstin: r.beneficiary_gstin, reporting_standard: r.reporting_standard, purpose: r.purpose }); setReason(''); setModal({ type: 'correct_retirement', data: r }); }}>✎</button>
                      {r.tx_hash && <a href={`https://sepolia.etherscan.io/tx/${r.tx_hash}`} target="_blank" rel="noreferrer" style={{ ...S.actView, textDecoration: 'none' }}>⛓</a>}
                      {!r.disputed ? <button style={S.actReject} onClick={() => { setReason(''); setModal({ type: 'flag_retirement', data: r }); }}>FLAG</button> : <button style={S.actApprove} onClick={() => handleUnflagRetirement(r.id)}>CLEAR</button>}
                      <MoreMenu items={[{ label: '📄 Regenerate certificate', onClick: () => { setReason(''); setModal({ type: 'regen_cert', data: r }); } }]} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ LISTINGS ══ */}
        {tab === 'listings' && (
          <div>
            {loading ? <div style={S.loading}>Loading...</div> : (
              <div style={S.table}>
                <div style={{ ...S.thead, gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr 1fr 1.5fr' }}>
                  {['SELLER', 'PROJECT', 'SERIAL', 'QTY', '₹/CR', 'STD', 'ACTIONS'].map(h => <div key={h} style={S.th}>{h}</div>)}
                </div>
                {listings.length === 0 && <div style={S.empty}>No active listings</div>}
                {listings.map(l => (
                  <div key={l.listing_id || l.batch_id} style={{ ...S.trow, gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr 1fr 1.5fr' }}>
                    <div style={S.td}><div style={{ color: '#f0fdf4', fontSize: 11 }}>{l.seller_name || '—'}</div><div style={{ color: '#f59e0bcc', fontSize: 9 }}>{l.seller_email}</div></div>
                    <div style={{ ...S.td, fontSize: 10 }}>{l.project_name || '—'}</div>
                    <div style={{ ...S.td, fontSize: 8, color: '#60a5facc', fontFamily: 'monospace' }}>{(l.registry_serial || '—').slice(0, 14)}</div>
                    <div style={{ ...S.td, fontSize: 11, color: '#22c55e' }}>{l.amount_remaining}</div>
                    <div style={{ ...S.td, fontSize: 10 }}>₹{parseFloat(l.price_per_credit_inr || 0).toLocaleString('en-IN')}</div>
                    <div style={S.td}><StatusBadge status={l.standard || 'VCS'} /></div>
                    <div style={{ ...S.td, display: 'flex', gap: 4 }}>
                      <button style={{ ...S.actView, borderColor: '#f59e0b33', color: '#f59e0b' }} onClick={() => { setPriceOverride(''); setReason(''); setModal({ type: 'price_override', data: l }); }}>₹ PRICE</button>
                      <button style={S.actReject} onClick={() => { setReason(''); setModal({ type: 'force_delist', data: l }); }}>DELIST</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ BUY ORDERS ══ */}
        {tab === 'buyorders' && (
          <div>
            <div style={S.toolbar}>
              <FilterRow options={['open','cancelled','filled','all']} value={buyOrderFilter} onChange={v => { setBuyOrderFilter(v); loadBuyOrders(v === 'all' ? undefined : v); }} />
            </div>
            {loading ? <div style={S.loading}>Loading...</div> : (
              <div style={S.table}>
                <div style={{ ...S.thead, gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr 1fr 1fr 1.5fr' }}>
                  {['BUYER', 'PROJECT', 'TOKEN', 'AMOUNT', 'FILLED', 'LIMIT₹', 'ETH ESC.', 'ACTIONS'].map(h => <div key={h} style={S.th}>{h}</div>)}
                </div>
                {buyOrders.length === 0 && <div style={S.empty}>No {buyOrderFilter} buy orders</div>}
                {buyOrders.map(o => (
                  <div key={o.id} style={{ ...S.trow, gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr 1fr 1fr 1.5fr', ...(o.status === 'open' ? { borderLeft: '2px solid #f59e0b22' } : {}) }}>
                    <div style={S.td}><div style={{ color: '#f0fdf4', fontSize: 11 }}>{o.buyer_name || '—'}</div><div style={{ color: '#f59e0bcc', fontSize: 9 }}>{o.buyer_email}</div></div>
                    <div style={{ ...S.td, fontSize: 10 }}>{o.project_name || '—'}</div>
                    <div style={{ ...S.td, fontSize: 10, color: '#60a5fa' }}>#{o.token_id}</div>
                    <div style={{ ...S.td, fontSize: 11, color: '#22c55e' }}>{o.amount}t</div>
                    <div style={{ ...S.td, fontSize: 11 }}>{o.amount_filled || 0}t</div>
                    <div style={{ ...S.td, fontSize: 10 }}>₹{parseFloat(o.limit_price_inr || 0).toLocaleString('en-IN')}</div>
                    <div style={{ ...S.td, fontSize: 10, color: '#f59e0b' }}>{parseFloat(o.eth_escrowed || 0).toFixed(4)}</div>
                    <div style={{ ...S.td, display: 'flex', gap: 4, alignItems: 'center' }}>
                      <StatusBadge status={o.status} />
                      {o.status === 'open' && <button style={S.actReject} onClick={() => { setReason(''); setModal({ type: 'cancel_order_choice', data: o }); }}>CANCEL</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ TRADES ══ */}
        {tab === 'trades' && (
          <div>
            <div style={S.toolbar}>
              <FilterRow options={['completed','pending','failed']} value={tradeFilter} onChange={v => { setTradeFilter(v); loadTrades(v); }} />
            </div>
            {loading ? <div style={S.loading}>Loading...</div> : (
              <div style={S.table}>
                <div style={{ ...S.thead, gridTemplateColumns: '1.5fr 1.5fr 1.5fr 1fr 1fr 1fr 1fr 1.5fr' }}>
                  {['BUYER', 'SELLER', 'PROJECT', 'QTY', 'PRICE', 'TOTAL', 'STATUS', 'ACTIONS'].map(h => <div key={h} style={S.th}>{h}</div>)}
                </div>
                {trades.length === 0 && <div style={S.empty}>No {tradeFilter} trades</div>}
                {trades.map(t => (
                  <div key={t.id} style={{ ...S.trow, gridTemplateColumns: '1.5fr 1.5fr 1.5fr 1fr 1fr 1fr 1fr 1.5fr' }}>
                    <div style={S.td}><div style={{ color: '#f0fdf4', fontSize: 10 }}>{t.buyer_name || '—'}</div><div style={{ color: '#f59e0bcc', fontSize: 8 }}>{t.buyer_email}</div></div>
                    <div style={S.td}><div style={{ color: '#f0fdf4', fontSize: 10 }}>{t.seller_name || '—'}</div><div style={{ color: '#f59e0bcc', fontSize: 8 }}>{t.seller_email}</div></div>
                    <div style={{ ...S.td, fontSize: 10 }}>{t.project_name || '—'}<div style={{ fontSize: 8, color: '#f59e0b44' }}>{t.standard}</div></div>
                    <div style={{ ...S.td, fontSize: 11, color: '#22c55e' }}>{t.quantity}t</div>
                    <div style={{ ...S.td, fontSize: 10 }}>₹{parseFloat(t.price_per_credit_inr || 0).toLocaleString('en-IN')}</div>
                    <div style={{ ...S.td, fontSize: 10 }}>₹{parseFloat(t.subtotal_inr || 0).toLocaleString('en-IN')}</div>
                    <div style={S.td}><StatusBadge status={t.status} /></div>
                    <div style={{ ...S.td, display: 'flex', gap: 4 }}>
                      {t.tx_hash && <a href={`https://sepolia.etherscan.io/tx/${t.tx_hash}`} target="_blank" rel="noreferrer" style={{ ...S.actView, textDecoration: 'none' }}>⛓</a>}
                      {t.status === 'completed' && <button style={{ ...S.actView, borderColor: '#22c55e33', color: '#22c55e' }} onClick={() => { setReason(''); setModal({ type: 'reconcile_trade', data: t }); }}>RECONCILE</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ ACCOUNTS ══ */}
        {tab === 'accounts' && (
          <div>
            {kycExpiring.length > 0 && (
              <div style={{ ...S.card, marginBottom: 16, borderColor: '#f59e0b22' }}>
                <SecHead>⚠ KYC EXPIRING WITHIN 90 DAYS</SecHead>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 8 }}>
                  {kycExpiring.map(u => (
                    <div key={u.id} style={{ padding: '8px 12px', background: '#0a0800', border: '1px solid #f59e0b1a', borderRadius: 7, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div><div style={{ fontSize: 11, color: '#f0fdf4' }}>{u.full_name}</div><div style={{ fontSize: 8, color: '#f59e0b88', marginTop: 2 }}>{u.days_left}d · {fmt(u.kyc_expires_at)}</div></div>
                      <button style={{ ...S.actView, borderColor: '#f59e0b33', color: '#f59e0b' }} onClick={() => handleKycReminder(u.id, u.email)}>📧</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={S.toolbar}>
              <input style={{ ...S.input, flex: 1, minWidth: 200 }} placeholder="Search name or email..." value={userSearch} onChange={e => setUserSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadUsers()} />
              <FilterRow options={[{value:'',label:'All'},{value:'frozen',label:'Frozen'},{value:'verified',label:'Verified'},{value:'pending',label:'Pending'}]} value={userFilter} onChange={v => { setUserFilter(v); loadUsers(v); }} />
            </div>
            {loading ? <div style={S.loading}>Loading...</div> : (
              <div style={S.table}>
                <div style={{ ...S.thead, gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr 2fr' }}>
                  {['USER', 'WALLET', 'KYC', 'STATUS', 'JOINED', 'ACTIONS'].map(h => <div key={h} style={S.th}>{h}</div>)}
                </div>
                {users.length === 0 && <div style={S.empty}>No users found</div>}
                {users.map(u => {
                  const moreItems = [
                    { label: '📧 Send message',    onClick: () => { setMsgSubject(''); setMsgBody(''); setModal({ type: 'send_msg', data: u }); } },
                    { label: '🔑 Reassign wallet',  onClick: () => { setNewWallet(''); setReason(''); setModal({ type: 'reassign_wallet', data: u }); } },
                    { label: '🔄 Resync portfolio', onClick: () => handleResync(u.id) },
                    { label: '↻ Require re-KYC',    onClick: () => { setReason(''); setModal({ type: 'rekyc', data: u }); } },
                    { label: '🗑 Delete user',       onClick: () => { setReason(''); setModal({ type: 'delete_user', data: u }); }, danger: true },
                  ];
                  return (
                    <div key={u.id} style={{ ...S.trow, gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr 2fr' }}>
                      <div style={S.td}><div style={{ color: u.frozen ? '#f87171' : '#f0fdf4', fontSize: 11 }}>{u.full_name || '—'}{u.frozen && ' 🔒'}</div><div style={{ color: '#f59e0bcc', fontSize: 9 }}>{u.email}</div></div>
                      <div style={{ ...S.td, fontSize: 8, color: '#60a5facc', fontFamily: 'monospace' }}>{u.wallet_address ? `${u.wallet_address.slice(0, 6)}...${u.wallet_address.slice(-4)}` : '—'}</div>
                      <div style={S.td}><StatusBadge status={u.kyc_status || 'pending'} /></div>
                      <div style={S.td}><StatusBadge status={u.frozen ? 'frozen' : 'active'} /></div>
                      <div style={{ ...S.td, fontSize: 8, color: '#f59e0bbb' }}>{fmt(u.created_at)}</div>
                      <div style={{ ...S.td, display: 'flex', gap: 4, alignItems: 'center' }}>
                        <button style={S.actView} onClick={() => { loadUserData(u.id); setModal({ type: 'user_detail', data: u }); }}>VIEW</button>
                        <button style={{ ...S.actView, borderColor: '#22c55e22', color: '#22c55eaa' }} onClick={() => { loadUserData(u.id); setModal({ type: 'user_history', data: u }); }}>HISTORY</button>
                        {!u.frozen ? <button style={S.actReject} onClick={() => setModal({ type: 'freeze', data: u })}>FREEZE</button> : <button style={S.actApprove} onClick={() => setModal({ type: 'unfreeze', data: u })}>UNFREEZE</button>}
                        <MoreMenu items={moreItems} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══ PROJECTS ══ */}
        {tab === 'projects' && (
          <div>
            {loading ? <div style={S.loading}>Loading...</div> : (
              <div style={S.table}>
                <div style={{ ...S.thead, gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 1fr' }}>
                  {['PROJECT', 'STD', 'BATCHES', 'TOTAL', 'AVAIL', 'RETIRED', 'MINTED'].map(h => <div key={h} style={S.th}>{h}</div>)}
                </div>
                {projects.length === 0 && <div style={S.empty}>No projects</div>}
                {projects.map(p => (
                  <div key={p.id} style={{ ...S.trow, gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 1fr' }}>
                    <div style={S.td}><div style={{ color: '#f0fdf4', fontSize: 11 }}>{p.project_name}</div><div style={{ color: '#f59e0bcc', fontSize: 8 }}>{p.project_code} · {p.developer_name || '—'}</div></div>
                    <div style={S.td}><StatusBadge status={p.standard} /></div>
                    <div style={{ ...S.td, fontSize: 11 }}>{p.batch_count}</div>
                    <div style={{ ...S.td, fontSize: 11, color: '#f0fdf4' }}>{parseInt(p.total_credits).toLocaleString()}</div>
                    <div style={{ ...S.td, fontSize: 11, color: '#22c55e' }}>{parseInt(p.available_credits).toLocaleString()}</div>
                    <div style={{ ...S.td, fontSize: 11, color: '#f87171' }}>{parseInt(p.retired_credits).toLocaleString()}</div>
                    <div style={{ ...S.td, fontSize: 11, color: p.minted_batches > 0 ? '#22c55e' : '#f59e0baa' }}>{p.minted_batches}/{p.batch_count}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ DISPUTES ══ */}
        {tab === 'disputes' && (
          <div>
            <div style={S.toolbar}>
              <button style={S.quickBtn} onClick={() => setModal({ type: 'new_dispute' })}>+ OPEN DISPUTE</button>
            </div>
            {loading ? <div style={S.loading}>Loading...</div> : (
              <div style={S.table}>
                <div style={{ ...S.thead, gridTemplateColumns: 'repeat(5,1fr)' }}>
                  {['TARGET', 'REASON', 'STATUS', 'OPENED', 'ACTIONS'].map(h => <div key={h} style={S.th}>{h}</div>)}
                </div>
                {disputes.length === 0 && <div style={S.empty}>No disputes</div>}
                {disputes.map(d => (
                  <div key={d.id} style={{ ...S.trow, gridTemplateColumns: 'repeat(5,1fr)' }}>
                    <div style={S.td}><div style={{ color: '#f0fdf4', fontSize: 11 }}>{d.target_name || '—'}</div><div style={{ color: '#f59e0bcc', fontSize: 9 }}>{d.target_email}</div></div>
                    <div style={{ ...S.td, fontSize: 10, color: '#f59e0bdd' }}>{d.reason?.slice(0, 60)}</div>
                    <div style={S.td}><StatusBadge status={d.status} /></div>
                    <div style={{ ...S.td, fontSize: 9, color: '#f59e0bbb' }}>{fmt(d.created_at)}</div>
                    <div style={S.td}>{d.status === 'open' && <button style={S.actApprove} onClick={() => setModal({ type: 'resolve_dispute', data: d })}>RESOLVE</button>}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ BLACKLIST ══ */}
        {tab === 'blacklist' && (
          <div>
            <div style={{ ...S.card, marginBottom: 16 }}>
              <SecHead>BLACKLIST NEW SERIAL</SecHead>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input style={{ ...S.input, minWidth: 200 }} placeholder="Serial number" value={newSerial} onChange={e => setNewSerial(e.target.value)} />
                <input style={{ ...S.input, flex: 1 }} placeholder="Reason..." value={reason} onChange={e => setReason(e.target.value)} />
                <button style={{ ...S.quickBtn, borderColor: '#f87171', color: '#f87171' }} onClick={handleBlacklistSerial}>🚫 BLACKLIST</button>
              </div>
            </div>
            {loading ? <div style={S.loading}>Loading...</div> : (
              <div style={S.table}>
                <div style={{ ...S.thead, gridTemplateColumns: '2fr 3fr 1.5fr 1fr' }}>
                  {['SERIAL', 'REASON', 'BY', 'ACTION'].map(h => <div key={h} style={S.th}>{h}</div>)}
                </div>
                {blacklist.length === 0 && <div style={S.empty}>No blacklisted serials</div>}
                {blacklist.map(b => (
                  <div key={b.serial_number} style={{ ...S.trow, gridTemplateColumns: '2fr 3fr 1.5fr 1fr' }}>
                    <div style={{ ...S.td, fontSize: 9, color: '#f87171', fontFamily: 'monospace' }}>{b.serial_number}</div>
                    <div style={{ ...S.td, fontSize: 10, color: '#f59e0bbb' }}>{b.reason}</div>
                    <div style={{ ...S.td, fontSize: 9, color: '#f59e0b88' }}>{b.blacklisted_by_email || '—'}</div>
                    <div style={S.td}><button style={S.actApprove} onClick={() => handleUnblacklist(b.serial_number)}>REMOVE</button></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ ANNOUNCEMENTS ══ */}
        {tab === 'announcements' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              <div style={S.card}>
                <SecHead>📢 BROADCAST TO ALL USERS</SecHead>
                <input style={{ ...S.input, width: '100%', marginBottom: 10 }} placeholder="Subject / Title" value={annTitle} onChange={e => setAnnTitle(e.target.value)} />
                <textarea style={{ ...M.ta, marginBottom: 10 }} placeholder="Message body..." value={annMsg} onChange={e => setAnnMsg(e.target.value)} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <input type="checkbox" id="ae" checked={annEmail} onChange={e => setAnnEmail(e.target.checked)} />
                  <label htmlFor="ae" style={{ fontSize: 10, color: '#f59e0bcc' }}>Also send email</label>
                </div>
                <button style={{ ...S.quickBtn, borderColor: '#f59e0b66', color: '#f59e0b', width: '100%', textAlign: 'center', opacity: broadcasting ? .5 : 1 }} onClick={handleBroadcast} disabled={broadcasting}>
                  {broadcasting ? '⟳ BROADCASTING...' : `📢 BROADCAST${annEmail ? ' + EMAIL' : ' (IN-APP)'}`}
                </button>
              </div>
              <div style={S.card}>
                <SecHead>🪧 PLATFORM BANNER</SecHead>
                <input style={{ ...S.input, width: '100%', marginBottom: 10 }} placeholder="Banner title" value={annTitle} onChange={e => setAnnTitle(e.target.value)} />
                <textarea style={{ ...M.ta, minHeight: 60, marginBottom: 10 }} placeholder="Banner message..." value={annMsg} onChange={e => setAnnMsg(e.target.value)} />
                <select style={{ ...S.input, width: '100%', marginBottom: 12 }} value={annType} onChange={e => setAnnType(e.target.value)}>
                  <option value="info">ℹ Info</option>
                  <option value="warning">⚠ Warning</option>
                  <option value="critical">🚨 Critical</option>
                  <option value="success">✅ Success</option>
                </select>
                <button style={{ ...S.quickBtn, borderColor: '#60a5fa44', color: '#60a5fa', width: '100%', textAlign: 'center' }} onClick={handleSaveBanner}>🪧 SAVE BANNER</button>
              </div>
            </div>
            <div style={S.card}>
              <SecHead>ACTIVE BANNERS</SecHead>
              {announcements.length === 0 ? <div style={S.empty}>No active banners</div> : announcements.map(a => (
                <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #f59e0b08' }}>
                  <div><div style={{ fontSize: 11, color: '#f0fdf4', fontWeight: 600 }}>{a.title}</div><div style={{ fontSize: 10, color: '#f59e0baa', marginTop: 2 }}>{a.message?.slice(0, 80)}...</div><div style={{ fontSize: 9, color: '#f59e0b44', marginTop: 2 }}>{fmt(a.created_at)} · {a.type?.toUpperCase()}</div></div>
                  <button style={S.actReject} onClick={() => handleDeleteAnn(a.id)}>REMOVE</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ SUPPORT ══ */}
        {tab === 'support' && (
          <div>
            <div style={S.toolbar}>
              <div style={{ display: 'flex', gap: 4, background: '#0d0a00', border: '1px solid #f59e0b1a', borderRadius: 8, padding: 3 }}>
                {[['tickets', 'Tickets'], ['analytics', 'Analytics']].map(([id, label]) => (
                  <button key={id} style={{ padding: '6px 14px', borderRadius: 5, border: 'none', cursor: 'pointer', fontFamily: "'DM Mono',monospace", fontSize: 10, fontWeight: 700, background: supportSubTab === id ? '#f59e0b' : 'transparent', color: supportSubTab === id ? '#0a0800' : '#f59e0bcc' }} onClick={() => setSupportSubTab(id)}>{label}</button>
                ))}
              </div>
              {supportSubTab === 'tickets' && <>
                <input style={S.input} placeholder="Search ticket #, name, or email..." value={supportSearch} onChange={e => setSupportSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadSupportTickets()} />
                <FilterRow options={[{value:'all',label:'All'},{value:'open',label:'Open'},{value:'in_progress',label:'In Progress'},{value:'resolved',label:'Resolved'},{value:'closed',label:'Closed'}]} value={supportStatusFilter} onChange={v => { setSupportStatusFilter(v); setSupportPage(1); }} />
              </>}
            </div>

            {supportSubTab === 'tickets' && <>
              {supportLoading ? <div style={S.loading}>Loading...</div> : (
                <div style={S.table}>
                  <div style={{ ...S.thead, gridTemplateColumns: '2fr 2.5fr 1.5fr 1fr 1.5fr' }}>
                    {['TICKET', 'FROM', 'SUBMITTED', 'STATUS', 'ACTIONS'].map(h => <div key={h} style={S.th}>{h}</div>)}
                  </div>
                  {supportTickets.length === 0 && <div style={S.empty}>No tickets found</div>}
                  {supportTickets.map(t => (
                    <div key={t.id} style={{ ...S.trow, gridTemplateColumns: '2fr 2.5fr 1.5fr 1fr 1.5fr' }}>
                      <div style={S.td}><div style={{ fontSize: 10, color: '#22c55e', fontFamily: 'monospace' }}>{t.ticket_number}</div><div style={{ fontSize: 10, color: '#f0fdf4', marginTop: 2 }}>{t.subject || t.message.slice(0, 50)}</div></div>
                      <div style={S.td}><div style={{ fontSize: 11, color: '#f0fdf4' }}>{t.name}</div><div style={{ fontSize: 9, color: '#f59e0bcc' }}>{t.email}</div></div>
                      <div style={{ ...S.td, fontSize: 9, color: '#f59e0bbb' }}>{fmtT(t.created_at)}</div>
                      <div style={S.td}><StatusBadge status={t.status} /></div>
                      <div style={{ ...S.td, display: 'flex', gap: 4, alignItems: 'center' }}>
                        <button style={S.actView} onClick={() => setModal({ type: 'support_ticket_detail', data: t })}>VIEW</button>
                        {t.status === 'open' && <button style={S.actApprove} onClick={() => updateTicketStatus(t.id, 'in_progress')}>START</button>}
                        {t.status === 'in_progress' && <button style={S.actApprove} onClick={() => updateTicketStatus(t.id, 'resolved')}>RESOLVE</button>}
                        {t.status !== 'closed' && <MoreMenu items={[{ label: '✕ Close ticket', onClick: () => updateTicketStatus(t.id, 'closed'), danger: true }]} />}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {supportTotalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginTop: 16, alignItems: 'center' }}>
                  <button style={S.filterBtn} disabled={supportPage <= 1} onClick={() => setSupportPage(p => p - 1)}>← PREV</button>
                  <span style={{ fontSize: 10, color: '#f59e0bcc' }}>Page {supportPage} of {supportTotalPages}</span>
                  <button style={S.filterBtn} disabled={supportPage >= supportTotalPages} onClick={() => setSupportPage(p => p + 1)}>NEXT →</button>
                </div>
              )}
            </>}

            {supportSubTab === 'analytics' && (
              supportLoading || !supportAnalytics ? <div style={S.loading}>Loading...</div> : <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 10, marginBottom: 16 }}>
                  {Object.entries(supportAnalytics.ticketCounts || {}).map(([status, count]) => (
                    <div key={status} style={S.statCard}><div style={{ fontSize: 22, fontWeight: 700, color: '#f59e0b', marginBottom: 3 }}>{count}</div><div style={{ fontSize: 8, color: '#f59e0bcc', letterSpacing: '.1em' }}>{status.replace('_', ' ').toUpperCase()}</div></div>
                  ))}
                  <div style={S.statCard}><div style={{ fontSize: 22, fontWeight: 700, color: '#22c55e', marginBottom: 3 }}>{supportAnalytics.totalFeedback}</div><div style={{ fontSize: 8, color: '#f59e0bcc', letterSpacing: '.1em' }}>TOTAL FEEDBACK</div></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div style={S.card}>
                    <SecHead>👎 KB NEEDS IMPROVEMENT</SecHead>
                    {(supportAnalytics.topicStats || []).length === 0 ? <div style={{ fontSize: 10, color: '#f59e0b44' }}>No feedback data yet</div>
                      : supportAnalytics.topicStats.map(t => (
                        <div key={t.topicId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #f59e0b08' }}>
                          <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 11, color: '#f0fdf4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.question || t.topicId}</div></div>
                          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}><span style={{ fontSize: 11, color: '#22c55e' }}>👍 {t.helpful}</span><span style={{ fontSize: 11, color: '#f87171' }}>👎 {t.unhelpful}</span></div>
                        </div>
                      ))}
                  </div>
                  <div style={S.card}>
                    <SecHead>🆘 TOP UNANSWERED QUERIES (90D)</SecHead>
                    {(supportAnalytics.topUnanswered || []).length === 0 ? <div style={{ fontSize: 10, color: '#f59e0b44' }}>No unanswered queries — great coverage!</div>
                      : supportAnalytics.topUnanswered.map((q, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f59e0b08' }}>
                          <span style={{ fontSize: 11, color: '#f0fdf4' }}>{q.query}</span>
                          <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>×{q.count}</span>
                        </div>
                      ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ══ REVENUE ══ */}
        {tab === 'revenue' && (
          <div>
            <div style={S.toolbar}>
              <FilterRow options={[{value:'7',label:'7D'},{value:'30',label:'30D'},{value:'90',label:'90D'},{value:'365',label:'1Y'}]} value={revPeriod} onChange={p => { setRevPeriod(p); loadRevenue(p); }} />
            </div>
            <div style={{ ...S.toolbar, marginTop: -8 }}>
              <FilterRow
                options={[
                  { value: 'this_month', label: 'This Month' },
                  { value: 'last_3_months', label: '3 Months' },
                  { value: 'last_6_months', label: '6 Months' },
                  { value: 'this_year', label: 'This Year' },
                  { value: 'last_12_months', label: '1 Year' },
                  { value: 'all_time', label: 'All Time' },
                ]}
                value={exportPeriod}
                onChange={setExportPeriod}
              />
              <button style={{ ...S.quickBtn, borderColor: '#22c55e44', color: '#22c55e' }} onClick={() => handleFinanceExport('subscriptions', exportPeriod)}>↓ EXPORT SUBSCRIPTIONS CSV</button>
              <button style={{ ...S.quickBtn, borderColor: '#60a5fa44', color: '#60a5fa' }} onClick={() => handleFinanceExport('trades', exportPeriod)}>↓ EXPORT TRADE FEES CSV</button>
              <button style={{ ...S.quickBtn, borderColor: '#f59e0b44', color: '#f59e0b' }} onClick={() => handleFinanceExport('combined', exportPeriod)}>↓ EXPORT COMBINED CSV</button>
            </div>
            {loading || !revenue ? <div style={S.loading}>Loading...</div> : <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 10, marginBottom: 16 }}>
                {[{ l: `FEES(${revPeriod}D)`, v: fmtINR(revenue.summary?.period_fees_inr), c: '#22c55e' }, { l: 'TOTAL FEES', v: fmtINR(revenue.summary?.total_fees_inr), c: '#22c55e' }, { l: 'VOLUME', v: fmtINR(revenue.summary?.total_volume_inr), c: '#60a5fa' }, { l: 'CREDITS TRADED', v: `${parseInt(revenue.summary?.total_credits_traded || 0).toLocaleString()}t`, c: '#f59e0b' }, { l: 'TOTAL TRADES', v: revenue.summary?.total_trades || 0, c: '#a78bfa' }, { l: `ACTIVE USERS(${revPeriod}D)`, v: revenue.activeUsers || 0, c: '#34d399' }].map(({ l, v, c }) => (
                  <div key={l} style={S.statCard}><div style={{ fontSize: 18, fontWeight: 700, color: c, marginBottom: 2 }}>{v}</div><div style={{ fontSize: 8, color: '#f59e0bcc', letterSpacing: '.1em' }}>{l}</div></div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div style={S.card}><SecHead>FEES BY MONTH</SecHead>{(revenue.feesByMonth || []).map(m => <div key={m.month} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f59e0b08' }}><span style={{ fontSize: 10, color: '#f59e0bcc' }}>{m.month}</span><div style={{ textAlign: 'right' }}><div style={{ fontSize: 10, color: '#22c55e' }}>{fmtINR(m.fees_inr)}</div><div style={{ fontSize: 8, color: '#f59e0b44' }}>{m.trades} trades</div></div></div>)}</div>
                <div style={S.card}><SecHead>RETIREMENTS BY MONTH</SecHead>{(revenue.retirementsByMonth || []).map(m => <div key={m.month} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f59e0b08' }}><span style={{ fontSize: 10, color: '#f59e0bcc' }}>{m.month}</span><div style={{ textAlign: 'right' }}><div style={{ fontSize: 10, color: '#f87171' }}>{parseInt(m.tco2).toLocaleString()}t</div><div style={{ fontSize: 8, color: '#f59e0b44' }}>{m.count} certs</div></div></div>)}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={S.card}><SecHead>TOP 10 TRADERS</SecHead>{(revenue.topTraders || []).map((t, i) => <div key={t.email} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #f59e0b08' }}><div><span style={{ fontSize: 8, color: '#f59e0b44', marginRight: 5 }}>#{i + 1}</span><span style={{ fontSize: 11, color: '#f0fdf4' }}>{t.full_name || t.email}</span><div style={{ fontSize: 8, color: '#f59e0b44' }}>{t.trade_count} trades</div></div><div style={{ fontSize: 11, color: '#22c55e' }}>{fmtINR(t.volume_inr)}</div></div>)}</div>
                <div style={S.card}><SecHead>CREDITS BY STANDARD</SecHead>{(revenue.creditsByStandard || []).map(s => <div key={s.standard} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #f59e0b08' }}><div><StatusBadge status={s.standard} /><span style={{ fontSize: 8, color: '#f59e0b44', marginLeft: 5 }}>{s.batches} batches</span></div><div style={{ fontSize: 11, color: '#f0fdf4' }}>{parseInt(s.total_credits).toLocaleString()}t</div></div>)}</div>
              </div>
            </>}
          </div>
        )}

        {/* ══ SUBSCRIPTIONS ══ */}
        {tab === 'subscriptions' && (
          <div>
            <div style={S.toolbar}>
              <button style={S.quickBtn} onClick={loadSubStats} disabled={loading}>{loading ? '⟳ Loading...' : '↻ REFRESH'}</button>
            </div>
            {loading || !subStats ? <div style={S.loading}>Loading...</div> : <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 10, marginBottom: 16 }}>
                {[
                  { l: 'ACTIVE PAID SUBS', v: subStats.totalActivePaid, c: '#22c55e' },
                  { l: 'FREE USERS', v: subStats.freeUsers, c: '#60a5fa' },
                  { l: 'CURRENT MRR', v: fmtINR(subStats.currentMRRInINR), c: '#22c55e' },
                  { l: 'CANCELLED (ALL TIME)', v: subStats.cancelledTotal, c: '#f87171' },
                  { l: 'ALL-TIME SUB REVENUE', v: fmtINR(subStats.allTimeSubscriptionRevenueINR), c: '#f59e0b' },
                  { l: 'ALL-TIME PAYMENTS', v: subStats.allTimePayments, c: '#a78bfa' },
                ].map(({ l, v, c }) => (
                  <div key={l} style={S.statCard}><div style={{ fontSize: 18, fontWeight: 700, color: c, marginBottom: 2 }}>{v}</div><div style={{ fontSize: 8, color: '#f59e0bcc', letterSpacing: '.1em' }}>{l}</div></div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div style={S.card}>
                  <SecHead>ACTIVE SUBSCRIBERS BY TIER</SecHead>
                  {(subStats.byTier || []).length === 0 && <div style={{ fontSize: 10, color: '#f59e0b66', padding: '8px 0' }}>No active paid subscribers yet</div>}
                  {(subStats.byTier || []).map(t => (
                    <div key={`${t.plan}-${t.cycle}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f59e0b08' }}>
                      <div>
                        <span style={{ fontSize: 11, color: '#f0fdf4', fontWeight: 700 }}>{(t.plan || '').toUpperCase()}</span>
                        <span style={{ fontSize: 8, color: '#f59e0b66', marginLeft: 6 }}>{t.cycle}</span>
                        <div style={{ fontSize: 8, color: '#f59e0b44' }}>{t.activeCount} subscriber{t.activeCount === 1 ? '' : 's'}</div>
                      </div>
                      <div style={{ fontSize: 11, color: '#22c55e' }}>{fmtINR(t.mrrINR)}/mo</div>
                    </div>
                  ))}
                </div>
                <div style={S.card}>
                  <SecHead>CANCELLATIONS BY MONTH</SecHead>
                  {(subStats.cancelledByMonth || []).length === 0 && <div style={{ fontSize: 10, color: '#f59e0b66', padding: '8px 0' }}>No cancellations recorded</div>}
                  {(subStats.cancelledByMonth || []).map(m => (
                    <div key={m.month} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f59e0b08' }}>
                      <span style={{ fontSize: 10, color: '#f59e0bcc' }}>{m.month}</span>
                      <span style={{ fontSize: 10, color: '#f87171' }}>{m.count} cancelled</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={S.card}>
                <SecHead>SUBSCRIPTION REVENUE BY MONTH</SecHead>
                {(subStats.revenueByMonth || []).length === 0 && <div style={{ fontSize: 10, color: '#f59e0b66', padding: '8px 0' }}>No payments recorded yet</div>}
                {(subStats.revenueByMonth || []).map((m, i) => (
                  <div key={`${m.month}-${m.plan}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #f59e0b08' }}>
                    <div>
                      <span style={{ fontSize: 10, color: '#f59e0bcc' }}>{m.month}</span>
                      <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 3, background: '#f59e0b11', color: '#f59e0bcc', marginLeft: 8 }}>{(m.plan || '').toUpperCase()}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 10, color: '#22c55e' }}>{fmtINR(m.revenueINR)}</div>
                      <div style={{ fontSize: 8, color: '#f59e0b44' }}>{m.payments} payment{m.payments === 1 ? '' : 's'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>}
          </div>
        )}

        {/* ══ CHAIN HEALTH ══ */}
        {tab === 'health' && (
          <div>
            <div style={S.toolbar}>
              <button style={S.quickBtn} onClick={loadHealth} disabled={healthLoading}>{healthLoading ? '⟳ Checking...' : '↻ REFRESH'}</button>
            </div>
            {healthLoading && !health ? <div style={S.loading}>Connecting to Sepolia...</div> : health && <>
              {health.minterWallet && !health.minterWallet.ok && (
                <div style={{ padding: '12px 16px', background: '#1a0707', border: '1px solid #f8717133', borderRadius: 8, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 22 }}>🚨</span>
                  <div><div style={{ fontSize: 13, color: '#f87171', fontWeight: 700 }}>MINTER WALLET LOW — Mints will fail</div><div style={{ fontSize: 10, color: '#f8717188', marginTop: 3 }}>{health.minterWallet.balanceEth} ETH · Need &gt;0.01 · <a href="https://faucet.sepolia.dev" target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>Faucet↗</a></div></div>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
                {[{ l: 'RPC', v: health.rpcConnected ? 'CONNECTED' : 'DOWN', c: health.rpcConnected ? '#22c55e' : '#f87171', i: health.rpcConnected ? '✅' : '❌' }, { l: 'MINTER ETH', v: health.minterWallet?.balanceEth != null ? `${health.minterWallet.balanceEth} ETH` : '?', c: health.minterWallet?.ok ? '#22c55e' : '#f87171', i: '💰' }, { l: 'CHAIN ID', v: health.chainId ? `#${health.chainId}` : '?', c: '#60a5fa', i: '⛓' }, { l: 'PENDING', v: health.pendingMints ?? '—', c: (health.pendingMints ?? 0) > 0 ? '#f59e0b' : '#22c55e', i: '⏳' }, { l: 'FAILED', v: health.failedMints ?? '—', c: (health.failedMints ?? 0) > 0 ? '#f87171' : '#22c55e', i: '❌' }, { l: 'LAST MINT', v: health.lastMint ? fmt(health.lastMint.tokenised_at) : 'Never', c: '#f0fdf4', i: '🕐' }].map(({ l, v, c, i }) => (
                  <div key={l} style={S.statCard}><div style={{ fontSize: 18, marginBottom: 4 }}>{i}</div><div style={{ fontSize: 14, fontWeight: 700, color: c, marginBottom: 2 }}>{v}</div><div style={{ fontSize: 8, color: '#f59e0bcc', letterSpacing: '.1em' }}>{l}</div></div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={S.card}><SecHead>CONTRACT ADDRESSES</SecHead>
                  {[['Token', health.contractAddress], ['Marketplace', health.marketplaceAddress], ['Minter', health.minterWallet?.address]].map(([label, addr]) => (
                    <div key={label} style={{ padding: '6px 0', borderBottom: '1px solid #f59e0b08' }}><div style={{ fontSize: 8, color: '#f59e0baa', letterSpacing: '.1em', marginBottom: 2 }}>{label}</div>{addr ? <a href={`https://sepolia.etherscan.io/address/${addr}`} target="_blank" rel="noreferrer" style={{ fontSize: 8, color: '#60a5fa', fontFamily: 'monospace', textDecoration: 'none', wordBreak: 'break-all' }}>{addr}</a> : <span style={{ fontSize: 8, color: '#f8717188' }}>Not configured</span>}</div>
                  ))}
                </div>
                <div style={S.card}><SecHead>QUICK ACTIONS</SecHead>
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
                    <a href="https://faucet.sepolia.dev" target="_blank" rel="noreferrer" style={{ ...S.quickBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', fontSize: 9 }}>💧 FAUCET↗</a>
                    <a href={`https://sepolia.etherscan.io/address/${health.minterWallet?.address}`} target="_blank" rel="noreferrer" style={{ ...S.quickBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', fontSize: 9 }}>🔍 MINTER↗</a>
                    <button style={{ ...S.quickBtn, borderColor: '#f87171', color: '#f87171', fontSize: 9 }} onClick={() => setTab('credits')}>⚠ FAILED MINTS</button>
                  </div>
                  {health.lastMint && <><div style={M.row}><span style={M.key}>Last Token</span><span style={{ ...M.val, color: '#22c55e' }}>#{health.lastMint.token_id}</span></div><div style={M.row}><span style={M.key}>Project</span><span style={M.val}>{health.lastMint.project_name}</span></div><div style={M.row}><span style={M.key}>At</span><span style={M.val}>{fmtT(health.lastMint.tokenised_at)}</span></div></>}
                </div>
              </div>
            </>}
          </div>
        )}

        {/* ══ AUDIT ══ */}
        {tab === 'audit' && (
          <div>
            <div style={S.toolbar}>
              <button style={{ ...S.quickBtn, borderColor: '#22c55e44', color: '#22c55e' }} onClick={handleExportAudit}>↓ EXPORT CSV</button>
            </div>
            {loading ? <div style={S.loading}>Loading...</div> : (
              <div style={S.table}>
                <div style={{ ...S.thead, gridTemplateColumns: 'repeat(4,1fr)' }}>
                  {['ACTION', 'TARGET', 'DETAILS', 'TIMESTAMP'].map(h => <div key={h} style={S.th}>{h}</div>)}
                </div>
                {audit.length === 0 && <div style={S.empty}>No entries</div>}
                {audit.map(a => (
                  <div key={a.id} style={{ ...S.trow, gridTemplateColumns: 'repeat(4,1fr)' }}>
                    <div style={S.td}><span style={{ fontSize: 8, padding: '2px 7px', borderRadius: 20, background: '#1a0f0066', border: '1px solid #f59e0b66', color: '#f59e0b' }}>{a.action}</span></div>
                    <div style={S.td}><div style={{ fontSize: 11, color: '#f0fdf4' }}>{a.target_name || '—'}</div><div style={{ fontSize: 9, color: '#f59e0bcc' }}>{a.target_email}</div></div>
                    <div style={{ ...S.td, fontSize: 9, color: '#f59e0bbb', maxWidth: 220 }}>{a.details}</div>
                    <div style={{ ...S.td, fontSize: 9, color: '#f59e0baa' }}>{fmtT(a.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ COMPLIANCE ══ */}
        {tab === 'compliance' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
              {[{ l: 'OPEN FLAGS', v: compStats.openFlags, c: '#f59e0b', i: '🚩' }, { l: 'CRITICAL', v: compStats.criticalFlags, c: '#f87171', i: '🚨' }, { l: 'TOTAL TDS', v: fmtINR(compStats.totalTds), c: '#60a5fa', i: '📋' }, { l: 'FEMA CONV.', v: compStats.totalConversions, c: '#a78bfa', i: '🔄' }].map(({ l, v, c, i }) => (
                <div key={l} style={S.statCard}><div style={{ fontSize: 18, marginBottom: 4 }}>{i}</div><div style={{ fontSize: 18, fontWeight: 700, color: c, marginBottom: 2 }}>{v}</div><div style={{ fontSize: 8, color: '#f59e0bcc', letterSpacing: '.12em' }}>{l}</div></div>
              ))}
            </div>
            <div style={S.toolbar}>
              {[{ id: 'flags', l: '🚩 Flags' }, { id: 'tds', l: '📋 TDS' }, { id: 'fema', l: '🔄 FEMA' }, { id: 'config', l: '⚙️ Config' }].map(t => (
                <button key={t.id} style={{ padding: '7px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: "'DM Mono',monospace", fontSize: 10, borderBottom: `2px solid ${compTab === t.id ? '#f59e0b' : 'transparent'}`, color: compTab === t.id ? '#f59e0b' : '#f59e0bcc' }} onClick={() => setCompTab(t.id)}>{t.l}</button>
              ))}
            </div>
            {compTab === 'flags' && (
              <div>
                <div style={{ ...S.toolbar, marginTop: 12 }}>
                  <FilterRow options={[{value:'all',label:'All'},{value:'open',label:'Open'},{value:'reviewed',label:'Reviewed'},{value:'cleared',label:'Cleared'},{value:'escalated',label:'Escalated'}]} value={flagFilter} onChange={setFlagFilter} />
                  <FilterRow options={[{value:'',label:'All Sev'},{value:'low',label:'Low'},{value:'medium',label:'Med'},{value:'high',label:'High'},{value:'critical',label:'Crit'}]} value={flagSeverity} onChange={setFlagSeverity} />
                </div>
                {compLoading ? <div style={S.loading}>Loading...</div> : (
                  <div style={S.table}>
                    <div style={{ ...S.thead, gridTemplateColumns: '1.5fr 1fr 1fr 1fr 2fr 1fr 1fr' }}>
                      {['USER', 'FLAG', 'AMOUNT', 'SEV', 'DESC', 'STATUS', 'ACTIONS'].map(h => <div key={h} style={S.th}>{h}</div>)}
                    </div>
                    {compFlags.length === 0 && <div style={S.empty}>No flags</div>}
                    {compFlags.map(f => (
                      <div key={f.id} style={{ ...S.trow, gridTemplateColumns: '1.5fr 1fr 1fr 1fr 2fr 1fr 1fr', ...(f.severity === 'critical' && f.status === 'open' ? { borderLeft: '2px solid #f8717133' } : {}) }}>
                        <div style={S.td}><div style={{ color: '#f0fdf4', fontSize: 11 }}>{f.full_name || '—'}</div><div style={{ color: '#f59e0bcc', fontSize: 9 }}>{f.email}</div></div>
                        <div style={S.td}><span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: '#1a0f0066', border: '1px solid #f59e0b33', color: '#f59e0b' }}>{f.flag_type}</span></div>
                        <div style={{ ...S.td, fontSize: 11 }}>{f.amount ? `₹${parseFloat(f.amount).toLocaleString('en-IN')}` : '—'}</div>
                        <div style={S.td}><span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, border: `1px solid ${({ low: '#22c55e', medium: '#f59e0b', high: '#f97316', critical: '#f87171' }[f.severity] || '#f59e0b')}33`, color: ({ low: '#22c55e', medium: '#f59e0b', high: '#f97316', critical: '#f87171' }[f.severity] || '#f59e0b') }}>{f.severity?.toUpperCase()}</span></div>
                        <div style={{ ...S.td, fontSize: 9, color: '#f59e0bbb' }}>{f.description?.slice(0, 70)}</div>
                        <div style={S.td}><StatusBadge status={f.status} /></div>
                        <div style={{ ...S.td, display: 'flex', gap: 4 }}>
                          {f.status === 'open' && <><button style={S.actApprove} onClick={() => setModal({ type: 'flag_review', data: f, action: 'cleared' })}>CLEAR</button><button style={{ ...S.actReject, fontSize: 8 }} onClick={() => setModal({ type: 'flag_review', data: f, action: 'escalated' })}>ESC</button></>}
                          {f.status !== 'open' && <button style={S.actView} onClick={() => setModal({ type: 'flag_detail', data: f })}>VIEW</button>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {compTab === 'tds' && (
              <div>
                <div style={{ ...S.toolbar, marginTop: 12 }}>
                  <FilterRow options={[{value:'',label:'All'},{value:'2024-25',label:'FY24-25'},{value:'2025-26',label:'FY25-26'},{value:'2026-27',label:'FY26-27'}]} value={fyFilter} onChange={setFyFilter} />
                </div>
                {compLoading ? <div style={S.loading}>Loading...</div> : (
                  <div style={S.table}>
                    <div style={{ ...S.thead, gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1fr 1fr 1fr' }}>
                      {['USER', 'FY/QTR', 'GROSS', 'TDS 1%', 'NET', 'PAN', 'STATUS'].map(h => <div key={h} style={S.th}>{h}</div>)}
                    </div>
                    {compTDS.length === 0 && <div style={S.empty}>No TDS records</div>}
                    {compTDS.map(t => (
                      <div key={t.id} style={{ ...S.trow, gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1fr 1fr 1fr' }}>
                        <div style={S.td}><div style={{ fontSize: 11, color: '#f0fdf4' }}>{t.full_name || '—'}</div><div style={{ fontSize: 9, color: '#f59e0bcc' }}>{t.email}</div></div>
                        <div style={S.td}><div style={{ fontSize: 10 }}>{t.financial_year}</div><div style={{ fontSize: 9, color: '#f59e0bcc' }}>{t.quarter}</div></div>
                        <div style={{ ...S.td, fontSize: 11 }}>{fmtINR(t.transaction_amount)}</div>
                        <div style={{ ...S.td, fontSize: 11, color: '#f87171', fontWeight: 600 }}>{fmtINR(t.tds_amount)}</div>
                        <div style={{ ...S.td, fontSize: 11, color: '#22c55e' }}>{fmtINR(t.net_amount)}</div>
                        <div style={{ ...S.td, fontSize: 9, color: '#60a5facc', fontFamily: 'monospace' }}>{t.pan || '—'}</div>
                        <div style={S.td}><StatusBadge status={t.status} /></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {compTab === 'fema' && (
              <div>
                {compLoading ? <div style={S.loading}>Loading...</div> : (
                  <div style={S.table}>
                    <div style={{ ...S.thead, gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1fr 1.5fr 1fr' }}>
                      {['USER', 'INR', 'ETH', 'RATE', 'PURPOSE', 'TX', 'DATE'].map(h => <div key={h} style={S.th}>{h}</div>)}
                    </div>
                    {compFEMA.length === 0 && <div style={S.empty}>No FEMA records</div>}
                    {compFEMA.map(c => (
                      <div key={c.id} style={{ ...S.trow, gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1fr 1.5fr 1fr' }}>
                        <div style={S.td}><div style={{ fontSize: 11, color: '#f0fdf4' }}>{c.full_name || '—'}</div><div style={{ fontSize: 9, color: '#f59e0bcc' }}>{c.email}</div></div>
                        <div style={{ ...S.td, fontSize: 11, color: '#22c55e', fontWeight: 600 }}>{fmtINR(c.inr_amount)}</div>
                        <div style={{ ...S.td, fontSize: 11, color: '#60a5fa' }}>{parseFloat(c.crypto_amount).toFixed(6)}</div>
                        <div style={{ ...S.td, fontSize: 10, color: '#f59e0bbb' }}>₹{parseFloat(c.eth_inr_rate).toLocaleString('en-IN')}</div>
                        <div style={{ ...S.td, fontSize: 9, color: '#a78bfacc' }}>{c.purpose?.replace(/_/g, ' ').toUpperCase()}</div>
                        <div style={{ ...S.td, fontSize: 8, color: '#60a5fa88', fontFamily: 'monospace' }}>{c.tx_hash ? `${c.tx_hash.slice(0, 8)}...` : '—'}</div>
                        <div style={{ ...S.td, fontSize: 9, color: '#f59e0baa' }}>{fmt(c.created_at)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {compTab === 'config' && (
              <div>
                {compLoading ? <div style={S.loading}>Loading...</div> : (
                  <div style={S.table}>
                    <div style={{ ...S.thead, gridTemplateColumns: '2fr 1fr 3fr 1.5fr' }}>
                      {['KEY', 'VALUE', 'DESCRIPTION', 'ACTION'].map(h => <div key={h} style={S.th}>{h}</div>)}
                    </div>
                    {compConfig.length === 0 && <div style={S.empty}>No config</div>}
                    {compConfig.map(c => (
                      <div key={c.key} style={{ ...S.trow, gridTemplateColumns: '2fr 1fr 3fr 1.5fr', alignItems: 'center' }}>
                        <div style={{ ...S.td, fontSize: 10, color: '#60a5fa', fontFamily: 'monospace' }}>{c.key}</div>
                        <div style={S.td}>{editingConfig[c.key] !== undefined ? <input style={{ ...S.input, width: 90, padding: '4px 8px', fontSize: 11 }} value={editingConfig[c.key]} onChange={e => setEditingConfig(p => ({ ...p, [c.key]: e.target.value }))} onKeyDown={e => e.key === 'Enter' && saveConfig(c.key, editingConfig[c.key])} autoFocus /> : <span style={{ fontSize: 13, color: '#22c55e', fontWeight: 700 }}>{c.value}</span>}</div>
                        <div style={{ ...S.td, fontSize: 10, color: '#f59e0baa', lineHeight: 1.5 }}>{c.description}</div>
                        <div style={{ ...S.td, display: 'flex', gap: 6 }}>{editingConfig[c.key] !== undefined ? <><button style={S.actApprove} onClick={() => saveConfig(c.key, editingConfig[c.key])}>SAVE</button><button style={S.actView} onClick={() => setEditingConfig(p => { const n = { ...p }; delete n[c.key]; return n; })}>CANCEL</button></> : <button style={S.actView} onClick={() => setEditingConfig(p => ({ ...p, [c.key]: c.value }))}>EDIT</button>}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══ CORPORATE ══ */}
        {tab === 'corporate' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              {/* Activate */}
              <div style={S.card}>
                <SecHead>ACTIVATE CORPORATE — FIND USER</SecHead>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input style={{ ...S.input, flex: 1 }} placeholder="Search email or name..." value={corpSearch} onChange={e => setCorpSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCorpUserSearch()} />
                  <button style={S.quickBtn} onClick={handleCorpUserSearch} disabled={corpSearching}>{corpSearching ? '⟳' : '🔍'}</button>
                </div>
                {corpSearchResults !== null && (
                  <div style={{ marginBottom: 12, maxHeight: 200, overflowY: 'auto' }}>
                    {corpSearchResults.length === 0 && <div style={{ fontSize: 10, color: '#f59e0b44', padding: '8px 0' }}>No users found</div>}
                    {corpSearchResults.map(u => (
                      <div key={u.id} onClick={() => setCorpForm(f => ({ ...f, userId: u.id, email: u.email }))}
                        style={{ padding: '8px 10px', borderRadius: 6, cursor: 'pointer', marginBottom: 4, background: corpForm.userId === u.id ? '#f59e0b18' : '#0a0800', border: `1px solid ${corpForm.userId === u.id ? '#f59e0b66' : '#f59e0b11'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div><div style={{ fontSize: 11, color: '#f0fdf4' }}>{u.full_name || '—'}</div><div style={{ fontSize: 9, color: '#f59e0bcc' }}>{u.email}</div></div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                          {u.kyc_verified ? <span style={{ fontSize: 8, color: '#22c55e' }}>✓ KYC</span> : <span style={{ fontSize: 8, color: '#f87171' }}>✕ KYC</span>}
                          <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 3, background: u.subscription_plan === 'corporate' ? '#f59e0b22' : '#f59e0b08', color: u.subscription_plan === 'corporate' ? '#f59e0b' : '#f59e0b66', border: '1px solid #f59e0b22' }}>{(u.subscription_plan || 'free').toUpperCase()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {corpForm.userId && (
                  <div style={{ padding: '8px 12px', borderRadius: 6, background: '#f59e0b14', border: '1px solid #f59e0b44', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div><div style={{ fontSize: 9, color: '#f59e0bcc', letterSpacing: '.1em' }}>SELECTED USER</div><div style={{ fontSize: 11, color: '#f59e0b', marginTop: 2 }}>{corpForm.email}</div></div>
                    <button style={{ background: 'none', border: 'none', color: '#f59e0b88', cursor: 'pointer', fontSize: 14 }} onClick={() => setCorpForm(f => ({ ...f, userId: '', email: '' }))}>✕</button>
                  </div>
                )}
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 9, color: '#f59e0bcc', letterSpacing: '.1em', marginBottom: 6 }}>BILLING CYCLE</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {['monthly', 'annual'].map(c => (
                      <button key={c} onClick={() => setCorpForm(f => ({ ...f, cycle: c }))} style={{ flex: 1, padding: '8px', borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Mono',monospace", fontSize: 10, fontWeight: 700, border: `1px solid ${corpForm.cycle === c ? '#f59e0b' : '#f59e0b22'}`, background: corpForm.cycle === c ? '#f59e0b18' : 'transparent', color: corpForm.cycle === c ? '#f59e0b' : '#f59e0b66' }}>{c.toUpperCase()}</button>
                    ))}
                  </div>
                </div>
                {[['SEATS (blank = unlimited)', 'number', '1', 'e.g. 25', 'seats'], ['NEGOTIATED PRICE ₹ (0 = offline)', 'number', '0', 'e.g. 75000', 'customPriceINR'], ['RENEWAL IN MONTHS (blank = auto)', 'number', '1', 'e.g. 12', 'renewalMonths']].map(([label, type, min, ph, key]) => (
                  <div key={key} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 9, color: '#f59e0bcc', letterSpacing: '.1em', marginBottom: 5 }}>{label}</div>
                    <input style={{ ...M.inp, marginBottom: 0 }} type={type} min={min} placeholder={ph} value={corpForm[key]} onChange={e => setCorpForm(f => ({ ...f, [key]: e.target.value }))} />
                  </div>
                ))}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 9, color: '#f59e0bcc', letterSpacing: '.1em', marginBottom: 5 }}>NOTES</div>
                  <textarea style={{ ...M.ta, minHeight: 52, marginBottom: 0 }} placeholder="e.g. Signed 2026-06-08 · PO #1234" value={corpForm.notes} onChange={e => setCorpForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
                <button style={{ ...M.aPrimary, background: 'linear-gradient(135deg,#d97706,#b45309)', width: '100%', padding: '11px', opacity: (corpActivating || !corpForm.userId) ? 0.45 : 1 }} onClick={handleCorpActivate} disabled={corpActivating || !corpForm.userId}>
                  {corpActivating ? '⟳ ACTIVATING...' : '🏢 ACTIVATE CORPORATE PLAN →'}
                </button>
              </div>

              {/* Renew */}
              <div style={S.card}>
                <SecHead>EXTEND / UPDATE RENEWAL</SecHead>
                <p style={{ fontSize: 10, color: '#f59e0b88', marginBottom: 14, lineHeight: 1.7 }}>Use to extend an existing plan, update seats, or adjust renewal date after a new invoice.</p>
                {[['USER ID', 'text', '', 'UUID e.g. 3f4a…', 'userId'], ['NEW RENEWAL DATE', 'date', new Date().toISOString().slice(0, 10), '', 'renewalDate'], ['SEATS (blank = no change)', 'number', '1', 'e.g. 50', 'seats']].map(([label, type, min, ph, key]) => (
                  <div key={key} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 9, color: '#f59e0bcc', letterSpacing: '.1em', marginBottom: 5 }}>{label}</div>
                    <input style={{ ...M.inp, marginBottom: 0 }} type={type} min={type === 'date' ? min : undefined} placeholder={ph} value={corpRenewalForm[key]} onChange={e => setCorpRenewalForm(f => ({ ...f, [key]: type === 'text' ? e.target.value.trim() : e.target.value }))} />
                  </div>
                ))}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 9, color: '#f59e0bcc', letterSpacing: '.1em', marginBottom: 5 }}>NOTES</div>
                  <textarea style={{ ...M.ta, minHeight: 52, marginBottom: 0 }} placeholder="e.g. Renewal PO #5678" value={corpRenewalForm.notes} onChange={e => setCorpRenewalForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
                <button style={{ ...M.aPrimary, background: 'linear-gradient(135deg,#1d4ed8,#1e40af)', width: '100%', padding: '11px', opacity: (corpRenewing || !corpRenewalForm.userId || !corpRenewalForm.renewalDate) ? 0.45 : 1 }} onClick={handleCorpRenewal} disabled={corpRenewing || !corpRenewalForm.userId || !corpRenewalForm.renewalDate}>
                  {corpRenewing ? '⟳ UPDATING...' : '📅 UPDATE RENEWAL →'}
                </button>
                <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 8, background: '#0a0800', border: '1px solid #f59e0b0d' }}>
                  <div style={{ fontSize: 9, color: '#f59e0b', letterSpacing: '.12em', marginBottom: 8 }}>WHAT ACTIVATION UNLOCKS</div>
                  {['Full Scope 3 (all 15 GHG categories)', 'BRSR / CDP / TCFD / GHG PDF exports', 'Audit trail + verifier integration', 'PAT scheme + CCTS + GEI/BEE', '5-year decarbonisation plan', 'SBTi targets + MRV calendar', 'Supplier data portal', 'Multi-entity consolidation', 'Carbon neutrality certificate', 'Team management (custom seats)'].map(f => (
                    <div key={f} style={{ fontSize: 9, color: '#22c55e88', marginBottom: 3, display: 'flex', gap: 6 }}><span style={{ color: '#22c55e', flexShrink: 0 }}>✓</span>{f}</div>
                  ))}
                </div>
              </div>
            </div>

            {/* Corporate accounts table */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <SecHead>ACTIVE CORPORATE ACCOUNTS</SecHead>
              <button style={S.quickBtn} onClick={loadCorpActivations} disabled={loading}>{loading ? '⟳' : '↻ REFRESH'}</button>
            </div>
            {loading ? <div style={S.loading}>Loading...</div> : (
              <div style={S.table}>
                <div style={{ ...S.thead, gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1.5fr 1fr 2fr 1fr' }}>
                  {['USER', 'COMPANY', 'CYCLE', 'SEATS', 'RENEWAL', 'PRICE', 'NOTES', 'ACTIONS'].map(h => <div key={h} style={S.th}>{h}</div>)}
                </div>
                {corpActivations.length === 0 && <div style={S.empty}>No corporate accounts yet</div>}
                {corpActivations.map(a => {
                  const renewalD = a.subscription_renewal_date ? new Date(a.subscription_renewal_date) : null;
                  const daysLeft = renewalD ? Math.ceil((renewalD - new Date()) / 86400000) : null;
                  const expColor = daysLeft === null ? '#f59e0b44' : daysLeft <= 30 ? '#f87171' : daysLeft <= 90 ? '#f59e0b' : '#22c55e';
                  return (
                    <div key={a.id} style={{ ...S.trow, gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1.5fr 1fr 2fr 1fr' }}>
                      <div style={S.td}><div style={{ color: '#f0fdf4', fontSize: 11 }}>{a.full_name || '—'}</div><div style={{ color: '#f59e0bcc', fontSize: 9 }}>{a.email}</div></div>
                      <div style={{ ...S.td, fontSize: 10, color: '#f0fdf4' }}>{a.company_name || a.org_name || '—'}</div>
                      <div style={S.td}><span style={{ fontSize: 8, padding: '2px 7px', borderRadius: 3, background: '#f59e0b14', color: '#f59e0b', border: '1px solid #f59e0b33' }}>{(a.subscription_cycle || '—').toUpperCase()}</span></div>
                      <div style={{ ...S.td, fontSize: 11, color: '#22c55e' }}>{a.seats_limit === 999 || a.seats_limit === null ? '∞' : a.seats_limit}</div>
                      <div style={S.td}>{renewalD ? <div><div style={{ fontSize: 10, color: '#f0fdf4' }}>{renewalD.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}</div><div style={{ fontSize: 8, color: expColor }}>{daysLeft > 0 ? `${daysLeft}d left` : daysLeft === 0 ? 'TODAY' : 'EXPIRED'}</div></div> : <span style={{ color: '#f59e0b44', fontSize: 10 }}>—</span>}</div>
                      <div style={{ ...S.td, fontSize: 10, color: '#22c55e' }}>{a.amount_paise > 0 ? `₹${(a.amount_paise / 100).toLocaleString('en-IN')}` : <span style={{ color: '#f59e0b44' }}>Custom</span>}</div>
                      <div style={{ ...S.td, fontSize: 9, color: '#f59e0b88', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.activation_notes || '—'}</div>
                      <div style={S.td}><button style={{ ...S.actView, borderColor: '#f59e0b33', color: '#f59e0b', fontSize: 7 }} onClick={() => setCorpRenewalForm({ userId: a.id, renewalDate: renewalD ? renewalD.toISOString().slice(0, 10) : '', seats: (a.seats_limit && a.seats_limit !== 999) ? String(a.seats_limit) : '', notes: '' })}>↻ RENEW</button></div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>{/* end main */}

      {/* ══ MODALS (unchanged from v3) ══ */}
      {modal?.type === 'kyc_detail' && <Dlg title="KYC Submission Details" onClose={() => setModal(null)} wide>
        {[['Name', modal.data.full_name], ['Email', modal.data.email], ['ID Type', modal.data.id_type || '—'], ['Submitted', fmt(modal.data.submitted_at)], ['Status', modal.data.status], ['Reviewed At', modal.data.reviewed_at ? fmt(modal.data.reviewed_at) : 'Not yet reviewed'], ['Rejection Reason', modal.data.rejection_reason || '—'], ['Wallet', modal.data.wallet_address || 'Not connected'], ['Aadhaar Hash', modal.data.aadhaar_hash ? `${modal.data.aadhaar_hash.slice(0, 12)}...` : '—'], ['PAN Hash', modal.data.pan_hash ? `${modal.data.pan_hash.slice(0, 12)}...` : '—']].map(([k, v]) => <div key={k} style={M.row}><span style={M.key}>{k}</span><span style={{ ...M.val, color: k === 'Status' && modal.data.status === 'rejected' ? '#f87171' : k === 'Status' && modal.data.status === 'approved' ? '#22c55e' : undefined }}>{v}</span></div>)}
        {modal.data.doc_ipfs_hash && <div style={{ marginTop: 12, padding: '10px 12px', background: '#051409', border: '1px solid #22c55e22', borderRadius: 6 }}><div style={{ fontSize: 9, color: '#22c55eaa', letterSpacing: '.1em', marginBottom: 6 }}>KYC DOCUMENT</div><a href={`${PG}/${modal.data.doc_ipfs_hash}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#60a5fa', textDecoration: 'none' }}>📄 VIEW IPFS DOC ↗ ({modal.data.doc_ipfs_hash.slice(0, 20)}...)</a></div>}
        {modal.data.status === 'pending' && <div style={{ display: 'flex', gap: 8, marginTop: 14 }}><button style={M.aPrimary} onClick={() => setModal({ type: 'kyc_approve', data: modal.data })}>✓ APPROVE KYC</button><button style={M.rPrimary} onClick={() => setModal({ type: 'kyc_reject', data: modal.data })}>✕ REJECT KYC</button></div>}
      </Dlg>}

      {modal?.type === 'kyc_approve' && (
        <Dlg title="Approve KYC" onClose={() => { setModal(null); setReason(''); setKycTier('full'); }}>
          <div style={M.ct}>Approve KYC for <strong style={{ color: '#f0fdf4' }}>{modal.data.full_name}</strong>?</div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, color: '#f59e0bcc', letterSpacing: '.12em', marginBottom: 8 }}>KYC TIER</div>
            <div style={{ display: 'flex', gap: 7 }}>
              {[{ value: 'phone', label: 'Phone', desc: 'Basic access' }, { value: 'basic', label: 'Basic', desc: 'Standard features' }, { value: 'full', label: 'Full', desc: 'All features' }].map(({ value, label, desc }) => (
                <button key={value} onClick={() => setKycTier(value)} style={{ flex: 1, padding: '10px 8px', borderRadius: 7, cursor: 'pointer', fontFamily: "'DM Mono',monospace", fontSize: 10, fontWeight: 700, border: `1px solid ${kycTier === value ? '#22c55e' : '#22c55e22'}`, background: kycTier === value ? '#0d2e1f' : 'transparent', color: kycTier === value ? '#22c55e' : '#22c55e66' }}>
                  <div>{label}</div><div style={{ fontSize: 8, fontWeight: 400, marginTop: 2, opacity: .7 }}>{desc}</div>
                </button>
              ))}
            </div>
          </div>
          <button style={M.aPrimary} onClick={() => kycAction(modal.data.id, 'approve')}>CONFIRM APPROVE — {kycTier.toUpperCase()} TIER</button>
        </Dlg>
      )}

      {modal?.type === 'kyc_reject' && <Dlg title="Reject KYC" onClose={() => { setModal(null); setReason(''); }}><textarea style={M.ta} value={reason} onChange={e => setReason(e.target.value)} placeholder="Rejection reason..." /><button style={M.rPrimary} onClick={() => kycAction(modal.data.id, 'reject')} disabled={!reason.trim()}>CONFIRM REJECT</button></Dlg>}

      {modal?.type === 'credit_detail' && <Dlg title="Credit Details" onClose={() => setModal(null)} wide>
        {[['User', modal.data.full_name], ['Email', modal.data.email], ['Project', modal.data.project_name], ['Standard', modal.data.standard || '—'], ['Serial', modal.data.registry_serial || '—'], ['Quantity', `${modal.data.quantity} tCO₂`], ['Vintage Year', modal.data.vintage_year || '—'], ['Admin Status', modal.data.admin_status], ['Token ID', modal.data.token_id != null ? `#${modal.data.token_id}` : 'Not minted'], ['Wallet', modal.data.user_wallet || 'NONE — wallet required']].map(([k, v]) => <div key={k} style={M.row}><span style={M.key}>{k}</span><span style={{ ...M.val, color: k === 'Token ID' && !modal.data.token_id ? '#f87171' : k === 'Wallet' && !modal.data.user_wallet ? '#f87171' : undefined }}>{v}</span></div>)}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          {modal.data.admin_status === 'pending' && <><button style={M.aPrimary} onClick={() => setModal({ type: 'credit_approve', data: modal.data })}>✓ APPROVE</button><button style={M.rPrimary} onClick={() => setModal({ type: 'credit_reject', data: modal.data })}>✕ REJECT</button></>}
          {modal.data.admin_status === 'approved' && !modal.data.token_id && <><button style={{ ...M.aPrimary, background: 'linear-gradient(135deg,#dc2626,#b91c1c)' }} onClick={() => { setModal(null); retryMint(modal.data.id); }}>⟳ RETRY MINT</button><button style={{ ...M.aPrimary, background: 'linear-gradient(135deg,#1d4ed8,#1e40af)' }} onClick={() => { setManualTokenId(''); setModal({ type: 'manual_sync', data: modal.data }); }}>✎ SET TOKEN ID</button></>}
        </div>
      </Dlg>}

      {modal?.type === 'credit_approve' && <Dlg title="Approve Credit" onClose={() => { setModal(null); setReason(''); }}><div style={M.ct}>Approve <strong style={{ color: '#f0fdf4' }}>{modal.data.project_name}</strong>?</div><RegistryVerifyPanel creditId={modal.data.id} /><textarea style={M.ta} value={reason} onChange={e => setReason(e.target.value)} placeholder="Optional notes..." /><button style={M.aPrimary} onClick={() => creditAction(modal.data.id, 'approve')}>CONFIRM APPROVE</button></Dlg>}
      {modal?.type === 'credit_reject' && <Dlg title="Reject Credit" onClose={() => { setModal(null); setReason(''); }}><textarea style={M.ta} value={reason} onChange={e => setReason(e.target.value)} placeholder="Rejection reason..." /><button style={M.rPrimary} onClick={() => creditAction(modal.data.id, 'reject')} disabled={!reason.trim()}>CONFIRM REJECT</button></Dlg>}

      {modal?.type === 'manual_sync' && <Dlg title="✎ Set Token ID Manually" onClose={() => { setModal(null); setManualTokenId(''); }}>
        <div style={M.ct}>Use only if mint succeeded on-chain but DB was not updated.</div>
        <input style={M.inp} type="number" min="0" placeholder="e.g. 4" value={manualTokenId} onChange={e => setManualTokenId(e.target.value)} />
        <button style={{ ...M.aPrimary, background: 'linear-gradient(135deg,#1d4ed8,#1e40af)', opacity: syncingId === modal.data.id ? .5 : 1 }} onClick={() => handleManualSync(modal.data.id)} disabled={!manualTokenId || syncingId === modal.data.id}>{syncingId === modal.data.id ? 'SYNCING...' : 'CONFIRM SET TOKEN ID'}</button>
      </Dlg>}

      {modal?.type === 'qty_fix' && <Dlg title="✎ Correct Quantity" onClose={() => { setModal(null); setNewQty(''); setReason(''); }}><div style={M.row}><span style={M.key}>Current</span><span style={M.val}>{modal.data.quantity} tCO₂</span></div><input style={{ ...M.inp, marginTop: 12 }} type="number" min="1" value={newQty} onChange={e => setNewQty(e.target.value)} placeholder="New quantity" /><textarea style={M.ta} value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason..." /><button style={M.aPrimary} onClick={() => handleQtyFix(modal.data.id)} disabled={!newQty || !reason.trim()}>CONFIRM</button></Dlg>}

      {modal?.type === 'assign_mint' && <Dlg title="🔑 Assign Wallet + Mint" onClose={() => { setModal(null); setAssignWallet(''); }}>
        <div style={M.ct}>User <strong style={{ color: '#f0fdf4' }}>{modal.data.full_name}</strong> has no wallet.</div>
        <input style={M.inp} placeholder="0x1234...abcd (42 chars)" value={assignWallet} onChange={e => setAssignWallet(e.target.value)} />
        {assignWallet && !isValidWallet(assignWallet) && <div style={{ fontSize: 9, color: '#f87171', marginBottom: 8 }}>⚠ Invalid wallet format</div>}
        <button style={M.aPrimary} onClick={() => handleAssignAndMint(modal.data.id)} disabled={!isValidWallet(assignWallet) || syncingId === modal.data.id}>{syncingId === modal.data.id ? 'MINTING...' : 'ASSIGN + MINT →'}</button>
      </Dlg>}

      {modal?.type === 'mint_diag' && <Dlg title="🔍 Mint Diagnosis" onClose={() => setModal(null)}>
        {modal.data.diagnostics?.map((d, i) => <div key={i} style={{ padding: '9px 12px', borderRadius: 6, marginBottom: 7, background: d.severity === 'critical' ? '#1a0707' : d.severity === 'warning' ? '#110a00' : '#060a07', border: `1px solid ${d.severity === 'critical' ? '#f87171' : d.severity === 'warning' ? '#f59e0b' : '#22c55e'}33` }}><div style={{ fontSize: 11, color: d.severity === 'critical' ? '#f87171' : d.severity === 'warning' ? '#f59e0b' : '#22c55e', fontWeight: 600, marginBottom: 3 }}>{d.severity === 'critical' ? '🚨' : d.severity === 'warning' ? '⚠' : 'ℹ'} {d.issue}</div><div style={{ fontSize: 10, color: '#86efac88' }}>Fix: {d.fix}</div></div>)}
        {modal.data.mintErrors?.map((e, i) => <div key={i} style={{ padding: '7px 10px', background: '#060a07', border: '1px solid #f8717122', borderRadius: 6, marginBottom: 5, fontSize: 9, color: '#f87171', fontFamily: 'monospace' }}>{e.timestamp}<br />{e.error}</div>)}
      </Dlg>}

      {modal?.type === 'cancel_order_choice' && <Dlg title="Cancel Buy Order" onClose={() => { setModal(null); setReason(''); }}>
        <div style={M.ct}>Force-cancel order from <strong style={{ color: '#f0fdf4' }}>{modal.data.buyer_name}</strong>.</div>
        <div style={M.row}><span style={M.key}>ETH Escrowed</span><span style={{ ...M.val, color: '#f59e0b' }}>{parseFloat(modal.data.eth_escrowed || 0).toFixed(4)} ETH</span></div>
        <textarea style={{ ...M.ta, marginTop: 10 }} value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for cancellation..." />
        <button style={M.rPrimary} onClick={() => handleForceCancelOrder(modal.data.id)} disabled={!reason.trim()}>CONFIRM CANCEL</button>
      </Dlg>}

      {modal?.type === 'correct_retirement' && <Dlg title="✎ Correct Retirement Data" onClose={() => { setModal(null); setReason(''); setRetCorrect({}); }}>
        <div style={M.ct}>Edit metadata for cert <strong style={{ color: '#22c55e' }}>{modal.data.certificate_id?.slice(0, 20)}</strong>.</div>
        {[['retire_scope', 'Scope (1/2/3)'], ['beneficiary_name', 'Beneficiary Name'], ['beneficiary_entity', 'Company / Entity'], ['beneficiary_gstin', 'GSTIN'], ['reporting_standard', 'Reporting Standard'], ['purpose', 'Purpose']].map(([field, label]) => (
          <div key={field} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 9, color: '#f59e0baa', letterSpacing: '.1em', marginBottom: 3 }}>{label.toUpperCase()}</div>
            <input style={{ ...M.inp, marginBottom: 0 }} value={retCorrect[field] || ''} onChange={e => setRetCorrect(p => ({ ...p, [field]: e.target.value }))} placeholder={`Current: ${modal.data[field] || '—'}`} />
          </div>
        ))}
        <div style={{ fontSize: 9, color: '#f59e0baa', marginTop: 10, marginBottom: 4 }}>AUDIT REASON (required)</div>
        <textarea style={M.ta} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. User selected wrong scope" />
        <button style={M.aPrimary} onClick={() => handleRetirementCorrect(modal.data.id)} disabled={!reason.trim()}>CONFIRM CORRECTION</button>
      </Dlg>}

      {modal?.type === 'flag_retirement' && <Dlg title="⚠ Flag Retirement" onClose={() => { setModal(null); setReason(''); }}><div style={M.ct}>Flag <strong style={{ color: '#f0fdf4' }}>{modal.data.certificate_id}</strong>.</div><textarea style={M.ta} value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason..." /><button style={M.rPrimary} onClick={() => handleFlagRetirement(modal.data.id)} disabled={!reason.trim()}>CONFIRM FLAG</button></Dlg>}

      {modal?.type === 'regen_cert' && <Dlg title="📄 Regenerate Certificate" onClose={() => { setModal(null); setReason(''); }}>
        <div style={M.ct}>Regenerate PDF for <strong style={{ color: '#22c55e' }}>{modal.data.certificate_id?.slice(0, 24)}</strong>.</div>
        <textarea style={M.ta} value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason..." />
        <button style={M.aPrimary} onClick={async () => { if (!reason.trim()) { toast_('❌ Reason required', 3000, 'error'); return; } try { const r = await api(`/api/admin/retirements/${modal.data.id}/regenerate-certificate`, { method: 'POST', body: JSON.stringify({ reason: sanitize(reason) }) }); toast_(`✅ New IPFS: ${r?.newIpfsHash?.slice(0, 12)}...`, 6000, 'success'); setModal(null); setReason(''); loadRetirements(); } catch (e) { toast_(`❌ ${e.message}`, 5000, 'error'); } }} disabled={!reason.trim()}>📄 REGENERATE CERTIFICATE</button>
      </Dlg>}

      {modal?.type === 'reconcile_trade' && <Dlg title="🔁 Reconcile Trade" onClose={() => { setModal(null); setReason(''); }} wide>
        <div style={M.ct}>Manually assign credits to buyer for trade <strong style={{ color: '#60a5fa' }}>#{modal.data.id}</strong>.</div>
        {[['Buyer', modal.data.buyer_name || modal.data.buyer_email], ['Seller', modal.data.seller_name || modal.data.seller_email], ['Quantity', `${modal.data.quantity} tCO₂`], ['Total', `₹${parseFloat(modal.data.subtotal_inr || 0).toLocaleString('en-IN')}`]].map(([k, v]) => <div key={k} style={M.row}><span style={M.key}>{k}</span><span style={M.val}>{v}</span></div>)}
        <textarea style={{ ...M.ta, marginTop: 10 }} value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason..." />
        <button style={M.aPrimary} onClick={() => handleReconcile(modal.data.id)} disabled={!reason.trim()}>✅ CONFIRM RECONCILE</button>
      </Dlg>}

      {modal?.type === 'user_detail' && <Dlg title="User Details" onClose={() => setModal(null)} wide>
        {[['Name', modal.data.full_name || '—'], ['Email', modal.data.email], ['Wallet', modal.data.wallet_address || 'Not connected'], ['KYC Status', modal.data.kyc_status || 'pending'], ['Account Status', modal.data.frozen ? `🔒 FROZEN` : '✅ Active'], ['Joined', fmt(modal.data.created_at)]].map(([k, v]) => <div key={k} style={M.row}><span style={M.key}>{k}</span><span style={M.val}>{v}</span></div>)}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          {!modal.data.frozen ? <button style={M.rPrimary} onClick={() => setModal({ type: 'freeze', data: modal.data })}>🔒 FREEZE</button> : <button style={M.aPrimary} onClick={() => setModal({ type: 'unfreeze', data: modal.data })}>🔓 UNFREEZE</button>}
          <button style={{ ...M.aPrimary, background: 'linear-gradient(135deg,#1d4ed8,#1e40af)' }} onClick={() => { setNewWallet(''); setReason(''); setModal({ type: 'reassign_wallet', data: modal.data }); }}>🔑 WALLET</button>
          <button style={{ ...M.aPrimary, background: 'linear-gradient(135deg,#a16207,#854d0e)' }} onClick={() => { setReason(''); setModal({ type: 'rekyc', data: modal.data }); }}>↻ RE-KYC</button>
          <button style={{ ...M.aPrimary, background: 'linear-gradient(135deg,#1e3a5f,#1d4ed8)' }} onClick={() => { setMsgSubject(''); setMsgBody(''); setModal({ type: 'send_msg', data: modal.data }); }}>📧 MESSAGE</button>
          <button style={{ ...M.rPrimary, background: 'linear-gradient(135deg,#7c2d12,#991b1b)' }} onClick={() => { setReason(''); setModal({ type: 'delete_user', data: modal.data }); }}>🗑 DELETE</button>
        </div>
      </Dlg>}

      {modal?.type === 'user_history' && <Dlg title={`History — ${modal.data.full_name}`} onClose={() => setModal(null)} wide>
        {userDataLoading ? <div style={{ padding: 20, textAlign: 'center', color: '#f59e0baa' }}>Loading...</div> : <>
          <div style={{ fontSize: 9, color: '#22c55e88', letterSpacing: '.14em', marginBottom: 6 }}>CREDITS ({userCredits.length})</div>
          {userCredits.length === 0 ? <div style={{ fontSize: 10, color: '#f59e0b44', marginBottom: 12 }}>No credits</div> : userCredits.map(c => <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 6, padding: '6px 0', borderBottom: '1px solid #f59e0b08', alignItems: 'center' }}><div style={{ fontSize: 11, color: '#f0fdf4' }}>{c.project_name}</div><div style={{ fontSize: 11, color: '#22c55e' }}>{c.quantity}t</div><div style={{ fontSize: 9, color: '#f59e0bbb' }}>{c.vintage_year}</div><div>{c.token_id != null ? <span style={{ fontSize: 9, color: '#22c55e' }}>⛓#{c.token_id}</span> : <span style={{ fontSize: 9, color: '#f8717188' }}>⏳</span>}</div><StatusBadge status={c.admin_status} /></div>)}
          <div style={{ fontSize: 9, color: '#60a5fa88', letterSpacing: '.14em', margin: '12px 0 6px' }}>TRADES ({userTrades.length})</div>
          {userTrades.length === 0 ? <div style={{ fontSize: 10, color: '#f59e0b44', marginBottom: 12 }}>No trades</div> : userTrades.slice(0, 20).map(t => <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 6, padding: '6px 0', borderBottom: '1px solid #f59e0b08', alignItems: 'center' }}><div style={{ fontSize: 10, color: '#f0fdf4' }}>{t.project_name || '—'}</div><div style={{ fontSize: 10, color: t.buyer_id === modal.data.id ? '#22c55e' : '#f87171' }}>{t.buyer_id === modal.data.id ? 'BOUGHT' : 'SOLD'}</div><div style={{ fontSize: 11 }}>{t.quantity}t</div><div style={{ fontSize: 10, color: '#22c55e' }}>₹{parseFloat(t.subtotal_inr || 0).toLocaleString('en-IN')}</div><div style={{ fontSize: 9, color: '#f59e0baa' }}>{fmt(t.created_at)}</div></div>)}
        </>}
      </Dlg>}

      {modal?.type === 'send_msg' && <Dlg title={`📧 Message — ${modal.data.full_name}`} onClose={() => { setModal(null); setMsgSubject(''); setMsgBody(''); }}>
        <input style={M.inp} placeholder="Subject" value={msgSubject} onChange={e => setMsgSubject(e.target.value)} maxLength={200} />
        <textarea style={{ ...M.ta, minHeight: 90 }} value={msgBody} onChange={e => setMsgBody(e.target.value)} placeholder="Message..." maxLength={2000} />
        <button style={M.aPrimary} onClick={() => handleSendMsg(modal.data.id)} disabled={!msgSubject.trim() || !msgBody.trim()}>SEND →</button>
      </Dlg>}

      {modal?.type === 'reassign_wallet' && <Dlg title="🔑 Reassign Wallet" onClose={() => { setModal(null); setNewWallet(''); setReason(''); }}>
        <div style={M.ct}>Current: <span style={{ color: '#f87171aa', fontSize: 10 }}>{modal.data.wallet_address || 'None'}</span></div>
        <input style={M.inp} placeholder="New wallet (0x... 42 chars)" value={newWallet} onChange={e => setNewWallet(e.target.value)} />
        {newWallet && !isValidWallet(newWallet) && <div style={{ fontSize: 9, color: '#f87171', marginBottom: 8 }}>⚠ Invalid wallet format</div>}
        <textarea style={M.ta} value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason..." />
        <button style={{ ...M.aPrimary, background: 'linear-gradient(135deg,#1d4ed8,#1e40af)' }} onClick={() => handleWalletReassign(modal.data.id)} disabled={!isValidWallet(newWallet) || !reason.trim()}>CONFIRM REASSIGN</button>
      </Dlg>}

      {modal?.type === 'rekyc' && <Dlg title="↻ Require Re-KYC" onClose={() => { setModal(null); setReason(''); }}><div style={M.ct}>Invalidate KYC for <strong style={{ color: '#f0fdf4' }}>{modal.data.full_name}</strong>.</div><textarea style={M.ta} value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason..." /><button style={M.rPrimary} onClick={() => handleRekyc(modal.data.id)} disabled={!reason.trim()}>CONFIRM RE-KYC</button></Dlg>}

      {modal?.type === 'delete_user' && <Dlg title="🗑 Delete User" onClose={() => { setModal(null); setReason(''); }}>
        <div style={{ padding: '9px 12px', background: '#1a0707', border: '1px solid #f8717133', borderRadius: 6, marginBottom: 10, fontSize: 10, color: '#f87171', lineHeight: 1.6 }}>⛔ Irreversible. On-chain tokens remain.</div>
        <textarea style={M.ta} value={reason} onChange={e => setReason(e.target.value)} placeholder="Deletion reason (required)..." />
        <ConfirmBar message={`Permanently delete ${modal.data.email}?`} onConfirm={() => handleDeleteUser(modal.data.id)} onCancel={() => setModal(null)} />
      </Dlg>}

      {modal?.type === 'freeze' && <Dlg title="Freeze Account" onClose={() => { setModal(null); setReason(''); }}><div style={M.ct}>Freeze <strong style={{ color: '#f87171' }}>{modal.data.email}</strong>?</div><textarea style={M.ta} value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason..." /><button style={M.rPrimary} onClick={() => freezeAction(modal.data.id, 'freeze')} disabled={!reason.trim()}>CONFIRM FREEZE</button></Dlg>}
      {modal?.type === 'unfreeze' && <Dlg title="Unfreeze Account" onClose={() => { setModal(null); setReason(''); }}><div style={M.ct}>Unfreeze <strong style={{ color: '#22c55e' }}>{modal.data.email}</strong>?</div><button style={M.aPrimary} onClick={() => freezeAction(modal.data.id, 'unfreeze')}>CONFIRM UNFREEZE</button></Dlg>}
      {modal?.type === 'force_delist' && <Dlg title="Force Delist" onClose={() => { setModal(null); setReason(''); }}><div style={M.ct}>Delist from <strong style={{ color: '#f0fdf4' }}>{modal.data.seller_name || modal.data.seller_email}</strong>?</div><textarea style={M.ta} value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason..." /><button style={M.rPrimary} onClick={() => handleForceDelist(modal.data.listing_id || modal.data.batch_id)} disabled={!reason.trim()}>CONFIRM DELIST</button></Dlg>}
      {modal?.type === 'price_override' && <Dlg title="₹ Override Price" onClose={() => { setModal(null); setPriceOverride(''); setReason(''); }}><div style={M.ct}>Override price for <strong style={{ color: '#f0fdf4' }}>{modal.data.project_name}</strong></div><input style={M.inp} type="number" min="1" placeholder="New price ₹" value={priceOverride} onChange={e => setPriceOverride(e.target.value)} /><textarea style={M.ta} value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason..." /><button style={M.aPrimary} onClick={() => handlePriceOverride(modal.data.listing_id || modal.data.batch_id)} disabled={!priceOverride || !reason.trim()}>CONFIRM</button></Dlg>}

      {modal?.type === 'new_dispute' && <Dlg title="Open Dispute" onClose={() => { setModal(null); setReason(''); }}>
        <input style={M.inp} placeholder="Target user ID..." onChange={e => setModal(m => ({ ...m, targetId: e.target.value }))} />
        <textarea style={M.ta} value={reason} onChange={e => setReason(e.target.value)} placeholder="Dispute reason..." />
        <button style={M.aPrimary} onClick={async () => { try { await api('/api/admin/disputes', { method: 'POST', body: JSON.stringify({ targetUserId: modal.targetId, reason: sanitize(reason), notes: '' }) }); toast_('✅ Dispute opened', 3000, 'success'); setModal(null); setReason(''); loadDisputes(); } catch (e) { toast_(`❌ ${e.message}`, 4000, 'error'); } }} disabled={!reason.trim()}>OPEN DISPUTE</button>
      </Dlg>}

      {modal?.type === 'resolve_dispute' && <Dlg title="Resolve Dispute" onClose={() => { setModal(null); setReason(''); }}><div style={M.ct}>{modal.data.reason}</div><textarea style={M.ta} value={reason} onChange={e => setReason(e.target.value)} placeholder="Resolution notes..." /><button style={M.aPrimary} onClick={() => resolveDispute(modal.data.id)} disabled={!reason.trim()}>MARK RESOLVED</button></Dlg>}

      {modal?.type === 'flag_review' && <Dlg title={modal.action === 'cleared' ? '✅ Clear Flag' : '🚨 Escalate Flag'} onClose={() => { setModal(null); setReason(''); }}>
        <div style={M.ct}>{modal.action === 'cleared' ? 'Clear' : 'Escalate'} flag for <strong style={{ color: '#f0fdf4' }}>{modal.data.email}</strong>?</div>
        <textarea style={M.ta} value={reason} onChange={e => setReason(e.target.value)} placeholder={modal.action === 'cleared' ? 'Why cleared?' : 'Escalation reason...'} />
        <button style={modal.action === 'cleared' ? M.aPrimary : M.rPrimary} onClick={() => reviewFlag(modal.data.id, modal.action, reason)} disabled={!reason.trim()}>CONFIRM {modal.action.toUpperCase()}</button>
      </Dlg>}

      {modal?.type === 'flag_detail' && <Dlg title="Flag Details" onClose={() => setModal(null)}>
        {[['User', modal.data.email], ['Type', modal.data.flag_type], ['Amount', modal.data.amount ? `₹${parseFloat(modal.data.amount).toLocaleString('en-IN')}` : '—'], ['Severity', modal.data.severity], ['Status', modal.data.status], ['Description', modal.data.description], ['Review Notes', modal.data.review_notes || '—']].map(([k, v]) => <div key={k} style={M.row}><span style={M.key}>{k}</span><span style={{ ...M.val, maxWidth: 280 }}>{v || '—'}</span></div>)}
      </Dlg>}

      {/* ── Global confirm modal — replaces all window.confirm() calls ── */}
      {confirm && (
        <ConfirmModal
          message={confirm.message}
          detail={confirm.detail}
          confirmLabel={confirm.confirmLabel}
          danger={confirm.danger !== false}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {modal?.type === 'support_ticket_detail' && (
        <Dlg title={modal.data.ticket_number} onClose={() => setModal(null)} wide>
          {[['From', `${modal.data.name} (${modal.data.email})`], ['Subject', modal.data.subject || '—'], ['Page', modal.data.page || 'unknown'], ['Submitted', fmtT(modal.data.created_at)], ['Status', modal.data.status]].map(([k, v]) => <div key={k} style={M.row}><span style={M.key}>{k}</span><span style={M.val}>{v}</span></div>)}
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 9, color: '#f59e0bcc', letterSpacing: '.1em', marginBottom: 6 }}>MESSAGE</div>
            <div style={{ background: '#0a0800', border: '1px solid #f59e0b22', borderRadius: 6, padding: 12, fontSize: 11, color: '#f0fdf4', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{modal.data.message}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            {['open', 'in_progress', 'resolved', 'closed'].map(s => (
              <button key={s} style={{ padding: '7px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: "'DM Mono',monospace", fontSize: 10, fontWeight: 700, border: `1px solid ${modal.data.status === s ? '#f59e0b' : '#f59e0b33'}`, background: modal.data.status === s ? '#f59e0b' : 'transparent', color: modal.data.status === s ? '#0a0800' : '#f59e0bcc' }} onClick={() => { updateTicketStatus(modal.data.id, s); setModal(null); }}>{s.replace('_', ' ').toUpperCase()}</button>
            ))}
          </div>
        </Dlg>
      )}

    </div>
  );
}

// ── Style tokens ──────────────────────────────────────────────────────────────
// 8pt grid: 8 / 12 / 16 / 24 / 32
// Color roles:
//   amber  #f59e0b — chrome, navigation, primary labels
//   green  #22c55e — success, approve, positive values
//   red    #f87171 — danger, reject, negative values
//   blue   #60a5fa — info, links, chain references
//   base   #0a0800 — deepest background
const S = {
  page:       { display: 'flex', minHeight: '100vh', background: '#0a0800', fontFamily: "'DM Mono',monospace", color: '#f0fdf4' },
  sidebar:    { width: 196, background: '#0c0900', borderRight: '1px solid #f59e0b0d', display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' },
  sideTop:    { padding: '16px 14px 12px', borderBottom: '1px solid #f59e0b0d' },
  logo:       { fontSize: 11, fontWeight: 700, color: '#f59e0b', letterSpacing: '.14em' },
  logoSub:    { fontSize: 7, color: '#f59e0b77', letterSpacing: '.22em', marginTop: 3 },
  sideFooter: { padding: '12px 14px', borderTop: '1px solid #f59e0b0d' },
  logoutBtn:  { width: '100%', padding: '8px', borderRadius: 6, border: '1px solid #f59e0b1a', background: 'transparent', color: '#f87171cc', cursor: 'pointer', fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: '.08em' },

  // Nav
  groupBtn:   { width: '100%', padding: '8px 14px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontFamily: "'DM Mono',monospace" },
  navBtn:     { width: '100%', padding: '7px 14px 7px 28px', background: 'transparent', border: 'none', borderLeft: '2px solid transparent', color: '#f59e0b99', cursor: 'pointer', fontFamily: "'DM Mono',monospace", fontSize: 10, textAlign: 'left', letterSpacing: '.03em', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  navActive:  { borderLeft: '2px solid #f59e0b', color: '#f59e0b', background: '#f59e0b0d' },
  badge:      { background: '#f59e0b', color: '#0a0800', fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 10, minWidth: 14, textAlign: 'center', flexShrink: 0 },

  // Content
  main:       { flex: 1, padding: 0, display: 'flex', flexDirection: 'column', minWidth: 0, overflowY: 'auto' },
  topBar:     { padding: '12px 24px', borderBottom: '1px solid #f59e0b0d', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', position: 'sticky', top: 0, zIndex: 10, background: '#0a0800bb', backdropFilter: 'blur(8px)' },
  statsGrid:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 10, padding: '24px 24px 0' },
  statCard:   { background: '#0d0900', border: '1px solid #f59e0b22', borderRadius: 10, padding: '14px 10px', textAlign: 'center' },
  card:       { background: '#0d0900', border: '1px solid #f59e0b1a', borderRadius: 10, padding: '16px' },

  // Toolbar (filter row + search above tables)
  toolbar:    { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '16px 24px 12px', borderBottom: '1px solid #f59e0b08' },
  input:      { padding: '7px 11px', borderRadius: 6, border: '1px solid #f59e0b1a', background: '#0a0800', color: '#f0fdf4', fontFamily: "'DM Mono',monospace", fontSize: 11, outline: 'none' },
  filterBtn:  { padding: '5px 10px', borderRadius: 6, border: '1px solid #f59e0b1a', background: 'transparent', color: '#f59e0bcc', cursor: 'pointer', fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: '.06em' },
  filterActive:{ borderColor: '#f59e0b', color: '#f59e0b', background: '#f59e0b0d' },
  quickBtn:   { padding: '7px 12px', borderRadius: 6, border: '1px solid #f59e0b44', background: 'transparent', color: '#f59e0bdd', cursor: 'pointer', fontFamily: "'DM Mono',monospace", fontSize: 10 },

  // Tables
  table:      { background: '#0d0900', borderTop: '1px solid #f59e0b0d', overflowX: 'auto' },
  thead:      { display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', background: '#0a0800', padding: '8px 24px', borderBottom: '1px solid #f59e0b0d' },
  trow:       { display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', padding: '9px 24px', borderBottom: '1px solid #f59e0b06', alignItems: 'center' },
  th:         { fontSize: 8, color: '#f59e0b77', letterSpacing: '.1em' },
  td:         { fontSize: 11 },
  loading:    { padding: 40, textAlign: 'center', color: '#f59e0baa', fontSize: 11 },
  empty:      { padding: 40, textAlign: 'center', color: '#f59e0b77', fontSize: 11 },

  // Row action buttons — unified size/padding/font
  actView:    { padding: '3px 8px', borderRadius: 4, border: '1px solid #f59e0b22', background: 'transparent', color: '#f59e0bcc', cursor: 'pointer', fontFamily: "'DM Mono',monospace", fontSize: 9, whiteSpace: 'nowrap' },
  actApprove: { padding: '3px 8px', borderRadius: 4, border: '1px solid #22c55e33', background: '#22c55e0d', color: '#22c55e', cursor: 'pointer', fontFamily: "'DM Mono',monospace", fontSize: 9, whiteSpace: 'nowrap' },
  actReject:  { padding: '3px 8px', borderRadius: 4, border: '1px solid #f8717133', background: '#f871710d', color: '#f87171', cursor: 'pointer', fontFamily: "'DM Mono',monospace", fontSize: 9, whiteSpace: 'nowrap' },

  // MoreMenu
  moreMenu:     { position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#0d0900', border: '1px solid #f59e0b22', borderRadius: 7, padding: 4, zIndex: 50, minWidth: 152, boxShadow: '0 8px 24px rgba(0,0,0,.6)' },
  moreMenuItem: { display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', borderRadius: 5, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: "'DM Mono',monospace", fontSize: 10, whiteSpace: 'nowrap' },

  // Toast
  toast: { position: 'fixed', bottom: 24, right: 24, background: '#1a1200', border: '1px solid #f59e0b33', color: '#f59e0b', padding: '12px 20px', borderRadius: 8, fontSize: 12, zIndex: 9999, fontFamily: "'DM Mono',monospace", maxWidth: 360 },
};

// Modal styles
const M = {
  ov:       { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 },
  bx:       { background: '#0d0900', border: '1px solid #f59e0b1a', borderRadius: 12, padding: '24px', maxWidth: 520, width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', fontFamily: "'DM Mono',monospace" },
  tt:       { fontSize: 13, fontWeight: 700, color: '#f59e0b', marginBottom: 16, letterSpacing: '.08em' },
  row:      { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f59e0b06' },
  key:      { fontSize: 10, color: '#f59e0bcc', letterSpacing: '.1em' },
  val:      { fontSize: 11, color: '#f0fdf4', maxWidth: 280, textAlign: 'right', wordBreak: 'break-all' },
  ct:       { fontSize: 11, color: '#f59e0bdd', lineHeight: 1.7, marginBottom: 12 },
  ta:       { width: '100%', minHeight: 70, padding: '9px 11px', borderRadius: 6, border: '1px solid #f59e0b1a', background: '#0a0800', color: '#f0fdf4', fontFamily: "'DM Mono',monospace", fontSize: 11, outline: 'none', resize: 'vertical', marginBottom: 10 },
  inp:      { width: '100%', padding: '9px 11px', borderRadius: 6, border: '1px solid #f59e0b1a', background: '#0a0800', color: '#f0fdf4', fontFamily: "'DM Mono',monospace", fontSize: 11, outline: 'none', marginBottom: 10 },
  aPrimary: { padding: '9px 18px', borderRadius: 6, border: 'none', background: 'linear-gradient(135deg,#16a34a,#15803d)', color: '#fff', cursor: 'pointer', fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 700, letterSpacing: '.08em' },
  rPrimary: { padding: '9px 18px', borderRadius: 6, border: 'none', background: 'linear-gradient(135deg,#dc2626,#b91c1c)', color: '#fff', cursor: 'pointer', fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 700, letterSpacing: '.08em' },
  cl:       { marginTop: 12, padding: '6px 14px', borderRadius: 6, border: '1px solid #f59e0b1a', background: 'transparent', color: '#f59e0bcc', cursor: 'pointer', fontFamily: "'DM Mono',monospace", fontSize: 10, alignSelf: 'flex-start' },
};