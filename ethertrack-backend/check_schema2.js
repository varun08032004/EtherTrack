require('dotenv').config();
const { safeQuery: query } = require('./db/pool.js');

async function checkSchema() {
  const tradesCols = await query('SELECT column_name FROM information_schema.columns WHERE table_name = \'trades\' AND column_name IN (\'status\', \'settlement_state\')');
  console.log('Trades columns:', tradesCols.rows);

  const ctOpsCols = await query('SELECT column_name FROM information_schema.columns WHERE table_name = \'credit_transfer_operations\' AND column_name = \'status\'');
  console.log('Credit transfer ops columns:', ctOpsCols.rows);

  const ctCols = await query('SELECT column_name FROM information_schema.columns WHERE table_name = \'credit_transfers\' AND column_name = \'status\'');
  console.log('Credit transfers columns:', ctCols.rows);

  process.exit(0);
}

checkSchema().catch(console.error).finally(() => process.exit(1));