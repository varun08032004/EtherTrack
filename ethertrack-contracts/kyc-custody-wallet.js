// kyc-custody-wallet.js
// Register custody wallet KYC on-chain
// Run: node kyc-custody-wallet.js

require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-contracts\\.env' });
const { ethers } = require('ethers');

async function main() {
  const RPC_URL = process.env.SEPOLIA_RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/VdL7KSs0Tx6bb1jjs_lU9";
  
  const KYC_REGISTRY_ADDRESS = "0x443e068FE6F2F7B57C71A3Bc5492aA98b5069597";
  const MINTER_PRIVATE_KEY = process.env.PRIVATE_KEY; // Has KYC operator role
  const CUSTODY_WALLET = "0xA3Cfbf47fb0a64c20119777d401100415c71498b";

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const minterWallet = new ethers.Wallet(MINTER_PRIVATE_KEY, provider);

  const KYC_ABI = [
    "function isKYCVerified(address wallet) view returns (bool)",
    "function kycOperators(address) view returns (bool)",
    "function verifyKYC(bytes32 userIdHash, bytes32 kycDataHash) external",
    "function linkWallet(bytes32 userIdHash, address wallet) external",
    "function addKYCOperator(address operator) external"
  ];

  const kyc = new ethers.Contract(KYC_REGISTRY_ADDRESS, KYC_ABI, minterWallet);

  console.log("🔐 Registering Custody Wallet KYC");
  console.log("══════════════════════════════════════════════════════");
  console.log(`KYC Registry: ${KYC_REGISTRY_ADDRESS}`);
  console.log(`Minter (Operator): ${minterWallet.address}`);
  console.log(`Custody Wallet: ${CUSTODY_WALLET}`);
  console.log("");

  // Check if minter is KYC operator
  const isOperator = await kyc.kycOperators(minterWallet.address);
  console.log(`Minter is KYC Operator: ${isOperator}`);

  if (!isOperator) {
    console.log("Adding minter as KYC operator...");
    const tx = await kyc.addKYCOperator(minterWallet.address);
    await tx.wait();
    console.log("✅ Minter added as KYC operator");
  }

  // Check if custody wallet already KYC verified
  const alreadyVerified = await kyc.isKYCVerified(CUSTODY_WALLET);
  console.log(`Custody wallet KYC verified: ${alreadyVerified}`);

  if (!alreadyVerified) {
    console.log("\n⛓  Verifying KYC for custody wallet...");
    const userIdHash = ethers.keccak256(ethers.toUtf8Bytes("ethertrack-custody-wallet"));
    const kycDataHash = ethers.keccak256(ethers.toUtf8Bytes("custody-wallet-kyc"));
    
    const tx = await kyc.verifyKYC(userIdHash, kycDataHash);
    console.log(`TX sent: ${tx.hash}`);
    await tx.wait();
    console.log("✅ KYC verified for custody wallet");

    // Link wallet to the identity
    console.log("\n⛓  Linking custody wallet to KYC identity...");
    const tx2 = await kyc.linkWallet(userIdHash, CUSTODY_WALLET);
    console.log(`TX sent: ${tx2.hash}`);
    await tx2.wait();
    console.log("✅ Wallet linked to KYC identity");
  }

  // Final verification
  const finalCheck = await kyc.isKYCVerified(CUSTODY_WALLET);
  console.log(`\n✅ Final KYC status for custody wallet: ${finalCheck}`);
}

main().catch((err) => {
  console.error("❌ Failed:", err);
  process.exit(1);
});