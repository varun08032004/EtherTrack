// services/statsCache.js
// In-memory stats cache with built-in expiry scheduler.
//
// FIX: /api/market/stats and /api/transactions/stats fired 4 COUNT/SUM
// aggregations on every request. This cache reduces that to once per minute.
//
// Redis upgrade path:
//   This interface is intentionally async-compatible — get/set/del/has/getOrSet
//   all work as-is if you swap the backing Map for ioredis calls. The one
//   difference is that ioredis set() requires serialisation (JSON.stringify/parse)
//   and getOrSet() dedup logic must move to a Redis lock (e.g. SET NX). A
//   redis-adapter wrapper is the right upgrade path, not a drop-in replace.
//
// Built-in scheduler:
//   purgeExpired() runs every PURGE_INTERVAL_MS automatically.
//   No external scheduler needed.

'use strict';

const DEFAULT_TTL_SEC    = parseInt(process.env.STATS_CACHE_DEFAULT_TTL || '60',    10);
const PURGE_INTERVAL_MS  = parseInt(process.env.STATS_CACHE_PURGE_MS    || '120000', 10); // 2 min
const MIN_TTL_SEC        = 1; // guard against zero/negative TTL footgun

const _cache    = new Map(); // key → { value, expiresAt, cachedAt }
const _inflight = new Map(); // key → Promise (dedup concurrent getOrSet callers)

// ── Internal helpers ──────────────────────────────────────────────────────────

function _isExpired(entry) {
  return Date.now() > entry.expiresAt;
}

function _resolvedSize() {
  // Count only non-expired entries — what health checks actually care about
  let n = 0;
  for (const entry of _cache.values()) {
    if (!_isExpired(entry)) n++;
  }
  return n;
}

// ── Public interface ──────────────────────────────────────────────────────────

const statsCache = {

  DEFAULT_TTL: DEFAULT_TTL_SEC, // exported so callers don't have to hard-code it

  /**
   * get(key) → value | null
   * Returns null for missing or expired entries (expired entries are evicted).
   */
  get(key) {
    const entry = _cache.get(key);
    if (!entry) return null;
    if (_isExpired(entry)) {
      _cache.delete(key);
      return null;
    }
    return entry.value;
  },

  /**
   * has(key) → boolean
   * True only if the key exists and has not expired.
   */
  has(key) {
    return this.get(key) !== null;
  },

  /**
   * set(key, value, ttlSeconds?)
   * Silently clamps TTL to MIN_TTL_SEC to prevent instant-expiry footgun.
   */
  set(key, value, ttlSeconds = DEFAULT_TTL_SEC) {
    const ttl = Math.max(ttlSeconds, MIN_TTL_SEC);
    _cache.set(key, {
      value,
      expiresAt: Date.now() + ttl * 1000,
      cachedAt:  Date.now(),
    });
  },

  /**
   * del(key)
   */
  del(key) {
    _cache.delete(key);
    // If there's an in-flight promise for this key, let it finish but discard
    // its write-back so it doesn't resurrect a key we just explicitly deleted.
    _inflight.delete(key);
  },

  /**
   * getOrSet(key, asyncFn, ttlSeconds?)
   * Returns cached value if fresh. Otherwise calls asyncFn(), caches the result,
   * and returns it. Concurrent callers for the same key share one in-flight request.
   */
  async getOrSet(key, asyncFn, ttlSeconds = DEFAULT_TTL_SEC) {
    const cached = this.get(key);
    if (cached !== null) return cached;

    // Dedup: share the in-flight promise with concurrent callers
    if (_inflight.has(key)) return _inflight.get(key);

    const ttl = Math.max(ttlSeconds, MIN_TTL_SEC);

    const promise = asyncFn()
      .then(value => {
        // Only write back if the key hasn't been explicitly deleted while in-flight
        if (_inflight.has(key)) {
          _cache.set(key, {
            value,
            expiresAt: Date.now() + ttl * 1000,
            cachedAt:  Date.now(),
          });
        }
        _inflight.delete(key);
        return value;
      })
      .catch(err => {
        _inflight.delete(key);
        throw err;
      });

    _inflight.set(key, promise);
    return promise;
  },

  /**
   * getWithMeta(key) → { value, cachedAt, expiresAt, ttlRemainingMs } | null
   * Returns cache metadata for debugging and monitoring without exposing internals.
   */
  getWithMeta(key) {
    const entry = _cache.get(key);
    if (!entry || _isExpired(entry)) {
      if (entry) _cache.delete(key);
      return null;
    }
    return {
      value:          entry.value,
      cachedAt:       entry.cachedAt,
      expiresAt:      entry.expiresAt,
      ttlRemainingMs: entry.expiresAt - Date.now(),
    };
  },

  /**
   * invalidate(prefix?)
   * Clears all keys, or only keys starting with prefix.
   * Also cancels the write-back for any matching in-flight requests.
   */
  invalidate(prefix) {
    if (!prefix) {
      _cache.clear();
      _inflight.clear(); // prevent stale write-backs into a freshly cleared cache
      return;
    }
    for (const key of _cache.keys()) {
      if (key.startsWith(prefix)) _cache.delete(key);
    }
    for (const key of _inflight.keys()) {
      if (key.startsWith(prefix)) _inflight.delete(key);
    }
  },

  /**
   * purgeExpired() — evicts all expired entries.
   * Called automatically by the built-in scheduler; expose for manual use too.
   */
  purgeExpired() {
    const now = Date.now();
    for (const [key, entry] of _cache) {
      if (now > entry.expiresAt) _cache.delete(key);
    }
  },

  /**
   * size() — count of non-expired entries.
   * Health checks should use this, not the raw Map size.
   */
  size() {
    return _resolvedSize();
  },

  /**
   * stats() — summary for health/monitoring endpoints.
   */
  stats() {
    return {
      total:    _cache.size,          // includes expired-but-not-yet-evicted
      live:     _resolvedSize(),      // only fresh entries
      inflight: _inflight.size,
    };
  },
};

// ── Built-in purge scheduler ──────────────────────────────────────────────────
// Runs automatically so callers don't have to set up their own interval.
// unref() prevents this timer from keeping the process alive in test/CLI contexts.
const _purgeTimer = setInterval(() => statsCache.purgeExpired(), PURGE_INTERVAL_MS);
if (_purgeTimer.unref) _purgeTimer.unref();

module.exports = statsCache;