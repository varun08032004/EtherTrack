// routes/auditor-verification.js
// ── Auditor Verification Seal Flow
// ── Status machine:
//    draft → package_ready → under_review → signed_uploaded → sealed
//
// ── How it works:
//    1. SME generates a verification package (PDF via pdfGenerator) + creates a cycle
//    2. System creates a tokenized link — auditor opens it, no login needed
//    3. Auditor downloads the package, signs offline via emSigner/Leegality
//    4. Auditor uploads signed PDF back via the tokenized link
//    5. Backend SHA-256 hashes the signed PDF → anchors hash on Sepolia
//    6. Status → sealed. Cycle record is the immutable proof of verification.
//
// ── Mount in app.js:
//    app.use('/api/audit', require('./routes/auditor-verification'));
//    app.use('/api/audit', require('./routes/audit-auditor-access'));
//
// ── ENV VARS: same as audit.js (RELAYER_PRIVATE_KEY, SEPOLIA_RPC_URL, AUDIT_CONTRACT_ADDRESS)

'use strict';

const router  = require('express').Router();
const crypto  = require('crypto');
const multer  = require('multer');
const { safeQuery: query } = require('../db/pool');
const { authenticate }     = require('../middleware/auth');
const { insertAuditEntry, resolveScope } = require('./audit');
const { sendVerificationPackageCreatedEmail, sendVerificationSealedEmail, sendVerificationReceivedEmail } = require('../services/email');

const FRONTEND_URL = process.env.FRONTEND_URL || process.env.APP_BASE_URL || 'https://ethertrack.in';

// ── Email: notify SME package created + portal link ───────────────────────
const sendPackageCreatedEmail = async ({ toEmail, toName, companyName, year, auditorFirm, auditorEmail, portalUrl, expiresAt }) => {
  try {
    await sendVerificationPackageCreatedEmail(toEmail, {
      name: toName, companyName, year, auditorFirm, auditorEmail, portalUrl,
      expiresAt: new Date(expiresAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
      dashboardUrl: `${FRONTEND_URL}/emission-tracking`,
    });
  } catch (err) {
    console.error('[AuditorVerification] Package email failed:', err.message);
  }
};

// ── Email: notify SME inventory is sealed ─────────────────────────────────
const sendSealedEmail = async ({ toEmail, toName, companyName, year, auditorFirm, auditorName, fileHash, sealTxHash, sealExplorerUrl }) => {
  try {
    await sendVerificationSealedEmail(toEmail, {
      name: toName, companyName, year, verifierName: auditorName || auditorFirm,
      fileHash, sealTxHash, sealExplorerUrl,
      dashboardUrl: `${FRONTEND_URL}/emission-tracking`,
    });
  } catch (err) {
    console.error('[AuditorVerification] Seal email failed:', err.message);
  }
};

// ── Email: confirm to auditor their upload was received ───────────────────
const sendAuditorConfirmEmail = async ({ toEmail, auditorName, companyName, year, fileHash, sealTxHash, sealExplorerUrl }) => {
  try {
    await sendVerificationReceivedEmail(toEmail, {
      name: auditorName, companyName, year, fileHash, sealTxHash, sealExplorerUrl,
    });
  } catch (err) {
    console.error('[AuditorVerification] Auditor confirm email failed:', err.message);
  }
};

// ── multer — signed PDF upload (max 20MB) ────────────────────────────────
const uploadPDF = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are accepted for signed verification documents'));
    }
  },
});

// ── helpers ───────────────────────────────────────────────────────────────
const sanitise = (val, maxLen = 500) =>
  String(val || '').replace(/<[^>]*>/g, '').replace(/['"`;\\]/g, '').trim().slice(0, maxLen);

const safeYear = (val, fallback = null) => {
  const n = parseInt(val, 10);
  if (!Number.isFinite(n) || n < 2000 || n > 2100) return fallback;
  return n;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VALID_PACKAGES = ['standard', 'brsr', 'full'];

const VALID_STATUSES = ['draft', 'package_ready', 'under_review', 'signed_uploaded', 'sealed'];

const sha256File = (buffer) =>
  crypto.createHash('sha256').update(buffer).digest('hex');

const generateLinkToken = () =>
  `et_verify_${crypto.randomBytes(28).toString('hex')}`;

const dbErr = (res, context = 'Operation', err = null) => {
  if (err) console.error(`[AuditorVerification] ${context}:`, err.message);
  return res.status(500).json({
    error: process.env.NODE_ENV !== 'production'
      ? `${context} failed: ${err?.message || 'unknown'}`
      : 'An error occurred. Please try again.',
  });
};

// ── Chain setup (same relayer as audit.js) ────────────────────────────────
const ethers = require('ethers');

// Minimal ABI — we only need logEntry to anchor the signed PDF hash
const ANCHOR_ABI = [
  'function logEntry(string companyId, uint16 year, uint8 action, string message, string metaJson, bytes32 entryHash) returns (uint256)',
];

let provider   = null;
let relayer    = null;
let contract   = null;
let chainReady = false;

const CHAIN_EXPLORER = 'https://sepolia.etherscan.io/tx';
const ACTION_SIGN    = 5; // matches AuditTrail.sol ACTION_SIGN

try {
  if (process.env.RELAYER_PRIVATE_KEY && process.env.AUDIT_CONTRACT_ADDRESS) {
    provider   = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL || process.env.ALCHEMY_RPC || 'https://rpc.sepolia.org');
    relayer    = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
    contract   = new ethers.Contract(process.env.AUDIT_CONTRACT_ADDRESS, ANCHOR_ABI, relayer);
    chainReady = true;
    console.log('[AuditorVerification] Chain ready');
  }
} catch (e) {
  console.error('[AuditorVerification] Chain init failed:', e.message);
}

const toBytes32 = (hexStr) => {
  const hex = hexStr.startsWith('0x') ? hexStr : `0x${hexStr}`;
  return hex.padEnd(66, '0').slice(0, 66);
};

// ── anchor a hash on-chain ────────────────────────────────────────────────
const anchorHashOnChain = async (scopeId, year, fileHash, message) => {
  if (!chainReady) return { txHash: null, blockNumber: null, error: 'Chain not configured' };
  try {
    const hashBytes = toBytes32(fileHash);
    const tx        = await contract.logEntry(
      String(scopeId), year, ACTION_SIGN,
      message.slice(0, 2000),
      JSON.stringify({ type: 'signed_verification_document', hash: fileHash }).slice(0, 2000),
      hashBytes,
      { gasLimit: 200_000 }
    );
    const receipt = await tx.wait(1);
    console.log(`[AuditorVerification] Sealed on-chain | tx: ${receipt.hash}`);
    return { txHash: receipt.hash, blockNumber: receipt.blockNumber, error: null };
  } catch (err) {
    console.error('[AuditorVerification] Chain anchor failed:', err.message);
    return { txHash: null, blockNumber: null, error: err.message.slice(0, 200) };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/audit/verification-cycles
// Create a new verification cycle — called when SME generates a package
// ─────────────────────────────────────────────────────────────────────────────
router.post('/verification-cycles', authenticate, async (req, res) => {
  const year          = safeYear(req.body.year, new Date().getFullYear());
  const auditorEmail  = sanitise(req.body.auditor_email  || '', 254).toLowerCase();
  const auditorFirm   = sanitise(req.body.auditor_firm   || '', 200);
  const packageType   = VALID_PACKAGES.includes(req.body.package_type) ? req.body.package_type : 'standard';
  const notes         = sanitise(req.body.notes          || '', 500);

  if (req.body.year !== undefined && safeYear(req.body.year) === null)
    return res.status(400).json({ error: 'Invalid year — must be 2000–2100' });
  if (!auditorEmail || !EMAIL_RE.test(auditorEmail))
    return res.status(400).json({ error: 'Valid auditor_email is required' });

  try {
    const { scopeId } = await resolveScope(req.user.id);

    // check for existing active cycle for same scope+year
    const { rows: existing } = await query(
      `SELECT id, status FROM auditor_verification_cycles
       WHERE scope_id = $1 AND year = $2 AND status NOT IN ('sealed')
       ORDER BY created_at DESC LIMIT 1`,
      [scopeId, year]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        error:    'An active verification cycle already exists for this year',
        cycleId:  existing[0].id,
        status:   existing[0].status,
        message:  'Use the existing cycle or seal/cancel it before creating a new one',
      });
    }

    const linkToken   = generateLinkToken();
    const linkExpiry  = new Date(Date.now() + 30 * 86_400_000).toISOString(); // 30 days

    const { rows } = await query(
      `INSERT INTO auditor_verification_cycles
         (scope_id, year, issued_by, auditor_email, auditor_firm,
          package_type, status, link_token, link_expires_at,
          package_generated_at, notes)
       VALUES ($1, $2, $3, $4, $5, $6, 'package_ready', $7, $8, NOW(), $9)
       RETURNING id, status, link_token, link_expires_at, created_at`,
      [scopeId, year, req.user.id, auditorEmail, auditorFirm || null,
       packageType, linkToken, linkExpiry, notes || null]
    );

    const cycle = rows[0];

    // log to ghg_audit_log
    await insertAuditEntry(
      req.user.id, year, 'VERIFY',
      `Verification package generated for ${auditorFirm || auditorEmail} — ${packageType} assurance`,
      { cycle_id: cycle.id, auditor_email: auditorEmail, package_type: packageType }
    );

    // build the auditor portal URL
    const baseUrl = process.env.FRONTEND_URL || process.env.APP_BASE_URL || 'https://ethertrack.in';
const portalUrl = `${baseUrl}/verify-audit/${cycle.link_token}`;

    // fetch SME details for email
    const smeRows = await query(
      `SELECT u.email, u.full_name, p.company_name
       FROM users u
       LEFT JOIN emission_profiles p ON p.user_id = u.id
       WHERE u.id = $1 LIMIT 1`,
      [req.user.id]
    ).catch(() => ({ rows: [] }));

    const sme = smeRows.rows[0] || {};

    // fire package created email to SME (non-blocking)
    sendPackageCreatedEmail({
      toEmail:     sme.email || '',
      toName:      sme.full_name,
      companyName: sme.company_name || 'your company',
      year,
      auditorFirm,
      auditorEmail,
      portalUrl,
      expiresAt:   cycle.link_expires_at,
    });

    res.status(201).json({
      message:    'Verification cycle created',
      cycleId:    cycle.id,
      status:     cycle.status,
      portalUrl,
      linkToken:  cycle.link_token,
      expiresAt:  cycle.link_expires_at,
    });
  } catch (err) {
    dbErr(res, 'Create verification cycle', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/audit/verification-cycles
// List all cycles for the current org/user
// ─────────────────────────────────────────────────────────────────────────────
router.get('/verification-cycles', authenticate, async (req, res) => {
  const year = req.query.year ? safeYear(req.query.year) : null;
  if (req.query.year && year === null)
    return res.status(400).json({ error: 'Invalid year — must be 2000–2100' });

  try {
    const { scopeId } = await resolveScope(req.user.id);

    const { rows } = await query(
      `SELECT
         avc.id, avc.year, avc.auditor_email, avc.auditor_firm,
         avc.package_type, avc.status,
         avc.package_generated_at, avc.link_expires_at,
         avc.signed_at, avc.signed_pdf_hash, avc.signed_pdf_filename,
         avc.seal_tx_hash, avc.sealed_at, avc.notes, avc.created_at,
         asd.id AS doc_id, asd.filename AS doc_filename,
         asd.file_size AS doc_size, asd.uploaded_at AS doc_uploaded_at
       FROM auditor_verification_cycles avc
       LEFT JOIN auditor_signed_documents asd ON asd.cycle_id = avc.id
       WHERE avc.scope_id = $1
       ${year ? 'AND avc.year = $2' : ''}
       ORDER BY avc.created_at DESC`,
      year ? [scopeId, year] : [scopeId]
    );

    // attach explorer URL if sealed
    const cycles = rows.map(c => ({
      ...c,
      sealExplorerUrl: c.seal_tx_hash ? `${CHAIN_EXPLORER}/${c.seal_tx_hash}` : null,
    }));

    res.json({ cycles });
  } catch (err) {
    dbErr(res, 'List verification cycles', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/audit/verification-cycles/:id
// Get a single cycle (authenticated — for SME dashboard)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/verification-cycles/:id', authenticate, async (req, res) => {
  try {
    const { scopeId } = await resolveScope(req.user.id);
    const { rows }    = await query(
      `SELECT * FROM auditor_verification_cycles
       WHERE id = $1 AND scope_id = $2`,
      [req.params.id, scopeId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Cycle not found' });
    res.json({ cycle: rows[0] });
  } catch (err) {
    dbErr(res, 'Get cycle', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/audit/verify/:token
// PUBLIC — auditor portal — no login required
// Returns enough info for the auditor to review and know what to upload
// ─────────────────────────────────────────────────────────────────────────────
router.get('/verify/:token', async (req, res) => {
  const token = req.params.token;

  if (!token || !token.startsWith('et_verify_')) {
    return res.status(400).json({ error: 'Invalid verification token' });
  }

  try {
    const { rows } = await query(
      `SELECT
         avc.id, avc.year, avc.auditor_email, avc.auditor_firm,
         avc.package_type, avc.status, avc.link_expires_at,
         avc.package_generated_at, avc.signed_at,
         avc.signed_pdf_hash, avc.signed_pdf_filename,
         avc.seal_tx_hash, avc.sealed_at, avc.notes,
         u.email AS issuer_email,
         p.company_name, p.company_cin, p.industry, p.reporting_year,
         p.company_gstin
       FROM auditor_verification_cycles avc
       JOIN users u ON u.id = avc.issued_by
       LEFT JOIN emission_profiles p ON p.user_id = avc.issued_by
       WHERE avc.link_token = $1`,
      [token]
    );

    if (!rows.length) return res.status(404).json({ error: 'Verification link not found' });

    const cycle = rows[0];

    if (new Date(cycle.link_expires_at) < new Date()) {
      return res.status(410).json({
        error:     'This verification link has expired',
        expiredAt: cycle.link_expires_at,
        message:   'Ask the company to generate a new verification package',
      });
    }

    if (cycle.status === 'sealed') {
      return res.json({
        cycle: {
          ...cycle,
          sealExplorerUrl: cycle.seal_tx_hash ? `${CHAIN_EXPLORER}/${cycle.seal_tx_hash}` : null,
        },
        message: 'This inventory has already been sealed',
        sealed:  true,
      });
    }

    res.json({
      cycle: {
        id:                  cycle.id,
        year:                cycle.year,
        auditorFirm:         cycle.auditor_firm,
        packageType:         cycle.package_type,
        status:              cycle.status,
        expiresAt:           cycle.link_expires_at,
        packageGeneratedAt:  cycle.package_generated_at,
        signedAt:            cycle.signed_at,
        signedPdfFilename:   cycle.signed_pdf_filename,
        sealed:              false,
        sealTxHash:          cycle.seal_tx_hash,
        notes:               cycle.notes,
      },
      entity: {
        companyName: cycle.company_name,
        companyCin:  cycle.company_cin,
        companyGstin: cycle.company_gstin,
        industry:    cycle.industry,
      },
      instructions: [
        '1. Download the verification package from the company portal',
        '2. Review the GHG inventory data and supporting evidence',
        '3. Sign the verification statement using emSigner or your firm\'s DSC tool',
        '4. Upload the signed PDF using the form below',
        '5. Your signature will be hashed and anchored on Ethereum — this is the immutable seal',
      ],
      uploadEndpoint: `/api/audit/verify/${token}/upload`,
    });
  } catch (err) {
    dbErr(res, 'Fetch verification portal', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/audit/verify/:token/upload
// PUBLIC — auditor uploads signed PDF
// No login required — token is the auth
// ─────────────────────────────────────────────────────────────────────────────
router.post('/verify/:token/upload',
  (req, res, next) => {
    uploadPDF.single('signed_pdf')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  async (req, res) => {
    const token = req.params.token;

    if (!token || !token.startsWith('et_verify_')) {
      return res.status(400).json({ error: 'Invalid verification token' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'signed_pdf file is required' });
    }

    const auditorName  = sanitise(req.body.auditor_name  || '', 200);
    const auditorEmail = sanitise(req.body.auditor_email || '', 254).toLowerCase();
    const notes        = sanitise(req.body.notes         || '', 500);

    try {
      // validate token
      const { rows } = await query(
        `SELECT * FROM auditor_verification_cycles WHERE link_token = $1`,
        [token]
      );

      if (!rows.length) return res.status(404).json({ error: 'Verification link not found' });

      const cycle = rows[0];

      if (new Date(cycle.link_expires_at) < new Date()) {
        return res.status(410).json({ error: 'This verification link has expired' });
      }

      if (cycle.status === 'sealed') {
        return res.status(409).json({ error: 'This inventory has already been sealed' });
      }

      // hash the signed PDF
      const fileHash = sha256File(req.file.buffer);
      const filename = sanitise(req.file.originalname, 255);

      // store signed document
      const { rows: docRows } = await query(
        `INSERT INTO auditor_signed_documents
           (cycle_id, scope_id, year, filename, file_data,
            file_size, mime_type, sha256_hash, uploaded_by_ip)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, filename, file_size, sha256_hash, uploaded_at`,
        [
          cycle.id, cycle.scope_id, cycle.year,
          filename, req.file.buffer,
          req.file.size, req.file.mimetype,
          fileHash,
          req.ip || null,
        ]
      );

      const doc = docRows[0];

      // anchor on-chain
      const sealMessage = `Signed verification document uploaded by ${auditorName || auditorEmail || cycle.auditor_firm || 'auditor'} — SHA-256: ${fileHash.slice(0, 16)}…`;
      const chainResult = await anchorHashOnChain(cycle.scope_id, cycle.year, fileHash, sealMessage);

      // update cycle → sealed (or signed_uploaded if chain failed)
      const newStatus = chainResult.txHash ? 'sealed' : 'signed_uploaded';

      const { rows: updatedCycle } = await query(
        `UPDATE auditor_verification_cycles SET
           status             = $2,
           signed_at          = NOW(),
           signed_pdf_hash    = $3,
           signed_pdf_filename= $4,
           seal_tx_hash       = $5,
           seal_block_number  = $6,
           sealed_at          = $7,
           updated_at         = NOW()
         WHERE id = $1
         RETURNING id, status, seal_tx_hash, sealed_at`,
        [
          cycle.id,
          newStatus,
          fileHash,
          filename,
          chainResult.txHash    || null,
          chainResult.blockNumber ? Number(chainResult.blockNumber) : null,
          chainResult.txHash ? new Date().toISOString() : null,
        ]
      );

      // if chain anchor succeeded, update the doc record too
      if (chainResult.txHash) {
        await query(
          `UPDATE auditor_signed_documents SET
             seal_tx_hash   = $2,
             seal_block_number = $3,
             anchored_at    = NOW()
           WHERE id = $1`,
          [doc.id, chainResult.txHash, chainResult.blockNumber ? Number(chainResult.blockNumber) : null]
        );
      }

      // log to ghg_audit_log via issued_by user
      await insertAuditEntry(
        cycle.issued_by, cycle.year, 'SIGN',
        `Verification document signed and ${chainResult.txHash ? 'sealed on-chain' : 'uploaded (chain pending)'} — ${auditorName || cycle.auditor_firm || 'auditor'}`,
        {
          cycle_id:       cycle.id,
          doc_id:         doc.id,
          file_hash:      fileHash,
          auditor_name:   auditorName,
          auditor_email:  auditorEmail,
          chain_tx:       chainResult.txHash,
        }
      ).catch(e => console.error('[AuditorVerification] Audit log failed:', e.message));

      const sealExplorerUrl = chainResult.txHash ? `${CHAIN_EXPLORER}/${chainResult.txHash}` : null;

      // fetch SME details for seal email
      const smeData = await query(
        `SELECT u.email, u.full_name, p.company_name
         FROM users u
         LEFT JOIN emission_profiles p ON p.user_id = u.id
         WHERE u.id = $1 LIMIT 1`,
        [cycle.issued_by]
      ).catch(() => ({ rows: [] }));
      const sme = smeData.rows[0] || {};

      // email SME — sealed notification (non-blocking)
      sendSealedEmail({
        toEmail:        sme.email || '',
        toName:         sme.full_name,
        companyName:    sme.company_name || '',
        year:           cycle.year,
        auditorFirm:    cycle.auditor_firm,
        auditorName:    auditorName,
        fileHash,
        sealTxHash:     chainResult.txHash || null,
        sealExplorerUrl,
      });

      // email auditor — upload confirmation (non-blocking)
      if (auditorEmail || cycle.auditor_email) {
        sendAuditorConfirmEmail({
          toEmail:        auditorEmail || cycle.auditor_email,
          auditorName:    auditorName,
          companyName:    sme.company_name || '',
          year:           cycle.year,
          fileHash,
          sealTxHash:     chainResult.txHash || null,
          sealExplorerUrl,
        });
      }

      res.json({
        message:        chainResult.txHash
          ? 'Signed document uploaded and sealed on Ethereum'
          : 'Signed document uploaded — blockchain anchor pending',
        status:         newStatus,
        documentId:     doc.id,
        fileHash,
        sealed:         !!chainResult.txHash,
        sealTxHash:     chainResult.txHash || null,
        sealExplorerUrl,
        chainError:     chainResult.error || null,
        uploadedAt:     doc.uploaded_at,
      });
    } catch (err) {
      dbErr(res, 'Upload signed document', err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/audit/verification-cycles/:id/anchor
// Authenticated — retry chain anchor if it failed during upload
// ─────────────────────────────────────────────────────────────────────────────
router.post('/verification-cycles/:id/anchor', authenticate, async (req, res) => {
  try {
    const { scopeId } = await resolveScope(req.user.id);
    const { rows }    = await query(
      `SELECT avc.*, asd.sha256_hash, asd.id AS doc_id
       FROM auditor_verification_cycles avc
       LEFT JOIN auditor_signed_documents asd ON asd.cycle_id = avc.id
       WHERE avc.id = $1 AND avc.scope_id = $2`,
      [req.params.id, scopeId]
    );

    if (!rows.length) return res.status(404).json({ error: 'Cycle not found' });

    const cycle = rows[0];

    if (cycle.status === 'sealed') {
      return res.json({ message: 'Already sealed on-chain', sealTxHash: cycle.seal_tx_hash });
    }

    if (!cycle.sha256_hash) {
      return res.status(400).json({ error: 'No signed document uploaded yet' });
    }

    if (!chainReady) {
      return res.status(503).json({ error: 'Blockchain not available — check RELAYER_PRIVATE_KEY and SEPOLIA_RPC_URL' });
    }

    const sealMessage = `Verification document seal retry — SHA-256: ${cycle.sha256_hash.slice(0, 16)}…`;
    const chainResult = await anchorHashOnChain(cycle.scope_id, cycle.year, cycle.sha256_hash, sealMessage);

    if (!chainResult.txHash) {
      return res.status(502).json({ error: chainResult.error || 'Chain anchor failed' });
    }

    await query(
      `UPDATE auditor_verification_cycles SET
         status            = 'sealed',
         seal_tx_hash      = $2,
         seal_block_number = $3,
         sealed_at         = NOW(),
         updated_at        = NOW()
       WHERE id = $1`,
      [cycle.id, chainResult.txHash, chainResult.blockNumber ? Number(chainResult.blockNumber) : null]
    );

    if (cycle.doc_id) {
      await query(
        `UPDATE auditor_signed_documents SET
           seal_tx_hash      = $2,
           seal_block_number = $3,
           anchored_at       = NOW()
         WHERE id = $1`,
        [cycle.doc_id, chainResult.txHash, chainResult.blockNumber ? Number(chainResult.blockNumber) : null]
      );
    }

    res.json({
      message:        'Sealed on Ethereum',
      sealTxHash:     chainResult.txHash,
      sealExplorerUrl: `${CHAIN_EXPLORER}/${chainResult.txHash}`,
    });
  } catch (err) {
    dbErr(res, 'Anchor retry', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/audit/verification-cycles/:id
// Cancel a cycle (only allowed when not sealed)
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/verification-cycles/:id', authenticate, async (req, res) => {
  try {
    const { scopeId } = await resolveScope(req.user.id);
    const { rows }    = await query(
      `SELECT id, status, year FROM auditor_verification_cycles
       WHERE id = $1 AND scope_id = $2`,
      [req.params.id, scopeId]
    );

    if (!rows.length) return res.status(404).json({ error: 'Cycle not found' });
    if (rows[0].status === 'sealed') {
      return res.status(409).json({ error: 'Cannot cancel a sealed cycle — it is permanently recorded on-chain' });
    }

    await query(
      `DELETE FROM auditor_verification_cycles WHERE id = $1`,
      [rows[0].id]
    );

    await insertAuditEntry(
      req.user.id, rows[0].year, 'DELETE',
      `Verification cycle cancelled`,
      { cycle_id: rows[0].id }
    ).catch(() => {});

    res.json({ message: 'Verification cycle cancelled', id: rows[0].id });
  } catch (err) {
    dbErr(res, 'Cancel cycle', err);
  }
});

module.exports = router;