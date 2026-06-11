/**
 * hooks/useEthRate.js
 *
 * Manages ETH/INR rate fetching with:
 *  - null initial state (never shows hardcoded fallback as real price)
 *  - module-level cache (survives re-renders, shared across instances)
 *  - circuit breaker (stops hammering a failing /api/rates endpoint)
 *  - visibility-aware refresh
 *  - stale rate detection
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch }             from '../services/api';
import { fetchWithTimeout, withRetry } from '../utils/dashboard';
import { createCircuitBreaker } from '../utils/circuitBreaker';
import {
  RATE_REFRESH_MS,
  RATE_STALE_WARN_MS,
  CB_FAILURE_THRESHOLD,
  CB_OPEN_DURATION_MS,
} from '../constants/dashboard';

// Module-level cache — shared across all hook instances
const _cache = { rate: null, fetchedAt: 0 };
const _cb    = createCircuitBreaker('eth-rate', {
  threshold: CB_FAILURE_THRESHOLD,
  openMs:    CB_OPEN_DURATION_MS,
});

export function useEthRate() {
  const [rate, setRate]           = useState(null);   // null = not yet fetched
  const [fetchedAt, setFetchedAt] = useState(null);
  const fetchingRef               = useRef(false);

  const fetch = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      // Serve from cache if fresh
      if (_cache.rate && Date.now() - _cache.fetchedAt < RATE_REFRESH_MS) {
        setRate(_cache.rate);
        setFetchedAt(_cache.fetchedAt);
        return;
      }

      const data = await _cb.call(() =>
        withRetry(() => fetchWithTimeout(() => apiFetch('/api/rates/eth-inr'), 4_000)),
      );

      if (data?.inr > 0) {
        _cache.rate      = data.inr;
        _cache.fetchedAt = Date.now();
        setRate(data.inr);
        setFetchedAt(_cache.fetchedAt);
      }
    } catch (err) {
      if (err?.message?.startsWith('circuit-open:')) {
        // CB is open — keep showing whatever rate we have (could be null)
        return;
      }
      // Keep existing rate on transient failure — but don't fake one
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  // Initial fetch + interval
  useEffect(() => {
    fetch();
    const id = setInterval(fetch, RATE_REFRESH_MS);
    return () => clearInterval(id);
  }, [fetch]);

  // Visibility-based refresh
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') {
        const age = Date.now() - _cache.fetchedAt;
        if (age > RATE_REFRESH_MS) {
          _cache.fetchedAt = 0; // force refetch
          fetch();
        }
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [fetch]);

  const isStale = !fetchedAt || Date.now() - fetchedAt > RATE_STALE_WARN_MS;
  const ageMin  = fetchedAt ? Math.floor((Date.now() - fetchedAt) / 60_000) : null;

  // Expose an imperative refresh for the "Refresh Data" button
  const forceRefresh = useCallback(() => {
    _cache.fetchedAt = 0;
    fetchingRef.current = false;
    fetch();
  }, [fetch]);

  return { rate, fetchedAt, isStale, ageMin, forceRefresh };
}