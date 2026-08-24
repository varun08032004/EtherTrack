require('dotenv').config();
const { safeQuery } = require('./db/pool.js');
const { ethers } = require('ethers');

async function addMints() {
  const RPC_URL = process.env.ALCHEMY_RPC;
  const CUSTODY_KEY = process.env.MINTER_PRIVATE_KEY;
  const CREDIT_LEDGER_ADDRESS = process.env.CREDIT_LEDGER_ADDRESS;

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(CUSTODY_KEY, provider);

  const LEDGER_ABI = [
    'function logOwnershipChange(bytes32 userId, uint256 tokenId, int256 amountDelta, uint8 actionType, bytes32 refHash, string calldata note) external returns (uint256 logId)',
    'function computeUserId(string calldata userUuid) view returns (bytes32)',
  ];
  const ledger = new ethers.Contract(CREDIT_LEDGER_ADDRESS, LEDGER_ABI, wallet);

  const userIdHash = (uuid) => ethers.keccak256(ethers.toUtf8Bytes(uuid));

  const fixes = [
    // Deshmukh Solar user (45aced03...) - token 1 - 3000 credits
    { 
      userId: '45aced03-8164-44d8-9f39-c6bb828ba9cd', 
      tokenId: 1, 
      amount: 3000,
      batchId: '7cc35e17-4b08-4e27-b56f-3f90bd915b4b',
      serial: 'VCS-0000122'
    },
    // Mango Farms user (706c67a4...) - token 2 - 3000 credits
    { 
      userId: '706c67a4-de98-4a9a-9287-bed77d33b1a4', 
      tokenId: 2, 
      amount: 3000,
      batchId: 'dde40c5e-4a2c-4263-b3dc-e3963572e023',
      serial: 'VCS-233 233 23378'
    },
    // Mango Farms user - token 3 - 500 credits (already has 500 on-chain)
    // This one already has MINT logged, just need to verify
  ];

  for (const f of fixes) {
    console.log(`\n=== Adding MINT for user ${f.userId} token ${f.tokenId} amount ${f.amount} ===`);
    
    const uHash = userIdHash(f.userId);
    const refHash = ethers.keccak256(ethers.toUtf8Bytes(`${uHash}:${f.tokenId}:${f.amount}:MINT:carbon_batches:${f.batchId}`));

    // Log MINT in CreditLedger
    const tx = await ledger.logOwnershipChange(uHash, f.tokenId, f.amount, 0, refHash, 'Reconciliation MINT');
    const receipt = await tx.wait();
    console.log('CreditLedger MINT tx:', tx.hash, 'block:', receipt.blockNumber);

    // Get onchain log ID
    let onchainLogId = null;
    for (const log of receipt.logs) {
      try {
        const parsed = ledger.interface.parseLog(log);
        if (parsed?.name === 'OwnershipLogged') { onchainLogId = Number(parsed.args.logId); break; }
      } catch {}
    }

    // Add DB entry
    await safeQuery(
      `INSERT INTO credit_ledger_entries (onchain_log_id, user_id, user_id_hash, token_id, amount_delta, action_type, ref_hash, ref_table, ref_id, note, tx_hash, block_number, chain_status)
       VALUES ($1,$2,$3,$4,$5,'MINT',$6,'carbon_batches',$7,'Reconciliation MINT',$8,$9,'confirmed')
       ON CONFLICT DO NOTHING`,
      [onchainLogId, f.userId, uHash, f.tokenId, f.amount, refHash, f.batchId, tx.hash, receipt.blockNumber]
    );

    // Update balance
    await safeQuery(
      `INSERT INTO credit_ledger_balances (user_id, token_id, balance, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, token_id) 
       DO UPDATE SET balance = credit_ledger_balances.balance + EXCLUDED.balance, updated_at = NOW()`,
      [f.userId, f.tokenId, f.amount]
    );

    console.log('✅ Added MINT for token', f.tokenId);
  }

  // Verify final balances
  for (const f of fixes) {
    const bal = await safeQuery('SELECT balance FROM credit_ledger_balances WHERE user_id = $1 AND token_id = $2', [f.userId, f.tokenId]);
    console.log(`\nFinal DB balance for ${f.userId} token ${f.tokenId}:`, bal.rows[0]?.balance || 0);
  }

  process.exit(0);
}

addMints().catch(console.error).finally(() => process.exit(1));