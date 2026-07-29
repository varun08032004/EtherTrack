'use strict';
// routes/opsIntegrationCorporate.js
//
// WRITE-capable counterpart to routes/opsIntegration.js — deliberately kept
// in its own file, mounted on its own path, and gated by its OWN token
// (OPS_SYNC_CORPORATE_WRITE_TOKEN via requireCorporateWriteToken, not
// OPS_SYNC_SERVICE_TOKEN via requireServiceToken).
//
// opsIntegration.js's header comment is explicit that it should never grow
// write endpoints — that's a deliberate blast-radius decision: a leaked
// read-only sync token should never be able to touch billing state. This
// file is the answer to "the ERP needs to trigger Corporate activation"
// that doesn't compromise that boundary: even if OPS_SYNC_SERVICE_TOKEN
// leaks, it still can't reach anything here, and vice versa.
//
// Surface is intentionally narrow: exactly the 3 corporate-subscription
// actions the ERP's Sales module needs, nothing else. If a future need
// comes up for more platform writes from the ERP, it should get its own
// route + its own audit trail here too, not get bolted onto this or onto
// opsIntegration.js.
//
// Mount: app.use('/api/ops-integration-corporate', require('./routes/opsIntegrationCorporate'))
// Auth:  requireCorporateWriteToken (middleware/serviceAuth.js), configured
//        via OPS_SYNC_CORPORATE_WRITE_TOKEN — a secret distinct from
//        OPS_SYNC_SERVICE_TOKEN. The ERP calls this token
//        PLATFORM_SYNC_CORPORATE_WRITE_TOKEN in its own .env (matching its
//        own naming convention for the read-only token too) — only the
//        *value* needs to match across the two repos, not the variable name.

const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { requireCorporateWriteToken } = require('../middleware/serviceAuth');
const corporateActivation = require('../services/corporateActivation');

// Tighter than opsIntegration.js's 30/min — this is a low-volume, high-
// consequence action (a handful of corporate deals close per week, not per
// minute), so a tight limit costs nothing legitimate and makes abuse loud.
const corporateWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — slow down' },
});

router.use(corporateWriteLimiter);
router.use(requireCorporateWriteToken);

router.use((req, res, next) => {
  console.log(`[ops-integration-corporate] ${req.method} ${req.originalUrl} — WRITE call authorized`);
  next();
});

// POST /api/ops-integration-corporate/:userId/activate
// body: { cycle, seats, customPriceINR, renewalMonths, notes }
router.post('/:userId/activate', async (req, res) => {
  const { userId } = req.params;
  const { cycle, seats, customPriceINR, renewalMonths, notes } = req.body;
  try {
    const result = await corporateActivation.activateCorporate(
      userId, { cycle, seats, customPriceINR, renewalMonths, notes }, null // null actorId → audit log shows ERP-triggered
    );
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[ops-integration-corporate/activate]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Corporate activation failed', detail: e.message });
  }
});

// PATCH /api/ops-integration-corporate/:userId/renewal
// body: { renewalDate, seats, notes }
router.patch('/:userId/renewal', async (req, res) => {
  const { userId } = req.params;
  const { renewalDate, seats, notes } = req.body;
  try {
    const result = await corporateActivation.updateCorporateRenewal(userId, { renewalDate, seats, notes }, null);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[ops-integration-corporate/renewal]', e.message);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Renewal update failed' });
  }
});

// GET /api/ops-integration-corporate/activations
// Read, but grouped here rather than in opsIntegration.js since it's part
// of the same feature and gated behind the same write-scoped token —
// simpler than splitting one feature's auth across two token surfaces.
router.get('/activations', async (req, res) => {
  try {
    const activations = await corporateActivation.listCorporateActivations();
    res.json({ activations });
  } catch (e) {
    console.error('[ops-integration-corporate/activations]', e.message);
    res.status(500).json({ error: 'Failed to fetch corporate activations' });
  }
});

module.exports = router;