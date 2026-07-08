// routes/user.js — EtherTrack
// FIX-IPv6: destructiveLimiter keyGenerator uses ipKeyGenerator(req)
//           instead of req.ip — fixes ERR_ERL_KEY_GEN_IPV6.
'use strict';

const router    = require('express').Router();
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { safeQuery: query } = require('../db/pool');
const { authenticate }     = require('../middleware/auth');
const { invalidateUserCache } = require('../middleware/auth');
const { sendTwoFactorDisabledEmail, sendAccountDeactivatedEmail, sendAccountDeletedEmail, sendNewTicketInternalAlert, sendSupportTicketReceivedEmail } = require('../services/email');

const escHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

// FIX-IPv6: use ipKeyGenerator(req) as fallback, not req.ip
const destructiveLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => req.user?.id ?? ipKeyGenerator(req),
  message: { error: 'Too many requests. Please wait before trying again.' },
});

// ── GET /api/user/preferences ─────────────────────────────────────
router.get('/preferences', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT notification_prefs, timezone, two_fa_enabled, totp_enabled
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    const raw   = rows[0];
    const prefs = raw.notification_prefs || {};

    res.json({
      notifications: {
        tradeConfirm:   prefs.tradeConfirm   ?? true,
        priceAlerts:    prefs.priceAlerts     ?? true,
        emissionAlerts: prefs.emissionAlerts  ?? false,
        newsletter:     prefs.newsletter      ?? false,
        kycUpdates:     prefs.kycUpdates      ?? true,
      },
      preferences: {
        currency:    prefs.currency    || 'INR',
        language:    prefs.language    || 'English',
        timezone:    raw.timezone      || 'Asia/Kolkata',
        priceFormat: prefs.priceFormat || 'Indian',
      },
      security: {
        twoFactorEnabled: !!(raw.two_fa_enabled || raw.totp_enabled),
        loginAlerts:      prefs.loginAlerts ?? true,
        sessionTimeout:   prefs.sessionTimeout || '30',
      },
    });
  } catch (e) {
    console.error('[preferences/get]', e.message);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

// ── POST /api/user/preferences ────────────────────────────────────
router.post('/preferences', authenticate, async (req, res) => {
  const { notifications, preferences, security } = req.body;

  if (!notifications && !preferences && !security) {
    return res.status(400).json({ error: 'No preferences provided' });
  }

  try {
    const { rows } = await query(
      'SELECT notification_prefs, timezone FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    const current = rows[0].notification_prefs || {};

    const merged = {
      ...current,
      ...(notifications && {
        tradeConfirm:   !!notifications.tradeConfirm,
        priceAlerts:    !!notifications.priceAlerts,
        emissionAlerts: !!notifications.emissionAlerts,
        newsletter:     !!notifications.newsletter,
        kycUpdates:     !!notifications.kycUpdates,
      }),
      ...(preferences && {
        currency:    preferences.currency    || current.currency    || 'INR',
        language:    preferences.language    || current.language    || 'English',
        priceFormat: preferences.priceFormat || current.priceFormat || 'Indian',
      }),
      ...(security && {
        loginAlerts:    security.loginAlerts    ?? current.loginAlerts    ?? true,
        sessionTimeout: security.sessionTimeout || current.sessionTimeout || '30',
      }),
    };

    const newTimezone = preferences?.timezone || rows[0].timezone || 'Asia/Kolkata';

    await query(
      `UPDATE users SET notification_prefs = $1, timezone = $2, updated_at = NOW() WHERE id = $3`,
      [JSON.stringify(merged), newTimezone, req.user.id]
    );

    res.json({ success: true, message: 'Preferences saved' });
  } catch (e) {
    console.error('[preferences/save]', e.message);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

// ── POST /api/user/disable-2fa ────────────────────────────────────
router.post('/disable-2fa', authenticate, destructiveLimiter, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT two_fa_enabled, totp_enabled FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    if (!rows[0].two_fa_enabled && !rows[0].totp_enabled) {
      return res.status(400).json({ error: '2FA is not enabled on this account' });
    }

    await query(
      `UPDATE users
       SET two_fa_enabled = FALSE, totp_enabled = FALSE, totp_secret = NULL,
           totp_secret_temp = NULL, totp_backup_codes = NULL, updated_at = NOW()
       WHERE id = $1`,
      [req.user.id]
    );

    await invalidateUserCache(req.user.id);

    try {
      await sendTwoFactorDisabledEmail(req.user.email, { name: req.user.full_name });
    } catch {}

    res.json({ success: true, message: '2FA disabled successfully' });
  } catch (e) {
    console.error('[disable-2fa]', e.message);
    res.status(500).json({ error: 'Failed to disable 2FA' });
  }
});

// ── POST /api/user/deactivate ─────────────────────────────────────
router.post('/deactivate', authenticate, destructiveLimiter, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT is_active, inr_balance FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    if (!rows[0].is_active) {
      return res.status(400).json({ error: 'Account is already deactivated' });
    }

    await query(`UPDATE users SET is_active=FALSE, updated_at=NOW() WHERE id=$1`, [req.user.id]);
    await invalidateUserCache(req.user.id);

    try {
      await sendAccountDeactivatedEmail(req.user.email, { name: req.user.full_name, inrBalance: rows[0].inr_balance });
    } catch {}

    res.json({ success: true, message: 'Account deactivated' });
  } catch (e) {
    console.error('[deactivate]', e.message);
    res.status(500).json({ error: 'Failed to deactivate account' });
  }
});

// ── POST /api/user/delete ─────────────────────────────────────────
router.post('/delete', authenticate, destructiveLimiter, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT inr_balance, kyc_verified, wallet_address FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    const balance = parseFloat(rows[0].inr_balance || 0);
    if (balance > 0) {
      return res.status(400).json({
        error:   `You have ₹${balance.toLocaleString('en-IN')} in your wallet. Please withdraw all funds before deleting your account.`,
        code:    'BALANCE_REMAINING',
        balance: balance.toString(),
      });
    }

    await query(
      `UPDATE users SET
         email            = CONCAT('deleted_', id, '@deleted.ethertrack.in'),
         full_name        = 'Deleted User',
         password_hash    = NULL, phone = NULL, company_name = NULL,
         company_gstin    = NULL, company_pan = NULL, company_cin = NULL,
         bio              = NULL, avatar_url = NULL, wallet_address = NULL,
         kyc_data_hash    = NULL, kyc_aadhaar_hash = NULL, kyc_pan_hash = NULL,
         totp_secret      = NULL, totp_secret_temp = NULL, totp_backup_codes = NULL,
         notification_prefs = NULL, is_active = FALSE, frozen = TRUE,
         freeze_reason    = 'ACCOUNT_DELETED', updated_at = NOW()
       WHERE id = $1`,
      [req.user.id]
    );

    await invalidateUserCache(req.user.id);

    try {
      await query(
        `INSERT INTO audit_log (user_id, action, metadata, created_at) VALUES ($1, 'ACCOUNT_DELETED', $2, NOW())`,
        [req.user.id, JSON.stringify({
          deletedAt: new Date().toISOString(),
          hadWallet: !!rows[0].wallet_address,
          wasKYCVerified: !!rows[0].kyc_verified,
        })]
      );
    } catch {}

    try {
      await sendAccountDeletedEmail(req.user.email, { name: req.user.full_name });
    } catch {}

    res.json({ success: true, message: 'Account permanently deleted' });
  } catch (e) {
    console.error('[delete]', e.message);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// ── POST /api/support/ticket ──────────────────────────────────────
router.post('/ticket', authenticate, [
  body('type').notEmpty(),
  body('message').trim().isLength({ min: 10, max: 2000 })
    .withMessage('Message must be between 10 and 2000 characters'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { type, message } = req.body;

  const ALLOWED_TYPES = ['kyc_reset', 'account_issue', 'billing', 'trade_dispute', 'other'];
  if (!ALLOWED_TYPES.includes(type)) {
    return res.status(400).json({ error: 'Invalid ticket type' });
  }

  const safeMessage = escHtml(message);
  const safeType    = escHtml(type);
  const safeEmail   = escHtml(req.user.email);
  const safeName    = escHtml(req.user.full_name || 'User');

  try {
    await query(
      `INSERT INTO audit_log (user_id, action, metadata, created_at) VALUES ($1, 'SUPPORT_TICKET', $2, NOW())`,
      [req.user.id, JSON.stringify({ type, message, email: req.user.email })]
    );

    const ticketNumber = `TKT-${req.user.id}-${Date.now().toString(36).toUpperCase()}`;

    try {
      if (process.env.ADMIN_EMAIL) {
        await sendNewTicketInternalAlert(process.env.ADMIN_EMAIL, {
          ticketNumber, userEmail: req.user.email, userId: req.user.id, type: safeType, message: safeMessage,
        });
      }
    } catch (emailErr) {
      console.warn('[ticket] admin email failed:', emailErr.message);
    }

    try {
      await sendSupportTicketReceivedEmail(req.user.email, { name: safeName, ticketNumber });
    } catch {}

    res.json({ success: true, message: 'Support ticket submitted. We will respond within 1 business day.' });
  } catch (e) {
    console.error('[ticket]', e.message);
    res.status(500).json({ error: 'Failed to submit support ticket' });
  }
});

module.exports = router;