// scripts/reset-testnet-market-data.js
// ─────────────────────────────────────────────────────────────────────────────
// Wipes ONLY the tables that reference on-chain state tied to the OLD
// contract addresses (token IDs, tx hashes, listing IDs). Necessary after
// redeploying the contract suite — the new contracts restart token IDs
// from 0, so leftover DB rows would silently point at the wrong assets
// under the new contracts.
//
// Does NOT touch: users, KYC data, compliance/obligated_entities,
// organisations, subscriptions, support tickets, audit_log,
// admin_audit_log. Those are real business data, not chain-linked test
// state, and are untouched regardless of which contracts are live.
//
// [FIX-VIEW] Some target names (e.g. market_listings) turned out to be
// VIEWs, not real tables — TRUNCATE fails on a view with error 42809.
// This version checks table_type via information_schema and:
//   - TRUNCATEs anything that's a real BASE TABLE
//   - Skips anything that's a VIEW, but prints its definition so you can
//     see what underlying table it actually reads from (that underlying
//     table is very likely already in TARGET_TABLES anyway, or needs
//     adding — check the printed SQL)
//   - Skips anything that doesn't exist at all
//
// Usage:
//   node scripts/reset-testnet-market-data.js            # dry run — row counts only
//   node scripts/reset-testnet-market-data.js --confirm   # actually wipes
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();
const { safeQuery: query, shutdown } = require('../db/pool');

const CONFIRM = process.argv.includes('--confirm');

const TARGET_TABLES = [
  'trades',
  'buy_orders',
  'market_listings',
  'ledger_listings',
  'exchange_orders',
  'retirements',
  'retirement_requests',
  'credit_ledger_entries',
  'credit_ledger_balances',
  'pending_chain_logs',
  'pending_seller_credits',
  'registry_transactions',
  'wallet_transactions',
  'inventory_locks',
  'failed_trade_records',
  'carbon_batches',
];

async function tableInfo(name) {
  const { rows } = await query(
    `SELECT table_type FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
    [name]
  );
  return rows[0]?.table_type || null; // 'BASE TABLE', 'VIEW', or null (doesn't exist)
}

async function viewDefinition(name) {
  const { rows } = await query(
    `SELECT view_definition FROM information_schema.views WHERE table_schema='public' AND table_name=$1`,
    [name]
  );
  return rows[0]?.view_definition || null;
}

async function rowCount(name) {
  const { rows } = await query(`SELECT COUNT(*) FROM ${name}`);
  return parseInt(rows[0].count, 10);
}

async function main() {
  console.log(CONFIRM ? '🗑️  WIPING (real deletes)' : '🧪 DRY RUN — no data will be deleted (pass --confirm to run for real)');
  console.log('');

  const baseTables = [];
  const views = [];

  for (const t of TARGET_TABLES) {
    const type = await tableInfo(t);
    if (type === 'BASE TABLE') {
      baseTables.push(t);
    } else if (type === 'VIEW') {
      views.push(t);
      const def = await viewDefinition(t);
      console.log(`⏭  ${t} — this is a VIEW, not a table. Skipping TRUNCATE.`);
      if (def) console.log(`     Definition: ${def.replace(/\s+/g, ' ').trim().slice(0, 200)}`);
    } else {
      console.log(`⏭  ${t} — table not found, skipping`);
    }
  }

  console.log('\nRow counts before (base tables only):');
  let total = 0;
  for (const t of baseTables) {
    const c = await rowCount(t);
    total += c;
    console.log(`   ${t.padEnd(28)} ${c}`);
  }
  console.log(`   ${'TOTAL'.padEnd(28)} ${total}`);

  if (views.length) {
    console.log(`\n⚠️  ${views.length} view(s) skipped — check the definitions printed above to see if the`);
    console.log(`   underlying real table needs to be added to TARGET_TABLES in this script.`);
  }

  if (!CONFIRM) {
    console.log('\nDry run complete. Re-run with --confirm to actually wipe these tables.');
    await shutdown();
    return;
  }

  if (!baseTables.length) {
    console.log('\nNothing to wipe.');
    await shutdown();
    return;
  }

  console.log('\nWiping...');
  await query(`TRUNCATE TABLE ${baseTables.join(', ')} RESTART IDENTITY CASCADE`);
  console.log(`✅ Wiped ${baseTables.length} table(s): ${baseTables.join(', ')}`);

  console.log('\nRow counts after:');
  for (const t of baseTables) {
    console.log(`   ${t.padEnd(28)} ${await rowCount(t)}`);
  }

  console.log('\nDone. Users, KYC records, compliance data, subscriptions, and support data were NOT touched.');
  await shutdown();
}

main().catch(async (e) => {
  console.error('Fatal error:', e);
  await shutdown();
  process.exit(1);
});