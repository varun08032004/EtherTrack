// routes/priceFeed.js — EtherTrack CCTS Price Feed API (#7) - 28/05/2026
'use strict';

const router    = require('express').Router();
const rateLimit = require('express-rate-limit');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getCCCMarketPrice, getAllPrices, getPriceHistory } = require('../services/priceFeedService');
const { safeQuery: query } = require('../db/pool');

const limiter = rateLimit({ windowMs: 60_000, max: 120, keyGenerator: r => r.ip });

// GET /api/ccc/price — best current price
router.get('/price', limiter, async (req, res) => {
  try {
    const price = await getCCCMarketPrice();
    if (!price) return res.json({ price: null, message: 'No price data available yet' });
    res.json({
      priceInr:      parseFloat(price.price_inr),
      bidInr:        price.bid_price_inr ? parseFloat(price.bid_price_inr) : null,
      askInr:        price.ask_price_inr ? parseFloat(price.ask_price_inr) : null,
      volumeCcc:     price.volume_ccc    ? parseFloat(price.volume_ccc)    : null,
      source:        price.source,
      isOfficial:    price.is_official,
      sessionDate:   price.session_date,
      capturedAt:    price.captured_at,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch price' });
  }
});

// GET /api/ccc/prices/all — all sources side by side
router.get('/prices/all', limiter, async (req, res) => {
  try {
    const prices = await getAllPrices();
    res.json({ prices });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch prices' });
  }
});

// GET /api/ccc/price/history?source=IEX&days=30
router.get('/price/history', limiter, async (req, res) => {
  const source = ['IEX','PXIL','ETHERTRACK_AMM'].includes(req.query.source)
    ? req.query.source : 'IEX';
  const days = Math.min(parseInt(req.query.days) || 30, 365);
  try {
    const history = await getPriceHistory(source, days);
    res.json({ source, days, history });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch price history' });
  }
});

// GET /api/ccc/exchange/orders — my exchange orders
router.get('/exchange/orders', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT eo.*
       FROM exchange_orders eo
       JOIN obligated_entities oe ON oe.id = eo.entity_id AND oe.user_id = $1
       ORDER BY eo.created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json({ orders: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// POST /api/ccc/exchange/order — submit order to IEX or PXIL
router.post('/exchange/order', authenticate, async (req, res) => {
  const { exchange, orderSide, orderType, quantityCcc, limitPriceInr, nettingSessionId } = req.body;

  if (!['IEX','PXIL'].includes(exchange))
    return res.status(400).json({ error: 'exchange must be IEX or PXIL' });
  if (!['buy','sell'].includes(orderSide))
    return res.status(400).json({ error: 'orderSide must be buy or sell' });
  if (!quantityCcc || parseFloat(quantityCcc) <= 0)
    return res.status(400).json({ error: 'quantityCcc must be positive' });

  try {
    const { rows: entityRows } = await query(
      `SELECT id FROM obligated_entities WHERE user_id = $1`, [req.user.id]
    );
    if (!entityRows.length)
      return res.status(400).json({ error: 'Complete entity onboarding before trading on exchange' });

    const { iexClient, pxilClient } = require('../services/exchangeService');
    const client = exchange === 'IEX' ? iexClient : pxilClient;

    const result = await client.submitOrder({
      entityId:         entityRows[0].id,
      nettingSessionId: nettingSessionId || null,
      orderSide,
      orderType:        orderType || 'limit',
      quantityCcc:      parseFloat(quantityCcc),
      limitPriceInr:    limitPriceInr ? parseFloat(limitPriceInr) : null,
      periodId:         null,
      submittedBy:      req.user.id,
    });

    res.status(201).json({ order: result });
  } catch (e) {
    console.error('[exchange/order]', e.message);
    res.status(500).json({ error: e.message || 'Failed to submit order' });
  }
});

// GET /api/ccc/gci/sync-history
router.get('/gci/sync-history', authenticate, async (req, res) => {
  try {
    const { rows: entityRows } = await query(
      `SELECT id FROM obligated_entities WHERE user_id = $1`, [req.user.id]
    );
    const { gciClient } = require('../services/exchangeService');
    const history = await gciClient.getSyncHistory(entityRows[0]?.id || null);
    res.json({ history });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch sync history' });
  }
});

// POST /api/ccc/gci/sync — manual trigger (admin or self)
router.post('/gci/sync', authenticate, async (req, res) => {
  try {
    const { rows: entityRows } = await query(
      `SELECT oe.id, cp.period_id
       FROM obligated_entities oe
       JOIN compliance_positions cp ON cp.entity_id = oe.id
       JOIN compliance_periods cpd ON cpd.id = cp.period_id AND cpd.is_active = TRUE
       WHERE oe.user_id = $1 LIMIT 1`,
      [req.user.id]
    );
    if (!entityRows.length)
      return res.status(400).json({ error: 'No entity or compliance position found to sync' });

    const { gciClient } = require('../services/exchangeService');
    const result = await gciClient.pullPosition(entityRows[0].id, entityRows[0].period_id);
    res.json({ result, message: 'GCI sync complete' });
  } catch (e) {
    res.status(500).json({ error: `GCI sync failed: ${e.message}` });
  }
});

// GET /api/ccc/cerc/reconciliation
router.get('/cerc/reconciliation', authenticate, async (req, res) => {
  try {
    const { rows: entityRows } = await query(
      `SELECT id FROM obligated_entities WHERE user_id = $1`, [req.user.id]
    );
    if (!entityRows.length) return res.json({ report: [] });
    const { cercRecon } = require('../services/exchangeService');
    const report = await cercRecon.getReconciliationReport(entityRows[0].id, null);
    res.json({ report });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch reconciliation report' });
  }
});

module.exports = router;
