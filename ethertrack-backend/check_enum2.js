require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

pool.query(`
  SELECT typname, typcategory FROM pg_type WHERE typname IN ('carbon_instrument_type', 'asset_passport_state', 'eligibility_scheme')
`)
  .then(r => {
    console.log('Enums:', r.rows);
    return pool.query(`
      SELECT * FROM information_schema.columns 
      WHERE table_name = 'carbon_asset_passports' AND column_name IN ('instrument_type', 'state')
    `);
  })
  .then(r => {
    console.log('Columns:', r.rows);
    pool.end();
  })
  .catch(e => {
    console.error('Error:', e.message);
    pool.end();
  });