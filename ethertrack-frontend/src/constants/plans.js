// src/constants/plans.js — EtherTrack v5
// ─────────────────────────────────────────────────────────────────
// SINGLE source of truth for plan UI metadata on the frontend.
// NEVER put pricing here — prices come from /api/subscription/prices.
// NEVER import this file in any backend/server code.
//
// [v5] Updated to match confirmed tier structure:
//   FREE      — ₹0        · 1.5% gas · 1 seat
//   STARTER   — ₹1,499/mo · 1% gas   · 3 seats  (₹14,990/yr)
//   GROWTH    — ₹7,999/mo · 0.75% gas· 10 seats  (₹79,990/yr)
//   CORPORATE — Contact Sales · 0.5% negotiated · Custom seats
// ─────────────────────────────────────────────────────────────────

export const PLAN_KEYS = ['free', 'starter', 'growth', 'corporate'];

export const ANNUAL_DISCOUNT_HINT = 0.17;

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export const PAN_REGEX   = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

// ── Plan access gates — UI gating only ───────────────────────────
export const PLAN_ACCESS = {
  free: {
    trade:       true,   // ✅ Buy only
    sell:        false,  // 🔒 Starter+
    portfolio:   false,  // 🔒 Starter+
    retirement:  false,  // 🔒 Starter+
    emissions:   false,  // 🔒 Growth+
    reports:     false,  // 🔒 Corporate
    team:        false,  // 🔒 Corporate
    api:         false,  // 🔒 Corporate
    verifier:    false,  // 🔒 Corporate
    compliance:  false,  // 🔒 Corporate
  },
  starter: {
    trade:       true,
    sell:        true,
    portfolio:   true,
    retirement:  true,
    emissions:   false,  // 🔒 Growth+
    reports:     false,
    team:        false,
    api:         false,
    verifier:    false,
    compliance:  false,
  },
  growth: {
    trade:       true,
    sell:        true,
    portfolio:   true,
    retirement:  true,
    emissions:   true,   // Scope 1+2 full + basic Scope 3 (5 categories)
    reports:     true,   // GHG Protocol PDF
    team:        false,  // 🔒 Corporate
    api:         false,
    verifier:    false,
    compliance:  false,
  },
  corporate: {
    trade:       true,
    sell:        true,
    portfolio:   true,
    retirement:  true,
    emissions:   true,   // Full Scope 3 (all 15 categories)
    reports:     true,   // BRSR/CDP/TCFD/GHG PDF
    team:        true,   // Custom seats
    api:         true,
    verifier:    true,
    compliance:  true,
  },
};

export const PLANS = [
  {
    key:       'free',
    label:     'Free',
    badge:     'Explorer',
    tagline:   'Start exploring',
    audience:  'Individuals, students, companies just exploring',
    color:     '#86efac',
    dimColor:  '#86efac44',
    bg:        '#0a1a0e',
    border:    '#22c55e22',
    highlight: null,
    seats:     1,
    gasFee:    '1.5%',
    locked: [
      'Portfolio management',
      'List & sell credits',
      'Credit retirement',
      'Portfolio export',
      'Emission tracking',
      'Compliance dashboard',
      'Team management',
    ],
    unlocked: [
      'Buy credits from marketplace',
      'Browse listings & real-time prices',
      'On-chain transaction receipt',
      'Basic carbon footprint calculator',
      'Wallet & trading history',
      'Email support',
    ],
    cta: 'START FREE',
  },
  {
    key:       'starter',
    label:     'Starter',
    badge:     'Trader',
    tagline:   'For active traders',
    audience:  'Freelancers, ESG consultants, small NGOs, active traders',
    color:     '#60a5fa',
    dimColor:  '#60a5fa44',
    bg:        '#060e18',
    border:    '#60a5fa22',
    highlight: null,
    seats:     3,
    gasFee:    '1%',
    locked: [
      'Emission tracking (Growth+)',
      'Compliance dashboard (Corporate)',
      'Team management (Corporate)',
    ],
    unlocked: [
      'Everything in Free',
      'Full portfolio management',
      'List & sell credits on marketplace',
      'Credit retirement',
      'Portfolio export (CSV)',
      'Blockchain audit trail PDF',
      '3 seats',
      'Priority email support',
    ],
    cta: 'CHOOSE STARTER',
  },
  {
    key:       'growth',
    label:     'Growth',
    badge:     'Business',
    tagline:   'Most popular',
    audience:  'MSMEs, growing businesses, serious ESG teams',
    color:     '#22c55e',
    dimColor:  '#22c55e66',
    bg:        '#0a1a0e',
    border:    '#22c55e55',
    highlight: 'MOST POPULAR',
    seats:     10,
    gasFee:    '0.75%',
    locked: [
      'Compliance dashboard (Corporate)',
      'Team management (Corporate)',
      'BRSR/CDP/TCFD reports (Corporate)',
    ],
    unlocked: [
      'Everything in Starter',
      'Scope 1 + 2 full tracking',
      'Basic Scope 3 (5 categories)',
      'GHG inventory ledger',
      'CSV export + analytics dashboard',
      'Carbon intensity metrics',
      'Basic decarbonisation scenarios',
      'GHG Protocol PDF report',
      '10 seats',
      'Chat support',
    ],
    cta: 'CHOOSE GROWTH',
  },
  {
    key:       'corporate',
    label:     'Corporate',
    badge:     'Enterprise',
    tagline:   'For listed companies',
    audience:  'SEBI-listed cos, BRSR filers, ESG teams, CDP/TCFD filers',
    color:     '#f59e0b',
    dimColor:  '#f59e0b44',
    bg:        '#1a1000',
    border:    '#f59e0b33',
    highlight: null,
    seats:     null,   // custom
    gasFee:    '0.5%',
    locked: [],
    unlocked: [
      'Everything in Growth',
      'Full Scope 3 (all 15 categories)',
      'BRSR / CDP / TCFD / GHG PDF reports',
      'Audit trail + verifier integration',
      'BV, DNV, EY, Deloitte, TÜV SÜD, BSI, KPMG',
      'GEI / BEE compliance',
      'PAT scheme + CCTS (forms A–E2)',
      '5-year decarbonisation plan',
      'MRV calendar + SBTi target setting',
      'Supplier data portal',
      'Multi-entity consolidation',
      'Carbon neutrality certificate',
      'Regulatory deadline alerts',
      'Custom seats · Custom pricing',
    ],
    cta: 'CONTACT SALES',
  },
];

// ── Feature matrix ────────────────────────────────────────────────
export const FEATURE_ROWS = [
  { key: 'trade',         label: 'Buy credits'               },
  { key: 'sell',          label: 'Sell & list credits'       },
  { key: 'portfolio',     label: 'Portfolio management'      },
  { key: 'retirement',    label: 'Credit retirement'         },
  { key: 'scope12',       label: 'Scope 1 + 2 tracking'     },
  { key: 'scope3',        label: 'Scope 3 tracking'         },
  { key: 'ghg_ledger',    label: 'GHG inventory ledger'     },
  { key: 'reports',       label: 'Compliance reports'        },
  { key: 'brsr',          label: 'BRSR / CDP / TCFD'        },
  { key: 'audit',         label: 'Audit trail'               },
  { key: 'verifier',      label: 'Verifier integration'      },
  { key: 'ccts',          label: 'PAT / CCTS / GEI / BEE'  },
  { key: 'decarb',        label: 'Decarbonisation plan'     },
  { key: 'sbti',          label: 'SBTi + MRV calendar'      },
  { key: 'supplier',      label: 'Supplier data portal'      },
  { key: 'team',          label: 'Team management'           },
  { key: 'support',       label: 'Support tier'              },
];

export const PLAN_FEATURES_MATRIX = {
  free: {
    trade:       { val: 'Buy only',          ok: true  },
    sell:        { val: false,               ok: false },
    portfolio:   { val: false,               ok: false },
    retirement:  { val: false,               ok: false },
    scope12:     { val: false,               ok: false },
    scope3:      { val: false,               ok: false },
    ghg_ledger:  { val: false,               ok: false },
    reports:     { val: false,               ok: false },
    brsr:        { val: false,               ok: false },
    audit:       { val: false,               ok: false },
    verifier:    { val: false,               ok: false },
    ccts:        { val: false,               ok: false },
    decarb:      { val: false,               ok: false },
    sbti:        { val: false,               ok: false },
    supplier:    { val: false,               ok: false },
    team:        { val: false,               ok: false },
    support:     { val: 'Email',             ok: true  },
  },
  starter: {
    trade:       { val: 'Buy + Sell',        ok: true  },
    sell:        { val: true,                ok: true  },
    portfolio:   { val: 'Full management',   ok: true  },
    retirement:  { val: true,                ok: true  },
    scope12:     { val: false,               ok: false },
    scope3:      { val: false,               ok: false },
    ghg_ledger:  { val: false,               ok: false },
    reports:     { val: false,               ok: false },
    brsr:        { val: false,               ok: false },
    audit:       { val: false,               ok: false },
    verifier:    { val: false,               ok: false },
    ccts:        { val: false,               ok: false },
    decarb:      { val: false,               ok: false },
    sbti:        { val: false,               ok: false },
    supplier:    { val: false,               ok: false },
    team:        { val: false,               ok: false },
    support:     { val: 'Priority email',    ok: true  },
  },
  growth: {
    trade:       { val: 'Buy + Sell',        ok: true  },
    sell:        { val: true,                ok: true  },
    portfolio:   { val: true,                ok: true  },
    retirement:  { val: true,                ok: true  },
    scope12:     { val: 'Full Scope 1+2',    ok: true  },
    scope3:      { val: '5 categories',      ok: true  },
    ghg_ledger:  { val: true,                ok: true  },
    reports:     { val: 'GHG Protocol PDF',  ok: true  },
    brsr:        { val: false,               ok: false },
    audit:       { val: false,               ok: false },
    verifier:    { val: false,               ok: false },
    ccts:        { val: false,               ok: false },
    decarb:      { val: 'Basic scenarios',   ok: true  },
    sbti:        { val: false,               ok: false },
    supplier:    { val: false,               ok: false },
    team:        { val: false,               ok: false },
    support:     { val: 'Chat',              ok: true  },
  },
  corporate: {
    trade:       { val: 'Buy + Sell',        ok: true  },
    sell:        { val: true,                ok: true  },
    portfolio:   { val: true,                ok: true  },
    retirement:  { val: true,                ok: true  },
    scope12:     { val: 'Full Scope 1+2',    ok: true  },
    scope3:      { val: 'All 15 categories', ok: true  },
    ghg_ledger:  { val: true,                ok: true  },
    reports:     { val: 'BRSR/CDP/TCFD/GHG', ok: true  },
    brsr:        { val: 'Auto-populated',    ok: true  },
    audit:       { val: true,                ok: true  },
    verifier:    { val: 'BV,DNV,EY,Deloitte…', ok: true },
    ccts:        { val: 'Forms A–E2',        ok: true  },
    decarb:      { val: '5-year plan',       ok: true  },
    sbti:        { val: true,                ok: true  },
    supplier:    { val: true,                ok: true  },
    team:        { val: 'Custom seats',      ok: true  },
    support:     { val: 'Dedicated manager', ok: true  },
  },
};

export const FAQS = [
  {
    key: 'free-buy',
    q:   'Can Free users buy credits on the marketplace?',
    a:   'Yes — Free tier users can buy carbon credits immediately with 1 seat. Every purchase gets an on-chain transaction receipt. Selling credits, portfolio management, and emissions tracking unlock from Starter onwards.',
  },
  {
    key: 'starter-sell',
    q:   'What does Starter unlock?',
    a:   'Starter (₹1,499/mo) gives you portfolio management, the ability to list and sell credits, credit retirement, portfolio export (CSV), and 3 seats. Gas fee drops from 1.5% to 1%.',
  },
  {
    key: 'growth-emissions',
    q:   'What does Growth unlock?',
    a:   'Growth (₹7,999/mo) adds full Scope 1+2 tracking, basic Scope 3 (5 categories), GHG inventory ledger, CSV export, analytics dashboard, carbon intensity metrics, basic decarbonisation scenarios, and GHG Protocol PDF reports. 10 seats, 0.75% gas fee.',
  },
  {
    key: 'corporate',
    q:   'What is included in Corporate?',
    a:   'Corporate includes everything in Growth plus full Scope 3 (all 15 categories), BRSR/CDP/TCFD/GHG PDF reports, audit trail, verifier integration (BV, DNV, EY, Deloitte, TÜV SÜD, BSI, KPMG), GEI/BEE compliance, PAT scheme, CCTS (forms A–E2), 5-year decarbonisation plan, MRV calendar, SBTi target setting, supplier data portal, multi-entity consolidation, carbon neutrality certificate, and regulatory deadline alerts. Custom seats and pricing — contact support@ethertrack.in.',
  },
  {
    key: 'gas-fee',
    q:   'What is the marketplace gas fee?',
    a:   'Gas fee is charged to the seller at settlement on every credit transaction. Free: 1.5%, Starter: 1%, Growth: 0.75%, Corporate: 0.5% (negotiated). The buyer never pays gas — only the seller does at settlement.',
  },
  {
    key: 'switch-plans',
    q:   'Can I switch plans anytime?',
    a:   'Yes. Upgrades are immediate. Downgrades take effect at the end of your current billing cycle. No lock-in on monthly plans.',
  },
  {
    key: 'annual',
    q:   'How does annual billing work?',
    a:   'Annual plans are billed once per year at ~17% off: Starter ₹14,990/yr, Growth ₹79,990/yr. Corporate is custom — contact sales. A single GST invoice is issued for the full year.',
  },
  {
    key: 'gst',
    q:   'Is GST included in listed prices?',
    a:   'No. All prices are exclusive of 18% GST, added at checkout. A GST-compliant tax invoice is issued automatically on payment.',
  },
  {
    key: 'team',
    q:   'When does Team Management unlock?',
    a:   'Team Management is a Corporate-only feature — it unlocks with a Corporate plan which supports custom seats and multi-entity consolidation.',
  },
  {
    key: 'wallet-pay',
    q:   'Can I pay from my INR wallet?',
    a:   'Yes — instant with no redirect. Top up from the Wallet page first.',
  },
  {
    key: 'invoice',
    q:   'Do I get a GST invoice?',
    a:   'Yes. A GST-compliant tax invoice is emailed within minutes and available for download from Billing → Payment History.',
  },
  {
    key: 'data-cancel',
    q:   'What happens to my data if I cancel?',
    a:   'Data is retained for 90 days. Export before or during that window. On-chain records are permanent and always accessible via blockchain explorer.',
  },
];