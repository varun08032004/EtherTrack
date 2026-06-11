// middleware/index.js — All production middleware exports
// Install deps: npm install express-rate-limit csurf cookie-parser

// ─────────────────────────────────────────────────────────────────
// [C4] CSRF Protection
// Apply to all state-changing routes (POST/PUT/DELETE).
// Frontend must read the XSRF-TOKEN cookie and send it as
// X-CSRF-Token header on every non-GET request.
// ─────────────────────────────────────────────────────────────────
const csurf = require('csurf');

const csrfProtection = csurf({
  cookie: {
    httpOnly: false,  // must be readable by JS so frontend can send it
    sameSite: 'strict',
    secure:   process.env.NODE_ENV === 'production',
  },
});

// Sends the CSRF token as a cookie after every state-changing request
const attachCsrfToken = (req, res, next) => {
  res.cookie('XSRF-TOKEN', req.csrfToken(), {
    httpOnly: false,
    sameSite: 'strict',
    secure:   process.env.NODE_ENV === 'production',
  });
  next();
};

// Error handler for CSRF failures — returns JSON instead of HTML
const csrfErrorHandler = (err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({
      error: 'Invalid or missing CSRF token. Refresh the page and try again.',
    });
  }
  next(err);
};

// ─────────────────────────────────────────────────────────────────
// [C1] Rate limiters
// ─────────────────────────────────────────────────────────────────
const rateLimit = require('express-rate-limit');

const tradeLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => req.user?.id || req.ip,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many trade attempts. Please wait before retrying.' });
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max:      20,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many login attempts. Please wait 15 minutes.' });
  },
});

const readLimiter = rateLimit({
  windowMs:     60 * 1000,
  max:          120,
  keyGenerator: (req) => req.user?.id || req.ip,
});

const walletLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      5, // 5 withdrawals/deposits per minute max
  keyGenerator: (req) => req.user?.id || req.ip,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many wallet operations. Please wait.' });
  },
});

// ─────────────────────────────────────────────────────────────────
// [MISSING] KYC tier trading limit enforcement
// Call this middleware on /api/trades/record to enforce
// per-tier daily limits.
// ─────────────────────────────────────────────────────────────────
const { safeQuery: query } = require('../db/pool');

const enforceTradingLimit = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const { rows: userRows } = await query(
      'SELECT kyc_tier, inr_balance FROM users WHERE id = $1',
      [userId]
    );
    if (!userRows.length) return res.status(404).json({ error: 'User not found' });

    const tier = userRows[0].kyc_tier || 0;

    // Get the daily limit for this tier
    const { rows: limitRows } = await query(
      'SELECT daily_limit_inr FROM kyc_tier_limits WHERE tier = $1',
      [tier]
    );
    const dailyLimit = limitRows[0]?.daily_limit_inr;

    // NULL daily_limit means no cap (tier 3 — full CKYC)
    if (dailyLimit === null || dailyLimit === undefined) return next();

    // Tier 0 — no trading at all
    if (parseFloat(dailyLimit) === 0) {
      return res.status(403).json({
        error: 'Complete KYC verification to start trading.',
        kycTier: tier,
      });
    }

    // Sum today's buys for this user
    const { rows: volRows } = await query(
      `SELECT COALESCE(SUM(buyer_pays_inr), 0) AS today_volume
       FROM trades
       WHERE buyer_id = $1
         AND status = 'completed'
         AND created_at >= CURRENT_DATE`,
      [userId]
    );
    const todayVolume  = parseFloat(volRows[0]?.today_volume || 0);
    const tradingAmount = parseFloat(req.body.pricePerCreditINR || 0) * parseInt(req.body.quantity || 0);
    const buyerFee     = tradingAmount * 0.005;
    const totalRequired = tradingAmount + buyerFee;

    if (todayVolume + totalRequired > parseFloat(dailyLimit)) {
      return res.status(403).json({
        error:        `Daily trading limit of Rs.${parseFloat(dailyLimit).toLocaleString('en-IN')} exceeded for your KYC tier.`,
        kycTier:      tier,
        dailyLimit:   parseFloat(dailyLimit),
        usedToday:    todayVolume,
        remaining:    Math.max(0, parseFloat(dailyLimit) - todayVolume),
      });
    }

    next();
  } catch (e) {
    console.error('enforceTradingLimit error:', e);
    next(); // non-fatal — don't block the trade if this check itself fails
  }
};

module.exports = {
  csrfProtection,
  attachCsrfToken,
  csrfErrorHandler,
  tradeLimiter,
  authLimiter,
  readLimiter,
  walletLimiter,
  enforceTradingLimit,
};