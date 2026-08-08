// scripts/initialize-marketplace-timelock.sepolia.ts
// Initialize Marketplace timelock reference after TimelockController deployment

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("🔧 Initializing Marketplace Timelock Reference\n");

  // Load timelock address
  const timelockAddressFile = path.join(__dirname, "../.timelock-address.sepolia");
  if (!fs.existsSync(timelockAddressFile)) {
    throw new Error("Timelock address not found. Run deploy-timelock.sepolia.ts first.");
  }
  const timelockAddress = fs.readFileSync(timelockAddressFile, "utf8").trim();

  // Marketplace address (Sepolia)
  const marketplaceAddress = "0x3cDE5d0e6A0B0955d5fb72e7E5Ba2e3070AEA19A";

  const [deployer] = await ethers.getSigners();
  console.log(`👤 Deployer: ${deployer.address}`);
  console.log(`🔗 Marketplace: ${marketplaceAddress}`);
  console.log(`🔗 Timelock: ${timelockAddress}\n`);

  // Connect to Marketplace
  const Marketplace = await ethers.getContractFactory("Marketplace");
  const marketplace = Marketplace.attach("0x3cDE5d0e6A0B0955d5fb72e7E5Ba2e3070AEA19A");

  // Check current timelock reference
  try {
    const currentTimelock = await marketplace.timelockController();
    console.log(`\nCurrent timelock reference: ${currentTimelock}`);
    if (currentTimelock.toLowerCase() === timelockAddress.toLowerCase()) {
      console.log("✅ Timelock already initialized");
      return;
    }
  } catch (e) {
    // Function might not exist or return error
    console.log("No timelock reference set yet");
  }

  // Initialize timelock reference
  console.log(`\n🔧 Initializing timelock reference...`);
  const tx = await marketplace.initializeTimelock(timelockAddress);
  console.log(`📤 Transaction sent: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`✅ Confirmed in block ${receipt.blockNumber}`);
  console.log(`   Gas used: ${receipt.gasUsed.toString()}`);

  // Verify
  const newTimelock = await ethers.getContractAt("Marketplace", "0x3cDE5d0e6A0B0955d5fb72e7E5Ba2e3070AEA19A");
  const newTimelockRef = await newTimelock.timelockController();
  console.log(`\n✅ Verified: ${newTimelockRef === timelockAddress ? "MATCH" : "MISMATCH"}`);
  console.log(`   Marketplace timelock: ${newTimelockRef}`);
  console.log(`   Expected: ${timelockAddress}`);

  console.log("\n✅ Marketplace timelock reference initialized!");
}

main().catch((error) => {
  console.error("\n❌ Error:", error);
  process.exitCode = 1;
});