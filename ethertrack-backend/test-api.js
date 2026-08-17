// test-api.js - Test portfolio APIs for both users
const { Pool } = require('pg');
require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-backend\\.env' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  try {
    console.log("=== Testing /api/portfolio/my-credits query ===");
    
    // User 1: varun.deshmukh2004@gmail.com
    const user1 = '706c67a4-de98-4a9a-9287-bed77d33b1a4';
    console.log(`\n--- User 1: ${user1} ---`);
    
    const credits1 = await pool.query(
      `SELECT cb.id, cb.project_name, cb.token_id, cb.custody_model, cb.status, cb.admin_status, 
              cb.available_credits, cb.listed_quantity, cb.quantity
       FROM carbon_batches cb
       WHERE cb.user_id = $1 AND cb.admin_status = 'approved'`
      , [user1]
    );
    console.table(credits1.rows);
    
    const ledger1 = await pool.query(
      `SELECT clb.token_id, clb.balance, clb.total_retired,
              cb.project_name, cb.standard, cb.project_type, cb.developer,
              cb.vintage_year, cb.country, cb.project_location, cb.registry_serial,
              cb.credit_type, cb.cbam_eligible, cb.expiry_date,
              ll.id AS ledger_listing_id, ll.amount_remaining AS listed_amount
       FROM credit_ledger_balances clb
       LEFT JOIN carbon_batches cb ON cb.token_id = clb.token_id
       LEFT JOIN ledger_listings ll ON ll.seller_id = clb.user_id AND ll.token_id = clb.token_id AND ll.active = TRUE
       WHERE clb.user_id = $1 AND clb.balance > 0`
      , [user1]
    );
    console.log("Ledger credits for User 1:");
    console.table(ledger1.rows);
    
    // User 2: deshmukhvarun2004@gmail.com
    const user2 = '45aced03-8164-44d8-9f39-c6bb828ba9cd';
    console.log(`\n--- User 2: ${user2} ---`);
    
    const credits2 = await pool.query(
      `SELECT cb.id, cb.project_name, cb.token_id, cb.custody_model, cb.status, cb.admin_status,
              cb.available_credits, cb.listed_quantity, cb.quantity
       FROM carbon_batches cb
       WHERE cb.user_id = $1 AND cb.admin_status = 'approved'`
      , [user2]
    );
    console.table(credits2.rows);
    
    const ledger2 = await pool.query(
      `SELECT clb.token_id, clb.balance, clb.total_retired,
              cb.project_name, cb.standard, cb.project_type, cb.developer,
              cb.vintage_year, cb.country, cb.project_location, cb.registry_serial,
              cb.credit_type, cb.cbam_eligible, cb.expiry_date,
              ll.id AS ledger_listing_id, ll.amount_remaining AS listed_amount
       FROM credit_ledger_balances clb
       LEFT JOIN carbon_batches cb ON cb.token_id = clb.token_id
       LEFT JOIN ledger_listings ll ON ll.seller_id = clb.user_id AND ll.token_id = clb.token_id AND ll.active = TRUE
       WHERE clb.user_id = $1 AND clb.balance > 0`
      , [user2]
    );
    console.log("Ledger credits for User 2:");
    console.table(ledger2.rows);
    
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}

main();