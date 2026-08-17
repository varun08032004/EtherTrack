// update-db-post-migration.js
// Update database records after migration
// Run: node update-db-post-migration.js

require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-backend\\.env' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const client = await pool.connect();
  
  try {
    console.log("🗄️  Updating Database Post-Migration");
    console.log("══════════════════════════════════════════════════════");
    
    // First, check the actual columns in carbon_batches
    const { rows: columns } = await client.query(
      `SELECT column_name FROM information_schema.columns 
       WHERE table_name = 'carbon_batches' AND table_schema = 'public'`
    );
    console.log("carbon_batches columns:", columns.map(c => c.column_name).join(', '));
    
    // Find batches with token_id 1 and 2
    const { rows: batches } = await client.query(
      `SELECT id, user_id, project_name, token_id, custody_model 
       FROM carbon_batches 
       WHERE token_id IN (1, 2)`
    );
    
    console.log(`\nFound ${batches.length} batches to update:`);
    for (const b of batches) {
      console.log(`  Batch ${b.id}: ${b.project_name} (Token #${b.token_id}), Current custody_model: ${b.custody_model}`);
    }
    
    // Update custody_model to 'pooled' for both batches
    for (const batch of batches) {
      await client.query(
        `UPDATE carbon_batches 
         SET custody_model = 'pooled', updated_at = NOW() 
         WHERE id = $1`,
        [batch.id]
      );
      console.log(`  ✅ Updated batch ${batch.id} custody_model -> 'pooled'`);
    }
    
    // Get user IDs for credit ledger updates
    const userIds = [...new Set(batches.map(b => b.user_id))];
    console.log(`\nAffected user IDs: ${userIds.join(', ')}`);
    
    // For each user and token, ensure credit_ledger_balances has correct entry
    for (const batch of batches) {
      const { rows: existing } = await client.query(
        `SELECT balance FROM credit_ledger_balances WHERE user_id = $1 AND token_id = $2`,
        [batch.user_id, batch.token_id]
      );
      
      if (existing.length > 0) {
        // Update existing balance to 3000
        await client.query(
          `UPDATE credit_ledger_balances 
           SET balance = 3000, updated_at = NOW() 
           WHERE user_id = $1 AND token_id = $2`,
          [batch.user_id, batch.token_id]
        );
        console.log(`  ✅ Updated credit_ledger_balances for user ${batch.user_id}, token ${batch.token_id} -> 3000`);
      } else {
        // Insert new balance
        await client.query(
          `INSERT INTO credit_ledger_balances (user_id, token_id, balance, total_retired)
           VALUES ($1, $2, 3000, 0)`,
          [batch.user_id, batch.token_id]
        );
        console.log(`  ✅ Inserted credit_ledger_balances for user ${batch.user_id}, token ${batch.token_id} -> 3000`);
      }
      
      // Add migration entry to credit_ledger_entries
      const { ethers } = require('ethers');
      const userIdHash = ethers.keccak256(ethers.toUtf8Bytes(batch.user_id));
      const refHash = ethers.keccak256(ethers.toUtf8Bytes(
        `${userIdHash}:${batch.token_id}:3000:MINT:carbon_batches:${batch.id}`
      ));
      
      await client.query(
        `INSERT INTO credit_ledger_entries 
         (user_id, user_id_hash, token_id, amount_delta, action_type, ref_hash, ref_table, ref_id, note, chain_status)
         VALUES ($1, $2, $3, 3000, 'MINT', $4, 'carbon_batches', $5, 'Migration to custodial wallet', 'confirmed')`,
        [batch.user_id, userIdHash, batch.token_id, refHash, batch.id]
      );
      console.log(`  ✅ Added migration entry to credit_ledger_entries for batch ${batch.id}`);
    }
    
    // Verify updates
    console.log("\n📊 Verification:");
    const { rows: verifyBatches } = await client.query(
      `SELECT id, project_name, token_id, custody_model FROM carbon_batches WHERE token_id IN (1, 2)`
    );
    for (const b of verifyBatches) {
      console.log(`  Batch ${b.id}: ${b.project_name} (Token #${b.token_id}) - custody_model: ${b.custody_model}`);
    }
    
    const { rows: verifyLedger } = await client.query(
      `SELECT user_id, token_id, balance FROM credit_ledger_balances WHERE token_id IN (1, 2)`
    );
    for (const l of verifyLedger) {
      console.log(`  Ledger: user ${l.user_id}, token ${l.token_id} - balance: ${l.balance}`);
    }
    
    console.log("\n══════════════════════════════════════════════════════");
    console.log("✅ DATABASE UPDATE COMPLETE!");
    console.log("══════════════════════════════════════════════════════");
    
  } catch (e) {
    console.error("❌ Database update failed:", e);
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