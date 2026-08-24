require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

pool.query(`
  SELECT typname FROM pg_type WHERE typname IN ('carbon_instrument_type', 'asset_passport_state', 'eligibility_scheme')
`)
  .then(r => {
    console.log('Enums:', r.rows);
    return pool.query(`
      SELECT typname FROM pg_type WHERE typname IN ('carbon_instrument_type', 'asset_passport_state', 'eligibility_scheme')
    `);
  })
  .then(r => {
    console.log('Enums found:', r.rows.map(r => r.typname));
    pool.end();
  })
  .catch(e => {
    console.error('Error:', e.message);
    pool.end();
  });