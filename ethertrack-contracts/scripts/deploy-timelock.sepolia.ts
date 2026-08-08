// scripts/deploy-timelock.sepolia.ts
// Deploy TimelockController on Sepolia and configure for SEC-002

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("🔒 Deploying TimelockController on Sepolia...\n");

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await deployer.provider.getBalance(deployer.address))} ETH\n`);

  // Configuration
  const MIN_DELAY = 3600; // 1 hour for testnet (48 hours = 172800 for mainnet)
  const PROPOSERS = []; // Will be set after Gnosis Safe deployment
  const EXECUTORS = []; // Will be set after contract addresses known

  // For initial deployment, use deployer as proposer/admin
  // Will be updated after Gnosis Safe creation
  const PROPOSERS_INITIAL = [deployer.address];
  const EXECUTORS_INITIAL = []; // Empty = anyone can execute after delay (will restrict later)

  // Deploy TimelockController
  console.log("📦 Deploying TimelockController...");
  const TimelockController = await ethers.getContractFactory("TimelockController");
  
  // Use deployer as initial admin, will transfer to Gnosis Safe later
  const timelock = await TimelockController.deploy(
    3600, // 1 hour for testnet (48h = 172800 for mainnet)
    [deployer.address], // initial proposers
    [], // executors - empty means anyone can execute after delay
    deployer.address // admin
  );

  await timelock.waitForDeployment();
  const timelockAddress = await timelock.getAddress();
  
  console.log(`✅ TimelockController deployed to: ${timelockAddress}`);
  console.log(`   Min Delay: ${(await timelock.getMinDelay())} seconds`);
  console.log(`   Admin: ${await timelock.admin()}`);
  console.log(`   Proposers: ${(await timelock.getRoleMembers(await timelock.PROPOSER_ROLE())).join(", ")}`);

  // Verify contract deployment
  const code = await ethers.provider.getCode(timelockAddress);
  if (code === "0x") {
    throw new Error("Contract deployment failed - no code at address");
  }

  // Save deployment info
  const deploymentInfo = {
    network: "sepolia",
    chainId: 11155111,
    timelockAddress: timelockAddress,
    deployer: deployer.address,
    minDelay: 3600,
    proposers: [deployer.address],
    executors: [],
    admin: deployer.address,
    deployedAt: new Date().toISOString(),
    blockNumber: (await ethers.provider.getBlockNumber()).toString(),
  };

  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const timestamp = Date.now();
  const deploymentFile = path.join(deploymentsDir, `sepolia_timelock_${timestamp}.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n📄 Deployment info saved to: ${deploymentFile}`);

  // Save timelock address for later scripts
  const timelockAddressFile = path.join(__dirname, "../.timelock-address.sepolia");
  fs.writeFileSync(timelockAddressFile, timelockAddress);
  console.log(`📄 Timelock address saved to: ${timelockAddressFile}`);

  // Verify timelock roles
  console.log("\n🔍 Verifying Timelock Roles:");
  const proposerRole = await timelock.PROPOSER_ROLE();
  const executorRole = await timelock.EXECUTOR_ROLE();
  const adminRole = await timelock.ADMIN_ROLE();
  
  console.log(`   PROPOSER_ROLE: ${proposerRole}`);
  console.log(`   EXECUTOR_ROLE: ${executorRole}`);
  console.log(`   ADMIN_ROLE: ${adminRole}`);
  
  const proposerMembers = await timelock.getRoleMembers(proposerRole);
  console.log(`   Proposers: ${proposerMembers.join(", ")}`);
  
  const adminMembers = await timelock.getRoleMembers(adminRole);
  console.log(`   Admins: ${adminMembers.join(", ")}`);

  console.log("\n✅ TimelockController deployed successfully!");
  console.log("\n📋 NEXT STEPS:");
  console.log("1. Deploy Gnosis Safe (3/4 multisig) on Sepolia");
  console.log("2. Grant PROPOSER_ROLE to Gnosis Safe address");
  console.log("3. Add contract addresses as EXECUTORS");
  console.log("4. Transfer operator roles to Timelock via proposals");
}

main().catch((error) => {
  console.error("\n❌ Deployment failed:", error);
  process.exitCode = 1;
});