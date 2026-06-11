// middleware/adminAuth2FA.js — TOTP 2FA for admin panel
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { safeQuery: query } = require('../db/pool');

// Generate a new TOTP secret for an admin user
const generateAdminTOTP = async (userId, email) => {
  const secret = speakeasy.generateSecret({
    name: `EtherTrack Admin (${email})`,
    issuer: 'EtherTrack',
    length: 32,
  });
  // Store the base32 secret in DB (encrypted ideally, but base32 here for simplicity)
  await query(
    `UPDATE users SET totp_secret=$1, totp_enabled=FALSE, updated_at=NOW() WHERE id=$2`,
    [secret.base32, userId]
  );
  const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
  return { secret: secret.base32, qrCodeUrl, otpauthUrl: secret.otpauth_url };
};

// Verify a TOTP token
const verifyTOTP = (secret, token) => {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: token.replace(/\s/g, ''),
    window: 2, // allow 2 steps drift (60 seconds)
  });
};

// Express middleware — require 2FA for admin routes
const require2FA = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { rows } = await query(
      `SELECT totp_secret, totp_enabled FROM users WHERE id=$1`, [req.user.id]
    );
    if (!rows.length) return res.status(403).json({ error: 'User not found' });
    // If 2FA is not set up yet, allow through but flag it
    if (!rows[0].totp_enabled || !rows[0].totp_secret) {
      req.totp2FARequired = true;
      return next();
    }
    // Check session for verified 2FA
    if (req.session?.totp2FAVerified === req.user.id) return next();
    return res.status(401).json({ error: '2FA_REQUIRED', message: 'Two-factor authentication required' });
  } catch (e) {
    console.error('2FA middleware error:', e.message);
    res.status(500).json({ error: '2FA check failed' });
  }
};

module.exports = { generateAdminTOTP, verifyTOTP, require2FA };