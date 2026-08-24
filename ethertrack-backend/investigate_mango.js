require('dotenv').config();
const { safeQuery } = require('./db/pool.js');

async function investigate() {
  console.log('=== Finding ALL users with Mango Farms credits ===');
  
  // Find all batches with "Mango Farms" project name
  const batches = await safeQuery(`
    SELECT cb.id, cb.project_name, cb.user_id, cb.token_id, cb.total_credits, cb.available_credits, u.email
    FROM carbon_batches cb
    JOIN users u ON u.id = cb.user_id
    WHERE cb.project_name ILIKE '%mango%farms%nashik%'
  `);
  console.log('\nMango Farms batches:');
  console.table(batches.rows);
  
  // Check trades involving these batches
  const batchIds = batches.rows.map(r => r.id);
  if (batchIds.length > 0) {
    const trades = await safeQuery(`
      SELECT t.*, cb.project_name, t.buyer_id, t.seller_id, u_b.email as buyer_email, u_s.email as seller_email
      FROM trades t
      JOIN carbon_batches cb ON cb.id = t.batch_id
      JOIN users u_b ON u_b.id = t.buyer_id
      JOIN users u_s ON u_s.id = t.seller_id
      WHERE cb.id = ANY($1)
    `, [batchIds]);
    console.log('\nTrades for Mango Farms batches:');
    console.table(trades.rows);
  }
  
  // Check ledger listings
  const tokenIds = batches.rows.map(r => r.token_id);
  const listings = await safeQuery(`
    SELECT ll.*, cb.project_name, u.email as seller_email
    FROM ledger_listings ll
    JOIN carbon_batches cb ON cb.token_id = ll.token_id
    JOIN users u ON u.id = ll.seller_id
    WHERE ll.token_id = ANY($1) AND ll.active = TRUE
  `, [tokenIds]);
  console.log('\nActive ledger listings for these tokens:');
  console.table(listings.rows);
  
  // Check credit ledger balances for these tokens
  const balances = await safeQuery(`
    SELECT clb.*, u.email
    FROM credit_ledger_balances clb
    JOIN users u ON u.id = clb.user_id
    WHERE clb.token_id = ANY($1) AND clb.balance > 0
  `, [tokenIds]);
  console.log('\nCredit ledger balances for these tokens:');
  console.table(balances.rows);
  
  // Check portfolio/my-bought-credits query for each user
  for (const b of batches.rows) {
    const bought = await safeQuery(`
      SELECT t.id as trade_id, t.quantity, t.price_per_credit_inr, t.buyer_id, t.seller_id, t.status,
             cb.project_name, u_b.email as buyer_email, u_s.email as seller_email
      FROM trades t
      JOIN carbon_batches cb ON cb.id = t.batch_id
      JOIN users u_b ON u_b.id = t.buyer_id
      JOIN users u_s ON u_s.id = t.seller_id
      WHERE t.buyer_id = $1 AND t.status = 'completed' AND cb.project_name ILIKE '%mango%farms%nashik%'
    `, [b.user_id]);
    if (bought.rows.length > 0) {
      console.log(`\nUser ${b.email} (${b.user_id}) bought Mango Farms:`);
      console.table(bought.rows);
    }
  }
  
  process.exit(0);
}

investigate().catch(console.error).finally(() => process.exit(1));