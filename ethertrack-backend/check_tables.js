const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('wallet_transactions', 'subscription_payments', 'kyc_idempotency_keys', 'trades')`)
  .then(r => console.log(r.rows))
  .catch(e => console.error(e.message))
  .finally(() => pool.end());