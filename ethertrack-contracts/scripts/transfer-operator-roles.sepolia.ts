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
  console.log(`Using deployer: ${deployer.address}\n`);

  const timelock = await ethers.getContractAt("TimelockController", timelockAddr);

  console.log(`🔗 Timelock: ${timelockAddr}`);
  console.log(`👤 Deployer: ${deployer.address}\n`);

  // Generate calldata for each operation
  console.log("\n📋 CALldata for each proposal:\n");

  // 1. CarbonCreditToken.setOperator(timelock)
  const carbonCreditToken = await ethers.getContractAt("CarbonCreditToken", CONTRACTS.carbonCreditToken);
  const setOperatorCalldata = carbonCreditToken.interface.encodeFunctionData("setOperator", [timelockAddr]);
  console.log("1. CarbonCreditToken.setOperator(timelock):");
  console.log(`   Target: ${CONTRACTS.carbonCreditToken}`);
  console.log(`   Data: ${setOperatorCalldata}\n`);

  // 2. Marketplace.setSignerWalletViaTimelock(timelockSigner)
  // Use current signer wallet as new signer for testing
  const marketplace = await ethers.getContractAt("Marketplace", CONTRACTS.marketplace);
  const currentSigner = await marketplace.signerWallet();
  const setSignerCalldata = marketplace.interface.encodeFunctionData("setSignerWalletViaTimelock", [currentSigner]);
  console.log("2. Marketplace.setSignerWalletViaTimelock(currentSigner):");
  console.log(`   Target: ${CONTRACTS.marketplace}`);
  console.log(`   Data: ${setSignerCalldata}\n`);

  // 3. CreditLedger.setOperator(timelock)
  const creditLedger = await ethers.getContractAt("CreditLedger", CONTRACTS.creditLedger);
  const setOperatorLedgerCalldata = creditLedger.interface.encodeFunctionData("setOperator", [timelockAddr]);
  console.log("3. CreditLedger.setOperator(timelock):");
  console.log(`   Target: ${CONTRACTS.creditLedger}`);
  console.log(`   Data: ${setOperatorLedgerCalldata}\n`);

  // 4. KYCRegistry.transferOwnership(timelock)
  const kycRegistry = await ethers.getContractAt("KYCRegistry", CONTRACTS.kycRegistry);
  const transferOwnershipCalldata = kycRegistry.interface.encodeFunctionData("transferOwnership", [timelockAddr]);
  console.log("4. KYCRegistry.transferOwnership(timelock):");
  console.log(`   Target: ${CONTRACTS.kycRegistry}`);
  console.log(`   Data: ${transferOwnershipCalldata}\n`);

  // 5. Treasury.transferOwnership(timelock)
  const treasury = await ethers.getContractAt("Treasury", CONTRACTS.treasury);
  const treasuryTransferCalldata = treasury.interface.encodeFunctionData("transferOwnership", [timelockAddr]);
  console.log("5. Treasury.transferOwnership(timelock):");
  console.log(`   Target: ${CONTRACTS.treasury}`);
  console.log(`   Data: ${treasuryTransferCalldata}\n`);

  // 6. AuditTrail.transferOwnership(timelock)
  const auditTrail = await ethers.getContractAt("AuditTrail", CONTRACTS.auditTrail);
  const auditTrailTransferCalldata = auditTrail.interface.encodeFunctionData("transferOwnership", [timelockAddr]);
  console.log("6. AuditTrail.transferOwnership(timelock):");
  console.log(`   Target: ${CONTRACTS.auditTrail}`);
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
    timelockAddress: timelockAddr,
    operations: [
      { name: "CarbonCreditToken.setOperator", target: CONTRACTS.carbonCreditToken, data: setOperatorCalldata },
      { name: "Marketplace.setSignerWalletViaTimelock", target: CONTRACTS.marketplace, data: setSignerCalldata },
      { name: "CreditLedger.setOperator", target: CONTRACTS.creditLedger, data: setOperatorLedgerCalldata },
      { name: "KYCRegistry.transferOwnership", target: CONTRACTS.kycRegistry, data: transferOwnershipCalldata },
      { name: "Treasury.transferOwnership", target: CONTRACTS.treasury, data: treasuryTransferCalldata },
      { name: "AuditTrail.transferOwnership", target: CONTRACTS.auditTrail, data: auditTrailTransferCalldata },
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