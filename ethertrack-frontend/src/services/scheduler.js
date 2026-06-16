// services/scheduler.js — EtherTrack
// Background job scheduler using node-cron.
//
// Started by server.js on boot: scheduler.start()
// Stopped on SIGTERM/SIGINT:    scheduler.stop()
//
// Install dependency if not already present:
//   npm install node-cron
//
// JOBS:
//   Every 1 min  — ETH/INR rate refresh
//   Every 1 min  — Market stats cache warm (market.js /stats)
//   Every 1 min  — Transaction stats cache warm (transactions.js /stats)
//   Every 5 min  — Stale pending tx cleanup (was inside GET /pending — now here)
//   Every 5 min  — Memory store purge (expired tokens + cache keys)
//   Every 30 sec — Price alert checks (notify users when price threshold hit)
//   Every day 2am — CERC settlement reconciliation

'use strict';

const cron = require('node-cron');

const jobs = []; // { job, label }

function registerJob(schedule, label, fn) {
  const job = cron.schedule(schedule, async () => {
    try {
      await fn();
    } catch (e) {
      console.error(`[scheduler] ${label} failed:`, e.message);
    }
  }, { scheduled: false });
  jobs.push({ job, label });
  return job;
}

// ── Lazy-load services to avoid circular dependency issues ─────────────────
// Each fn() is called at runtime, not at module load time.

// ── Job 1: ETH/INR rate refresh — every 60 seconds ───────────────────────────
registerJob('*/1 * * * *', 'eth-rate-refresh', async () => {
  const { getLiveETHRate } = require('./rateService');
  await getLiveETHRate();
});

// ── Job 2: Market stats cache warm — every 60 seconds ────────────────────────
registerJob('*/1 * * * *', 'market-stats-warm', async () => {
  const { safeQuery: query } = require('../db/pool');
  const statsCache = require('./statsCache');

  const [vol, cnt, active, ret] = await Promise.all([
    query(`SELECT COALESCE(SUM(subtotal_inr), 0) AS total FROM trades WHERE status = 'completed'`),
    query(`SELECT COUNT(*) FROM trades WHERE status = 'completed'`),
    query(`SELECT COUNT(*) FROM carbon_batches
           WHERE admin_status = 'approved' AND available_credits > 0
             AND listing_id_onchain IS NOT NULL
             AND (deleted_at IS NULL OR deleted_at > NOW())
             AND (expires_at IS NULL OR expires_at > NOW())`),
    query(`SELECT COALESCE(SUM(retired_credits), 0) AS total FROM carbon_batches`),
  ]);

  statsCache.set('market:stats', {
    totalVolumeINR: parseFloat(vol.rows[0].total),
    totalTrades:    parseInt(cnt.rows[0].count),
    activeListings: parseInt(active.rows[0].count),
    totalRetired:   parseInt(ret.rows[0].total),
    cachedAt:       new Date().toISOString(),
  }, 90);
});

// ── Job 3: Transaction stats cache warm — every 60 seconds ───────────────────
registerJob('*/1 * * * *', 'tx-stats-warm', async () => {
  const { safeQuery: query } = require('../db/pool');
  const statsCache = require('./statsCache');

  const [trades, retired, volume, users] = await Promise.all([
    query(`SELECT COUNT(*) FROM registry_transactions WHERE tx_type IN ('BUY','SELL','buy','sell')`),
    query(`SELECT COALESCE(SUM(retired_credits),0) AS total FROM carbon_batches`),
    query(`SELECT COALESCE(SUM(total_price_inr),0) AS total FROM registry_transactions WHERE tx_type IN ('BUY','SELL','buy','sell')`),
    query(`SELECT COUNT(*) FROM users WHERE kyc_verified = TRUE`),
  ]);

  statsCache.set('tx:stats', {
    totalTrades:    parseInt(trades.rows[0].count),
    totalRetired:   parseInt(retired.rows[0].total),
    totalVolumeINR: parseFloat(volume.rows[0].total),
    verifiedUsers:  parseInt(users.rows[0].count),
    cachedAt:       new Date().toISOString(),
  }, 90);
});

// ── Job 4: Stale pending tx cleanup — every 5 minutes ────────────────────────
// Moved here from GET /transactions/pending (was a side-effectful read).
registerJob('*/5 * * * *', 'stale-tx-cleanup', async () => {
  const { safeQuery: query } = require('../db/pool');

  const { rowCount } = await query(
    `UPDATE registry_transactions
     SET block_number = -1
     WHERE block_number IS NULL
       AND created_at < NOW() - INTERVAL '30 minutes'`
  );
  if (rowCount > 0) {
    console.info(`[scheduler] Marked ${rowCount} stale transactions as timed-out`);
  }
});

// ── Job 5: Memory store purge — every 5 minutes ───────────────────────────────
registerJob('*/5 * * * *', 'memory-purge', async () => {
  const statsCache = require('./statsCache');
  statsCache.purgeExpired();

  // Token store purge — only if tokenStore exists
  try {
    const tokenStore = require('./tokenStore');
    const purged = tokenStore.purgeExpired();
    if (purged > 0) console.info(`[scheduler] Purged ${purged} expired tokens`);
  } catch { /* tokenStore is optional */ }
});

// ── Job 6: Price alert checks — every 30 seconds ─────────────────────────────
// Checks all active, untriggered alerts against current listing prices.
// Inserts a notification when threshold is crossed.
registerJob('*/30 * * * * *', 'alert-check', async () => {
  const { safeQuery: query } = require('../db/pool');

  const { rows: pendingAlerts } = await query(
    `SELECT a.id, a.user_id, a.token_id, a.alert_type, a.target_price_inr,
            cb.price_per_credit_inr AS current_price
     FROM alerts a
     JOIN carbon_batches cb ON cb.token_id = a.token_id
       AND cb.admin_status = 'approved'
       AND cb.available_credits > 0
       AND (cb.deleted_at IS NULL OR cb.deleted_at > NOW())
     WHERE a.is_active = TRUE
       AND a.triggered_at IS NULL
       AND (a.expires_at IS NULL OR a.expires_at > NOW())`
  );

  for (const alert of pendingAlerts) {
    const current  = parseFloat(alert.current_price);
    const target   = parseFloat(alert.target_price_inr);
    const triggered =
      (alert.alert_type === 'below' && current <= target) ||
      (alert.alert_type === 'above' && current >= target);

    if (!triggered) continue;

    await query(
      `UPDATE alerts SET triggered_at = NOW() WHERE id = $1`,
      [alert.id]
    ).catch(() => {});

    await query(
      `INSERT INTO notifications
         (user_id, type, title, message, data, created_at)
       VALUES ($1, 'ALERT', 'Price Alert Triggered', $2, $3, NOW())`,
      [
        alert.user_id,
        `Token #${alert.token_id} price is now ₹${Math.round(current).toLocaleString('en-IN')} — alert ${alert.alert_type} ₹${Math.round(target).toLocaleString('en-IN')} triggered`,
        JSON.stringify({
          tokenId:      alert.token_id,
          alertType:    alert.alert_type,
          targetPrice:  target,
          currentPrice: current,
        }),
      ]
    ).catch(() => {});
  }
});

// ── Job 7: CERC reconciliation — daily at 2am ─────────────────────────────────
registerJob('0 2 * * *', 'cerc-reconciliation', async () => {
  try {
    const { cercRecon } = require('./exchangeService');
    const result = await cercRecon.reconcileSettledOrders();
    if (result.reconciled > 0) {
      console.info(`[scheduler] CERC: reconciled ${result.reconciled} orders`);
    }
  } catch (e) {
    // exchangeService may not exist in all environments — non-fatal
    if (!e.message.includes('Cannot find module')) {
      console.error('[scheduler] CERC reconciliation error:', e.message);
    }
  }
});

// ── Lifecycle ──────────────────────────────────────────────────────────────────
const scheduler = {
  start() {
    jobs.forEach(({ job, label }) => {
      job.start();
      console.info(`[scheduler] Started: ${label}`);
    });

    // Warm caches immediately on first start
    Promise.allSettled([
      (async () => {
        try {
          const { getLiveETHRate } = require('./rateService');
          await getLiveETHRate();
        } catch {}
      })(),
    ]);
  },

  stop() {
    jobs.forEach(({ job, label }) => {
      job.stop();
      console.info(`[scheduler] Stopped: ${label}`);
    });
  },
};

module.exports = scheduler;