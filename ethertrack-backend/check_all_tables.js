const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres.pnszmtgodypwadkuecch:4g9Ea0QWIoOyeqBt@aws-1-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function checkTables() {
  const tables = ['support_unanswered', 'notifications', 'audit_log', 'audit_logs', 'organisations', 'org_members', 'org_invites', 'user_bank_accounts', 'subscription_payments', 'subscription_history', 'coupons', 'coupon_redemptions', 'support_feedback', 'support_unanswered'];
  
  for (const table of tables) {
    const cols = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [table]);
    console.log(`\n${table} columns:`);
    for (const col of cols.rows) {
      console.log('  ' + col.column_name + ' | ' + col.data_type);
    }
  }
  await pool.end();
}

checkTables().catch(e => { console.error(e); process.exit(1); });