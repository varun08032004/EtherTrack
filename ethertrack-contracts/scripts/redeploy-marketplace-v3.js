// scripts/redeploy-marketplace-v3.js
// ─────────────────────────────────────────────────────────────────────────────
// Redeploys ONLY the Marketplace contract (v3 — adds listCreditFor,
// cancelListingFor, settleINRTrade for operator-executed/MetaMask-free
// trading), reusing your EXISTING CarbonCreditToken, KYCRegistry, Treasury,
// and AMMPool addresses. Mirrors redeploy-marketplace-v2.js exactly — same
// constructor signature, same signerWallet concept, same wiring steps.
//
// SAFE: does not touch CarbonCreditToken or its state. Your existing minted
// credits, balances, and KYC verifications are untouched.
//
// BEFORE RUNNING — same env vars as v2:
//   CARBON_CREDIT_TOKEN_ADDRESS, KYC_REGISTRY_ADDRESS, TREASURY_ADDRESS,
//   AMM_POOL_ADDRESS (optional), CHAIN_SIGNER_PRIVATE_KEY (or SIGNER_WALLET)
//
// The signerWallet here MUST be the same wallet as MINTER_PRIVATE_KEY in
// ethertrack-backend/.env — that's the wallet that will call
// listCreditFor/cancelListingFor/settleINRTrade via services/minter.js.
//
// CAVEAT: any listings/orders on the OLD Marketplace (v2) do not carry over —
// same caveat as the v2 script.
//
// Run: npx hardhat run scripts/redeploy-marketplace-v3.js --network sepolia
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

  console.log("🔁 EtherTrack Marketplace v3 — targeted redeploy");
  console.log("   (adds listCreditFor / cancelListingFor / settleINRTrade)");
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

  // ── Signer wallet — MUST match MINTER_PRIVATE_KEY used by services/minter.js.
  // This wallet is what calls listCreditFor/cancelListingFor/settleINRTrade,
  // so it MUST be the same wallet as the backend's operator functions use.
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
  console.log("⚠️  IMPORTANT: confirm this signerWallet's private key matches");
  console.log("   MINTER_PRIVATE_KEY in ethertrack-backend/.env — services/minter.js's");
  console.log("   listCreditForOnChain/cancelListingForOnChain/settleINRTradeOnChain");
  console.log("   will sign with that key and it must match this address, or every");
  console.log("   operator-only call will revert with 'Marketplace: not signer'.\n");

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

  // ── Deploy Marketplace v3 ───────────────────────────────────────────────
  console.log("🚀 Deploying Marketplace v3...");
  const Marketplace = await hre.ethers.getContractFactory("Marketplace");
  const marketplace = await Marketplace.deploy(
    deployer.address,     // initialOwner
    creditTokenAddress,   // creditTokenAddress
    kycRegistryAddress,   // kycRegistryAddress
    treasuryAddress,      // treasuryAddress
    signerWallet          // _signerWallet
  );
  await marketplace.waitForDeployment();
  const newMarketplaceAddress = await marketplace.getAddress();
  console.log(`   ✅ Marketplace v3 deployed: ${newMarketplaceAddress}`);

  // ── Post-deployment wiring ─────────────────────────────────────────────
  console.log("\n⚙️  Post-deployment configuration...");

  const treasury = await hre.ethers.getContractAt("Treasury", treasuryAddress);
  await treasury.authorizeDepositor(newMarketplaceAddress);
  console.log("   ✅ New Marketplace authorized as Treasury depositor");
  console.log("   ⚠️  Old Marketplace (v2)'s depositor authorization was NOT revoked.");
  console.log("      Consider revoking it manually if Treasury exposes that function.");

  if (ammPoolAddress) {
    await marketplace.setAMMPool(ammPoolAddress);
    console.log("   ✅ Existing AMMPool wired into new Marketplace");
    await marketplace.setAMMThreshold(100);
    console.log("   ✅ AMM threshold set: ≤100 credits → AMM, >100 → Order Book");
  } else {
    console.log("   ⚠️  AMM_POOL_ADDRESS not set — skipped AMM wiring.");
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
    action: 'marketplace-v3-redeploy',
    newMarketplaceAddress,
    newFunctions: ['listCreditFor', 'cancelListingFor', 'settleINRTrade'],
    reused: {
      CarbonCreditToken: creditTokenAddress,
      KYCRegistry: kycRegistryAddress,
      Treasury: treasuryAddress,
      AMMPool: ammPoolAddress,
    },
    signerWallet,
  };

  fs.writeFileSync(
    path.join(deploymentsDir, `${network}_marketplace-v3_${timestamp}.json`),
    JSON.stringify(deploymentData, null, 2)
  );
  console.log(`\n📁 Saved deployment record: deployments/${network}_marketplace-v3_${timestamp}.json`);

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log("");
  console.log("══════════════════════════════════════════════════════");
  console.log("🎉 MARKETPLACE V3 REDEPLOYED");
  console.log("══════════════════════════════════════════════════════");
  const link = explorer ? `\n  ${explorer}/${newMarketplaceAddress}` : '';
  console.log(`New Marketplace address: ${newMarketplaceAddress}${link}`);
  console.log("");
  console.log("UPDATE THESE IN YOUR BACKEND .env:");
  console.log(`MARKETPLACE_ADDRESS=${newMarketplaceAddress}`);
  console.log("");
  console.log("UPDATE THIS IN YOUR FRONTEND .env:");
  console.log(`REACT_APP_MARKETPLACE_ADDRESS=${newMarketplaceAddress}`);
  console.log("");
  console.log("NEXT STEP — sellers must approve the new Marketplace ONCE before");
  console.log("listCreditFor() can escrow their tokens on their behalf:");
  console.log(`  creditToken.setApprovalForAll("${newMarketplaceAddress}", true)`);
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