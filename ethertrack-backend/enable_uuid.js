require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')
  .then(() => {
    console.log('Extension created');
    return pool.query('SELECT uuid_generate_v4()');
  })
  .then(r => {
    console.log('UUID:', r.rows[0]);
    pool.end();
  })
  .catch(e => {
    console.error('Error:', e.message);
    pool.end();
  });