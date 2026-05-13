// src/components/PlanSelection.jsx
// Triggered once after KYC completes. Full-screen, cannot be skipped.
// Usage in App.js: after handleKycComplete(), if !plan_selected → show this
//
// Props:
//   onPlanSelected(planKey) — called when user confirms a plan
//   userName — first name for personalised greeting

import React, { useState, useEffect } from 'react';
import { apiFetch } from '../services/api';

const PLANS = [
  {
    key: 'free',
    label: 'Free',
    price: 0,
    priceLabel: '₹0',
    period: '',
    tagline: 'Start exploring',
    color: '#86efac',
    dimColor: '#86efac44',
    bg: '#0a1a0e',
    border: '#22c55e22',
    gasFee: '1%',
    seats: 1,
    highlight: null,
    features: [
      { text: 'Emissions tracking (3 sources)', ok: true },
      { text: 'Portfolio — view only', ok: false },
      { text: 'Marketplace browse only', ok: false },
      { text: 'Buy / sell credits', ok: false },
      { text: 'CSV / PDF exports', ok: false },
      { text: 'Team management', ok: false },
    ],
    cta: 'START FREE',
  },
  {
    key: 'starter',
    label: 'Starter',
    price: 1999,
    priceLabel: '₹1,999',
    period: '/mo',
    tagline: 'For MSMEs & NGOs',
    color: '#60a5fa',
    dimColor: '#60a5fa44',
    bg: '#060e18',
    border: '#60a5fa22',
    gasFee: '1%',
    seats: 3,
    highlight: null,
    features: [
      { text: 'Unlimited emissions tracking', ok: true },
      { text: 'Portfolio (up to 10 credits)', ok: true },
      { text: 'Buy credits on marketplace', ok: true },
      { text: 'Sell credits', ok: false },
      { text: 'CSV exports', ok: true },
      { text: 'Team management', ok: false },
    ],
    cta: 'CHOOSE STARTER',
  },
  {
    key: 'growth',
    label: 'Growth',
    price: 5999,
    priceLabel: '₹5,999',
    period: '/mo',
    tagline: 'Most popular',
    color: '#22c55e',
    dimColor: '#22c55e66',
    bg: '#0a1a0e',
    border: '#22c55e55',
    gasFee: '0.75%',
    seats: 10,
    highlight: 'MOST POPULAR',
    features: [
      { text: 'Unlimited emissions tracking', ok: true },
      { text: 'Portfolio (up to 100 credits)', ok: true },
      { text: 'Buy + sell on marketplace', ok: true },
      { text: 'CSV + PDF exports', ok: true },
      { text: 'Basic team roles (5 seats)', ok: true },
      { text: 'Basic MIS reports', ok: true },
    ],
    cta: 'CHOOSE GROWTH',
  },
  {
    key: 'corporate',
    label: 'Corporate',
    price: 18999,
    priceLabel: '₹18,999',
    period: '/mo',
    tagline: 'For listed companies',
    color: '#f97316',
    dimColor: '#f9731644',
    bg: '#1a0a00',
    border: '#f9731633',
    gasFee: '0.6%',
    seats: 50,
    highlight: null,
    features: [
      { text: 'Unlimited everything', ok: true },
      { text: 'BRSR / CDP / TCFD reports', ok: true },
      { text: 'Buy + sell on marketplace', ok: true },
      { text: 'Full RBAC team management', ok: true },
      { text: 'Verifier badge (BV, DNV, EY…)', ok: true },
      { text: 'Dedicated account manager', ok: true },
    ],
    cta: 'CHOOSE CORPORATE',
  },
  {
    key: 'enterprise',
    label: 'Enterprise',
    price: null,
    priceLabel: 'Custom',
    period: '',
    tagline: 'For conglomerates',
    color: '#a78bfa',
    dimColor: '#a78bfa44',
    bg: '#120a28',
    border: '#a78bfa33',
    gasFee: '0.5%+',
    seats: null,
    highlight: null,
    features: [
      { text: 'Everything in Corporate', ok: true },
      { text: 'White-label reports', ok: true },
      { text: 'REST API + webhooks', ok: true },
      { text: 'Unlimited seats + SSO', ok: true },
      { text: 'Volume gas fee discounts', ok: true },
      { text: 'SLA guarantee', ok: true },
    ],
    cta: 'CONTACT SALES',
  },
];

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}

  .ps-root{
    position:fixed;inset:0;z-index:9000;
    background:#040706;
    font-family:'DM Mono',monospace;
    color:#f0fdf4;
    overflow-y:auto;
    animation:psFadeIn .4s ease;
  }
  @keyframes psFadeIn{from{opacity:0;}to{opacity:1;}}

  .ps-inner{
    min-height:100vh;
    display:flex;flex-direction:column;
    align-items:center;
    padding:48px 24px 80px;
  }

  .ps-top{text-align:center;margin-bottom:48px;max-width:600px;}
  .ps-eyebrow{
    font-size:9px;letter-spacing:.25em;color:#86efac44;
    margin-bottom:12px;
  }
  .ps-title{
    font-family:'Syne',sans-serif;font-size:36px;font-weight:800;
    color:#f0fdf4;line-height:1.1;margin-bottom:10px;
  }
  .ps-title span{color:#22c55e;}
  .ps-sub{
    font-size:11px;color:#86efac44;line-height:1.9;
    letter-spacing:.04em;
  }

  .ps-skip-note{
    font-size:9px;color:#86efac22;margin-top:10px;letter-spacing:.08em;
  }

  .ps-grid{
    display:grid;
    grid-template-columns:repeat(5,1fr);
    gap:12px;
    width:100%;
    max-width:1160px;
    margin-bottom:32px;
  }

  .ps-card{
    border-radius:16px;
    border:1px solid #0d1f11;
    background:#070c09;
    padding:22px 16px 20px;
    display:flex;flex-direction:column;
    cursor:pointer;
    transition:transform .2s, border-color .2s, box-shadow .2s;
    position:relative;
    user-select:none;
  }
  .ps-card:hover{transform:translateY(-3px);}
  .ps-card.selected{transform:translateY(-4px);}

  .ps-highlight-badge{
    position:absolute;top:-11px;left:50%;transform:translateX(-50%);
    font-size:8px;letter-spacing:.12em;font-weight:700;
    padding:3px 12px;border-radius:4px;white-space:nowrap;
  }

  .ps-card-tier{
    font-size:9px;letter-spacing:.16em;font-weight:700;
    margin-bottom:6px;
  }
  .ps-card-name{
    font-family:'Syne',sans-serif;font-size:20px;font-weight:800;
    color:#f0fdf4;margin-bottom:2px;
  }
  .ps-card-tagline{
    font-size:9px;letter-spacing:.06em;margin-bottom:16px;
  }

  .ps-price-row{margin-bottom:16px;}
  .ps-price{
    font-family:'Syne',sans-serif;font-size:26px;font-weight:800;color:#f0fdf4;
  }
  .ps-period{font-size:10px;color:#86efac44;margin-left:3px;}
  .ps-gst{font-size:9px;color:#86efac22;margin-top:2px;}

  .ps-chips{display:flex;flex-direction:column;gap:5px;margin-bottom:16px;}
  .ps-chip{
    display:flex;align-items:center;gap:6px;
    font-size:9px;padding:5px 8px;border-radius:5px;
    background:#050809;border:1px solid #0d1f11;color:#86efac33;
  }
  .ps-chip-val{margin-left:auto;font-weight:700;}

  .ps-divider{border:none;border-top:1px solid #0d1f11;margin:12px 0;}

  .ps-feats{display:flex;flex-direction:column;gap:5px;flex:1;margin-bottom:18px;}
  .ps-feat{display:flex;align-items:flex-start;gap:6px;font-size:10px;line-height:1.4;}
  .ps-feat-ok{color:#d1fae5;}
  .ps-feat-no{color:#86efac22;}
  .ps-feat-icon{font-size:11px;flex-shrink:0;margin-top:1px;}

  .ps-select-btn{
    width:100%;padding:11px 0;border-radius:9px;border:none;
    font-family:'DM Mono',monospace;font-size:10px;
    letter-spacing:.1em;font-weight:700;cursor:pointer;
    transition:all .2s;
  }

  /* Confirm bar */
  .ps-confirm-bar{
    width:100%;max-width:1160px;
    background:#070c09;border:1px solid #0d1f11;
    border-radius:14px;padding:20px 28px;
    display:flex;align-items:center;justify-content:space-between;
    gap:20px;flex-wrap:wrap;
    position:sticky;bottom:24px;
  }
  .ps-confirm-left{}
  .ps-confirm-plan-label{font-size:9px;color:#86efac44;letter-spacing:.12em;margin-bottom:4px;}
  .ps-confirm-plan-name{font-size:16px;font-weight:700;font-family:'Syne',sans-serif;}
  .ps-confirm-plan-meta{font-size:10px;color:#86efac44;margin-top:2px;}
  .ps-confirm-btn{
    padding:14px 32px;border-radius:10px;border:none;
    font-family:'DM Mono',monospace;font-size:11px;
    letter-spacing:.12em;font-weight:700;cursor:pointer;
    background:linear-gradient(135deg,#14532d,#166534);
    color:#d1fae5;transition:all .2s;white-space:nowrap;
    flex-shrink:0;
  }
  .ps-confirm-btn:hover{background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;}
  .ps-confirm-btn:disabled{opacity:.5;cursor:not-allowed;}

  .ps-gst-note{
    text-align:center;font-size:9px;color:#86efac22;
    letter-spacing:.06em;margin-top:12px;
  }

  /* Comparison note */
  .ps-compare-note{
    width:100%;max-width:1160px;
    padding:14px 20px;
    background:#070c09;border:1px solid #0d1f11;border-radius:10px;
    font-size:10px;color:#86efac33;line-height:1.9;
    margin-bottom:16px;
    display:flex;align-items:flex-start;gap:12px;
  }
  .ps-compare-note-icon{font-size:16px;flex-shrink:0;margin-top:1px;}

  @media(max-width:1000px){.ps-grid{grid-template-columns:repeat(3,1fr);}}
  @media(max-width:680px){
    .ps-grid{grid-template-columns:1fr 1fr;}
    .ps-title{font-size:26px;}
  }
  @media(max-width:440px){.ps-grid{grid-template-columns:1fr;}}
`;

export default function PlanSelection({ onPlanSelected, userName = 'there' }) {
  const [selected, setSelected] = useState('free');
  const [confirming, setConfirming] = useState(false);
  const [step, setStep] = useState(0); // entrance animation

  useEffect(() => {
    const t = setTimeout(() => setStep(1), 100);
    return () => clearTimeout(t);
  }, []);

  const selectedPlan = PLANS.find(p => p.key === selected);

  const handleConfirm = async () => {
    if (confirming) return;

    if (selected === 'enterprise') {
      window.location.href = 'mailto:hello@ethertrack.in?subject=Enterprise Plan Enquiry';
      return;
    }

    setConfirming(true);
    try {
      await apiFetch('/api/org/plan/select', {
        method: 'POST',
        body: JSON.stringify({ plan: selected }),
      });
      onPlanSelected(selected);
    } catch (e) {
      // Even if API fails, let user through — plan can be reconciled later
      console.warn('Plan selection API failed:', e?.message);
      onPlanSelected(selected);
    } finally {
      setConfirming(false);
    }
  };

  const firstName = userName?.split(' ')[0] || 'there';

  return (
    <>
      <style>{CSS}</style>
      <div className="ps-root">
        <div className="ps-inner">

          {/* Header */}
          <div className="ps-top" style={{ opacity: step ? 1 : 0, transform: step ? 'none' : 'translateY(12px)', transition: 'all .5s ease' }}>
            <div className="ps-eyebrow">✓ KYC VERIFIED · CHOOSE YOUR PLAN</div>
            <h1 className="ps-title">
              Welcome to EtherTrack,<br />
              <span>{firstName}.</span>
            </h1>
            <p className="ps-sub">
              Your identity is verified. Choose a plan to unlock your workspace.<br />
              You can upgrade or downgrade anytime from Settings.
            </p>
            <div className="ps-skip-note">This step is required to activate your account.</div>
          </div>

          {/* Info note */}
          <div className="ps-compare-note" style={{ opacity: step ? 1 : 0, transition: 'all .6s ease .1s' }}>
            <span className="ps-compare-note-icon">ℹ</span>
            <span>
              All paid plans include a <strong style={{ color: '#d1fae5' }}>14-day free trial</strong> — no card required to start.
              Marketplace gas fees (charged per transaction) depend on your plan tier and are separate from the subscription.
              All prices exclude 18% GST.
            </span>
          </div>

          {/* Plan cards */}
          <div className="ps-grid" style={{ opacity: step ? 1 : 0, transition: 'all .6s ease .15s' }}>
            {PLANS.map(plan => {
              const isSelected = selected === plan.key;
              return (
                <div
                  key={plan.key}
                  className={`ps-card${isSelected ? ' selected' : ''}`}
                  style={{
                    borderColor: isSelected ? plan.border.replace('22', '99').replace('33', '88').replace('44', '99') : '#0d1f11',
                    background: isSelected ? plan.bg : '#070c09',
                    boxShadow: isSelected ? `0 0 0 1px ${plan.border}` : 'none',
                  }}
                  onClick={() => setSelected(plan.key)}
                >
                  {plan.highlight && (
                    <div
                      className="ps-highlight-badge"
                      style={{ background: plan.bg, color: plan.color, border: `1px solid ${plan.border}` }}
                    >
                      ★ {plan.highlight}
                    </div>
                  )}

                  {/* Selected checkmark */}
                  {isSelected && (
                    <div style={{
                      position: 'absolute', top: 14, right: 14,
                      width: 20, height: 20, borderRadius: '50%',
                      background: plan.color, display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, color: '#040706', fontWeight: 700,
                    }}>✓</div>
                  )}

                  <div className="ps-card-tier" style={{ color: plan.color }}>{plan.label.toUpperCase()}</div>
                  <div className="ps-card-name">{plan.label}</div>
                  <div className="ps-card-tagline" style={{ color: plan.dimColor }}>{plan.tagline}</div>

                  <div className="ps-price-row">
                    <span className="ps-price">{plan.priceLabel}</span>
                    {plan.period && <span className="ps-period">{plan.period}</span>}
                    <div className="ps-gst">{plan.price ? '+ 18% GST' : plan.price === 0 ? 'No card needed' : 'Negotiated annually'}</div>
                  </div>

                  <div className="ps-chips">
                    <div className="ps-chip" style={{ borderColor: plan.border }}>
                      <span>⛽ Gas fee</span>
                      <span className="ps-chip-val" style={{ color: plan.color }}>{plan.gasFee}</span>
                    </div>
                    <div className="ps-chip" style={{ borderColor: plan.border }}>
                      <span>👥 Seats</span>
                      <span className="ps-chip-val" style={{ color: plan.color }}>
                        {plan.seats ? plan.seats : '∞'}
                      </span>
                    </div>
                  </div>

                  <hr className="ps-divider" />

                  <div className="ps-feats">
                    {plan.features.map((feat, i) => (
                      <div key={i} className="ps-feat">
                        <span className="ps-feat-icon">
                          {feat.ok
                            ? <span style={{ color: plan.color }}>✓</span>
                            : <span style={{ color: '#86efac11' }}>—</span>
                          }
                        </span>
                        <span className={feat.ok ? 'ps-feat-ok' : 'ps-feat-no'}>
                          {feat.text}
                        </span>
                      </div>
                    ))}
                  </div>

                  <button
                    className="ps-select-btn"
                    style={isSelected ? {
                      background: plan.color,
                      color: '#040706',
                      fontWeight: 700,
                    } : {
                      background: '#050809',
                      border: `1px solid ${plan.border}`,
                      color: plan.dimColor,
                    }}
                    onClick={e => { e.stopPropagation(); setSelected(plan.key); }}
                  >
                    {isSelected ? '✓ SELECTED' : plan.cta}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Confirm bar */}
          <div className="ps-confirm-bar" style={{
            borderColor: selectedPlan.border,
            opacity: step ? 1 : 0,
            transition: 'all .6s ease .2s',
          }}>
            <div className="ps-confirm-left">
              <div className="ps-confirm-plan-label">SELECTED PLAN</div>
              <div className="ps-confirm-plan-name" style={{ color: selectedPlan.color }}>
                {selectedPlan.label}
                {selectedPlan.price > 0 && (
                  <span style={{ fontSize: 13, color: '#86efac44', fontFamily: "'DM Mono',monospace", marginLeft: 10 }}>
                    {selectedPlan.priceLabel}{selectedPlan.period}
                  </span>
                )}
              </div>
              <div className="ps-confirm-plan-meta">
                {selectedPlan.seats ? `${selectedPlan.seats} seat${selectedPlan.seats > 1 ? 's' : ''}` : 'Unlimited seats'} ·
                Gas fee {selectedPlan.gasFee} ·
                {selectedPlan.price === 0
                  ? ' Free forever — upgrade anytime'
                  : selectedPlan.price
                    ? ' 14-day free trial · No card required'
                    : ' We\'ll reach out to set up your account'
                }
              </div>
            </div>

            <button
              className="ps-confirm-btn"
              onClick={handleConfirm}
              disabled={confirming}
              style={selectedPlan.key !== 'free' && selectedPlan.key !== 'enterprise' ? {} : {
                background: selectedPlan.key === 'enterprise'
                  ? 'linear-gradient(135deg,#2d1a5c,#3d2080)'
                  : 'linear-gradient(135deg,#14532d,#166534)',
              }}
            >
              {confirming
                ? '⟳ ACTIVATING…'
                : selectedPlan.key === 'enterprise'
                  ? 'CONTACT SALES →'
                  : selectedPlan.key === 'free'
                    ? 'ACTIVATE FREE PLAN →'
                    : `START ${selectedPlan.label.toUpperCase()} TRIAL →`
              }
            </button>
          </div>

          <div className="ps-gst-note">
            Paid plans billed in INR · 18% GST added at checkout · Cancel anytime · hello@ethertrack.in
          </div>

        </div>
      </div>
    </>
  );
}