// src/components/SubscriptionBilling.jsx — EtherTrack Subscription & Billing Tab
// Drop this into your existing TeamManagement tabs, or use as standalone route

import React, { useState } from 'react';

// ── Static data ─────────────────────────────────────────────────────────────

const PLANS = [
  {
    key: 'free',
    label: 'Free',
    price: 0,
    period: null,
    tagline: 'Explore EtherTrack',
    audience: 'Students, individuals, explorers',
    color: '#86efac',
    bg: '#0a1a0e',
    border: '#22c55e22',
    seats: 1,
    gasFee: '1%',
    features: {
      emissions: { val: '3 sources', ok: true },
      portfolio: { val: 'View only', ok: false },
      marketplace_buy: { val: false, ok: false },
      marketplace_sell: { val: false, ok: false },
      exports: { val: false, ok: false },
      reports: { val: false, ok: false },
      team: { val: false, ok: false },
      verifier: { val: false, ok: false },
      api: { val: false, ok: false },
      support: { val: 'Community', ok: true },
    },
  },
  {
    key: 'starter',
    label: 'Starter',
    price: 1999,
    period: 'mo',
    tagline: 'For MSMEs & NGOs',
    audience: 'Unlisted SMEs, NGOs, CA consultants',
    color: '#60a5fa',
    bg: '#060e18',
    border: '#60a5fa22',
    seats: 3,
    gasFee: '1%',
    features: {
      emissions: { val: 'Unlimited sources', ok: true },
      portfolio: { val: 'Up to 10 credits', ok: true },
      marketplace_buy: { val: 'Buy credits', ok: true },
      marketplace_sell: { val: false, ok: false },
      exports: { val: 'CSV only', ok: true },
      reports: { val: false, ok: false },
      team: { val: false, ok: false },
      verifier: { val: false, ok: false },
      api: { val: false, ok: false },
      support: { val: 'Email support', ok: true },
    },
  },
  {
    key: 'growth',
    label: 'Growth',
    price: 5999,
    period: 'mo',
    tagline: 'Most popular',
    audience: 'Growing businesses, active traders',
    color: '#22c55e',
    bg: '#0a1a0e',
    border: '#22c55e44',
    seats: 10,
    gasFee: '0.75%',
    popular: true,
    features: {
      emissions: { val: 'Unlimited sources', ok: true },
      portfolio: { val: 'Up to 100 credits', ok: true },
      marketplace_buy: { val: 'Buy credits', ok: true },
      marketplace_sell: { val: 'Sell credits', ok: true },
      exports: { val: 'CSV + PDF', ok: true },
      reports: { val: 'Basic MIS reports', ok: true },
      team: { val: 'Viewer + Manager roles', ok: true },
      verifier: { val: false, ok: false },
      api: { val: false, ok: false },
      support: { val: 'Priority email', ok: true },
    },
  },
  {
    key: 'corporate',
    label: 'Corporate',
    price: 18999,
    period: 'mo',
    tagline: 'For listed companies',
    audience: 'BRSR filers, ESG teams, listed cos.',
    color: '#f97316',
    bg: '#1a0a00',
    border: '#f9731633',
    seats: 50,
    gasFee: '0.6%',
    features: {
      emissions: { val: 'Unlimited sources', ok: true },
      portfolio: { val: 'Unlimited credits', ok: true },
      marketplace_buy: { val: 'Buy credits', ok: true },
      marketplace_sell: { val: 'Sell credits', ok: true },
      exports: { val: 'CSV + PDF + Excel', ok: true },
      reports: { val: 'BRSR / CDP / TCFD', ok: true },
      team: { val: 'Full RBAC (all roles)', ok: true },
      verifier: { val: 'BV, DNV, EY, Deloitte…', ok: true },
      api: { val: false, ok: false },
      support: { val: 'Dedicated manager', ok: true },
    },
  },
  {
    key: 'enterprise',
    label: 'Enterprise',
    price: null,
    period: null,
    tagline: 'Custom pricing',
    audience: 'Conglomerates, brokers, consultancies',
    color: '#a78bfa',
    bg: '#120a28',
    border: '#a78bfa33',
    seats: null,
    gasFee: '0.5% + vol. discount',
    features: {
      emissions: { val: 'Unlimited sources', ok: true },
      portfolio: { val: 'Unlimited credits', ok: true },
      marketplace_buy: { val: 'Buy credits', ok: true },
      marketplace_sell: { val: 'Sell + bulk list', ok: true },
      exports: { val: 'All formats + white-label', ok: true },
      reports: { val: 'All + custom templates', ok: true },
      team: { val: 'Unlimited seats + SSO', ok: true },
      verifier: { val: 'Custom integrations', ok: true },
      api: { val: 'REST API + webhooks', ok: true },
      support: { val: 'SLA + dedicated team', ok: true },
    },
  },
];

const FEATURE_ROWS = [
  { key: 'emissions',        label: 'Emissions tracking' },
  { key: 'portfolio',        label: 'Portfolio management' },
  { key: 'marketplace_buy',  label: 'Marketplace — buy' },
  { key: 'marketplace_sell', label: 'Marketplace — sell' },
  { key: 'exports',          label: 'Data exports' },
  { key: 'reports',          label: 'Compliance reports' },
  { key: 'team',             label: 'Team management' },
  { key: 'verifier',         label: 'Verifier badge' },
  { key: 'api',              label: 'API / webhooks' },
  { key: 'support',          label: 'Support' },
];

const GAS_FEE_CONTEXT = [
  { range: '₹0 – ₹1L / txn', tier1: '₹0 – ₹1,000', tier2: '₹0 – ₹750', tier3: '₹0 – ₹600', tier4: '₹0 – ₹500' },
  { range: '₹5L / txn', tier1: '₹5,000', tier2: '₹3,750', tier3: '₹3,000', tier4: '₹2,500' },
  { range: '₹25L / txn', tier1: '₹25,000', tier2: '₹18,750', tier3: '₹15,000', tier4: '₹12,500' },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function SubscriptionBilling({ currentPlan = 'growth', orgName = 'Acme Corp' }) {
  const [billingCycle, setBillingCycle] = useState('monthly'); // monthly | annual
  const [hoveredPlan, setHoveredPlan] = useState(null);
  const [showMatrix, setShowMatrix] = useState(false);
  const [showGasCalc, setShowGasCalc] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const annualDiscount = 0.17; // 17% off = ~2 months free
  const getPrice = (plan) => {
    if (!plan.price) return null;
    if (billingCycle === 'annual') return Math.round(plan.price * (1 - annualDiscount));
    return plan.price;
  };

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
    *{box-sizing:border-box;}
    .sb{min-height:100vh;background:#040706;font-family:'DM Mono',monospace;color:#f0fdf4;padding:32px 24px 80px;}
    .sbw{max-width:1140px;margin:0 auto;}

    .sb-hdr{margin-bottom:28px;}
    .sb-hdr-label{font-size:9px;color:#86efac44;letter-spacing:.2em;margin-bottom:6px;}
    .sb-hdr-title{font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:#f0fdf4;margin:0;}
    .sb-hdr-title span{color:#22c55e;}
    .sb-hdr-sub{font-size:10px;color:#86efac33;letter-spacing:.08em;margin-top:4px;}

    .sb-current-banner{
      display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;
      background:#070c09;border:1px solid #22c55e22;border-radius:10px;
      padding:14px 20px;margin-bottom:24px;
    }
    .sb-current-left{display:flex;align-items:center;gap:12px;}
    .sb-current-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;flex-shrink:0;}
    .sb-current-label{font-size:9px;color:#86efac44;letter-spacing:.12em;margin-bottom:2px;}
    .sb-current-name{font-size:13px;color:#f0fdf4;font-weight:600;}
    .sb-current-meta{font-size:10px;color:#86efac44;margin-left:8px;}
    .sb-renewal{font-size:10px;color:#86efac33;text-align:right;}

    .sb-cycle-toggle{
      display:flex;align-items:center;gap:0;
      background:#070c09;border:1px solid #0d1f11;border-radius:8px;
      overflow:hidden;margin-bottom:24px;width:fit-content;
    }
    .sb-cycle-btn{
      padding:8px 20px;font-family:'DM Mono',monospace;font-size:10px;
      letter-spacing:.1em;font-weight:700;border:none;cursor:pointer;
      background:transparent;color:#86efac44;transition:all .2s;
    }
    .sb-cycle-btn.on{background:#0a1a0e;color:#22c55e;}
    .sb-cycle-badge{
      font-size:8px;padding:2px 6px;border-radius:3px;
      background:#22c55e22;color:#22c55e;margin-left:6px;letter-spacing:.06em;
    }

    .sb-plans-grid{
      display:grid;
      grid-template-columns:repeat(5,1fr);
      gap:10px;margin-bottom:32px;
    }
    .sb-plan-card{
      background:#070c09;border:1px solid #0d1f11;
      border-radius:14px;padding:20px 16px;
      display:flex;flex-direction:column;gap:0;
      position:relative;transition:border-color .25s,transform .2s;
      cursor:default;
    }
    .sb-plan-card:hover{transform:translateY(-2px);}
    .sb-plan-card.current{border-color:#22c55e44;}
    .sb-plan-card.popular-card{border-color:#22c55e66;}

    .sb-popular-badge{
      position:absolute;top:-10px;left:50%;transform:translateX(-50%);
      background:#14532d;border:1px solid #22c55e33;border-radius:4px;
      font-size:8px;color:#22c55e;letter-spacing:.1em;padding:3px 10px;
      white-space:nowrap;font-weight:700;
    }
    .sb-current-badge{
      position:absolute;top:-10px;left:50%;transform:translateX(-50%);
      background:#0a1628;border:1px solid #60a5fa22;border-radius:4px;
      font-size:8px;color:#60a5fa88;letter-spacing:.1em;padding:3px 10px;
      white-space:nowrap;
    }

    .sb-plan-tier{font-size:9px;letter-spacing:.15em;font-weight:700;margin-bottom:8px;}
    .sb-plan-name{font-family:'Syne',sans-serif;font-size:18px;font-weight:800;color:#f0fdf4;margin-bottom:2px;}
    .sb-plan-tagline{font-size:9px;color:#86efac33;letter-spacing:.06em;margin-bottom:12px;}
    .sb-plan-audience{font-size:10px;color:#86efac44;line-height:1.6;margin-bottom:14px;min-height:32px;}

    .sb-plan-price-row{margin-bottom:4px;}
    .sb-plan-price{font-family:'Syne',sans-serif;font-size:24px;font-weight:800;color:#f0fdf4;}
    .sb-plan-price-period{font-size:10px;color:#86efac44;margin-left:4px;}
    .sb-plan-price-annual{font-size:9px;color:#86efac33;margin-bottom:12px;}

    .sb-gas-chip{
      display:flex;align-items:center;gap:6px;
      padding:5px 8px;border-radius:5px;
      background:#050809;border:1px solid #0d1f11;
      font-size:9px;color:#86efac44;margin-bottom:12px;
    }
    .sb-gas-val{font-weight:700;margin-left:auto;}

    .sb-seats-row{font-size:9px;color:#86efac44;margin-bottom:14px;display:flex;align-items:center;gap:5px;}

    .sb-divider{border:none;border-top:1px solid #0d1f11;margin:12px 0;}

    .sb-feat-list{display:flex;flex-direction:column;gap:6px;flex:1;margin-bottom:14px;}
    .sb-feat{display:flex;align-items:flex-start;gap:6px;font-size:10px;line-height:1.4;}
    .sb-feat-icon{font-size:11px;flex-shrink:0;margin-top:1px;}
    .sb-feat-text{color:#86efac66;}
    .sb-feat-text.ok{color:#d1fae5;}
    .sb-feat-text.no{color:#86efac22;}

    .sb-plan-cta{
      width:100%;padding:10px 0;border-radius:8px;border:none;
      font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.1em;
      font-weight:700;cursor:pointer;transition:all .2s;
    }
    .sb-plan-cta.current-cta{
      background:#0a1a0e;border:1px solid #22c55e22;color:#22c55e66;
      cursor:default;
    }
    .sb-plan-cta.upgrade-cta{
      background:linear-gradient(135deg,#14532d,#166534);color:#d1fae5;
    }
    .sb-plan-cta.upgrade-cta:hover{background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;}
    .sb-plan-cta.downgrade-cta{
      background:#060a07;border:1px solid #0d1f11;color:#86efac33;
    }
    .sb-plan-cta.downgrade-cta:hover{border-color:#22c55e22;color:#86efac66;}
    .sb-plan-cta.contact-cta{
      background:#0d0a1a;border:1px solid #a78bfa33;color:#a78bfa88;
    }
    .sb-plan-cta.contact-cta:hover{border-color:#a78bfa66;color:#a78bfa;}

    .sb-section-hdr{
      display:flex;align-items:center;justify-content:space-between;
      margin-bottom:16px;flex-wrap:wrap;gap:10px;
    }
    .sb-section-title{font-size:9px;color:#86efac44;letter-spacing:.15em;display:flex;align-items:center;gap:8px;}
    .sb-section-title::before{content:'';width:14px;height:1px;background:#22c55e;}
    .sb-toggle-btn{
      padding:6px 14px;border-radius:6px;border:1px solid #0d1f11;
      background:#060a07;font-family:'DM Mono',monospace;font-size:9px;
      letter-spacing:.08em;color:#86efac33;cursor:pointer;transition:all .2s;
    }
    .sb-toggle-btn:hover{border-color:#22c55e22;color:#22c55e66;}

    .sb-matrix-wrap{
      background:#070c09;border:1px solid #0d1f11;border-radius:12px;
      overflow:auto;margin-bottom:24px;
    }
    .sb-matrix-table{width:100%;border-collapse:collapse;font-size:10px;min-width:700px;}
    .sb-matrix-table th{
      padding:10px 14px;text-align:left;font-weight:500;font-size:9px;
      color:#86efac44;background:#050809;border-bottom:1px solid #0d1f11;
      letter-spacing:.1em;white-space:nowrap;
    }
    .sb-matrix-table th:not(:first-child){text-align:center;}
    .sb-matrix-table td{
      padding:10px 14px;border-bottom:1px solid #0d1f1166;
      color:#86efac66;vertical-align:middle;
    }
    .sb-matrix-table td:not(:first-child){text-align:center;}
    .sb-matrix-table tr:last-child td{border-bottom:none;}
    .sb-matrix-table tr:hover td{background:#050809;}
    .sb-matrix-table td:first-child{color:#d1fae5;font-weight:500;}
    .sb-check{color:#22c55e;font-size:13px;}
    .sb-cross{color:#86efac11;font-size:13px;}
    .sb-partial{
      font-size:9px;font-weight:700;padding:2px 7px;border-radius:3px;
      display:inline-block;white-space:nowrap;
    }

    .sb-gas-section{
      background:#070c09;border:1px solid #0d1f11;border-radius:12px;
      padding:20px;margin-bottom:24px;
    }
    .sb-gas-intro{font-size:10px;color:#86efac44;line-height:1.8;margin-bottom:16px;}
    .sb-gas-tiers{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;}
    .sb-gas-tier-card{
      border-radius:8px;padding:14px;border:1px solid #0d1f11;
      background:#050809;text-align:center;
    }
    .sb-gas-tier-name{font-size:9px;letter-spacing:.1em;font-weight:700;margin-bottom:6px;}
    .sb-gas-tier-pct{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:#f0fdf4;margin-bottom:2px;}
    .sb-gas-tier-note{font-size:9px;color:#86efac33;line-height:1.5;}
    .sb-gas-table-wrap{overflow-x:auto;}
    .sb-gas-table{width:100%;border-collapse:collapse;font-size:10px;}
    .sb-gas-table th{
      padding:8px 12px;text-align:left;font-size:9px;color:#86efac44;
      letter-spacing:.1em;border-bottom:1px solid #0d1f11;background:#050809;
    }
    .sb-gas-table td{
      padding:8px 12px;border-bottom:1px solid #0d1f1144;color:#86efac66;
    }
    .sb-gas-table td:first-child{color:#d1fae5;}
    .sb-gas-table tr:last-child td{border-bottom:none;}

    .sb-faq{background:#070c09;border:1px solid #0d1f11;border-radius:12px;overflow:hidden;margin-bottom:24px;}
    .sb-faq-item{border-bottom:1px solid #0d1f11;}
    .sb-faq-item:last-child{border-bottom:none;}
    .sb-faq-q{
      width:100%;text-align:left;padding:14px 20px;
      background:transparent;border:none;font-family:'DM Mono',monospace;
      font-size:11px;color:#d1fae5;cursor:pointer;display:flex;
      align-items:center;justify-content:space-between;
    }
    .sb-faq-q:hover{background:#050809;}
    .sb-faq-q-icon{font-size:14px;color:#22c55e;flex-shrink:0;transition:transform .2s;}
    .sb-faq-q-icon.open{transform:rotate(45deg);}
    .sb-faq-a{font-size:10px;color:#86efac44;line-height:1.9;padding:0 20px 14px;}

    .sb-toast{
      position:fixed;bottom:24px;right:24px;z-index:9999;
      background:#070c09;border-radius:8px;padding:12px 20px;
      font-size:11px;font-family:'DM Mono',monospace;letter-spacing:.06em;
      box-shadow:0 8px 32px rgba(0,0,0,.8);animation:sbFadeIn .25s ease;
    }
    @keyframes sbFadeIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}

    @media(max-width:900px){
      .sb-plans-grid{grid-template-columns:repeat(2,1fr);}
      .sb-gas-tiers{grid-template-columns:repeat(2,1fr);}
    }
    @media(max-width:560px){
      .sb-plans-grid{grid-template-columns:1fr;}
      .sb-gas-tiers{grid-template-columns:1fr 1fr;}
    }
  `;

  const currentPlanData = PLANS.find(p => p.key === currentPlan);
  const currentPlanIndex = PLANS.findIndex(p => p.key === currentPlan);

  const getCtaLabel = (plan, idx) => {
    if (plan.key === currentPlan) return '✓ CURRENT PLAN';
    if (plan.key === 'enterprise') return 'CONTACT SALES →';
    if (idx > currentPlanIndex) return 'UPGRADE →';
    return 'DOWNGRADE';
  };

  const getCtaClass = (plan, idx) => {
    if (plan.key === currentPlan) return 'current-cta';
    if (plan.key === 'enterprise') return 'contact-cta';
    if (idx > currentPlanIndex) return 'upgrade-cta';
    return 'downgrade-cta';
  };

  const [openFaq, setOpenFaq] = useState(null);
  const FAQS = [
    {
      q: 'Can I switch plans anytime?',
      a: 'Yes. Upgrades are effective immediately and prorated for the remaining billing period. Downgrades take effect at the end of your current billing cycle so you keep access to your current features until then.',
    },
    {
      q: 'What is the marketplace gas fee?',
      a: 'Every credit transaction on the EtherTrack marketplace incurs a gas fee — charged to the seller at the time of a completed sale. The fee rate depends on your plan: 1% on Free/Starter, 0.75% on Growth, 0.6% on Corporate, and 0.5% (or lower with volume) on Enterprise.',
    },
    {
      q: 'Is GST included in the listed prices?',
      a: 'No. All listed prices are exclusive of GST. 18% GST will be added at checkout as per Indian tax regulations. A GST invoice will be issued to your registered GSTIN every billing cycle.',
    },
    {
      q: 'What happens to my data if I cancel?',
      a: 'Your emissions data, portfolio records, and transaction history are retained for 90 days after cancellation. You can export everything as CSV or PDF before or during that window. After 90 days, data is permanently deleted.',
    },
    {
      q: 'Does the annual plan auto-renew?',
      a: 'Yes, annual plans auto-renew 7 days before the end of the billing year. You will receive an email reminder 30 days in advance. You can cancel or switch plans at any time from this billing settings page.',
    },
    {
      q: 'Can I get a custom Enterprise quote?',
      a: 'Absolutely. Enterprise pricing is negotiated based on seat count, expected monthly GMV on the marketplace (which drives gas fee volume discounts), and required integrations. Contact hello@ethertrack.in for a custom proposal.',
    },
  ];

  return (
    <>
      <style>{CSS}</style>
      <div className="sb">
        <div className="sbw">

          {/* Header */}
          <div className="sb-hdr">
            <div className="sb-hdr-label">SUBSCRIPTION · BILLING · MARKETPLACE FEES</div>
            <h1 className="sb-hdr-title">Plans &amp; <span>Billing</span></h1>
            <div className="sb-hdr-sub">All prices in INR · Exclusive of 18% GST · Indian market</div>
          </div>

          {/* Current plan banner */}
          <div className="sb-current-banner">
            <div className="sb-current-left">
              <div className="sb-current-dot" />
              <div>
                <div className="sb-current-label">YOUR CURRENT PLAN</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span className="sb-current-name" style={{ color: currentPlanData.color }}>
                    {currentPlanData.label}
                  </span>
                  <span className="sb-current-meta">
                    {orgName} · {currentPlanData.seats ? `${currentPlanData.seats} seats` : 'Unlimited seats'} · Gas fee {currentPlanData.gasFee}
                  </span>
                </div>
              </div>
            </div>
            <div className="sb-renewal">
              Next renewal: <strong style={{ color: '#d1fae5' }}>15 Jun 2025</strong><br />
              <span style={{ fontSize: 9, color: '#86efac22' }}>Auto-renews · Cancel anytime</span>
            </div>
          </div>

          {/* Billing cycle toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
            <div className="sb-cycle-toggle">
              <button
                className={`sb-cycle-btn${billingCycle === 'monthly' ? ' on' : ''}`}
                onClick={() => setBillingCycle('monthly')}
              >
                MONTHLY
              </button>
              <button
                className={`sb-cycle-btn${billingCycle === 'annual' ? ' on' : ''}`}
                onClick={() => setBillingCycle('annual')}
              >
                ANNUAL
                <span className="sb-cycle-badge">SAVE 17%</span>
              </button>
            </div>
            {billingCycle === 'annual' && (
              <span style={{ fontSize: 10, color: '#22c55e88', letterSpacing: '.06em' }}>
                ≈ 2 months free · Billed as single annual invoice
              </span>
            )}
          </div>

          {/* Plan cards */}
          <div className="sb-plans-grid">
            {PLANS.map((plan, idx) => {
              const price = getPrice(plan);
              const isCurrent = plan.key === currentPlan;
              return (
                <div
                  key={plan.key}
                  className={`sb-plan-card${isCurrent ? ' current' : ''}${plan.popular ? ' popular-card' : ''}`}
                  style={{ borderColor: hoveredPlan === plan.key ? plan.border.replace('22', '66') : (isCurrent ? '#22c55e44' : plan.popular ? '#22c55e44' : undefined) }}
                  onMouseEnter={() => setHoveredPlan(plan.key)}
                  onMouseLeave={() => setHoveredPlan(null)}
                >
                  {plan.popular && !isCurrent && <div className="sb-popular-badge">★ MOST POPULAR</div>}
                  {isCurrent && <div className="sb-current-badge">✓ YOUR PLAN</div>}

                  <div className="sb-plan-tier" style={{ color: plan.color }}>
                    {plan.label.toUpperCase()}
                  </div>
                  <div className="sb-plan-name">{plan.label}</div>
                  <div className="sb-plan-tagline" style={{ color: plan.color + '88' }}>{plan.tagline}</div>
                  <div className="sb-plan-audience">{plan.audience}</div>

                  <div className="sb-plan-price-row">
                    {price !== null ? (
                      <>
                        <span className="sb-plan-price">₹{price.toLocaleString('en-IN')}</span>
                        <span className="sb-plan-price-period">/ {plan.period}</span>
                      </>
                    ) : (
                      <span className="sb-plan-price" style={{ fontSize: 18 }}>Custom</span>
                    )}
                  </div>
                  <div className="sb-plan-price-annual">
                    {billingCycle === 'annual' && price
                      ? `₹${(price * 12).toLocaleString('en-IN')} / year`
                      : plan.price
                        ? `₹${(getPrice(plan) ?? plan.price).toLocaleString('en-IN')}/mo billed annually`
                        : 'Negotiated annually'
                    }
                  </div>

                  {/* Gas fee chip */}
                  <div className="sb-gas-chip" style={{ borderColor: plan.border }}>
                    <span style={{ color: '#86efac33' }}>⛽ Marketplace gas</span>
                    <span className="sb-gas-val" style={{ color: plan.color }}>{plan.gasFee}</span>
                  </div>

                  <div className="sb-seats-row" style={{ color: plan.color + '66' }}>
                    👥 {plan.seats ? `Up to ${plan.seats} seat${plan.seats > 1 ? 's' : ''}` : 'Unlimited seats'}
                  </div>

                  <hr className="sb-divider" />

                  <div className="sb-feat-list">
                    {FEATURE_ROWS.map(row => {
                      const feat = plan.features[row.key];
                      return (
                        <div key={row.key} className="sb-feat">
                          <span className="sb-feat-icon">
                            {feat.ok ? <span style={{ color: '#22c55e' }}>✓</span> : <span style={{ color: '#86efac11' }}>—</span>}
                          </span>
                          <span className={`sb-feat-text${feat.ok ? ' ok' : ' no'}`}>
                            {feat.val !== false ? feat.val : row.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <button
                    className={`sb-plan-cta ${getCtaClass(plan, idx)}`}
                    onClick={() => {
                      if (plan.key === currentPlan) return;
                      if (plan.key === 'enterprise') {
                        window.location.href = 'mailto:hello@ethertrack.in?subject=Enterprise Plan Enquiry';
                        return;
                      }
                      showToast(
                        idx > currentPlanIndex
                          ? `↑ Upgrade to ${plan.label} — billing integration coming soon`
                          : `↓ Downgrade request noted — contact support`,
                        idx > currentPlanIndex ? 'success' : 'info'
                      );
                    }}
                  >
                    {getCtaLabel(plan, idx)}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Full feature matrix */}
          <div className="sb-section-hdr">
            <div className="sb-section-title">FULL FEATURE MATRIX</div>
            <button className="sb-toggle-btn" onClick={() => setShowMatrix(v => !v)}>
              {showMatrix ? '▲ HIDE' : '▼ EXPAND'}
            </button>
          </div>

          {showMatrix && (
            <div className="sb-matrix-wrap">
              <table className="sb-matrix-table">
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
                        const feat = plan.features[row.key];
                        return (
                          <td key={plan.key}>
                            {feat.ok && feat.val !== true ? (
                              <span
                                className="sb-partial"
                                style={{
                                  background: plan.bg,
                                  color: plan.color,
                                  border: `1px solid ${plan.border}`,
                                }}
                              >
                                {feat.val}
                              </span>
                            ) : feat.ok ? (
                              <span className="sb-check">✓</span>
                            ) : (
                              <span className="sb-cross">—</span>
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
                        <span className="sb-partial" style={{ background: p.bg, color: p.color, border: `1px solid ${p.border}` }}>
                          {p.seats ? p.seats : '∞'}
                        </span>
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Gas fee</td>
                    {PLANS.map(p => (
                      <td key={p.key}>
                        <span className="sb-partial" style={{ background: p.bg, color: p.color, border: `1px solid ${p.border}` }}>
                          {p.gasFee}
                        </span>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Gas fee calculator section */}
          <div className="sb-section-hdr" style={{ marginTop: 8 }}>
            <div className="sb-section-title">MARKETPLACE GAS FEE GUIDE</div>
            <button className="sb-toggle-btn" onClick={() => setShowGasCalc(v => !v)}>
              {showGasCalc ? '▲ HIDE' : '▼ EXPAND'}
            </button>
          </div>

          {showGasCalc && (
            <div className="sb-gas-section">
              <div className="sb-gas-intro">
                Gas fees apply to every completed buy/sell transaction on the EtherTrack carbon credit marketplace.
                The fee is charged to the <strong style={{ color: '#d1fae5' }}>seller</strong> at settlement.
                Higher-tier plans earn lower fee rates — at ₹25L/txn, Corporate saves ₹10,000 per trade vs Free/Starter.
                Enterprise plans can negotiate volume-based discounts below 0.5% for high-GMV months.
              </div>

              <div className="sb-gas-tiers">
                {[
                  { label: 'Free / Starter', pct: '1%', color: '#f87171', bg: '#1a0707', border: '#f8717133', note: 'Standard rate' },
                  { label: 'Growth', pct: '0.75%', color: '#fbbf24', bg: '#1a1000', border: '#fbbf2433', note: 'Save 25% vs standard' },
                  { label: 'Corporate', pct: '0.6%', color: '#22c55e', bg: '#0a1a0e', border: '#22c55e33', note: 'Save 40% vs standard' },
                  { label: 'Enterprise', pct: '0.5%+', color: '#a78bfa', bg: '#120a28', border: '#a78bfa33', note: 'Negotiated volume rate' },
                ].map(t => (
                  <div key={t.label} className="sb-gas-tier-card" style={{ borderColor: t.border, background: t.bg }}>
                    <div className="sb-gas-tier-name" style={{ color: t.color }}>{t.label.toUpperCase()}</div>
                    <div className="sb-gas-tier-pct">{t.pct}</div>
                    <div className="sb-gas-tier-note">{t.note}</div>
                  </div>
                ))}
              </div>

              <div className="sb-gas-table-wrap">
                <table className="sb-gas-table">
                  <thead>
                    <tr>
                      <th>Transaction value</th>
                      <th style={{ color: '#f87171' }}>Free / Starter (1%)</th>
                      <th style={{ color: '#fbbf24' }}>Growth (0.75%)</th>
                      <th style={{ color: '#22c55e' }}>Corporate (0.6%)</th>
                      <th style={{ color: '#a78bfa' }}>Enterprise (0.5%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['₹1,00,000', '₹1,000', '₹750', '₹600', '₹500'],
                      ['₹5,00,000', '₹5,000', '₹3,750', '₹3,000', '₹2,500'],
                      ['₹25,00,000', '₹25,000', '₹18,750', '₹15,000', '₹12,500'],
                      ['₹1,00,00,000', '₹1,00,000', '₹75,000', '₹60,000', '₹50,000'],
                    ].map(([val, ...fees]) => (
                      <tr key={val}>
                        <td>{val}</td>
                        {fees.map((f, i) => <td key={i} style={{ color: ['#f87171', '#fbbf24', '#22c55e', '#a78bfa'][i] + 'bb' }}>{f}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* FAQ */}
          <div className="sb-section-hdr" style={{ marginTop: 8 }}>
            <div className="sb-section-title">BILLING FAQ</div>
          </div>
          <div className="sb-faq">
            {FAQS.map((faq, i) => (
              <div key={i} className="sb-faq-item">
                <button className="sb-faq-q" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                  <span>{faq.q}</span>
                  <span className={`sb-faq-q-icon${openFaq === i ? ' open' : ''}`}>+</span>
                </button>
                {openFaq === i && <div className="sb-faq-a">{faq.a}</div>}
              </div>
            ))}
          </div>

          {/* Enterprise CTA banner */}
          <div style={{
            background: '#0d0a1a', border: '1px solid #a78bfa22', borderRadius: 12,
            padding: '20px 24px', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', flexWrap: 'wrap', gap: 14,
          }}>
            <div>
              <div style={{ fontSize: 12, color: '#a78bfa', fontWeight: 700, marginBottom: 4 }}>
                Need a custom plan for your conglomerate or brokerage?
              </div>
              <div style={{ fontSize: 10, color: '#86efac33', lineHeight: 1.8 }}>
                Volume gas fee discounts · Unlimited seats · White-label reports · REST API · SLA guarantee
              </div>
            </div>
            <a
              href="mailto:hello@ethertrack.in?subject=Enterprise Plan Enquiry"
              style={{
                padding: '10px 20px', borderRadius: 8, background: '#1a1030',
                border: '1px solid #a78bfa33', color: '#a78bfa',
                fontFamily: "'DM Mono',monospace", fontSize: 10,
                letterSpacing: '.1em', fontWeight: 700, textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              CONTACT SALES →
            </a>
          </div>

        </div>
      </div>

      {toast && (
        <div className="sb-toast" style={{
          border: `1px solid ${toast.type === 'error' ? '#f8717122' : '#22c55e22'}`,
          color: toast.type === 'error' ? '#f8717199' : '#22c55e88',
        }}>
          {toast.msg}
        </div>
      )}
    </>
  );
}