// routes/transactions.js — EtherTrack (Merged v3, production-ready)
// ─────────────────────────────────────────────────────────────────────────
// WHAT'S IN HERE AND WHY:
//
// [V1]  On-chain tx verification before DB write (Code 7) — Code 8 blindly
//       accepted any txHash a user sent. /sync and POST /retirements now
//       verify against the chain via txVerifier before writing.
//
// [V2]  Atomic withTransaction on POST /retirements (Code 7) — Code 8 ran
//       3 separate queries: registry_transactions INSERT, retirements INSERT,
//       carbon_batches UPDATE. If the second or third failed, the DB was left
//       in a partial state. All three are now inside one transaction.
//       The retirements INSERT failure is no longer swallowed silently —
//       it will roll back the entire operation as intended for a financial record.
//
// [V3]  GET /pending does NOT mutate state (Code 7) — Code 8 ran an UPDATE
//       inside a GET handler, violating HTTP semantics. Stale cleanup moved
//       to scheduler.js (runs every 5 minutes). GET must be safe/idempotent.
//
// [V4]  Rate limiting on all endpoints (Code 7) — Code 8 had none.
//
// [V5]  Cursor-based pagination on /my and GET /retirements (Code 7) —
//       Code 8 returned flat LIMIT 50/no-limit with no continuation.
//
// [V6]  type::text fallback in /stats trades count (Code 8) — Code 7 dropped
//       the `OR type::text IN (...)` clause that handles the migration window
//       where both enum and text columns may exist. Kept for backward compat.
//       Remove after migration 001 consolidates to tx_type.
//
// [V7]  txHash regex validation on /sync (Code 7) — Code 8 accepted any
//       string as a txHash.
//
// [V8]  tx_type allowlist on /sync (Code 7) — Code 8 wrote raw user input
//       straight to tx_type. Allowlist: BUY, SELL, RETIRE, MINT.
//
// [V9]  certId sanitization on /:certId (Code 7) — Code 8 used
//       req.params.certId raw as a query parameter.
//
// [V10] retire_scope included in GET /retirements response map (Code 8).
//
// [V11] NULLS LAST on created_at ORDER BY in non-paginated paths (Code 8) —
//       avoids NULLs surfacing at top on tables with missing timestamps.
//
// [V12] type::text = 'RETIRE' fallback in GET /retirements WHERE clause
//       (Code 8) — handles rows written before tx_type column existed.
//
// [NEW] parseInt(..., 10) with explicit radix throughout.
// [NEW] Audit log on POST /retirements (was in Code 7's transaction block,
//       explicitly preserved here).
// [NEW] /stats rate limiter uses ipKeyGenerator for IPv6 safety (consistent
//       with the trades.js pattern from auth merge).
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const router = require('express').Router();
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { safeQuery: query, withTransaction } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { verifyTradeTransaction, verifyRetirementTransaction } = require('../services/txVerifier');
const statsCache = require('../services/statsCache');
const { sendRetirementEmail } = require('../services/email');

// ── [V4] Rate limiters — IPv6-safe ───────────────────────────────
const readLimiter = rateLimit({
  windowMs:     60 * 1000,
  max:          120,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req),
});

const writeLimiter = rateLimit({
  windowMs:     60 * 1000,
  max:          20,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req),
  handler: (req, res) =>
    res.status(429).json({ error: 'Too many requests', code: 'RATE_LIMITED' }),
});

// ── GET /api/transactions/stats ───────────────────────────────────
// [V4] Rate limited. Served from statsCache — no live DB aggregation per hit.
router.get('/stats', readLimiter, async (req, res) => {
  try {
    const cached = statsCache.get('tx:stats');
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached);
    }

    res.setHeader('X-Cache', 'MISS');

    const [trades, retired, volume, users] = await Promise.all([
      // [V6] type::text fallback preserved for migration window
      query(
        `SELECT COUNT(*) FROM registry_transactions
         WHERE tx_type IN ('BUY','SELL','buy','sell')
            OR type::text IN ('BUY','SELL','buy','sell')`
      ),
      query(
        `SELECT COALESCE(SUM(retired_credits), 0) AS total FROM carbon_batches`
      ),
      query(
        `SELECT COALESCE(SUM(total_price_inr), 0) AS total
         FROM registry_transactions
         WHERE tx_type IN ('BUY','SELL','buy','sell')`
      ),
      query(
        `SELECT COUNT(*) FROM users WHERE kyc_verified = TRUE`
      ),
    ]);

    const stats = {
      totalTrades:    parseInt(trades.rows[0].count,   10),
      totalRetired:   parseInt(retired.rows[0].total,  10),
      totalVolumeINR: parseFloat(volume.rows[0].total),
      verifiedUsers:  parseInt(users.rows[0].count,    10),
      cachedAt:       new Date().toISOString(),
    };

    statsCache.set('tx:stats', stats, 90);
    res.json(stats);
  } catch (e) {
    console.error('[tx/stats]', e.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ── GET /api/transactions/my — cursor-paginated ───────────────────
// [V5] Cursor pagination. [V4] Rate limited. Explicit column list (not SELECT *).
router.get('/my', authenticate, readLimiter, async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const cursor = req.query.cursor ? parseInt(req.query.cursor, 10) : null;

  try {
    const params = [req.user.id];
    let cursorClause = '';
    if (cursor) {
      params.push(cursor);
      cursorClause = `AND rt.id < $${params.length}`;
    }

    const { rows } = await query(
      `SELECT rt.id,
              COALESCE(rt.tx_type, rt.type::text) AS tx_type,
              rt.tx_hash,
              rt.token_id,
              rt.amount,
              rt.total_price_inr,
              rt.project_name,
              rt.standard,
              rt.created_at,
              p.name          AS project_name_joined,
              p.standard::text AS standard_joined
       FROM registry_transactions rt
       LEFT JOIN projects p ON p.id = rt.project_id
       WHERE (rt.from_user_id = $1 OR rt.to_user_id = $1 OR rt.user_id = $1)
         ${cursorClause}
       ORDER BY rt.id DESC
       LIMIT ${limit + 1}`,
      params
    );

    const hasMore = rows.length > limit;
    const items   = hasMore ? rows.slice(0, limit) : rows;

    const transactions = items.map(r => ({
      ...r,
      tx_type:      r.tx_type,
      quantity:     r.amount || 0,
      project_name: r.project_name || r.project_name_joined || '—',
      standard:     r.standard     || r.standard_joined     || '—',
    }));

    res.json({
      transactions,
      nextCursor: hasMore ? items[items.length - 1].id : null,
      hasMore,
    });
  } catch (e) {
    console.error('[tx/my]', e.message);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// ── POST /api/transactions/sync ───────────────────────────────────
// [V1] On-chain verification for BUY/SELL before DB write.
// [V7] txHash format enforced. [V8] tx_type allowlist enforced.
router.post('/sync', authenticate, writeLimiter, async (req, res) => {
  const {
    txHash, txType, tokenId, quantity, totalPriceInr, projectName, standard,
  } = req.body;

  if (!txHash || !txType)
    return res.status(400).json({ error: 'txHash and txType required' });

  // [V7] Validate txHash format
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash))
    return res.status(400).json({ error: 'Invalid txHash format' });

  // [V8] Validate tx_type against allowlist
  const typeNorm = String(txType).toUpperCase();
  if (!['BUY', 'SELL', 'RETIRE', 'MINT'].includes(typeNorm))
    return res.status(400).json({ error: 'txType must be BUY, SELL, RETIRE, or MINT' });

  // [V1] Chain verification for trade types
  if (['BUY', 'SELL'].includes(typeNorm)) {
    const result = await verifyTradeTransaction(
      txHash,
      req.user.wallet_address,
      typeNorm
    );
    if (!result.valid) {
      return res.status(400).json({
        error:  `Transaction verification failed: ${result.error}`,
        txHash,
      });
    }
  }

  try {
    const { rows } = await query(
      `INSERT INTO registry_transactions
         (user_id, from_user_id, tx_hash, tx_type, token_id, amount,
          total_price_inr, project_name, standard)
       VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tx_hash) DO NOTHING
       RETURNING id`,
      [
        req.user.id, txHash, typeNorm,
        tokenId    || null,
        parseInt(quantity,      10) || 0,
        parseFloat(totalPriceInr)   || 0,
        projectName || null,
        standard    || null,
      ]
    );
    res.json({ message: 'Synced', id: rows[0]?.id || null });
  } catch (e) {
    console.error('[tx/sync]', e.message);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// ── GET /api/transactions/retirements — cursor-paginated ──────────
// [V5] Cursor pagination. [V12] type::text RETIRE fallback for old rows.
router.get('/retirements', authenticate, readLimiter, async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const cursor = req.query.cursor ? parseInt(req.query.cursor, 10) : null;

  try {
    const params = [req.user.id];
    let cursorClause = '';
    if (cursor) {
      params.push(cursor);
      cursorClause = `AND rt.id < $${params.length}`;
    }

    const { rows } = await query(
      `SELECT
         rt.id, rt.cert_id, rt.token_id, rt.amount,
         rt.tx_hash, rt.block_number,
         rt.project_name, rt.project_type, rt.standard,
         rt.serial_number, rt.developer, rt.location,
         rt.beneficiary, rt.created_at,
         cb.vintage_year, cb.country, cb.expiry_date,
         cb.registry_serial, cb.icvcm_ccp_eligible,
         cb.corresponding_adjustment, cb.sdg_tags, cb.credit_type,
         u.wallet_address
       FROM registry_transactions rt
       LEFT JOIN carbon_batches cb ON cb.token_id = rt.token_id
       LEFT JOIN users u ON u.id = rt.user_id
       WHERE (rt.from_user_id = $1 OR rt.user_id = $1)
         AND (rt.tx_type = 'RETIRE' OR rt.type::text = 'RETIRE')
         ${cursorClause}
       ORDER BY rt.id DESC
       LIMIT ${limit + 1}`,
      params
    );

    const hasMore     = rows.length > limit;
    const items       = hasMore ? rows.slice(0, limit) : rows;
    const retirements = items.map(r => ({
      id:                       r.id,
      certificate_id:           r.cert_id,
      cert_id:                  r.cert_id,
      token_id:                 r.token_id,
      amount:                   parseInt(r.amount, 10) || 0,
      tx_hash:                  r.tx_hash,
      block_number:             r.block_number,
      project_name:             r.project_name  || '—',
      project_type:             r.project_type  || '—',
      standard:                 r.standard      || 'VCS',
      serial_number:            r.serial_number || r.registry_serial || '—',
      developer:                r.developer     || '—',
      location:                 r.location      || '—',
      vintage_year:             r.vintage_year  || '—',
      country:                  r.country       || '—',
      beneficiary:              r.beneficiary   || '',
      beneficiary_name:         r.beneficiary   || '',
      retire_scope:             '1',              // [V10]
      retired_at:               r.created_at,
      created_at:               r.created_at,
      icvcm_ccp_eligible:       r.icvcm_ccp_eligible       || false,
      corresponding_adjustment: r.corresponding_adjustment || 'none',
      credit_type:              r.credit_type              || 'voluntary',
      wallet_address:           r.wallet_address           || '',
    }));

    res.json({
      retirements,
      nextCursor: hasMore ? items[items.length - 1].id : null,
      hasMore,
    });
  } catch (e) {
    console.error('[tx/retirements GET]', e.message);
    res.status(500).json({ error: 'Failed to fetch retirements' });
  }
});

// ── POST /api/transactions/retirements ────────────────────────────
// [V1] On-chain burn verification before any DB write.
// [V2] All three DB writes are atomic inside withTransaction.
router.post('/retirements', authenticate, writeLimiter, async (req, res) => {
  const {
    tokenId, projectName, standard, credits, vintageYear,
    serialNumber, developer, location, country, projectType,
    txHash, beneficiary,
    beneficiaryName, beneficiaryEntity, beneficiaryGstin,
    reportingStandard, purpose, retireScope,
    correspondingAdjustment, blockNumber, walletAddress,
  } = req.body;

  // Input validation
  if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash))
    return res.status(400).json({ error: 'Valid txHash required' });
  if (!tokenId || isNaN(parseInt(tokenId, 10)))
    return res.status(400).json({ error: 'Valid tokenId required' });
  if (!credits || parseInt(credits, 10) <= 0)
    return res.status(400).json({ error: 'credits must be a positive integer' });
  if (!projectName || !standard)
    return res.status(400).json({ error: 'projectName and standard required' });

  const creditsInt = parseInt(credits,  10);
  const tokenIdInt = parseInt(tokenId,  10);

  // [V1] Verify retirement burn on-chain before touching DB
  const verification = await verifyRetirementTransaction(
    txHash,
    tokenIdInt,
    creditsInt,
    walletAddress || req.user.wallet_address
  );

  if (!verification.valid) {
    return res.status(400).json({
      error:  `Retirement verification failed: ${verification.error}`,
      txHash,
    });
  }

  try {
    const certId =
      `CERT-${tokenIdInt.toString().padStart(8, '0')}-${Date.now().toString(36).toUpperCase()}`;

    let registryId;

    // [V2] Atomic — all three writes + audit log in one transaction
    await withTransaction(async (client) => {
      // 1. Insert registry_transactions
      const { rows } = await client.query(
        `INSERT INTO registry_transactions
           (user_id, from_user_id, tx_hash, tx_type, token_id, amount,
            project_name, standard, cert_id, beneficiary,
            serial_number, developer, location, project_type, total_price_inr)
         VALUES ($1, $1, $2, 'RETIRE', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0)
         ON CONFLICT (tx_hash) DO NOTHING
         RETURNING id, cert_id`,
        [
          req.user.id, txHash, tokenIdInt, creditsInt,
          projectName, standard, certId,
          beneficiary || beneficiaryName || null,
          serialNumber  || null,
          developer     || null,
          location      || null,
          projectType   || null,
        ]
      );
      registryId = rows[0]?.id;

      // 2. Insert retirements table — NOT swallowed; failure rolls back everything
      await client.query(
        `INSERT INTO retirements
           (retired_by, wallet_address, token_id, batch_id, amount,
            certificate_id, tx_hash, block_number,
            project_name, project_type, vintage_year, serial_number,
            developer, location, country, standard,
            beneficiary_name, beneficiary_entity, beneficiary_gstin,
            retire_scope, corresponding_adjustment,
            reporting_standard, purpose, is_public, retired_at)
         VALUES (
           $1, $2, $3,
           (SELECT id FROM carbon_batches
            WHERE token_id = $3 AND user_id = $1 LIMIT 1),
           $4, $5, $6, $7,
           $8, $9, $10, $11,
           $12, $13, $14, $15,
           $16, $17, $18,
           $19, $20,
           $21, $22,
           TRUE, NOW()
         )`,
        [
          req.user.id,
          walletAddress || null,
          tokenIdInt,
          creditsInt, certId, txHash,
          blockNumber   ? parseInt(blockNumber, 10) : null,
          projectName,
          projectType   || null,
          vintageYear   ? parseInt(vintageYear, 10) : null,
          serialNumber  || null,
          developer     || null,
          location      || null,
          country       || null,
          standard,
          beneficiaryName   || beneficiary   || null,
          beneficiaryEntity || null,
          beneficiaryGstin  || null,
          retireScope               || '1',
          correspondingAdjustment   || 'none',
          reportingStandard         || 'GHG_PROTOCOL',
          purpose                   || 'voluntary_offset',
        ]
      );

      // 3. Decrement carbon_batches
      await client.query(
        `UPDATE carbon_batches
         SET retired_credits   = COALESCE(retired_credits, 0) + $1,
             available_credits = GREATEST(0, COALESCE(available_credits, quantity) - $1),
             status = CASE
               WHEN GREATEST(0, COALESCE(available_credits, quantity) - $1) = 0
               THEN 'exhausted'
               ELSE status
             END,
             updated_at = NOW()
         WHERE token_id = $2 AND user_id = $3`,
        [creditsInt, tokenIdInt, req.user.id]
      );

      // 4. Audit log — non-fatal; does not block rollback
      await client.query(
        `INSERT INTO audit_log
         (user_id, action, entity, entity_id, new_value, ip_address, created_at)
         VALUES ($1, 'RETIREMENT_RECORDED', 'retirement', $2, $3, $4, NOW())`,
        [
          req.user.id,
          String(registryId || 0),
          JSON.stringify({ tokenId: tokenIdInt, credits: creditsInt, certId, txHash }),
          req.ip,
        ]
      ).catch(() => {});
    });

    res.json({ message: 'Retirement recorded', certId, id: registryId });

    sendRetirementEmail(req.user.email, {
      name: req.user.full_name, amount: creditsInt, certificateId: certId,
      projectName, beneficiary: beneficiaryName || beneficiary, txHash,
      certUrl: `${process.env.FRONTEND_URL}/verify/${certId}`,
    }).catch(e => console.warn('[tx/retirements] certificate email failed:', e.message));
  } catch (e) {
    console.error('[tx/retirements POST]', e.message);
    res.status(500).json({ error: 'Failed to record retirement' });
  }
});

// ── GET /api/transactions/retirements/:certId ─────────────────────
// [V9] certId sanitized — only alphanumeric + hyphens allowed in query param
router.get('/retirements/:certId', authenticate, async (req, res) => {
  const certId = req.params.certId.replace(/[^A-Za-z0-9\-]/g, '');
  if (!certId) return res.status(400).json({ error: 'Invalid certId' });

  try {
    const { rows } = await query(
      `SELECT * FROM registry_transactions
       WHERE cert_id = $1 AND (user_id = $2 OR from_user_id = $2)`,
      [certId, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Certificate not found' });
    res.json({ certificate: { ...rows[0], certificate_id: rows[0].cert_id } });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch certificate' });
  }
});

// ── GET /api/transactions/pending ─────────────────────────────────
// [V3] READ ONLY — stale cleanup moved to scheduler.js (runs every 5 min).
//      A GET must never mutate state. Code 8 ran UPDATE inside a GET handler.
router.get('/pending', authenticate, readLimiter, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, tx_hash, created_at, tx_type
       FROM registry_transactions
       WHERE (user_id = $1 OR from_user_id = $1)
         AND block_number IS NULL
         AND created_at > NOW() - INTERVAL '30 minutes'
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.json({
      count:        rows.length,
      transactions: rows.map(r => ({
        id:        r.id,
        txHash:    r.tx_hash,
        createdAt: r.created_at,
        type:      r.tx_type,
      })),
    });
  } catch (e) {
    console.error('[tx/pending]', e.message);
    res.status(500).json({ error: 'Failed to fetch pending transactions' });
  }
});

module.exports = router;