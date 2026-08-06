'use strict';
// routes/opsIntegrationPricing.js
//
// WRITE surface for the ERP (etpl_ops) Product/Sales section to push
// Starter/Growth prices — see services/pricing.js for how these override
// the hardcoded PLAN_CONFIG defaults in routes/subscription.js. Same
// isolation pattern as the other ops-integration-* write surfaces: its own
// token (PLATFORM_SYNC_PRICING_WRITE_TOKEN).
//
// Corporate is intentionally out of scope — always "Contact Sales", priced
// per deal via routes/opsIntegrationCorporate.js instead.

const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { requireServiceTokenFor } = require('../middleware/serviceAuth');
const { setPrice, listPrices } = require('../services/pricing');

const pricingOpsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — slow down' },
});

router.use(pricingOpsLimiter);
router.use(requireServiceTokenFor('PLATFORM_SYNC_PRICING_WRITE_TOKEN'));

router.use((req, res, next) => {
  console.log(`[ops-integration-pricing] ${req.method} ${req.originalUrl} — service call authorized`);
  next();
});

const VALID_PLANS  = ['starter', 'growth'];
const VALID_CYCLES = ['monthly', 'annual'];

// PATCH /api/ops-integration-pricing/:plan/:cycle
// body: { priceINR, updatedBy }
router.patch('/:plan/:cycle', async (req, res) => {
  const { plan, cycle } = req.params;
  const { priceINR, updatedBy } = req.body;
  if (!VALID_PLANS.includes(plan))
    return res.status(400).json({ error: "plan must be 'starter' or 'growth' — Corporate pricing is set via opsIntegrationCorporate, never here" });
  if (!VALID_CYCLES.includes(cycle))
    return res.status(400).json({ error: "cycle must be 'monthly' or 'annual'" });
  if (priceINR == null || isNaN(priceINR) || Number(priceINR) < 0)
    return res.status(400).json({ error: 'priceINR must be a non-negative number' });

  try {
    const pricePaise = Math.round(Number(priceINR) * 100);
    await setPrice(plan, cycle, pricePaise, { updatedBy: updatedBy || null, updatedFrom: 'erp' });
    res.json({ ok: true, plan, cycle, priceINR: Number(priceINR) });
  } catch (e) {
    console.error('[ops-integration-pricing:patch]', e.message);
    res.status(500).json({ error: 'Failed to update price' });
  }
});

// GET /api/ops-integration-pricing — current overrides (rows only present
// once the ERP has pushed at least one price; anything absent is still
// using the platform's hardcoded default).
router.get('/', async (req, res) => {
  try {
    const prices = await listPrices();
    res.json({ prices });
  } catch (e) {
    console.error('[ops-integration-pricing:list]', e.message);
    res.status(500).json({ error: 'Failed to fetch prices' });
  }
});

module.exports = router;