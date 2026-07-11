// scripts/deploy-credit-ledger.js
// ─────────────────────────────────────────────────────────────────────────────
// Deploys CreditLedger.sol — a brand new, standalone contract. No existing
// contracts are touched, no existing state can be orphaned (there IS no
// existing state — this is the first deployment).
//
// Run: npx hardhat run scripts/deploy-credit-ledger.js --network sepolia
// ─────────────────────────────────────────────────────────────────────────────

const hre  = require("hardhat");
const fs   = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;
  const balance = await hre.ethers.provider.getBalance(deployer.address);

  console.log("🚀 Deploying CreditLedger");
  console.log("══════════════════════════════════════════════════════");
  console.log(`Network:  ${network} (chainId: ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${hre.ethers.formatEther(balance)} ETH/MATIC`);

  const CreditLedger = await hre.ethers.getContractFactory("CreditLedger");
  const ledger = await CreditLedger.deploy(deployer.address);
  await ledger.waitForDeployment();
  const ledgerAddress = await ledger.getAddress();

  console.log(`\n✅ CreditLedger deployed: ${ledgerAddress}`);

  // Set the operator to the same wallet your backend already uses for
  // everything else (MINTER_PRIVATE_KEY) — reuses the address we already
  // fixed the Marketplace signer to match.
  const operatorAddress = process.env.MINTER_PRIVATE_KEY
    ? new hre.ethers.Wallet(process.env.MINTER_PRIVATE_KEY).address
    : deployer.address;

  console.log(`⚙️  Setting operator to: ${operatorAddress}`);
  const tx = await ledger.setOperator(operatorAddress);
  await tx.wait();
  console.log("   ✅ Operator set.");

  const timestamp = Date.now();
  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir);

  fs.writeFileSync(
    path.join(deploymentsDir, `${network}_credit-ledger_${timestamp}.json`),
    JSON.stringify({
      network, chainId: chainId.toString(), deployer: deployer.address,
      timestamp: new Date().toISOString(),
      creditLedgerAddress: ledgerAddress,
      operator: operatorAddress,
    }, null, 2)
  );

  console.log("\n══════════════════════════════════════════════════════");
  console.log("ADD THIS TO ethertrack-backend/.env:");
  console.log(`CREDIT_LEDGER_ADDRESS=${ledgerAddress}`);
  console.log("══════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});