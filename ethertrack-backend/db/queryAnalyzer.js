// db/queryAnalyzer.js — EtherTrack
// Query performance analysis and slow query detection
'use strict';

const { pool } = require('./pool');

// Track query execution times
const queryStats = new Map();
const SLOW_QUERY_THRESHOLD_MS = 1000; // 1 second

function recordQuery(text, durationMs) {
  const normalized = normalizeQuery(text);
  const existing = queryStats.get(normalized) || { count: 0, totalMs: 0, maxMs: 0, lastSeen: null };
  
  existing.count++;
  existing.totalMs += durationMs;
  existing.maxMs = Math.max(existing.maxMs, durationMs);
  existing.lastSeen = new Date().toISOString();
  
  queryStats.set(normalized, existing);
  
  if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
    console.warn(`[SLOW QUERY] ${durationMs}ms: ${text.slice(0, 200)}`);
  }
}

function normalizeQuery(text) {
  // Normalize query for grouping (remove values, normalize whitespace)
  return text
    .replace(/\$\d+/g, '$?')  // Parameter placeholders
    .replace(/\s+/g, ' ')     // Whitespace
    .trim()
    .slice(0, 500);           // Limit length
}

function getSlowQueries(limit = 20) {
  return Array.from(queryStats.entries())
    .map(([query, stats]) => ({
      query,
      count: stats.count,
      avgMs: Math.round(stats.totalMs / stats.count),
      maxMs: stats.maxMs,
      lastSeen: stats.lastSeen,
    }))
    .sort((a, b) => b.maxMs - a.maxMs)
    .slice(0, limit);
}

function getTopQueriesByCount(limit = 20) {
  return Array.from(queryStats.entries())
    .map(([query, stats]) => ({
      query,
      count: stats.count,
      avgMs: Math.round(stats.totalMs / stats.count),
      totalMs: stats.totalMs,
      lastSeen: stats.lastSeen,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function resetStats() {
  queryStats.clear();
}

// Wrapper that records timing
const trackedQuery = async (text, params = []) => {
  const start = process.hrtime.bigint();
  try {
    const result = await require('./pool').safeQuery(text, params);
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    recordQuery(text, durationMs);
    return result;
  } catch (err) {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    recordQuery(text, durationMs);
    throw err;
  }
};

module.exports = {
  trackedQuery,
  getSlowQueries,
  getTopQueriesByCount,
  resetStats,
  SLOW_QUERY_THRESHOLD_MS,
};