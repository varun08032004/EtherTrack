// server.js — EtherTrack API
// PRODUCTION HARDENED — v17
// ─────────────────────────────────────────────────────────────────────────────
// CHANGES vs v16:
//
// [FIX-BRSR-DATA-MOUNT]  Mounted routes/brsrDataRoutes.js at /api/brsr,
//                       alongside the existing routes/brsr.js on the same
//                       base path. brsrDataRoutes.js (Section A, Section B,
//                       principles P1-P5/P7-P9, and the /all/:year snapshot
//                       used by report generation) was fully written but
//                       never required or app.use()'d anywhere in this file —
//                       every route inside it has been 404ing since it was
//                       added. No path collisions with routes/brsr.js (that
//                       file only owns /environmental and a few others);
//                       mounted directly after it to match the ordering
//                       brsrDataRoutes.js's own header comment expects.
//                       Left OFF the CSRF_SKIP_PREFIX list on purpose — its
//                       POST endpoints are normal authenticated writes from
//                       the logged-in frontend and should carry the CSRF
//                       token like every other write route.
//
// CHANGES vs v15 (retained from v16):
//
// [FIX-INVOICE-VERIFY]  Mounted /api/invoices → routes/invoiceVerify.js —
//                       public, unauthenticated lookup backing the QR code
//                       printed on every trade invoice/bill (GET
//                       /api/invoices/verify/:invoiceNumber). Named
//                       "invoiceVerify" rather than "verify" to avoid
//                       colliding with the existing routes/verify.js already
//                       mounted at /api/verify. GET-only, so no CSRF_SKIP_PREFIX
//                       entry needed — csrfProtect already skips all
//                       GET/HEAD/OPTIONS requests before the skip-list checks
//                       even run. Rate limiting for this route lives inside
//                       routes/invoiceVerify.js itself (30/min per IP), on top
//                       of the general /api/ limiter below.
//
// CHANGES vs v14 (retained from v15):
//
// [FIX-ERP-ROUTE]  Mounted /api/erp → routes/erp.js (new ERP Connect module).
//                  Added to CSRF_SKIP_PREFIX — ERP OAuth callbacks (/zoho/callback,
//                  /quickbooks/callback) arrive as GET redirects from the ERP
//                  provider and carry no CSRF cookie; all mutating endpoints are
//                  protected by JWT `requireAuth`. Same pattern as /api/reports.
//                  Added rate limiters for /api/erp/*/test (10/hr per IP) and
//                  /api/erp/*/pull (5/hr per IP) to prevent credential stuffing
//                  and runaway sync loops.
//                  initErpCron(db) called after server starts — schedules
//                  per-org ERP syncs (daily/weekly/monthly per sync_config).
//                  Added ERP_CREDS_KEY to REQUIRED_ENV in production.
//
// [OPS-INTEGRATION-WRITE]  Mounted 3 new write surfaces for the internal ops
//                  ERP (etpl_ops): /api/ops-integration-corporate,
//                  /api/ops-integration-coupons, /api/ops-integration-pricing.
//                  Each is a separate route file/mount/env-var token from the
//                  existing read-only /api/ops-integration — see
//                  routes/opsIntegrationCorporate.js's header comment for the
//                  isolation reasoning. Added their 3 tokens to OPTIONAL_ENV.
//
// All v14 fixes retained.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

require('dotenv').config();

const IS_PROD = process.env.NODE_ENV === 'production';

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
  // [FIX-ERP-ROUTE v15] Required in prod — AES-256 key for ERP credential encryption
  ...(IS_PROD ? ['ERP_CREDS_KEY'] : []),
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
  'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM',
  'REDIS_URL',
  'BASE_URL',         // [FIX-ERP-ROUTE v15] Used for OAuth callbacks
  'ERP_CREDS_KEY',    // [FIX-ERP-ROUTE v15] Required in prod, optional in dev
  // Chain logging (Sepolia testnet → Polygon mainnet later)
  'CHAIN_SIGNER_PRIVATE_KEY',   // backend hot wallet signs INR trade logs
  'SIGNER_WALLET',              // public address of CHAIN_SIGNER_PRIVATE_KEY
  'POLYGON_RPC_URL',            // Sepolia: use ALCHEMY_RPC value here too
  'POLYGON_NETWORK',            // 'sepolia' or 'polygon'
  'COMPANY_USER_ID',            // DB id of platform@ethertrack.in
  'COMPANY_FUND_ACCOUNT_ID',    // Razorpay fund account for fee sweep
  // [OPS-INTEGRATION-WRITE] ERP (etpl_ops) write-back tokens — each isolated
  // per surface. Unset = that surface hard-403s every call (see
  // middleware/serviceAuth.js), it does NOT silently accept requests, so
  // it's safe to leave unset until you're ready to wire the ERP side up.
  'PLATFORM_SYNC_CORPORATE_WRITE_TOKEN', // ERP activates/renews Corporate deals
  'PLATFORM_SYNC_COUPON_WRITE_TOKEN',    // ERP creates/manages coupon codes
  'PLATFORM_SYNC_PRICING_WRITE_TOKEN',   // ERP pushes Starter/Growth prices
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
      tracesSampleRate: IS_PROD ? 0.2 : 0,
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
const operatorTradingRoutes = require('./routes/operator-trading');
const verifyRoutes      = require('./routes/verify');
// [FIX-INVOICE-VERIFY v16] Public invoice/bill QR-code verification lookup.
// Separate file/mount from routes/verify.js above (which already owns /api/verify
// for something else) to avoid overwriting existing behavior.
const invoiceVerifyRoutes = require('./routes/invoiceVerify');
const opsIntegrationRoutes = require('./routes/opsIntegration'); // read-only revenue feed for the internal ops ERP (etpl_ops)
// [OPS-INTEGRATION-WRITE] Scoped write surfaces for the internal ops ERP —
// each isolated on its own path + its own service-token env var, so a leak
// of one never grants access to another (or to the read-only sync above).
const opsIntegrationCorporateRoutes = require('./routes/opsIntegrationCorporate'); // WRITE — Corporate deal activation/renewal
const opsIntegrationCouponsRoutes   = require('./routes/opsIntegrationCoupons');   // WRITE — coupon code management
const opsIntegrationPricingRoutes   = require('./routes/opsIntegrationPricing');   // WRITE — Starter/Growth dynamic pricing
const tradeRoutes       = require('./routes/trades');
const marketRoutes      = require('./routes/market');
const ipfsRoutes        = require('./routes/ipfsRoute');
const certPDFRoutes     = require('./routes/certificatePDF');
const blockchain        = require('./services/blockchain');
const userRoutes        = require('./routes/user');
const watchlistRoutes   = require('./routes/watchlist');
const certificateRoutes = require('./routes/certificates');
const entitiesRoutes    = require('./routes/entities');
const auditRoutes                = require('./routes/audit');
const auditorVerificationRoutes  = require('./routes/auditor-verification');
const auditorAccessRoutes        = require('./routes/audit-auditor-access');
const brsrRoutes        = require('./routes/brsr');
// [FIX-BRSR-DATA-MOUNT v17] Section A/B/principles data layer — same base
// path as brsrRoutes above, no route collisions (see mount comment below).
const brsrDataRoutes    = require('./routes/brsrDataRoutes');
const patRoutes         = require('./routes/pat');
const cctsRoutes        = require('./routes/ccts');
const alertRoutes       = require('./routes/alerts');
const newsRoutes        = require('./routes/news');
const supportRoutes     = require('./routes/support');
const orgRoutes                     = require('./routes/org');
const { checkSubscriptionExpiries } = require('./routes/org');
const { router: notificationRoutes }= require('./routes/notifications');
const cctsCFORoutes   = require('./routes/compliance');
const priceFeedRoutes = require('./routes/priceFeed');
const supplierRoutes  = require('./routes/suppliers');
const subscriptionRoutes = require('./routes/subscription');
const { kycSubmitLimiter, adminActionLimiter } = require('./middleware/rateLimit');
const reportRoutes = require('./routes/reports');
// [FIX-ERP-ROUTE v15] ERP Connect — all 6 ERPs + cron scheduler
const { router: erpRoutes, initErpCron } = require('./routes/erp');

const { startPolling: startPriceFeed, stopPolling: stopPriceFeed } =
  require('./services/priceFeedService');

let scheduler = null;
try {
  scheduler = require('./services/scheduler');
} catch (e) {
  console.warn('⚠️  scheduler.js not found:', e.message);
}

const CSRF_SECRET_KEY = '_csrf_secret';
const CSRF_TOKEN_KEY  = 'XSRF-TOKEN';

const seedCsrfToken = (req, res) => {
  const existing = req.cookies?.[CSRF_SECRET_KEY];
  const secret   = existing || crypto.randomBytes(32).toString('hex');
  const OPTS = {
    sameSite: IS_PROD ? 'none' : 'lax',
    secure:   IS_PROD,
    maxAge:   24 * 60 * 60 * 1000,
  };
  res.cookie(CSRF_SECRET_KEY, secret, { ...OPTS, httpOnly: true  });
  res.cookie(CSRF_TOKEN_KEY,  secret, { ...OPTS, httpOnly: false });
  return secret;
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

const CSRF_SKIP_PREFIX = [
  '/api/wallet/webhook',
  '/api/subscription/webhook',
  // [FIX-INVOICE-VERIFY v16] GET-only in practice, but listed for clarity/
  // consistency with the rest of this list — csrfProtect already lets all
  // GET/HEAD/OPTIONS requests through before this list is even consulted,
  // so this entry is a no-op safety net rather than a functional requirement.
  '/api/invoices',
  '/api/kyc/stream',
  // [FIX-ERP-ROUTE v15] OAuth callbacks arrive as GET redirects from providers
  // (no CSRF cookie). Mutating endpoints all require JWT `requireAuth`.
  // NOTE: /api/erp/test and /api/erp/pull are now CSRF-protected (use cookie auth)
  '/api/erp',
  // [OPS-INTEGRATION-WRITE] Service-token authenticated (X-Service-Token
  // header, checked in middleware/serviceAuth.js), never carries a session
  // cookie, so the double-submit CSRF cookie check doesn't apply here —
  // same reasoning as the existing read-only /api/ops-integration.
  '/api/ops-integration-corporate',
  '/api/ops-integration-coupons',
  '/api/ops-integration-pricing',
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

// ── Request ID correlation middleware ────────────────────────────────────────
const { v4: uuidv4 } = require('uuid');
app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || uuidv4();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
});

// ── Request/Response structured logging ──────────────────────────────────────
const logger = require('./services/logger');
const { featureFlags } = require('./lib/featureFlags');

// Run initial health checks (async IIFE)
(async () => {
  try {
    await featureFlags.runHealthChecks();
    logger.info({ flags: featureFlags.getByCategory('blockchain') }, 'Feature flags initialized');
  } catch (e) {
    logger.error({ err: e.message }, 'Feature flags initialization failed');
  }
})();

const start = process.hrtime.bigint();

// ── Request/Response structured logging middleware ─────────────────────────────
app.use((req, res, next) => {
  const reqStart = process.hrtime.bigint();
  
  // Capture response finish
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - reqStart) / 1_000_000;
    const logData = {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      query: req.query,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs),
      userAgent: req.get('user-agent'),
      ip: req.ip,
      userId: req.user?.id,
    };
    
    if (res.statusCode >= 500) {
      logger.error(logData, 'Request completed with server error');
    } else if (res.statusCode >= 400) {
      logger.warn(logData, 'Request completed with client error');
    } else {
      logger.info(logData, 'Request completed');
    }
  });
  
  next();
});

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
          // [FIX-ERP-ROUTE v15] ERP OAuth providers
          'https://accounts.zoho.in',
          'https://accounts.zoho.com',
          'https://accounts.zoho.eu',
          'https://accounts.zoho.com.au',
          'https://appcenter.intuit.com',
          'https://oauth.platform.intuit.com',
          'https://login.microsoftonline.com',
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
  'https://app.ethertrack.in',
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
  allowedHeaders : ['Content-Type', 'Authorization', 'X-CSRF-Token', 'Idempotency-Key', 'X-Service-Token'],
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
// [FIX-BRSR-DATA-MOUNT v17] Same modest ceiling as /environmental above,
// now that section-a/section-b/principle saves are actually reachable.
app.use('/api/brsr/section-a',      limiter(60 * 1000,        20,  'Too many BRSR saves. Slow down.'));
app.use('/api/brsr/section-b',      limiter(60 * 1000,        20,  'Too many BRSR saves. Slow down.'));
app.use('/api/brsr/principle',      limiter(60 * 1000,        20,  'Too many BRSR saves. Slow down.'));
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
app.use('/api/support/tickets',     limiter(60 * 60 * 1000,  10,  'Too many support tickets submitted. Try again later.'));
// [FIX-ERP-ROUTE v15] ERP-specific rate limits
app.use('/api/erp/:erpId/test',     limiter(60 * 60 * 1000,  10,  'Too many ERP connection tests. Try again later.'));
app.use('/api/erp/:erpId/pull',     limiter(60 * 60 * 1000,   5,  'Too many ERP data pulls. Try again later.'));
app.use('/api/erp',                 limiter(15 * 60 * 1000,  60,  'Too many ERP requests. Try again later.'));
app.use('/api/ops-integration',     limiter(60 * 1000,        20,  'Too many sync requests. Try again later.'));
// [OPS-INTEGRATION-WRITE] Each write surface gets its own modest ceiling —
// these are internal, low-volume, staff-triggered calls, not user traffic.
app.use('/api/ops-integration-corporate', limiter(60 * 1000, 20, 'Too many requests. Try again later.'));
app.use('/api/ops-integration-coupons',   limiter(60 * 1000, 30, 'Too many requests. Try again later.'));
app.use('/api/ops-integration-pricing',   limiter(60 * 1000, 30, 'Too many requests. Try again later.'));
// [FIX-INVOICE-VERIFY v16] Public QR-scan endpoint — modest per-IP ceiling on
// top of the route's own internal limiter (30/min), since this is reachable
// by anyone who scans a printed invoice, not just logged-in users.
app.use('/api/invoices',            limiter(60 * 1000,        40,  'Too many verification requests. Slow down.'));
app.use('/api/',                    limiter(15 * 60 * 1000,  500,  'Too many requests. Try again later.'));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(csrfProtect);

app.get('/api/auth/csrf', (req, res) => {
  const csrfToken = seedCsrfToken(req, res);
  res.json({ csrfToken });
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

// ── Feature flags API (admin) ──────────────────────────────────────────────────
const { authenticate, requireRole } = require('./middleware/auth');
app.get('/api/admin/feature-flags', authenticate, requireRole('admin'), (req, res) => {
  res.json({ flags: featureFlags.getAll() });
});
app.post('/api/admin/feature-flags/:name', authenticate, requireRole('admin'), (req, res) => {
  const { name } = req.params;
  const { value } = req.body;
  if (typeof value !== 'boolean') return res.status(400).json({ error: 'value must be boolean' });
  const success = featureFlags.set(name, value, 'admin');
  if (!success) return res.status(404).json({ error: 'Flag not found' });
  res.json({ success: true, flag: name, value });
});
app.post('/api/admin/feature-flags/:name/reset', authenticate, requireRole('admin'), (req, res) => {
  const { name } = req.params;
  const success = featureFlags.reset(name);
  if (!success) return res.status(404).json({ error: 'Flag not found' });
  res.json({ success: true, flag: name, value: featureFlags.get(name) });
});

// ── Feature flags middleware ──────────────────────────────────────────────────
app.use((req, res, next) => {
  req.featureFlags = {
    get: (name) => featureFlags.get(name),
    getAll: () => featureFlags.getAll(),
    getByCategory: (cat) => featureFlags.getByCategory(cat),
    isInrOnly: () => featureFlags.get('inrOnlyMode'),
    isBlockchainEnabled: () => featureFlags.get('blockchain.enabled')
  };
  res.setHeader('X-Feature-Flags', JSON.stringify(featureFlags.getByCategory('blockchain')));
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/reports',       reportRoutes);
app.use('/api/market',        marketRoutes);
app.use('/api/verify',        verifyRoutes);
// [FIX-INVOICE-VERIFY v16] Public invoice/bill verification (QR code target)
app.use('/api/invoices',      invoiceVerifyRoutes);
app.use('/api/ops-integration', opsIntegrationRoutes); // scoped, read-only — see SRS §18.8
// [OPS-INTEGRATION-WRITE] Scoped, write — Corporate/coupons/pricing only,
// each gated by its own service-token env var (see middleware/serviceAuth.js).
app.use('/api/ops-integration-corporate', opsIntegrationCorporateRoutes);
app.use('/api/ops-integration-coupons',   opsIntegrationCouponsRoutes);
app.use('/api/ops-integration-pricing',   opsIntegrationPricingRoutes);
app.use('/api/news',          newsRoutes);
app.use('/api/auth',          authRoutes);
app.use('/api/wallet',        walletRoutes);
app.use('/api/user',          userRoutes);
app.use('/api/support',       supportRoutes);
app.use('/api/org',           orgRoutes);
app.use('/api/kyc',           kycRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/alerts',        alertRoutes);
app.use('/api/watchlist',     watchlistRoutes);
app.use('/api/trades',        tradeRoutes);
app.use('/api/transactions',  transactionRoutes);
app.use('/api/registry',      registryRoutes);
app.use('/api/portfolio',     portfolioRoutes);
app.use('/api/portfolio',     operatorTradingRoutes);
app.use('/api/emissions',     emissionRoutes);
app.use('/api/brsr',          brsrRoutes);
// [FIX-BRSR-DATA-MOUNT v17] Section A/B/principles + /all/:year snapshot.
// Mounted on the SAME base path as brsrRoutes above — Express matches
// sub-paths in registration order and there's no overlap (brsrRoutes owns
// /environmental etc.; brsrDataRoutes owns /section-a, /section-b,
// /principle/:id, /all/:year), so both routers happily coexist here.
app.use('/api/brsr',          brsrDataRoutes);
app.use('/api/pat',           patRoutes);
app.use('/api/ccts',          cctsRoutes);
app.use('/api/compliance',    cctsCFORoutes);
app.use('/api/ccc',           priceFeedRoutes);
app.use('/api/ipfs',          ipfsRoutes);
app.use('/api/certificates',  certPDFRoutes);
app.use('/api/cert',          certificateRoutes);
app.use('/api/entities',      entitiesRoutes);
app.use('/api/audit',         auditRoutes);
app.use('/api/audit',         auditorVerificationRoutes);
app.use('/api/audit',         auditorAccessRoutes);
app.use('/api/admin',         adminRoutes);
app.use('/api/suppliers',     supplierRoutes);
app.use('/api/subscription',  subscriptionRoutes);
app.use('/api/erp',           erpRoutes); // [FIX-ERP-ROUTE v15]

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
    error: IS_PROD
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

  // ── Blockchain initialization (feature flag controlled) ──────────────────────
  if (featureFlags.get('blockchain.enabled')) {
    if (process.env.ALCHEMY_RPC && process.env.MARKETPLACE_ADDRESS) {
      blockchain.init();
      console.log('✅ Blockchain listeners started');
    } else {
      console.warn('⚠️  Blockchain listeners skipped — missing ALCHEMY_RPC or MARKETPLACE_ADDRESS');
      // Auto-disable blockchain features if config missing
      featureFlags.set('blockchain.enabled', false, 'config');
      featureFlags.set('inrOnlyMode', true, 'config');
    }
  } else {
    console.log('🔄 INR-only mode active — blockchain features disabled');
    featureFlags.set('inrOnlyMode', true, 'config');
  }

  // ── Chain logger crons (INR/Razorpay trade on-chain logging) ──────────────
  // POLYGON_RPC_URL falls back to ALCHEMY_RPC (which is Ankr Sepolia URL)
  if (!process.env.POLYGON_RPC_URL && process.env.ALCHEMY_RPC) {
    process.env.POLYGON_RPC_URL = process.env.ALCHEMY_RPC;
    console.log('ℹ️  POLYGON_RPC_URL set from ALCHEMY_RPC');
  }

  if (featureFlags.get('blockchain.chainLogging') && process.env.CHAIN_SIGNER_PRIVATE_KEY && process.env.MARKETPLACE_ADDRESS) {
    try {
      const chainLogger  = require('./services/chainLogger');
      const feeOps       = require('./services/feeOperations');
      const nodeCron     = require('node-cron');

      // Retry failed chain logs — every 5 minutes
      nodeCron.schedule('*/5 * * * *', () =>
        chainLogger.retryPendingLogs().catch(e =>
          console.error('[cron/chainLogger] retryPendingLogs failed:', e.message)
        )
      );

      // Batch log unlogged INR trades — every hour
      nodeCron.schedule('0 * * * *', () =>
        chainLogger.batchLogPending().catch(e =>
          console.error('[cron/chainLogger] batchLogPending failed:', e.message)
        )
      );

      // Sweep platform fees to company bank — every Monday 10am IST (4:30am UTC)
      nodeCron.schedule('30 4 * * 1', () =>
        feeOps.sweepPlatformFees().catch(e =>
          console.error('[cron/feeOps] sweepPlatformFees failed:', e.message)
        )
      );

      console.log('⛓  Chain logger crons started (retry/5min, batch/1hr, sweep/weekly)');
    } catch (e) {
      console.warn('⚠️  Chain logger crons not started:', e.message);
    }
  } else {
    console.warn('⚠️  Chain logger crons skipped — missing CHAIN_SIGNER_PRIVATE_KEY or MARKETPLACE_ADDRESS');
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

  // [FIX-ERP-ROUTE v15] Start ERP sync cron scheduler
  // Reads sync_config per org from DB and schedules daily/weekly/monthly syncs.
  // Re-polls every 5 min for new/changed configs. Runs in IST timezone.
  try {
    const { pool: db } = require('./db/pool');
    initErpCron(db).then(() => {
      console.log('🔌 ERP sync cron scheduler started');
    }).catch(e => {
      console.warn('⚠️  ERP cron scheduler failed to start:', e.message);
    });
  } catch (e) {
    console.warn('⚠️  ERP cron scheduler not started:', e.message);
  }

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

  // CreditLedger reconciliation cron — runs hourly to detect on-chain/DB drift
  const { reconcileAllBalances } = require('./services/creditLedger');
  const runCreditLedgerReconciliation = async () => {
    try {
      const mismatches = await reconcileAllBalances();
      if (mismatches.length === 0) {
        console.log('[CreditLedger] Reconciliation complete — all balances match');
      }
    } catch (e) {
      console.error('[CreditLedger] Reconciliation cron error:', e.message);
    }
  };
  // Run once at startup
  setTimeout(runCreditLedgerReconciliation, 60_000);
  // Then every hour
  setInterval(runCreditLedgerReconciliation, 60 * 60 * 1000);
  console.log('🔍 CreditLedger reconciliation cron started (first run in 60 s, then hourly)');

  // ── Critical data backup cron (daily at 2:30 AM IST = 21:00 UTC) ────────────
  try {
    const nodeCron = require('node-cron');
    nodeCron.schedule('0 21 * * *', () => {
      const { fork } = require('child_process');
      const backupProcess = fork('./scripts/backup-cron.js');
      backupProcess.on('exit', (code) => {
        if (code !== 0) console.error('[Backup] Cron exited with code', code);
      });
      backupProcess.on('error', (err) => console.error('[Backup] Fork error:', err.message));
    }, { timezone: 'Asia/Kolkata' });
    console.log('💾 Critical data backup cron scheduled (daily 2:30 AM IST)');
  } catch (e) {
    console.warn('⚠️  Backup cron not started:', e.message);
  }

  try {
    const { startEmailWorker } = require('./services/email');
    startEmailWorker();
    console.log('📧 Email queue worker started');
  } catch (e) {
    console.warn('⚠️  Email queue worker not started:', e.message);
  }
});

module.exports = app;