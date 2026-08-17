// lib/advisoryLock.js — EtherTrack
// Advisory lock helpers for idempotency and concurrency control
'use strict';

/**
 * Acquire an advisory transaction lock on a deterministic key.
 * The lock is automatically released at the end of the transaction (COMMIT/ROLLBACK).
 * 
 * @param {import('pg').PoolClient} client - Database client from pool
 * @param {string|number} key - Lock key (string will be hashed, number used directly)
 * @returns {Promise<void>}
 */
async function acquireAdvisoryLock(client, key) {
  const lockKey = typeof key === 'string' 
    ? `hashtext('${key.replace(/'/g, "''")}')`
    : key;
  await client.query(`SELECT pg_advisory_xact_lock(${lockKey})`);
}

/**
 * Acquire an advisory transaction lock on a string key using hashtext.
 * 
 * @param {import('pg').PoolClient} client - Database client from pool
 * @param {string} key - String key to lock on
 * @returns {Promise<void>}
 */
async function acquireAdvisoryLockString(client, key) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [key]);
}

/**
 * Acquire an advisory transaction lock on a numeric key.
 * 
 * @param {import('pg').PoolClient} client - Database client from pool
 * @param {number} key - Numeric key (must fit in 32-bit signed integer)
 * @returns {Promise<void>}
 */
async function acquireAdvisoryLockInt(client, key) {
  await client.query(`SELECT pg_advisory_xact_lock($1)`, [key]);
}

/**
 * Generate a deterministic 32-bit integer lock key from a string.
 * Uses a simple hash function for consistent mapping.
 * 
 * @param {string} str - String to hash
 * @returns {number} 32-bit signed integer
 */
function generateLockKey(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Ensure it's within 32-bit signed integer range
  return hash % 2147483647;
}

/**
 * Generate a deterministic lock key for idempotency operations.
 * Combines user_id and idempotency_key for user-scoped locking.
 * 
 * @param {string} userId - User UUID
 * @param {string} idempotencyKey - Idempotency key
 * @returns {number} 32-bit signed integer
 */
function generateIdempotencyLockKey(userId, idempotencyKey) {
  return generateLockKey(`${userId}:${idempotencyKey}`);
}

module.exports = {
  acquireAdvisoryLock,
  acquireAdvisoryLockString,
  acquireAdvisoryLockInt,
  generateLockKey,
  generateIdempotencyLockKey,
};