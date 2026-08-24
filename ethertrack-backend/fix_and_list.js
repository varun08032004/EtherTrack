require('dotenv').config();
const { safeQuery } = require('./db/pool.js');

async function fixAndCreate() {
  const userId = '706c67a4-de98-4a9a-9287-bed77d33b1a4';
  const tokenId = 3;
  const amount = 100;
  const priceInINR = 850;
  const durationDays = 30;

  console.log('Fixing balance mismatch...');
  
  // Get on-chain balance first
  const { ethers } = require('ethers');
  const RPC_URL = process.env.ALCHEMY_RPC;
  const CUSTODY_KEY = process.env.MINTER_PRIVATE_KEY;
  const CREDIT_LEDGER_ADDRESS = process.env.CREDIT_LEDGER_ADDRESS;
  
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(CUSTODY_KEY, provider);
  
  const LEDGER_ABI = [
    'function getUserBalance(bytes32 userId, uint256 tokenId) view returns (uint256)',
    'function computeUserId(string calldata userUuid) view returns (bytes32)',
  ];
  
  const ledger = new ethers.Contract(CREDIT_LEDGER_ADDRESS, LEDGER_ABI, wallet);
  const userIdHash = ethers.keccak256(ethers.toUtf8Bytes(userId));
  const onChainBalance = await ledger.getUserBalance(userIdHash, tokenId);
  console.log('On-chain balance:', onChainBalance.toString());

  // Fix DB to match on-chain
  await safeQuery(
    `UPDATE credit_ledger_balances SET balance = $1, updated_at = NOW() WHERE user_id = $2 AND token_id = $3`,
    [onChainBalance.toString(), userId, tokenId]
  );
  console.log('✅ DB balance fixed to:', onChainBalance.toString());

  // Now create listing
  console.log('\nCreating listing...');
  const { rows } = await safeQuery(
    `INSERT INTO ledger_listings
       (seller_id, token_id, batch_id, amount, amount_remaining, price_per_credit_inr, expires_at)
     VALUES ($1,$2,$3,$4,$4,$5, NOW() + ($6 || ' days')::INTERVAL)
     RETURNING id`,
    [userId, tokenId, null, amount, priceInINR, durationDays]
  );

  const listingId = rows[0].id;
  console.log('✅ Listing created:', listingId);

  // Invalidate cache
  try {
    const { incrementPortfolioVersion, invalidateEntity } = require('./services/cacheStrategy');
    await incrementPortfolioVersion(userId);
    await invalidateEntity('market', 'listings');
    console.log('✅ Cache invalidated');
  } catch (e) {
    console.warn('Cache invalidation skipped:', e.message);
  }

  // Verify
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

fixAndCreate().catch(console.error).finally(() => process.exit(1));