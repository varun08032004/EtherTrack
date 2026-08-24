require('dotenv').config();
const { pool } = require('./db/pool');

pool.query('SHOW search_path')
  .then(r => {
    console.log('Search path:', r.rows[0]);
    return pool.query('SELECT proname, pronamespace::regnamespace FROM pg_proc WHERE proname = \'uuid_generate_v4\'');
  })
  .then(r => {
    console.log('Function:', r.rows);
    return pool.query('SELECT uuid-ossp.uuid_generate_v4()');
  })
  .then(r => {
    console.log('UUID with schema:', r.rows[0]);
    process.exit(0);
  })
  .catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
  });