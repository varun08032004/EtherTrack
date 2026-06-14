// routes/auth.js — EtherTrack
// ─────────────────────────────────────────────────────────────────
// SECURITY FIXES APPLIED (v4):
// [FIX-14] /register — now creates user in Firebase Console too via
//          admin.auth().createUser(). Firebase failure is non-blocking.
//          firebase_uid and provider='email' saved to public.users.
// [FIX-15] /verify-email — marks emailVerified=true in Firebase after
//          OTP verification succeeds.
// ─────────────────────────────────────────────────────────────────

'use strict';

const router  = require('express').Router();
const jwt     = require('jsonwebtoken');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

let bcrypt;
try {
  bcrypt = require('bcrypt');
} catch {
  bcrypt = require('bcryptjs');
  console.warn('[auth] native bcrypt not found — using bcryptjs (blocking). Run: npm install bcrypt');
}

const { safeQuery, withTransaction } = require('../db/pool');
const { generateOTP, sendVerificationEmail, sendWelcomeEmail } = require('../services/email');
const { authenticate, optionalAuth } = require('../middleware/auth');
const admin = require('../lib/firebaseAdmin');

const twoFA = require('./auth2fa');
const { setAuthCookies, clearAuthCookies } = require('./auth2fa');
router.use('/2fa', twoFA);

const escHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

const MIME_TO_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/avatars');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = MIME_TO_EXT[file.mimetype] || '.jpg';
    cb(null, `avatar_${req.user.id}_${Date.now()}${ext}`);
  },
});
const avatarUpload = multer({
  storage: avatarStorage,
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (MIME_TO_EXT[file.mimetype]) cb(null, true);
    else cb(new Error('Only JPG, PNG, or WebP allowed'));
  },
});

const generateTokens = (userId) => ({
  accessToken:  jwt.sign({ userId }, process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }),
  refreshToken: jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }),
});

const logActivity = async (userId, action, meta = {}, ipHint = null) => {
  try {
    await safeQuery(
      `INSERT INTO profile_activity_log (user_id, action, meta, ip_hint)
       VALUES ($1, $2, $3, $4)`,
      [userId, action, JSON.stringify(meta), ipHint]
    );
  } catch (e) {
    console.warn('[logActivity] failed:', e.message);
  }
};

const makeEmailLimiter = (max, windowMs) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders:   false,
    keyGenerator:    (req) => (req.body?.email || '').toLowerCase() || ipKeyGenerator(req),
    message: { error: 'Too many attempts. Please wait before trying again.' },
  });

/* ─────────────────────────────────────────────────────────────────
   REGISTER
───────────────────────────────────────────────────────────────── */
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('fullName').trim().notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, password, fullName, companyName } = req.body;
  try {
    const existing = await safeQuery('SELECT id FROM users WHERE email=$1', [email]);
    if (existing.rows.length) return res.status(409).json({ error: 'Email already registered' });

    const ROUNDS       = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const passwordHash = await bcrypt.hash(password, ROUNDS);
    const otp          = generateOTP();
    const otpHash      = await bcrypt.hash(otp, 8);
    const otpExpires   = new Date(Date.now() + 10 * 60 * 1000);

    // ── [FIX-14] Create user in Firebase Console ──────────────────
    let firebaseUid = null;
    try {
      const firebaseUser = await admin.auth().createUser({
        email,
        password,
        displayName:   fullName,
        emailVerified: false,
      });
      firebaseUid = firebaseUser.uid;
      console.log('[register] Firebase user created:', firebaseUid);
    } catch (firebaseErr) {
      // Non-blocking — registration continues even if Firebase fails
      console.warn('[register] Firebase user creation failed:', firebaseErr.message);
    }

    const { rows } = await safeQuery(
      `INSERT INTO users
         (email, password_hash, full_name, company_name, email_otp, email_otp_expires,
          otp_attempts, firebase_uid, provider)
       VALUES ($1,$2,$3,$4,$5,$6,0,$7,'email')
       RETURNING id, email, full_name, role`,
      [email, passwordHash, fullName, companyName || null, otpHash, otpExpires, firebaseUid]
    );

    sendVerificationEmail(email, otp, fullName).catch(e =>
      console.error('[register] verification email failed:', e.message)
    );

    res.status(201).json({
      message: 'Account created. Check your email for the OTP.',
      userId:  rows[0].id,
    });
  } catch (e) {
    const isDev = process.env.NODE_ENV !== 'production';
    console.error('[register]', isDev ? e : e.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   RESEND OTP
───────────────────────────────────────────────────────────────── */
router.post('/resend-otp',
  makeEmailLimiter(3, 60 * 60 * 1000),
  [body('email').isEmail().normalizeEmail()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email } = req.body;
    try {
      const { rows } = await safeQuery(
        'SELECT id, full_name, email_verified FROM users WHERE email=$1', [email]
      );
      if (!rows.length || rows[0].email_verified) {
        return res.json({ message: 'If that email is unverified, a new OTP has been sent.' });
      }

      const user    = rows[0];
      const otp     = generateOTP();
      const otpHash = await bcrypt.hash(otp, 8);
      const expires = new Date(Date.now() + 10 * 60 * 1000);

      await safeQuery(
        `UPDATE users
         SET email_otp=$1, email_otp_expires=$2, otp_attempts=0, updated_at=NOW()
         WHERE id=$3`,
        [otpHash, expires, user.id]
      );

      sendVerificationEmail(email, otp, user.full_name).catch(e =>
        console.error('[resend-otp] email failed:', e.message)
      );

      res.json({ message: 'If that email is unverified, a new OTP has been sent.' });
    } catch (e) {
      console.error('[resend-otp]', e.message);
      res.status(500).json({ error: 'Failed to resend OTP' });
    }
  }
);

/* ─────────────────────────────────────────────────────────────────
   VERIFY EMAIL
───────────────────────────────────────────────────────────────── */
router.post('/verify-email',
  makeEmailLimiter(5, 10 * 60 * 1000),
  [
    body('email').isEmail().normalizeEmail(),
    body('otp').isLength({ min: 6, max: 6 }).isNumeric(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, otp } = req.body;
    try {
      const { rows } = await safeQuery(
        `SELECT id, email_otp, email_otp_expires, full_name, otp_attempts, firebase_uid
         FROM users WHERE email=$1`,
        [email]
      );
      if (!rows.length) return res.status(404).json({ error: 'User not found' });

      const user = rows[0];

      if ((user.otp_attempts || 0) >= 5) {
        await safeQuery(
          'UPDATE users SET email_otp=NULL, email_otp_expires=NULL WHERE id=$1',
          [user.id]
        );
        return res.status(429).json({
          error: 'Too many failed attempts. Please request a new OTP.',
        });
      }

      if (!user.email_otp) {
        return res.status(400).json({ error: 'No OTP found. Please request a new one.' });
      }
      if (new Date() > new Date(user.email_otp_expires)) {
        return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
      }

      const otpValid = await bcrypt.compare(otp, user.email_otp);
      if (!otpValid) {
        await safeQuery(
          'UPDATE users SET otp_attempts=otp_attempts+1 WHERE id=$1',
          [user.id]
        );
        return res.status(400).json({ error: 'Invalid OTP' });
      }

      await safeQuery(
        `UPDATE users
         SET email_verified=TRUE, email_otp=NULL, email_otp_expires=NULL,
             otp_attempts=0, updated_at=NOW()
         WHERE id=$1`,
        [user.id]
      );

      // ── [FIX-15] Sync email verified status to Firebase ───────────
      if (user.firebase_uid) {
        try {
          await admin.auth().updateUser(user.firebase_uid, { emailVerified: true });
          console.log('[verify-email] Firebase emailVerified synced:', user.firebase_uid);
        } catch (firebaseErr) {
          console.warn('[verify-email] Firebase sync failed:', firebaseErr.message);
        }
      }

      sendWelcomeEmail(email, user.full_name).catch(e =>
        console.error('[verify-email] welcome email failed:', e.message)
      );

      const tokens = generateTokens(user.id);
      await safeQuery(
        `INSERT INTO refresh_tokens (user_id, token, expires_at)
         VALUES ($1, $2, NOW()+INTERVAL '7 days')`,
        [user.id, hashToken(tokens.refreshToken)]
      );

      setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
      res.json({ message: 'Email verified. You are now logged in.' });
    } catch (e) {
      console.error('[verify-email]', e.message);
      res.status(500).json({ error: 'Verification failed' });
    }
  }
);

/* ─────────────────────────────────────────────────────────────────
   LOGIN — with 2FA support
───────────────────────────────────────────────────────────────── */
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, password } = req.body;
  try {
    const { rows } = await safeQuery(
      `SELECT id, email, password_hash, full_name, company_name, role,
              wallet_address, kyc_status, kyc_verified, email_verified, is_active,
              subscription_plan, plan_selected, subscription_renewal_date,
              subscription_cycle, inr_balance, two_fa_enabled, provider
       FROM users WHERE email=$1`,
      [email]
    );

    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const user = rows[0];

    if (!user.is_active) return res.status(403).json({ error: 'Account disabled' });

    if (!user.password_hash || user.password_hash.startsWith('firebase:')) {
      return res.status(401).json({
        error: 'This account was created with Google or Facebook. Please use the social login button.',
        code:  'USE_SOCIAL_LOGIN',
      });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    if (!user.email_verified) {
      return res.status(403).json({
        error: 'Email not verified. Check your inbox for the verification code.',
        code:  'EMAIL_NOT_VERIFIED',
      });
    }

    await safeQuery('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);

    if (user.two_fa_enabled) {
      const tempToken = jwt.sign(
        { userId: user.id, type: '2fa_pending' },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
      );
      return res.json({ requires2FA: true, tempToken });
    }

    const tokens = generateTokens(user.id);
    await safeQuery(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW()+INTERVAL '7 days')`,
      [user.id, hashToken(tokens.refreshToken)]
    );

    const ua = req.headers['user-agent'] || '';
    await safeQuery(
      `INSERT INTO user_sessions (user_id, browser, os, device_type, ip_address, is_current)
       VALUES ($1, $2, $3, $4, $5, TRUE)`,
      [user.id, ua.slice(0, 200), 'Unknown', 'desktop', req.ip || null]
    ).catch(() => {});

    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    res.json({
      user: {
        id:                        user.id,
        email:                     user.email,
        full_name:                 user.full_name,
        company_name:              user.company_name,
        role:                      user.role,
        wallet_address:            user.wallet_address,
        kyc_verified:              !!(user.kyc_verified || user.kyc_status === 'verified'),
        subscription_plan:         user.subscription_plan         || 'free',
        plan_selected:             !!user.plan_selected,
        subscription_renewal_date: user.subscription_renewal_date || null,
        subscription_cycle:        user.subscription_cycle        || 'monthly',
        inr_balance:               (user.inr_balance || '0').toString(),
      },
    });
  } catch (e) {
    const isDev = process.env.NODE_ENV !== 'production';
    console.error('[login]', isDev ? e : e.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   REFRESH TOKEN
───────────────────────────────────────────────────────────────── */
router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.et_refresh || req.body?.refreshToken;
  if (!refreshToken) {
    return res.status(400).json({ error: 'No refresh token', code: 'NO_REFRESH' });
  }

  try {
    let payload;
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const { rows } = await safeQuery(
      `SELECT id FROM refresh_tokens
       WHERE token=$1 AND user_id=$2 AND expires_at>NOW() AND revoked=FALSE`,
      [hashToken(refreshToken), payload.userId]
    );
    if (!rows.length) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Refresh token revoked or expired' });
    }

    await safeQuery(
      'UPDATE refresh_tokens SET revoked=TRUE WHERE token=$1',
      [hashToken(refreshToken)]
    );

    const tokens = generateTokens(payload.userId);
    await safeQuery(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW()+INTERVAL '7 days')`,
      [payload.userId, hashToken(tokens.refreshToken)]
    );

    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    res.json({ message: 'Tokens refreshed' });
  } catch (e) {
    console.error('[refresh]', e.message);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   LOGOUT
───────────────────────────────────────────────────────────────── */
router.post('/logout', optionalAuth, async (req, res) => {
  try {
    const refreshToken = req.cookies?.et_refresh || req.body?.refreshToken;
    if (refreshToken) {
      await safeQuery(
        `UPDATE refresh_tokens SET revoked=TRUE
         WHERE token=$1 ${req.user ? 'AND user_id=$2' : ''}`,
        req.user ? [hashToken(refreshToken), req.user.id] : [hashToken(refreshToken)]
      ).catch(() => {});
    }
    if (req.user) {
      await safeQuery(
        'UPDATE user_sessions SET is_current=FALSE WHERE user_id=$1 AND is_current=TRUE',
        [req.user.id]
      ).catch(() => {});
    }
  } catch {}
  clearAuthCookies(res);
  res.json({ message: 'Logged out' });
});

/* ─────────────────────────────────────────────────────────────────
   FIREBASE SYNC
───────────────────────────────────────────────────────────────── */
router.post('/firebase-sync', async (req, res) => {
  console.log('[firebase-sync] auth header:', req.headers.authorization?.substring(0, 50) || 'MISSING');
  console.log('[firebase-sync] origin:', req.headers.origin);

  const idToken = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.split(' ')[1]
    : null;

  if (!idToken) return res.status(401).json({ error: 'Firebase ID token required' });

  let decoded;
  try {
    decoded = await Promise.race([
      admin.auth().verifyIdToken(idToken),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Firebase verification timeout')), 5000)
      ),
    ]);
  } catch (e) {
    console.error('[firebase-sync] token verification failed:', e.message);
    return res.status(401).json({ error: 'Invalid or expired Firebase token' });
  }

  const firebaseUid   = decoded.uid;
  const email         = decoded.email;
  const emailVerified = decoded.email_verified ?? false;
  const providerRaw   = decoded.firebase?.sign_in_provider || 'password';
  const provider      = providerRaw === 'google.com'   ? 'google'
                      : providerRaw === 'facebook.com' ? 'facebook'
                      : 'email';

  if (!email) return res.status(400).json({ error: 'Token has no email claim' });

  const rawName  = req.body?.fullName || decoded.name || email.split('@')[0];
  const fullName = rawName.replace(/[<>"'&]/g, '').trim().slice(0, 100);

  try {
    const result = await withTransaction(async (client) => {
      let { rows } = await client.query(
        `SELECT id, email, full_name, role, wallet_address, kyc_status, kyc_verified,
                subscription_plan, plan_selected, subscription_renewal_date,
                subscription_cycle, inr_balance
         FROM users WHERE email = $1`,
        [email]
      );
      let user = rows[0];

      if (!user) {
        const { rows: newUser } = await client.query(
          `INSERT INTO users
             (email, password_hash, full_name, firebase_uid, provider, email_verified)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, email, full_name, role, wallet_address, kyc_status, kyc_verified,
                     subscription_plan, plan_selected, subscription_renewal_date,
                     subscription_cycle, inr_balance`,
          [email, `firebase:${firebaseUid}`, fullName, firebaseUid, provider, emailVerified]
        );
        user = newUser[0];
      } else {
        await client.query(
          `UPDATE users SET
             firebase_uid   = COALESCE(firebase_uid, $1),
             provider       = CASE WHEN firebase_uid IS NULL THEN $2 ELSE provider END,
             email_verified = (email_verified OR $3),
             full_name      = COALESCE(NULLIF($4, ''), full_name),
             last_login     = NOW(),
             updated_at     = NOW()
           WHERE id = $5`,
          [firebaseUid, provider, emailVerified, fullName, user.id]
        );
      }

      const tokens = generateTokens(user.id);
      await client.query(
        `INSERT INTO refresh_tokens (user_id, token, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
        [user.id, hashToken(tokens.refreshToken)]
      );

      return { user, tokens };
    });

    setAuthCookies(res, result.tokens.accessToken, result.tokens.refreshToken);
    res.json({
      user: {
        id:                        result.user.id,
        email:                     result.user.email,
        full_name:                 result.user.full_name,
        role:                      result.user.role,
        wallet_address:            result.user.wallet_address,
        kyc_verified:              !!(result.user.kyc_verified || result.user.kyc_status === 'verified'),
        subscription_plan:         result.user.subscription_plan         || 'free',
        plan_selected:             !!result.user.plan_selected,
        subscription_renewal_date: result.user.subscription_renewal_date || null,
        subscription_cycle:        result.user.subscription_cycle        || 'monthly',
        inr_balance:               (result.user.inr_balance || '0').toString(),
      },
    });
  } catch (e) {
    console.error('[firebase-sync]', e.message);
    res.status(500).json({ error: 'Sync failed' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   CURRENT USER  /me
───────────────────────────────────────────────────────────────── */
router.get('/me', authenticate, async (req, res) => {
  try {
    const { rows } = await safeQuery(
      `SELECT
         id, email, full_name, company_name, role,
         wallet_address, kyc_status, kyc_verified, email_verified, last_login,
         phone, bio, timezone, avatar_url, notification_prefs,
         company_gstin, company_pan, company_cin, industry_sector, company_type,
         subscription_plan, plan_selected, subscription_renewal_date,
         subscription_cycle, subscription_activated_at,
         inr_balance, inr_balance_locked,
         two_fa_enabled
       FROM users WHERE id=$1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    const u = rows[0];
    const daysLeft = u.subscription_renewal_date
      ? Math.ceil((new Date(u.subscription_renewal_date) - new Date()) / (1000 * 60 * 60 * 24))
      : null;

    res.json({
      ...u,
      kyc_verified:              !!(u.kyc_verified || u.kyc_status === 'verified'),
      plan_selected:             !!u.plan_selected,
      subscription_plan:         u.subscription_plan         || 'free',
      subscription_cycle:        u.subscription_cycle        || 'monthly',
      subscription_renewal_date: u.subscription_renewal_date || null,
      subscription_days_left:    daysLeft,
      inr_balance:               (u.inr_balance || '0').toString(),
      inr_balance_locked:        (u.inr_balance_locked || '0').toString(),
      two_fa_enabled:            !!u.two_fa_enabled,
    });
  } catch (e) {
    console.error('[/me]', e.message);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   UPDATE PROFILE
───────────────────────────────────────────────────────────────── */
router.patch('/profile', authenticate, [
  body('full_name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
  body('email').optional().isEmail().normalizeEmail(),
  body('phone').optional().matches(/^\+?[\d\s\-()\u2013]{7,16}$/).withMessage('Invalid phone number'),
  body('bio').optional().isLength({ max: 280 }).withMessage('Bio must be under 280 characters'),
  body('avatar_url').optional().custom((val) => {
    if (!val) return true;
    try {
      const u = new URL(val);
      const allowedHosts = (process.env.AVATAR_ALLOWED_HOSTS || '').split(',').map(h => h.trim()).filter(Boolean);
      if (u.protocol !== 'https:') throw new Error('Must be HTTPS');
      if (allowedHosts.length && !allowedHosts.includes(u.hostname)) {
        throw new Error('Avatar URL must point to an allowed domain');
      }
      return true;
    } catch (e) {
      throw new Error(e.message || 'Invalid avatar URL');
    }
  }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { full_name, email, company_name, phone, bio, timezone, avatar_url } = req.body;

  try {
    const emailChanging = email && email !== req.user.email;

    if (emailChanging) {
      const { rows: existing } = await safeQuery(
        'SELECT id FROM users WHERE email=$1 AND id!=$2', [email, req.user.id]
      );
      if (existing.length) return res.status(409).json({ error: 'Email already in use' });
    }

    const { rows } = await safeQuery(
      `UPDATE users SET
        full_name    = COALESCE($1, full_name),
        email        = COALESCE($2, email),
        company_name = COALESCE($3, company_name),
        phone        = COALESCE($4, phone),
        bio          = COALESCE($5, bio),
        timezone     = COALESCE($6, timezone),
        avatar_url   = COALESCE($7, avatar_url),
        email_verified = CASE WHEN $2 IS NOT NULL AND $2 != email THEN FALSE ELSE email_verified END,
        updated_at   = NOW()
       WHERE id = $8
       RETURNING id, email, full_name, company_name, role,
                 wallet_address, kyc_verified, kyc_status,
                 phone, bio, timezone, avatar_url, notification_prefs`,
      [full_name || null, email || null, company_name || null, phone || null,
       bio || null, timezone || null, avatar_url || null, req.user.id]
    );

    if (emailChanging) {
      const otp     = generateOTP();
      const otpHash = await bcrypt.hash(otp, 8);
      const expires = new Date(Date.now() + 10 * 60 * 1000);
      await safeQuery(
        `UPDATE users SET email_otp=$1, email_otp_expires=$2, otp_attempts=0 WHERE id=$3`,
        [otpHash, expires, req.user.id]
      );
      sendVerificationEmail(email, otp, rows[0].full_name).catch(e =>
        console.error('[profile] re-verification email failed:', e.message)
      );
    }

    await logActivity(req.user.id, 'PROFILE_UPDATED',
      { fields: Object.keys(req.body), emailChanged: emailChanging }, req.ip);

    res.json({
      user: {
        ...rows[0],
        kyc_verified: !!(rows[0].kyc_verified || rows[0].kyc_status === 'verified'),
      },
      ...(emailChanging && {
        message: 'Profile updated. A verification OTP has been sent to your new email address.',
        requiresEmailVerification: true,
      }),
    });
  } catch (e) {
    console.error('[profile update]', e.message);
    res.status(500).json({ error: 'Profile update failed' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   UPLOAD AVATAR
───────────────────────────────────────────────────────────────── */
router.post('/upload-avatar', authenticate, avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const baseUrl   = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
    const avatarUrl = `${baseUrl}/uploads/avatars/${req.file.filename}`;

    if (req.user.avatar_url) {
      try {
        const oldFile = req.user.avatar_url.split('/uploads/avatars/')[1];
        if (oldFile) {
          const oldPath = path.join(__dirname, '../uploads/avatars', oldFile);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
      } catch {}
    }

    await safeQuery(
      'UPDATE users SET avatar_url=$1, updated_at=NOW() WHERE id=$2',
      [avatarUrl, req.user.id]
    );
    res.json({ avatar_url: avatarUrl });
  } catch (e) {
    console.error('[upload-avatar]', e.message);
    res.status(500).json({
      error: process.env.NODE_ENV === 'production' ? 'Avatar upload failed' : e.message,
    });
  }
});

/* ─────────────────────────────────────────────────────────────────
   CHANGE PASSWORD
───────────────────────────────────────────────────────────────── */
router.post('/change-password', authenticate, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { currentPassword, newPassword } = req.body;
  try {
    const { rows } = await safeQuery(
      'SELECT password_hash FROM users WHERE id=$1', [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    const ROUNDS  = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const newHash = await bcrypt.hash(newPassword, ROUNDS);

    await safeQuery(
      'UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2',
      [newHash, req.user.id]
    );
    await safeQuery('UPDATE refresh_tokens SET revoked=TRUE WHERE user_id=$1', [req.user.id]);
    await safeQuery('DELETE FROM user_sessions WHERE user_id=$1', [req.user.id]);
    await logActivity(req.user.id, 'PASSWORD_CHANGED', {}, req.ip);

    res.json({ message: 'Password changed successfully. Please log in again on other devices.' });
  } catch (e) {
    console.error('[change-password]', e.message);
    res.status(500).json({ error: 'Password change failed' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   NOTIFICATION PREFERENCES
───────────────────────────────────────────────────────────────── */
router.patch('/notification-prefs', authenticate, async (req, res) => {
  const { notification_prefs } = req.body;
  if (!notification_prefs || typeof notification_prefs !== 'object') {
    return res.status(400).json({ error: 'notification_prefs object is required' });
  }
  try {
    await safeQuery(
      'UPDATE users SET notification_prefs=$1, updated_at=NOW() WHERE id=$2',
      [JSON.stringify(notification_prefs), req.user.id]
    );
    await logActivity(req.user.id, 'NOTIF_PREFS_UPDATED', {}, req.ip);
    res.json({ message: 'Notification preferences saved', notification_prefs });
  } catch (e) {
    console.error('[notif-prefs]', e.message);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   SESSIONS
───────────────────────────────────────────────────────────────── */
router.get('/sessions', authenticate, async (req, res) => {
  try {
    const { rows } = await safeQuery(
      `SELECT id, browser, os, device_type, ip_address, is_current, last_active_at, created_at
       FROM user_sessions WHERE user_id=$1 ORDER BY last_active_at DESC`,
      [req.user.id]
    );
    res.json({ sessions: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

router.delete('/sessions/:id', authenticate, async (req, res) => {
  const sessionId = parseInt(req.params.id, 10);
  if (isNaN(sessionId)) return res.status(400).json({ error: 'Invalid session id' });

  try {
    const { rows } = await safeQuery(
      'DELETE FROM user_sessions WHERE id=$1 AND user_id=$2 RETURNING id',
      [sessionId, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });
    await logActivity(req.user.id, 'SESSION_REVOKED', { session_id: sessionId }, req.ip);
    res.json({ message: 'Session revoked' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to revoke session' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   ACTIVITY LOG
───────────────────────────────────────────────────────────────── */
router.get('/activity-log', authenticate, async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  || '20', 10), 100);
  const offset = Math.max(parseInt(req.query.offset || '0',  10), 0);

  try {
    const { rows } = await safeQuery(
      `SELECT id, action, meta, ip_hint, created_at
       FROM profile_activity_log
       WHERE user_id=$1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );
    res.json({ log: rows, limit, offset });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch activity log' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   REQUEST ACCOUNT DELETION
───────────────────────────────────────────────────────────────── */
router.post('/request-deletion', authenticate, [
  body('reason').trim().notEmpty().withMessage('Reason is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { reason } = req.body;
  try {
    const { rows: existing } = await safeQuery(
      `SELECT id FROM account_deletion_requests WHERE user_id=$1 AND status='pending'`,
      [req.user.id]
    );
    if (existing.length) {
      return res.status(409).json({
        error: 'A deletion request is already pending for this account',
      });
    }
    await safeQuery(
      `INSERT INTO account_deletion_requests (user_id, email, reason) VALUES ($1, $2, $3)`,
      [req.user.id, req.user.email, reason]
    );
    await logActivity(req.user.id, 'DELETION_REQUESTED', { reason }, req.ip);
    res.json({
      message: 'Deletion request submitted. Your account will be permanently deleted within 72 hours per DPDP Act 2023 §13.',
    });
  } catch (e) {
    console.error('[request-deletion]', e.message);
    res.status(500).json({ error: 'Failed to submit deletion request' });
  }
});

module.exports = router;