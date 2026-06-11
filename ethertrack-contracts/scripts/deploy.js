const hre  = require("hardhat");
const fs   = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network    = hre.network.name;
  const chainId    = (await hre.ethers.provider.getNetwork()).chainId;
  const balance    = await hre.ethers.provider.getBalance(deployer.address);

  // ── Explorer base URLs per network ──────────────────────────────────────
  const EXPLORERS = {
    sepolia:  'https://sepolia.etherscan.io/address',
    mainnet:  'https://etherscan.io/address',
    polygon:  'https://polygonscan.com/address',
    amoy:     'https://amoy.polygonscan.com/address',
    localhost:'http://localhost',
  };
  const explorer = EXPLORERS[network] || '';

  console.log("🚀 EtherTrack Full Deployment");
  console.log("══════════════════════════════════════════════════════");
  console.log(`Network:  ${network} (chainId: ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${hre.ethers.formatEther(balance)} ETH/MATIC`);
  console.log("");

  const addresses = {};

  // ── 1. KYCRegistry ────────────────────────────────────────────────────
  console.log("1️⃣  Deploying KYCRegistry...");
  const KYCRegistry = await hre.ethers.getContractFactory("KYCRegistry");
  const kyc = await KYCRegistry.deploy(deployer.address);
  await kyc.waitForDeployment();
  addresses.KYCRegistry = await kyc.getAddress();
  console.log(`   ✅ KYCRegistry: ${addresses.KYCRegistry}`);

  // ── 2. Treasury ───────────────────────────────────────────────────────
  console.log("2️⃣  Deploying Treasury...");
  const Treasury = await hre.ethers.getContractFactory("Treasury");
  const treasury = await Treasury.deploy(deployer.address);
  await treasury.waitForDeployment();
  addresses.Treasury = await treasury.getAddress();
  console.log(`   ✅ Treasury: ${addresses.Treasury}`);

  // ── 3. CarbonCreditToken ──────────────────────────────────────────────
  console.log("3️⃣  Deploying CarbonCreditToken...");
  const CarbonCreditToken = await hre.ethers.getContractFactory("CarbonCreditToken");
  const token = await CarbonCreditToken.deploy(deployer.address, addresses.KYCRegistry);
  await token.waitForDeployment();
  addresses.CarbonCreditToken = await token.getAddress();
  console.log(`   ✅ CarbonCreditToken: ${addresses.CarbonCreditToken}`);

  // ── 4. EmissionRegistry ───────────────────────────────────────────────
  console.log("4️⃣  Deploying EmissionRegistry...");
  const EmissionRegistry = await hre.ethers.getContractFactory("EmissionRegistry");
  const emission = await EmissionRegistry.deploy(deployer.address, addresses.KYCRegistry);
  await emission.waitForDeployment();
  addresses.EmissionRegistry = await emission.getAddress();
  console.log(`   ✅ EmissionRegistry: ${addresses.EmissionRegistry}`);

  // ── 5. Marketplace ────────────────────────────────────────────────────
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

  // ── 6. AMMPool ────────────────────────────────────────────────────────
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

  // ── 7. AuditTrail ─────────────────────────────────────────────────────
  // Standalone — no dependencies on other contracts.
  // deployer.address = relayer wallet (owner) — same PRIVATE_KEY used by
  // the backend audit.js to submit audit entries on-chain.
  console.log("7️⃣  Deploying AuditTrail...");
  const AuditTrail = await hre.ethers.getContractFactory("AuditTrail");
  const auditTrail = await AuditTrail.deploy(deployer.address);
  await auditTrail.waitForDeployment();
  addresses.AuditTrail = await auditTrail.getAddress();
  console.log(`   ✅ AuditTrail: ${addresses.AuditTrail}`);

  // ── Post-deployment wiring ─────────────────────────────────────────────
  console.log("");
  console.log("⚙️  Post-deployment configuration...");

  await treasury.authorizeDepositor(addresses.Marketplace);
  console.log("   ✅ Marketplace authorized as Treasury depositor");

  await treasury.authorizeDepositor(addresses.AMMPool);
  console.log("   ✅ AMMPool authorized as Treasury depositor");

  await kyc.addKYCOperator(deployer.address);
  console.log("   ✅ Deployer added as KYC operator");

  await marketplace.setAMMPool(addresses.AMMPool);
  console.log("   ✅ AMMPool wired into Marketplace");

  await marketplace.setAMMThreshold(100);
  console.log("   ✅ AMM threshold set: ≤100 credits → AMM, >100 → Order Book");

  // Deployer wallet KYC verified for testing
  const kycHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("deployer-kyc-ethertrack"));
  await kyc.verifyKYC(deployer.address, kycHash);
  console.log("   ✅ Deployer wallet KYC verified on-chain");

  // AuditTrail needs no wiring — deployer is already owner (relayer)
  console.log("   ✅ AuditTrail ready — deployer is relayer (owner)");

  // ── Save deployment ────────────────────────────────────────────────────
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
# ─── BACKEND .env ────────────────────────────────────────────────────────────
# EtherTrack Contract Addresses — ${new Date().toISOString()}
# Network: ${network} (chainId: ${chainId})

KYC_REGISTRY_ADDRESS=${addresses.KYCRegistry}
TREASURY_ADDRESS=${addresses.Treasury}
CARBON_CREDIT_TOKEN_ADDRESS=${addresses.CarbonCreditToken}
EMISSION_REGISTRY_ADDRESS=${addresses.EmissionRegistry}
MARKETPLACE_ADDRESS=${addresses.Marketplace}
AMM_POOL_ADDRESS=${addresses.AMMPool}
AUDIT_CONTRACT_ADDRESS=${addresses.AuditTrail}

# Used by routes/audit.js as the relayer wallet
# PRIVATE_KEY is already set — same wallet is the contract owner/relayer

# ─── FRONTEND .env ───────────────────────────────────────────────────────────
REACT_APP_KYC_REGISTRY_ADDRESS=${addresses.KYCRegistry}
REACT_APP_TREASURY_ADDRESS=${addresses.Treasury}
REACT_APP_CARBON_CREDIT_TOKEN_ADDRESS=${addresses.CarbonCreditToken}
REACT_APP_EMISSION_REGISTRY_ADDRESS=${addresses.EmissionRegistry}
REACT_APP_MARKETPLACE_ADDRESS=${addresses.Marketplace}
REACT_APP_AMM_POOL_ADDRESS=${addresses.AMMPool}
REACT_APP_AUDIT_CONTRACT_ADDRESS=${addresses.AuditTrail}
`.trim();

  fs.writeFileSync(path.join(deploymentsDir, `${network}.env`), envContent);
  console.log(`\n📁 Saved to: deployments/${network}_${timestamp}.json`);
  console.log(`📁 .env snippet: deployments/${network}.env`);

  // ── Summary ───────────────────────────────────────────────────────────
  console.log("");
  console.log("══════════════════════════════════════════════════════");
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("══════════════════════════════════════════════════════");
  console.log("");
  console.log("Contract Addresses:");
  Object.entries(addresses).forEach(([name, addr]) => {
    const link = explorer ? `\n     ${explorer}/${addr}` : '';
    console.log(`  ${name.padEnd(22)} ${addr}${link}`);
  });
  console.log("");
  console.log("══════════════════════════════════════════════════════");
  console.log("COPY THESE TO YOUR .env FILES:");
  console.log("══════════════════════════════════════════════════════");
  console.log(`KYC_REGISTRY_ADDRESS=${addresses.KYCRegistry}`);
  console.log(`TREASURY_ADDRESS=${addresses.Treasury}`);
  console.log(`CARBON_CREDIT_TOKEN_ADDRESS=${addresses.CarbonCreditToken}`);
  console.log(`EMISSION_REGISTRY_ADDRESS=${addresses.EmissionRegistry}`);
  console.log(`MARKETPLACE_ADDRESS=${addresses.Marketplace}`);
  console.log(`AMM_POOL_ADDRESS=${addresses.AMMPool}`);
  console.log(`AUDIT_CONTRACT_ADDRESS=${addresses.AuditTrail}`);
  console.log("");
  console.log(`REACT_APP_KYC_REGISTRY_ADDRESS=${addresses.KYCRegistry}`);
  console.log(`REACT_APP_TREASURY_ADDRESS=${addresses.Treasury}`);
  console.log(`REACT_APP_CARBON_CREDIT_TOKEN_ADDRESS=${addresses.CarbonCreditToken}`);
  console.log(`REACT_APP_EMISSION_REGISTRY_ADDRESS=${addresses.EmissionRegistry}`);
  console.log(`REACT_APP_MARKETPLACE_ADDRESS=${addresses.Marketplace}`);
  console.log(`REACT_APP_AMM_POOL_ADDRESS=${addresses.AMMPool}`);
  console.log(`REACT_APP_AUDIT_CONTRACT_ADDRESS=${addresses.AuditTrail}`);
  console.log("══════════════════════════════════════════════════════");

  // ── Verify prompt ─────────────────────────────────────────────────────
  if (network !== 'localhost') {
    console.log("");
    console.log("📋 To verify all contracts on explorer, run:");
    Object.entries(addresses).forEach(([name, addr]) => {
      const constructorArgs = {
        KYCRegistry:        [deployer.address],
        Treasury:           [deployer.address],
        CarbonCreditToken:  [deployer.address, addresses.KYCRegistry],
        EmissionRegistry:   [deployer.address, addresses.KYCRegistry],
        Marketplace:        [deployer.address, addresses.CarbonCreditToken, addresses.KYCRegistry, addresses.Treasury],
        AMMPool:            [deployer.address, addresses.CarbonCreditToken, addresses.KYCRegistry, addresses.Treasury],
        AuditTrail:         [deployer.address],
      };
      const args = (constructorArgs[name] || []).join(' ');
      console.log(`npx hardhat verify --network ${network} ${addr} ${args}`);
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});