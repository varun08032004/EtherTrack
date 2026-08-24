require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function fixAllChecksums() {
  try {
    const migrations = [
      { version: '018', file: '018_asset_eligibility_rules.sql' },
      { version: '019', file: '019_asset_quality_scores.sql' },
      { version: '020', file: '020_asset_price_history.sql' },
      { version: '021', file: '021_registry_sync.sql' },
      { version: '022', file: '022_marketplace_listings.sql' },
      { version: '023', file: '023_marketplace_orders.sql' },
      { version: '024', file: '024_rfq_quotes.sql' },
      { version: '025', file: '025_otc_negotiations.sql' },
      { version: '026', file: '026_seller_onboarding.sql' },
      { version: '027', file: '027_institutional_api.sql' },
      { version: '028', file: '028_webhooks.sql' },
    ];
    
    for (const m of migrations) {
      const migrationPath = path.join(__dirname, 'db', 'migrations', m.file);
      const content = fs.readFileSync(migrationPath, 'utf8');
      const checksum = crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
      
      console.log(`Updating checksum for ${m.version} (${m.file}): ${checksum}`);
      
      await pool.query(`
        UPDATE schema_migrations 
        SET checksum = $1 
        WHERE version = $2
      `, [checksum, m.version]);
      
      console.log(`Updated checksum for ${m.version}: ${checksum}`);
    }
    
    // Verify
    const { rows } = await pool.query(`SELECT version, checksum FROM schema_migrations WHERE version >= '018' AND version <= '028' ORDER BY version`);
    console.log('\nVerified checksums:');
    rows.forEach(r => console.log(`${r.version}: ${r.checksum}`));
    
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
}

fixAllChecksums();