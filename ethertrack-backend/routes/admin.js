// routes/admin.js — with notification triggers
const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendEmail } = require('../services/email');
const { mintApprovedCredit, verifyKYCOnChain } = require('../services/minter');
const { createNotification } = require('./notifications');

const isAdmin = [authenticate, requireRole('admin')];

const auditLog = async (adminId, action, targetUserId, details) => {
  try {
    await query(`INSERT INTO admin_audit_log (admin_id, action, target_user_id, details) VALUES ($1,$2,$3,$4)`,
      [adminId, action, targetUserId || null, details || null]);
  } catch (e) { console.warn('Audit log failed:', e.message); }
};

router.get('/stats', isAdmin, async (req, res) => {
  try {
    const [kyc, credits, users, frozen, disputes, verified] = await Promise.all([
      query(`SELECT COUNT(*) FROM kyc_submissions WHERE status='pending'`),
      query(`SELECT COUNT(*) FROM carbon_batches WHERE admin_status='pending'`),
      query(`SELECT COUNT(*) FROM users WHERE role != 'admin'`),
      query(`SELECT COUNT(*) FROM users WHERE frozen=TRUE`),
      query(`SELECT COUNT(*) FROM disputes WHERE status='open'`),
      query(`SELECT COUNT(*) FROM users WHERE kyc_verified=TRUE`),
    ]);
    res.json({ pendingKYC: parseInt(kyc.rows[0].count), pendingCredits: parseInt(credits.rows[0].count), totalUsers: parseInt(users.rows[0].count), frozenAccounts: parseInt(frozen.rows[0].count), openDisputes: parseInt(disputes.rows[0].count), verifiedUsers: parseInt(verified.rows[0].count) });
  } catch (e) { console.error('Stats error:', e); res.status(500).json({ error: 'Failed to fetch stats' }); }
});

router.get('/kyc', isAdmin, async (req, res) => {
  const { status = 'pending' } = req.query;
  try {
    const { rows } = await query(`SELECT s.*, u.email, u.wallet_address FROM kyc_submissions s JOIN users u ON u.id = s.user_id WHERE s.status=$1 ORDER BY s.submitted_at ASC`, [status]);
    res.json({ submissions: rows });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch KYC queue' }); }
});

router.post('/kyc/:id/approve', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: sub } = await query('SELECT * FROM kyc_submissions WHERE id=$1', [id]);
    if (!sub.length) return res.status(404).json({ error: 'Not found' });
    if (sub[0].status !== 'pending') return res.status(400).json({ error: 'Already reviewed' });
    await query(`UPDATE kyc_submissions SET status='approved', reviewed_at=NOW(), reviewed_by=$1 WHERE id=$2`, [req.user.id, id]);
    await query(
      `UPDATE users SET kyc_status='verified', kyc_verified=TRUE, kyc_verified_at=NOW(),
       kyc_aadhaar_hash=COALESCE($1,kyc_aadhaar_hash), kyc_pan_hash=COALESCE($2,kyc_pan_hash), kyc_data_hash=$3, updated_at=NOW() WHERE id=$4`,
      [sub[0].aadhaar_hash, sub[0].pan_hash, sub[0].kyc_data_hash, sub[0].user_id]
    );
    const { rows: usr } = await query('SELECT email, full_name, wallet_address FROM users WHERE id=$1', [sub[0].user_id]);
    await auditLog(req.user.id, 'KYC_APPROVED', sub[0].user_id, `KYC submission ${id} approved`);

    // ── NOTIFICATION: KYC Approved ──
    await createNotification(
      sub[0].user_id, 'KYC', '✅ KYC Verified',
      'Your KYC has been approved by our compliance team. You now have full access to trading, portfolio, and emission tracking.',
      '/profile', {}
    );

    if (usr[0]?.wallet_address) {
      setImmediate(async () => {
        try {
          const result = await verifyKYCOnChain(usr[0].wallet_address, sub[0].kyc_data_hash);
          if (!result.skipped) await auditLog(req.user.id, 'KYC_ONCHAIN_REGISTERED', sub[0].user_id, `Wallet ${usr[0].wallet_address} — TX: ${result.txHash}`);
        } catch (e) {
          console.error(`KYC on-chain failed for ${usr[0].wallet_address}:`, e.message);
          await auditLog(req.user.id, 'KYC_ONCHAIN_FAILED', sub[0].user_id, `On-chain KYC failed: ${e.message}`).catch(()=>{});
        }
      });
    }
    try {
      await sendEmail({ to: usr[0].email, subject: 'EtherTrack — KYC Approved 🎉', html: `<div style="font-family:monospace;background:#080c0a;color:#f0fdf4;padding:32px;border-radius:12px;"><h2 style="color:#22c55e;">KYC Approved ✅</h2><p>Hi ${usr[0].full_name},</p><p>Your KYC has been <strong style="color:#22c55e;">approved</strong>!</p><a href="${process.env.FRONTEND_URL}/dashboard" style="display:inline-block;background:#16a34a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">Go to Dashboard →</a></div>` });
    } catch {}
    res.json({ message: 'KYC approved' });
  } catch (e) { console.error('KYC approve error:', e); res.status(500).json({ error: 'Approval failed' }); }
});

router.post('/kyc/:id/reject', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'Rejection reason required' });
  try {
    const { rows: sub } = await query('SELECT * FROM kyc_submissions WHERE id=$1', [id]);
    if (!sub.length) return res.status(404).json({ error: 'Not found' });
    await query(`UPDATE kyc_submissions SET status='rejected', rejection_reason=$1, reviewed_at=NOW(), reviewed_by=$2 WHERE id=$3`, [reason, req.user.id, id]);
    await query(`UPDATE users SET kyc_status='rejected', updated_at=NOW() WHERE id=$1`, [sub[0].user_id]);
    const { rows: usr } = await query('SELECT email, full_name FROM users WHERE id=$1', [sub[0].user_id]);
    await auditLog(req.user.id, 'KYC_REJECTED', sub[0].user_id, reason);

    // ── NOTIFICATION: KYC Rejected ──
    await createNotification(
      sub[0].user_id, 'KYC', '❌ KYC Rejected',
      `Your KYC submission was rejected. Reason: ${reason}. Please resubmit with correct documents.`,
      '/kyc', { reason }
    );

    try {
      await sendEmail({ to: usr[0].email, subject: 'EtherTrack — KYC Resubmission Required', html: `<div style="font-family:monospace;background:#080c0a;color:#f0fdf4;padding:32px;border-radius:12px;"><h2 style="color:#f87171;">KYC Resubmission Required</h2><p>Hi ${usr[0].full_name},</p><p>Reason: <span style="color:#f87171;">${reason}</span></p><a href="${process.env.FRONTEND_URL}/kyc" style="display:inline-block;background:#dc2626;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">Resubmit KYC →</a></div>` });
    } catch {}
    res.json({ message: 'KYC rejected' });
  } catch (e) { console.error('KYC reject error:', e); res.status(500).json({ error: 'Rejection failed' }); }
});

router.get('/credits', isAdmin, async (req, res) => {
  const { status = 'pending' } = req.query;
  try {
    const { rows } = await query(
      `SELECT b.id, b.project_name, b.project_location, b.country, b.standard, b.project_type, b.developer,
              b.quantity, b.vintage_year, b.expiry_date, b.registry_serial, b.doc_ipfs_hash,
              b.admin_status, b.admin_notes, b.status, b.token_id, b.tx_hash_mint,
              b.created_at, b.updated_at, b.credit_type, b.cbam_eligible,
              b.corresponding_adjustment, b.sdg_tags, b.icvcm_ccp_eligible, b.icvcm_ccp_label,
              b.registry_link, u.email, u.full_name, u.wallet_address AS user_wallet,
              p.name AS registry_name
       FROM carbon_batches b LEFT JOIN users u ON u.id=b.user_id LEFT JOIN projects p ON p.id=b.project_id
       WHERE b.admin_status=$1 ORDER BY b.created_at ASC NULLS LAST`, [status]
    );
    res.json({ credits: rows });
  } catch (e) { console.error('Credits fetch error:', e.message); res.status(500).json({ error: 'Failed to fetch credit listings' }); }
});

router.post('/credits/:id/approve', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;
  try {
    const { rows: batch } = await query(`SELECT b.*, u.email, u.full_name, u.wallet_address FROM carbon_batches b LEFT JOIN users u ON u.id=b.user_id WHERE b.id=$1`, [id]);
    if (!batch.length) return res.status(404).json({ error: 'Not found' });
    if (batch[0].admin_status !== 'pending') return res.status(400).json({ error: 'Already reviewed' });
    await query(`UPDATE carbon_batches SET admin_status='approved', status='approved', admin_notes=$1, reviewed_at=NOW(), reviewed_by=$2 WHERE id=$3`, [notes || null, req.user.id, id]);
    await auditLog(req.user.id, 'CREDIT_APPROVED', batch[0].user_id, `Batch ${id} — Serial: ${batch[0].registry_serial || 'N/A'}`);

    // ── NOTIFICATION: Credit Approved ──
    await createNotification(
      batch[0].user_id, 'CREDIT', '✅ Credit Listing Approved',
      `Your carbon credit listing "${batch[0].project_name}" has been approved. Minting on blockchain now...`,
      '/portfolio', { creditId: id, projectName: batch[0].project_name }
    );

    res.json({ message: 'Credit approved — blockchain mint triggered', batchId: id });

    setImmediate(async () => {
      try {
        const { tokenId, txHash } = await mintApprovedCredit(id);
        await auditLog(req.user.id, 'CREDIT_MINTED', batch[0].user_id, `Batch ${id} → Token #${tokenId} TX: ${txHash}`);

        // ── NOTIFICATION: Credit Minted ──
        await createNotification(
          batch[0].user_id, 'CREDIT', '🪙 Credit Tokenised On-Chain',
          `"${batch[0].project_name}" minted as Token #${tokenId} on Ethereum Sepolia. Ready to list on market.`,
          '/portfolio', { tokenId, txHash, creditId: id }
        );

        try {
          await sendEmail({ to: batch[0].email, subject: 'EtherTrack — Carbon Credits Tokenised ⛓', html: `<div style="font-family:monospace;background:#080c0a;color:#f0fdf4;padding:32px;"><h2 style="color:#22c55e;">Carbon Credits Minted ⛓</h2><p>Token #${tokenId} · ${batch[0].project_name}</p><a href="${process.env.FRONTEND_URL}/portfolio" style="background:#16a34a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">View Portfolio →</a></div>` });
        } catch {}
      } catch (mintErr) {
        console.error(`Auto-mint failed for batch ${id}:`, mintErr.message);
        try { await query(`UPDATE carbon_batches SET admin_notes=COALESCE(admin_notes,'')||$1, updated_at=NOW() WHERE id=$2`, [`\n[MINT ERROR ${new Date().toISOString()}]: ${mintErr.message}`, id]); } catch {}
        await auditLog(req.user.id, 'CREDIT_MINT_FAILED', batch[0].user_id, `Batch ${id}: ${mintErr.message}`);
        // ── NOTIFICATION: Mint failed ──
        await createNotification(
          batch[0].user_id, 'CREDIT', '⚠ Credit Approved — Mint Pending',
          `"${batch[0].project_name}" is approved but on-chain tokenisation encountered an issue. Our team will resolve it shortly.`,
          '/portfolio', { creditId: id }
        );
      }
    });
  } catch (e) { console.error('Credit approve error:', e); res.status(500).json({ error: 'Approval failed' }); }
});

router.post('/credits/:id/retry-mint', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await query(`SELECT cb.*, u.wallet_address, u.email, u.full_name FROM carbon_batches cb JOIN users u ON u.id=cb.user_id WHERE cb.id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Batch not found' });
    const batch = rows[0];
    if (batch.admin_status !== 'approved') return res.status(400).json({ error: 'Batch must be approved before minting' });
    if (batch.token_id != null) return res.status(400).json({ error: `Already minted — Token #${batch.token_id}` });
    if (!batch.wallet_address) return res.status(400).json({ error: 'User has no wallet address' });
    const { mintApprovedCredit } = require('../services/minter');
    const result = await mintApprovedCredit(id);
    if (result.success) {
      // ── NOTIFICATION: Retry mint success ──
      await createNotification(
        batch.user_id, 'CREDIT', '🪙 Credit Tokenised On-Chain',
        `"${batch.project_name}" minted as Token #${result.tokenId} on Ethereum Sepolia.`,
        '/portfolio', { tokenId: result.tokenId, txHash: result.txHash }
      );
      res.json({ success: true, tokenId: result.tokenId, txHash: result.txHash, message: `Minted Token #${result.tokenId}` });
    } else {
      res.status(500).json({ success: false, error: result.error || 'Mint failed' });
    }
  } catch (e) { console.error('Retry mint error:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.post('/credits/:id/reject', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'Rejection reason required' });
  try {
    const { rows: batch } = await query('SELECT b.*, u.email, u.full_name FROM carbon_batches b LEFT JOIN users u ON u.id=b.user_id WHERE b.id=$1', [id]);
    if (!batch.length) return res.status(404).json({ error: 'Not found' });
    await query(`UPDATE carbon_batches SET admin_status='rejected', admin_notes=$1, reviewed_at=NOW(), reviewed_by=$2 WHERE id=$3`, [reason, req.user.id, id]);
    await auditLog(req.user.id, 'CREDIT_REJECTED', batch[0].user_id, reason);

    // ── NOTIFICATION: Credit Rejected ──
    await createNotification(
      batch[0].user_id, 'CREDIT', '❌ Credit Listing Rejected',
      `Your listing "${batch[0].project_name}" was rejected. Reason: ${reason}`,
      '/portfolio', { creditId: id, reason }
    );

    try {
      await sendEmail({ to: batch[0].email, subject: 'EtherTrack — Credit Listing Requires Resubmission', html: `<div style="font-family:monospace;background:#080c0a;color:#f0fdf4;padding:32px;"><h2 style="color:#f87171;">Credit Rejected</h2><p>Reason: ${reason}</p><a href="${process.env.FRONTEND_URL}/portfolio" style="background:#dc2626;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Go to Portfolio →</a></div>` });
    } catch {}
    res.json({ message: 'Credit listing rejected' });
  } catch (e) { console.error('Credit reject error:', e); res.status(500).json({ error: 'Rejection failed' }); }
});

router.get('/users', isAdmin, async (req, res) => {
  const { search, status } = req.query;
  try {
    let q = `SELECT id, email, full_name, role, wallet_address, kyc_status, kyc_verified, frozen, freeze_reason, created_at, is_active FROM users WHERE role != 'admin'`;
    const params = [];
    if (search) { params.push(`%${search}%`); q += ` AND (email ILIKE $${params.length} OR full_name ILIKE $${params.length})`; }
    if (status === 'frozen')   q += ` AND frozen=TRUE`;
    if (status === 'verified') q += ` AND kyc_status='verified'`;
    if (status === 'pending')  q += ` AND kyc_status='submitted'`;
    q += ` ORDER BY created_at DESC`;
    const { rows } = await query(q, params);
    res.json({ users: rows });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch users' }); }
});

router.post('/users/:id/freeze', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'Freeze reason required' });
  try {
    await query(`UPDATE users SET frozen=TRUE, freeze_reason=$1, updated_at=NOW() WHERE id=$2`, [reason, id]);
    await auditLog(req.user.id, 'ACCOUNT_FROZEN', id, reason);
    const { rows: usr } = await query('SELECT email, full_name FROM users WHERE id=$1', [id]);
    try { await sendEmail({ to: usr[0].email, subject: 'EtherTrack — Account Suspended', html: `<p>Reason: ${reason}</p>` }); } catch {}
    res.json({ message: 'Account frozen' });
  } catch (e) { res.status(500).json({ error: 'Freeze failed' }); }
});

router.post('/users/:id/unfreeze', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await query(`UPDATE users SET frozen=FALSE, freeze_reason=NULL, updated_at=NOW() WHERE id=$1`, [id]);
    await auditLog(req.user.id, 'ACCOUNT_UNFROZEN', id, 'Account reinstated');
    const { rows: usr } = await query('SELECT email, full_name FROM users WHERE id=$1', [id]);
    try { await sendEmail({ to: usr[0].email, subject: 'EtherTrack — Account Reinstated', html: `<p>Your account has been reinstated.</p>` }); } catch {}
    res.json({ message: 'Account unfrozen' });
  } catch (e) { res.status(500).json({ error: 'Unfreeze failed' }); }
});

router.get('/disputes', isAdmin, async (req, res) => {
  try {
    const { rows } = await query(`SELECT d.*, u.email AS target_email, u.full_name AS target_name FROM disputes d JOIN users u ON u.id=d.target_user_id ORDER BY d.created_at DESC`);
    res.json({ disputes: rows });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch disputes' }); }
});

router.post('/disputes', isAdmin, async (req, res) => {
  const { targetUserId, reason, notes } = req.body;
  if (!targetUserId || !reason) return res.status(400).json({ error: 'Target user and reason required' });
  try {
    const { rows } = await query(`INSERT INTO disputes (opened_by,target_user_id,reason,notes,status) VALUES ($1,$2,$3,$4,'open') RETURNING id`, [req.user.id, targetUserId, reason, notes||null]);
    await auditLog(req.user.id, 'DISPUTE_OPENED', targetUserId, reason);
    res.json({ message: 'Dispute opened', id: rows[0].id });
  } catch (e) { res.status(500).json({ error: 'Failed to open dispute' }); }
});

router.post('/disputes/:id/resolve', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { resolution } = req.body;
  if (!resolution) return res.status(400).json({ error: 'Resolution notes required' });
  try {
    const { rows: d } = await query('SELECT * FROM disputes WHERE id=$1', [id]);
    if (!d.length) return res.status(404).json({ error: 'Not found' });
    await query(`UPDATE disputes SET status='resolved', resolution=$1, resolved_at=NOW(), resolved_by=$2 WHERE id=$3`, [resolution, req.user.id, id]);
    await auditLog(req.user.id, 'DISPUTE_RESOLVED', d[0].target_user_id, resolution);
    res.json({ message: 'Dispute resolved' });
  } catch (e) { res.status(500).json({ error: 'Failed to resolve dispute' }); }
});

router.get('/audit', isAdmin, async (req, res) => {
  try {
    const { rows } = await query(`SELECT a.*, u.email AS target_email, u.full_name AS target_name FROM admin_audit_log a LEFT JOIN users u ON u.id=a.target_user_id ORDER BY a.created_at DESC LIMIT 200`);
    res.json({ logs: rows });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch audit log' }); }
});

module.exports = router;