// routes/compliance.js — EtherTrack CCTS Compliance API
// Covers:
//   #8  Compliance Position Dashboard — entity/plant positions, gap, penalty projection
//   #6  Netting engine — intra-group surplus/deficit netting before exchange routing
//   #9  Hedge contracts — forward buys, budget locks, price caps
//
// Endpoints:
//   GET    /api/compliance/entity
//   POST   /api/compliance/entity
//   GET    /api/compliance/plants
//   POST   /api/compliance/plants
//   PUT    /api/compliance/plants/:id
//   GET    /api/compliance/positions
//   POST   /api/compliance/positions
//   GET    /api/compliance/dashboard
//   POST   /api/compliance/netting/calculate
//   POST   /api/compliance/netting/confirm
//   GET    /api/compliance/netting
//   GET    /api/compliance/netting/:id
//   GET    /api/compliance/hedges
//   POST   /api/compliance/hedges
//   PUT    /api/compliance/hedges/:id        ← restored (dropped in v2)
//   DELETE /api/compliance/hedges/:id

'use strict';

const router    = require('express').Router();
const rateLimit = require('express-rate-limit');
const { safeQuery: query, withTransaction } = require('../db/pool');
const { authenticate, requireKYC } = require('../middleware/auth');
const { getCCCMarketPrice } = require('../services/priceFeedService');

// ── Rate limiters ─────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60_000, max: 120,
  keyGenerator: r => r.user?.id || r.ip,
});
const writeLimiter = rateLimit({
  windowMs: 60_000, max: 30,
  keyGenerator: r => r.user?.id || r.ip,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a numeric value from untrusted input.
 * Returns null (not NaN) if the value is absent or not a finite number.
 */
function safeFloat(val, fallback = null) {
  if (val === undefined || val === null || val === '') return fallback;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Fetch the active compliance period. Throws a structured error if none found.
 * Reuse this in every route that needs the current period to avoid repeated boilerplate.
 */
async function getActivePeriod() {
  const { rows } = await query(
    `SELECT * FROM compliance_periods WHERE is_active = TRUE LIMIT 1`
  );
  if (!rows.length) {
    const err = new Error('No active compliance period found');
    err.statusCode = 400;
    throw err;
  }
  return rows[0];
}

/**
 * Fetch the obligated entity for the current user. Throws if not found.
 */
async function getEntityForUser(userId) {
  const { rows } = await query(
    `SELECT id FROM obligated_entities WHERE user_id = $1`, [userId]
  );
  if (!rows.length) {
    const err = new Error('Create your entity profile first');
    err.statusCode = 400;
    throw err;
  }
  return rows[0];
}

/** Centralised error responder — avoids repeating status logic in every catch block. */
function handleError(res, context, err) {
  const code = err.statusCode || 500;
  console.error(`[${context}]`, err.message);
  res.status(code).json({ error: err.message || 'Internal server error' });
}

// ══════════════════════════════════════════════════════════════════
// OBLIGATED ENTITY — Onboarding + management
// ══════════════════════════════════════════════════════════════════

const VALID_ENTITY_TYPES = [
  'steel','cement','aluminium','fertiliser','power',
  'textile','pulp_paper','chlor_alkali','railway','other',
];

// GET /api/compliance/entity
router.get('/entity', authenticate, limiter, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT oe.*,
              COUNT(DISTINCT p.id)  AS plant_count,
              COUNT(DISTINCT cp.id) AS position_count
       FROM obligated_entities oe
       LEFT JOIN plants p  ON p.entity_id = oe.id AND p.is_active = TRUE
       LEFT JOIN compliance_positions cp ON cp.entity_id = oe.id
       WHERE oe.user_id = $1
       GROUP BY oe.id`,
      [req.user.id]
    );
    res.json({ entity: rows[0] || null });
  } catch (e) {
    handleError(res, 'compliance/entity GET', e);
  }
});

// POST /api/compliance/entity — upsert entity profile
// requireKYC applied: entity creation is a regulated onboarding step
router.post('/entity', authenticate, requireKYC, writeLimiter, async (req, res) => {
  const {
    entityName, entityType, dcId, gstin, pan, cin,
    complianceOfficer, complianceEmail, compliancePhone,
  } = req.body;

  if (!entityName || !entityType)
    return res.status(400).json({ error: 'entityName and entityType required' });
  if (!VALID_ENTITY_TYPES.includes(entityType))
    return res.status(400).json({ error: `entityType must be one of: ${VALID_ENTITY_TYPES.join(', ')}` });

  try {
    const { rows } = await query(
      `INSERT INTO obligated_entities
         (user_id, entity_name, entity_type, dc_id, gstin, pan, cin,
          compliance_officer, compliance_email, compliance_phone, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         entity_name        = EXCLUDED.entity_name,
         entity_type        = EXCLUDED.entity_type,
         dc_id              = EXCLUDED.dc_id,
         gstin              = EXCLUDED.gstin,
         pan                = EXCLUDED.pan,
         cin                = EXCLUDED.cin,
         compliance_officer = EXCLUDED.compliance_officer,
         compliance_email   = EXCLUDED.compliance_email,
         compliance_phone   = EXCLUDED.compliance_phone,
         updated_at         = NOW()
       RETURNING *`,
      [req.user.id, entityName, entityType,
       dcId||null, gstin||null, pan||null, cin||null,
       complianceOfficer||null, complianceEmail||null, compliancePhone||null]
    );
    res.json({ entity: rows[0] });
  } catch (e) {
    handleError(res, 'compliance/entity POST', e);
  }
});

// ── Plants ─────────────────────────────────────────────────────────────────────

// GET /api/compliance/plants
router.get('/plants', authenticate, limiter, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT p.*,
              cp.target_ccc, cp.held_ccc, cp.surrendered_ccc,
              cp.pending_purchase_ccc, cp.period_id
       FROM plants p
       JOIN obligated_entities oe ON oe.id = p.entity_id AND oe.user_id = $1
       LEFT JOIN compliance_positions cp
         ON cp.plant_id = p.id
         AND cp.period_id = (SELECT id FROM compliance_periods WHERE is_active = TRUE LIMIT 1)
       WHERE p.is_active = TRUE
       ORDER BY p.plant_name`,
      [req.user.id]
    );
    res.json({ plants: rows });
  } catch (e) {
    handleError(res, 'compliance/plants GET', e);
  }
});

// POST /api/compliance/plants
router.post('/plants', authenticate, writeLimiter, async (req, res) => {
  const {
    plantName, plantCode, state, district, sector,
    installedCapacity, capacityUnit, baselineSec, secUnit,
  } = req.body;
  if (!plantName) return res.status(400).json({ error: 'plantName required' });

  try {
    const entity = await getEntityForUser(req.user.id);
    const { rows } = await query(
      `INSERT INTO plants
         (entity_id, plant_name, plant_code, state, district, sector,
          installed_capacity, capacity_unit, baseline_sec, sec_unit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [entity.id, plantName, plantCode||null, state||null, district||null, sector||null,
       safeFloat(installedCapacity), capacityUnit||null,
       safeFloat(baselineSec), secUnit||null]
    );
    res.status(201).json({ plant: rows[0] });
  } catch (e) {
    handleError(res, 'compliance/plants POST', e);
  }
});

// PUT /api/compliance/plants/:id
router.put('/plants/:id', authenticate, writeLimiter, async (req, res) => {
  const {
    plantName, plantCode, state, district, sector,
    installedCapacity, capacityUnit, baselineSec, secUnit, isActive,
  } = req.body;
  try {
    const { rows } = await query(
      `UPDATE plants p SET
         plant_name         = COALESCE($1,  p.plant_name),
         plant_code         = COALESCE($2,  p.plant_code),
         state              = COALESCE($3,  p.state),
         district           = COALESCE($4,  p.district),
         sector             = COALESCE($5,  p.sector),
         installed_capacity = COALESCE($6,  p.installed_capacity),
         capacity_unit      = COALESCE($7,  p.capacity_unit),
         baseline_sec       = COALESCE($8,  p.baseline_sec),
         sec_unit           = COALESCE($9,  p.sec_unit),
         is_active          = COALESCE($10, p.is_active),
         updated_at         = NOW()
       FROM obligated_entities oe
       WHERE p.id = $11 AND p.entity_id = oe.id AND oe.user_id = $12
       RETURNING p.*`,
      [plantName||null, plantCode||null, state||null, district||null, sector||null,
       safeFloat(installedCapacity), capacityUnit||null,
       safeFloat(baselineSec), secUnit||null,
       isActive !== undefined ? Boolean(isActive) : null,
       req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Plant not found' });
    res.json({ plant: rows[0] });
  } catch (e) {
    handleError(res, 'compliance/plants PUT', e);
  }
});

// ══════════════════════════════════════════════════════════════════
// COMPLIANCE POSITIONS
// ══════════════════════════════════════════════════════════════════

// GET /api/compliance/positions — read positions for current period
// (was missing in both versions; needed for standalone position views)
router.get('/positions', authenticate, limiter, async (req, res) => {
  try {
    const period = await getActivePeriod();
    const { rows } = await query(
      `SELECT cp.*, p.plant_name, p.plant_code, p.state, p.sector
       FROM compliance_positions cp
       JOIN obligated_entities oe ON oe.id = cp.entity_id AND oe.user_id = $1
       LEFT JOIN plants p ON p.id = cp.plant_id
       WHERE cp.period_id = $2
       ORDER BY p.plant_name`,
      [req.user.id, period.id]
    );
    res.json({ positions: rows, periodId: period.id, cycleName: period.cycle_name });
  } catch (e) {
    handleError(res, 'compliance/positions GET', e);
  }
});

// POST /api/compliance/positions — upsert position for plant + period
router.post('/positions', authenticate, writeLimiter, async (req, res) => {
  const { plantId, periodId, targetCcc, heldCcc, surrenderedCcc, notes } = req.body;

  const tgt = safeFloat(targetCcc);
  const hld = safeFloat(heldCcc);
  if (tgt === null || hld === null)
    return res.status(400).json({ error: 'targetCcc and heldCcc must be valid numbers' });
  if (tgt < 0 || hld < 0)
    return res.status(400).json({ error: 'CCC values cannot be negative' });

  try {
    const [entity, period] = await Promise.all([
      getEntityForUser(req.user.id),
      periodId
        ? query(`SELECT id FROM compliance_periods WHERE id = $1`, [periodId]).then(r => r.rows[0])
        : getActivePeriod(),
    ]);
    if (!period) return res.status(400).json({ error: 'No active compliance period found' });

    const { rows } = await query(
      `INSERT INTO compliance_positions
         (entity_id, plant_id, period_id, target_ccc, held_ccc, surrendered_ccc,
          notes, data_source, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'self_declared',NOW())
       ON CONFLICT (entity_id, plant_id, period_id) DO UPDATE SET
         target_ccc      = EXCLUDED.target_ccc,
         held_ccc        = EXCLUDED.held_ccc,
         surrendered_ccc = EXCLUDED.surrendered_ccc,
         notes           = EXCLUDED.notes,
         data_source     = 'self_declared',
         updated_at      = NOW()
       RETURNING *`,
      [entity.id, plantId||null, period.id, tgt, hld, safeFloat(surrenderedCcc, 0), notes||null]
    );
    res.json({ position: rows[0] });
  } catch (e) {
    handleError(res, 'compliance/positions POST', e);
  }
});

// ══════════════════════════════════════════════════════════════════
// CFO DASHBOARD (#8) — The flagship endpoint
// Returns: entity summary, plant breakdown, gap analysis,
//          penalty projection, cost-to-comply, hedge summary
// ══════════════════════════════════════════════════════════════════

router.get('/dashboard', authenticate, limiter, async (req, res) => {
  try {
    // 1. Entity + active period in one query
    const { rows: entityRows } = await query(
      `SELECT oe.*, cp_period.id AS period_id, cp_period.cycle_name,
              cp_period.surrender_deadline, cp_period.penalty_per_ccc_inr,
              cp_period.end_date AS period_end
       FROM obligated_entities oe
       CROSS JOIN (SELECT * FROM compliance_periods WHERE is_active = TRUE LIMIT 1) cp_period
       WHERE oe.user_id = $1`,
      [req.user.id]
    );
    if (!entityRows.length) {
      return res.json({
        onboarded: false,
        message: 'Complete your entity profile to see compliance position',
      });
    }
    const entity   = entityRows[0];
    const periodId = entity.period_id;

    // 2. Fan out all remaining DB queries + market price fetch in parallel
    const [plantResult, aggResult, hedgeResult, nettingResult, marketPrice] =
      await Promise.allSettled([
        // Plant-level positions
        query(
          `SELECT
             p.id AS plant_id, p.plant_name, p.plant_code, p.state, p.sector,
             COALESCE(cp.target_ccc, 0)           AS target_ccc,
             COALESCE(cp.held_ccc, 0)             AS held_ccc,
             COALESCE(cp.surrendered_ccc, 0)      AS surrendered_ccc,
             COALESCE(cp.pending_purchase_ccc, 0) AS pending_purchase_ccc,
             COALESCE(cp.held_ccc, 0) - COALESCE(cp.target_ccc, 0) AS plant_gap,
             cp.data_source, cp.last_synced_at
           FROM plants p
           JOIN obligated_entities oe ON oe.id = p.entity_id AND oe.user_id = $1
           LEFT JOIN compliance_positions cp ON cp.plant_id = p.id AND cp.period_id = $2
           WHERE p.is_active = TRUE
           ORDER BY p.plant_name`,
          [req.user.id, periodId]
        ),
        // Entity-level aggregates
        query(
          `SELECT
             COALESCE(SUM(cp.target_ccc), 0)           AS total_target,
             COALESCE(SUM(cp.held_ccc), 0)             AS total_held,
             COALESCE(SUM(cp.surrendered_ccc), 0)      AS total_surrendered,
             COALESCE(SUM(cp.pending_purchase_ccc), 0) AS total_pending
           FROM compliance_positions cp
           JOIN obligated_entities oe ON oe.id = cp.entity_id AND oe.user_id = $1
           WHERE cp.period_id = $2`,
          [req.user.id, periodId]
        ),
        // Active hedge summary
        query(
          `SELECT contract_type, status,
                  SUM(quantity_ccc)      AS qty,
                  SUM(quantity_executed) AS executed,
                  SUM(budget_inr)        AS budget,
                  SUM(budget_used_inr)   AS budget_used,
                  AVG(locked_price_inr)  AS avg_locked_price
           FROM hedge_contracts hc
           JOIN obligated_entities oe ON oe.id = hc.entity_id AND oe.user_id = $1
           WHERE hc.period_id = $2 AND hc.status = 'active'
           GROUP BY contract_type, status`,
          [req.user.id, periodId]
        ),
        // Latest netting session
        query(
          `SELECT ns.*
           FROM netting_sessions ns
           JOIN obligated_entities oe ON oe.id = ns.entity_id AND oe.user_id = $1
           WHERE ns.period_id = $2
           ORDER BY ns.created_at DESC LIMIT 1`,
          [req.user.id, periodId]
        ),
        // Market price (non-critical — dashboard still loads if this fails)
        getCCCMarketPrice().catch(() => null),
      ]);

    const plantPositions = plantResult.status === 'fulfilled' ? plantResult.value.rows : [];
    const agg            = aggResult.status === 'fulfilled'
      ? aggResult.value.rows[0]
      : { total_target: 0, total_held: 0, total_surrendered: 0, total_pending: 0 };
    const hedgeRows      = hedgeResult.status === 'fulfilled'   ? hedgeResult.value.rows    : [];
    const nettingRows    = nettingResult.status === 'fulfilled' ? nettingResult.value.rows  : [];
    const market         = marketPrice.status === 'fulfilled'   ? marketPrice.value         : null;

    // 3. Compute summary figures
    const totalTarget      = safeFloat(agg.total_target,      0);
    const totalHeld        = safeFloat(agg.total_held,        0);
    const totalSurrendered = safeFloat(agg.total_surrendered, 0);
    const totalPending     = safeFloat(agg.total_pending,     0);
    const netGap           = totalHeld + totalPending - totalTarget; // negative = deficit
    const penaltyRate      = safeFloat(entity.penalty_per_ccc_inr, 0);
    const priceInr         = market?.price_inr || null;

    // 4. Cost-to-comply vs penalty
    let costToComply   = null;
    let penaltyIfShort = null;
    let recommendation = null;

    if (netGap < 0 && priceInr) {
      const shortfall = Math.abs(netGap);
      costToComply    = shortfall * priceInr * 1.005; // includes 0.5% platform fee
      penaltyIfShort  = shortfall * penaltyRate;
      recommendation  = costToComply < penaltyIfShort
        ? `Buy ${Math.ceil(shortfall)} CCCs — cheaper than penalty by ₹${Math.round(penaltyIfShort - costToComply).toLocaleString('en-IN')}`
        : `Evaluate penalty vs purchase — penalty ₹${Math.round(penaltyIfShort).toLocaleString('en-IN')} vs buy cost ₹${Math.round(costToComply).toLocaleString('en-IN')}`;
    } else if (netGap > 0) {
      recommendation = `Surplus of ${netGap.toFixed(0)} CCCs — consider selling on exchange`;
    } else {
      recommendation = 'Position balanced — consider hedging against price movements';
    }

    // 5. Deadline urgency
    const daysLeft = Math.max(0, Math.ceil(
      (new Date(entity.surrender_deadline) - new Date()) / (1000 * 60 * 60 * 24)
    ));
    const urgency = daysLeft < 30 ? 'critical' : daysLeft < 90 ? 'high' : daysLeft < 180 ? 'medium' : 'low';

    res.json({
      onboarded: true,
      entity: {
        id:         entity.id,
        name:       entity.entity_name,
        type:       entity.entity_type,
        dcId:       entity.dc_id,
        isVerified: entity.is_verified,
      },
      period: {
        id:               periodId,
        cycleName:        entity.cycle_name,
        surrenderDeadline: entity.surrender_deadline,
        periodEnd:        entity.period_end,
        daysLeft,
        urgency,
        penaltyPerCCC:    penaltyRate,
      },
      summary: {
        totalTarget,
        totalHeld,
        totalSurrendered,
        totalPending,
        netGap,
        positionStatus: netGap < 0 ? 'deficit' : netGap > 0 ? 'surplus' : 'balanced',
        completionPct:  totalTarget > 0
          ? Math.min(100, ((totalHeld + totalSurrendered) / totalTarget) * 100).toFixed(1)
          : '100.0',
      },
      marketContext: {
        currentPriceInr: priceInr,
        priceSource:     market?.source || null,
        costToComply,
        penaltyIfShort,
        recommendation,
      },
      plantBreakdown: plantPositions.map(p => ({
        ...p,
        status: parseFloat(p.plant_gap) >= 0 ? 'surplus' : 'deficit',
        gapAbs: Math.abs(parseFloat(p.plant_gap)),
      })),
      hedgeSummary: hedgeRows,
      lastNetting:  nettingRows[0] || null,
    });
  } catch (e) {
    handleError(res, 'compliance/dashboard', e);
  }
});

// ══════════════════════════════════════════════════════════════════
// INTRA-GROUP NETTING ENGINE (#6)
// ══════════════════════════════════════════════════════════════════

// POST /api/compliance/netting/calculate — dry run, returns netting result
router.post('/netting/calculate', authenticate, limiter, async (req, res) => {
  try {
    const [entity, activePeriod] = await Promise.all([
      getEntityForUser(req.user.id),
      getActivePeriod(),
    ]);

    // Fetch plant positions and market price in parallel
    const [positionsResult, marketResult] = await Promise.allSettled([
      query(
        `SELECT p.id AS plant_id, p.plant_name, p.plant_code,
                COALESCE(cp.target_ccc, 0) AS target_ccc,
                COALESCE(cp.held_ccc, 0)   AS held_ccc,
                COALESCE(cp.held_ccc, 0) - COALESCE(cp.target_ccc, 0) AS plant_position,
                cp.id AS position_id
         FROM plants p
         LEFT JOIN compliance_positions cp ON cp.plant_id = p.id AND cp.period_id = $1
         WHERE p.entity_id = $2 AND p.is_active = TRUE
         ORDER BY p.plant_name`,
        [activePeriod.id, entity.id]
      ),
      getCCCMarketPrice().catch(() => null),
    ]);

    const positions  = positionsResult.status === 'fulfilled' ? positionsResult.value.rows : [];
    const marketPrice = marketResult.status === 'fulfilled' ? marketResult.value : null;

    // Netting algorithm:
    // Separate surplus/deficit plants, allocate surplus to deficits in order of magnitude.
    const surplusPlants = positions
      .filter(p => parseFloat(p.plant_position) > 0)
      .map(p => ({ ...p, plant_position: parseFloat(p.plant_position) }));
    const deficitPlants = positions
      .filter(p => parseFloat(p.plant_position) < 0)
      .map(p => ({ ...p, plant_position: parseFloat(p.plant_position) }));

    const grossSurplus = surplusPlants.reduce((s, p) => s + p.plant_position, 0);
    const grossDeficit = Math.abs(deficitPlants.reduce((s, p) => s + p.plant_position, 0));

    let remainingSurplus = grossSurplus;
    const lines = positions.map(p => {
      const pos = parseFloat(p.plant_position);
      let allocated = 0;
      if (pos < 0 && remainingSurplus > 0) {
        allocated        = Math.min(Math.abs(pos), remainingSurplus);
        remainingSurplus -= allocated;
      }
      return {
        plantId:        p.plant_id,
        plantName:      p.plant_name,
        plantCode:      p.plant_code,
        targetCcc:      parseFloat(p.target_ccc),
        heldCcc:        parseFloat(p.held_ccc),
        plantPosition:  pos,
        allocatedCcc:   pos < 0 ? allocated : (pos > 0 ? Math.min(pos, grossDeficit) : 0),
        postNettingGap: pos < 0 ? -(Math.abs(pos) - allocated) : pos,
        positionId:     p.position_id,
      };
    });

    const netPosition = grossSurplus - grossDeficit;
    const netAction   = netPosition > 0 ? 'sell' : netPosition < 0 ? 'buy' : 'flat';
    const netValueInr = marketPrice ? Math.abs(netPosition) * marketPrice.price_inr : null;

    res.json({
      periodId:       activePeriod.id,
      cycleName:      activePeriod.cycle_name,
      grossSurplus,
      grossDeficit,
      netPosition,
      netAction,
      netValueInr,
      marketPriceInr: marketPrice?.price_inr || null,
      recommendation: netAction === 'flat'
        ? 'Group is balanced — no exchange trading needed'
        : netAction === 'sell'
          ? `Sell ${netPosition.toFixed(0)} CCCs on IEX or PXIL after netting`
          : `Buy ${Math.abs(netPosition).toFixed(0)} CCCs on IEX or PXIL after netting`,
      lines,
      canSaveSession: true,
    });
  } catch (e) {
    handleError(res, 'netting/calculate', e);
  }
});

// POST /api/compliance/netting/confirm — save netting session to DB
router.post('/netting/confirm', authenticate, writeLimiter, async (req, res) => {
  const { sessionName, periodId, lines, netPosition, netAction, grossSurplus, grossDeficit } = req.body;

  if (!Array.isArray(lines) || !lines.length)
    return res.status(400).json({ error: 'lines must be a non-empty array' });

  try {
    const [entity, activePeriodId] = await Promise.all([
      getEntityForUser(req.user.id),
      periodId
        ? Promise.resolve(periodId)
        : getActivePeriod().then(p => p.id),
    ]);

    let sessionId;
    await withTransaction(async (client) => {
      const { rows: sessionRows } = await client.query(
        `INSERT INTO netting_sessions
           (entity_id, period_id, session_name, status,
            gross_surplus_ccc, gross_deficit_ccc, net_position_ccc, net_action,
            created_by, updated_at)
         VALUES ($1,$2,$3,'confirmed',$4,$5,$6,$7,$8,NOW())
         RETURNING id`,
        [entity.id, activePeriodId,
         sessionName || `Netting ${new Date().toLocaleDateString('en-IN')}`,
         safeFloat(grossSurplus, 0), safeFloat(grossDeficit, 0),
         safeFloat(netPosition, 0), netAction || 'flat',
         req.user.id]
      );
      sessionId = sessionRows[0].id;

      // Bulk INSERT — avoids N round-trips inside the transaction
      const valuePlaceholders = lines.map((_, i) => {
        const base = i * 8;
        return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8})`;
      }).join(',');

      const flatValues = lines.flatMap(l => [
        sessionId, l.plantId, l.positionId || null,
        safeFloat(l.targetCcc, 0), safeFloat(l.heldCcc, 0),
        safeFloat(l.plantPosition, 0), safeFloat(l.allocatedCcc, 0),
        safeFloat(l.postNettingGap, 0),
      ]);

      await client.query(
        `INSERT INTO netting_session_lines
           (session_id, plant_id, position_id, target_ccc, held_ccc,
            plant_position, allocated_ccc, post_netting_gap)
         VALUES ${valuePlaceholders}`,
        flatValues
      );
    });

    res.status(201).json({ sessionId, message: 'Netting session confirmed' });
  } catch (e) {
    handleError(res, 'netting/confirm', e);
  }
});

// GET /api/compliance/netting — list sessions
router.get('/netting', authenticate, limiter, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT ns.*
       FROM netting_sessions ns
       JOIN obligated_entities oe ON oe.id = ns.entity_id AND oe.user_id = $1
       ORDER BY ns.created_at DESC
       LIMIT 20`,
      [req.user.id]
    );
    res.json({ sessions: rows });
  } catch (e) {
    handleError(res, 'netting GET', e);
  }
});

// GET /api/compliance/netting/:id — session detail with lines
router.get('/netting/:id', authenticate, limiter, async (req, res) => {
  try {
    const { rows: sessionRows } = await query(
      `SELECT ns.*
       FROM netting_sessions ns
       JOIN obligated_entities oe ON oe.id = ns.entity_id AND oe.user_id = $1
       WHERE ns.id = $2`,
      [req.user.id, req.params.id]
    );
    if (!sessionRows.length) return res.status(404).json({ error: 'Session not found' });

    const { rows: lineRows } = await query(
      `SELECT nsl.*, p.plant_name, p.plant_code
       FROM netting_session_lines nsl
       JOIN plants p ON p.id = nsl.plant_id
       WHERE nsl.session_id = $1`,
      [req.params.id]
    );

    res.json({ session: sessionRows[0], lines: lineRows });
  } catch (e) {
    handleError(res, 'netting/:id GET', e);
  }
});

// ══════════════════════════════════════════════════════════════════
// HEDGE CONTRACTS (#9)
// ══════════════════════════════════════════════════════════════════

const VALID_HEDGE_TYPES = ['forward_buy','forward_sell','budget_lock','price_cap'];

// GET /api/compliance/hedges
router.get('/hedges', authenticate, limiter, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT hc.*, p.plant_name, cp_period.cycle_name
       FROM hedge_contracts hc
       JOIN obligated_entities oe ON oe.id = hc.entity_id AND oe.user_id = $1
       LEFT JOIN plants p ON p.id = hc.plant_id
       LEFT JOIN compliance_periods cp_period ON cp_period.id = hc.period_id
       ORDER BY hc.created_at DESC`,
      [req.user.id]
    );
    res.json({ hedges: rows });
  } catch (e) {
    handleError(res, 'hedges GET', e);
  }
});

// POST /api/compliance/hedges
router.post('/hedges', authenticate, requireKYC, writeLimiter, async (req, res) => {
  const {
    contractType, plantId, quantityCcc, lockedPriceInr, maxPriceInr,
    budgetInr, executionDate, expiryDate, notes, counterparty,
  } = req.body;

  if (!VALID_HEDGE_TYPES.includes(contractType))
    return res.status(400).json({ error: `contractType must be one of: ${VALID_HEDGE_TYPES.join(', ')}` });
  if (!quantityCcc || safeFloat(quantityCcc) <= 0)
    return res.status(400).json({ error: 'quantityCcc must be a positive number' });
  if (!expiryDate)
    return res.status(400).json({ error: 'expiryDate required' });
  if (['forward_buy','forward_sell'].includes(contractType) && !lockedPriceInr)
    return res.status(400).json({ error: 'lockedPriceInr required for forward contracts' });
  if (contractType === 'budget_lock' && !budgetInr)
    return res.status(400).json({ error: 'budgetInr required for budget_lock' });
  if (contractType === 'price_cap' && !maxPriceInr)
    return res.status(400).json({ error: 'maxPriceInr required for price_cap' });

  try {
    const [entity, period] = await Promise.all([
      getEntityForUser(req.user.id),
      getActivePeriod(),
    ]);

    const { rows } = await query(
      `INSERT INTO hedge_contracts
         (entity_id, period_id, plant_id, contract_type, quantity_ccc,
          locked_price_inr, max_price_inr, budget_inr, execution_date,
          expiry_date, notes, counterparty, created_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
       RETURNING *`,
      [entity.id, period.id, plantId||null, contractType, safeFloat(quantityCcc),
       safeFloat(lockedPriceInr), safeFloat(maxPriceInr), safeFloat(budgetInr),
       executionDate||null, expiryDate, notes||null, counterparty||null, req.user.id]
    );
    res.status(201).json({ hedge: rows[0] });
  } catch (e) {
    handleError(res, 'hedges POST', e);
  }
});

// PUT /api/compliance/hedges/:id — update a hedge contract (restored; missing in v2)
router.put('/hedges/:id', authenticate, requireKYC, writeLimiter, async (req, res) => {
  const {
    quantityCcc, lockedPriceInr, maxPriceInr, budgetInr,
    executionDate, expiryDate, notes, counterparty,
  } = req.body;

  try {
    const { rows } = await query(
      `UPDATE hedge_contracts hc SET
         quantity_ccc      = COALESCE($1, hc.quantity_ccc),
         locked_price_inr  = COALESCE($2, hc.locked_price_inr),
         max_price_inr     = COALESCE($3, hc.max_price_inr),
         budget_inr        = COALESCE($4, hc.budget_inr),
         execution_date    = COALESCE($5, hc.execution_date),
         expiry_date       = COALESCE($6, hc.expiry_date),
         notes             = COALESCE($7, hc.notes),
         counterparty      = COALESCE($8, hc.counterparty),
         updated_at        = NOW()
       FROM obligated_entities oe
       WHERE hc.id = $9 AND hc.entity_id = oe.id AND oe.user_id = $10
         AND hc.status = 'active'
       RETURNING hc.*`,
      [safeFloat(quantityCcc), safeFloat(lockedPriceInr), safeFloat(maxPriceInr), safeFloat(budgetInr),
       executionDate||null, expiryDate||null, notes||null, counterparty||null,
       req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Hedge not found, not active, or not yours' });
    res.json({ hedge: rows[0] });
  } catch (e) {
    handleError(res, 'hedges PUT', e);
  }
});

// DELETE /api/compliance/hedges/:id — soft-delete (cancel)
router.delete('/hedges/:id', authenticate, writeLimiter, async (req, res) => {
  try {
    const { rowCount } = await query(
      `UPDATE hedge_contracts hc SET status = 'cancelled', updated_at = NOW()
       FROM obligated_entities oe
       WHERE hc.id = $1 AND hc.entity_id = oe.id AND oe.user_id = $2
         AND hc.status = 'active'`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Hedge not found or already inactive' });
    res.json({ message: 'Hedge contract cancelled' });
  } catch (e) {
    handleError(res, 'hedges DELETE', e);
  }
});

module.exports = router;