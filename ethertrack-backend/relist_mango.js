require('dotenv').config();
const { safeQuery } = require('./db/pool.js');
const { invalidateEntity, incrementPortfolioVersion } = require('./services/cacheStrategy');

async function relist() {
  const userId = '706c67a4-de98-4a9a-9287-bed77d33b1a4';
  const tokenId = 3;
  const totalAmount = 500;  // list all 500
  const priceInINR = 850;
  const durationDays = 30;

  console.log(`Relisting ${totalAmount} credits for Mango Farms (token ${tokenId})...`);

  // 1. Deactivate current active listing(s)
  const { rows: deactivated } = await safeQuery(
    `UPDATE ledger_listings SET active = FALSE, updated_at = NOW()
     WHERE seller_id = $1 AND token_id = $2 AND active = TRUE
     RETURNING id, amount_remaining`,
    [userId, tokenId]
  );
  console.log('Deactivated listings:', deactivated.map(r => ({ id: r.id, remaining: r.amount_remaining })));

  // 2. Create new listing for full 500
  const { rows } = await safeQuery(
    `INSERT INTO ledger_listings
       (seller_id, token_id, batch_id, amount, amount_remaining, price_per_credit_inr, expires_at)
     VALUES ($1,$2,$3,$4,$4,$5, NOW() + ($6 || ' days')::INTERVAL)
     RETURNING id`,
    [userId, tokenId, '1fdb198f-ecad-4175-9984-5a2581ff46de', totalAmount, priceInINR, durationDays]
  );
  const listingId = rows[0].id;
  console.log('✅ New listing created:', listingId, 'for', totalAmount, 'credits');

  // 3. Invalidate cache
  try {
    await incrementPortfolioVersion(userId);
    await invalidateEntity('market', 'listings');
    console.log('✅ Cache invalidated');
  } catch (e) {
    console.warn('Cache invalidation:', e.message);
  }

  // 4. Verify
  const market = await safeQuery(`
    SELECT ll.id AS listing_id, cb.project_name, ll.amount_remaining, ll.price_per_credit_inr, ll.active
    FROM ledger_listings ll
    JOIN carbon_batches cb ON cb.token_id = ll.token_id
    WHERE ll.active = TRUE AND ll.amount_remaining > 0
    ORDER BY ll.price_per_credit_inr ASC
  `);
  console.log('\n=== Market Now ===');
  console.table(market.rows);

  process.exit(0);
}

relist().catch(console.error).finally(() => process.exit(1));