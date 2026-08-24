require('dotenv').config();
const { safeQuery } = require('./db/pool.js');

async function check() {
  const userId = '706c67a4-de98-4a9a-9287-bed77d33b1a4';
  const tokenId = 3;

  // Check ALL ledger listings for this user/token (active or not)
  const allListings = await safeQuery('SELECT * FROM ledger_listings WHERE seller_id = $1 AND token_id = $2 ORDER BY created_at DESC', [userId, tokenId]);
  console.log('=== ALL Ledger Listings (active + inactive) ===');
  console.table(allListings.rows.map(r => ({ 
    id: r.id, 
    amount: r.amount, 
    remaining: r.amount_remaining, 
    price: r.price_per_credit_inr, 
    active: r.active, 
    created: r.created_at,
    expires: r.expires_at
  })));

  // Check carbon_batches for this user
  const batches = await safeQuery('SELECT id, project_name, listed_quantity, available_credits, listing_id_onchain, custody_model FROM carbon_batches WHERE user_id = $1 AND token_id = $2', [userId, tokenId]);
  console.log('\n=== Carbon Batches ===');
  console.table(batches.rows);

  process.exit(0);
}

check().catch(console.error).finally(() => process.exit(1));