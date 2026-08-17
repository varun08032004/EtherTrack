// src/components/SubscriptionBilling.jsx - 28/05/2026
// [v2] Changes:
// [SB-1] authAPI added to import — needed for instant me() refresh after payment
// [SB-2] onPlanActivated made async — calls authAPI.me() after payment so
//        PlanGate and Header locks lift immediately without page reload
// [SB-3] Debug console.logs removed from refreshBalance, handleWalletPay,
//        handleConfirmPay — production cleanup

import React, {
  useState, useEffect, useContext, useRef, useCallback,
  useMemo,
} from 'react';
import { createPortal } from 'react-dom';
import { walletAPI, subscriptionAPI, authAPI } from '../services/api';
import { AuthContext } from '../App';
import { useNotifications } from '../context/NotificationContext';
import {
  PLANS, FEATURE_ROWS, PLAN_FEATURES_MATRIX, FAQS,
  GSTIN_REGEX, PAN_REGEX,
} from '../constants/plans';
import styles from './SubscriptionBilling.module.css';

// ── Constants ────────────────────────────────────────────────────
const INVOICE_ALLOW_ORIGINS = [
  window.location.origin,
  'https://invoices.ethertrack.in',
  'https://storage.googleapis.com',
];

const RAZORPAY_KEY_ID = process.env.REACT_APP_RAZORPAY_KEY_ID || '';

// ── Utilities ────────────────────────────────────────────────────
const fmtINR = n =>
  new Intl.NumberFormat('en-IN', {
    style:                 'currency',
    currency:              'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parseFloat(n || 0));

const toPaise   = n  => Math.round((parseFloat(n) || 0) * 100);
const daysUntil = d  => d ? Math.ceil((new Date(d) - new Date()) / 86_400_000) : null;
const newKey    = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const isSafeInvoiceUrl = url => {
  if (!url) return false;
  try {
    const u = new URL(url);
    return INVOICE_ALLOW_ORIGINS.some(o => u.origin === new URL(o).origin);
  } catch { return false; }
};

// ── cx helper — joins CSS module classes ─────────────────────────
const cx = (...args) =>
  args.flat().filter(Boolean).map(c => styles[c] ?? c).join(' ');

// ── Razorpay SDK loader — deduped promise cache ───────────────────
let _rzpPromise = null;
const loadRazorpay = () => {
  if (_rzpPromise) return _rzpPromise;
  _rzpPromise = new Promise(resolve => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement('script');
    s.src     = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload  = () => resolve(true);
    s.onerror = () => { _rzpPromise = null; resolve(false); };
    document.body.appendChild(s);
  });
  return _rzpPromise;
};

// ── Mobile check ─────────────────────────────────────────────────
const checkMobile = () => /android|iphone|ipad|ipod/i.test(navigator.userAgent);

// ── Validation helpers ───────────────────────────────────────────
const validateGstin = v => !v || GSTIN_REGEX.test(v);
const validatePan   = v => !v || PAN_REGEX.test(v);

// ── Portal wrapper ───────────────────────────────────────────────
const Portal = ({ children }) => {
  const el = useRef(document.createElement('div'));
  useEffect(() => {
    const elRef = el.current;
    document.body.appendChild(elRef);
    return () => document.body.removeChild(elRef);
  }, []);
  return createPortal(children, el.current);
};

// ── Skeleton card ────────────────────────────────────────────────
const PlanSkeleton = () => (
  <div className={cx('planCard', 'skeleton')} aria-hidden="true">
    <div className={cx('skLine', 'skShort')} />
    <div className={cx('skLine', 'skTitle')} />
    <div className={cx('skLine', 'skMed')} />
    <div className={cx('skLine', 'skFull')} />
    <div className={cx('skLine', 'skFull')} />
    <div className={cx('skLine', 'skMed')} />
  </div>
);

// ═══════════════════════════════════════════════════════════════
export default function SubscriptionBilling({
  currentPlan = 'free',
  orgName     = '',
}) {
  const { dbUser, setDbUser }  = useContext(AuthContext);
  const { addNotification }    = useNotifications();

  // ── State ───────────────────────────────────────────────────
  const [billingCycle,   setBillingCycle]   = useState('monthly');
  const [walletBalance,  setWalletBalance]  = useState(null);
  const [prices,         setPrices]         = useState(null);
  const [priceError,     setPriceError]     = useState(false);
  const [priceLoading,   setPriceLoading]   = useState(true);

  const [payModal,       setPayModal]       = useState(null);
  const [payMethod,      setPayMethod]      = useState('wallet');
  const [paying,         setPaying]         = useState(false);
  const [modalErr,       setModalErr]       = useState('');

  const [gstin,          setGstin]          = useState('');
  const [pan,            setPan]            = useState('');
  const [gstinErr,       setGstinErr]       = useState('');
  const [panErr,         setPanErr]         = useState('');

  const [couponInput,    setCouponInput]    = useState('');
  const [couponStatus,   setCouponStatus]   = useState('idle'); // idle | checking | valid | invalid
  const [couponResult,   setCouponResult]   = useState(null);   // { code, discountPaise, finalPaise, basePaise, discountLabel }
  const [couponMsg,      setCouponMsg]      = useState('');

  const [showMatrix,     setShowMatrix]     = useState(false);
  const [showGas,        setShowGas]        = useState(false);
  const [showHistory,    setShowHistory]    = useState(false);
  const [payHistory,     setPayHistory]     = useState([]);
  const [historyError,   setHistoryError]   = useState('');
  const [historyCursor,  setHistoryCursor]  = useState(null);
  const [historyMore,    setHistoryMore]    = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [openFaq,        setOpenFaq]        = useState(null);
  const [toast,          setToast]          = useState(null);

  const toastTimer     = useRef(null);
  const idempotencyKey = useRef(newKey());
  const mainRef        = useRef(null);
  const modalRef       = useRef(null);
  const notifFiredRef  = useRef(false);
  const isMobile       = useMemo(checkMobile, []);

  // ── Derived ─────────────────────────────────────────────────
  const renewalDate    = dbUser?.subscription_renewal_date || null;
  const daysLeft       = daysUntil(renewalDate);
  const activePlan     = dbUser?.subscription_plan || currentPlan;
  const activePlanData = PLANS.find(p => p.key === activePlan) || PLANS[0];
  const activePlanIdx  = PLANS.findIndex(p => p.key === activePlan);
  const needsGstFields = payModal && ['corporate', 'enterprise'].includes(payModal.plan.key);

  // ── Price fetch with retry ───────────────────────────────────
  const fetchPrices = useCallback(() => {
    setPriceLoading(true);
    setPriceError(false);
    subscriptionAPI.getPrices()
      .then(d => setPrices(d?.prices || null))
      .catch(() => setPriceError(true))
      .finally(() => setPriceLoading(false));
  }, []);

  useEffect(() => { fetchPrices(); }, [fetchPrices]);

  // ── Wallet balance ───────────────────────────────────────────
  // [SB-3] Removed debug console.logs
  const refreshBalance = useCallback(() => {
    walletAPI.getBalance()
      .then(d => {
        const raw = d?.balance ?? d?.data?.balance ?? d?.inr_balance ?? 0;
        setWalletBalance(parseFloat(raw) || 0);
      })
      .catch(() => setWalletBalance(0));
  }, []);

  useEffect(() => { refreshBalance(); }, [refreshBalance]);

  // ── Focus trap via inert on main (modal is in Portal) ────────
  useEffect(() => {
    if (!payModal) return;
    const mainEl = mainRef.current;
    mainEl?.setAttribute('inert', '');
    const firstBtn = modalRef.current?.querySelector(
      'button:not([disabled]), [tabindex="0"]'
    );
    setTimeout(() => firstBtn?.focus(), 60);
    return () => mainEl?.removeAttribute('inert');
  }, [payModal]);

  // ── Toast cleanup on unmount ─────────────────────────────────
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // ── Expiry notifications (once per mount) ───────────────────
  useEffect(() => {
    if (daysLeft === null || notifFiredRef.current) return;
    notifFiredRef.current = true;
    if      (daysLeft <= 0)   addNotification({ type: 'SYSTEM', title: 'Subscription Expired',            message: `Your ${activePlan} plan has expired. Renew now.`,                                    link: '/billing' });
    else if (daysLeft === 1)  addNotification({ type: 'SYSTEM', title: 'Subscription Expires Tomorrow',   message: `Your ${activePlan} plan expires tomorrow. Renew to avoid interruption.`,             link: '/billing' });
    else if (daysLeft <= 7)   addNotification({ type: 'SYSTEM', title: `Expiring in ${daysLeft} days`,    message: `Your ${activePlan} plan expires on ${new Date(renewalDate).toLocaleDateString('en-IN')}.`, link: '/billing' });
    else if (daysLeft <= 30)  addNotification({ type: 'SYSTEM', title: 'Renewal reminder',                message: `Your ${activePlan} plan renews on ${new Date(renewalDate).toLocaleDateString('en-IN')}.`,  link: '/billing' });
  }, [daysLeft]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ──────────────────────────────────────────────────
  const showToast = useCallback((msg, type = 'success', invoiceUrl = null) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, type, invoiceUrl: isSafeInvoiceUrl(invoiceUrl) ? invoiceUrl : null });
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  const getPrice = useCallback((plan) => {
    if (!prices || !plan) return null;
    const p = prices[plan.key];
    if (!p) return null;
    return billingCycle === 'annual' ? p.annual : p.monthly;
  }, [prices, billingCycle]);

  const annualSaving = useCallback((plan) => {
    if (!prices) return null;
    const p = prices[plan.key];
    if (!p?.monthly || !p?.annual) return null;
    const saving = (p.monthly * 12) - p.annual;
    return saving > 0 ? saving : null;
  }, [prices]);

  // ── Open modal ───────────────────────────────────────────────
  const openPayModal = useCallback((plan, method = 'wallet') => {
    idempotencyKey.current = newKey();
    setPayModal({ plan });
    setPayMethod(method);
    setModalErr('');
    setGstin(''); setPan('');
    setGstinErr(''); setPanErr('');
    setCouponInput(''); setCouponStatus('idle'); setCouponResult(null); setCouponMsg('');
    refreshBalance();
  }, [refreshBalance]);

  // ── Coupon ───────────────────────────────────────────────────
  // Read-only preview via /api/subscription/coupon/validate — nothing is
  // "used up" here, the coupon is only actually redeemed once a payment
  // goes through (see services/coupons.js recordRedemption on the backend).
  const handleApplyCoupon = useCallback(async () => {
    if (!couponInput.trim() || !payModal?.plan) return;
    setCouponStatus('checking'); setCouponMsg('');
    try {
      const result = await subscriptionAPI.validateCoupon(payModal.plan.key, billingCycle, couponInput.trim());
      if (result?.valid) {
        setCouponStatus('valid');
        setCouponResult(result);
        setCouponMsg(result.discountLabel ? `${result.discountLabel} applied!` : 'Coupon applied!');
      } else {
        setCouponStatus('invalid');
        setCouponResult(null);
        setCouponMsg(result?.reason || 'Invalid coupon code.');
      }
    } catch (e) {
      setCouponStatus('invalid');
      setCouponResult(null);
      setCouponMsg(e?.error || 'Could not validate coupon right now.');
    }
  }, [couponInput, payModal, billingCycle]);

  const clearCoupon = useCallback(() => {
    setCouponInput(''); setCouponStatus('idle'); setCouponResult(null); setCouponMsg('');
  }, []);

  useEffect(() => {
    if (payModal) clearCoupon();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingCycle]);

  // ── Context update after activation ─────────────────────────
  // [SB-2] Made async — instantly re-fetches /me after payment so
  // PlanGate and Header lock icons update without requiring a page reload.
  // Falls back to the optimistic update if the fetch fails.
  const onPlanActivated = useCallback(async (plan, result) => {
    // Optimistic update — lifts locks immediately in the UI
    setDbUser?.(prev => prev ? {
      ...prev,
      subscription_plan:         plan.key,
      plan_selected:             true,
      subscription_renewal_date: result?.renewalDate || prev.subscription_renewal_date,
      subscription_cycle:        billingCycle,
    } : prev);
    refreshBalance();
    // Instant server re-fetch — ensures dbUser matches DB exactly
    try {
      const me = await authAPI.me();
      if (me?.id) setDbUser?.(prev => prev ? { ...prev, ...me } : me);
    } catch { /* silent — optimistic update already applied above */ }
  }, [billingCycle, refreshBalance, setDbUser]);

  // ── Validate GST fields ──────────────────────────────────────
  const validateGstFields = useCallback(() => {
    let ok = true;
    if (gstin && !validateGstin(gstin)) { setGstinErr('Invalid GSTIN format'); ok = false; }
    else setGstinErr('');
    if (pan && !validatePan(pan)) { setPanErr('Invalid PAN format'); ok = false; }
    else setPanErr('');
    return ok;
  }, [gstin, pan]);

  // ── WALLET PAY ───────────────────────────────────────────────
  // [SB-3] Removed debug console.logs
  const handleWalletPay = useCallback(async () => {
    if (!validateGstFields()) return;
    const plan  = payModal.plan;
    const basePrice = getPrice(plan);
    const activeCoupon = couponStatus === 'valid' ? couponResult : null;
    const price = activeCoupon ? activeCoupon.finalPaise / 100 : basePrice;

    if (!idempotencyKey.current || idempotencyKey.current.length < 8) {
      idempotencyKey.current = newKey();
    }

    if (toPaise(walletBalance) < toPaise(price)) {
      setModalErr('Insufficient wallet balance. Please top up first.');
      return;
    }
    setPaying(true); setModalErr('');
    try {
      const result = await subscriptionAPI.payWithWallet(
        plan.key, billingCycle, idempotencyKey.current,
        { gstin: gstin || undefined, pan: pan || undefined },
        activeCoupon?.code
      );
      if (result?.ok) {
        onPlanActivated(plan, result);
        addNotification({ type: 'WALLET', title: `${plan.label} Plan Activated`, message: `${fmtINR(price)} debited. ${plan.label} plan active.`, link: '/billing' });
        showToast(`${plan.label} plan activated!`, 'success', result?.invoiceUrl);
        setPayModal(null);
      } else {
        setModalErr(result?.error || 'Activation failed. Please try again.');
        idempotencyKey.current = newKey();
      }
    } catch (e) {
      setModalErr(e?.error || e?.message || 'Wallet payment failed.');
      idempotencyKey.current = newKey();
    } finally {
      setPaying(false);
    }
  }, [payModal, getPrice, walletBalance, billingCycle, gstin, pan, couponStatus, couponResult,
      validateGstFields, onPlanActivated, addNotification, showToast]);

  // ── RAZORPAY PAY ─────────────────────────────────────────────
  const handleRazorpayPay = useCallback(async () => {
    if (!validateGstFields()) return;
    const plan = payModal.plan;
    const activeCoupon = couponStatus === 'valid' ? couponResult : null;
    setPaying(true); setModalErr('');
    try {
      const loaded = await loadRazorpay();
      if (!loaded) throw new Error('Razorpay failed to load. Please refresh.');

      const order = await subscriptionAPI.createOrder(
        plan.key, billingCycle, idempotencyKey.current, activeCoupon?.code
      );
      if (!order?.orderId) throw new Error('Could not create payment order. Try again.');

      const options = {
        key:         RAZORPAY_KEY_ID,
        amount:      order.amount,
        currency:    'INR',
        name:        'EtherTrack',
        description: `${plan.label} Plan — ${billingCycle}`,
        order_id:    order.orderId,
        prefill:     { name: dbUser?.full_name || '', email: dbUser?.email || '' },
        notes:       { gstin: gstin || '', pan: pan || '' },
        theme:       { color: plan.color },
        modal: { ondismiss: () => setPaying(false) },
        handler: async (response) => {
          try {
            const result = await subscriptionAPI.verifyAndActivate(
              plan.key, billingCycle, response,
              { gstin: gstin || undefined, pan: pan || undefined }
            );
            if (result?.ok) {
              onPlanActivated(plan, result);
              addNotification({ type: 'WALLET', title: `${plan.label} Plan Activated`, message: `Payment confirmed.`, link: '/billing' });
              showToast(`${plan.label} plan activated!`, 'success', result?.invoiceUrl);
              setPayModal(null);
            } else {
              setModalErr('Payment confirmed but activation failed. Contact support@ethertrack.in.');
            }
          } catch (e) {
            setModalErr(e?.error || 'Verification failed. Contact support@ethertrack.in.');
          } finally {
            setPaying(false);
          }
        },
      };
      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', r => {
        setPaying(false);
        setModalErr(r.error?.description || 'Payment failed. Please try again.');
        idempotencyKey.current = newKey();
      });
      rzp.open();
    } catch (e) {
      setPaying(false);
      setModalErr(e?.message || 'Payment initiation failed.');
      idempotencyKey.current = newKey();
    }
  }, [payModal, billingCycle, gstin, pan, couponStatus, couponResult, validateGstFields,
      dbUser, onPlanActivated, addNotification, showToast]);

  // ── METAMASK PAY ─────────────────────────────────────────────
  const handleMetaMaskPay = useCallback(async () => {
    if (!validateGstFields()) return;
    const plan = payModal.plan;
    setPaying(true); setModalErr('');
    try {
      if (isMobile && !window.ethereum) {
        sessionStorage.setItem('et_pending_intent', JSON.stringify({
          planKey:        plan.key,
          billingCycle,
          idempotencyKey: idempotencyKey.current,
          gstin:          gstin || '',
          pan:            pan   || '',
        }));
        const dappUrl = encodeURIComponent(window.location.href);
        window.location.href = `metamask://dapp/${dappUrl}`;
        setPaying(false);
        return;
      }
      if (!window.ethereum) {
        throw new Error('MetaMask not detected. Please install MetaMask or use the mobile app.');
      }

      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const account  = accounts?.[0];
      if (!account) throw new Error('No MetaMask account connected.');

      const registeredWallet = dbUser?.wallet_address;
      if (registeredWallet && account.toLowerCase() !== registeredWallet.toLowerCase()) {
        throw new Error(
          `Connected wallet (${account.slice(0,6)}…${account.slice(-4)}) does not match ` +
          `your registered address (${registeredWallet.slice(0,6)}…${registeredWallet.slice(-4)}). ` +
          `Please switch wallets in MetaMask.`
        );
      }

      const ts      = Date.now();
      const message = `EtherTrack:${plan.key}:${billingCycle}:${idempotencyKey.current}:${ts}`;
      const signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, account],
      });

      const result = await subscriptionAPI.payWithMetaMask(
        plan.key, billingCycle, account, signature, message,
        { gstin: gstin || undefined, pan: pan || undefined },
        (couponStatus === 'valid' ? couponResult?.code : undefined)
      );
      if (result?.ok) {
        onPlanActivated(plan, result);
        addNotification({ type: 'WALLET', title: `${plan.label} Plan Activated via MetaMask`, message: `Signature confirmed.`, link: '/billing' });
        showToast(`${plan.label} activated via MetaMask!`, 'success', result?.invoiceUrl);
        setPayModal(null);
      } else {
        setModalErr(result?.error || 'Activation failed after signature. Contact support.');
        idempotencyKey.current = newKey();
      }
    } catch (e) {
      if (e.code === 4001) setModalErr('MetaMask signature rejected by user.');
      else setModalErr(e?.message || 'MetaMask payment failed.');
      idempotencyKey.current = newKey();
    } finally {
      setPaying(false);
    }
  }, [payModal, billingCycle, isMobile, gstin, pan, dbUser, couponStatus, couponResult,
      validateGstFields, onPlanActivated, addNotification, showToast]);

  // ── Confirm pay ──────────────────────────────────────────────
  // [SB-3] Removed debug console.logs, cleaned up deps
  const handleConfirmPay = useCallback(() => {
    if (payMethod === 'wallet')   handleWalletPay();
    if (payMethod === 'razorpay') handleRazorpayPay();
    if (payMethod === 'metamask') handleMetaMaskPay();
  }, [payMethod, handleWalletPay, handleRazorpayPay, handleMetaMaskPay]);

  // ── Payment history ──────────────────────────────────────────
  const loadHistory = useCallback(async (cursor = null) => {
    if (showHistory && !cursor) { setShowHistory(false); return; }
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const d = await subscriptionAPI.getHistory({ limit: 20, cursor });
      if (cursor) {
        setPayHistory(prev => [...prev, ...(d?.history || [])]);
      } else {
        setPayHistory(d?.history || []);
      }
      setHistoryCursor(d?.nextCursor || null);
      setHistoryMore(!!d?.nextCursor);
      setShowHistory(true);
    } catch (e) {
      setHistoryError(e?.message || 'Failed to load payment history. Please retry.');
    } finally {
      setHistoryLoading(false);
    }
  }, [showHistory]);

  // ── Expiry banner config ─────────────────────────────────────
  const expiryBanner = useMemo(() => {
    if (daysLeft === null) return null;
    if (daysLeft <= 0)  return { cls: 'expiryUrgent', icon: '🔴', title: 'SUBSCRIPTION EXPIRED',        sub: 'Renew now to restore full access.',                                                 color: '#f87171', days: 'Expired' };
    if (daysLeft <= 1)  return { cls: 'expiryUrgent', icon: '⚠️', title: 'EXPIRES TOMORROW',             sub: 'Renew now to avoid interruption.',                                                  color: '#f87171', days: '1 day'   };
    if (daysLeft <= 7)  return { cls: 'expiryWarn',   icon: '⏰', title: `EXPIRES IN ${daysLeft} DAYS`, sub: `Renew before ${new Date(renewalDate).toLocaleDateString('en-IN')}.`,               color: '#fbbf24', days: `${daysLeft}d` };
    if (daysLeft <= 30) return { cls: 'expiryNotice', icon: '📅', title: 'RENEWAL REMINDER',             sub: `Renews on ${new Date(renewalDate).toLocaleDateString('en-IN')}.`,                 color: '#4ade80', days: `${daysLeft}d` };
    return null;
  }, [daysLeft, renewalDate]);

  // ── confirmDisabled ──────────────────────────────────────────
  const confirmDisabled = useMemo(() => {
    if (paying || !prices || !payModal) return true;
    const price = (couponStatus === 'valid' && couponResult) ? couponResult.finalPaise / 100 : getPrice(payModal.plan);
    if (payMethod === 'wallet'   && toPaise(walletBalance) < toPaise(price)) return true;
    if (payMethod === 'metamask' && !dbUser?.wallet_address && !isMobile)    return true;
    return false;
  }, [paying, prices, payModal, payMethod, walletBalance, dbUser, isMobile, getPrice, couponStatus, couponResult]);

  // ── Proration notice for downgrade ───────────────────────────
  const prorationNotice = useMemo(() => {
    if (!payModal || !renewalDate) return null;
    const planIdx = PLANS.findIndex(p => p.key === payModal.plan.key);
    if (planIdx >= activePlanIdx) return null;
    const daysRemaining = daysUntil(renewalDate);
    if (!daysRemaining || daysRemaining <= 0) return null;
    return `Downgrade takes effect on ${new Date(renewalDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}. You keep ${activePlanData.label} access for ${daysRemaining} more day${daysRemaining !== 1 ? 's' : ''}.`;
  }, [payModal, renewalDate, activePlanIdx, activePlanData]);

  // ═══════════════════════════════════════════════════════════
  return (
    <>
      <div ref={mainRef} className={styles.root}>
        <div className={styles.inner}>

          {/* ── Expiry banner ── */}
          {expiryBanner && (
            <div className={cx('expiryBanner', expiryBanner.cls)} role="alert">
              <span className={styles.expiryIcon}>{expiryBanner.icon}</span>
              <div className={styles.expiryBody}>
                <div className={styles.expiryTitle} style={{ color: expiryBanner.color }}>
                  {expiryBanner.title}
                </div>
                <div className={styles.expirySub} style={{ color: expiryBanner.color + 'aa' }}>
                  {expiryBanner.sub}
                </div>
              </div>
              <div className={styles.expiryDays} style={{ color: expiryBanner.color }}>
                {expiryBanner.days}
              </div>
            </div>
          )}

          {/* ── Page header ── */}
          <div className={styles.pageHdr}>
            <div className={styles.pageEyebrow}>SUBSCRIPTION · BILLING · MARKETPLACE FEES</div>
            <h1 className={styles.pageTitle}>
              Plans <span className={styles.pageTitleAccent}>&amp;</span> Billing
            </h1>
            <p className={styles.pageSub}>
              All prices in INR · Exclusive of 18% GST · GST invoice issued on payment ·
              Free tier: trade freely, unlock emissions &amp; portfolio from Starter
            </p>
          </div>

          {/* ── Balance chips ── */}
          <div className={styles.chipsRow}>
            <div className={styles.chip}>
              <span className={styles.chipLabel}>💰 INR WALLET</span>
              <span className={styles.chipVal}>
                {walletBalance === null ? '—' : fmtINR(walletBalance)}
              </span>
              <button
                className={styles.chipBtn}
                onClick={() => window.location.href = '/wallet'}
                aria-label="Top up INR wallet"
              >
                TOP UP →
              </button>
            </div>
            {dbUser?.wallet_address && (
              <div className={styles.chip}>
                <span className={styles.chipLabel}>🦊 METAMASK</span>
                <span className={cx('chipVal')}>
                  {dbUser.wallet_address.slice(0, 6)}…{dbUser.wallet_address.slice(-4)}
                </span>
              </div>
            )}
          </div>

          {/* ── Current plan banner ── */}
          <div className={styles.currentBanner} style={{ borderColor: activePlanData.border }}>
            <div className={styles.currentLeft}>
              <div className={styles.currentDot} style={{ background: activePlanData.color }} />
              <div>
                <div className={styles.currentLabel}>YOUR CURRENT PLAN</div>
                <div>
                  <span className={styles.currentName} style={{ color: activePlanData.color }}>
                    {activePlanData.label}
                  </span>
                  <span className={styles.currentMeta}>
                    {orgName || dbUser?.company_name || ''}{orgName || dbUser?.company_name ? ' · ' : ''}
                    {activePlanData.seats ? `${activePlanData.seats} seat${activePlanData.seats > 1 ? 's' : ''}` : 'Unlimited seats'}
                    {' · '} Gas {activePlanData.gasFee}
                  </span>
                </div>
              </div>
            </div>
            <div className={styles.renewalInfo}>
              {renewalDate ? (
                <>
                  <strong style={{ color: '#d1fae5' }}>
                    {new Date(renewalDate).toLocaleDateString('en-IN', {
                      day: '2-digit', month: 'short', year: 'numeric',
                    })}
                  </strong>
                  <br />
                  <span style={{ color: daysLeft <= 7 ? '#f87171' : undefined }}>
                    {daysLeft > 0 ? `${daysLeft} days remaining` : 'Expired'}
                  </span>
                </>
              ) : (
                <span>No renewal date set</span>
              )}
            </div>
          </div>

          {/* ── Free tier notice ── */}
          {activePlan === 'free' && (
            <div className={styles.freeNotice} role="note">
              <span className={styles.freeNoticeIcon}>🔓</span>
              <div>
                <strong style={{ color: '#4ade80' }}>Free tier:</strong>
                {' '}You can browse and trade carbon credits freely.{' '}
                <span style={{ color: 'rgba(240,253,244,0.5)' }}>
                  Emissions Tracker and Portfolio are locked — upgrade to Starter or above to unlock.
                </span>
              </div>
            </div>
          )}

          {/* ── Billing cycle toggle ── */}
          <div className={styles.cycleRow}>
            <div className={styles.cycleToggle} role="group" aria-label="Billing cycle">
              <button
                className={cx('cycleBtn', billingCycle === 'monthly' && 'cycleBtnOn')}
                onClick={() => setBillingCycle('monthly')}
                aria-pressed={billingCycle === 'monthly'}
              >
                MONTHLY
              </button>
              <button
                className={cx('cycleBtn', billingCycle === 'annual' && 'cycleBtnOn')}
                onClick={() => setBillingCycle('annual')}
                aria-pressed={billingCycle === 'annual'}
              >
                ANNUAL <span className={styles.cycleBadge}>SAVE 17%</span>
              </button>
            </div>
            {billingCycle === 'annual' && (
              <span className={styles.cycleNote}>≈ 2 months free · Single annual invoice</span>
            )}
          </div>

          {/* ── Price error state ── */}
          {priceError && (
            <div className={styles.priceError} role="alert">
              <span>⚠ Could not load pricing.</span>
              <button className={styles.retryBtn} onClick={fetchPrices}>Retry →</button>
            </div>
          )}

          {/* ── Plan cards grid ── */}
          <div className={styles.plansGrid} role="list" aria-label="Available plans">
            {priceLoading ? (
              PLANS.map(p => <PlanSkeleton key={p.key} />)
            ) : (
              PLANS.map((plan, idx) => {
                const price     = getPrice(plan);
                const saving    = annualSaving(plan);
                const isCurrent = plan.key === activePlan;
                const canWallet = walletBalance !== null && price !== null &&
                                  toPaise(walletBalance) >= toPaise(price);
                const isUpgrade = idx > activePlanIdx;

                return (
                  <div
                    key={plan.key}
                    className={cx(
                      'planCard',
                      isCurrent      && 'planCurrent',
                      plan.highlight && 'planPopular',
                    )}
                    role="listitem"
                    style={{
                      '--plan-color':  plan.color,
                      '--plan-border': plan.border,
                      '--plan-bg':     plan.bg,
                    }}
                    tabIndex={isCurrent ? -1 : 0}
                    aria-label={`${plan.label} plan${isCurrent ? ', your current plan' : ''}`}
                    onKeyDown={e => {
                      if (!isCurrent && plan.key !== 'corporate' &&
                          (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        openPayModal(plan, 'wallet');
                      }
                    }}
                  >
                    {plan.highlight && !isCurrent && (
                      <div className={cx('planBadge', 'badgePopular')}>★ MOST POPULAR</div>
                    )}
                    {isCurrent && (
                      <div className={cx('planBadge', 'badgeCurrent')}>✓ YOUR PLAN</div>
                    )}

                    <div className={styles.planTier} style={{ color: plan.color }}>
                      {plan.label.toUpperCase()}
                    </div>
                    <div className={styles.planName}>{plan.label}</div>
                    <div className={styles.planTagline} style={{ color: plan.dimColor }}>
                      {plan.tagline}
                    </div>
                    <div className={styles.planAudience}>{plan.audience}</div>

                    {/* Price */}
                    <div>
                      {price !== null ? (
                        <>
                          <span className={styles.planPrice}>
                            {price === 0 ? '₹0' : `₹${price.toLocaleString('en-IN')}`}
                          </span>
                          <span className={styles.planPeriod}>
                            {price === 0 ? ' forever' : billingCycle === 'annual' ? ' /yr' : ' /mo'}
                          </span>
                        </>
                      ) : (
                        <span className={styles.planPrice} style={{ fontSize: 18 }}>Contact Sales</span>
                      )}
                    </div>
                    {price !== null && price > 0 && (
                      <div className={styles.planGstNote}>+ 18% GST</div>
                    )}
                    {saving && (
                      <div className={styles.planSaving} style={{ color: plan.color }}>
                        Save {fmtINR(saving)}/yr vs monthly
                      </div>
                    )}

                    {/* Chips */}
                    <div className={styles.planChipRow}>
                      <div className={styles.planChip} style={{ borderColor: plan.border }}>
                        <span style={{ color: 'rgba(240,253,244,0.3)' }}>⛽</span>
                        <span style={{ color: plan.color }}>{plan.gasFee}</span>
                      </div>
                      <div className={styles.planChip} style={{ borderColor: plan.border }}>
                        <span style={{ color: 'rgba(240,253,244,0.3)' }}>👥</span>
                        <span style={{ color: plan.color }}>
                          {plan.seats ? `${plan.seats} seat${plan.seats > 1 ? 's' : ''}` : '∞'}
                        </span>
                      </div>
                    </div>

                    <hr className={styles.planDivider} />

                    {/* Feature list */}
                    <div className={styles.featList}>
                      {plan.locked?.map(item => (
                        <div key={item} className={cx('feat', 'featLocked')}>
                          <span>🔒</span>
                          <span>{item}</span>
                        </div>
                      ))}
                      {plan.unlocked?.map(item => (
                        <div key={item} className={cx('feat', 'featOk')}>
                          <span style={{ color: plan.color }}>✓</span>
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>

                    {/* Primary CTA */}
                    <button
                      className={cx(
                        'planCta',
                        isCurrent                  ? 'ctaCurrent'  :
                        plan.key === 'corporate'   ? 'ctaContact'  :
                        isUpgrade                  ? 'ctaUpgrade'  : 'ctaDowngrade',
                      )}
                      disabled={isCurrent}
                      aria-disabled={isCurrent}
                      onClick={() => {
                        if (isCurrent) return;
                        if (plan.key === 'corporate') {
                          window.location.href = 'https://mail.google.com/mail/?view=cm&to=support@ethertrack.in&su=Corporate+Plan+Enquiry';
                          return;
                        }
                        openPayModal(plan, 'wallet');
                      }}
                    >
                      {isCurrent                  ? '✓ CURRENT PLAN'  :
                       plan.key === 'corporate'   ? 'CONTACT SALES →' :
                       isUpgrade                  ? 'UPGRADE →'       : 'DOWNGRADE'}
                    </button>

                    {/* Quick-pay row — only for paid plans with actual price */}
                    {!isCurrent && plan.key !== 'corporate' && price !== null && price > 0 && (
                      <div
                        className={styles.quickpay}
                        role="group"
                        aria-label={`Quick pay for ${plan.label} plan`}
                      >
                        <button
                          className={styles.qpBtn}
                          disabled={!canWallet || !prices}
                          aria-label={
                            canWallet
                              ? `Pay ${plan.label} from wallet (${fmtINR(price)})`
                              : 'Insufficient wallet balance'
                          }
                          onClick={() => canWallet && openPayModal(plan, 'wallet')}
                          tabIndex={-1}
                        >
                          💰 {canWallet ? `₹${price?.toLocaleString('en-IN')}` : 'LOW BAL'}
                        </button>
                        <button
                          className={styles.qpBtn}
                          onClick={() => openPayModal(plan, 'metamask')}
                          tabIndex={-1}
                          aria-label={`Pay ${plan.label} via MetaMask`}
                        >
                          🦊 {isMobile ? 'APP' : 'MM'}
                        </button>
                        <button
                          className={styles.qpBtn}
                          onClick={() => openPayModal(plan, 'razorpay')}
                          tabIndex={-1}
                          aria-label={`Pay ${plan.label} via Card or UPI`}
                        >
                          💳 UPI
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* ── Feature matrix ── */}
          <div className={styles.sectionHdr}>
            <div className={styles.sectionTitle}>FULL FEATURE MATRIX</div>
            <button
              className={styles.toggleBtn}
              onClick={() => setShowMatrix(v => !v)}
              aria-expanded={showMatrix}
            >
              {showMatrix ? '▲ HIDE' : '▼ EXPAND'}
            </button>
          </div>
          {showMatrix && (
            <div className={styles.matrixWrap}>
              <table className={styles.matrix} aria-label="Plan feature comparison">
                <thead>
                  <tr>
                    <th style={{ width: '22%' }}>Feature</th>
                    {PLANS.map(p => (
                      <th key={p.key} style={{ color: p.color }}>
                        {p.label.toUpperCase()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FEATURE_ROWS.map(row => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      {PLANS.map(plan => {
                        const feat = PLAN_FEATURES_MATRIX[plan.key]?.[row.key];
                        return (
                          <td key={plan.key}>
                            {feat?.ok && feat?.val !== true ? (
                              <span
                                className={styles.matrixPill}
                                style={{
                                  background: plan.bg,
                                  color:      plan.color,
                                  border:     `1px solid ${plan.border}`,
                                }}
                              >
                                {feat.val}
                              </span>
                            ) : feat?.ok ? (
                              <span className={styles.matrixCheck} aria-label="Included">✓</span>
                            ) : (
                              <span className={styles.matrixCross} aria-label="Not included">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr>
                    <td>Seats</td>
                    {PLANS.map(p => (
                      <td key={p.key}>
                        <span
                          className={styles.matrixPill}
                          style={{ background: p.bg, color: p.color, border: `1px solid ${p.border}` }}
                        >
                          {p.seats || '∞'}
                        </span>
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Gas fee</td>
                    {PLANS.map(p => (
                      <td key={p.key}>
                        <span
                          className={styles.matrixPill}
                          style={{ background: p.bg, color: p.color, border: `1px solid ${p.border}` }}
                        >
                          {p.gasFee}
                        </span>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* ── Payment history ── */}
          <div className={styles.sectionHdr} style={{ marginTop: 8 }}>
            <div className={styles.sectionTitle}>PAYMENT HISTORY</div>
            <button
              className={styles.toggleBtn}
              onClick={() => loadHistory(null)}
              aria-expanded={showHistory}
              aria-busy={historyLoading}
            >
              {historyLoading ? '⟳ LOADING…' : showHistory ? '▲ HIDE' : '▼ LOAD'}
            </button>
          </div>
          {historyError && (
            <div className={styles.historyErr} role="alert">
              ⚠ {historyError}
              <button className={styles.retryBtn} onClick={() => loadHistory(null)}>Retry →</button>
            </div>
          )}
          {showHistory && (
            <>
              <table className={styles.historyTable} aria-label="Payment history">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Plan</th>
                    <th>Cycle</th>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th>Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {payHistory.length === 0 && !historyLoading && (
                    <tr>
                      <td colSpan={7} className={styles.historyEmpty}>No payments yet</td>
                    </tr>
                  )}
                  {payHistory.map(row => (
                    <tr key={row.id}>
                      <td>{new Date(row.created_at).toLocaleDateString('en-IN')}</td>
                      <td style={{ color: PLANS.find(p => p.key === row.plan)?.color || '#d1fae5' }}>
                        {row.plan}
                      </td>
                      <td>{row.cycle}</td>
                      <td>{fmtINR(row.amount)}</td>
                      <td>{row.pay_method}</td>
                      <td style={{ color: row.status === 'success' ? '#22c55e' : '#f87171' }}>
                        {row.status}
                      </td>
                      <td>
                        {isSafeInvoiceUrl(row.invoice_url) ? (
                          <a
                            href={row.invoice_url}
                            className={styles.invoiceLink}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Download invoice for ${row.plan} plan`}
                          >
                            ↓ PDF
                          </a>
                        ) : (
                          <span className={styles.noInvoice}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {historyMore && (
                <button
                  className={styles.loadMore}
                  onClick={() => loadHistory(historyCursor)}
                  aria-busy={historyLoading}
                  disabled={historyLoading}
                >
                  {historyLoading ? '⟳ Loading…' : 'Load more →'}
                </button>
              )}
            </>
          )}

          {/* ── Gas fee guide ── */}
          <div className={styles.sectionHdr} style={{ marginTop: 8 }}>
            <div className={styles.sectionTitle}>MARKETPLACE GAS FEE GUIDE</div>
            <button
              className={styles.toggleBtn}
              onClick={() => setShowGas(v => !v)}
              aria-expanded={showGas}
            >
              {showGas ? '▲ HIDE' : '▼ EXPAND'}
            </button>
          </div>
          {showGas && (
            <div className={styles.gasGrid}>
              {[
                { label: 'Free',      pct: '1.5%',  color: '#f87171', bg: 'rgba(248,113,113,0.06)', border: 'rgba(248,113,113,0.2)', note: 'Standard rate'     },
                { label: 'Starter',   pct: '1%',    color: '#60a5fa', bg: 'rgba(96,165,250,0.06)',  border: 'rgba(96,165,250,0.2)',  note: 'Save 33% vs Free' },
                { label: 'Growth',    pct: '0.75%', color: '#fbbf24', bg: 'rgba(251,191,36,0.06)',  border: 'rgba(251,191,36,0.2)',  note: 'Save 50% vs Free' },
                { label: 'Corporate', pct: '0.5%',  color: '#f59e0b', bg: 'rgba(245,158,11,0.06)',  border: 'rgba(245,158,11,0.2)',  note: 'Negotiated'       },
              ].map(t => (
                <div
                  key={t.label}
                  className={styles.gasCard}
                  style={{ background: t.bg, borderColor: t.border }}
                >
                  <div className={styles.gasLabel} style={{ color: t.color }}>{t.label.toUpperCase()}</div>
                  <div className={styles.gasPct}   style={{ color: '#f0fdf4' }}>{t.pct}</div>
                  <div className={styles.gasNote}>{t.note}</div>
                </div>
              ))}
            </div>
          )}

          {/* ── FAQ ── */}
          <div className={styles.sectionHdr} style={{ marginTop: 8 }}>
            <div className={styles.sectionTitle}>BILLING FAQ</div>
          </div>
          <div className={styles.faq} role="list">
            {FAQS.map(faq => (
              <div key={faq.key} className={styles.faqItem} role="listitem">
                <button
                  className={styles.faqQ}
                  onClick={() => setOpenFaq(openFaq === faq.key ? null : faq.key)}
                  aria-expanded={openFaq === faq.key}
                  aria-controls={`faq-ans-${faq.key}`}
                >
                  <span>{faq.q}</span>
                  <span className={cx('faqIcon', openFaq === faq.key && 'faqIconOpen')}>+</span>
                </button>
                {openFaq === faq.key && (
                  <div
                    id={`faq-ans-${faq.key}`}
                    className={styles.faqA}
                    role="region"
                  >
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* ── Corporate CTA ── */}
          <div className={styles.entCta}>
            <div>
              <div className={styles.entTitle}>Need Corporate or a custom plan?</div>
              <div className={styles.entSub}>
                Full Scope 3 · BRSR/CDP/TCFD · Verifier integration · Multi-entity · Custom seats
              </div>
            </div>
           <button
  className={styles.entBtn}
  onClick={() => window.location.href = 'https://mail.google.com/mail/?view=cm&to=support@ethertrack.in&su=Corporate+Plan+Enquiry'}
>
  CONTACT SALES →
</button>
          </div>

        </div>
      </div>

      {/* ══ Payment modal ══ */}
      {payModal && (
        <Portal>
          <div
            className={styles.overlay}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pay-modal-title"
            onClick={e => e.target === e.currentTarget && !paying && setPayModal(null)}
          >
            <div className={styles.modal} ref={modalRef}>

              {/* Modal header */}
              <div className={styles.modalHdr}>
                <span className={styles.modalTitle} id="pay-modal-title">
                  CHOOSE PAYMENT METHOD
                </span>
                <button
                  className={styles.modalClose}
                  onClick={() => !paying && setPayModal(null)}
                  aria-label="Close payment modal"
                  disabled={paying}
                >
                  ✕
                </button>
              </div>

              <div className={styles.modalBody}>

                {/* Plan summary */}
                <div className={styles.modalPlanSummary}>
                  <div className={styles.modalPlanName} style={{ color: payModal.plan.color }}>
                    {payModal.plan.label} Plan
                  </div>
                  <div className={styles.modalPlanPrice}>
                    {prices
                      ? (couponStatus === 'valid' && couponResult
                          ? (
                            <>
                              <span style={{ textDecoration: 'line-through', opacity: 0.5, marginRight: 8 }}>
                                {fmtINR(getPrice(payModal.plan))}
                              </span>
                              {fmtINR(couponResult.finalPaise / 100)} / {billingCycle === 'annual' ? 'year' : 'month'} + 18% GST
                            </>
                          )
                          : `${fmtINR(getPrice(payModal.plan))} / ${billingCycle === 'annual' ? 'year' : 'month'} + 18% GST`
                        )
                      : 'Loading…'
                    }
                  </div>
                </div>

                {/* Coupon code */}
                <div className={styles.field} style={{ marginTop: 12 }}>
                  <label className={styles.fieldLabel} htmlFor="sb-coupon">Coupon code</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      id="sb-coupon"
                      type="text"
                      value={couponInput}
                      onChange={e => { setCouponInput(e.target.value.toUpperCase()); if (couponStatus !== 'idle') { setCouponStatus('idle'); setCouponResult(null); setCouponMsg(''); } }}
                      placeholder="e.g. EARLYBIRD50"
                      autoComplete="off"
                      disabled={couponStatus === 'valid'}
                      className={cx('fieldInput', couponStatus === 'invalid' && 'fieldInputErr')}
                      style={{ flex: 1 }}
                    />
                    {couponStatus === 'valid' ? (
                      <button type="button" className={styles.cancelBtn} onClick={clearCoupon} disabled={paying}>
                        REMOVE
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.cancelBtn}
                        onClick={handleApplyCoupon}
                        disabled={paying || couponStatus === 'checking' || !couponInput.trim()}
                      >
                        {couponStatus === 'checking' ? '…' : 'APPLY'}
                      </button>
                    )}
                  </div>
                  {couponMsg && (
                    <div
                      className={couponStatus === 'valid' ? styles.fieldOk : styles.fieldErr}
                      role={couponStatus === 'invalid' ? 'alert' : undefined}
                    >
                      {couponStatus === 'valid' ? '✓ ' : ''}{couponMsg}
                    </div>
                  )}
                </div>

                {/* Proration notice */}
                {prorationNotice && (
                  <div className={styles.prorationNotice} role="note">
                    ℹ {prorationNotice}
                  </div>
                )}

                {/* Wallet method */}
                <button
                  className={cx('methodCard', payMethod === 'wallet' && 'methodCardSel')}
                  onClick={() => setPayMethod('wallet')}
                  aria-pressed={payMethod === 'wallet'}
                >
                  <span className={styles.methodIcon}>💰</span>
                  <div className={styles.methodInfo}>
                    <div className={styles.methodName}>INR Wallet</div>
                    <div className={styles.methodDesc}>Instant · No redirect · Deducted server-side</div>
                  </div>
                  <span className={cx(
                    'methodBadge',
                    toPaise(walletBalance) >= toPaise(getPrice(payModal.plan) || 0) ? 'badgeOk' : 'badgeWarn'
                  )}>
                    {toPaise(walletBalance) >= toPaise(getPrice(payModal.plan) || 0) ? 'SUFFICIENT' : 'LOW BAL'}
                  </span>
                </button>
                {payMethod === 'wallet' && (
                  <div className={styles.walletDetail}>
                    <span>Wallet balance</span>
                    <strong>{fmtINR(walletBalance)}</strong>
                  </div>
                )}
                {payMethod === 'wallet' &&
                  toPaise(walletBalance) < toPaise(getPrice(payModal.plan) || 0) && (
                  <div className={styles.insufficient}>
                    ⚠ Insufficient balance.{' '}
                    <span
                      className={styles.insufLink}
                      role="button"
                      tabIndex={0}
                      onClick={() => window.location.href = '/wallet'}
                      onKeyDown={e => e.key === 'Enter' && (window.location.href = '/wallet')}
                    >
                      Top up →
                    </span>
                  </div>
                )}

                {/* MetaMask method */}
                <button
                  className={cx('methodCard', payMethod === 'metamask' && 'methodCardSel')}
                  onClick={() => setPayMethod('metamask')}
                  style={{ marginTop: 8 }}
                  aria-pressed={payMethod === 'metamask'}
                >
                  <span className={styles.methodIcon}>🦊</span>
                  <div className={styles.methodInfo}>
                    <div className={styles.methodName}>{isMobile ? 'MetaMask App' : 'MetaMask'}</div>
                    <div className={styles.methodDesc}>
                      {isMobile
                        ? 'Opens MetaMask mobile app · On-chain verification'
                        : 'Sign with connected wallet · Plan key signed — no price in message'}
                    </div>
                  </div>
                  {dbUser?.wallet_address
                    ? <span className={cx('methodBadge', 'badgeOk')}>
                        {dbUser.wallet_address.slice(0, 6)}…
                      </span>
                    : <span className={cx('methodBadge', 'badgeWarn')}>NOT BOUND</span>
                  }
                </button>

                {/* Razorpay method */}
                <button
                  className={cx('methodCard', payMethod === 'razorpay' && 'methodCardSel')}
                  onClick={() => setPayMethod('razorpay')}
                  style={{ marginTop: 8 }}
                  aria-pressed={payMethod === 'razorpay'}
                >
                  <span className={styles.methodIcon}>💳</span>
                  <div className={styles.methodInfo}>
                    <div className={styles.methodName}>Card / UPI / Net Banking</div>
                    <div className={styles.methodDesc}>Powered by Razorpay · 256-bit encrypted · All Indian banks</div>
                  </div>
                  <span className={cx('methodBadge', 'badgeOk')}>RAZORPAY</span>
                </button>

                {/* GST fields — corporate only */}
                {needsGstFields && (
                  <div className={styles.gstSection}>
                    <div className={styles.gstTitle}>
                      GST DETAILS{' '}
                      <span style={{ color: 'rgba(240,253,244,0.25)' }}>(optional — for B2B ITC)</span>
                    </div>

                    <div className={styles.field}>
                      <label className={styles.fieldLabel} htmlFor="sb-gstin">GSTIN</label>
                      <input
                        id="sb-gstin"
                        type="text"
                        value={gstin}
                        onChange={e => { setGstin(e.target.value.toUpperCase()); setGstinErr(''); }}
                        onBlur={() => gstin && !validateGstin(gstin) && setGstinErr('Invalid GSTIN format (15-char)')}
                        placeholder="22AAAAA0000A1Z5"
                        maxLength={15}
                        autoComplete="off"
                        aria-describedby={gstinErr ? 'gstin-err' : undefined}
                        aria-invalid={!!gstinErr}
                        className={cx('fieldInput', gstinErr && 'fieldInputErr')}
                      />
                      {gstinErr && <div id="gstin-err" className={styles.fieldErr} role="alert">{gstinErr}</div>}
                    </div>

                    <div className={styles.field}>
                      <label className={styles.fieldLabel} htmlFor="sb-pan">PAN</label>
                      <input
                        id="sb-pan"
                        type="text"
                        value={pan}
                        onChange={e => { setPan(e.target.value.toUpperCase()); setPanErr(''); }}
                        onBlur={() => pan && !validatePan(pan) && setPanErr('Invalid PAN format (10-char)')}
                        placeholder="AAAAA0000A"
                        maxLength={10}
                        autoComplete="off"
                        aria-describedby={panErr ? 'pan-err' : undefined}
                        aria-invalid={!!panErr}
                        className={cx('fieldInput', panErr && 'fieldInputErr')}
                      />
                      {panErr && <div id="pan-err" className={styles.fieldErr} role="alert">{panErr}</div>}
                    </div>

                    <div className={styles.gstNote}>
                      GSTIN and PAN are printed on your GST-compliant tax invoice and required
                      for input tax credit (ITC) claims under CGST rules.
                    </div>
                  </div>
                )}

                {modalErr && (
                  <div className={styles.modalErr} role="alert">⚠ {modalErr}</div>
                )}
              </div>

              {/* Modal footer */}
              <div className={styles.modalFoot}>
                <button
                  className={styles.cancelBtn}
                  onClick={() => setPayModal(null)}
                  disabled={paying}
                >
                  CANCEL
                </button>
                <button
                  className={styles.confirmBtn}
                  onClick={handleConfirmPay}
                  disabled={confirmDisabled}
                  aria-busy={paying}
                >
                  {paying
                    ? '⟳ PROCESSING…'
                    : `PAY ${
                        payMethod === 'wallet'   ? 'FROM WALLET' :
                        payMethod === 'metamask' ? 'VIA METAMASK' : 'VIA RAZORPAY'
                      } →`
                  }
                </button>
              </div>

            </div>
          </div>
        </Portal>
      )}

      {/* ── Toast ── */}
      {toast && (
        <Portal>
          <div
            className={cx('toast', toast.type === 'success' ? 'toastSuccess' : 'toastError')}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <div className={styles.toastMsg}>{toast.msg}</div>
            {toast.invoiceUrl && (
              <a
                href={toast.invoiceUrl}
                className={styles.toastInvoice}
                target="_blank"
                rel="noreferrer"
              >
                📄 Download GST invoice →
              </a>
            )}
          </div>
        </Portal>
      )}
    </>
  );
}