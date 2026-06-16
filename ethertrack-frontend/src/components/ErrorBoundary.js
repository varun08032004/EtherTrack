// src/components/ErrorBoundary.jsx — EtherTrack
// PRODUCTION HARDENED
// Fixes:
//   [FIX-1] captureError import wrapped in try/catch — Sentry missing never masks original error
//   [FIX-2] Try Again forces remount via key increment — data-driven errors actually reset
//   [FIX-3] Error details never shown in production (no sensitive stack leaks)
//   [FIX-4] onReset prop allows parent to clear bad state before remount
//   [FIX-5] componentDidCatch logs even if Sentry is absent

import React from 'react';

// [FIX-1] Lazy Sentry import — never throws if not configured
let _captureError = null;
try {
  const sentry = require('../utils/sentry');
  _captureError = sentry?.captureError || null;
} catch {}

const safeCapture = (error, context) => {
  if (!_captureError) return;
  try { _captureError(error, context); } catch {}
};

const isDev = process.env.NODE_ENV === 'development';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    // [FIX-2] remountKey increments on reset, forcing genuine child remount
    this.state = { hasError: false, error: null, remountKey: 0 };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // [FIX-5] Always log, regardless of Sentry status
    console.error('[ErrorBoundary]', error, info?.componentStack);
    safeCapture(error, { componentStack: info?.componentStack });

    // Call optional parent error handler
    if (typeof this.props.onError === 'function') {
      try { this.props.onError(error, info); } catch {}
    }
  }

  handleReset = () => {
    // [FIX-4] Call parent onReset so it can clear bad props/state first
    if (typeof this.props.onReset === 'function') {
      try { this.props.onReset(); } catch {}
    }
    // [FIX-2] Increment key to force genuine remount of children
    this.setState(prev => ({
      hasError    : false,
      error       : null,
      remountKey  : prev.remountKey + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      // [FIX-3] Never expose stack traces in production
      const message = isDev
        ? (this.state.error?.message || 'An unexpected error occurred')
        : 'An unexpected error occurred. Our team has been notified.';

      return (
        <div
          role="alert"
          style={{
            padding      : '32px 24px',
            background   : '#0e0505',
            border       : '1px solid #f8717133',
            borderRadius : 12,
            textAlign    : 'center',
            color        : '#f87171',
            fontFamily   : 'DM Mono, monospace',
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
            Something went wrong in this section
          </div>
          <div style={{ fontSize: 11, color: '#f8717166', marginBottom: 16 }}>
            {message}
          </div>
          <button
            onClick={this.handleReset}
            style={{
              padding      : '8px 18px',
              borderRadius : 6,
              border       : '1px solid #f8717133',
              background   : '#1a0707',
              color        : '#f87171',
              cursor       : 'pointer',
              fontFamily   : 'DM Mono, monospace',
              fontSize     : 11,
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    // [FIX-2] key prop forces React to fully unmount + remount after reset
    return (
      <React.Fragment key={this.state.remountKey}>
        {this.props.children}
      </React.Fragment>
    );
  }
}