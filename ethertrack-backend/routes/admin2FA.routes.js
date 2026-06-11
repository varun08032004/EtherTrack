// routes/admin2FA.routes.js — 2FA setup + verify endpoints
const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { generateAdminTOTP, verifyTOTP } = require('../middleware/adminAuth2FA');

const isAdmin = [authenticate, requireRole('admin')];

// GET /api/admin/2fa/setup — generate QR code for admin to scan
router.get('/setup', isAdmin, async (req, res) => {
  try {
    const { rows } = await query(`SELECT email, totp_enabled FROM users WHERE id=$1`, [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    if (rows[0].totp_enabled) return res.status(400).json({ error: '2FA already enabled. Disable it first to re-setup.' });
    const result = await generateAdminTOTP(req.user.id, rows[0].email);
    res.json({
      qrCodeUrl: result.qrCodeUrl,
      secret: result.secret, // show once — user should save this backup code
      instructions: 'Scan the QR code with Google Authenticator or Authy. Then verify with a code to enable 2FA.',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/2fa/enable — verify first code to confirm setup
router.post('/enable', isAdmin, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'TOTP token required' });
  try {
    const { rows } = await query(`SELECT totp_secret, totp_enabled FROM users WHERE id=$1`, [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    if (!rows[0].totp_secret) return res.status(400).json({ error: 'Run /setup first' });
    if (rows[0].totp_enabled) return res.status(400).json({ error: '2FA already enabled' });
    const valid = verifyTOTP(rows[0].totp_secret, token);
    if (!valid) return res.status(401).json({ error: 'Invalid code — check your authenticator app and try again' });
    await query(`UPDATE users SET totp_enabled=TRUE, updated_at=NOW() WHERE id=$1`, [req.user.id]);
    res.json({ success: true, message: '2FA enabled successfully. All future admin logins will require your authenticator code.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/2fa/verify — verify code during login session
router.post('/verify', isAdmin, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'TOTP token required' });
  try {
    const { rows } = await query(`SELECT totp_secret, totp_enabled FROM users WHERE id=$1`, [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    if (!rows[0].totp_enabled) return res.status(400).json({ error: '2FA not enabled for this account' });
    const valid = verifyTOTP(rows[0].totp_secret, token);
    if (!valid) return res.status(401).json({ error: 'Invalid code. Try again.' });
    // Mark session as 2FA verified
    if (req.session) req.session.totp2FAVerified = req.user.id;
    res.json({ success: true, message: '2FA verified' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/2fa/disable — disable 2FA (requires valid token to confirm)
router.post('/disable', isAdmin, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'TOTP token required to disable 2FA' });
  try {
    const { rows } = await query(`SELECT totp_secret, totp_enabled FROM users WHERE id=$1`, [req.user.id]);
    if (!rows[0].totp_enabled) return res.status(400).json({ error: '2FA not enabled' });
    const valid = verifyTOTP(rows[0].totp_secret, token);
    if (!valid) return res.status(401).json({ error: 'Invalid code' });
    await query(`UPDATE users SET totp_secret=NULL, totp_enabled=FALSE, updated_at=NOW() WHERE id=$1`, [req.user.id]);
    if (req.session) delete req.session.totp2FAVerified;
    res.json({ success: true, message: '2FA disabled' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/2fa/status
router.get('/status', isAdmin, async (req, res) => {
  try {
    const { rows } = await query(`SELECT totp_enabled FROM users WHERE id=$1`, [req.user.id]);
    res.json({ enabled: rows[0]?.totp_enabled || false, sessionVerified: req.session?.totp2FAVerified === req.user.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;