// Backfill script for custody_model column
// Run once after migration to set custody_model for existing records

require('dotenv').config();
const { pool, safeQuery: query } = require('../db/pool');

async function backfillCustodyModel() {
  console.log('Starting custody_model backfill...');

  try {
    // For each carbon_batch, determine custody model based on whether the developer (user) had a wallet_address at mint time
    // Since we can't know for certain at this point, we use the current state as a proxy:
    // - If the user currently has a wallet_address, assume self-custody
    // - If the user has no wallet_address, assume pooled custody
    // - For batches with token_id but no wallet_address on user, mark as pooled

    const { rows: batches } = await query(`
      SELECT cb.id, cb.token_id, cb.developer_id, u.wallet_address
      FROM carbon_batches cb
      JOIN users u ON u.id = cb.developer_id
      WHERE cb.custody_model IS NULL
    `);

    console.log(`Found ${batches.length} batches to backfill`);

    let pooled = 0;
    let self = 0;

    for (const batch of batches) {
      const custodyModel = batch.wallet_address ? 'self' : 'pooled';
      const status = batch.token_id != null && custodyModel === 'pooled' ? 'tokenised' : batch.status;
      
      await query(
        `UPDATE carbon_batches SET custody_model = $1, status = $2 WHERE id = $3`,
        [custodyModel, status, batch.id]
      );

      if (custodyModel === 'pooled') pooled++;
      else self++;

      if ((pooled + self) % 100 === 0) {
        console.log(`  Processed ${pooled + self}/${batches.length}...`);
      }
    }

    console.log(`Backfill complete:`);
    console.log(`  Pooled custody: ${pooled}`);
    console.log(`  Self custody: ${self}`);
    console.log(`  Total: ${pooled + self}`);

  } catch (e) {
    console.error('Backfill failed:', e.message);
    throw e;
  } finally {
    await pool.end();
  }
}

backfillCustodyModel().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});