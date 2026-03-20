// routes/org.js — with notification triggers
const router  = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate }     = require('../middleware/auth');
const { requireRole, getPermissions } = require('../middleware/rbac');
const { sendEmail }        = require('../services/email');
const crypto               = require('crypto');
const { createNotification } = require('./notifications');

router.post('/create', authenticate, async (req, res) => {
  const { name, cin, gstin, pan, industry, companyType } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Organisation name required' });
  try {
    const { rows: existing } = await query(`SELECT id FROM organisations WHERE owner_id=$1`, [req.user.id]);
    if (existing.length) return res.status(409).json({ error: 'You already own an organisation.' });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50) + '-' + Date.now().toString(36).slice(-4);
    const { rows } = await query(
      `INSERT INTO organisations (name,slug,cin,gstin,pan,industry,company_type,owner_id,subscription_plan,subscription_status,seats_limit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'starter','trial',3) RETURNING *`,
      [name.trim(), slug, cin||null, gstin||null, pan||null, industry||null, companyType||null, req.user.id]
    );
    const org = rows[0];
    await query(`INSERT INTO org_members (org_id,user_id,team_role,status,accepted_at) VALUES ($1,$2,'owner','active',NOW())`, [org.id, req.user.id]);
    await query(`UPDATE users SET org_id=$1, team_role='owner' WHERE id=$2`, [org.id, req.user.id]);
    res.status(201).json({ message: 'Organisation created', org });
  } catch (e) { console.error('Org create error:', e.message); res.status(500).json({ error: 'Failed to create organisation', detail: e.message }); }
});

router.get('/me', authenticate, async (req, res) => {
  try {
    const { rows } = await query(`SELECT o.*, om.team_role, om.status AS member_status, om.accepted_at FROM organisations o JOIN org_members om ON om.org_id=o.id WHERE om.user_id=$1 AND om.status='active' LIMIT 1`, [req.user.id]);
    if (!rows.length) return res.json({ org: null, teamRole: null });
    const org = rows[0];
    res.json({ org, teamRole: org.team_role, permissions: getPermissions(org.team_role) });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch organisation' }); }
});

router.get('/:orgId/members', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT om.id, om.team_role, om.status, om.invited_at, om.accepted_at,
              u.id AS user_id, u.full_name, u.email, u.wallet_address, u.kyc_verified, u.kyc_status
       FROM org_members om LEFT JOIN users u ON u.id=om.user_id
       WHERE om.org_id=$1
       ORDER BY CASE om.team_role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'manager' THEN 3 WHEN 'auditor' THEN 4 WHEN 'viewer' THEN 5 ELSE 6 END`,
      [req.params.orgId]
    );
    res.json({ members: rows });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch members' }); }
});

router.post('/:orgId/invite', authenticate, requireRole('owner','admin'), async (req, res) => {
  const { email, teamRole = 'viewer' } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const validRoles = ['admin','manager','viewer','auditor'];
  if (!validRoles.includes(teamRole)) return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
  try {
    const { rows: org }     = await query(`SELECT seats_limit, name FROM organisations WHERE id=$1`, [req.params.orgId]);
    const { rows: members } = await query(`SELECT COUNT(*) AS cnt FROM org_members WHERE org_id=$1 AND status='active'`, [req.params.orgId]);
    if (parseInt(members[0].cnt) >= (org[0]?.seats_limit||3)) return res.status(403).json({ error: 'Seat limit reached. Upgrade your plan.' });
    const { rows: existing } = await query(`SELECT om.id FROM org_members om JOIN users u ON u.id=om.user_id WHERE om.org_id=$1 AND u.email=$2`, [req.params.orgId, email]);
    if (existing.length) return res.status(409).json({ error: 'User is already a member' });
    const token = crypto.randomBytes(32).toString('hex');
    await query(
      `INSERT INTO org_invites (org_id,email,team_role,token,invited_by,expires_at) VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL '7 days')
       ON CONFLICT (org_id,email) DO UPDATE SET token=EXCLUDED.token, team_role=EXCLUDED.team_role, expires_at=EXCLUDED.expires_at, accepted_at=NULL`,
      [req.params.orgId, email, teamRole, token, req.user.id]
    ).catch(() => query(`INSERT INTO org_invites (org_id,email,team_role,token,invited_by,expires_at) VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL '7 days')`, [req.params.orgId, email, teamRole, token, req.user.id]));
    const inviteUrl = `${process.env.FRONTEND_URL}/join-org?token=${token}`;
    try {
      await sendEmail({ to: email, subject: `You've been invited to join ${org[0]?.name} on EtherTrack`, html: `<div style="font-family:monospace;background:#040706;color:#f0fdf4;padding:32px;border-radius:12px;"><div style="color:#22c55e;font-size:18px;font-weight:700;margin-bottom:12px;">EtherTrack 🌿</div><p>You've been invited to join <strong>${org[0]?.name}</strong> as <strong style="color:#22c55e">${teamRole}</strong>.</p><a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background:#14532d;color:#d1fae5;border-radius:8px;text-decoration:none;font-weight:700;">ACCEPT INVITATION →</a><p style="color:#86efac33;font-size:12px;margin-top:20px;">Expires in 7 days.</p></div>` });
    } catch (emailErr) { console.warn('Invite email failed:', emailErr.message); }
    res.json({ message: `Invite sent to ${email}`, inviteUrl });
  } catch (e) { console.error('Invite error:', e.message); res.status(500).json({ error: 'Failed to send invite', detail: e.message }); }
});

router.get('/invite-preview', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token required' });
  try {
    const { rows } = await query(`SELECT oi.team_role, oi.email, oi.expires_at, oi.accepted_at, o.name AS org_name, o.id AS org_id, o.industry FROM org_invites oi JOIN organisations o ON o.id=oi.org_id WHERE oi.token=$1`, [token]);
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
    const { rows: invite } = await query(`SELECT * FROM org_invites WHERE token=$1 AND expires_at>NOW() AND accepted_at IS NULL`, [token]);
    if (!invite.length) return res.status(404).json({ error: 'Invalid or expired invite' });
    const inv = invite[0];
    if (req.user.email !== inv.email) return res.status(403).json({ error: 'Invite is for a different email address' });
    await query(`INSERT INTO org_members (org_id,user_id,team_role,invited_by,status,accepted_at) VALUES ($1,$2,$3,$4,'active',NOW()) ON CONFLICT (org_id,user_id) DO UPDATE SET team_role=EXCLUDED.team_role, status='active', accepted_at=NOW()`, [inv.org_id, req.user.id, inv.team_role, inv.invited_by]);
    await query(`UPDATE org_invites SET accepted_at=NOW() WHERE id=$1`, [inv.id]);
    await query(`UPDATE users SET org_id=$1, team_role=$2 WHERE id=$3`, [inv.org_id, inv.team_role, req.user.id]);
    const { rows: org } = await query(`SELECT name, owner_id FROM organisations WHERE id=$1`, [inv.org_id]);
    const { rows: newMember } = await query('SELECT full_name, email FROM users WHERE id=$1', [req.user.id]);

    // ── NOTIFICATION: Welcome to the team (joining member) ──
    await createNotification(
      req.user.id, 'TEAM', '🎉 Welcome to the Team',
      `You have successfully joined ${org[0]?.name} as ${inv.team_role}. You now have access to team resources.`,
      '/team', { orgId: inv.org_id, role: inv.team_role, orgName: org[0]?.name }
    );

    // ── NOTIFICATION: Member joined (org owner) ──
    if (org[0]?.owner_id && org[0].owner_id !== req.user.id) {
      await createNotification(
        org[0].owner_id, 'TEAM', '👥 Team Member Joined',
        `${newMember[0]?.full_name || inv.email} accepted your invitation and joined ${org[0]?.name} as ${inv.team_role}.`,
        '/team', { memberId: req.user.id, role: inv.team_role, memberEmail: inv.email }
      );
    }

    res.json({ message: `Joined ${org[0]?.name} as ${inv.team_role}`, teamRole: inv.team_role });
  } catch (e) { console.error('Accept invite error:', e.message); res.status(500).json({ error: 'Failed to accept invite' }); }
});

router.patch('/:orgId/members/:userId/role', authenticate, requireRole('owner'), async (req, res) => {
  const { teamRole } = req.body;
  const validRoles = ['admin','manager','viewer','auditor'];
  if (!validRoles.includes(teamRole)) return res.status(400).json({ error: 'Invalid role' });
  const { rows: target } = await query(`SELECT team_role FROM org_members WHERE org_id=$1 AND user_id=$2`, [req.params.orgId, req.params.userId]);
  if (target[0]?.team_role === 'owner') return res.status(403).json({ error: 'Cannot change owner role' });
  try {
    await query(`UPDATE org_members SET team_role=$1 WHERE org_id=$2 AND user_id=$3`, [teamRole, req.params.orgId, req.params.userId]);
    await query(`UPDATE users SET team_role=$1 WHERE id=$2`, [teamRole, req.params.userId]);
    res.json({ message: `Role updated to ${teamRole}` });
  } catch (e) { res.status(500).json({ error: 'Failed to update role' }); }
});

router.delete('/:orgId/members/:userId', authenticate, requireRole('owner','admin'), async (req, res) => {
  try {
    const { rows } = await query(`SELECT team_role FROM org_members WHERE org_id=$1 AND user_id=$2`, [req.params.orgId, req.params.userId]);
    if (rows[0]?.team_role === 'owner') return res.status(403).json({ error: 'Cannot remove org owner' });
    await query(`UPDATE org_members SET status='revoked' WHERE org_id=$1 AND user_id=$2`, [req.params.orgId, req.params.userId]);
    await query(`UPDATE users SET org_id=NULL, team_role='viewer' WHERE id=$1`, [req.params.userId]);
    res.json({ message: 'Member removed' });
  } catch (e) { res.status(500).json({ error: 'Failed to remove member' }); }
});

router.get('/:orgId/verifiers', authenticate, async (req, res) => {
  try {
    const { rows } = await query(`SELECT * FROM verifier_connections WHERE org_id=$1 ORDER BY created_at DESC`, [req.params.orgId]);
    res.json({ verifiers: rows });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch verifiers' }); }
});

router.post('/:orgId/verifiers/request', authenticate, requireRole('owner','admin'), async (req, res) => {
  const { verifierName, verifierCode, contactEmail, notes } = req.body;
  if (!verifierName) return res.status(400).json({ error: 'Verifier name required' });
  try {
    const { rows } = await query(`INSERT INTO verifier_connections (org_id,verifier_name,verifier_code,contact_email,status,notes) VALUES ($1,$2,$3,$4,'pending',$5) RETURNING *`, [req.params.orgId, verifierName, verifierCode||null, contactEmail||null, notes||null]);
    res.json({ message: `Request submitted for ${verifierName}.`, verifier: rows[0] });
  } catch (e) { res.status(500).json({ error: 'Failed to submit verifier request' }); }
});

router.get('/:orgId/audit-log', authenticate, requireRole('owner','admin','auditor'), async (req, res) => {
  try {
    const { rows } = await query(`SELECT al.*, u.full_name, u.email FROM audit_logs al LEFT JOIN users u ON u.id=al.user_id WHERE al.org_id=$1 OR u.org_id=$1 ORDER BY al.created_at DESC LIMIT 100`, [req.params.orgId]);
    res.json({ logs: rows });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch audit log' }); }
});

router.get('/:orgId/permissions', authenticate, async (req, res) => {
  try {
    const { rows } = await query(`SELECT team_role FROM org_members WHERE org_id=$1 AND user_id=$2 AND status='active'`, [req.params.orgId, req.user.id]);
    if (!rows.length) return res.json({ teamRole: null, permissions: [] });
    const teamRole = rows[0].team_role;
    res.json({ teamRole, permissions: getPermissions(teamRole) });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch permissions' }); }
});

module.exports = router;