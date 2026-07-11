// scripts/approve-marketplace.js
// ─────────────────────────────────────────────────────────────────────────────
// ONE-TIME approval — lets the new Marketplace v3 contract move a seller's
// tokens on their behalf (required before listCreditFor() can escrow
// anything for them). This is a single transaction, run once per seller
// wallet, ever. Safe to re-run — if already approved, it just confirms and
// does nothing on-chain.
//
// Usage:
//   npx hardhat run scripts/approve-marketplace.js --network sepolia
//
// Uses whatever private key hardhat.config.js is configured to sign with
// for the `sepolia` network (same key that deployed your contracts) — so
// this approves on behalf of THAT wallet. If you need to approve a
// DIFFERENT seller's wallet, see the note at the bottom of this file.
// ─────────────────────────────────────────────────────────────────────────────

const hre = require("hardhat");

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const sellerAddress = signer.address;

  const tokenAddress       = process.env.CARBON_CREDIT_TOKEN_ADDRESS;
  const marketplaceAddress = process.env.MARKETPLACE_ADDRESS;

  if (!tokenAddress || !marketplaceAddress) {
    console.error('❌ Missing CARBON_CREDIT_TOKEN_ADDRESS or MARKETPLACE_ADDRESS in .env');
    process.exit(1);
  }

  console.log('🔍 Approving Marketplace to move tokens on behalf of:', sellerAddress);
  console.log('   Token contract:', tokenAddress);
  console.log('   Marketplace   :', marketplaceAddress);

  const token = await hre.ethers.getContractAt(
    ['function isApprovedForAll(address account, address operator) view returns (bool)',
     'function setApprovalForAll(address operator, bool approved) external'],
    tokenAddress,
    signer
  );

  const alreadyApproved = await token.isApprovedForAll(sellerAddress, marketplaceAddress);
  if (alreadyApproved) {
    console.log('✅ Already approved — nothing to do. Listing/delisting via the backend should work.');
    return;
  }

  console.log('⛓  Sending setApprovalForAll transaction...');
  const tx = await token.setApprovalForAll(marketplaceAddress, true);
  const receipt = await tx.wait();

  if (receipt.status !== 1) {
    console.error('❌ Transaction reverted:', tx.hash);
    process.exit(1);
  }

  console.log('✅ Approved! Block', receipt.blockNumber, '— TX:', tx.hash);
  console.log('   This wallet can now be listed/delisted for by the backend with zero further approval.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// ─────────────────────────────────────────────────────────────────────────────
// To approve a DIFFERENT seller wallet (not the one hardhat.config.js signs
// with by default), you have two options:
//   1. Temporarily set PRIVATE_KEY in .env to that seller's key, run this
//      script, then change it back — simplest for a one-off demo wallet.
//   2. Have that seller connect their own wallet (e.g. in a block explorer's
//      "Write Contract" tab on Etherscan, or a small page you build) and
//      call setApprovalForAll themselves — this is what real users would
//      do in production, since you won't have their private key.
// ─────────────────────────────────────────────────────────────────────────────