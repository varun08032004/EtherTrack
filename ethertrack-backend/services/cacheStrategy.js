// services/cacheStrategy.js — EtherTrack Redis Caching Strategy
// Centralized caching layer with TTL policies, invalidation, and metrics
'use strict';

const { getRedis } = require('./redis');
const logger = require('./logger');

// ─────────────────────────────────────────────────────────────────────────────
// TTL Configuration (in seconds)
// ─────────────────────────────────────────────────────────────────────────────
const TTL = {
  USER_PROFILE: 300,
  USER_KYC_STATUS: 60,
  USER_WALLET: 300,
  MARKET_LISTINGS: 15,
  MARKET_STATS: 30,
  PRICE_FEED: 15,
  ETH_INR_RATE: 60,
  MARKET_PRICE_HISTORY: 300,
  MARKET_VOLUME_24H: 60,
  CARBON_BATCHES: 30,
  CARBON_PROJECTS: 300,
  CARBON_LISTINGS: 30,
  CARBON_STATS: 60,
  WALLET_BALANCE: 10,
  WALLET_TRANSACTIONS: 30,
  SUBSCRIPTION_STATUS: 60,
  SUBSCRIPTION_PRICES: 300,
  MARKET_LISTINGS: 15,
  MARKET_STATS: 30,
  TRADE_HISTORY: 30,
  BUY_ORDERS: 15,
  EMISSION_SUMMARY: 60,
  EMISSION_ACTIVITIES: 30,
  BRSR_DATA: 300,
  BRSR_SECTION: 300,
  KYC_STATUS: 60,
  KYC_SUBMISSION: 30,
  ADMIN_STATS: 60,
  ADMIN_DASHBOARD: 30,
  ERP_SYNC_STATUS: 300,
  ERP_DATA: 600,
  ETH_INR_RATE: 60,
  TOKEN_PRICES: 30,
};

const KEYS = {
  userProfile: (userId) => `user:profile:${userId}`,
  userKyc: (userId) => `user:kyc:${userId}`,
  userWallet: (userId) => `user:wallet:${userId}`,
  marketListings: (params) => `market:listings:${JSON.stringify(params)}`,
  marketStats: () => 'market:stats',
  priceEthInr: () => 'price:eth:inr',
  priceToken: (tokenId) => `price:token:${tokenId}`,
  carbonBatches: (userId) => `carbon:batches:${userId}`,
  carbonListings: (params) => `carbon:listings:${JSON.stringify(params)}`,
  carbonStats: () => 'carbon:stats',
  walletBalance: (userId) => `wallet:balance:${userId}`,
  walletTransactions: (userId, params) => `wallet:tx:${userId}:${JSON.stringify(params)}`,
  subscriptionStatus: (userId) => `sub:status:${userId}`,
  subscriptionPrices: () => 'sub:prices',
  buyOrders: (params) => `market:buyorders:${JSON.stringify(params)}`,
  emissionsSummary: (userId, year) => `emissions:summary:${userId}:${year}`,
  emissionActivities: (userId, params) => `emissions:activities:${userId}:${JSON.stringify(params)}`,
  portfolioCredits: (userId, limit, cursor) => `portfolio:credits:${userId}:${limit}:${cursor || 'first'}`,
  portfolioCreditsPrefix: (userId) => `portfolio:credits:${userId}:`,
  portfolioBought: (userId) => `portfolio:bought:${userId}`,
  brsrData: (userId, year) => `brsr:${userId}:${year}`,
  brsrSection: (userId, year, section) => `brsr:${userId}:${year}:${section}`,
  kycStatus: (userId) => `kyc:status:${userId}`,
  adminStats: () => 'admin:stats',
  adminDashboard: () => 'admin:dashboard',
  erpSyncStatus: (orgId, erpId) => `erp:sync:${orgId}:${erpId}`,
  erpData: (orgId, erpId) => `erp:data:${orgId}:${erpId}`,
};

const metrics = {
  hits: 0,
  misses: 0,
  sets: 0,
  errors: 0,
  evictions: 0,
};

async function get(key) {
  try {
    const redis = getRedis();
    const value = await redis.get(key);
    if (value !== null && value !== undefined) {
      metrics.hits++;
      return JSON.parse(value);
    }
    metrics.misses++;
    return null;
  } catch (e) {
    metrics.errors++;
    logger.warn({ err: e.message, key }, 'Cache GET error');
    return null;
  }
}

async function set(key, value, ttl) {
  try {
    const redis = getRedis();
    const serialized = JSON.stringify(value);
    if (ttl) {
      await redis.setex(key, ttl, serialized);
    } else {
      await redis.set(key, serialized);
    }
    metrics.sets++;
    return true;
  } catch (e) {
    metrics.errors++;
    logger.warn({ err: e.message, key }, 'Cache SET error');
    return false;
  }
}

async function del(key) {
  try {
    const redis = getRedis();
    await redis.del(key);
    return true;
  } catch (e) {
    metrics.errors++;
    logger.warn({ err: e.message, key }, 'Cache DEL error');
    return false;
  }
}

async function delPattern(pattern) {
  try {
    const redis = getRedis();
    logger.warn({ pattern }, 'Pattern delete not fully supported on Upstash');
    return 0;
  } catch (e) {
    metrics.errors++;
    logger.warn({ err: e.message, pattern }, 'Cache DEL pattern error');
    return 0;
  }
}

async function invalidatePrefix(prefix) {
  logger.info({ prefix }, 'Cache invalidation requested');
  return 0;
}

async function invalidate(key) {
  return del(key);
}

async function incrementPortfolioVersion(userId) {
  const key = `portfolio:version:${userId}`;
  try {
    const redis = getRedis();
    const newVersion = await redis.incr(key);
    return newVersion;
  } catch (e) {
    metrics.errors++;
    logger.warn({ err: e.message, userId }, 'Failed to increment portfolio version');
    return 1;
  }
}

async function getPortfolioVersion(userId) {
  const key = `portfolio:version:${userId}`;
  try {
    const redis = getRedis();
    const version = await redis.get(key);
    return version ? parseInt(version, 10) : 1;
  } catch (e) {
    metrics.errors++;
    return 1;
  }
}

async function getOrSet(key, fn, ttl) {
  const cached = await get(key);
  if (cached !== null) return cached;
  
  const value = await fn();
  if (value !== null && value !== undefined) {
    await set(key, value, ttl);
  }
  return value;
}

async function invalidateEntity(entityType, entityId) {
  const patterns = [];
  switch (entityType) {
    case 'user':
      patterns.push(`user:profile:${entityId}`);
      patterns.push(`user:kyc:${entityId}`);
      patterns.push(`user:wallet:${entityId}`);
      patterns.push(`wallet:balance:${entityId}`);
      patterns.push(`wallet:tx:${entityId}:*`);
      patterns.push(`sub:status:${entityId}`);
      patterns.push(`kyc:status:${entityId}`);
      break;
    case 'batch':
      patterns.push(`carbon:batches:*`);
      patterns.push(`carbon:listings:*`);
      patterns.push(`carbon:stats`);
      patterns.push(`market:listings:*`);
      patterns.push(`market:stats`);
      break;
    case 'trade':
      patterns.push(`market:stats`);
      patterns.push(`carbon:stats`);
      break;
    case 'subscription':
      patterns.push(`sub:status:${entityId}`);
      patterns.push(`sub:prices`);
      break;
    case 'market':
      patterns.push('market:stats');
      patterns.push('market:listings:*');
      break;
    case 'carbon':
      patterns.push('carbon:stats');
      patterns.push('carbon:batches:*');
      patterns.push('carbon:listings:*');
      patterns.push('market:listings:*');
      patterns.push('market:stats');
      break;
  }
  logger.info({ entityType, entityId, patterns }, 'Cache invalidation requested');
}

async function getUserProfile(userId) {
  const key = `user:profile:${userId}`;
  return getOrSet(key, async () => {
    const { safeQuery: query } = require('../db/pool');
    const { rows } = await query(
      `SELECT id, email, full_name, role, wallet_address, kyc_status, kyc_verified,
              inr_balance, inr_balance_locked, subscription_plan, subscription_cycle,
              subscription_renewal_date, subscription_activated_at, is_active, frozen,
              company_name, company_gstin, company_pan, company_cin, corporate_managed
       FROM users WHERE id = $1`, [userId]
    );
    return rows[0] || null;
  }, TTL.USER_PROFILE);
}

async function getMarketListings(params = {}) {
  const key = KEYS.marketListings(params);
  return getOrSet(key, async () => {
    const { safeQuery: query } = require('../db/pool');
    const { standard, projectType, sortBy } = params;
    const sqlParams = [];
    let whereExtra = '';
    if (params.standard && params.standard !== 'ALL') {
      sqlParams.push(params.standard);
      whereExtra += ` AND cb.standard = $${sqlParams.length}`;
    }
    if (params.projectType && params.projectType !== 'ALL') {
      sqlParams.push(params.projectType);
      whereExtra += ` AND cb.project_type = $${sqlParams.length}`;
    }
    const sortMap = {
      priceAsc: 'll.price_per_credit_inr ASC',
      priceDesc: 'll.price_per_credit_inr DESC',
      amount: 'll.amount_remaining DESC',
      vintage: 'cb.vintage_year DESC',
      name: 'cb.project_name ASC',
      recent: 'll.created_at DESC',
    };
    const orderClause = sortMap[params.sortBy] || 'll.price_per_credit_inr ASC';
    // Ledger-based (pooled custody) listings only
    const { rows } = await query(
      `SELECT ll.id AS listing_id,
              cb.project_name AS "projectName",
              cb.project_location AS "projectLocation",
              cb.country,
              cb.standard,
              cb.project_type AS "projectType",
              cb.developer,
              cb.vintage_year AS "vintageYear",
              cb.registry_serial AS "serialNumber",
              ll.amount_remaining AS amount,
              ll.price_per_credit_inr AS "pricePerUnitINR",
              NULL AS "lastTradedPriceINR",
              cb.token_id AS "tokenId",
              0 AS "vintageDiscount",
              0 AS "totalRetired",
              EXTRACT(EPOCH FROM ll.expires_at)::bigint AS "expiresAt",
              u.wallet_address AS seller,
              ll.created_at AS "updatedAt",
              'ledger' AS "listingType",
              ll.id AS "listingId"
       FROM ledger_listings ll
       JOIN carbon_batches cb ON cb.token_id = ll.token_id
       JOIN users u ON u.id = ll.seller_id
       WHERE ll.active = TRUE
         AND cb.admin_status = 'approved'
         AND ll.amount_remaining > 0
         AND (ll.expires_at IS NULL OR ll.expires_at > NOW())
         ${whereExtra}
       ORDER BY ${orderClause}
       LIMIT 200`,
      sqlParams
    );

    return rows.map(r => ({
      ...r,
      adjPrice: r.pricePerUnitINR ? r.pricePerUnitINR / 280000 : 0,
    }));
  }, TTL.MARKET_LISTINGS);
}

async function getMarketStats() {
  const key = KEYS.marketStats();
  return getOrSet(key, async () => {
    const { safeQuery: query } = require('../db/pool');
    const [volume, count, listings, retired] = await Promise.all([
      query(`SELECT COALESCE(SUM(subtotal_inr), 0) AS total FROM trades WHERE status = 'completed'`),
      query(`SELECT COUNT(*) FROM trades WHERE status = 'completed'`),
      query(`SELECT COUNT(*) FROM ledger_listings WHERE active = TRUE AND amount_remaining > 0 AND (expires_at IS NULL OR expires_at > NOW())`),
      query(`SELECT COALESCE(SUM(retired_credits), 0) AS total FROM carbon_batches`),
    ]);
    return {
      totalVolumeINR: parseFloat(volume.rows[0].total),
      totalTrades: parseInt(count.rows[0].count, 10),
      activeListings: parseInt(listings.rows[0].count, 10),
      totalRetired: parseInt(retired.rows[0].total, 10),
    };
  }, TTL.MARKET_STATS);
}

async function getWalletBalance(userId) {
  const key = KEYS.walletBalance(userId);
  return getOrSet(key, async () => {
    const { safeQuery: query } = require('../db/pool');
    const { rows } = await query(
      'SELECT inr_balance, inr_balance_locked FROM users WHERE id = $1',
      [userId]
    );
    return rows[0] ? { balance: parseFloat(rows[0].inr_balance), locked: parseFloat(rows[0].inr_balance_locked) } : null;
  }, TTL.WALLET_BALANCE);
}

async function getEmissionsSummary(req, year, scope) {
  const cacheKey = `emissions:summary:${scope.value}:${year}`;
  return getOrSet(cacheKey, async () => {
    const { safeQuery: query } = require('../db/pool');
    const [scopeRows, monthRows, catRows, prevYearRow, s2DetailRows] = await Promise.all([
      query(`SELECT scope, COALESCE(SUM(co2e),0) AS total_co2e, COUNT(*) AS records
             FROM emission_activities WHERE ${scope.clause} AND EXTRACT(YEAR FROM date)=$2
             GROUP BY scope ORDER BY scope`, [scope.value, year]),
      query(`SELECT EXTRACT(MONTH FROM date)::int AS month, scope, COALESCE(SUM(co2e),0) AS total_co2e
             FROM emission_activities WHERE ${scope.clause} AND EXTRACT(YEAR FROM date)=$2
             GROUP BY month, scope ORDER BY month, scope`, [scope.value, year]),
      query(`SELECT category, COALESCE(SUM(co2e),0) AS total_co2e
             FROM emission_activities WHERE ${scope.clause} AND EXTRACT(YEAR FROM date)=$2 AND category IS NOT NULL
             GROUP BY category ORDER BY total_co2e DESC LIMIT 10`, [scope.value, year]),
      query(`SELECT COALESCE(SUM(co2e),0) AS total_co2e
             FROM emission_activities WHERE ${scope.clause} AND EXTRACT(YEAR FROM date)=$2`,
             [scope.value, year - 1]),
      query(`SELECT
                COALESCE(SUM(co2e) FILTER (WHERE category ILIKE '%Location-based%'),0) AS scope2_location,
                COALESCE(SUM(co2e) FILTER (WHERE category ILIKE '%Market-based%'),  0) AS scope2_market
              FROM emission_activities WHERE ${scope.clause} AND EXTRACT(YEAR FROM date)=$2 AND scope=2`,
             [scope.value, year]),
    ]);
    const s    = (sc) => parseFloat(scopeRows.rows.find(r => r.scope === sc)?.total_co2e || 0);
    const scope1 = s(1), scope2 = s(2), scope3 = s(3);
    const total  = scope1 + scope2 + scope3;
    const prevTotal  = parseFloat(prevYearRow.rows[0]?.total_co2e || 0);
    const yoyChange  = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;
    const scope2Location = parseFloat(s2DetailRows.rows[0]?.scope2_location || 0);
    const scope2Market   = parseFloat(s2DetailRows.rows[0]?.scope2_market   || 0);
    return {
      year, scope1, scope2, scope3, total,
      scope2Location: scope2Location || scope2, scope2Market,
      creditsNeeded: Math.ceil(total), yoyChange, prevYearTotal: prevTotal,
      scopeBreakdown: scopeRows.rows, monthlyTrend: monthRows.rows,
      categoryBreakdown: catRows.rows,
      meta: {
        gridEmissionFactor: 0.727,
        gridEFKwh:          0.000727,
        gridEFSource:       'CEA V20.0 Dec 2024 (FY 2023-24 weighted average)',
        generatedAt:        new Date().toISOString(),
      },
    };
  }, TTL.EMISSIONS_SUMMARY || 60);
}

function getMetrics() {
  return { ...metrics };
}

function resetMetrics() {
  metrics.hits = 0;
  metrics.misses = 0;
  metrics.sets = 0;
  metrics.errors = 0;
  metrics.evictions = 0;
}

module.exports = {
  TTL,
  KEYS,
  get,
  set,
  del,
  delPattern,
  invalidatePrefix,
  invalidate,
  getOrSet,
  invalidateEntity,
  getMetrics,
  resetMetrics,
  getUserProfile,
  getMarketStats,
  getMarketListings,
  getWalletBalance,
  getEmissionsSummary,
  incrementPortfolioVersion,
  getPortfolioVersion,
};