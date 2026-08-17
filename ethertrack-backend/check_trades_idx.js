const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
  const tradesIdx = await pool.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'trades' AND indexname LIKE '%idempotency%'
  `);
  console.log('Trades idempotency indexes:', tradesIdx.rows);

  const tradesCons = await pool.query(`
    SELECT conname, contype
    FROM pg_constraint
    WHERE conrelid = 'trades'::regclass AND conname LIKE '%idempotency%'
  `);
  console.log('Trades idempotency constraints:', tradesCons.rows);

  await pool.end();
}
check().catch(e => { console.error(e); process.exit(1); });