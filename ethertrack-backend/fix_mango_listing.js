require('dotenv').config();
const { safeQuery: query } = require('./db/pool.js');

async function fixListing() {
  // Check current state
  const listings = await query(`
    SELECT * FROM ledger_listings 
    WHERE seller_id = '706c67a4-de98-4a9a-9287-bed77d33b1a4' 
    AND token_id = 3
  `);
  console.log('Current listings:', listings.rows);

  // Check trade
  const trade = await query(`
    SELECT * FROM trades 
    WHERE seller_id = '706c67a4-de98-4a9a-9287-bed77d33b1a4' 
    AND token_id = 3
    AND status = 'completed'
    ORDER BY created_at DESC LIMIT 1
  `);
  console.log('Trade:', trade.rows[0]);

  if (listings.rows.length > 0) {
    const activeListing = listings.rows.find(l => l.active);
    if (activeListing) {
      console.log('Deactivating active listing:', activeListing.id);
      await query(`
        UPDATE ledger_listings 
        SET active = FALSE, amount_remaining = 0, updated_at = NOW()
        WHERE id = $1
      `, [activeListing.id]);
      console.log('Listing deactivated');
    } else {
      console.log('No active listings found');
    }
  }

  process.exit(0);
}

fixListing().catch(console.error).finally(() => process.exit(1));