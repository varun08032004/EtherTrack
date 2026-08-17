const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
  // FIN-003: Check wallet balance constraints
  const walletCheck = await pool.query(`
    SELECT constraint_name 
    FROM information_schema.check_constraints 
    WHERE constraint_name LIKE '%wallet%'
  `);
  console.log('Wallet constraints:', walletCheck.rows.map(r => r.constraint_name));
  
  // FIN-007: Check fee calculation in trades
  const tradesCheck = await pool.query(`
    SELECT constraint_name 
    FROM information_schema.check_constraints 
    WHERE constraint_name LIKE '%trades%'
  `);
  console.log('Trades constraints:', tradesCheck.rows.map(r => r.constraint_name));
  
  // FIN-009: Check settlement atomicity - trades table
  const settlementCheck = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'trades' AND column_name IN ('buyer_inr_deducted', 'seller_inr_credited', 'inr_settlement_at', 'payment_mode')
  `);
  console.log('Settlement columns:', settlementCheck.rows.map(r => r.column_name));
  
  // FIN-010: Check reconciliation tables
  const reconCheck = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_name IN ('wallet_ledger', 'credit_ledger_balances', 'reconciliation_jobs')
  `);
  console.log('Reconciliation tables:', reconCheck.rows.map(r => r.table_name));
  
  await pool.end();
}
check().catch(e => { console.error(e); process.exit(1); });