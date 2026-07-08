// scripts/run-retry-now.js
// ─────────────────────────────────────────────────────────────────────────────
// Manually triggers chainLogger.retryPendingLogs() immediately, instead of
// waiting for the every-5-minutes cron tick. Useful for testing/debugging
// without needing to guess when the next scheduled run lands.
//
// Usage: node scripts/run-retry-now.js
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

require('dotenv').config();
const { pool } = require('../db/pool');
const chainLogger = require('../services/chainLogger');

async function main() {
  console.log('Running retryPendingLogs() manually...\n');

  // Show what's currently queued before we run, for context.
  const { rows: before } = await pool.query(
    `SELECT cl.id, cl.trade_id, cl.attempts, cl.next_retry_at, t.chain_status
     FROM pending_chain_logs cl
     JOIN trades t ON t.id = cl.trade_id
     ORDER BY cl.next_retry_at ASC`
  );
  console.log(`pending_chain_logs currently has ${before.length} row(s):`);
  before.forEach(r => console.log(`  trade ${r.trade_id} | attempts=${r.attempts} | next_retry_at=${r.next_retry_at} | trades.chain_status=${r.chain_status}`));
  console.log('');

  await chainLogger.retryPendingLogs();

  console.log('\nretryPendingLogs() finished. Checking results...\n');

  const { rows: after } = await pool.query(
    `SELECT id, chain_status, chain_tx_hash, chain_logged_at
     FROM trades
     WHERE id = ANY($1::uuid[])`,
    [before.map(r => r.trade_id)]
  );
  after.forEach(r => console.log(`  ${r.id} | chain_status=${r.chain_status} | tx=${r.chain_tx_hash} | logged_at=${r.chain_logged_at}`));

  await pool.end();
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});