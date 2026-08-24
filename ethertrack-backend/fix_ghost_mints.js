require('dotenv').config();
const { safeQuery } = require('./db/pool.js');

async function fix() {
  // Fix Mango Farms user (token_id=3)
  const user1 = '706c67a4-de98-4a9a-9287-bed77d33b1a4';
  const token1 = 3;
  
  // Fix Deshmukh Solar user (token_id=1) - need to find the user
  const user2 = '45aced03-8164-44d8-9f39-c6bb828ba9cd';
  const token2 = 1;

  for (const {userId, tokenId} of [{userId: user1, tokenId: token1}, {userId: user2, tokenId: token2}]) {
    console.log(`\n=== Fixing user ${userId} token ${tokenId} ===`);
    
    // Get on-chain balance
    const { ethers } = require('ethers');
    const RPC_URL = process.env.ALCHEMY_RPC;
    const CUSTODY_KEY = process.env.MINTER_PRIVATE_KEY;
    const CREDIT_LEDGER_ADDRESS = process.env.CREDIT_LEDGER_ADDRESS;
    
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(CUSTODY_KEY, provider);
    const LEDGER_ABI = ['function getUserBalance(bytes32 userId, uint256 tokenId) view returns (uint256)', 'function computeUserId(string calldata userUuid) view returns (bytes32)'];
    const ledger = new ethers.Contract(CREDIT_LEDGER_ADDRESS, LEDGER_ABI, wallet);
    const userIdHash = ethers.keccak256(ethers.toUtf8Bytes(userId));
    const onChainBalance = await ledger.getUserBalance(userIdHash, tokenId);
    console.log('On-chain balance:', onChainBalance.toString());

    // Get DB balance
    const dbBal = await safeQuery('SELECT balance FROM credit_ledger_balances WHERE user_id = $1 AND token_id = $2', [userId, tokenId]);
    console.log('DB balance before:', dbBal.rows[0]?.balance || 0);

    // Get ghost MINT entries (no tx_hash)
    const ghosts = await safeQuery(
      `SELECT * FROM credit_ledger_entries 
       WHERE user_id = $1 AND token_id = $2 AND action_type = 'MINT' AND tx_hash IS NULL`,
      [userId, tokenId]
    );
    console.log('Ghost MINT entries:', ghosts.rows.length);

    // Calculate total ghost amount
    const ghostTotal = ghosts.rows.reduce((sum, r) => sum + Number(r.amount_delta), 0);
    console.log('Ghost total amount:', ghostTotal);

    // Fix DB balance to match on-chain
    await safeQuery(
      `UPDATE credit_ledger_balances SET balance = $1, updated_at = NOW() WHERE user_id = $2 AND token_id = $3`,
      [onChainBalance.toString(), userId, tokenId]
    );
    console.log('✅ DB balance fixed to:', onChainBalance.toString());

    // Delete ghost entries
    if (ghosts.rows.length > 0) {
      await safeQuery(
        `DELETE FROM credit_ledger_entries WHERE user_id = $1 AND token_id = $2 AND action_type = 'MINT' AND tx_hash IS NULL`,
        [userId, tokenId]
      );
      console.log('✅ Deleted', ghosts.rows.length, 'ghost entries');
    }

    // Verify
    const newBal = await safeQuery('SELECT balance FROM credit_ledger_balances WHERE user_id = $1 AND token_id = $2', [userId, tokenId]);
    console.log('DB balance after:', newBal.rows[0].balance);
  }

  process.exit(0);
}

fix().catch(console.error).finally(() => process.exit(1));