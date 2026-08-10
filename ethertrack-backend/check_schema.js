const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function checkTable(table) {
  const cols = await pool.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1
    ORDER BY ordinal_position
  `, [table]);
  console.log(`\n=== ${table} ===`);
  cols.rows.forEach(c => console.log(`  ${c.column_name}: ${c.data_type} ${c.is_nullable==='NO'?'NOT NULL':''} ${c.column_default||''}`));
  
  const indexes = await pool.query(`
    SELECT indexname, indexdef FROM pg_indexes WHERE tablename=$1 AND schemaname='public'
  `, [table]);
  console.log('  Indexes:');
  indexes.rows.forEach(i => console.log(`    ${i.indexname}: ${i.indexdef}`));
  
  const constraints = await pool.query(`
    SELECT conname, contype, pg_get_constraintdef(oid) as def
    FROM pg_constraint WHERE conrelid = $1::regclass
  `, [table]);
  console.log('  Constraints:');
  constraints.rows.forEach(c => console.log(`    ${c.conname} (${c.contype}): ${c.def}`));
}

async function main() {
  await checkTable('wallet_transactions');
  await checkTable('subscription_payments');
  await checkTable('kyc_idempotency_keys');
  await checkTable('trades');
  pool.end();
}

main();