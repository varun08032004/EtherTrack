// scripts/transfer-operator-roles.sepolia.ts
// Transfer operator roles to TimelockController via proposals

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("🔄 Transferring Operator Roles to TimelockController\n");

  // Load timelock address
  const timelockAddressFile = path.join(__dirname, "../.timelock-address.sepolia");
  if (!fs.existsSync(timelockAddressFile)) {
    throw new Error("Timelock address not found. Run deploy-timelock.sepolia.ts first.");
  }
  const timelockAddress = fs.readFileSync(timelockAddressFile, "utf8").trim();

  // Contract addresses (Sepolia)
  const CONTRACTS = {
    carbonCreditToken: "0x0C72dcc5a88C66259DDB09B187F9A8392f6cf3C2",
    marketplace: "0x3cDE5d0e6A0B0955d5fb72e7E5Ba2e3070AEA19A",
    creditLedger: "0x2046625FC6181DeE411a35F160Cb00b9FEC9d830",
    kycRegistry: "0x443e068FE6F2F7B57C71A3Bc5492aA98b5069597",
    treasury: "0x2504e917A78C8094Aee0cba8e076fc3891b95265",
    auditTrail: "0x98D9f9555bd2049Fb52DCe040C1B895CB55BcE81",
  };

  // Timelock address
  const timelockAddress = "0x..."; // Will be loaded from file

  const [deployer] = await ethers.getSigners();
  console.log(`Using deployer: ${deployer.address}\n`);

  // Connect to contracts
  const CarbonCreditToken = await ethers.getContractFactory("CarbonCreditToken");
  const Marketplace = await ethers.getContractFactory("Marketplace");
  const CreditLedger = await ethers.getContractFactory("CreditLedger");
  const KYCRegistry = await ethers.getContractFactory("KYCRegistry");
  const Treasury = await ethers.getContractFactory("Treasury");
  const AuditTrail = await ethers.getContractFactory("AuditTrail");
  const TimelockController = await ethers.getContractFactory("TimelockController");

  const contracts = {
    carbonCreditToken: CarbonCreditToken.attach(CONTRACTS.carbonCreditToken),
    marketplace: Marketplace.attach(CONTRACTS.marketplace),
    creditLedger: CreditLedger.attach(CONTRACTS.creditLedger),
    kycRegistry: KYCRegistry.attach(CONTRACTS.kycRegistry),
    treasury: Treasury.attach(CONTRACTS.treasury),
    auditTrail: AuditTrail.attach(CONTRACTS.auditTrail),
    timelock: (await ethers.getContractFactory("TimelockController")).attach("TIMELOCK_ADDRESS_PLACEHOLDER"),
  };

  // Load actual timelock address
  const timelockAddressFile = path.join(__dirname, "../.timelock-address.sepolia");
  const timelockAddr = fs.existsSync(timelockAddressFile) 
    ? fs.readFileSync(timelockAddressFile, "utf8").trim() 
    : "0x0000000000000000000000000000000000000000";

  if (timelockAddr === "0x0000000000000000000000000000000000000000") {
    throw new Error("Timelock address not found. Run deploy-timelock.sepolia.ts first.");
  }

  const timelock = await ethers.getContractAt("TimelockController", timelockAddr);

  console.log(`🔗 Timelock: ${timelockAddr}`);
  console.log(`👤 Deployer: ${deployer.address}\n`);

  // Define the operations to propose
  const operations = [
    {
      name: "CarbonCreditToken.setOperator(timelock)",
      target: "0x0C72dcc5a88C66259DDB09B187F9A8392f6cf3C2",
      data: ethers.AbiCoder.defaultAbiCoder().encode(
        ["address"], 
        ["0x" + "TIMELOCK_ADDRESS_PLACEHOLDER".replace("TIMELOCK_ADDRESS_PLACEHOLDER", timelockAddr.slice(2))]
      ),
      // Will be encoded properly below
    },
    {
      name: "Marketplace.setSignerWalletViaTimelock(timelockSigner)",
      target: "0x3cDE5d0e6A0B0955d5fb72e7E5Ba2e3070AEA19A",
    },
    {
      name: "CreditLedger.setOperator(timelock)",
      target: "0x2046625FC6181DeE411a35F160Cb00b9FEC9d830",
    },
    {
      name: "KYCRegistry.transferOwnership(timelock)",
      target: "0x443e068FE6F2F7B57C71A3Bc5492aA98b5069597",
    },
  ];

  console.log("\n📋 Proposed Operations:");
  operations.forEach((op, i) => {
    console.log(`${i + 1}. ${op.name}`);
  });

  console.log("\n⚠️  This script prepares the calldata for proposals.");
  console.log("Actual proposals must be submitted via Gnosis Safe UI or script.");
  console.log("\n📋 PROPOSAL PREPARATION:");
  console.log("1. Open Gnosis Safe UI");
  console.log("2. Create new proposal for each operation above");
  console.log("3. Set Timelock as target contract");
  console.log("4. Submit proposal → Wait for delay → Execute");

  // Generate calldata for each operation
  console.log("\n📋 CALldata for each proposal:\n");

  // 1. CarbonCreditToken.setOperator(timelock)
  const carbonCreditToken = await ethers.getContractAt("CarbonCreditToken", "0x0C72dcc5a88C66259DDB09B187F9A8392f6cf3C2");
  const setOperatorCalldata = carbonCreditToken.interface.encodeFunctionData("setOperator", [timelockAddr]);
  console.log("1. CarbonCreditToken.setOperator(timelock):");
  console.log(`   Target: 0x0C72dcc5a88C66259DDB09B187F9A8392f6cf3C2`);
  console.log(`   Data: ${setOperatorCalldata}\n`);

  // 2. Marketplace.setSignerWalletViaTimelock(timelockSigner)
  // Need a new signer wallet address - for now use placeholder
  const newSignerWallet = "0x0000000000000000000000000000000000000000"; // REPLACE WITH ACTUAL
  const marketplace = await ethers.getContractAt("Marketplace", "0x3cDE5d0e6A0B0955d5fb72e7E5Ba2e3070AEA19A");
  const setSignerCalldata = marketplace.interface.encodeFunctionData("setSignerWalletViaTimelock", [newSignerWallet]);
  console.log("2. Marketplace.setSignerWalletViaTimelock(newSigner):");
  console.log(`   Target: 0x3cDE5d0e6A0B0955d5fb72e7E5Ba2e3070AEA19A`);
  console.log(`   Data: ${setSignerCalldata}\n`);

  // 3. CreditLedger.setOperator(timelock)
  const creditLedger = await ethers.getContractAt("CreditLedger", "0x2046625FC6181DeE411a35F160Cb00b9FEC9d830");
  const setOperatorLedgerCalldata = creditLedger.interface.encodeFunctionData("setOperator", [timelockAddr]);
  console.log("3. CreditLedger.setOperator(timelock):");
  console.log(`   Target: 0x2046625FC6181DeE411a35F160Cb00b9FEC9d830`);
  console.log(`   Data: ${setOperatorLedgerCalldata}\n`);

  // 4. KYCRegistry.transferOwnership(timelock)
  const kycRegistry = await ethers.getContractAt("KYCRegistry", "0x443e068FE6F2F7B57C71A3Bc5492aA98b5069597");
  const transferOwnershipCalldata = kycRegistry.interface.encodeFunctionData("transferOwnership", [timelockAddr]);
  console.log("4. KYCRegistry.transferOwnership(timelock):");
  console.log(`   Target: 0x443e068FE6F2F7B57C71A3Bc5492aA98b5069597`);
  console.log(`   Data: ${transferOwnershipCalldata}\n`);

  // Treasury and AuditTrail ownership transfers
  const treasury = await ethers.getContractAt("Treasury", "0x2504e917A78C8094Aee0cba8e076fc3891b95265");
  const treasuryTransferCalldata = treasury.interface.encodeFunctionData("transferOwnership", [timelockAddr]);
  console.log("5. Treasury.transferOwnership(timelock):");
  console.log(`   Target: 0x2504e917A78C8094Aee0cba8e076fc3891b95265`);
  console.log(`   Data: ${treasuryTransferCalldata}\n`);

  const auditTrail = await ethers.getContractAt("AuditTrail", "0x98D9f9555bd2049Fb52DCe040C1B895CB55BcE81");
  const auditTrailTransferCalldata = auditTrail.interface.encodeFunctionData("transferOwnership", [timelockAddr]);
  console.log("6. AuditTrail.transferOwnership(timelock):");
  console.log(`   Target: 0x98D9f9555bd2049Fb52DCe040C1B895CB55BcE81`);
  console.log(`   Data: ${auditTrailTransferCalldata}\n`);

  console.log("\n📋 EXECUTION ORDER (via Gnosis Safe):");
  console.log("1. Propose each operation via Gnosis Safe UI");
  console.log("2. Wait for 3/4 signatures");
  console.log("3. Submit to Timelock (queue in Safe, executes after delay)");
  console.log("4. Wait for timelock delay (1 hour testnet / 48h mainnet)");
  console.log("5. Execute via Timelock (anyone can execute after delay)");

  // Save calldata for reference
  const calldata = {
    network: "sepolia",
    timelockAddress: "TIMELOCK_ADDRESS_PLACEHOLDER",
    operations: [
      { name: "CarbonCreditToken.setOperator", target: "0x0C72dcc5a88C66259DDB09B187F9A8392f6cf3C2", data: setOperatorCalldata },
      { name: "Marketplace.setSignerWalletViaTimelock", target: "0x3cDE5d0e6A0B0955d5fb72e7E5Ba2e3070AEA19A", data: setSignerCalldata },
      { name: "CreditLedger.setOperator", target: "0x2046625FC6181DeE411a35F160Cb00b9FEC9d830", data: setOperatorLedgerCalldata },
      { name: "KYCRegistry.transferOwnership", target: "0x443e068FE6F2F7B57C71A3Bc5492aA98b5069597", data: transferOwnershipCalldata },
      { name: "Treasury.transferOwnership", target: "0x2504e917A78C8094Aee0cba8e076fc3891b95265", data: treasuryTransferCalldata },
      { name: "AuditTrail.transferOwnership", target: "0x98D9f9555bd2049Fb52DCe040C1B895CB55BcE81", data: auditTrailTransferCalldata },
    ],
    generatedAt: new Date().toISOString(),
  };

  const outputFile = path.join(__dirname, "../deployments", `sepolia_proposals_${Date.now()}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(calldata, null, 2));
  console.log(`\n📄 Proposal calldata saved to: ${outputFile}`);
  console.log("\n✅ Proposal preparation complete!");
}

main().catch((error) => {
  console.error("\n❌ Error:", error);
  process.exitCode = 1;
});