// scripts/configure-timelock.sepolia.ts
// Configure TimelockController after Gnosis Safe deployment

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("⚙️  Configuring TimelockController on Sepolia...\n");

  // Load timelock address
  const timelockAddressFile = path.join(__dirname, "../.timelock-address.sepolia");
  if (!fs.existsSync(timelockAddressFile)) {
    throw new Error("Timelock address not found. Run deploy-timelock.sepolia.ts first.");
  }
  const timelockAddress = fs.readFileSync(timelockAddressFile, "utf8").trim();
  
  // Get Gnosis Safe address from user input or env
  const safeAddress = process.env.GNOSIS_SAFE_ADDRESS;
  if (!safeAddress) {
    throw new Error("Set GNOSIS_SAFE_ADDRESS environment variable");
  }

  // Contract addresses (from Sepolia deployment)
  const CONTRACTS = {
    carbonCreditToken: "0x0C72dcc5a88C66259DDB09B187F9A8392f6cf3C2",
    marketplace: "0x3cDE5d0e6A0B0955d5fb72e7E5Ba2e3070AEA19A",
    creditLedger: "0x2046625FC6181DeE411a35F160Cb00b9FEC9d830",
    kycRegistry: "0x443e068FE6F2F7B57C71A3Bc5492aA98b5069597",
    treasury: "0x2504e917A78C8094Aee0cba8e076fc3891b95265",
    auditTrail: "0x98D9f9555bd2049Fb52DCe040C1B895CB55BcE81",
  };

  const [deployer] = await ethers.getSigners();
  console.log(`Configuring with deployer: ${deployer.address}\n`);

  // Connect to TimelockController
  const TimelockController = await ethers.getContractFactory("TimelockController");
  const timelock = TimelockController.attach(timelockAddress);

  console.log(`🔗 TimelockController: ${timelockAddress}`);
  console.log(`🔐 Gnosis Safe (Proposer): ${safeAddress}\n`);

  // 1. Grant PROPOSER_ROLE to Gnosis Safe
  console.log("\n1️⃣ Granting PROPOSER_ROLE to Gnosis Safe...");
  const proposerRole = await timelock.PROPOSER_ROLE();
  const hasProposerRole = await timelock.hasRole(proposerRole, safeAddress);
  
  if (!hasProposerRole) {
    const tx = await timelock.grantRole(proposerRole, safeAddress);
    await tx.wait();
    console.log(`   ✅ PROPOSER_ROLE granted to ${safeAddress}`);
  } else {
    console.log(`   ℹ️  PROPOSER_ROLE already granted`);
  }

  // 2. Grant EXECUTOR_ROLE to all contract addresses
  console.log("\n2️⃣ Granting EXECUTOR_ROLE to contracts...");
  const executorRole = await timelock.EXECUTOR_ROLE();
  
  for (const [name, address] of Object.entries(CONTRACTS)) {
    const hasRole = await timelock.hasRole(executorRole, address);
    if (!hasRole) {
      const tx = await timelock.grantRole(executorRole, address);
      await tx.wait();
      console.log(`   ✅ EXECUTOR_ROLE granted to ${name} (${address})`);
    } else {
      console.log(`   ℹ️  EXECUTOR_ROLE already granted to ${name}`);
    }
  }

  // 3. Verify roles
  console.log("\n3️⃣ Verifying roles...");
  const proposerRoleHash = await timelock.PROPOSER_ROLE();
  const executorRoleHash = await timelock.EXECUTOR_ROLE();
  
  console.log(`\nProposers: ${(await timelock.getRoleMembers(proposerRoleHash)).join(", ")}`);
  console.log(`Executors: ${(await timelock.getRoleMembers(executorRoleHash)).join(", ")}`);

  // 4. Save configuration
  const config = {
    network: "sepolia",
    chainId: 11155111,
    timelockAddress,
    gnosisSafe: safeAddress,
    minDelay: 3600, // 1 hour for testnet
    contracts: CONTRACTS,
    configuredAt: new Date().toISOString(),
    blockNumber: (await ethers.provider.getBlockNumber()).toString(),
  };

  const configFile = path.join(__dirname, "../deployments", `sepolia_timelock_config_${Date.now()}.json`);
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  console.log(`\n📄 Configuration saved to: ${configFile}`);

  console.log("\n✅ Timelock configured successfully!");
  console.log("\n📋 NEXT STEPS:");
  console.log("1. Transfer operator roles to Timelock via proposals");
  console.log("2. Run: npx hardhat run scripts/transfer-operator-roles.sepolia.ts --network sepolia");
}

main().catch((error) => {
  console.error("\n❌ Configuration failed:", error);
  process.exitCode = 1;
});