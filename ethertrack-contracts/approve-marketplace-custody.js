// approve-marketplace-custody.js
// Approve Marketplace from the custody wallet
// Run: node approve-marketplace-custody.js

require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-contracts\\.env' });
const { ethers } = require('ethers');

async function main() {
  const RPC_URL = process.env.SEPOLIA_RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/VdL7KSs0Tx6bb1jjs_lU9";
  const CUSTODY_PRIVATE_KEY = "0x1c169dd1741342287c7256318318b10525f6b85bc5ef3b0adaabda9c93737e7a";
  
  const CARBON_CREDIT_TOKEN_ADDRESS = "0x0C72dcc5a88C66259DDB09B187F9A8392f6cf3C2";
  const MARKETPLACE_ADDRESS = "0x3cDE5d0e6A0B0955d5fb72e7E5Ba2e3070AEA19A";

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const custodyWallet = new ethers.Wallet(CUSTODY_PRIVATE_KEY, provider);

  console.log("🔐 Approving Marketplace from Custody Wallet");
  console.log("══════════════════════════════════════════════════════");
  console.log(`Custody Wallet: ${custodyWallet.address}`);
  console.log(`Token: ${CARBON_CREDIT_TOKEN_ADDRESS}`);
  console.log(`Marketplace: ${MARKETPLACE_ADDRESS}`);
  console.log("");

  const APPROVAL_ABI = [
    "function isApprovedForAll(address account, address operator) view returns (bool)",
    "function setApprovalForAll(address operator, bool approved) external"
  ];

  const token = new ethers.Contract(CARBON_CREDIT_TOKEN_ADDRESS, APPROVAL_ABI, custodyWallet);

  const isApproved = await token.isApprovedForAll(custodyWallet.address, MARKETPLACE_ADDRESS);
  console.log(`Currently approved: ${isApproved}`);

  if (!isApproved) {
    console.log("⛓  Sending setApprovalForAll transaction...");
    const tx = await token.setApprovalForAll(MARKETPLACE_ADDRESS, true);
    console.log(`TX sent: ${tx.hash}`);
    await tx.wait();
    console.log(`✅ Approved! TX: ${tx.hash}`);
  } else {
    console.log("✅ Already approved.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});