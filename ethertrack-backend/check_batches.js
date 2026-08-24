require('dotenv').config();
const { safeQuery } = require('./db/pool.js');

async function check() {
  // Check all batches for both users
  const users = [
    { id: '706c67a4-de98-4a9a-9287-bed77d33b1a4', name: 'Mango Farms' },
    { id: '45aced03-8164-44d8-9f39-c6bb828ba9cd', name: 'Deshmukh Solar' }
  ];

  for (const u of users) {
    console.log(`\n=== ${u.name} (${u.id}) ===`);
    const batches = await safeQuery(
      `SELECT id, project_name, total_credits, available_credits, retired_credits, token_id, custody_model, created_at
       FROM carbon_batches WHERE user_id = $1 ORDER BY created_at`,
      [u.id]
    );
    console.table(batches.rows);
  }

  // Check trigger
  const trigger = await safeQuery(`
    SELECT tgname, proname 
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE tgrelid = 'carbon_batches'::regclass
  `);
  console.log('\n=== Triggers on carbon_batches ===');
  console.table(trigger.rows);

  process.exit(0);
}

check().catch(console.error).finally(() => process.exit(1));