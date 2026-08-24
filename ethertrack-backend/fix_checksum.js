require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function fixChecksum() {
  try {
    // Calculate checksum of current migration file
    const migrationPath = path.join(__dirname, 'db', 'migrations', '017_carbon_asset_passports.sql');
    const content = fs.readFileSync(migrationPath, 'utf8');
    const checksum = crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
    
    console.log('New checksum:', checksum);
    
    // Update the checksum in schema_migrations
    await pool.query(`
      UPDATE schema_migrations 
      SET checksum = $1 
      WHERE version = '017'
    `, [checksum]);
    
    console.log('Checksum updated for migration 017');
    
    // Verify
    const { rows } = await pool.query(`SELECT version, checksum FROM schema_migrations WHERE version = '017'`);
    console.log('Verified:', rows[0]);
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
}

fixChecksum();