'use strict';
// routes/subscription.js — EtherTrack v3
// Prices updated to confirmed tier structure:
//   Free:      ₹0
//   Starter:   ₹1,499/mo  ₹14,990/yr 
//   Growth:    ₹7,999/mo  ₹1,60,000/yr  
//   Corporate: Contact Sales (custom)
// Gas fees:
//   Free: 0.5 percent of transaction +18 percent gst from seller and 0.5 percent of transaction + 18 percent gst from buyer

const express    = require('express');
const crypto     = require('crypto');
const Razorpay   = require('razorpay');
const { ethers } = require('ethers');
const { body, query: qv, validationResult } = require('express-validator');

const { safeQuery: query, withTransaction } = require('../db/pool');
const { authenticate, requireKYC }          = require('../middleware/auth');
const { generateGSTInvoice, serveInvoice, getGSTType }  = require('../services/invoice');
const { createNotification }               = require('../routes/notifications');
const { sendPaymentFailedEmail, sendPlanSelectedEmail, sendSubscriptionCancelledEmail } = require('../services/email');
const { rateLimit, ipKeyGenerator }        = require('express-rate-limit');
const { getEffectivePricePaise, getAllEffectivePrices } = require('../services/pricing');
const { validateCoupon, computeDiscount, recordRedemption } = require('../services/coupons');

const router = express.Router();

const { getBreaker } = require('../lib/circuitBreaker');
const razorpayBreaker = getBreaker('razorpay', {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 30000
});

let _razorpay = null;
const getRazorpay = () => {
  if (_razorpay) return _razorpay;
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET)
    throw new Error('Razorpay keys not configured');
  _razorpay = new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
  return _razorpay;
};

const withRazorpay = (fn) => razorpayBreaker.execute(async () => {
  const rzp = getRazorpay();
  return fn(rzp);
});

// ── Rate limiters ─────────────────────────────────────────────────
const payLimiter = rateLimit({
  windowMs:     60 * 1000,
  max:          10,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req),
  handler:      (req, res) => res.status(429).json({ error: 'Too many payment requests. Slow down.', code: 'RATE_LIMITED' }),
  skip:         () => process.env.NODE_ENV === 'test',
});

const priceLimiter = rateLimit({
  windowMs:     60 * 1000,
  max:          60,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator: (req) => ipKeyGenerator(req),
  skip:         () => process.env.NODE_ENV === 'test',
});

// ── PLAN CONFIG — FALLBACK prices in PAISE ────────────────────────
// [DYNAMIC-PRICING] These *_paise values are only the default used until
// the ERP (etpl_ops) Product/Sales section pushes a real price via
// PATCH /api/ops-integration-pricing/:plan/:cycle (services/pricing.js).
// Once pushed, services/pricing.js's plan_prices table wins. Corporate is
// exempt by design — always null/"Contact Sales", set per-deal instead.
const PLAN_CONFIG = {
  free: {
    label:          'Free',
    badge:          'Explorer',
    monthly_paise:  0,
    annual_paise:   0,
    gas_fee_bps:    150,
    seats:          1,
    trial_days:     0,
  },
  starter: {
    label:          'Starter',
    badge:          'Trader',
    monthly_paise:  149900,
    annual_paise:   1499000,
    gas_fee_bps:    100,
    seats:          3,
    trial_days:     14,
  },
  growth: {
    label:          'Growth',
    badge:          'Business',
    monthly_paise:  799900,
    annual_paise:   7999000,
    gas_fee_bps:    75,
    seats:          10,
    trial_days:     14,
  },
  corporate: {
    label:          'Corporate',
    badge:          'Enterprise',
    monthly_paise:  null,
    annual_paise:   null,
    gas_fee_bps:    50,
    seats:          null,
    trial_days:     0,
  },
};

const VALID_PLANS  = Object.keys(PLAN_CONFIG);
const VALID_CYCLES = ['monthly', 'annual'];
const GST_RATE_BPS = 1800;
const MM_MAX_AGE   = 5 * 60 * 1000;

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_RE   = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

// ── Helpers ────────────────────────────────────────────────────────
// [DYNAMIC-PRICING] getPricePaise (static PLAN_CONFIG lookup) has been
// replaced everywhere by services/pricing.js's getEffectivePricePaise(),
// which checks the ERP-pushed plan_prices table first and only falls back
// to PLAN_CONFIG's hardcoded values if the ERP hasn't set a price yet.
const getGstPaise   = (p) => Math.round((p * GST_RATE_BPS) / 10000);
const getTotalPaise = (p) => p + getGstPaise(p);

// [FIX-RENEWAL-DATE] trialDays used to override the cycle length entirely —
// any paid Starter/Growth purchase (monthly OR annual, any payment method)
// got a renewal_date only 14 days out instead of the period actually paid
// for, because trial_days > 0 always won. This function is only ever
// called from the three POST-PAYMENT-SUCCESS activation paths (/verify,
// /wallet-pay, /metamask-pay) — there is no separate "start a free trial
// without paying" flow that calls it — so a trial concept never belonged
// here at all. Renewal date is now always exactly the paid cycle length.
const getRenewalDate = (cycle) => {
  const d = new Date();
  if (cycle === 'annual') d.setFullYear(d.getFullYear() + 1);
  else                    d.setMonth(d.getMonth() + 1);
  return d;
};

const validate = (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) { res.status(400).json({ error: errs.array()[0].msg }); return false; }
  return true;
};

const checkIdempotency = async (userId, key) => {
  const { rows } = await query(
    `SELECT id, status FROM subscription_payments
     WHERE user_id=$1 AND idempotency_key=$2
       AND status IN ('success','pending') LIMIT 1`,
    [userId, key]
  );
  return rows[0] || null;
};

// FIX: pass amount_paise/100 as explicit $18 param to avoid pg type conflict
const insertPayment = async (f) => {
  // Persist the CGST/SGST-vs-IGST determination at insert time — previously
  // this was computed correctly at PDF-generation time but never saved,
  // making it impossible to bulk-export the split for GST return filing.
  const gstType = getGSTType(f.gstin, f.buyerStateCode);
  const isIgst  = gstType === 'igst';
  const cgstPaise = isIgst ? 0 : Math.round((f.gst_amount_paise || 0) / 2);
  const sgstPaise = isIgst ? 0 : Math.round((f.gst_amount_paise || 0) / 2);
  const igstPaise = isIgst ? (f.gst_amount_paise || 0) : 0;

  const { rows } = await query(
    `INSERT INTO subscription_payments
       (user_id, plan, cycle,
        amount_paise, gst_amount_paise, total_amount_paise,
        pay_method, status, idempotency_key,
        razorpay_order_id, wallet_address, signature,
        metamask_address, metamask_message,
        gstin, pan, renewal_date, amount,
        gst_type, buyer_state_code, cgst_paise, sgst_paise, igst_paise,
        coupon_code, discount_paise)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
     RETURNING id`,
    [
      f.user_id, f.plan, f.cycle,
      f.amount_paise, f.gst_amount_paise, f.total_amount_paise,
      f.pay_method, f.status, f.idempotency_key,
      f.razorpay_order_id  || null,
      f.wallet_address     || null,
      f.signature          || null,
      f.metamask_address   || null,
      f.metamask_message   || null,
      f.gstin              || null,
      f.pan                || null,
      f.renewal_date       || null,
      f.amount_paise / 100,
      gstType, f.buyerStateCode || null, cgstPaise, sgstPaise, igstPaise,
      f.coupon_code        || null,
      f.discount_paise     || 0,
    ]
  );
  return rows[0].id;
};

const activatePlan = async ({ userId, plan, cycle, paymentId, renewalDate }) => {
  await withTransaction(async (client) => {
    const { rows: [cur] } = await client.query(
      `SELECT subscription_plan, subscription_cycle FROM users WHERE id=$1 FOR UPDATE`,
      [userId]
    );
    const ORDER   = ['free','starter','growth','corporate'];
    const fromIdx = ORDER.indexOf(cur?.subscription_plan);
    const toIdx   = ORDER.indexOf(plan);
    const event   =
      !cur?.subscription_plan || cur.subscription_plan === 'free' ? 'activated' :
      toIdx > fromIdx ? 'upgraded' : toIdx < fromIdx ? 'downgraded' : 'renewed';

    await client.query(
      `UPDATE users SET
         subscription_plan=$1, subscription_cycle=$2,
         subscription_renewal_date=$3,
         subscription_activated_at=COALESCE(subscription_activated_at,NOW()),
         plan_selected=TRUE, updated_at=NOW()
       WHERE id=$4`,
      [plan, cycle, renewalDate, userId]
    );

    const { rows: [pay] } = await client.query(
      `SELECT amount_paise, gst_amount_paise, gstin, pan, invoice_number
       FROM subscription_payments WHERE id=$1`, [paymentId]
    );

    await client.query(
      `INSERT INTO subscription_history
         (user_id,event_type,from_plan,to_plan,from_cycle,to_cycle,
          payment_id,amount_paise,gst_amount_paise,renewal_date,
          triggered_by,gstin,pan,invoice_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'user',$11,$12,$13)`,
      [
        userId, event,
        cur?.subscription_plan || null, plan,
        cur?.subscription_cycle || null, cycle,
        paymentId,
        pay?.amount_paise || 0, pay?.gst_amount_paise || 0,
        renewalDate,
        pay?.gstin || null, pay?.pan || null, pay?.invoice_number || null,
      ]
    );
  });
};

// [INVOICE] issueInvoice now accepts renewalDate so the PDF can show a
// "Billing Period" (today → renewal date) on subscription invoices.
const issueInvoice = async ({ paymentId, plan, cycle, amountPaise, gstin, pan, user, renewalDate }) => {
  try {
    const invoiceUrl = await generateGSTInvoice({
      paymentId, plan, cycle,
      amount:     amountPaise / 100,
      gstin:      gstin || null,
      pan:        pan   || null,
      buyerName:  user.full_name || user.email,
      buyerEmail: user.email,
      billingPeriodStart: new Date(),
      billingPeriodEnd:   renewalDate || null,
    });
    if (invoiceUrl) {
      await query(
        `UPDATE subscription_payments SET invoice_url=$1 WHERE id=$2`,
        [invoiceUrl, paymentId]
      ).catch(() => {});
    }
    return invoiceUrl;
  } catch (e) {
    console.error('[subscription/issueInvoice] non-critical:', e.message);
    return null;
  }
};

// ═══════════════════════════════════════════════════════════════════
// 1. GET /api/subscription/prices
// ═══════════════════════════════════════════════════════════════════
router.get('/prices', priceLimiter, async (req, res) => {
  res.set('Cache-Control', 'public, max-age=60'); // shorter than before — prices can now change from the ERP
  try {
    const prices = await getAllEffectivePrices(PLAN_CONFIG);
    return res.json({ prices });
  } catch (e) {
    console.error('[GET /subscription/prices]', e.message);
    // Fall back to the hardcoded defaults rather than fail the pricing page outright
    const prices = {};
    for (const [key, cfg] of Object.entries(PLAN_CONFIG)) {
      prices[key] = {
        monthly: cfg.monthly_paise !== null ? cfg.monthly_paise / 100 : null,
        annual:  cfg.annual_paise  !== null ? cfg.annual_paise  / 100 : null,
      };
    }
    return res.json({ prices });
  }
});

// ═══════════════════════════════════════════════════════════════════
// 1b. POST /api/subscription/coupon/validate
// body: { plan, cycle, coupon_code }
// Lets the checkout UI show "50% off applied" before the user commits to
// creating a Razorpay order — read-only, does not redeem/consume anything.
// ═══════════════════════════════════════════════════════════════════
router.post('/coupon/validate', authenticate,
  [
    body('plan').isIn(VALID_PLANS).withMessage('Invalid plan.'),
    body('cycle').isIn(VALID_CYCLES).withMessage('Invalid cycle.'),
    body('coupon_code').isString().trim().isLength({ min: 1, max: 40 }),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    const { plan, cycle, coupon_code } = req.body;
    try {
      const result = await validateCoupon(coupon_code, { userId: req.user.id, plan, cycle });
      if (!result.valid) return res.json({ valid: false, reason: result.reason });

      const basePaise = await getEffectivePricePaise(plan, cycle, PLAN_CONFIG);
      if (basePaise === null || basePaise === 0) return res.json({ valid: false, reason: 'Coupon not applicable to this plan.' });

      const discountPaise = computeDiscount(result.coupon, basePaise);
      const finalPaise    = basePaise - discountPaise;
      return res.json({
        valid: true,
        code: result.coupon.code,
        discountPaise, finalPaise, basePaise,
        discountLabel: result.coupon.discount_type === 'percent' ? `${result.coupon.discount_value}% off` : `₹${(discountPaise/100).toFixed(0)} off`,
      });
    } catch (e) {
      console.error('[POST /subscription/coupon/validate]', e.message);
      return res.status(500).json({ valid: false, reason: 'Could not validate coupon right now.' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════
// 2. POST /api/subscription/order
// ═══════════════════════════════════════════════════════════════════
router.post('/order',
  authenticate, requireKYC, payLimiter,
  [
    body('plan').isIn(VALID_PLANS).withMessage('Invalid plan.'),
    body('cycle').isIn(VALID_CYCLES).withMessage('Invalid cycle.'),
    body('idempotency_key').isString().trim().isLength({ min: 8, max: 64 }),
    body('coupon_code').optional().isString().trim().isLength({ max: 40 }),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    const { plan, cycle, idempotency_key, coupon_code } = req.body;
    const userId = req.user.id;
    try {
      const existing = await checkIdempotency(userId, idempotency_key);
      if (existing?.status === 'success') return res.json({ ok: true, duplicate: true });

      const basePaise = await getEffectivePricePaise(plan, cycle, PLAN_CONFIG);
      if (basePaise === null) return res.status(400).json({ error: 'Corporate plan requires contacting sales at support@ethertrack.in.' });
      if (basePaise === 0)   return res.status(400).json({ error: 'Use /free endpoint for free plan.' });

      let amountPaise    = basePaise;
      let discountPaise  = 0;
      let appliedCoupon  = null;
      if (coupon_code) {
        const result = await validateCoupon(coupon_code, { userId, plan, cycle });
        if (!result.valid) return res.status(400).json({ error: result.reason, code: 'COUPON_INVALID' });
        discountPaise = computeDiscount(result.coupon, basePaise);
        amountPaise   = basePaise - discountPaise;
        appliedCoupon = result.coupon.code;
      }

      // GST is charged on the net (post-discount) sale price, matching
      // standard invoicing practice for a discounted sale.
      const totalPaise = getTotalPaise(amountPaise);
      const order = await withRazorpay((rzp) => rzp.orders.create({
        amount: totalPaise, currency: 'INR',
        receipt: `et_${Date.now()}`,
        notes:   { user_id: userId, plan, cycle, idempotency_key, coupon_code: appliedCoupon || undefined },
      }));

      await insertPayment({
        user_id: userId, plan, cycle,
        amount_paise:       amountPaise,
        gst_amount_paise:   getGstPaise(amountPaise),
        total_amount_paise: totalPaise,
        pay_method: 'razorpay', status: 'pending',
        razorpay_order_id: order.id, idempotency_key,
        coupon_code: appliedCoupon, discount_paise: discountPaise,
      });

      return res.json({
        orderId: order.id, amount: totalPaise, currency: 'INR',
        ...(appliedCoupon ? { couponApplied: appliedCoupon, discountPaise, basePaise } : {}),
      });
    } catch (err) {
      console.error('[POST /subscription/order]', err.message);
      return res.status(500).json({ error: 'Could not create payment order.' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════
// 3. POST /api/subscription/verify
// ═══════════════════════════════════════════════════════════════════
router.post('/verify',
  authenticate, requireKYC, payLimiter,
  [
    body('plan').isIn(VALID_PLANS).withMessage('Invalid plan.'),
    body('cycle').isIn(VALID_CYCLES).withMessage('Invalid cycle.'),
    body('razorpay_order_id').isString().notEmpty(),
    body('razorpay_payment_id').isString().notEmpty(),
    body('razorpay_signature').isString().notEmpty(),
    body('gstin').optional().matches(GSTIN_RE).withMessage('Invalid GSTIN.'),
    body('pan').optional().matches(PAN_RE).withMessage('Invalid PAN.'),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    const { plan, cycle, razorpay_order_id, razorpay_payment_id, razorpay_signature, gstin, pan } = req.body;
    const userId = req.user.id;
    try {
      const expected = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');
      if (expected !== razorpay_signature)
        return res.status(400).json({ error: 'Payment signature verification failed.', code: 'SIGNATURE_MISMATCH' });

      const { rows: [payment] } = await query(
        `SELECT id, plan, cycle, amount_paise, status, coupon_code FROM subscription_payments
         WHERE razorpay_order_id=$1 AND user_id=$2 LIMIT 1`,
        [razorpay_order_id, userId]
      );
      if (!payment) return res.status(400).json({ error: 'Payment record not found.' });
      if (payment.status === 'success') return res.json({ ok: true, duplicate: true });

      // [DYNAMIC-PRICING/COUPON-FIX] amount_paise was already computed
      // server-side at /order time (from the effective price at that moment,
      // net of any coupon) and is trusted here — do NOT recompute against
      // getEffectivePricePaise now, since a live price change or an
      // already-applied coupon would cause a false AMOUNT_MISMATCH on an
      // otherwise-legitimate payment. What we DO still verify is that the
      // plan/cycle being activated matches what this specific order was
      // actually created for, so a client can't request one order then
      // claim a different (possibly pricier) plan on activation.
      if (payment.plan !== plan || payment.cycle !== cycle)
        return res.status(400).json({ error: 'Plan/cycle does not match the order created earlier.', code: 'PLAN_MISMATCH' });

      // [FIX-STRING-CONCAT] payment.amount_paise comes back from Postgres as
      // a STRING (node-pg's default behavior for BIGINT/NUMERIC columns, to
      // avoid silent precision loss on values beyond MAX_SAFE_INTEGER) — the
      // previous line here used it directly in `expectedPaise + gstPaise`,
      // which JS evaluates as STRING CONCATENATION whenever either operand
      // is a string, not addition. That produced a garbage total_amount_paise
      // (e.g. "14399910" + 2591984 → "143999102591984" instead of 17023894),
      // which then showed up as an absurd rupee figure anywhere that value
      // was displayed (divided by 100 for INR). Number(...) here guarantees
      // real arithmetic regardless of the column's underlying pg type.
      const expectedPaise = Number(payment.amount_paise);
      const gstPaise    = getGstPaise(expectedPaise);
      const totalPaise  = expectedPaise + gstPaise;
      const renewalDate = getRenewalDate(cycle);

      await query(
        `UPDATE subscription_payments SET
           status='success', razorpay_payment_id=$1,
           gst_amount_paise=$2, total_amount_paise=$3,
           gstin=$4, pan=$5, gstin_validated=$6, pan_validated=$7,
           renewal_date=$8, webhook_verified_at=NOW()
         WHERE id=$9`,
        [
          razorpay_payment_id, gstPaise, totalPaise,
          gstin || null, pan || null,
          gstin ? GSTIN_RE.test(gstin) : false,
          pan   ? PAN_RE.test(pan)     : false,
          renewalDate, payment.id,
        ]
      );

      await activatePlan({ userId, plan, cycle, paymentId: payment.id, renewalDate });
      const invoiceUrl = await issueInvoice({ paymentId: payment.id, plan, cycle, amountPaise: expectedPaise, gstin, pan, user: req.user, renewalDate });

      // [COUPON] Redemption is only recorded once payment is actually
      // confirmed — an abandoned checkout never burns the user's one-time use.
      if (payment.coupon_code) {
        try {
          const { rows: [couponRow] } = await query(`SELECT id FROM coupons WHERE code=$1`, [payment.coupon_code]);
          if (couponRow) {
            const { rows: [pRow] } = await query(`SELECT discount_paise FROM subscription_payments WHERE id=$1`, [payment.id]);
            await recordRedemption({
              couponId: couponRow.id, userId,
              subscriptionPaymentId: payment.id,
              discountPaise: pRow?.discount_paise || 0,
            });
          }
        } catch (e) {
          console.warn('[subscription/verify] coupon redemption record failed (non-fatal):', e.message);
        }
      }

      await createNotification(userId, 'WALLET',
        `${PLAN_CONFIG[plan].label} Plan Activated`,
        `Payment confirmed via Razorpay. ${PLAN_CONFIG[plan].label} plan is now active.`,
        '/billing', { plan, cycle }
      ).catch(() => {});

      return res.json({ ok: true, plan, cycle, renewalDate: renewalDate.toISOString(), invoiceUrl: invoiceUrl || null });
    } catch (err) {
      console.error('[POST /subscription/verify]', err.message);
      return res.status(500).json({ error: 'Activation failed after payment. Contact support@ethertrack.in.', code: 'ACTIVATION_FAILED' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════
// 4. POST /api/subscription/wallet-pay
// ═══════════════════════════════════════════════════════════════════
router.post('/wallet-pay',
  authenticate, requireKYC, payLimiter,
  [
    body('plan').isIn(VALID_PLANS).withMessage('Invalid plan.'),
    body('cycle').isIn(VALID_CYCLES).withMessage('Invalid cycle.'),
    body('idempotency_key').isString().trim().isLength({ min: 8, max: 64 }),
    body('gstin').optional().matches(GSTIN_RE).withMessage('Invalid GSTIN.'),
    body('pan').optional().matches(PAN_RE).withMessage('Invalid PAN.'),
    body('coupon_code').optional().isString().trim().isLength({ max: 40 }),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    const { plan, cycle, idempotency_key, gstin, pan, coupon_code } = req.body;
    const userId = req.user.id;
    try {
      const existing = await checkIdempotency(userId, idempotency_key);
      if (existing?.status === 'success') return res.json({ ok: true, duplicate: true });

      const basePaise = await getEffectivePricePaise(plan, cycle, PLAN_CONFIG);
      if (basePaise === null) return res.status(400).json({ error: 'Corporate plan requires contacting sales at support@ethertrack.in.' });
      if (basePaise === 0)   return res.status(400).json({ error: 'Use /free endpoint for free plan.' });

      let amountPaise   = basePaise;
      let discountPaise = 0;
      let appliedCoupon = null;
      let couponRowId   = null;
      if (coupon_code) {
        const result = await validateCoupon(coupon_code, { userId, plan, cycle });
        if (!result.valid) return res.status(400).json({ error: result.reason, code: 'COUPON_INVALID' });
        discountPaise = computeDiscount(result.coupon, basePaise);
        amountPaise   = basePaise - discountPaise;
        appliedCoupon = result.coupon.code;
        couponRowId   = result.coupon.id;
      }

      const gstPaise   = getGstPaise(amountPaise);
      const totalPaise = amountPaise + gstPaise;

      // FIX: read inr_balance when inr_balance_paise is 0
      const { rows: [freshUser] } = await query(
        `SELECT inr_balance_paise, inr_balance FROM users WHERE id=$1`, [userId]
      );
      const balancePaise = freshUser?.inr_balance_paise > 0
        ? parseInt(freshUser.inr_balance_paise)
        : Math.round((parseFloat(freshUser?.inr_balance) || 0) * 100);

      if (balancePaise < totalPaise)
        return res.status(400).json({
          error: `Insufficient wallet balance. Need ₹${(totalPaise/100).toFixed(2)}, have ₹${(balancePaise/100).toFixed(2)}.`,
          code:  'INSUFFICIENT_BALANCE',
        });

      const renewalDate = getRenewalDate(cycle);
      let paymentId;

      await withTransaction(async (client) => {
        // FIX: use explicit $13 for amount (INR) instead of $4::numeric/100
        // to avoid "inconsistent types deduced for parameter $4" pg error
        const { rows: [pay] } = await client.query(
          `INSERT INTO subscription_payments
             (user_id,plan,cycle,amount_paise,gst_amount_paise,total_amount_paise,
              pay_method,status,idempotency_key,gstin,pan,
              gstin_validated,pan_validated,renewal_date,amount,coupon_code,discount_paise)
           VALUES ($1,$2,$3,$4,$5,$6,'wallet','success',$7,$8,$9,$10,$11,$12,$13,$14,$15)
           RETURNING id`,
          [
            userId, plan, cycle, amountPaise, gstPaise, totalPaise,
            idempotency_key,
            gstin || null, pan || null,
            gstin ? GSTIN_RE.test(gstin) : false,
            pan   ? PAN_RE.test(pan)     : false,
            renewalDate,
            amountPaise / 100,  // $13 — computed in JS, no type ambiguity
            appliedCoupon, discountPaise,
          ]
        );
        paymentId = pay.id;

        // FIX: pass all args with explicit casts to avoid pg type inference conflict
        const { rows: [debit] } = await client.query(
          `SELECT debit_wallet_paise(
             $1::uuid,
             $2::bigint,
             $3::text,
             'subscription_payment'::text,
             NULL::uuid,
             $4::text
           ) AS new_balance`,
          [
            userId,
            totalPaise,
            `${plan} plan — ${cycle}`,
            `wallet_debit_${idempotency_key}`,
          ]
        );
        if (debit.new_balance === null) throw new Error('Wallet debit failed.');

        const { rows: [cur] } = await client.query(
          `SELECT subscription_plan, subscription_cycle FROM users WHERE id=$1`, [userId]
        );
        const ORDER   = ['free','starter','growth','corporate'];
        const fromIdx = ORDER.indexOf(cur?.subscription_plan);
        const toIdx   = ORDER.indexOf(plan);
        const event   =
          !cur?.subscription_plan || cur.subscription_plan === 'free' ? 'activated' :
          toIdx > fromIdx ? 'upgraded' : toIdx < fromIdx ? 'downgraded' : 'renewed';

        await client.query(
          `UPDATE users SET
             subscription_plan=$1, subscription_cycle=$2,
             subscription_renewal_date=$3,
             subscription_activated_at=COALESCE(subscription_activated_at,NOW()),
             plan_selected=TRUE, updated_at=NOW()
           WHERE id=$4`,
          [plan, cycle, renewalDate, userId]
        );

        await client.query(
          `INSERT INTO subscription_history
             (user_id,event_type,from_plan,to_plan,from_cycle,to_cycle,
              payment_id,amount_paise,gst_amount_paise,renewal_date,triggered_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'user')`,
          [
            userId, event,
            cur?.subscription_plan || null, plan,
            cur?.subscription_cycle || null, cycle,
            paymentId, amountPaise, gstPaise, renewalDate,
          ]
        );
      });

      const invoiceUrl = await issueInvoice({ paymentId, plan, cycle, amountPaise, gstin, pan, user: req.user, renewalDate });

      if (appliedCoupon && couponRowId) {
        await recordRedemption({ couponId: couponRowId, userId, subscriptionPaymentId: paymentId, discountPaise })
          .catch(e => console.warn('[wallet-pay] coupon redemption record failed (non-fatal):', e.message));
      }

      await createNotification(userId, 'WALLET',
        `${PLAN_CONFIG[plan].label} Plan Activated`,
        `₹${(totalPaise/100).toFixed(2)} debited from wallet. ${PLAN_CONFIG[plan].label} plan is now active.`,
        '/billing', { plan, cycle }
      ).catch(() => {});

      return res.json({ ok: true, plan, cycle, renewalDate: renewalDate.toISOString(), invoiceUrl: invoiceUrl || null });
    } catch (err) {
      console.error('[POST /subscription/wallet-pay]', err.message);
      const msg = err.message?.includes('Insufficient') ? err.message : 'Wallet payment failed.';
      return res.status(400).json({ error: msg });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════
// 5. POST /api/subscription/metamask-pay
// ═══════════════════════════════════════════════════════════════════
router.post('/metamask-pay',
  authenticate, requireKYC, payLimiter,
  [
    body('plan').isIn(VALID_PLANS).withMessage('Invalid plan.'),
    body('cycle').isIn(VALID_CYCLES).withMessage('Invalid cycle.'),
    body('wallet_address').isEthereumAddress().withMessage('Invalid Ethereum address.'),
    body('signature').isString().notEmpty(),
    body('message').isString().notEmpty(),
    body('gstin').optional().matches(GSTIN_RE).withMessage('Invalid GSTIN.'),
    body('pan').optional().matches(PAN_RE).withMessage('Invalid PAN.'),
    body('coupon_code').optional().isString().trim().isLength({ max: 40 }),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    const { plan, cycle, wallet_address, signature, message, gstin, pan, coupon_code } = req.body;
    const userId = req.user.id;
    try {
      if (!message.startsWith('EtherTrack:'))
        return res.status(400).json({ error: 'Invalid message prefix.' });
      const parts = message.split(':');
      if (parts.length !== 5) return res.status(400).json({ error: 'Invalid message format.' });
      const [, msgPlan, msgCycle, idempotencyKey, tsStr] = parts;
      const ts  = parseInt(tsStr, 10);
      const age = Date.now() - ts;

      if (!VALID_PLANS.includes(msgPlan) || !VALID_CYCLES.includes(msgCycle))
        return res.status(400).json({ error: 'Invalid plan/cycle in signed message.' });
      if (msgPlan !== plan || msgCycle !== cycle)
        return res.status(400).json({ error: 'Signed plan/cycle does not match request.' });
      if (isNaN(ts) || age > MM_MAX_AGE || age < -30000)
        return res.status(400).json({ error: `Signed message expired. Please retry.`, code: 'MESSAGE_EXPIRED' });

      let recovered;
      try { recovered = ethers.verifyMessage(message, signature); }
      catch (e) { return res.status(400).json({ error: `Invalid signature: ${e.message}` }); }

      if (recovered.toLowerCase() !== wallet_address.toLowerCase())
        return res.status(400).json({ error: 'Signature address mismatch.', code: 'ADDRESS_MISMATCH' });

      if (req.user.wallet_address &&
          recovered.toLowerCase() !== req.user.wallet_address.toLowerCase())
        return res.status(400).json({
          error: `Signing address does not match your registered wallet. Switch wallets in MetaMask.`,
          code:  'WALLET_MISMATCH',
        });

      const existing = await checkIdempotency(userId, idempotencyKey);
      if (existing?.status === 'success') return res.json({ ok: true, duplicate: true });

      const basePaise = await getEffectivePricePaise(plan, cycle, PLAN_CONFIG);
      if (basePaise === null) return res.status(400).json({ error: 'Corporate plan requires contacting sales.' });

      let amountPaise   = basePaise;
      let discountPaise = 0;
      let appliedCoupon = null;
      let couponRowId   = null;
      if (coupon_code) {
        const result = await validateCoupon(coupon_code, { userId, plan, cycle });
        if (!result.valid) return res.status(400).json({ error: result.reason, code: 'COUPON_INVALID' });
        discountPaise = computeDiscount(result.coupon, basePaise);
        amountPaise   = basePaise - discountPaise;
        appliedCoupon = result.coupon.code;
        couponRowId   = result.coupon.id;
      }

      const gstPaise    = getGstPaise(amountPaise);
      const totalPaise  = amountPaise + gstPaise;
      const renewalDate = getRenewalDate(cycle);

      const paymentId = await insertPayment({
        user_id: userId, plan, cycle,
        amount_paise: amountPaise, gst_amount_paise: gstPaise, total_amount_paise: totalPaise,
        pay_method: 'metamask', status: 'success',
        idempotency_key: idempotencyKey,
        wallet_address: recovered, signature,
        metamask_address: recovered, metamask_message: message,
        gstin: gstin || null, pan: pan || null, renewal_date: renewalDate,
        coupon_code: appliedCoupon, discount_paise: discountPaise,
      });

      await activatePlan({ userId, plan, cycle, paymentId, renewalDate });
      const invoiceUrl = await issueInvoice({ paymentId, plan, cycle, amountPaise, gstin, pan, user: req.user, renewalDate });

      if (appliedCoupon && couponRowId) {
        await recordRedemption({ couponId: couponRowId, userId, subscriptionPaymentId: paymentId, discountPaise })
          .catch(e => console.warn('[metamask-pay] coupon redemption record failed (non-fatal):', e.message));
      }

      await createNotification(userId, 'WALLET',
        `${PLAN_CONFIG[plan].label} Plan Activated via MetaMask`,
        `Signature verified. ${PLAN_CONFIG[plan].label} plan is now active.`,
        '/billing', { plan, cycle }
      ).catch(() => {});

      return res.json({ ok: true, plan, cycle, renewalDate: renewalDate.toISOString(), invoiceUrl: invoiceUrl || null });
    } catch (err) {
      console.error('[POST /subscription/metamask-pay]', err.message);
      return res.status(400).json({ error: err.message || 'MetaMask payment failed.' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════
// 6. POST /api/subscription/free
// ═══════════════════════════════════════════════════════════════════
router.post('/free', authenticate, async (req, res) => {
  const userId = req.user.id;
  try {
    await withTransaction(async (client) => {
      const paymentId = await insertPayment({
        user_id: userId, plan: 'free', cycle: 'monthly',
        amount_paise: 0, gst_amount_paise: 0, total_amount_paise: 0,
        pay_method: 'free', status: 'success',
        idempotency_key: `free_${userId}_${Date.now()}`,
        renewal_date: null,
      });

      await client.query(
        `UPDATE users SET
           subscription_plan='free', subscription_cycle='monthly',
           subscription_renewal_date=NULL,
           subscription_activated_at=COALESCE(subscription_activated_at,NOW()),
           plan_selected=TRUE, updated_at=NOW()
         WHERE id=$1`,
        [userId]
      );

      await client.query(
        `INSERT INTO subscription_history
           (user_id,event_type,from_plan,to_plan,from_cycle,to_cycle,
            payment_id,amount_paise,gst_amount_paise,triggered_by)
         VALUES ($1,'activated',$2,'free',$3,'monthly',$4,0,0,'user')`,
        [userId, req.user.subscription_plan||null, req.user.subscription_cycle||null, paymentId]
      );
    });

    const wasOnPaidPlan = req.user.subscription_plan && req.user.subscription_plan !== 'free';
    if (wasOnPaidPlan) {
      const fromPlanLabel = req.user.subscription_plan.charAt(0).toUpperCase() + req.user.subscription_plan.slice(1);
      sendSubscriptionCancelledEmail(req.user.email, {
        name: req.user.full_name, fromPlan: fromPlanLabel, downgradeTo: 'Free', effectiveNow: true,
        renewUrl: `${process.env.FRONTEND_URL}/billing`,
      }).catch(e => console.warn('[subscription/free] cancelled email failed:', e.message));
    } else {
      sendPlanSelectedEmail(req.user.email, {
        name: req.user.full_name, dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`,
      }).catch(e => console.warn('[subscription/free] plan-selected email failed:', e.message));
    }

    return res.json({ ok: true, plan: 'free', renewalDate: null });
  } catch (err) {
    console.error('[POST /subscription/free]', err.message);
    return res.status(500).json({ error: 'Free plan activation failed. Please retry.' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// 7. GET /api/subscription/history
// ═══════════════════════════════════════════════════════════════════
router.get('/history',
  authenticate,
  [
    qv('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
    qv('cursor').optional().isISO8601(),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    const userId = req.user.id;
    const limit  = req.query.limit || 20;
    const cursor = req.query.cursor || null;
    try {
      const { rows } = await query(
        `SELECT id, created_at, plan, cycle,
           amount_paise,
           ROUND(amount_paise::numeric/100,2) AS amount_inr,
           gst_amount_paise,
           ROUND(gst_amount_paise::numeric/100,2) AS gst_inr,
           total_amount_paise,
           ROUND(total_amount_paise::numeric/100,2) AS total_inr,
           pay_method, status, invoice_number, invoice_url,
           renewal_date, refunded_at, refund_amount_paise
         FROM subscription_payments
         WHERE user_id=$1 AND status IN ('success','refunded')
           ${cursor ? 'AND created_at < $3' : ''}
         ORDER BY created_at DESC LIMIT $2`,
        cursor ? [userId, limit+1, cursor] : [userId, limit+1]
      );
      const hasMore    = rows.length > limit;
      const history    = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? history[history.length-1].created_at : null;
      return res.json({ history, nextCursor, hasMore });
    } catch (err) {
      console.error('[GET /subscription/history]', err.message);
      return res.status(500).json({ error: 'Failed to load payment history.' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════
// 8. GET /api/subscription/invoice/:paymentId
// ═══════════════════════════════════════════════════════════════════
router.get('/invoice/:paymentId', authenticate, serveInvoice);

// ═══════════════════════════════════════════════════════════════════
// 9. POST /api/subscription/webhook/razorpay
// ═══════════════════════════════════════════════════════════════════
router.post('/webhook/razorpay',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig           = req.headers['x-razorpay-signature'];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!sig || !webhookSecret)
      return res.status(400).json({ error: 'Missing signature.' });

    const expected = crypto.createHmac('sha256', webhookSecret).update(req.body).digest('hex');
    if (expected !== sig) return res.status(400).json({ error: 'Webhook signature verification failed.' });

    let event;
    try { event = JSON.parse(req.body.toString()); }
    catch { return res.status(400).json({ error: 'Invalid JSON.' }); }

    const eventId     = event.id;
    const eventType   = event.event;
    const paymentData = event.payload?.payment?.entity;

    const { rows: [dup] } = await query(
      `SELECT id FROM subscription_payments WHERE webhook_event_id=$1 LIMIT 1`, [eventId]
    ).catch(() => ({ rows: [] }));
    if (dup) return res.json({ received: true, duplicate: true });

    try {
      if (eventType === 'payment.captured') {
        await query(
          `UPDATE subscription_payments SET
             status='success', razorpay_payment_id=$1,
             webhook_verified_at=NOW(), webhook_event_id=$2
           WHERE razorpay_order_id=$3 AND status='pending'`,
          [paymentData.id, eventId, paymentData.order_id]
        );
      } else if (eventType === 'payment.failed') {
        const { rows: [failedPayment] } = await query(
          `UPDATE subscription_payments SET
             status='failed', payment_failed_reason=$1,
             failure_code=$2, webhook_event_id=$3
           WHERE razorpay_order_id=$4 AND status='pending'
           RETURNING user_id, plan, amount`,
          [paymentData.error_description||'Payment failed', paymentData.error_code||null, eventId, paymentData.order_id]
        );

        if (failedPayment) {
          const { rows: [user] } = await query(
            `SELECT email, full_name FROM users WHERE id=$1`, [failedPayment.user_id]
          ).catch(() => ({ rows: [] }));
          if (user?.email) {
            const planLabel = failedPayment.plan.charAt(0).toUpperCase() + failedPayment.plan.slice(1);
            sendPaymentFailedEmail(user.email, {
              name: user.full_name, plan: planLabel, amount: failedPayment.amount,
              retryUrl: `${process.env.FRONTEND_URL}/billing`,
            }).catch(e => console.warn('[webhook/razorpay] payment-failed email failed:', e.message));
          }
        }
      } else if (eventType === 'refund.processed') {
        const refund = event.payload?.refund?.entity;
        await query(
          `UPDATE subscription_payments SET
             status='refunded', refunded_at=NOW(),
             refund_amount_paise=$1, refund_ref=$2, webhook_event_id=$3
           WHERE razorpay_payment_id=$4`,
          [refund.amount, refund.id, eventId, refund.payment_id]
        );
      }
      return res.json({ received: true });
    } catch (err) {
      console.error('[webhook/razorpay]', err.message);
      return res.status(500).json({ error: 'Webhook processing failed.' });
    }
  }
);

module.exports = router;