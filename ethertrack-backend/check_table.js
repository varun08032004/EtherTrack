require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function checkTable() {
  // Check if table exists
  const tableCheck = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'carbon_asset_passports'
    )
  `);
  console.log('Table exists:', tableCheck.rows[0].exists);
  
  // Check columns
  const cols = await pool.query(`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'carbon_asset_passports'
    ORDER BY ordinal_position
  `);
  console.log('Columns:', cols.rows);
  
  // Check constraints
  const constraints = await pool.query(`
    SELECT conname, contype 
    FROM pg_constraint 
    WHERE conrelid = 'carbon_asset_passports'::regclass
  `);
  console.log('Constraints:', constraints.rows);
  
  // Check schema_migrations
  const migrations = await pool.query(`
    SELECT version FROM schema_migrations WHERE version = '017'
  `);
  console.log('Migration 017 applied:', migrations.rows.length > 0);
  
  await pool.end();
}

checkTable().catch(e => console.error(e));