// scripts/configure-custody-wallet.js
// ─────────────────────────────────────────────────────────────────────────────
// Configures the dedicated EtherTrack custody wallet as:
//   - CarbonCreditToken operator (for mintCredit, retireCreditFor)
//   - Marketplace signerWallet (for listCreditFor, cancelListingFor, settleINRTrade)
//   - CreditLedger operator (for logOwnershipChange, logRetirement)
// 
// Run: npx hardhat run scripts/configure-custody-wallet.js --network sepolia
// ─────────────────────────────────────────────────────────────────────────────

const hre = require("hardhat");
const { ethers } = require("ethers");

async function main() {
  const [owner] = await hre.ethers.getSigners();
  const network = hre.network.name;

  // New custody wallet address
  const CUSTODY_WALLET_ADDRESS = "0xA3Cfbf47fb0a64c20119777d401100415c71498b";

  // Contract addresses from backend .env (current Sepolia deployment)
  const CARBON_CREDIT_TOKEN_ADDRESS = "0x0C72dcc5a88C66259DDB09B187F9A8392f6cf3C2";
  const MARKETPLACE_ADDRESS = "0x3cDE5d0e6A0B0955d5fb72e7E5Ba2e3070AEA19A";
  const CREDIT_LEDGER_ADDRESS = "0x2046625FC6181DeE411a35F160Cb00b9FEC9d830";

  console.log("🔧 Configuring EtherTrack Custody Wallet");
  console.log("══════════════════════════════════════════════════════");
  console.log(`Network: ${network}`);
  console.log(`Owner: ${owner.address}`);
  console.log(`Custody Wallet: ${CUSTODY_WALLET_ADDRESS}`);
  console.log("");

  // 1. CarbonCreditToken - setOperator
  console.log("1️⃣  Configuring CarbonCreditToken operator...");
  const token = await hre.ethers.getContractAt(
    ["function operator() view returns (address)", "function setOperator(address _operator) external"],
    CARBON_CREDIT_TOKEN_ADDRESS,
    owner
  );

  const currentTokenOperator = await token.operator();
  console.log(`   Current operator: ${currentTokenOperator}`);
  console.log(`   Target operator:  ${CUSTODY_WALLET_ADDRESS}`);

  if (currentTokenOperator.toLowerCase() !== CUSTODY_WALLET_ADDRESS.toLowerCase()) {
    console.log("   ⛓  Updating operator...");
    const tx = await token.setOperator(CUSTODY_WALLET_ADDRESS);
    await tx.wait();
    console.log(`   ✅ Operator updated. TX: ${tx.hash}`);
  } else {
    console.log("   ✅ Already configured.");
  }

  // 2. Marketplace - setSignerWallet
  console.log("\n2️⃣  Configuring Marketplace signerWallet...");
  const marketplace = await hre.ethers.getContractAt(
    ["function signerWallet() view returns (address)", "function setSignerWallet(address _signer) external"],
    MARKETPLACE_ADDRESS,
    owner
  );

  const currentSigner = await marketplace.signerWallet();
  console.log(`   Current signerWallet: ${currentSigner}`);
  console.log(`   Target signerWallet:  ${CUSTODY_WALLET_ADDRESS}`);

  if (currentSigner.toLowerCase() !== CUSTODY_WALLET_ADDRESS.toLowerCase()) {
    console.log("   ⛓  Updating signerWallet...");
    const tx = await marketplace.setSignerWallet(CUSTODY_WALLET_ADDRESS);
    await tx.wait();
    console.log(`   ✅ signerWallet updated. TX: ${tx.hash}`);
  } else {
    console.log("   ✅ Already configured.");
  }

  // 3. CreditLedger - setOperator
  console.log("\n3️⃣  Configuring CreditLedger operator...");
  const ledger = await hre.ethers.getContractAt(
    ["function operator() view returns (address)", "function setOperator(address _operator) external"],
    CREDIT_LEDGER_ADDRESS,
    owner
  );

  const currentLedgerOperator = await ledger.operator();
  console.log(`   Current operator: ${currentLedgerOperator}`);
  console.log(`   Target operator:  ${CUSTODY_WALLET_ADDRESS}`);

  if (currentLedgerOperator.toLowerCase() !== CUSTODY_WALLET_ADDRESS.toLowerCase()) {
    console.log("   ⛓  Updating operator...");
    const tx = await ledger.setOperator(CUSTODY_WALLET_ADDRESS);
    await tx.wait();
    console.log(`   ✅ Operator updated. TX: ${tx.hash}`);
  } else {
    console.log("   ✅ Already configured.");
  }

  // 4. Verify Marketplace approval for custody wallet
  console.log("\n4️⃣  Checking Marketplace approval for custody wallet...");
  const tokenForApproval = await hre.ethers.getContractAt(
    ["function isApprovedForAll(address account, address operator) view returns (bool)"],
    CARBON_CREDIT_TOKEN_ADDRESS,
    owner
  );

  const isApproved = await tokenForApproval.isApprovedForAll(CUSTODY_WALLET_ADDRESS, MARKETPLACE_ADDRESS);
  console.log(`   Custody wallet approved for Marketplace: ${isApproved}`);

  if (!isApproved) {
    console.log("   ⚠️  Custody wallet MUST approve Marketplace to enable operator-executed listings.");
    console.log("   Run the following transaction FROM the custody wallet:");
    console.log(`   token.setApprovalForAll(${MARKETPLACE_ADDRESS}, true)`);
    console.log("   (This requires the custody wallet's private key to sign)");
  }

  console.log("\n══════════════════════════════════════════════════════");
  console.log("✅ Contract configuration complete!");
  console.log("══════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});