require('dotenv').config();
const { safeQuery } = require('./db/pool.js');
const { logOwnershipChangeOnChain } = require('./services/creditLedger');

async function fixTrade() {
  const tradeId = '2bf2da43-a6c6-4094-b3bf-dc2af067f231';
  
  // Check trade using 'id' column
  const trade = await safeQuery('SELECT * FROM trades WHERE id = $1', [tradeId]);
  console.log('Trade:', trade.rows[0] ? { id: trade.rows[0].id, settlement_state: trade.rows[0].settlement_state, chain_status: trade.rows[0].chain_status } : 'NOT FOUND');
  
  // Move to REQUIRES_RECONCILIATION
  await safeQuery(`UPDATE trades SET settlement_state = 'REQUIRES_RECONCILIATION', updated_at = NOW() WHERE id = $1`, [tradeId]);
  console.log('Moved to REQUIRES_RECONCILIATION');
  
  const sellerId = '706c67a4-de98-4a9a-9287-bed77d33b1a4';
  const buyerId = '45aced03-8164-44d8-9f39-c6bb828ba9cd';
  const tokenId = 3;
  const amount = 500;
  
  console.log('\n--- Executing credit transfer ---');
  
  // 1. Debit seller (SELL)
  const sellerResult = await logOwnershipChangeOnChain({
    userId: sellerId,
    tokenId,
    amountDelta: -amount,
    actionType: 'SELL',
    refTable: 'trades',
    refId: tradeId,
    note: `Trade ${tradeId} - sell 500 Mango Farms`
  });
  console.log('Seller SELL:', sellerResult.txHash);
  
  // 2. Credit buyer (BUY)
  const buyerResult = await logOwnershipChangeOnChain({
    userId: buyerId,
    tokenId,
    amountDelta: amount,
    actionType: 'BUY',
    refTable: 'trades',
    refId: tradeId,
    note: `Trade ${tradeId} - buy 500 Mango Farms`
  });
  console.log('Buyer BUY:', buyerResult.txHash);
  
  // Update trade
  await safeQuery(`UPDATE trades SET chain_status = 'confirmed', settlement_state = 'SETTLED', updated_at = NOW() WHERE id = $1`, [tradeId]);
  console.log('✅ Trade marked SETTLED');
  
  // Verify balances
  const bal = await safeQuery('SELECT * FROM credit_ledger_balances WHERE token_id = $1 AND balance > 0', [tokenId]);
  console.log('\nFinal balances:');
  console.table(bal.rows);
  
  process.exit(0);
}

fixTrade().catch(console.error).finally(() => process.exit(1));