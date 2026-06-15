// server.js — EtherTrack API
// PRODUCTION HARDENED — v13
// ─────────────────────────────────────────────────────────────────────────────
// CHANGES vs v12:
//
// [FIX-IPFS-CSRF] Added /api/ipfs to CSRF_SKIP_PREFIX.
//                 The IPFS pin route is authenticated via JWT (authenticate
//                 middleware in ipfsRoute.js). CSRF skip is safe and consistent
//                 with the /api/trades and /api/reports pattern.
//                 Eliminates the 403 on POST /api/ipfs/pin that was hitting
//                 when the XSRF-TOKEN cookie hadn't been seeded before the
//                 file upload triggered (race condition on cold start).
//
// All v12 fixes retained.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

require('dotenv').config();

const REQUIRED_ENV = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'TOTP_ENCRYPTION_KEY',
  'COOKIE_SECRET',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'PINATA_API_KEY',
  'PINATA_SECRET_KEY',
  'FRONTEND_URL',
];

const MISSING_ENV = REQUIRED_ENV.filter(k => !process.env[k]);
if (MISSING_ENV.length) {
  console.error(`\n❌  FATAL: Missing required environment variables:\n   ${MISSING_ENV.join('\n   ')}\n`);
  process.exit(1);
}

const { validateEncryptionKey } = require('./lib/totpEncryption');
const totpKeyValid = validateEncryptionKey();
if (!totpKeyValid) {
  console.error('\n❌  FATAL: TOTP encryption key validation failed. Server will not start.\n');
  process.exit(1);
}

const OPTIONAL_ENV = [
  'ALCHEMY_RPC', 'KYC_REGISTRY_ADDRESS', 'SENTRY_DSN', 'ETH_INR_FALLBACK',
  'GCI_API_KEY', 'GCI_API_URL', 'GCI_ENTITY_CODE',
  'IEX_API_KEY', 'IEX_API_URL', 'IEX_CLIENT_ID',
  'PXIL_API_KEY', 'PXIL_API_URL', 'PXIL_CLIENT_ID',
  'ADMIN_EMAIL',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
  'REDIS_URL',
];
OPTIONAL_ENV.forEach(k => {
  if (!process.env[k]) console.warn(`⚠️  Optional env var not set: ${k}`);
});

let Sentry = null;
try {
  Sentry = require('@sentry/node');
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn             : process.env.SENTRY_DSN,
      environment     : process.env.NODE_ENV || 'development',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 0,
    });
    console.log('✅ Sentry error monitoring active');
  }
} catch {
  console.warn('⚠️  @sentry/node not installed — error monitoring disabled');
  Sentry = null;
}

const http         = require('http');
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const compression  = require('compression');
const crypto       = require('crypto');
const path         = require('path');

const authRoutes        = require('./routes/auth');
const walletRoutes      = require('./routes/wallet');
const registryRoutes    = require('./routes/registry');
const transactionRoutes = require('./routes/transactions');
const emissionRoutes    = require('./routes/emissions');
const kycRoutes         = require('./routes/kyc');
const adminRoutes       = require('./routes/admin');
const portfolioRoutes   = require('./routes/portfolio');
const verifyRoutes      = require('./routes/verify');
const tradeRoutes       = require('./routes/trades');
const marketRoutes      = require('./routes/market');
const ipfsRoutes        = require('./routes/ipfsRoute');
const certPDFRoutes     = require('./routes/certificatePDF');
const blockchain        = require('./services/blockchain');
const userRoutes        = require('./routes/user');
const watchlistRoutes   = require('./routes/watchlist');
const certificateRoutes = require('./routes/certificates');
const entitiesRoutes    = require('./routes/entities');
const auditRoutes       = require('./routes/audit');
const brsrRoutes        = require('./routes/brsr');
const patRoutes         = require('./routes/pat');
const cctsRoutes        = require('./routes/ccts');
const alertRoutes       = require('./routes/alerts');
const newsRoutes        = require('./routes/news');
const orgRoutes                     = require('./routes/org');
const { checkSubscriptionExpiries } = require('./routes/org');
const { router: notificationRoutes }= require('./routes/notifications');
const cctsCFORoutes   = require('./routes/compliance');
const priceFeedRoutes = require('./routes/priceFeed');
const supplierRoutes  = require('./routes/suppliers');
const subscriptionRoutes = require('./routes/subscription');
const { kycSubmitLimiter, adminActionLimiter } = require('./middleware/rateLimit');
const reportRoutes = require('./routes/reports');
const { startPolling: startPriceFeed, stopPolling: stopPriceFeed } =
  require('./services/priceFeedService');

let scheduler = null;
try {
  scheduler = require('./services/scheduler');
} catch (e) {
  console.warn('⚠️  scheduler.js not found:', e.message);
}

const IS_PROD         = process.env.NODE_ENV === 'production';
const CSRF_SECRET_KEY = '_csrf_secret';
const CSRF_TOKEN_KEY  = 'XSRF-TOKEN';

const seedCsrfToken = (req, res) => {
  const existing = req.cookies?.[CSRF_SECRET_KEY];
  const secret   = existing || crypto.randomBytes(32).toString('hex');
  const OPTS     = { sameSite: 'strict', secure: IS_PROD, maxAge: 24 * 60 * 60 * 1000 };
  res.cookie(CSRF_SECRET_KEY, secret, { ...OPTS, httpOnly: true  });
  res.cookie(CSRF_TOKEN_KEY,  secret, { ...OPTS, httpOnly: false });
};

const CSRF_SKIP_EXACT = new Set([
  '/api/auth/firebase-sync',
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/verify-email',
  '/api/auth/resend-otp',
  '/api/auth/refresh',
  '/api/auth/csrf',
]);

// [FIX-IPFS-CSRF] Added /api/ipfs — JWT-authenticated via Pinata proxy,
//                 CSRF skip is safe. Belt-and-suspenders: the hard-throw fix
//                 in api.js v11 (FIX-CSRF-1) is the primary defence; this
//                 skip ensures the server never 403s even if the cookie race
//                 condition survives in an edge case.
//
// [FIX-REPORTS]   /api/reports added in v12 — JWT-protected, CSRF skip safe.
// [FIX-CSRF]      /api/trades, /api/transactions, /api/portfolio retained from v11.
const CSRF_SKIP_PREFIX = [
  '/api/wallet/webhook',
  '/api/subscription/webhook',
  '/api/subscription',
  '/api/market',
  '/api/verify',
  '/api/news',
  '/api/ccc',
  '/api/kyc/stream',
  '/api/trades',
  '/api/transactions',
  '/api/portfolio',
  '/api/reports',       // [FIX-REPORTS v12] Puppeteer PDF generation — JWT auth sufficient
  '/api/ipfs',          // [FIX-IPFS-CSRF v13] Pinata proxy — JWT auth sufficient
  '/health',
];

const csrfProtect = (req, res, next) => {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  if (CSRF_SKIP_EXACT.has(req.path))                                  return next();
  if (CSRF_SKIP_PREFIX.some(p => req.path.startsWith(p)))            return next();
  const secret = req.cookies?.[CSRF_SECRET_KEY];
  const token  = req.headers['x-csrf-token'];
  if (!secret || !token || secret !== token) {
    return res.status(403).json({
      error: 'Invalid or missing CSRF token. Refresh the page and try again.',
    });
  }
  next();
};

console.log('✅ CSRF protection active (stable double-submit cookie)');

const app    = express();
const server = http.createServer(app);
const PORT   = parseInt(process.env.PORT || '5000', 10);

app.set('trust proxy', 1);

if (Sentry?.Handlers) app.use(Sentry.Handlers.requestHandler());

app.use(compression());

app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use((req, res, next) => {
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc    : ["'self'"],
        scriptSrc     : ["'self'", `'nonce-${res.locals.cspNonce}'`],
        styleSrc      : ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc       : ["'self'", 'https://fonts.gstatic.com'],
        connectSrc    : [
          "'self'", 'wss:',
          'https://api.coingecko.com',
          'https://api.pinata.cloud',
          'https://gateway.pinata.cloud',
          'https://*.etherscan.io',
          'https://*.alchemy.com',
          'https://checkout.razorpay.com',
          'https://api.iexindia.com',
          'https://api.pxil.co.in',
        ],
        frameSrc      : ['https://api.razorpay.com', 'https://checkout.razorpay.com'],
        imgSrc        : ["'self'", 'data:', 'blob:', 'https://gateway.pinata.cloud'],
        objectSrc     : ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: IS_PROD ? [] : null,
      },
    },
    hsts: IS_PROD
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
  })(req, res, next);
});

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://ethertrackapp.vercel.app',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    console.warn(`[CORS] Blocked origin: ${origin}`);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials    : true,
  methods        : ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders : ['Content-Type', 'Authorization', 'X-CSRF-Token', 'Idempotency-Key'],
}));

app.use(cookieParser(process.env.COOKIE_SECRET));

app.use('/api/wallet/webhook',                express.raw({ type: 'application/json' }));
app.use('/api/subscription/webhook/razorpay', express.raw({ type: 'application/json' }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  maxAge: '1d', etag: true, dotfiles: 'deny',
}));

const limiter = (windowMs, max, message) =>
  rateLimit({ windowMs, max, message: { error: message }, standardHeaders: true, legacyHeaders: false });

app.use('/api/auth/login',          limiter(15 * 60 * 1000,  20,  'Too many login attempts. Try again later.'));
app.use('/api/auth/register',       limiter(60 * 60 * 1000,  10,  'Too many registrations. Try again later.'));
app.use('/api/auth/resend-otp',     limiter(60 * 60 * 1000,   5,  'Too many OTP requests. Try again later.'));
app.use('/api/auth',                limiter(15 * 60 * 1000, 100,  'Too many auth requests. Try again later.'));
app.use('/api/kyc/submit',        kycSubmitLimiter);
app.use('/api/kyc/:id/approve',   adminActionLimiter);
app.use('/api/kyc/:id/reject',    adminActionLimiter);
app.use('/api/kyc',                 limiter(60 * 60 * 1000,  20,  'Too many KYC attempts. Try again later.'));
app.use('/api/ipfs',                limiter(60 * 60 * 1000,  20,  'Too many file uploads. Try again later.'));
app.use('/api/certificates',        limiter(60 * 60 * 1000,  50,  'Too many PDF requests. Try again later.'));
app.use('/api/rates',               limiter(60 * 1000,        60,  'Too many rate requests.'));
app.use('/api/emissions/log',       limiter(60 * 1000,        30,  'Too many emission logs. Slow down.'));
app.use('/api/emissions/bulk',      limiter(60 * 60 * 1000,   10,  'Too many bulk imports. Try again later.'));
app.use('/api/brsr/environmental',  limiter(60 * 1000,        20,  'Too many BRSR saves. Slow down.'));
app.use('/api/ccts/profile',        limiter(60 * 1000,        20,  'Too many CCTS saves. Slow down.'));
app.use('/api/pat/profile',         limiter(60 * 1000,        20,  'Too many PAT saves. Slow down.'));
app.use('/api/compliance',          limiter(60 * 1000,        60,  'Too many compliance requests. Slow down.'));
app.use('/api/ccc',                 limiter(60 * 1000,       120,  'Too many price feed requests.'));
app.use('/api/suppliers',           limiter(60 * 1000,        60,  'Too many supplier requests. Slow down.'));
app.use('/api/subscription/order',        limiter(60 * 1000, 10, 'Too many payment requests. Slow down.'));
app.use('/api/subscription/verify',       limiter(60 * 1000, 10, 'Too many payment requests. Slow down.'));
app.use('/api/subscription/wallet-pay',   limiter(60 * 1000, 10, 'Too many payment requests. Slow down.'));
app.use('/api/subscription/metamask-pay', limiter(60 * 1000, 10, 'Too many payment requests. Slow down.'));
app.use('/api/reports/generate',    limiter(60 * 60 * 1000,  20,  'Too many report generation requests. Try again later.'));
app.use('/api/',                    limiter(15 * 60 * 1000,  500,  'Too many requests. Try again later.'));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(csrfProtect);

app.get('/api/auth/csrf', (req, res) => {
  seedCsrfToken(req, res);
  res.status(204).end();
});

const SERVER_START = Date.now();
const { safeQuery: healthQuery } = require('./db/pool');

app.get('/health', async (req, res) => {
  const t0 = Date.now();
  let dbOk = false, dbMs = null, dbErr = null;
  try {
    await healthQuery('SELECT 1');
    dbOk = true;
    dbMs = Date.now() - t0;
  } catch (e) {
    dbErr = e.message;
  }
  res.status(dbOk ? 200 : 503).json({
    ok      : dbOk,
    status  : dbOk ? 'healthy' : 'degraded',
    service : 'EtherTrack API',
    checks  : {
      database: dbOk
        ? { ok: true, latencyMs: dbMs }
        : { ok: false, error: dbErr },
    },
    uptimeMs: Date.now() - SERVER_START,
    time    : new Date().toISOString(),
    env     : process.env.NODE_ENV,
  });
});
app.get('/api/health', (req, res) => res.redirect('/health'));

// ── Routes ────────────────────────────────────────────────────────
app.use('/api/reports',       reportRoutes);      // [FIX-REPORTS v12] Puppeteer PDF
app.use('/api/market',        marketRoutes);
app.use('/api/verify',        verifyRoutes);
app.use('/api/news',          newsRoutes);
app.use('/api/auth',          authRoutes);
app.use('/api/wallet',        walletRoutes);
app.use('/api/user',          userRoutes);
app.use('/api/support',       userRoutes);
app.use('/api/org',           orgRoutes);
app.use('/api/kyc',           kycRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/alerts',        alertRoutes);
app.use('/api/watchlist',     watchlistRoutes);
app.use('/api/trades',        tradeRoutes);
app.use('/api/transactions',  transactionRoutes);
app.use('/api/registry',      registryRoutes);
app.use('/api/portfolio',     portfolioRoutes);
app.use('/api/emissions',     emissionRoutes);
app.use('/api/brsr',          brsrRoutes);
app.use('/api/pat',           patRoutes);
app.use('/api/ccts',          cctsRoutes);
app.use('/api/compliance',    cctsCFORoutes);
app.use('/api/ccc',           priceFeedRoutes);
app.use('/api/ipfs',          ipfsRoutes);
app.use('/api/certificates',  certPDFRoutes);
app.use('/api/cert',          certificateRoutes);
app.use('/api/entities',      entitiesRoutes);
app.use('/api/audit',         auditRoutes);
app.use('/api/admin',         adminRoutes);
app.use('/api/suppliers',     supplierRoutes);
app.use('/api/subscription',  subscriptionRoutes);

if (Sentry?.Handlers) app.use(Sentry.Handlers.errorHandler());

app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE')
    return res.status(400).json({ error: 'File too large. Maximum 5 MB.' });
  if (err.type === 'entity.too.large')
    return res.status(413).json({ error: 'Request body too large.' });
  if (err.message?.includes('CORS'))
    return res.status(403).json({ error: 'CORS policy violation.' });

  console.error('[GlobalError]', {
    message : err.message,
    stack   : process.env.NODE_ENV === 'development' ? err.stack : undefined,
    path    : req.path,
    method  : req.method,
  });

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : (err.message || 'Internal server error'),
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason);
  if (Sentry) Sentry.captureException(reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UncaughtException]', err);
  if (Sentry) Sentry.captureException(err);
  setTimeout(() => process.exit(1), 1000);
});

const shutdown = (signal) => {
  console.log(`\n[${signal}] Graceful shutdown initiated…`);
  stopPriceFeed();
  if (scheduler) scheduler.stop();
  server.close(() => {
    console.log('HTTP server closed');
    const { pool } = require('./db/pool');
    pool.end(() => {
      console.log('DB pool closed');
      process.exit(0);
    });
  });
  setTimeout(() => {
    console.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

server.listen(PORT, () => {
  console.log(`\n🌿 EtherTrack API running on port ${PORT}`);
  console.log(`   Environment : ${process.env.NODE_ENV}`);
  console.log(`   Health      : http://localhost:${PORT}/health\n`);

  try {
    const { init: initSocket } = require('./services/socketServer');
    initSocket(server);
    console.log('✅ Socket.io initialised');
  } catch {
    console.warn('⚠️  Socket.io not available');
  }

  if (process.env.ALCHEMY_RPC && process.env.MARKETPLACE_ADDRESS) {
    blockchain.init();
    console.log('✅ Blockchain listeners started');
  } else {
    console.warn('⚠️  Blockchain listeners skipped — missing ALCHEMY_RPC or MARKETPLACE_ADDRESS');
  }

  try {
    require('./cron/jobs');
    console.log('⏰ Cron jobs loaded');
  } catch (e) {
    console.warn('⚠️  cron/jobs not found:', e.message);
  }

  if (scheduler) {
    scheduler.start();
    console.log('⏰ Scheduler started');
  }

  startPriceFeed();
  console.log('📈 CCC price feed started');

  setTimeout(() => {
    checkSubscriptionExpiries().catch(err =>
      console.error('[org/checkSubscriptionExpiries] Initial run failed:', err.message)
    );
  }, 30_000);

  setInterval(
    () => checkSubscriptionExpiries().catch(err =>
      console.error('[org/checkSubscriptionExpiries] Scheduled run failed:', err.message)
    ),
    24 * 60 * 60 * 1000
  );
  console.log('📅 Subscription expiry cron started (first run in 30 s)');

  try {
    const { startEmailWorker } = require('./services/emailQueue');
    startEmailWorker();
    console.log('📧 Email queue worker started');
  } catch (e) {
    console.warn('⚠️  Email queue worker not started:', e.message);
  }
});

module.exports = app;