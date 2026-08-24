require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-backend\\.env' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Wallet-based listings
pool.query(`
  SELECT cb.id, cb.token_id, cb.available_credits, cb.listed_quantity, cb.listing_id_onchain, cb.project_name, cb.admin_status
  FROM carbon_batches cb
  WHERE cb.admin_status = 'approved'
    AND cb.available_credits > 0
    AND cb.listed_quantity > 0
    AND cb.listing_id_onchain IS NOT NULL
    AND cb.deleted_at IS NULL
    AND (cb.expires_at IS NULL OR cb.expires_at > NOW())
`)
  .then(r => {
    console.log('Wallet listings:', r.rows.length);
    console.table(r.rows);
  })
  .catch(console.error)
  .finally(() => pool.end());