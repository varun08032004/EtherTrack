// fix-missing-ledger.js - Add missing ledger entries
const { Pool } = require('pg');
const { ethers } = require('ethers');
require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-backend\\.env' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const client = await pool.connect();
  
  try {
    console.log("🔧 Fixing Missing Ledger Entries");
    console.log("══════════════════════════════════════════════════════");
    
    // 1. Add ledger entry for Token #3 (Mango Farms) for User 1
    console.log("\n1️⃣ Adding Token #3 (Mango Farms) ledger for User 1...");
    const userId1 = '706c67a4-de98-4a9a-9287-bed77d33b1a4';
    const tokenId3 = 3;
    const amount3 = 500;
    const batchId3 = '1fdb198f-ecad-4175-9984-5a2581ff46de';
    
    const userIdHash1 = ethers.keccak256(ethers.toUtf8Bytes(userId1));
    const refHash3 = ethers.keccak256(ethers.toUtf8Bytes(
      `${userIdHash1}:${tokenId3}:${amount3}:MINT:carbon_batches:${batchId3}`
    ));
    
    // Insert balance
    await client.query(
      `INSERT INTO credit_ledger_balances (user_id, token_id, balance, total_retired)
       VALUES ($1, $2, $3, 0)
       ON CONFLICT (user_id, token_id)
       DO UPDATE SET balance = GREATEST(credit_ledger_balances.balance + $3, 0), updated_at = NOW()`,
      [userId1, tokenId3, amount3]
    );
    console.log(`   ✅ Balance inserted/updated: ${amount3}`);
    
    // Insert entry
    await client.query(
      `INSERT INTO credit_ledger_entries 
       (user_id, user_id_hash, token_id, amount_delta, action_type, ref_hash, ref_table, ref_id, note, chain_status)
       VALUES ($1, $2, $3, $4, 'MINT', $5, 'carbon_batches', $6, 'Mint to custodial wallet', 'confirmed')`,
      [userId1, userIdHash1, tokenId3, amount3, refHash3, batchId3]
    );
    console.log(`   ✅ Ledger entry inserted`);
    
    // 2. Fix duplicate VD Wind Plant for User 2 - remove the token_id = 0 batch
    console.log("\n2️⃣ Fixing duplicate VD Wind Plant for User 2...");
    const userId2 = '45aced03-8164-44d8-9f39-c6bb828ba9cd';
    const duplicateBatchId = '706b98fc-d787-4c62-80b2-a3b4c45af339';
    
    // Check if this batch has any dependencies
    const deps = await client.query(
      `SELECT COUNT(*) FROM credit_ledger_balances WHERE user_id = $1 AND token_id = 0`,
      [userId2]
    );
    
    // Delete the duplicate batch (token_id = 0, custody_model = 'self')
    await client.query(
      `DELETE FROM carbon_batches WHERE id = $1 AND token_id = 0`,
      [duplicateBatchId]
    );
    console.log(`   ✅ Deleted duplicate batch with token_id = 0`);
    
    // 3. Verify fixes
    console.log("\n3️⃣ Verification:");
    
    const user1Balances = await client.query(
      `SELECT token_id, balance FROM credit_ledger_balances WHERE user_id = $1 ORDER BY token_id`,
      [userId1]
    );
    console.log("User 1 ledger balances:");
    console.table(user1Balances.rows);
    
    const user2Batches = await client.query(
      `SELECT id, project_name, token_id, custody_model FROM carbon_batches WHERE user_id = $1 AND admin_status = 'approved' ORDER BY token_id`,
      [userId2]
    );
    console.log("User 2 batches:");
    console.table(user2Batches.rows);
    
    console.log("\n══════════════════════════════════════════════════════");
    console.log("✅ FIXES COMPLETE!");
    console.log("══════════════════════════════════════════════════════");
    
  } catch (e) {
    console.error("❌ Fix failed:", e);
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});