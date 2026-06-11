// src/components/Wallet.jsx — EtherTrack (10/10 PRODUCTION-HARDENED) - 28/05/2026

import React, {
  useState, useEffect, useCallback, useContext, useRef, useMemo,
  Component, createRef,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { walletAPI, subscriptionAPI } from '../services/api';
import { AuthContext } from '../App';
import { useNotifications } from '../context/NotificationContext';

// ── Constants ────────────────────────────────────────────────────────────────
const ETH_INR_FALLBACK    = 280000;
const TDS_THRESHOLD       = 10000;
const TDS_RATE            = 0.01;
const TX_PAGE_SIZE        = 25;
const IFSC_REGEX          = /^[A-Z]{4}0[A-Z0-9]{6}$/;

// ── Utilities ────────────────────────────────────────────────────────────────
const fmtINR  = n =>
  `₹${parseFloat(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

const fmtDate = d =>
  d ? new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) : '—';

const daysUntil = d => {
  if (!d) return null;
  return Math.ceil((new Date(d) - new Date()) / 86400000);
};

// Mask wallet/account for safe logging
const maskSensitive = str =>
  typeof str === 'string' && str.length > 8
    ? str.slice(0, 4) + '****' + str.slice(-4)
    : '****';

// ── Razorpay loader ───────────────────────────────────────────────────────────
const loadRazorpay = () => new Promise(resolve => {
  if (window.Razorpay) return resolve(true);
  const s = document.createElement('script');
  s.src = 'https://checkout.razorpay.com/v1/checkout.js';
  // SRI hash not pinnable (dynamic CDN) — document this in your CSP
  s.onload = () => resolve(true);
  s.onerror = () => resolve(false);
  document.body.appendChild(s);
});

// ── Plan metadata ─────────────────────────────────────────────────────────────
const PLAN_META = {
  free:       { label: 'Free',       price: 0,     color: '#86efac', border: '#22c55e22' },
  starter:    { label: 'Starter',    price: 1999,  color: '#60a5fa', border: '#60a5fa22' },
  growth:     { label: 'Growth',     price: 5999,  color: '#22c55e', border: '#22c55e44' },
  corporate:  { label: 'Corporate',  price: 18999, color: '#f97316', border: '#f9731633' },
  enterprise: { label: 'Enterprise', price: null,  color: '#a78bfa', border: '#a78bfa33' },
};

// ── Focus trap utility ────────────────────────────────────────────────────────
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function useFocusTrap(containerRef, active) {
  useEffect(() => {
    if (!active || !containerRef.current) return;
    const el     = containerRef.current;
    const nodes  = Array.from(el.querySelectorAll(FOCUSABLE));
    if (nodes.length) nodes[0].focus();
    const handler = e => {
      if (e.key !== 'Tab') return;
      const first = nodes[0];
      const last  = nodes[nodes.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
      }
    };
    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }, [active, containerRef]);
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ data, color = '#22c55e', w = 80, h = 28 }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`)
    .join(' ');
  return (
    <svg width={w} height={h} aria-hidden="true">
      <polyline fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" points={pts} opacity="0.8" />
    </svg>
  );
}

// ── TDS Breakdown ─────────────────────────────────────────────────────────────
function TDSBreakdown({ amount }) {
  if (!amount || amount <= TDS_THRESHOLD) return null;
  const tds = Math.round(amount * TDS_RATE);
  const net = amount - tds;
  return (
    <div style={s.tdsBox} role="region" aria-label="TDS breakdown">
      <div style={s.tdsTitle}>TAX DEDUCTION BREAKDOWN</div>
      {[
        { label: 'Withdrawal amount',       value: fmtINR(amount), color: '#f0fdf4' },
        { label: 'TDS deducted (1% · Sec 194S)', value: `-${fmtINR(tds)}`, color: '#f87171' },
        { label: 'Amount you receive',      value: fmtINR(net),    color: '#22c55e' },
      ].map(({ label, value, color }) => (
        <div key={label} style={s.tdsRow}>
          <span style={s.tdsKey}>{label}</span>
          <span style={{ ...s.tdsVal, color }}>{value}</span>
        </div>
      ))}
      <div style={s.tdsNote}>
        TDS certificate will be issued. Claim credit in your ITR under Section 194S.
      </div>
    </div>
  );
}

// ── [A-FIX-11] Error Boundary with Sentry support ────────────────────────────
class WalletErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error, info) {
    // [A-FIX-12] Never log raw wallet addresses or account numbers
    console.error('[EtherTrack] Wallet crash:', error?.message, info?.componentStack?.slice(0, 200));
    // Wire to Sentry if available
    if (typeof window !== 'undefined' && window.Sentry?.captureException) {
      window.Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
    }
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={s.errWrap}>
        <div style={s.errBox}>
          <div style={s.errIcon}>⚠️</div>
          <div style={s.errTitle}>Wallet failed to load</div>
          <div style={s.errSub}>Your funds are safe — this is a display issue only.</div>
          <button
            style={s.errBtn}
            onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
          >
            RELOAD WALLET
          </button>
        </div>
      </div>
    );
  }
}

// ── [A-FIX-5] Renewal box — isolated component with early return ──────────────
function RenewalBox({
  renewPrice, planMeta, subCycle, setSubCycle,
  subPayMethod, setSubPayMethod, subPaying, subErr,
  canWalletPay, balance, dbUser, openModal,
  handleSubWalletPay, handleSubRazorpayPay, handleSubMetaMaskPay,
}) {
  // Early return — no flash, no conditional hooks
  if (!renewPrice || renewPrice <= 0) return (
    <div style={s.subFree}>
      You're on the <strong style={{ color: '#86efac88' }}>Free plan</strong> — no renewal needed.{' '}
      <span style={s.subFreeLink}>Upgrade from Billing →</span>
    </div>
  );

  return (
    <div style={s.subRenewBox}>
      <div style={s.subRenewTitle}>RENEW SUBSCRIPTION</div>

      {/* Billing cycle toggle */}
      <div style={s.cycleRow} role="group" aria-label="Billing cycle">
        {[['monthly', 'MONTHLY'], ['annual', 'ANNUAL · SAVE 17%']].map(([val, label]) => (
          <button
            key={val}
            role="radio"
            aria-checked={subCycle === val}
            style={{ ...s.cycleBtn, ...(subCycle === val ? s.cycleBtnOn : {}) }}
            onClick={() => setSubCycle(val)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Amount display */}
      <div style={s.subAmtRow} aria-label={`Price: ₹${renewPrice.toLocaleString('en-IN')} per ${subCycle === 'annual' ? 'year' : 'month'} plus 18% GST`}>
        <span style={{ ...s.subAmtBig, color: planMeta.color }}>
          ₹{renewPrice.toLocaleString('en-IN')}
        </span>
        <span style={s.subAmtPeriod}>/ {subCycle === 'annual' ? 'year' : 'month'}</span>
        <span style={s.subAmtGst}>+ 18% GST</span>
      </div>

      {/* Payment method selector */}
      <div style={s.subMethods} role="radiogroup" aria-label="Payment method">
        {[
          {
            id: 'wallet', icon: '💰', name: 'INR Wallet',
            desc: 'Instant · Deducted server-side',
            badgeOk: canWalletPay,
            badge: canWalletPay ? 'SUFFICIENT' : 'LOW BALANCE',
          },
          {
            id: 'razorpay', icon: '💳', name: 'Card / UPI / NetBanking',
            desc: 'Powered by Razorpay',
            badgeOk: true, badge: 'SECURE',
          },
          {
            id: 'metamask', icon: '🦊', name: 'MetaMask',
            desc: 'Sign with connected wallet',
            badgeOk: !!dbUser?.wallet_address,
            badge: dbUser?.wallet_address
              ? maskSensitive(dbUser.wallet_address)
              : 'NOT BOUND',
          },
        ].map(m => (
          <div
            key={m.id}
            role="radio"
            aria-checked={subPayMethod === m.id}
            tabIndex={0}
            style={{ ...s.subMethod, ...(subPayMethod === m.id ? s.subMethodSel : {}) }}
            onClick={() => setSubPayMethod(m.id)}
            onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setSubPayMethod(m.id)}
          >
            <span style={s.subMethodIcon} aria-hidden="true">{m.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={s.subMethodName}>{m.name}</div>
              <div style={s.subMethodDesc}>{m.desc}</div>
            </div>
            <span style={{ ...s.subBadge, ...(m.badgeOk ? s.subBadgeOk : s.subBadgeWarn) }}>
              {m.badge}
            </span>
          </div>
        ))}
      </div>

      {subPayMethod === 'wallet' && (
        <div style={s.subWalletHint}>
          <span>Wallet balance</span>
          <strong style={{ color: '#22c55e' }}>{fmtINR(balance)}</strong>
        </div>
      )}
      {subPayMethod === 'wallet' && !canWalletPay && (
        <div style={s.subInsuf} role="alert">
          ⚠ Insufficient balance.{' '}
          <span
            style={{ cursor: 'pointer', textDecoration: 'underline', color: '#22c55e' }}
            onClick={() => openModal('deposit')}
            role="button"
            tabIndex={0}
            onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && openModal('deposit')}
          >
            Deposit funds →
          </span>
        </div>
      )}

      {subErr && <div style={s.subErr} role="alert">⚠ {subErr}</div>}

      <button
        style={{
          ...s.subPayBtn,
          background: subPaying ? '#0a1a0e' : `linear-gradient(135deg,${planMeta.color}44,${planMeta.color}22)`,
          color: planMeta.color,
          border: `1px solid ${planMeta.border}`,
        }}
        disabled={
          subPaying
          || (subPayMethod === 'wallet'   && !canWalletPay)
          || (subPayMethod === 'metamask' && !dbUser?.wallet_address)
        }
        aria-busy={subPaying}
        onClick={() => {
          if (subPayMethod === 'wallet')    handleSubWalletPay();
          else if (subPayMethod === 'razorpay') handleSubRazorpayPay();
          else handleSubMetaMaskPay();
        }}
      >
        {subPaying
          ? '⟳ PROCESSING…'
          : `RENEW ${planMeta.label.toUpperCase()} — ${
              subPayMethod === 'wallet' ? 'FROM WALLET'
              : subPayMethod === 'metamask' ? 'VIA METAMASK'
              : 'VIA RAZORPAY'
            } →`}
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// WalletInner
// ════════════════════════════════════════════════════════════════════════════
function WalletInner() {
  const navigate             = useNavigate();
  const { dbUser, setDbUser } = useContext(AuthContext);
  const { addNotification }  = useNotifications();
  const toastTimer           = useRef(null);

  // ── Core state ────────────────────────────────────────────────────────────
  const [tab,           setTab]           = useState('transactions');
  const [balance,       setBalance]       = useState(0);
  const [balanceLocked, setBalanceLocked] = useState(0);
  const [transactions,  setTransactions]  = useState([]);
  const [txCursor,      setTxCursor]      = useState(null);   // [A-FIX-10]
  const [txHasMore,     setTxHasMore]     = useState(false);
  const [txLoadingMore, setTxLoadingMore] = useState(false);
  const [txFilter,      setTxFilter]      = useState('all');
  const [loading,       setLoading]       = useState(true);
  const [ethRate,       setEthRate]       = useState(ETH_INR_FALLBACK);
  const [ethRateLive,   setEthRateLive]   = useState(false);

  // ── Modal state ───────────────────────────────────────────────────────────
  const [modal,         setModal]         = useState(null);
  const [modalStep,     setModalStep]     = useState('amount');
  const [modalAmount,   setModalAmount]   = useState(0);      // [A-FIX-6] number
  const [modalMethod,   setModalMethod]   = useState('upi');
  const [modalErr,      setModalErr]      = useState('');
  const [modalDone,     setModalDone]     = useState(null);
  const [modalLoading,  setModalLoading]  = useState(false);
  const modalRef = useRef(null);

  // [A-FIX-2] Focus trap
  useFocusTrap(modalRef, !!modal);

  // ── Bank state ────────────────────────────────────────────────────────────
  const [bankAccounts,  setBankAccounts]  = useState([]);
  const [bankLoading,   setBankLoading]   = useState(false);
  const [showAddBank,   setShowAddBank]   = useState(false);
  const [bankForm,      setBankForm]      = useState({ name: '', account: '', ifsc: '', bank: '' });
  const [bankErr,       setBankErr]       = useState({});
  const [wdAccount,     setWdAccount]     = useState('');
  const [wdIfsc,        setWdIfsc]        = useState('');
  const [wdName,        setWdName]        = useState('');
  const [withdrawLimits,setWithdrawLimits]= useState(null);

  // ── Subscription state ────────────────────────────────────────────────────
  const [subPaying,     setSubPaying]     = useState(false);
  const [subPayMethod,  setSubPayMethod]  = useState('wallet');
  const [subCycle,      setSubCycle]      = useState('monthly');
  const [subErr,        setSubErr]        = useState('');

  // ── UI state ──────────────────────────────────────────────────────────────
  const [toast,         setToast]         = useState(null);
  const [convInr,       setConvInr]       = useState('');
  const [convDir,       setConvDir]       = useState('inr2eth');
  const [stmtLoading,   setStmtLoading]   = useState(false);

  // ── Derived ───────────────────────────────────────────────────────────────
  const currentPlanKey = dbUser?.subscription_plan || 'free';
  const renewalDate    = dbUser?.subscription_renewal_date || null;
  const daysLeft       = daysUntil(renewalDate);
  const planMeta       = PLAN_META[currentPlanKey] || PLAN_META.free;

  // [FIX-3] Price computed for display only — NOT sent to backend
  const renewPrice = subCycle === 'annual' && planMeta.price
    ? Math.round(planMeta.price * 12 * 0.83)
    : planMeta.price;

  const canWalletPay   = balance >= (renewPrice || 0) && (renewPrice || 0) > 0;

  // [A-FIX-6] amtVal is always a number now
  const amtVal = modalAmount;
  const wdTDS  = amtVal > TDS_THRESHOLD ? Math.round(amtVal * TDS_RATE) : 0;
  const wdNet  = amtVal - wdTDS;

  const convResult = convDir === 'inr2eth'
    ? `${((parseFloat(convInr) || 0) / ethRate).toFixed(6)} ETH`
    : `₹${((parseFloat(convInr) || 0) * ethRate).toLocaleString('en-IN')}`;

  // ── Toast ─────────────────────────────────────────────────────────────────
  // [A-FIX-3] Type drives ARIA role
  const showToast = useCallback((msg, type = 'success') => {
    clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // ── Fetch data ────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [balData, bankData] = await Promise.all([
        walletAPI.getBalance(),
        walletAPI.getBankAccounts(),
      ]);
      if (balData) {
        setBalance(parseFloat(balData.balance) || 0);
        setBalanceLocked(parseFloat(balData.balanceLocked) || 0);
      }
      // [A-FIX-10] Paginated transaction fetch
      const txData = await walletAPI.getTransactions({ limit: TX_PAGE_SIZE });
      if (txData?.transactions) {
        setTransactions(txData.transactions);
        setTxCursor(txData.nextCursor || null);
        setTxHasMore(!!txData.nextCursor);
      }
      if (bankData?.accounts) setBankAccounts(bankData.accounts);
    } catch (err) {
      // [A-FIX-12] Never log account details
      console.error('[EtherTrack] fetchData error:', err?.message);
      showToast('Failed to load wallet data', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  // [A-FIX-10] Load more transactions
  const loadMoreTransactions = useCallback(async () => {
    if (!txCursor || txLoadingMore) return;
    setTxLoadingMore(true);
    try {
      const txData = await walletAPI.getTransactions({ cursor: txCursor, limit: TX_PAGE_SIZE });
      if (txData?.transactions) {
        setTransactions(prev => [...prev, ...txData.transactions]);
        setTxCursor(txData.nextCursor || null);
        setTxHasMore(!!txData.nextCursor);
      }
    } catch (err) {
      console.error('[EtherTrack] loadMore error:', err?.message);
      showToast('Failed to load more transactions', 'error');
    } finally {
      setTxLoadingMore(false);
    }
  }, [txCursor, txLoadingMore, showToast]);

  // [FIX-1] ETH rate — backend proxy only
  const fetchEthRate = useCallback(async () => {
    try {
      const d = await walletAPI.getEthRate();
      if (d?.inr > 0) { setEthRate(d.inr); setEthRateLive(true); }
    } catch { /* keep fallback */ }
  }, []);

  useEffect(() => { fetchData(); fetchEthRate(); }, [fetchData, fetchEthRate]);

  useEffect(() => {
    const id = setInterval(fetchEthRate, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [fetchEthRate]);

  useEffect(() => {
    const handler = () => { if (document.visibilityState === 'visible') fetchEthRate(); };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [fetchEthRate]);

  // Cleanup toast timer on unmount
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // [FIX-2] Sparkline — correct direction, memoized
  const balSpark = useMemo(() => {
    if (transactions.length < 2) return [];
    let running = balance;
    const points = [running];
    [...transactions].reverse().forEach(t => {
      running = t.type === 'credit'
        ? running - parseFloat(t.amount || 0)
        : running + parseFloat(t.amount || 0);
      points.unshift(Math.max(0, running));
    });
    return points.slice(-12);
  }, [transactions, balance]);

  // ── Filtered transactions ─────────────────────────────────────────────────
  const filteredTx = useMemo(() => transactions.filter(t => {
    if (txFilter === 'deposits')    return t.type === 'credit' && t.method !== 'system';
    if (txFilter === 'withdrawals') return t.type === 'debit'  && t.method !== 'system';
    if (txFilter === 'trades')      return t.method === 'system';
    return true;
  }), [transactions, txFilter]);

  // ── Modal open/close ──────────────────────────────────────────────────────
  const openModal = useCallback(async type => {
    setModal(type);
    setModalStep('amount');
    setModalAmount(0);           // [A-FIX-6] number
    setModalMethod('upi');
    setModalErr('');
    setModalDone(null);
    if (type === 'withdraw') {
      if (bankAccounts.length > 0) {
        const def = bankAccounts.find(a => a.is_default) || bankAccounts[0];
        setWdName(def.account_name);
        setWdAccount(def.account_number);
        setWdIfsc(def.ifsc);
      }
      try {
        const limits = await walletAPI.getLimits();
        if (limits) setWithdrawLimits(limits);
      } catch { /* non-critical */ }
    }
  }, [bankAccounts]);

  const closeModal = useCallback(() => {
    if (modalLoading) return;
    setModal(null);
    setModalLoading(false);
  }, [modalLoading]);

  // Close on Escape
  useEffect(() => {
    if (!modal) return;
    const handler = e => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [modal, closeModal]);

  // ── Deposit ───────────────────────────────────────────────────────────────
  const handleDeposit = useCallback(async () => {
    setModalErr('');
    setModalLoading(true);
    try {
      const loaded = await loadRazorpay();
      if (!loaded) throw new Error('Razorpay SDK failed to load');
      const order = await walletAPI.createDepositOrder(amtVal, modalMethod);
      if (!order?.orderId) throw new Error('Failed to create payment order');
      const options = {
        key:         order.keyId,
        amount:      Math.round(amtVal * 100),
        currency:    'INR',
        name:        'EtherTrack',
        description: 'Add funds to INR wallet',
        order_id:    order.orderId,
        prefill:     { name: dbUser?.full_name || '', email: dbUser?.email || '' },
        theme:       { color: '#22c55e' },
        modal: {
          ondismiss: () => {
            setModalLoading(false);
            setModalErr('Payment cancelled');
          },
        },
        handler: async response => {
          try {
            const result = await walletAPI.verifyDeposit(response);
            if (result?.success) {
              setBalance(parseFloat(result.balance));
              setModalDone({
                type:         'deposit',
                amount:       amtVal,
                reference:    result.reference,
                paymentId:    result.paymentId,
                gstInvoiceNo: result.gstInvoiceNo,
              });
              setModalStep('done');
              await fetchData();
            } else throw new Error('Verification failed');
          } catch (e) {
            setModalErr(e.message || 'Verification failed');
          } finally {
            setModalLoading(false);
          }
        },
      };
      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', r => {
        setModalLoading(false);
        setModalErr(r.error?.description || 'Payment failed');
      });
      rzp.open();
    } catch (e) {
      setModalLoading(false);
      setModalErr(e.message || 'Deposit failed');
    }
  }, [amtVal, modalMethod, dbUser, fetchData]);

  // ── Withdraw ──────────────────────────────────────────────────────────────
  const handleWithdraw = useCallback(async () => {
    setModalErr('');
    if (!wdAccount || !wdIfsc || !wdName) {
      setModalErr('Please fill in all bank details');
      return;
    }
    // [A-FIX-1] IFSC validation in withdrawal modal
    if (!IFSC_REGEX.test(wdIfsc.trim().toUpperCase())) {
      setModalErr('Invalid IFSC format (e.g. HDFC0001234)');
      return;
    }
    if (amtVal > balance) {
      setModalErr('Insufficient balance');
      return;
    }
    setModalLoading(true);
    try {
      const result = await walletAPI.withdraw({
        amount:        amtVal,
        accountNumber: wdAccount,
        ifsc:          wdIfsc.toUpperCase(),
        accountName:   wdName,
      });
      if (result?.success) {
        setModalDone({
          type:      'withdraw',
          amount:    amtVal,
          netAmount: wdNet,
          tds:       wdTDS,
          reference: result.reference,
        });
        setModalStep('done');
        await fetchData();
      }
    } catch (e) {
      // [A-FIX-12] Don't log raw account numbers
      console.error('[EtherTrack] withdraw error:', e?.message);
      setModalErr(e.error || e.message || 'Withdrawal failed');
    } finally {
      setModalLoading(false);
    }
  }, [wdAccount, wdIfsc, wdName, amtVal, balance, wdNet, wdTDS, fetchData]);

  // ── Bank accounts ─────────────────────────────────────────────────────────
  const saveBankAccount = useCallback(async () => {
    const e = {};
    if (!bankForm.name.trim())    e.name    = 'Required';
    if (!bankForm.account.trim()) e.account = 'Required';
    if (!bankForm.bank.trim())    e.bank    = 'Required';
    if (!bankForm.ifsc.trim()) {
      e.ifsc = 'Required';
    } else if (!IFSC_REGEX.test(bankForm.ifsc.trim().toUpperCase())) {
      e.ifsc = 'Invalid IFSC (e.g. HDFC0001234)';
    }
    if (Object.keys(e).length) { setBankErr(e); return; }
    setBankLoading(true);
    try {
      const result = await walletAPI.addBankAccount({
        accountName:   bankForm.name.trim().slice(0, 60),
        accountNumber: bankForm.account.trim(),
        ifsc:          bankForm.ifsc.trim().toUpperCase(),
        bankName:      bankForm.bank.trim().slice(0, 60),
      });
      if (result?.success) {
        setBankAccounts(prev => [...prev, result.account]);
        setBankForm({ name: '', account: '', ifsc: '', bank: '' });
        setBankErr({});
        setShowAddBank(false);
        showToast('Bank account saved');
      }
    } catch (err) {
      showToast(err.error || 'Failed to save bank account', 'error');
    } finally {
      setBankLoading(false);
    }
  }, [bankForm, showToast]);

  const deleteBankAccount = useCallback(async id => {
    setBankLoading(true);
    try {
      await walletAPI.deleteBankAccount(id);
      setBankAccounts(prev => prev.filter(a => a.id !== id));
      showToast('Account removed');
    } catch {
      showToast('Failed to remove account', 'error');
    } finally {
      setBankLoading(false);
    }
  }, [showToast]);

  const setDefaultAccount = useCallback(async id => {
    setBankLoading(true);
    try {
      await walletAPI.setDefaultAccount(id);
      setBankAccounts(prev => prev.map(a => ({ ...a, is_default: a.id === id })));
      showToast('Default updated');
    } catch {
      showToast('Failed to update default', 'error');
    } finally {
      setBankLoading(false);
    }
  }, [showToast]);

  // ── Statement download ────────────────────────────────────────────────────
  // [A-FIX-4] Shows loading toast immediately before heavy import
  const downloadStatement = useCallback(async () => {
    setStmtLoading(true);
    showToast('Generating statement…', 'info');
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const W = 210, ml = 20, tw = W - 40;
      let y = 20;
      doc.setFillColor(4, 7, 6);    doc.rect(0, 0, W, 297, 'F');
      doc.setFillColor(13, 46, 31); doc.rect(0, 0, W, 36, 'F');
      doc.setTextColor(34, 197, 94);  doc.setFontSize(8);  doc.setFont('helvetica', 'normal');
      doc.text('ETHERTRACK · INR WALLET STATEMENT', W / 2, y, { align: 'center' }); y += 7;
      doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor(240, 253, 244);
      doc.text('Account Statement', W / 2, y, { align: 'center' }); y += 6;
      doc.setFontSize(8);  doc.setFont('helvetica', 'normal'); doc.setTextColor(134, 239, 172);
      doc.text(
        `Generated: ${new Date().toLocaleDateString('en-IN')} · ${dbUser?.email || ''}`,
        W / 2, y, { align: 'center' }
      ); y += 14;
      doc.setFillColor(10, 15, 12); doc.roundedRect(ml, y, tw, 20, 2, 2, 'F');
      doc.setFontSize(8);  doc.setTextColor(134, 239, 172);
      doc.text('CURRENT BALANCE', ml + 4, y + 6);
      doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(34, 197, 94);
      doc.text(fmtINR(balance), ml + 4, y + 15); y += 28;
      doc.setFillColor(13, 46, 31); doc.rect(ml, y, tw, 8, 'F');
      doc.setFontSize(7);  doc.setFont('helvetica', 'bold'); doc.setTextColor(134, 239, 172);
      ['DATE', 'REFERENCE', 'TYPE', 'METHOD', 'AMOUNT', 'STATUS'].forEach((h, i) =>
        doc.text(h, ml + [0, 32, 72, 100, 130, 160][i], y + 5.5)
      ); y += 10;
      transactions.forEach((t, idx) => {
        if (y > 260) {
          doc.addPage();
          y = 20;
          doc.setFillColor(4, 7, 6); doc.rect(0, 0, W, 297, 'F');
        }
        if (idx % 2 === 0) { doc.setFillColor(8, 12, 10); doc.rect(ml, y - 1, tw, 8, 'F'); }
        doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(200, 240, 210);
        doc.text(fmtDate(t.created_at).slice(0, 12), ml, y + 5);
        doc.text((t.reference || '—').slice(0, 14), ml + 32, y + 5);
        doc.text((t.type || '—').toUpperCase(), ml + 72, y + 5);
        doc.text((t.method || '—').toUpperCase(), ml + 100, y + 5);
        const ic = t.type === 'credit';
        doc.setTextColor(ic ? 34 : 248, ic ? 197 : 113, ic ? 94 : 113);
        doc.text(`${ic ? '+' : '-'}${fmtINR(t.amount)}`, ml + 130, y + 5);
        doc.setTextColor(200, 240, 210);
        doc.text((t.status || '—').toUpperCase(), ml + 160, y + 5);
        y += 8;
      });
      y += 8; doc.setFontSize(7); doc.setTextColor(134, 239, 172);
      doc.text('ETHERTRACK TECHNOLOGIES PVT LTD · RBI COMPLIANT · RAZORPAY POWERED', W / 2, y, { align: 'center' });
      doc.save(`EtherTrack_Statement_${Date.now()}.pdf`);
      showToast('✅ Statement downloaded');
    } catch (e) {
      console.error('[EtherTrack] PDF error:', e?.message);
      showToast('❌ Download failed: ' + (e.message || 'Unknown error'), 'error');
    } finally {
      setStmtLoading(false);
    }
  }, [balance, transactions, dbUser, showToast]);

  // ── Subscription handlers ─────────────────────────────────────────────────
  const onSubActivated = useCallback(result => {
    if (setDbUser) {
      setDbUser(prev => prev ? {
        ...prev,
        subscription_plan:         currentPlanKey,
        plan_selected:             true,
        subscription_renewal_date: result?.renewalDate || prev.subscription_renewal_date,
        subscription_cycle:        subCycle,
      } : prev);
    }
    fetchData();
  }, [setDbUser, currentPlanKey, subCycle, fetchData]);

  const handleSubWalletPay = useCallback(async () => {
    if (!renewPrice || !canWalletPay) { setSubErr('Insufficient wallet balance.'); return; }
    setSubPaying(true); setSubErr('');
    try {
      const result = await subscriptionAPI.payWithWallet(currentPlanKey, subCycle);
      if (result?.ok) {
        onSubActivated(result);
        setBalance(prev => prev - renewPrice);
        addNotification({
          type:    'WALLET',
          title:   `${planMeta.label} Plan Renewed`,
          message: `₹${renewPrice.toLocaleString('en-IN')} debited. Plan renewed for ${subCycle === 'annual' ? '1 year' : '1 month'}.`,
          link:    '/billing',
        });
        showToast(`✅ ${planMeta.label} plan renewed!`);
      } else {
        setSubErr(result?.error || 'Renewal failed. Please try again.');
      }
    } catch (e) {
      setSubErr(e?.error || e?.message || 'Wallet payment failed.');
    } finally {
      setSubPaying(false);
    }
  }, [renewPrice, canWalletPay, currentPlanKey, subCycle, onSubActivated, addNotification, planMeta, showToast]);

  const handleSubRazorpayPay = useCallback(async () => {
    if (!renewPrice) return;
    setSubPaying(true); setSubErr('');
    try {
      const loaded = await loadRazorpay();
      if (!loaded) throw new Error('Razorpay SDK failed to load');
      const order = await subscriptionAPI.createOrder(currentPlanKey, subCycle);
      if (!order?.orderId) throw new Error('Order creation failed');
      const options = {
        key:         order.keyId,
        amount:      Math.round(order.amount * 100),
        currency:    'INR',
        name:        'EtherTrack',
        description: `${planMeta.label} Renewal — ${subCycle}`,
        order_id:    order.orderId,
        prefill:     { name: dbUser?.full_name || '', email: dbUser?.email || '' },
        theme:       { color: planMeta.color },
        modal:       { ondismiss: () => setSubPaying(false) },
        handler: async response => {
          try {
            const result = await subscriptionAPI.verifyAndActivate(currentPlanKey, subCycle, response);
            if (result?.ok) {
              onSubActivated(result);
              addNotification({
                type:    'WALLET',
                title:   `${planMeta.label} Plan Renewed`,
                message: 'Payment confirmed. Plan renewed.',
                link:    '/billing',
              });
              showToast(`✅ ${planMeta.label} plan renewed!`);
            } else {
              setSubErr('Payment confirmed but renewal failed. Contact support.');
            }
          } catch (e) {
            setSubErr(e?.error || 'Payment verification failed. Contact support.');
          } finally {
            setSubPaying(false);
          }
        },
      };
      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', () => {
        setSubPaying(false);
        setSubErr('Payment failed. Please try again.');
      });
      rzp.open();
    } catch (e) {
      setSubPaying(false);
      setSubErr(e.message || 'Payment failed.');
    }
  }, [renewPrice, currentPlanKey, subCycle, onSubActivated, addNotification, planMeta, dbUser, showToast]);

  const handleSubMetaMaskPay = useCallback(async () => {
    if (!renewPrice) return;
    setSubPaying(true); setSubErr('');
    try {
      if (!window.ethereum) throw new Error('MetaMask not detected');
      const accounts  = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const account   = accounts[0];
      const message   = `EtherTrack renewal: ${currentPlanKey} plan, cycle: ${subCycle}, ts: ${Date.now()}`;
      const signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, account],
      });
      const result = await subscriptionAPI.payWithMetaMask(currentPlanKey, subCycle, account, signature, message);
      if (result?.ok) {
        onSubActivated(result);
        addNotification({
          type:    'WALLET',
          title:   `${planMeta.label} Renewed via MetaMask`,
          message: `Signature confirmed from ${maskSensitive(account)}`,
          link:    '/billing',
        });
        showToast('✅ Renewed via MetaMask!');
      } else {
        setSubErr(result?.error || 'Activation failed after signature.');
      }
    } catch (e) {
      if (e.code === 4001) setSubErr('MetaMask signature rejected.');
      else setSubErr(e.message || 'MetaMask payment failed.');
    } finally {
      setSubPaying(false);
    }
  }, [renewPrice, currentPlanKey, subCycle, onSubActivated, addNotification, planMeta, showToast]);

  // ═════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════════════
  return (
    <>
      <style>{CSS}</style>
      <div className="wlt">
        <div className="wlt-wrap">

          {/* Skip-link for keyboard users */}
          <a href="#wlt-main" className="wlt-skip">Skip to main content</a>

          {/* Header */}
          <header className="wlt-hdr">
            <div className="wlt-hdr-label">ETHERTRACK · FINANCIAL HUB</div>
            <h1 className="wlt-hdr-title">INR <span>Wallet</span></h1>
            <div className="wlt-hdr-sub">DEPOSIT · WITHDRAW · TRADE · SUBSCRIPTION · STATEMENT · RBI COMPLIANT</div>
          </header>

          {/* Top 3-col grid */}
          <div className="wlt-top" id="wlt-main">

            {/* Balance card */}
            <section className="wlt-bal-card" aria-label="Wallet balance">
              <div className="wlt-bal-label">AVAILABLE BALANCE</div>
              {loading
                ? <div className="wlt-skel" style={{ height: 40, width: '60%', marginBottom: 8 }} aria-hidden="true" />
                : <div className="wlt-bal-amount" aria-live="polite" aria-atomic="true">{fmtINR(balance)}</div>
              }
              {balanceLocked > 0 && (
                <div className="wlt-bal-locked">
                  🔒 <span className="sr-only">Locked amount:</span> {fmtINR(balanceLocked)} locked
                </div>
              )}
              <div className="wlt-bal-spark" aria-hidden="true">
                <Sparkline data={balSpark} color="#22c55e" w={160} h={32} />
              </div>
              <div className="wlt-bal-actions">
                <button className="wlt-dep-btn" onClick={() => openModal('deposit')} aria-label="Add funds to wallet">
                  ＋ DEPOSIT
                </button>
                <button className="wlt-wd-btn" onClick={() => openModal('withdraw')} aria-label="Withdraw funds from wallet">
                  ↑ WITHDRAW
                </button>
              </div>
            </section>

            {/* Wallet status */}
            <section className="wlt-meta-card" aria-label="Wallet status">
              <div className="wlt-meta-title">WALLET STATUS</div>
              {[
                {
                  k: 'KYC STATUS',
                  v: dbUser?.kyc_verified ? '✅ VERIFIED' : '⚠ PENDING',
                  cls: dbUser?.kyc_verified ? 'green' : 'yellow',
                  action: !dbUser?.kyc_verified ? () => navigate('/kyc') : null,
                  actionLabel: 'Complete KYC verification',
                },
                { k: 'CURRENT PLAN',  v: planMeta.label, cls: '', style: { color: planMeta.color } },
                {
                  k: 'RENEWAL IN',
                  v: daysLeft !== null ? (daysLeft > 0 ? `${daysLeft} days` : 'EXPIRED') : '—',
                  cls: daysLeft <= 7 ? 'red' : daysLeft <= 30 ? 'yellow' : '',
                },
                { k: 'GSTIN',         v: dbUser?.company_gstin || '—', cls: '' },
                { k: 'INR BALANCE',   v: fmtINR(balance), cls: 'green' },
                {
                  k: 'LAST ACTIVITY',
                  v: transactions[0] ? fmtDate(transactions[0].created_at).slice(0, 12) : 'No activity',
                  cls: '',
                },
              ].map(({ k, v, cls, action, actionLabel, style }) => (
                <div
                  key={k}
                  className="wlt-meta-row"
                  onClick={action || undefined}
                  style={action ? { cursor: 'pointer' } : {}}
                  role={action ? 'button' : undefined}
                  tabIndex={action ? 0 : undefined}
                  aria-label={action ? actionLabel : undefined}
                  onKeyDown={action ? e => (e.key === 'Enter' || e.key === ' ') && action() : undefined}
                >
                  <span className="wlt-meta-key">{k}</span>
                  <span className={`wlt-meta-val${cls ? ' ' + cls : ''}`} style={style}>{v}</span>
                </div>
              ))}
            </section>

            {/* INR↔ETH converter */}
            <section className="wlt-conv-card" aria-label="INR to ETH converter">
              <div className="wlt-conv-title">INR ↔ ETH CONVERTER</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }} role="group" aria-label="Conversion direction">
                {[['inr2eth', '₹ → ETH'], ['eth2inr', 'ETH → ₹']].map(([d, l]) => (
                  <button
                    key={d}
                    onClick={() => { setConvDir(d); setConvInr(''); }}
                    aria-pressed={convDir === d}
                    style={{
                      flex: 1, padding: '6px', borderRadius: 5,
                      border: `1px solid ${convDir === d ? '#22c55e44' : '#0f2a1a'}`,
                      background: convDir === d ? '#0d2e1f22' : '#060a07',
                      color: convDir === d ? '#22c55e' : '#86efac44',
                      cursor: 'pointer', fontFamily: 'DM Mono,monospace',
                      fontSize: 9, transition: 'all .2s',
                    }}
                  >{l}</button>
                ))}
              </div>
              <label htmlFor="conv-input" className="sr-only">
                {convDir === 'inr2eth' ? 'Enter INR amount' : 'Enter ETH amount'}
              </label>
              <input
                id="conv-input"
                className="wlt-conv-input"
                type="number"
                placeholder={convDir === 'inr2eth' ? 'Enter ₹ amount' : 'Enter ETH amount'}
                value={convInr}
                onChange={e => setConvInr(e.target.value)}
                min={0}
                aria-label={convDir === 'inr2eth' ? 'INR amount to convert' : 'ETH amount to convert'}
              />
              <div className="wlt-conv-result" aria-live="polite" aria-atomic="true">
                {convInr ? convResult : '—'}
              </div>
              <div className="wlt-conv-rate">
                1 ETH = ₹{ethRate.toLocaleString('en-IN')} · {ethRateLive ? 'Live rate' : 'Estimated rate'}
              </div>
              <div style={{ marginTop: 12, padding: '8px 10px', background: '#060a07', border: '1px solid #0f2a1a', borderRadius: 6 }}>
                <div style={{ fontSize: 8, color: '#86efac33', marginBottom: 4 }}>YOUR TRADING POWER</div>
                <div style={{ fontSize: 13, color: '#22c55e', fontWeight: 700 }}>
                  {(balance / ethRate).toFixed(6)} ETH
                </div>
                <div style={{ fontSize: 8, color: '#86efac22', marginTop: 2 }}>Based on INR balance</div>
              </div>
            </section>
          </div>

          {/* Tab navigation */}
          <nav className="wlt-tabs" aria-label="Wallet sections">
            {[
              ['transactions', `TRANSACTIONS${transactions.length ? ` (${transactions.length})` : ''}`],
              ['banks',        `BANK ACCOUNTS${bankAccounts.length ? ` (${bankAccounts.length})` : ''}`],
              ['subscription', `SUBSCRIPTION${daysLeft !== null && daysLeft <= 7 ? ' ⚠' : ''}`],
              ['kyc',          'KYC & IDENTITY'],
            ].map(([t, l]) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                aria-controls={`panel-${t}`}
                className={`wlt-tab${tab === t ? ' act' : ''}`}
                onClick={() => setTab(t)}
              >{l}</button>
            ))}
          </nav>

          {/* ── TRANSACTIONS ─────────────────────────────────────────────── */}
          <div
            id="panel-transactions"
            role="tabpanel"
            aria-labelledby="tab-transactions"
            hidden={tab !== 'transactions'}
          >
            {tab === 'transactions' && (
              <div className="wlt-section">
                <div className="wlt-section-hdr">
                  <span className="wlt-section-title">TRANSACTION HISTORY</span>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div className="wlt-tx-filters" role="group" aria-label="Filter transactions">
                      {[['all', 'ALL'], ['deposits', 'DEPOSITS'], ['withdrawals', 'WITHDRAWALS'], ['trades', 'TRADES']].map(([f, l]) => (
                        <button
                          key={f}
                          className={`wlt-filter-btn${txFilter === f ? ' act' : ''}`}
                          aria-pressed={txFilter === f}
                          onClick={() => setTxFilter(f)}
                        >{l}</button>
                      ))}
                    </div>
                    <button
                      className="wlt-dl-btn"
                      onClick={downloadStatement}
                      disabled={stmtLoading}
                      aria-busy={stmtLoading}
                    >
                      {stmtLoading ? '⟳ GENERATING…' : '↓ STATEMENT PDF'}
                    </button>
                  </div>
                </div>

                {loading ? (
                  <div style={{ padding: '20px' }} aria-busy="true" aria-label="Loading transactions">
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} style={{ display: 'flex', gap: 10, padding: '12px 0', borderBottom: '1px solid #0f2a1a08' }}>
                        <div className="wlt-skel" style={{ height: 10, width: '15%' }} />
                        <div className="wlt-skel" style={{ height: 10, width: '25%' }} />
                        <div className="wlt-skel" style={{ height: 10, width: '10%' }} />
                      </div>
                    ))}
                  </div>
                ) : filteredTx.length === 0 ? (
                  <div className="wlt-tx-empty" role="status">
                    {txFilter === 'all'
                      ? '💸 No transactions yet. Deposit funds to get started.'
                      : `No ${txFilter} found.`}
                  </div>
                ) : (
                  <>
                    <div className="wlt-tx-head" role="row" aria-label="Transaction table headers">
                      {['DATE', 'REFERENCE', 'TYPE', 'METHOD', 'AMOUNT', 'STATUS'].map(h => (
                        <span key={h} role="columnheader">{h}</span>
                      ))}
                    </div>
                    {/* [A-FIX-9] Render only first 50 from filtered; pagination handles the rest */}
                    {filteredTx.slice(0, 50).map((t, i) => {
                      const ic = t.type === 'credit';
                      const sc = t.status === 'success' ? '#22c55e' : t.status === 'pending' ? '#f59e0b' : '#f87171';
                      const sb = t.status === 'success' ? '#0d2e1f' : t.status === 'pending' ? '#1a0e00' : '#1a0707';
                      return (
                        <div
                          key={t.id || i}
                          className="wlt-tx-row"
                          role="row"
                          aria-label={`${ic ? 'Credit' : 'Debit'} of ${fmtINR(t.amount)} on ${fmtDate(t.created_at)}`}
                        >
                          <span style={{ fontSize: 10, color: '#86efac55' }}>{fmtDate(t.created_at)}</span>
                          <span style={{ fontSize: 10, color: '#86efac88', fontFamily: 'monospace' }}>{t.reference || '—'}</span>
                          <span>
                            <span
                              className="wlt-tx-badge"
                              style={{
                                background: ic ? '#0d2e1f' : '#1a0707',
                                color:      ic ? '#22c55e' : '#f87171',
                                border:     `1px solid ${ic ? '#22c55e33' : '#f8717133'}`,
                              }}
                              aria-label={ic ? 'Credit — funds received' : 'Debit — funds sent'}
                            >
                              {ic ? '↓ IN' : '↑ OUT'}
                            </span>
                          </span>
                          <span style={{ fontSize: 9, color: '#86efac55' }}>{(t.method || '—').toUpperCase()}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: ic ? '#22c55e' : '#f87171' }}>
                            {ic ? '+' : '-'}{fmtINR(t.amount)}
                          </span>
                          <span>
                            <span
                              className="wlt-tx-status"
                              style={{ background: sb, color: sc, border: `1px solid ${sc}33` }}
                              aria-label={`Status: ${t.status}`}
                            >
                              {(t.status || '—').toUpperCase()}
                            </span>
                          </span>
                        </div>
                      );
                    })}

                    {/* [A-FIX-10] Pagination — load more */}
                    {txHasMore && (
                      <div style={{ padding: '12px 20px', textAlign: 'center' }}>
                        <button
                          className="wlt-add-btn"
                          onClick={loadMoreTransactions}
                          disabled={txLoadingMore}
                          aria-busy={txLoadingMore}
                        >
                          {txLoadingMore ? '⟳ LOADING…' : 'LOAD MORE TRANSACTIONS'}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── BANK ACCOUNTS ────────────────────────────────────────────── */}
          <div
            id="panel-banks"
            role="tabpanel"
            hidden={tab !== 'banks'}
          >
            {tab === 'banks' && (
              <div className="wlt-section">
                <div className="wlt-section-hdr">
                  <span className="wlt-section-title">SAVED BANK ACCOUNTS</span>
                  <button
                    className="wlt-add-btn"
                    onClick={() => setShowAddBank(b => !b)}
                    aria-expanded={showAddBank}
                    aria-controls="add-bank-form"
                  >
                    {showAddBank ? '✕ CANCEL' : '＋ ADD ACCOUNT'}
                  </button>
                </div>

                {showAddBank && (
                  <div id="add-bank-form" className="wlt-add-bank" role="region" aria-label="Add new bank account">
                    <div style={{ fontSize: 10, color: '#86efac66', letterSpacing: '.1em', marginBottom: 14 }}>NEW BANK ACCOUNT</div>
                    <div className="wlt-form-grid">
                      {[
                        { key: 'name',    label: 'ACCOUNT HOLDER NAME', ph: 'e.g. Rahul Sharma',   type: 'text'   },
                        { key: 'bank',    label: 'BANK NAME',           ph: 'e.g. HDFC Bank',       type: 'text'   },
                        { key: 'account', label: 'ACCOUNT NUMBER',      ph: 'e.g. 1234567890',      type: 'text', inputMode: 'numeric' },
                        { key: 'ifsc',    label: 'IFSC CODE',           ph: 'e.g. HDFC0001234',     type: 'text'   },
                      ].map(f => (
                        <div key={f.key}>
                          <label htmlFor={`bank-${f.key}`} className="wlt-inp-label">{f.label}</label>
                          <input
                            id={`bank-${f.key}`}
                            className={`wlt-inp${bankErr[f.key] ? ' err' : ''}`}
                            type={f.type}
                            inputMode={f.inputMode}
                            placeholder={f.ph}
                            value={bankForm[f.key]}
                            aria-invalid={!!bankErr[f.key]}
                            aria-describedby={bankErr[f.key] ? `bank-${f.key}-err` : undefined}
                            onChange={e => {
                              const val = f.key === 'ifsc' ? e.target.value.toUpperCase() : e.target.value;
                              setBankForm(p => ({ ...p, [f.key]: val }));
                            }}
                          />
                          {bankErr[f.key] && (
                            <div id={`bank-${f.key}-err`} className="wlt-inp-err" role="alert">
                              {bankErr[f.key]}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <button className="wlt-save-btn" onClick={saveBankAccount} disabled={bankLoading}>
                      {bankLoading ? 'SAVING…' : 'SAVE ACCOUNT'}
                    </button>
                    <button
                      className="wlt-cancel-btn"
                      onClick={() => { setShowAddBank(false); setBankErr({}); }}
                    >
                      CANCEL
                    </button>
                  </div>
                )}

                {bankAccounts.length === 0 && !showAddBank ? (
                  <div className="wlt-tx-empty" role="status">
                    🏦 No bank accounts saved yet.<br />
                    <span style={{ fontSize: 9, color: '#86efac22' }}>Add your bank account for fast withdrawals.</span>
                  </div>
                ) : (
                  <div className="wlt-bank-grid">
                    {bankAccounts.map(acc => (
                      <article key={acc.id} className={`wlt-bank-card${acc.is_default ? ' default' : ''}`}>
                        {acc.is_default && <span className="wlt-default-badge" aria-label="Default account">DEFAULT</span>}
                        <div className="wlt-bank-name">{acc.account_name}</div>
                        {/* [A-FIX-8] Account number masked in UI, min-width:0 on card */}
                        <div className="wlt-bank-num" aria-label={`Account ending ${acc.account_number.slice(-4)}`}>
                          ···· ···· {acc.account_number.slice(-4)}
                        </div>
                        <div className="wlt-bank-meta">{acc.bank_name} · IFSC: {acc.ifsc}</div>
                        <div className="wlt-bank-actions">
                          {!acc.is_default && (
                            <button
                              className="wlt-bank-btn wlt-default-btn"
                              onClick={() => setDefaultAccount(acc.id)}
                              aria-label={`Set ${acc.account_name} as default account`}
                            >
                              SET DEFAULT
                            </button>
                          )}
                          <button
                            className="wlt-bank-btn wlt-delete-btn"
                            onClick={() => deleteBankAccount(acc.id)}
                            aria-label={`Delete account ending ${acc.account_number.slice(-4)}`}
                          >
                            DELETE
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                <div style={{ padding: '14px 20px', borderTop: '1px solid #0f2a1a', fontSize: 9, color: '#86efac22' }}>
                  🔒 Bank details stored securely · Withdrawals via Razorpay Payouts · 1–2 business days
                </div>
              </div>
            )}
          </div>

          {/* ── SUBSCRIPTION ─────────────────────────────────────────────── */}
          <div
            id="panel-subscription"
            role="tabpanel"
            hidden={tab !== 'subscription'}
          >
            {tab === 'subscription' && (
              <div className="wlt-section">
                <div className="wlt-section-hdr">
                  <span className="wlt-section-title">SUBSCRIPTION MANAGEMENT</span>
                  <button className="wlt-add-btn" onClick={() => navigate('/billing')}>VIEW ALL PLANS →</button>
                </div>
                <div className="sub-wrap">
                  {/* Hero */}
                  <div className="sub-hero" style={{ borderColor: planMeta.border }}>
                    <div>
                      <div className="sub-plan-label">ACTIVE PLAN</div>
                      <div className="sub-plan-name" style={{ color: planMeta.color }}>{planMeta.label}</div>
                      <div className="sub-plan-meta">
                        {renewalDate
                          ? `Renews ${new Date(renewalDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
                          : 'No renewal date set'}
                      </div>
                    </div>
                    {daysLeft !== null && (
                      <div className="sub-days-ring" aria-label={`${daysLeft} days remaining`}>
                        <div
                          className="sub-days-num"
                          style={{ color: daysLeft <= 7 ? '#f87171' : daysLeft <= 30 ? '#f59e0b' : planMeta.color }}
                        >
                          {daysLeft > 0 ? daysLeft : '0'}
                        </div>
                        <div className="sub-days-label">DAYS LEFT</div>
                      </div>
                    )}
                  </div>

                  {/* Expiry warning */}
                  {daysLeft !== null && daysLeft <= 30 && (
                    <div className={`sub-warn ${daysLeft <= 7 ? 'urgent' : 'med'}`} role="alert">
                      <span style={{ fontSize: 18, flexShrink: 0 }}>{daysLeft <= 0 ? '🔴' : daysLeft <= 7 ? '⚠️' : '⏰'}</span>
                      <div style={{ fontSize: 10, color: daysLeft <= 7 ? '#f87171' : '#f59e0b', flex: 1 }}>
                        {daysLeft <= 0
                          ? 'Your subscription has expired. Renew now to restore full access.'
                          : daysLeft === 1
                            ? 'Your subscription expires tomorrow! Renew now.'
                            : `Your subscription expires in ${daysLeft} days.`}
                      </div>
                    </div>
                  )}

                  {/* [A-FIX-5] Isolated RenewalBox component */}
                  <RenewalBox
                    renewPrice={renewPrice}
                    planMeta={planMeta}
                    subCycle={subCycle}
                    setSubCycle={setSubCycle}
                    subPayMethod={subPayMethod}
                    setSubPayMethod={setSubPayMethod}
                    subPaying={subPaying}
                    subErr={subErr}
                    canWalletPay={canWalletPay}
                    balance={balance}
                    dbUser={dbUser}
                    openModal={openModal}
                    handleSubWalletPay={handleSubWalletPay}
                    handleSubRazorpayPay={handleSubRazorpayPay}
                    handleSubMetaMaskPay={handleSubMetaMaskPay}
                  />

                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button className="wlt-dl-btn" style={{ flex: 1 }} onClick={() => navigate('/billing')}>
                      VIEW ALL PLANS & PRICING
                    </button>
                    <button
                      className="wlt-dl-btn"
                      style={{ flex: 1 }}
                      onClick={() => { window.open('https://mail.google.com/mail/?view=cm&to=hello@ethertrack.in', '_blank'); }}
                    >
                      CONTACT SUPPORT
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── KYC ──────────────────────────────────────────────────────── */}
          <div
            id="panel-kyc"
            role="tabpanel"
            hidden={tab !== 'kyc'}
          >
            {tab === 'kyc' && (
              <div className="wlt-section">
                <div className="wlt-section-hdr">
                  <span className="wlt-section-title">KYC & IDENTITY VERIFICATION</span>
                  {!dbUser?.kyc_verified && (
                    <button className="wlt-add-btn" onClick={() => navigate('/kyc')}>COMPLETE KYC →</button>
                  )}
                </div>

                {/* [A-FIX-7] Empty state CTA when no company data */}
                {!dbUser?.kyc_verified && !dbUser?.company_name && (
                  <div style={{
                    margin: '16px 20px', padding: '16px 20px',
                    background: '#0a1a0e', border: '1px solid #22c55e22',
                    borderRadius: 10, display: 'flex', alignItems: 'center', gap: 14,
                  }} role="alert">
                    <span style={{ fontSize: 24 }}>📋</span>
                    <div>
                      <div style={{ fontSize: 12, color: '#f0fdf4', fontWeight: 700, marginBottom: 4 }}>
                        Complete your company profile to enable withdrawals
                      </div>
                      <div style={{ fontSize: 10, color: '#86efac55', marginBottom: 10 }}>
                        KYC verification is required for withdrawals above ₹100 and for trading carbon credits.
                      </div>
                      <button
                        style={{
                          padding: '8px 18px', borderRadius: 7, border: 'none',
                          background: 'linear-gradient(135deg,#16a34a,#15803d)',
                          color: '#fff', cursor: 'pointer',
                          fontFamily: 'DM Mono,monospace', fontSize: 11, fontWeight: 700,
                        }}
                        onClick={() => navigate('/kyc')}
                      >
                        START KYC →
                      </button>
                    </div>
                  </div>
                )}

                <div className="wlt-kyc-grid">
                  {[
                    { icon: '🪪', label: 'KYC STATUS',    val: dbUser?.kyc_verified ? 'VERIFIED' : 'PENDING',     color: dbUser?.kyc_verified ? '#22c55e' : '#f59e0b' },
                    { icon: '🏢', label: 'COMPANY',        val: dbUser?.company_name  || 'Not set',                 color: '#f0fdf4' },
                    { icon: '📋', label: 'GSTIN',          val: dbUser?.company_gstin || 'Not provided',            color: '#60a5fa' },
                    { icon: '🪙', label: 'PAN',            val: dbUser?.company_pan   || 'Not provided',            color: '#a78bfa' },
                    { icon: '🏛', label: 'CIN',            val: dbUser?.company_cin   || 'Not provided',            color: '#facc15' },
                    { icon: '📧', label: 'EMAIL',          val: dbUser?.email         || '—',                       color: '#f0fdf4' },
                    { icon: '🏭', label: 'INDUSTRY',       val: dbUser?.industry_sector || 'Not set',               color: '#f0fdf4' },
                    { icon: '💼', label: 'COMPANY TYPE',   val: dbUser?.company_type  || 'Not set',                 color: '#f0fdf4' },
                  ].map(({ icon, label, val, color }) => (
                    <div key={label} className="wlt-kyc-item">
                      <span className="wlt-kyc-icon" aria-hidden="true">{icon}</span>
                      <div>
                        <div className="wlt-kyc-label">{label}</div>
                        <div className="wlt-kyc-val" style={{ color }}>{val}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ padding: '16px 20px', borderTop: '1px solid #0f2a1a' }}>
                  <div style={{ fontSize: 9, color: '#86efac44', letterSpacing: '.12em', marginBottom: 12 }}>
                    TRADING PERMISSIONS
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    {[
                      { label: 'INR DEPOSITS',    ok: true,                                                  desc: 'Via UPI / Net Banking' },
                      { label: 'INR WITHDRAWALS', ok: true,                                                  desc: 'Via Bank Transfer'     },
                      { label: 'CREDIT TRADING',  ok: !!dbUser?.kyc_verified,                                desc: 'Requires KYC'          },
                      { label: 'METAMASK BIND',   ok: !!dbUser?.wallet_address,                              desc: 'For on-chain signing'  },
                      { label: 'BRSR REPORTS',    ok: !!dbUser?.kyc_verified,                                desc: 'Requires KYC'          },
                      { label: 'CREDIT RETIRE',   ok: !!dbUser?.wallet_address && !!dbUser?.kyc_verified,    desc: 'Requires both'         },
                    ].map(({ label, ok, desc }) => (
                      <div
                        key={label}
                        style={{
                          padding: '12px 14px', borderRadius: 8,
                          background: ok ? '#051409' : '#0a0a0a',
                          border: `1px solid ${ok ? '#22c55e22' : '#0f2a1a'}`,
                        }}
                        aria-label={`${label}: ${ok ? 'enabled' : 'disabled'}. ${desc}`}
                      >
                        <div style={{ fontSize: 9, color: ok ? '#22c55e' : '#86efac22', fontWeight: 700, marginBottom: 3 }}>
                          {ok ? '✓' : '○'} {label}
                        </div>
                        <div style={{ fontSize: 8, color: '#86efac33' }}>{desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ padding: '14px 20px', borderTop: '1px solid #0f2a1a', fontSize: 9, color: '#86efac22' }}>
                  🔒 KYC verified by EtherTrack compliance team · ISO 14064-3 · SEBI BRSR · RBI compliant
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── DEPOSIT / WITHDRAW MODAL ────────────────────────────────────── */}
      {modal && (
        <div
          className="wlt-overlay"
          onClick={e => { if (e.target === e.currentTarget && !modalLoading) closeModal(); }}
          role="presentation"
        >
          {/* [A-FIX-2] Focus trap applied to modalRef */}
          <div
            ref={modalRef}
            className="wlt-modal"
            role="dialog"
            aria-modal="true"
            aria-label={modal === 'deposit' ? 'Add funds to wallet' : 'Withdraw funds from wallet'}
            aria-describedby="modal-desc"
          >
            <div className="wlt-modal-hdr">
              <span className="wlt-modal-title">
                {modal === 'deposit' ? '🇮🇳 ADD FUNDS' : '↑ WITHDRAW FUNDS'}
              </span>
              <button
                className="wlt-modal-close"
                onClick={closeModal}
                disabled={modalLoading}
                aria-label="Close modal"
              >✕</button>
            </div>

            <div className="wlt-modal-body" id="modal-desc">

              {/* ── Amount step ───────────────────────────────────────── */}
              {modalStep === 'amount' && (
                <>
                  {modal === 'withdraw' && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: '#060a07', border: '1px solid #0f2a1a', borderRadius: 7, marginBottom: 8 }}>
                        <span style={{ fontSize: 9, color: '#86efac44' }}>AVAILABLE</span>
                        <span style={{ fontSize: 13, color: '#22c55e', fontWeight: 700 }}>{fmtINR(balance)}</span>
                      </div>
                      {withdrawLimits && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 10px', background: '#060a07', border: '1px solid #0f2a1a', borderRadius: 7, marginBottom: 12 }}>
                          <span style={{ fontSize: 9, color: '#86efac44' }}>DAILY REMAINING</span>
                          <span style={{ fontSize: 11, color: withdrawLimits.remaining < 10000 ? '#f87171' : '#60a5fa', fontWeight: 700 }}>
                            {fmtINR(withdrawLimits.remaining)}{' '}
                            <span style={{ fontSize: 9, color: '#86efac33' }}>of {fmtINR(withdrawLimits.dailyLimit)}</span>
                          </span>
                        </div>
                      )}
                    </>
                  )}

                  {/* Preset buttons */}
                  <div className="wlt-presets" role="group" aria-label="Quick amount selection">
                    {(modal === 'deposit'
                      ? [500, 1000, 2000, 5000, 10000]
                      : [500, 1000, 2000, 5000].filter(a => a <= balance)
                    ).map(a => (
                      <button
                        key={a}
                        // [A-FIX-6] compare numbers, not strings
                        className={`wlt-preset${amtVal === a ? ' sel' : ''}`}
                        aria-pressed={amtVal === a}
                        onClick={() => setModalAmount(a)}
                      >
                        ₹{a.toLocaleString('en-IN')}
                      </button>
                    ))}
                  </div>

                  <label htmlFor="modal-amount" className="sr-only">Amount in rupees</label>
                  <div className="wlt-amount-wrap">
                    <span className="wlt-amount-prefix" aria-hidden="true">₹</span>
                    <input
                      id="modal-amount"
                      className="wlt-amount-inp"
                      type="number"
                      placeholder="0"
                      // [A-FIX-6] value is a number
                      value={modalAmount || ''}
                      onChange={e => setModalAmount(parseFloat(e.target.value) || 0)}
                      min={100}
                      max={modal === 'withdraw' ? balance : 100000}
                      step={1}
                      aria-label="Amount in Indian rupees"
                      aria-describedby="amount-hint"
                    />
                  </div>
                  <div className="wlt-hint" id="amount-hint">
                    {modal === 'deposit' ? 'MIN ₹100 · MAX ₹1,00,000' : `MIN ₹100 · MAX ${fmtINR(balance)}`}
                  </div>

                  {modal === 'withdraw' && amtVal > TDS_THRESHOLD && (
                    <TDSBreakdown amount={amtVal} />
                  )}
                  {modalErr && <div className="wlt-err" role="alert">⚠ {modalErr}</div>}
                </>
              )}

              {/* ── Method step — deposit ─────────────────────────────── */}
              {modalStep === 'method' && modal === 'deposit' && (
                <>
                  <div className="wlt-amount-pill">
                    <span>DEPOSITING</span>
                    <strong>₹{amtVal.toLocaleString('en-IN')}</strong>
                  </div>
                  <div className="wlt-method-list" role="radiogroup" aria-label="Payment method">
                    {[
                      { id: 'upi',  icon: '📱', name: 'UPI',         desc: 'GPay · PhonePe · Paytm' },
                      { id: 'qr',   icon: '⬛', name: 'Scan QR',     desc: 'Open any UPI app and scan' },
                      { id: 'bank', icon: '🏦', name: 'Net Banking',  desc: 'NEFT · IMPS · All banks' },
                    ].map(m => (
                      <div
                        key={m.id}
                        role="radio"
                        aria-checked={modalMethod === m.id}
                        tabIndex={0}
                        className={`wlt-method${modalMethod === m.id ? ' sel' : ''}`}
                        onClick={() => setModalMethod(m.id)}
                        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setModalMethod(m.id)}
                      >
                        <span className="wlt-method-icon" aria-hidden="true">{m.icon}</span>
                        <div className="wlt-method-info">
                          <div className="wlt-method-name">{m.name}</div>
                          <div className="wlt-method-desc">{m.desc}</div>
                        </div>
                        <div className="wlt-radio" aria-hidden="true">
                          {modalMethod === m.id && <div className="wlt-radio-dot" />}
                        </div>
                      </div>
                    ))}
                  </div>
                  {modalErr && <div className="wlt-err" role="alert">⚠ {modalErr}</div>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'center', marginTop: 12 }}>
                    <span style={{ fontSize: 8, color: '#86efac22' }}>🔒 256-BIT ENCRYPTED · RBI COMPLIANT · RAZORPAY</span>
                  </div>
                </>
              )}

              {/* ── Method step — withdraw ────────────────────────────── */}
              {modalStep === 'method' && modal === 'withdraw' && (
                <>
                  <div className="wlt-amount-pill">
                    <span>WITHDRAWING</span>
                    <strong>₹{amtVal.toLocaleString('en-IN')}</strong>
                  </div>
                  {amtVal > TDS_THRESHOLD && <TDSBreakdown amount={amtVal} />}

                  {bankAccounts.length > 0 && (
                    <fieldset style={{ border: 'none', padding: 0, marginBottom: 12 }}>
                      <legend style={{ fontSize: 9, color: '#86efac44', marginBottom: 6 }}>SAVED ACCOUNTS</legend>
                      {bankAccounts.map(acc => (
                        <div
                          key={acc.id}
                          role="radio"
                          aria-checked={wdAccount === acc.account_number}
                          tabIndex={0}
                          onClick={() => { setWdName(acc.account_name); setWdAccount(acc.account_number); setWdIfsc(acc.ifsc); }}
                          onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (() => { setWdName(acc.account_name); setWdAccount(acc.account_number); setWdIfsc(acc.ifsc); })()}
                          style={{
                            padding: '9px 12px', borderRadius: 7, marginBottom: 6, cursor: 'pointer',
                            border: `1px solid ${wdAccount === acc.account_number ? '#22c55e44' : '#0f2a1a'}`,
                            background: wdAccount === acc.account_number ? '#0d2e1f22' : '#060a07',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            transition: 'all .2s',
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 10, color: '#f0fdf4', fontWeight: 600 }}>{acc.account_name}</div>
                            <div style={{ fontSize: 9, color: '#86efac44' }}>
                              {acc.bank_name} · ···{acc.account_number.slice(-4)}
                            </div>
                          </div>
                          {acc.is_default && <span style={{ fontSize: 8, color: '#22c55e55' }}>DEFAULT</span>}
                        </div>
                      ))}
                    </fieldset>
                  )}

                  <div style={{ fontSize: 9, color: '#86efac44', marginBottom: 8 }}>
                    {bankAccounts.length > 0 ? 'OR ENTER MANUALLY' : 'BANK DETAILS'}
                  </div>

                  {[
                    { id: 'wd-name',    ph: 'Account Holder Name', val: wdName,    set: setWdName,    inputMode: 'text' },
                    { id: 'wd-account', ph: 'Account Number',       val: wdAccount, set: setWdAccount, inputMode: 'numeric' },
                    { id: 'wd-ifsc',    ph: 'IFSC Code',            val: wdIfsc,    set: setWdIfsc,    inputMode: 'text' },
                  ].map(f => (
                    <div key={f.id}>
                      <label htmlFor={f.id} className="sr-only">{f.ph}</label>
                      <input
                        id={f.id}
                        className="wlt-upi-inp"
                        placeholder={f.ph}
                        value={f.val}
                        inputMode={f.inputMode}
                        onChange={e => f.set(f.id === 'wd-ifsc' ? e.target.value.toUpperCase() : e.target.value)}
                        style={{ marginBottom: 8, display: 'block', width: '100%' }}
                      />
                    </div>
                  ))}

                  {modalErr && <div className="wlt-err" role="alert">⚠ {modalErr}</div>}
                  <div style={{ fontSize: 9, color: '#86efac22', marginTop: 6 }}>
                    Funds reach your account in 1–2 business days
                  </div>
                </>
              )}

              {/* ── Done step ─────────────────────────────────────────── */}
              {modalStep === 'done' && modalDone && (() => {
                const doneRows = modalDone.type === 'withdraw' && modalDone.tds > 0
                  ? [
                      { k: 'AMOUNT DEBITED',          v: fmtINR(modalDone.amount),    g: false },
                      { k: 'TDS DEDUCTED (Sec 194S)', v: `-${fmtINR(modalDone.tds)}`, g: false },
                      { k: 'YOU RECEIVE',              v: fmtINR(modalDone.netAmount), g: true  },
                      { k: 'REFERENCE',                v: modalDone.reference || '—',  g: false },
                      { k: 'STATUS',                   v: 'PROCESSING',                g: true  },
                    ]
                  : [
                      {
                        k: modalDone.type === 'deposit' ? 'AMOUNT CREDITED' : 'AMOUNT DEBITED',
                        v: `₹${amtVal.toLocaleString('en-IN')}`, g: true,
                      },
                      { k: 'REFERENCE', v: modalDone.reference || modalDone.paymentId || '—', g: false },
                      { k: 'METHOD',    v: modalMethod.toUpperCase(), g: false },
                      ...(modalDone.gstInvoiceNo
                        ? [{ k: 'GST INVOICE', v: modalDone.gstInvoiceNo, g: false }]
                        : [{ k: 'GST INVOICE', v: 'Emailed to you',       g: false }]),
                      {
                        k: 'STATUS',
                        v: modalDone.type === 'deposit' ? 'CONFIRMED' : 'PROCESSING',
                        g: true,
                      },
                    ];
                return (
                  <div className="wlt-done" role="status" aria-live="polite">
                    <div className="wlt-done-ring" aria-hidden="true"><span style={{ fontSize: 28 }}>✅</span></div>
                    <div className="wlt-done-title">
                      {modalDone.type === 'deposit' ? 'FUNDS ADDED!' : 'WITHDRAWAL INITIATED!'}
                    </div>
                    <div className="wlt-done-sub">
                      {modalDone.type === 'deposit'
                        ? 'Your INR wallet has been credited'
                        : 'Will reach your account in 1–2 business days'}
                    </div>
                    <div className="wlt-done-card">
                      {doneRows.map(r => (
                        <div key={r.k} className="wlt-done-row">
                          <span className="wlt-done-key">{r.k}</span>
                          <span className={`wlt-done-val${r.g ? ' g' : ''}`}>{r.v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Modal footer */}
            <div className="wlt-modal-foot">
              {modalStep === 'amount' && (
                <>
                  <button className="wlt-secondary-btn" onClick={closeModal}>CANCEL</button>
                  <button
                    className="wlt-primary-btn"
                    onClick={() => {
                      if (!amtVal || amtVal < 100) { setModalErr('Minimum amount is ₹100'); return; }
                      if (modal === 'withdraw' && amtVal > balance) { setModalErr('Insufficient balance'); return; }
                      setModalErr('');
                      setModalStep('method');
                    }}
                  >
                    NEXT →
                  </button>
                </>
              )}
              {modalStep === 'method' && (
                <>
                  <button className="wlt-secondary-btn" onClick={() => setModalStep('amount')}>← BACK</button>
                  <button
                    className="wlt-primary-btn"
                    onClick={modal === 'deposit' ? handleDeposit : handleWithdraw}
                    disabled={modalLoading}
                    aria-busy={modalLoading}
                  >
                    {modalLoading ? 'PROCESSING...' : modal === 'deposit' ? 'PAY NOW →' : 'CONFIRM →'}
                  </button>
                </>
              )}
              {modalStep === 'done' && (
                <button className="wlt-primary-btn" onClick={closeModal}>DONE ✓</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* [A-FIX-3] Toast with proper ARIA roles */}
      {toast && (
        <div
          className="wlt-toast"
          role={toast.type === 'error' ? 'alert' : 'status'}
          aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
          style={{
            border: `1px solid ${toast.type === 'error' ? '#f8717144' : toast.type === 'info' ? '#60a5fa44' : '#22c55e33'}`,
            color: toast.type === 'error' ? '#f87171' : toast.type === 'info' ? '#60a5fa' : '#22c55e88',
          }}
        >
          {toast.msg}
        </div>
      )}
    </>
  );
}

// ── Style objects (for component-local styles) ────────────────────────────────
const s = {
  tdsBox:   { background: '#0a1a0e', border: '1px solid #22c55e22', borderRadius: 7, padding: '10px 12px', marginBottom: 12 },
  tdsTitle: { fontSize: 9, color: '#86efac44', letterSpacing: '.1em', marginBottom: 8 },
  tdsRow:   { display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #0f2a1a18' },
  tdsKey:   { fontSize: 10, color: '#86efac66' },
  tdsVal:   { fontSize: 11, fontWeight: 700 },
  tdsNote:  { fontSize: 9, color: '#86efac33', marginTop: 6 },
  errWrap:  { minHeight: '100vh', background: '#040706', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Mono',monospace" },
  errBox:   { textAlign: 'center', maxWidth: 400, padding: 32 },
  errIcon:  { fontSize: 40, marginBottom: 16 },
  errTitle: { fontSize: 16, color: '#f0fdf4', fontWeight: 700, marginBottom: 8 },
  errSub:   { fontSize: 12, color: '#86efac66', marginBottom: 24, lineHeight: 1.7 },
  errBtn:   { padding: '10px 28px', borderRadius: 8, border: 'none', background: '#22c55e', color: '#060a07', cursor: 'pointer', fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700, letterSpacing: '.1em' },
  subFree:  { textAlign: 'center', padding: '32px', color: '#86efac44', fontSize: 11 },
  subFreeLink: { cursor: 'pointer', color: '#22c55e', textDecoration: 'underline', fontSize: 10 },
  subRenewBox: { background: '#060a07', border: '1px solid #0f2a1a', borderRadius: 12, padding: 20, marginBottom: 16 },
  subRenewTitle: { fontSize: 9, color: '#86efac44', letterSpacing: '.15em', marginBottom: 16 },
  cycleRow: { display: 'flex', gap: 8, marginBottom: 16 },
  cycleBtn: { flex: 1, padding: '9px 0', borderRadius: 7, border: '1px solid #0f2a1a', background: '#050809', color: '#86efac44', cursor: 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 10, letterSpacing: '.08em', transition: 'all .2s', textAlign: 'center' },
  cycleBtnOn: { background: '#0d2e1f', borderColor: '#22c55e44', color: '#22c55e' },
  subAmtRow:  { display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 16 },
  subAmtBig:  { fontFamily: 'Syne,sans-serif', fontSize: 36, fontWeight: 800 },
  subAmtPeriod: { fontSize: 11, color: '#86efac44' },
  subAmtGst:  { fontSize: 9, color: '#86efac22', marginLeft: 4 },
  subMethods: { display: 'flex', flexDirection: 'column', gap: 8 },
  subMethod:  { display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 9, border: '1px solid #0f2a1a', background: '#050809', cursor: 'pointer', transition: 'all .2s' },
  subMethodSel: { borderColor: '#22c55e55', background: '#0d2e1f22' },
  subMethodIcon: { fontSize: 18, width: 26, textAlign: 'center', flexShrink: 0 },
  subMethodName: { fontSize: 11, color: '#f0fdf4', fontWeight: 600 },
  subMethodDesc: { fontSize: 9, color: '#86efac44', marginTop: 1 },
  subBadge:  { fontSize: 8, padding: '2px 7px', borderRadius: 3, whiteSpace: 'nowrap' },
  subBadgeOk:   { background: '#0d2e1f', color: '#22c55e', border: '1px solid #22c55e22' },
  subBadgeWarn: { background: '#1a0e00', color: '#f59e0b', border: '1px solid #f59e0b22' },
  subWalletHint: { fontSize: 9, color: '#86efac44', marginTop: 8, display: 'flex', justifyContent: 'space-between' },
  subInsuf:  { fontSize: 9, color: '#f87171', marginTop: 5 },
  subErr:    { fontSize: 9, color: '#f87171', marginTop: 10, padding: '8px 12px', background: '#1a0707', borderRadius: 6, border: '1px solid #f8717133' },
  subPayBtn: { width: '100%', marginTop: 16, padding: 13, borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 12, fontWeight: 700, letterSpacing: '.1em', transition: 'opacity .2s' },
};

// ── Global CSS ────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
*{box-sizing:border-box;}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}
.wlt-skip{position:absolute;top:-999px;left:0;background:#22c55e;color:#040706;padding:8px 16px;z-index:9999;font-family:'DM Mono',monospace;font-size:11px;}
.wlt-skip:focus{top:0;}
.wlt{min-height:100vh;background:#040706;font-family:'DM Mono',monospace;color:#f0fdf4;position:relative;}
.wlt::before{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background-image:radial-gradient(circle at 15% 50%,rgba(34,197,94,.03) 0%,transparent 50%),radial-gradient(circle at 85% 20%,rgba(96,165,250,.02) 0%,transparent 50%);}
.wlt-wrap{position:relative;z-index:1;max-width:1100px;margin:0 auto;padding:32px 24px 80px;}
.wlt-hdr{margin-bottom:28px;animation:wu .4s ease both;}
.wlt-hdr-label{font-size:10px;color:#86efac66;letter-spacing:.2em;margin-bottom:6px;}
.wlt-hdr-title{font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:#f0fdf4;margin-bottom:4px;}
.wlt-hdr-title span{color:#22c55e;}
.wlt-hdr-sub{font-size:10px;color:#86efac44;letter-spacing:.1em;}
.wlt-top{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:24px;animation:wu .4s ease .05s both;}
.wlt-bal-card{background:linear-gradient(135deg,#061408,#0a1f0d);border:1px solid #22c55e22;border-radius:16px;padding:24px 24px 20px;position:relative;overflow:hidden;}
.wlt-bal-card::before{content:'';position:absolute;top:-20px;right:-20px;width:120px;height:120px;border-radius:50%;background:radial-gradient(circle,rgba(34,197,94,.06),transparent 70%);pointer-events:none;}
.wlt-bal-label{font-size:9px;color:#86efac44;letter-spacing:.16em;margin-bottom:8px;}
.wlt-bal-amount{font-family:'Syne',sans-serif;font-size:34px;font-weight:800;color:#22c55e;line-height:1;margin-bottom:4px;}
.wlt-bal-locked{font-size:9px;color:#86efac33;margin-bottom:12px;}
.wlt-bal-spark{opacity:.6;}
.wlt-bal-actions{display:flex;gap:8px;margin-top:14px;}
.wlt-dep-btn{flex:1;padding:10px;border-radius:8px;border:none;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.08em;transition:opacity .2s;}
.wlt-dep-btn:hover{opacity:.85;}
.wlt-dep-btn:focus-visible{outline:2px solid #22c55e;outline-offset:2px;}
.wlt-wd-btn{flex:1;padding:10px;border-radius:8px;border:1px solid #22c55e33;background:#0d2e1f22;color:#22c55e88;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.08em;transition:all .2s;}
.wlt-wd-btn:hover{background:#0d2e1f;color:#22c55e;}
.wlt-wd-btn:focus-visible{outline:2px solid #22c55e;outline-offset:2px;}
.wlt-meta-card{background:#070c09;border:1px solid #0f2a1a;border-radius:16px;padding:20px 22px;}
.wlt-meta-title{font-size:9px;color:#86efac44;letter-spacing:.16em;margin-bottom:14px;}
.wlt-meta-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #0f2a1a18;}
.wlt-meta-row:last-child{border-bottom:none;}
.wlt-meta-row:focus-visible{outline:2px solid #22c55e;outline-offset:2px;border-radius:4px;}
.wlt-meta-key{font-size:9px;color:#86efac44;letter-spacing:.08em;}
.wlt-meta-val{font-size:10px;color:#f0fdf4;font-weight:600;text-align:right;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.wlt-meta-val.green{color:#22c55e;} .wlt-meta-val.red{color:#f87171;} .wlt-meta-val.yellow{color:#facc15;}
.wlt-conv-card{background:#070c09;border:1px solid #0f2a1a;border-radius:16px;padding:20px 22px;}
.wlt-conv-title{font-size:9px;color:#86efac44;letter-spacing:.16em;margin-bottom:14px;}
.wlt-conv-input{width:100%;padding:10px 12px;border-radius:7px;border:1px solid #0f2a1a;background:#040706;color:#f0fdf4;font-family:'DM Mono',monospace;font-size:14px;font-weight:700;outline:none;margin-bottom:6px;transition:border-color .2s;}
.wlt-conv-input:focus{border-color:#22c55e33;}
.wlt-conv-result{font-size:18px;font-weight:700;color:#22c55e;margin-bottom:4px;}
.wlt-conv-rate{font-size:9px;color:#86efac33;}
.wlt-tabs{display:flex;gap:4px;border-bottom:1px solid #0f2a1a;margin-bottom:20px;animation:wu .4s ease .1s both;}
.wlt-tab{padding:10px 18px;border:none;border-bottom:2px solid transparent;background:transparent;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.1em;color:#86efac44;transition:all .2s;margin-bottom:-1px;}
.wlt-tab:hover{color:#86efac88;}
.wlt-tab.act{color:#22c55e;border-bottom-color:#22c55e;}
.wlt-tab:focus-visible{outline:2px solid #22c55e;outline-offset:2px;border-radius:4px;}
.wlt-section{background:#070c09;border:1px solid #0f2a1a;border-radius:14px;overflow:hidden;animation:wu .4s ease .15s both;}
.wlt-section-hdr{padding:16px 20px;border-bottom:1px solid #0f2a1a;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;}
.wlt-section-title{font-size:10px;color:#f0fdf4;font-weight:700;letter-spacing:.1em;}
.wlt-tx-filters{display:flex;gap:6px;}
.wlt-filter-btn{padding:5px 12px;border-radius:5px;border:1px solid #0f2a1a;background:transparent;color:#86efac44;cursor:pointer;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.08em;transition:all .2s;}
.wlt-filter-btn.act{background:#0d2e1f;border-color:#22c55e33;color:#22c55e;}
.wlt-filter-btn:focus-visible{outline:2px solid #22c55e;outline-offset:2px;}
.wlt-tx-head{display:grid;grid-template-columns:140px 1fr 80px 90px 110px 80px;gap:8px;padding:10px 20px;font-size:8px;color:#86efac33;letter-spacing:.12em;border-bottom:1px solid #0f2a1a;}
.wlt-tx-row{display:grid;grid-template-columns:140px 1fr 80px 90px 110px 80px;gap:8px;padding:12px 20px;border-bottom:1px solid #0f2a1a08;align-items:center;transition:background .15s;}
.wlt-tx-row:hover{background:#0f2a1a18;}
.wlt-tx-row:last-child{border-bottom:none;}
.wlt-tx-empty{padding:48px;text-align:center;color:#86efac22;font-size:11px;}
.wlt-tx-badge{font-size:8px;padding:2px 8px;border-radius:3px;letter-spacing:.08em;font-weight:700;}
.wlt-tx-status{font-size:8px;padding:2px 7px;border-radius:3px;letter-spacing:.06em;}
.wlt-bank-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:20px;}
/* [A-FIX-8] min-width:0 prevents overflow at 320px */
.wlt-bank-card{background:#060a07;border:1px solid #0f2a1a;border-radius:10px;padding:16px;position:relative;transition:border-color .2s;min-width:0;}
.wlt-bank-card:hover{border-color:#22c55e22;}
.wlt-bank-card.default{border-color:#22c55e33;background:#0a1a0e;}
.wlt-bank-name{font-size:12px;color:#f0fdf4;font-weight:700;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.wlt-bank-num{font-size:10px;color:#86efac55;margin-bottom:8px;}
.wlt-bank-meta{font-size:9px;color:#86efac33;margin-bottom:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.wlt-bank-actions{display:flex;gap:6px;}
.wlt-bank-btn{padding:5px 12px;border-radius:5px;font-family:'DM Mono',monospace;font-size:9px;cursor:pointer;transition:all .2s;}
.wlt-default-btn{border:1px solid #22c55e33;background:#0d2e1f22;color:#22c55e88;}
.wlt-default-btn:hover{background:#0d2e1f;color:#22c55e;}
.wlt-delete-btn{border:1px solid #dc262633;background:transparent;color:#f8717166;}
.wlt-delete-btn:hover{background:#450a0a;border-color:#dc2626;color:#f87171;}
.wlt-default-badge{position:absolute;top:12px;right:12px;font-size:8px;padding:2px 8px;border-radius:3px;background:#0d2e1f;color:#22c55e;border:1px solid #22c55e33;}
.wlt-add-bank{background:#060a07;border:1px dashed #0f2a1a;border-radius:10px;padding:20px;margin:0 20px 20px;}
.wlt-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;}
.wlt-inp{width:100%;padding:9px 12px;border-radius:7px;border:1px solid #0f2a1a;background:#040706;color:#f0fdf4;font-family:'DM Mono',monospace;font-size:11px;outline:none;transition:border-color .2s;}
.wlt-inp:focus{border-color:#22c55e33;} .wlt-inp.err{border-color:#dc2626;}
.wlt-inp-label{font-size:9px;color:#86efac55;letter-spacing:.1em;margin-bottom:4px;display:block;}
.wlt-inp-err{font-size:9px;color:#f87171;margin-top:3px;}
.wlt-save-btn{padding:10px 22px;border-radius:7px;border:none;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.08em;transition:opacity .2s;margin-right:8px;}
.wlt-save-btn:hover{opacity:.85;}
.wlt-cancel-btn{padding:10px 18px;border-radius:7px;border:1px solid #0f2a1a;background:transparent;color:#86efac55;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;transition:all .2s;}
.wlt-kyc-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:20px;}
.wlt-kyc-item{background:#060a07;border:1px solid #0f2a1a;border-radius:10px;padding:14px 16px;display:flex;align-items:center;gap:12px;}
.wlt-kyc-icon{font-size:22px;flex-shrink:0;}
.wlt-kyc-label{font-size:9px;color:#86efac44;letter-spacing:.1em;margin-bottom:4px;}
.wlt-kyc-val{font-size:12px;font-weight:700;}
.sub-wrap{padding:24px;}
.sub-hero{background:linear-gradient(135deg,#061408,#0a1f0d);border-radius:14px;padding:24px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;border:1px solid #22c55e22;position:relative;overflow:hidden;}
.sub-hero::before{content:'';position:absolute;top:-30px;right:-30px;width:150px;height:150px;border-radius:50%;background:radial-gradient(circle,rgba(34,197,94,.05),transparent 70%);pointer-events:none;}
.sub-plan-label{font-size:9px;color:#86efac44;letter-spacing:.15em;margin-bottom:6px;}
.sub-plan-name{font-family:'Syne',sans-serif;font-size:32px;font-weight:800;line-height:1;margin-bottom:4px;}
.sub-plan-meta{font-size:10px;color:#86efac44;}
.sub-days-ring{text-align:center;flex-shrink:0;}
.sub-days-num{font-family:'Syne',sans-serif;font-size:48px;font-weight:800;line-height:1;}
.sub-days-label{font-size:9px;color:#86efac44;letter-spacing:.12em;margin-top:2px;}
.sub-warn{border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px;}
.sub-warn.urgent{background:#1a0707;border:1px solid #f8717144;}
.sub-warn.med{background:#1a0e00;border:1px solid #f59e0b44;}
.wlt-overlay{position:fixed;inset:0;background:rgba(0,0,0,.88);backdrop-filter:blur(6px);z-index:3000;display:flex;align-items:center;justify-content:center;padding:20px;}
.wlt-modal{background:#070c09;border:1px solid #0f2a1a;border-radius:16px;width:100%;max-width:420px;box-shadow:0 32px 80px rgba(0,0,0,.95);overflow:hidden;}
.wlt-modal-hdr{padding:16px 20px;border-bottom:1px solid #0f2a1a;display:flex;align-items:center;justify-content:space-between;}
.wlt-modal-title{font-size:12px;font-weight:700;color:#f0fdf4;letter-spacing:.1em;}
.wlt-modal-close{background:none;border:none;color:#86efac44;cursor:pointer;font-size:16px;}
.wlt-modal-close:hover{color:#f87171;}
.wlt-modal-close:focus-visible{outline:2px solid #22c55e;outline-offset:2px;border-radius:4px;}
.wlt-modal-body{padding:20px;}
.wlt-modal-foot{padding:14px 20px;border-top:1px solid #0f2a1a;display:flex;gap:8px;}
.wlt-presets{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;}
.wlt-preset{padding:5px 12px;border-radius:5px;border:1px solid #0f2a1a;background:transparent;color:#86efac55;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;transition:all .2s;}
.wlt-preset:hover,.wlt-preset.sel{background:#0d2e1f;border-color:#22c55e44;color:#22c55e;}
.wlt-preset:focus-visible{outline:2px solid #22c55e;outline-offset:2px;}
.wlt-amount-wrap{position:relative;margin-bottom:6px;}
.wlt-amount-prefix{position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:16px;color:#4ade8055;font-weight:700;}
.wlt-amount-inp{width:100%;padding:12px 12px 12px 30px;border-radius:8px;border:1px solid #0f2a1a;background:#060a07;color:#f0fdf4;font-family:'DM Mono',monospace;font-size:22px;font-weight:800;outline:none;transition:border-color .2s;box-sizing:border-box;}
.wlt-amount-inp:focus{border-color:#22c55e33;}
.wlt-amount-inp::placeholder{color:#4ade8022;}
.wlt-hint{font-size:8px;color:#86efac33;margin-bottom:14px;}
.wlt-method-list{display:flex;flex-direction:column;gap:7px;margin-bottom:12px;}
.wlt-method{display:flex;align-items:center;gap:10px;padding:11px 13px;border-radius:8px;border:1px solid #0f2a1a;background:#060a07;cursor:pointer;transition:all .2s;}
.wlt-method:hover{border-color:#22c55e33;} .wlt-method.sel{border-color:#22c55e55;background:#0d2e1f22;}
.wlt-method:focus-visible{outline:2px solid #22c55e;outline-offset:2px;border-radius:8px;}
.wlt-method-icon{font-size:18px;width:26px;text-align:center;flex-shrink:0;}
.wlt-method-info{flex:1;}
.wlt-method-name{font-size:10px;color:#f0fdf4;font-weight:600;}
.wlt-method-desc{font-size:8px;color:#86efac44;margin-top:1px;}
.wlt-radio{width:12px;height:12px;border-radius:50%;border:1.5px solid #0f2a1a;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:border-color .2s;}
.wlt-method.sel .wlt-radio{border-color:#22c55e;}
.wlt-radio-dot{width:5px;height:5px;border-radius:50%;background:#22c55e;}
.wlt-upi-inp{width:100%;padding:9px 12px;border-radius:7px;border:1px solid #0f2a1a;background:#060a07;color:#f0fdf4;font-family:'DM Mono',monospace;font-size:11px;outline:none;transition:border-color .2s;box-sizing:border-box;}
.wlt-upi-inp:focus{border-color:#22c55e33;}
.wlt-err{font-size:9px;color:#f87171;margin-top:6px;}
.wlt-amount-pill{padding:8px 12px;background:#060a07;border:1px solid #0f2a1a;border-radius:7px;font-size:10px;color:#86efac66;margin-bottom:12px;display:flex;justify-content:space-between;}
.wlt-amount-pill strong{color:#22c55e;}
.wlt-done{text-align:center;padding:12px 0;}
.wlt-done-ring{width:60px;height:60px;border-radius:50%;border:2px solid #22c55e33;background:#0d2e1f22;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;}
.wlt-done-title{font-size:14px;color:#f0fdf4;font-weight:700;margin-bottom:4px;}
.wlt-done-sub{font-size:9px;color:#86efac44;margin-bottom:14px;}
.wlt-done-card{background:#060a07;border:1px solid #0f2a1a;border-radius:8px;padding:10px 14px;text-align:left;margin-bottom:14px;}
.wlt-done-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #0f2a1a18;}
.wlt-done-row:last-child{border-bottom:none;}
.wlt-done-key{font-size:8px;color:#86efac33;letter-spacing:.1em;}
.wlt-done-val{font-size:10px;color:#f0fdf4;font-weight:600;}
.wlt-done-val.g{color:#22c55e;}
.wlt-primary-btn{flex:1;padding:11px;border-radius:8px;border:none;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.08em;transition:opacity .2s;}
.wlt-primary-btn:hover:not(:disabled){opacity:.85;} .wlt-primary-btn:disabled{opacity:.4;cursor:not-allowed;}
.wlt-primary-btn:focus-visible{outline:2px solid #22c55e;outline-offset:2px;}
.wlt-secondary-btn{flex:1;padding:11px;border-radius:8px;border:1px solid #0f2a1a;background:transparent;color:#86efac55;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;transition:all .2s;}
.wlt-secondary-btn:hover{color:#86efac88;}
.wlt-secondary-btn:focus-visible{outline:2px solid #22c55e;outline-offset:2px;}
.wlt-toast{position:fixed;bottom:24px;right:24px;z-index:9999;background:#070c09;border-radius:8px;padding:11px 18px;font-size:11px;font-family:'DM Mono',monospace;box-shadow:0 8px 40px rgba(0,0,0,.7);}
.wlt-skel{background:linear-gradient(90deg,#0d2e1f22 25%,#0d2e1f44 50%,#0d2e1f22 75%);background-size:200% 100%;animation:wltShimmer 1.5s infinite;border-radius:6px;}
.wlt-add-btn{padding:8px 16px;border-radius:7px;border:1px solid #22c55e33;background:#0d2e1f22;color:#22c55e88;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.08em;transition:all .2s;}
.wlt-add-btn:hover{background:#0d2e1f;color:#22c55e;}
.wlt-add-btn:disabled{opacity:.4;cursor:not-allowed;}
.wlt-add-btn:focus-visible{outline:2px solid #22c55e;outline-offset:2px;}
.wlt-dl-btn{padding:8px 16px;border-radius:7px;border:1px solid #60a5fa33;background:#060e18;color:#60a5fa88;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.08em;transition:all .2s;}
.wlt-dl-btn:hover{border-color:#60a5fa66;color:#60a5fa;}
.wlt-dl-btn:disabled{opacity:.4;cursor:not-allowed;}
@keyframes wu{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
@keyframes wltShimmer{0%{background-position:200% 0;}100%{background-position:-200% 0;}}
@media(prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;}}
@media(max-width:900px){.wlt-top{grid-template-columns:1fr 1fr;}.wlt-bank-grid{grid-template-columns:1fr;}.wlt-kyc-grid{grid-template-columns:1fr;}}
@media(max-width:600px){.wlt-top{grid-template-columns:1fr;}.wlt-tx-head,.wlt-tx-row{grid-template-columns:110px 1fr 70px 80px;}.wlt-tx-head>*:nth-child(n+5),.wlt-tx-row>*:nth-child(n+5){display:none;}.wlt-form-grid{grid-template-columns:1fr;}}
`;

// ── Default export — ErrorBoundary wraps everything ───────────────────────────
export default function Wallet() {
  return (
    <WalletErrorBoundary>
      <WalletInner />
    </WalletErrorBoundary>
  );
}