require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-backend\\.env' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

pool.query(`
  SELECT id, email, full_name, kyc_status, kyc_verified, wallet_address, subscription_plan, plan_selected
  FROM users WHERE id = '706c67a4-de98-4a9a-9287-bed77d33b1a4'
`)
  .then(r => console.table(r.rows))
  .catch(console.error)
  .finally(() => pool.end());