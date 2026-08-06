'use strict';
// services/corporateActivation.js
//
// Extracted out of routes/admin.js so the exact same logic is used whether
// a Corporate deal is activated/renewed from the platform's own Admin Panel
// (routes/admin.js, human admin session) or pushed from the ERP (etpl_ops)
// via routes/opsIntegrationCorporate.js (service-token call, triggered by
// Sales marking a deal won or Product/Ops setting up a renewal). One code
// path, two callers — no risk of the two surfaces drifting out of sync.
//
// [SIGNATURE] activateCorporate(userId, opts, actorId) / updateCorporateRenewal
// (userId, opts, actorId) — positional args matching exactly how
// routes/admin.js calls this module. actorId is 'admin' user id when called
// from the Admin Panel, or the literal string 'erp' when called from
// routes/opsIntegrationCorporate.js's service-token path (no human admin
// session exists there).

const { safeQuery: query, withTransaction } = require('../db/pool');
const { invalidateUserCache } = require('../middleware/auth');
const { createNotification } = require('../routes/notifications');
const { sendCorporatePlanActivatedEmail } = require('../services/email');

// activateCorporate(userId, opts, actorId) — creates/reactivates a Corporate
// subscription for a user: records a subscription_payments row
// (pay_method='sales', since the actual money moved outside the platform —
// bank transfer/cheque/invoice, arranged directly between Sales and the
// customer), sets the user's plan + renewal date, and sets seats on their
// organisation.
async function activateCorporate(userId, opts = {}, actorId = 'admin') {
  const {
    cycle = 'annual', seats = null, customPriceINR = 0,
    notes = '', renewalMonths = null,
  } = opts;

  if (!['monthly', 'annual'].includes(cycle))
    throw Object.assign(new Error('cycle must be monthly or annual'), { status: 400 });
  if (seats !== null && (!Number.isInteger(seats) || seats < 1))
    throw Object.assign(new Error('seats must be a positive integer or null (unlimited)'), { status: 400 });
  const priceINR = parseFloat(customPriceINR) || 0;
  if (priceINR < 0)
    throw Object.assign(new Error('customPriceINR cannot be negative'), { status: 400 });

  const { rows: userRows } = await query(
    `SELECT id, email, full_name, company_name, kyc_verified,
            subscription_plan, subscription_cycle, org_id
     FROM users WHERE id = $1`, [userId]
  );
  if (!userRows.length) throw Object.assign(new Error('User not found'), { status: 404 });
  const user = userRows[0];

  const renewalDate = new Date();
  if (renewalMonths && Number.isInteger(parseInt(renewalMonths)) && parseInt(renewalMonths) > 0) {
    renewalDate.setMonth(renewalDate.getMonth() + parseInt(renewalMonths));
  } else if (cycle === 'annual') {
    renewalDate.setFullYear(renewalDate.getFullYear() + 1);
  } else {
    renewalDate.setMonth(renewalDate.getMonth() + 1);
  }

  const customPricePaise = Math.round(priceINR * 100);
  const idempotencyKey   = `corporate_sales_${userId}_${Date.now()}`;

  await withTransaction(async (client) => {
    const ORDER   = ['free', 'starter', 'growth', 'corporate'];
    const fromIdx = ORDER.indexOf(user.subscription_plan || 'free');
    const event   = fromIdx < ORDER.indexOf('corporate') ? 'upgraded' : 'activated';

    const { rows: [pay] } = await client.query(
      `INSERT INTO subscription_payments
         (user_id, plan, cycle, amount_paise, gst_amount_paise, total_amount_paise,
          pay_method, status, idempotency_key, renewal_date, amount, notes)
       VALUES ($1,'corporate',$2,$3,0,$3,'sales','success',$4,$5,$6,$7)
       RETURNING id`,
      [userId, cycle, customPricePaise, idempotencyKey, renewalDate, priceINR, notes || null]
    );

    await client.query(
      `UPDATE users SET
         subscription_plan         = 'corporate',
         subscription_cycle        = $1,
         subscription_renewal_date = $2,
         subscription_activated_at = COALESCE(subscription_activated_at, NOW()),
         plan_selected             = TRUE,
         corporate_managed         = TRUE,
         updated_at                = NOW()
       WHERE id = $3`,
      [cycle, renewalDate, userId]
    );

    await client.query(
      `INSERT INTO subscription_history
         (user_id, event_type, from_plan, to_plan, from_cycle, to_cycle,
          payment_id, amount_paise, gst_amount_paise, renewal_date, triggered_by, notes)
       VALUES ($1,$2,$3,'corporate',$4,$5,$6,$7,0,$8,$9,$10)`,
      [userId, event, user.subscription_plan || 'free', user.subscription_cycle || null,
       cycle, pay.id, customPricePaise, renewalDate, actorId === 'erp' ? 'erp' : 'admin', notes || null]
    );

    const seatLimit = (seats !== null && seats > 0) ? seats : 999;
    await client.query(
      `UPDATE organisations SET seats_limit=$1, updated_at=NOW() WHERE owner_id=$2`,
      [seatLimit, userId]
    );
  });

  await invalidateUserCache(userId);
  await createNotification(userId, 'WALLET', '🏢 Corporate Plan Activated',
    `Your Corporate plan has been activated by the EtherTrack team.${notes ? ` Note: ${notes}` : ''}`,
    '/billing', { plan: 'corporate', cycle }).catch(() => {});

  const { rows: [freshUser] } = await query('SELECT email, full_name FROM users WHERE id=$1', [userId]);
  setImmediate(async () => {
    try {
      const seatDisplay = (seats !== null && seats > 0) ? seats : 'Unlimited';
      await sendCorporatePlanActivatedEmail(freshUser.email, {
        name: freshUser.full_name,
        seatDisplay, cycle,
        renewalDateLabel: renewalDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
        priceINR, notes,
        billingUrl: `${process.env.FRONTEND_URL}/billing`,
      });
    } catch (e) { console.warn('[corporateActivation/activate] email failed:', e.message); }
  });

  return { userId, plan: 'corporate', cycle, seats: seats ?? 'unlimited', renewalDate, customPriceINR: priceINR };
}

// updateCorporateRenewal(userId, opts, actorId) — extends (or corrects) the
// renewal date on an ALREADY-active Corporate account. Does not touch
// pricing/payment records — for a genuinely new payment/term, call
// activateCorporate again instead (it upserts cleanly since it's keyed by
// user, not by a "deal id").
async function updateCorporateRenewal(userId, opts = {}, actorId = 'admin') {
  const { renewalDate, seats, notes = '' } = opts;
  if (!renewalDate) throw Object.assign(new Error('renewalDate required (ISO string or YYYY-MM-DD)'), { status: 400 });
  const parsed = new Date(renewalDate);
  if (isNaN(parsed.getTime())) throw Object.assign(new Error('Invalid renewalDate'), { status: 400 });
  if (parsed < new Date()) throw Object.assign(new Error('renewalDate must be in the future'), { status: 400 });

  const { rows } = await query(`SELECT subscription_plan, email, full_name FROM users WHERE id=$1`, [userId]);
  if (!rows.length) throw Object.assign(new Error('User not found'), { status: 404 });
  if (rows[0].subscription_plan !== 'corporate')
    throw Object.assign(new Error('User is not on Corporate plan — activate first'), { status: 400 });

  await query(
    `UPDATE users SET subscription_renewal_date=$1, corporate_managed=TRUE, updated_at=NOW() WHERE id=$2`,
    [parsed, userId]
  );
  if (seats != null) {
    const seatLimit = seats === 'unlimited' ? 999 : parseInt(seats);
    if (!isNaN(seatLimit) && seatLimit > 0)
      await query(`UPDATE organisations SET seats_limit=$1, updated_at=NOW() WHERE owner_id=$2`, [seatLimit, userId]);
  }
  await invalidateUserCache(userId);
  await createNotification(userId, 'WALLET', '📅 Corporate Plan Renewed',
    `Your Corporate plan has been renewed until ${parsed.toLocaleDateString('en-IN')}.`,
    '/billing', { plan: 'corporate' }).catch(() => {});

  return { renewalDate: parsed };
}

// listCorporateActivations() — read helper for both the Admin Panel and the
// ERP's own dashboard view (fetchCorporateActivations() in the ERP's
// services/platformClient.js).
async function listCorporateActivations() {
  const { rows } = await query(
    `SELECT u.id, u.email, u.full_name, u.company_name,
            u.subscription_cycle, u.subscription_renewal_date,
            u.subscription_activated_at, o.seats_limit,
            sp.amount, sp.notes, sp.created_at AS activated_payment_at
     FROM users u
     LEFT JOIN organisations o ON o.owner_id = u.id
     LEFT JOIN LATERAL (
       SELECT amount, notes, created_at FROM subscription_payments
       WHERE user_id = u.id AND plan = 'corporate' AND status = 'success'
       ORDER BY created_at DESC LIMIT 1
     ) sp ON TRUE
     WHERE u.subscription_plan = 'corporate' AND u.corporate_managed = TRUE
     ORDER BY u.subscription_renewal_date ASC NULLS LAST`
  );
  return rows;
}

module.exports = { activateCorporate, updateCorporateRenewal, listCorporateActivations };