// configure-contracts.js
// Standalone script to configure custody wallet on contracts
// Run: node configure-contracts.js

require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-contracts\\.env' });
const { ethers } = require('ethers');

async function main() {
  // Configuration
  const RPC_URL = process.env.SEPOLIA_RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/VdL7KSs0Tx6bb1jjs_lU9";
  const OWNER_PRIVATE_KEY = process.env.PRIVATE_KEY; // Deployer/owner key
  const CUSTODY_WALLET_ADDRESS = "0xA3Cfbf47fb0a64c20119777d401100415c71498b";

  // Contract addresses (from backend .env)
  const CARBON_CREDIT_TOKEN_ADDRESS = "0x0C72dcc5a88C66259DDB09B187F9A8392f6cf3C2";
  const MARKETPLACE_ADDRESS = "0x3cDE5d0e6A0B0955d5fb72e7E5Ba2e3070AEA19A";
  const CREDIT_LEDGER_ADDRESS = "0x2046625FC6181DeE411a35F160Cb00b9FEC9d830";

  if (!OWNER_PRIVATE_KEY) {
    console.error("❌ PRIVATE_KEY not found in ethertrack-contracts/.env");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const owner = new ethers.Wallet(OWNER_PRIVATE_KEY, provider);

  console.log("🔧 Configuring EtherTrack Custody Wallet");
  console.log("══════════════════════════════════════════════════════");
  console.log(`Network: Sepolia`);
  console.log(`Owner: ${owner.address}`);
  console.log(`Custody Wallet: ${CUSTODY_WALLET_ADDRESS}`);
  console.log("");

  // ABI for operator/signer functions
  const OPERATOR_ABI = [
    "function operator() view returns (address)",
    "function setOperator(address _operator) external"
  ];
  const SIGNER_ABI = [
    "function signerWallet() view returns (address)",
    "function setSignerWallet(address _signer) external"
  ];
  const APPROVAL_ABI = [
    "function isApprovedForAll(address account, address operator) view returns (bool)",
    "function setApprovalForAll(address operator, bool approved) external"
  ];

  // 1. CarbonCreditToken - setOperator
  console.log("1️⃣  Configuring CarbonCreditToken operator...");
  const token = new ethers.Contract(CARBON_CREDIT_TOKEN_ADDRESS, OPERATOR_ABI, owner);

  try {
    const currentTokenOperator = await token.operator();
    console.log(`   Current operator: ${currentTokenOperator}`);
    console.log(`   Target operator:  ${CUSTODY_WALLET_ADDRESS}`);

    if (currentTokenOperator.toLowerCase() !== CUSTODY_WALLET_ADDRESS.toLowerCase()) {
      console.log("   ⛓  Updating operator...");
      const tx = await token.setOperator(CUSTODY_WALLET_ADDRESS);
      console.log(`   TX sent: ${tx.hash}`);
      await tx.wait();
      console.log(`   ✅ Operator updated. TX: ${tx.hash}`);
    } else {
      console.log("   ✅ Already configured.");
    }
  } catch (e) {
    console.error(`   ❌ Error: ${e.message}`);
  }

  // 2. Marketplace - setSignerWallet
  console.log("\n2️⃣  Configuring Marketplace signerWallet...");
  const marketplace = new ethers.Contract(MARKETPLACE_ADDRESS, SIGNER_ABI, owner);

  try {
    const currentSigner = await marketplace.signerWallet();
    console.log(`   Current signerWallet: ${currentSigner}`);
    console.log(`   Target signerWallet:  ${CUSTODY_WALLET_ADDRESS}`);

    if (currentSigner.toLowerCase() !== CUSTODY_WALLET_ADDRESS.toLowerCase()) {
      console.log("   ⛓  Updating signerWallet...");
      const tx = await marketplace.setSignerWallet(CUSTODY_WALLET_ADDRESS);
      console.log(`   TX sent: ${tx.hash}`);
      await tx.wait();
      console.log(`   ✅ signerWallet updated. TX: ${tx.hash}`);
    } else {
      console.log("   ✅ Already configured.");
    }
  } catch (e) {
    console.error(`   ❌ Error: ${e.message}`);
  }

  // 3. CreditLedger - setOperator
  console.log("\n3️⃣  Configuring CreditLedger operator...");
  const ledger = new ethers.Contract(CREDIT_LEDGER_ADDRESS, OPERATOR_ABI, owner);

  try {
    const currentLedgerOperator = await ledger.operator();
    console.log(`   Current operator: ${currentLedgerOperator}`);
    console.log(`   Target operator:  ${CUSTODY_WALLET_ADDRESS}`);

    if (currentLedgerOperator.toLowerCase() !== CUSTODY_WALLET_ADDRESS.toLowerCase()) {
      console.log("   ⛓  Updating operator...");
      const tx = await ledger.setOperator(CUSTODY_WALLET_ADDRESS);
      console.log(`   TX sent: ${tx.hash}`);
      await tx.wait();
      console.log(`   ✅ Operator updated. TX: ${tx.hash}`);
    } else {
      console.log("   ✅ Already configured.");
    }
  } catch (e) {
    console.error(`   ❌ Error: ${e.message}`);
  }

  // 4. Verify Marketplace approval for custody wallet
  console.log("\n4️⃣  Checking Marketplace approval for custody wallet...");
  const tokenForApproval = new ethers.Contract(CARBON_CREDIT_TOKEN_ADDRESS, APPROVAL_ABI, owner);

  try {
    const isApproved = await tokenForApproval.isApprovedForAll(CUSTODY_WALLET_ADDRESS, MARKETPLACE_ADDRESS);
    console.log(`   Custody wallet approved for Marketplace: ${isApproved}`);

    if (!isApproved) {
      console.log("   ⚠️  Custody wallet MUST approve Marketplace to enable operator-executed listings.");
      console.log("   This requires the custody wallet's private key to sign:");
      console.log(`   token.setApprovalForAll(${MARKETPLACE_ADDRESS}, true)`);
    }
  } catch (e) {
    console.error(`   ❌ Error checking approval: ${e.message}`);
  }

  console.log("\n══════════════════════════════════════════════════════");
  console.log("✅ Contract configuration complete!");
  console.log("══════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});