require('dotenv').config();
const { safeQuery } = require('./db/pool.js');

async function checkSchema() {
  const cols = await safeQuery(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'trades' ORDER BY ordinal_position
  `);
  console.log('Trades columns:', cols.rows.map(r => r.column_name));
  
  const ctCols = await safeQuery(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'credit_transfers' ORDER BY ordinal_position
  `);
  console.log('Credit transfers columns:', ctCols.rows.map(r => r.column_name));
  
  process.exit(0);
}

checkSchema().catch(console.error).finally(() => process.exit(1));