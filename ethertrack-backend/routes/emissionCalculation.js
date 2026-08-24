// routes/emissionCalculation.js
// Emission Calculation Engine API Routes

'use strict';

const router = require('express').Router();
const { safeQuery: query, withTransaction } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requirePlan } = require('../middleware/planGate');
const { writeLimiter } = require('../middleware/rateLimit');
const EmissionCalculationEngine = require('../src/services/emissionCalculationEngine');
const factorLibrary = require('../src/services/emissionFactorLibrary');
const rateLimit = require('express-rate-limit');

const calculationEngine = new EmissionCalculationEngine();

// Use the built-in ipKeyGenerator from express-rate-limit for IPv6 support
const { ipKeyGenerator } = rateLimit;

// ── Rate limiters ────────────────────────────────────────────────────────────
const calculationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: ipKeyGenerator,
  handler: (req, res) => res.status(429).json({ error: 'Too many calculation requests' })
});

const bulkLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: ipKeyGenerator,
  handler: (req, res) => res.status(429).json({ error: 'Too many bulk calculation requests' })
});

// ── GET /api/emissions/calculate ─────────────────────────────────────────────
// Single calculation endpoint
router.post('/calculate', authenticate, requirePlan('growth'), calculationLimiter, async (req, res) => {
  try {
    const { 
      categoryCode, 
      methodologyTemplate, 
      quantity, 
      unit, 
      date, 
      factorCode, 
      metadata 
    } = req.body;
    
    // Validate required fields
    if (!categoryCode || !methodologyTemplate || quantity === undefined || !unit || !date) {
      return res.status(400).json({ 
        error: 'Missing required fields: categoryCode, methodologyTemplate, quantity, unit, date' 
      });
    }
    
    if (typeof quantity !== 'number' || quantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be a positive number' });
    }
    
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Date must be in YYYY-MM-DD format' });
    }
    
    const result = await EmissionCalculationEngine.calculate(
      { categoryCode, methodologyTemplate, quantity, unit, date, factorCode, metadata },
      req.user.id
    );
    
    res.json({ success: true, calculation: result });
  } catch (error) {
    console.error('[emissionCalculation/calculate]', error.message);
    res.status(400).json({ error: error.message || 'Calculation failed' });
  }
});

// ── GET /api/emissions/calculate/bulk ────────────────────────────────────────
// Bulk calculation endpoint
router.post('/calculate/bulk', authenticate, requirePlan('growth'), bulkLimiter, async (req, res) => {
  try {
    const { calculations, methodologyTemplate } = req.body;
    
    if (!Array.isArray(calculations) || calculations.length === 0) {
      return res.status(400).json({ error: 'calculations must be a non-empty array' });
    }
    
    if (calculations.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 calculations per bulk request' });
    }
    
    // Validate each calculation
    for (let i = 0; i < calculations.length; i++) {
      const calc = calculations[i];
      if (!calc.categoryCode || !calc.quantity || !calc.unit || !calc.date) {
        return res.status(400).json({ 
          error: `Calculation ${i}: missing required fields` 
        });
      }
      if (typeof calc.quantity !== 'number' || calc.quantity <= 0) {
        return res.status(400).json({ 
          error: `Calculation ${i}: quantity must be a positive number` 
        });
      }
    }
    
    // Create bulk job record
    const { rows: jobRows } = await query(
      `INSERT INTO emission_bulk_jobs (user_id, methodology_template, total_calculations, status, input_data)
       VALUES ($1, $2, $3, 'PROCESSING', $4)
       RETURNING job_id`,
      [req.user.id, methodologyTemplate || 'GHG_PROTOCOL_CORPORATE', calculations.length, JSON.stringify(calculations)]
    );
    const jobId = rows[0].job_id;
    
    // Process calculations
    try {
      const input = { 
        calculations: calculations.map(c => ({ 
          ...c, 
          methodologyTemplate: c.methodologyTemplate || methodologyTemplate 
        })) 
      };
      
      const result = await EmissionCalculationEngine.calculateBulk(input, req.user.id);
      
      // Update job as completed
      await query(
        `UPDATE emission_bulk_jobs 
         SET status = $1, successful_count = $2, error_count = $3, 
             results_summary = $4, error_details = $5, 
             started_at = NOW(), completed_at = NOW()
         WHERE job_id = $6`,
        [
          result.errors.length === 0 ? 'COMPLETED' : 'PARTIAL',
          result.results.length,
          result.errors.length,
          JSON.stringify(result.summary),
          JSON.stringify(result.errors),
          jobId
        ]
      );
      
      res.json({ 
        success: true, 
        jobId,
        ...result 
      });
    } catch (error) {
      // Mark job as failed
      await query(
        `UPDATE emission_bulk_jobs 
         SET status = 'FAILED', error_details = $1, completed_at = NOW()
         WHERE job_id = $2`,
        [JSON.stringify([{ error: error.message }]), jobId]
      );
      throw error;
    }
  } catch (error) {
    console.error('[emissionCalculation/bulk]', error.message);
    res.status(400).json({ error: error.message || 'Bulk calculation failed' });
  }
});

// ── GET /api/emissions/calculate/history ─────────────────────────────────────
// Get calculation history
router.get('/calculate/history', authenticate, async (req, res) => {
  try {
    const { categoryCode, methodologyTemplate, dateFrom, dateTo, limit } = req.query;
    
    const history = await EmissionCalculationEngine.getCalculationHistory(req.user.id, {
      categoryCode,
      methodologyTemplate,
      dateFrom,
      dateTo,
      limit: limit ? parseInt(limit) : 100
    });
    
    res.json({ calculations: history });
  } catch (error) {
    console.error('[emissionCalculation/history]', error.message);
    res.status(500).json({ error: 'Failed to fetch calculation history' });
  }
});

// ── POST /api/emissions/calculate/recalculate ────────────────────────────────
// Recalculate with updated factor
router.post('/calculate/recalculate', authenticate, requirePlan('growth'), calculationLimiter, async (req, res) => {
  try {
    const { calculationId, newFactorCode } = req.body;
    
    if (!calculationId || !newFactorCode) {
      return res.status(400).json({ error: 'calculationId and newFactorCode required' });
    }
    
    const result = await EmissionCalculationEngine.recalculateWithUpdatedFactor(
      calculationId, newFactorCode, req.user.id
    );
    
    res.json({ success: true, calculation: result });
  } catch (error) {
    console.error('[emissionCalculation/recalculate]', error.message);
    res.status(400).json({ error: error.message || 'Recalculation failed' });
  }
});

// ── GET /api/emissions/factors ───────────────────────────────────────────────
// Get emission factors
router.get('/factors', authenticate, async (req, res) => {
  try {
    const { category, subCategory, ghgScope, geography, region, sector, factorCode } = req.query;
    
    if (factorCode) {
      const factor = await EmissionFactorLibrary.getFactorByCode(factorCode);
      return res.json({ factor });
    }
    
    const factors = await EmissionFactorLibrary.getFactorsForActivity({
      category,
      subCategory,
      ghgScope: ghgScope ? parseInt(ghgScope) : undefined,
      geography,
      region,
      sector,
      date: req.query.date
    });
    
    res.json({ factors });
  } catch (error) {
    console.error('[emissionFactorLibrary/factors]', error.message);
    res.status(500).json({ error: 'Failed to fetch emission factors' });
  }
});

// ── POST /api/emissions/factors/seed ─────────────────────────────────────────
// Seed default factors (admin only)
router.post('/factors/seed', authenticate, async (req, res) => {
  try {
    // Check admin role
    const { rows } = await query('SELECT role FROM users WHERE id = $1', [req.user.id]);
    if (!rows.length || rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    await EmissionFactorLibrary.seedDefaultFactors(req.user.id);
    await EmissionFactorLibrary.seedMethodologyTemplates();
    
    res.json({ success: true, message: 'Default emission factors and methodology templates seeded' });
  } catch (error) {
    console.error('[emissionFactorLibrary/seed]', error.message);
    res.status(500).json({ error: 'Failed to seed emission factors' });
  }
});

// ── GET /api/emissions/methodologies ─────────────────────────────────────────
// Get methodology template with categories
router.get('/methodologies/:templateCode', authenticate, async (req, res) => {
  try {
    const { templateCode } = req.params;
    const data = await EmissionFactorLibrary.getMethodologyTemplate(templateCode);
    
    if (!data) {
      return res.status(404).json({ error: 'Methodology template not found' });
    }
    
    res.json(data);
  } catch (error) {
    console.error('[emissionFactorLibrary/methodology]', error.message);
    res.status(500).json({ error: 'Failed to fetch methodology template' });
  }
});

// ── POST /api/emissions/validate ─────────────────────────────────────────────
// Validate activity data against methodology
router.post('/validate', authenticate, async (req, res) => {
  try {
    const { methodologyTemplate, categoryCode, data } = req.body;
    
    if (!methodologyTemplate || !categoryCode) {
      return res.status(400).json({ error: 'methodologyTemplate and categoryCode required' });
    }
    
    const templateData = await EmissionFactorLibrary.getMethodologyTemplate(methodologyTemplate);
    if (!templateData) {
      return res.status(404).json({ error: 'Methodology template not found' });
    }
    
    const category = templateData.categories.find(c => c.categoryCode === categoryCode);
    if (!category) {
      return res.status(404).json({ error: 'Activity category not found' });
    }
    
    const validation = EmissionFactorLibrary.validateActivityData(category, data || {});
    
    res.json({ 
      valid: validation.valid, 
      errors: validation.errors,
      category: {
        categoryCode: category.categoryCode,
        name: category.name,
        ghgScope: category.ghgScope,
        requiredFields: category.requiredFields,
        unitOptions: category.unitOptions
      }
    });
  } catch (error) {
    console.error('[emissionCalculation/validate]', error.message);
    res.status(500).json({ error: 'Validation failed' });
  }
});

module.exports = router;