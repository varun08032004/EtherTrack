require('dotenv').config();
const { safeQuery } = require('./db/pool.js');

async function check() {
  const buyer = await safeQuery('SELECT id, email, kyc_status, kyc_verified, kyc_data_hash FROM users WHERE id = $1', ['45aced03-8164-44d8-9f39-c6bb828ba9cd']);
  console.log('Buyer KYC:', buyer.rows[0]);
  
  const seller = await safeQuery('SELECT id, email, kyc_status, kyc_verified, kyc_data_hash FROM users WHERE id = $1', ['706c67a4-de98-4a9a-9287-bed77d33b1a4']);
  console.log('Seller KYC:', seller.rows[0]);
  
  process.exit(0);
}

check().catch(console.error).finally(() => process.exit(1));