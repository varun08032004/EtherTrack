// middleware/auth.js — Production-Ready (v4)
// ─────────────────────────────────────────────────────────────────
// Changes vs v3:
//
// [CORP-1]  corporate_managed added to both SELECT statements
//           (authenticate + optionalAuth) so req.user.corporate_managed
//           is always available for downstream checks.
//
// [CORP-2]  subscription_plan + subscription_renewal_date added to
//           SELECT so downstream middleware can check plan without
//           an extra DB hit.
//
// All other logic unchanged from the v3 you provided.
// ─────────────────────────────────────────────────────────────────
'use strict';

const jwt = require('jsonwebtoken');
const { safeQuery: query } = require('../db/pool');

// ── Firebase Admin (optional) ─────────────────────────────────────
let firebaseAdmin = null;
if (process.env.FIREBASE_PROJECT_ID) {
  try {
    firebaseAdmin = require('firebase-admin');
    if (!firebaseAdmin.apps.length) {
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.applicationDefault(),
        projectId:  process.env.FIREBASE_PROJECT_ID,
      });
    }
    console.log('[auth] ✅ Firebase Admin initialised');
  } catch (e) {
    console.warn('[auth] firebase-admin not available, using custom JWT only:', e.message);
    firebaseAdmin = null;
  }
}

// ── Redis user cache (optional) ───────────────────────────────────
let redis = null;
const USER_CACHE_TTL = 60; // seconds

;(async () => {
  if (!process.env.REDIS_URL) {
    console.warn('[auth] REDIS_URL not set — user cache disabled (DB hit on every request)');
    return;
  }
  try {
    const { createClient } = require('redis');
    redis = createClient({ url: process.env.REDIS_URL });
    redis.on('error', (e) => {
      console.warn('[auth] Redis error:', e.message, '— falling back to DB');
      redis = null;
    });
    await redis.connect();
    console.log('[auth] ✅ Redis user cache connected');
  } catch (e) {
    console.warn('[auth] Redis unavailable — DB-only auth:', e.message);
    redis = null;
  }
})();

// ── Cache helpers ─────────────────────────────────────────────────
const getCachedUser = async (userId) => {
  if (!redis) return null;
  try {
    const raw = await redis.get(`user:${userId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const setCachedUser = async (userId, user) => {
  if (!redis) return;
  try {
    await redis.setEx(`user:${userId}`, USER_CACHE_TTL, JSON.stringify(user));
  } catch {}
};

const invalidateUserCache = async (userId) => {
  if (!redis) return;
  try {
    await redis.del(`user:${userId}`);
  } catch {}
};

// ── Token verification ────────────────────────────────────────────
async function verifyToken(token) {
  if (firebaseAdmin && token.split('.').length === 3) {
    try {
      const decoded = await firebaseAdmin.auth().verifyIdToken(token);
      return { userId: decoded.uid, email: decoded.email, source: 'firebase' };
    } catch (fbErr) {
      if (fbErr.code !== 'auth/argument-error') throw fbErr;
    }
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  return jwt.verify(token, secret, { algorithms: ['HS256'] });
}

// ── Shared user SELECT ────────────────────────────────────────────
// [CORP-1] corporate_managed added
// [CORP-2] subscription_plan + subscription_renewal_date added
// Single place to update if schema changes again.
const USER_SELECT = `
  SELECT id, email, full_name, role, wallet_address,
         kyc_status, kyc_verified, inr_balance,
         is_active, frozen, freeze_reason,
         avatar_url,
         corporate_managed,
         subscription_plan,
         subscription_cycle,
         subscription_renewal_date
  FROM users
  WHERE id::text = $1
     OR firebase_uid = $1
  LIMIT 1
`;

// ── authenticate ──────────────────────────────────────────────────
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token =
      (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null) ||
      req.cookies?.et_access ||
      null;

    if (!token) {
      return res.status(401).json({ error: 'No token provided', code: 'NO_TOKEN' });
    }

    let decoded;
    try {
      decoded = await verifyToken(token);
    } catch (e) {
      const isExpired =
        e.name === 'TokenExpiredError' || e.code === 'auth/id-token-expired';
      return res.status(401).json({
        error:   isExpired ? 'Token expired' : 'Invalid token',
        code:    isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
        expired: isExpired,
      });
    }

    if (decoded.type === '2fa_pending') {
      return res.status(401).json({ error: '2FA not completed', code: 'TWO_FA_REQUIRED' });
    }

    const userId = decoded.userId || decoded.uid || decoded.sub || decoded.id || null;
    if (!userId) {
      return res.status(401).json({ error: 'Invalid token payload', code: 'INVALID_TOKEN' });
    }

    let user = await getCachedUser(userId);

    if (!user) {
      const { rows } = await query(USER_SELECT, [String(userId)]);
      if (!rows.length) {
        return res.status(401).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      }
      user = rows[0];
      await setCachedUser(userId, user);
    }

    if (!user.is_active || user.frozen) {
      await invalidateUserCache(userId);
      return res.status(403).json({
        error: user.frozen
          ? (user.freeze_reason || 'Account frozen')
          : 'Account is deactivated',
        code: 'ACCOUNT_DISABLED',
      });
    }

    req.user  = user;
    req.token = token;

    // Fire-and-forget session activity update
    query(
      `UPDATE user_sessions SET last_active_at = NOW()
       WHERE user_id = $1 AND is_current = TRUE`,
      [user.id]
    ).catch(() => {});

    next();
  } catch (e) {
    console.error('[authenticate]', e.message);
    return res.status(500).json({ error: 'Authentication check failed', code: 'AUTH_ERROR' });
  }
};

// ── requireKYC ───────────────────────────────────────────────────
const requireKYC = (req, res, next) => {
  const u = req.user;
  if (!u?.kyc_verified && u?.kyc_status !== 'verified') {
    return res.status(403).json({
      error: 'KYC verification required to perform this action',
      code:  'KYC_REQUIRED',
    });
  }
  next();
};

// ── requireWallet ─────────────────────────────────────────────────
const requireWallet = (req, res, next) => {
  if (!req.user?.wallet_address) {
    return res.status(403).json({
      error: 'Wallet not bound to account',
      code:  'WALLET_REQUIRED',
    });
  }
  next();
};

// ── requireRole ───────────────────────────────────────────────────
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
  }
  next();
};

// ── optionalAuth ──────────────────────────────────────────────────
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token =
      (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null) ||
      req.cookies?.et_access ||
      null;

    if (!token) return next();

    let decoded;
    try {
      decoded = await verifyToken(token);
    } catch {
      return next();
    }

    if (!decoded || decoded.type === '2fa_pending') return next();

    const userId = decoded.userId || decoded.uid || decoded.sub || decoded.id || null;
    if (!userId) return next();

    let user = await getCachedUser(userId);
    if (!user) {
      const { rows } = await query(USER_SELECT, [String(userId)]);
      if (rows.length) {
        user = rows[0];
        await setCachedUser(userId, user);
      }
    }

    if (user && user.is_active && !user.frozen) {
      req.user  = user;
      req.token = token;
    }
  } catch {
    // Silent — route is public
  }
  next();
};

// ── Convenience alias ─────────────────────────────────────────────
const requireAdmin = requireRole('admin');

module.exports = {
  authenticate,
  requireKYC,
  requireWallet,
  requireRole,
  requireAdmin,
  optionalAuth,
  invalidateUserCache,
};