// check-users.js
const { Pool } = require('pg');
require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-backend\\.env' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  try {
    console.log("=== users ===");
    const users = await pool.query(
      `SELECT id, email, full_name, wallet_address FROM users WHERE id IN ('45aced03-8164-44d8-9f39-c6bb828ba9cd', '706c67a4-de98-4a9a-9287-bed77d33b1a4')`
    );
    console.table(users.rows);
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}

main();