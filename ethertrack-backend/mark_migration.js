require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function markMigrationApplied() {
  try {
    // Check if migration 018 is already applied
    const { rows } = await pool.query(`SELECT version FROM schema_migrations WHERE version = '018'`);
    if (rows.length > 0) {
      console.log('Migration 018 already applied');
    } else {
      // Mark migration 018 as applied
      await pool.query(`
        INSERT INTO schema_migrations (version, name, checksum, applied_at)
        VALUES ('018', 'asset_eligibility_rules', 'placeholder', NOW())
        ON CONFLICT (version) DO NOTHING
      `);
      console.log('Marked migration 018 as applied');
    }
    
    // Also mark other migrations that were created manually
    const migrations = [
      { version: '019', name: 'asset_quality_scores' },
      { version: '020', name: 'asset_price_history' },
      { version: '021', name: 'registry_sync' },
      { version: '022', name: 'marketplace_listings' },
      { version: '023', name: 'marketplace_orders' },
      { version: '024', name: 'rfq_quotes' },
      { version: '025', name: 'otc_negotiations' },
      { version: '026', name: 'seller_onboarding' },
      { version: '027', name: 'institutional_api' },
      { version: '028', name: 'webhooks' },
    ];
    
    for (const m of migrations) {
      const { rows } = await pool.query(`SELECT version FROM schema_migrations WHERE version = $1`, [m.version]);
      if (rows.length === 0) {
        await pool.query(`
          INSERT INTO schema_migrations (version, name, checksum, applied_at)
          VALUES ($1, $2, 'manual', NOW())
          ON CONFLICT (version) DO NOTHING
        `, [m.version, m.name]);
        console.log(`Marked migration ${m.version} as applied`);
      }
    }
    
    console.log('All migrations marked as applied');
    await pool.end();
  } catch (e) {
    console.error('Error:', e.message);
    await pool.end();
  }
}

markMigrationApplied();