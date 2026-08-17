const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
  const wt = await pool.query(`
    SELECT indexname, indexdef FROM pg_indexes 
    WHERE tablename = 'wallet_transactions' AND indexname LIKE '%idempotency%'
  `);
  console.log('wallet_transactions idempotency:', wt.rows.length > 0 ? 'PASS' : 'FAIL');
  
  const tr = await pool.query(`
    SELECT indexname, indexdef FROM pg_indexes 
    WHERE tablename = 'trades' AND indexname LIKE '%idempotency%'
  `);
  console.log('trades idempotency:', tr.rows.length > 0 ? 'PASS' : 'FAIL');
  
  const sp = await pool.query(`
    SELECT indexname, indexdef FROM pg_indexes 
    WHERE tablename = 'subscription_payments' AND indexname LIKE '%idempotency%'
  `);
  console.log('subscription_payments idempotency:', sp.rows.length > 0 ? 'PASS' : 'FAIL');
  
  await pool.end();
}
check().catch(e => { console.error(e); process.exit(1); });