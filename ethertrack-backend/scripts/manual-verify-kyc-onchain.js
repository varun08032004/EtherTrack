// scripts/manual-verify-kyc-onchain.js
// ─────────────────────────────────────────────────────────────────────────────
// One-off fix for accounts where KYC was approved in the DB (kyc_verified=TRUE)
// but the on-chain KYCRegistry.verifyKYC() call never fired — this happens
// when the user's wallet_address was NULL at the moment admin approved their
// KYC (see routes/admin.js `/kyc/:id/approve` — the on-chain call only runs
// inside `if (usr[0]?.wallet_address) { ... }`, silently skipped otherwise,
// with zero audit log entry and zero user-facing error).
//
// This script:
//   1. Looks up the user's kyc_data_hash from the DB by wallet address
//   2. Calls the SAME verifyKYCOnChain() used by the normal approval flow
//   3. Writes an audit log row so this shows up in admin history
//
// Usage:
//   node scripts/manual-verify-kyc-onchain.js 0xWALLET_ADDRESS
//
// Requires the same .env as the rest of the backend:
//   DATABASE_URL, ALCHEMY_RPC, MINTER_PRIVATE_KEY,
//   KYC_REGISTRY_ADDRESS, CARBON_CREDIT_TOKEN_ADDRESS
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();
const { safeQuery: query, shutdown } = require('../db/pool');
const { verifyKYCOnChain } = require('../services/minter');

async function main() {
  const wallet = process.argv[2];
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    console.error('❌ Usage: node scripts/manual-verify-kyc-onchain.js 0xWalletAddress');
    process.exit(1);
  }

  console.log(`🔍 Looking up user for wallet ${wallet}...`);
  const { rows } = await query(
    `SELECT id, email, full_name, kyc_status, kyc_verified, kyc_data_hash
     FROM users
     WHERE wallet_address ILIKE $1`,
    [wallet]
  );

  if (!rows.length) {
    console.error(`❌ No user found with wallet_address = ${wallet}`);
    process.exit(1);
  }

  const user = rows[0];
  console.log(`   User: ${user.email} (${user.id})`);
  console.log(`   DB kyc_status: ${user.kyc_status} | kyc_verified: ${user.kyc_verified}`);

  if (!user.kyc_verified) {
    console.error('❌ This user is not marked kyc_verified in the DB. Approve their KYC first.');
    process.exit(1);
  }

  if (!user.kyc_data_hash) {
    console.warn('⚠️  No kyc_data_hash stored — will fall back to a generic hash inside verifyKYCOnChain().');
  }

  try {
    console.log('⛓  Calling verifyKYCOnChain()...');
    const result = await verifyKYCOnChain(wallet, user.kyc_data_hash);

    if (result.skipped) {
      console.log('ℹ️  Wallet is ALREADY verified on-chain — nothing to do.');
      console.log('   (If you are still seeing "Wallet not KYC verified" reverts, the');
      console.log('    problem is elsewhere — e.g. wrong contract address, wrong network,');
      console.log('    or KYCRegistry address mismatch between contracts. Let me know and');
      console.log('    we will dig into that instead.)');
    } else {
      console.log(`✅ On-chain KYC registered successfully!`);
      console.log(`   TX Hash: ${result.txHash}`);
      console.log(`   Block:   ${result.blockNumber}`);

      // Log it so it shows up in your admin audit trail, matching the normal flow
      await query(
        `INSERT INTO admin_audit_log (admin_id, action, target_user_id, details)
         VALUES ($1, $2, $3, $4)`,
        [user.id, 'KYC_ONCHAIN_REGISTERED_MANUAL', user.id, `Manual fix — TX: ${result.txHash}`]
      );
      console.log('   📝 Audit log entry written.');
    }
  } catch (err) {
    console.error('❌ verifyKYCOnChain failed:', err.message);
    console.error('');
    console.error('Common causes:');
    console.error('  - Minter wallet is not registered as a KYC operator on KYCRegistry');
    console.error('    (fix: call kycRegistry.addKYCOperator(<minterAddress>) as the owner)');
    console.error('  - Minter wallet has insufficient ETH/MATIC for gas');
    console.error('  - ALCHEMY_RPC points to the wrong network');
    process.exit(1);
  }

  await shutdown();
}

main().catch(async (err) => {
  console.error('Script failed:', err);
  await shutdown().catch(() => {});
  process.exit(1);
});