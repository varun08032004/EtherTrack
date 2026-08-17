// check-db-state.js
const { Pool } = require('pg');
require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-backend\\.env' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  try {
    console.log("=== carbon_batches ===");
    const batches = await pool.query(
      `SELECT id, project_name, token_id, custody_model, status, admin_status, listed_quantity, available_credits 
       FROM carbon_batches WHERE token_id IN (1, 2)`
    );
    console.table(batches.rows);

    console.log("\n=== credit_ledger_balances ===");
    const ledger = await pool.query(
      `SELECT user_id, token_id, balance, total_retired FROM credit_ledger_balances WHERE token_id IN (1, 2)`
    );
    console.table(ledger.rows);

    console.log("\n=== credit_ledger_entries (recent) ===");
    const entries = await pool.query(
      `SELECT user_id, token_id, amount_delta, action_type, note, created_at 
       FROM credit_ledger_entries WHERE token_id IN (1, 2) ORDER BY created_at DESC LIMIT 10`
    );
    console.table(entries.rows);

  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}

main();