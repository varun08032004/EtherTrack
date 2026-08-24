require('dotenv').config();
const { SettlementEngine } = require('../src/services/settlement/SettlementEngine');
const { ListingService } = require('../src/services/listing/ListingService');
const { TradeService } = require('../src/services/trade/TradeService');
const { v4: uuidv4 } = require('uuid');
const { safeQuery: query, withTransaction } = require('./db/pool');

const NUM_CONCURRENT_TRADES = 50;
const NUM_USERS = 10;

async function setupTestData() {
  console.log('Setting up test data...');
  
  // Create test users
  const userIds = [];
  for (let i = 0; i < NUM_USERS; i++) {
    const { rows } = await query(
      `INSERT INTO users (email, password_hash, full_name, role, kyc_status, kyc_verified, inr_balance)
       VALUES ($1, 'hash', $2, 'user', 'verified', true, 1000000)
       RETURNING id`,
      [`loadtest_buyer_${i}@test.com`, `Load Buyer ${i}`]
    );
    userIds.push(rows[0].id);
  }
  
  // Create seller users
  const sellerIds = [];
  for (let i = 0; i < NUM_USERS; i++) {
    const { rows } = await query(
      `INSERT INTO users (email, password_hash, full_name, role, kyc_status, kyc_verified, inr_balance)
       VALUES ($1, 'hash', $2, 'user', 'verified', true, 0)
       RETURNING id`,
      [`loadtest_seller_${i}@test.com`, `Load Seller ${i}`]
    );
    sellerIds.push(rows[0].id);
  }
  
  // Create carbon assets
  const assetIds = [];
  for (let i = 0; i < 5; i++) {
    const { rows } = await query(
      `INSERT INTO carbon_assets (token_id, project_id, standard, project_type, vintage, methodology, serial_number, total_supply, retired_supply, status)
       VALUES ($1, $2, 'VCS', 'Renewable', 2023, 'VM001', $3, 10000, 0, 'active')
       RETURNING asset_id`,
      [1000 + i, `proj_${i}`, `SERIAL-${i}`]
    );
    assetIds.push(rows[0].asset_id);
  }
  
  // Create ownership positions for sellers
  for (let i = 0; i < sellerIds.length; i++) {
    for (let j = 0; j < assetIds.length; j++) {
      await query(
        `INSERT INTO ownership_positions (owner_id, asset_id, custody_type, owned_quantity, reserved_quantity, status)
         VALUES ($1, $2, 'ledger', 1000, 0, 'active')
         ON CONFLICT (owner_id, asset_id, custody_type) DO UPDATE SET owned_quantity = 1000`,
        [sellerIds[i], assetIds[j]]
      );
    }
  }
  
  // Create listings
  const listingIds = [];
  const listingService = new ListingService();
  for (let i = 0; i < sellerIds.length; i++) {
    for (let j = 0; j < assetIds.length; j++) {
      const listing = await listingService.createListing({
        sellerId: sellerIds[i],
        assetId: assetIds[j],
        quantity: 100,
        pricePerUnit: 500 + (j * 50),
        currency: 'INR',
        durationDays: 30
      });
      listingIds.push(listing.listingId);
    }
  }
  
  console.log(`Created ${userIds.length} buyers, ${sellerIds.length} sellers, ${assetIds.length} assets, ${listingIds.length} listings`);
  return { userIds, sellerIds, assetIds, listingIds };
}

async function runLoadTest() {
  console.log(`Starting load test with ${NUM_CONCURRENT_TRADES} concurrent trades...`);
  
  const { userIds, listingIds } = await setupTestData();
  
  const settlementEngine = new SettlementEngine();
  const tradeService = new TradeService(settlementEngine, new (require('./src/services/listing/ListingService'))());
  
  const startTime = Date.now();
  const results = { success: 0, failed: 0, errors: [] };
  
  // Run concurrent trades
  const promises = [];
  for (let i = 0; i < NUM_CONCURRENT_TRADES; i++) {
    const buyerId = userIds[i % userIds.length];
    const listingId = listingIds[i % listingIds.length];
    const quantity = Math.floor(Math.random() * 50) + 10;
    
    promises.push(
      (async () => {
        try {
          // Get quote
          const quote = await settlementEngine.generateQuote(listingId, quantity, buyerId, 'inr_wallet');
          
          // Create trade
          const trade = await tradeService.createTrade(quote, buyerId, { razorpayOrderId: `order_${uuidv4()}` });
          
          // Simulate payment capture
          await settlementEngine.transitionToFundsReserved(trade.tradeId);
          await settlementEngine.transitionToCreditsReserved(trade.tradeId);
          await settlementEngine.transitionToSettlementPending(trade.tradeId);
          
          // Execute credit transfer (ledger-to-ledger)
          const { CreditTransferService } = require('./services/credit-transfer/CreditTransferService');
          const ctService = new CreditTransferService();
          const operations = await ctService.executeTransfer(trade);
          
          await settlementEngine.transitionToCreditTransferSubmitted(trade.tradeId, operations);
          await settlementEngine.transitionToCreditTransferConfirmed(trade.tradeId);
          
          // Simulate payment settlement
          await settlementEngine.transitionToPaymentSettled(trade.tradeId, {
            providerReference: `pay_${uuidv4()}`,
            capturedAt: new Date()
          });
          
          await settlementEngine.transitionToFeesCollected(trade.tradeId);
          await settlementEngine.transitionToSellerPaid(trade.tradeId);
          await settlementEngine.transitionToBuyerCredited(trade.tradeId);
          await settlementEngine.transitionToSettled(trade.tradeId);
          
          results.success++;
        } catch (err) {
          results.failed++;
          results.errors.push(err.message);
        }
      })()
    );
  }
  
  await Promise.all(promises);
  
  const duration = (Date.now() - startTime) / 1000;
  console.log(`\n=== Load Test Results ===`);
  console.log(`Duration: ${duration.toFixed(2)}s`);
  console.log(`Successful trades: ${results.success}`);
  console.log(`Failed trades: ${results.failed}`);
  console.log(`Throughput: ${(results.success / duration).toFixed(2)} trades/sec`);
  
  if (results.errors.length > 0) {
    console.log('\nErrors:');
    results.errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
  }
  
  return results;
}

if (require.main === module) {
  runLoadTest()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Load test failed:', err);
      process.exit(1);
    });
}

module.exports = { runLoadTest };