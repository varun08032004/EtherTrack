require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { pool } = require('./pool');

async function migrate() {
  console.log('Running EtherTrack DB migration...');
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('✅ Schema applied successfully');
  } catch (e) {
    console.error('Migration error:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
