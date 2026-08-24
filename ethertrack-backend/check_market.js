require('dotenv').config();
const { safeQuery: query } = require('./db/pool.js');

async function checkMarket() {
  const market = await query(`
    SELECT ll.id AS listing_id, cb.project_name, ll.amount_remaining, ll.price_per_credit_inr, ll.active
    FROM ledger_listings ll
    JOIN carbon_batches cb ON cb.token_id = ll.token_id
    WHERE ll.active = TRUE AND ll.amount_remaining > 0
    ORDER BY ll.price_per_credit_inr ASC
  `);
  console.table(market.rows);
  process.exit(0);
}

checkMarket().catch(console.error).finally(() => process.exit(1));