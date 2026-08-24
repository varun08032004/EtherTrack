require('dotenv').config();
const { safeQuery } = require('./db/pool.js');
const { ethers } = require('ethers');

async function mint() {
  const RPC_URL = process.env.ALCHEMY_RPC;
  const CUSTODY_KEY = process.env.MINTER_PRIVATE_KEY;
  const CREDIT_LEDGER_ADDRESS = process.env.CREDIT_LEDGER_ADDRESS;
  const CARBON_CREDIT_TOKEN_ADDRESS = process.env.CARBON_CREDIT_TOKEN_ADDRESS;

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(CUSTODY_KEY, provider);

  // CreditLedger contract
  const LEDGER_ABI = [
    'function logOwnershipChange(bytes32 userId, uint256 tokenId, int256 amountDelta, uint8 actionType, bytes32 refHash, string calldata note) external returns (uint256 logId)',
    'function computeUserId(string calldata userUuid) view returns (bytes32)',
  ];
  const ledger = new ethers.Contract(CREDIT_LEDGER_ADDRESS, LEDGER_ABI, wallet);

  // CarbonCreditToken contract
  const TOKEN_ABI = [
    'function mint(address to, uint256 id, uint256 amount, bytes calldata data) external',
    'function balanceOf(address account, uint256 id) view returns (uint256)',
  ];
  const token = new ethers.Contract(CARBON_CREDIT_TOKEN_ADDRESS, TOKEN_ABI, wallet);

  const userIdHash = (uuid) => ethers.keccak256(ethers.toUtf8Bytes(uuid));

  // Fix 1: Deshmukh Solar user (45aced03...) token 1 - 3000 credits
  const user1 = '45aced03-8164-44d8-9f39-c6bb828ba9cd';
  const tokenId1 = 1;
  const amount1 = 3000;

  console.log(`Minting ${amount1} credits for user ${user1} token ${tokenId1}...`);
  
  // Mint ERC1155 tokens
  const mintTx = await token.mint(wallet.address, tokenId1, amount1, '0x');
  const mintReceipt = await mintTx.wait();
  console.log('ERC1155 mint tx:', mintTx.hash);

  // Log MINT in CreditLedger
  const userIdHash1 = userIdHash(user1);
  const refHash1 = ethers.keccak256(ethers.toUtf8Bytes(`${userIdHash1}:${tokenId1}:${amount1}:MINT:carbon_batches:fix`));
  const ledgerTx = await ledger.logOwnershipChange(userIdHash1, tokenId1, amount1, 0, refHash1, 'Reconciliation mint');
  const ledgerReceipt = await ledgerTx.wait();
  console.log('CreditLedger MINT tx:', ledgerTx.hash);

  // Update DB
  await safeQuery(
    `INSERT INTO credit_ledger_entries (user_id, user_id_hash, token_id, amount_delta, action_type, ref_hash, ref_table, ref_id, note, tx_hash, block_number, chain_status)
     VALUES ($1,$2,$3,$4,'MINT',$5,'carbon_batches',(SELECT id FROM carbon_batches WHERE token_id = $3 AND user_id = $1 LIMIT 1),'Reconciliation mint',$6,$7,'confirmed')`,
    [user1, userIdHash1, tokenId1, amount1, refHash1, ledgerTx.hash, ledgerReceipt.blockNumber]
  );
  await safeQuery(
    `UPDATE credit_ledger_balances SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2 AND token_id = $3`,
    [amount1, user1, tokenId1]
  );
  console.log('✅ User 1 fixed');

  // Fix 2: Mango Farms user (706c67a4...) token 2 - 3000 credits
  const user2 = '706c67a4-de98-4a9a-9287-bed77d33b1a4';
  const tokenId2 = 2;
  const amount2 = 3000;

  console.log(`\nMinting ${amount2} credits for user ${user2} token ${tokenId2}...`);
  
  const mintTx2 = await token.mint(wallet.address, tokenId2, amount2, '0x');
  const mintReceipt2 = await mintTx2.wait();
  console.log('ERC1155 mint tx:', mintTx2.hash);

  const userIdHash2 = userIdHash(user2);
  const refHash2 = ethers.keccak256(ethers.toUtf8Bytes(`${userIdHash2}:${tokenId2}:${amount2}:MINT:carbon_batches:fix`));
  const ledgerTx2 = await ledger.logOwnershipChange(userIdHash2, tokenId2, amount2, 0, refHash2, 'Reconciliation mint');
  const ledgerReceipt2 = await ledgerTx2.wait();
  console.log('CreditLedger MINT tx:', ledgerTx2.hash);

  await safeQuery(
    `INSERT INTO credit_ledger_entries (user_id, user_id_hash, token_id, amount_delta, action_type, ref_hash, ref_table, ref_id, note, tx_hash, block_number, chain_status)
     VALUES ($1,$2,$3,$4,'MINT',$5,'carbon_batches',(SELECT id FROM carbon_batches WHERE token_id = $3 AND user_id = $1 LIMIT 1),'Reconciliation mint',$6,$7,'confirmed')`,
    [user2, userIdHash2, tokenId2, amount2, refHash2, ledgerTx2.hash, ledgerReceipt2.blockNumber]
  );
  await safeQuery(
    `UPDATE credit_ledger_balances SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2 AND token_id = $3`,
    [amount2, user2, tokenId2]
  );
  console.log('✅ User 2 fixed');

  process.exit(0);
}

mint().catch(console.error).finally(() => process.exit(1));