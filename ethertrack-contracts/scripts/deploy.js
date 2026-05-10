const hre = require("hardhat");
const fs  = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network    = hre.network.name;
  const chainId    = (await hre.ethers.provider.getNetwork()).chainId;
  const balance    = await hre.ethers.provider.getBalance(deployer.address);

  console.log("🚀 EtherTrack Full Deployment");
  console.log("══════════════════════════════════════════════════════");
  console.log(`Network:  ${network} (chainId: ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${hre.ethers.formatEther(balance)} ETH`);
  console.log("");

  const addresses = {};

  // ── 1. KYCRegistry ───────────────────────────────────────
  console.log("1️⃣  Deploying KYCRegistry...");
  const KYCRegistry = await hre.ethers.getContractFactory("KYCRegistry");
  const kyc = await KYCRegistry.deploy(deployer.address);
  await kyc.waitForDeployment();
  addresses.KYCRegistry = await kyc.getAddress();
  console.log(`   ✅ KYCRegistry: ${addresses.KYCRegistry}`);

  // ── 2. Treasury ───────────────────────────────────────────
  console.log("2️⃣  Deploying Treasury...");
  const Treasury = await hre.ethers.getContractFactory("Treasury");
  const treasury = await Treasury.deploy(deployer.address);
  await treasury.waitForDeployment();
  addresses.Treasury = await treasury.getAddress();
  console.log(`   ✅ Treasury: ${addresses.Treasury}`);

  // ── 3. CarbonCreditToken ──────────────────────────────────
  console.log("3️⃣  Deploying CarbonCreditToken...");
  const CarbonCreditToken = await hre.ethers.getContractFactory("CarbonCreditToken");
  const token = await CarbonCreditToken.deploy(deployer.address, addresses.KYCRegistry);
  await token.waitForDeployment();
  addresses.CarbonCreditToken = await token.getAddress();
  console.log(`   ✅ CarbonCreditToken: ${addresses.CarbonCreditToken}`);

  // ── 4. EmissionRegistry ───────────────────────────────────
  console.log("4️⃣  Deploying EmissionRegistry...");
  const EmissionRegistry = await hre.ethers.getContractFactory("EmissionRegistry");
  const emission = await EmissionRegistry.deploy(deployer.address, addresses.KYCRegistry);
  await emission.waitForDeployment();
  addresses.EmissionRegistry = await emission.getAddress();
  console.log(`   ✅ EmissionRegistry: ${addresses.EmissionRegistry}`);

  // ── 5. Marketplace ────────────────────────────────────────
  console.log("5️⃣  Deploying Marketplace...");
  const Marketplace = await hre.ethers.getContractFactory("Marketplace");
  const marketplace = await Marketplace.deploy(
    deployer.address,
    addresses.CarbonCreditToken,
    addresses.KYCRegistry,
    addresses.Treasury
  );
  await marketplace.waitForDeployment();
  addresses.Marketplace = await marketplace.getAddress();
  console.log(`   ✅ Marketplace: ${addresses.Marketplace}`);

  // ── 6. AMMPool ────────────────────────────────────────────
  console.log("6️⃣  Deploying AMMPool...");
  const AMMPool = await hre.ethers.getContractFactory("AMMPool");
  const amm = await AMMPool.deploy(
    deployer.address,
    addresses.CarbonCreditToken,
    addresses.KYCRegistry,
    addresses.Treasury
  );
  await amm.waitForDeployment();
  addresses.AMMPool = await amm.getAddress();
  console.log(`   ✅ AMMPool: ${addresses.AMMPool}`);

  // ── Post-deployment wiring ────────────────────────────────
  console.log("");
  console.log("⚙️  Post-deployment configuration...");

  // ✅ FIXED: authorizeDepositor (not addDepositor)
  await treasury.authorizeDepositor(addresses.Marketplace);
  console.log("   ✅ Marketplace authorized as Treasury depositor");

  await treasury.authorizeDepositor(addresses.AMMPool);
  console.log("   ✅ AMMPool authorized as Treasury depositor");

  // ✅ FIXED: addKYCOperator (not addMinter — token doesn't have that)
  await kyc.addKYCOperator(deployer.address);
  console.log("   ✅ Deployer added as KYC operator");

  // Wire AMMPool into Marketplace
  await marketplace.setAMMPool(addresses.AMMPool);
  console.log("   ✅ AMMPool wired into Marketplace");

  // Set AMM threshold
  await marketplace.setAMMThreshold(100);
  console.log("   ✅ AMM threshold set: ≤100 credits → AMM, >100 → Order Book");

  // ✅ Deployer wallet KYC verified (for testing)
  const kycHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("deployer-kyc-ethertrack"));
  await kyc.verifyKYC(deployer.address, kycHash);
  console.log("   ✅ Deployer wallet KYC verified on-chain");

  // ── Save deployment ───────────────────────────────────────
  const timestamp      = Date.now();
  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir);

  const deploymentData = {
    network,
    chainId:   chainId.toString(),
    deployer:  deployer.address,
    timestamp: new Date().toISOString(),
    contracts: addresses,
  };

  fs.writeFileSync(
    path.join(deploymentsDir, `${network}_${timestamp}.json`),
    JSON.stringify(deploymentData, null, 2)
  );

  // Write .env snippet
  const envContent = `
# ─── BACKEND .env ────────────────────────────────────
# EtherTrack Contract Addresses — ${new Date().toISOString()}
# Network: ${network} (${chainId})

KYC_REGISTRY_ADDRESS=${addresses.KYCRegistry}
TREASURY_ADDRESS=${addresses.Treasury}
CARBON_CREDIT_TOKEN_ADDRESS=${addresses.CarbonCreditToken}
EMISSION_REGISTRY_ADDRESS=${addresses.EmissionRegistry}
MARKETPLACE_ADDRESS=${addresses.Marketplace}
AMM_POOL_ADDRESS=${addresses.AMMPool}

# ─── FRONTEND .env ───────────────────────────────────
REACT_APP_KYC_REGISTRY_ADDRESS=${addresses.KYCRegistry}
REACT_APP_TREASURY_ADDRESS=${addresses.Treasury}
REACT_APP_CARBON_CREDIT_TOKEN_ADDRESS=${addresses.CarbonCreditToken}
REACT_APP_EMISSION_REGISTRY_ADDRESS=${addresses.EmissionRegistry}
REACT_APP_MARKETPLACE_ADDRESS=${addresses.Marketplace}
REACT_APP_AMM_POOL_ADDRESS=${addresses.AMMPool}
`.trim();

  fs.writeFileSync(path.join(deploymentsDir, `${network}.env`), envContent);
  console.log(`\n📁 Saved to: deployments/${network}_${timestamp}.json`);
  console.log(`📁 .env snippet: deployments/${network}.env`);

  // ── Summary ───────────────────────────────────────────────
  console.log("");
  console.log("══════════════════════════════════════════════════════");
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("══════════════════════════════════════════════════════");
  console.log("");
  console.log("Contract Addresses:");
  Object.entries(addresses).forEach(([name, addr]) => {
    console.log(`  ${name.padEnd(22)} ${addr}`);
  });
  console.log("");
  console.log("══════════════════════════════════════════════════════");
  console.log("COPY THESE TO YOUR .env FILES:");
  console.log("══════════════════════════════════════════════════════");
  console.log(`KYC_REGISTRY_ADDRESS=${addresses.KYCRegistry}`);
  console.log(`TREASURY_ADDRESS=${addresses.Treasury}`);
  console.log(`CARBON_CREDIT_TOKEN_ADDRESS=${addresses.CarbonCreditToken}`);
  console.log(`MARKETPLACE_ADDRESS=${addresses.Marketplace}`);
  console.log(`AMM_POOL_ADDRESS=${addresses.AMMPool}`);
  console.log("");
  console.log(`REACT_APP_KYC_REGISTRY_ADDRESS=${addresses.KYCRegistry}`);
  console.log(`REACT_APP_CARBON_CREDIT_TOKEN_ADDRESS=${addresses.CarbonCreditToken}`);
  console.log(`REACT_APP_MARKETPLACE_ADDRESS=${addresses.Marketplace}`);
  console.log(`REACT_APP_AMM_POOL_ADDRESS=${addresses.AMMPool}`);
  console.log(`REACT_APP_TREASURY_ADDRESS=${addresses.Treasury}`);
  console.log("══════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});