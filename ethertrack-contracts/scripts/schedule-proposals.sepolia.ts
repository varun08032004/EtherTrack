// scripts/schedule-proposals.sepolia.ts
// Schedule all operator transfer proposals on TimelockController

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("📅 Scheduling Operator Transfer Proposals on TimelockController\n");

  // Load timelock address
  const timelockAddressFile = path.join(__dirname, "../.timelock-address.sepolia");
  if (!fs.existsSync(timelockAddressFile)) {
    throw new Error("Timelock address not found. Run deploy-timelock.sepolia.ts first.");
  }
  const timelockAddr = fs.readFileSync(timelockAddressFile, "utf8").trim();

  // Contract addresses (Sepolia)
  const CONTRACTS = {
    carbonCreditToken: "0x0C72dcc5a88C66259DDB09B187F9A8392f6cf3C2",
    marketplace: "0x3cDE5d0e6A0B0955d5fb72e7E5Ba2e3070AEA19A",
    creditLedger: "0x2046625FC6181DeE411a35F160Cb00b9FEC9d830",
    kycRegistry: "0x443e068FE6F2F7B57C71A3Bc5492aA98b5069597",
    treasury: "0x2504e917A78C8094Aee0cba8e076fc3891b95265",
    auditTrail: "0x98D9f9555bd2049Fb52DCe040C1B895CB55BcE81",
  };

  const [deployer] = await ethers.getSigners();
  console.log(`Proposer: ${deployer.address}\n`);

  const timelock = await ethers.getContractAt("TimelockController", timelockAddr);
  const minDelay = Number(await timelock.getMinDelay());
  console.log(`⏱️  Min Delay: ${minDelay} seconds (${minDelay / 3600} hours)\n`);

  // Get current signer wallet from marketplace
  const marketplace = await ethers.getContractAt("Marketplace", CONTRACTS.marketplace);
  const currentSigner = await marketplace.signerWallet();

  // Operations to schedule
  const operations = [
    {
      name: "CarbonCreditToken.setOperator(timelock)",
      target: CONTRACTS.carbonCreditToken,
      data: ethers.AbiCoder.defaultAbiCoder().encode(["address"], [timelockAddr]),
    },
    {
      name: "Marketplace.setSignerWalletViaTimelock(currentSigner)",
      target: CONTRACTS.marketplace,
      data: ethers.AbiCoder.defaultAbiCoder().encode(["address"], [currentSigner]),
    },
    {
      name: "CreditLedger.setOperator(timelock)",
      target: CONTRACTS.creditLedger,
      data: ethers.AbiCoder.defaultAbiCoder().encode(["address"], [timelockAddr]),
    },
    {
      name: "KYCRegistry.transferOwnership(timelock)",
      target: CONTRACTS.kycRegistry,
      data: ethers.AbiCoder.defaultAbiCoder().encode(["address"], [timelockAddr]),
    },
    {
      name: "Treasury.transferOwnership(timelock)",
      target: CONTRACTS.treasury,
      data: ethers.AbiCoder.defaultAbiCoder().encode(["address"], [timelockAddr]),
    },
    {
      name: "AuditTrail.transferOwnership(timelock)",
      target: CONTRACTS.auditTrail,
      data: ethers.AbiCoder.defaultAbiCoder().encode(["address"], [timelockAddr]),
    },
  ];

  console.log("📋 Scheduling operations...\n");

  const scheduledOps = [];

  for (const op of operations) {
    console.log(`Scheduling: ${op.name}`);
    console.log(`   Target: ${op.target}`);
    console.log(`   Data: ${op.data}`);

    try {
      const tx = await timelock.schedule(
        op.target,
        0, // value
        op.data,
        ethers.ZeroHash, // predecessor
        ethers.ZeroHash, // salt
        minDelay
      );
      const receipt = await tx.wait();
      
      // Find the CallScheduled event to get operation ID
      const event = receipt.logs.find((log: any) => {
        try {
          const parsed = timelock.interface.parseLog(log);
          return parsed?.name === "CallScheduled";
        } catch { return false; }
      });
      
      const opId = event ? timelock.interface.parseLog(event).args.id : "unknown";
      console.log(`   ✅ Scheduled! Operation ID: ${opId}`);
      console.log(`   TX: ${receipt.hash}\n`);
      
      scheduledOps.push({
        name: op.name,
        target: op.target,
        data: op.data,
        operationId: opId,
        txHash: receipt.hash,
        eta: Math.floor(Date.now() / 1000) + Number(minDelay),
      });
    } catch (error: any) {
      console.log(`   ❌ Failed: ${error.message}\n`);
    }
  }

  // Save scheduled operations
  const scheduleInfo = {
    network: "sepolia",
    timelockAddress: timelockAddr,
    minDelay,
    proposer: deployer.address,
    operations: scheduledOps,
    scheduledAt: new Date().toISOString(),
  };

  const outputFile = path.join(__dirname, "../deployments", `sepolia_scheduled_${Date.now()}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(scheduleInfo, null, 2));
  console.log(`📄 Scheduled operations saved to: ${outputFile}`);

  console.log("\n⏳ NEXT STEPS:");
  console.log(`1. Wait for timelock delay (${minDelay / 3600} hour)`);
  console.log("2. Run: npx hardhat run scripts/execute-proposals.sepolia.ts --network sepolia");
}

main().catch((error) => {
  console.error("\n❌ Error:", error);
  process.exitCode = 1;
});