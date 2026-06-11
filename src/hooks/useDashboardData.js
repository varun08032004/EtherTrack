/**
 * hooks/useDashboardData.js
 *
 * Manages all dashboard API data:
 *  - Platform stats, trades, emissions, news, INR balance, alerts, pending tx
 *  - Priority loading: critical data first, secondary data after
 *  - Per-key concurrent-fetch guards
 *  - Circuit breaker per endpoint family
 *  - Auto-retry on error (30 s debounce)
 *  - Refresh cooldown enforced via localStorage (UX) + server (security)
 */

import { useReducer, useCallback, useEffect, useRef } from 'react';
import { txAPI, apiFetch }              from '../services/api';
import { fetchWithTimeout, withRetry }  from '../utils/dashboard';
import { createCircuitBreaker }         from '../utils/circuitBreaker';
import { STATIC_NEWS_FALLBACK }         from '../constants/dashboard';
import {
  FETCH_TIMEOUT_MS,
  REFRESH_COOLDOWN_MS,
  PENDING_POLL_MS,
  ALERT_POLL_MS,
  HEALTH_POLL_MS,
  AUTO_RETRY_DELAY_MS,
  LS_KEY_REFRESH,
  CB_FAILURE_THRESHOLD,
  CB_OPEN_DURATION_MS,
} from '../constants/dashboard';
import { sanitizeNewsItem } from '../utils/dashboard';

// ── Circuit breakers (one per API family) ──────────────────────────────────
const CB = {
  stats:    createCircuitBreaker('stats',    { threshold: CB_FAILURE_THRESHOLD, openMs: CB_OPEN_DURATION_MS }),
  trades:   createCircuitBreaker('trades',   { threshold: CB_FAILURE_THRESHOLD, openMs: CB_OPEN_DURATION_MS }),
  emissions:createCircuitBreaker('emissions',{ threshold: CB_FAILURE_THRESHOLD, openMs: CB_OPEN_DURATION_MS }),
  news:     createCircuitBreaker('news',     { threshold: CB_FAILURE_THRESHOLD, openMs: CB_OPEN_DURATION_MS }),
  wallet:   createCircuitBreaker('wallet',   { threshold: CB_FAILURE_THRESHOLD, openMs: CB_OPEN_DURATION_MS }),
  network:  createCircuitBreaker('network',  { threshold: CB_FAILURE_THRESHOLD, openMs: CB_OPEN_DURATION_MS }),
};

// ── Reducer ────────────────────────────────────────────────────────────────
const INIT = {
  // INR balance
  inrBalance:   null,
  inrBalError:  false,

  // Platform stats
  platformStats:  null,
  statsError:     false,
  statsLoading:   true,
  statsTs:        null,

  // My trades
  myTrades:      [],
  tradesError:   false,
  tradesLoading: true,
  tradesTs:      null,

  // Emissions
  emissionsData:  null,
  emissionsError: false,
  emissionsTs:    null,

  // News
  newsItems:   STATIC_NEWS_FALLBACK,
  newsLive:    false,
  newsLoading: true,

  // Network
  networkStatus: { backend: 'CHECKING', backendMs: null },

  // Pending tx / alerts
  pendingTxCount: 0,
  alertCount:     0,

  // Global state
  isRefreshing:   false,
  sessionExpired: false,
};

function reducer(state, action) {
  switch (action.type) {
    case 'PATCH':  return { ...state, ...action.payload };
    default:       return state;
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────
export function useDashboardData() {
  const [state, dispatch] = useReducer(reducer, INIT);
  const patch = useCallback((payload) => dispatch({ type: 'PATCH', payload }), []);

  // Per-key in-flight guard
  const inFlight = useRef({});

  // ── Helpers ──────────────────────────────────────────────────────────────

  function guard(key, fn) {
    return async (...args) => {
      if (inFlight.current[key]) return;
      inFlight.current[key] = true;
      try {
        return await fn(...args);
      } finally {
        inFlight.current[key] = false;
      }
    };
  }

  function isSessionExpired(err) {
    return err?.message === 'session-expired';
  }

  function isCircuitOpen(err) {
    return err?.message?.startsWith('circuit-open:');
  }

  // ── Fetchers ─────────────────────────────────────────────────────────────

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchStats = useCallback(guard('stats', async () => {
    patch({ statsLoading: true, statsError: false });
    try {
      const data = await CB.stats.call(() =>
        withRetry(() => fetchWithTimeout(() => txAPI.getStats())),
      );
      patch({ platformStats: data, statsTs: Date.now() });
    } catch (err) {
      if (!isSessionExpired(err) && !isCircuitOpen(err)) patch({ statsError: true });
    } finally {
      patch({ statsLoading: false });
    }
  }), [patch]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchTrades = useCallback(guard('trades', async () => {
    patch({ tradesLoading: true, tradesError: false });
    try {
      // Pass limit to avoid over-fetching — server should support ?limit=4
      const data = await CB.trades.call(() =>
        withRetry(() => fetchWithTimeout(() => txAPI.getMy({ limit: 4 }))),
      );
      patch({ myTrades: (data?.transactions || []).slice(0, 4), tradesTs: Date.now() });
    } catch (err) {
      if (!isSessionExpired(err) && !isCircuitOpen(err)) patch({ tradesError: true });
    } finally {
      patch({ tradesLoading: false });
    }
  }), [patch]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchEmissions = useCallback(guard('emissions', async () => {
    patch({ emissionsError: false });
    try {
      const data = await CB.emissions.call(() =>
        withRetry(() => fetchWithTimeout(() => apiFetch('/api/emissions/my'))),
      );
      patch({ emissionsData: data, emissionsTs: Date.now() });
    } catch (err) {
      if (!isSessionExpired(err) && !isCircuitOpen(err)) patch({ emissionsError: true });
    }
  }), [patch]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchNews = useCallback(guard('news', async () => {
    patch({ newsLoading: true });
    try {
      const data = await CB.news.call(() =>
        withRetry(() => fetchWithTimeout(() => apiFetch('/api/news/carbon'))),
      );
      if (data?.items?.length) {
        patch({ newsItems: data.items.slice(0, 6).map(sanitizeNewsItem), newsLive: true });
      }
      // Static fallback stays if fetch fails or returns empty
    } catch { /* keep static fallback */ }
    finally {
      patch({ newsLoading: false });
    }
  }), [patch]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchInrBalance = useCallback(guard('inr', async () => {
    patch({ inrBalError: false });
    try {
      const data = await CB.wallet.call(() =>
        withRetry(() => fetchWithTimeout(() => apiFetch('/api/wallet/balance'))),
      );
      patch({ inrBalance: data?.balance ?? null });
    } catch (err) {
      if (!isSessionExpired(err) && !isCircuitOpen(err)) patch({ inrBalError: true });
    }
  }), [patch]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const checkNetwork = useCallback(guard('network', async () => {
    const t0 = Date.now();
    try {
      await CB.network.call(() =>
        fetchWithTimeout(() => apiFetch('/api/health'), 4_000),
      );
      patch({ networkStatus: { backend: 'ONLINE', backendMs: Date.now() - t0 } });
    } catch (err) {
      patch({
        networkStatus: {
          backend:   isCircuitOpen(err) ? 'DEGRADED' : 'DEGRADED',
          backendMs: null,
        },
      });
    }
  }), [patch]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pollPending = useCallback(guard('pending', async () => {
    try {
      const data = await fetchWithTimeout(() => apiFetch('/api/transactions/pending'), 5_000);
      patch({ pendingTxCount: data?.count || 0 });
    } catch { /* silent */ }
  }), [patch]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchAlerts = useCallback(guard('alerts', async () => {
    try {
      const data = await fetchWithTimeout(() => apiFetch('/api/alerts/my'), 5_000);
      patch({ alertCount: data?.count || 0 });
    } catch { /* silent */ }
  }), [patch]);

  // ── Session expiry listener ───────────────────────────────────────────────
  useEffect(() => {
    const handler = () => patch({ sessionExpired: true });
    window.addEventListener('auth/session-expired', handler);
    return () => window.removeEventListener('auth/session-expired', handler);
  }, [patch]);

  // ── Priority loading: critical first, secondary after ────────────────────
  useEffect(() => {
    // Phase 1: user-visible financial data
    Promise.allSettled([fetchStats(), fetchTrades(), fetchInrBalance()]).then(() => {
      // Phase 2: supporting data
      Promise.allSettled([fetchEmissions(), fetchNews()]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Health check polling (15 s — fast enough to catch degradation) ───────
  useEffect(() => {
    checkNetwork();
    const id = setInterval(checkNetwork, HEALTH_POLL_MS);
    return () => clearInterval(id);
  }, [checkNetwork]);

  // ── Pending tx polling ────────────────────────────────────────────────────
  useEffect(() => {
    pollPending();
    const id = setInterval(pollPending, PENDING_POLL_MS);
    return () => clearInterval(id);
  }, [pollPending]);

  // ── Alert polling ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetchAlerts();
    const id = setInterval(fetchAlerts, ALERT_POLL_MS);
    return () => clearInterval(id);
  }, [fetchAlerts]);

  // ── Auto-retry on error ───────────────────────────────────────────────────
  useEffect(() => {
    if (!state.statsError && !state.tradesError && !state.emissionsError) return;
    const id = setTimeout(() => {
      if (state.statsError)     fetchStats();
      if (state.tradesError)    fetchTrades();
      if (state.emissionsError) fetchEmissions();
    }, AUTO_RETRY_DELAY_MS);
    return () => clearTimeout(id);
  }, [state.statsError, state.tradesError, state.emissionsError, fetchStats, fetchTrades, fetchEmissions]);

  // ── Refresh (all keys) ────────────────────────────────────────────────────
  const refresh = useCallback(async (ethRateForceRefresh) => {
    const stored = Number(localStorage.getItem(LS_KEY_REFRESH) || 0);
    if (Date.now() - stored < REFRESH_COOLDOWN_MS) return false;
    localStorage.setItem(LS_KEY_REFRESH, String(Date.now()));

    patch({ isRefreshing: true });
    // Reset all in-flight guards
    inFlight.current = {};

    await Promise.allSettled([
      fetchStats(), fetchTrades(), fetchEmissions(), fetchNews(),
      fetchInrBalance(), fetchAlerts(),
    ]);
    if (ethRateForceRefresh) ethRateForceRefresh();

    patch({ isRefreshing: false });
    return true;
  }, [patch, fetchStats, fetchTrades, fetchEmissions, fetchNews, fetchInrBalance, fetchAlerts]);

  return {
    state,
    actions: {
      fetchStats, fetchTrades, fetchEmissions,
      fetchNews, fetchInrBalance, fetchAlerts,
      checkNetwork, refresh,
    },
  };
}