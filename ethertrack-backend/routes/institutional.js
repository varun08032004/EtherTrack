// routes/institutional.js — Institutional API Routes

'use strict';

const router = require('express').Router();
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { safeQuery: query, withTransaction } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requirePlan } = require('../middleware/planGate');
const InstitutionalAPIService = require('../src/services/institutionalApiService').default;

const institutionalService = new InstitutionalAPIService();

// ── Rate limiters ────────────────────────────────────────────────────────────
const apiKeyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.apiKey?.key_id ?? ipKeyGenerator(req),
  handler: (req, res) => res.status(429).json({ error: 'Too many API requests' })
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req),
  handler: (req, res) => res.status(429).json({ error: 'Too many webhook requests' })
});

// ── API Key Management ──────────────────────────────────────────────────────

// POST /api/institutional/api-keys — Create API key
router.post('/api-keys', authenticate, requirePlan('growth'), apiKeyLimiter, async (req, res) => {
  try {
    const { name, scopes, rate_limit_tier, allowed_ips, expires_at, org_id } = req.body;

    if (!name || !scopes || !Array.isArray(scopes) || scopes.length === 0) {
      return res.status(400).json({ error: 'name and scopes (non-empty array) required' });
    }

    const validScopes = [
      'market:read', 'market:write', 'trade:read', 'trade:write',
      'compliance:read', 'compliance:write', 'mrv:read', 'mrv:write',
      'portfolio:read', 'portfolio:write', 'webhook:read', 'webhook:write',
      'admin:read', 'admin:write'
    ];

    for (const scope of scopes) {
      if (!validScopes.includes(scope)) {
        return res.status(400).json({ error: `Invalid scope: ${scope}` });
      }
    }

    const tier = rate_limit_tier || 'growth';
    const validTiers = ['starter', 'growth', 'corporate', 'enterprise'];
    if (!validTiers.includes(tier)) {
      return res.status(400).json({ error: `Invalid rate_limit_tier. Must be one of: ${validTiers.join(', ')}` });
    }

    const result = await institutionalService.createAPIKey({
      user_id: req.user.id,
      org_id: org_id,
      name,
      scopes,
      rate_limit_tier: tier,
      allowed_ips,
      expires_at
    });

    res.status(201).json({ success: true, ...result });
  } catch (error) {
    console.error('[institutional/api-keys POST]', error.message);
    res.status(400).json({ error: error.message });
  }
});

// GET /api/institutional/api-keys — List API keys
router.get('/api-keys', authenticate, async (req, res) => {
  try {
    const keys = await institutionalService.listAPIKeys(req.user.id);
    res.json({ keys });
  } catch (error) {
    console.error('[institutional/api-keys GET]', error.message);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// DELETE /api/institutional/api-keys/:keyId — Revoke API key
router.delete('/api-keys/:keyId', authenticate, async (req, res) => {
  try {
    await institutionalService.revokeAPIKey(req.params.keyId, req.user.id);
    res.json({ success: true, message: 'API key revoked' });
  } catch (error) {
    console.error('[institutional/api-keys DELETE]', error.message);
    res.status(400).json({ error: error.message });
  }
});

// ── Webhook Management ──────────────────────────────────────────────────────

// POST /api/institutional/webhooks — Register webhook
router.post('/webhooks', authenticate, requirePlan('growth'), webhookLimiter, async (req, res) => {
  try {
    const { url, events, secret, retry_config, description, api_key_id } = req.body;

    if (!url || !events || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'url and events (non-empty array) required' });
    }

    if (!secret || secret.length < 16) {
      return res.status(400).json({ error: 'secret must be at least 16 characters' });
    }

    const validEvents = [
      'trade.created', 'trade.filled', 'trade.partially_filled', 'trade.cancelled', 'trade.settled', 'trade.failed',
      'order.created', 'order.filled', 'order.partially_filled', 'order.cancelled', 'order.expired',
      'market.listing_created', 'market.listing_filled', 'market.listing_expired', 'market.price_updated',
      'rfq.created', 'rfq.quote_received', 'rfq.accepted',
      'otc.initiated', 'otc.terms_agreed', 'otc.settled',
      'mrv.plan_submitted', 'mrv.plan_verified', 'mrv.plan_approved', 'mrv.evidence_uploaded', 'mrv.finding_added',
      'compliance.position_updated', 'compliance.deadline_approaching',
      'wallet.deposit_received', 'wallet.withdrawal_initiated', 'wallet.withdrawal_completed',
      'credit.minted', 'credit.listed', 'credit.retired', 'credit.transferred'
    ];

    for (const event of events) {
      if (!validEvents.includes(event)) {
        return res.status(400).json({ error: `Invalid event: ${event}` });
      }
    }

    const result = await institutionalService.registerWebhook({
      user_id: req.user.id,
      api_key_id: req.body.api_key_id,
      url,
      events,
      secret,
      retry_config,
      description
    });

    res.status(201).json({ success: true, ...result });
  } catch (error) {
    console.error('[institutional/webhooks POST]', error.message);
    res.status(400).json({ error: error.message });
  }
});

// GET /api/institutional/webhooks — List webhooks
router.get('/webhooks', authenticate, async (req, res) => {
  try {
    const webhooks = await institutionalService.listWebhooks(req.user.id);
    res.json({ webhooks });
  } catch (error) {
    console.error('[institutional/webhooks GET]', error.message);
    res.status(500).json({ error: 'Failed to fetch webhooks' });
  }
});

// DELETE /api/institutional/webhooks/:endpointId — Delete webhook
router.delete('/webhooks/:endpointId', authenticate, async (req, res) => {
  try {
    await institutionalService.deleteWebhook(req.params.endpointId, req.user.id);
    res.json({ success: true, message: 'Webhook deleted' });
  } catch (error) {
    console.error('[institutional/webhooks DELETE]', error.message);
    res.status(400).json({ error: error.message });
  }
});

// GET /api/institutional/webhooks/:endpointId/logs — Get webhook delivery logs
router.get('/webhooks/:endpointId/logs', authenticate, async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const logs = await institutionalService.getWebhookLogs(req.params.endpointId, parseInt(limit), parseInt(offset));
    res.json({ logs });
  } catch (error) {
    console.error('[institutional/webhooks/:id/logs GET]', error.message);
    res.status(500).json({ error: 'Failed to fetch webhook logs' });
  }
});

// ── Market Data API ────────────────────────────────────────────────────────

// GET /api/institutional/market/data — Get real-time market data
router.get('/market/data', authenticate, requirePlan('growth'), async (req, res) => {
  try {
    const { asset_ids, methodology, vintage, limit } = req.query;
    const data = await institutionalService.getMarketData({
      asset_ids: asset_ids?.split(','),
      methodology,
      vintage: vintage ? parseInt(vintage) : undefined,
      limit: limit ? parseInt(limit) : 50
    });
    res.json({ assets: data });
  } catch (error) {
    console.error('[institutional/market/data GET]', error.message);
    res.status(500).json({ error: 'Failed to fetch market data' });
  }
});

// GET /api/institutional/market/indices — Get price indices
router.get('/market/indices', authenticate, requirePlan('growth'), async (req, res) => {
  try {
    const { methodology, vintage, geography, days } = req.query;
    const indices = await institutionalService.getPriceIndices({
      methodology: methodology,
      vintage: vintage ? parseInt(vintage) : undefined,
      geography,
      days: days ? parseInt(days) : undefined
    });
    res.json({ indices });
  } catch (error) {
    console.error('[institutional/market/indices GET]', error.message);
    res.status(500).json({ error: 'Failed to fetch price indices' });
  }
});

// GET /api/institutional/market/stats — Get market statistics
router.get('/market/stats', authenticate, requirePlan('growth'), async (req, res) => {
  try {
    const stats = await institutionalService.getMarketStats();
    res.json(stats);
  } catch (error) {
    console.error('[institutional/market/stats GET]', error.message);
    res.status(500).json({ error: 'Failed to fetch market stats' });
  }
});

// ── Compliance API ──────────────────────────────────────────────────────────

// GET /api/institutional/compliance/position/:entityId — Get CCTS compliance position
router.get('/compliance/position/:entityId', authenticate, requirePlan('corporate'), async (req, res) => {
  try {
    const position = await institutionalService.getCompliancePosition(req.params.entityId);
    if (!position) {
      return res.status(404).json({ error: 'Entity not found' });
    }
    res.json(position);
  } catch (error) {
    console.error('[institutional/compliance/position GET]', error.message);
    res.status(500).json({ error: 'Failed to fetch compliance position' });
  }
});

// GET /api/institutional/compliance/procurement-plan/:entityId — Get procurement plan
router.get('/compliance/procurement-plan/:entityId', authenticate, requirePlan('corporate'), async (req, res) => {
  try {
    const plan = await institutionalService.getProcurementPlan(req.params.entityId);
    if (!plan) {
      return res.status(404).json({ error: 'Entity not found' });
    }
    res.json(plan);
  } catch (error) {
    console.error('[institutional/compliance/procurement-plan GET]', error.message);
    res.status(500).json({ error: 'Failed to fetch procurement plan' });
  }
});

// ── Procurement API ────────────────────────────────────────────────────────

// POST /api/institutional/procurement/quote — Get procurement quote
router.post('/procurement/quote', authenticate, requirePlan('growth'), async (req, res) => {
  try {
    const { asset_ids, quantities, buyer_id } = req.body;
    if (!asset_ids || !Array.isArray(asset_ids) || asset_ids.length === 0) {
      return res.status(400).json({ error: 'asset_ids (non-empty array) required' });
    }
    if (!quantities || !Array.isArray(quantities) || quantities.length !== asset_ids.length) {
      return res.status(400).json({ error: 'quantities array must match asset_ids length' });
    }

    const quote = await institutionalService.getProcurementQuote({
      buyer_id: req.user.id,
      asset_ids,
      quantities
    });

    res.json({ success: true, quote });
  } catch (error) {
    console.error('[institutional/procurement/quote POST]', error.message);
    res.status(400).json({ error: error.message });
  }
});

// POST /api/institutional/procurement/order — Execute procurement order
router.post('/procurement/order', authenticate, requirePlan('growth'), async (req, res) => {
  try {
    const { quote_id, payment_mode } = req.body;
    if (!quote_id || !payment_mode) {
      return res.status(400).json({ error: 'quote_id and payment_mode required' });
    }
    if (!['inr_wallet', 'razorpay', 'bank_transfer'].includes(payment_mode)) {
      return res.status(400).json({ error: 'Invalid payment_mode' });
    }

    const order = await institutionalService.executeProcurementOrder({
      quote_id: req.body.quote_id,
      buyer_id: req.user.id,
      payment_mode
    });

    res.json({ success: true, order });
  } catch (error) {
    console.error('[institutional/procurement/order POST]', error.message);
    res.status(400).json({ error: error.message });
  }
});

// ── Market Data API ────────────────────────────────────────────────────────

// GET /api/institutional/market/data — Get market data
router.get('/market/data', authenticate, requirePlan('growth'), async (req, res) => {
  try {
    const { asset_ids, methodology, vintage, limit } = req.query;
    const data = await institutionalService.getMarketData({
      asset_ids: asset_ids?.split(','),
      methodology,
      vintage: vintage ? parseInt(vintage) : undefined,
      limit: limit ? parseInt(limit) : 50
    });
    res.json({ assets: data });
  } catch (error) {
    console.error('[institutional/market/data GET]', error.message);
    res.status(500).json({ error: 'Failed to fetch market data' });
  }
});

// GET /api/institutional/market/indices — Get price indices
router.get('/market/indices', authenticate, requirePlan('growth'), async (req, res) => {
  try {
    const { methodology, vintage, geography, days } = req.query;
    const indices = await institutionalService.getPriceIndices({
      methodology,
      vintage: vintage ? parseInt(vintage) : undefined,
      geography,
      days: days ? parseInt(days) : undefined
    });
    res.json({ indices });
  } catch (error) {
    console.error('[institutional/market/indices GET]', error.message);
    res.status(500).json({ error: 'Failed to fetch price indices' });
  }
});

// GET /api/institutional/market/stats — Get market statistics
router.get('/market/stats', authenticate, requirePlan('growth'), async (req, res) => {
  try {
    const stats = await institutionalService.getMarketStats();
    res.json(stats);
  } catch (error) {
    console.error('[institutional/market/stats GET]', error.message);
    res.status(500).json({ error: 'Failed to fetch market stats' });
  }
});

// ── Compliance API ──────────────────────────────────────────────────────────

// GET /api/institutional/compliance/position/:entityId — Get CCTS compliance position
router.get('/compliance/position/:entityId', authenticate, requirePlan('corporate'), async (req, res) => {
  try {
    const position = await institutionalService.getCompliancePosition(req.params.entityId);
    if (!position) {
      return res.status(404).json({ error: 'Entity not found' });
    }
    res.json(position);
  } catch (error) {
    console.error('[institutional/compliance/position GET]', error.message);
    res.status(500).json({ error: 'Failed to fetch compliance position' });
  }
});

// GET /api/institutional/compliance/procurement-plan/:entityId — Get procurement plan
router.get('/compliance/procurement-plan/:entityId', authenticate, requirePlan('corporate'), async (req, res) => {
  try {
    const plan = await institutionalService.getProcurementPlan(req.params.entityId);
    if (!plan) {
      return res.status(404).json({ error: 'Entity not found' });
    }
    res.json(plan);
  } catch (error) {
    console.error('[institutional/compliance/procurement-plan GET]', error.message);
    res.status(500).json({ error: 'Failed to fetch procurement plan' });
  }
});

// ── Webhook Management ────────────────────────────────────────────────────

// POST /api/institutional/webhooks — Register webhook
router.post('/webhooks', authenticate, requirePlan('growth'), webhookLimiter, async (req, res) => {
  try {
    const { url, events, secret, retry_config, description, api_key_id } = req.body;

    if (!url || !events || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'url and events (non-empty array) required' });
    }

    if (!secret || secret.length < 16) {
      return res.status(400).json({ error: 'secret must be at least 16 characters' });
    }

    const validEvents = [
      'trade.created', 'trade.filled', 'trade.partially_filled', 'trade.cancelled', 'trade.settled', 'trade.failed',
      'order.created', 'order.filled', 'order.partially_filled', 'order.cancelled', 'order.expired',
      'market.listing_created', 'market.listing_filled', 'market.listing_expired', 'market.price_updated',
      'rfq.created', 'rfq.quote_received', 'rfq.accepted',
      'otc.initiated', 'otc.terms_agreed', 'otc.settled',
      'mrv.plan_submitted', 'mrv.plan_verified', 'mrv.plan_approved', 'mrv.evidence_uploaded', 'mrv.finding_added',
      'compliance.position_updated', 'compliance.deadline_approaching',
      'wallet.deposit_received', 'wallet.withdrawal_initiated', 'wallet.withdrawal_completed',
      'credit.minted', 'credit.listed', 'credit.retired', 'credit.transferred'
    ];

    for (const event of events) {
      if (!validEvents.includes(event)) {
        return res.status(400).json({ error: `Invalid event: ${event}` });
      }
    }

    const result = await institutionalService.registerWebhook({
      user_id: req.user.id,
      api_key_id: req.body.api_key_id,
      url,
      events,
      secret,
      retry_config,
      description
    });

    res.status(201).json({ success: true, ...result });
  } catch (error) {
    console.error('[institutional/webhooks POST]', error.message);
    res.status(400).json({ error: error.message });
  }
});

// GET /api/institutional/webhooks — List webhooks
router.get('/webhooks', authenticate, async (req, res) => {
  try {
    const webhooks = await institutionalService.listWebhooks(req.user.id);
    res.json({ webhooks });
  } catch (error) {
    console.error('[institutional/webhooks GET]', error.message);
    res.status(500).json({ error: 'Failed to fetch webhooks' });
  }
});

// DELETE /api/institutional/webhooks/:endpointId — Delete webhook
router.delete('/webhooks/:endpointId', authenticate, async (req, res) => {
  try {
    await institutionalService.deleteWebhook(req.params.endpointId, req.user.id);
    res.json({ success: true, message: 'Webhook deleted' });
  } catch (error) {
    console.error('[institutional/webhooks DELETE]', error.message);
    res.status(400).json({ error: error.message });
  }
});

// GET /api/institutional/webhooks/:endpointId/logs — Get webhook delivery logs
router.get('/webhooks/:endpointId/logs', authenticate, async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const logs = await institutionalService.getWebhookLogs(req.params.endpointId, parseInt(limit), parseInt(offset));
    res.json({ logs });
  } catch (error) {
    console.error('[institutional/webhooks/:id/logs GET]', error.message);
    res.status(500).json({ error: 'Failed to fetch webhook logs' });
  }
});

// ── Usage Analytics ────────────────────────────────────────────────────────

// GET /api/institutional/usage/stats/:keyId — Get API usage statistics
router.get('/usage/stats/:keyId', authenticate, requirePlan('growth'), async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const stats = await institutionalService.getUsageStats(req.params.keyId, parseInt(days));
    res.json(stats);
  } catch (error) {
    console.error('[institutional/usage/stats GET]', error.message);
    res.status(500).json({ error: 'Failed to fetch usage stats' });
  }
});

// GET /api/institutional/usage/rate-limit/:keyId — Get rate limit status
router.get('/usage/rate-limit/:keyId', authenticate, requirePlan('growth'), async (req, res) => {
  try {
    const status = await institutionalService.getRateLimitStatus(req.params.keyId);
    if (!status) {
      return res.status(404).json({ error: 'API key not found' });
    }
    res.json(status);
  } catch (error) {
    console.error('[institutional/usage/rate-limit GET]', error.message);
    res.status(500).json({ error: 'Failed to fetch rate limit status' });
  }
});

// ── Procurement API ────────────────────────────────────────────────────────

// POST /api/institutional/procurement/quote — Get procurement quote
router.post('/procurement/quote', authenticate, requirePlan('growth'), async (req, res) => {
  try {
    const { asset_ids, quantities, buyer_id } = req.body;
    if (!asset_ids || !Array.isArray(asset_ids) || asset_ids.length === 0) {
      return res.status(400).json({ error: 'asset_ids (non-empty array) required' });
    }
    if (!quantities || !Array.isArray(quantities) || quantities.length !== asset_ids.length) {
      return res.status(400).json({ error: 'quantities array must match asset_ids length' });
    }

    const quote = await institutionalService.getProcurementQuote({
      buyer_id: req.user.id,
      asset_ids,
      quantities
    });

    res.json({ success: true, quote });
  } catch (error) {
    console.error('[institutional/procurement/quote POST]', error.message);
    res.status(400).json({ error: error.message });
  }
});

// POST /api/institutional/procurement/order — Execute procurement order
router.post('/procurement/order', authenticate, requirePlan('growth'), async (req, res) => {
  try {
    const { quote_id, payment_mode } = req.body;
    if (!quote_id || !payment_mode) {
      return res.status(400).json({ error: 'quote_id and payment_mode required' });
    }
    if (!['inr_wallet', 'razorpay', 'bank_transfer'].includes(payment_mode)) {
      return res.status(400).json({ error: 'Invalid payment_mode' });
    }

    const order = await institutionalService.executeProcurementOrder({
      quote_id: req.body.quote_id,
      buyer_id: req.user.id,
      payment_mode
    });

    res.json({ success: true, order });
  } catch (error) {
    console.error('[institutional/procurement/order POST]', error.message);
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;