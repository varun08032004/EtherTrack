'use strict';
// routes/opsIntegrationCorporate.js
//
// WRITE surface for the internal ops ERP (etpl_ops) to activate and renew
// Corporate subscriptions — this is what the ERP's
// services/platformClient.js's activateCorporate()/updateCorporateRenewal()/
// fetchCorporateActivations() have been calling all along
// (POST/PATCH/GET /api/ops-integration-corporate/...).
//
// Deliberately a SEPARATE route file, mount path, and env-var token from the
// read-only /api/ops-integration/* surface (routes/opsIntegration.js) — see
// that file's own header comment: it should never grow write endpoints. If
// PLATFORM_SYNC_CORPORATE_WRITE_TOKEN ever leaks, the read-only sync is
// completely unaffected, and vice versa.
//
// Corporate deals are sold and priced manually by Sales (ethertrack.in's
// Corporate tier has always been "Contact Sales" only, never self-serve
// checkout) — this route is simply how the ERP tells the platform "the deal
// closed, turn their account on" or "they renewed, push the date out",
// instead of a human admin re-typing the same thing into the Admin Panel.
// Uses the exact same underlying logic (services/corporateActivation.js) as
// the Admin Panel's own /api/admin/users/:id/activate-corporate — one
// source of truth for either caller.

const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { requireServiceTokenFor } = require('../middleware/serviceAuth');
const { activateCorporate, updateCorporateRenewal, listCorporateActivations } = require('../services/corporateActivation');

const corporateOpsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — slow down' },
});

router.use(corporateOpsLimiter);
router.use(requireServiceTokenFor('PLATFORM_SYNC_CORPORATE_WRITE_TOKEN'));

router.use((req, res, next) => {
  console.log(`[ops-integration-corporate] ${req.method} ${req.originalUrl} — service call authorized`);
  next();
});

// POST /api/ops-integration-corporate/:userId/activate
// body: { cycle, seats, customPriceINR, renewalMonths, notes }
router.post('/:userId/activate', async (req, res) => {
  const { userId } = req.params;
  const { cycle, seats, customPriceINR, renewalMonths, notes } = req.body;
  try {
    const result = await activateCorporate(userId, { cycle, seats, customPriceINR, notes, renewalMonths }, 'erp');
    res.json({
      ok: true, userId, plan: 'corporate', cycle: result.cycle,
      seats: result.seats, renewalDate: result.renewalDate.toISOString(),
      customPriceINR: result.customPriceINR,
    });
  } catch (e) {
    console.error('[ops-integration-corporate:activate]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Corporate activation failed' });
  }
});

// PATCH /api/ops-integration-corporate/:userId/renewal
// body: { renewalDate, seats, notes }
router.patch('/:userId/renewal', async (req, res) => {
  const { userId } = req.params;
  const { renewalDate, seats, notes } = req.body;
  try {
    const result = await updateCorporateRenewal(userId, { renewalDate, seats, notes }, 'erp');
    res.json({ ok: true, renewalDate: result.renewalDate.toISOString() });
  } catch (e) {
    console.error('[ops-integration-corporate:renewal]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Renewal update failed' });
  }
});

// GET /api/ops-integration-corporate/activations
router.get('/activations', async (req, res) => {
  try {
    const activations = await listCorporateActivations();
    res.json({ activations });
  } catch (e) {
    console.error('[ops-integration-corporate:activations]', e.message);
    res.status(500).json({ error: 'Failed to fetch corporate activations' });
  }
});

module.exports = router;