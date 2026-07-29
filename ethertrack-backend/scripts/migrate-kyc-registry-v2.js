// scripts/migrate-kyc-registry-v2.js
// ─────────────────────────────────────────────────────────────────────────────
// One-off backfill after redeploying KYCRegistry with the new identity-keyed
// scheme (records keyed by bytes32 userIdHash instead of wallet address —
// see contracts/KYCRegistry.sol).
//
// The new contract starts EMPTY — none of your previously on-chain-verified
// wallets exist in it. This script re-registers every DB-verified user
// under the new scheme:
//   1. For every user with kyc_verified = TRUE:
//        → call verifyKYC(userIdHash, kycDataHash)   [always — no wallet needed]
//   2. If that user also has a wallet_address bound:
//        → call linkWallet(userIdHash, wallet)
//
// Runs SEQUENTIALLY (not in parallel) — every call goes through the same
// minter wallet, and concurrent txs from one wallet race on nonce and fail.
//
// Usage:
//   node scripts/migrate-kyc-registry-v2.js            # dry run — logs plan only
//   node scripts/migrate-kyc-registry-v2.js --execute   # actually sends txs
//
// Requires the SAME .env as the rest of the backend, pointed at the NEW
// KYCRegistry address:
//   DATABASE_URL, ALCHEMY_RPC, MINTER_PRIVATE_KEY,
//   KYC_REGISTRY_ADDRESS   ← must be the freshly deployed contract
//   CARBON_CREDIT_TOKEN_ADDRESS
//
// BEFORE running with --execute:
//   1. Deploy the new KYCRegistry.sol (npx hardhat run scripts/deploy.js ...
//      or a targeted redeploy script — KYCRegistry only, other contracts
//      don't need redeploying since their KYC calls are unchanged).
//   2. Call addKYCOperator(minterWalletAddress) on the NEW contract as its
//      owner — the fresh contract does not inherit operator status from
//      the old one.
//   3. Update KYC_REGISTRY_ADDRESS in .env to the new contract address.
//   4. Update KYC_REGISTRY_ADDRESS wherever else it's referenced (frontend
//      contracts.config.js, Marketplace/EmissionRegistry/AMMPool/
//      CarbonCreditToken constructor args if THEY also need pointing at
//      the new registry — check your deploy script for how kycRegistry is
//      wired into each).
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();
const { safeQuery: query, shutdown } = require('../db/pool');
const { verifyKYCOnChain, linkWalletOnChain } = require('../services/minter');

const EXECUTE = process.argv.includes('--execute');

async function main() {
  console.log(EXECUTE ? '🚀 EXECUTING migration (real transactions)' : '🧪 DRY RUN — no transactions will be sent (pass --execute to run for real)');
  console.log('');

  const { rows: users } = await query(`
    SELECT id, email, full_name, wallet_address, kyc_data_hash, kyc_verified_at
    FROM users
    WHERE kyc_verified = TRUE
    ORDER BY kyc_verified_at ASC NULLS LAST
  `);

  if (!users.length) {
    console.log('No KYC-verified users found. Nothing to migrate.');
    await shutdown();
    return;
  }

  console.log(`Found ${users.length} KYC-verified user(s) to migrate.\n`);

  let regOk = 0, regSkipped = 0, regFailed = 0;
  let linkOk = 0, linkSkipped = 0, linkFailed = 0, linkNotApplicable = 0;
  const failures = [];

  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const progress = `[${i + 1}/${users.length}]`;
    console.log(`${progress} ${u.email} (${u.id})${u.wallet_address ? ` — wallet ${u.wallet_address}` : ' — no wallet'}`);

    if (!EXECUTE) {
      console.log(`   would call verifyKYC(userIdHash, ${u.kyc_data_hash ? 'dataHash' : 'fallback hash'})`);
      if (u.wallet_address) console.log(`   would call linkWallet(userIdHash, ${u.wallet_address})`);
      continue;
    }

    try {
      const r = await verifyKYCOnChain(u.id, u.kyc_data_hash);
      if (r.skipped) { console.log('   ℹ️  already registered on-chain'); regSkipped++; }
      else { console.log(`   ✅ registered — TX: ${r.txHash}`); regOk++; }
    } catch (e) {
      console.error(`   ❌ registration failed: ${e.message}`);
      regFailed++;
      failures.push({ userId: u.id, email: u.email, stage: 'register', error: e.message });
      continue; // no point trying to link a wallet if registration itself failed
    }

    if (u.wallet_address) {
      try {
        const r = await linkWalletOnChain(u.id, u.wallet_address);
        if (r.skipped) { console.log('   ℹ️  wallet already linked'); linkSkipped++; }
        else { console.log(`   ✅ wallet linked — TX: ${r.txHash}`); linkOk++; }
      } catch (e) {
        console.error(`   ❌ wallet link failed: ${e.message}`);
        linkFailed++;
        failures.push({ userId: u.id, email: u.email, stage: 'link', error: e.message });
      }
    } else {
      linkNotApplicable++;
    }
  }

  console.log('\n────────────────────────────────────────');
  console.log(EXECUTE ? 'Migration complete.' : 'Dry run complete — re-run with --execute to apply.');
  console.log(`Registration: ✅ ${regOk} done · ℹ️ ${regSkipped} already ok · ❌ ${regFailed} failed`);
  console.log(`Wallet link:  ✅ ${linkOk} done · ℹ️ ${linkSkipped} already ok · ⏭  ${linkNotApplicable} no wallet · ❌ ${linkFailed} failed`);

  if (failures.length) {
    console.log('\n⚠️  Failures (re-run the script to retry — already-succeeded rows are skipped automatically):');
    for (const f of failures) console.log(`   - ${f.email} (${f.userId}) [${f.stage}]: ${f.error}`);
  }

  await shutdown();
}

main().catch(async (e) => {
  console.error('Fatal error:', e);
  await shutdown();
  process.exit(1);
});