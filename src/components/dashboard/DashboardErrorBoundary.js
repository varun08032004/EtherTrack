/**
 * components/dashboard/DashboardErrorBoundary.jsx
 */

import React, { Component } from 'react';
import * as Sentry from '@sentry/react';
import s from './Dashboard.module.css';

export class DashboardErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    Sentry.captureException(error, { contexts: { react: info } });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className={s.ebWrap}>
        <div className={s.ebInner}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <div style={{ fontSize: 16, color: '#f0fdf4', fontWeight: 700, marginBottom: 8 }}>
            Dashboard failed to load
          </div>
          <div style={{ fontSize: 12, color: '#86efac66', marginBottom: 24, lineHeight: 1.7 }}>
            An unexpected error occurred. Your funds and credits are safe — this is a display issue only.
          </div>
          <button
            className={s.ebBtn}
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
          >
            RELOAD DASHBOARD
          </button>
          {process.env.NODE_ENV === 'development' && (
            <pre className={s.ebStack}>{this.state.error?.toString()}</pre>
          )}
        </div>
      </div>
    );
  }
}