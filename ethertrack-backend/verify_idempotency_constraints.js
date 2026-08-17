const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function verify() {
  // Check wallet_transactions
  const wt = await pool.query(`
    SELECT indexname, indexdef FROM pg_indexes 
    WHERE tablename = 'wallet_transactions' AND indexname LIKE '%idempotency%'
  `);
  console.log('wallet_transactions idempotency indexes:');
  wt.rows.forEach(r => console.log('  ', r.indexname, ':', r.indexdef));

  // Check trades
  const tr = await pool.query(`
    SELECT indexname, indexdef FROM pg_indexes 
    WHERE tablename = 'trades' AND indexname LIKE '%idempotency%'
  `);
  console.log('trades idempotency indexes:');
  tr.rows.forEach(r => console.log('  ', r.indexname, ':', r.indexdef));

  // Check subscription_payments
  const sp = await pool.query(`
    SELECT indexname, indexdef FROM pg_indexes 
    WHERE tablename = 'subscription_payments' AND indexname LIKE '%idempotency%'
  `);
  console.log('subscription_payments idempotency indexes:');
  sp.rows.forEach(r => console.log('  ', r.indexname, ':', r.indexdef));

  // Check kyc_idempotency_keys
  const kyc = await pool.query(`
    SELECT indexname, indexdef FROM pg_indexes 
    WHERE tablename = 'kyc_idempotency_keys' AND (indexname LIKE '%idempotency%' OR indexname LIKE '%pkey%')
  `);
  console.log('kyc_idempotency_keys indexes:');
  kyc.rows.forEach(r => console.log('  ', r.indexname, ':', r.indexdef));

  // Check constraints
  const cons = await pool.query(`
    SELECT conname, contype, pg_get_constraintdef(oid) as def
    FROM pg_constraint 
    WHERE conrelid IN ('wallet_transactions'::regclass, 'trades'::regclass, 'subscription_payments'::regclass, 'kyc_idempotency_keys'::regclass)
    AND (contype = 'u' OR contype = 'p')
  `);
  console.log('Constraints:');
  cons.rows.forEach(r => console.log('  ', r.conname, '(', r.contype, '):', r.def));

  await pool.end();
}
verify().catch(e => { console.error(e); process.exit(1); });