// routes/admin.js
const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendEmail } = require('../services/email');
const { mintApprovedCredit, verifyKYCOnChain } = require('../services/minter');

const isAdmin = [authenticate, requireRole('admin')];

// ── log every admin action ────────────────────────────────────────
const auditLog = async (adminId, action, targetUserId, details) => {
  try {
    await query(
      `INSERT INTO admin_audit_log (admin_id, action, target_user_id, details)
       VALUES ($1, $2, $3, $4)`,
      [adminId, action, targetUserId || null, details || null]
    );
  } catch (e) { console.warn('Audit log failed:', e.message); }
};

// ════════════════════════════════════════════════════════════════
// STATS
// ════════════════════════════════════════════════════════════════
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
    res.json({
      pendingKYC:     parseInt(kyc.rows[0].count),
      pendingCredits: parseInt(credits.rows[0].count),
      totalUsers:     parseInt(users.rows[0].count),
      frozenAccounts: parseInt(frozen.rows[0].count),
      openDisputes:   parseInt(disputes.rows[0].count),
      verifiedUsers:  parseInt(verified.rows[0].count),
    });
  } catch (e) {
    console.error('Stats error:', e);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ════════════════════════════════════════════════════════════════
// KYC
// ════════════════════════════════════════════════════════════════
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
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch KYC queue' });
  }
});

router.post('/kyc/:id/approve', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: sub } = await query('SELECT * FROM kyc_submissions WHERE id=$1', [id]);
    if (!sub.length)                 return res.status(404).json({ error: 'Not found' });
    if (sub[0].status !== 'pending') return res.status(400).json({ error: 'Already reviewed' });

    await query(
      `UPDATE kyc_submissions SET status='approved', reviewed_at=NOW(), reviewed_by=$1 WHERE id=$2`,
      [req.user.id, id]
    );
    await query(
      `UPDATE users SET
         kyc_status='verified', kyc_verified=TRUE, kyc_verified_at=NOW(),
         kyc_aadhaar_hash = COALESCE($1, kyc_aadhaar_hash),
         kyc_pan_hash     = COALESCE($2, kyc_pan_hash),
         kyc_data_hash    = $3,
         updated_at=NOW()
       WHERE id=$4`,
      [sub[0].aadhaar_hash, sub[0].pan_hash, sub[0].kyc_data_hash, sub[0].user_id]
    );

    const { rows: usr } = await query('SELECT email, full_name, wallet_address FROM users WHERE id=$1', [sub[0].user_id]);
    await auditLog(req.user.id, 'KYC_APPROVED', sub[0].user_id, `KYC submission ${id} approved`);

    // ✅ Register KYC on-chain so the contract allows minting to this wallet
    // Runs async — don't block the response if it fails
    if (usr[0]?.wallet_address) {
      setImmediate(async () => {
        try {
          const result = await verifyKYCOnChain(usr[0].wallet_address, sub[0].kyc_data_hash);
          if (!result.skipped) {
            await auditLog(req.user.id, 'KYC_ONCHAIN_REGISTERED', sub[0].user_id,
              `Wallet ${usr[0].wallet_address} registered on KYCRegistry — TX: ${result.txHash}`);
            console.log(`✅ KYC on-chain registered for ${usr[0].wallet_address} (${result.txHash})`);
          }
        } catch (e) {
          console.error(`❌ KYC on-chain registration failed for ${usr[0].wallet_address}:`, e.message);
          await auditLog(req.user.id, 'KYC_ONCHAIN_FAILED', sub[0].user_id,
            `On-chain KYC failed: ${e.message}`).catch(()=>{});
        }
      });
    } else {
      console.warn(`⚠️  User ${sub[0].user_id} has no wallet bound — on-chain KYC skipped`);
    }

    try {
      await sendEmail({
        to: usr[0].email,
        subject: 'EtherTrack — KYC Approved 🎉',
        html: `
          <div style="font-family:monospace;background:#080c0a;color:#f0fdf4;padding:32px;border-radius:12px;">
            <h2 style="color:#22c55e;">KYC Approved ✅</h2>
            <p>Hi ${usr[0].full_name},</p>
            <p>Your KYC has been <strong style="color:#22c55e;">approved</strong>! Your account is now fully activated.</p>
            <ul style="color:#86efac88;">
              <li>List and trade carbon credits</li>
              <li>Track emissions</li>
              <li>Manage your portfolio</li>
            </ul>
            <a href="${process.env.FRONTEND_URL}/dashboard"
               style="display:inline-block;background:#16a34a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">
              Go to Dashboard →
            </a>
          </div>`,
      });
    } catch {}

    res.json({ message: 'KYC approved' });
  } catch (e) {
    console.error('KYC approve error:', e);
    res.status(500).json({ error: 'Approval failed' });
  }
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
    await query(
      `UPDATE users SET kyc_status='rejected', updated_at=NOW() WHERE id=$1`,
      [sub[0].user_id]
    );

    const { rows: usr } = await query('SELECT email, full_name FROM users WHERE id=$1', [sub[0].user_id]);
    await auditLog(req.user.id, 'KYC_REJECTED', sub[0].user_id, reason);

    try {
      await sendEmail({
        to: usr[0].email,
        subject: 'EtherTrack — KYC Resubmission Required',
        html: `
          <div style="font-family:monospace;background:#080c0a;color:#f0fdf4;padding:32px;border-radius:12px;">
            <h2 style="color:#f87171;">KYC Resubmission Required</h2>
            <p>Hi ${usr[0].full_name},</p>
            <p>Your KYC submission requires resubmission. Reason:</p>
            <p style="color:#f87171;padding:12px;background:#1a0a0a;border-radius:6px;">${reason}</p>
            <a href="${process.env.FRONTEND_URL}/kyc"
               style="display:inline-block;background:#dc2626;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">
              Resubmit KYC →
            </a>
          </div>`,
      });
    } catch {}

    res.json({ message: 'KYC rejected' });
  } catch (e) {
    console.error('KYC reject error:', e);
    res.status(500).json({ error: 'Rejection failed' });
  }
});

// ════════════════════════════════════════════════════════════════
// CREDIT LISTINGS
// ════════════════════════════════════════════════════════════════
router.get('/credits', isAdmin, async (req, res) => {
  const { status = 'pending' } = req.query;
  try {
    const { rows } = await query(
      `SELECT b.*, u.email, u.full_name
       FROM carbon_batches b
       LEFT JOIN users u ON u.id = b.user_id
       WHERE b.admin_status = $1
       ORDER BY b.created_at ASC NULLS LAST`,
      [status]
    );
    res.json({ credits: rows });
  } catch (e) {
    console.error('Credits fetch error:', e.message);
    res.status(500).json({ error: 'Failed to fetch credit listings' });
  }
});

// ── APPROVE + AUTO-MINT ───────────────────────────────────────────
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
    if (!batch.length)                       return res.status(404).json({ error: 'Not found' });
    if (batch[0].admin_status !== 'pending') return res.status(400).json({ error: 'Already reviewed' });

    // ── Step 1: Mark approved in DB immediately ───────────────────
    await query(
      `UPDATE carbon_batches SET
         admin_status = 'approved',
         status       = 'approved',
         admin_notes  = $1,
         reviewed_at  = NOW(),
         reviewed_by  = $2
       WHERE id = $3`,
      [notes || null, req.user.id, id]
    );

    await auditLog(req.user.id, 'CREDIT_APPROVED', batch[0].user_id,
      `Batch ${id} — Serial: ${batch[0].registry_serial || 'N/A'} — Notes: ${notes || 'none'}`);

    // ── Step 2: Respond to admin instantly — don't wait for chain ─
    res.json({
      message: 'Credit approved — blockchain mint triggered',
      batchId: id,
    });

    // ── Step 3: Auto-mint async after response sent ───────────────
    setImmediate(async () => {
      try {
        const { tokenId, txHash } = await mintApprovedCredit(id);

        await auditLog(req.user.id, 'CREDIT_MINTED', batch[0].user_id,
          `Batch ${id} → Token #${tokenId} TX: ${txHash}`);

        console.log(`✅ Auto-mint: Batch ${id} → Token #${tokenId} (${txHash})`);

        // Email user: minted successfully
        try {
          await sendEmail({
            to: batch[0].email,
            subject: 'EtherTrack — Carbon Credits Tokenised ⛓',
            html: `
              <div style="font-family:monospace;background:#080c0a;color:#f0fdf4;padding:32px;border-radius:12px;">
                <h2 style="color:#22c55e;">Carbon Credits Minted on Blockchain ⛓</h2>
                <p>Hi ${batch[0].full_name},</p>
                <p>Your carbon credits are now <strong style="color:#22c55e;">live on Ethereum Sepolia</strong>.</p>
                <div style="background:#0d2e1f;padding:16px;border-radius:8px;margin:16px 0;font-size:12px;line-height:2;">
                  <div>📋 Project: <strong style="color:#f0fdf4;">${batch[0].project_name}</strong></div>
                  <div>🏷️  Serial: <strong style="color:#60a5fa;">${batch[0].registry_serial}</strong></div>
                  <div>🌿 Credits: <strong style="color:#22c55e;">${batch[0].quantity} tCO₂</strong></div>
                  <div>🔑 Token ID: <strong style="color:#a78bfa;">#${tokenId}</strong></div>
                  <div>⛓️  TX: <a href="https://sepolia.etherscan.io/tx/${txHash}" style="color:#60a5fa;">${txHash?.slice(0,20)}...↗</a></div>
                </div>
                <a href="${process.env.FRONTEND_URL}/portfolio"
                   style="display:inline-block;background:#16a34a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">
                  View Portfolio →
                </a>
              </div>`,
          });
        } catch {}

      } catch (mintErr) {
        console.error(`❌ Auto-mint failed for batch ${id}:`, mintErr.message);

        // Save error to admin_notes so admin can see it
        try {
          await query(
            `UPDATE carbon_batches
             SET admin_notes = COALESCE(admin_notes,'') || $1, updated_at=NOW()
             WHERE id = $2`,
            [`\n[MINT ERROR ${new Date().toISOString()}]: ${mintErr.message}`, id]
          );
        } catch {}

        await auditLog(req.user.id, 'CREDIT_MINT_FAILED', batch[0].user_id,
          `Batch ${id}: ${mintErr.message}`);

        // Email user: approved but mint pending
        try {
          await sendEmail({
            to: batch[0].email,
            subject: 'EtherTrack — Credit Listing Approved ✅',
            html: `
              <div style="font-family:monospace;background:#080c0a;color:#f0fdf4;padding:32px;border-radius:12px;">
                <h2 style="color:#22c55e;">Credit Listing Approved ✅</h2>
                <p>Hi ${batch[0].full_name},</p>
                <p>Your listing is approved. On-chain tokenisation will complete shortly.</p>
                <div style="background:#0d2e1f;padding:12px;border-radius:6px;margin:12px 0;font-size:12px;">
                  <div>Serial: ${batch[0].registry_serial}</div>
                  <div>Quantity: ${batch[0].quantity} tCO₂</div>
                </div>
                <a href="${process.env.FRONTEND_URL}/portfolio"
                   style="display:inline-block;background:#16a34a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">
                  View Portfolio →
                </a>
              </div>`,
          });
        } catch {}
      }
    });

  } catch (e) {
    console.error('Credit approve error:', e);
    res.status(500).json({ error: 'Approval failed' });
  }
});

// ── Manual retry mint for failed mints ───────────────────────────
router.post('/credits/:id/retry-mint', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await query(
      `SELECT admin_status, status FROM carbon_batches WHERE id=$1`, [id]
    );
    if (!rows.length)                        return res.status(404).json({ error: 'Not found' });
    if (rows[0].admin_status !== 'approved') return res.status(400).json({ error: 'Batch not approved' });
    if (rows[0].status === 'tokenised')      return res.status(400).json({ error: 'Already tokenised' });

    res.json({ message: 'Retry mint triggered' });

    setImmediate(async () => {
      try {
        const { tokenId, txHash } = await mintApprovedCredit(id);
        await auditLog(req.user.id, 'CREDIT_MINTED_RETRY', null,
          `Batch ${id} retry → Token #${tokenId} TX: ${txHash}`);
        console.log(`✅ Retry mint: Batch ${id} → Token #${tokenId}`);
      } catch (e) {
        console.error(`❌ Retry failed for batch ${id}:`, e.message);
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'Retry failed' });
  }
});

// ── REJECT ────────────────────────────────────────────────────────
router.post('/credits/:id/reject', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'Rejection reason required' });

  try {
    const { rows: batch } = await query(
      'SELECT b.*, u.email, u.full_name FROM carbon_batches b LEFT JOIN users u ON u.id=b.user_id WHERE b.id=$1',
      [id]
    );
    if (!batch.length) return res.status(404).json({ error: 'Not found' });

    await query(
      `UPDATE carbon_batches SET
         admin_status = 'rejected',
         admin_notes  = $1,
         reviewed_at  = NOW(),
         reviewed_by  = $2
       WHERE id = $3`,
      [reason, req.user.id, id]
    );

    await auditLog(req.user.id, 'CREDIT_REJECTED', batch[0].user_id, reason);

    try {
      await sendEmail({
        to: batch[0].email,
        subject: 'EtherTrack — Credit Listing Requires Resubmission',
        html: `
          <div style="font-family:monospace;background:#080c0a;color:#f0fdf4;padding:32px;border-radius:12px;">
            <h2 style="color:#f87171;">Credit Listing Rejected</h2>
            <p>Hi ${batch[0].full_name},</p>
            <p>Your credit listing was not approved. Reason:</p>
            <p style="color:#f87171;padding:12px;background:#1a0a0a;border-radius:6px;">${reason}</p>
            <a href="${process.env.FRONTEND_URL}/portfolio"
               style="display:inline-block;background:#dc2626;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">
              Go to Portfolio →
            </a>
          </div>`,
      });
    } catch {}

    res.json({ message: 'Credit listing rejected' });
  } catch (e) {
    console.error('Credit reject error:', e);
    res.status(500).json({ error: 'Rejection failed' });
  }
});

// ════════════════════════════════════════════════════════════════
// ACCOUNTS
// ════════════════════════════════════════════════════════════════
router.get('/users', isAdmin, async (req, res) => {
  const { search, status } = req.query;
  try {
    let q = `SELECT id, email, full_name, role, wallet_address,
                    kyc_status, kyc_verified, frozen, freeze_reason,
                    created_at, is_active
             FROM users WHERE role != 'admin'`;
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      q += ` AND (email ILIKE $${params.length} OR full_name ILIKE $${params.length})`;
    }
    if (status === 'frozen')   q += ` AND frozen=TRUE`;
    if (status === 'verified') q += ` AND kyc_status='verified'`;
    if (status === 'pending')  q += ` AND kyc_status='submitted'`;
    q += ` ORDER BY created_at DESC`;
    const { rows } = await query(q, params);
    res.json({ users: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.post('/users/:id/freeze', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'Freeze reason required' });
  try {
    await query(`UPDATE users SET frozen=TRUE, freeze_reason=$1, updated_at=NOW() WHERE id=$2`, [reason, id]);
    await auditLog(req.user.id, 'ACCOUNT_FROZEN', id, reason);
    const { rows: usr } = await query('SELECT email, full_name FROM users WHERE id=$1', [id]);
    try {
      await sendEmail({
        to: usr[0].email,
        subject: 'EtherTrack — Account Suspended',
        html: `<div style="font-family:monospace;background:#080c0a;color:#f0fdf4;padding:32px;border-radius:12px;">
          <h2 style="color:#f87171;">Account Suspended 🔒</h2>
          <p>Hi ${usr[0].full_name},</p>
          <p>Your account has been temporarily suspended. Reason:</p>
          <p style="color:#f87171;padding:12px;background:#1a0a0a;border-radius:6px;">${reason}</p>
          <p style="color:#86efac88;font-size:12px;">Contact support@ethertrack.in if this is an error.</p>
        </div>`,
      });
    } catch {}
    res.json({ message: 'Account frozen' });
  } catch (e) {
    res.status(500).json({ error: 'Freeze failed' });
  }
});

router.post('/users/:id/unfreeze', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await query(`UPDATE users SET frozen=FALSE, freeze_reason=NULL, updated_at=NOW() WHERE id=$1`, [id]);
    await auditLog(req.user.id, 'ACCOUNT_UNFROZEN', id, 'Account reinstated');
    const { rows: usr } = await query('SELECT email, full_name FROM users WHERE id=$1', [id]);
    try {
      await sendEmail({
        to: usr[0].email,
        subject: 'EtherTrack — Account Reinstated',
        html: `<div style="font-family:monospace;background:#080c0a;color:#f0fdf4;padding:32px;border-radius:12px;">
          <h2 style="color:#22c55e;">Account Reinstated ✅</h2>
          <p>Hi ${usr[0].full_name},</p>
          <p>Your account has been reinstated. You can now access all platform features.</p>
          <a href="${process.env.FRONTEND_URL}/dashboard"
             style="display:inline-block;background:#16a34a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">
            Go to Dashboard →
          </a>
        </div>`,
      });
    } catch {}
    res.json({ message: 'Account unfrozen' });
  } catch (e) {
    res.status(500).json({ error: 'Unfreeze failed' });
  }
});

// ════════════════════════════════════════════════════════════════
// DISPUTES
// ════════════════════════════════════════════════════════════════
router.get('/disputes', isAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT d.*, u.email AS target_email, u.full_name AS target_name
       FROM disputes d JOIN users u ON u.id = d.target_user_id
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

// ════════════════════════════════════════════════════════════════
// AUDIT LOG
// ════════════════════════════════════════════════════════════════
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

// ── POST /api/admin/credits/:id/retry-mint ────────────────────────
// ✅ Retry minting for approved but un-minted credits
router.post('/credits/:id/retry-mint', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    // Fetch the batch
    const { rows } = await query(
      `SELECT cb.*, u.wallet_address, u.email, u.full_name
       FROM carbon_batches cb
       JOIN users u ON u.id = cb.user_id
       WHERE cb.id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Batch not found' });

    const batch = rows[0];

    if (batch.admin_status !== 'approved') {
      return res.status(400).json({ error: 'Batch must be approved before minting' });
    }
    if (batch.token_id != null) {
      return res.status(400).json({ error: `Already minted — Token #${batch.token_id}` });
    }
    if (!batch.wallet_address) {
      return res.status(400).json({ error: 'User has no wallet address' });
    }

    // Trigger mint via minter service
    const { mintApprovedCredit } = require('../services/minter');
    const result = await mintApprovedCredit(id);

    if (result.success) {
      res.json({
        success:  true,
        tokenId:  result.tokenId,
        txHash:   result.txHash,
        message:  `Minted Token #${result.tokenId}`,
      });
    } else {
      res.status(500).json({
        success: false,
        error:   result.error || 'Mint failed',
      });
    }
  } catch (e) {
    console.error('Retry mint error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;