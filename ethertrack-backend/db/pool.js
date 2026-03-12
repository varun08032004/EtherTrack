const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  // Supabase requires SSL
  ssl: {
    rejectUnauthorized: false
  },

  // keep pool small because Supabase already pools connections
  max: 5,

  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

// Catch unexpected pool errors
pool.on('error', (err) => {
  console.error('Unexpected DB pool error:', err);
});


/* ------------------------------------------------
   Safe query with retry (handles Supabase cold start)
------------------------------------------------ */

const safeQuery = async (text, params = [], retries = 3) => {
  try {
    return await pool.query(text, params);
  } catch (err) {

    if (retries > 0) {
      console.log("DB retry attempt...", 4 - retries);

      await new Promise(resolve => setTimeout(resolve, 1000));

      return safeQuery(text, params, retries - 1);
    }

    throw err;
  }
};


/* ------------------------------------------------
   Get client for manual transactions
------------------------------------------------ */

const getClient = () => pool.connect();


/* ------------------------------------------------
   Transaction wrapper
------------------------------------------------ */

const withTransaction = async (callback) => {

  const client = await pool.connect();

  try {

    await client.query('BEGIN');

    const result = await callback(client);

    await client.query('COMMIT');

    return result;

  } catch (err) {

    await client.query('ROLLBACK');

    throw err;

  } finally {

    client.release();

  }
};


module.exports = {
  safeQuery,
  getClient,
  withTransaction,
  pool
};