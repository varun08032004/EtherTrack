// routes/org.js — EtherTrack
// ─────────────────────────────────────────────────────────────────
// FIXES APPLIED (v3):
//
// [FIX-1]  GET /:orgId/members — membership guard added.
// [FIX-2]  GET /:orgId/retirement-queue — membership guard added.
// [FIX-3]  POST /plan/select (wallet path) — idempotency guard.
// [FIX-4]  MetaMask signed message format validation tightened.
// [FIX-5]  Org slug uses crypto random suffix for uniqueness.
//
// [v4-PLAN] PLAN_CONFIG updated to confirmed tier structure:
//   Free:      ₹0         · 1.5% gas · 1 seat
//   Starter:   ₹1,499/mo  · 1% gas   · 3 seats  (₹14,990/yr)
//   Growth:    ₹7,999/mo  · 0.75% gas· 10 seats  (₹79,990/yr)
//   Corporate: Contact Sales · 0.5% negotiated · custom seats
//   Enterprise: ₹75,000/mo floor · 0.4% gas (backend only)
// ─────────────────────────────────────────────────────────────────
'use strict';

const router     = require('express').Router();
const { ethers } = require('ethers');
const Razorpay   = require('razorpay');
const crypto     = require('crypto');
const { safeQuery: query, getClient } = require('../db/pool');
const { authenticate }     = require('../middleware/auth');
const { requireRole, getPermissions } = require('../middleware/rbac');
const { sendOrgInviteEmail, sendSubscriptionExpiringSoonEmail, sendSubscriptionExpiredEmail, sendOrgRetirementRequestedEmail, sendOrgRetirementRejectedEmail, sendRetirementEmail } = require('../services/email');
const { createNotification } = require('./notifications');
const { generateGSTInvoice, serveInvoice } = require('../services/invoice');

// ── Razorpay ──────────────────────────────────────────────────────
const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ── Plan config — [v4-PLAN] updated pricing ───────────────────────
const PLAN_CONFIG = {
  free: {
    label:         'Free',
    badge:         'Explorer',
    price_monthly: 0,
    price_annual:  0,
    seats:         1,
    gasFee:        0.015,   // 1.5%
  },
  starter: {
    label:         'Starter',
    badge:         'Trader',
    price_monthly: 1499,    // ₹1,499
    price_annual:  14990,   // ₹14,990
    seats:         3,       // [v4] updated from 1 → 3
    gasFee:        0.01,    // 1%
  },
  growth: {
    label:         'Growth',
    badge:         'Business',
    price_monthly: 7999,    // ₹7,999  [v4] updated from ₹3,999
    price_annual:  79990,   // ₹79,990 [v4] updated from ₹39,990
    seats:         10,      // [v4] updated from 5 → 10
    gasFee:        0.0075,  // 0.75%
  },
  corporate: {
    label:         'Corporate',
    badge:         'Enterprise',
    price_monthly: null,    // [v4] Contact Sales — custom pricing
    price_annual:  null,    // custom
    seats:         null,    // custom
    gasFee:        0.005,   // 0.5% negotiated [v4] updated from 0.006
  },
};

const getRenewalDate = (cycle) => {
  const d = new Date();
  if (cycle === 'annual') d.setFullYear(d.getFullYear() + 1);
  else                    d.setMonth(d.getMonth() + 1);
  return d;
};

// ── Helper: verify requester is org member ────────────────────────
const assertOrgMember = async (orgId, userId) => {
  const { rows } = await query(
    `SELECT team_role FROM org_members
     WHERE org_id = $1 AND user_id = $2 AND status = 'active'`,
    [orgId, userId]
  );
  if (!rows.length) {
    const err = new Error('Not a member of this organisation');
    err.statusCode = 403;
    throw err;
  }
  return rows[0].team_role;
};

// ── Apply plan to DB ──────────────────────────────────────────────
async function applyPlan(userId, plan, cycle, payMethod, extraMeta = {}) {
  const renewalDate = getRenewalDate(cycle);
  const cfg         = PLAN_CONFIG[plan];
  const amount      = cycle === 'annual' ? cfg?.price_annual : cfg?.price_monthly;

  await query(
    `UPDATE users SET
       subscription_plan         = $1,
       plan_selected             = TRUE,
       subscription_cycle        = $2,
       subscription_renewal_date = $3,
       subscription_activated_at = NOW(),
       updated_at                = NOW()
     WHERE id = $4`,
    [plan, cycle, renewalDate, userId]
  );

  const { rows: payRows } = await query(
    `INSERT INTO subscription_payments
       (user_id, plan, cycle, amount, pay_method, wallet_address, signature,
        razorpay_order_id, razorpay_payment_id, gstin, pan, status, renewal_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'success',$12)
     RETURNING id`,
    [
      userId, plan, cycle, amount || 0, payMethod,
      extraMeta.walletAddr          || null,
      extraMeta.signature           || null,
      extraMeta.razorpay_order_id   || null,
      extraMeta.razorpay_payment_id || null,
      extraMeta.gstin               || null,
      extraMeta.pan                 || null,
      renewalDate,
    ]
  );

  return { renewalDate, amount, paymentId: payRows[0]?.id };
}

// ── Issue GST invoice (non-blocking) ─────────────────────────────
async function issueInvoice(userId, paymentId, plan, cycle, amount, extraMeta = {}) {
  try {
    const { rows: userRows } = await query(
      `SELECT full_name, email, company_name FROM users WHERE id=$1`, [userId]
    );
    const user = userRows[0] || {};
    const invoiceUrl = await generateGSTInvoice({
      paymentId, plan, cycle, amount,
      amountWithGST: Math.round(amount * 1.18),
      gstin:         extraMeta.gstin || null,
      pan:           extraMeta.pan   || null,
      buyerName:     user.company_name || user.full_name || '',
      buyerEmail:    user.email || '',
    });

    if (invoiceUrl) {
      await query(
        `UPDATE subscription_payments SET invoice_url=$1 WHERE id=$2`,
        [invoiceUrl, paymentId]
      );
      // NOTE: no email sent here — generateGSTInvoice() already sends the
      // GST tax invoice email internally (services/invoice.js). Sending
      // another one here was a duplicate-send bug; users were getting two
      // "invoice" emails per payment.
    }

    return invoiceUrl;
  } catch (e) {
    console.error('[org/issueInvoice] failed:', e.message);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════
// ── ORG ROUTES ───────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════

router.post('/create', authenticate, async (req, res) => {
  const { name, cin, gstin, pan, industry, companyType } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Organisation name required' });
  try {
    const { rows: existing } = await query(
      `SELECT id FROM organisations WHERE owner_id=$1`, [req.user.id]
    );
    if (existing.length) return res.status(409).json({ error: 'You already own an organisation.' });

    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 46);
    const slug     = `${baseSlug}-${crypto.randomBytes(3).toString('hex')}`;

    const { rows } = await query(
      `INSERT INTO organisations
         (name,slug,cin,gstin,pan,industry,company_type,owner_id,
          subscription_plan,subscription_status,seats_limit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'starter','trial',3)
       RETURNING *`,
      [name.trim(), slug, cin||null, gstin||null, pan||null, industry||null, companyType||null, req.user.id]
    );
    const org = rows[0];
    await query(
      `INSERT INTO org_members (org_id,user_id,team_role,status,accepted_at)
       VALUES ($1,$2,'owner','active',NOW())`,
      [org.id, req.user.id]
    );
    await query(
      `UPDATE users SET org_id=$1, team_role='owner' WHERE id=$2`,
      [org.id, req.user.id]
    );
    res.status(201).json({ message: 'Organisation created', org });
  } catch (e) {
    console.error('[org/create]', e.message);
    res.status(500).json({ error: 'Failed to create organisation', detail: e.message });
  }
});

router.get('/me', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT o.*, om.team_role, om.status AS member_status, om.accepted_at
       FROM organisations o JOIN org_members om ON om.org_id=o.id
       WHERE om.user_id=$1 AND om.status='active' LIMIT 1`,
      [req.user.id]
    );
    if (!rows.length) return res.json({ org: null, teamRole: null });
    const org = rows[0];
    res.json({ org, teamRole: org.team_role, permissions: getPermissions(org.team_role) });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch organisation' }); }
});

router.get('/:orgId/members', authenticate, async (req, res) => {
  try {
    await assertOrgMember(req.params.orgId, req.user.id);
    const { rows } = await query(
      `SELECT om.id, om.team_role, om.status, om.invited_at, om.accepted_at,
              u.id AS user_id, u.full_name, u.email, u.wallet_address,
              u.kyc_verified, u.kyc_status
       FROM org_members om LEFT JOIN users u ON u.id=om.user_id
       WHERE om.org_id=$1
       ORDER BY CASE om.team_role
         WHEN 'owner'   THEN 1 WHEN 'admin'   THEN 2
         WHEN 'manager' THEN 3 WHEN 'auditor' THEN 4
         WHEN 'viewer'  THEN 5 ELSE 6 END`,
      [req.params.orgId]
    );
    res.json({ members: rows });
  } catch (e) {
    if (e.statusCode === 403) return res.status(403).json({ error: e.message });
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

router.post('/:orgId/invite', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  const { email, teamRole = 'viewer' } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const validRoles = ['admin', 'manager', 'viewer', 'auditor'];
  if (!validRoles.includes(teamRole))
    return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
  try {
    const { rows: org }     = await query(`SELECT seats_limit, name FROM organisations WHERE id=$1`, [req.params.orgId]);
    const { rows: members } = await query(`SELECT COUNT(*) AS cnt FROM org_members WHERE org_id=$1 AND status='active'`, [req.params.orgId]);
    if (parseInt(members[0].cnt) >= (org[0]?.seats_limit || 3))
      return res.status(403).json({ error: 'Seat limit reached. Upgrade your plan.' });
    const { rows: existing } = await query(
      `SELECT om.id FROM org_members om JOIN users u ON u.id=om.user_id
       WHERE om.org_id=$1 AND u.email=$2`,
      [req.params.orgId, email]
    );
    if (existing.length) return res.status(409).json({ error: 'User is already a member' });
    const token = crypto.randomBytes(32).toString('hex');
    await query(
      `INSERT INTO org_invites (org_id,email,team_role,token,invited_by,expires_at)
       VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL '7 days')
       ON CONFLICT (org_id,email) DO UPDATE
         SET token=EXCLUDED.token, team_role=EXCLUDED.team_role,
             expires_at=EXCLUDED.expires_at, accepted_at=NULL`,
      [req.params.orgId, email, teamRole, token, req.user.id]
    );
    const inviteUrl = `${process.env.FRONTEND_URL}/join-org?token=${token}`;
    const roleDescription = {
      admin:   `As Admin — you'll be able to manage the team, approve carbon credit retirements, and access all emissions data.`,
      manager: `As Manager — you'll be able to log Scope 1, 2 & 3 emissions, manage the carbon credit portfolio, and export ESG reports.`,
      auditor: `As Auditor — you'll have read-only access to all emissions data, portfolio, and can export PDF reports for verification.`,
      viewer:  `As Viewer — you'll have read-only access to the dashboard, emissions summary, and carbon credit portfolio.`,
    }[teamRole] || `As ${teamRole} on the ESG emissions tracking and carbon credit platform.`;

    sendOrgInviteEmail(email, {
      orgName: org[0]?.name,
      inviterName: req.user.full_name,
      roleDescription,
      inviteUrl,
    }).catch(e => console.warn('[org/invite] email failed:', e.message));
    res.json({ message: `Invite sent to ${email}`, inviteUrl });
  } catch (e) {
    console.error('[org/invite]', e.message);
    res.status(500).json({ error: 'Failed to send invite', detail: e.message });
  }
});

router.get('/invite-preview', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required' });
  try {
    const { rows } = await query(
      `SELECT oi.team_role, oi.email, oi.expires_at, oi.accepted_at,
              o.name AS org_name, o.id AS org_id, o.industry
       FROM org_invites oi JOIN organisations o ON o.id=oi.org_id
       WHERE oi.token=$1`,
      [token]
    );
    if (!rows.length) return res.status(404).json({ error: 'Invalid invite token' });
    const inv = rows[0];
    if (inv.accepted_at) return res.status(410).json({ error: 'Invite already accepted' });
    if (new Date(inv.expires_at) < new Date()) return res.status(410).json({ error: 'Invite has expired' });
    res.json({ invite: { token, team_role: inv.team_role, org_name: inv.org_name, org_id: inv.org_id, industry: inv.industry, email: inv.email } });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch invite details' }); }
});

router.post('/accept-invite', authenticate, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });
  try {
    const { rows: invite } = await query(
      `SELECT * FROM org_invites WHERE token=$1 AND expires_at>NOW() AND accepted_at IS NULL`,
      [token]
    );
    if (!invite.length) return res.status(404).json({ error: 'Invalid or expired invite' });
    const inv = invite[0];
    if (req.user.email !== inv.email)
      return res.status(403).json({ error: 'Invite is for a different email address' });
    await query(
      `INSERT INTO org_members (org_id,user_id,team_role,invited_by,status,accepted_at)
       VALUES ($1,$2,$3,$4,'active',NOW())
       ON CONFLICT (org_id,user_id) DO UPDATE
         SET team_role=EXCLUDED.team_role, status='active', accepted_at=NOW()`,
      [inv.org_id, req.user.id, inv.team_role, inv.invited_by]
    );
    await query(`UPDATE org_invites SET accepted_at=NOW() WHERE id=$1`, [inv.id]);
    await query(`UPDATE users SET org_id=$1, team_role=$2 WHERE id=$3`, [inv.org_id, inv.team_role, req.user.id]);
    const { rows: org }       = await query(`SELECT name, owner_id FROM organisations WHERE id=$1`, [inv.org_id]);
    const { rows: newMember } = await query('SELECT full_name, email FROM users WHERE id=$1', [req.user.id]);
    await createNotification(req.user.id, 'TEAM', '🎉 Welcome to the Team',
      `You have successfully joined ${org[0]?.name} as ${inv.team_role}.`,
      '/team', { orgId: inv.org_id, role: inv.team_role, orgName: org[0]?.name });
    if (org[0]?.owner_id && org[0].owner_id !== req.user.id) {
      await createNotification(org[0].owner_id, 'TEAM', '👥 Team Member Joined',
        `${newMember[0]?.full_name || inv.email} joined ${org[0]?.name} as ${inv.team_role}.`,
        '/team', { memberId: req.user.id, role: inv.team_role, memberEmail: inv.email });
    }
    res.json({ message: `Joined ${org[0]?.name} as ${inv.team_role}`, teamRole: inv.team_role });
  } catch (e) {
    console.error('[org/accept-invite]', e.message);
    res.status(500).json({ error: 'Failed to accept invite' });
  }
});

router.patch('/:orgId/members/:userId/role', authenticate, requireRole('owner'), async (req, res) => {
  const { teamRole } = req.body;
  const validRoles = ['admin', 'manager', 'viewer', 'auditor'];
  if (!validRoles.includes(teamRole)) return res.status(400).json({ error: 'Invalid role' });
  const { rows: target } = await query(
    `SELECT team_role FROM org_members WHERE org_id=$1 AND user_id=$2`,
    [req.params.orgId, req.params.userId]
  );
  if (target[0]?.team_role === 'owner')
    return res.status(403).json({ error: 'Cannot change owner role' });
  try {
    await query(`UPDATE org_members SET team_role=$1 WHERE org_id=$2 AND user_id=$3`, [teamRole, req.params.orgId, req.params.userId]);
    await query(`UPDATE users SET team_role=$1 WHERE id=$2`, [teamRole, req.params.userId]);
    res.json({ message: `Role updated to ${teamRole}` });
  } catch (e) { res.status(500).json({ error: 'Failed to update role' }); }
});

router.delete('/:orgId/members/:userId', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT team_role FROM org_members WHERE org_id=$1 AND user_id=$2`,
      [req.params.orgId, req.params.userId]
    );
    if (rows[0]?.team_role === 'owner') return res.status(403).json({ error: 'Cannot remove org owner' });
    await query(`UPDATE org_members SET status='revoked' WHERE org_id=$1 AND user_id=$2`, [req.params.orgId, req.params.userId]);
    await query(`UPDATE users SET org_id=NULL, team_role='viewer' WHERE id=$1`, [req.params.userId]);
    res.json({ message: 'Member removed' });
  } catch (e) { res.status(500).json({ error: 'Failed to remove member' }); }
});

router.get('/:orgId/verifiers', authenticate, async (req, res) => {
  try {
    await assertOrgMember(req.params.orgId, req.user.id);
    const { rows } = await query(
      `SELECT * FROM verifier_connections WHERE org_id=$1 ORDER BY created_at DESC`,
      [req.params.orgId]
    );
    res.json({ verifiers: rows });
  } catch (e) {
    if (e.statusCode === 403) return res.status(403).json({ error: e.message });
    res.status(500).json({ error: 'Failed to fetch verifiers' });
  }
});

router.post('/:orgId/verifiers/request', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  const { verifierName, verifierCode, contactEmail, notes } = req.body;
  if (!verifierName) return res.status(400).json({ error: 'Verifier name required' });
  try {
    const { rows } = await query(
      `INSERT INTO verifier_connections
         (org_id,verifier_name,verifier_code,contact_email,status,notes)
       VALUES ($1,$2,$3,$4,'pending',$5) RETURNING *`,
      [req.params.orgId, verifierName, verifierCode||null, contactEmail||null, notes||null]
    );
    res.json({ message: `Request submitted for ${verifierName}.`, verifier: rows[0] });
  } catch (e) { res.status(500).json({ error: 'Failed to submit verifier request' }); }
});

router.get('/:orgId/audit-log', authenticate, requireRole('owner', 'admin', 'auditor'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT al.*, u.full_name, u.email FROM audit_logs al
       LEFT JOIN users u ON u.id=al.user_id
       WHERE al.org_id=$1 OR u.org_id=$1
       ORDER BY al.created_at DESC LIMIT 100`,
      [req.params.orgId]
    );
    res.json({ logs: rows });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch audit log' }); }
});

router.get('/:orgId/permissions', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT team_role FROM org_members WHERE org_id=$1 AND user_id=$2 AND status='active'`,
      [req.params.orgId, req.user.id]
    );
    if (!rows.length) return res.json({ teamRole: null, permissions: [] });
    res.json({ teamRole: rows[0].team_role, permissions: getPermissions(rows[0].team_role) });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch permissions' }); }
});

router.get('/:orgId/portfolio-summary', authenticate, async (req, res) => {
  try {
    await assertOrgMember(req.params.orgId, req.user.id);
    const { rows } = await query(
      `SELECT COUNT(*) AS total_batches,
              COALESCE(SUM(available_credits),0) AS total_available,
              COALESCE(SUM(retired_credits),0)   AS total_retired
       FROM carbon_batches cb
       JOIN org_members om ON om.user_id = cb.user_id
       WHERE om.org_id = $1 AND om.status = 'active'`,
      [req.params.orgId]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.statusCode === 403) return res.status(403).json({ error: e.message });
    res.status(500).json({ error: 'Failed to fetch portfolio summary' });
  }
});

// ═════════════════════════════════════════════════════════════════
// ── RETIREMENT QUEUE ─────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════

router.get('/:orgId/retirement-queue', authenticate, requireRole('owner', 'admin', 'manager'), async (req, res) => {
  try {
    await assertOrgMember(req.params.orgId, req.user.id);
    const { rows } = await query(
      `SELECT q.*, u.full_name AS requester_name_display
       FROM org_retirement_queue q
       LEFT JOIN users u ON u.id = q.requester_id
       WHERE q.org_id = $1 AND q.status = 'pending'
       ORDER BY q.created_at ASC`,
      [req.params.orgId]
    );
    res.json({ queue: rows });
  } catch (e) {
    if (e.statusCode === 403) return res.status(403).json({ error: e.message });
    console.error('[org/retirement-queue/get]', e.message);
    res.status(500).json({ error: 'Failed to fetch retirement queue' });
  }
});

router.post('/:orgId/retirement-queue', authenticate, requireRole('owner', 'admin', 'manager'), async (req, res) => {
  const {
    creditId, tokenId, projectName, serialNumber, standard,
    qty, scope, beneficiaryName, beneficiaryEntity, beneficiaryGstin,
    reportingStandard, purpose, requesterName,
  } = req.body;

  if (!projectName || !qty || qty <= 0)
    return res.status(400).json({ error: 'projectName and qty are required' });

  try {
    await assertOrgMember(req.params.orgId, req.user.id);
    if (creditId) {
      const { rows: existing } = await query(
        `SELECT id FROM org_retirement_queue WHERE batch_id = $1 AND status = 'pending'`,
        [creditId]
      );
      if (existing.length)
        return res.status(409).json({ error: 'A pending retirement request already exists for this credit' });
    }
    const { rows } = await query(
      `INSERT INTO org_retirement_queue
         (org_id, batch_id, token_id, project_name, serial_number, standard,
          qty, scope, requester_id, requester_name,
          beneficiary_name, beneficiary_entity, beneficiary_gstin,
          reporting_standard, purpose, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending')
       RETURNING id`,
      [
        req.params.orgId, creditId||null, tokenId||null,
        projectName, serialNumber||null, standard||null,
        parseInt(qty), parseInt(scope)||1,
        req.user.id, requesterName||req.user.full_name,
        beneficiaryName||null, beneficiaryEntity||null, beneficiaryGstin||null,
        reportingStandard||'GHG_PROTOCOL', purpose||'voluntary_offset',
      ]
    );
    await query(
      `INSERT INTO audit_logs (org_id, user_id, action, meta, created_at)
       VALUES ($1,$2,'RETIRE_REQUESTED',$3,NOW())`,
      [req.params.orgId, req.user.id, `${qty} tCO₂ retirement requested for ${projectName}`]
    ).catch(() => {});

    const { rows: [org] } = await query('SELECT name FROM organisations WHERE id=$1', [req.params.orgId]).catch(() => ({ rows: [{}] }));
    sendOrgRetirementRequestedEmail(req.user.email, {
      name: req.user.full_name, projectName, quantity: qty, orgName: org?.name,
    }).catch(e => console.warn('[retirement-queue/post] email failed:', e.message));

    res.status(201).json({ message: 'Retirement request submitted', id: rows[0].id });
  } catch (e) {
    if (e.statusCode === 403) return res.status(403).json({ error: e.message });
    console.error('[org/retirement-queue/post]', e.message);
    res.status(500).json({ error: 'Failed to submit retirement request', detail: e.message });
  }
});

router.post('/:orgId/retirement-queue/:itemId/approve', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  const { orgId, itemId } = req.params;
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT q.*, cb.registry_serial, u.email AS requester_email, u.full_name AS requester_full_name, o.name AS org_name
       FROM org_retirement_queue q
       LEFT JOIN carbon_batches cb ON cb.id = q.batch_id
       LEFT JOIN users u ON u.id = q.requester_id
       LEFT JOIN organisations o ON o.id = q.org_id
       WHERE q.id = $1 AND q.org_id = $2 FOR UPDATE`,
      [itemId, orgId]
    );
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Request not found' }); }
    const item = rows[0];
    if (item.status !== 'pending') { await client.query('ROLLBACK'); return res.status(409).json({ error: `Request already ${item.status}` }); }

    const certId = `CERT-${String(item.token_id || item.batch_id || itemId).padStart(8,'0').slice(-8)}-${Date.now().toString(36).toUpperCase().slice(-6)}`;

    await client.query(
      `INSERT INTO retirements
         (batch_id, token_id, serial_number, project_name, standard,
          amount, retire_scope, retired_by, org_id,
          beneficiary_name, beneficiary_entity, beneficiary_gstin,
          reporting_standard, purpose, certificate_id,
          approved_by, approved_at, retired_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW())`,
      [
        item.batch_id, item.token_id, item.serial_number||item.registry_serial,
        item.project_name, item.standard, item.qty, item.scope,
        item.requester_id, orgId,
        item.beneficiary_name, item.beneficiary_entity, item.beneficiary_gstin,
        item.reporting_standard, item.purpose, certId, req.user.id,
      ]
    );
    await client.query(
      `UPDATE org_retirement_queue
       SET status='approved', approved_by=$1, approved_at=NOW(), cert_id=$2, updated_at=NOW()
       WHERE id=$3`,
      [req.user.id, certId, itemId]
    );
    if (item.batch_id) {
      await client.query(
        `UPDATE carbon_batches
         SET available_credits = GREATEST(0, available_credits - $1),
             retired_credits   = COALESCE(retired_credits, 0) + $2,
             updated_at        = NOW()
         WHERE id = $3`,
        [item.qty, item.qty, item.batch_id]
      );
    }
    await client.query(
      `INSERT INTO audit_logs (org_id, user_id, action, meta, created_at)
       VALUES ($1,$2,'RETIRE_APPROVED',$3,NOW())`,
      [orgId, req.user.id, `${item.qty} tCO₂ retired from ${item.project_name} — cert ${certId}`]
    );
    await client.query('COMMIT');

    if (item.requester_email) {
      sendRetirementEmail(item.requester_email, {
        name: item.requester_full_name, amount: item.qty, certificateId: certId,
        projectName: item.project_name, beneficiary: item.beneficiary_name || 'Self',
        certUrl: `${process.env.FRONTEND_URL}/verify/${certId}`,
      }).catch(e => console.warn('[retirement-queue/approve] certificate email failed:', e.message));
    }

    res.json({ success: true, certId, message: `Retirement approved — ${item.qty} tCO₂` });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'This credit has already been retired' });
    console.error('[org/retirement-queue/approve]', e.message);
    res.status(500).json({ error: 'Approval failed', detail: e.message });
  } finally {
    client.release();
  }
});

router.post('/:orgId/retirement-queue/:itemId/reject', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  const { orgId, itemId } = req.params;
  const { reason } = req.body;
  if (!reason?.trim()) return res.status(400).json({ error: 'Rejection reason is required for audit trail' });
  try {
    const { rows } = await query(
      `UPDATE org_retirement_queue
       SET status='rejected', rejected_by=$1, rejected_at=NOW(),
           rejection_reason=$2, updated_at=NOW()
       WHERE id=$3 AND org_id=$4 AND status='pending'
       RETURNING id, project_name, qty, requester_id`,
      [req.user.id, reason.trim(), itemId, orgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Request not found or already processed' });
    await query(
      `INSERT INTO audit_logs (org_id, user_id, action, meta, created_at)
       VALUES ($1,$2,'RETIRE_REJECTED',$3,NOW())`,
      [orgId, req.user.id, `Rejected ${rows[0].qty} tCO₂ for ${rows[0].project_name}. Reason: ${reason.trim()}`]
    ).catch(() => {});

    try {
      const { rows: [ctx] } = await query(
        `SELECT u.email, u.full_name, o.name AS org_name FROM users u, organisations o WHERE u.id=$1 AND o.id=$2`,
        [rows[0].requester_id, orgId]
      );
      if (ctx?.email) {
        await sendOrgRetirementRejectedEmail(ctx.email, {
          name: ctx.full_name, projectName: rows[0].project_name, quantity: rows[0].qty,
          orgName: ctx.org_name, reason: reason.trim(),
        });
      }
    } catch (e) { console.warn('[retirement-queue/reject] email failed:', e.message); }

    res.json({ success: true, message: 'Retirement request rejected' });
  } catch (e) {
    console.error('[org/retirement-queue/reject]', e.message);
    res.status(500).json({ error: 'Rejection failed', detail: e.message });
  }
});

// ═════════════════════════════════════════════════════════════════
// ── PLAN SELECTION & BILLING ─────────────────────────────────────
// ═════════════════════════════════════════════════════════════════

router.get('/plan/prices', async (_req, res) => {
  const prices = {};
  for (const [key, cfg] of Object.entries(PLAN_CONFIG)) {
    prices[key] = { monthly: cfg.price_monthly, annual: cfg.price_annual, seats: cfg.seats, gasFee: cfg.gasFee };
  }
  res.json({ prices });
});

router.post('/plan/create-order', authenticate, async (req, res) => {
  const { planKey, cycle = 'monthly', idempotencyKey } = req.body;
  if (!planKey || !PLAN_CONFIG[planKey])
    return res.status(400).json({ error: 'Invalid planKey', validPlans: Object.keys(PLAN_CONFIG) });
  if (!['monthly', 'annual'].includes(cycle))
    return res.status(400).json({ error: 'cycle must be monthly or annual' });
  if (planKey === 'corporate')
    return res.status(400).json({ error: 'This plan requires contacting sales at support@ethertrack.in' });

  const cfg    = PLAN_CONFIG[planKey];
  const amount = cycle === 'annual' ? cfg.price_annual : cfg.price_monthly;
  if (!amount || amount === 0)
    return res.status(400).json({ error: 'Free plan does not require an order. Use /plan/select directly.' });

  if (idempotencyKey) {
    const { rows: existing } = await query(
      `SELECT razorpay_order_id FROM subscription_payments
       WHERE user_id=$1 AND idempotency_key=$2 AND created_at > NOW() - INTERVAL '24 hours'
       LIMIT 1`,
      [req.user.id, idempotencyKey]
    ).catch(() => ({ rows: [] }));
    if (existing.length && existing[0].razorpay_order_id) {
      return res.json({
        orderId: existing[0].razorpay_order_id,
        keyId:   process.env.RAZORPAY_KEY_ID,
        amount:  amount * 100,
        planKey, cycle, idempotent: true,
      });
    }
  }

  try {
    const order = await razorpay.orders.create({
      amount:   amount * 100,
      currency: 'INR',
      notes:    { planKey, cycle, userId: req.user.id },
    });
    if (idempotencyKey) {
      await query(
        `INSERT INTO subscription_payments
           (user_id, plan, cycle, amount, pay_method, razorpay_order_id, idempotency_key, status)
         VALUES ($1,$2,$3,$4,'razorpay',$5,$6,'pending')
         ON CONFLICT DO NOTHING`,
        [req.user.id, planKey, cycle, amount, order.id, idempotencyKey]
      ).catch(() => {});
    }
    res.json({ orderId: order.id, keyId: process.env.RAZORPAY_KEY_ID, amount: amount * 100, planKey, cycle });
  } catch (e) {
    console.error('[org/plan/create-order]', e.message);
    res.status(500).json({ error: 'Could not create payment order', detail: e.message });
  }
});

router.post('/plan/select', authenticate, async (req, res) => {
  const {
    plan, cycle = 'monthly', payMethod,
    razorpay_order_id, razorpay_payment_id, razorpay_signature,
    walletAddr, signature, message,
    gstin, pan,
  } = req.body;

  if (!plan || !PLAN_CONFIG[plan])
    return res.status(400).json({ error: 'Invalid plan', validPlans: Object.keys(PLAN_CONFIG) });
  if (!['monthly', 'annual'].includes(cycle))
    return res.status(400).json({ error: 'cycle must be monthly or annual' });
  if (plan === 'corporate')
    return res.status(400).json({ error: 'This plan requires contacting sales', contact: 'support@ethertrack.in' });

  const cfg       = PLAN_CONFIG[plan];
  const amount    = cycle === 'annual' ? cfg.price_annual : cfg.price_monthly;
  const userId    = req.user.id;
  const planLabel = cfg.label;

  try {
    if (plan === 'free' || amount === 0) {
      const { renewalDate } = await applyPlan(userId, plan, cycle, 'free', { gstin, pan });
      await createNotification(userId, 'SYSTEM', '✅ Free Plan Activated',
        'Your EtherTrack Free plan is now active. You can buy credits from the marketplace.', '/dashboard');
      return res.json({ ok: true, plan, cycle, renewalDate, message: 'Free plan activated' });
    }

    const method = payMethod || (razorpay_payment_id ? 'razorpay' : walletAddr ? 'metamask' : 'wallet');

    if (method === 'wallet') {
      const { rows: recentActivation } = await query(
        `SELECT id FROM subscription_payments
         WHERE user_id=$1 AND plan=$2 AND cycle=$3 AND status='success'
           AND pay_method='wallet' AND created_at > NOW() - INTERVAL '1 minute'`,
        [userId, plan, cycle]
      );
      if (recentActivation.length)
        return res.status(409).json({ error: 'Subscription already activated recently', code: 'DUPLICATE' });

      const { rows: userRows } = await query('SELECT inr_balance FROM users WHERE id=$1', [userId]);
      const currentBalance = parseFloat(userRows[0].inr_balance);
      if (currentBalance < amount)
        return res.status(400).json({ error: 'Insufficient wallet balance', required: amount, available: currentBalance, code: 'INSUFFICIENT_BALANCE' });

      await query(`UPDATE users SET inr_balance = inr_balance - $1, updated_at=NOW() WHERE id=$2`, [amount, userId]);
      await query(
        `INSERT INTO wallet_transactions
           (user_id,type,method,amount,status,balance_before,balance_after,notes)
         VALUES ($1,'debit','system',$2,'success',$3,$4,$5)`,
        [userId, amount, currentBalance, currentBalance - amount,
         `Subscription: ${plan} plan (${cycle}) — paid from INR wallet`]
      );
      const { renewalDate, paymentId } = await applyPlan(userId, plan, cycle, 'wallet', { gstin, pan });
      const invoiceUrl = await issueInvoice(userId, paymentId, plan, cycle, amount, { gstin, pan });
      await createNotification(userId, 'WALLET', `🎉 ${planLabel} Plan Activated`,
        `₹${amount.toLocaleString('en-IN')} debited from your INR wallet.`,
        '/billing', { plan, cycle, amount, renewalDate });
      return res.json({ ok: true, plan, cycle, amount, renewalDate, newBalance: currentBalance - amount, invoiceUrl });
    }

    if (method === 'razorpay') {
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
        return res.status(400).json({ error: 'razorpay_order_id, razorpay_payment_id and razorpay_signature required' });

      const expectedSig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
      if (expectedSig !== razorpay_signature)
        return res.status(400).json({ error: 'Payment signature verification failed', code: 'SIG_MISMATCH' });

      let rzpOrder;
      try { rzpOrder = await razorpay.orders.fetch(razorpay_order_id); }
      catch { return res.status(400).json({ error: 'Could not verify Razorpay order', code: 'ORDER_FETCH_FAILED' }); }

      const orderAmountINR = rzpOrder.amount / 100;
      if (orderAmountINR !== amount)
        return res.status(400).json({ error: 'Order amount does not match plan price', code: 'AMOUNT_MISMATCH' });

      const { rows: existing } = await query(
        `SELECT id FROM subscription_payments WHERE razorpay_payment_id=$1 AND status='success'`,
        [razorpay_payment_id]
      );
      if (existing.length) return res.status(409).json({ error: 'Payment already processed', code: 'DUPLICATE' });

      const { renewalDate, paymentId } = await applyPlan(userId, plan, cycle, 'razorpay',
        { razorpay_order_id, razorpay_payment_id, gstin, pan });
      const invoiceUrl = await issueInvoice(userId, paymentId, plan, cycle, amount, { gstin, pan });
      await createNotification(userId, 'WALLET', `🎉 ${planLabel} Plan Activated`,
        `Payment of ₹${amount.toLocaleString('en-IN')} confirmed via Razorpay.`,
        '/billing', { plan, cycle, amount, renewalDate });
      return res.json({ ok: true, plan, cycle, amount, renewalDate, invoiceUrl });
    }

    if (method === 'metamask') {
      if (!walletAddr || !signature || !message)
        return res.status(400).json({ error: 'walletAddr, signature and message required' });

      let recoveredAddress;
      try { recoveredAddress = ethers.verifyMessage(message, signature); }
      catch { return res.status(400).json({ error: 'Invalid MetaMask signature', code: 'SIG_INVALID' }); }

      if (recoveredAddress.toLowerCase() !== walletAddr.toLowerCase())
        return res.status(400).json({ error: 'Signature does not match wallet address', code: 'SIG_MISMATCH' });

      const expectedPrefix = `EtherTrack Subscription\nPlan: ${plan}\nAmount: ${amount}\nUser: ${userId}\nts: `;
      if (!message.startsWith(expectedPrefix))
        return res.status(400).json({ error: 'Signed message does not match requested plan/amount', code: 'MESSAGE_MISMATCH' });

      const ts = parseInt(message.slice(expectedPrefix.length), 10);
      if (isNaN(ts) || Date.now() - ts > 10 * 60 * 1000)
        return res.status(400).json({ error: 'Signed message is too old (>10 minutes). Please try again.', code: 'MESSAGE_STALE' });

      const { rows: userRows } = await query('SELECT wallet_address FROM users WHERE id=$1', [userId]);
      const boundWallet = userRows[0]?.wallet_address;
      if (!boundWallet || boundWallet.toLowerCase() !== walletAddr.toLowerCase())
        return res.status(403).json({ error: 'MetaMask wallet not bound to your account.', code: 'WALLET_NOT_BOUND' });

      const { renewalDate, paymentId } = await applyPlan(userId, plan, cycle, 'metamask',
        { walletAddr, signature, gstin, pan });
      const invoiceUrl = await issueInvoice(userId, paymentId, plan, cycle, amount, { gstin, pan });
      await createNotification(userId, 'WALLET', `🎉 ${planLabel} Plan Activated via MetaMask`,
        `MetaMask signature confirmed.`,
        '/billing', { plan, cycle, amount, renewalDate, walletAddr });
      return res.json({ ok: true, plan, cycle, amount, renewalDate, invoiceUrl });
    }

    return res.status(400).json({ error: 'Unknown payMethod', valid: ['free','wallet','razorpay','metamask'] });

  } catch (e) {
    console.error('[org/plan/select]', e.message);
    res.status(500).json({ error: 'Plan activation failed', detail: e.message });
  }
});

router.get('/plan', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT subscription_plan, plan_selected, subscription_renewal_date,
              subscription_cycle, subscription_activated_at, inr_balance
       FROM users WHERE id=$1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    const u        = rows[0];
    const daysLeft = u.subscription_renewal_date
      ? Math.ceil((new Date(u.subscription_renewal_date) - new Date()) / (1000 * 60 * 60 * 24))
      : null;
    const cfg = PLAN_CONFIG[u.subscription_plan] || PLAN_CONFIG.free;
    res.json({
      plan:           u.subscription_plan,
      plan_selected:  u.plan_selected,
      cycle:          u.subscription_cycle,
      renewal_date:   u.subscription_renewal_date,
      activated_at:   u.subscription_activated_at,
      days_remaining: daysLeft,
      is_expired:     daysLeft !== null && daysLeft <= 0,
      seats:          cfg.seats,
      gas_fee_rate:   cfg.gasFee,
      inr_balance:    (u.inr_balance || '0').toString(),
    });
  } catch (e) {
    console.error('[org/plan]', e.message);
    res.status(500).json({ error: 'Failed to fetch plan' });
  }
});

router.get('/plan/history', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, plan, cycle, amount, pay_method, status, renewal_date, invoice_url, created_at
       FROM subscription_payments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`,
      [req.user.id]
    );
    res.json({ history: rows });
  } catch (e) {
    console.error('[org/plan/history]', e.message);
    res.status(500).json({ error: 'Failed to fetch payment history' });
  }
});

router.get('/invoice/:paymentId', authenticate, serveInvoice);

// ── Subscription expiry cron ──────────────────────────────────────
async function checkSubscriptionExpiries() {
  try {
 
    // ── Step 1: Send renewal reminders (non-corporate) ────────────
    // Corporate accounts get a separate, dedicated notification below.
    const { rows: expiring } = await query(`
      SELECT id, email, full_name, subscription_plan, subscription_renewal_date,
             EXTRACT(DAY FROM (subscription_renewal_date - NOW())) AS days_left,
             corporate_managed
      FROM users
      WHERE subscription_plan != 'free'
        AND plan_selected = TRUE
        AND subscription_renewal_date IS NOT NULL
        AND EXTRACT(DAY FROM (subscription_renewal_date - NOW())) IN (30, 7, 1, 0)
    `);
 
    for (const user of expiring) {
      const days      = Math.round(parseFloat(user.days_left));
      const cfg       = PLAN_CONFIG[user.subscription_plan] || PLAN_CONFIG.free;
      const planLabel = cfg.label;
      const dateStr   = new Date(user.subscription_renewal_date)
        .toLocaleDateString('en-IN');
 
      if (user.corporate_managed) {
        // [CORP-2] Corporate-specific notification — no auto-downgrade warning,
        // just a professional heads-up so they can contact their account manager.
        let title, message;
        if (days <= 0) {
          title   = '🏢 Corporate Plan — Renewal Due';
          message = `Your Corporate plan has reached its renewal date. Please contact your EtherTrack account manager at support@ethertrack.in to renew.`;
        } else if (days <= 7) {
          title   = `🏢 Corporate Plan — Renewal in ${days} day${days !== 1 ? 's' : ''}`;
          message = `Your Corporate plan renews on ${dateStr}. Contact support@ethertrack.in to arrange renewal.`;
        } else if (days <= 30) {
          title   = '🏢 Corporate Plan — Upcoming Renewal';
          message = `Your Corporate plan renews on ${dateStr}. Your account manager will be in touch.`;
        } else {
          continue; // No notification needed yet for corporate
        }
        await createNotification(user.id, 'SYSTEM', title, message,
          '/billing', { plan: user.subscription_plan }).catch(() => {});
 
      } else {
        // Standard plans — original notification logic + email (email was
        // missing entirely before; users only ever saw an in-app badge)
        if (days <= 0) {
          await createNotification(user.id, 'SYSTEM', '🔴 Subscription Expired',          `Your ${planLabel} plan has expired. Renew now to restore full access.`,  '/billing', { plan: user.subscription_plan });
          await sendSubscriptionExpiredEmail(user.email, {
            name: user.full_name, plan: planLabel, downgradeTo: 'Free',
            renewUrl: `${process.env.FRONTEND_URL}/billing`,
          }).catch(e => console.warn('[checkSubscriptionExpiries] expired email failed:', e.message));
        } else if (days === 1) {
          await createNotification(user.id, 'SYSTEM', '⚠️ Subscription Expires Tomorrow', `Your ${planLabel} plan expires tomorrow.`,                                '/billing', { plan: user.subscription_plan });
          await sendSubscriptionExpiringSoonEmail(user.email, {
            name: user.full_name, plan: planLabel, expiryDate: dateStr, daysLeft: 1,
            renewUrl: `${process.env.FRONTEND_URL}/billing`,
          }).catch(e => console.warn('[checkSubscriptionExpiries] expiring email failed:', e.message));
        } else if (days === 7) {
          await createNotification(user.id, 'SYSTEM', '⏰ Expiring in 7 Days',             `Your ${planLabel} plan expires on ${dateStr}.`,                         '/billing', { plan: user.subscription_plan });
          await sendSubscriptionExpiringSoonEmail(user.email, {
            name: user.full_name, plan: planLabel, expiryDate: dateStr, daysLeft: 7,
            renewUrl: `${process.env.FRONTEND_URL}/billing`,
          }).catch(e => console.warn('[checkSubscriptionExpiries] expiring email failed:', e.message));
        } else if (days === 30) {
          await createNotification(user.id, 'SYSTEM', '📅 Renewal Reminder',              `Your ${planLabel} plan renews on ${dateStr} (30 days away).`,           '/billing', { plan: user.subscription_plan });
          // no email at 30 days — 7/1/0 day emails are enough, avoid over-mailing
        }
      }
    }
 
    // ── Step 2: Downgrade expired NON-corporate users to free ─────
    // [CORP-1] corporate_managed = TRUE are explicitly excluded.
    // Self-serve (Starter / Growth) users who haven't renewed get downgraded.
    const { rows: expired } = await query(`
      SELECT id, subscription_plan, subscription_cycle
      FROM users
      WHERE subscription_plan != 'free'
        AND plan_selected = TRUE
        AND subscription_renewal_date IS NOT NULL
        AND subscription_renewal_date < NOW()
        AND (corporate_managed IS NOT TRUE OR subscription_plan != 'corporate')
    `);
 
    for (const user of expired) {
      try {
        await query(
          `UPDATE users
           SET subscription_plan = 'free',
               subscription_renewal_date = NULL,
               updated_at = NOW()
           WHERE id = $1`,
          [user.id]
        );
 
        await query(
          `INSERT INTO subscription_history
             (user_id, event_type, from_plan, to_plan, from_cycle, to_cycle,
              amount_paise, gst_amount_paise, triggered_by)
           VALUES ($1,'expired',$2,'free',$3,'monthly',0,0,'cron')`,
          [user.id, user.subscription_plan, user.subscription_cycle]
        );
 
        console.log(
          `[org/cron] Downgraded expired user ${user.id} ` +
          `from ${user.subscription_plan} → free`
        );
      } catch (e) {
        console.warn('[checkSubscriptionExpiries] downgrade failed:', e.message);
      }
    }
 
    // ── Step 3: Log corporate accounts that are past renewal ─────
    // [CORP-3] These are NOT downgraded. We just log so the sales
    // team can follow up. The account stays on Corporate.
    const { rows: corpExpired } = await query(`
      SELECT id, email, full_name, subscription_plan, subscription_renewal_date
      FROM users
      WHERE subscription_plan = 'corporate'
        AND corporate_managed = TRUE
        AND subscription_renewal_date IS NOT NULL
        AND subscription_renewal_date < NOW()
    `);
 
    if (corpExpired.length > 0) {
      console.warn(
        `[org/cron] ⚠️  ${corpExpired.length} corporate account(s) past renewal date — ` +
        `NOT auto-downgraded. Sales team follow-up required:\n` +
        corpExpired.map(u => `  · ${u.email} (expired ${new Date(u.subscription_renewal_date).toLocaleDateString('en-IN')})`).join('\n')
      );
      // Optionally: fire an alert to your internal Slack/webhook here.
    }
 
    console.log(
      `[org/cron] Expiry check — ` +
      `${expiring.length} notified, ` +
      `${expired.length} downgraded, ` +
      `${corpExpired.length} corporate past-renewal (manual follow-up needed)`
    );
 
  } catch (e) {
    console.error('[org/checkSubscriptionExpiries]', e.message);
  }
}
// Alias — TeamManagement.js calls POST /:orgId/verifiers (no /request suffix)
router.post('/:orgId/verifiers', authenticate, requireRole('owner', 'admin'), async (req, res) => {
  const { verifierName, verifierCode, contactEmail, notes } = req.body;
  if (!verifierName) return res.status(400).json({ error: 'Verifier name required' });
  try {
    const { rows } = await query(
      `INSERT INTO verifier_connections
         (org_id,verifier_name,verifier_code,contact_email,status,notes)
       VALUES ($1,$2,$3,$4,'pending',$5)
       ON CONFLICT (org_id,verifier_code) DO UPDATE
         SET contact_email=EXCLUDED.contact_email, notes=EXCLUDED.notes, status='pending'
       RETURNING *`,
      [req.params.orgId, verifierName, verifierCode||null, contactEmail||null, notes||null]
    );
    res.json({ message: `Request submitted for ${verifierName}.`, verifier: rows[0] });
  } catch (e) {
    console.error('[org/verifiers/post]', e.message);
    res.status(500).json({ error: 'Failed to submit verifier request', detail: e.message });
  }
});

module.exports = router;
module.exports.checkSubscriptionExpiries = checkSubscriptionExpiries;