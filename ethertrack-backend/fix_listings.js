require('dotenv').config();
const { safeQuery } = require('./db/pool.js');

async function fix() {
  // 1. Remove incorrect token 1 listing by Mango Farms user (706c67a4)
  await safeQuery(
    `UPDATE ledger_listings SET active = FALSE WHERE seller_id = $1 AND token_id = 1 AND active = TRUE`,
    ['706c67a4-de98-4a9a-9287-bed77d33b1a4']
  );
  console.log('✅ Deactivated incorrect token 1 listing by Mango Farms user');

  // 2. Recreate Mango Farms token 3 listing (100 credits at ₹850)
  const { rows } = await safeQuery(
    `INSERT INTO ledger_listings
       (seller_id, token_id, batch_id, amount, amount_remaining, price_per_credit_inr, expires_at)
     VALUES ($1,$2,$3,$4,$4,$5, NOW() + ($6 || ' days')::INTERVAL)
     RETURNING id`,
    ['706c67a4-de98-4a9a-9287-bed77d33b1a4', 3, '1fdb198f-ecad-4175-9984-5a2581ff46de', 100, 850, 30]
  );
  console.log('✅ Created Mango Farms token 3 listing:', rows[0].id);

  // 3. Create Deshmukh Solar token 1 listing (3000 at ₹850) - by correct user
  const { rows: rows2 } = await safeQuery(
    `INSERT INTO ledger_listings
       (seller_id, token_id, batch_id, amount, amount_remaining, price_per_credit_inr, expires_at)
     VALUES ($1,$2,$3,$4,$4,$5, NOW() + ($6 || ' days')::INTERVAL)
     RETURNING id`,
    ['45aced03-8164-44d8-9f39-c6bb828ba9cd', 1, '7cc35e17-4b08-4e27-b56f-3f90bd915b4b', 3000, 850, 30]
  );
  console.log('✅ Created Deshmukh Solar token 1 listing:', rows2[0].id);

  // Verify
  const market = await safeQuery(`
    SELECT ll.id AS listing_id, cb.project_name, ll.seller_id, ll.token_id, ll.amount_remaining, ll.price_per_credit_inr, ll.active
    FROM ledger_listings ll
    JOIN carbon_batches cb ON cb.token_id = ll.token_id AND cb.user_id = ll.seller_id
    WHERE ll.active = TRUE AND ll.amount_remaining > 0
    ORDER BY ll.price_per_credit_inr ASC
  `);
  console.log('\n=== Market Listings (fixed) ===');
  console.table(market.rows);

  process.exit(0);
}

fix().catch(console.error).finally(() => process.exit(1));