const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
  // Check subscription_payments webhook_event_id constraint
  const sp = await pool.query(`
    SELECT constraint_name, constraint_type
    FROM information_schema.table_constraints
    WHERE table_name = 'subscription_payments' AND constraint_name LIKE '%webhook%'
  `);
  console.log('Subscription payments webhook constraints:', sp.rows);

  // Check wallet_transactions webhook_event_id constraint
  const wt = await pool.query(`
    SELECT constraint_name, constraint_type
    FROM information_schema.table_constraints
    WHERE table_name = 'wallet_transactions' AND constraint_name LIKE '%webhook%'
  `);
  console.log('Wallet transactions webhook constraints:', wt.rows);

  // Check if webhook_event_id column exists
  const spCol = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'subscription_payments' AND column_name = 'webhook_event_id'
  `);
  console.log('Subscription payments webhook_event_id column:', spCol.rows);

  const wtCol = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'wallet_transactions' AND column_name = 'webhook_event_id'
  `);
  console.log('Wallet transactions webhook_event_id column:', wtCol.rows);

  await pool.end();
}
check().catch(e => { console.error(e); process.exit(1); });