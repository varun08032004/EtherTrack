// scripts/redeploy-marketplace-v2.js
// ─────────────────────────────────────────────────────────────────────────────
// Redeploys ONLY the Marketplace contract (v2 — with logINRTrade/
// batchLogINRTrades/verifyTrade), reusing your EXISTING CarbonCreditToken,
// KYCRegistry, Treasury, and AMMPool addresses. Does NOT touch those other
// contracts or their state (KYC verifications, credit balances, etc.).
//
// WHY: your currently-deployed Marketplace is the old v1 version (4-arg
// constructor, no logINRTrade). This script deploys the v2 version (5-arg
// constructor, includes signerWallet) and rewires Treasury/AMMPool to
// recognize the new address.
//
// BEFORE RUNNING — set these in your .env (some likely already there from
// the original deployment):
//   CARBON_CREDIT_TOKEN_ADDRESS   — existing, reused as-is
//   KYC_REGISTRY_ADDRESS          — existing, reused as-is
//   TREASURY_ADDRESS              — existing, reused as-is
//   AMM_POOL_ADDRESS              — existing, reused as-is (optional — skipped if unset)
//   CHAIN_SIGNER_PRIVATE_KEY      — used to derive the on-chain signerWallet
//                                    (or set SIGNER_WALLET directly to override)
//
// IMPORTANT CAVEAT: any listings, buy orders, or trade history stored in the
// OLD Marketplace contract's own mappings do NOT carry over — those live
// only in the old contract's storage. This only matters for ETH-side
// listings/orders that were placed against the old Marketplace address.
// If you have live listings on it, you'll need to either let them expire
// naturally or handle migration separately — this script does not attempt
// that.
//
// Run: npx hardhat run scripts/redeploy-marketplace-v2.js --network sepolia
// ─────────────────────────────────────────────────────────────────────────────

const hre  = require("hardhat");
const fs   = require("fs");
const path = require("path");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`❌ Missing required env var: ${name}`);
    console.error(`   Set it in your .env before running this script.`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network     = hre.network.name;
  const chainId     = (await hre.ethers.provider.getNetwork()).chainId;
  const balance     = await hre.ethers.provider.getBalance(deployer.address);

  const EXPLORERS = {
    sepolia:   'https://sepolia.etherscan.io/address',
    mainnet:   'https://etherscan.io/address',
    polygon:   'https://polygonscan.com/address',
    amoy:      'https://amoy.polygonscan.com/address',
    localhost: 'http://localhost',
  };
  const explorer = EXPLORERS[network] || '';

  console.log("🔁 EtherTrack Marketplace v2 — targeted redeploy");
  console.log("══════════════════════════════════════════════════════");
  console.log(`Network:  ${network} (chainId: ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${hre.ethers.formatEther(balance)} ETH/MATIC`);
  console.log("");

  // ── Reused existing addresses ──────────────────────────────────────────
  const creditTokenAddress = requireEnv('CARBON_CREDIT_TOKEN_ADDRESS');
  const kycRegistryAddress = requireEnv('KYC_REGISTRY_ADDRESS');
  const treasuryAddress    = requireEnv('TREASURY_ADDRESS');
  const ammPoolAddress     = process.env.AMM_POOL_ADDRESS || null;

  // ── Signer wallet — must match CHAIN_SIGNER_PRIVATE_KEY used by chainLogger.js ──
  let signerWallet = process.env.SIGNER_WALLET;
  if (!signerWallet) {
    const key = requireEnv('CHAIN_SIGNER_PRIVATE_KEY');
    signerWallet = new hre.ethers.Wallet(key).address;
    console.log(`ℹ️  SIGNER_WALLET not set — derived from CHAIN_SIGNER_PRIVATE_KEY: ${signerWallet}`);
  }

  console.log("Reusing existing contracts:");
  console.log(`  CarbonCreditToken : ${creditTokenAddress}`);
  console.log(`  KYCRegistry       : ${kycRegistryAddress}`);
  console.log(`  Treasury          : ${treasuryAddress}`);
  console.log(`  AMMPool           : ${ammPoolAddress || '(not set — will skip wiring)'}`);
  console.log(`  Signer wallet     : ${signerWallet}`);
  console.log("");

  // ── Sanity check: confirm bytecode actually exists at each reused address ──
  for (const [name, addr] of Object.entries({
    CarbonCreditToken: creditTokenAddress,
    KYCRegistry: kycRegistryAddress,
    Treasury: treasuryAddress,
    ...(ammPoolAddress ? { AMMPool: ammPoolAddress } : {}),
  })) {
    const code = await hre.ethers.provider.getCode(addr);
    if (code === '0x') {
      console.error(`❌ No contract found at ${name} address (${addr}) on ${network}. Aborting.`);
      process.exit(1);
    }
  }
  console.log("✅ All reused addresses verified to have deployed bytecode.\n");

  // ── Deploy Marketplace v2 ───────────────────────────────────────────────
  console.log("🚀 Deploying Marketplace v2...");
  const Marketplace = await hre.ethers.getContractFactory("Marketplace");
  const marketplace = await Marketplace.deploy(
    deployer.address,     // initialOwner
    creditTokenAddress,   // creditTokenAddress
    kycRegistryAddress,   // kycRegistryAddress
    treasuryAddress,      // treasuryAddress
    signerWallet          // _signerWallet — the new v2 arg
  );
  await marketplace.waitForDeployment();
  const newMarketplaceAddress = await marketplace.getAddress();
  console.log(`   ✅ Marketplace v2 deployed: ${newMarketplaceAddress}`);

  // ── Post-deployment wiring ─────────────────────────────────────────────
  console.log("\n⚙️  Post-deployment configuration...");

  const treasury = await hre.ethers.getContractAt("Treasury", treasuryAddress);
  await treasury.authorizeDepositor(newMarketplaceAddress);
  console.log("   ✅ New Marketplace authorized as Treasury depositor");
  console.log("   ⚠️  Old Marketplace's depositor authorization was NOT revoked.");
  console.log("      If Treasury exposes a revoke/deauthorize function, consider");
  console.log("      calling it manually against the OLD Marketplace address.");

  if (ammPoolAddress) {
    await marketplace.setAMMPool(ammPoolAddress);
    console.log("   ✅ Existing AMMPool wired into new Marketplace");
    await marketplace.setAMMThreshold(100);
    console.log("   ✅ AMM threshold set: ≤100 credits → AMM, >100 → Order Book");
  } else {
    console.log("   ⚠️  AMM_POOL_ADDRESS not set — skipped AMM wiring. Run");
    console.log("      marketplace.setAMMPool(<address>) manually if you use one.");
  }

  // ── Save deployment record ─────────────────────────────────────────────
  const timestamp      = Date.now();
  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir);

  const deploymentData = {
    network,
    chainId: chainId.toString(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    action: 'marketplace-v2-redeploy',
    newMarketplaceAddress,
    reused: {
      CarbonCreditToken: creditTokenAddress,
      KYCRegistry: kycRegistryAddress,
      Treasury: treasuryAddress,
      AMMPool: ammPoolAddress,
    },
    signerWallet,
  };

  fs.writeFileSync(
    path.join(deploymentsDir, `${network}_marketplace-v2_${timestamp}.json`),
    JSON.stringify(deploymentData, null, 2)
  );
  console.log(`\n📁 Saved deployment record: deployments/${network}_marketplace-v2_${timestamp}.json`);

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log("");
  console.log("══════════════════════════════════════════════════════");
  console.log("🎉 MARKETPLACE V2 REDEPLOYED");
  console.log("══════════════════════════════════════════════════════");
  const link = explorer ? `\n  ${explorer}/${newMarketplaceAddress}` : '';
  console.log(`New Marketplace address: ${newMarketplaceAddress}${link}`);
  console.log("");
  console.log("UPDATE THESE IN YOUR BACKEND .env:");
  console.log(`MARKETPLACE_ADDRESS=${newMarketplaceAddress}`);
  console.log("");
  console.log("UPDATE THIS IN YOUR FRONTEND .env:");
  console.log(`REACT_APP_MARKETPLACE_ADDRESS=${newMarketplaceAddress}`);
  console.log("══════════════════════════════════════════════════════");

  if (network !== 'localhost') {
    console.log("\n📋 To verify on explorer, run:");
    console.log(
      `npx hardhat verify --network ${network} ${newMarketplaceAddress} ` +
      `${deployer.address} ${creditTokenAddress} ${kycRegistryAddress} ${treasuryAddress} ${signerWallet}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});