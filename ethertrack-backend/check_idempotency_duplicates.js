const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
  // Check wallet_transactions duplicates
  const wt = await pool.query(`
    SELECT user_id, idempotency_key, count(*) as cnt
    FROM wallet_transactions
    WHERE idempotency_key IS NOT NULL
    GROUP BY user_id, idempotency_key
    HAVING count(*) > 1
  `);
  console.log('wallet_transactions duplicates:', wt.rows.length);
  if (wt.rows.length > 0) console.log(wt.rows);

  // Check trades duplicates
  const tr = await pool.query(`
    SELECT buyer_id, idempotency_key, count(*) as cnt
    FROM trades
    WHERE idempotency_key IS NOT NULL AND status = 'completed'
    GROUP BY buyer_id, idempotency_key
    HAVING count(*) > 1
  `);
  console.log('trades duplicates:', tr.rows.length);
  if (tr.rows.length > 0) console.log(tr.rows);

  // Check subscription_payments duplicates
  const sp = await pool.query(`
    SELECT user_id, idempotency_key, count(*) as cnt
    FROM subscription_payments
    WHERE idempotency_key IS NOT NULL
    GROUP BY user_id, idempotency_key
    HAVING count(*) > 1
  `);
  console.log('subscription_payments duplicates:', sp.rows.length);
  if (sp.rows.length > 0) console.log(sp.rows);

  // Check kyc_idempotency_keys duplicates
  const kyc = await pool.query(`
    SELECT key, user_id, count(*) as cnt
    FROM kyc_idempotency_keys
    GROUP BY key, user_id
    HAVING count(*) > 1
  `);
  console.log('kyc_idempotency_keys duplicates:', kyc.rows.length);
  if (kyc.rows.length > 0) console.log(kyc.rows);

  await pool.end();
}
check().catch(e => { console.error(e); process.exit(1); });