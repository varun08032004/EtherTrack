// routes/kyc.js — EtherTrack KYC v2 · PRODUCTION-HARDENED - 28/05/2026

'use strict';

const router                   = require('express').Router();
const { ethers }               = require('ethers');
const { safeQuery: query, pool } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { enqueueEmail }         = require('../services/email');
const { getRedis }             = require('../services/redis');
const logger                   = require('../services/logger');   // pino instance
const Sentry                   = require('@sentry/node');
const { verifyKYCOnChain, linkWalletOnChain } = require('../services/minter');

// ── Constants ────────────────────────────────────────────────────────────────
const CID_REGEX   = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/;
const UUID_REGEX  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_REGEX  = /^0x[0-9a-f]{64}$/i;
const PHONE_REGEX = /^\+[1-9]\d{6,14}$/;  // E.164 — any country
const VALID_ID_TYPES = new Set(['aadhaar','pan','passport','driving','voter']);
const VALID_KYC_TYPES = new Set(['individual','business']);
const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}\d[Z]{1}[A-Z\d]{1}$/;
const BUSINESS_PAN_REGEX = /^[A-Z]{5}\d{4}[A-Z]{1}$/;
const CIN_REGEX = /^[LUu]\d{5}[A-Za-z]{2}\d{4}[A-Za-z]{3}\d{6}$/;

// KYC tier progression
const TIER_RANK = { none: 0, phone: 1, basic: 2, full: 3 };

// Redis cache TTL
const STATUS_CACHE_TTL = 30; // seconds

// SSE clients map: userId → Set<res>
const sseClients = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** HTML-escape user-controlled strings before email template injection */
const escHtml = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Validate UUID format before DB query */
const isValidUUID = (s) => UUID_REGEX.test(s);

/** Invalidate Redis KYC status cache for a user */
const invalidateStatusCache = async (userId) => {
  try {
    const redis = getRedis();
    await redis.del(`kyc:status:${userId}`);
  } catch { /* non-fatal */ }
};

/** Push SSE event to all open connections for a user */
const pushSseEvent = (userId, event) => {
  const connections = sseClients.get(userId);
  if (!connections || connections.size === 0) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of connections) {
    try { res.write(payload); } catch { connections.delete(res); }
  }
};

/** Recompute kycDataHash from canonical inputs — server is authoritative */
const computeKycDataHash = (idType, normalizedId, phone, fullName) =>
  ethers.keccak256(
    ethers.toUtf8Bytes(`${idType}:${normalizedId}:${phone}:${fullName}`)
  );

/** Normalize ID number server-side */
const normalizeId = (idType, idNumber) => {
  if (idType === 'pan')     return String(idNumber).toUpperCase().trim();
  if (idType === 'aadhaar') return String(idNumber).replace(/\s/g, '').trim();
  return String(idNumber).trim();
};

/** Normalize + hash GSTIN server-side (same pattern as aadhaar/pan hashing) */
const normalizeGstin = (gstin) => String(gstin).toUpperCase().trim();
const computeGstinHash = (gstin) =>
  ethers.keccak256(ethers.toUtf8Bytes(`gstin:${normalizeGstin(gstin)}`));

/** Insert a kyc_events row (fire-and-forget inside a transaction) */
const logKycEvent = (client, { submissionId, actorId, action, fromStatus, toStatus, meta, ip, ua }) =>
  client.query(
    `INSERT INTO kyc_events
       (submission_id, actor_id, action, from_status, to_status, meta, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [submissionId, actorId || null, action, fromStatus || null, toStatus || null,
     JSON.stringify(meta || {}), ip || null, ua || null]
  );

// ── Middleware: attach request logger with correlation ID ─────────────────────
router.use((req, _res, next) => {
  req.log = logger.child({
    requestId: req.headers['x-request-id'] || crypto.randomUUID(),
    userId:    req.user?.id,
    path:      req.path,
    method:    req.method,
  });
  next();
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/kyc/submit
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/submit', authenticate, async (req, res) => {
  const t0 = Date.now();

  const {
    fullName, idType, phone, idNumber,
    aadhaarHash, panHash, docIpfsHash,
    kycType = 'individual',
    entityName, gstin, businessPan, cin,
    signatoryDesignation, businessDocIpfsHash,
  } = req.body;

  const idempotencyKey = req.headers['idempotency-key'];

  // ── Input validation ──────────────────────────────────────────────────────
  const errs = [];
  if (!VALID_KYC_TYPES.has(kycType))
    errs.push(`kycType must be one of: ${[...VALID_KYC_TYPES].join(', ')}`);

  // fullName/idType/idNumber/docIpfsHash represent the *signatory* on a
  // business submission, and the individual applicant otherwise — same
  // fields, same validation either way.
  if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 1 || fullName.length > 200)
    errs.push('fullName must be 1–200 characters');
  if (!idType || !VALID_ID_TYPES.has(idType))
    errs.push(`idType must be one of: ${[...VALID_ID_TYPES].join(', ')}`);
  if (!idNumber || typeof idNumber !== 'string' || idNumber.trim().length < 4 || idNumber.length > 30)
    errs.push('idNumber must be 4–30 characters');
  if (phone && !PHONE_REGEX.test(phone))
    errs.push('phone must be E.164 format (+[country][number])');
  if (!docIpfsHash || !CID_REGEX.test(docIpfsHash))
    errs.push('docIpfsHash must be a valid IPFS CIDv0 or CIDv1');
  if (aadhaarHash && !HASH_REGEX.test(aadhaarHash))
    errs.push('aadhaarHash must be a 0x-prefixed keccak256 hex string');
  if (panHash && !HASH_REGEX.test(panHash))
    errs.push('panHash must be a 0x-prefixed keccak256 hex string');

  // ── Business-only fields ────────────────────────────────────────────────
  if (kycType === 'business') {
    if (!entityName || typeof entityName !== 'string' || entityName.trim().length < 1 || entityName.length > 255)
      errs.push('entityName must be 1–255 characters');
    if (!gstin || !GSTIN_REGEX.test(normalizeGstin(gstin || '')))
      errs.push('gstin must be a valid 15-character GSTIN');
    if (!businessPan || !BUSINESS_PAN_REGEX.test(String(businessPan).toUpperCase().trim()))
      errs.push('businessPan must be a valid 10-character company PAN');
    if (cin && !CIN_REGEX.test(String(cin).toUpperCase().trim()))
      errs.push('cin must be a valid 21-character CIN/LLPIN (omit if proprietorship/partnership)');
    if (!signatoryDesignation || typeof signatoryDesignation !== 'string' || signatoryDesignation.trim().length < 1)
      errs.push('signatoryDesignation is required for business KYC (e.g. Director, Partner)');
    if (!businessDocIpfsHash || !CID_REGEX.test(businessDocIpfsHash))
      errs.push('businessDocIpfsHash must be a valid IPFS CIDv0/CIDv1 (GST certificate / incorporation doc)');

    // Cross-check: GSTIN characters 3–12 are the PAN it was issued against.
    // Catches typos/mismatched entries before they ever reach an admin.
    if (gstin && businessPan && GSTIN_REGEX.test(normalizeGstin(gstin)) && BUSINESS_PAN_REGEX.test(String(businessPan).toUpperCase().trim())) {
      const panInGstin = normalizeGstin(gstin).slice(2, 12);
      if (panInGstin !== String(businessPan).toUpperCase().trim())
        errs.push('businessPan does not match the PAN embedded in the GSTIN — check both fields');
    }
  }

  if (errs.length) {
    return res.status(400).json({ error: 'Validation failed', details: errs });
  }

  // ── Idempotency check ─────────────────────────────────────────────────────
  if (idempotencyKey) {
    if (idempotencyKey.length > 128) {
      return res.status(400).json({ error: 'Idempotency-Key too long (max 128 chars)' });
    }
    try {
      const { rows: cached } = await query(
        'SELECT response FROM kyc_idempotency_keys WHERE key=$1 AND user_id=$2 AND expires_at > NOW()',
        [idempotencyKey, req.user.id]
      );
      if (cached.length) {
        req.log.info({ idempotencyKey }, 'kyc.submit.idempotent_replay');
        return res.json(cached[0].response);
      }
    } catch (e) {
      req.log.warn({ err: { msg: e.message } }, 'kyc.submit.idempotency_check_failed');
    }
  }

  // ── Server-side hash recomputation ────────────────────────────────────────
  const normalized  = normalizeId(idType, idNumber);
  const serverHash  = computeKycDataHash(idType, normalized, phone || '', fullName.trim());
  const serverIdHash = ethers.keccak256(ethers.toUtf8Bytes(`${idType}:${normalized}`));

  // Compute canonical hashes server-side — client values used only for aadhaar/pan type routing
  const canonicalAadhaarHash = idType === 'aadhaar' ? serverIdHash : null;
  const canonicalPanHash     = idType === 'pan'     ? serverIdHash : null;

  // Business fields — server is authoritative for gstin_hash too
  const normalizedGstin       = kycType === 'business' ? normalizeGstin(gstin) : null;
  const canonicalGstinHash    = kycType === 'business' ? computeGstinHash(gstin) : null;
  const normalizedBusinessPan = kycType === 'business' ? String(businessPan).toUpperCase().trim() : null;
  const normalizedCin         = kycType === 'business' && cin ? String(cin).toUpperCase().trim() : null;

  // ── Transaction with advisory lock ───────────────────────────────────────
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

    // Advisory lock keyed on user_id — prevents concurrent submissions
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [req.user.id]);

    // Rate limit: 1 submission per hour
    const { rows: recentSub } = await client.query(
      `SELECT id FROM kyc_submissions
       WHERE user_id=$1 AND submitted_at > NOW() - INTERVAL '1 hour'
         AND deleted_at IS NULL
       ORDER BY submitted_at DESC LIMIT 1`,
      [req.user.id]
    );
    if (recentSub.length) {
      await client.query('ROLLBACK');
      return res.status(429).json({
        error: 'Rate limited',
        message: 'Please wait at least 1 hour between KYC submissions.',
        code: 'RATE_LIMITED',
      });
    }

    // Check for already approved/pending submission
    const { rows: existing } = await client.query(
      `SELECT id, status FROM kyc_submissions
       WHERE user_id=$1 AND status IN ('pending','approved') AND deleted_at IS NULL
       ORDER BY submitted_at DESC LIMIT 1`,
      [req.user.id]
    );
    if (existing.length) {
      await client.query('ROLLBACK');
      const st = existing[0].status;
      return res.status(400).json({
        error: st === 'approved' ? 'KYC already approved' : 'KYC already submitted and under review',
        code:  st === 'approved' ? 'ALREADY_APPROVED' : 'ALREADY_SUBMITTED',
      });
    }

    // Mark previous rejected submission as superseded
    await client.query(
      `UPDATE kyc_submissions SET status='superseded', updated_at=NOW()
       WHERE user_id=$1 AND status='rejected' AND deleted_at IS NULL`,
      [req.user.id]
    );

    // Insert new submission
    const { rows: [sub] } = await client.query(
  `INSERT INTO kyc_submissions
     (user_id, full_name, id_type, phone, kyc_data_hash,
      aadhaar_hash, pan_hash, doc_ipfs_hash, status, kyc_tier,
      idempotency_key, consent_given, consent_at,
      kyc_type, entity_name, gstin, gstin_hash, business_pan, cin,
      signatory_designation, business_doc_ipfs_hash)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending','phone',$9,$10,$11,
           $12,$13,$14,$15,$16,$17,$18,$19)
   RETURNING id, submitted_at`,
  [req.user.id, fullName.trim(), idType, phone || null, serverHash,
   canonicalAadhaarHash, canonicalPanHash, docIpfsHash,
   idempotencyKey || null,
   req.body.consentGiven === true,
   req.body.consentAt ? new Date(req.body.consentAt) : new Date(),
   kycType, entityName ? entityName.trim() : null, normalizedGstin, canonicalGstinHash,
   normalizedBusinessPan, normalizedCin, signatoryDesignation ? signatoryDesignation.trim() : null,
   businessDocIpfsHash || null,
  ]
);
    

    // Update user record atomically
    await client.query(
      `UPDATE users SET
         kyc_status='submitted', full_name=$1,
         kyc_submission_id=$2, kyc_submitted_at=NOW(), updated_at=NOW(),
         kyc_type=$4
       WHERE id=$3`,
      [fullName.trim(), sub.id, req.user.id, kycType]
    );

    // Audit log
    await logKycEvent(client, {
      submissionId: sub.id,
      actorId:      req.user.id,
      action:       'submitted',
      fromStatus:   null,
      toStatus:     'pending',
      meta:         { idType, hasPhone: !!phone, kycType, entityName: entityName || null },
      ip:           req.ip,
      ua:           req.headers['user-agent'],
    });

    await client.query('COMMIT');

    // ── Post-commit side effects ─────────────────────────────────────────
    await invalidateStatusCache(req.user.id);

    const responseBody = {
      message:      'KYC submitted successfully',
      status:       'submitted',
      submissionId: sub.id,
      submittedAt:  sub.submitted_at,
    };

    // Store idempotency response
    if (idempotencyKey) {
      query(
        `INSERT INTO kyc_idempotency_keys (key, user_id, response)
         VALUES ($1,$2,$3) ON CONFLICT (key) DO NOTHING`,
        [idempotencyKey, req.user.id, JSON.stringify(responseBody)]
      ).catch(() => {});
    }

    // Async email (non-blocking)
    enqueueEmail({
      to:      req.user.email,
      subject: 'EtherTrack — KYC Submission Received',
      template: 'kyc-submitted',
      data: { fullName: escHtml(fullName.trim()), submissionId: sub.id },
    }).catch(e => req.log.warn({ err: { msg: e.message } }, 'kyc.email.submit_enqueue_failed'));

    if (process.env.ADMIN_EMAIL) {
      enqueueEmail({
        to:       process.env.ADMIN_EMAIL,
        subject:  kycType === 'business'
          ? `[EtherTrack Admin] New Business KYC — ${escHtml(entityName ? entityName.trim() : fullName.trim())}`
          : `[EtherTrack Admin] New KYC — ${escHtml(fullName.trim())}`,
        template: 'kyc-admin-new',
        data: {
          userEmail:    escHtml(req.user.email),
          fullName:     escHtml(fullName.trim()),
          idType:       escHtml(idType.toUpperCase()),
          kycType,
          entityName:   entityName ? escHtml(entityName.trim()) : null,
          gstin:        kycType === 'business' ? escHtml(normalizedGstin) : null,
          submissionId: sub.id,
          submittedAt:  new Date().toISOString(),
          adminUrl:     `${process.env.FRONTEND_URL}/admin/kyc`,
        },
      }).catch(() => {});
    }

    req.log.info(
      { submissionId: sub.id, idType, durationMs: Date.now() - t0 },
      'kyc.submit.success'
    );

    return res.status(201).json(responseBody);

  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') {
      // Unique constraint on aadhaar/pan hash, or gstin_hash for business KYC
      const isGstinConflict = String(e.constraint || '').includes('gstin');
      return res.status(409).json({
        error:   'duplicate_kyc',
        message: isGstinConflict
          ? 'This GSTIN is already verified with another account.'
          : 'These KYC credentials are already verified with another account.',
        code:    isGstinConflict ? 'DUPLICATE_GSTIN' : 'DUPLICATE_CREDENTIALS',
      });
    }
    req.log.error({ err: { code: e.code, msg: e.message }, durationMs: Date.now() - t0 }, 'kyc.submit.error');
    Sentry.captureException(e, { tags: { endpoint: 'kyc.submit' } });
    return res.status(500).json({ error: 'KYC submission failed', code: 'INTERNAL_ERROR' });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/kyc/status — with Redis cache
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/status', authenticate, async (req, res) => {
  const cacheKey = `kyc:status:${req.user.id}`;

  try {
    // Try Redis cache first
    try {
      const redis = getRedis();
      const cached = await redis.get(cacheKey);
      if (cached) {
        return res.json({ ...JSON.parse(cached), cached: true });
      }
    } catch { /* cache miss — fall through */ }

    const { rows } = await query(
      `SELECT
         s.id, s.status, s.kyc_tier, s.submitted_at, s.reviewed_at,
         s.rejection_reason, s.kyc_type, s.entity_name,
         u.kyc_status, u.kyc_verified, u.kyc_tier as user_tier, u.kyc_type as user_kyc_type
       FROM kyc_submissions s
       JOIN users u ON u.id = s.user_id
       WHERE s.user_id = $1 AND s.deleted_at IS NULL
       ORDER BY s.submitted_at DESC LIMIT 1`,
      [req.user.id]
    );

    const payload = {
      kycStatus:   rows[0]?.kyc_status  ?? req.user.kyc_status ?? 'none',
      kycVerified: rows[0]?.kyc_verified ?? false,
      kycTier:     rows[0]?.user_tier   ?? 'none',
      kycType:     rows[0]?.user_kyc_type ?? 'individual',
      submission:  rows[0] ? {
        id:              rows[0].id,
        status:          rows[0].status,
        tier:            rows[0].kyc_tier,
        kycType:         rows[0].kyc_type,
        entityName:      rows[0].entity_name,
        submittedAt:     rows[0].submitted_at,
        reviewedAt:      rows[0].reviewed_at,
        rejectionReason: rows[0].rejection_reason,
      } : null,
    };

    // Cache result
    try {
      const redis = getRedis();
      await redis.setex(cacheKey, STATUS_CACHE_TTL, JSON.stringify(payload));
    } catch { /* non-fatal */ }

    return res.json(payload);

  } catch (e) {
    req.log.error({ err: { msg: e.message } }, 'kyc.status.error');
    return res.status(500).json({ error: 'Failed to fetch KYC status' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/kyc/stream — SSE push channel (replaces polling)
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/stream', authenticate, (req, res) => {
  const userId = req.user.id;

  res.set({
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no',  // disable nginx buffering
  });
  res.flushHeaders();

  // Register client
  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(res);

  // Send initial heartbeat
  res.write(': connected\n\n');

  // Heartbeat every 25s (keep-alive under nginx 60s timeout)
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); }
    catch { clearInterval(heartbeat); }
  }, 25_000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    const set = sseClients.get(userId);
    if (set) { set.delete(res); if (set.size === 0) sseClients.delete(userId); }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/kyc/pending — admin only, paginated, explicit columns
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/pending', authenticate, requireRole('admin'), async (req, res) => {
  const page = Math.max(0, parseInt(req.query.page) || 0);
  const size = Math.min(100, Math.max(1, parseInt(req.query.size) || 50));
  const offset = page * size;

  try {
    const { rows } = await query(
      `SELECT
         s.id, s.full_name, s.id_type, s.phone, s.status, s.kyc_tier,
         s.submitted_at, s.doc_ipfs_hash,
         s.kyc_type, s.entity_name, s.gstin, s.business_pan, s.cin,
         s.signatory_designation, s.business_doc_ipfs_hash,
         u.email, u.wallet_address,
         (SELECT COUNT(*) FROM kyc_submissions WHERE user_id=s.user_id) as prior_submissions
       FROM kyc_submissions s
       JOIN users u ON u.id = s.user_id
       WHERE s.status = 'pending' AND s.deleted_at IS NULL
       ORDER BY s.submitted_at ASC
       LIMIT $1 OFFSET $2`,
      [size, offset]
    );

    const { rows: [{ total }] } = await query(
      `SELECT COUNT(*) as total FROM kyc_submissions WHERE status='pending' AND deleted_at IS NULL`
    );

    req.log.info({ page, size, total }, 'kyc.admin.pending.fetched');

    return res.json({
      submissions: rows,
      pagination: { page, size, total: parseInt(total), pages: Math.ceil(total / size) },
    });

  } catch (e) {
    req.log.error({ err: { msg: e.message } }, 'kyc.pending.error');
    return res.status(500).json({ error: 'Failed to fetch pending KYC' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/kyc/:id — admin detail view (explicit columns, no hash exposure in list)
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  if (!isValidUUID(id)) return res.status(400).json({ error: 'Invalid submission ID' });

  try {
    const { rows } = await query(
      `SELECT
         s.id, s.full_name, s.id_type, s.phone, s.status, s.kyc_tier,
         s.kyc_data_hash, s.aadhaar_hash, s.pan_hash, s.doc_ipfs_hash,
         s.kyc_type, s.entity_name, s.gstin, s.gstin_hash, s.business_pan,
         s.cin, s.signatory_designation, s.business_doc_ipfs_hash,
         s.submitted_at, s.reviewed_at, s.rejection_reason, s.reviewed_by,
         u.email, u.wallet_address, u.kyc_status
       FROM kyc_submissions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.deleted_at IS NULL`,
      [id]
    );

    if (!rows.length) return res.status(404).json({ error: 'Submission not found' });

    // Fetch audit trail
    const { rows: events } = await query(
      `SELECT action, from_status, to_status, meta, created_at,
              (SELECT email FROM users WHERE id=actor_id) as actor_email
       FROM kyc_events WHERE submission_id=$1 ORDER BY created_at ASC`,
      [id]
    );

    return res.json({ submission: rows[0], events });

  } catch (e) {
    req.log.error({ err: { msg: e.message }, submissionId: id }, 'kyc.detail.error');
    return res.status(500).json({ error: 'Failed to fetch submission' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/kyc/:id/approve — fully transactional CTE, SSE push, cache invalidation
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/:id/approve', authenticate, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  if (!isValidUUID(id)) return res.status(400).json({ error: 'Invalid submission ID' });

  const { tier = 'full' } = req.body;
  if (!['phone','basic','full'].includes(tier)) {
    return res.status(400).json({ error: 'tier must be phone | basic | full' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // CTE: update submission + user in one round-trip, return everything needed
    const { rows } = await client.query(
      `WITH sub_upd AS (
         UPDATE kyc_submissions
         SET status='approved', reviewed_at=NOW(), reviewed_by=$1, kyc_tier=$2, updated_at=NOW()
         WHERE id=$3 AND status='pending' AND deleted_at IS NULL
         RETURNING id, user_id, aadhaar_hash, pan_hash, kyc_data_hash, full_name, id_type
       ), usr_upd AS (
         UPDATE users SET
           kyc_status='verified', kyc_verified=TRUE, kyc_verified_at=NOW(),
           kyc_tier=$2,
           kyc_aadhaar_hash=COALESCE(sub_upd.aadhaar_hash, kyc_aadhaar_hash),
           kyc_pan_hash=COALESCE(sub_upd.pan_hash, kyc_pan_hash),
           kyc_data_hash=sub_upd.kyc_data_hash,
           updated_at=NOW()
         FROM sub_upd WHERE users.id=sub_upd.user_id
         RETURNING users.id, users.email, users.full_name, users.wallet_address
       )
       SELECT sub_upd.id as submission_id, sub_upd.user_id,
              usr_upd.email, usr_upd.full_name, usr_upd.wallet_address, sub_upd.kyc_data_hash
       FROM sub_upd JOIN usr_upd ON TRUE`,
      [req.user.id, tier, id]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Submission not found or already reviewed' });
    }

    const { submission_id, user_id, email, full_name, wallet_address, kyc_data_hash } = rows[0];

    await logKycEvent(client, {
      submissionId: submission_id,
      actorId:      req.user.id,
      action:       'approved',
      fromStatus:   'pending',
      toStatus:     'approved',
      meta:         { tier, approvedBy: req.user.email },
      ip:           req.ip,
      ua:           req.headers['user-agent'],
    });

    await client.query('COMMIT');

    // ── Post-commit ──────────────────────────────────────────────────────
    await invalidateStatusCache(user_id);

    // SSE push — instant unlock without page refresh
    pushSseEvent(user_id, {
      type:   'kyc.approved',
      status: 'verified',
      tier,
      ts:     new Date().toISOString(),
    });

    // Identity-keyed on-chain registration — fires regardless of whether
    // this user has a wallet bound. See KYCRegistry.sol for why.
    setImmediate(async () => {
      try {
        const r = await verifyKYCOnChain(user_id, kyc_data_hash);
        if (!r.skipped) {
          await logKycEvent(pool, {
            submissionId: submission_id, actorId: req.user.id, action: 'onchain_registered',
            fromStatus: 'approved', toStatus: 'approved', meta: { txHash: r.txHash },
          }).catch(() => {});
        }
        if (wallet_address) {
          const l = await linkWalletOnChain(user_id, wallet_address);
          if (!l.skipped) {
            await logKycEvent(pool, {
              submissionId: submission_id, actorId: req.user.id, action: 'onchain_wallet_linked',
              fromStatus: 'approved', toStatus: 'approved', meta: { txHash: l.txHash, wallet: wallet_address },
            }).catch(() => {});
          }
        }
      } catch (e) {
        req.log.warn({ err: e.message, userId: user_id }, 'kyc.onchain.failed');
      }
    });

    enqueueEmail({
      to:       email,
      subject:  'EtherTrack — KYC Approved 🎉',
      template: 'kyc-approved',
      data:     { fullName: escHtml(full_name || ''), tier, dashboardUrl: `${process.env.FRONTEND_URL}/dashboard` },
    }).catch(() => {});

    req.log.info({ submissionId: submission_id, userId: user_id, tier }, 'kyc.approve.success');

    return res.json({ message: 'KYC approved', submissionId: submission_id, userId: user_id, tier });

  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    req.log.error({ err: { msg: e.message }, submissionId: id }, 'kyc.approve.error');
    Sentry.captureException(e, { tags: { endpoint: 'kyc.approve' } });
    return res.status(500).json({ error: 'Approval failed' });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/kyc/:id/reject — transactional, sanitised reason, SSE push
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/:id/reject', authenticate, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  if (!isValidUUID(id)) return res.status(400).json({ error: 'Invalid submission ID' });

  const { reason } = req.body;
  if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
    return res.status(400).json({ error: 'Rejection reason required (min 5 chars)' });
  }
  if (reason.length > 2000) {
    return res.status(400).json({ error: 'Rejection reason too long (max 2000 chars)' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `WITH sub_upd AS (
         UPDATE kyc_submissions
         SET status='rejected', rejection_reason=$1,
             reviewed_at=NOW(), reviewed_by=$2, updated_at=NOW()
         WHERE id=$3 AND status='pending' AND deleted_at IS NULL
         RETURNING id, user_id
       ), usr_upd AS (
         UPDATE users SET kyc_status='rejected', updated_at=NOW()
         FROM sub_upd WHERE users.id=sub_upd.user_id
         RETURNING users.id, users.email, users.full_name
       )
       SELECT sub_upd.id as submission_id, sub_upd.user_id,
              usr_upd.email, usr_upd.full_name
       FROM sub_upd JOIN usr_upd ON TRUE`,
      [reason.trim(), req.user.id, id]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Submission not found or already reviewed' });
    }

    const { submission_id, user_id, email, full_name } = rows[0];

    await logKycEvent(client, {
      submissionId: submission_id,
      actorId:      req.user.id,
      action:       'rejected',
      fromStatus:   'pending',
      toStatus:     'rejected',
      meta:         { rejectedBy: req.user.email },
      ip:           req.ip,
      ua:           req.headers['user-agent'],
    });

    await client.query('COMMIT');

    await invalidateStatusCache(user_id);

    // SSE push — user sees rejection immediately
    pushSseEvent(user_id, {
      type:   'kyc.rejected',
      status: 'rejected',
      ts:     new Date().toISOString(),
    });

    enqueueEmail({
      to:       email,
      subject:  'EtherTrack — KYC Requires Resubmission',
      template: 'kyc-rejected',
      data: {
        fullName:   escHtml(full_name || ''),
        reason:     escHtml(reason.trim()),
        resubmitUrl: `${process.env.FRONTEND_URL}/kyc`,
      },
    }).catch(() => {});

    req.log.info({ submissionId: submission_id, userId: user_id }, 'kyc.reject.success');

    return res.json({ message: 'KYC rejected', submissionId: submission_id, userId: user_id });

  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    req.log.error({ err: { msg: e.message }, submissionId: id }, 'kyc.reject.error');
    Sentry.captureException(e, { tags: { endpoint: 'kyc.reject' } });
    return res.status(500).json({ error: 'Rejection failed' });
  } finally {
    client.release();
  }
});

module.exports = router;
module.exports.pushSseEvent = pushSseEvent; // exported for test mocking