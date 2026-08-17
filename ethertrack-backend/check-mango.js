// check-mango.js
const { Pool } = require('pg');
require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-backend\\.env' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  try {
    const result = await pool.query(
      `SELECT id, project_name, admin_status, token_id, custody_model, user_id, quantity, registry_serial 
       FROM carbon_batches WHERE project_name ILIKE '%mango%'`
    );
    console.table(result.rows);
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}

main();