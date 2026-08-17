// check-enums.js
const { Pool } = require('pg');
require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-backend\\.env' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  try {
    const result = await pool.query(
      `SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'batch_status')`
    );
    console.table(result.rows);
    
    const result2 = await pool.query(
      `SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'admin_status')`
    );
    console.table(result2.rows);
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}

main();