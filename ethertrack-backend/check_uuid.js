require('dotenv').config();
const { pool } = require('./db/pool');

pool.query('SELECT * FROM pg_extension WHERE extname = \'uuid-ossp\'')
  .then(r => {
    console.log('Extension:', r.rows);
    return pool.query('SELECT uuid_generate_v4()');
  })
  .then(r => {
    console.log('UUID:', r.rows[0]);
    process.exit(0);
  })
  .catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
  });