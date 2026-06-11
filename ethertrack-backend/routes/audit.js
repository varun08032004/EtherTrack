// routes/audit.js — GHG Audit Trail, Blockchain-anchored (Sepolia) v2
// ── Production fixes:
//    [FIX-ORG-SCOPE]    Profile now scoped to org_id when user belongs to an org
//    [FIX-DELETE-VER]   DELETE /api/audit/verifiers/:id route added
//    [FIX-STATEMENTS]   GET/POST /api/audit/statements routes added
//    [FIX-ROUTE-NAME]   GET /api/audit/logs (plural) added as alias for /log
//    [FIX-MIGRATION]    Migration SQL provided at bottom
//    [FIX-INPUT-VALID]  All inputs sanitised server-side before DB/chain write
// ── Architecture:
//    PRIMARY  → Sepolia testnet via ethers.js relayer wallet
//    FALLBACK → Postgres (chain_status = pending, retry available)
//    HASH CHAIN → SHA-256, server-side, same algorithm as contract
// ── ENV VARS:
//    RELAYER_PRIVATE_KEY   — relayer wallet private key
//    SEPOLIA_RPC_URL       — Alchemy/Infura Sepolia endpoint
//    AUDIT_CONTRACT_ADDRESS — deployed AuditTrail.sol address

'use strict';

const router  = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate }     = require('../middleware/auth');
const crypto  = require('crypto');
const ethers  = require('ethers');
const path    = require('path');
const multer  = require('multer');

// ── Chain config ─────────────────────────────────────────────────────────────
const CHAIN_CONFIG = {
  name:        'sepolia',
  chainId:     11155111,
  rpcUrl:      process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org',
  explorerTx:  'https://sepolia.etherscan.io/tx',
  explorerAddr:'https://sepolia.etherscan.io/address',
  symbol:      'ETH',
};

// ── AuditTrail.sol ABI ────────────────────────────────────────────────────────
const AUDIT_ABI = [
  'function logEntry(string companyId, uint16 year, uint8 action, string message, string metaJson, bytes32 entryHash) returns (uint256)',
  'function lockInventory(string companyId, uint16 year)',
  'function getAllEntries(string companyId, uint16 year) view returns (tuple(uint256 id, string companyId, uint16 year, uint8 action, string message, string metaJson, bytes32 entryHash, bytes32 prevHash, uint256 timestamp, address relayer)[])',
  'function verifyChain(string companyId, uint16 year) view returns (bool intact, uint256 brokenAt)',
  'function isLocked(string companyId, uint16 year) view returns (bool)',
  'function getEntryCount(string companyId, uint16 year) view returns (uint256)',
  'event EntryLogged(string indexed companyId, uint16 indexed year, uint256 entryId, uint8 action, bytes32 entryHash, bytes32 prevHash, uint256 timestamp)',
  'event InventoryLocked(string indexed companyId, uint16 indexed year, address lockedBy, uint256 timestamp)',
];

const ACTION_MAP = {
  CREATE: 1, UPDATE: 2, DELETE: 3, VERIFY: 4,
  SIGN:   5, LOCK:   6, IMPORT: 7, COMMENT: 8,
};

// ── Chain init ────────────────────────────────────────────────────────────────
let provider   = null;
let relayer    = null;
let contract   = null;
let chainReady = false;

const initChain = () => {
  try {
    if (!process.env.RELAYER_PRIVATE_KEY) {
      console.warn('[Audit] RELAYER_PRIVATE_KEY not set — blockchain disabled');
      return;
    }
    if (!process.env.AUDIT_CONTRACT_ADDRESS) {
      console.warn('[Audit] AUDIT_CONTRACT_ADDRESS not set — deploy contract first');
      return;
    }
    provider   = new ethers.JsonRpcProvider(CHAIN_CONFIG.rpcUrl);
    relayer    = new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
    contract   = new ethers.Contract(process.env.AUDIT_CONTRACT_ADDRESS, AUDIT_ABI, relayer);
    chainReady = true;
    console.log(`[Audit] Chain ready — ${CHAIN_CONFIG.name} | relayer: ${relayer.address}`);
    provider.getBalance(relayer.address).then(bal => {
      const eth = parseFloat(ethers.formatEther(bal));
      if (eth < 0.05) console.warn(`[Audit] Low relayer balance: ${eth.toFixed(4)} ETH`);
      else console.log(`[Audit] Relayer balance: ${eth.toFixed(4)} ETH`);
    }).catch(() => {});
  } catch (err) {
    console.error('[Audit] Chain init failed:', err.message);
    chainReady = false;
  }
};
initChain();

// ── Multer for statement uploads ──────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx', '.xlsx', '.png', '.jpg', '.jpeg'];
    const ext     = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`File type ${ext} not allowed. Allowed: ${allowed.join(', ')}`));
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────
const safeYear = (val, fallback = null) => {
  const n = parseInt(val, 10);
  if (!Number.isFinite(n) || n < 2000 || n > 2100) return fallback;
  return n;
};

const sanitiseText = (val, maxLen = 500) =>
  String(val || '').replace(/<[^>]*>/g, '').replace(/['"`;\\]/g, '').trim().slice(0, maxLen);

const sha256    = (str)    => crypto.createHash('sha256').update(str, 'utf8').digest('hex');
const toBytes32 = (hexStr) => {
  const hex = hexStr.startsWith('0x') ? hexStr : `0x${hexStr}`;
  return hex.padEnd(66, '0').slice(0, 66);
};

const parseChainError = (err) => {
  const msg = err?.message || String(err);
  if (msg.includes('insufficient funds'))  return 'Relayer wallet has insufficient ETH — top up Sepolia faucet';
  if (msg.includes('nonce too low'))       return 'Transaction nonce conflict — will retry automatically';
  if (msg.includes('network') || msg.includes('ECONNREFUSED') || msg.includes('timeout'))
    return `${CHAIN_CONFIG.name} RPC unreachable — check SEPOLIA_RPC_URL`;
  if (msg.includes('Inventory locked'))    return 'Inventory is locked on-chain — no more entries allowed';
  return `Chain error: ${msg.slice(0, 120)}`;
};

const dbErr = (res, context = 'Operation', err = null) => {
  if (err) console.error(`[Audit] ${context}:`, err.message);
  return res.status(500).json({
    error: process.env.NODE_ENV !== 'production'
      ? `${context} failed: ${err?.message || 'unknown'}`
      : 'An error occurred. Please try again.',
  });
};

// ── [FIX-ORG-SCOPE] Resolve org or user scope ─────────────────────────────────
const resolveScope = async (userId) => {
  const { rows } = await query(
    `SELECT org_id FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  const orgId    = rows[0]?.org_id || null;
  const scopeId  = orgId || userId;
  return { orgId, scopeId };
};

// ── Get previous hash for chain linking ───────────────────────────────────────
const getPrevHash = async (scopeId, year) => {
  const { rows } = await query(
    `SELECT hash FROM audit_log
     WHERE scope_id = $1 AND year = $2
     ORDER BY created_at DESC LIMIT 1`,
    [scopeId, year]
  );
  return rows[0]?.hash || '0'.repeat(64);
};

// ── Core: write entry to chain + Postgres ─────────────────────────────────────
const insertAuditEntry = async (userId, year, action, message, meta = {}) => {
  const { scopeId } = await resolveScope(userId);
  const prevHash    = await getPrevHash(scopeId, year);
  const ts          = new Date().toISOString();
  const hash        = sha256(JSON.stringify({ userId, year, action, message, meta, ts, prevHash }));

  let txHash      = null;
  let blockNumber = null;
  let gasUsed     = null;
  let chainStatus = 'pending';
  let chainError  = null;

  // 1. Write to blockchain
  if (chainReady) {
    try {
      const actionCode = ACTION_MAP[action] || ACTION_MAP.COMMENT;
      const metaJson   = JSON.stringify(meta).slice(0, 2000);
      const hashBytes  = toBytes32(hash);
      const tx         = await contract.logEntry(
        String(scopeId), year, actionCode,
        message.slice(0, 2000), metaJson, hashBytes,
        { gasLimit: 200_000 }
      );
      const receipt = await tx.wait(1);
      txHash        = receipt.hash;
      blockNumber   = receipt.blockNumber;
      gasUsed       = receipt.gasUsed?.toString();
      chainStatus   = 'confirmed';
      console.log(`[Audit] On-chain | tx: ${txHash} | block: ${blockNumber} | action: ${action}`);
    } catch (err) {
      chainError  = parseChainError(err);
      chainStatus = 'failed';
      console.error(`[Audit] Chain write failed (Postgres fallback): ${chainError}`);
    }
  }

  // 2. Always write to Postgres
  const { rows } = await query(
    `INSERT INTO audit_log
       (user_id, scope_id, year, action, message, meta, hash, prev_hash, created_at,
        chain_status, tx_hash, block_number, gas_used, chain_error, chain_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING *`,
    [
      userId, scopeId, year, action,
      message.slice(0, 2000),
      JSON.stringify(meta), hash, prevHash, ts,
      chainStatus, txHash, blockNumber, gasUsed,
      chainError, CHAIN_CONFIG.name,
    ]
  );

  const entry = rows[0];
  if (txHash) entry.explorerUrl = `${CHAIN_CONFIG.explorerTx}/${txHash}`;
  entry.chainName = CHAIN_CONFIG.name;
  return entry;
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/audit/log  (and /api/audit/logs alias)
// ─────────────────────────────────────────────────────────────────────────────
const getLogHandler = async (req, res) => {
  const year = safeYear(req.query.year, new Date().getFullYear());
  if (req.query.year !== undefined && safeYear(req.query.year) === null)
    return res.status(400).json({ error: 'Invalid year — must be 2000–2100' });

  try {
    const { scopeId } = await resolveScope(req.user.id);

    const [logRows, lockRow] = await Promise.all([
      query(
        `SELECT id, year, action, message, meta, hash, prev_hash, created_at,
                chain_status, tx_hash, block_number, gas_used, chain_error, chain_name
         FROM audit_log
         WHERE scope_id = $1 AND year = $2
         ORDER BY created_at DESC`,
        [scopeId, year]
      ),
      query(
        `SELECT id, tx_hash FROM inventory_locks
         WHERE scope_id = $1 AND year = $2 LIMIT 1`,
        [scopeId, year]
      ),
    ]);

    const entries = logRows.rows.map(e => ({
      ...e,
      explorerUrl: e.tx_hash ? `${CHAIN_CONFIG.explorerTx}/${e.tx_hash}` : null,
    }));

    const lockTx = lockRow.rows[0]?.tx_hash;
    res.json({
      entries,
      count:        entries.length,
      locked:       lockRow.rows.length > 0,
      lockTxHash:   lockTx  || null,
      lockExplorer: lockTx  ? `${CHAIN_CONFIG.explorerTx}/${lockTx}` : null,
      year,
      chain: {
        name:     CHAIN_CONFIG.name,
        chainId:  CHAIN_CONFIG.chainId,
        ready:    chainReady,
        relayer:  relayer?.address || null,
        contract: process.env.AUDIT_CONTRACT_ADDRESS || null,
      },
    });
  } catch (err) {
    dbErr(res, 'Fetch audit log', err);
  }
};

router.get('/log',  authenticate, getLogHandler);
router.get('/logs', authenticate, getLogHandler); // [FIX-ROUTE-NAME] alias

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/audit/log — manual comment
// ─────────────────────────────────────────────────────────────────────────────
router.post('/log', authenticate, async (req, res) => {
  const year    = safeYear(req.body.year, new Date().getFullYear());
  const action  = req.body.action  || 'COMMENT';
  const message = sanitiseText(req.body.message || '', 2000);
  const meta    = (req.body.meta && typeof req.body.meta === 'object') ? req.body.meta : {};

  if (req.body.year !== undefined && safeYear(req.body.year) === null)
    return res.status(400).json({ error: 'Invalid year — must be 2000–2100' });
  if (!message)
    return res.status(400).json({ error: 'message is required' });
  if (!ACTION_MAP[action])
    return res.status(400).json({ error: `Invalid action. Must be one of: ${Object.keys(ACTION_MAP).join(', ')}` });

  try {
    const entry = await insertAuditEntry(req.user.id, year, action, message, meta);
    res.json({
      message:    'Entry logged',
      entry,
      onChain:    entry.chain_status === 'confirmed',
      explorerUrl: entry.explorerUrl || null,
    });
  } catch (err) {
    dbErr(res, 'Log audit entry', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/audit/retry-chain/:id
// ─────────────────────────────────────────────────────────────────────────────
router.post('/retry-chain/:id', authenticate, async (req, res) => {
  try {
    const { scopeId } = await resolveScope(req.user.id);
    const { rows }    = await query(
      `SELECT * FROM audit_log WHERE id = $1 AND scope_id = $2`,
      [req.params.id, scopeId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Entry not found' });

    const entry = rows[0];
    if (entry.chain_status === 'confirmed')
      return res.json({ message: 'Already confirmed on-chain', entry });
    if (!chainReady)
      return res.status(503).json({ error: 'Blockchain not available — check RELAYER_PRIVATE_KEY and SEPOLIA_RPC_URL' });

    const meta       = typeof entry.meta === 'string' ? JSON.parse(entry.meta) : (entry.meta || {});
    const actionCode = ACTION_MAP[entry.action] || ACTION_MAP.COMMENT;
    const hashBytes  = toBytes32(entry.hash);

    const tx      = await contract.logEntry(
      String(scopeId), entry.year, actionCode,
      entry.message.slice(0, 2000),
      JSON.stringify(meta).slice(0, 2000),
      hashBytes,
      { gasLimit: 200_000 }
    );
    const receipt = await tx.wait(1);

    const { rows: updated } = await query(
      `UPDATE audit_log SET
         chain_status = 'confirmed',
         tx_hash      = $3,
         block_number = $4,
         gas_used     = $5,
         chain_error  = NULL
       WHERE id = $1 AND scope_id = $2
       RETURNING *`,
      [entry.id, scopeId, receipt.hash, receipt.blockNumber, receipt.gasUsed?.toString()]
    );

    res.json({
      message:     'Entry anchored to chain',
      entry:       updated[0],
      txHash:      receipt.hash,
      explorerUrl: `${CHAIN_CONFIG.explorerTx}/${receipt.hash}`,
    });
  } catch (err) {
    const chainError = parseChainError(err);
    await query(
      `UPDATE audit_log SET chain_error = $2 WHERE id = $1`,
      [req.params.id, chainError]
    ).catch(() => {});
    dbErr(res, chainError, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/audit/verifiers?year=2025
// ─────────────────────────────────────────────────────────────────────────────
router.get('/verifiers', authenticate, async (req, res) => {
  const year = safeYear(req.query.year, new Date().getFullYear());
  if (req.query.year !== undefined && safeYear(req.query.year) === null)
    return res.status(400).json({ error: 'Invalid year — must be 2000–2100' });

  try {
    const { scopeId } = await resolveScope(req.user.id);
    const { rows }    = await query(
      `SELECT id, year, verifier_name, verifier_org, verifier_email,
              assurance_level, scope, engagement_ref, notes,
              status, verification_ref, verification_date, verified_at, invited_at
       FROM audit_verifiers
       WHERE scope_id = $1 AND year = $2
       ORDER BY invited_at DESC`,
      [scopeId, year]
    );
    res.json({ verifiers: rows });
  } catch (err) {
    dbErr(res, 'Fetch verifiers', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/audit/verifiers
// ─────────────────────────────────────────────────────────────────────────────
router.post('/verifiers', authenticate, async (req, res) => {
  const year = safeYear(req.body.year, new Date().getFullYear());
  if (req.body.year !== undefined && safeYear(req.body.year) === null)
    return res.status(400).json({ error: 'Invalid year — must be 2000–2100' });

  const verifier_name    = sanitiseText(req.body.verifier_name    || '', 200);
  const verifier_org     = sanitiseText(req.body.verifier_org     || '', 200);
  const verifier_email   = sanitiseText(req.body.verifier_email   || '', 200).toLowerCase();
  const assurance_level  = req.body.assurance_level || 'limited';
  const scope            = sanitiseText(req.body.scope            || '1+2+3', 20);
  const engagement_ref   = sanitiseText(req.body.engagement_ref   || '', 100);
  const notes            = sanitiseText(req.body.notes            || '', 500);

  if (!verifier_name || !verifier_email)
    return res.status(400).json({ error: 'verifier_name and verifier_email are required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(verifier_email))
    return res.status(400).json({ error: 'Invalid verifier_email format' });
  if (!['limited', 'reasonable', 'high'].includes(assurance_level))
    return res.status(400).json({ error: 'assurance_level must be limited, reasonable, or high' });

  try {
    const { scopeId } = await resolveScope(req.user.id);

    const { rows } = await query(
      `INSERT INTO audit_verifiers
         (user_id, scope_id, year, verifier_name, verifier_org, verifier_email,
          assurance_level, scope, engagement_ref, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        req.user.id, scopeId, year,
        verifier_name, verifier_org || null, verifier_email,
        assurance_level, scope,
        engagement_ref || null, notes || null,
      ]
    );

    const auditEntry = await insertAuditEntry(
      req.user.id, year, 'VERIFY',
      `Verifier invited: ${verifier_name} (${verifier_org || 'independent'}) — ${assurance_level} assurance`,
      { verifier_email, assurance_level, scope }
    );

    res.json({
      message:     'Verifier invited',
      verifier:    rows[0],
      auditEntry,
      onChain:     auditEntry.chain_status === 'confirmed',
      explorerUrl: auditEntry.explorerUrl || null,
    });
  } catch (err) {
    dbErr(res, 'Invite verifier', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/audit/verifiers/:id
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/verifiers/:id', authenticate, async (req, res) => {
  const { status, verification_ref, verification_date } = req.body;

  if (status && !['pending', 'verified', 'rejected'].includes(status))
    return res.status(400).json({ error: 'status must be pending, verified, or rejected' });
  if (verification_date && !/^\d{4}-\d{2}-\d{2}$/.test(verification_date))
    return res.status(400).json({ error: 'verification_date must be YYYY-MM-DD' });

  try {
    const { scopeId } = await resolveScope(req.user.id);
    const { rows }    = await query(
      `UPDATE audit_verifiers SET
         status            = COALESCE($3, status),
         verification_ref  = COALESCE($4, verification_ref),
         verification_date = COALESCE($5, verification_date),
         verified_at       = CASE WHEN $3 = 'verified' THEN NOW() ELSE verified_at END
       WHERE id = $1 AND scope_id = $2
       RETURNING *`,
      [
        req.params.id, scopeId,
        status             || null,
        verification_ref   ? sanitiseText(verification_ref, 100) : null,
        verification_date  || null,
      ]
    );

    if (!rows.length) return res.status(404).json({ error: 'Verifier not found' });

    let auditEntry = null;
    if (status === 'verified') {
      auditEntry = await insertAuditEntry(
        req.user.id, rows[0].year, 'SIGN',
        `Inventory verified by ${rows[0].verifier_name} — ISO 14064-3 ${rows[0].assurance_level} assurance`,
        { verification_ref, verification_date }
      );
    }

    res.json({
      message:     'Verifier updated',
      verifier:    rows[0],
      auditEntry,
      onChain:     auditEntry?.chain_status === 'confirmed',
      explorerUrl: auditEntry?.explorerUrl || null,
    });
  } catch (err) {
    dbErr(res, 'Update verifier', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// [FIX-DELETE-VER] DELETE /api/audit/verifiers/:id
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/verifiers/:id', authenticate, async (req, res) => {
  try {
    const { scopeId } = await resolveScope(req.user.id);
    const { rows }    = await query(
      `DELETE FROM audit_verifiers
       WHERE id = $1 AND scope_id = $2
       RETURNING id, verifier_name, year`,
      [req.params.id, scopeId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Verifier not found' });

    // Log removal to audit trail
    await insertAuditEntry(
      req.user.id, rows[0].year, 'DELETE',
      `Verifier removed: ${rows[0].verifier_name}`,
      { verifier_id: rows[0].id }
    );

    res.json({ message: 'Verifier removed', id: rows[0].id });
  } catch (err) {
    dbErr(res, 'Remove verifier', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/audit/lock
// ─────────────────────────────────────────────────────────────────────────────
router.post('/lock', authenticate, async (req, res) => {
  const year = safeYear(req.body.year, new Date().getFullYear());
  if (req.body.year !== undefined && safeYear(req.body.year) === null)
    return res.status(400).json({ error: 'Invalid year — must be 2000–2100' });

  let chainTxHash    = null;
  let chainExplorer  = null;
  let chainLockError = null;

  if (chainReady) {
    try {
      const { scopeId }  = await resolveScope(req.user.id);
      const tx           = await contract.lockInventory(String(scopeId), year, { gasLimit: 100_000 });
      const receipt      = await tx.wait(1);
      chainTxHash        = receipt.hash;
      chainExplorer      = `${CHAIN_CONFIG.explorerTx}/${chainTxHash}`;
      console.log(`[Audit] Inventory locked on-chain | tx: ${chainTxHash}`);
    } catch (err) {
      chainLockError = parseChainError(err);
      console.error(`[Audit] Chain lock failed: ${chainLockError}`);
    }
  }

  try {
    const { scopeId } = await resolveScope(req.user.id);

    await query(
      `INSERT INTO inventory_locks (user_id, scope_id, year, locked_by, tx_hash)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (scope_id, year) DO NOTHING`,
      [req.user.id, scopeId, year, req.user.email || String(req.user.id), chainTxHash]
    );

    const auditEntry = await insertAuditEntry(
      req.user.id, year, 'LOCK',
      `GHG inventory locked for FY ${year} — ISO 14064-3 data freeze`,
      { year, locked_by: req.user.email, chain_tx: chainTxHash }
    );

    res.json({
      message:        `Inventory locked for FY ${year}`,
      year,
      onChain:        !!chainTxHash,
      lockTxHash:     chainTxHash,
      lockExplorer:   chainExplorer,
      chainLockError: chainLockError || null,
      auditEntry,
    });
  } catch (err) {
    dbErr(res, 'Lock inventory', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/audit/verify-chain?year=2025
// ─────────────────────────────────────────────────────────────────────────────
router.get('/verify-chain', authenticate, async (req, res) => {
  const year = safeYear(req.query.year, new Date().getFullYear());
  if (req.query.year !== undefined && safeYear(req.query.year) === null)
    return res.status(400).json({ error: 'Invalid year — must be 2000–2100' });

  try {
    const { scopeId } = await resolveScope(req.user.id);

    const { rows } = await query(
      `SELECT id, hash, prev_hash, action, created_at, chain_status, tx_hash
       FROM audit_log
       WHERE scope_id = $1 AND year = $2
       ORDER BY created_at ASC`,
      [scopeId, year]
    );

    let dbBroken = 0;
    const dbResults = rows.map((entry, i) => {
      if (i === 0) return { id: entry.id, action: entry.action, ok: true, chain_status: entry.chain_status, tx_hash: entry.tx_hash };
      const ok = entry.prev_hash === rows[i - 1].hash;
      if (!ok) dbBroken++;
      return { id: entry.id, action: entry.action, ok, chain_status: entry.chain_status, tx_hash: entry.tx_hash };
    });

    let onChain = null;
    if (chainReady) {
      try {
        const [intact, brokenAt] = await contract.verifyChain(String(scopeId), year);
        const count              = await contract.getEntryCount(String(scopeId), year);
        onChain = {
          intact,
          brokenAt:     intact ? null : Number(brokenAt),
          totalOnChain: Number(count),
          contractUrl:  `${CHAIN_CONFIG.explorerAddr}/${process.env.AUDIT_CONTRACT_ADDRESS}`,
        };
      } catch (err) {
        onChain = { error: parseChainError(err) };
      }
    }

    const confirmedCount = rows.filter(r => r.chain_status === 'confirmed').length;
    const pendingCount   = rows.filter(r => r.chain_status === 'pending').length;
    const failedCount    = rows.filter(r => r.chain_status === 'failed').length;

    res.json({
      year,
      database:   { total: rows.length, broken: dbBroken, intact: dbBroken === 0, entries: dbResults },
      blockchain: onChain,
      summary: {
        confirmed: confirmedCount,
        pending:   pendingCount,
        failed:    failedCount,
        coverage:  rows.length > 0 ? `${Math.round(confirmedCount / rows.length * 100)}%` : '0%',
      },
      chain: { name: CHAIN_CONFIG.name, chainId: CHAIN_CONFIG.chainId, ready: chainReady },
    });
  } catch (err) {
    dbErr(res, 'Verify chain', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/audit/chain-status
// ─────────────────────────────────────────────────────────────────────────────
router.get('/chain-status', authenticate, async (req, res) => {
  if (!chainReady) {
    return res.json({
      ready:  false,
      reason: !process.env.RELAYER_PRIVATE_KEY
        ? 'RELAYER_PRIVATE_KEY not configured'
        : !process.env.AUDIT_CONTRACT_ADDRESS
        ? 'AUDIT_CONTRACT_ADDRESS not configured — deploy contract first'
        : 'Chain initialization failed',
      chain: CHAIN_CONFIG.name,
    });
  }

  try {
    const [balance, blockNumber] = await Promise.all([
      provider.getBalance(relayer.address),
      provider.getBlockNumber(),
    ]);
    const ethBalance = parseFloat(ethers.formatEther(balance));
    res.json({
      ready:       true,
      chain:       CHAIN_CONFIG.name,
      chainId:     CHAIN_CONFIG.chainId,
      relayer:     relayer.address,
      contract:    process.env.AUDIT_CONTRACT_ADDRESS,
      explorerUrl: `${CHAIN_CONFIG.explorerAddr}/${process.env.AUDIT_CONTRACT_ADDRESS}`,
      balance:     ethBalance.toFixed(4),
      symbol:      CHAIN_CONFIG.symbol,
      blockNumber,
      lowBalance:  ethBalance < 0.05,
    });
  } catch (err) {
    res.json({ ready: false, reason: parseChainError(err), chain: CHAIN_CONFIG.name });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// [FIX-STATEMENTS] GET /api/audit/statements?year=2025
// ─────────────────────────────────────────────────────────────────────────────
router.get('/statements', authenticate, async (req, res) => {
  const year = safeYear(req.query.year, new Date().getFullYear());
  if (req.query.year !== undefined && safeYear(req.query.year) === null)
    return res.status(400).json({ error: 'Invalid year — must be 2000–2100' });

  try {
    const { scopeId } = await resolveScope(req.user.id);
    const { rows }    = await query(
      `SELECT id, year, filename, file_size, mime_type, description,
              uploaded_by, uploaded_at, verifier_name
       FROM audit_statements
       WHERE scope_id = $1 AND year = $2
       ORDER BY uploaded_at DESC`,
      [scopeId, year]
    );
    res.json({ statements: rows });
  } catch (err) {
    dbErr(res, 'Fetch statements', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// [FIX-STATEMENTS] POST /api/audit/statements — upload verification statement
// ─────────────────────────────────────────────────────────────────────────────
router.post('/statements',
  authenticate,
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'File is required' });

    const year          = safeYear(req.body.year, new Date().getFullYear());
    const description   = sanitiseText(req.body.description   || '', 500);
    const verifier_name = sanitiseText(req.body.verifier_name || '', 200);

    if (req.body.year !== undefined && safeYear(req.body.year) === null)
      return res.status(400).json({ error: 'Invalid year — must be 2000–2100' });

    try {
      const { scopeId } = await resolveScope(req.user.id);

      // Store file bytes in DB (or replace with S3 upload in production)
      const { rows } = await query(
        `INSERT INTO audit_statements
           (user_id, scope_id, year, filename, file_data, file_size, mime_type,
            description, verifier_name, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, year, filename, file_size, mime_type, description, uploaded_at`,
        [
          req.user.id, scopeId, year,
          sanitiseText(req.file.originalname, 255),
          req.file.buffer,
          req.file.size,
          req.file.mimetype,
          description || null,
          verifier_name || null,
          req.user.email || String(req.user.id),
        ]
      );

      // Log to audit trail
      await insertAuditEntry(
        req.user.id, year, 'SIGN',
        `Verification statement uploaded: ${req.file.originalname}${verifier_name ? ` by ${verifier_name}` : ''}`,
        { filename: req.file.originalname, file_size: req.file.size }
      );

      res.json({ message: 'Statement uploaded', statement: rows[0] });
    } catch (err) {
      dbErr(res, 'Upload statement', err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Export insertAuditEntry for use in emissions.js and other routes
// ─────────────────────────────────────────────────────────────────────────────
module.exports = router;
module.exports.insertAuditEntry = insertAuditEntry;

/*
── MIGRATION SQL ──────────────────────────────────────────────────────────────

-- 1. audit_log table
CREATE TABLE IF NOT EXISTS audit_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_id     TEXT        NOT NULL,  -- org_id or user_id (UUID as text)
  year         INTEGER     NOT NULL,
  action       VARCHAR(20) NOT NULL,
  message      TEXT        NOT NULL,
  meta         JSONB       DEFAULT '{}',
  hash         VARCHAR(64) NOT NULL,
  prev_hash    VARCHAR(64) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  chain_status VARCHAR(20) DEFAULT 'pending',
  tx_hash      VARCHAR(66),
  block_number BIGINT,
  gas_used     VARCHAR(30),
  chain_error  TEXT,
  chain_name   VARCHAR(20) DEFAULT 'sepolia'
);
CREATE INDEX IF NOT EXISTS audit_log_scope_year_idx ON audit_log (scope_id, year);
CREATE INDEX IF NOT EXISTS audit_log_user_idx        ON audit_log (user_id);

-- 2. audit_verifiers table
CREATE TABLE IF NOT EXISTS audit_verifiers (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_id          TEXT        NOT NULL,
  year              INTEGER     NOT NULL,
  verifier_name     VARCHAR(200) NOT NULL,
  verifier_org      VARCHAR(200),
  verifier_email    VARCHAR(200) NOT NULL,
  assurance_level   VARCHAR(20)  NOT NULL DEFAULT 'limited',
  scope             VARCHAR(20)  NOT NULL DEFAULT '1+2+3',
  engagement_ref    VARCHAR(100),
  notes             VARCHAR(500),
  status            VARCHAR(20)  NOT NULL DEFAULT 'pending',
  verification_ref  VARCHAR(100),
  verification_date DATE,
  verified_at       TIMESTAMPTZ,
  invited_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_verifiers_scope_year_idx ON audit_verifiers (scope_id, year);

-- 3. inventory_locks table
CREATE TABLE IF NOT EXISTS inventory_locks (
  id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_id  TEXT        NOT NULL,
  year      INTEGER     NOT NULL,
  locked_by VARCHAR(200),
  tx_hash   VARCHAR(66),
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_locks_scope_year_key UNIQUE (scope_id, year)
);

-- 4. audit_statements table
CREATE TABLE IF NOT EXISTS audit_statements (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_id      TEXT         NOT NULL,
  year          INTEGER      NOT NULL,
  filename      VARCHAR(255) NOT NULL,
  file_data     BYTEA,          -- or store S3 URL instead
  file_size     INTEGER,
  mime_type     VARCHAR(100),
  description   VARCHAR(500),
  verifier_name VARCHAR(200),
  uploaded_by   VARCHAR(200),
  uploaded_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_statements_scope_year_idx ON audit_statements (scope_id, year);

-- 5. Migration if upgrading from old schema with user_id instead of scope_id:
ALTER TABLE audit_log         ADD COLUMN IF NOT EXISTS scope_id TEXT;
ALTER TABLE audit_verifiers   ADD COLUMN IF NOT EXISTS scope_id TEXT;
ALTER TABLE inventory_locks   ADD COLUMN IF NOT EXISTS scope_id TEXT;

UPDATE audit_log       SET scope_id = user_id::text WHERE scope_id IS NULL;
UPDATE audit_verifiers SET scope_id = user_id::text WHERE scope_id IS NULL;
UPDATE inventory_locks SET scope_id = user_id::text WHERE scope_id IS NULL;

ALTER TABLE audit_log       ALTER COLUMN scope_id SET NOT NULL;
ALTER TABLE audit_verifiers ALTER COLUMN scope_id SET NOT NULL;
ALTER TABLE inventory_locks ALTER COLUMN scope_id SET NOT NULL;

-- Drop old user_id unique constraint on inventory_locks and add scope_id one:
ALTER TABLE inventory_locks DROP CONSTRAINT IF EXISTS inventory_locks_user_id_year_key;
ALTER TABLE inventory_locks ADD CONSTRAINT inventory_locks_scope_year_key UNIQUE (scope_id, year);

──────────────────────────────────────────────────────────────────────────────
*/