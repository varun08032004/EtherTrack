// src/utils/sentry.js
// Frontend Sentry setup
// Install: npm install @sentry/react
// Add to your .env: REACT_APP_SENTRY_DSN=your_dsn_here

import * as Sentry from '@sentry/react';

export const initSentry = () => {
  if (!process.env.REACT_APP_SENTRY_DSN) return;
  Sentry.init({
    dsn:              process.env.REACT_APP_SENTRY_DSN,
    environment:      process.env.NODE_ENV,
    release:          process.env.REACT_APP_VERSION || '1.0.0',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    // Don't send errors from localhost
    beforeSend: (event) => {
      if (window.location.hostname === 'localhost') return null;
      return event;
    },
  });
};

export const captureError = (err, context = {}) => {
  Sentry.captureException(err, { extra: context });
};

export { Sentry };