'use strict';
// routes/opsIntegration.js
//
// Dedicated, minimal, READ-ONLY surface for the internal ops ERP (etpl_ops)
// to pull the platform's own revenue (subscriptions + trade fees) into its
// accounting ledger. Per SRS §18.8, this is the *only* integration point
// between the platform and the ERP — no shared DB, no shared codebase, no
// write access in either direction. Keep this file's surface area small on
// purpose: it should never grow write endpoints.
//
// Mount: app.use('/api/ops-integration', require('./routes/opsIntegration'))
// Auth:  requireServiceToken (x-service-token header), NOT user sessions.
// Rate limited to make token-guessing / scraping impractical even though
// the token check itself is timing-safe and fails closed.

const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { safeQuery: query } = require('../db/pool');
const { requireServiceToken } = require('../middleware/serviceAuth');

const opsIntegrationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // generous for legitimate polling/sync use, tight for abuse
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — slow down' },
});

router.use(opsIntegrationLimiter);
router.use(requireServiceToken);

// Lightweight access log for every successful (post-auth) call — gives you
// an audit trail if the token ever needs to be investigated or rotated.
router.use((req, res, next) => {
  console.log(`[ops-integration] ${req.method} ${req.originalUrl} — service call authorized`);
  next();
});

// GET /api/ops-integration/income?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Returns every completed subscription payment and collected trade fee in
// the window, each already carrying its CGST/SGST/IGST split so the ops
// ledger can post correct GST-payable entries without re-deriving tax logic
// here. `ref_id` is stable and unique per source — the ops side uses
// (source, ref_id) as its idempotency key so re-running an import for the
// same month never double-posts.
//
// invoice_number: the real GST invoice/bill number services/invoice.js
// already generated for this record (ET-/ETT-/ETB- series). Exposed so the
// ops side can display it next to each ledger entry and, via the new
// /invoice/:type/:id endpoint below, pull the actual signed PDF for GST
// filing — without ops needing to regenerate or duplicate anything.
router.get('/income', async (req, res) => {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : '2000-01-01';
  const to   = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to   || '') ? req.query.to   : '2100-01-01';

  try {
    const [tradeRows, subRows] = await Promise.all([
      query(
        `SELECT t.id AS ref_id, t.created_at AS date,
                pf.total_fee_inr AS amount_inr,
                COALESCE(pf.gst_inr,0)  AS gst_inr,
                COALESCE(pf.cgst_inr,0) AS cgst_inr,
                COALESCE(pf.sgst_inr,0) AS sgst_inr,
                COALESCE(pf.igst_inr,0) AS igst_inr,
                COALESCE(pf.gst_type, 'cgst_sgst') AS gst_type,
                bu.email AS buyer_email, su.email AS seller_email,
                t.quantity AS quantity_tco2, t.subtotal_inr AS trade_subtotal_inr,
                cb.project_name, cb.standard AS registry_standard,
                t.trade_invoice_number AS invoice_number,
                CONCAT('Trade fee — trade #', t.id::text,
                       CASE WHEN cb.project_name IS NOT NULL THEN CONCAT(' (', cb.project_name, ')') ELSE '' END
                ) AS description
         FROM trades t
         JOIN platform_fees pf ON pf.trade_id = t.id
         LEFT JOIN carbon_batches cb ON cb.id = t.batch_id
         LEFT JOIN users bu ON bu.id = t.buyer_id
         LEFT JOIN users su ON su.id = t.seller_id
         WHERE t.status = 'completed' AND t.created_at::date BETWEEN $1 AND $2
         ORDER BY t.created_at`,
        [from, to]
      ),
      query(
        `SELECT sp.id AS ref_id, sp.created_at AS date,
                (sp.total_amount_paise / 100.0) AS amount_inr,
                (sp.gst_amount_paise  / 100.0) AS gst_inr,
                (COALESCE(sp.cgst_paise,0) / 100.0) AS cgst_inr,
                (COALESCE(sp.sgst_paise,0) / 100.0) AS sgst_inr,
                (COALESCE(sp.igst_paise,0) / 100.0) AS igst_inr,
                COALESCE(sp.gst_type, 'cgst_sgst') AS gst_type,
                u.email AS customer_email, sp.plan, sp.cycle,
                sp.invoice_number AS invoice_number,
                CONCAT('Subscription — ', COALESCE(u.email, 'user #' || sp.user_id::text),
                       ' (', sp.plan, ' ', sp.cycle, ')') AS description
         FROM subscription_payments sp
         LEFT JOIN users u ON u.id = sp.user_id
         WHERE sp.status = 'success' AND sp.created_at::date BETWEEN $1 AND $2
         ORDER BY sp.created_at`,
        [from, to]
      ),
    ]);

    res.json({
      from,
      to,
      trades: tradeRows.rows.map((r) => ({ source: 'trade_fee', ...r })),
      subscriptions: subRows.rows.map((r) => ({ source: 'subscription', ...r })),
    });
  } catch (e) {
    console.error('[ops-integration/income]', e.message);
    res.status(500).json({ error: 'Failed to fetch income data' });
  }
});

// GET /api/ops-integration/invoice/:type/:id
//
// Serves the actual invoice/bill PDF bytes for a single subscription
// payment or trade — :type is 'subscription' or 'trade', :id is the same
// ref_id returned by /income. This is DELIBERATELY separate from
// serveInvoice/serveTradeInvoice in services/invoice.js, which check
// req.user.id (the buyer's own logged-in session) and would always 401/404
// for a service-token caller. This route serves the same stored PDF bytes
// but under service-token auth instead, since ops pulling a GST filing
// document is a legitimate read, just via a different caller than the
// buyer downloading their own receipt.
//
// Read-only: selects the already-generated invoice_pdf / trade_invoice_pdf
// blob, never regenerates or modifies anything.
router.get('/invoice/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  if (!['subscription', 'trade'].includes(type)) {
    return res.status(400).json({ error: "type must be 'subscription' or 'trade'" });
  }

  try {
    let row;
    if (type === 'subscription') {
      const { rows } = await query(
        `SELECT invoice_pdf, invoice_number FROM subscription_payments WHERE id = $1`,
        [id]
      );
      row = rows[0];
    } else {
      const { rows } = await query(
        `SELECT trade_invoice_pdf AS invoice_pdf, trade_invoice_number AS invoice_number FROM trades WHERE id = $1`,
        [id]
      );
      row = rows[0];
    }

    if (!row || !row.invoice_pdf) {
      return res.status(404).json({ error: 'Invoice not found or not yet generated' });
    }

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="EtherTrack-${row.invoice_number || id}.pdf"`,
      'Content-Length': row.invoice_pdf.length,
      'Cache-Control': 'no-store', // financial document — don't let intermediate caches retain it
    });
    res.send(row.invoice_pdf);
  } catch (e) {
    console.error('[ops-integration/invoice]', e.message);
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// GET /api/ops-integration/customers?limit=1000
//
// Read-only customer roster with subscription status and lifetime trade
// activity — feeds the ops Sales/Customer Success view (account health,
// upsell candidates, at-risk accounts) without ops needing its own copy of
// platform user data. No PII beyond what a salesperson would already see in
// the platform's own admin console (email, name, company, KYC status).
//
// latest_subscription_payment_inr: each active subscriber's most recent
// successful payment amount — same `latest_payment` pattern already used
// in routes/admin.js's /subscriptions/stats. This is what lets etpl_ops
// compute real MRR without a hardcoded price table: it naturally captures
// Corporate's custom per-deal pricing (set via activate-corporate, which
// always writes a real subscription_payments row) with zero special-casing,
// and stays correct automatically if standard-tier prices ever change.
router.get('/customers', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 1000, 5000);
  try {
    const { rows } = await query(
      `WITH latest_payment AS (
         SELECT DISTINCT ON (user_id) user_id, total_amount_paise
         FROM subscription_payments
         WHERE status = 'success'
         ORDER BY user_id, created_at DESC
       )
       SELECT u.id, u.email, u.full_name, u.company_name, u.kyc_status, u.is_active,
              u.created_at AS signup_at,
              u.subscription_plan, u.subscription_cycle,
              u.subscription_activated_at, u.subscription_renewal_date,
              u.corporate_managed,
              COALESCE(t.trade_count, 0) AS trade_count,
              COALESCE(t.trade_volume_inr, 0) AS trade_volume_inr,
              t.last_trade_at,
              ROUND(lp.total_amount_paise / 100.0, 2) AS latest_subscription_payment_inr
       FROM users u
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS trade_count,
                SUM(subtotal_inr) AS trade_volume_inr,
                MAX(created_at) AS last_trade_at
         FROM (
           SELECT buyer_id AS user_id, subtotal_inr, created_at FROM trades WHERE status = 'completed'
           UNION ALL
           SELECT seller_id AS user_id, subtotal_inr, created_at FROM trades WHERE status = 'completed'
         ) both_sides
         GROUP BY user_id
       ) t ON t.user_id = u.id
       LEFT JOIN latest_payment lp ON lp.user_id = u.id
       WHERE u.role = 'user'
       ORDER BY u.created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ customers: rows });
  } catch (e) {
    console.error('[ops-integration/customers]', e.message);
    res.status(500).json({ error: 'Failed to fetch customer roster' });
  }
});

module.exports = router;