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

// GET /api/ops-integration/churn-events?since=ISO_TIMESTAMP
//
// Every paid→free downgrade recorded in subscription_history (event_type
// 'expired', written by routes/org.js's checkSubscriptionExpiries cron), so
// the ERP can alert Sales/CS same-day for win-back outreach instead of only
// finding out whenever someone next re-pulls the customer roster.
//
// `event_id` is subscription_history.id (cast to text so this works whether
// that column is a serial int or a UUID) — the ERP side's stable dedupe key,
// same pattern as `ref_id` on /income above.
router.get('/churn-events', async (req, res) => {
  const since = req.query.since && !isNaN(Date.parse(req.query.since))
    ? req.query.since
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // default: last 30 days

  try {
    const { rows } = await query(
      `SELECT sh.id::text AS event_id, sh.created_at AS downgraded_at,
              sh.from_plan, sh.from_cycle, sh.renewal_date AS previous_renewal_date,
              u.email, u.full_name, u.company_name, u.corporate_managed
       FROM subscription_history sh
       JOIN users u ON u.id = sh.user_id
       WHERE sh.event_type = 'expired'
         AND sh.to_plan = 'free'
         AND sh.created_at >= $1
       ORDER BY sh.created_at DESC
       LIMIT 500`,
      [since]
    );
    res.json({ events: rows });
  } catch (e) {
    console.error('[ops-integration/churn-events]', e.message);
    res.status(500).json({ error: 'Failed to fetch churn events' });
  }
});

// GET /api/ops-integration/refunds?since=ISO_TIMESTAMP
//
// Subscription payments Razorpay has refunded (status='refunded', set by the
// existing 'refund.processed' webhook handler in routes/subscription.js —
// this endpoint doesn't process refunds itself, just exposes ones that
// already happened). `ref_id` matches exactly what platform_sync_log stores
// for source='subscription' on the ERP side (subscription_payments.id), so
// the ERP can tell whether that revenue was ever actually imported/posted
// to its ledger, and if so, needs a reversing entry now that it's refunded.
router.get('/refunds', async (req, res) => {
  const since = req.query.since && !isNaN(Date.parse(req.query.since))
    ? req.query.since
    : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(); // default: last 90 days

  try {
    const { rows } = await query(
      `SELECT sp.id AS ref_id, sp.refunded_at, sp.refund_ref,
              (sp.refund_amount_paise / 100.0) AS refund_amount_inr,
              (sp.total_amount_paise / 100.0)  AS original_total_inr,
              sp.plan, sp.cycle, sp.invoice_number,
              u.email AS customer_email, u.full_name AS customer_name
       FROM subscription_payments sp
       LEFT JOIN users u ON u.id = sp.user_id
       WHERE sp.status = 'refunded'
         AND sp.refunded_at >= $1
       ORDER BY sp.refunded_at DESC
       LIMIT 500`,
      [since]
    );
    res.json({ refunds: rows });
  } catch (e) {
    console.error('[ops-integration/refunds]', e.message);
    res.status(500).json({ error: 'Failed to fetch refunds' });
  }
});

// GET /api/ops-integration/coupon-redemptions?since=ISO_TIMESTAMP
//
// Every coupon redemption (EARLYBIRD50, or whatever else has been created
// via routes/opsIntegrationCoupons.js), joined with the actual payment it
// applied to — so the ERP's Marketing module can measure real ROI (revenue
// actually collected after the discount) rather than just "N people used
// this code," which is all the write-side /api/ops-integration-coupons
// list endpoint currently shows.
router.get('/coupon-redemptions', async (req, res) => {
  const since = req.query.since && !isNaN(Date.parse(req.query.since))
    ? req.query.since
    : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(); // default: last 12 months

  try {
    const { rows } = await query(
      `SELECT c.code AS coupon_code, c.discount_type, c.discount_value,
              cr.redeemed_at, (cr.discount_paise / 100.0) AS discount_inr,
              u.email AS customer_email, u.full_name AS customer_name,
              sp.plan, sp.cycle,
              (sp.amount_paise / 100.0)       AS net_paid_inr,
              (sp.total_amount_paise / 100.0) AS total_paid_inr
       FROM coupon_redemptions cr
       JOIN coupons c ON c.id = cr.coupon_id
       JOIN users u ON u.id = cr.user_id
       LEFT JOIN subscription_payments sp ON sp.id = cr.subscription_payment_id
       WHERE cr.redeemed_at >= $1
       ORDER BY cr.redeemed_at DESC
       LIMIT 1000`,
      [since]
    );
    res.json({ redemptions: rows });
  } catch (e) {
    console.error('[ops-integration/coupon-redemptions]', e.message);
    res.status(500).json({ error: 'Failed to fetch coupon redemptions' });
  }
});

// GET /api/ops-integration/support-tickets?since=ISO_TIMESTAMP&status=open
//
// Platform support tickets, joined with subscription context where the
// submitter is a logged-in user — so Sales/CS in the ERP can see "this
// Corporate account has 2 open tickets" without a separate login into the
// platform's own admin panel. Read-only; ticket handling itself still
// happens on the platform (routes/support.js).
router.get('/support-tickets', async (req, res) => {
  const since = req.query.since && !isNaN(Date.parse(req.query.since))
    ? req.query.since
    : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(); // default: last 90 days
  const status = ['open', 'in_progress', 'resolved', 'closed'].includes(req.query.status)
    ? req.query.status
    : null;

  try {
    const params = [since];
    let statusClause = '';
    if (status) { params.push(status); statusClause = `AND st.status = $${params.length}`; }

    const { rows } = await query(
      `SELECT st.id, st.ticket_number, st.name, st.email, st.subject, st.status,
              st.priority, st.source, st.created_at, st.resolved_at,
              u.subscription_plan, u.corporate_managed, u.company_name
       FROM support_tickets st
       LEFT JOIN users u ON u.id = st.user_id
       WHERE st.created_at >= $1 ${statusClause}
       ORDER BY st.created_at DESC
       LIMIT 500`,
      params
    );
    res.json({ tickets: rows });
  } catch (e) {
    console.error('[ops-integration/support-tickets]', e.message);
    res.status(500).json({ error: 'Failed to fetch support tickets' });
  }
});

module.exports = router;