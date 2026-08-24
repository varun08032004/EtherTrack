require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-backend\\.env' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Exact ledger query from cacheStrategy
pool.query(`
  SELECT ll.id, cb.project_name, cb.project_location, cb.country, cb.standard,
          cb.project_type, cb.developer, cb.vintage_year, cb.registry_serial,
          ll.amount_remaining AS amount,
          ll.price_per_credit_inr, 0 AS last_traded_price_inr, cb.token_id,
          0 AS vintageDiscount,
          0 AS totalRetired,
          EXTRACT(EPOCH FROM ll.expires_at)::bigint AS expiresAt,
          u.wallet_address AS seller, ll.updated_at,
          'ledger' AS listing_type,
          ll.id AS listing_id
   FROM ledger_listings ll
   JOIN carbon_batches cb ON cb.token_id = ll.token_id AND cb.user_id = ll.seller_id
   JOIN users u ON u.id = ll.seller_id
   WHERE ll.active = TRUE
     AND ll.amount_remaining > 0
     AND (ll.expires_at IS NULL OR ll.expires_at > NOW())
`)
  .then(r => {
    console.log('Ledger listings (exact query):', r.rows.length);
    console.table(r.rows);
  })
  .catch(console.error)
  .finally(() => pool.end());