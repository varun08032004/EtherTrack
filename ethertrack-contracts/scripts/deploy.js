const hre  = require("hardhat");
const fs   = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network    = hre.network.name;
  const chainId    = (await hre.ethers.provider.getNetwork()).chainId;
  const balance    = await hre.ethers.provider.getBalance(deployer.address);

  const EXPLORERS = {
    sepolia:  'https://sepolia.etherscan.io/address',
    mainnet:  'https://etherscan.io/address',
    polygon:  'https://polygonscan.com/address',
    amoy:     'https://amoy.polygonscan.com/address',
    localhost:'http://localhost',
  };
  const explorer = EXPLORERS[network] || '';

  // [FIX-SIGNER] Marketplace.signerWallet / CarbonCreditToken.operator /
  // CreditLedger.operator must all be the address matching
  // MINTER_PRIVATE_KEY in the backend .env. This script assumes deployer
  // IS that wallet. If your MINTER_PRIVATE_KEY is a different key than
  // whichever key runs this script, replace `deployer.address` below.
  const operatorWallet = deployer.address;

  console.log("🚀 EtherTrack Full Deployment");
  console.log("══════════════════════════════════════════════════════");
  console.log(`Network:  ${network} (chainId: ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${hre.ethers.formatEther(balance)} ETH/MATIC`);
  console.log(`Operator/Signer wallet (must match MINTER_PRIVATE_KEY): ${operatorWallet}`);
  console.log("");

  const addresses = {};

  console.log("1️⃣  Deploying KYCRegistry...");
  const KYCRegistry = await hre.ethers.getContractFactory("KYCRegistry");
  const kyc = await KYCRegistry.deploy(deployer.address);
  await kyc.waitForDeployment();
  addresses.KYCRegistry = await kyc.getAddress();
  console.log(`   ✅ KYCRegistry: ${addresses.KYCRegistry}`);

  console.log("2️⃣  Deploying Treasury...");
  const Treasury = await hre.ethers.getContractFactory("Treasury");
  const treasury = await Treasury.deploy(deployer.address);
  await treasury.waitForDeployment();
  addresses.Treasury = await treasury.getAddress();
  console.log(`   ✅ Treasury: ${addresses.Treasury}`);

  console.log("3️⃣  Deploying CarbonCreditToken...");
  const CarbonCreditToken = await hre.ethers.getContractFactory("CarbonCreditToken");
  const token = await CarbonCreditToken.deploy(deployer.address, addresses.KYCRegistry);
  await token.waitForDeployment();
  addresses.CarbonCreditToken = await token.getAddress();
  console.log(`   ✅ CarbonCreditToken: ${addresses.CarbonCreditToken}`);

  console.log("4️⃣  Deploying EmissionRegistry...");
  const EmissionRegistry = await hre.ethers.getContractFactory("EmissionRegistry");
  const emission = await EmissionRegistry.deploy(deployer.address, addresses.KYCRegistry);
  await emission.waitForDeployment();
  addresses.EmissionRegistry = await emission.getAddress();
  console.log(`   ✅ EmissionRegistry: ${addresses.EmissionRegistry}`);

  console.log("5️⃣  Deploying Marketplace...");
  const Marketplace = await hre.ethers.getContractFactory("Marketplace");
  const marketplace = await Marketplace.deploy(
    deployer.address,
    addresses.CarbonCreditToken,
    addresses.KYCRegistry,
    addresses.Treasury,
    operatorWallet
  );
  await marketplace.waitForDeployment();
  addresses.Marketplace = await marketplace.getAddress();
  console.log(`   ✅ Marketplace: ${addresses.Marketplace} (signerWallet: ${operatorWallet})`);

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

  console.log("7️⃣  Deploying AuditTrail...");
  const AuditTrail = await hre.ethers.getContractFactory("AuditTrail");
  const auditTrail = await AuditTrail.deploy(deployer.address);
  await auditTrail.waitForDeployment();
  addresses.AuditTrail = await auditTrail.getAddress();
  console.log(`   ✅ AuditTrail: ${addresses.AuditTrail}`);

  console.log("8️⃣  Deploying CreditLedger...");
  const CreditLedger = await hre.ethers.getContractFactory("CreditLedger");
  const creditLedger = await CreditLedger.deploy(deployer.address);
  await creditLedger.waitForDeployment();
  addresses.CreditLedger = await creditLedger.getAddress();
  console.log(`   ✅ CreditLedger: ${addresses.CreditLedger}`);

  // ── Save deployment files IMMEDIATELY after all deploys succeed,
  // BEFORE any post-deployment wiring calls — so a failure in wiring
  // (like the linkWallet race below) never costs you the addresses.
  const timestamp      = Date.now();
  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir);

  const deploymentData = {
    network, chainId: chainId.toString(), deployer: deployer.address,
    operatorWallet, timestamp: new Date().toISOString(), contracts: addresses,
  };
  fs.writeFileSync(
    path.join(deploymentsDir, `${network}_${timestamp}.json`),
    JSON.stringify(deploymentData, null, 2)
  );

  const envContent = `
# ─── BACKEND .env ────────────────────────────────────────────────────────────
KYC_REGISTRY_ADDRESS=${addresses.KYCRegistry}
TREASURY_ADDRESS=${addresses.Treasury}
CARBON_CREDIT_TOKEN_ADDRESS=${addresses.CarbonCreditToken}
EMISSION_REGISTRY_ADDRESS=${addresses.EmissionRegistry}
MARKETPLACE_ADDRESS=${addresses.Marketplace}
AMM_POOL_ADDRESS=${addresses.AMMPool}
AUDIT_CONTRACT_ADDRESS=${addresses.AuditTrail}
CREDIT_LEDGER_ADDRESS=${addresses.CreditLedger}

# ─── FRONTEND .env ───────────────────────────────────────────────────────────
REACT_APP_KYC_REGISTRY_ADDRESS=${addresses.KYCRegistry}
REACT_APP_TREASURY_ADDRESS=${addresses.Treasury}
REACT_APP_CARBON_CREDIT_TOKEN_ADDRESS=${addresses.CarbonCreditToken}
REACT_APP_EMISSION_REGISTRY_ADDRESS=${addresses.EmissionRegistry}
REACT_APP_MARKETPLACE_ADDRESS=${addresses.Marketplace}
REACT_APP_AMM_POOL_ADDRESS=${addresses.AMMPool}
REACT_APP_AUDIT_CONTRACT_ADDRESS=${addresses.AuditTrail}
REACT_APP_CREDIT_LEDGER_ADDRESS=${addresses.CreditLedger}
`.trim();
  fs.writeFileSync(path.join(deploymentsDir, `${network}.env`), envContent);
  console.log(`\n📁 Saved: deployments/${network}_${timestamp}.json and deployments/${network}.env`);

  // ── Post-deployment wiring ─────────────────────────────────────────────
  console.log("");
  console.log("⚙️  Post-deployment configuration...");

  await (await treasury.authorizeDepositor(addresses.Marketplace)).wait();
  console.log("   ✅ Marketplace authorized as Treasury depositor");

  await (await treasury.authorizeDepositor(addresses.AMMPool)).wait();
  console.log("   ✅ AMMPool authorized as Treasury depositor");

  await (await kyc.addKYCOperator(deployer.address)).wait();
  console.log("   ✅ Deployer added as KYC operator");

  await (await marketplace.setAMMPool(addresses.AMMPool)).wait();
  console.log("   ✅ AMMPool wired into Marketplace");

  await (await marketplace.setAMMThreshold(100)).wait();
  console.log("   ✅ AMM threshold set: ≤100 credits → AMM, >100 → Order Book");

  await (await token.setOperator(operatorWallet)).wait();
  console.log(`   ✅ CarbonCreditToken operator set: ${operatorWallet}`);

  await (await creditLedger.setOperator(operatorWallet)).wait();
  console.log(`   ✅ CreditLedger operator set: ${operatorWallet}`);

  // [FIX-RACE] linkWallet()'s require(verified) checks state written by
  // verifyKYC() in the immediately preceding call — MUST wait for that
  // transaction to actually be mined first, or gas estimation for
  // linkWallet reverts against stale (pre-verification) chain state.
  // This step is OPTIONAL — purely a testnet convenience so the deployer's
  // own wallet is KYC'd for quick manual testing. Real users go through
  // the actual admin-approval flow, not this bootstrap step.
  const deployerIdHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("deployer-kyc-ethertrack"));
  const kycHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("deployer-kyc-ethertrack"));
  await (await kyc.verifyKYC(deployerIdHash, kycHash)).wait();
  await (await kyc.linkWallet(deployerIdHash, deployer.address)).wait();
  console.log("   ✅ Deployer identity KYC verified + wallet linked on-chain (testnet convenience only)");

  console.log("   ✅ AuditTrail ready — deployer is relayer (owner)");

  console.log("");
  console.log("══════════════════════════════════════════════════════");
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("══════════════════════════════════════════════════════");
  Object.entries(addresses).forEach(([name, addr]) => {
    const link = explorer ? `\n     ${explorer}/${addr}` : '';
    console.log(`  ${name.padEnd(22)} ${addr}${link}`);
  });

  if (network !== 'localhost') {
    console.log("");
    console.log("📋 To verify all contracts on explorer, run:");
    Object.entries(addresses).forEach(([name, addr]) => {
      const constructorArgs = {
        KYCRegistry:        [deployer.address],
        Treasury:           [deployer.address],
        CarbonCreditToken:  [deployer.address, addresses.KYCRegistry],
        EmissionRegistry:   [deployer.address, addresses.KYCRegistry],
        Marketplace:        [deployer.address, addresses.CarbonCreditToken, addresses.KYCRegistry, addresses.Treasury, operatorWallet],
        AMMPool:            [deployer.address, addresses.CarbonCreditToken, addresses.KYCRegistry, addresses.Treasury],
        AuditTrail:         [deployer.address],
        CreditLedger:       [deployer.address],
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