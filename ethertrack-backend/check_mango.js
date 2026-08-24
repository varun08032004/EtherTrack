const { safeQuery } = require('./db/pool.js');

async function check() {
  const userId = '706c67a4-de98-4a9a-9287-bed77d33b1a4';
  const tokenId = 3;
  
  console.log('Checking ledger for user:', userId, 'token:', tokenId);
  
  // Check ledger balance
  const bal = await safeQuery('SELECT * FROM credit_ledger_balances WHERE user_id = $1 AND token_id = $2', [userId, tokenId]);
  console.log('DB Balance:', bal.rows[0]);
  
  // Check ledger entries
  const entries = await safeQuery('SELECT * FROM credit_ledger_entries WHERE user_id = $1 AND token_id = $2 ORDER BY created_at DESC LIMIT 20', [userId, tokenId]);
  console.log('Recent Entries:', entries.rows.map(e => ({ action: e.action_type, delta: e.amount_delta, ref: e.ref_table, refId: e.ref_id, tx: e.tx_hash, block: e.block_number, chainStatus: e.chain_status })));
  
  // Check user_id_hash
  const userHash = await safeQuery('SELECT user_id_hash FROM users WHERE id = $1', [userId]);
  console.log('User ID Hash:', userHash.rows[0]);
  
  // Check ledger_listings
  const listings = await safeQuery('SELECT * FROM ledger_listings WHERE seller_id = $1 AND token_id = $2', [userId, tokenId]);
  console.log('Ledger Listings:', listings.rows);
  
  process.exit(0);
}

check().catch(console.error);