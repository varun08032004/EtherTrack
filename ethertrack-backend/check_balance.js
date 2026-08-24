require('dotenv').config();
const { safeQuery } = require('./db/pool.js');

async function check() {
  const userId = '706c67a4-de98-4a9a-9287-bed77d33b1a4';
  const tokenId = 3;

  // 1. Ledger balance
  const bal = await safeQuery('SELECT * FROM credit_ledger_balances WHERE user_id = $1 AND token_id = $2', [userId, tokenId]);
  console.log('=== DB Ledger Balance ===');
  console.log(bal.rows[0]);

  // 2. Ledger entries
  const entries = await safeQuery('SELECT action_type, amount_delta, ref_table, ref_id, tx_hash, block_number, chain_status, created_at FROM credit_ledger_entries WHERE user_id = $1 AND token_id = $2 ORDER BY created_at DESC LIMIT 20', [userId, tokenId]);
  console.log('\n=== Ledger Entries ===');
  console.table(entries.rows);

  // 3. Active ledger listings
  const listings = await safeQuery('SELECT * FROM ledger_listings WHERE seller_id = $1 AND token_id = $2 AND active = TRUE', [userId, tokenId]);
  console.log('\n=== Active Ledger Listings ===');
  console.table(listings.rows);

  // 4. Market cache check - query the market listings directly
  const market = await safeQuery(`SELECT ll.id AS listing_id, cb.project_name, ll.amount_remaining, ll.price_per_credit_inr, ll.active
       FROM ledger_listings ll
       JOIN carbon_batches cb ON cb.token_id = ll.token_id
       WHERE ll.active = TRUE AND ll.amount_remaining > 0
       ORDER BY ll.price_per_credit_inr ASC LIMIT 10`);
  console.log('\n=== Market Query (what getMarketListings returns) ===');
  console.table(market.rows);

  process.exit(0);
}

check().catch(console.error).finally(() => process.exit(1));