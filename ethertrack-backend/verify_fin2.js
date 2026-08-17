const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
  // FIN-002: Check oversell prevention - carbon_batches constraints
  const batchCheck = await pool.query(`
    SELECT constraint_name, check_clause
    FROM information_schema.check_constraints
    WHERE constraint_name LIKE '%carbon_batches%' AND constraint_name LIKE '%available%'
  `);
  console.log('Available credits constraints:', batchCheck.rows.map(r => r.constraint_name));

  // Check wallet_ledger table
  const walletLedger = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'wallet_ledger'
  `);
  console.log('Wallet ledger columns:', walletLedger.rows.map(r => r.column_name + ':' + r.data_type));

  // Check credit_ledger_balances constraints
  const clbCheck = await pool.query(`
    SELECT constraint_name, check_clause
    FROM information_schema.check_constraints
    WHERE constraint_name LIKE '%ledger%'
  `);
  console.log('Credit ledger constraints:', clbCheck.rows.map(r => r.constraint_name));

  // Check reconciliation_jobs table
  const reconJobs = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'reconciliation_jobs'
  `);
  console.log('Reconciliation jobs columns:', reconJobs.rows.map(r => r.column_name + ':' + r.data_type));

  // Check wallet_transactions reference uniqueness
  const wtRef = await pool.query(`
    SELECT constraint_name, constraint_type
    FROM information_schema.table_constraints
    WHERE table_name = 'wallet_transactions' AND constraint_name LIKE '%reference%'
  `);
  console.log('Wallet reference constraints:', wtRef.rows.map(r => r.constraint_name));

  // Check trades unique constraint on tx_hash
  const tradesTx = await pool.query(`
    SELECT constraint_name, constraint_type
    FROM information_schema.table_constraints
    WHERE table_name = 'trades' AND constraint_name LIKE '%tx_hash%'
  `);
  console.log('Trades tx_hash constraints:', tradesTx.rows.map(r => r.constraint_name));

  // Check webhook event id uniqueness in subscription_payments
  const spWebhook = await pool.query(`
    SELECT constraint_name, constraint_type
    FROM information_schema.table_constraints
    WHERE table_name = 'subscription_payments' AND constraint_name LIKE '%webhook%'
  `);
  console.log('Subscription payments webhook constraints:', spWebhook.rows.map(r => r.constraint_name));

  // Check wallet_transactions razorpay_payout_id uniqueness
  const wtPayout = await pool.query(`
    SELECT constraint_name, constraint_type
    FROM information_schema.table_constraints
    WHERE table_name = 'wallet_transactions' AND constraint_name LIKE '%payout%'
  `);
  console.log('Wallet payout constraints:', wtPayout.rows.map(r => r.constraint_name));

  await pool.end();
}
check().catch(e => { console.error(e); process.exit(1); });