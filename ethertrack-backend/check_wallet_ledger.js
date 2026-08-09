const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres.pnszmtgodypwadkuecch:4g9Ea0QWIoOyeqBt@aws-1-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function checkWalletLedger() {
  const cols = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'wallet_ledger'
    ORDER BY ordinal_position
  `);
  console.log('wallet_ledger columns:');
  for (const col of cols.rows) {
    console.log('  ' + col.column_name + ' | ' + col.data_type);
  }
  await pool.end();
}

checkWalletLedger().catch(e => { console.error(e); process.exit(1); });