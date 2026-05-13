// routes/auth.js  —  EtherTrack
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { safeQuery, withTransaction } = require('../db/pool');
const { generateOTP, sendVerificationEmail, sendWelcomeEmail } = require('../services/email');
const { authenticate } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

// ── Cookie config ─────────────────────────────────────────────────
const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path:     '/',
};
const ACCESS_COOKIE_OPTS  = { ...COOKIE_OPTS, maxAge: 15 * 60 * 1000 };
const REFRESH_COOKIE_OPTS = { ...COOKIE_OPTS, maxAge: 7 * 24 * 60 * 60 * 1000 };

const generateTokens = (userId) => ({
  accessToken:  jwt.sign({ userId }, process.env.JWT_SECRET,         { expiresIn: process.env.JWT_EXPIRES_IN         || '15m' }),
  refreshToken: jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'  }),
});

// ── Helpers ───────────────────────────────────────────────────────
const setAuthCookies = (res, accessToken, refreshToken) => {
  res.cookie('et_access',  accessToken,  ACCESS_COOKIE_OPTS);
  res.cookie('et_refresh', refreshToken, REFRESH_COOKIE_OPTS);
};
const clearAuthCookies = (res) => {
  res.clearCookie('et_access',  { path:'/' });
  res.clearCookie('et_refresh', { path:'/' });
};

// ── Avatar upload config (multer) ─────────────────────────────────
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/avatars');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `avatar_${req.user.id}_${Date.now()}${ext}`);
  },
});
const avatarUpload = multer({
  storage: avatarStorage,
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG, or WebP allowed'));
  },
});

// ── Activity log helper ───────────────────────────────────────────
const logActivity = async (userId, action, meta = {}, ipHint = null) => {
  try {
    await safeQuery(
      `INSERT INTO profile_activity_log (user_id, action, meta, ip_hint)
       VALUES ($1, $2, $3, $4)`,
      [userId, action, JSON.stringify(meta), ipHint]
    );
  } catch (e) {
    console.warn('Activity log failed:', e.message);
  }
};

/* ─────────────────────────────────────────────────────────────────
   REGISTER
───────────────────────────────────────────────────────────────── */
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min:8 }),
  body('fullName').trim().notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, password, fullName, companyName } = req.body;
  try {
    const existing = await safeQuery('SELECT id FROM users WHERE email=$1', [email]);
    if (existing.rows.length) return res.status(409).json({ error:'Email already registered' });

    const passwordHash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS)||12);
    const otp          = generateOTP();
    const otpExpires   = new Date(Date.now() + 10*60*1000);

    const { rows } = await safeQuery(
      `INSERT INTO users (email,password_hash,full_name,company_name,email_otp,email_otp_expires)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,email,full_name,role`,
      [email, passwordHash, fullName, companyName||null, otp, otpExpires]
    );
    sendVerificationEmail(email, otp, fullName).catch(()=>{});
    res.status(201).json({ message:'Account created. Check email for OTP.', userId:rows[0].id });
  } catch(e) {
    console.error('Register error:', e);
    res.status(500).json({ error:'Registration failed' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   VERIFY EMAIL
───────────────────────────────────────────────────────────────── */
router.post('/verify-email', [
  body('email').isEmail().normalizeEmail(),
  body('otp').isLength({ min:6, max:6 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { email, otp } = req.body;
  try {
    const { rows } = await safeQuery(
      'SELECT id,email_otp,email_otp_expires,full_name FROM users WHERE email=$1', [email]
    );
    if (!rows.length) return res.status(404).json({ error:'User not found' });
    const user = rows[0];
    if (user.email_otp !== otp)                       return res.status(400).json({ error:'Invalid OTP' });
    if (new Date() > new Date(user.email_otp_expires)) return res.status(400).json({ error:'OTP expired' });

    await safeQuery(
      'UPDATE users SET email_verified=TRUE,email_otp=NULL,email_otp_expires=NULL WHERE id=$1',
      [user.id]
    );
    sendWelcomeEmail(email, user.full_name).catch(()=>{});

    const tokens = generateTokens(user.id);
    await safeQuery(
      `INSERT INTO refresh_tokens (user_id,token,expires_at) VALUES ($1,$2,NOW()+INTERVAL '7 days')`,
      [user.id, tokens.refreshToken]
    );

    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    res.json({
      message:      'Email verified',
      accessToken:  tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  } catch(e) {
    console.error('Verify error:', e);
    res.status(500).json({ error:'Verification failed' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   LOGIN
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
      `SELECT id,email,password_hash,full_name,company_name,role,
              wallet_address,kyc_status,kyc_verified,email_verified,is_active
       FROM users WHERE email=$1`, [email]
    );
    if (!rows.length)         return res.status(401).json({ error:'Invalid credentials' });
    const user = rows[0];
    if (!user.is_active)      return res.status(403).json({ error:'Account disabled' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)               return res.status(401).json({ error:'Invalid credentials' });
    if (!user.email_verified) return res.status(403).json({ error:'Email not verified' });

    await safeQuery('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);

    const tokens = generateTokens(user.id);
    await safeQuery(
      `INSERT INTO refresh_tokens (user_id,token,expires_at) VALUES ($1,$2,NOW()+INTERVAL '7 days')`,
      [user.id, tokens.refreshToken]
    );

    // Track session
    const ua = req.headers['user-agent'] || '';
    await safeQuery(
      `INSERT INTO user_sessions (user_id, browser, os, device_type, ip_address, is_current)
       VALUES ($1, $2, $3, $4, $5, TRUE)`,
      [user.id, ua.slice(0, 200), 'Unknown', 'desktop', req.ip || null]
    ).catch(() => {});

    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    res.json({
      user: {
        id:             user.id,
        email:          user.email,
        full_name:      user.full_name,
        company_name:   user.company_name,
        role:           user.role,
        wallet_address: user.wallet_address,
        kyc_verified:   !!(user.kyc_verified || user.kyc_status==='verified'),
      },
      accessToken:  tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  } catch(e) {
    console.error('Login error:', e);
    res.status(500).json({ error:'Login failed' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   REFRESH TOKEN
───────────────────────────────────────────────────────────────── */
router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.et_refresh || req.body?.refreshToken;
  if (!refreshToken) return res.status(400).json({ error:'No refresh token', code:'NO_REFRESH' });

  try {
    let payload;
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch {
      clearAuthCookies(res);
      return res.status(401).json({ error:'Invalid or expired refresh token' });
    }

    const { rows } = await safeQuery(
      `SELECT id FROM refresh_tokens
       WHERE token=$1 AND user_id=$2 AND expires_at>NOW() AND revoked=FALSE`,
      [refreshToken, payload.userId]
    );
    if (!rows.length) {
      clearAuthCookies(res);
      return res.status(401).json({ error:'Refresh token revoked or expired' });
    }

    await safeQuery('UPDATE refresh_tokens SET revoked=TRUE WHERE token=$1', [refreshToken]);

    const tokens = generateTokens(payload.userId);
    await safeQuery(
      `INSERT INTO refresh_tokens (user_id,token,expires_at) VALUES ($1,$2,NOW()+INTERVAL '7 days')`,
      [payload.userId, tokens.refreshToken]
    );

    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    res.json({
      message:      'Tokens refreshed',
      accessToken:  tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  } catch(e) {
    console.error('Refresh error:', e);
    res.status(500).json({ error:'Token refresh failed' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   LOGOUT
───────────────────────────────────────────────────────────────── */
router.post('/logout', authenticate, async (req, res) => {
  try {
    const refreshToken = req.cookies?.et_refresh || req.body?.refreshToken;
    if (refreshToken) {
      await safeQuery(
        'UPDATE refresh_tokens SET revoked=TRUE WHERE token=$1 AND user_id=$2',
        [refreshToken, req.user.id]
      ).catch(()=>{});
    }
    // Remove current session flag
    await safeQuery(
      'UPDATE user_sessions SET is_current=FALSE WHERE user_id=$1 AND is_current=TRUE',
      [req.user.id]
    ).catch(()=>{});
  } catch {}
  clearAuthCookies(res);
  res.json({ message:'Logged out' });
});

/* ─────────────────────────────────────────────────────────────────
   FIREBASE SYNC
───────────────────────────────────────────────────────────────── */
router.post('/firebase-sync', async (req, res) => {
  const { email, firebaseUid, fullName } = req.body;
  if (!email || !firebaseUid) return res.status(400).json({ error:'email and firebaseUid required' });

  try {
    const result = await withTransaction(async (client) => {
      let { rows } = await client.query(
        `SELECT id,email,full_name,role,wallet_address,kyc_status,kyc_verified
         FROM users WHERE email=$1`, [email]
      );
      let user = rows[0];
      if (!user) {
        const { rows:newUser } = await client.query(
          `INSERT INTO users (email,password_hash,full_name,email_verified)
           VALUES ($1,$2,$3,TRUE)
           RETURNING id,email,full_name,role,wallet_address,kyc_status,kyc_verified`,
          [email, `firebase:${firebaseUid}`, fullName||email.split('@')[0]]
        );
        user = newUser[0];
      }
      await client.query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
      const tokens = generateTokens(user.id);
      await client.query(
        `INSERT INTO refresh_tokens (user_id,token,expires_at) VALUES ($1,$2,NOW()+INTERVAL '7 days')`,
        [user.id, tokens.refreshToken]
      );
      return { user, tokens };
    });

    setAuthCookies(res, result.tokens.accessToken, result.tokens.refreshToken);
    res.json({
      user: {
        id:             result.user.id,
        email:          result.user.email,
        full_name:      result.user.full_name,
        role:           result.user.role,
        wallet_address: result.user.wallet_address,
        kyc_verified:   !!(result.user.kyc_verified || result.user.kyc_status==='verified'),
      },
      accessToken:  result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
    });
  } catch(e) {
    console.error('Firebase sync error:', e);
    res.status(500).json({ error:'Sync failed' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   CURRENT USER  /me
───────────────────────────────────────────────────────────────── */
router.get('/me', authenticate, async (req, res) => {
  try {
    const { rows } = await safeQuery(
      `SELECT id, email, full_name, company_name, role,
              wallet_address, kyc_status, kyc_verified, email_verified, last_login,
              phone, bio, timezone, avatar_url, notification_prefs
       FROM users WHERE id=$1`,
      [req.user.id]
    );
    const u = rows[0];
    res.json({
      ...u,
      kyc_verified: !!(u.kyc_verified || u.kyc_status === 'verified'),
    });
  } catch(e) {
    console.error('/me error:', e);
    res.status(500).json({ error:'Failed to fetch user' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   UPDATE PROFILE  PATCH /profile
   Updates: full_name, email, company_name, phone, bio, timezone, avatar_url
───────────────────────────────────────────────────────────────── */
router.patch('/profile', authenticate, [
  body('full_name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
  body('email').optional().isEmail().normalizeEmail(),
  body('phone').optional().matches(/^\+?[\d\s\-()\u2013]{7,16}$/).withMessage('Invalid phone number'),
  body('bio').optional().isLength({ max:280 }).withMessage('Bio must be under 280 characters'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { full_name, email, company_name, phone, bio, timezone, avatar_url } = req.body;

  try {
    // If email is changing, check it's not already taken
    if (email && email !== req.user.email) {
      const { rows: existing } = await safeQuery(
        'SELECT id FROM users WHERE email=$1 AND id!=$2', [email, req.user.id]
      );
      if (existing.length) return res.status(409).json({ error:'Email already in use' });
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
        updated_at   = NOW()
       WHERE id = $8
       RETURNING id, email, full_name, company_name, role,
                 wallet_address, kyc_verified, kyc_status,
                 phone, bio, timezone, avatar_url, notification_prefs`,
      [full_name||null, email||null, company_name||null, phone||null,
       bio||null, timezone||null, avatar_url||null, req.user.id]
    );

    await logActivity(req.user.id, 'PROFILE_UPDATED',
      { fields: Object.keys(req.body) }, req.ip);

    res.json({ user: { ...rows[0], kyc_verified: !!(rows[0].kyc_verified || rows[0].kyc_status === 'verified') } });
  } catch(e) {
    console.error('Profile update error:', e);
    res.status(500).json({ error:'Profile update failed' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   UPLOAD AVATAR  POST /upload-avatar
   Accepts multipart/form-data with field 'avatar'
   Returns: { avatar_url }
───────────────────────────────────────────────────────────────── */
router.post('/upload-avatar', authenticate, avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Build public URL — adjust BASE_URL to your domain in production
    const baseUrl  = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
    const avatarUrl = `${baseUrl}/uploads/avatars/${req.file.filename}`;

    // Delete old avatar file from disk if it exists
    if (req.user.avatar_url) {
      try {
        const oldFile = req.user.avatar_url.split('/uploads/avatars/')[1];
        if (oldFile) {
          const oldPath = path.join(__dirname, '../uploads/avatars', oldFile);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
      } catch {}
    }

    // Persist new avatar_url to DB
    await safeQuery(
      'UPDATE users SET avatar_url=$1, updated_at=NOW() WHERE id=$2',
      [avatarUrl, req.user.id]
    );

    res.json({ avatar_url: avatarUrl });
  } catch(e) {
    console.error('Avatar upload error:', e);
    res.status(500).json({ error: e.message || 'Avatar upload failed' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   CHANGE PASSWORD  POST /change-password
   Verifies current password, then updates to new password
───────────────────────────────────────────────────────────────── */
router.post('/change-password', authenticate, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min:8 }).withMessage('New password must be at least 8 characters'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { currentPassword, newPassword } = req.body;

  try {
    // Fetch current password hash
    const { rows } = await safeQuery(
      'SELECT password_hash FROM users WHERE id=$1', [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    // Verify current password
    const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    // Hash and save new password
    const newHash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    await safeQuery(
      'UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2',
      [newHash, req.user.id]
    );

    // Revoke all refresh tokens to invalidate other sessions
    await safeQuery(
      'UPDATE refresh_tokens SET revoked=TRUE WHERE user_id=$1',
      [req.user.id]
    );

    // Mark all other sessions as inactive
    await safeQuery(
      'DELETE FROM user_sessions WHERE user_id=$1',
      [req.user.id]
    );

    await logActivity(req.user.id, 'PASSWORD_CHANGED', {}, req.ip);

    res.json({ message: 'Password changed successfully. Please log in again on other devices.' });
  } catch(e) {
    console.error('Change password error:', e);
    res.status(500).json({ error: 'Password change failed' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   NOTIFICATION PREFERENCES  PATCH /notification-prefs
   Saves notification_prefs JSONB column
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
  } catch(e) {
    console.error('Notif prefs error:', e);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   LIST SESSIONS  GET /sessions
   Returns all active sessions for the current user
───────────────────────────────────────────────────────────────── */
router.get('/sessions', authenticate, async (req, res) => {
  try {
    const { rows } = await safeQuery(
      `SELECT id, browser, os, device_type, ip_address, is_current, last_active_at, created_at
       FROM user_sessions
       WHERE user_id = $1
       ORDER BY last_active_at DESC`,
      [req.user.id]
    );
    res.json({ sessions: rows });
  } catch(e) {
    console.error('Sessions error:', e);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   REVOKE SESSION  DELETE /sessions/:id
   Deletes a specific session row
───────────────────────────────────────────────────────────────── */
router.delete('/sessions/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await safeQuery(
      'DELETE FROM user_sessions WHERE id=$1 AND user_id=$2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });

    await logActivity(req.user.id, 'SESSION_REVOKED', { session_id: req.params.id }, req.ip);

    res.json({ message: 'Session revoked' });
  } catch(e) {
    console.error('Revoke session error:', e);
    res.status(500).json({ error: 'Failed to revoke session' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   ACTIVITY LOG  GET /activity-log
   Returns last 10 profile/security events for the current user
───────────────────────────────────────────────────────────────── */
router.get('/activity-log', authenticate, async (req, res) => {
  try {
    const { rows } = await safeQuery(
      `SELECT id, action, meta, ip_hint, created_at
       FROM profile_activity_log
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [req.user.id]
    );
    res.json({ log: rows });
  } catch(e) {
    console.error('Activity log error:', e);
    res.status(500).json({ error: 'Failed to fetch activity log' });
  }
});

/* ─────────────────────────────────────────────────────────────────
   REQUEST ACCOUNT DELETION  POST /request-deletion
   DPDP Act 2023 §13 compliant — creates a deletion request record
───────────────────────────────────────────────────────────────── */
router.post('/request-deletion', authenticate, [
  body('reason').trim().notEmpty().withMessage('Reason is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { reason } = req.body;

  try {
    // Check if a pending request already exists
    const { rows: existing } = await safeQuery(
      `SELECT id FROM account_deletion_requests
       WHERE user_id=$1 AND status='pending'`,
      [req.user.id]
    );
    if (existing.length) {
      return res.status(409).json({ error: 'A deletion request is already pending for this account' });
    }

    await safeQuery(
      `INSERT INTO account_deletion_requests (user_id, email, reason)
       VALUES ($1, $2, $3)`,
      [req.user.id, req.user.email, reason]
    );

    await logActivity(req.user.id, 'DELETION_REQUESTED', { reason }, req.ip);

    res.json({
      message: 'Deletion request submitted. You will receive an email confirmation within 24 hours. Your account will be permanently deleted within 72 hours per DPDP Act 2023 §13.',
    });
  } catch(e) {
    console.error('Deletion request error:', e);
    res.status(500).json({ error: 'Failed to submit deletion request' });
  }
});

module.exports = router;