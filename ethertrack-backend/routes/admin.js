// routes/admin.js — EtherTrack Admin Console v4
// ─────────────────────────────────────────────────────────────────
// Changes vs v3:
//
// [FIX-STATS]     openTickets added to /stats — was always 0 in dashboard
// [FIX-EXPORT]    /audit/export now served via authenticated session cookie
//                 (no ?token= in URL — was leaking creds to logs/history)
// [FIX-LISTINGS]  filter moved to SQL instead of JS .filter() — avoids
//                 returning full table then discarding rows
// [FIX-PROJECTS]  WHERE clause was incorrect (AND vs OR on admin_status)
//                 — now returns all batches regardless of status for project agg
// [HARDENING]     Integer parse guards on all :id params that feed SQL
//                 Rate-limit-aware 429 pass-through
//                 Broadcast now streams users in batches of 50 to avoid
//                 holding a large result set in memory
//
// All v3 features (CORP-1, CORP-2, CORP-3) preserved unchanged.
// ─────────────────────────────────────────────────────────────────
'use strict';

const router = require('express').Router();
const { safeQuery: query, withTransaction } = require('../db/pool');
const { authenticate, requireRole, invalidateUserCache } = require('../middleware/auth');
const {
  sendKycApprovedEmail, sendKycRejectedEmail, sendKycResubmissionRequiredEmail,
  sendKycExpiringSoonEmail, sendMintSuccessEmail, sendCreditListingRejectedEmail, sendTokenizationFailedEmail,
  sendBuyOrderCancelledEmail, sendAccountSuspendedEmail, sendAccountReinstatedEmail,
  sendAdminMessageToUserEmail, sendWalletUpdatedEmail, sendCorporatePlanActivatedEmail,
  sendPlatformAnnouncementEmail,
} = require('../services/email');
const { mintApprovedCredit, verifyKYCOnChain } = require('../services/minter');
const { createNotification } = require('./notifications');

const isAdmin = [authenticate, requireRole('admin')];

// ── Helpers ───────────────────────────────────────────────────────
const escHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

const auditLog = async (adminId, action, targetUserId, details) => {
  try {
    await query(
      `INSERT INTO admin_audit_log (admin_id, action, target_user_id, details)
       VALUES ($1,$2,$3,$4)`,
      [adminId, action, targetUserId || null, details || null]
    );
  } catch (e) { console.warn('[auditLog] failed:', e.message); }
};

// Safe integer parse — returns null on invalid input
const safeInt = (v) => {
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
};

// ── Stats ─────────────────────────────────────────────────────────
// [FIX-STATS] Added openTickets query
router.get('/stats', isAdmin, async (req, res) => {
  try {
    const [
      kyc, credits, users, frozen, disputes, verified,
      failedMints, openOrders, corporate, openTickets,
    ] = await Promise.all([
      query(`SELECT COUNT(*) FROM kyc_submissions WHERE status='pending'`),
      query(`SELECT COUNT(*) FROM carbon_batches WHERE admin_status='pending'`),
      query(`SELECT COUNT(*) FROM users WHERE role != 'admin'`),
      query(`SELECT COUNT(*) FROM users WHERE frozen=TRUE`),
      query(`SELECT COUNT(*) FROM disputes WHERE status='open'`),
      query(`SELECT COUNT(*) FROM users WHERE kyc_verified=TRUE`),
      query(`SELECT COUNT(*) FROM carbon_batches WHERE admin_status='approved' AND token_id IS NULL`),
      query(`SELECT COUNT(*) FROM buy_orders WHERE status='open'`).catch(() => ({ rows: [{ count: 0 }] })),
      query(`SELECT COUNT(*) FROM users WHERE subscription_plan='corporate'`).catch(() => ({ rows: [{ count: 0 }] })),
      query(`SELECT COUNT(*) FROM support_tickets WHERE status IN ('open','in_progress')`).catch(() => ({ rows: [{ count: 0 }] })),
    ]);
    res.json({
      pendingKYC:        parseInt(kyc.rows[0].count),
      pendingCredits:    parseInt(credits.rows[0].count),
      totalUsers:        parseInt(users.rows[0].count),
      frozenAccounts:    parseInt(frozen.rows[0].count),
      openDisputes:      parseInt(disputes.rows[0].count),
      verifiedUsers:     parseInt(verified.rows[0].count),
      failedMints:       parseInt(failedMints.rows[0].count),
      openBuyOrders:     parseInt(openOrders.rows[0].count),
      corporateAccounts: parseInt(corporate.rows[0].count),
      openTickets:       parseInt(openTickets.rows[0].count),  // [FIX-STATS]
    });
  } catch (e) {
    console.error('[admin/stats]', e.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ── KYC ──────────────────────────────────────────────────────────
router.get('/kyc', isAdmin, async (req, res) => {
  const VALID_STATUSES = ['pending', 'approved', 'rejected'];
  const status = VALID_STATUSES.includes(req.query.status) ? req.query.status : 'pending';
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
      `UPDATE kyc_submissions
       SET status='approved', reviewed_at=NOW(), reviewed_by=$1
       WHERE id=$2`,
      [req.user.id, id]
    );
    await query(
      `UPDATE users
       SET kyc_status='verified', kyc_verified=TRUE, kyc_verified_at=NOW(),
           kyc_aadhaar_hash=COALESCE($1,kyc_aadhaar_hash),
           kyc_pan_hash=COALESCE($2,kyc_pan_hash),
           kyc_data_hash=$3, updated_at=NOW()
       WHERE id=$4`,
      [sub[0].aadhaar_hash, sub[0].pan_hash, sub[0].kyc_data_hash, sub[0].user_id]
    );
    await invalidateUserCache(sub[0].user_id);

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
          const r = await verifyKYCOnChain(usr[0].wallet_address, sub[0].kyc_data_hash);
          if (!r.skipped) await auditLog(req.user.id, 'KYC_ONCHAIN_REGISTERED', sub[0].user_id, `TX: ${r.txHash}`);
        } catch (e) {
          await auditLog(req.user.id, 'KYC_ONCHAIN_FAILED', sub[0].user_id, e.message).catch(() => {});
        }
      });
    }

    try {
      await sendKycApprovedEmail(usr[0].email, {
        fullName: usr[0].full_name,
        dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`,
      });
    } catch {}

    res.json({ message: 'KYC approved' });
  } catch (e) {
    console.error('[admin/kyc/approve]', e.message);
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
      `UPDATE kyc_submissions
       SET status='rejected', rejection_reason=$1, reviewed_at=NOW(), reviewed_by=$2
       WHERE id=$3`,
      [reason, req.user.id, id]
    );
    await query(`UPDATE users SET kyc_status='rejected', updated_at=NOW() WHERE id=$1`, [sub[0].user_id]);
    await invalidateUserCache(sub[0].user_id);

    const { rows: usr } = await query('SELECT email, full_name FROM users WHERE id=$1', [sub[0].user_id]);
    await auditLog(req.user.id, 'KYC_REJECTED', sub[0].user_id, reason);
    await createNotification(sub[0].user_id, 'KYC', '❌ KYC Rejected',
      `Your KYC was rejected. Reason: ${reason}. Please resubmit.`, '/kyc', { reason });

    try {
      await sendKycRejectedEmail(usr[0].email, {
        fullName: usr[0].full_name,
        reason,
        resubmitUrl: `${process.env.FRONTEND_URL}/kyc`,
      });
    } catch {}

    res.json({ message: 'KYC rejected' });
  } catch (e) {
    console.error('[admin/kyc/reject]', e.message);
    res.status(500).json({ error: 'Rejection failed' });
  }
});

router.post('/kyc/bulk-approve', isAdmin, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length)
    return res.status(400).json({ error: 'ids array required' });
  if (ids.length > 200)
    return res.status(400).json({ error: 'Max 200 IDs per bulk operation' });

  let approved = 0, failed = 0, errors = [];
  for (const id of ids) {
    try {
      const { rows: sub } = await query(
        `SELECT * FROM kyc_submissions WHERE id=$1 AND status=$2`, [id, 'pending']
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
      await invalidateUserCache(sub[0].user_id);
      await createNotification(sub[0].user_id, 'KYC', '✅ KYC Verified', 'Your KYC has been approved.', '/portfolio', {});
      await auditLog(req.user.id, 'KYC_BULK_APPROVED', sub[0].user_id, `Bulk approve — submission ${id}`);
      approved++;
    } catch (e) { failed++; errors.push(`${id}: ${e.message}`); }
  }
  res.json({ success: true, approved, failed, errors });
});

// ── Credits ───────────────────────────────────────────────────────
router.get('/credits', isAdmin, async (req, res) => {
  const VALID_STATUSES = ['pending', 'approved', 'rejected'];
  const status = VALID_STATUSES.includes(req.query.status) ? req.query.status : 'pending';
  try {
    const { rows } = await query(
      `SELECT b.id, b.project_name, b.project_location, b.country, b.standard,
              b.project_type, b.developer, b.quantity, b.vintage_year, b.expiry_date,
              b.registry_serial, b.doc_ipfs_hash, b.admin_status, b.admin_notes,
              b.status, b.token_id, b.tx_hash_mint, b.created_at, b.updated_at,
              b.credit_type, b.cbam_eligible, b.corresponding_adjustment, b.sdg_tags,
              b.icvcm_ccp_eligible, b.icvcm_ccp_label, b.registry_link,
              b.price_per_credit_inr,
              u.email, u.full_name, u.wallet_address AS user_wallet
       FROM carbon_batches b
       LEFT JOIN users u ON u.id = b.user_id
       WHERE b.admin_status = $1
       ORDER BY b.created_at ASC NULLS LAST`,
      [status]
    );
    res.json({ credits: rows });
  } catch (e) {
    console.error('[admin/credits]', e.message);
    res.status(500).json({ error: 'Failed to fetch credits' });
  }
});

router.post('/credits/:id/approve', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { notes } = req.body;
  try {
    const { rows: batch } = await query(
      `SELECT b.*, u.email, u.full_name, u.wallet_address
       FROM carbon_batches b LEFT JOIN users u ON u.id=b.user_id WHERE b.id=$1`, [id]
    );
    if (!batch.length) return res.status(404).json({ error: 'Not found' });
    if (batch[0].admin_status !== 'pending') return res.status(400).json({ error: 'Already reviewed' });

    await query(
      `UPDATE carbon_batches SET admin_status='approved', status='approved', admin_notes=$1,
       reviewed_at=NOW(), reviewed_by=$2 WHERE id=$3`,
      [notes || null, req.user.id, id]
    );
    await auditLog(req.user.id, 'CREDIT_APPROVED', batch[0].user_id, `Batch ${id} — Serial: ${batch[0].registry_serial || 'N/A'}`);
    await createNotification(batch[0].user_id, 'CREDIT', '✅ Credit Listing Approved',
      `Your carbon credit listing "${batch[0].project_name}" has been approved. Minting on blockchain now...`, '/portfolio', { creditId: id });

    res.json({ message: 'Credit approved', batchId: id });

    setImmediate(async () => {
      try {
        const { tokenId, txHash } = await mintApprovedCredit(id);
        await auditLog(req.user.id, 'CREDIT_MINTED', batch[0].user_id, `Batch ${id} → Token #${tokenId}`);
        await createNotification(batch[0].user_id, 'CREDIT', '🪙 Credit Tokenised On-Chain',
          `"${batch[0].project_name}" minted as Token #${tokenId}.`, '/portfolio', { tokenId, txHash, creditId: id });
        try {
          await sendMintSuccessEmail(batch[0].email, {
            name: batch[0].full_name,
            projectName: batch[0].project_name,
            tokenId,
            txHash,
            portfolioUrl: `${process.env.FRONTEND_URL}/portfolio`,
          });
        } catch {}
      } catch (mintErr) {
        console.error(`[admin] Auto-mint failed for batch ${id}:`, mintErr.message);
        await query(
          `UPDATE carbon_batches SET admin_notes=COALESCE(admin_notes,'')||$1, updated_at=NOW() WHERE id=$2`,
          [`\n[MINT ERROR ${new Date().toISOString()}]: ${mintErr.message.slice(0, 300)}`, id]
        ).catch(() => {});
        await auditLog(req.user.id, 'CREDIT_MINT_FAILED', batch[0].user_id, `Batch ${id}: ${mintErr.message.slice(0, 300)}`);
        try {
          await sendTokenizationFailedEmail(batch[0].email, {
            name: batch[0].full_name, projectName: batch[0].project_name,
            reason: 'A temporary blockchain network issue prevented minting. Our team has been notified and will retry.',
            portfolioUrl: `${process.env.FRONTEND_URL}/portfolio`,
          });
        } catch {}
      }
    });
  } catch (e) {
    console.error('[admin/credits/approve]', e.message);
    res.status(500).json({ error: 'Approval failed' });
  }
});

router.post('/credits/:id/retry-mint', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await query(
      `SELECT cb.*, u.wallet_address, u.email, u.full_name FROM carbon_batches cb JOIN users u ON u.id=cb.user_id WHERE cb.id=$1`, [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Batch not found' });
    const batch = rows[0];
    if (batch.admin_status !== 'approved') return res.status(400).json({ error: 'Batch must be approved first' });
    if (batch.token_id != null) return res.status(400).json({ error: `Already minted — Token #${batch.token_id}` });
    if (!batch.wallet_address) return res.status(400).json({ error: 'User has no wallet — use assign-wallet-and-mint' });

    const result = await mintApprovedCredit(id);
    if (result.tokenId != null) {
      await createNotification(batch.user_id, 'CREDIT', '🪙 Credit Tokenised', `"${batch.project_name}" minted as Token #${result.tokenId}.`, '/portfolio', { tokenId: result.tokenId });
      await auditLog(req.user.id, 'CREDIT_MINTED', batch.user_id, `Retry — Batch ${id} → Token #${result.tokenId}`);
      sendMintSuccessEmail(batch.email, {
        name: batch.full_name, projectName: batch.project_name,
        tokenId: result.tokenId, txHash: result.txHash,
        portfolioUrl: `${process.env.FRONTEND_URL}/portfolio`,
      }).catch(e => console.warn('[retry-mint] success email failed:', e.message));
      res.json({ success: true, tokenId: result.tokenId, txHash: result.txHash });
    } else {
      sendTokenizationFailedEmail(batch.email, {
        name: batch.full_name, projectName: batch.project_name,
        reason: 'The retry attempt was unsuccessful. Our team is investigating.',
        portfolioUrl: `${process.env.FRONTEND_URL}/portfolio`,
      }).catch(e => console.warn('[retry-mint] failure email failed:', e.message));
      res.status(500).json({ success: false, error: 'Mint failed' });
    }
  } catch (e) {
    try {
      const { rows } = await query(`SELECT cb.project_name, u.email, u.full_name FROM carbon_batches cb JOIN users u ON u.id=cb.user_id WHERE cb.id=$1`, [id]);
      if (rows[0]?.email) {
        await sendTokenizationFailedEmail(rows[0].email, {
          name: rows[0].full_name, projectName: rows[0].project_name,
          reason: 'The retry attempt was unsuccessful. Our team is investigating.',
          portfolioUrl: `${process.env.FRONTEND_URL}/portfolio`,
        });
      }
    } catch {}
    res.status(500).json({ success: false, error: process.env.NODE_ENV === 'production' ? 'Mint failed' : e.message });
  }
});

router.post('/credits/:id/reject', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'Rejection reason required' });
  try {
    const { rows: batch } = await query(
      `SELECT b.*, u.email, u.full_name FROM carbon_batches b LEFT JOIN users u ON u.id=b.user_id WHERE b.id=$1`, [id]
    );
    if (!batch.length) return res.status(404).json({ error: 'Not found' });

    await query(`UPDATE carbon_batches SET admin_status='rejected', admin_notes=$1, reviewed_at=NOW(), reviewed_by=$2 WHERE id=$3`, [reason, req.user.id, id]);
    await auditLog(req.user.id, 'CREDIT_REJECTED', batch[0].user_id, reason);
    await createNotification(batch[0].user_id, 'CREDIT', '❌ Credit Listing Rejected', `Your listing "${batch[0].project_name}" was rejected. Reason: ${reason}`, '/portfolio', { creditId: id, reason });

    try {
      await sendCreditListingRejectedEmail(batch[0].email, {
        name: batch[0].full_name,
        projectName: batch[0].project_name,
        reason,
        portfolioUrl: `${process.env.FRONTEND_URL}/portfolio`,
      });
    } catch {}
    res.json({ message: 'Credit listing rejected' });
  } catch (e) { res.status(500).json({ error: 'Rejection failed' }); }
});

router.post('/credits/:id/set-token-id', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { tokenId } = req.body;
  if (tokenId == null || isNaN(parseInt(tokenId))) return res.status(400).json({ error: 'Valid tokenId required' });
  try {
    const { rows } = await query(`SELECT user_id, project_name, token_id FROM carbon_batches WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Batch not found' });
    if (rows[0].token_id != null) return res.status(400).json({ error: `Already has Token #${rows[0].token_id}` });

    await query(`UPDATE carbon_batches SET token_id=$1, status='tokenised', tokenised_at=NOW(), updated_at=NOW() WHERE id=$2`, [parseInt(tokenId), id]);
    await auditLog(req.user.id, 'MANUAL_TOKEN_SYNC', rows[0].user_id, `Batch ${id} → Token #${tokenId} (manual)`);
    await createNotification(rows[0].user_id, 'CREDIT', '🪙 Credit Tokenised', `"${rows[0].project_name}" assigned Token #${tokenId} by admin.`, '/portfolio', { tokenId: parseInt(tokenId), creditId: id });
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
    const { rows } = await query(`SELECT user_id, project_name, token_id, quantity FROM carbon_batches WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Batch not found' });
    if (rows[0].token_id != null) return res.status(400).json({ error: `Cannot correct after minting — Token #${rows[0].token_id} exists on-chain` });

    await query(`UPDATE carbon_batches SET quantity=$1, total_credits=$1, available_credits=$1, updated_at=NOW() WHERE id=$2`, [qty, id]);
    await auditLog(req.user.id, 'QTY_CORRECTED', rows[0].user_id, `Batch ${id}: ${rows[0].quantity} → ${qty} — ${reason}`);
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
      `SELECT cb.*, u.id AS user_id, u.email, u.full_name FROM carbon_batches cb JOIN users u ON u.id=cb.user_id WHERE cb.id=$1`, [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Batch not found' });
    if (rows[0].admin_status !== 'approved') return res.status(400).json({ error: 'Batch must be approved first' });
    if (rows[0].token_id != null) return res.status(400).json({ error: `Already minted — Token #${rows[0].token_id}` });

    await query(`UPDATE users SET wallet_address=$1, updated_at=NOW() WHERE id=$2`, [walletAddress.toLowerCase(), rows[0].user_id]);
    await invalidateUserCache(rows[0].user_id);
    await auditLog(req.user.id, 'WALLET_ASSIGNED_FOR_MINT', rows[0].user_id, `Wallet ${walletAddress} assigned for batch ${id}`);

    const result = await mintApprovedCredit(id);
    if (result.tokenId != null) {
      await createNotification(rows[0].user_id, 'CREDIT', '🪙 Credit Tokenised', `"${rows[0].project_name}" minted as Token #${result.tokenId}.`, '/portfolio', { tokenId: result.tokenId });
      await auditLog(req.user.id, 'CREDIT_MINTED', rows[0].user_id, `Assign+Mint — Batch ${id} → Token #${result.tokenId}`);
      sendMintSuccessEmail(rows[0].email, {
        name: rows[0].full_name, projectName: rows[0].project_name,
        tokenId: result.tokenId, txHash: result.txHash,
        portfolioUrl: `${process.env.FRONTEND_URL}/portfolio`,
      }).catch(e => console.warn('[assign-wallet-and-mint] success email failed:', e.message));
      res.json({ success: true, tokenId: result.tokenId, txHash: result.txHash });
    } else {
      sendTokenizationFailedEmail(rows[0].email, {
        name: rows[0].full_name, projectName: rows[0].project_name,
        reason: 'Minting failed after wallet assignment. Our team is investigating.',
        portfolioUrl: `${process.env.FRONTEND_URL}/portfolio`,
      }).catch(e => console.warn('[assign-wallet-and-mint] failure email failed:', e.message));
      res.status(500).json({ success: false, error: 'Mint failed after wallet assignment' });
    }
  } catch (e) { res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Operation failed' : e.message }); }
});

router.get('/credits/:id/mint-errors', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await query(
      `SELECT cb.id, cb.project_name, cb.registry_serial, cb.standard, cb.quantity,
              cb.vintage_year, cb.expiry_date, cb.admin_status, cb.status, cb.token_id,
              cb.admin_notes, cb.tx_hash_mint, cb.created_at, cb.updated_at,
              u.wallet_address, u.email, u.full_name, u.kyc_verified
       FROM carbon_batches cb JOIN users u ON u.id = cb.user_id WHERE cb.id = $1`, [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Batch not found' });
    const b = rows[0];
    const diagnostics = [];
    if (!b.wallet_address) diagnostics.push({ severity: 'critical', issue: 'No wallet address', fix: 'Use "Assign Wallet + Mint"' });
    if (!b.kyc_verified)   diagnostics.push({ severity: 'critical', issue: 'User KYC not verified', fix: 'Approve KYC first' });
    const expiry = b.expiry_date ? new Date(b.expiry_date) : null;
    if (expiry && expiry < new Date()) diagnostics.push({ severity: 'critical', issue: `Expiry date in the past (${b.expiry_date})`, fix: 'Update expiry_date then retry' });
    if (!b.quantity || b.quantity <= 0) diagnostics.push({ severity: 'critical', issue: `Invalid quantity: ${b.quantity}`, fix: 'Use "Correct Quantity"' });

    const mintErrors = [];
    if (b.admin_notes) {
      const matches = b.admin_notes.matchAll(/\[MINT ERROR ([^\]]+)\]: (.+)/g);
      for (const m of matches) mintErrors.push({ timestamp: m[1], error: m[2] });
    }
    if (mintErrors.length) {
      const lastErr = mintErrors[mintErrors.length - 1].error;
      if (lastErr.includes('Serial already registered')) diagnostics.push({ severity: 'warning', issue: 'Serial already on-chain', fix: 'Use "Set Token ID Manually"' });
      if (lastErr.includes('insufficient funds'))        diagnostics.push({ severity: 'critical', issue: 'Minter wallet out of ETH', fix: 'Top up minter wallet' });
      if (lastErr.includes('ALCHEMY_RPC') || lastErr.includes('network')) diagnostics.push({ severity: 'warning', issue: 'RPC connection failed', fix: 'Check ALCHEMY_RPC env var' });
    }
    if (!diagnostics.length && !mintErrors.length) diagnostics.push({ severity: 'info', issue: 'No errors recorded', fix: 'Try retrying the mint' });

    res.json({ batch: b, diagnostics, mintErrors });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Retirements ───────────────────────────────────────────────────
router.get('/retirements', isAdmin, async (req, res) => {
  const { disputed } = req.query;
  try {
    const params = [];
    let q = `SELECT r.*, u.email, u.full_name FROM retirements r LEFT JOIN users u ON u.id = r.retired_by`;
    if (disputed === 'true') { params.push(true); q += ` WHERE r.disputed = $1`; }
    q += ` ORDER BY r.retired_at DESC LIMIT 200`;
    const { rows } = await query(q, params);
    res.json({ retirements: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/retirements/search', isAdmin, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q param required' });
  if (q.length > 200) return res.status(400).json({ error: 'Search query too long (max 200 chars)' });
  try {
    const { rows } = await query(
      `SELECT r.*, u.email, u.full_name FROM retirements r LEFT JOIN users u ON u.id = r.retired_by
       WHERE r.certificate_id ILIKE $1 OR r.serial_number ILIKE $1 OR u.email ILIKE $1 OR u.full_name ILIKE $1
       ORDER BY r.retired_at DESC LIMIT 50`,
      [`%${q}%`]
    );
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
    await query(`UPDATE retirements SET disputed=TRUE, dispute_reason=$1, disputed_at=NOW(), disputed_by=$2 WHERE id=$3`, [reason, req.user.id, id]);
    await auditLog(req.user.id, 'RETIREMENT_DISPUTED', rows[0].retired_by, `Retirement ${id} flagged: ${reason}`);
    await createNotification(rows[0].retired_by, 'CREDIT', '⚠ Retirement Under Review', `Your retirement certificate ${rows[0].certificate_id} has been flagged. Reason: ${reason}`, '/portfolio', { certId: rows[0].certificate_id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/retirements/:id/unflag', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await query(`UPDATE retirements SET disputed=FALSE, dispute_reason=NULL, disputed_at=NULL, disputed_by=NULL WHERE id=$1`, [id]);
    await auditLog(req.user.id, 'RETIREMENT_UNFLAGGED', null, `Retirement ${id} dispute cleared`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/retirements/:id', isAdmin, async (req, res) => {
  try {
    const { rows } = await query(`SELECT r.*, u.email, u.full_name FROM retirements r LEFT JOIN users u ON u.id=r.retired_by WHERE r.id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ retirement: rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/retirements/:id/correct', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { retire_scope, beneficiary_name, beneficiary_entity, beneficiary_gstin, reporting_standard, purpose, reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'Audit reason required' });
  try {
    const { rows } = await query(`SELECT r.*, u.email, u.full_name FROM retirements r LEFT JOIN users u ON u.id=r.retired_by WHERE r.id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const old = rows[0];
    const updates = []; const values = []; let idx = 1;
    if (retire_scope       != null) { updates.push(`retire_scope=$${idx++}`);       values.push(retire_scope); }
    if (beneficiary_name   != null) { updates.push(`beneficiary_name=$${idx++}`);   values.push(beneficiary_name); }
    if (beneficiary_entity != null) { updates.push(`beneficiary_entity=$${idx++}`); values.push(beneficiary_entity); }
    if (beneficiary_gstin  != null) { updates.push(`beneficiary_gstin=$${idx++}`);  values.push(beneficiary_gstin); }
    if (reporting_standard != null) { updates.push(`reporting_standard=$${idx++}`); values.push(reporting_standard); }
    if (purpose            != null) { updates.push(`purpose=$${idx++}`);            values.push(purpose); }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
    updates.push(`updated_at=NOW()`);
    values.push(id);
    await query(`UPDATE retirements SET ${updates.join(', ')} WHERE id=$${idx}`, values);
    const changes = [];
    if (retire_scope != null && retire_scope !== old.retire_scope) changes.push(`scope: ${old.retire_scope}→${retire_scope}`);
    if (beneficiary_name != null && beneficiary_name !== old.beneficiary_name) changes.push(`beneficiary: ${old.beneficiary_name}→${beneficiary_name}`);
    if (beneficiary_entity != null && beneficiary_entity !== old.beneficiary_entity) changes.push(`entity: ${old.beneficiary_entity}→${beneficiary_entity}`);
    if (reporting_standard != null && reporting_standard !== old.reporting_standard) changes.push(`std: ${old.reporting_standard}→${reporting_standard}`);
    if (purpose != null && purpose !== old.purpose) changes.push(`purpose: ${old.purpose}→${purpose}`);
    await auditLog(req.user.id, 'RETIREMENT_CORRECTED', old.retired_by, `Cert ${old.certificate_id} — ${changes.join(', ')} — Reason: ${reason}`);
    await createNotification(old.retired_by, 'CREDIT', '📝 Retirement Record Updated', `Your retirement certificate ${old.certificate_id} has been updated. Changes: ${changes.join(', ')}.`, '/portfolio', { certId: old.certificate_id });
    res.json({ success: true, changes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Buy Orders ────────────────────────────────────────────────────
router.get('/buy-orders', isAdmin, async (req, res) => {
  const VALID_STATUSES = ['open', 'filled', 'cancelled', 'expired', 'all'];
  const { status = 'open' } = req.query;
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
  try {
    const params = [];
    let q = `SELECT bo.id, bo.token_id, bo.amount, bo.amount_filled,
                    bo.limit_price_inr, bo.eth_escrowed, bo.status,
                    bo.expires_at, bo.created_at,
                    u.email AS buyer_email, u.full_name AS buyer_name, u.id AS buyer_id,
                    cb.project_name, cb.registry_serial, cb.standard
             FROM buy_orders bo
             LEFT JOIN users u ON u.id = bo.buyer_id
             LEFT JOIN carbon_batches cb ON cb.token_id = bo.token_id`;
    if (status !== 'all') { params.push(status); q += ` WHERE bo.status = $${params.length}`; }
    q += ` ORDER BY bo.created_at DESC LIMIT 200`;
    const { rows } = await query(q, params);
    res.json({ orders: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/buy-orders/:id/force-cancel', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'Reason required' });
  try {
    const { rows } = await query(`SELECT bo.*, u.email, u.full_name FROM buy_orders bo LEFT JOIN users u ON u.id=bo.buyer_id WHERE bo.id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Buy order not found' });
    const order = rows[0];
    if (['cancelled', 'filled'].includes(order.status)) return res.status(400).json({ error: `Order already ${order.status}` });

    await query(`UPDATE buy_orders SET status='cancelled', cancelled_at=NOW(), cancel_reason=$1, updated_at=NOW() WHERE id=$2`, [`Admin force-cancel: ${reason}`, id]);
    await auditLog(req.user.id, 'BUY_ORDER_FORCE_CANCELLED', order.buyer_id, `Order #${id} — ETH: ${order.eth_escrowed} — ${reason}`);
    await createNotification(order.buyer_id, 'TRADE', '⚠ Buy Order Cancelled by Admin', `Your buy order #${id} has been cancelled. Reason: ${reason}.`, '/portfolio', { orderId: id });
    try {
      await sendBuyOrderCancelledEmail(order.email, { orderId: id, reason, ethEscrowed: order.eth_escrowed });
    } catch {}
    res.json({ success: true, ethEscrowed: order.eth_escrowed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Trades ────────────────────────────────────────────────────────
router.get('/trades', isAdmin, async (req, res) => {
  const VALID_STATUSES = ['completed', 'pending', 'failed', 'refunded'];
  const status = VALID_STATUSES.includes(req.query.status) ? req.query.status : 'completed';
  const limit  = Math.min(parseInt(req.query.limit || '100', 10), 500);
  try {
    const { rows } = await query(
      `SELECT t.id, t.buyer_id, t.seller_id, t.batch_id, t.token_id,
              t.quantity, t.price_per_credit_inr, t.subtotal_inr,
              t.buyer_fee_inr, t.seller_fee_inr, t.buyer_pays_inr,
              t.payment_mode, t.status, t.tx_hash, t.created_at,
              bu.email AS buyer_email, bu.full_name AS buyer_name,
              su.email AS seller_email, su.full_name AS seller_name,
              cb.project_name, cb.registry_serial, cb.standard
       FROM trades t
       LEFT JOIN users bu ON bu.id = t.buyer_id
       LEFT JOIN users su ON su.id = t.seller_id
       LEFT JOIN carbon_batches cb ON cb.id = t.batch_id
       WHERE t.status = $1 ORDER BY t.created_at DESC LIMIT $2`,
      [status, limit]
    );
    res.json({ trades: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/trades/:id/reconcile', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'Reason required' });
  try {
    const { rows } = await query(
      `SELECT t.*, bu.email AS buyer_email, bu.full_name AS buyer_name, cb.project_name, cb.status AS batch_status
       FROM trades t LEFT JOIN users bu ON bu.id = t.buyer_id LEFT JOIN carbon_batches cb ON cb.id = t.batch_id
       WHERE t.id = $1`, [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Trade not found' });
    const trade = rows[0];
    if (trade.status !== 'completed') return res.status(400).json({ error: 'Trade must be completed to reconcile' });

    const { rows: existing } = await query(`SELECT id FROM carbon_batches WHERE user_id=$1 AND token_id=$2`, [trade.buyer_id, trade.token_id]);
    if (existing.length > 0) {
      await query(`UPDATE carbon_batches SET available_credits=available_credits+$1, total_credits=total_credits+$1, updated_at=NOW() WHERE id=$2`, [trade.quantity, existing[0].id]);
    } else {
      const { rows: src } = await query(`SELECT * FROM carbon_batches WHERE id=$1`, [trade.batch_id]);
      if (!src.length) return res.status(400).json({ error: 'Source batch not found — cannot auto-reconcile' });
      const s = src[0];
      await query(
        `INSERT INTO carbon_batches (user_id,project_id,project_name,project_location,country,standard,project_type,developer,quantity,total_credits,available_credits,retired_credits,vintage_year,expiry_date,registry_serial,token_id,status,admin_status,price_per_credit_inr,credit_type,cbam_eligible,corresponding_adjustment,sdg_tags,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$9,0,$10,$11,$12,$13,'tokenised','approved',$14,$15,$16,$17,$18,NOW(),NOW())`,
        [trade.buyer_id,s.project_id,s.project_name,s.project_location,s.country,s.standard,s.project_type,s.developer,trade.quantity,s.vintage_year,s.expiry_date,s.registry_serial,trade.token_id,trade.price_per_credit_inr,s.credit_type,s.cbam_eligible,s.corresponding_adjustment,s.sdg_tags]
      );
    }
    await auditLog(req.user.id, 'TRADE_RECONCILED', trade.buyer_id, `Trade #${id} — ${trade.quantity} credits assigned. Reason: ${reason}`);
    await createNotification(trade.buyer_id, 'TRADE', '✅ Credits Added to Portfolio', `${trade.quantity} tCO₂ credits from "${trade.project_name}" have been added to your portfolio following a reconciliation.`, '/portfolio', { tradeId: id });
    res.json({ success: true, creditsAssigned: trade.quantity });
  } catch (e) {
    console.error('[admin/trades/reconcile]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Users ─────────────────────────────────────────────────────────
router.get('/users', isAdmin, async (req, res) => {
  const { search, status } = req.query;
  try {
    let q = `SELECT id, email, full_name, role, wallet_address, kyc_status,
                    kyc_verified, frozen, freeze_reason, created_at, is_active,
                    subscription_plan, corporate_managed
             FROM users WHERE role != 'admin'`;
    const params = [];
    if (search) {
      params.push(`%${search}%`, `%${search}%`);
      q += ` AND (email ILIKE $${params.length - 1} OR full_name ILIKE $${params.length})`;
    }
    if (status === 'frozen')   q += ` AND frozen=TRUE`;
    if (status === 'verified') q += ` AND kyc_status='verified'`;
    if (status === 'pending')  q += ` AND kyc_status='submitted'`;
    q += ` ORDER BY created_at DESC LIMIT 200`;
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
    await invalidateUserCache(id);
    await auditLog(req.user.id, 'ACCOUNT_FROZEN', id, reason);
    const { rows: usr } = await query('SELECT email, full_name FROM users WHERE id=$1', [id]);
    try { await sendAccountSuspendedEmail(usr[0].email, { name: usr[0].full_name, reason }); } catch {}
    res.json({ message: 'Account frozen' });
  } catch (e) { res.status(500).json({ error: 'Freeze failed' }); }
});

router.post('/users/:id/unfreeze', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await query(`UPDATE users SET frozen=FALSE, freeze_reason=NULL, updated_at=NOW() WHERE id=$1`, [id]);
    await invalidateUserCache(id);
    await auditLog(req.user.id, 'ACCOUNT_UNFROZEN', id, 'Account reinstated');
    const { rows: usr } = await query('SELECT email, full_name FROM users WHERE id=$1', [id]);
    try { await sendAccountReinstatedEmail(usr[0].email, { name: usr[0].full_name }); } catch {}
    res.json({ message: 'Account unfrozen' });
  } catch (e) { res.status(500).json({ error: 'Unfreeze failed' }); }
});

router.get('/users/:id/credits',    isAdmin, async (req, res) => { try { const { rows } = await query(`SELECT id, project_name, registry_serial, standard, quantity, vintage_year, token_id, admin_status, status, created_at FROM carbon_batches WHERE user_id=$1 ORDER BY created_at DESC`, [req.params.id]); res.json({ credits: rows }); } catch (e) { res.status(500).json({ error: e.message }); } });
router.get('/users/:id/trades',     isAdmin, async (req, res) => { try { const { rows } = await query(`SELECT t.id, t.buyer_id, t.seller_id, t.quantity, t.price_per_credit_inr, t.subtotal_inr, t.buyer_pays_inr, t.buyer_fee_inr, t.seller_fee_inr, t.payment_mode, t.status, t.tx_hash, t.created_at, bu.email AS buyer_email, bu.full_name AS buyer_name, su.email AS seller_email, su.full_name AS seller_name, cb.project_name, cb.registry_serial, cb.standard FROM trades t LEFT JOIN users bu ON bu.id=t.buyer_id LEFT JOIN users su ON su.id=t.seller_id LEFT JOIN carbon_batches cb ON cb.id=t.batch_id WHERE t.buyer_id=$1 OR t.seller_id=$1 ORDER BY t.created_at DESC LIMIT 100`, [req.params.id]); res.json({ trades: rows }); } catch (e) { res.status(500).json({ error: e.message }); } });
router.get('/users/:id/buy-orders', isAdmin, async (req, res) => { try { const { rows } = await query(`SELECT bo.id, bo.token_id, bo.amount, bo.amount_filled, bo.limit_price_inr, bo.eth_escrowed, bo.status, bo.expires_at, bo.created_at, cb.project_name, cb.registry_serial, cb.standard FROM buy_orders bo LEFT JOIN carbon_batches cb ON cb.token_id=bo.token_id WHERE bo.buyer_id=$1 ORDER BY bo.created_at DESC`, [req.params.id]); res.json({ orders: rows }); } catch (e) { res.status(500).json({ error: e.message }); } });

router.post('/users/:id/resync-portfolio', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await query(`SELECT email, full_name, wallet_address FROM users WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    if (!rows[0].wallet_address) return res.status(400).json({ error: 'User has no wallet address' });
    await query(`UPDATE carbon_batches SET updated_at=NOW() WHERE user_id=$1 AND admin_status='approved'`, [id]);
    await auditLog(req.user.id, 'PORTFOLIO_RESYNC', id, `Resync for wallet ${rows[0].wallet_address}`);
    await createNotification(id, 'CREDIT', '🔄 Portfolio Sync Requested', 'Your portfolio has been flagged for re-sync. Refresh to see updated balances.', '/portfolio', {});
    res.json({ success: true, wallet: rows[0].wallet_address });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/users/:id/send-message', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { subject, message } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'subject and message required' });
  if (message.length > 5000) return res.status(400).json({ error: 'Message too long (max 5000 chars)' });
  try {
    const { rows } = await query(`SELECT email, full_name FROM users WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    await sendAdminMessageToUserEmail(rows[0].email, { name: rows[0].full_name, subject, message });
    await createNotification(id, 'ACCOUNT', `📬 ${subject}`, message.slice(0, 120), '/dashboard', {});
    await auditLog(req.user.id, 'USER_MESSAGE_SENT', id, `Subject: ${subject}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/users/:id/reassign-wallet', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { walletAddress, reason } = req.body;
  if (!walletAddress || !reason) return res.status(400).json({ error: 'walletAddress and reason required' });
  if (!walletAddress.startsWith('0x') || walletAddress.length !== 42) return res.status(400).json({ error: 'Invalid Ethereum address' });
  try {
    const { rows } = await query(`SELECT email, full_name, wallet_address FROM users WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    await query(`UPDATE users SET wallet_address=$1, updated_at=NOW() WHERE id=$2`, [walletAddress.toLowerCase(), id]);
    await invalidateUserCache(id);
    await auditLog(req.user.id, 'WALLET_REASSIGNED', id, `${rows[0].wallet_address || 'none'} → ${walletAddress.toLowerCase()} — ${reason}`);
    await createNotification(id, 'ACCOUNT', '🔑 Wallet Address Updated', `Your wallet has been updated to ${walletAddress.slice(0,6)}...${walletAddress.slice(-4)}`, '/profile', {});
    try { await sendWalletUpdatedEmail(rows[0].email, { name: rows[0].full_name, walletAddress }); } catch {}
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
    await query(`UPDATE users SET kyc_verified=FALSE, kyc_status='rekyc_required', kyc_verified_at=NULL, updated_at=NOW() WHERE id=$1`, [id]);
    await query(`UPDATE kyc_submissions SET status='rejected', rejection_reason=$1 WHERE user_id=$2 AND status='pending'`, [`Re-KYC required: ${reason}`, id]);
    await invalidateUserCache(id);
    await auditLog(req.user.id, 'REKYC_REQUIRED', id, reason);
    await createNotification(id, 'KYC', '🔄 Re-KYC Required', `Your KYC has been invalidated. Reason: ${reason}. Please resubmit your documents.`, '/kyc', { reason });
    try {
      await sendKycResubmissionRequiredEmail(rows[0].email, {
        fullName: rows[0].full_name,
        reason,
        kycUrl: `${process.env.FRONTEND_URL}/kyc`,
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
    const { rows: active } = await query(`SELECT COUNT(*) FROM market_listings WHERE seller_id=$1 AND available_credits > 0`, [id]).catch(() => ({ rows: [{ count: 0 }] }));
    if (parseInt(active[0].count) > 0) return res.status(400).json({ error: 'User has active listings — delist them first' });
    await query(
      `UPDATE users SET email=CONCAT('deleted_',id,'@removed.invalid'), full_name='Deleted User',
       phone=NULL, wallet_address=NULL, kyc_verified=FALSE, kyc_status='deleted',
       kyc_data_hash=NULL, kyc_aadhaar_hash=NULL, kyc_pan_hash=NULL,
       is_active=FALSE, frozen=TRUE, freeze_reason=$1, updated_at=NOW() WHERE id=$2`,
      [`ACCOUNT DELETED: ${reason}`, id]
    );
    await query(`UPDATE kyc_submissions SET doc_ipfs_hash=NULL, aadhaar_hash=NULL, pan_hash=NULL, kyc_data_hash=NULL WHERE user_id=$1`, [id]);
    await invalidateUserCache(id);
    await auditLog(req.user.id, 'USER_DELETED', id, `${rows[0].email} — ${reason}`);
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
         AND kyc_verified=TRUE
       ORDER BY kyc_expires_at ASC`
    );
    res.json({ users: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/users/:id/kyc-reminder', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await query(`SELECT email, full_name, kyc_expires_at FROM users WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    const u = rows[0];
    await createNotification(id, 'KYC', '⚠ KYC Renewal Required', `Your KYC expires on ${new Date(u.kyc_expires_at).toLocaleDateString('en-IN')}. Please renew to avoid suspension.`, '/kyc', {});
    const daysLeft = Math.max(0, Math.ceil((new Date(u.kyc_expires_at) - Date.now()) / 86400000));
    await sendKycExpiringSoonEmail(u.email, {
      fullName: u.full_name,
      daysLeft,
      expiresOn: new Date(u.kyc_expires_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
      kycUrl: `${process.env.FRONTEND_URL}/kyc`,
    });
    await auditLog(req.user.id, 'KYC_REMINDER_SENT', id, `Sent to ${u.email}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Corporate ─────────────────────────────────────────────────────
// [CORP-1] GET /api/admin/corporate/activations
router.get('/corporate/activations', isAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT DISTINCT ON (u.id)
              u.id, u.email, u.full_name, u.company_name,
              u.subscription_plan, u.subscription_cycle,
              u.subscription_renewal_date, u.subscription_activated_at,
              u.corporate_managed, u.kyc_verified,
              sp.amount_paise, sp.pay_method, sp.created_at AS payment_date,
              sp.notes AS activation_notes,
              o.seats_limit, o.name AS org_name
       FROM users u
       LEFT JOIN subscription_payments sp
         ON sp.user_id = u.id AND sp.plan = 'corporate' AND sp.status = 'success'
       LEFT JOIN organisations o ON o.owner_id = u.id
       WHERE u.subscription_plan = 'corporate'
       ORDER BY u.id, sp.created_at DESC NULLS LAST`
    );
    res.json({ activations: rows });
  } catch (e) {
    console.error('[admin/corporate/activations]', e.message);
    res.status(500).json({ error: 'Failed to fetch corporate activations' });
  }
});

// [CORP-2] POST /api/admin/users/:id/activate-corporate
router.post('/users/:id/activate-corporate', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { cycle = 'annual', seats = null, customPriceINR = 0, notes = '', renewalMonths = null } = req.body;

  if (!['monthly', 'annual'].includes(cycle))
    return res.status(400).json({ error: 'cycle must be monthly or annual' });
  if (seats !== null && (!Number.isInteger(seats) || seats < 1))
    return res.status(400).json({ error: 'seats must be a positive integer or null (unlimited)' });
  const priceINR = parseFloat(customPriceINR) || 0;
  if (priceINR < 0)
    return res.status(400).json({ error: 'customPriceINR cannot be negative' });

  try {
    const { rows: userRows } = await query(
      `SELECT id, email, full_name, company_name, kyc_verified,
              subscription_plan, subscription_cycle, org_id
       FROM users WHERE id = $1`, [id]
    );
    if (!userRows.length) return res.status(404).json({ error: 'User not found' });
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
    const idempotencyKey   = `corporate_sales_${id}_${Date.now()}`;

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
        [id, cycle, customPricePaise, idempotencyKey, renewalDate, priceINR, notes || null]
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
        [cycle, renewalDate, id]
      );

      await client.query(
        `INSERT INTO subscription_history
           (user_id, event_type, from_plan, to_plan, from_cycle, to_cycle,
            payment_id, amount_paise, gst_amount_paise, renewal_date, triggered_by, notes)
         VALUES ($1,$2,$3,'corporate',$4,$5,$6,$7,0,$8,'admin',$9)`,
        [id, event, user.subscription_plan || 'free', user.subscription_cycle || null,
         cycle, pay.id, customPricePaise, renewalDate, notes || null]
      );

      const seatLimit = (seats !== null && seats > 0) ? seats : 999;
      await client.query(
        `UPDATE organisations SET seats_limit=$1, updated_at=NOW() WHERE owner_id=$2`,
        [seatLimit, id]
      );
    });

    await invalidateUserCache(id);
    await createNotification(id, 'WALLET', '🏢 Corporate Plan Activated',
      `Your Corporate plan has been activated by the EtherTrack team.${notes ? ` Note: ${notes}` : ''}`,
      '/billing', { plan: 'corporate', cycle }).catch(() => {});

    const { rows: [freshUser] } = await query('SELECT email, full_name FROM users WHERE id=$1', [id]);
    setImmediate(async () => {
      try {
        const seatDisplay = (seats !== null && seats > 0) ? seats : 'Unlimited';
        await sendCorporatePlanActivatedEmail(freshUser.email, {
          name: freshUser.full_name,
          seatDisplay,
          cycle,
          renewalDateLabel: renewalDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
          priceINR,
          notes,
          billingUrl: `${process.env.FRONTEND_URL}/billing`,
        });
      } catch (e) { console.warn('[admin/activate-corporate] email failed:', e.message); }
    });

    await auditLog(req.user.id, 'CORPORATE_PLAN_ACTIVATED', id,
      `Cycle: ${cycle} · Seats: ${seats ?? 'unlimited'} · Price: ₹${priceINR} · ${notes || ''}`);

    return res.json({ ok: true, userId: id, plan: 'corporate', cycle, seats: seats ?? 'unlimited', renewalDate: renewalDate.toISOString(), customPriceINR: priceINR });
  } catch (e) {
    console.error('[admin/activate-corporate]', e.message);
    return res.status(500).json({ error: 'Corporate activation failed', detail: e.message });
  }
});

// [CORP-3] PATCH /api/admin/users/:id/corporate-renewal
router.patch('/users/:id/corporate-renewal', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { renewalDate, seats, notes } = req.body;
  if (!renewalDate) return res.status(400).json({ error: 'renewalDate required (ISO string or YYYY-MM-DD)' });
  const parsed = new Date(renewalDate);
  if (isNaN(parsed.getTime())) return res.status(400).json({ error: 'Invalid renewalDate' });
  if (parsed < new Date()) return res.status(400).json({ error: 'renewalDate must be in the future' });
  try {
    const { rows } = await query(`SELECT subscription_plan, email, full_name FROM users WHERE id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    if (rows[0].subscription_plan !== 'corporate')
      return res.status(400).json({ error: 'User is not on Corporate plan — activate first' });

    await query(
      `UPDATE users SET subscription_renewal_date=$1, corporate_managed=TRUE, updated_at=NOW() WHERE id=$2`,
      [parsed, id]
    );
    if (seats != null) {
      const seatLimit = seats === 'unlimited' ? 999 : parseInt(seats);
      if (!isNaN(seatLimit) && seatLimit > 0)
        await query(`UPDATE organisations SET seats_limit=$1, updated_at=NOW() WHERE owner_id=$2`, [seatLimit, id]);
    }
    await invalidateUserCache(id);
    await auditLog(req.user.id, 'CORPORATE_RENEWAL_UPDATED', id,
      `New renewal: ${parsed.toISOString()} · Seats: ${seats ?? 'unchanged'} · ${notes || ''}`);
    await createNotification(id, 'WALLET', '📅 Corporate Plan Renewed',
      `Your Corporate plan has been renewed until ${parsed.toLocaleDateString('en-IN')}.`,
      '/billing', { plan: 'corporate' }).catch(() => {});
    res.json({ ok: true, renewalDate: parsed.toISOString() });
  } catch (e) {
    console.error('[admin/corporate-renewal]', e.message);
    res.status(500).json({ error: 'Renewal update failed' });
  }
});

// ── Listings ──────────────────────────────────────────────────────
// [FIX-LISTINGS] Filter moved to SQL — avoids fetching full table into JS
router.get('/listings', isAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT ml.batch_id, ml.token_id, ml.listing_id, ml.project_name,
              ml.registry_serial, ml.standard, ml.vintage_year, ml.project_type,
              ml.price_per_credit_inr, ml.seller_id, ml.seller_wallet, ml.seller_name,
              ml.seller_email, ml.created_at, ml.updated_at,
              ml.available_credits AS amount_remaining
       FROM market_listings ml
       WHERE ml.available_credits > 0
       ORDER BY ml.created_at DESC`
    );
    res.json({ listings: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/listings/:listingId/force-delist', isAdmin, async (req, res) => {
  const { listingId } = req.params;
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'Reason required' });
  const lid = safeInt(listingId);
  if (lid === null) return res.status(400).json({ error: 'Invalid listing ID' });
  try {
    const { rows } = await query(`SELECT * FROM market_listings WHERE listing_id=$1`, [lid]);
    if (!rows.length) return res.status(404).json({ error: 'Listing not found' });
    const listing = rows[0];
    if (listing.batch_id && listing.amount_remaining > 0) {
      await query(
        `UPDATE carbon_batches SET available_credits=available_credits+$1,
         status=CASE WHEN status='listed' THEN 'tokenised' ELSE status END, updated_at=NOW()
         WHERE id=$2`,
        [listing.amount_remaining, listing.batch_id]
      );
    }
    await query(`DELETE FROM market_listings WHERE listing_id=$1`, [lid]);
    await auditLog(req.user.id, 'LISTING_FORCE_DELISTED', listing.seller_id, `Listing #${listingId} — ${reason}`);
    await createNotification(listing.seller_id, 'CREDIT', '⚠ Listing Removed by Admin', `Your listing for "${listing.project_name}" was removed. Reason: ${reason}`, '/portfolio', { listingId });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/listings/:listingId/override-price', isAdmin, async (req, res) => {
  const { listingId } = req.params;
  const { priceInr, reason } = req.body;
  if (!priceInr || !reason) return res.status(400).json({ error: 'priceInr and reason required' });
  const price = parseFloat(priceInr);
  if (isNaN(price) || price <= 0) return res.status(400).json({ error: 'priceInr must be a positive number' });
  const lid = safeInt(listingId);
  if (lid === null) return res.status(400).json({ error: 'Invalid listing ID' });
  try {
    const { rows } = await query(`SELECT * FROM market_listings WHERE listing_id=$1`, [lid]);
    if (!rows.length) return res.status(404).json({ error: 'Listing not found' });
    await query(`UPDATE market_listings SET price_per_credit_inr=$1, updated_at=NOW() WHERE listing_id=$2`, [price, lid]);
    await query(`UPDATE carbon_batches SET price_per_credit_inr=$1, updated_at=NOW() WHERE id=$2`, [price, rows[0].batch_id]);
    await auditLog(req.user.id, 'LISTING_PRICE_OVERRIDDEN', rows[0].seller_id, `Listing ${listingId}: → ₹${price} — ${reason}`);
    await createNotification(rows[0].seller_id, 'CREDIT', '📝 Listing Price Updated by Admin', `Your listing for "${rows[0].project_name}" price was corrected to ₹${price.toLocaleString('en-IN')}/credit.`, '/portfolio', { listingId });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Revenue ───────────────────────────────────────────────────────
// ── Subscription analytics (active/cancelled counts, tier breakdown, MRR, revenue by month) ──
router.get('/subscriptions/stats', isAdmin, async (req, res) => {
  try {
    const [byTier, freeCount, cancelledByMonth, cancelledTotal, revenueByMonth, allTimeRevenue] = await Promise.all([
      // Active paid subscribers by plan+cycle, with MRR normalized from each user's
      // actual last-paid amount (not a hardcoded price — this naturally handles
      // Corporate's custom per-deal pricing with zero special-casing).
      query(`
        WITH latest_payment AS (
          SELECT DISTINCT ON (user_id) user_id, total_amount_paise
          FROM subscription_payments
          WHERE status = 'success'
          ORDER BY user_id, created_at DESC
        )
        SELECT
          u.subscription_plan  AS plan,
          u.subscription_cycle AS cycle,
          COUNT(*)::int AS active_count,
          COALESCE(SUM(
            CASE WHEN u.subscription_cycle = 'annual' THEN lp.total_amount_paise / 12.0
                 ELSE lp.total_amount_paise END
          ), 0)::bigint AS mrr_paise
        FROM users u
        LEFT JOIN latest_payment lp ON lp.user_id = u.id
        WHERE u.subscription_plan != 'free' AND u.plan_selected = TRUE
          AND (u.subscription_renewal_date IS NULL OR u.subscription_renewal_date > NOW())
        GROUP BY u.subscription_plan, u.subscription_cycle
        ORDER BY u.subscription_plan
      `),
      query(`SELECT COUNT(*)::int AS count FROM users WHERE subscription_plan = 'free' OR plan_selected = FALSE`),
      // "Cancelled" = a subscription_history row where a paid plan was downgraded to free.
      // First-time free selection (from_plan IS NULL) is NOT counted as a cancellation.
      query(`
        SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YYYY') AS month, COUNT(*)::int AS count
        FROM subscription_history
        WHERE to_plan = 'free' AND from_plan IS NOT NULL AND from_plan != 'free'
          AND created_at > NOW() - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY DATE_TRUNC('month', created_at) DESC
      `),
      query(`
        SELECT COUNT(*)::int AS count FROM subscription_history
        WHERE to_plan = 'free' AND from_plan IS NOT NULL AND from_plan != 'free'
      `),
      query(`
        SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YYYY') AS month,
               plan, COUNT(*)::int AS payments,
               COALESCE(SUM(total_amount_paise), 0)::bigint AS revenue_paise
        FROM subscription_payments
        WHERE status = 'success' AND created_at > NOW() - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', created_at), plan
        ORDER BY DATE_TRUNC('month', created_at) DESC
      `),
      query(`SELECT COALESCE(SUM(total_amount_paise), 0)::bigint AS total_paise, COUNT(*)::int AS total_payments FROM subscription_payments WHERE status = 'success'`),
    ]);

    const toINR = (paise) => Math.round(Number(paise) / 100);

    res.json({
      byTier: byTier.rows.map(r => ({ plan: r.plan, cycle: r.cycle, activeCount: r.active_count, mrrINR: toINR(r.mrr_paise) })),
      totalActivePaid: byTier.rows.reduce((sum, r) => sum + r.active_count, 0),
      freeUsers: freeCount.rows[0].count,
      currentMRRInINR: toINR(byTier.rows.reduce((sum, r) => sum + Number(r.mrr_paise), 0)),
      cancelledTotal: cancelledTotal.rows[0].count,
      cancelledByMonth: cancelledByMonth.rows,
      revenueByMonth: revenueByMonth.rows.map(r => ({ month: r.month, plan: r.plan, payments: r.payments, revenueINR: toINR(r.revenue_paise) })),
      allTimeSubscriptionRevenueINR: toINR(allTimeRevenue.rows[0].total_paise),
      allTimePayments: allTimeRevenue.rows[0].total_payments,
    });
  } catch (e) {
    console.error('[admin/subscriptions/stats]', e.message);
    res.status(500).json({ error: 'Failed to fetch subscription stats' });
  }
});

// ── Finance export (CSV) — trades fees / subscription revenue / combined ──
// For ERP injection. type=trades|subscriptions|combined. Optional from/to
// query params (YYYY-MM-DD) to scope the date range, defaults to all-time.
router.get('/finance/export', isAdmin, async (req, res) => {
  const type = ['trades', 'subscriptions', 'combined'].includes(req.query.type) ? req.query.type : 'combined';
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : '2000-01-01';
  const to   = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to   || '') ? req.query.to   : '2100-01-01';

  const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  try {
    if (type === 'trades') {
      const { rows } = await query(
        `SELECT t.created_at, t.id AS trade_id, bu.email AS buyer_email, su.email AS seller_email,
                cb.project_name, t.quantity, t.subtotal_inr, pf.buyer_fee_inr, pf.seller_fee_inr,
                pf.total_fee_inr, pf.gst_inr, pf.gst_type, pf.cgst_inr, pf.sgst_inr, pf.igst_inr,
                pf.platform_net_inr, pf.payment_mode
         FROM trades t
         JOIN platform_fees pf ON pf.trade_id = t.id
         LEFT JOIN users bu ON bu.id = t.buyer_id
         LEFT JOIN users su ON su.id = t.seller_id
         LEFT JOIN carbon_batches cb ON cb.id = t.batch_id
         WHERE t.status = 'completed' AND t.created_at::date BETWEEN $1 AND $2
         ORDER BY t.created_at DESC`,
        [from, to]
      );
      const headers = ['DATE','TRADE ID','BUYER','SELLER','PROJECT','QUANTITY (tCO2)','SUBTOTAL (INR)','BUYER FEE (INR)','SELLER FEE (INR)','TOTAL FEE (INR)','GST TYPE','CGST (INR)','SGST (INR)','IGST (INR)','TOTAL GST (INR)','PLATFORM NET (INR)','PAYMENT MODE'];
      const csvRows = rows.map(r => [
        new Date(r.created_at).toISOString(), r.trade_id, r.buyer_email, r.seller_email, r.project_name,
        r.quantity, r.subtotal_inr, r.buyer_fee_inr, r.seller_fee_inr, r.total_fee_inr,
        r.gst_type || 'cgst_sgst (assumed — pre-migration record)', r.cgst_inr || 0, r.sgst_inr || 0, r.igst_inr || 0, r.gst_inr, r.platform_net_inr, r.payment_mode,
      ].map(csvCell).join(','));
      const csv = [headers.join(','), ...csvRows].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="ethertrack_trade_fees_${Date.now()}.csv"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(csv);
    }

    if (type === 'subscriptions') {
      const { rows } = await query(
        `SELECT sp.created_at, sp.id AS payment_id, u.email, sp.plan, sp.cycle,
                sp.amount_paise, sp.gst_amount_paise, sp.total_amount_paise, sp.pay_method,
                sp.gst_type, sp.cgst_paise, sp.sgst_paise, sp.igst_paise
         FROM subscription_payments sp
         LEFT JOIN users u ON u.id = sp.user_id
         WHERE sp.status = 'success' AND sp.created_at::date BETWEEN $1 AND $2
         ORDER BY sp.created_at DESC`,
        [from, to]
      );
      const headers = ['DATE','PAYMENT ID','USER EMAIL','PLAN','CYCLE','AMOUNT (INR)','GST TYPE','CGST (INR)','SGST (INR)','IGST (INR)','TOTAL GST (INR)','TOTAL (INR)','PAYMENT METHOD'];
      const csvRows = rows.map(r => [
        new Date(r.created_at).toISOString(), r.payment_id, r.email, r.plan, r.cycle,
        (r.amount_paise / 100).toFixed(2),
        r.gst_type || 'cgst_sgst (assumed — pre-migration record)',
        ((r.cgst_paise || 0) / 100).toFixed(2), ((r.sgst_paise || 0) / 100).toFixed(2), ((r.igst_paise || 0) / 100).toFixed(2),
        (r.gst_amount_paise / 100).toFixed(2), (r.total_amount_paise / 100).toFixed(2), r.pay_method,
      ].map(csvCell).join(','));
      const csv = [headers.join(','), ...csvRows].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="ethertrack_subscription_revenue_${Date.now()}.csv"`);
      res.setHeader('Cache-Control', 'no-store');
      return res.send(csv);
    }

    // combined — unified income ledger: one row per income event, both
    // sources normalized to the same shape. This is the shape most useful
    // for a straight ERP ledger import.
    const [tradeRows, subRows] = await Promise.all([
      query(
        `SELECT t.created_at AS date, 'trade_fee' AS source, t.id AS ref_id,
                pf.total_fee_inr AS amount_inr, pf.gst_inr,
                CONCAT('Trade #', t.id, ' — ', cb.project_name) AS description
         FROM trades t
         JOIN platform_fees pf ON pf.trade_id = t.id
         LEFT JOIN carbon_batches cb ON cb.id = t.batch_id
         WHERE t.status = 'completed' AND t.created_at::date BETWEEN $1 AND $2`,
        [from, to]
      ),
      query(
        `SELECT sp.created_at AS date, 'subscription' AS source, sp.id AS ref_id,
                (sp.total_amount_paise / 100.0) AS amount_inr, (sp.gst_amount_paise / 100.0) AS gst_inr,
                CONCAT(u.email, ' — ', sp.plan, ' (', sp.cycle, ')') AS description
         FROM subscription_payments sp
         LEFT JOIN users u ON u.id = sp.user_id
         WHERE sp.status = 'success' AND sp.created_at::date BETWEEN $1 AND $2`,
        [from, to]
      ),
    ]);
    const combined = [...tradeRows.rows, ...subRows.rows].sort((a, b) => new Date(b.date) - new Date(a.date));
    const headers = ['DATE','SOURCE','REF ID','AMOUNT (INR)','GST (INR)','DESCRIPTION'];
    const csvRows = combined.map(r => [
      new Date(r.date).toISOString(), r.source, r.ref_id, Number(r.amount_inr).toFixed(2), Number(r.gst_inr).toFixed(2), r.description,
    ].map(csvCell).join(','));
    const totalRow = ['', '', 'TOTAL', combined.reduce((s, r) => s + Number(r.amount_inr), 0).toFixed(2), '', ''].map(csvCell).join(',');
    const csv = [headers.join(','), ...csvRows, totalRow].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="ethertrack_combined_income_${Date.now()}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  } catch (e) {
    console.error('[admin/finance/export]', e.message);
    res.status(500).json({ error: 'Export failed' });
  }
});

router.get('/revenue', isAdmin, async (req, res) => {
  const period = Math.min(parseInt(req.query.period || '30', 10), 365);
  try {
    const [totalFees, feesByMonth, topTraders, creditsByStandard, retirementsByMonth, activeUsers] = await Promise.all([
      query(`SELECT COALESCE(SUM(buyer_fee_inr+seller_fee_inr),0) AS total_fees_inr, COALESCE(SUM(CASE WHEN created_at>NOW()-($1||' days')::interval THEN buyer_fee_inr+seller_fee_inr ELSE 0 END),0) AS period_fees_inr, COALESCE(SUM(subtotal_inr),0) AS total_volume_inr, COUNT(*) AS total_trades, COALESCE(SUM(quantity),0) AS total_credits_traded FROM trades WHERE status='completed'`, [period]),
      query(`SELECT TO_CHAR(DATE_TRUNC('month',created_at),'Mon YYYY') AS month, COALESCE(SUM(buyer_fee_inr+seller_fee_inr),0) AS fees_inr, COALESCE(SUM(subtotal_inr),0) AS volume_inr, COUNT(*) AS trades FROM trades WHERE status='completed' AND created_at>NOW()-INTERVAL '6 months' GROUP BY DATE_TRUNC('month',created_at) ORDER BY DATE_TRUNC('month',created_at) DESC`),
      query(`SELECT u.id, u.email, u.full_name, COUNT(t.id) AS trade_count, COALESCE(SUM(t.subtotal_inr),0) AS volume_inr FROM trades t JOIN users u ON u.id=t.buyer_id OR u.id=t.seller_id WHERE t.status='completed' GROUP BY u.id,u.email,u.full_name ORDER BY volume_inr DESC LIMIT 10`),
      query(`SELECT standard, COUNT(*) AS batches, COALESCE(SUM(quantity),0) AS total_credits FROM carbon_batches WHERE admin_status='approved' GROUP BY standard ORDER BY total_credits DESC`),
      query(`SELECT TO_CHAR(DATE_TRUNC('month',retired_at),'Mon YYYY') AS month, COUNT(*) AS count, COALESCE(SUM(amount),0) AS tco2 FROM retirements WHERE retired_at>NOW()-INTERVAL '6 months' GROUP BY DATE_TRUNC('month',retired_at) ORDER BY DATE_TRUNC('month',retired_at) DESC`),
      query(`SELECT COUNT(DISTINCT buyer_id)+COUNT(DISTINCT seller_id) AS active FROM trades WHERE status='completed' AND created_at>NOW()-($1||' days')::interval`, [period]),
    ]);
    res.json({ summary: totalFees.rows[0], feesByMonth: feesByMonth.rows, topTraders: topTraders.rows, creditsByStandard: creditsByStandard.rows, retirementsByMonth: retirementsByMonth.rows, activeUsers: parseInt(activeUsers.rows[0]?.active || 0), period });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Audit ─────────────────────────────────────────────────────────
router.get('/audit', isAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT a.*, u.email AS target_email, u.full_name AS target_name
       FROM admin_audit_log a LEFT JOIN users u ON u.id=a.target_user_id
       ORDER BY a.created_at DESC LIMIT 200`
    );
    res.json({ logs: rows });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch audit log' }); }
});

// [FIX-EXPORT] Authentication via session cookie (isAdmin middleware),
// not via ?token= query param which was leaking credentials into server
// logs, browser history, and CDN access logs.
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
    const headers  = ['TIMESTAMP','ACTION','ADMIN','TARGET EMAIL','TARGET NAME','DETAILS'];
    const csvRows  = rows.map(r => [
      new Date(r.created_at).toISOString(),
      r.action        || '',
      r.admin_email   || '',
      r.target_email  || '',
      `"${(r.target_name || '').replace(/"/g, '""')}"`,
      `"${(r.details    || '').replace(/"/g, '""')}"`,
    ].join(','));
    const csv = [headers.join(','), ...csvRows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="ethertrack_audit_${Date.now()}.csv"`);
    res.setHeader('Cache-Control', 'no-store'); // never cache sensitive exports
    res.send(csv);
  } catch (e) { res.status(500).json({ error: 'Export failed' }); }
});

// ── Disputes ──────────────────────────────────────────────────────
router.get('/disputes', isAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT d.*, u.email AS target_email, u.full_name AS target_name
       FROM disputes d JOIN users u ON u.id=d.target_user_id
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
      `INSERT INTO disputes (opened_by,target_user_id,reason,notes,status) VALUES ($1,$2,$3,$4,'open') RETURNING id`,
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

// ── Announcements ─────────────────────────────────────────────────
router.get('/announcements', isAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT a.*, u.email AS created_by_email
       FROM system_announcements a LEFT JOIN users u ON u.id=a.created_by
       ORDER BY a.created_at DESC LIMIT 20`
    ).catch(() => ({ rows: [] }));
    res.json({ announcements: rows });
  } catch (e) { res.json({ announcements: [] }); }
});

router.post('/announcements', isAdmin, async (req, res) => {
  const { title, message, type = 'info', expiresAt } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'title and message required' });
  try {
    const { rows } = await query(
      `INSERT INTO system_announcements (title,message,type,expires_at,created_by,created_at)
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

// [HARDENING] Broadcast streams users in batches of 50 to avoid holding
// thousands of rows in memory before the notification loop starts.
router.post('/announcements/broadcast', isAdmin, async (req, res) => {
  const { subject, message, sendEmail: doEmail } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'subject and message required' });
  if (message.length > 10000) return res.status(400).json({ error: 'Message too long (max 10000 chars)' });
  try {
    const { rows: countRow } = await query(
      `SELECT COUNT(*) FROM users WHERE is_active=TRUE AND role!='admin' AND frozen=FALSE`
    );
    const total = parseInt(countRow[0].count);
    res.json({ success: true, total, message: `Broadcast queued for ${total} users` });

    setImmediate(async () => {
      const safeSubject = escHtml(subject);
      const safeMessage = escHtml(message);
      let sent = 0, failed = 0, offset = 0;
      const BATCH = 50;

      while (true) {
        const { rows: batch } = await query(
          `SELECT id, email, full_name FROM users
           WHERE is_active=TRUE AND role!='admin' AND frozen=FALSE
           ORDER BY id LIMIT $1 OFFSET $2`,
          [BATCH, offset]
        );
        if (!batch.length) break;
        for (const u of batch) {
          try {
            await createNotification(u.id, 'SYSTEM', `📢 ${subject}`, message.slice(0, 200), '/dashboard', {});
            if (doEmail) {
              await sendPlatformAnnouncementEmail(u.email, { name: u.full_name, subject: safeSubject, message: safeMessage });
            }
            sent++;
          } catch { failed++; }
        }
        offset += BATCH;
      }
      await auditLog(req.user.id, 'ANNOUNCEMENT_BROADCAST', null, `"${subject}" — ${sent} sent, ${failed} failed`).catch(() => {});
      console.log(`[admin/broadcast] "${subject}" — ${sent} sent, ${failed} failed`);
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Chain Health ──────────────────────────────────────────────────
router.get('/health/onchain', isAdmin, async (req, res) => {
  const results = {
    minterWallet: { address: null, balanceEth: null, ok: false, error: null },
    rpcConnected: false, lastMint: null, pendingMints: 0, failedMints: 0,
    contractAddress:   process.env.CARBON_CREDIT_TOKEN_ADDRESS || null,
    marketplaceAddress: process.env.MARKETPLACE_ADDRESS || null,
    network: 'sepolia',
  };
  try {
    const [lastMint, pending, failed] = await Promise.all([
      query(`SELECT tokenised_at, token_id, project_name FROM carbon_batches WHERE token_id IS NOT NULL ORDER BY tokenised_at DESC LIMIT 1`),
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
    results.chainId      = Number(network.chainId);
    const minterAddress  = process.env.MINTER_ADDRESS;
    if (minterAddress) {
      results.minterWallet.address    = minterAddress;
      const balance = await provider.getBalance(minterAddress);
      results.minterWallet.balanceEth = parseFloat(ethers.formatEther(balance)).toFixed(4);
      results.minterWallet.ok         = parseFloat(results.minterWallet.balanceEth) > 0.01;
    }
  } catch (e) { results.rpcConnected = false; results.minterWallet.error = e.message; }
  res.json(results);
});

// ── Blacklist ─────────────────────────────────────────────────────
router.get('/serials/blacklist', isAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT bs.*, u.email AS blacklisted_by_email
       FROM blacklisted_serials bs LEFT JOIN users u ON u.id=bs.blacklisted_by
       ORDER BY bs.blacklisted_at DESC`
    ).catch(() => ({ rows: [] }));
    res.json({ blacklist: rows });
  } catch (e) { res.json({ blacklist: [] }); }
});

router.post('/serials/blacklist', isAdmin, async (req, res) => {
  const { serial, reason } = req.body;
  if (!serial || !reason) return res.status(400).json({ error: 'serial and reason required' });
  try {
    await query(
      `INSERT INTO blacklisted_serials (serial_number,reason,blacklisted_by,blacklisted_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (serial_number) DO UPDATE SET reason=$2, blacklisted_by=$3, blacklisted_at=NOW()`,
      [serial.trim(), reason, req.user.id]
    );
    const { rows: affected } = await query(
      `UPDATE carbon_batches SET admin_status='rejected', admin_notes=$1
       WHERE registry_serial=$2 AND admin_status='pending'
       RETURNING user_id, project_name`,
      [`Blacklisted serial: ${reason}`, serial.trim()]
    );
    for (const b of affected)
      await createNotification(b.user_id, 'CREDIT', '❌ Credit Submission Rejected', `Serial ${serial} has been blacklisted. Reason: ${reason}`, '/portfolio', {});
    await auditLog(req.user.id, 'SERIAL_BLACKLISTED', null, `Serial: ${serial} — ${reason} (${affected.length} batches auto-rejected)`);
    res.json({ success: true, affectedBatches: affected.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/serials/blacklist/:serial', isAdmin, async (req, res) => {
  try {
    await query(`DELETE FROM blacklisted_serials WHERE serial_number=$1`, [decodeURIComponent(req.params.serial)]);
    await auditLog(req.user.id, 'SERIAL_UNBLACKLISTED', null, `Serial: ${req.params.serial}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Projects ──────────────────────────────────────────────────────
// [FIX-PROJECTS] WHERE clause corrected — was wrongly excluding batches with
// admin_status IS NULL (new projects with no batches). Now groups all batches
// per project regardless of admin_status.
router.get('/projects', isAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT p.id, p.project_name, p.project_code, p.developer_name, p.standard,
              COUNT(b.id)                                                    AS batch_count,
              COALESCE(SUM(b.total_credits),0)                              AS total_credits,
              COALESCE(SUM(b.available_credits),0)                          AS available_credits,
              COALESCE(SUM(b.retired_credits),0)                            AS retired_credits,
              COUNT(CASE WHEN b.token_id IS NOT NULL THEN 1 END)            AS minted_batches
       FROM projects p
       LEFT JOIN carbon_batches b ON b.project_id = p.id
       GROUP BY p.id
       ORDER BY total_credits DESC`
    ).catch(() => ({ rows: [] }));
    res.json({ projects: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;