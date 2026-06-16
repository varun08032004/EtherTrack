/**
 * utils/dashboard.js
 *
 * Pure utility functions — no React, no side-effects.
 * All exported functions have corresponding test stubs in __tests__/utils.test.js
 */

import { FETCH_TIMEOUT_MS, ALLOWED_NEWS_TAGS, TAG_COLORS, ALLOWED_WALLET_HOSTS } from '../constants/dashboard';

// ── Formatting ──────────────────────────────────────────────────────────────

/**
 * Format a number as Indian-locale INR string.
 * Returns '—' for non-finite input (never renders "NaN" or "undefined" to users).
 * @param {number} n
 * @param {number} [decimals=0]
 * @returns {string}
 */
export function fmt(n, decimals = 0) {
  if (!Number.isFinite(n)) return '—';
  return `₹${Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * Return relative time label for a timestamp.
 * @param {number|null} ts - Unix ms
 * @returns {string|null}
 */
export function timeAgo(ts) {
  if (!ts || !Number.isFinite(ts)) return null;
  const s = Math.floor((Date.now() - ts) / 1_000);
  if (s < 5)    return 'just now';
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/**
 * Minutes elapsed since a timestamp.
 * @param {number|null} ts
 * @returns {number|null}
 */
export function minutesOld(ts) {
  if (!ts || !Number.isFinite(ts)) return null;
  return Math.floor((Date.now() - ts) / 60_000);
}

/**
 * Days remaining until an ISO date string.
 * Returns null for invalid input.
 * Returns negative values for past dates (already expired).
 * @param {string|null} isoDateString
 * @returns {number|null}
 */
export function daysUntil(isoDateString) {
  if (!isoDateString) return null;
  const diff = new Date(isoDateString).getTime() - Date.now();
  if (!Number.isFinite(diff)) return null;
  return Math.ceil(diff / 86_400_000);
}

/**
 * Derive greeting from hour of day.
 * @param {number} hour - 0–23
 * @returns {string}
 */
export function getGreeting(hour) {
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

// ── News ────────────────────────────────────────────────────────────────────

/**
 * Sanitize a news item from the API — allowlist the tag, truncate strings.
 * Does NOT call dangerouslySetInnerHTML anywhere — React JSX escapes text nodes.
 */
export function sanitizeNewsItem(n) {
  return {
    ...n,
    tag:    ALLOWED_NEWS_TAGS.has(String(n.tag)) ? String(n.tag) : 'MARKET',
    title:  String(n.title  || '').slice(0, 200),
    source: String(n.source || '').slice(0, 60),
    url:    sanitizeUrl(n.url),
  };
}

// ── Security ────────────────────────────────────────────────────────────────

/**
 * Validate and allowlist a URL before opening externally.
 * Only allows https: protocol and known news domains.
 * Returns null for anything that fails validation.
 */
const ALLOWED_NEWS_DOMAINS = new Set([
  'pib.gov.in', 'beeindia.gov.in', 'carbon-pulse.com',
  'unfccc.int', 'coindesk.com', 'ccts.gov.in', 'sebi.gov.in',
  'thehindu.com', 'livemint.com', 'businessstandard.com',
  'moneycontrol.com', 'economictimes.indiatimes.com',
]);

export function sanitizeUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    if (parsed.protocol !== 'https:') return null;
    const hostname = parsed.hostname.replace(/^www\./, '');
    const allowed = [...ALLOWED_NEWS_DOMAINS].some(
      (d) => hostname === d || hostname.endsWith('.' + d),
    );
    return allowed ? parsed.href : null;
  } catch {
    return null;
  }
}

export function safeOpen(url) {
  const safe = sanitizeUrl(url);
  if (!safe) return;
  window.open(safe, '_blank', 'noopener,noreferrer');
}

/**
 * Check whether the current hostname is allowed to initiate wallet connections.
 * UX-only gate — enforce the same check server-side.
 */
export function isWalletHostAllowed() {
  const host = window.location.hostname;
  return (
    host === 'localhost'
    || host === '127.0.0.1'
    || ALLOWED_WALLET_HOSTS.includes(host)
    || ALLOWED_WALLET_HOSTS.some((h) => host.endsWith('.' + h))
  );
}

// ── Async helpers ───────────────────────────────────────────────────────────

/**
 * Race a promise against a timeout.
 * Throws an Error('timeout') when the deadline is exceeded.
 */
export function fetchWithTimeout(promiseFn, ms = FETCH_TIMEOUT_MS) {
  return Promise.race([
    promiseFn(),
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error('timeout')), ms),
    ),
  ]);
}

/**
 * Retry an async operation with exponential backoff + jitter.
 * Skips retries on session-expired or timeout errors.
 *
 * @param {() => Promise<T>} fn
 * @param {object} opts
 * @param {number} opts.attempts   - max attempts (default 3)
 * @param {number} opts.baseMs     - base delay in ms (default 500)
 * @returns {Promise<T>}
 */
export async function withRetry(fn, { attempts = 3, baseMs = 500 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Don't retry on auth or intentional errors
      if (err?.message === 'session-expired' || err?.message === 'timeout') throw err;
      if (i < attempts - 1) {
        const delay = baseMs * 2 ** i + Math.random() * 200;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// ── Financial calculations ──────────────────────────────────────────────────

/**
 * Calculate emission offset percentage.
 * Returns 100 if credits retired but no emissions logged (special state).
 * Returns 0 if neither is populated.
 * @returns {{ pct: number, creditsRetiredButNoEmissions: boolean }}
 */
export function calcEmissionOffset(totalEmitted, userRetired) {
  if (userRetired > 0 && totalEmitted === 0) {
    return { pct: 100, creditsRetiredButNoEmissions: true };
  }
  if (totalEmitted > 0 && userRetired > 0) {
    return {
      pct: Math.min(Math.round((userRetired / totalEmitted) * 100), 100),
      creditsRetiredButNoEmissions: false,
    };
  }
  return { pct: 0, creditsRetiredButNoEmissions: false };
}

/**
 * Calculate P&L from cost basis and current value.
 * Returns null if cost basis is unknown or zero.
 * @returns {{ pnl: number, pnlPct: string } | null}
 */
export function calcPnL(totalPortfolioValue, costBasis) {
  if (!Number.isFinite(costBasis) || costBasis <= 0) return null;
  if (!Number.isFinite(totalPortfolioValue)) return null;
  const pnl = totalPortfolioValue - costBasis;
  const pnlPct = ((pnl / costBasis) * 100).toFixed(1);
  return { pnl, pnlPct };
}

/**
 * Build portfolio breakdown array from active credits.
 * @param {Array} activeCredits
 * @returns {Array<{ name, std, credits, color, pct }>}
 */
const BREAKDOWN_COLORS = ['#22c55e', '#4ade80', '#facc15', '#a78bfa'];
export function buildPortfolioBreakdown(activeCredits) {
  const total = activeCredits.reduce((sum, x) => sum + (x.credits || 0), 0) || 1;
  return activeCredits.slice(0, 4).map((c, i) => ({
    name:    c.projectName,
    std:     c.standard,
    credits: c.credits,
    color:   BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length],
    pct:     +((c.credits / total) * 100).toFixed(1),
  }));
}

// ── Tag color helper ────────────────────────────────────────────────────────
export function getTagColor(tag) {
  return TAG_COLORS[tag] || TAG_COLORS.MARKET;
}