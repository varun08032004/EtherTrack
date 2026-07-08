// db/pool.js — EtherTrack
// FIXES:
// [P1] Removed noisy "[DB Pool] New client connected" log — was spamming console
//      every request and making it impossible to read real errors.
// [P2] Reduced MAX_CONNECTIONS from 15 → 10 for Supabase free tier (limit is 15,
//      leaving headroom for migrations/admin connections).
// [P3] CONNECT_TIMEOUT_MS lowered to 5s — 15s was allowing hung connections to
//      pile up. Fail fast + retry is better than waiting 15s per attempt.
// [P4] Added pool exhaustion warning threshold at 80% utilisation.
// [P5] Fixed the utilisation calculation itself: it was computing
//      `totalCount / MAX_CONNECTIONS`, which measures how many connections the
//      pool has ever opened (idle or busy) — not how many are actually in use.
//      A pool sitting at 10 idle, unused connections would falsely report
//      "100% utilisation" with Idle: 10, Waiting: 0 (zero real load). Now
//      measures active = total - idle, and only warns when active load is
//      high OR requests are actually queued waiting for a connection.
'use strict';

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('[DB] FATAL: DATABASE_URL environment variable is not set');
  if (process.env.NODE_ENV === 'production') process.exit(1);
}

const QUERY_TIMEOUT_MS   = 15_000; // [P3] 30s → 15s — slow queries should fail fast
const CONNECT_TIMEOUT_MS =  5_000; // [P3] 15s → 5s  — fail fast, let retry handle it
const IDLE_TIMEOUT_MS    = 30_000;
const MAX_CONNECTIONS    = 10;     // [P2] 15 → 10   — safer for Supabase free tier
const MAX_RETRIES        = 3;
const RETRY_DELAY_MS     = 500;    // [P3] 1000 → 500ms — faster recovery

const pool = new Pool({
  connectionString        : process.env.DATABASE_URL,
  ssl                     : { rejectUnauthorized: false },
  max                     : MAX_CONNECTIONS,
  idleTimeoutMillis       : IDLE_TIMEOUT_MS,
  connectionTimeoutMillis : CONNECT_TIMEOUT_MS,
  options                 : `--search_path=public --statement_timeout=${QUERY_TIMEOUT_MS}`,
});

pool.on('error', (err) => {
  console.error('[DB Pool] Unexpected client error:', err.message);
});

// [P1] Removed per-connection log — it was printing 17+ times per page load
// pool.on('connect', () => { console.log('[DB Pool] New client connected'); });

// [P4/P5] Pool health monitor — warn only when things are actually bad.
// See [P5] note above for why this now measures `active` (total - idle)
// instead of raw `totalCount`.
setInterval(() => {
  const active        = pool.totalCount - pool.idleCount;
  const utilisation    = MAX_CONNECTIONS > 0 ? active / MAX_CONNECTIONS : 0;
  const underPressure  = pool.waitingCount > 0 || utilisation >= 0.8;

  if (underPressure) {
    console.warn(
      `[DB Pool] ⚠️  HIGH UTILISATION ${Math.round(utilisation * 100)}% | ` +
      `Active: ${active}/${MAX_CONNECTIONS} | ` +
      `Total: ${pool.totalCount}/${MAX_CONNECTIONS} | ` +
      `Idle: ${pool.idleCount} | Waiting: ${pool.waitingCount}`
    );
  }
}, 10_000);

const RETRIABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'CONNECTION_TERMINATED',
  '57P01',
  '57P02',
  '57P03',
]);

const safeQuery = async (text, params = [], retries = MAX_RETRIES) => {
  try {
    return await pool.query(text, params);
  } catch (err) {
    const isRetriable =
      RETRIABLE_CODES.has(err.code) ||
      RETRIABLE_CODES.has(err.errno) ||
      err.message?.includes('Connection terminated') ||
      err.message?.includes('connection timeout') ||
      err.message?.includes('timeout');

    if (retries > 0 && isRetriable) {
      const attempt = MAX_RETRIES - retries + 1;
      console.warn(`[DB] Retriable error (attempt ${attempt}/${MAX_RETRIES}):`, err.message);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
      return safeQuery(text, params, retries - 1);
    }
    err.queryText = text.slice(0, 200);
    throw err;
  }
};

const getClient = () => pool.connect();

const withTransaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const healthCheck = async () => {
  const t0 = Date.now();
  try {
    await pool.query('SELECT 1');
    return {
      ok         : true,
      latencyMs  : Date.now() - t0,
      poolTotal  : pool.totalCount,
      poolIdle   : pool.idleCount,
      poolWaiting: pool.waitingCount,
    };
  } catch (err) {
    return { ok: false, error: err.message, latencyMs: Date.now() - t0 };
  }
};

const shutdown = async () => {
  console.log('[DB Pool] Closing all connections…');
  await pool.end();
  console.log('[DB Pool] All connections closed');
};

module.exports = { safeQuery, getClient, withTransaction, healthCheck, shutdown, pool };