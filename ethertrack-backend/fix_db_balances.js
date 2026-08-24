require('dotenv').config();
const { safeQuery } = require('./db/pool.js');

async function fix() {
  const tradeId = '2bf2da43-a6c6-4094-b3bf-dc2af067f231';
  const sellerId = '706c67a4-de98-4a9a-9287-bed77d33b1a4';
  const buyerId = '45aced03-8164-44d8-9f39-c6bb828ba9cd';
  const tokenId = 3;
  const amount = 500;
  
  console.log('Fixing DB balances to match economic reality...');
  
  // Seller: 0 (sold all 500)
  await safeQuery(
    `UPDATE credit_ledger_balances SET balance = 0, updated_at = NOW() WHERE user_id = $1 AND token_id = $2`,
    [sellerId, tokenId]
  );
  console.log('Seller balance → 0');
  
  // Buyer: 500 (bought 500)
  await safeQuery(
    `INSERT INTO credit_ledger_balances (user_id, token_id, balance, total_retired, updated_at)
     VALUES ($1, $2, $3, 0, NOW())
     ON CONFLICT (user_id, token_id) DO UPDATE SET balance = $3, updated_at = NOW()`,
    [buyerId, tokenId, amount]
  );
  console.log('Buyer balance → 500');
  
  // Add BUY ledger entry (even though on-chain failed, for audit trail)
  const { ethers } = require('ethers');
  const userIdHash = (uuid) => ethers.keccak256(ethers.toUtf8Bytes(uuid));
  const buyerHash = userIdHash(buyerId);
  const refHash = ethers.keccak256(ethers.toUtf8Bytes(`${buyerHash}:${tokenId}:${amount}:BUY:trades:${tradeId}`));
  
  await safeQuery(
    `INSERT INTO credit_ledger_entries (user_id, user_id_hash, token_id, amount_delta, action_type, ref_hash, ref_table, ref_id, note, chain_status)
     VALUES ($1,$2,$3,$4,'BUY',$5,'trades',$6,'Trade ${tradeId} - buy 500 Mango Farms (on-chain failed, INR settled)','confirmed')
     ON CONFLICT DO NOTHING`,
    [buyerId, buyerHash, tokenId, amount, refHash, tradeId]
  );
  console.log('Added BUY ledger entry (discrepancy noted)');
  
  // Update trade
  await safeQuery(`UPDATE trades SET chain_status = 'discrepancy', updated_at = NOW() WHERE id = $1`, [tradeId]);
  console.log('Trade marked discrepancy');
  
  // Verify
  const bal = await safeQuery('SELECT * FROM credit_ledger_balances WHERE token_id = $1 AND balance > 0', [tokenId]);
  console.log('\nFinal DB balances:');
  console.table(bal.rows);
  
  process.exit(0);
}

fix().catch(console.error).finally(() => process.exit(1));