// routes/unsubscribe.js — EtherTrack
// Unauthenticated by design — RFC 8058 requires mail providers to be able to
// POST here with zero user interaction (no login, no cookies, no CAPTCHA).
// Scope: ONLY affects the 'informational' email category (platform-wide
// announcements). Transactional mail (KYC, security, money movement,
// approvals) is never gated by this and keeps sending regardless.
'use strict';

const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { verifyUnsubscribeToken } = require('../services/email');

const CONFIRMATION_PAGE = (message, ok) => `
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EtherTrack</title></head>
<body style="margin:0;padding:0;background:#0a0f0c;font-family:'Courier New',monospace;display:flex;align-items:center;justify-content:center;min-height:100vh">
  <div style="background:#0d1410;border:1px solid #1a4d30;border-radius:12px;padding:40px;max-width:420px;text-align:center">
    <div style="font-size:11px;color:#6ee7b7;letter-spacing:.15em;margin-bottom:16px;font-weight:700">ETHERTRACK</div>
    <div style="font-size:20px;font-weight:700;color:${ok ? '#22c55e' : '#f87171'};margin-bottom:12px">${ok ? 'Unsubscribed' : 'Link Invalid'}</div>
    <p style="color:#d6f5e3;font-size:13px;line-height:1.7">${message}</p>
  </div>
</body></html>`;

const doUnsubscribe = async (email, token) => {
  if (!email || !token || !verifyUnsubscribeToken(email, token)) {
    return { ok: false, message: 'This unsubscribe link is invalid or has expired.' };
  }
  await query('UPDATE users SET marketing_emails_enabled = FALSE WHERE email = $1', [email.toLowerCase()]);
  return { ok: true, message: "You've been unsubscribed from EtherTrack platform announcements. You'll still receive account, security, and transaction emails — those aren't optional." };
};

// GET — a human clicking the link in their email client
router.get('/', async (req, res) => {
  const { email, token } = req.query;
  const { ok, message } = await doUnsubscribe(email, token).catch(() => ({ ok: false, message: 'Something went wrong. Please contact support@ethertrack.in.' }));
  res.set('Content-Type', 'text/html').send(CONFIRMATION_PAGE(message, ok));
});

// POST — Gmail/Yahoo's automated one-click unsubscribe (RFC 8058).
// Must respond 200 with no user interaction required.
router.post('/', async (req, res) => {
  const { email, token } = req.query;
  const { ok } = await doUnsubscribe(email, token).catch(() => ({ ok: false }));
  res.status(ok ? 200 : 400).send();
});

module.exports = router;