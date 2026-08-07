// middleware/rateLimit.js — EtherTrack · Tiered rate limiting
// ─────────────────────────────────────────────────────────────────
// FIX: ipKeyGenerator(req) used everywhere instead of req.ip directly.
//      express-rate-limit v7+ validates keyGenerators and throws
//      ERR_ERL_KEY_GEN_IPV6 if raw req.ip is used — IPv6 clients
//      could otherwise bypass limits via address variants.
// ─────────────────────────────────────────────────────────────────
'use strict';

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { RedisStore }                = require('rate-limit-redis');
const { getRedis }                  = require('../services/redis');
const logger                        = require('../services/logger');

const makeStore = (prefix) => {
  try {
    const redis = getRedis();
    if (typeof redis.sendCommand === 'function') {
      return new RedisStore({
        sendCommand: (...args) => redis.call(...args),
        prefix: `rl:${prefix}:`,
      });
    }
  } catch { /* fall through */ }
  logger.warn({ prefix }, 'rateLimit.using_memory_store');
  return undefined;
};

const onLimitReached = (req, _res, options) => {
  logger.warn(
    { ip: req.ip, userId: req.user?.id, path: req.path, limit: options.max },
    'rateLimit.hit'
  );
};

const makeLimiter = ({ prefix, windowMs, max, message, keyGenerator }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders:   false,
    store:           makeStore(prefix),
    // FIX: use ipKeyGenerator(req) — never req.ip directly
    keyGenerator:    keyGenerator ?? ((req) => req.user?.id ?? ipKeyGenerator(req)),
    handler: (req, res, next, options) => {
      onLimitReached(req, res, options);
      res.status(429).json({
        error:      'Too many requests',
        message,
        retryAfter: Math.ceil(options.windowMs / 1000),
        code:       'RATE_LIMITED',
      });
    },
    skip: () => process.env.NODE_ENV === 'test',
  });

// IP-only limiters (unauthenticated routes)
const publicLimiter = makeLimiter({
  prefix:       'public',
  windowMs:     15 * 60 * 1000,
  max:          300,
  message:      'Too many requests from this IP. Please try again in 15 minutes.',
  // FIX: ipKeyGenerator(req) not req.ip
  keyGenerator: (req) => ipKeyGenerator(req),
});

// Authenticated + IP fallback
const apiLimiter = makeLimiter({
  prefix:   'api',
  windowMs: 60 * 1000,
  max:      120,
  message:  'Too many API requests. Please slow down.',
});

const kycSubmitLimiter = makeLimiter({
  prefix:   'kyc-submit',
  windowMs: 60 * 60 * 1000,
  max:      3,
  message:  'Too many KYC submissions. Please wait 1 hour before trying again.',
});

const adminActionLimiter = makeLimiter({
  prefix:   'admin-action',
  windowMs: 60 * 1000,
  max:      60,
  message:  'Too many admin actions. Please slow down.',
});

// [FIX-RATE-GAP] Listing/delisting/retiring credits (routes/operator-trading.js,
// mounted at /api/portfolio) previously had NO dedicated limiter — only the
// generic global catch-all (500 req/15min per IP), far too loose for
// actions that move or destroy real assets worth real money. 15/min per
// user is generous for legitimate active portfolio management while
// meaningfully blocking spam-listing/rapid-fire abuse or race-condition
// probing against the escrow/custody logic.
const assetActionLimiter = makeLimiter({
  prefix:   'asset-action',
  windowMs: 60 * 1000,
  max:      15,
  message:  'Too many listing/retirement actions. Please slow down.',
});

// [FIX-RATE-COVERAGE] The rest of the money/security-sensitive surface
// that had no dedicated limiter — only the generic 500/15min IP-based
// catch-all. Each mounted as a prefix limiter in server.js, so one line
// covers every mutating endpoint under that path rather than hand-tuning
// dozens of individual routes.

// Wallet binding, bank account add/remove, withdrawal requests — real
// money movement. Excludes /api/wallet/webhook (Razorpay-signed, handled
// separately, should not be throttled the same way user actions are).
const walletActionLimiter = makeLimiter({
  prefix:   'wallet-action',
  windowMs: 60 * 1000,
  max:      20,
  message:  'Too many wallet actions. Please slow down.',
});

// Org member management, subscription/payment actions.
const orgActionLimiter = makeLimiter({
  prefix:   'org-action',
  windowMs: 60 * 1000,
  max:      20,
  message:  'Too many organisation actions. Please slow down.',
});

// Entity/user account PATCH/DELETE — account-level changes.
const entityActionLimiter = makeLimiter({
  prefix:   'entity-action',
  windowMs: 60 * 1000,
  max:      20,
  message:  'Too many account actions. Please slow down.',
});

// 2FA setup/verify — same brute-force risk profile as OTP (someone
// guessing a 6-digit TOTP code), same tight ceiling.
const twoFactorLimiter = makeLimiter({
  prefix:       'two-factor',
  windowMs:     10 * 60 * 1000,
  max:          5,
  message:      'Too many 2FA attempts. Please wait 10 minutes.',
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req),
});


const otpLimiter = makeLimiter({
  prefix:       'otp',
  windowMs:     10 * 60 * 1000,
  max:          5,
  message:      'Too many OTP requests. Please wait 10 minutes.',
  // FIX: ipKeyGenerator(req) not req.ip
  keyGenerator: (req) => ipKeyGenerator(req),
});

module.exports = {
  publicLimiter,
  apiLimiter,
  kycSubmitLimiter,
  adminActionLimiter,
  assetActionLimiter,
  walletActionLimiter,
  orgActionLimiter,
  entityActionLimiter,
  twoFactorLimiter,
  otpLimiter,
};