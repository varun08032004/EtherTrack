// routes/health.js — EtherTrack
// Health check endpoints for load balancers, K8s probes, and uptime monitoring.
//
// Endpoints:
//   GET /health        — full diagnostic (used by dashboards, uptime monitors)
//   GET /health/ready  — readiness probe: DB must be reachable (K8s readinessProbe)
//   GET /health/live   — liveness probe:  process is alive (K8s livenessProbe)
//
// Response codes:
//   200  all critical checks passed  → { ok: true,  status: 'healthy',  ... }
//   503  one or more critical checks failed → { ok: false, status: 'degraded', ... }
//
// Critical checks (503 on failure): database, ethRate freshness
// Informational only (never 503):   statsCache, sessionStore

'use strict';

const router     = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { getCachedRate, cacheAge } = require('../services/rateService');
const statsCache = require('../services/statsCache');
const tokenStore = require('../services/tokenStore');

// Uncomment + set ETHEREUM_RPC_URL in .env to enable live RPC reachability check.
// const { ethers } = require('ethers');

const SERVER_START = Date.now();

// ─── Individual check functions ───────────────────────────────────────────────

/** Lightweight DB ping. Returns latency on success, error message on failure. */
async function checkDatabase() {
  const t0 = Date.now();
  try {
    await query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: err.message ?? 'DB unreachable' };
  }
}

/**
 * ETH/USD rate freshness check.
 * Marks stale if the cached rate is older than ETH_RATE_STALE_SEC (default 300s).
 */
function checkEthRate() {
  const staleLimitSec = parseInt(process.env.ETH_RATE_STALE_SEC ?? '300', 10);
  const ageSeconds    = Math.round(cacheAge() / 1000);
  const ok            = ageSeconds < staleLimitSec;
  return {
    ok,
    cachedRate:    getCachedRate(),
    ageSeconds,
    staleLimitSec,
  };
}

/** In-memory stats cache — informational only, never marks overall health as bad. */
function checkStatsCache() {
  return { ok: true, keys: statsCache.size() };
}

/** Active session / token store — informational only. */
function checkSessionStore() {
  return { ok: true, activeSessions: tokenStore.size() };
}

/**
 * Optional: Ethereum RPC reachability.
 * Uncomment body + import above to enable.
 */
async function checkEthereumRpc() {
  // const t0 = Date.now();
  // try {
  //   const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL);
  //   await provider.getBlockNumber();
  //   return { ok: true, latencyMs: Date.now() - t0 };
  // } catch (err) {
  //   return { ok: false, error: err.message };
  // }
  return { ok: true, skipped: true }; // remove once enabled
}

// ─── GET /health ─────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  // Run all async checks in parallel; Promise.allSettled ensures one slow/failing
  // check never blocks the others.
  const [dbResult, rpcResult] = await Promise.allSettled([
    checkDatabase(),
    checkEthereumRpc(),
  ]);

  const db  = dbResult.status  === 'fulfilled' ? dbResult.value  : { ok: false, error: 'check threw' };
  const rpc = rpcResult.status === 'fulfilled' ? rpcResult.value : { ok: false, error: 'check threw' };

  // Synchronous checks (fast, no await needed)
  const ethRate      = checkEthRate();
  const statsC       = checkStatsCache();
  const sessionStore = checkSessionStore();

  // Only critical checks determine overall health
  const criticalOk = db.ok && ethRate.ok;
  const allOk      = criticalOk && (rpc.skipped || rpc.ok); // rpc optional

  return res.status(allOk ? 200 : 503).json({
    ok:       allOk,
    status:   allOk ? 'healthy' : 'degraded',
    uptimeMs: Date.now() - SERVER_START,
    ts:       new Date().toISOString(),
    checks: {
      database:     db,           // critical
      ethRate,                    // critical
      ethereumRpc:  rpc,          // critical when enabled
      statsCache:   statsC,       // informational
      sessionStore,               // informational
    },
  });
});

// ─── GET /health/ready — readiness probe ─────────────────────────────────────
// Strict: DB must be reachable. Used by K8s readinessProbe to gate traffic.

router.get('/ready', async (req, res) => {
  const db = await checkDatabase();
  if (db.ok) {
    return res.json({ ready: true, dbLatencyMs: db.latencyMs });
  }
  return res.status(503).json({ ready: false, error: db.error });
});

// ─── GET /health/live — liveness probe ───────────────────────────────────────
// Minimal: if the process can respond, it's alive. Used by K8s livenessProbe.

router.get('/live', (_req, res) => {
  res.json({ alive: true, uptimeMs: Date.now() - SERVER_START });
});

module.exports = router;