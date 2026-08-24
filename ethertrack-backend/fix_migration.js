require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function fixMigration() {
  try {
    // Mark migration 017 as applied
    await pool.query(`
      INSERT INTO schema_migrations (version, name, checksum, applied_at)
      VALUES ('017', 'carbon_asset_passports', 'placeholder', NOW())
      ON CONFLICT (version) DO NOTHING
    `);
    console.log('Migration 017 marked as applied');
    
    // Verify
    const { rows } = await pool.query(`SELECT version FROM schema_migrations WHERE version = '017'`);
    console.log('Migration 017 now applied:', rows.length > 0);
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
}

fixMigration();