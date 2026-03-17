// routes/auth.js  —  EtherTrack
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
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
    // ✅ Also return tokens in body so frontend can store in localStorage
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

    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    // ✅ Return tokens in body
    res.json({
      user: {
        id:             user.id,
        email:          user.email,
        fullName:       user.full_name,
        companyName:    user.company_name,
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
   Accepts token from cookie OR from request body (cross-origin fallback)
───────────────────────────────────────────────────────────────── */
router.post('/refresh', async (req, res) => {
  // Accept from cookie first, fall back to body (for cross-origin localhost dev)
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

    // Rotate — revoke old, issue new
    await safeQuery('UPDATE refresh_tokens SET revoked=TRUE WHERE token=$1', [refreshToken]);

    const tokens = generateTokens(payload.userId);
    await safeQuery(
      `INSERT INTO refresh_tokens (user_id,token,expires_at) VALUES ($1,$2,NOW()+INTERVAL '7 days')`,
      [payload.userId, tokens.refreshToken]
    );

    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    // ✅ Return tokens in body
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
    // ✅ Return tokens in body
    res.json({
      user: {
        id:             result.user.id,
        email:          result.user.email,
        fullName:       result.user.full_name,
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
      `SELECT id,email,full_name,company_name,role,
              wallet_address,kyc_status,kyc_verified,email_verified,last_login
       FROM users WHERE id=$1`,
      [req.user.id]
    );
    const u = rows[0];
    res.json({
      ...u,
      kyc_verified: !!(u.kyc_verified || u.kyc_status==='verified'),
    });
  } catch(e) {
    console.error('/me error:', e);
    res.status(500).json({ error:'Failed to fetch user' });
  }
});

module.exports = router;