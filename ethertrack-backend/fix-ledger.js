require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function fix() {
  // Keep only first MINT, delete duplicates
  const del = await pool.query(`
    DELETE FROM credit_ledger_entries 
    WHERE token_id = 2 
      AND action_type = 'MINT' 
      AND user_id = '706c67a4-de98-4a9a-9287-bed77d33b1a4'
      AND ctid NOT IN (
        SELECT min(ctid) FROM credit_ledger_entries 
        WHERE token_id = 2 AND action_type = 'MINT' AND user_id = '706c67a4-de98-4a9a-9287-bed77d33b1a4'
      )
  `);
  console.log('Deleted', del.rowCount, 'duplicate MINTs');

  // Fix balance to 3000
  const upd = await pool.query(`
    UPDATE credit_ledger_balances 
    SET balance = 3000, updated_at = NOW()
    WHERE user_id = '706c67a4-de98-4a9a-9287-bed77d33b1a4' AND token_id = 2
  `);
  console.log('Fixed balance to 3000');

  // Verify
  const verify = await pool.query('SELECT balance FROM credit_ledger_balances WHERE token_id = 2');
  console.log('New balance:', verify.rows[0].balance);

  pool.end();
}
fix().catch(console.error);