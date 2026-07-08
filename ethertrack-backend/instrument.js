// instrument.js
require('dotenv').config(); // load env vars before Sentry.init needs SENTRY_DSN

const Sentry = require('@sentry/node');

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 0,
  });
  console.log('✅ Sentry error monitoring active');
} else {
  console.warn('⚠️  SENTRY_DSN not set — error monitoring disabled');
}

module.exports = Sentry;