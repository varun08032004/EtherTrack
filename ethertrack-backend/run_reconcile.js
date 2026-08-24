require('dotenv').config();
const { reconcileAllBalances } = require('./services/creditLedger');

async function run() {
  console.log('Running reconciliation...');
  const mismatches = await reconcileAllBalances();
  console.log('Mismatches found:', mismatches.length);
  console.table(mismatches);
  process.exit(0);
}

run().catch(console.error).finally(() => process.exit(1));