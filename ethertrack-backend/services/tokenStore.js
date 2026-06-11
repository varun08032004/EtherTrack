// services/tokenStore.js
// Memory-only session token store — tokens never touch disk, localStorage, or logs.
//
// Design notes:
//   - One active token per userId (second login silently supersedes the first).
//     If multi-device support is needed, change the store to userId → Set<entry>.
//   - Survives process restart gracefully: clients re-authenticate via
//     /api/auth/refresh which issues a new access token from the httpOnly
//     refresh cookie.
//   - Timing-safe comparison via crypto.timingSafeEqual for isValid().
//   - Built-in purge scheduler — no external cron needed.
//   - EventEmitter interface for security incident hooks.
//
// USAGE:
//   tokenStore.set(userId, token, ttlSeconds?)   → void (throws on bad input)
//   tokenStore.get(userId)                        → token | null
//   tokenStore.has(userId)                        → boolean
//   tokenStore.isValid(userId, token)             → boolean (timing-safe)
//   tokenStore.revoke(userId)                     → boolean (true if existed)
//   tokenStore.revokeAll()                        → number (count revoked)
//   tokenStore.getMetadata(userId)                → { expiresAt, issuedAt } | null
//   tokenStore.size()                             → non-expired session count
//   tokenStore.on('revoke:all', cb)               → EventEmitter

'use strict';

const crypto       = require('crypto');
const EventEmitter = require('events');

const DEFAULT_TTL_SEC = parseInt(process.env.TOKEN_STORE_DEFAULT_TTL || '900',    10); // 15 min
const MIN_TTL_SEC     = 1;
const PURGE_INTERVAL  = parseInt(process.env.TOKEN_STORE_PURGE_MS    || '300000', 10); // 5 min

const _store   = new Map(); // userId (string) → { token, expiresAt, issuedAt }
const _emitter = new EventEmitter();
_emitter.setMaxListeners(20);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalise userId to a non-empty string or throw. */
function _uid(userId) {
  const s = String(userId ?? '').trim();
  if (!s) throw new TypeError('tokenStore: userId must be a non-empty string');
  return s;
}

/** Timing-safe string equality using Buffer comparison. */
function _safeEqual(a, b) {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    // Buffers must be the same length for timingSafeEqual — pad to equal length
    // using a fixed-length hash to avoid length-leaking timing differences.
    const ha = crypto.createHash('sha256').update(ba).digest();
    const hb = crypto.createHash('sha256').update(bb).digest();
    return crypto.timingSafeEqual(ha, hb);
  } catch {
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

const tokenStore = {

  /**
   * Store an access token for a user.
   * Throws TypeError on missing/empty userId or token.
   * Clamps TTL to MIN_TTL_SEC to prevent instant-expiry footgun.
   */
  set(userId, token, ttlSeconds = DEFAULT_TTL_SEC) {
    const uid = _uid(userId);
    if (!token || typeof token !== 'string')
      throw new TypeError('tokenStore: token must be a non-empty string');

    const ttl = Math.max(ttlSeconds, MIN_TTL_SEC);
    _store.set(uid, {
      token,
      expiresAt: Date.now() + ttl * 1000,
      issuedAt:  Date.now(),
    });
  },

  /**
   * Retrieve a token — returns null if missing or expired (expired entries evicted).
   */
  get(userId) {
    const uid   = _uid(userId);
    const entry = _store.get(uid);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      _store.delete(uid);
      return null;
    }
    return entry.token;
  },

  /**
   * Check if a valid (non-expired) token exists for a user.
   */
  has(userId) {
    return this.get(userId) !== null;
  },

  /**
   * Check if a specific token is valid for a user.
   * Uses timing-safe comparison to prevent timing-based token enumeration.
   */
  isValid(userId, token) {
    const stored = this.get(userId);
    if (!stored) return false;
    if (!token || typeof token !== 'string') return false;
    return _safeEqual(stored, token);
  },

  /**
   * Revoke a user's token (logout).
   * Returns true if a token existed and was removed, false if already absent.
   */
  revoke(userId) {
    const uid = _uid(userId);
    const had = _store.has(uid);
    _store.delete(uid);
    return had;
  },

  /**
   * Revoke all tokens — use on security incident.
   * Returns the number of sessions revoked.
   * Emits 'revoke:all' for security incident hooks.
   */
  revokeAll() {
    const count = _store.size;
    _store.clear();
    console.warn(`[tokenStore] All ${count} sessions revoked`);
    _emitter.emit('revoke:all', { count, revokedAt: new Date() });
    return count;
  },

  /**
   * Inspect metadata for a session without returning the token itself.
   * Returns null if missing or expired.
   */
  getMetadata(userId) {
    const uid   = _uid(userId);
    const entry = _store.get(uid);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      _store.delete(uid);
      return null;
    }
    return {
      issuedAt:       entry.issuedAt,
      expiresAt:      entry.expiresAt,
      ttlRemainingMs: entry.expiresAt - Date.now(),
    };
  },

  /**
   * Purge expired entries. Called automatically by the built-in scheduler.
   * Returns the number of entries purged.
   */
  purgeExpired() {
    const now = Date.now();
    let purged = 0;
    for (const [key, entry] of _store) {
      if (now > entry.expiresAt) {
        _store.delete(key);
        purged++;
      }
    }
    return purged;
  },

  /**
   * Count of non-expired sessions — for health endpoints.
   * Does not evict; call purgeExpired() first for an exact count.
   */
  size() {
    const now = Date.now();
    let n = 0;
    for (const entry of _store.values()) {
      if (now <= entry.expiresAt) n++;
    }
    return n;
  },

  // ── EventEmitter passthrough ─────────────────────────────────────────────
  // Events: 'revoke:all' → { count, revokedAt }

  on(event, listener)  { _emitter.on(event, listener); },
  off(event, listener) { _emitter.off(event, listener); },
  once(event, listener){ _emitter.once(event, listener); },
};

// ── Built-in purge scheduler ──────────────────────────────────────────────────
const _purgeTimer = setInterval(() => tokenStore.purgeExpired(), PURGE_INTERVAL);
if (_purgeTimer.unref) _purgeTimer.unref();

module.exports = tokenStore;