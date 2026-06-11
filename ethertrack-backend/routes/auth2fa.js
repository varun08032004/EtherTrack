// routes/auth2fa.js — EtherTrack
// ─────────────────────────────────────────────────────────────────
// FIXES APPLIED (v3):
//
// [FIX-TOTP-1]  TOTP secrets encrypted at rest using AES-256-GCM
//               via lib/totpEncryption.js.
//               - setup2FA      → encrypts totp_secret_temp before storing
//               - verifySetup2FA → decrypts temp secret for verification,
//                                  encrypts permanent secret on activation
//               - validate2FA   → decrypts totp_secret for verification
//               - disable2FA    → decrypts before verifying, then NULLs
//
// All v2 fixes retained:
//   [FIX-1]  Hashed refresh tokens (SHA-256)
//   [FIX-2]  JWT_REFRESH_SECRET hard-fail
//   [FIX-3]  TOTP backup codes (8 codes, bcrypt hashed, consumed on use)
// ─────────────────────────────────────────────────────────────────
'use strict';

const speakeasy = require('speakeasy');
const QRCode    = require('qrcode');
const jwt       = require('jsonwebtoken');
const crypto    = require('crypto');

let bcrypt;
try { bcrypt = require('bcrypt'); }
catch { bcrypt = require('bcryptjs'); }

const { safeQuery: query } = require('../db/pool');
const { authenticate }     = require('../middleware/auth');

// [FIX-TOTP-1] Encryption helpers
const {
  encryptTotp,
  decryptTotp,
} = require('../lib/totpEncryption');

// Hard-fail on missing JWT_REFRESH_SECRET
if (!process.env.JWT_REFRESH_SECRET) {
  throw new Error('[auth2fa] FATAL: JWT_REFRESH_SECRET environment variable is not set');
}

// ── Refresh token hashing ─────────────────────────────────────────
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

// ── httpOnly cookie config ────────────────────────────────────────
const IS_PROD = process.env.NODE_ENV === 'production';

const COOKIE_ACCESS = {
  httpOnly: true,
  secure:   IS_PROD,
  sameSite: 'strict',
  maxAge:   15 * 60 * 1000,
  path:     '/',
};
const COOKIE_REFRESH = {
  httpOnly: true,
  secure:   IS_PROD,
  sameSite: 'strict',
  maxAge:   7 * 24 * 60 * 60 * 1000,
  path:     '/api/auth/refresh',
};

const setAuthCookies = (res, accessToken, refreshToken) => {
  res.cookie('et_access',  accessToken,  COOKIE_ACCESS);
  res.cookie('et_refresh', refreshToken, COOKIE_REFRESH);
};

const clearAuthCookies = (res) => {
  res.clearCookie('et_access',  { path: '/' });
  res.clearCookie('et_refresh', { path: '/api/auth/refresh' });
};

// ── POST /api/auth/2fa/setup ──────────────────────────────────────
const setup2FA = async (req, res) => {
  try {
    const secret = speakeasy.generateSecret({
      name:   `EtherTrack (${req.user.email})`,
      length: 32,
    });

    // [FIX-TOTP-1] Encrypt before storing — plaintext never touches the DB
    const encryptedTemp = encryptTotp(secret.base32);

    await query(
      `UPDATE users SET totp_secret_temp = $1, totp_secret_temp_encrypted = TRUE, updated_at = NOW()
       WHERE id = $2`,
      [encryptedTemp, req.user.id]
    );

    const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);

    // Return the plaintext base32 to the frontend for QR display
    // It is never stored in plaintext — only the encrypted form is persisted
    res.json({
      secret:      secret.base32,
      qrDataUrl,
      otpauthUrl:  secret.otpauth_url,
    });
  } catch (e) {
    console.error('[2fa/setup]', e.message);
    res.status(500).json({ error: '2FA setup failed' });
  }
};

// ── POST /api/auth/2fa/verify-setup ──────────────────────────────
const verifySetup2FA = async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'TOTP token required' });

  try {
    const { rows } = await query(
      'SELECT totp_secret_temp FROM users WHERE id = $1',
      [req.user.id]
    );
    const encryptedTemp = rows[0]?.totp_secret_temp;
    if (!encryptedTemp) return res.status(400).json({ error: 'Run /2fa/setup first' });

    // [FIX-TOTP-1] Decrypt temp secret for verification
    const plainSecret = decryptTotp(encryptedTemp);
    if (!plainSecret) return res.status(400).json({ error: 'Invalid 2FA setup state. Run /2fa/setup again.' });

    const valid = speakeasy.totp.verify({
      secret:   plainSecret,
      encoding: 'base32',
      token:    token.replace(/\s/g, ''),
      window:   1,
    });
    if (!valid) return res.status(400).json({ error: 'Invalid code. Try again.' });

    // Generate 8 backup codes
    const backupCodes  = Array.from({ length: 8 }, () => crypto.randomBytes(4).toString('hex'));
    const hashedCodes  = await Promise.all(backupCodes.map(c => bcrypt.hash(c, 8)));

    // [FIX-TOTP-1] Encrypt permanent secret before promoting from temp
    // (temp was already encrypted — we decrypt it and re-encrypt for the permanent column
    //  to ensure a fresh IV, making the two ciphertexts unlinkable)
    const encryptedPermanent = encryptTotp(plainSecret);

    await query(
      `UPDATE users
       SET totp_secret               = $1,
           totp_secret_encrypted     = TRUE,
           totp_secret_temp          = NULL,
           totp_secret_temp_encrypted = FALSE,
           two_fa_enabled            = TRUE,
           totp_backup_codes         = $2,
           updated_at                = NOW()
       WHERE id = $3`,
      [encryptedPermanent, JSON.stringify(hashedCodes), req.user.id]
    );

    await query(
      `INSERT INTO audit_log (user_id, action, entity, ip_address, created_at)
       VALUES ($1, '2FA_ENABLED', 'user', $2, NOW())`,
      [req.user.id, req.ip]
    ).catch(() => {});

    // Backup codes returned ONCE — user must save them
    res.json({
      success:     true,
      message:     '2FA activated',
      backupCodes, // plaintext, shown once, never stored
    });
  } catch (e) {
    console.error('[2fa/verify-setup]', e.message);
    res.status(500).json({ error: '2FA verification failed' });
  }
};

// ── POST /api/auth/2fa/validate ───────────────────────────────────
const validate2FA = async (req, res) => {
  const { tempToken, totpCode } = req.body;
  if (!tempToken || !totpCode) {
    return res.status(400).json({ error: 'tempToken and totpCode required' });
  }

  try {
    let payload;
    try {
      payload = jwt.verify(tempToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired session. Log in again.' });
    }
    if (payload.type !== '2fa_pending') {
      return res.status(400).json({ error: 'Invalid token type' });
    }

    const { rows } = await query(
      `SELECT id, email, totp_secret, two_fa_enabled, totp_backup_codes
       FROM users WHERE id = $1`,
      [payload.userId]
    );
    const user = rows[0];
    if (!user?.two_fa_enabled) {
      return res.status(400).json({ error: '2FA not enabled' });
    }

    // [FIX-TOTP-1] Decrypt stored secret before passing to speakeasy
    const plainSecret = decryptTotp(user.totp_secret);
    if (!plainSecret) {
      return res.status(500).json({ error: '2FA configuration error. Please contact support.' });
    }

    // Try TOTP first
    const totpValid = speakeasy.totp.verify({
      secret:   plainSecret,
      encoding: 'base32',
      token:    totpCode.replace(/\s/g, ''),
      window:   1,
    });

    // Try backup code if TOTP fails
    let usedBackup = false;
    if (!totpValid) {
      const storedHashes = JSON.parse(user.totp_backup_codes || '[]');
      let matchIndex = -1;

      for (let i = 0; i < storedHashes.length; i++) {
        const match = await bcrypt.compare(totpCode.replace(/\s/g, ''), storedHashes[i]);
        if (match) { matchIndex = i; break; }
      }

      if (matchIndex === -1) {
        return res.status(401).json({ error: 'Invalid 2FA code' });
      }

      // Consume the backup code
      storedHashes.splice(matchIndex, 1);
      await query(
        `UPDATE users SET totp_backup_codes = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(storedHashes), user.id]
      );
      usedBackup = true;
    }

    const accessToken  = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );
    const refreshToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
    );

    await query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [user.id, hashToken(refreshToken)]
    );

    await query(
      `INSERT INTO audit_log (user_id, action, entity, ip_address, created_at)
       VALUES ($1, '2FA_LOGIN_SUCCESS', 'user', $2, NOW())`,
      [user.id, req.ip]
    ).catch(() => {});

    setAuthCookies(res, accessToken, refreshToken);
    res.json({
      success:    true,
      usedBackup,
      ...(usedBackup && {
        warning: 'Backup code used. You have fewer backup codes remaining. Consider regenerating them.',
      }),
      user: { id: user.id, email: user.email },
    });
  } catch (e) {
    console.error('[2fa/validate]', e.message);
    res.status(500).json({ error: '2FA validation failed' });
  }
};

// ── POST /api/auth/2fa/disable ────────────────────────────────────
const disable2FA = async (req, res) => {
  const { totpCode } = req.body;
  if (!totpCode) return res.status(400).json({ error: 'TOTP code required' });

  try {
    const { rows } = await query(
      'SELECT totp_secret FROM users WHERE id = $1 AND two_fa_enabled = TRUE',
      [req.user.id]
    );
    if (!rows.length) return res.status(400).json({ error: '2FA is not enabled' });

    // [FIX-TOTP-1] Decrypt before passing to speakeasy
    const plainSecret = decryptTotp(rows[0].totp_secret);
    if (!plainSecret) {
      return res.status(500).json({ error: '2FA configuration error. Please contact support.' });
    }

    const valid = speakeasy.totp.verify({
      secret:   plainSecret,
      encoding: 'base32',
      token:    totpCode.replace(/\s/g, ''),
      window:   1,
    });
    if (!valid) return res.status(401).json({ error: 'Invalid 2FA code' });

    await query(
      `UPDATE users
       SET totp_secret                = NULL,
           totp_secret_encrypted      = FALSE,
           two_fa_enabled             = FALSE,
           totp_backup_codes          = NULL,
           totp_secret_temp           = NULL,
           totp_secret_temp_encrypted = FALSE,
           updated_at                 = NOW()
       WHERE id = $1`,
      [req.user.id]
    );

    await query(
      `INSERT INTO audit_log (user_id, action, entity, ip_address, created_at)
       VALUES ($1, '2FA_DISABLED', 'user', $2, NOW())`,
      [req.user.id, req.ip]
    ).catch(() => {});

    res.json({ success: true, message: '2FA disabled' });
  } catch (e) {
    console.error('[2fa/disable]', e.message);
    res.status(500).json({ error: 'Failed to disable 2FA' });
  }
};

// ── Router ────────────────────────────────────────────────────────
const router = require('express').Router();
router.post('/setup',        authenticate, setup2FA);
router.post('/verify-setup', authenticate, verifySetup2FA);
router.post('/validate',     validate2FA);
router.post('/disable',      authenticate, disable2FA);

module.exports = router;
module.exports.setAuthCookies   = setAuthCookies;
module.exports.clearAuthCookies = clearAuthCookies;