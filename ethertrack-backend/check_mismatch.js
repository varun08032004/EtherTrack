const { safeQuery } = require('./db/pool.js');

async function check() {
  // Find the Mango Farms Nashik batch
  const batch = await safeQuery(`
    SELECT cb.*, u.id as user_id, u.email
    FROM carbon_batches cb
    JOIN users u ON u.id = cb.user_id
    WHERE cb.project_name ILIKE '%mango%farms%nashik%' OR cb.project_name ILIKE '%mango farms nashik%'
  `);
  console.log('Batch:', batch.rows);
  
  if (batch.rows.length > 0) {
    const b = batch.rows[0];
    console.log('Found batch:', b.id, 'token_id:', b.token_id, 'user:', b.email);
    
    // Check ledger balance
    const bal = await safeQuery('SELECT * FROM credit_ledger_balances WHERE user_id = $1 AND token_id = $2', [b.user_id, b.token_id]);
    console.log('DB Balance:', bal.rows[0]);
    
    // Check ledger entries
    const entries = await safeQuery('SELECT * FROM credit_ledger_entries WHERE user_id = $1 AND token_id = $2 ORDER BY created_at DESC LIMIT 20', [b.user_id, b.token_id]);
    console.log('Recent Entries:', entries.rows.map(e => ({ action: e.action_type, delta: e.amount_delta, ref: e.ref_table, tx: e.tx_hash })));
  }
}

check().catch(console.error).finally(() => process.exit(0));