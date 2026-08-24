require('dotenv').config();
const { safeQuery } = require('./db/pool.js');
const { ethers } = require('ethers');

async function fixTrade() {
  const tradeId = '2bf2da43-a6c6-4094-b3bf-dc2af067f231';
  
  // Check current trade state
  const trade = await safeQuery('SELECT * FROM trades WHERE trade_id = $1', [tradeId]);
  console.log('Current trade:', trade.rows[0]?.settlement_state, trade.rows[0]?.chain_status);
  
  // Check if credit transfer exists
  const ct = await safeQuery('SELECT * FROM credit_transfers WHERE trade_id = $1', [tradeId]);
  console.log('Credit transfer:', ct.rows[0]);
  
  // Check credit transfer operations
  if (ct.rows.length > 0) {
    const ops = await safeQuery('SELECT * FROM credit_transfer_operations WHERE transfer_id = $1', [ct.rows[0].transfer_id]);
    console.log('Operations:', ops.rows);
  }
  
  // Move trade to REQUIRES_RECONCILIATION since chain failed
  await safeQuery(
    `UPDATE trades SET settlement_state = 'REQUIRES_RECONCILIATION', updated_at = NOW() WHERE trade_id = $1`,
    [tradeId]
  );
  console.log('\n✅ Moved trade to REQUIRES_RECONCILIATION');
  
  // Now execute the credit transfer via CreditTransferService
  // For ledger-based (pooled custody), it's a ledger-to-ledger transfer
  const { executeTransfer } = require('./services/credit-transfer/CreditTransferService');
  
  // Actually, let me just manually do the ledger transfer since both are pooled custody
  // Seller: 706c67a4... (Mango Farms user)
  // Buyer: 45aced03... (Deshmukh Solar user)
  // Token: 3, Amount: 500
  
  const sellerId = '706c67a4-de98-4a9a-9287-bed77d33b1a4';
  const buyerId = '45aced03-8164-44d8-9f39-c6bb828ba9cd';
  const tokenId = 3;
  const amount = 500;
  
  console.log('\n--- Executing manual credit transfer ---');
  
  // 1. Debit seller (SELL)
  const { logOwnershipChangeOnChain } = require('./services/creditLedger');
  
  const sellerResult = await logOwnershipChangeOnChain({
    userId: sellerId,
    tokenId,
    amountDelta: -amount,
    actionType: 'SELL',
    refTable: 'trades',
    refId: tradeId,
    note: `Trade ${tradeId} - sell 500 Mango Farms to buyer`
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
    note: `Trade ${tradeId} - buy 500 Mango Farms from seller`
  });
  console.log('Buyer BUY:', buyerResult.txHash);
  
  // Update credit_transfer status
  if (ct.rows.length > 0) {
    await safeQuery(
      `UPDATE credit_transfers SET status = 'CONFIRMED', completed_at = NOW(), updated_at = NOW() WHERE transfer_id = $1`,
      [ct.rows[0].transfer_id]
    );
    console.log('✅ Credit transfer marked CONFIRMED');
  }
  
  // Update trade chain_status
  await safeQuery(
    `UPDATE trades SET chain_status = 'confirmed', settlement_state = 'SETTLED', updated_at = NOW() WHERE trade_id = $1`,
    [tradeId]
  );
  console.log('✅ Trade marked SETTLED');
  
  // Verify balances
  const bal = await safeQuery('SELECT * FROM credit_ledger_balances WHERE token_id = $1 AND balance > 0', [tokenId]);
  console.log('\nFinal balances:');
  console.table(bal.rows);
  
  process.exit(0);
}

fixTrade().catch(console.error).finally(() => process.exit(1));