// check-ledger-entries.js
const { Pool } = require('pg');
require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-backend\\.env' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  try {
    console.log("=== credit_ledger_balances ===");
    const balances = await pool.query(
      `SELECT user_id, token_id, balance, total_retired FROM credit_ledger_balances ORDER BY user_id, token_id`
    );
    console.table(balances.rows);
    
    console.log("\n=== credit_ledger_entries (all) ===");
    const entries = await pool.query(
      `SELECT cle.*, cb.project_name 
       FROM credit_ledger_entries cle
       LEFT JOIN carbon_batches cb ON cb.id::text = cle.ref_id::text
       ORDER BY cle.created_at DESC`
    );
    console.table(entries.rows);
    
    // Check specific token_id = 3 for User 1
    console.log("\n=== Ledger for User 1 (varun.deshmukh2004@gmail.com) token_id = 3 ===");
    const token3 = await pool.query(
      `SELECT * FROM credit_ledger_balances WHERE user_id = '706c67a4-de98-4a9a-9287-bed77d33b1a4' AND token_id = 3`
    );
    console.table(token3.rows);
    
    const entries3 = await pool.query(
      `SELECT * FROM credit_ledger_entries WHERE user_id = '706c67a4-de98-4a9a-9287-bed77d33b1a4' AND token_id = 3`
    );
    console.table(entries3.rows);
    
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}

main();