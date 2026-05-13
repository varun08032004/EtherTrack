// routes/admin.js — EtherTrack Admin Console (Schema-Fixed)
const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendEmail } = require('../services/email');
const { mintApprovedCredit, verifyKYCOnChain } = require('../services/minter');
const { createNotification } = require('./notifications');

const isAdmin = [authenticate, requireRole('admin')];

const auditLog = async (adminId, action, targetUserId, details) => {
  try {
    await query(
      `INSERT INTO admin_audit_log (admin_id, action, target_user_id, details) VALUES ($1,$2,$3,$4)`,
      [adminId, action, targetUserId || null, details || null]
    );
  } catch (e) { console.warn('Audit log failed:', e.message); }
};

// ── Stats ─────────────────────────────────────────────────────────
router.get('/stats', isAdmin, async (req, res) => {
  try {
    const [kyc, credits, users, frozen, disputes, verified, failedMints] = await Promise.all([
      query(`SELECT COUNT(*) FROM kyc_submissions WHERE status='pending'`),
      query(`SELECT COUNT(*) FROM carbon_batches WHERE admin_status='pending'`),
      query(`SELECT COUNT(*) FROM users WHERE role != 'admin'`),
      query(`SELECT COUNT(*) FROM users WHERE frozen=TRUE`),
      query(`SELECT COUNT(*) FROM disputes WHERE status='open'`),
      query(`SELECT COUNT(*) FROM users WHERE kyc_verified=TRUE`),
      query(`SELECT COUNT(*) FROM carbon_batches WHERE admin_status='approved' AND token_id IS NULL`),
    ]);
    res.json({
      pendingKYC:     parseInt(kyc.rows[0].count),
      pendingCredits: parseInt(credits.rows[0].count),
      totalUsers:     parseInt(users.rows[0].count),
      frozenAccounts: parseInt(frozen.rows[0].count),
      openDisputes:   parseInt(disputes.rows[0].count),
      verifiedUsers:  parseInt(verified.rows[0].count),
      failedMints:    parseInt(failedMints.rows[0].count),
    });
  } catch (e) { console.error('Stats error:', e); res.status(500).json({ error: 'Failed to fetch stats' }); }
});

// ── KYC ──────────────────────────────────────────────────────────
router.get('/kyc', isAdmin, async (req, res) => {
  const { status = 'pending' } = req.query;
  try {
    const { rows } = await query(
      `SELECT s.*, u.email, u.wallet_address
       FROM kyc_submissions s
       JOIN users u ON u.id = s.user_id
       WHERE s.status = $1
       ORDER BY s.submitted_at ASC`,
      [status]
    );
    res.json({ submissions: rows });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch KYC queue' }); }
});

router.post('/kyc/:id/approve', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: sub } = await query('SELECT * FROM kyc_submissions WHERE id=$1', [id]);
    if (!sub.length) return res.status(404).json({ error: 'Not found' });
    if (sub[0].status !== 'pending') return res.status(400).json({ error: 'Already reviewed' });
    await query(
      `UPDATE kyc_submissions SET status='approved', reviewed_at=NOW(), reviewed_by=$1 WHERE id=$2`,
      [req.user.id, id]
    );
    await query(
      `UPDATE users SET kyc_status='verified', kyc_verified=TRUE, kyc_verified_at=NOW(),
       kyc_aadhaar_hash=COALESCE($1,kyc_aadhaar_hash),
       kyc_pan_hash=COALESCE($2,kyc_pan_hash),
       kyc_data_hash=$3, updated_at=NOW()
       WHERE id=$4`,
      [sub[0].aadhaar_hash, sub[0].pan_hash, sub[0].kyc_data_hash, sub[0].user_id]
    );
    const { rows: usr } = await query(
      'SELECT email, full_name, wallet_address FROM users WHERE id=$1',
      [sub[0].user_id]
    );
    await auditLog(req.user.id, 'KYC_APPROVED', sub[0].user_id, `KYC submission ${id} approved`);
    await createNotification(sub[0].user_id, 'KYC', '✅ KYC Verified',
      'Your KYC has been approved. You now have full access to trading, portfolio, and emission tracking.',
      '/profile', {});
    if (usr[0]?.wallet_address) {
      setImmediate(async () => {
        try {
          const result = await verifyKYCOnChain(usr[0].wallet_address, sub[0].kyc_data_hash);
          if (!result.skipped) await auditLog(req.user.id, 'KYC_ONCHAIN_REGISTERED', sub[0].user_id, `TX: ${result.txHash}`);
        } catch (e) {
          console.error(`KYC on-chain failed:`, e.message);
          await auditLog(req.user.id, 'KYC_ONCHAIN_FAILED', sub[0].user_id, e.message).catch(() => {});
        }
      });
    }
    try {
      await sendEmail({
        to: usr[0].email,
        subject: 'EtherTrack — KYC Approved 🎉',
        html: `<div style="font-family:monospace;background:#080c0a;color:#f0fdf4;padding:32px;border-radius:12px;">
          <h2 style="color:#22c55e;">KYC Approved ✅</h2>
          <p>Hi ${usr[0].full_name},</p>
          <p>Your KYC has been <strong style="color:#22c55e;">approved</strong>!</p>
          <a href="${process.env.FRONTEND_URL}/dashboard" style="display:inline-block;background:#16a34a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">Go to Dashboard →</a>
        </div>`,
      });
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
    await query(
      `UPDATE kyc_submissions SET status='rejected', rejection_reason=$1, reviewed_at=NOW(), reviewed_by=$2 WHERE id=$3`,
      [reason, req.user.id, id]
    );
    await query(`UPDATE users SET kyc_status='rejected', updated_at=NOW() WHERE id=$1`, [sub[0].user_id]);
    const { rows: usr } = await query('SELECT email, full_name FROM users WHERE id=$1', [sub[0].user_id]);
    await auditLog(req.user.id, 'KYC_REJECTED', sub[0].user_id, reason);
    await createNotification(sub[0].user_id, 'KYC', '❌ KYC Rejected',
      `Your KYC was rejected. Reason: ${reason}. Please resubmit.`, '/kyc', { reason });
    try {
      await sendEmail({
        to: usr[0].email,
        subject: 'EtherTrack — KYC Resubmission Required',
        html: `<div style="font-family:monospace;background:#080c0a;color:#f0fdf4;padding:32px;border-radius:12px;">
          <h2 style="color:#f87171;">KYC Resubmission Required</h2>
          <p>Hi ${usr[0].full_name},</p>
          <p>Reason: <span style="color:#f87171;">${reason}</span></p>
          <a href="${process.env.FRONTEND_URL}/kyc" style="display:inline-block;background:#dc2626;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">Resubmit KYC →</a>
        </div>`,
      });
    } catch {}
    res.json({ message: 'KYC rejected' });
  } catch (e) { console.error('KYC reject error:', e); res.status(500).json({ error: 'Rejection failed' }); }
});

router.post('/kyc/bulk-approve', isAdmin, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array required' });
  let approved = 0, failed = 0, errors = [];
  for (const id of ids) {
    try {
      const { rows: sub } = await query(
        'SELECT * FROM kyc_submissions WHERE id=$1 AND status=$2', [id, 'pending']
      );
      if (!sub.length) { failed++; errors.push(`${id}: not found or not pending`); continue; }
      await query(
        `UPDATE kyc_submissions SET status='approved', reviewed_at=NOW(), reviewed_by=$1 WHERE id=$2`,
        [req.user.id, id]
      );
      await query(
        `UPDATE users SET kyc_status='verified', kyc_verified=TRUE, kyc_verified_at=NOW(),
         kyc_data_hash=$1, updated_at=NOW() WHERE id=$2`,
        [sub[0].kyc_data_hash, sub[0].user_id]
      );
      await createNotification(sub[0].user_id, 'KYC', '✅ KYC Verified',
        'Your KYC has been approved. You now have full platform access.', '/portfolio', {});
      await auditLog(req.user.id, 'KYC_BULK_APPROVED', sub[0].user_id, `Bulk approve — submission ${id}`);
      approved++;
    } catch (e) { failed++; errors.push(`${id}: ${e.message}`); }
  }
  res.json({ success: true, approved, failed, errors });
});

// ── Credits ───────────────────────────────────────────────────────
// ✅ FIX: carbon_batches has no full_name/email directly — join users
router.get('/credits', isAdmin, async (req, res) => {
  const { status = 'pending' } = req.query;
  try {
    const { rows } = await query(
      `SELECT
         b.id, b.project_name, b.project_location, b.country,
         b.standard, b.project_type, b.developer,
         b.quantity, b.vintage_year, b.expiry_date,
         b.registry_serial, b.doc_ipfs_hash,
         b.admin_status, b.admin_notes, b.status,
         b.token_id, b.tx_hash_mint,
         b.created_at, b.updated_at,
         b.credit_type, b.cbam_eligible,
         b.corresponding_adjustment, b.sdg_tags,
         b.icvcm_ccp_eligible, b.icvcm_ccp_label,
         b.registry_link, b.price_per_credit_inr,
         u.email, u.full_name,
         u.wallet_address AS user_wallet
       FROM carbon_batches b
       LEFT JOIN users u ON u.id = b.user_id
       WHERE b.admin_status = $1
       ORDER BY b.created_at ASC NULLS LAST`,
      [status]
    );
    res.json({ credits: rows });
  } catch (e) {
    console.error('Credits fetch error:', e.message);
    res.status(500).json({ error: 'Failed to fetch credits' });
  }
});

router.post('/credits/:id/approve', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;
  try {
    const { rows: batch } = await query(
      `SELECT b.*, u.email, u.full_name, u.wallet_address
       FROM carbon_batches b
       LEFT JOIN users u ON u.id = b.user_id
       WHERE b.id = $1`,
      [id]
    );
    if (!batch.length) return res.status(404).json({ error: 'Not found' });
    if (batch[0].admin_status !== 'pending') return res.status(400).json({ error: 'Already reviewed' });
    await query(
      `UPDATE carbon_batches
       SET admin_status='approved', status='approved',
           admin_notes=$1, reviewed_at=NOW(), reviewed_by=$2
       WHERE id=$3`,
      [notes || null, req.user.id, id]
    );
    await auditLog(req.user.id, 'CREDIT_APPROVED', batch[0].user_id,
      `Batch ${id} — Serial: ${batch[0].registry_serial || 'N/A'}`);
    await createNotification(batch[0].user_id, 'CREDIT', '✅ Credit Listing Approved',
      `Your carbon credit listing "${batch[0].project_name}" has been approved. Minting on blockchain now...`,
      '/portfolio', { creditId: id, projectName: batch[0].project_name });
    res.json({ message: 'Credit approved — blockchain mint triggered', batchId: id });
    setImmediate(async () => {
      try {
        const { tokenId, txHash } = await mintApprovedCredit(id);
        await auditLog(req.user.id, 'CREDIT_MINTED', batch[0].user_id,
          `Batch ${id} → Token #${tokenId} TX: ${txHash}`);
        await createNotification(batch[0].user_id, 'CREDIT', '🪙 Credit Tokenised On-Chain',
          `"${batch[0].project_name}" minted as Token #${tokenId} on Ethereum Sepolia.`,
          '/portfolio', { tokenId, txHash, creditId: id });
        try {
          await sendEmail({
            to: batch[0].email,
            subject: 'EtherTrack — Carbon Credits Tokenised ⛓',
            html: `<div style="font-family:monospace;background:#080c0a;color:#f0fdf4;padding:32px;">
              <h2 style="color:#22c55e;">Carbon Credits Minted ⛓</h2>
              <p>Token #${tokenId} · ${batch[0].project_name}</p>
              <a href="${process.env.FRONTEND_URL}/portfolio" style="background:#16a34a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">View Portfolio →</a>
            </div>`,
          });
        } catch {}
      } catch (mintErr) {
        console.error(`Auto-mint failed for batch ${id}:`, mintErr.message);
        try {
          await query(
            `UPDATE carbon_batches
             SET admin_notes = COALESCE(admin_notes,'') || $1, updated_at=NOW()
             WHERE id=$2`,
            [`\n[MINT ERROR ${new Date().toISOString()}]: ${mintErr.message}`, id]
          );
        } catch {}
        await auditLog(req.user.id, 'CREDIT_MINT_FAILED', batch[0].user_id, `Batch ${id}: ${mintErr.message}`);
        await createNotification(batch[0].user_id, 'CREDIT', '⚠ Credit Approved — Mint Pending',
          `"${batch[0].project_name}" is approved but on-chain tokenisation encountered an issue.`,
          '/portfolio', { creditId: id });
      }
    });
  } catch (e) { console.error('Credit approve error:', e); res.status(500).json({ error: 'Approval failed' }); }
});

router.post('/credits/:id/retry-mint', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await query(
      `SELECT cb.*, u.wallet_address, u.email, u.full_name
       FROM carbon_batches cb
       JOIN users u ON u.id = cb.user_id
       WHERE cb.id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Batch not found' });
    const batch = rows[0];
    if (batch.admin_status !== 'approved') return res.status(400).json({ error: 'Batch must be approved first' });
    if (batch.token_id != null) return res.status(400).json({ error: `Already minted — Token #${batch.token_id}` });
    if (!batch.wallet_address) return res.status(400).json({ error: 'User has no wallet — use assign-wallet-and-mint' });
    const result = await mintApprovedCredit(id);
    if (result.tokenId != null) {
      await createNotification(batch.user_id, 'CREDIT', '🪙 Credit Tokenised On-Chain',
        `"${batch.project_name}" minted as Token #${result.tokenId}.`,
        '/portfolio', { tokenId: result.tokenId, txHash: result.txHash });
      await auditLog(req.user.id, 'CREDIT_MINTED', batch.user_id, `Retry — Batch ${id} → Token #${result.tokenId}`);
      res.json({ success: true, tokenId: result.tokenId, txHash: result.txHash });
    } else {
      res.status(500).json({ success: false, error: 'Mint failed' });
    }
  } catch (e) { console.error('Retry mint error:', e.message); res.status(500).json({ success: false, error: e.message }); }
});

router.post('/credits/:id/reject', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'Rejection reason required' });
  try {
    const { rows: batch } = await query(
      `SELECT b.*, u.email, u.full_name
       FROM carbon_batches b
       LEFT JOIN users u ON u.id = b.user_id
       WHERE b.id = $1`,
      [id]
    );
    if (!batch.length) return res.status(404).json({ error: 'Not found' });
    await query(
      `UPDATE carbon_batches
       SET admin_status='rejected', admin_notes=$1, reviewed_at=NOW(), reviewed_by=$2
       WHERE id=$3`,
      [reason, req.user.id, id]
    );
    await auditLog(req.user.id, 'CREDIT_REJECTED', batch[0].user_id, reason);
    await createNotification(batch[0].user_id, 'CREDIT', '❌ Credit Listing Rejected',
      `Your listing "${batch[0].project_name}" was rejected. Reason: ${reason}`,
      '/portfolio', { creditId: id, reason });
    try {
      await sendEmail({
        to: batch[0].email,
        subject: 'EtherTrack — Credit Listing Requires Resubmission',
        html: `<div style="font-family:monospace;background:#080c0a;color:#f0fdf4;padding:32px;">
          <h2 style="color:#f87171;">Credit Rejected</h2>
          <p>Reason: ${reason}</p>
          <a href="${process.env.FRONTEND_URL}/portfolio" style="background:#dc2626;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Go to Portfolio →</a>
        </div>`,
      });
    } catch {}
    res.json({ message: 'Credit listing rejected' });
  } catch (e) { console.error('Credit reject error:', e); res.status(500).json({ error: 'Rejection failed' }); }
});

router.post('/credits/:id/set-token-id', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { tokenId } = req.body;
  if (tokenId == null || isNaN(parseInt(tokenId))) return res.status(400).json({ error: 'Valid tokenId required' });
  try {
    const { rows } = await query(
      `SELECT user_id, project_name, token_id FROM carbon_batches WHERE id=$1`, [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Batch not found' });
    if (rows[0].token_id != null) return res.status(400).json({ error: `Already has Token #${rows[0].token_id}` });
    await query(
      `UPDATE carbon_batches
       SET token_id=$1, status='tokenised', tokenised_at=NOW(), updated_at=NOW()
       WHERE id=$2`,
      [parseInt(tokenId), id]
    );
    await auditLog(req.user.id, 'MANUAL_TOKEN_SYNC', rows[0].user_id, `Batch ${id} → Token #${tokenId} (manual)`);
    await createNotification(rows[0].user_id, 'CREDIT', '🪙 Credit Tokenised On-Chain',
      `"${rows[0].project_name}" assigned Token #${tokenId} by admin.`,
      '/portfolio', { tokenId: parseInt(tokenId), creditId: id });
    res.json({ success: true, tokenId: parseInt(tokenId) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/credits/:id/correct-quantity', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { quantity, reason } = req.body;
  if (!quantity || !reason) return res.status(400).json({ error: 'quantity and reason required' });
  const qty = parseInt(quantity);
  if (!qty || qty <= 0) return res.status(400).json({ error: 'quantity must be positive' });
  try {
    const { rows } = await query(
      `SELECT user_id, project_name, token_id, quantity FROM carbon_batches WHERE id=$1`, [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Batch not found' });
    if (rows[0].token_id != null) return res.status(400).json({ error: `Cannot correct after minting — Token #${rows[0].token_id} exists on-chain` });
    await query(
      `UPDATE carbon_batches
       SET quantity=$1, total_credits=$1, available_credits=$1, updated_at=NOW()
       WHERE id=$2`,
      [qty, id]
    );
    await auditLog(req.user.id, 'QTY_CORRECTED', rows[0].user_id,
      `Batch ${id}: ${rows[0].quantity} → ${qty} — ${reason}`);
    res.json({ success: true, newQuantity: qty });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/credits/:id/assign-wallet-and-mint', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { walletAddress } = req.body;
  if (!walletAddress || !walletAddress.startsWith('0x') || walletAddress.length !== 42)
    return res.status(400).json({ error: 'Valid 0x wallet address required' });
  try {
    const { rows } = await query(
      `SELECT cb.*, u.id AS user_id, u.email, u.full_name
       FROM carbon_batches cb
       JOIN users u ON u.id = cb.user_id
       WHERE cb.id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Batch not found' });
    if (rows[0].admin_status !== 'approved') return res.status(400).json({ error: 'Batch must be approved first' });
    if (rows[0].token_id != null) return res.status(400).json({ error: `Already minted — Token #${rows[0].token_id}` });
    await query(
      `UPDATE users SET wallet_address=$1, updated_at=NOW() WHERE id=$2`,
      [walletAddress.toLowerCase(), rows[0].user_id]
    );
    await auditLog(req.user.id, 'WALLET_ASSIGNED_FOR_MINT', rows[0].user_id,
      `Wallet ${walletAddress} assigned for batch ${id}`);
    const result = await mintApprovedCredit(id);
    if (result.tokenId != null) {
      await createNotification(rows[0].user_id, 'CREDIT', '🪙 Credit Tokenised On-Chain',
        `"${rows[0].project_name}" minted as Token #${result.tokenId}.`,
        '/portfolio', { tokenId: result.tokenId });
      await auditLog(req.user.id, 'CREDIT_MINTED', rows[0].user_id,
        `Assign+Mint — Batch ${id} → Token #${result.tokenId}`);
      res.json({ success: true, tokenId: result.tokenId, txHash: result.txHash });
    } else {
      res.status(500).json({ success: false, error: 'Mint failed after wallet assignment' });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Retirements ───────────────────────────────────────────────────
// ✅ FIX: retirements table uses retired_by (not user_id), retired_at (not created_at)
router.get('/retirements', isAdmin, async (req, res) => {
  const { disputed } = req.query;
  try {
    let q = `
      SELECT r.*, u.email, u.full_name
      FROM retirements r
      LEFT JOIN users u ON u.id = r.retired_by
    `;
    if (disputed === 'true') q += ` WHERE r.disputed = TRUE`;
    q += ` ORDER BY r.retired_at DESC LIMIT 200`;
    const { rows } = await query(q);
    res.json({ retirements: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/retirements/:id/flag', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'Reason required' });
  try {
    const { rows } = await query(`SELECT * FROM retirements WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Retirement not found' });
    await query(
      `UPDATE retirements
       SET disputed=TRUE, dispute_reason=$1, disputed_at=NOW(), disputed_by=$2
       WHERE id=$3`,
      [reason, req.user.id, id]
    );
    await auditLog(req.user.id, 'RETIREMENT_DISPUTED', rows[0].retired_by,
      `Retirement ${id} flagged: ${reason}`);
    await createNotification(rows[0].retired_by, 'CREDIT', '⚠ Retirement Under Review',
      `Your retirement certificate ${rows[0].certificate_id} has been flagged. Reason: ${reason}`,
      '/portfolio', { certId: rows[0].certificate_id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/retirements/:id/unflag', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await query(
      `UPDATE retirements
       SET disputed=FALSE, dispute_reason=NULL, disputed_at=NULL, disputed_by=NULL
       WHERE id=$1`,
      [id]
    );
    await auditLog(req.user.id, 'RETIREMENT_UNFLAGGED', null, `Retirement ${id} dispute cleared`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/retirements/search', isAdmin, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q param required' });
  try {
    const { rows } = await query(
      `SELECT r.*, u.email, u.full_name
       FROM retirements r
       LEFT JOIN users u ON u.id = r.retired_by
       WHERE r.certificate_id ILIKE $1
          OR r.serial_number   ILIKE $1
          OR u.email           ILIKE $1
          OR u.full_name       ILIKE $1
       ORDER BY r.retired_at DESC LIMIT 50`,
      [`%${q}%`]
    );
    res.json({ retirements: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Users ─────────────────────────────────────────────────────────
router.get('/users', isAdmin, async (req, res) => {
  const { search, status } = req.query;
  try {
    let q = `
      SELECT id, email, full_name, role, wallet_address,
             kyc_status, kyc_verified, frozen, freeze_reason,
             created_at, is_active
      FROM users WHERE role != 'admin'
    `;
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      q += ` AND (email ILIKE $${params.length} OR full_name ILIKE $${params.length})`;
    }
    if (status === 'frozen')   q += ` AND frozen = TRUE`;
    if (status === 'verified') q += ` AND kyc_status = 'verified'`;
    if (status === 'pending')  q += ` AND kyc_status = 'submitted'`;
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
    await query(
      `UPDATE users SET frozen=TRUE, freeze_reason=$1, updated_at=NOW() WHERE id=$2`,
      [reason, id]
    );
    await auditLog(req.user.id, 'ACCOUNT_FROZEN', id, reason);
    const { rows: usr } = await query('SELECT email, full_name FROM users WHERE id=$1', [id]);
    try { await sendEmail({ to: usr[0].email, subject: 'EtherTrack — Account Suspended', html: `<p>Reason: ${reason}</p>` }); } catch {}
    res.json({ message: 'Account frozen' });
  } catch (e) { res.status(500).json({ error: 'Freeze failed' }); }
});

router.post('/users/:id/unfreeze', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await query(
      `UPDATE users SET frozen=FALSE, freeze_reason=NULL, updated_at=NOW() WHERE id=$1`, [id]
    );
    await auditLog(req.user.id, 'ACCOUNT_UNFROZEN', id, 'Account reinstated');
    const { rows: usr } = await query('SELECT email, full_name FROM users WHERE id=$1', [id]);
    try { await sendEmail({ to: usr[0].email, subject: 'EtherTrack — Account Reinstated', html: `<p>Your account has been reinstated.</p>` }); } catch {}
    res.json({ message: 'Account unfrozen' });
  } catch (e) { res.status(500).json({ error: 'Unfreeze failed' }); }
});

router.get('/users/:id/credits', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await query(
      `SELECT id, project_name, registry_serial, standard, quantity,
              vintage_year, token_id, admin_status, status, created_at
       FROM carbon_batches WHERE user_id=$1 ORDER BY created_at DESC`,
      [id]
    );
    res.json({ credits: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ✅ FIX: trades — buyer_pays_inr instead of subtotal_inr for volume,
//         no buyer_name/seller_name cols in trades — join users
router.get('/users/:id/trades', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await query(
      `SELECT
         t.id, t.buyer_id, t.seller_id,
         t.quantity, t.price_per_credit_inr,
         t.subtotal_inr, t.buyer_pays_inr,
         t.buyer_fee_inr, t.seller_fee_inr,
         t.payment_mode, t.status,
         t.tx_hash, t.created_at,
         bu.email AS buyer_email,  bu.full_name AS buyer_name,
         su.email AS seller_email, su.full_name AS seller_name,
         cb.project_name, cb.registry_serial, cb.standard
       FROM trades t
       LEFT JOIN users bu ON bu.id = t.buyer_id
       LEFT JOIN users su ON su.id = t.seller_id
       LEFT JOIN carbon_batches cb ON cb.id = t.batch_id
       WHERE t.buyer_id=$1 OR t.seller_id=$1
       ORDER BY t.created_at DESC LIMIT 100`,
      [id]
    );
    res.json({ trades: rows });
  } catch (e) { console.error('user trades error:', e.message); res.status(500).json({ error: e.message }); }
});

router.post('/users/:id/resync-portfolio', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await query(
      `SELECT email, full_name, wallet_address FROM users WHERE id=$1`, [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    if (!rows[0].wallet_address) return res.status(400).json({ error: 'User has no wallet address' });
    await query(
      `UPDATE carbon_batches SET updated_at=NOW()
       WHERE user_id=$1 AND admin_status='approved'`,
      [id]
    );
    await auditLog(req.user.id, 'PORTFOLIO_RESYNC', id, `Resync for wallet ${rows[0].wallet_address}`);
    await createNotification(id, 'CREDIT', '🔄 Portfolio Sync Requested',
      'Your portfolio has been flagged for re-sync. Refresh to see updated balances.', '/portfolio', {});
    res.json({ success: true, wallet: rows[0].wallet_address });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/users/:id/send-message', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { subject, message } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'subject and message required' });
  try {
    const { rows } = await query(`SELECT email, full_name FROM users WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    await sendEmail({
      to: rows[0].email,
      subject: `EtherTrack — ${subject}`,
      html: `<div style="font-family:monospace;background:#080c0a;color:#f0fdf4;padding:32px;border-radius:12px;">
        <h2 style="color:#f59e0b;">Message from EtherTrack Support</h2>
        <p>Hi ${rows[0].full_name},</p>
        <div style="padding:16px;background:#0d0a00;border-left:3px solid #f59e0b;border-radius:4px;white-space:pre-wrap;font-size:13px;line-height:1.7;">${message}</div>
      </div>`,
    });
    await createNotification(id, 'ACCOUNT', `📬 ${subject}`, message.slice(0, 120), '/dashboard', {});
    await auditLog(req.user.id, 'USER_MESSAGE_SENT', id, `Subject: ${subject}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/users/:id/reassign-wallet', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { walletAddress, reason } = req.body;
  if (!walletAddress || !reason) return res.status(400).json({ error: 'walletAddress and reason required' });
  if (!walletAddress.startsWith('0x') || walletAddress.length !== 42)
    return res.status(400).json({ error: 'Invalid Ethereum address' });
  try {
    const { rows } = await query(
      `SELECT email, full_name, wallet_address FROM users WHERE id=$1`, [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    await query(
      `UPDATE users SET wallet_address=$1, updated_at=NOW() WHERE id=$2`,
      [walletAddress.toLowerCase(), id]
    );
    await auditLog(req.user.id, 'WALLET_REASSIGNED', id,
      `${rows[0].wallet_address || 'none'} → ${walletAddress.toLowerCase()} — ${reason}`);
    await createNotification(id, 'ACCOUNT', '🔑 Wallet Address Updated',
      `Your wallet has been updated to ${walletAddress.slice(0,6)}...${walletAddress.slice(-4)}`, '/profile', {});
    try {
      await sendEmail({
        to: rows[0].email,
        subject: 'EtherTrack — Wallet Address Updated',
        html: `<div style="font-family:monospace;background:#080c0a;color:#f0fdf4;padding:32px;border-radius:12px;">
          <h2 style="color:#60a5fa;">Wallet Updated 🔑</h2>
          <p>New wallet: <strong>${walletAddress}</strong></p>
          <p>If you did not request this, contact support immediately.</p>
        </div>`,
      });
    } catch {}
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/users/:id/delete', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'Deletion reason required' });
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  try {
    const { rows } = await query(`SELECT email, full_name, role FROM users WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    if (rows[0].role === 'admin') return res.status(403).json({ error: 'Cannot delete admin accounts' });
    // ✅ FIX: market_listings uses active column, not status='listed'
    const { rows: active } = await query(
      `SELECT COUNT(*) FROM market_listings WHERE seller_id=$1 AND active=TRUE`, [id]
    );
    if (parseInt(active[0].count) > 0)
      return res.status(400).json({ error: 'User has active listings — delist them first' });
    await query(
      `UPDATE users SET
         email        = CONCAT('deleted_',id,'@removed.invalid'),
         full_name    = 'Deleted User',
         phone        = NULL,
         wallet_address = NULL,
         kyc_verified = FALSE,
         kyc_status   = 'deleted',
         kyc_data_hash    = NULL,
         kyc_aadhaar_hash = NULL,
         kyc_pan_hash     = NULL,
         is_active  = FALSE,
         frozen     = TRUE,
         freeze_reason = $1,
         updated_at = NOW()
       WHERE id = $2`,
      [`ACCOUNT DELETED: ${reason}`, id]
    );
    await query(
      `UPDATE kyc_submissions
       SET doc_ipfs_hash=NULL, aadhaar_hash=NULL, pan_hash=NULL, kyc_data_hash=NULL
       WHERE user_id=$1`,
      [id]
    );
    await auditLog(req.user.id, 'USER_DELETED', id, `${rows[0].email} — ${reason}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/users/:id/require-rekyc', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'Reason required' });
  try {
    const { rows } = await query(`SELECT email, full_name FROM users WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    await query(
      `UPDATE users SET
         kyc_verified    = FALSE,
         kyc_status      = 'rekyc_required',
         kyc_verified_at = NULL,
         updated_at      = NOW()
       WHERE id = $1`,
      [id]
    );
    await query(
      `UPDATE kyc_submissions SET status='rejected', rejection_reason=$1
       WHERE user_id=$2 AND status='pending'`,
      [`Re-KYC required: ${reason}`, id]
    );
    await auditLog(req.user.id, 'REKYC_REQUIRED', id, reason);
    await createNotification(id, 'KYC', '🔄 Re-KYC Required',
      `Your KYC has been invalidated. Reason: ${reason}. Please resubmit your documents.`,
      '/kyc', { reason });
    try {
      await sendEmail({
        to: rows[0].email,
        subject: 'EtherTrack — Fresh KYC Submission Required',
        html: `<div style="font-family:monospace;background:#080c0a;color:#f0fdf4;padding:32px;border-radius:12px;">
          <h2 style="color:#f59e0b;">Re-KYC Required 🔄</h2>
          <p>Hi ${rows[0].full_name},</p>
          <p><strong style="color:#f87171;">Reason:</strong> ${reason}</p>
          <a href="${process.env.FRONTEND_URL}/kyc" style="display:inline-block;background:#f59e0b;color:#000;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;margin-top:8px;">RESUBMIT KYC →</a>
        </div>`,
      });
    } catch {}
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/kyc-expiring', isAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, email, full_name, kyc_expires_at,
              EXTRACT(DAY FROM kyc_expires_at - NOW())::int AS days_left
       FROM users
       WHERE kyc_expires_at IS NOT NULL
         AND kyc_expires_at > NOW()
         AND kyc_expires_at < NOW() + INTERVAL '90 days'
         AND kyc_verified = TRUE
       ORDER BY kyc_expires_at ASC`
    );
    res.json({ users: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/users/:id/kyc-reminder', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await query(
      `SELECT email, full_name, kyc_expires_at FROM users WHERE id=$1`, [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    const u = rows[0];
    await createNotification(id, 'KYC', '⚠ KYC Renewal Required',
      `Your KYC expires on ${new Date(u.kyc_expires_at).toLocaleDateString('en-IN')}. Please renew to avoid suspension.`,
      '/kyc', {});
    await sendEmail({
      to: u.email,
      subject: 'EtherTrack — KYC Renewal Required',
      html: `<div style="font-family:monospace;background:#080c0a;color:#f0fdf4;padding:32px;border-radius:12px;">
        <h2 style="color:#f59e0b;">KYC Renewal Required ⚠️</h2>
        <p>Hi ${u.full_name},</p>
        <p>Your KYC expires on <strong style="color:#f59e0b;">${new Date(u.kyc_expires_at).toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' })}</strong>.</p>
        <a href="${process.env.FRONTEND_URL}/kyc" style="display:inline-block;background:#f59e0b;color:#000;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;margin-top:8px;">RENEW KYC NOW →</a>
      </div>`,
    });
    await auditLog(req.user.id, 'KYC_REMINDER_SENT', id, `Sent to ${u.email}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Listings ──────────────────────────────────────────────────────
// ✅ FIX: market_listings schema — seller_name/seller_email are IN the table directly
//         no need to join users for those columns
router.get('/listings', isAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         ml.batch_id, ml.token_id, ml.listing_id,
         ml.project_name, ml.registry_serial, ml.standard,
         ml.vintage_year, ml.project_type,
         ml.price_per_credit_inr,
         ml.seller_id, ml.seller_wallet,
         ml.seller_name, ml.seller_email,
         ml.created_at, ml.updated_at,
         ml.available_credits AS amount_remaining
       FROM market_listings ml
       ORDER BY ml.created_at DESC`
    );
    // ✅ FIX: market_listings has no 'active' column — filter by checking available_credits > 0
    // If your table does have an active column, change this filter
    res.json({ listings: rows.filter(l => l.amount_remaining > 0) });
  } catch (e) {
    console.error('admin listings error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ✅ FIX: market_listings has no id column — use batch_id or listing_id
router.post('/listings/:listingId/force-delist', isAdmin, async (req, res) => {
  const { listingId } = req.params;
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'Reason required' });
  try {
    const { rows } = await query(
      `SELECT * FROM market_listings WHERE listing_id=$1`, [parseInt(listingId)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Listing not found' });
    const listing = rows[0];
    // Return credits to batch
    if (listing.batch_id && listing.amount_remaining > 0) {
      await query(
        `UPDATE carbon_batches
         SET available_credits = available_credits + $1,
             status = CASE WHEN status='listed' THEN 'tokenised' ELSE status END,
             updated_at = NOW()
         WHERE id = $2`,
        [listing.amount_remaining, listing.batch_id]
      );
    }
    // Remove from market_listings
    await query(
      `DELETE FROM market_listings WHERE listing_id=$1`, [parseInt(listingId)]
    );
    await auditLog(req.user.id, 'LISTING_FORCE_DELISTED', listing.seller_id,
      `Listing #${listingId} — ${reason}`);
    await createNotification(listing.seller_id, 'CREDIT', '⚠ Listing Removed by Admin',
      `Your listing for "${listing.project_name}" was removed. Reason: ${reason}`,
      '/portfolio', { listingId });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/listings/:listingId/override-price', isAdmin, async (req, res) => {
  const { listingId } = req.params;
  const { priceInr, reason } = req.body;
  if (!priceInr || !reason) return res.status(400).json({ error: 'priceInr and reason required' });
  try {
    const { rows } = await query(
      `SELECT * FROM market_listings WHERE listing_id=$1`, [parseInt(listingId)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Listing not found' });
    await query(
      `UPDATE market_listings SET price_per_credit_inr=$1, updated_at=NOW() WHERE listing_id=$2`,
      [parseFloat(priceInr), parseInt(listingId)]
    );
    // Also update carbon_batches price
    await query(
      `UPDATE carbon_batches SET price_per_credit_inr=$1, updated_at=NOW() WHERE id=$2`,
      [parseFloat(priceInr), rows[0].batch_id]
    );
    await auditLog(req.user.id, 'LISTING_PRICE_OVERRIDDEN', rows[0].seller_id,
      `Listing ${listingId}: → ₹${priceInr} — ${reason}`);
    await createNotification(rows[0].seller_id, 'CREDIT', '📝 Listing Price Updated by Admin',
      `Your listing for "${rows[0].project_name}" price was corrected to ₹${parseFloat(priceInr).toLocaleString('en-IN')}/credit. Reason: ${reason}`,
      '/portfolio', { listingId });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Disputes ──────────────────────────────────────────────────────
router.get('/disputes', isAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT d.*, u.email AS target_email, u.full_name AS target_name
       FROM disputes d
       JOIN users u ON u.id = d.target_user_id
       ORDER BY d.created_at DESC`
    );
    res.json({ disputes: rows });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch disputes' }); }
});

router.post('/disputes', isAdmin, async (req, res) => {
  const { targetUserId, reason, notes } = req.body;
  if (!targetUserId || !reason) return res.status(400).json({ error: 'Target user and reason required' });
  try {
    const { rows } = await query(
      `INSERT INTO disputes (opened_by, target_user_id, reason, notes, status)
       VALUES ($1,$2,$3,$4,'open') RETURNING id`,
      [req.user.id, targetUserId, reason, notes || null]
    );
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
    await query(
      `UPDATE disputes SET status='resolved', resolution=$1, resolved_at=NOW(), resolved_by=$2 WHERE id=$3`,
      [resolution, req.user.id, id]
    );
    await auditLog(req.user.id, 'DISPUTE_RESOLVED', d[0].target_user_id, resolution);
    res.json({ message: 'Dispute resolved' });
  } catch (e) { res.status(500).json({ error: 'Failed to resolve dispute' }); }
});

// ── Audit ─────────────────────────────────────────────────────────
router.get('/audit', isAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT a.*, u.email AS target_email, u.full_name AS target_name
       FROM admin_audit_log a
       LEFT JOIN users u ON u.id = a.target_user_id
       ORDER BY a.created_at DESC LIMIT 200`
    );
    res.json({ logs: rows });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch audit log' }); }
});

router.get('/audit/export', isAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT a.created_at, a.action,
              au.email AS admin_email,
              u.email  AS target_email,
              u.full_name AS target_name,
              a.details
       FROM admin_audit_log a
       LEFT JOIN users u  ON u.id  = a.target_user_id
       LEFT JOIN users au ON au.id = a.admin_id
       ORDER BY a.created_at DESC`
    );
    const headers = ['TIMESTAMP','ACTION','ADMIN','TARGET EMAIL','TARGET NAME','DETAILS'];
    const csvRows = rows.map(r => [
      new Date(r.created_at).toISOString(),
      r.action || '',
      r.admin_email || '',
      r.target_email || '',
      `"${(r.target_name || '').replace(/"/g, '""')}"`,
      `"${(r.details || '').replace(/"/g, '""')}"`,
    ].join(','));
    const csv = [headers.join(','), ...csvRows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="ethertrack_audit_${Date.now()}.csv"`);
    res.send(csv);
  } catch (e) { res.status(500).json({ error: 'Export failed' }); }
});

// ── Announcements ─────────────────────────────────────────────────
router.get('/announcements', isAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT a.*, u.email AS created_by_email
       FROM system_announcements a
       LEFT JOIN users u ON u.id = a.created_by
       ORDER BY a.created_at DESC LIMIT 20`
    ).catch(() => ({ rows: [] }));
    res.json({ announcements: rows });
  } catch (e) { res.json({ announcements: [] }); }
});

router.post('/announcements', isAdmin, async (req, res) => {
  const { title, message, type = 'info', expiresAt } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'title and message required' });
  try {
    await query(`CREATE TABLE IF NOT EXISTS system_announcements (
      id SERIAL PRIMARY KEY, title TEXT NOT NULL, message TEXT NOT NULL,
      type VARCHAR(20) DEFAULT 'info', expires_at TIMESTAMPTZ,
      active BOOLEAN DEFAULT TRUE, created_by UUID, created_at TIMESTAMPTZ DEFAULT NOW()
    )`).catch(() => {});
    const { rows } = await query(
      `INSERT INTO system_announcements (title, message, type, expires_at, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING id`,
      [title, message, type, expiresAt || null, req.user.id]
    );
    await auditLog(req.user.id, 'ANNOUNCEMENT_CREATED', null, `"${title}"`);
    res.json({ success: true, id: rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/announcements/:id', isAdmin, async (req, res) => {
  try {
    await query(`UPDATE system_announcements SET active=FALSE WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/announcements/broadcast', isAdmin, async (req, res) => {
  const { subject, message, sendEmail: doEmail } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'subject and message required' });
  try {
    const { rows: allUsers } = await query(
      `SELECT id, email, full_name FROM users WHERE is_active=TRUE AND role != 'admin' AND frozen=FALSE`
    );
    let sent = 0, failed = 0;
    for (const u of allUsers) {
      try {
        await createNotification(u.id, 'SYSTEM', `📢 ${subject}`, message.slice(0, 200), '/dashboard', {});
        if (doEmail) {
          await sendEmail({
            to: u.email,
            subject: `EtherTrack — ${subject}`,
            html: `<div style="font-family:monospace;background:#080c0a;color:#f0fdf4;padding:32px;border-radius:12px;">
              <h2 style="color:#f59e0b;">📢 Platform Announcement</h2>
              <p>Hi ${u.full_name},</p>
              <div style="padding:16px;background:#0d0a00;border-left:3px solid #f59e0b;border-radius:4px;white-space:pre-wrap;font-size:13px;line-height:1.7;">${message}</div>
            </div>`,
          });
        }
        sent++;
      } catch { failed++; }
    }
    await auditLog(req.user.id, 'ANNOUNCEMENT_BROADCAST', null, `"${subject}" — ${sent} sent, ${failed} failed`);
    res.json({ success: true, sent, failed, total: allUsers.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Blacklist ─────────────────────────────────────────────────────
router.get('/serials/blacklist', isAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT bs.*, u.email AS blacklisted_by_email
       FROM blacklisted_serials bs
       LEFT JOIN users u ON u.id = bs.blacklisted_by
       ORDER BY bs.blacklisted_at DESC`
    ).catch(() => ({ rows: [] }));
    res.json({ blacklist: rows });
  } catch (e) { res.json({ blacklist: [] }); }
});

router.post('/serials/blacklist', isAdmin, async (req, res) => {
  const { serial, reason } = req.body;
  if (!serial || !reason) return res.status(400).json({ error: 'serial and reason required' });
  try {
    await query(`CREATE TABLE IF NOT EXISTS blacklisted_serials (
      serial_number TEXT PRIMARY KEY, reason TEXT,
      blacklisted_by UUID, blacklisted_at TIMESTAMPTZ DEFAULT NOW()
    )`).catch(() => {});
    await query(
      `INSERT INTO blacklisted_serials (serial_number, reason, blacklisted_by, blacklisted_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (serial_number)
       DO UPDATE SET reason=$2, blacklisted_by=$3, blacklisted_at=NOW()`,
      [serial.trim(), reason, req.user.id]
    );
    const { rows: affected } = await query(
      `UPDATE carbon_batches SET admin_status='rejected', admin_notes=$1
       WHERE registry_serial=$2 AND admin_status='pending'
       RETURNING user_id, project_name`,
      [`Blacklisted serial: ${reason}`, serial.trim()]
    );
    for (const b of affected) {
      await createNotification(b.user_id, 'CREDIT', '❌ Credit Submission Rejected',
        `Serial ${serial} has been blacklisted. Reason: ${reason}`, '/portfolio', {});
    }
    await auditLog(req.user.id, 'SERIAL_BLACKLISTED', null,
      `Serial: ${serial} — ${reason} (${affected.length} batches auto-rejected)`);
    res.json({ success: true, affectedBatches: affected.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/serials/blacklist/:serial', isAdmin, async (req, res) => {
  try {
    await query(
      `DELETE FROM blacklisted_serials WHERE serial_number=$1`,
      [decodeURIComponent(req.params.serial)]
    );
    await auditLog(req.user.id, 'SERIAL_UNBLACKLISTED', null, `Serial: ${req.params.serial}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Projects ──────────────────────────────────────────────────────
router.get('/projects', isAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         p.id, p.name AS project_name, p.project_code, p.standard,
         p.project_type, p.location, p.country, p.developer_name,
         COUNT(cb.id)                                        AS batch_count,
         COALESCE(SUM(cb.quantity), 0)                       AS total_credits,
         COALESCE(SUM(cb.available_credits), 0)              AS available_credits,
         COALESCE(SUM(cb.retired_credits), 0)                AS retired_credits,
         COUNT(CASE WHEN cb.token_id IS NOT NULL THEN 1 END) AS minted_batches,
         COUNT(CASE WHEN cb.admin_status='pending' THEN 1 END) AS pending_batches,
         MAX(cb.updated_at)                                  AS last_activity
       FROM projects p
       LEFT JOIN carbon_batches cb ON cb.project_id = p.id
       GROUP BY p.id, p.name, p.project_code, p.standard,
                p.project_type, p.location, p.country, p.developer_name
       ORDER BY last_activity DESC NULLS LAST`
    );
    res.json({ projects: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Revenue ───────────────────────────────────────────────────────
// ✅ FIX: trades uses subtotal_inr, buyer_fee_inr, seller_fee_inr, buyer_pays_inr
//         no 'volume' col — compute from subtotal_inr
router.get('/revenue', isAdmin, async (req, res) => {
  const { period = '30' } = req.query;
  try {
    const [totalFees, feesByMonth, topTraders, creditsByStandard, retirementsByMonth, activeUsers] =
      await Promise.all([
        query(`
          SELECT
            COALESCE(SUM(buyer_fee_inr + seller_fee_inr), 0)   AS total_fees_inr,
            COALESCE(SUM(CASE WHEN created_at > NOW() - ($1 || ' days')::interval
              THEN buyer_fee_inr + seller_fee_inr ELSE 0 END), 0) AS period_fees_inr,
            COALESCE(SUM(subtotal_inr), 0)                     AS total_volume_inr,
            COUNT(*)                                           AS total_trades,
            COALESCE(SUM(quantity), 0)                         AS total_credits_traded
          FROM trades WHERE status='completed'
        `, [period]),

        query(`
          SELECT
            TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YYYY') AS month,
            COALESCE(SUM(buyer_fee_inr + seller_fee_inr), 0)    AS fees_inr,
            COALESCE(SUM(subtotal_inr), 0)                       AS volume_inr,
            COUNT(*)                                             AS trades
          FROM trades
          WHERE status='completed' AND created_at > NOW() - INTERVAL '6 months'
          GROUP BY DATE_TRUNC('month', created_at)
          ORDER BY DATE_TRUNC('month', created_at) DESC
        `),

        // ✅ FIX: join users separately for name/email — trades only has buyer_id/seller_id
        query(`
          SELECT
            u.id, u.email, u.full_name,
            COUNT(t.id)                      AS trade_count,
            COALESCE(SUM(t.subtotal_inr), 0) AS volume_inr
          FROM trades t
          JOIN users u ON u.id = t.buyer_id OR u.id = t.seller_id
          WHERE t.status = 'completed'
          GROUP BY u.id, u.email, u.full_name
          ORDER BY volume_inr DESC LIMIT 10
        `),

        query(`
          SELECT standard,
            COUNT(*) AS batches,
            COALESCE(SUM(quantity), 0) AS total_credits
          FROM carbon_batches WHERE admin_status='approved'
          GROUP BY standard ORDER BY total_credits DESC
        `),

        // ✅ FIX: retirements uses retired_at not created_at
        query(`
          SELECT
            TO_CHAR(DATE_TRUNC('month', retired_at), 'Mon YYYY') AS month,
            COUNT(*)                                              AS count,
            COALESCE(SUM(amount), 0)                             AS tco2
          FROM retirements
          WHERE retired_at > NOW() - INTERVAL '6 months'
          GROUP BY DATE_TRUNC('month', retired_at)
          ORDER BY DATE_TRUNC('month', retired_at) DESC
        `),

        query(`
          SELECT COUNT(DISTINCT buyer_id) + COUNT(DISTINCT seller_id) AS active
          FROM trades WHERE status='completed'
            AND created_at > NOW() - ($1 || ' days')::interval
        `, [period]),
      ]);

    res.json({
      summary:            totalFees.rows[0],
      feesByMonth:        feesByMonth.rows,
      topTraders:         topTraders.rows,
      creditsByStandard:  creditsByStandard.rows,
      retirementsByMonth: retirementsByMonth.rows,
      activeUsers:        parseInt(activeUsers.rows[0]?.active || 0),
      period:             parseInt(period),
    });
  } catch (e) {
    console.error('revenue error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Chain Health ──────────────────────────────────────────────────
router.get('/health/onchain', isAdmin, async (req, res) => {
  const results = {
    minterWallet:       { address: null, balanceEth: null, ok: false, error: null },
    rpcConnected:       false,
    lastMint:           null,
    pendingMints:       0,
    failedMints:        0,
    contractAddress:    process.env.CARBON_CREDIT_TOKEN_ADDRESS || null,
    marketplaceAddress: process.env.MARKETPLACE_ADDRESS || null,
    network:            'sepolia',
  };
  try {
    // ✅ FIX: carbon_batches uses tokenised_at not created_at for mints
    const [lastMint, pending, failed] = await Promise.all([
      query(`SELECT tokenised_at, token_id, project_name FROM carbon_batches
             WHERE token_id IS NOT NULL ORDER BY tokenised_at DESC LIMIT 1`),
      query(`SELECT COUNT(*) FROM carbon_batches WHERE admin_status='approved' AND token_id IS NULL`),
      query(`SELECT COUNT(*) FROM carbon_batches WHERE admin_status='approved' AND token_id IS NULL AND admin_notes LIKE '%MINT ERROR%'`),
    ]);
    results.lastMint     = lastMint.rows[0] || null;
    results.pendingMints = parseInt(pending.rows[0].count);
    results.failedMints  = parseInt(failed.rows[0].count);
  } catch (e) { results.dbError = e.message; }

  try {
    const { ethers } = require('ethers');
    const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_RPC);
    const network  = await provider.getNetwork();
    results.rpcConnected = true;
    results.chainId = Number(network.chainId);
    if (process.env.MINTER_PRIVATE_KEY) {
      const wallet = new ethers.Wallet(process.env.MINTER_PRIVATE_KEY, provider);
      results.minterWallet.address    = wallet.address;
      const balance = await provider.getBalance(wallet.address);
      results.minterWallet.balanceEth = parseFloat(ethers.formatEther(balance)).toFixed(4);
      results.minterWallet.ok         = parseFloat(results.minterWallet.balanceEth) > 0.01;
    }
  } catch (e) {
    results.rpcConnected       = false;
    results.minterWallet.error = e.message;
  }

  res.json(results);
});

// ── Mint error diagnostics ────────────────────────────────────────
router.get('/credits/:id/mint-errors', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await query(
      `SELECT cb.id, cb.project_name, cb.registry_serial, cb.standard,
              cb.quantity, cb.vintage_year, cb.expiry_date,
              cb.admin_status, cb.status, cb.token_id,
              cb.admin_notes, cb.tx_hash_mint,
              cb.created_at, cb.updated_at,
              u.wallet_address, u.email, u.full_name, u.kyc_verified
       FROM carbon_batches cb
       JOIN users u ON u.id = cb.user_id
       WHERE cb.id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Batch not found' });
    const b = rows[0];
    const diagnostics = [];
    if (!b.wallet_address)
      diagnostics.push({ severity:'critical', issue:'No wallet address', fix:'Use "Assign Wallet + Mint"' });
    if (!b.kyc_verified)
      diagnostics.push({ severity:'critical', issue:'User KYC not verified', fix:'Approve KYC first' });
    const expiry = b.expiry_date ? new Date(b.expiry_date) : null;
    if (expiry && expiry < new Date())
      diagnostics.push({ severity:'critical', issue:`Expiry date in the past (${b.expiry_date})`, fix:'Update expiry_date in Supabase then retry' });
    if (!b.quantity || b.quantity <= 0)
      diagnostics.push({ severity:'critical', issue:`Invalid quantity: ${b.quantity}`, fix:'Use "Correct Quantity"' });
    const mintErrors = [];
    if (b.admin_notes) {
      const matches = b.admin_notes.matchAll(/\[MINT ERROR ([^\]]+)\]: (.+)/g);
      for (const m of matches) mintErrors.push({ timestamp: m[1], error: m[2] });
    }
    if (mintErrors.length) {
      const lastErr = mintErrors[mintErrors.length - 1].error;
      if (lastErr.includes('Serial already registered'))
        diagnostics.push({ severity:'warning', issue:'Serial already on-chain', fix:'Use "Set Token ID Manually"' });
      if (lastErr.includes('insufficient funds'))
        diagnostics.push({ severity:'critical', issue:'Minter wallet out of ETH', fix:'Top up at faucet.sepolia.dev' });
      if (lastErr.includes('ALCHEMY_RPC') || lastErr.includes('network'))
        diagnostics.push({ severity:'warning', issue:'RPC connection failed', fix:'Check ALCHEMY_RPC env var' });
    }
    if (!diagnostics.length && !mintErrors.length)
      diagnostics.push({ severity:'info', issue:'No errors recorded', fix:'Try retrying the mint' });
    res.json({ batch: b, diagnostics, mintErrors });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;