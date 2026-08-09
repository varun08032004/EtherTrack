// scripts/execute-proposals.sepolia.ts
// Execute scheduled proposals on TimelockController after delay

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("▶️  Executing Scheduled Proposals on TimelockController\n");

  // Load timelock address
  const timelockAddressFile = path.join(__dirname, "../.timelock-address.sepolia");
  if (!fs.existsSync(timelockAddressFile)) {
    throw new Error("Timelock address not found. Run deploy-timelock.sepolia.ts first.");
  }
  const timelockAddr = fs.readFileSync(timelockAddressFile, "utf8").trim();

  // Load scheduled operations
  const deploymentsDir = path.join(__dirname, "../deployments");
  const scheduleFiles = fs.readdirSync(deploymentsDir)
    .filter(f => f.startsWith("sepolia_scheduled_") && f.endsWith(".json"))
    .sort()
    .reverse();
  
  if (scheduleFiles.length === 0) {
    throw new Error("No scheduled operations found. Run schedule-proposals.sepolia.ts first.");
  }
  
  const latestSchedule = JSON.parse(fs.readFileSync(path.join(deploymentsDir, scheduleFiles[0]), "utf8"));
  const operations = latestSchedule.operations;

  const [deployer] = await ethers.getSigners();
  console.log(`Executor: ${deployer.address}\n`);

  const timelock = await ethers.getContractAt("TimelockController", timelockAddr);
  const minDelay = Number(await timelock.getMinDelay());
  console.log(`⏱️  Min Delay: ${minDelay} seconds\n`);

  console.log("📋 Executing operations...\n");

  const executedOps = [];

  for (const op of operations) {
    console.log(`Executing: ${op.name}`);
    console.log(`   Target: ${op.target}`);
    console.log(`   Operation ID: ${op.operationId}`);

    try {
      // Check if ready
      const isReady = await timelock.isOperationReady(op.operationId);
      if (!isReady) {
        console.log(`   ⏳ Not ready yet - waiting for delay...`);
        const block = await ethers.provider.getBlock("latest");
        const currentTime = block.timestamp;
        const eta = op.eta || (currentTime + minDelay);
        const waitTime = eta - currentTime;
        if (waitTime > 0) {
          console.log(`   Need to wait ${waitTime} more seconds (${Math.ceil(waitTime / 60)} minutes)`);
          continue;
        }
      }

      const tx = await timelock.execute(
        op.target,
        0, // value
        op.data,
        ethers.ZeroHash, // predecessor
        ethers.ZeroHash  // salt
      );
      const receipt = await tx.wait();
      console.log(`   ✅ Executed! TX: ${receipt.hash}\n`);
      
      executedOps.push({
        name: op.name,
        target: op.target,
        operationId: op.operationId,
        txHash: receipt.hash,
        executedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      console.log(`   ❌ Failed: ${error.message}\n`);
    }
  }

  // Save execution results
  const executionInfo = {
    network: "sepolia",
    timelockAddress: timelockAddr,
    executor: deployer.address,
    operations: executedOps,
    executedAt: new Date().toISOString(),
  };

  const outputFile = path.join(deploymentsDir, `sepolia_executed_${Date.now()}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(executionInfo, null, 2));
  console.log(`📄 Execution results saved to: ${outputFile}`);

  if (executedOps.length === operations.length) {
    console.log("\n✅ All proposals executed successfully!");
  } else {
    console.log(`\n⏳ ${operations.length - executedOps.length} operations not ready yet.`);
    console.log("Run this script again after the timelock delay passes.");
  }
}

main().catch((error) => {
  console.error("\n❌ Error:", error);
  process.exitCode = 1;
});