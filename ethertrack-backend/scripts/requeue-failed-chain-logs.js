// scripts/requeue-failed-chain-logs.js
// ─────────────────────────────────────────────────────────────────────────────
// One-off remediation script.
//
// WHY: 9 trades got marked chain_status = 'failed' by the (correctly working)
// retry-limit logic in chainLogger.js, but they hit that limit while
// MARKETPLACE_ADDRESS still pointed at the old/stale contract (missing
// logINRTrade). Now that MARKETPLACE_ADDRESS points at the redeployed v2
// contract, these trades would very likely succeed — but they're no longer
// in pending_chain_logs, so the retry cron won't pick them up on its own.
//
// This script resets chain_status back to NULL for trades matching the given
// IDs (or, if none given, the known stuck IDs below), and re-inserts them
// into pending_chain_logs with attempts=0 so the next retryPendingLogs()
// cron run (every 5 min) picks them up immediately against the corrected
// contract.
//
// Usage:
//   node scripts/requeue-failed-chain-logs.js                 # requeue the known stuck trades below
//   node scripts/requeue-failed-chain-logs.js <id1> <id2> ...  # requeue specific trade IDs only
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

require('dotenv').config();
const { safeQuery, pool } = require('../db/pool');

const KNOWN_STUCK_TRADE_IDS = [
  '70ceb4c0-a981-4ed9-82e9-0218ad45c6c7',
  '2939fb83-fc87-4c5f-8fbd-568d4ef71a7a',
  '9c293cf3-582f-4372-aa15-c0be9a42ad7a',
  '61214246-2b7a-4b7f-bd11-fc4b515e3cab',
  '4bb3b4f9-4321-46de-8d3c-7caeeef0307e',
  'a7e951f9-2eb6-4088-a0ad-31c53dba1498',
  'aedbe08b-b726-4be0-a9f4-edabc7c7e268',
  '5c637445-ccdb-481c-9be4-c5352200109d',
  '8764506d-e531-4590-a797-d5fdca87d5fe',
];

async function main() {
  const argIds = process.argv.slice(2);
  const targetIds = argIds.length > 0 ? argIds : KNOWN_STUCK_TRADE_IDS;

  console.log(`Requeuing ${targetIds.length} trade(s):`, targetIds);

  // Confirm these trades are actually marked 'failed' right now, so we don't
  // accidentally requeue something that's already pending/confirmed.
  const { rows: current } = await safeQuery(
    `SELECT id, chain_status FROM trades WHERE id = ANY($1::uuid[])`,
    [targetIds]
  );

  const notFailed = current.filter(r => r.chain_status !== 'failed');
  if (notFailed.length > 0) {
    console.log('⚠️  Skipping these — not currently chain_status=failed:');
    notFailed.forEach(r => console.log(`   ${r.id} → ${r.chain_status}`));
  }

  const toRequeue = current.filter(r => r.chain_status === 'failed').map(r => r.id);
  if (toRequeue.length === 0) {
    console.log('Nothing to requeue. Exiting.');
    await pool.end();
    return;
  }

  // Reset trades.chain_status back to NULL so batchLogPending/retry logic
  // treats them as unlogged again.
  await safeQuery(
    `UPDATE trades SET chain_status = NULL WHERE id = ANY($1::uuid[])`,
    [toRequeue]
  );
  console.log(`✅ Reset chain_status to NULL for ${toRequeue.length} trade(s)`);

  // Re-insert into pending_chain_logs with a clean attempts counter so the
  // next retryPendingLogs() cron run (every 5 min) picks these up immediately.
  let inserted = 0;
  for (const tradeId of toRequeue) {
    await safeQuery(
      `INSERT INTO pending_chain_logs (trade_id, payload, attempts, next_retry_at, created_at)
       VALUES ($1, '{}', 0, NOW(), NOW())
       ON CONFLICT (trade_id) DO UPDATE
         SET attempts = 0, next_retry_at = NOW()`,
      [tradeId]
    );
    inserted++;
  }
  console.log(`✅ Re-queued ${inserted} trade(s) into pending_chain_logs (attempts reset to 0)`);
  console.log('The next retryPendingLogs() cron run (within 5 minutes) will attempt these against the current MARKETPLACE_ADDRESS.');

  await pool.end();
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});