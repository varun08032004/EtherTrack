require('dotenv').config();
const { mintApprovedCredit } = require('./services/minter');

async function fix() {
  // Batch 1: Deshmukh Solar user - VD Wind Plant - token 1, 3000 credits
  const batch1 = '7cc35e17-4b08-4e27-b56f-3f90bd915b4b';  // Deshmukh Solar user, token 1
  
  // Batch 2: Mango Farms user - Deshmukh Solar - token 2, 3000 credits  
  const batch2 = 'dde40c5e-4a2c-4263-b3dc-e3963572e023';  // Mango Farms user, token 2

  console.log('Minting batch 1 (Deshmukh Solar user, token 1)...');
  try {
    const result1 = await mintApprovedCredit(batch1, { force: true });
    console.log('✅ Batch 1 result:', result1);
  } catch (e) {
    console.error('Batch 1 failed:', e.message);
  }

  console.log('\nMinting batch 2 (Mango Farms user, token 2)...');
  try {
    const result2 = await mintApprovedCredit(batch2, { force: true });
    console.log('✅ Batch 2 result:', result2);
  } catch (e) {
    console.error('Batch 2 failed:', e.message);
  }

  process.exit(0);
}

fix().catch(console.error).finally(() => process.exit(1));