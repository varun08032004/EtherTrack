// services/rateService.js
// Production ETH/INR rate service.
//
// FIXES:
//   - Retry with exponential backoff (3 attempts)
//   - Fallback to Binance if CoinGecko fails
//   - Circuit breaker: serves stale cache for up to 5 minutes before erroring
//   - Slippage guard (unchanged — 1% drift rejects trade)
//   - Rate saved to DB for audit trail
//   - Module-level singleton — one fetch at a time (no thundering herd)
//   - Separate from route handlers — no network call inside request path

'use strict';

const { safeQuery: query } = require('../db/pool');

const FALLBACK_RATE    = 280000;
const RATE_TTL_MS      = 60 * 1000;       // refresh every 60s
const CIRCUIT_BREAK_MS = 5 * 60 * 1000;   // serve stale for up to 5 min
const MAX_SLIPPAGE     = 0.01;            // 1%
const MAX_RETRIES      = 3;

let _cachedRate    = FALLBACK_RATE;
let _lastFetchedAt = 0;
let _fetchPromise  = null; // singleton in-flight request

// ── Source fetchers ────────────────────────────────────────────────

async function fetchCoinGecko() {
  const res  = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=inr',
    { signal: AbortSignal.timeout(5000) }
  );
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data = await res.json();
  const rate = data?.ethereum?.inr;
  if (!rate || typeof rate !== 'number') throw new Error('CoinGecko: bad payload');
  return rate;
}

async function fetchBinance() {
  // Binance doesn't have a direct ETH/INR pair — use ETH/USDT × USD/INR
  const [ethRes, fxRes] = await Promise.all([
    fetch('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT',
      { signal: AbortSignal.timeout(5000) }),
    fetch('https://api.exchangerate-api.com/v4/latest/USD',
      { signal: AbortSignal.timeout(5000) }),
  ]);
  if (!ethRes.ok) throw new Error(`Binance ${ethRes.status}`);
  if (!fxRes.ok)  throw new Error(`FX API ${fxRes.status}`);
  const ethData = await ethRes.json();
  const fxData  = await fxRes.json();
  const ethUsd  = parseFloat(ethData.price);
  const usdInr  = fxData.rates?.INR;
  if (!ethUsd || !usdInr) throw new Error('Binance: bad payload');
  return Math.round(ethUsd * usdInr);
}

// ── Retry helper ───────────────────────────────────────────────────

async function withRetry(fn, maxRetries = MAX_RETRIES) {
  let lastErr;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt))); // 500ms, 1s, 2s
      }
    }
  }
  throw lastErr;
}

// ── Core fetch ─────────────────────────────────────────────────────

async function _doFetch() {
  let newRate;

  try {
    newRate = await withRetry(fetchCoinGecko);
  } catch (primaryErr) {
    console.warn('[rateService] CoinGecko failed, trying Binance:', primaryErr.message);
    try {
      newRate = await withRetry(fetchBinance);
    } catch (fallbackErr) {
      console.error('[rateService] Both sources failed:', fallbackErr.message);
      // Circuit breaker: if cache is fresh enough, return it; otherwise throw
      const staleAge = Date.now() - _lastFetchedAt;
      if (_lastFetchedAt > 0 && staleAge < CIRCUIT_BREAK_MS) {
        console.warn(`[rateService] Serving stale rate (${Math.round(staleAge / 1000)}s old): ${_cachedRate}`);
        return _cachedRate;
      }
      throw new Error('ETH rate unavailable: both sources failed and cache is too stale');
    }
  }

  // Slippage guard — warn but don't reject (rejection happens at trade time)
  if (_lastFetchedAt > 0) {
    const drift = Math.abs(newRate - _cachedRate) / _cachedRate;
    if (drift > MAX_SLIPPAGE) {
      console.warn(`[rateService] ETH rate moved ${(drift * 100).toFixed(2)}%: ${_cachedRate} → ${newRate}`);
    }
  }

  _cachedRate    = newRate;
  _lastFetchedAt = Date.now();

  // Persist to DB for audit (non-fatal)
  query(
    `INSERT INTO eth_inr_rates (rate, source, created_at) VALUES ($1, 'rateService', NOW())`,
    [_cachedRate]
  ).catch(() => {});

  return _cachedRate;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * getLiveETHRate — returns current ETH/INR rate.
 * Refreshes at most once per RATE_TTL_MS; concurrent callers share one fetch.
 */
async function getLiveETHRate() {
  if (Date.now() - _lastFetchedAt < RATE_TTL_MS) return _cachedRate;

  // Singleton: if a fetch is already in flight, wait for it
  if (_fetchPromise) return _fetchPromise;

  _fetchPromise = _doFetch().finally(() => { _fetchPromise = null; });
  return _fetchPromise;
}

/**
 * getCachedRate — returns last known rate without triggering a fetch.
 * Use for non-critical display values.
 */
function getCachedRate() {
  return _cachedRate;
}

/**
 * validateSlippage — call at trade settlement time.
 * Returns { valid, drift, serverRate } — route handler decides whether to reject.
 */
function validateSlippage(clientRate) {
  if (!clientRate) return { valid: true, drift: 0, serverRate: _cachedRate };
  const drift = Math.abs(_cachedRate - parseFloat(clientRate)) / parseFloat(clientRate);
  return {
    valid:      drift <= MAX_SLIPPAGE,
    drift,
    driftPct:   (drift * 100).toFixed(2),
    serverRate: _cachedRate,
    clientRate: parseFloat(clientRate),
  };
}

/**
 * cacheAge — milliseconds since last successful fetch.
 * Exposed for health endpoint.
 */
function cacheAge() {
  return _lastFetchedAt ? Date.now() - _lastFetchedAt : Infinity;
}

module.exports = { getLiveETHRate, getCachedRate, validateSlippage, cacheAge, FALLBACK_RATE };
