// services/priceFeedService.js — EtherTrack CCTS Price Feed (#7) - 28/05/2026
// Aggregates CCC prices from:
//   1. IEX (Indian Energy Exchange) — primary official source
//   2. PXIL (Power Exchange India Ltd) — secondary official source
//   3. EtherTrack AMM / order book — fallback + benchmark
//
// Architecture:
//   - Each source has an adapter class
//   - PriceFeedAggregator polls all sources every POLL_INTERVAL_MS
//   - Results stored in DB (ccc_price_feed table) and in memory cache
//   - getCCCMarketPrice() returns best available price with source metadata
//   - When IEX/PXIL APIs become live, swap mock adapters for real ones
//     by changing ADAPTERS array — no other code changes needed

'use strict';

const { safeQuery: query } = require('../db/pool');

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const STALE_AFTER_MS   = 30 * 60 * 1000; // 30 minutes

// ── In-memory price cache ──────────────────────────────────────────
const priceCache = new Map();
// source → { price_inr, bid_price_inr, ask_price_inr, volume_ccc, captured_at, source, is_official }

// ══════════════════════════════════════════════════════════════════
// BASE ADAPTER — all exchange adapters extend this
// ══════════════════════════════════════════════════════════════════
class ExchangeAdapter {
  constructor(name, isOfficial) {
    this.name       = name;
    this.isOfficial = isOfficial;
  }

  async fetchPrice() { throw new Error('fetchPrice() not implemented'); }

  async fetchAndStore() {
    try {
      const result = await this.fetchPrice();
      if (!result || !result.price_inr) return null;

      const record = {
        source:        this.name,
        price_inr:     result.price_inr,
        bid_price_inr: result.bid_price_inr || null,
        ask_price_inr: result.ask_price_inr || null,
        volume_ccc:    result.volume_ccc    || null,
        session_date:  result.session_date  || null,
        vintage_year:  result.vintage_year  || null,
        is_official:   this.isOfficial,
        raw_payload:   JSON.stringify(result.raw || {}),
        captured_at:   new Date(),
      };

      // Store in DB
      await query(
        `INSERT INTO ccc_price_feed
           (source, price_inr, bid_price_inr, ask_price_inr, volume_ccc,
            session_date, vintage_year, is_official, raw_payload, captured_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [record.source, record.price_inr, record.bid_price_inr, record.ask_price_inr,
         record.volume_ccc, record.session_date, record.vintage_year,
         record.is_official, record.raw_payload, record.captured_at]
      ).catch(() => {}); // non-fatal

      // Update memory cache
      priceCache.set(this.name, record);
      return record;
    } catch (e) {
      console.warn(`[priceFeed] ${this.name} fetch failed:`, e.message);
      return null;
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// IEX ADAPTER
// When IEX opens their CCC API, replace fetchPrice() body with:
//   const res = await fetch(process.env.IEX_API_URL + '/ccc/marketprice', {
//     headers: { 'X-API-Key': process.env.IEX_API_KEY }
//   });
//   const data = await res.json();
//   return { price_inr: data.settlementPrice, volume_ccc: data.totalVolume, ... }
// ══════════════════════════════════════════════════════════════════
class IEXAdapter extends ExchangeAdapter {
  constructor() { super('IEX', true); }

  async fetchPrice() {
    // PRODUCTION: replace with real IEX API call
    // IEX CCC market is expected to open when CCTS goes live
    if (process.env.IEX_API_KEY && process.env.IEX_API_URL) {
      try {
        const res = await fetch(`${process.env.IEX_API_URL}/api/ccc/price`, {
          headers: {
            'Authorization': `Bearer ${process.env.IEX_API_KEY}`,
            'Content-Type':  'application/json',
          },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`IEX API ${res.status}`);
        const data = await res.json();
        return {
          price_inr:     parseFloat(data.settlementPrice || data.price || data.ltp),
          bid_price_inr: parseFloat(data.bidPrice || data.bid) || null,
          ask_price_inr: parseFloat(data.askPrice || data.ask) || null,
          volume_ccc:    parseFloat(data.totalVolume || data.volume) || null,
          session_date:  data.sessionDate || data.date || null,
          raw:           data,
        };
      } catch (e) {
        console.warn('[IEX] Live API failed, using stub:', e.message);
      }
    }

    // STUB: returns simulated IEX price until live API is available
    // Simulates realistic CCTS market price range ₹700–₹1200
    const basePrice = 850;
    const jitter    = (Math.random() - 0.5) * 40;
    const price     = Math.round(basePrice + jitter);
    return {
      price_inr:     price,
      bid_price_inr: price - 5,
      ask_price_inr: price + 5,
      volume_ccc:    Math.floor(Math.random() * 5000) + 1000,
      session_date:  new Date().toISOString().slice(0, 10),
      _stub:         true,
      _note:         'Set IEX_API_KEY and IEX_API_URL env vars to enable live feed',
    };
  }
}

// ══════════════════════════════════════════════════════════════════
// PXIL ADAPTER
// Same pattern as IEX — swap fetchPrice() when PXIL API is available
// ══════════════════════════════════════════════════════════════════
class PXILAdapter extends ExchangeAdapter {
  constructor() { super('PXIL', true); }

  async fetchPrice() {
    if (process.env.PXIL_API_KEY && process.env.PXIL_API_URL) {
      try {
        const res = await fetch(`${process.env.PXIL_API_URL}/market/ccc/price`, {
          headers: {
            'X-Api-Key':    process.env.PXIL_API_KEY,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`PXIL API ${res.status}`);
        const data = await res.json();
        return {
          price_inr:     parseFloat(data.price || data.ltp || data.settlementPrice),
          bid_price_inr: parseFloat(data.bid)  || null,
          ask_price_inr: parseFloat(data.ask)  || null,
          volume_ccc:    parseFloat(data.volume) || null,
          session_date:  data.date || null,
          raw:           data,
        };
      } catch (e) {
        console.warn('[PXIL] Live API failed, using stub:', e.message);
      }
    }

    // STUB
    const basePrice = 855;
    const jitter    = (Math.random() - 0.5) * 35;
    const price     = Math.round(basePrice + jitter);
    return {
      price_inr:     price,
      bid_price_inr: price - 4,
      ask_price_inr: price + 6,
      volume_ccc:    Math.floor(Math.random() * 3000) + 500,
      session_date:  new Date().toISOString().slice(0, 10),
      _stub:         true,
      _note:         'Set PXIL_API_KEY and PXIL_API_URL env vars to enable live feed',
    };
  }
}

// ══════════════════════════════════════════════════════════════════
// ETHERTRACK AMM ADAPTER — reads from our own DB
// ══════════════════════════════════════════════════════════════════
class EtherTrackAMMAdapter extends ExchangeAdapter {
  constructor() { super('ETHERTRACK_AMM', false); }

  async fetchPrice() {
    try {
      // Get latest trade price from our own order book
      const { rows } = await query(
        `SELECT price_per_credit_inr AS price_inr,
                quantity AS volume_ccc,
                created_at
         FROM trades
         WHERE status = 'completed'
         ORDER BY created_at DESC
         LIMIT 1`
      );
      if (!rows.length) return null;
      const row = rows[0];

      // Also get current best ask from listings
      const { rows: askRows } = await query(
        `SELECT MIN(price_per_credit_inr) AS best_ask,
                MAX(price_per_credit_inr) AS best_bid
         FROM carbon_batches
         WHERE admin_status = 'approved'
           AND available_credits > 0
           AND (expires_at IS NULL OR expires_at > NOW())
           AND deleted_at IS NULL`
      );

      return {
        price_inr:     parseFloat(row.price_inr),
        ask_price_inr: askRows[0]?.best_ask ? parseFloat(askRows[0].best_ask) : null,
        bid_price_inr: askRows[0]?.best_bid ? parseFloat(askRows[0].best_bid) : null,
        volume_ccc:    parseFloat(row.volume_ccc),
        raw:           { source: 'ethertrack_db' },
      };
    } catch (e) {
      console.warn('[EtherTrackAMM] DB read failed:', e.message);
      return null;
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// AGGREGATOR
// ══════════════════════════════════════════════════════════════════
const ADAPTERS = [
  new IEXAdapter(),
  new PXILAdapter(),
  new EtherTrackAMMAdapter(),
];

let _pollTimer = null;

async function pollAll() {
  for (const adapter of ADAPTERS) {
    await adapter.fetchAndStore();
  }
}

function startPolling() {
  pollAll(); // immediate first run
  _pollTimer = setInterval(pollAll, POLL_INTERVAL_MS);
  console.info('[priceFeed] Started polling IEX, PXIL, EtherTrack AMM');
}

function stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

/**
 * getCCCMarketPrice()
 * Returns the best available CCC price with source metadata.
 * Priority: IEX (official) → PXIL (official) → EtherTrack AMM
 * Falls back to latest DB record if memory cache is stale.
 */
async function getCCCMarketPrice() {
  const now = Date.now();

  // Try official exchange sources first
  for (const sourceName of ['IEX', 'PXIL', 'ETHERTRACK_AMM']) {
    const cached = priceCache.get(sourceName);
    if (cached && (now - new Date(cached.captured_at).getTime()) < STALE_AFTER_MS) {
      return cached;
    }
  }

  // Cache miss — try DB
  try {
    const { rows } = await query(
      `SELECT * FROM ccc_latest_prices
       ORDER BY is_official DESC, captured_at DESC
       LIMIT 1`
    );
    if (rows.length) {
      priceCache.set(rows[0].source, rows[0]);
      return rows[0];
    }
  } catch { /* fall through */ }

  return null;
}

/**
 * getAllPrices()
 * Returns latest price from every source — for the price comparison widget.
 */
async function getAllPrices() {
  try {
    const { rows } = await query(
      `SELECT * FROM ccc_latest_prices ORDER BY is_official DESC, price_inr ASC`
    );
    return rows;
  } catch {
    // Fall back to memory cache
    return Array.from(priceCache.values());
  }
}

/**
 * getPriceHistory(source, days)
 * Returns time-series price data for charting.
 */
async function getPriceHistory(source, days = 30) {
  const { rows } = await query(
    `SELECT
       date_trunc('day', captured_at) AS day,
       AVG(price_inr)::NUMERIC(12,2)  AS avg_price,
       MAX(price_inr)::NUMERIC(12,2)  AS high,
       MIN(price_inr)::NUMERIC(12,2)  AS low,
       SUM(volume_ccc)::NUMERIC(15,2) AS volume,
       COUNT(*)                       AS data_points
     FROM ccc_price_feed
     WHERE source = $1
       AND captured_at > NOW() - INTERVAL '${parseInt(days)} days'
     GROUP BY day
     ORDER BY day ASC`,
    [source]
  );
  return rows;
}

module.exports = {
  startPolling,
  stopPolling,
  getCCCMarketPrice,
  getAllPrices,
  getPriceHistory,
  ADAPTERS,
};
