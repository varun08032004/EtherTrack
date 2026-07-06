/**
 * hooks/useDashboardData.js
 *
 * [FEAT-ESG-SUMMARY] Added esgData, esgError, esgTs + fetchEsg() action.
 *   - Fetches /api/brsr/esg-summary/:year after critical data loads (Phase 2)
 *   - Exposed in state as ds.esgData — consumed by EmissionOffsetCard
 *   - Auto-retried on error alongside emissions
 *   - Non-blocking — never delays Phase 1 (stats/trades/inr)
 *
 * All existing behaviour unchanged.
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

// ── Circuit breakers ───────────────────────────────────────────────────────
const CB = {
  stats:    createCircuitBreaker('stats',    { threshold: CB_FAILURE_THRESHOLD, openMs: CB_OPEN_DURATION_MS }),
  trades:   createCircuitBreaker('trades',   { threshold: CB_FAILURE_THRESHOLD, openMs: CB_OPEN_DURATION_MS }),
  emissions:createCircuitBreaker('emissions',{ threshold: CB_FAILURE_THRESHOLD, openMs: CB_OPEN_DURATION_MS }),
  news:     createCircuitBreaker('news',     { threshold: CB_FAILURE_THRESHOLD, openMs: CB_OPEN_DURATION_MS }),
  wallet:   createCircuitBreaker('wallet',   { threshold: CB_FAILURE_THRESHOLD, openMs: CB_OPEN_DURATION_MS }),
  network:  createCircuitBreaker('network',  { threshold: CB_FAILURE_THRESHOLD, openMs: CB_OPEN_DURATION_MS }),
  esg:      createCircuitBreaker('esg',      { threshold: CB_FAILURE_THRESHOLD, openMs: CB_OPEN_DURATION_MS }), // [FEAT-ESG-SUMMARY]
};

// ── Reducer ────────────────────────────────────────────────────────────────
const INIT = {
  // INR balance
  inrBalance:  null,
  inrBalError: false,

  // Platform stats
  platformStats: null,
  statsError:    false,
  statsLoading:  true,
  statsTs:       null,

  // My trades
  myTrades:      [],
  tradesError:   false,
  tradesLoading: true,
  tradesTs:      null,

  // Emissions (basic — from /api/emissions/my)
  emissionsData:  null,
  emissionsError: false,
  emissionsTs:    null,

  // [FEAT-ESG-SUMMARY] Full ESG summary from /api/brsr/esg-summary/:year
  // Shape: { emissions:{}, offsets:{}, net:{}, brsr:{}, frameworks:[], ready_for_submission }
  esgData:  null,
  esgError: false,
  esgTs:    null,

  // News
  newsItems:   STATIC_NEWS_FALLBACK,
  newsLive:    false,
  newsLoading: true,

  // Network
  networkStatus: { backend: 'CHECKING', backendMs: null },

  // Pending tx / alerts
  pendingTxCount: 0,
  alertCount:     0,

  // Global
  isRefreshing:   false,
  sessionExpired: false,
};

function reducer(state, action) {
  switch (action.type) {
    case 'PATCH': return { ...state, ...action.payload };
    default:      return state;
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────
export function useDashboardData() {
  const [state, dispatch] = useReducer(reducer, INIT);
  const patch = useCallback((payload) => dispatch({ type: 'PATCH', payload }), []);

  const inFlight = useRef({});

  function guard(key, fn) {
    return async (...args) => {
      if (inFlight.current[key]) return;
      inFlight.current[key] = true;
      try { return await fn(...args); }
      finally { inFlight.current[key] = false; }
    };
  }

  function isSessionExpired(err) { return err?.message === 'session-expired'; }
  function isCircuitOpen(err)    { return err?.message?.startsWith('circuit-open:'); }

  // ── Fetchers ─────────────────────────────────────────────────────────────

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchStats = useCallback(guard('stats', async () => {
    patch({ statsLoading: true, statsError: false });
    try {
      const data = await CB.stats.call(() => withRetry(() => fetchWithTimeout(() => txAPI.getStats())));
      patch({ platformStats: data, statsTs: Date.now() });
    } catch (err) {
      if (!isSessionExpired(err) && !isCircuitOpen(err)) patch({ statsError: true });
    } finally { patch({ statsLoading: false }); }
  }), [patch]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchTrades = useCallback(guard('trades', async () => {
    patch({ tradesLoading: true, tradesError: false });
    try {
      const data = await CB.trades.call(() => withRetry(() => fetchWithTimeout(() => txAPI.getMy({ limit: 4 }))));
      patch({ myTrades: (data?.transactions || []).slice(0, 4), tradesTs: Date.now() });
    } catch (err) {
      if (!isSessionExpired(err) && !isCircuitOpen(err)) patch({ tradesError: true });
    } finally { patch({ tradesLoading: false }); }
  }), [patch]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchEmissions = useCallback(guard('emissions', async () => {
    patch({ emissionsError: false });
    try {
      const data = await CB.emissions.call(() => withRetry(() => fetchWithTimeout(() => apiFetch('/api/emissions/my'))));
      patch({ emissionsData: data, emissionsTs: Date.now() });
    } catch (err) {
      if (!isSessionExpired(err) && !isCircuitOpen(err)) patch({ emissionsError: true });
    }
  }), [patch]);

  // [FEAT-ESG-SUMMARY] Fetch full ESG summary for current year
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchEsg = useCallback(guard('esg', async () => {
    patch({ esgError: false });
    try {
      const year = new Date().getFullYear();
      const data = await CB.esg.call(() =>
        withRetry(() => fetchWithTimeout(() => apiFetch(`/api/brsr/esg-summary/${year}`)))
      );
      if (data) patch({ esgData: data, esgTs: Date.now() });
    } catch (err) {
      if (!isSessionExpired(err) && !isCircuitOpen(err)) patch({ esgError: true });
    }
  }), [patch]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchNews = useCallback(guard('news', async () => {
    patch({ newsLoading: true });
    try {
      const data = await CB.news.call(() => withRetry(() => fetchWithTimeout(() => apiFetch('/api/news/carbon'))));
      if (data?.items?.length) patch({ newsItems: data.items.slice(0, 6).map(sanitizeNewsItem), newsLive: true });
    } catch { /* keep static fallback */ }
    finally { patch({ newsLoading: false }); }
  }), [patch]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchInrBalance = useCallback(guard('inr', async () => {
    patch({ inrBalError: false });
    try {
      const data = await CB.wallet.call(() => withRetry(() => fetchWithTimeout(() => apiFetch('/api/wallet/balance'))));
      patch({ inrBalance: data?.balance ?? null });
    } catch (err) {
      if (!isSessionExpired(err) && !isCircuitOpen(err)) patch({ inrBalError: true });
    }
  }), [patch]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const checkNetwork = useCallback(guard('network', async () => {
    const t0 = Date.now();
    try {
      await CB.network.call(() => fetchWithTimeout(() => apiFetch('/api/health'), 4_000));
      patch({ networkStatus: { backend: 'ONLINE', backendMs: Date.now() - t0 } });
    } catch (err) {
      patch({ networkStatus: { backend: isCircuitOpen(err) ? 'DEGRADED' : 'DEGRADED', backendMs: null } });
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

  // ── Priority loading ──────────────────────────────────────────────────────
  // Phase 1: critical financial data (stats, trades, inr balance)
  // Phase 2: supporting data including ESG summary — non-blocking
  useEffect(() => {
    Promise.allSettled([fetchStats(), fetchTrades(), fetchInrBalance()]).then(() => {
      // [FEAT-ESG-SUMMARY] fetchEsg runs in Phase 2 — never delays Phase 1
      Promise.allSettled([fetchEmissions(), fetchNews(), fetchEsg()]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Health check polling ──────────────────────────────────────────────────
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
    if (!state.statsError && !state.tradesError && !state.emissionsError && !state.esgError) return;
    const id = setTimeout(() => {
      if (state.statsError)     fetchStats();
      if (state.tradesError)    fetchTrades();
      if (state.emissionsError) fetchEmissions();
      if (state.esgError)       fetchEsg(); // [FEAT-ESG-SUMMARY]
    }, AUTO_RETRY_DELAY_MS);
    return () => clearTimeout(id);
  }, [state.statsError, state.tradesError, state.emissionsError, state.esgError,
      fetchStats, fetchTrades, fetchEmissions, fetchEsg]);

  // ── Refresh (all keys) ────────────────────────────────────────────────────
  const refresh = useCallback(async (ethRateForceRefresh) => {
    const stored = Number(localStorage.getItem(LS_KEY_REFRESH) || 0);
    if (Date.now() - stored < REFRESH_COOLDOWN_MS) return false;
    localStorage.setItem(LS_KEY_REFRESH, String(Date.now()));

    patch({ isRefreshing: true });
    inFlight.current = {};

    await Promise.allSettled([
      fetchStats(), fetchTrades(), fetchEmissions(), fetchNews(),
      fetchInrBalance(), fetchAlerts(), fetchEsg(), // [FEAT-ESG-SUMMARY]
    ]);
    if (ethRateForceRefresh) ethRateForceRefresh();

    patch({ isRefreshing: false });
    return true;
  }, [patch, fetchStats, fetchTrades, fetchEmissions, fetchNews, fetchInrBalance, fetchAlerts, fetchEsg]);

  return {
    state,
    actions: {
      fetchStats, fetchTrades, fetchEmissions,
      fetchNews, fetchInrBalance, fetchAlerts,
      checkNetwork, fetchEsg, // [FEAT-ESG-SUMMARY]
      refresh,
    },
  };
}