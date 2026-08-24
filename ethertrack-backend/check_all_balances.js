require('dotenv').config();
const { safeQuery } = require('./db/pool.js');

async function check() {
  console.log('=== All Credit Ledger Balances ===');
  const balances = await safeQuery('SELECT * FROM credit_ledger_balances WHERE balance > 0 ORDER BY user_id, token_id');
  console.table(balances.rows);

  console.log('\n=== All Ledger Entries ===');
  const entries = await safeQuery('SELECT * FROM credit_ledger_entries ORDER BY created_at DESC LIMIT 30');
  console.table(entries.rows.map(e => ({ user: e.user_id.slice(0,8), token: e.token_id, action: e.action_type, delta: e.amount_delta, tx: e.tx_hash?.slice(0,12) })));

  console.log('\n=== Active Ledger Listings ===');
  const listings = await safeQuery('SELECT * FROM ledger_listings WHERE active = TRUE ORDER BY created_at');
  console.table(listings.rows.map(r => ({ id: r.id.slice(0,8), seller: r.seller_id.slice(0,8), token: r.token_id, amount: r.amount, remaining: r.amount_remaining, price: r.price_per_credit_inr, active: r.active })));

  console.log('\n=== Market Query ===');
  const market = await safeQuery(`
    SELECT ll.id AS listing_id, cb.project_name, ll.amount_remaining, ll.price_per_credit_inr, ll.active
    FROM ledger_listings ll
    JOIN carbon_batches cb ON cb.token_id = ll.token_id
    WHERE ll.active = TRUE AND ll.amount_remaining > 0
    ORDER BY ll.price_per_credit_inr ASC LIMIT 10
  `);
  console.table(market.rows);

  process.exit(0);
}

check().catch(console.error).finally(() => process.exit(1));