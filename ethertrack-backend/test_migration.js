const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

const sql = `
CREATE TABLE carbon_asset_passports (
    passport_id           UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    asset_id              UUID NOT NULL REFERENCES carbon_batches(id) ON DELETE CASCADE,
    CONSTRAINT uq_carbon_asset_passports_asset UNIQUE (asset_id)
)
`;

pool.query(sql)
  .then(() => console.log('Success'))
  .catch(e => console.error('Error:', e.message))
  .finally(() => pool.end());