// routes/portfolio.js — EtherTrack Corporate Edition
// PRODUCTION HARDENED — all critical/high/medium issues resolved
//
// [FIX-LISTED-QTY] confirm-listing now accepts & stores `quantity` into the
// new carbon_batches.listed_quantity column; confirm-delisting zeroes it;
// mapCreditRow reads it directly instead of deriving listed = total - held
// (which mathematically equals "credits sold", not "credits still listed",
// and could never produce the correct partial-delist remainder).
'use strict';

const router      = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate, requireKYC } = require('../middleware/auth');
const { sendCreditSubmittedEmail, sendListingConfirmedEmail, sendDelistingConfirmedEmail } = require('../services/email');
const rateLimit   = require('express-rate-limit');
const Joi         = require('joi');

// ── Rate limiters ────────────────────────────────────────────────
const submitLimiter = rateLimit({
  windowMs : 60 * 60 * 1000, // 1 hour
  max      : 10,
  keyGenerator : req => String(req.user.id),
  handler  : (req, res) =>
    res.status(429).json({ error: 'Too many submissions. Try again in an hour.' }),
  standardHeaders: true,
  legacyHeaders  : false,
});

const exportLimiter = rateLimit({
  windowMs : 60 * 1000,
  max      : 20,
  keyGenerator : req => String(req.user.id),
  handler  : (req, res) =>
    res.status(429).json({ error: 'Export rate limit exceeded.' }),
});

// ── Constants & validation maps ──────────────────────────────────
const PROJECT_TYPE_MAP = {
  'Renewable Energy (BEE)'                : 'Renewable',
  'Green Hydrogen (BEE)'                  : 'Renewable',
  'Industrial Energy Efficiency (BEE)'    : 'Efficiency',
  'Landfill Methane Recovery (BEE)'       : 'Methane',
  'Mangrove Afforestation (BEE)'          : 'Forestry',
  'Renewable Energy with Storage (BEE)'   : 'Renewable',
  'Offshore Wind (BEE)'                   : 'Renewable',
  'Compressed Biogas (BEE)'              : 'Methane',
  'Renewable Energy'                      : 'Renewable',
  'Reforestation'                         : 'Forestry',
  'REDD+'                                 : 'Forestry',
  'Avoided Deforestation'                 : 'Forestry',
  'Blue Carbon'                           : 'Ocean',
  'Methane Capture'                       : 'Methane',
  'Energy Efficiency'                     : 'Efficiency',
  'Cookstoves'                            : 'Efficiency',
  'Soil Carbon'                           : 'Agriculture',
  'Industrial Gas'                        : 'Methane',
  'Forestry'                              : 'Forestry',
  'Renewable'                             : 'Renewable',
  'Methane'                               : 'Methane',
  'Efficiency'                            : 'Efficiency',
  'Ocean'                                 : 'Ocean',
  'Agriculture'                           : 'Agriculture',
};

const VALID_STANDARDS        = ['VCS', 'GS', 'CDM', 'ACR', 'BEE'];
const VALID_CREDIT_TYPES     = ['voluntary', 'compliance'];
const VALID_BANKING          = ['available', 'banked'];
const VALID_VERIF_STATUSES   = ['pending', 'in_progress', 'verified'];
const VALID_CA_OPTIONS       = ['none', 'host_issued', 'itmo', 'pending'];
const VALID_ADDITIONALITY    = ['not_specified', 'additionality_demonstrated', 'conservative_baseline'];
const VALID_PERMANENCE       = ['not_rated', 'low', 'medium', 'high', 'buffer_pool_protected'];
const VALID_SDG_IDS          = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17];

// ── CSV injection-safe escaper ────────────────────────────────────
const csvEscape = v => {
  const s = String(v == null ? '' : v);
  const stripped = s.replace(/^[=+\-@\t\r\n]/g, "'$&");
  if (/[",\n\r]/.test(stripped)) return `"${stripped.replace(/"/g, '""')}"`;
  return stripped;
};

// ── Input sanitiser ───────────────────────────────────────────────
const sanitiseString = (s, maxLen = 255) =>
  typeof s === 'string' ? s.trim().slice(0, maxLen) : '';

// ── Joi schema for submit-credit ──────────────────────────────────
const submitCreditSchema = Joi.object({
  projectName     : Joi.string().trim().min(2).max(255).required(),
  projectLocation : Joi.string().trim().max(255).required(),
  country         : Joi.string().trim().max(100).required(),
  standard        : Joi.string().valid(...VALID_STANDARDS).required(),
  projectId       : Joi.string().trim().max(100).required(),
  projectType     : Joi.string().valid(...Object.keys(PROJECT_TYPE_MAP)).required(),
  developer       : Joi.string().trim().max(255).required(),
  quantity        : Joi.number().integer().min(1).max(10_000_000).required(),
  vintageYear     : Joi.number().integer().min(1990).max(new Date().getFullYear()).required(),
  expiryDate      : Joi.string().isoDate().allow(null, '').optional(),
  registrySerial  : Joi.string().trim().max(200).required(),
  docIpfsHash     : Joi.string().trim().max(200).required(),
  creditType      : Joi.string().valid(...VALID_CREDIT_TYPES).default('voluntary'),
  cbamEligible    : Joi.boolean().default(false),
  acvaName        : Joi.string().trim().max(255).allow(null, '').optional(),
  acvaDate        : Joi.string().isoDate().allow(null, '').optional(),
  acvaStatus      : Joi.string().valid(...VALID_VERIF_STATUSES).default('pending'),
  icmRegistryId   : Joi.string().trim().max(100).allow(null, '').optional(),
  bankingStatus   : Joi.string().valid(...VALID_BANKING).default('available'),
  correspondingAdjustment : Joi.string().valid(...VALID_CA_OPTIONS).default('none'),
  sdgTags         : Joi.array().items(Joi.number().integer().valid(...VALID_SDG_IDS)).max(17).default([]),
  icvcmCcpEligible : Joi.boolean().default(false),
  icvcmCcpLabel   : Joi.string().trim().max(100).allow(null, '').optional(),
  icvcmCcpDate    : Joi.string().isoDate().allow(null, '').optional(),
  registryLink    : Joi.string().uri({ scheme: ['http', 'https'] }).max(500).allow(null, '').optional(),
  methodologyId   : Joi.string().trim().max(100).allow(null, '').optional(),
  additionalityType : Joi.string().valid(...VALID_ADDITIONALITY).default('not_specified'),
  permanenceRating  : Joi.string().valid(...VALID_PERMANENCE).default('not_rated'),
  coBenefitsVerified : Joi.boolean().default(false),
  orgId           : Joi.number().integer().allow(null).optional(),
}).options({ stripUnknown: true });

// ── Helper: plan credit limit check ──────────────────────────────
const PLAN_LIMITS = { free: 0, starter: Infinity, growth: Infinity, corporate: Infinity };

const checkPlanLimit = async (userId) => {
  const { rows } = await query(
    `SELECT COUNT(*) AS cnt
     FROM carbon_batches cb
     JOIN users u ON u.id = cb.user_id
     WHERE cb.user_id = $1
       AND cb.admin_status != 'rejected'`,
    [userId]
  );
  const { rows: userRows } = await query(
    `SELECT o.subscription_plan
     FROM users u
     LEFT JOIN org_members om ON om.user_id = u.id
     LEFT JOIN organisations o ON o.id = om.org_id
     WHERE u.id = $1 LIMIT 1`,
    [userId]
  );
  const plan  = userRows[0]?.subscription_plan || 'starter';
  const limit = PLAN_LIMITS[plan] ?? 5;
  return { count: parseInt(rows[0].cnt, 10), limit, plan };
};

// ─────────────────────────────────────────────────────────────────
// POST /api/portfolio/submit-credit
// ─────────────────────────────────────────────────────────────────
router.post(
  '/submit-credit',
  authenticate,
  requireKYC,
  submitLimiter,
  async (req, res) => {
    const { error: validationError, value: body } = submitCreditSchema.validate(req.body);
    if (validationError) {
      console.error('[submit-credit validation]', JSON.stringify(validationError.details));
      return res.status(400).json({
        error  : 'Validation failed',
        detail : validationError.details.map(d => d.message).join('; '),
      });
    }
    const {
      projectName, projectLocation, country, standard, projectId, projectType, developer,
      quantity, vintageYear, expiryDate, registrySerial, docIpfsHash,
      creditType, cbamEligible, acvaName, acvaDate, acvaStatus,
      icmRegistryId, bankingStatus, correspondingAdjustment, sdgTags,
      icvcmCcpEligible, icvcmCcpLabel, icvcmCcpDate,
      registryLink, methodologyId, additionalityType, permanenceRating,
      coBenefitsVerified, orgId,
    } = body;

    try {
      const { count, limit, plan } = await checkPlanLimit(req.user.id);
      if (count >= limit) {
        return res.status(403).json({
          error : `Credit limit reached for ${plan} plan (${limit} max). Please upgrade.`,
        });
      }

      const { rows: dup } = await query(
        `SELECT id, user_id FROM carbon_batches WHERE registry_serial = $1`,
        [registrySerial]
      );
      if (dup.length) {
        return res.status(409).json({
          error: 'Serial number already registered globally. Contact support if this is an error.',
        });
      }

      const mappedProjectType = PROJECT_TYPE_MAP[projectType];
      if (!mappedProjectType) {
        return res.status(400).json({ error: `Invalid project type: "${projectType}"` });
      }

      if (standard === 'GS' && sdgTags.length === 0) {
        return res.status(400).json({ error: 'Gold Standard credits require at least one SDG tag.' });
      }

      if (expiryDate) {
        const expiry = new Date(expiryDate);
        if (isNaN(expiry.getTime()) || expiry <= new Date()) {
          return res.status(400).json({ error: 'Expiry date must be a valid future date.' });
        }
      }

      if (vintageYear > new Date().getFullYear()) {
        return res.status(400).json({ error: 'Vintage year cannot be in the future.' });
      }

      const client = await (require('../db/pool').pool || require('../db/pool')).connect();
      try {
        await client.query('BEGIN');

        const { rows: projectRows } = await client.query(
          `SELECT id FROM projects WHERE project_code = $1 LIMIT 1`,
          [projectId]
        );

        let dbProjectId;
        if (projectRows.length > 0) {
          dbProjectId = projectRows[0].id;
        } else {
          const dbStandard = standard === 'BEE' ? 'VCS' : standard;
          const { rows: newProject } = await client.query(
            `INSERT INTO projects
               (developer_id, name, project_code, standard, project_type,
                location, country, developer_name, ipfs_document_hash, created_at)
             VALUES ($1,$2,$3,$4::credit_standard,$5::project_type,$6,$7,$8,$9,NOW())
             RETURNING id`,
            [req.user.id, projectName, projectId, dbStandard, mappedProjectType,
             projectLocation, country, developer, docIpfsHash]
          );
          dbProjectId = newProject[0].id;
        }

        const { rows } = await client.query(
          `INSERT INTO carbon_batches
             (user_id, project_id, project_name, project_location, country,
              standard, project_type, developer,
              quantity, total_credits, available_credits,
              vintage_year, expiry_date, registry_serial, doc_ipfs_hash,
              status, admin_status,
              credit_type, cbam_eligible, acva_name, acva_date, acva_status,
              icm_registry_id, banking_status, corresponding_adjustment, sdg_tags,
              icvcm_ccp_eligible, icvcm_ccp_label, icvcm_ccp_date,
              registry_link, methodology_id, additionality_type,
              permanence_rating, co_benefits_verified, submitted_from_org_id)
           VALUES
             ($1,$2,$3,$4,$5,
              $6,$7,$8,
              $9,$10,$11,
              $12,$13,$14,$15,
              'pending','pending',
              $16,$17,$18,$19,$20,
              $21,$22,$23,$24,
              $25,$26,$27,
              $28,$29,$30,
              $31,$32,$33)
           RETURNING id`,
          [
            req.user.id, dbProjectId, projectName, projectLocation, country,
            standard, mappedProjectType, developer,
            quantity, quantity, quantity,
            vintageYear, expiryDate || null, registrySerial, docIpfsHash,
            creditType, cbamEligible,
            acvaName || null, acvaDate || null, acvaStatus,
            icmRegistryId || null, bankingStatus, correspondingAdjustment,
            JSON.stringify(sdgTags),
            icvcmCcpEligible, icvcmCcpLabel || null, icvcmCcpDate || null,
            registryLink || null, methodologyId || null,
            additionalityType, permanenceRating, coBenefitsVerified,
            orgId || null,
          ]
        );

        await client.query('COMMIT');

        const submissionId = `SUB-${String(rows[0].id).padStart(6, '0')}`;
        sendCreditSubmittedEmail(req.user.email, {
          name: req.user.full_name, projectName, quantity, submissionId,
          portfolioUrl: `${process.env.FRONTEND_URL}/portfolio`,
        }).catch(e => console.warn('[submit-credit] confirmation email failed:', e.message));

        res.status(201).json({ message: 'Credit submitted successfully.', id: rows[0].id });
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
    } catch (e) {
      console.error('[submit-credit]', e.message);
      res.status(500).json({ error: 'Submission failed. Please try again.' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────
// POST /api/portfolio/confirm-listing
// Called by frontend after MetaMask confirms the list TX on-chain.
// Writes listing_id_onchain + price + listed_quantity back to
// carbon_batches so the market query (which filters on
// listing_id_onchain IS NOT NULL) can surface the credit with the
// CORRECT remaining amount, and so the delist modal shows the right
// number instead of the original/total quantity.
//
// [FIX-LISTED-QTY] `quantity` is now required in the request body — the
// frontend must send how many credits were listed (see CarbonCredits.jsx /
// PortfolioV3.jsx handleListForSale, which now includes `quantity: qty` in
// its confirm-listing call).
// ─────────────────────────────────────────────────────────────────
router.post('/confirm-listing', authenticate, async (req, res) => {
  const { batchId, listingIdOnchain, txHash, pricePerCreditInr, quantity } = req.body;

  if (!batchId) {
    return res.status(400).json({ error: 'batchId required' });
  }
  if (listingIdOnchain === undefined || listingIdOnchain === null) {
    return res.status(400).json({ error: 'listingIdOnchain required' });
  }
  if (quantity === undefined || quantity === null) {
    return res.status(400).json({ error: 'quantity required — how many credits were listed on-chain' });
  }

  const listingId = parseInt(listingIdOnchain, 10);
  if (isNaN(listingId) || listingId < 0) {
    return res.status(400).json({ error: 'Invalid listingIdOnchain — must be a non-negative integer' });
  }

  const listedQty = parseInt(quantity, 10);
  if (isNaN(listedQty) || listedQty <= 0) {
    return res.status(400).json({ error: 'Invalid quantity — must be a positive integer' });
  }

  try {
    // Ownership check — only the batch owner can confirm listing
    const { rows } = await query(
      `SELECT id, user_id, admin_status, token_id, available_credits, project_name FROM carbon_batches WHERE id = $1`,
      [batchId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Batch not found' });
    }
    if (rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden — you do not own this batch' });
    }
    if (rows[0].admin_status !== 'approved') {
      return res.status(400).json({ error: 'Batch is not approved' });
    }
    if (listedQty > rows[0].available_credits) {
      return res.status(400).json({
        error: `Cannot list ${listedQty} credits — only ${rows[0].available_credits} held`,
      });
    }

    // Write listing_id_onchain, price, and listed_quantity back to DB
    await query(
      `UPDATE carbon_batches
       SET listing_id_onchain   = $1,
           price_per_credit_inr = COALESCE($2, price_per_credit_inr),
           listed_quantity      = $3,
           updated_at           = NOW()
       WHERE id = $4 AND user_id = $5`,
      [listingId, pricePerCreditInr || null, listedQty, batchId, req.user.id]
    );

    console.log(`[confirm-listing] batch=${batchId} listingId=${listingId} qty=${listedQty} price=${pricePerCreditInr} tx=${txHash}`);

    sendListingConfirmedEmail(req.user.email, {
      name: req.user.full_name, projectName: rows[0].project_name, quantity: listedQty,
      pricePerCreditInr: pricePerCreditInr || null, marketUrl: `${process.env.FRONTEND_URL}/market`,
    }).catch(e => console.warn('[confirm-listing] email failed:', e.message));

    res.json({ success: true, listingIdOnchain: listingId, listedQuantity: listedQty });
  } catch (e) {
    console.error('[confirm-listing]', e.message);
    res.status(500).json({ error: 'Failed to confirm listing' });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/portfolio/confirm-delisting
// Called by frontend after MetaMask confirms the delist TX on-chain.
// Clears listing_id_onchain AND zeroes listed_quantity so the credit
// disappears from the market and the "still listed" figure resets.
//
// [FIX-LISTED-QTY] Previously only cleared listing_id_onchain, leaving
// listed_quantity stale. This is safe to always zero because a full
// on-chain cancelListing() always deactivates the WHOLE listing — there's
// no partial cancel on-chain. The frontend's "partial delist" flow does a
// full cancel + a brand new listCredit() for the remainder, which will
// call confirm-listing again with the new (correct) quantity.
// ─────────────────────────────────────────────────────────────────
router.post('/confirm-delisting', authenticate, async (req, res) => {
  const { batchId } = req.body;

  if (!batchId) {
    return res.status(400).json({ error: 'batchId required' });
  }

  try {
    const { rows } = await query(
      `SELECT id, user_id, project_name, listed_quantity FROM carbon_batches WHERE id = $1`,
      [batchId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Batch not found' });
    }
    if (rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden — you do not own this batch' });
    }

    await query(
      `UPDATE carbon_batches
       SET listing_id_onchain = NULL,
           listed_quantity    = 0,
           updated_at         = NOW()
       WHERE id = $1 AND user_id = $2`,
      [batchId, req.user.id]
    );

    console.log(`[confirm-delisting] batch=${batchId} user=${req.user.id}`);

    sendDelistingConfirmedEmail(req.user.email, {
      name: req.user.full_name, projectName: rows[0].project_name, quantity: rows[0].listed_quantity,
      portfolioUrl: `${process.env.FRONTEND_URL}/portfolio`,
    }).catch(e => console.warn('[confirm-delisting] email failed:', e.message));

    res.json({ success: true });
  } catch (e) {
    console.error('[confirm-delisting]', e.message);
    res.status(500).json({ error: 'Failed to confirm delisting' });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/portfolio/my-submissions
// ─────────────────────────────────────────────────────────────────
router.get('/my-submissions', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT cb.id, cb.project_name, cb.project_location, cb.country,
              cb.standard, cb.project_type, cb.developer, cb.quantity,
              cb.vintage_year, cb.expiry_date, cb.registry_serial,
              cb.doc_ipfs_hash, cb.admin_status, cb.admin_notes,
              cb.status, cb.created_at,
              cb.credit_type, cb.cbam_eligible,
              cb.acva_name, cb.acva_date, cb.acva_status,
              cb.icm_registry_id, cb.banking_status,
              cb.corresponding_adjustment, cb.sdg_tags,
              cb.icvcm_ccp_eligible, cb.icvcm_ccp_label, cb.icvcm_ccp_date,
              cb.registry_link, cb.methodology_id,
              cb.additionality_type, cb.permanence_rating, cb.co_benefits_verified,
              p.project_code AS project_id
       FROM carbon_batches cb
       LEFT JOIN projects p ON p.id = cb.project_id
       WHERE cb.user_id = $1
         AND cb.admin_status IN ('pending', 'rejected')
       ORDER BY cb.created_at DESC
       LIMIT 200`,
      [req.user.id]
    );

    const submissions = rows.map(r => ({
      ...r,
      sdg_tags: parseSdgTags(r.sdg_tags),
    }));

    res.json({ submissions });
  } catch (e) {
    console.error('[my-submissions]', e.message);
    res.status(500).json({ error: 'Failed to fetch submissions.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/portfolio/my-credits
// [FIX-LISTED-QTY] cb.listed_quantity added to the SELECT so mapCreditRow
// can read the real tracked value instead of deriving it.
// ─────────────────────────────────────────────────────────────────
router.get('/my-credits', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT cb.id, cb.project_name, cb.project_location, cb.country,
              cb.standard, cb.project_type, cb.developer,
              cb.quantity, cb.total_credits, cb.available_credits, cb.retired_credits,
              cb.listed_quantity,
              cb.vintage_year, cb.expiry_date, cb.registry_serial,
              cb.doc_ipfs_hash, cb.admin_status, cb.admin_notes,
              cb.status, cb.token_id, cb.tx_hash_mint,
              cb.listing_id_onchain,
              cb.created_at, cb.updated_at,
              cb.credit_type, cb.cbam_eligible,
              cb.acva_name, cb.acva_date, cb.acva_status,
              cb.icm_registry_id, cb.banking_status,
              cb.corresponding_adjustment, cb.sdg_tags,
              cb.icvcm_ccp_eligible, cb.icvcm_ccp_label, cb.icvcm_ccp_date,
              cb.registry_link, cb.methodology_id,
              cb.additionality_type, cb.permanence_rating, cb.co_benefits_verified,
              p.project_code AS project_id
       FROM carbon_batches cb
       LEFT JOIN projects p ON p.id = cb.project_id
       WHERE cb.user_id = $1
         AND cb.admin_status = 'approved'
       ORDER BY cb.updated_at DESC
       LIMIT 500`,
      [req.user.id]
    );

    const credits = rows.map(mapCreditRow);
    res.json({ credits });
  } catch (e) {
    console.error('[my-credits]', e.message);
    res.status(500).json({ error: 'Failed to fetch credits.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/portfolio/my-bought-credits
// ─────────────────────────────────────────────────────────────────
router.get('/my-bought-credits', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         t.id             AS trade_id,
         t.token_id,
         t.quantity,
         t.price_per_credit_inr,
         t.subtotal_inr,
         t.buyer_pays_inr,
         t.payment_mode,
         t.tx_hash,
         t.created_at    AS bought_at,
         t.status        AS trade_status,
         su.full_name    AS seller_name,
         su.email        AS seller_email,
         su.wallet_address AS seller_wallet,
         cb.id           AS batch_id,
         cb.project_name,
         cb.project_location,
         cb.country,
         cb.standard,
         cb.project_type,
         cb.developer,
         cb.vintage_year,
         cb.expiry_date,
         cb.registry_serial,
         cb.credit_type,
         cb.cbam_eligible,
         cb.corresponding_adjustment,
         cb.sdg_tags,
         cb.icvcm_ccp_eligible,
         cb.icvcm_ccp_label,
         cb.registry_link,
         cb.methodology_id
       FROM trades t
       JOIN users su ON su.id = t.seller_id
       LEFT JOIN carbon_batches cb ON cb.id = t.batch_id
       WHERE t.buyer_id = $1
         AND t.status = 'completed'
       ORDER BY t.created_at DESC
       LIMIT 500`,
      [req.user.id]
    );

    const bought = rows.map(r => ({
      id              : `bought-${r.trade_id}`,
      tradeId         : r.trade_id,
      tokenId         : r.token_id,
      tokenHex        : r.token_id != null
        ? `0x${Number(r.token_id).toString(16).padStart(8, '0').toUpperCase()}`
        : null,
      credits         : Number(r.quantity),
      heldCredits     : Number(r.quantity),
      listedCredits   : 0,
      quantity        : Number(r.quantity),
      pricePerCredit  : Number(r.price_per_credit_inr) || 0,
      totalPaid       : Number(r.buyer_pays_inr) || 0,
      paymentMode     : r.payment_mode || 'eth',
      txHash          : r.tx_hash,
      boughtAt        : r.bought_at,
      batchId         : r.batch_id,
      projectName     : r.project_name || 'Unknown Project',
      location        : r.project_location || '',
      country         : r.country || '',
      standard        : r.standard || 'VCS',
      projectType     : r.project_type || '',
      developer       : r.developer || '',
      vintageYear     : r.vintage_year,
      expiryDate      : r.expiry_date,
      serialNumber    : r.registry_serial,
      creditType      : r.credit_type || 'voluntary',
      cbamEligible    : r.cbam_eligible || false,
      correspondingAdjustment : r.corresponding_adjustment || 'none',
      sdgTags         : parseSdgTags(r.sdg_tags),
      icvcmCcpEligible : r.icvcm_ccp_eligible || false,
      icvcmCcpLabel   : r.icvcm_ccp_label || '',
      registryLink    : r.registry_link || '',
      methodologyId   : r.methodology_id || '',
      sellerName      : r.seller_name,
      sellerWallet    : r.seller_wallet,
      status          : 'BOUGHT',
      isBought        : true,
      isOnChain       : true,
      admin_status    : 'approved',
      vintageDiscount : 0,
    }));

    res.json({ bought });
  } catch (e) {
    console.error('[my-bought-credits]', e.message);
    res.status(500).json({ error: 'Failed to fetch bought credits.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/portfolio/batch-by-token/:tokenId
// ─────────────────────────────────────────────────────────────────
router.get('/batch-by-token/:tokenId', authenticate, async (req, res) => {
  try {
    const tokenId = parseInt(req.params.tokenId, 10);
    if (isNaN(tokenId) || tokenId < 0) {
      return res.status(400).json({ error: 'Invalid tokenId.' });
    }

    const { rows } = await query(
      `SELECT id, project_name, standard, available_credits, user_id
       FROM carbon_batches
       WHERE token_id = $1
       LIMIT 1`,
      [tokenId]
    );

    if (!rows.length) return res.json({ batchId: null });

    const row = rows[0];
    res.json({
      batchId          : row.id,
      projectName      : row.project_name,
      standard         : row.standard,
      availableCredits : row.available_credits,
      isOwner          : row.user_id === req.user.id,
    });
  } catch (e) {
    console.error('[batch-by-token]', e.message);
    res.json({ batchId: null });
  }
});

// ─────────────────────────────────────────────────────────────────
// DELETE /api/portfolio/submissions/:id
// ─────────────────────────────────────────────────────────────────
router.delete('/submissions/:id', authenticate, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid submission ID.' });
  }

  try {
    const { rows } = await query(
      `SELECT id, user_id, admin_status FROM carbon_batches WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Submission not found.' });

    if (rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    if (rows[0].admin_status === 'approved') {
      return res.status(400).json({ error: 'Cannot delete an approved credit.' });
    }

    await query(`DELETE FROM carbon_batches WHERE id = $1`, [id]);
    res.json({ message: 'Submission deleted.' });
  } catch (e) {
    console.error('[delete-submission]', e.message);
    res.status(500).json({ error: 'Delete failed.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/portfolio/check-duplicate-retirement
// ─────────────────────────────────────────────────────────────────
router.get('/check-duplicate-retirement', authenticate, async (req, res) => {
  const serial = sanitiseString(req.query.serial || '', 200);
  if (!serial) return res.status(400).json({ error: 'serial required.' });

  try {
    const { rows } = await query(
      `SELECT id FROM retirements WHERE serial_number = $1 LIMIT 1`,
      [serial]
    );
    res.json({ found: rows.length > 0 });
  } catch (e) {
    console.error('[check-duplicate-retirement]', e.message);
    res.status(500).json({ error: 'Check failed.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/portfolio/kyc-status
// ─────────────────────────────────────────────────────────────────
router.get('/kyc-status', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT kyc_verified, kyc_verified_at, kyc_expires_at,
              kyc_renewal_notified, kyc_status
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });

    const u          = rows[0];
    const now        = new Date();
    const expiresAt  = u.kyc_expires_at ? new Date(u.kyc_expires_at) : null;
    const daysLeft   = expiresAt
      ? Math.floor((expiresAt - now) / (1000 * 60 * 60 * 24))
      : null;
    const isExpired      = expiresAt ? expiresAt < now : false;
    const isExpiringSoon = daysLeft !== null && daysLeft <= 90 && daysLeft > 0;

    res.json({
      kycVerified    : u.kyc_verified,
      kycStatus      : u.kyc_status,
      kycVerifiedAt  : u.kyc_verified_at,
      kycExpiresAt   : u.kyc_expires_at,
      daysUntilExpiry: daysLeft,
      isExpired,
      isExpiringSoon,
      needsRenewal   : isExpired || isExpiringSoon,
    });
  } catch (e) {
    console.error('[kyc-status]', e.message);
    res.status(500).json({ error: 'Failed to fetch KYC status.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/portfolio/emissions-summary
// ─────────────────────────────────────────────────────────────────
router.get('/emissions-summary', authenticate, async (req, res) => {
  const rawYear = parseInt(req.query.year, 10);
  const year    = isNaN(rawYear) ? new Date().getFullYear() : Math.min(Math.max(rawYear, 2000), 2100);

  try {
    const { rows } = await query(
      `SELECT
         COALESCE(SUM(co2e), 0)                                         AS total,
         COALESCE(SUM(CASE WHEN scope = 1 THEN co2e ELSE 0 END), 0)    AS scope1,
         COALESCE(SUM(CASE WHEN scope = 2 THEN co2e ELSE 0 END), 0)    AS scope2,
         COALESCE(SUM(CASE WHEN scope = 3 THEN co2e ELSE 0 END), 0)    AS scope3,
         COUNT(*)                                                        AS record_count
       FROM emission_activities
       WHERE user_id = $1
         AND EXTRACT(YEAR FROM date::date) = $2`,
      [req.user.id, year]
    );
    res.json({ ...rows[0], year });
  } catch (e) {
    console.error('[emissions-summary]', e.message);
    res.status(500).json({ error: 'Failed to fetch emissions summary.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// Export helpers — shared across GHG / BRSR / CDP / TCFD
// ─────────────────────────────────────────────────────────────────
const safeYear = rawYear => {
  const y = parseInt(rawYear, 10);
  return isNaN(y) ? new Date().getFullYear() : Math.min(Math.max(y, 2000), 2100);
};

const sendCsvResponse = (res, filename, lines) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send('\uFEFF' + lines.join('\n'));
};

// ─────────────────────────────────────────────────────────────────
// GET /api/portfolio/export/ghg-protocol
// ─────────────────────────────────────────────────────────────────
router.get('/export/ghg-protocol', authenticate, exportLimiter, async (req, res) => {
  const year = safeYear(req.query.year);
  try {
    const [creditsRes, emissionsRes, retirementsRes] = await Promise.all([
      query(
        `SELECT * FROM carbon_batches WHERE user_id = $1 AND admin_status = 'approved'`,
        [req.user.id]
      ),
      query(
        `SELECT * FROM emission_activities
         WHERE user_id = $1 AND EXTRACT(YEAR FROM date::date) = $2`,
        [req.user.id, year]
      ),
      query(
        `SELECT * FROM retirements
         WHERE retired_by = $1 AND EXTRACT(YEAR FROM retired_at) = $2`,
        [req.user.id, year]
      ),
    ]);

    const lines = [
      '# GHG Protocol Corporate Standard Inventory',
      `# Reporting Year: ${year}`,
      `# Methodology: GHG Protocol Corporate Standard`,
      `# Generated: ${new Date().toISOString()}`,
      '',
      '## SECTION 1: GHG INVENTORY',
      ['Date','Activity','Scope','Category','Quantity','Unit','Emission Factor','CO2e (tonnes)','Verification Status','Notes']
        .map(csvEscape).join(','),
      ...emissionsRes.rows.map(r =>
        [r.date, r.activity, r.scope, r.category, r.quantity, r.unit, r.factor,
         parseFloat(r.co2e).toFixed(4), r.verified ? 'Verified' : 'Unverified', r.notes || '']
        .map(csvEscape).join(',')
      ),
      '',
      '## SECTION 2: CARBON CREDITS PORTFOLIO',
      ['Project Name','Standard','Serial Number','ICVCM CCP','Quantity (tCO2e)','Vintage Year',
       'Country','Credit Type','CBAM Eligible','Status','Token ID','Corresponding Adjustment']
        .map(csvEscape).join(','),
      ...creditsRes.rows.map(r =>
        [r.project_name, r.standard, r.registry_serial,
         r.icvcm_ccp_eligible ? 'Yes' : 'No', r.quantity, r.vintage_year,
         r.country, r.credit_type, r.cbam_eligible ? 'Yes' : 'No',
         r.status, r.token_id || 'Pending', r.corresponding_adjustment]
        .map(csvEscape).join(',')
      ),
      '',
      '## SECTION 3: RETIREMENTS',
      ['Certificate ID','Project Name','Standard','Credits Retired (tCO2e)','Vintage Year',
       'Scope','Beneficiary Name','TX Hash','Date']
        .map(csvEscape).join(','),
      ...retirementsRes.rows.map(r =>
        [r.certificate_id, r.project_name, r.standard, r.amount, r.vintage_year,
         r.retire_scope, r.beneficiary_name || '', r.tx_hash,
         r.retired_at?.toISOString().slice(0, 10)]
        .map(csvEscape).join(',')
      ),
    ];

    sendCsvResponse(res, `ghg_protocol_inventory_${year}.csv`, lines);
  } catch (e) {
    console.error('[export/ghg-protocol]', e.message);
    res.status(500).json({ error: 'Export failed.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/portfolio/export/brsr
// ─────────────────────────────────────────────────────────────────
router.get('/export/brsr', authenticate, exportLimiter, async (req, res) => {
  const year = safeYear(req.query.year);
  try {
    const [emissionsRes, retirementsRes, userRes] = await Promise.all([
      query(
        `SELECT * FROM emission_activities
         WHERE user_id = $1 AND EXTRACT(YEAR FROM date::date) = $2`,
        [req.user.id, year]
      ),
      query(
        `SELECT * FROM retirements
         WHERE retired_by = $1 AND EXTRACT(YEAR FROM retired_at) = $2`,
        [req.user.id, year]
      ),
      query(
        `SELECT full_name, company_name FROM users WHERE id = $1`,
        [req.user.id]
      ),
    ]);

    const u      = userRes.rows[0];
    const emits  = emissionsRes.rows;
    const rets   = retirementsRes.rows;
    const scope1 = emits.filter(r => r.scope === 1).reduce((s, r) => s + parseFloat(r.co2e || 0), 0);
    const scope2 = emits.filter(r => r.scope === 2).reduce((s, r) => s + parseFloat(r.co2e || 0), 0);
    const scope3 = emits.filter(r => r.scope === 3).reduce((s, r) => s + parseFloat(r.co2e || 0), 0);
    const totalRetired = rets.reduce((s, r) => s + Number(r.amount || 0), 0);
    const net    = Math.max(0, scope1 + scope2 + scope3 - totalRetired);

    const lines = [
      '# SEBI BRSR Core',
      `# Company: ${sanitiseString(u?.company_name || u?.full_name || 'Unknown', 255)}`,
      `# Reporting Year: FY ${year}-${parseInt(year, 10) + 1}`,
      `# Generated: ${new Date().toISOString()}`,
      '',
      ['Metric','Unit','FY Current','Source'].map(csvEscape).join(','),
      ['Scope 1 Emissions','tCO2e', scope1.toFixed(2), 'GHG Protocol'].map(csvEscape).join(','),
      ['Scope 2 Emissions','tCO2e', scope2.toFixed(2), 'GHG Protocol'].map(csvEscape).join(','),
      ['Scope 3 Emissions','tCO2e', scope3.toFixed(2), 'GHG Protocol'].map(csvEscape).join(','),
      ['Total GHG Emissions','tCO2e', (scope1+scope2+scope3).toFixed(2), 'GHG Protocol'].map(csvEscape).join(','),
      ['Carbon Credits Retired','tCO2e', totalRetired.toString(), 'EtherTrack Blockchain'].map(csvEscape).join(','),
      ['Net Emissions','tCO2e', net.toFixed(2), 'Calculated'].map(csvEscape).join(','),
      '',
      ['Certificate ID','Project','Standard','Quantity','Vintage','Scope Offset','Date','TX Hash']
        .map(csvEscape).join(','),
      ...rets.map(r =>
        [r.certificate_id, r.project_name, r.standard, r.amount, r.vintage_year,
         `Scope ${r.retire_scope}`, r.retired_at?.toISOString().slice(0, 10), r.tx_hash]
        .map(csvEscape).join(',')
      ),
    ];

    sendCsvResponse(res, `brsr_core_fy${year}.csv`, lines);
  } catch (e) {
    console.error('[export/brsr]', e.message);
    res.status(500).json({ error: 'Export failed.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/portfolio/export/cdp
// ─────────────────────────────────────────────────────────────────
router.get('/export/cdp', authenticate, exportLimiter, async (req, res) => {
  const year = safeYear(req.query.year);
  try {
    const [emissionsRes, retirementsRes, creditsRes] = await Promise.all([
      query(
        `SELECT * FROM emission_activities
         WHERE user_id = $1 AND EXTRACT(YEAR FROM date::date) = $2`,
        [req.user.id, year]
      ),
      query(
        `SELECT * FROM retirements
         WHERE retired_by = $1 AND EXTRACT(YEAR FROM retired_at) = $2`,
        [req.user.id, year]
      ),
      query(
        `SELECT registry_serial, icvcm_ccp_eligible, corresponding_adjustment
         FROM carbon_batches WHERE user_id = $1 AND admin_status = 'approved'`,
        [req.user.id]
      ),
    ]);

    const emits  = emissionsRes.rows;
    const rets   = retirementsRes.rows;
    const scope1 = emits.filter(r => r.scope === 1).reduce((s, r) => s + parseFloat(r.co2e || 0), 0);
    const scope2 = emits.filter(r => r.scope === 2).reduce((s, r) => s + parseFloat(r.co2e || 0), 0);
    const scope3 = emits.filter(r => r.scope === 3).reduce((s, r) => s + parseFloat(r.co2e || 0), 0);
    const totalRetired = rets.reduce((s, r) => s + Number(r.amount || 0), 0);
    const creditMap = {};
    creditsRes.rows.forEach(c => { creditMap[c.registry_serial] = c; });

    const lines = [
      '# CDP Climate Change Questionnaire',
      `# Reporting Year: ${year}`,
      `# Generated: ${new Date().toISOString()}`,
      '',
      ['CDP Question','Response'].map(csvEscape).join(','),
      [`C6.1 Scope 1 GHG emissions (metric tons CO2e)`, scope1.toFixed(2)].map(csvEscape).join(','),
      [`C6.3 Scope 2 GHG emissions location-based`, scope2.toFixed(2)].map(csvEscape).join(','),
      [`C6.5 Scope 3 total`, scope3.toFixed(2)].map(csvEscape).join(','),
      [`C11.2 Carbon credits retired`, `${totalRetired} tCO2e`].map(csvEscape).join(','),
      '',
      ['Project Name','Standard','Serial','ICVCM CCP','Quantity','Vintage','Country','CA','Certificate ID','TX Hash']
        .map(csvEscape).join(','),
      ...rets.map(r => {
        const credit = creditMap[r.serial_number];
        return [r.project_name, r.standard, r.serial_number,
                credit?.icvcm_ccp_eligible ? 'Yes' : 'No',
                r.amount, r.vintage_year, r.country || '',
                credit?.corresponding_adjustment || 'none',
                r.certificate_id, r.tx_hash]
          .map(csvEscape).join(',');
      }),
    ];

    sendCsvResponse(res, `cdp_climate_${year}.csv`, lines);
  } catch (e) {
    console.error('[export/cdp]', e.message);
    res.status(500).json({ error: 'Export failed.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/portfolio/export/tcfd
// ─────────────────────────────────────────────────────────────────
router.get('/export/tcfd', authenticate, exportLimiter, async (req, res) => {
  const year = safeYear(req.query.year);
  try {
    const [emissionsRes, retirementsRes] = await Promise.all([
      query(
        `SELECT * FROM emission_activities
         WHERE user_id = $1 AND EXTRACT(YEAR FROM date::date) = $2`,
        [req.user.id, year]
      ),
      query(
        `SELECT * FROM retirements
         WHERE retired_by = $1 AND EXTRACT(YEAR FROM retired_at) = $2`,
        [req.user.id, year]
      ),
    ]);

    const emits   = emissionsRes.rows;
    const scope1  = emits.filter(r => r.scope === 1).reduce((s, r) => s + parseFloat(r.co2e || 0), 0);
    const scope2  = emits.filter(r => r.scope === 2).reduce((s, r) => s + parseFloat(r.co2e || 0), 0);
    const scope3  = emits.filter(r => r.scope === 3).reduce((s, r) => s + parseFloat(r.co2e || 0), 0);
    const total   = scope1 + scope2 + scope3;
    const retired = retirementsRes.rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    const net     = Math.max(0, total - retired);

    const lines = [
      '# TCFD Climate Disclosure',
      `# Reporting Period: ${year}`,
      `# Generated: ${new Date().toISOString()}`,
      '',
      ['Metric','Value','Unit','Year'].map(csvEscape).join(','),
      ['Scope 1 GHG Emissions', scope1.toFixed(2), 'tCO2e', year].map(csvEscape).join(','),
      ['Scope 2 GHG Emissions', scope2.toFixed(2), 'tCO2e', year].map(csvEscape).join(','),
      ['Scope 3 GHG Emissions', scope3.toFixed(2), 'tCO2e', year].map(csvEscape).join(','),
      ['Total GHG Emissions', total.toFixed(2), 'tCO2e', year].map(csvEscape).join(','),
      ['Carbon Credits Retired', retired.toString(), 'tCO2e', year].map(csvEscape).join(','),
      ['Net Emissions', net.toFixed(2), 'tCO2e', year].map(csvEscape).join(','),
      '',
      ['Certificate ID','Standard','Amount (tCO2e)','Scope','Date','TX Hash']
        .map(csvEscape).join(','),
      ...retirementsRes.rows.map(r =>
        [r.certificate_id, r.standard, r.amount,
         `Scope ${r.retire_scope}`, r.retired_at?.toISOString().slice(0, 10), r.tx_hash]
        .map(csvEscape).join(',')
      ),
    ];

    sendCsvResponse(res, `tcfd_disclosure_${year}.csv`, lines);
  } catch (e) {
    console.error('[export/tcfd]', e.message);
    res.status(500).json({ error: 'Export failed.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────
function parseSdgTags(raw) {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

// [FIX-LISTED-QTY] listed is now read directly from the tracked column
// instead of being derived as `total_credits - available_credits`, which
// mathematically equals "credits sold" (not "credits still listed") and
// could never produce a correct partial-delist remainder.
function mapCreditRow(r) {
  const listed = Number(r.listed_quantity ?? 0);
  const total  = Number(r.available_credits ?? r.quantity ?? 0);
  const held   = Math.max(0, total - listed);

  let status = 'HELD';
  if (r.status === 'exhausted' || r.status === 'expired') status = 'RETIRED';
  else if (listed > 0 && held > 0) status = 'PARTIAL';
  else if (listed > 0 && held === 0) status = 'LISTED';

  return {
    ...r,
    credits         : held,
    heldCredits     : held,
    listedCredits   : listed,
    vintageYear     : r.vintage_year,
    projectName     : r.project_name,
    serialNumber    : r.registry_serial,
    projectId       : r.project_id,
    tokenId         : r.token_id,
    tokenHex        : r.token_id != null
      ? `0x${Number(r.token_id).toString(16).padStart(8, '0').toUpperCase()}`
      : null,
    expiryDate      : r.expiry_date,
    listingIdOnchain: r.listing_id_onchain ?? null,
    status,
    isOnChain       : r.status === 'tokenised' && r.token_id != null,
    sdg_tags        : parseSdgTags(r.sdg_tags),
  };
}

module.exports = router;