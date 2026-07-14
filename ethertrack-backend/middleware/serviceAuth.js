'use strict';
// middleware/serviceAuth.js
//
// Separate from the normal `authenticate` (user session/JWT) middleware.
// This gates server-to-server calls from the internal ops ERP (etpl_ops),
// per SRS §18.8: "the ERP integrates via the platform's own API, read-only,
// using a scoped service-account token. No shared database, no shared
// codebase, and no write access in either direction."
//
// The token is a single shared secret (OPS_SYNC_SERVICE_TOKEN) checked with
// a timing-safe comparison. It is intentionally NOT a user JWT — there is no
// "ops service user" in the users table, and this must keep working even if
// every human admin account is locked out.
//
// Optional defense-in-depth: OPS_SYNC_ALLOWED_IPS restricts calls to a known
// set of source IPs (e.g. your etpl_ops server's static egress IP on Render).
// Leave it unset locally — it's skipped entirely when not configured, so
// localhost dev keeps working with just the token.

const crypto = require('crypto');

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  // Pad to equal length before comparing so mismatched lengths don't short
  // circuit before reaching timingSafeEqual (avoids leaking length via timing).
  const maxLen = Math.max(bufA.length, bufB.length, 1);
  const paddedA = Buffer.concat([bufA], maxLen);
  const paddedB = Buffer.concat([bufB], maxLen);
  const equal = crypto.timingSafeEqual(paddedA, paddedB);
  return equal && bufA.length === bufB.length;
}

function getClientIp(req) {
  // Render (and most PaaS) sit behind a proxy — trust x-forwarded-for's
  // first hop only if 'trust proxy' is set correctly on the express app.
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress;
}

function requireServiceToken(req, res, next) {
  const configured = process.env.OPS_SYNC_SERVICE_TOKEN;
  if (!configured) {
    console.error('[serviceAuth] OPS_SYNC_SERVICE_TOKEN is not set — refusing all service calls');
    return res.status(503).json({ error: 'Service integration not configured' });
  }

  const provided = req.headers['x-service-token'];
  if (!provided || !timingSafeEqual(provided, configured)) {
    console.warn(`[serviceAuth] rejected service call from ${getClientIp(req)} — bad or missing token`);
    return res.status(401).json({ error: 'Invalid or missing service token' });
  }

  // Optional IP allowlist. Unset OPS_SYNC_ALLOWED_IPS entirely to disable
  // (e.g. for localhost dev, where the caller's IP isn't fixed/known).
  const allowlist = (process.env.OPS_SYNC_ALLOWED_IPS || '')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);

  if (allowlist.length > 0) {
    const clientIp = getClientIp(req);
    const normalizedClientIp = clientIp?.replace('::ffff:', ''); // strip IPv4-mapped IPv6 prefix
    if (!allowlist.includes(normalizedClientIp)) {
      console.warn(`[serviceAuth] rejected service call — IP ${normalizedClientIp} not in allowlist`);
      return res.status(403).json({ error: 'Source not permitted' });
    }
  }

  req.isServiceCall = true;
  next();
}

module.exports = { requireServiceToken };