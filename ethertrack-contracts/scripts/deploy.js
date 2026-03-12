const hre = require("hardhat");
const fs  = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network    = hre.network.name;
  const chainId    = (await hre.ethers.provider.getNetwork()).chainId;
  const balance    = await hre.ethers.provider.getBalance(deployer.address);

  console.log("🚀 EtherTrack Full Deployment — Hybrid Order Book + AMM");
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

  // ── 5. Marketplace (NEW — with matching engine + buy orders) ──
  console.log("5️⃣  Deploying Marketplace (Order Book + Matching Engine)...");
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

  // ── 6. AMMPool (NEW) ──────────────────────────────────────
  console.log("6️⃣  Deploying AMMPool (x*y=k AMM)...");
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

  // Marketplace authorized as Treasury depositor
  await treasury.addDepositor(addresses.Marketplace);
  console.log("   ✅ Marketplace authorized as Treasury depositor");

  // AMMPool authorized as Treasury depositor
  await treasury.addDepositor(addresses.AMMPool);
  console.log("   ✅ AMMPool authorized as Treasury depositor");

  // Marketplace authorized as CarbonCreditToken minter
  await token.addMinter(addresses.Marketplace);
  console.log("   ✅ Marketplace authorized as CarbonCreditToken minter");

  // Wire AMMPool into Marketplace
  await marketplace.setAMMPool(addresses.AMMPool);
  console.log("   ✅ AMMPool wired into Marketplace");

  // Set AMM threshold: orders <= 100 credits → AMM, > 100 → order book
  await marketplace.setAMMThreshold(100);
  console.log("   ✅ AMM threshold set: ≤100 credits → AMM, >100 → Order Book");

  // Deployer wallet self-verify KYC (for testing)
  const kycHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("deployer-kyc-ethertrack"));
  const kycTx   = await kyc.verifyKYC(deployer.address, kycHash);
  await kycTx.wait();
  console.log("   ✅ Deployer wallet KYC verified");

  // ── Save deployment ───────────────────────────────────────
  const timestamp = Date.now();
  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir);

  const deploymentData = {
    network,
    chainId: chainId.toString(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: addresses,
  };

  fs.writeFileSync(
    path.join(deploymentsDir, `${network}_${timestamp}.json`),
    JSON.stringify(deploymentData, null, 2)
  );

  // Write .env file for React
  const envContent = `
# EtherTrack Contract Addresses — deployed ${new Date().toISOString()}
# Network: ${network} (${chainId})

REACT_APP_KYC_REGISTRY_ADDRESS=${addresses.KYCRegistry}
REACT_APP_TREASURY_ADDRESS=${addresses.Treasury}
REACT_APP_CARBON_CREDIT_TOKEN_ADDRESS=${addresses.CarbonCreditToken}
REACT_APP_EMISSION_REGISTRY_ADDRESS=${addresses.EmissionRegistry}
REACT_APP_MARKETPLACE_ADDRESS=${addresses.Marketplace}
REACT_APP_AMM_POOL_ADDRESS=${addresses.AMMPool}
`.trim();

  fs.writeFileSync(path.join(deploymentsDir, `${network}.env`), envContent);

  // ── Summary ───────────────────────────────────────────────
  console.log("");
  console.log("══════════════════════════════════════════════════════");
  console.log("🎉 Deployment Complete!");
  console.log("");
  console.log("Contract Addresses:");
  Object.entries(addresses).forEach(([name, addr]) => {
    console.log(`  ${name.padEnd(20)} ${addr}`);
  });
  console.log("");
  console.log("Architecture:");
  console.log("  Orders ≤ 100 credits  → AMMPool (instant swap, x*y=k)");
  console.log("  Orders > 100 credits  → Marketplace (order book matching)");
  console.log("  Platform fee          → 0.5% → Treasury");
  console.log("  LP fee                → 0.3% stays in AMM pool");
  console.log("");
  console.log(`Saved to: deployments/${network}_${timestamp}.json`);
  console.log(`Frontend .env: deployments/${network}.env`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Copy deployments/*.env to your React .env");
  console.log("  2. Add REACT_APP_AMM_POOL_ADDRESS to .env");
  console.log("  3. npm start");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});