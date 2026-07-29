'use strict';
// services/corporateActivation.js
//
// Extracted from routes/admin.js's activate-corporate / corporate-renewal /
// corporate/activations handlers, unchanged in behavior. Exists so this
// logic has exactly one implementation, callable from:
//   1. routes/admin.js  — human admin, session-cookie auth (isAdmin)
//   2. routes/opsIntegration.js — the ERP, service-token auth
//
// `actorId` is the acting admin's user id for the audit log / notification
// trail. Pass null when triggered by the ERP (no human admin session) —
// auditLog already tolerates a null admin_id elsewhere in this file, and
// the `details` string below makes it clear in the audit log that this
// came from the ERP rather than a click in the console.

const { safeQuery: query, withTransaction } = require('../db/pool');
const { invalidateUserCache } = require('../middleware/auth');
const { createNotification } = require('../routes/notifications');
const { sendCorporatePlanActivatedEmail } = require('./email');

const auditLog = async (adminId, action, targetUserId, details) => {
  try {
    await query(
      `INSERT INTO admin_audit_log (admin_id, action, target_user_id, details) VALUES ($1,$2,$3,$4)`,
      [adminId, action, targetUserId || null, details || null]
    );
  } catch (e) { console.warn('[auditLog] failed:', e.message); }
};

async function activateCorporate(userId, { cycle = 'annual', seats = null, customPriceINR = 0, notes = '', renewalMonths = null }, actorId) {
  if (!['monthly', 'annual'].includes(cycle)) {
    throw Object.assign(new Error('cycle must be monthly or annual'), { status: 400 });
  }
  if (seats !== null && (!Number.isInteger(seats) || seats < 1)) {
    throw Object.assign(new Error('seats must be a positive integer or null (unlimited)'), { status: 400 });
  }
  const priceINR = parseFloat(customPriceINR) || 0;
  if (priceINR < 0) throw Object.assign(new Error('customPriceINR cannot be negative'), { status: 400 });

  const { rows: userRows } = await query(
    `SELECT id, email, full_name, company_name, kyc_verified, subscription_plan, subscription_cycle, org_id
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
  const idempotencyKey = `corporate_sales_${userId}_${Date.now()}`;

  await withTransaction(async (client) => {
    const ORDER = ['free', 'starter', 'growth', 'corporate'];
    const fromIdx = ORDER.indexOf(user.subscription_plan || 'free');
    const event = fromIdx < ORDER.indexOf('corporate') ? 'upgraded' : 'activated';

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
         subscription_plan = 'corporate', subscription_cycle = $1, subscription_renewal_date = $2,
         subscription_activated_at = COALESCE(subscription_activated_at, NOW()),
         plan_selected = TRUE, corporate_managed = TRUE, updated_at = NOW()
       WHERE id = $3`,
      [cycle, renewalDate, userId]
    );

    await client.query(
      `INSERT INTO subscription_history
         (user_id, event_type, from_plan, to_plan, from_cycle, to_cycle,
          payment_id, amount_paise, gst_amount_paise, renewal_date, triggered_by, notes)
       VALUES ($1,$2,$3,'corporate',$4,$5,$6,$7,0,$8,$9,$10)`,
      [userId, event, user.subscription_plan || 'free', user.subscription_cycle || null,
       cycle, pay.id, customPricePaise, renewalDate, actorId ? 'admin' : 'erp_sync', notes || null]
    );

    const seatLimit = (seats !== null && seats > 0) ? seats : 999;
    await client.query(`UPDATE organisations SET seats_limit=$1, updated_at=NOW() WHERE owner_id=$2`, [seatLimit, userId]);
  });

  await invalidateUserCache(userId);
  await createNotification(userId, 'WALLET', '🏢 Corporate Plan Activated',
    `Your Corporate plan has been activated by the EtherTrack team.${notes ? ` Note: ${notes}` : ''}`,
    '/billing', { plan: 'corporate', cycle }).catch(() => {});

  setImmediate(async () => {
    try {
      const seatDisplay = (seats !== null && seats > 0) ? seats : 'Unlimited';
      await sendCorporatePlanActivatedEmail(user.email, {
        name: user.full_name, seatDisplay, cycle,
        renewalDateLabel: renewalDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
        priceINR, notes, billingUrl: `${process.env.FRONTEND_URL}/billing`,
      });
    } catch (e) { console.warn('[activateCorporate] email failed:', e.message); }
  });

  await auditLog(actorId, 'CORPORATE_PLAN_ACTIVATED', userId,
    `Cycle: ${cycle} · Seats: ${seats ?? 'unlimited'} · Price: ₹${priceINR} · ${notes || ''}` +
    (actorId ? '' : ' [triggered by ERP Sales — deal won]'));

  return { userId, plan: 'corporate', cycle, seats: seats ?? 'unlimited', renewalDate: renewalDate.toISOString(), customPriceINR: priceINR };
}

async function updateCorporateRenewal(userId, { renewalDate, seats, notes }, actorId) {
  if (!renewalDate) throw Object.assign(new Error('renewalDate required (ISO string or YYYY-MM-DD)'), { status: 400 });
  const parsed = new Date(renewalDate);
  if (isNaN(parsed.getTime())) throw Object.assign(new Error('Invalid renewalDate'), { status: 400 });
  if (parsed < new Date()) throw Object.assign(new Error('renewalDate must be in the future'), { status: 400 });

  const { rows } = await query(`SELECT subscription_plan, email, full_name FROM users WHERE id=$1`, [userId]);
  if (!rows.length) throw Object.assign(new Error('User not found'), { status: 404 });
  if (rows[0].subscription_plan !== 'corporate')
    throw Object.assign(new Error('User is not on Corporate plan — activate first'), { status: 400 });

  await query(`UPDATE users SET subscription_renewal_date=$1, corporate_managed=TRUE, updated_at=NOW() WHERE id=$2`, [parsed, userId]);
  if (seats != null) {
    const seatLimit = seats === 'unlimited' ? 999 : parseInt(seats);
    if (!isNaN(seatLimit) && seatLimit > 0)
      await query(`UPDATE organisations SET seats_limit=$1, updated_at=NOW() WHERE owner_id=$2`, [seatLimit, userId]);
  }
  await invalidateUserCache(userId);
  await auditLog(actorId, 'CORPORATE_RENEWAL_UPDATED', userId,
    `New renewal: ${parsed.toISOString()} · Seats: ${seats ?? 'unchanged'} · ${notes || ''}` + (actorId ? '' : ' [triggered by ERP]'));
  await createNotification(userId, 'WALLET', '📅 Corporate Plan Renewed',
    `Your Corporate plan has been renewed until ${parsed.toLocaleDateString('en-IN')}.`, '/billing', { plan: 'corporate' }).catch(() => {});

  return { renewalDate: parsed.toISOString() };
}

async function listCorporateActivations() {
  const { rows } = await query(
    `SELECT DISTINCT ON (u.id)
            u.id, u.email, u.full_name, u.company_name,
            u.subscription_plan, u.subscription_cycle,
            u.subscription_renewal_date, u.subscription_activated_at,
            u.corporate_managed, u.kyc_verified,
            sp.amount_paise, sp.pay_method, sp.created_at AS payment_date, sp.notes AS activation_notes,
            o.seats_limit, o.name AS org_name
     FROM users u
     LEFT JOIN subscription_payments sp ON sp.user_id = u.id AND sp.plan = 'corporate' AND sp.status = 'success'
     LEFT JOIN organisations o ON o.owner_id = u.id
     WHERE u.subscription_plan = 'corporate'
     ORDER BY u.id, sp.created_at DESC NULLS LAST`
  );
  return rows;
}

module.exports = { activateCorporate, updateCorporateRenewal, listCorporateActivations };