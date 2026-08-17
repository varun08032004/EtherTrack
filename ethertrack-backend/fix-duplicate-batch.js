// fix-duplicate-batch.js - Handle duplicate batch by marking it as merged
const { Pool } = require('pg');
require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-backend\\.env' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const client = await pool.connect();
  
  try {
    console.log("🔧 Fixing Duplicate Batch");
    console.log("══════════════════════════════════════════════════════");
    
    const duplicateBatchId = '706b98fc-d787-4c62-80b2-a3b4c45af339';
    const userId2 = '45aced03-8164-44d8-9f39-c6bb828ba9cd';
    
    // Update the duplicate: set admin_status to 'rejected', add note, keep status as 'approved' or 'pending'
    await client.query(
      `UPDATE carbon_batches 
       SET token_id = NULL, 
           custody_model = 'pooled',
           admin_status = 'rejected',
           admin_notes = 'Duplicate of token_id=1 batch (7cc35e17-4b08-4e27-b56f-3f90bd915b4b) - merged',
           updated_at = NOW()
       WHERE id = $1`,
      [duplicateBatchId]
    );
    console.log(`   ✅ Marked duplicate batch as rejected/merged`);
    
    // Verify
    const batches = await client.query(
      `SELECT id, project_name, token_id, custody_model, status, admin_status, admin_notes
       FROM carbon_batches WHERE user_id = $1 ORDER BY created_at`,
      [userId2]
    );
    console.log("\nUser 2 batches after fix:");
    console.table(batches.rows);
    
    console.log("\n══════════════════════════════════════════════════════");
    console.log("✅ DUPLICATE FIXED!");
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