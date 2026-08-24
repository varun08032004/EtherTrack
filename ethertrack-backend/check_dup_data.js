require('dotenv').config();
const { safeQuery: query } = require('./db/pool.js');

async function checkDuplicates() {
  const userId = '45aced03-8164-44d8-9f39-c6bb828ba9cd'; // Deshmukh Solar user who bought Mango Farms
  
  // Check my-bought-credits for this user
  const bought = await query(`
    SELECT t.id, t.token_id, t.quantity, t.price_per_credit_inr, cb.project_name
    FROM trades t
    LEFT JOIN carbon_batches cb ON cb.id = t.batch_id
    WHERE t.buyer_id = $1 AND t.status = 'completed'
    ORDER BY t.created_at DESC
  `, [userId]);
  console.log('my-bought-credits:', bought.rows.map(r => ({ 
    id: `bought-${r.trade_id}`, 
    tokenId: r.token_id, 
    project: r.project_name,
    qty: r.quantity 
  })));

  // Check my-ledger-credits for this user
  const ledger = await query(`
    SELECT clb.token_id, clb.balance, cb.project_name
    FROM credit_ledger_balances clb
    LEFT JOIN carbon_batches cb ON cb.token_id = clb.token_id
    WHERE clb.user_id = $1 AND clb.balance > 0
  `, [userId]);
  console.log('my-ledger-credits:', ledger.rows.map(r => ({
    id: `ledger-${r.token_id}`,
    tokenId: r.token_id,
    project: r.project_name,
    balance: r.balance
  })));

  process.exit(0);
}

checkDuplicates().catch(console.error).finally(() => process.exit(1));