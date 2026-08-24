require('dotenv').config();
const { safeQuery: query } = require('./db/pool.js');

async function checkSchema() {
  const ctOpsCols = await query('SELECT column_name FROM information_schema.columns WHERE table_name = \'credit_transfer_operations\'');
  console.log('Credit transfer ops columns:', ctOpsCols.rows.map(r => r.column_name));

  const ctCols = await query('SELECT column_name FROM information_schema.columns WHERE table_name = \'credit_transfers\'');
  console.log('Credit transfers columns:', ctCols.rows.map(r => r.column_name));

  const tradesCols = await query('SELECT column_name FROM information_schema.columns WHERE table_name = \'trades\'');
  console.log('Trades columns:', tradesCols.rows.map(r => r.column_name).join(', '));

  process.exit(0);
}

checkSchema().catch(console.error).finally(() => process.exit(1));