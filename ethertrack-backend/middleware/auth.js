const jwt = require('jsonwebtoken');
const { safeQuery: query } = require('../db/pool');

// ── Verify access token from httpOnly cookie ──────────────────────
const authenticate = async (req, res, next) => {
  try {
    const token = req.cookies?.et_access
      || (req.headers.authorization?.startsWith('Bearer ')
          ? req.headers.authorization.split(' ')[1]
          : null);

    if (!token) {
      return res.status(401).json({ error: 'No token provided', code: 'NO_TOKEN' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const { rows } = await query(
      `SELECT id, email, full_name, role, wallet_address,
              kyc_status, kyc_verified, is_active
       FROM users WHERE id = $1`,
      [decoded.userId]
    );

    if (!rows.length || !rows[0].is_active) {
      return res.status(401).json({ error: 'User not found or deactivated' });
    }

    req.user = rows[0];
    next();
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// ── Require KYC verified ──────────────────────────────────────────
const requireKYC = (req, res, next) => {
  if (!req.user.kyc_verified && req.user.kyc_status !== 'verified') {
    return res.status(403).json({ error: 'KYC verification required', code: 'KYC_REQUIRED' });
  }
  next();
};

// ── Require wallet bound ──────────────────────────────────────────
const requireWallet = (req, res, next) => {
  if (!req.user.wallet_address) {
    return res.status(403).json({ error: 'Wallet not bound to account', code: 'WALLET_REQUIRED' });
  }
  next();
};

// ── Require role ──────────────────────────────────────────────────
const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

// ── Optional auth (doesn't fail if no token) ─────────────────────
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.cookies?.et_access
      || (req.headers.authorization?.startsWith('Bearer ')
          ? req.headers.authorization.split(' ')[1]
          : null);
    if (!token) return next();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await query(
      `SELECT id, email, full_name, role, wallet_address,
              kyc_status, kyc_verified FROM users WHERE id = $1`,
      [decoded.userId]
    );
    if (rows.length) req.user = rows[0];
  } catch {}
  next();
};

module.exports = { authenticate, requireKYC, requireWallet, requireRole, optionalAuth };