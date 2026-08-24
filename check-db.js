const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const r = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('ledger_listings', 'carbon_batches', 'credit_ledger_balances')");
  console.log('Tables:', r.rows);
  const r2 = await pool.query('SELECT * FROM ledger_listings LIMIT 5');
  console.log('ledger_listings:', r2.rows);
  await pool.end();
}

check().catch(console.error);