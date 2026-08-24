require('dotenv').config();
const { safeQuery: query } = require('./db/pool.js');

async function check() {
  console.log('=== TRADES FOR TOKEN_ID=3 (Mango Farms) ===');
  const trades = await query(`
    SELECT id, buyer_id, seller_id, quantity, price_per_credit_inr, status, 
           tx_hash, chain_status, chain_tx_hash, payment_mode, 
           buyer_inr_deducted, seller_inr_credited, inr_settlement_at
    FROM trades 
    WHERE token_id = 3 AND status = 'completed'
    ORDER BY created_at DESC
  `);
  console.table(trades.rows);

  console.log('\n=== BUYER CREDITS (Deshmukh Solar) ===');
  const buyer = '45aced03-8164-44d8-9f39-c6bb828ba9cd';
  const bought = await query(`
    SELECT t.id as trade_id, t.token_id, t.quantity, t.price_per_credit_inr, t.status,
           cb.project_name
    FROM trades t
    LEFT JOIN carbon_batches cb ON cb.id = t.batch_id
    WHERE t.buyer_id = $1 AND t.status = 'completed' AND t.token_id = 3
  `, ['45aced03-8164-44d8-9f39-c6bb828ba9cd']);
  console.table(bought.rows);

  console.log('\n=== LEDGER BALANCE FOR BUYER ===');
  const ledger = await query(`
    SELECT clb.token_id, clb.balance, cb.project_name
    FROM credit_ledger_balances clb
    LEFT JOIN carbon_batches cb ON cb.token_id = clb.token_id
    WHERE clb.user_id = $1 AND clb.token_id = 3
  `, ['45aced03-8164-44d8-9f39-c6bb828ba9cd']);
  console.table(ledger.rows);

  process.exit(0);
}

check().catch(console.error).finally(() => process.exit(1));