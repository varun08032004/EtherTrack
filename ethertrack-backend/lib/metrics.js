'use strict';

const client = require('prom-client');
const { safeQuery } = require('../db/pool');

const register = new client.Registry();

register.setDefaultLabels({
  app: 'ethertrack-api',
  env: process.env.NODE_ENV || 'development',
});

client.collectDefaultMetrics({
  register,
  prefix: 'ethertrack_',
  gcDurationBuckets: [0.001, 0.01, 0.1, 1, 10],
});

const httpRequestDuration = new client.Histogram({
  name: 'ethertrack_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

const httpRequestTotal = new client.Counter({
  name: 'ethertrack_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const httpRequestErrors = new client.Counter({
  name: 'ethertrack_http_request_errors_total',
  help: 'Total number of HTTP request errors (4xx, 5xx)',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const activeRequests = new client.Gauge({
  name: 'ethertrack_active_requests',
  help: 'Number of currently active HTTP requests',
  labelNames: ['method', 'route'],
  registers: [register],
});

const dbQueryDuration = new client.Histogram({
  name: 'ethertrack_db_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['operation', 'result'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [register],
});

const dbQueryTotal = new client.Counter({
  name: 'ethertrack_db_queries_total',
  help: 'Total number of database queries',
  labelNames: ['operation', 'result'],
  registers: [register],
});

const dbPoolActive = new client.Gauge({
  name: 'ethertrack_db_pool_active',
  help: 'Number of active database connections in the pool',
  registers: [register],
});

const dbPoolIdle = new client.Gauge({
  name: 'ethertrack_db_pool_idle',
  help: 'Number of idle database connections in the pool',
  registers: [register],
});

const dbPoolTotal = new client.Gauge({
  name: 'ethertrack_db_pool_total',
  help: 'Total number of database connections in the pool',
  registers: [register],
});

const redisHits = new client.Counter({
  name: 'ethertrack_redis_hits_total',
  help: 'Total number of Redis cache hits',
  labelNames: ['cache_type'],
  registers: [register],
});

const redisMisses = new client.Counter({
  name: 'ethertrack_redis_misses_total',
  help: 'Total number of Redis cache misses',
  labelNames: ['cache_type'],
  registers: [register],
});

const redisErrors = new client.Counter({
  name: 'ethertrack_redis_errors_total',
  help: 'Total number of Redis errors',
  labelNames: ['operation'],
  registers: [register],
});

const externalApiDuration = new client.Histogram({
  name: 'ethertrack_external_api_duration_seconds',
  help: 'External API call duration in seconds',
  labelNames: ['service', 'operation', 'result'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [register],
});

const externalApiTotal = new client.Counter({
  name: 'ethertrack_external_api_total',
  help: 'Total number of external API calls',
  labelNames: ['service', 'operation', 'result'],
  registers: [register],
});

const circuitBreakerState = new client.Gauge({
  name: 'ethertrack_circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
  labelNames: ['service'],
  registers: [register],
});

const tradeSettlementTotal = new client.Counter({
  name: 'ethertrack_trade_settlement_total',
  help: 'Total number of trade settlements',
  labelNames: ['result', 'payment_mode'],
  registers: [register],
});

const walletTransactionTotal = new client.Counter({
  name: 'ethertrack_wallet_transaction_total',
  help: 'Total number of wallet transactions',
  labelNames: ['type', 'result'],
  registers: [register],
});

const webhookTotal = new client.Counter({
  name: 'ethertrack_webhook_total',
  help: 'Total number of webhook calls',
  labelNames: ['provider', 'event', 'result'],
  registers: [register],
});

const kycTotal = new client.Counter({
  name: 'ethertrack_kyc_total',
  help: 'Total number of KYC operations',
  labelNames: ['action', 'result'],
  registers: [register],
});

const reconciliationTotal = new client.Counter({
  name: 'ethertrack_reconciliation_total',
  help: 'Total number of reconciliation runs',
  labelNames: ['type', 'result'],
  registers: [register],
});

const backupTotal = new client.Counter({
  name: 'ethertrack_backup_total',
  help: 'Total number of backup runs',
  labelNames: ['type', 'result'],
  registers: [register],
});

const jobDuration = new client.Histogram({
  name: 'ethertrack_job_duration_seconds',
  help: 'Background job duration in seconds',
  labelNames: ['job', 'result'],
  buckets: [1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600],
  registers: [register],
});

const jobTotal = new client.Counter({
  name: 'ethertrack_job_total',
  help: 'Total number of background jobs',
  labelNames: ['job', 'result'],
  registers: [register],
});

const blockchainRpcDuration = new client.Histogram({
  name: 'ethertrack_blockchain_rpc_duration_seconds',
  help: 'Blockchain RPC call duration in seconds',
  labelNames: ['method', 'result'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [register],
});

const blockchainRpcTotal = new client.Counter({
  name: 'ethertrack_blockchain_rpc_total',
  help: 'Total number of blockchain RPC calls',
  labelNames: ['method', 'result'],
  registers: [register],
});

const blockchainQueueDepth = new client.Gauge({
  name: 'ethertrack_blockchain_queue_depth',
  help: 'Current blockchain transaction queue depth',
  registers: [register],
});

const erpSyncTotal = new client.Counter({
  name: 'ethertrack_erp_sync_total',
  help: 'Total number of ERP sync runs',
  labelNames: ['erp', 'operation', 'result'],
  registers: [register],
});

const authTotal = new client.Counter({
  name: 'ethertrack_auth_total',
  help: 'Total number of authentication attempts',
  labelNames: ['action', 'result'],
  registers: [register],
});

const rateLimitTotal = new client.Counter({
  name: 'ethertrack_rate_limit_total',
  help: 'Total number of rate limit hits',
  labelNames: ['endpoint', 'result'],
  registers: [register],
});

const adminActionTotal = new client.Counter({
  name: 'ethertrack_admin_action_total',
  help: 'Total number of admin actions',
  labelNames: ['action', 'result'],
  registers: [register],
});

function observeHttpRequest(method, route, statusCode, durationMs) {
  const labels = { method, route, status_code: String(statusCode) };
  httpRequestDuration.observe(labels, durationMs / 1000);
  httpRequestTotal.inc(labels);
  if (statusCode >= 400) {
    httpRequestErrors.inc(labels);
  }
}

function observeActiveRequest(method, route, delta) {
  activeRequests.inc({ method, route }, delta);
}

function observeDbQuery(operation, result, durationMs) {
  const labels = { operation, result };
  dbQueryDuration.observe(labels, durationMs / 1000);
  dbQueryTotal.inc(labels);
}

function updateDbPoolMetrics(pool) {
  if (pool && typeof pool.totalCount === 'number') {
    dbPoolTotal.set(pool.totalCount);
    dbPoolActive.set(pool.totalCount - (pool.idleCount || 0));
    dbPoolIdle.set(pool.idleCount || 0);
  }
}

function observeExternalApi(service, operation, result, durationMs) {
  const labels = { service, operation, result };
  externalApiDuration.observe(labels, durationMs / 1000);
  externalApiTotal.inc(labels);
}

function setCircuitBreakerState(service, state) {
  const stateMap = { closed: 0, half_open: 1, open: 2 };
  circuitBreakerState.set({ service }, stateMap[state] ?? 0);
}

function observeTradeSettlement(result, paymentMode) {
  tradeSettlementTotal.inc({ result, payment_mode: paymentMode });
}

function observeWalletTransaction(type, result) {
  walletTransactionTotal.inc({ type, result });
}

function observeWebhook(provider, event, result) {
  webhookTotal.inc({ provider, event, result });
}

function observeKyc(action, result) {
  kycTotal.inc({ action, result });
}

function observeReconciliation(type, result) {
  reconciliationTotal.inc({ type, result });
}

function observeBackup(type, result) {
  backupTotal.inc({ type, result });
}

function observeJob(job, result, durationMs) {
  const labels = { job, result };
  jobDuration.observe(labels, durationMs / 1000);
  jobTotal.inc(labels);
}

function observeBlockchainRpc(method, result, durationMs) {
  const labels = { method, result };
  blockchainRpcDuration.observe(labels, durationMs / 1000);
  blockchainRpcTotal.inc(labels);
}

function setBlockchainQueueDepth(depth) {
  blockchainQueueDepth.set(depth);
}

function observeErpSync(erp, operation, result) {
  erpSyncTotal.inc({ erp, operation, result });
}

function observeAuth(action, result) {
  authTotal.inc({ action, result });
}

function observeRateLimit(endpoint, result) {
  rateLimitTotal.inc({ endpoint, result });
}

function observeAdminAction(action, result) {
  adminActionTotal.inc({ action, result });
}

function observeRedisHit(cacheType) {
  redisHits.inc({ cache_type: cacheType });
}

function observeRedisMiss(cacheType) {
  redisMisses.inc({ cache_type: cacheType });
}

function observeRedisError(operation) {
  redisErrors.inc({ operation });
}

async function collectDbMetrics() {
  try {
    const { rows } = await safeQuery(`
      SELECT 
        (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active,
        (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle') as idle,
        (SELECT count(*) FROM pg_stat_activity) as total
    `);
    if (rows[0]) {
      dbPoolActive.set(parseInt(rows[0].active) || 0);
      dbPoolIdle.set(parseInt(rows[0].idle) || 0);
      dbPoolTotal.set(parseInt(rows[0].total) || 0);
    }
  } catch (e) {
    console.error('[Metrics] Failed to collect DB metrics:', e.message);
  }
}

function metricsMiddleware() {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    const route = req.route?.path || req.path;
    const method = req.method;

    observeActiveRequest(method, route, 1);

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      observeHttpRequest(method, route, res.statusCode, durationMs);
      observeActiveRequest(method, route, -1);
    });

    next();
  };
}

module.exports = {
  register,
  metricsMiddleware,
  observeHttpRequest,
  observeActiveRequest,
  observeDbQuery,
  updateDbPoolMetrics,
  observeExternalApi,
  setCircuitBreakerState,
  observeTradeSettlement,
  observeWalletTransaction,
  observeWebhook,
  observeKyc,
  observeReconciliation,
  observeBackup,
  observeJob,
  observeBlockchainRpc,
  setBlockchainQueueDepth,
  observeErpSync,
  observeAuth,
  observeRateLimit,
  observeAdminAction,
  observeRedisHit,
  observeRedisMiss,
  observeRedisError,
  collectDbMetrics,
  observeRedisHit,
  observeRedisMiss,
  observeRedisError,
  metrics: {
    httpRequestDuration,
    httpRequestTotal,
    httpRequestErrors,
    activeRequests,
    dbQueryDuration,
    dbQueryTotal,
    dbPoolActive,
    dbPoolIdle,
    dbPoolTotal,
    redisHits,
    redisMisses,
    redisErrors,
    externalApiDuration,
    externalApiTotal,
    circuitBreakerState,
    tradeSettlementTotal,
    walletTransactionTotal,
    webhookTotal,
    kycTotal,
    reconciliationTotal,
    backupTotal,
    jobDuration,
    jobTotal,
    blockchainRpcDuration,
    blockchainRpcTotal,
    blockchainQueueDepth,
    erpSyncTotal,
    authTotal,
    rateLimitTotal,
    adminActionTotal,
  },
};