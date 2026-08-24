require('dotenv').config();
const { pool } = require('./db/pool');

pool.query('SELECT extensions.uuid_generate_v4()')
  .then(r => {
    console.log('UUID with schema:', r.rows[0]);
    process.exit(0);
  })
  .catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
  });