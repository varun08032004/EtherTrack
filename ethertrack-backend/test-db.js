require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-backend\\.env' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

pool.query(`
  SELECT ll.id, ll.token_id, ll.amount_remaining, ll.active, cb.project_name
  FROM ledger_listings ll
  JOIN carbon_batches cb ON cb.token_id = ll.token_id AND cb.user_id = ll.seller_id
  WHERE ll.active = TRUE AND ll.amount_remaining > 0
`)
  .then(r => {
    console.log('Ledger listings:', r.rows.length);
    console.table(r.rows);
  })
  .catch(console.error)
  .finally(() => pool.end());