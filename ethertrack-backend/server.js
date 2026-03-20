// server.js — EtherTrack API entry point
require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const cookieParser = require('cookie-parser');

// ── Route imports ─────────────────────────────────────────────────
const authRoutes        = require('./routes/auth');
const walletRoutes      = require('./routes/wallet');
const registryRoutes    = require('./routes/registry');
const transactionRoutes = require('./routes/transactions');
const emissionRoutes    = require('./routes/emissions');
const kycRoutes         = require('./routes/kyc');
const adminRoutes       = require('./routes/admin');
const portfolioRoutes   = require('./routes/portfolio');
const verifyRoutes      = require('./routes/verify');
const orgRoutes         = require('./routes/org');
const blockchain        = require('./services/blockchain');

// compliance.js exports BOTH helper functions (used by wallet.js) AND an express router
// Always destructure { router } — do not require the file directly as a router
const { router: complianceRoutes }    = require('./routes/compliance');
const { router: notificationRoutes }  = require('./routes/notifications');

const app  = express();
const PORT = process.env.PORT || 5000;

app.set('trust proxy', 1);
app.use(helmet());

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://ethertrackapp.vercel.app',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));

app.use(cookieParser());

// ─────────────────────────────────────────────────────────────────
// ⚠️  WEBHOOK RAW BODY — must be BEFORE express.json()
// Razorpay webhook needs the raw Buffer to verify HMAC signature.
// If express.json() runs first, signature verification WILL fail.
// ─────────────────────────────────────────────────────────────────
app.use('/api/wallet/webhook', express.raw({ type: 'application/json' }));

// ── Rate limiting ─────────────────────────────────────────────────
app.use('/api/auth/me', (req, res, next) => next()); // exempt /me

app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  skip: (req) => req.path === '/me' || req.path === '/refresh',
  message: { error: 'Too many auth requests, please try again later' },
}));

app.use('/api/kyc', rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: 'Too many KYC attempts, please try again later' },
}));

app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
}));

// ── Body parsers — AFTER webhook raw middleware ───────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Health check ──────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:  'ok',
    service: 'EtherTrack API',
    time:    new Date().toISOString(),
    env:     process.env.NODE_ENV,
  });
});

// ── Routes ────────────────────────────────────────────────────────
app.use('/api/auth',         authRoutes);
app.use('/api/wallet',       walletRoutes);
app.use('/api/compliance',     complianceRoutes);  // AML flags, TDS records, FEMA log, limit config
app.use('/api/notifications',  notificationRoutes); // real-time notifications
app.use('/api/registry',     registryRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/emissions',    emissionRoutes);
app.use('/api/kyc',          kycRoutes);
app.use('/api/admin',        adminRoutes);
app.use('/api/portfolio',    portfolioRoutes);
app.use('/api/verify',       verifyRoutes);
app.use('/api/org',          orgRoutes);

// ── 404 ───────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── Global error handler ──────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌿 EtherTrack API running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV}`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);

  if (process.env.ALCHEMY_RPC && process.env.MARKETPLACE_ADDRESS) {
    blockchain.init();
  } else {
    console.warn('⚠️  Blockchain listeners skipped — missing ALCHEMY_RPC or MARKETPLACE_ADDRESS in .env');
  }
});

module.exports = app;