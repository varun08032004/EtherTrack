require('dotenv').config();
const { safeQuery: query } = require('../db/pool.js');
const Sentry = require('@sentry/node');

let settlementEngine = null;

function setSettlementEngine(engine) {
  settlementEngine = engine;
}

async function monitorStuckTrades() {
  if (!settlementEngine) {
    console.error('[cron/monitor] SettlementEngine not initialized');
    return;
  }
  try {
    // Check for trades stuck in various states
    const { rows: stuckTrades } = await query(`
      SELECT status, COUNT(*) as count, 
             MAX(EXTRACT(EPOCH FROM (NOW() - updated_at))) as max_age_seconds
      FROM trades 
      WHERE status NOT IN ('SETTLED', 'FAILED', 'CANCELLED', 'EXPIRED')
      GROUP BY status
    `);
    
    // Alert if any state has trades older than 30 minutes
    for (const state of stuckTrades) {
      if (state.max_age_seconds > 1800) { // 30 minutes
        Sentry.captureMessage(
          `⚠️ ${state.count} trade(s) stuck in ${state.status} for ${Math.round(state.max_age_seconds/60)} min`,
          'warning'
        );
      }
    }
    
    // Check for failed trades needing attention
    const { rows: failedTrades } = await query(`
      SELECT COUNT(*) as count FROM trades 
      WHERE status = 'FAILED' 
        AND updated_at > NOW() - INTERVAL '1 hour'
    `);
    
    if (failedTrades[0].count > 0) {
      Sentry.captureMessage(
        `❌ ${failedTrades[0].count} trade(s) failed in last hour`,
        'error'
      );
    }
    
    // Check for REQUIRES_RECONCILIATION trades
    const { rows: reconTrades } = await query(`
      SELECT COUNT(*) as count FROM trades 
      WHERE status = 'REQUIRES_RECONCILIATION'
    `);
    
    if (reconTrades[0].count > 0) {
      Sentry.captureMessage(
        `🔧 ${reconTrades[0].count} trade(s) require reconciliation`,
        'warning'
      );
    }
    
    console.log('[monitor] Trade monitoring check completed');
  } catch (err) {
    console.error('[monitor] Error:', err.message);
    Sentry.captureException(err);
  }
}

module.exports = { monitorStuckTrades, setSettlementEngine };