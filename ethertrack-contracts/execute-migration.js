// execute-migration.js
// Execute both token migrations to custody wallet
// Run: node execute-migration.js

require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-contracts\\.env' });
const { ethers } = require('ethers');

async function main() {
  const RPC_URL = process.env.SEPOLIA_RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/VdL7KSs0Tx6bb1jjs_lU9";
  
  const CARBON_CREDIT_TOKEN_ADDRESS = "0x0C72dcc5a88C66259DDB09B187F9A8392f6cf3C2";
  const CUSTODY_WALLET = "0xA3Cfbf47fb0a64c20119777d401100415c71498b";

  // Private keys provided by user
  const WALLET_1_PK = "0xb1afcfbb79c268247ac0a13559e4f6e51e1f75b823e17ac57d3dc637e2f80660"; // Token #1 holder
  const WALLET_2_PK = "0xe19f997ef66bd45e5d603d53fb2a0bbc74593e42e719c7a968be007fd10b151b"; // Token #2 holder (also minter)

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  const TOKEN_ABI = [
    "function balanceOf(address account, uint256 id) view returns (uint256)",
    "function totalSupply(uint256 id) view returns (uint256)",
    "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data) external",
    "function creditMetadata(uint256 id) view returns (string projectName, string location, uint8 standard, string projectType, string developer, uint256 vintageYear, uint256 expiryDate, string serialNumber, string metadataURI, bool active, address registeredBy, uint256 registeredAt)"
  ];

  const token = new ethers.Contract(CARBON_CREDIT_TOKEN_ADDRESS, TOKEN_ABI, provider);

  console.log("🚀 Executing Token Migrations to Custody Wallet");
  console.log("══════════════════════════════════════════════════════");
  console.log(`Custody Wallet: ${CUSTODY_WALLET}`);
  console.log(`Token Contract: ${CARBON_CREDIT_TOKEN_ADDRESS}`);
  console.log("");

  // Verify pre-state
  console.log("📊 Pre-Migration State:");
  for (const tokenId of [1, 2]) {
    const metadata = await token.creditMetadata(tokenId);
    const totalSupply = await token.totalSupply(tokenId);
    console.log(`  Token #${tokenId} (${metadata[0]}): Total=${totalSupply}`);
  }
  console.log("");

  // Migration 1: Token #1 from wallet 1
  console.log("1️⃣  Migrating Token #1 (VD Wind Plant)...");
  const wallet1 = new ethers.Wallet(WALLET_1_PK, provider);
  console.log(`   From: ${wallet1.address}`);
  console.log(`   To:   ${CUSTODY_WALLET}`);
  console.log(`   Amount: 3000`);

  const balance1Before = await token.balanceOf(wallet1.address, 1);
  console.log(`   Pre-transfer balance: ${balance1Before}`);

  const tokenWithWallet1 = token.connect(wallet1);
  const tx1 = await tokenWithWallet1.safeTransferFrom(
    wallet1.address,
    CUSTODY_WALLET,
    1,
    3000,
    "0x"
  );
  console.log(`   TX sent: ${tx1.hash}`);
  const receipt1 = await tx1.wait();
  console.log(`   ✅ Confirmed in block ${receipt1.blockNumber}`);

  const balance1After = await token.balanceOf(wallet1.address, 1);
  const custodyBalance1 = await token.balanceOf(CUSTODY_WALLET, 1);
  console.log(`   Post-transfer - Wallet 1: ${balance1After}, Custody: ${custodyBalance1}`);
  console.log("");

  // Migration 2: Token #2 from wallet 2
  console.log("2️⃣  Migrating Token #2 (Deshmukh Solar)...");
  const wallet2 = new ethers.Wallet(WALLET_2_PK, provider);
  console.log(`   From: ${wallet2.address}`);
  console.log(`   To:   ${CUSTODY_WALLET}`);
  console.log(`   Amount: 3000`);

  const balance2Before = await token.balanceOf(wallet2.address, 2);
  console.log(`   Pre-transfer balance: ${balance2Before}`);

  const tokenWithWallet2 = token.connect(wallet2);
  const tx2 = await tokenWithWallet2.safeTransferFrom(
    wallet2.address,
    CUSTODY_WALLET,
    2,
    3000,
    "0x"
  );
  console.log(`   TX sent: ${tx2.hash}`);
  const receipt2 = await tx2.wait();
  console.log(`   ✅ Confirmed in block ${receipt2.blockNumber}`);

  const balance2After = await token.balanceOf(wallet2.address, 2);
  const custodyBalance2 = await token.balanceOf(CUSTODY_WALLET, 2);
  console.log(`   Post-transfer - Wallet 2: ${balance2After}, Custody: ${custodyBalance2}`);
  console.log("");

  // Verify final state
  console.log("📊 Post-Migration Verification:");
  for (const tokenId of [1, 2]) {
    const metadata = await token.creditMetadata(tokenId);
    const totalSupply = await token.totalSupply(tokenId);
    const custodyBal = await token.balanceOf(CUSTODY_WALLET, tokenId);
    console.log(`  Token #${tokenId} (${metadata[0]}): Total=${totalSupply}, Custody=${custodyBal}`);
  }
  console.log("");
  console.log("══════════════════════════════════════════════════════");
  console.log("✅ BOTH MIGRATIONS COMPLETE!");
  console.log("══════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});