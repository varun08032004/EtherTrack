require('dotenv').config();
const { pool, safeQuery: query } = require('../db/pool');

async function diagnoseUser() {
  const email = 'deshmukhvarun2004@gmail.com';
  
  try {
    console.log(`=== DIAGNOSING USER: ${email} ===`);
    
    // 1. User record
    const { rows: users } = await query(`
      SELECT id, email, full_name, wallet_address, kyc_verified, kyc_status, 
             kyc_verified_at, kyc_expires_at, subscription_plan, plan_selected,
             company_name, role
      FROM users WHERE email = $1
    `, [email]);
    
    if (!users.length) {
      console.log('❌ USER NOT FOUND');
      return;
    }
    
    const user = users[0];
    console.log('\n👤 USER RECORD:');
    console.log(JSON.stringify(user, null, 2));
    
    // 2. Carbon batches
    const { rows: batches } = await query(`
      SELECT id, project_name, quantity, available_credits, listed_quantity, 
             retired_credits, token_id, custody_model, status, admin_status,
             wallet_address, developer_id, created_at
      FROM carbon_batches 
      WHERE developer_id = $1
      ORDER BY created_at DESC
    `, [user.id]);
    
    console.log(`\n📦 CARBON BATCHES (${batches.length}):`);
    batches.forEach(b => console.log(JSON.stringify(b, null, 2)));
    
    // 3. Ledger balances
    const { rows: ledger } = await query(`
      SELECT clb.token_id, clb.balance, clb.total_retired,
             cb.project_name, cb.custody_model
      FROM credit_ledger_balances clb
      LEFT JOIN carbon_batches cb ON cb.token_id = clb.token_id
      WHERE clb.user_id = $1
    `, [user.id]);
    
    console.log(`\n📊 LEDGER BALANCES (${ledger.length}):`);
    ledger.forEach(l => console.log(JSON.stringify(l, null, 2)));
    
    // 4. Ledger listings
    const { rows: listings } = await query(`
      SELECT id, token_id, amount, amount_remaining, price_per_credit_inr, 
             active, expires_at, created_at
      FROM ledger_listings
      WHERE seller_id = $1
    `, [user.id]);
    
    console.log(`\n🏪 LEDGER LISTINGS (${listings.length}):`);
    listings.forEach(l => console.log(JSON.stringify(l, null, 2)));
    
    // 5. KYC status check
    console.log('\n🔐 KYC STATUS CHECK:');
    console.log(`  kyc_verified: ${user.kyc_verified}`);
    console.log(`  kyc_status: ${user.kyc_status}`);
    console.log(`  kyc_verified_at: ${user.kyc_verified_at}`);
    console.log(`  kyc_expires_at: ${user.kyc_expires_at}`);
    console.log(`  wallet_address: ${user.wallet_address || 'NULL (no MetaMask)'}`);
    
    // 6. Plan check
    console.log('\n💳 PLAN STATUS:');
    console.log(`  subscription_plan: ${user.subscription_plan}`);
    console.log(`  plan_selected: ${user.plan_selected}`);
    
    // 7. Summary of issues
    console.log('\n⚠️  DIAGNOSIS:');
    
    const issues = [];
    
    if (!user.kyc_verified) issues.push('KYC not verified');
    if (user.kyc_status !== 'verified') issues.push(`KYC status: ${user.kyc_status}`);
    if (!user.plan_selected) issues.push('Plan not selected');
    if (user.subscription_plan === 'free') issues.push('On free plan (credits limit = 0)');
    if (!user.wallet_address) issues.push('No wallet bound (required for self-custody)');
    
    const pooledBatches = batches.filter(b => b.custody_model === 'pooled');
    const selfBatches = batches.filter(b => b.custody_model === 'self');
    
    if (selfBatches.length > 0 && !user.wallet_address) {
      issues.push(`${selfBatches.length} batch(es) marked 'self' custody but user has NO wallet_address`);
    }
    
    if (pooledBatches.length > 0) {
      console.log(`  ✅ ${pooledBatches.length} pooled-custody batch(es) - should work with ledger endpoints`);
    }
    
    if (issues.length === 0) {
      console.log('  ✅ No obvious issues found');
    } else {
      issues.forEach(i => console.log(`  ❌ ${i}`));
    }
    
    // 8. Market KYC check
    console.log('\n🏪 MARKET KYC CHECK:');
    console.log('  Market requires: KYC verified + wallet bound (for self-custody)');
    console.log('  For pooled custody: KYC verified only (no wallet needed)');
    
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
}

diagnoseUser().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});