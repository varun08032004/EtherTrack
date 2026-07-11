// scripts/backfill-legacy-inr-trades.js
// ─────────────────────────────────────────────────────────────────────────────
// ONE-TIME remediation for trades that were marked 'completed' in the DB
// (payment received) BEFORE settleINRTrade() existed. Those trades only ever
// called logINRTrade() (an audit-log-only function that never moved tokens),
// so buyers paid real money but never actually received their credits
// on-chain. This script delivers what they're actually owed, directly via
// the deployer/seller's own wallet — NOT through Marketplace escrow, since
// these legacy trades were never associated with an on-chain listing.
//
// Usage:
//   node scripts/backfill-legacy-inr-trades.js --dry-run     (preview only)
//   node scripts/backfill-legacy-inr-trades.js               (execute)
//
// Requires .env: ALCHEMY_RPC, MINTER_PRIVATE_KEY, CARBON_CREDIT_TOKEN_ADDRESS
// IMPORTANT: MINTER_PRIVATE_KEY must control the SELLER's wallet for these
// specific legacy trades (or the seller must have already granted
// setApprovalForAll to whatever wallet MINTER_PRIVATE_KEY controls), because
// this performs a real safeTransferFrom(seller, buyer, ...) using it.
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();
const { ethers } = require('ethers');
const { safeQuery: query, shutdown } = require('../db/pool');

const TOKEN_ABI = [
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data) external',
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function isApprovedForAll(address account, address operator) view returns (bool)',
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const rpcUrl   = process.env.ALCHEMY_RPC;
  const minterKey = process.env.MINTER_PRIVATE_KEY;
  const tokenAddr = process.env.CARBON_CREDIT_TOKEN_ADDRESS;
  if (!rpcUrl || !minterKey || !tokenAddr) {
    console.error('❌ Missing ALCHEMY_RPC, MINTER_PRIVATE_KEY, or CARBON_CREDIT_TOKEN_ADDRESS in .env');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet   = new ethers.Wallet(minterKey, provider);
  const token    = new ethers.Contract(tokenAddr, TOKEN_ABI, wallet);

  console.log(`🔍 Finding legacy INR trades with chain_status != null (i.e. "confirmed" from`);
  console.log(`   the old logINRTrade-only path) that never had a real token transfer...\n`);

  // Every trade currently in the table predates settleINRTrade() (this
  // script is meant to run exactly once, right after deploying the new
  // contracts) — so we just group ALL completed trades by (buyer, token_id)
  // and deliver the net total each buyer is actually owed per token.
  const { rows: trades } = await query(`
    SELECT t.buyer_id, t.seller_id, t.token_id, SUM(t.quantity) as total_owed,
           u_buyer.wallet_address as buyer_wallet,
           u_seller.wallet_address as seller_wallet
    FROM trades t
    JOIN users u_buyer  ON u_buyer.id  = t.buyer_id
    JOIN users u_seller ON u_seller.id = t.seller_id
    WHERE t.status = 'completed'
      AND t.token_id IS NOT NULL
    GROUP BY t.buyer_id, t.seller_id, t.token_id, u_buyer.wallet_address, u_seller.wallet_address
    ORDER BY total_owed DESC
  `);

  if (!trades.length) {
    console.log('✅ No legacy trades found — nothing to backfill.');
    await shutdown();
    return;
  }

  console.log(`Found ${trades.length} buyer/seller/token group(s):\n`);
  for (const t of trades) {
    console.log(`  Buyer ${t.buyer_wallet} owed ${t.total_owed} of token ${t.token_id} (from seller ${t.seller_wallet})`);
  }
  console.log('');

  if (dryRun) {
    console.log('ℹ️  --dry-run set, not executing any transfers. Re-run without --dry-run to proceed.');
    await shutdown();
    return;
  }

  for (const t of trades) {
    if (!t.buyer_wallet || !t.seller_wallet) {
      console.warn(`⚠️  Skipping — buyer or seller has no wallet_address linked (buyer_id=${t.buyer_id})`);
      continue;
    }

    try {
      // Check seller's actual on-chain balance covers what's owed — if the
      // seller wallet doesn't hold enough, something else is wrong and we
      // should not attempt a partial/incorrect transfer.
      const sellerBalance = await token.balanceOf(t.seller_wallet, t.token_id);
      if (Number(sellerBalance) < Number(t.total_owed)) {
        console.error(`❌ Seller ${t.seller_wallet} only holds ${sellerBalance} of token ${t.token_id}, but owes ${t.total_owed} — SKIPPING. Investigate before retrying.`);
        continue;
      }

      // Confirm our wallet can move the seller's tokens (either IS the
      // seller wallet, or has been granted setApprovalForAll by it).
      const isSelf     = wallet.address.toLowerCase() === t.seller_wallet.toLowerCase();
      const isApproved = isSelf || await token.isApprovedForAll(t.seller_wallet, wallet.address);
      if (!isApproved) {
        console.error(`❌ Wallet ${wallet.address} is not approved to move tokens for seller ${t.seller_wallet} — SKIPPING. Seller must call setApprovalForAll(${wallet.address}, true) first.`);
        continue;
      }

      console.log(`⛓  Transferring ${t.total_owed} of token ${t.token_id}: ${t.seller_wallet} → ${t.buyer_wallet}...`);
      const tx = await token.safeTransferFrom(t.seller_wallet, t.buyer_wallet, t.token_id, t.total_owed, '0x');
      const receipt = await tx.wait();

      if (receipt.status !== 1) {
        console.error(`❌ Transfer reverted for buyer ${t.buyer_wallet} — tx: ${tx.hash}`);
        continue;
      }

      console.log(`   ✅ Delivered. Block ${receipt.blockNumber}, tx: ${tx.hash}`);

      await query(
        `INSERT INTO admin_audit_log (admin_id, action, target_user_id, details)
         VALUES ($1,$2,$3,$4)`,
        [t.buyer_id, 'LEGACY_INR_TRADE_BACKFILLED', t.buyer_id,
         `Delivered ${t.total_owed} of token ${t.token_id} — TX: ${tx.hash}`]
      ).catch(() => {});

    } catch (e) {
      console.error(`❌ Failed for buyer ${t.buyer_wallet}, token ${t.token_id}:`, e.message);
    }
  }

  console.log('\n✅ Backfill run complete.');
  await shutdown();
}

main().catch(async (err) => {
  console.error('Script failed:', err);
  await shutdown().catch(() => {});
  process.exit(1);
});