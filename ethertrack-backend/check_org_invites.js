const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres.pnszmtgodypwadkuecch:4g9Ea0QWIoOyeqBt@aws-1-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function checkOrgInvites() {
  const cols = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'org_invites'
    ORDER BY ordinal_position
  `);
  console.log('org_invites columns:');
  for (const col of cols.rows) {
    console.log('  ' + col.column_name + ' | ' + col.data_type);
  }
  await pool.end();
}

checkOrgInvites().catch(e => { console.error(e); process.exit(1); });