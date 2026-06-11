// src/components/PlanSelection.jsx — EtherTrack v3 - 28/05/2026

import React, {
  useState, useEffect, useRef, useCallback, useMemo, createPortal,
} from 'react';
import { subscriptionAPI } from '../services/api';
import { PLANS, GSTIN_REGEX, PAN_REGEX } from '../constants/plans';
import './PlanSelection.css';

// ── Constants ─────────────────────────────────────────────────────
const RAZORPAY_KEY_ID = process.env.REACT_APP_RAZORPAY_KEY_ID || '';

// ── Razorpay SDK loader — module-level promise cache (deduped) ────
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

// ── Idempotency key ───────────────────────────────────────────────
const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// ── Mobile check ─────────────────────────────────────────────────
const checkMobile = () => /android|iphone|ipad|ipod/i.test(navigator.userAgent);

// ── Portal ────────────────────────────────────────────────────────
const Portal = ({ children }) => {
  const el = useRef(document.createElement('div'));
  useEffect(() => {
    document.body.appendChild(el.current);
    return () => document.body.removeChild(el.current);
  }, []);
  return createPortal(children, el.current);
};

// ── Skeleton card ─────────────────────────────────────────────────
const PlanSkeleton = () => (
  <div className="ps-card ps-skeleton" aria-hidden="true">
    <div className="ps-sk ps-sk-short" />
    <div className="ps-sk ps-sk-title" />
    <div className="ps-sk ps-sk-med" />
    <div className="ps-sk ps-sk-full" />
    <div className="ps-sk ps-sk-full" />
  </div>
);

export default function PlanSelection({ onPlanSelected, userName = 'there' }) {
  const [selected,     setSelected]     = useState('free');
  const [prices,       setPrices]       = useState(null);
  const [priceError,   setPriceError]   = useState(false);
  const [priceLoading, setPriceLoading] = useState(true);
  const [confirming,   setConfirming]   = useState(false);
  const [error,        setError]        = useState('');
  const [visible,      setVisible]      = useState(false);
  const [showGstModal, setShowGstModal] = useState(false);
  const [gstin,        setGstin]        = useState('');
  const [pan,          setPan]          = useState('');
  const [gstinErr,     setGstinErr]     = useState('');
  const [panErr,       setPanErr]       = useState('');
  const [success,      setSuccess]      = useState(null);

  // ✅ Idempotency key generated pre-async in handleConfirm, not inside doActivate
  const idempotencyKey = useRef(newKey());
  const innerRef       = useRef(null);
  const modalRef       = useRef(null);
  const isMobile       = useMemo(checkMobile, []);
  const firstName      = useMemo(() => userName?.split(' ')[0] || 'there', [userName]);

  // ── Fetch prices with retry ────────────────────────────────────
  const fetchPrices = useCallback(() => {
    setPriceLoading(true);
    setPriceError(false);
    subscriptionAPI.getPrices()
      .then(d => setPrices(d?.prices || null))
      .catch(() => setPriceError(true))
      .finally(() => setPriceLoading(false));
  }, []);

  useEffect(() => {
    fetchPrices();
    const t = setTimeout(() => setVisible(true), 80);
    return () => clearTimeout(t);
  }, [fetchPrices]);

  // ✅ Focus trap: inert applied to inner content, modal in Portal
  useEffect(() => {
    if (!showGstModal) return;
    innerRef.current?.setAttribute('inert', '');
    setTimeout(() => modalRef.current?.querySelector('input')?.focus(), 60);
    return () => innerRef.current?.removeAttribute('inert');
  }, [showGstModal]);

  // ── Price helpers ──────────────────────────────────────────────
  const getMonthlyPrice = useCallback(key => prices?.[key]?.monthly ?? null, [prices]);

  const fmtPrice = n => {
    if (n === null) return 'Custom';
    if (n === 0)   return '₹0';
    return `₹${n.toLocaleString('en-IN')}`;
  };

  const annualSaving = key => {
    if (!prices) return null;
    const { monthly, annual } = prices[key] || {};
    if (!monthly || !annual) return null;
    const s = (monthly * 12) - annual;
    return s > 0 ? s : null;
  };

  const selectedPlan  = useMemo(() => PLANS.find(p => p.key === selected), [selected]);
  const selectedPrice = useMemo(() => getMonthlyPrice(selected), [selected, getMonthlyPrice]);

  // ── Keyboard nav on radio grid ─────────────────────────────────
  const handleCardKey = useCallback((e, key) => {
    const keys = PLANS.map(p => p.key);
    const idx  = keys.indexOf(key);
    if (e.key === 'ArrowRight' && idx < keys.length - 1) {
      const next = keys[idx + 1];
      setSelected(next);
      document.getElementById(`ps-card-${next}`)?.focus();
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      const prev = keys[idx - 1];
      setSelected(prev);
      document.getElementById(`ps-card-${prev}`)?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelected(key);
    }
  }, []);

  // ── GST validation ─────────────────────────────────────────────
  const validateGst = useCallback(() => {
    let ok = true;
    if (gstin && !GSTIN_REGEX.test(gstin)) { setGstinErr('Invalid GSTIN (15-char format)'); ok = false; }
    else setGstinErr('');
    if (pan && !PAN_REGEX.test(pan)) { setPanErr('Invalid PAN (10-char format)'); ok = false; }
    else setPanErr('');
    return ok;
  }, [gstin, pan]);

  // ── Confirm handler ────────────────────────────────────────────
  const handleConfirm = useCallback(async () => {
    if (confirming) return;
    setError('');

    // Corporate: prompt GST details first
    if (selected === 'corporate' && !showGstModal) {
      setShowGstModal(true);
      return;
    }

    // ✅ Idempotency key assigned here (pre-async), not inside doActivate
    idempotencyKey.current = newKey();
    await doActivate();
  }, [confirming, selected, showGstModal]); // eslint-disable-line react-hooks/exhaustive-deps

  const doActivate = useCallback(async () => {
    if (!validateGst()) return;
    setConfirming(true);
    setShowGstModal(false);

    try {
      // ── Free plan ──────────────────────────────────────────────
      if (selected === 'free' || selectedPrice === 0) {
        const res = await subscriptionAPI.selectFree('free');
        // ✅ Only proceed on explicit success — no silent catch-activation
        if (!res?.ok) throw new Error(res?.error || 'Free plan activation failed. Please retry.');
        setSuccess({ plan: selected, renewalDate: res?.renewalDate });
        setTimeout(() => onPlanSelected('free'), 2200);
        return;
      }

      // ── Paid plan → Razorpay ───────────────────────────────────
      const loaded = await loadRazorpay();
      if (!loaded) throw new Error('Razorpay failed to load. Please refresh and try again.');

      const order = await subscriptionAPI.createOrder(
        selected, 'monthly', idempotencyKey.current
      );
      if (!order?.orderId) throw new Error('Could not create payment order. Please try again.');

      const options = {
        key:         RAZORPAY_KEY_ID,        // ✅ from env, not order response
        amount:      order.amount,
        currency:    'INR',
        name:        'EtherTrack',
        description: `${selectedPlan.label} Plan — 14-day free trial`,
        order_id:    order.orderId,
        prefill:     { name: userName },
        notes:       { gstin: gstin || '', pan: pan || '' },
        theme:       { color: selectedPlan.color },
        modal: {
          ondismiss: () => setConfirming(false), // ✅ always resets
        },
        handler: async (response) => {
          try {
            const result = await subscriptionAPI.verifyAndActivate(
              selected, 'monthly', response,
              { gstin: gstin || undefined, pan: pan || undefined }
            );
            setSuccess({
              plan:        selected,
              renewalDate: result?.renewalDate,
              invoiceUrl:  result?.invoiceUrl,
            });
            setTimeout(() => onPlanSelected(selected), 3000);
          } catch (e) {
            setError('Payment received but activation failed. Contact support@ethertrack.in immediately.');
            setConfirming(false);
          }
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', r => {
        setError(r.error?.description || 'Payment failed. Please try again.');
        setConfirming(false);
        idempotencyKey.current = newKey(); // fresh key on retry
      });
      rzp.open();

    } catch (e) {
      const isNet = !navigator.onLine || e?.message?.includes('fetch');
      // ✅ Free plan errors are shown — no silent activation
      setError(isNet
        ? 'Network error. Check your connection and try again.'
        : e?.message || e?.error || 'Something went wrong. Please try again.'
      );
      setConfirming(false);
    }
  }, [selected, selectedPrice, selectedPlan, userName, gstin, pan,
      validateGst, onPlanSelected]);

  // ── Success screen ─────────────────────────────────────────────
  if (success) {
    const p = PLANS.find(pl => pl.key === success.plan);
    return (
      <div className="ps-root ps-success-root" aria-live="polite">
        <div className="ps-success">
          <div className="ps-success-icon" aria-hidden="true">🌿</div>
          <h1 className="ps-success-title" style={{ color: p?.color }}>
            {p?.label} Plan Activated!
          </h1>
          <p className="ps-success-sub">
            Your workspace is ready. Redirecting to dashboard…
            {success.renewalDate && (
              <><br />Active until {new Date(success.renewalDate).toLocaleDateString('en-IN', {
                day: '2-digit', month: 'long', year: 'numeric',
              })}</>
            )}
          </p>
          {success.invoiceUrl && (
            <div className="ps-success-invoice">
              📄 GST invoice generated —{' '}
              <a href={success.invoiceUrl} target="_blank" rel="noreferrer">
                Download invoice →
              </a>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="ps-root">
        <div ref={innerRef} className="ps-inner">

          {/* Header */}
          <div className={`ps-top${visible ? ' ps-visible' : ''}`}>
            <div className="ps-eyebrow">✓ KYC verified · Choose your plan</div>
            <h1 className="ps-title">
              Welcome to EtherTrack,<br /><span className="ps-name">{firstName}.</span>
            </h1>
            <p className="ps-sub">
              Your identity is verified. Choose a plan to unlock your workspace.
              You can upgrade or downgrade anytime from Billing.
            </p>
            <p className="ps-skip-note">This step is required to activate your account.</p>
          </div>

          {/* Free tier notice */}
          <div className={`ps-info-note${visible ? ' ps-visible' : ''}`} role="note">
            <span className="ps-info-icon" aria-hidden="true">ℹ</span>
            <span>
              <strong>Free plan:</strong> trade carbon credits on the marketplace immediately — no payment needed.
              Emissions Tracker and Portfolio Management unlock from Starter onwards.
              All paid plans include a <strong>14-day free trial</strong>. All prices exclude 18% GST.
            </span>
          </div>

          {/* Price states */}
          {priceError && (
            <div className="ps-err" role="alert">
              ⚠ Could not load pricing.{' '}
              <button className="ps-retry-btn" onClick={fetchPrices}>Retry →</button>
            </div>
          )}
          {error && <div className="ps-err" role="alert">⚠ {error}</div>}

          {/* Plan grid */}
          <div
            className={`ps-grid${visible ? ' ps-visible' : ''}`}
            role="radiogroup"
            aria-label="Choose a subscription plan"
          >
            {priceLoading
              ? PLANS.map(p => <PlanSkeleton key={p.key} />)
              : PLANS.map(plan => {
                  const isSelected   = selected === plan.key;
                  const monthlyPrice = getMonthlyPrice(plan.key);
                  const saving       = annualSaving(plan.key);

                  return (
                    <button
                      key={plan.key}
                      id={`ps-card-${plan.key}`}
                      className={`ps-card${isSelected ? ' ps-card-selected' : ''}${plan.highlight ? ' ps-card-popular' : ''}`}
                      role="radio"
                      aria-checked={isSelected}
                      aria-label={`${plan.label} plan — ${monthlyPrice !== null ? fmtPrice(monthlyPrice) + '/mo' : 'Custom pricing'}`}
                      onClick={() => { setSelected(plan.key); setError(''); }}
                      onKeyDown={e => handleCardKey(e, plan.key)}
                    >
                      {plan.highlight && (
                        <div className="ps-highlight-badge" style={{ color: plan.color }}>
                          ★ {plan.highlight}
                        </div>
                      )}
                      {isSelected && (
                        <div
                          className="ps-check-dot"
                          style={{ background: plan.color }}
                          aria-hidden="true"
                        >
                          ✓
                        </div>
                      )}

                      <div className="ps-card-tier"  style={{ color: plan.color }}>{plan.label.toUpperCase()}</div>
                      <div className="ps-card-name">{plan.label}</div>
                      <div className="ps-card-tagline" style={{ color: plan.dimColor }}>{plan.tagline}</div>

                      <div className="ps-price-row">
                        <span className="ps-price">{fmtPrice(monthlyPrice)}</span>
                        {monthlyPrice !== null && monthlyPrice > 0 && (
                          <span className="ps-period">/mo</span>
                        )}
                        <div className="ps-gst-note">
                          {monthlyPrice === 0   ? 'Free forever'     :
                           monthlyPrice !== null ? '+ 18% GST'        :
                           'Negotiated annually'}
                        </div>
                        {saving && (
                          <div className="ps-saving" style={{ color: plan.color }}>
                            Annual: save ₹{saving.toLocaleString('en-IN')}/yr
                          </div>
                        )}
                      </div>

                      {/* Locked items (free) */}
                      {(plan.locked || []).map(item => (
                        <div key={item} className="ps-feat ps-feat-locked">
                          <span className="ps-feat-lock-icon" aria-label="Locked">🔒</span>
                          <span>{item}</span>
                          <span className="ps-lock-badge">Upgrade to unlock</span>
                        </div>
                      ))}

                      {/* Unlocked items */}
                      {(plan.unlocked || []).map(item => (
                        <div key={item} className="ps-feat ps-feat-ok">
                          <span style={{ color: plan.color }} aria-hidden="true">✓</span>
                          <span>{item}</span>
                        </div>
                      ))}

                      <div
                        className="ps-select-label"
                        aria-hidden="true"
                        style={isSelected
                          ? { background: plan.color, color: '#040706' }
                          : { borderColor: plan.border, color: plan.dimColor }
                        }
                      >
                        {isSelected ? '✓ Selected' : plan.cta}
                      </div>
                    </button>
                  );
                })
            }
          </div>

          {/* Confirm bar */}
          {prices && (
            <div
              className={`ps-confirm-bar${visible ? ' ps-visible' : ''}`}
              style={{ borderColor: selectedPlan?.border }}
            >
              <div>
                <div className="ps-confirm-label">Selected plan</div>
                <div className="ps-confirm-name" style={{ color: selectedPlan?.color }}>
                  {selectedPlan?.label}
                  {selectedPrice !== null && selectedPrice > 0 && (
                    <span className="ps-confirm-price">
                      {fmtPrice(selectedPrice)}/mo
                    </span>
                  )}
                </div>
                <div className="ps-confirm-meta">
                  {selectedPlan?.seats
                    ? `${selectedPlan.seats} seat${selectedPlan.seats > 1 ? 's' : ''}`
                    : 'Unlimited seats'
                  } · Gas {selectedPlan?.gasFee} ·{' '}
                  {selectedPrice === 0
                    ? 'Free forever — trade immediately, upgrade anytime'
                    : selectedPrice !== null
                      ? '14-day free trial · GST invoice on payment'
                      : "We'll reach out to set up your account"
                  }
                </div>
              </div>

              <button
                className="ps-confirm-btn"
                onClick={handleConfirm}
                disabled={confirming || priceLoading}
                aria-busy={confirming}
              >
                {confirming
                  ? '⟳ Activating…'
                  : selected === 'free'       ? 'Activate free plan →'
                  : selected === 'corporate'  ? 'Contact sales →'
                  : `Start ${selectedPlan?.label} trial →`
                }
              </button>
            </div>
          )}

          <p className="ps-footer-note">
            Paid plans billed in INR · 18% GST added at checkout · GST invoice issued automatically ·
            Cancel anytime · support@ethertrack.in
          </p>
        </div>
      </div>

      {/* GST modal — in Portal so inert on ps-inner doesn't trap it */}
      {showGstModal && (
        <Portal>
          <div
            className="ps-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gst-modal-title"
            onClick={e => e.target === e.currentTarget && setShowGstModal(false)}
          >
            <div className="ps-modal" ref={modalRef}>
              <div className="ps-modal-hdr">
                <span className="ps-modal-title" id="gst-modal-title">
                  GST details — Corporate plan
                </span>
                <button
                  className="ps-modal-close"
                  onClick={() => setShowGstModal(false)}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div className="ps-modal-body">
                <p className="ps-modal-note">
                  For B2B invoicing and input tax credit (ITC) eligibility under CGST rules,
                  provide your organisation's GSTIN and PAN. These appear on your GST-compliant
                  tax invoice. You can skip and add them later from Billing.
                </p>

                <div className="ps-field">
                  <label htmlFor="gst-gstin">GSTIN <span className="ps-optional">(optional)</span></label>
                  <input
                    id="gst-gstin"
                    type="text"
                    value={gstin}
                    onChange={e => { setGstin(e.target.value.toUpperCase()); setGstinErr(''); }}
                    onBlur={() => gstin && !GSTIN_REGEX.test(gstin) && setGstinErr('Invalid GSTIN format (15-char)')}
                    placeholder="22AAAAA0000A1Z5"
                    maxLength={15}
                    autoComplete="off"
                    aria-describedby={gstinErr ? 'gst-gstin-err' : undefined}
                    aria-invalid={!!gstinErr}
                  />
                  {gstinErr && (
                    <div id="gst-gstin-err" className="ps-field-err" role="alert">{gstinErr}</div>
                  )}
                </div>

                <div className="ps-field">
                  <label htmlFor="gst-pan">PAN <span className="ps-optional">(optional)</span></label>
                  <input
                    id="gst-pan"
                    type="text"
                    value={pan}
                    onChange={e => { setPan(e.target.value.toUpperCase()); setPanErr(''); }}
                    onBlur={() => pan && !PAN_REGEX.test(pan) && setPanErr('Invalid PAN format (10-char)')}
                    placeholder="AAAAA0000A"
                    maxLength={10}
                    autoComplete="off"
                    aria-describedby={panErr ? 'gst-pan-err' : undefined}
                    aria-invalid={!!panErr}
                  />
                  {panErr && (
                    <div id="gst-pan-err" className="ps-field-err" role="alert">{panErr}</div>
                  )}
                </div>
              </div>

              <div className="ps-modal-foot">
                <button className="ps-modal-skip" onClick={doActivate}>
                  Skip for now
                </button>
                <button
                  className="ps-modal-confirm"
                  onClick={doActivate}
                  disabled={confirming}
                  aria-busy={confirming}
                >
                  Continue to payment →
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}