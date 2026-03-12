// routes/kyc.js
const router  = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { sendEmail } = require('../services/email');

// ── POST /api/kyc/submit — user submits KYC ───────────────────────
router.post('/submit', authenticate, async (req, res) => {
  const { fullName, idType, phone, kycDataHash, aadhaarHash, panHash, docIpfsHash } = req.body;

  if (!fullName || !idType || !kycDataHash || !docIpfsHash) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // ── Check for duplicate Aadhaar hash ─────────────────────
    if (aadhaarHash) {
      const { rows: dup } = await query(
        'SELECT id FROM kyc_submissions WHERE aadhaar_hash = $1 AND user_id != $2',
        [aadhaarHash, req.user.id]
      );
      if (dup.length) {
        return res.status(409).json({
          error: 'duplicate_kyc',
          message: 'These KYC credentials are already verified with another account.',
        });
      }
    }

    // ── Check for duplicate PAN hash ──────────────────────────
    if (panHash) {
      const { rows: dup } = await query(
        'SELECT id FROM kyc_submissions WHERE pan_hash = $1 AND user_id != $2',
        [panHash, req.user.id]
      );
      if (dup.length) {
        return res.status(409).json({
          error: 'duplicate_kyc',
          message: 'These KYC credentials are already verified with another account.',
        });
      }
    }

    // ── Check if already has a pending/approved submission ───
    const { rows: existing } = await query(
      `SELECT id, status FROM kyc_submissions 
       WHERE user_id = $1 AND status IN ('pending','approved')
       ORDER BY submitted_at DESC LIMIT 1`,
      [req.user.id]
    );
    if (existing.length) {
      return res.status(400).json({
        error: existing[0].status === 'approved'
          ? 'KYC already approved'
          : 'KYC already submitted and under review',
        code: existing[0].status === 'approved' ? 'ALREADY_APPROVED' : 'ALREADY_SUBMITTED',
      });
    }

    // ── Insert submission ─────────────────────────────────────
    const { rows } = await query(
      `INSERT INTO kyc_submissions
         (user_id, full_name, id_type, phone, kyc_data_hash, aadhaar_hash, pan_hash, doc_ipfs_hash, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
       RETURNING id`,
      [req.user.id, fullName, idType, phone || null, kycDataHash, aadhaarHash || null, panHash || null, docIpfsHash]
    );

    // ── Update user status to submitted ──────────────────────
    await query(
      `UPDATE users SET
         kyc_status         = 'submitted',
         full_name          = $1,
         kyc_submission_id  = $2,
         kyc_submitted_at   = NOW(),
         updated_at         = NOW()
       WHERE id = $3`,
      [fullName, rows[0].id, req.user.id]
    );

    // ── Email user: submission received ──────────────────────
    try {
      await sendEmail({
        to:      req.user.email,
        subject: 'EtherTrack — KYC Submission Received',
        html: `
          <div style="font-family:monospace;background:#080c0a;color:#f0fdf4;padding:32px;border-radius:12px;">
            <h2 style="color:#22c55e;">KYC Submission Received ✅</h2>
            <p>Hi ${fullName},</p>
            <p>We've received your KYC submission. Our compliance team will review your details within <strong>1–2 business days</strong>.</p>
            <p style="color:#86efac88;">Submission ID: ${rows[0].id}</p>
            <p>You'll receive another email once your KYC is approved and your account is fully activated.</p>
            <p style="color:#4ade8044;font-size:12px;margin-top:24px;">EtherTrack · Carbon Credit Exchange · Ethereum Sepolia</p>
          </div>
        `,
      });
    } catch (emailErr) {
      console.warn('KYC submission email failed:', emailErr.message);
    }

    res.json({
      message:    'KYC submitted successfully',
      status:     'submitted',
      submission: rows[0].id,
    });

  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'duplicate_kyc', message: 'Duplicate KYC credentials.' });
    }
    console.error('KYC submit error:', e);
    res.status(500).json({ error: 'KYC submission failed' });
  }
});

// ── GET /api/kyc/status — get current user KYC status ────────────
router.get('/status', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT s.id, s.status, s.submitted_at, s.reviewed_at, s.rejection_reason
       FROM kyc_submissions s
       WHERE s.user_id = $1
       ORDER BY s.submitted_at DESC LIMIT 1`,
      [req.user.id]
    );
    res.json({
      kycStatus:    req.user.kyc_status,
      kycVerified:  !!req.user.kyc_verified,
      submission:   rows[0] || null,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch KYC status' });
  }
});

// ── GET /api/kyc/pending — admin: list pending submissions ────────
router.get('/pending', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT s.*, u.email, u.wallet_address
       FROM kyc_submissions s
       JOIN users u ON u.id = s.user_id
       WHERE s.status = 'pending'
       ORDER BY s.submitted_at ASC`
    );
    res.json({ submissions: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch pending KYC' });
  }
});

// ── POST /api/kyc/:id/approve — admin: approve KYC ───────────────
router.post('/:id/approve', authenticate, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: sub } = await query(
      'SELECT * FROM kyc_submissions WHERE id = $1', [id]
    );
    if (!sub.length) return res.status(404).json({ error: 'Submission not found' });
    if (sub[0].status !== 'pending') return res.status(400).json({ error: 'Already reviewed' });

    // ── Update submission ─────────────────────────────────────
    await query(
      `UPDATE kyc_submissions SET status='approved', reviewed_at=NOW(), reviewed_by=$1 WHERE id=$2`,
      [req.user.id, id]
    );

    // ── Update user ───────────────────────────────────────────
    await query(
      `UPDATE users SET
         kyc_status       = 'verified',
         kyc_verified     = TRUE,
         kyc_verified_at  = NOW(),
         kyc_aadhaar_hash = COALESCE($1, kyc_aadhaar_hash),
         kyc_pan_hash     = COALESCE($2, kyc_pan_hash),
         kyc_data_hash    = $3,
         updated_at       = NOW()
       WHERE id = $4`,
      [sub[0].aadhaar_hash, sub[0].pan_hash, sub[0].kyc_data_hash, sub[0].user_id]
    );

    // ── Get user email for notification ──────────────────────
    const { rows: usr } = await query('SELECT email, full_name FROM users WHERE id=$1', [sub[0].user_id]);

    // ── Email user: approved ──────────────────────────────────
    try {
      await sendEmail({
        to:      usr[0].email,
        subject: 'EtherTrack — KYC Approved 🎉',
        html: `
          <div style="font-family:monospace;background:#080c0a;color:#f0fdf4;padding:32px;border-radius:12px;">
            <h2 style="color:#22c55e;">KYC Approved ✅</h2>
            <p>Hi ${usr[0].full_name},</p>
            <p>Your KYC has been <strong style="color:#22c55e;">approved</strong>! Your account is now fully activated.</p>
            <p>You can now:</p>
            <ul style="color:#86efac88;">
              <li>List and trade carbon credits</li>
              <li>Track emissions</li>
              <li>Manage your portfolio</li>
            </ul>
            <p>Log in to get started → <a href="${process.env.FRONTEND_URL}/dashboard" style="color:#22c55e;">EtherTrack Dashboard</a></p>
            <p style="color:#4ade8044;font-size:12px;margin-top:24px;">EtherTrack · Carbon Credit Exchange</p>
          </div>
        `,
      });
    } catch (emailErr) {
      console.warn('KYC approval email failed:', emailErr.message);
    }

    res.json({ message: 'KYC approved', userId: sub[0].user_id });
  } catch (e) {
    console.error('KYC approve error:', e);
    res.status(500).json({ error: 'Approval failed' });
  }
});

// ── POST /api/kyc/:id/reject — admin: reject KYC ─────────────────
router.post('/:id/reject', authenticate, requireRole('admin'), async (req, res) => {
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
    try {
      await sendEmail({
        to:      usr[0].email,
        subject: 'EtherTrack — KYC Requires Resubmission',
        html: `
          <div style="font-family:monospace;background:#080c0a;color:#f0fdf4;padding:32px;border-radius:12px;">
            <h2 style="color:#f87171;">KYC Resubmission Required</h2>
            <p>Hi ${usr[0].full_name},</p>
            <p>Your KYC submission requires resubmission. Reason:</p>
            <p style="color:#f87171;padding:12px;background:#1a0a0a;border-radius:6px;">${reason}</p>
            <p>Please log in and resubmit your KYC with the correct information.</p>
            <p style="color:#4ade8044;font-size:12px;margin-top:24px;">EtherTrack · Carbon Credit Exchange</p>
          </div>
        `,
      });
    } catch {}

    res.json({ message: 'KYC rejected' });
  } catch (e) {
    console.error('KYC reject error:', e);
    res.status(500).json({ error: 'Rejection failed' });
  }
});

module.exports = router;