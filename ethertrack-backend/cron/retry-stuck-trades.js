require('dotenv').config();
const { safeQuery: query } = require('../db/pool.js');

let settlementEngine = null;

function setSettlementEngine(engine) {
  settlementEngine = engine;
}

async function retryStuckTrades() {
  if (!settlementEngine) {
    console.error('[cron/retry] SettlementEngine not initialized');
    return;
  }
  console.log('[cron/retry] Starting stuck trade retry...');
  
  // 1. Find trades in REQUIRES_RECONCILIATION
  const { rows: reconTrades } = await query(`
    SELECT * FROM trades 
    WHERE status = 'REQUIRES_RECONCILIATION' 
      AND updated_at < NOW() - INTERVAL '5 minutes'
    LIMIT 20
  `);
  
  console.log(`[cron/retry] Found ${reconTrades.length} trades requiring reconciliation`);
  
  for (const trade of reconTrades) {
    try {
      console.log(`[cron/retry] Processing trade ${trade.id} (failure: ${trade.chain_status})`);
      
      // Attempt to complete credit transfer if not done
      if (trade.credit_transfer_id) {
        const { rows: ctRows } = await query('SELECT * FROM credit_transfers WHERE transfer_id = $1', [trade.credit_transfer_id]);
        if (ctRows.length && ctRows[0].status === 'SUBMITTED') {
          // Check if on-chain operations are confirmed
          const { rows: ops } = await query('SELECT * FROM credit_transfer_operations WHERE transfer_id = $1', [trade.credit_transfer_id]);
          const allConfirmed = ops.every(op => op.status === 'CONFIRMED');
          
          if (allConfirmed) {
            // Complete the transfer
            await query(`UPDATE credit_transfers SET status = 'CONFIRMED', completed_at = NOW(), updated_at = NOW() WHERE transfer_id = $1`, [trade.credit_transfer_id]);
            await settlementEngine.transitionToCreditTransferConfirmed(trade.id);
            console.log(`[cron/retry] Trade ${trade.id} credit transfer confirmed`);
          }
        }
      }
      
      // If payment settled but seller not paid
      if (trade.status === 'PAYMENT_SETTLED') {
        await settlementEngine.transitionToSellerPaid(trade.id);
        await settlementEngine.transitionToBuyerCredited(trade.id);
        await settlementEngine.transitionToSettled(trade.id);
        console.log(`[cron/retry] Trade ${trade.id} fully settled`);
      }
      
    } catch (err) {
      console.error(`[cron/retry] Failed to retry trade ${trade.id}:`, err.message);
    }
  }
  
  // 2. Find trades stuck in intermediate states > 30 minutes
  const { rows: stuckTrades } = await query(`
    SELECT * FROM trades 
    WHERE status IN ('CREDITS_RESERVED', 'SETTLEMENT_PENDING', 'CREDIT_TRANSFER_SUBMITTED', 'CREDIT_TRANSFER_CONFIRMED', 'PAYMENT_SETTLED', 'FEES_COLLECTED', 'SELLER_PAID', 'BUYER_CREDITED')
      AND updated_at < NOW() - INTERVAL '30 minutes'
    LIMIT 20
  `);
  
  console.log(`[cron/retry] Found ${stuckTrades.length} stuck trades`);
  
  for (const trade of stuckTrades) {
    try {
      console.log(`[cron/retry] Processing stuck trade ${trade.id} in state ${trade.status}`);
      
      // Attempt to advance the trade based on current state
      const validTransitions = {
        'CREDITS_RESERVED': 'SETTLEMENT_PENDING',
        'SETTLEMENT_PENDING': 'CREDIT_TRANSFER_SUBMITTED',
        'CREDIT_TRANSFER_SUBMITTED': 'CREDIT_TRANSFER_CONFIRMED',
        'CREDIT_TRANSFER_CONFIRMED': 'PAYMENT_SETTLED',
        'PAYMENT_SETTLED': 'FEES_COLLECTED',
        'FEES_COLLECTED': 'SELLER_PAID',
        'SELLER_PAID': 'BUYER_CREDITED',
        'BUYER_CREDITED': 'SETTLED'
      };
      
      const nextState = validTransitions[trade.status];
      if (nextState) {
        // Try to advance
        const method = `transitionTo${nextState.charAt(0).toUpperCase() + nextState.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase())}`;
        if (typeof settlementEngine[method] === 'function') {
          await settlementEngine[method](trade.id);
          console.log(`[cron/retry] Advanced trade ${trade.id} to ${nextState}`);
        }
      }
    } catch (err) {
      console.error(`[cron/retry] Failed to advance trade ${trade.id}:`, err.message);
    }
  }
  
  console.log('[cron/retry] Completed');
}

// Run if called directly
if (require.main === module) {
  retryStuckTrades()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[cron/retry] Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { retryStuckTrades, setSettlementEngine };