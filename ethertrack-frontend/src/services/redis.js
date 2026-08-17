// services/redis.js — EtherTrack · Redis client with fallback - 08/06/2026
// Uses ioredis with auto-reconnect and a graceful no-op fallback
// so the app degrades (no caching) rather than crashes if Redis is down.


const Redis  = require('ioredis');
const logger = require('./logger');

let client = null;
let healthy = false;

// No-op fallback used when Redis is unavailable
const NOOP_CLIENT = {
  get:    async () => null,
  set:    async () => 'OK',
  setex:  async () => 'OK',
  del:    async () => 1,
  exists: async () => 0,
  ping:   async () => 'PONG',
};

const createClient = () => {
  if (!process.env.REDIS_URL) {
    logger.warn('REDIS_URL not set — Redis caching disabled, using no-op fallback');
    return NOOP_CLIENT;
  }

  const redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 2,
    tls: process.env.REDIS_URL.startsWith('rediss://') ? {} : undefined,
    retryStrategy: (times) => {
      if (times > 10) return null; // stop retrying after 10 attempts
      return Math.min(times * 200, 3000);
    },
    reconnectOnError: (err) => {
      const targetErrors = ['READONLY', 'ECONNREFUSED'];
      return targetErrors.some(e => err.message.includes(e));
    },
    lazyConnect:        true,
    enableOfflineQueue: false,
    keyPrefix:          `ethertrack:${process.env.NODE_ENV || 'dev'}:`,
  });

  redis.on('connect',      () => { healthy = true;  logger.info('redis.connected'); });
  redis.on('ready',        () => { healthy = true;  logger.info('redis.ready'); });
  redis.on('error', (err)  => { healthy = false; logger.warn({ err }, 'redis.error'); });
  redis.on('close',        () => { healthy = false; logger.warn('redis.connection_closed'); });
  redis.on('reconnecting', () => logger.info('redis.reconnecting'));

  redis.connect().catch(() => {}); // non-fatal
  return redis;
};

/** Return Redis client — always safe to call (falls back to no-op) */
const getRedis = () => {
  if (!client) client = createClient();
  // If ioredis client but unhealthy, return no-op so callers don't throw
  if (!healthy && client !== NOOP_CLIENT) return NOOP_CLIENT;
  return client;
};

/** Graceful shutdown */
const closeRedis = async () => {
  if (client && client !== NOOP_CLIENT) {
    await client.quit().catch(() => {});
    client = null;
    healthy = false;
  }
};

module.exports = { getRedis, closeRedis };