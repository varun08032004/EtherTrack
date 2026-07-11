// scripts/fix-signer-mismatch.js
// ─────────────────────────────────────────────────────────────────────────────
// Fixes "Marketplace: not signer wallet" reverts by reading the backend's
// actual MINTER_PRIVATE_KEY address and updating Marketplace's signerWallet
// to match it — no redeploy needed, just one owner-only transaction.
//
// IMPORTANT: put MINTER_PRIVATE_KEY in THIS folder's .env too (temporarily,
// or permanently) so this script can read it — it normally only lives in
// ethertrack-backend/.env.
//
// Usage:
//   npx hardhat run scripts/fix-signer-mismatch.js --network sepolia
// ─────────────────────────────────────────────────────────────────────────────

const hre = require("hardhat");
const { ethers } = require("ethers");

async function main() {
  const minterKey = process.env.MINTER_PRIVATE_KEY;
  if (!minterKey) {
    console.error('❌ MINTER_PRIVATE_KEY not found in this folder\'s .env.');
    console.error('   Copy the exact same value from ethertrack-backend/.env into');
    console.error('   ethertrack-contracts/.env, then re-run this script.');
    process.exit(1);
  }

  const minterAddress = new ethers.Wallet(minterKey).address;
  const marketplaceAddress = process.env.MARKETPLACE_ADDRESS;

  if (!marketplaceAddress) {
    console.error('❌ MARKETPLACE_ADDRESS not found in .env');
    process.exit(1);
  }

  console.log('🔍 Backend MINTER_PRIVATE_KEY resolves to:', minterAddress);
  console.log('   Marketplace contract:', marketplaceAddress);

  const [owner] = await hre.ethers.getSigners();
  console.log('   Calling as owner:', owner.address);

  const marketplace = await hre.ethers.getContractAt(
    ['function signerWallet() view returns (address)',
     'function setSignerWallet(address _signer) external',
     'function owner() view returns (address)'],
    marketplaceAddress,
    owner
  );

  const currentSigner = await marketplace.signerWallet();
  const contractOwner = await marketplace.owner();

  console.log('   Current on-chain signerWallet:', currentSigner);
  console.log('   Contract owner:', contractOwner);

  if (currentSigner.toLowerCase() === minterAddress.toLowerCase()) {
    console.log('✅ Already matches — nothing to fix. The revert must be caused by something else.');
    return;
  }

  if (owner.address.toLowerCase() !== contractOwner.toLowerCase()) {
    console.error(`❌ The wallet running this script (${owner.address}) is not the contract owner (${contractOwner}).`);
    console.error('   Run this with the same private key that deployed the contract.');
    process.exit(1);
  }

  console.log('⛓  Updating signerWallet to match MINTER_PRIVATE_KEY...');
  const tx = await marketplace.setSignerWallet(minterAddress);
  const receipt = await tx.wait();

  if (receipt.status !== 1) {
    console.error('❌ Transaction reverted:', tx.hash);
    process.exit(1);
  }

  console.log('✅ Fixed! Block', receipt.blockNumber, '— TX:', tx.hash);
  console.log(`   signerWallet is now: ${minterAddress}`);
  console.log('   Operator-executed listing/delisting/settlement should work now.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});