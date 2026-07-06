// services/redis.js — EtherTrack · Upstash Redis HTTP client
// Replaces ioredis with @upstash/redis (HTTP-based).
// Zero persistent TCP connection = zero heartbeat/reconnect commands.
// Falls back to no-op if env vars are missing so app never crashes.
'use strict';

const logger = require('./logger');

// ── No-op fallback ────────────────────────────────────────────────────────────
// Used when Upstash env vars are not set (local dev without Redis).
const NOOP_CLIENT = {
  get:    async () => null,
  set:    async () => 'OK',
  setex:  async (key, ttl, val) => 'OK', // compat shim — maps to set with ex
  del:    async () => 1,
  exists: async () => 0,
  ping:   async () => 'PONG',
};

// ── Upstash client singleton ──────────────────────────────────────────────────
let client = null;

const createClient = () => {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    logger.warn('UPSTASH_REDIS_REST_URL / TOKEN not set — Redis caching disabled, using no-op fallback');
    return NOOP_CLIENT;
  }

  // @upstash/redis is HTTP — no persistent connection, no heartbeats, no polling.
  // Every call is a single REST request = exactly 1 Upstash command.
  const { Redis } = require('@upstash/redis');
  const redis = new Redis({ url, token });

  // Wrap with a setex shim so kyc.js callers need zero changes.
  // Upstash SDK uses redis.set(key, val, { ex: ttl }) instead of setex.
  const wrapped = {
    get:    (key)           => redis.get(key),
    set:    (key, val, opts)=> redis.set(key, val, opts),
    setex:  (key, ttl, val) => redis.set(key, val, { ex: ttl }),
    del:    (key)           => redis.del(key),
    exists: (key)           => redis.exists(key),
    ping:   ()              => redis.ping(),
  };

  logger.info('redis.upstash_client_created (HTTP mode, zero persistent connection)');
  return wrapped;
};

/** Return Redis client — always safe to call (falls back to no-op) */
const getRedis = () => {
  if (!client) client = createClient();
  return client;
};

/** No-op — kept for API compatibility. Upstash HTTP has no connection to close. */
const closeRedis = async () => {
  client = null;
};

module.exports = { getRedis, closeRedis };