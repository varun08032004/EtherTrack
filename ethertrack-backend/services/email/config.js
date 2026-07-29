// services/email/config.js — EtherTrack
// Single source of truth: which mailbox owns which email template.
// Built from actual call sites in auth.js, user.js, org.js, admin.js, kyc.js,
// cron/jobs.js, invoice.js, auditor-verification.js, support.js.
'use strict';

const FROM = {
  support: process.env.EMAIL_SUPPORT_FROM || '"EtherTrack Support" <support@ethertrack.in>',
  billing: process.env.EMAIL_BILLING_FROM || '"EtherTrack Billing" <billing@ethertrack.in>',
  sales:   process.env.EMAIL_SALES_FROM   || '"EtherTrack Sales" <sales@ethertrack.in>',
  admin:   process.env.EMAIL_ADMIN_FROM   || '"EtherTrack Admin" <admin@ethertrack.in>',
};

const TEMPLATE_CATEGORY = {
  // ── Auth / account (support@) — routes/auth.js, routes/user.js ──────────
  'verify-account':              'support',
  'welcome':                     'support',
  'password-changed':            'support', // NEW — auth.js change-password sends nothing today
  'two-factor-disabled':         'support',
  'account-deactivated':         'support',
  'account-deleted':             'support',
  'account-suspended':           'support', // admin.js
  'account-reinstated':          'support', // admin.js
  'wallet-updated':              'support', // admin.js

  // ── KYC (support@ to user) — routes/kyc.js, routes/admin.js, cron/jobs.js ─
  'kyc-submitted':                'support',
  'kyc-approved':                 'support',
  'kyc-rejected':                 'support',
  'kyc-resubmission-required':    'support', // admin.js "Fresh KYC Submission Required"
  'kyc-expiring-soon':            'support', // cron/jobs.js
  'kyc-expired':                  'support', // cron/jobs.js

  // ── Marketplace (support@) — routes/admin.js, cron/jobs.js ───────────────
  'credit-listing-rejected':      'support', // admin.js — batch/listing rejected (NOT kyc)
  'listing-expired':              'support', // cron/jobs.js
  'mint-success':                 'support', // cron/jobs.js + admin.js retry path

  // ── Support tickets (support@ to user / admin@ internal) ──────────────────
  'support-ticket-received':      'support', // support.js — ack to submitter
  'new-ticket-internal':          'admin',   // support.js — alert to support team

  // ── Admin-authored messages (support@) ────────────────────────────────────
  'admin-message-to-user':        'support', // admin.js /users/:id/send-message
  'platform-announcement':        'support', // admin.js broadcast

  // ── Org (support@) ─────────────────────────────────────────────────────────
  'org-invite':                   'support',

  // ── GHG verification (support@) — routes/auditor-verification.js ─────────
  'verification-package-created': 'support',
  'verification-sealed':          'support',
  'verification-received':        'support',

  // ── Billing / invoices (billing@) — services/invoice.js, routes/admin.js ─
  'subscription-invoice':         'billing', // GST tax invoice, PDF attached
  'trade-invoice':                'billing', // INR/GST trade invoice, PDF attached
  'trade-invoice-chain-confirmed':'billing', // updated invoice w/ tx hash, PDF attached
  'trade-bill-eth':               'billing', // ETH non-GST bill, PDF attached
  'buy-order-cancelled':          'billing', // admin.js force-cancel

  // ── Billing — subscription-expiring-soon/expired wired into
  // routes/org.js checkSubscriptionExpiries() cron. payment-failed wired
  // into routes/subscription.js Razorpay webhook (payment.failed event).
  'subscription-expiring-soon':   'billing',
  'subscription-expired':         'billing',
  'subscription-admin-alert':     'admin',
  'payment-failed':               'billing',

  // ── Sales (sales@) — routes/admin.js ──────────────────────────────────────
  'corporate-plan-activated':     'sales',

  // ── Marketplace sale (billing@) — routes/trades.js checkout-verify ────────
  // Seller only ever got an in-app notification when their listing sold —
  // never an email, despite money landing in their account.
  'credits-sold':                  'billing',

  // ── Portfolio / tokenization (support@) — routes/portfolio.js, routes/admin.js, routes/registry.js ─
  'credit-submitted':              'support',
  'tokenization-failed':           'support',
  'listing-confirmed':             'support',
  'delisting-confirmed':           'support',

  // ── Retirement (support@) — routes/transactions.js, routes/org.js ─────────
  // Individual retirement (transactions.js POST /retirements) never emailed
  // despite the retirement-certificate template existing since before this
  // migration. Org-level retirement queue submit/approve/reject had zero
  // notification of any kind — not even in-app.
  'org-retirement-requested':      'support',
  'org-retirement-rejected':       'support',
  'retirement-certificate':        'support',

  // ── Emission tracking (support@) — routes/emissions-approval.js ───────────
  // Maker-checker approval workflow (draft→submitted→reviewed→approved/
  // rejected/locked) had ONLY in-app notifications, zero email, despite
  // being a compliance-relevant audit trail feature.
  'emission-record-approved':      'support',
  'emission-record-rejected':      'support',
  'emission-record-adjusted':      'support',

  // ── Internal admin alerts (admin@) — routes/kyc.js ────────────────────────
  'kyc-admin-new':                'admin',

  // ── Wallet (support@ for connect/security, billing@ for money movement) ──
  // wallet.js /bind, /deposit/verify, /webhook (payment.captured, payout.processed,
  // payout.failed), /withdraw, /bank-accounts POST/DELETE — none of these had
  // any email before, only in-app notifications.
  'wallet-connected':             'support',
  'deposit-confirmed':            'billing',
  'withdrawal-processed':         'billing',
  'withdrawal-failed':            'billing',
  'bank-account-added':           'support',
  'bank-account-removed':         'support',

  // ── Plan selection (support@ / billing@) — routes/subscription.js /free ──
  // This route had zero email at all — both for first-time free selection
  // (post-KYC) and for downgrading away from a paid plan.
  'plan-selected':                'support',
  'subscription-cancelled':       'billing',
};

// Templates that must send immediately (never queued) — user is actively
// waiting on them in a live flow.
const IMMEDIATE_TEMPLATES = new Set([
  'verify-account',
]);

module.exports = { FROM, TEMPLATE_CATEGORY, IMMEDIATE_TEMPLATES };