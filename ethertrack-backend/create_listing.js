require('dotenv').config();
const { safeQuery } = require('./db/pool.js');
const { getLedgerBalance, verifyLedgerBalance } = require('./services/creditLedger');

async function createListing() {
  const userId = '706c67a4-de98-4a9a-9287-bed77d33b1a4';
  const tokenId = 3;
  const amount = 100;  // list 100 credits
  const priceInINR = 850;
  const durationDays = 30;

  console.log(`Creating listing for user ${userId}, token ${tokenId}, amount ${amount}, price ${priceInINR}...`);

  // 1. Check custody model
  const batch = await safeQuery(
    `SELECT custody_model FROM carbon_batches WHERE token_id = $1 AND user_id = $2 LIMIT 1`,
    [tokenId, userId]
  );
  if (!batch.rows.length || batch.rows[0].custody_model !== 'pooled') {
    console.error('Not pooled custody');
    process.exit(1);
  }
  console.log('✓ Custody model: pooled');

  // 2. Verify ledger balance
  const current = await getLedgerBalance(userId, tokenId);
  console.log('DB Balance:', current.balance);

  const verified = await verifyLedgerBalance(userId, tokenId);
  console.log('On-chain Balance:', verified.onChain, '| Match:', verified.matches);
  if (!verified.matches) {
    console.error('Balance mismatch!');
    process.exit(1);
  }

  // 3. Check already listed
  const { rows: activeListings } = await safeQuery(
    `SELECT COALESCE(SUM(amount_remaining), 0) as listed
     FROM ledger_listings WHERE seller_id = $1 AND token_id = $2 AND active = TRUE`,
    [userId, tokenId]
  );
  const alreadyListed = Number(activeListings[0].listed);
  const available = Number(current.balance) - alreadyListed;
  console.log('Available:', available, '(held:', current.balance, '- listed:', alreadyListed, ')');
  
  if (available < amount) {
    console.error('Insufficient available');
    process.exit(1);
  }

  // 4. Insert listing
  const { rows } = await safeQuery(
    `INSERT INTO ledger_listings
       (seller_id, token_id, batch_id, amount, amount_remaining, price_per_credit_inr, expires_at)
     VALUES ($1,$2,$3,$4,$4,$5, NOW() + ($6 || ' days')::INTERVAL)
     RETURNING id`,
    [userId, tokenId, null, amount, priceInINR, durationDays]
  );

  const listingId = rows[0].id;
  console.log('✅ Listing created:', listingId);

  // 5. Invalidate cache (if Redis available)
  try {
    const { incrementPortfolioVersion, invalidateEntity } = require('./services/cacheStrategy');
    await incrementPortfolioVersion(userId);
    await invalidateEntity('market', 'listings');
    console.log('✅ Cache invalidated');
  } catch (e) {
    console.warn('Cache invalidation skipped:', e.message);
  }

  // 6. Verify it appears in market query
  const market = await safeQuery(`
    SELECT ll.id AS listing_id, cb.project_name, ll.amount_remaining, ll.price_per_credit_inr, ll.active
    FROM ledger_listings ll
    JOIN carbon_batches cb ON cb.token_id = ll.token_id
    WHERE ll.active = TRUE AND ll.amount_remaining > 0
    ORDER BY ll.price_per_credit_inr ASC LIMIT 10
  `);
  console.log('\n=== Market Listings Now ===');
  console.table(market.rows);

  process.exit(0);
}

createListing().catch(console.error).finally(() => process.exit(1));