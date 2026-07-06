// routes/audit.js — GHG Audit Trail, Blockchain-anchored (Sepolia) v4
// [FEAT-LEDGER-CHAIN] Added GET /chain and POST /chain for GHGLedger.jsx
//                     Uses ghg_ledger_chain table (lightweight per-user chain)
//                     separate from ghg_audit_log (Sepolia-anchored full trail).

'use strict';

const router  = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate }     = require('../middleware/auth');
const crypto  = require('crypto');
const ethers  = require('ethers');
const path    = require('path');
const multer  = require('multer');

const CHAIN_CONFIG = {
  name:        'sepolia',
  chainId:     11155111,
  rpcUrl:      process.env.SEPOLIA_RPC_URL || process.env.ALCHEMY_RPC || 'https://rpc.sepolia.org',
  explorerTx:  'https://sepolia.etherscan.io/tx',
  explorerAddr:'https://sepolia.etherscan.io/address',
  symbol:      'ETH',
};

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

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx', '.xlsx', '.png', '.jpg', '.jpeg'];
    const ext     = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`File type ${ext} not allowed`));
  },
});

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
  if (msg.includes('insufficient funds'))  return 'Relayer wallet has insufficient ETH';
  if (msg.includes('nonce too low'))       return 'Transaction nonce conflict — will retry';
  if (msg.includes('network') || msg.includes('ECONNREFUSED') || msg.includes('timeout'))
    return `${CHAIN_CONFIG.name} RPC unreachable`;
  if (msg.includes('Inventory locked'))    return 'Inventory is locked on-chain';
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

const resolveScope = async (userId) => {
  const { rows } = await query(
    `SELECT org_id FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  const orgId   = rows[0]?.org_id || null;
  const scopeId = orgId || userId;
  return { orgId, scopeId };
};

const getPrevHash = async (scopeId, year) => {
  const { rows } = await query(
    `SELECT hash FROM ghg_audit_log
     WHERE scope_id = $1 AND year = $2
     ORDER BY created_at DESC LIMIT 1`,
    [scopeId, year]
  );
  return rows[0]?.hash || '0'.repeat(64);
};

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

  const { rows } = await query(
    `INSERT INTO ghg_audit_log
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

// ── GET /api/audit/log (and /logs alias) ─────────────────────────────────
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
         FROM ghg_audit_log
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
      lockTxHash:   lockTx || null,
      lockExplorer: lockTx ? `${CHAIN_CONFIG.explorerTx}/${lockTx}` : null,
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
router.get('/logs', authenticate, getLogHandler);

// ── POST /api/audit/log ───────────────────────────────────────────────────
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
      message:     'Entry logged',
      entry,
      onChain:     entry.chain_status === 'confirmed',
      explorerUrl: entry.explorerUrl || null,
    });
  } catch (err) {
    dbErr(res, 'Log audit entry', err);
  }
});

// ── GET /api/audit/chain ──────────────────────────────────────────────────
// Lightweight per-user ledger chain (ghg_ledger_chain table).
// Used by GHGLedger.jsx Chain Log panel.
router.get('/chain', authenticate, async (req, res) => {
  const year  = safeYear(req.query.year, new Date().getFullYear());
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

  if (req.query.year !== undefined && year === null)
    return res.status(400).json({ error: 'Invalid year — must be 2000–2100' });

  try {
    const { scopeId } = await resolveScope(req.user.id);

    const { rows } = await query(
      `SELECT id, action, record_count, record_ids, activities,
              co2e_delta, actor, hash, prev_hash, created_at
       FROM ghg_ledger_chain
       WHERE scope_id = $1 AND year = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [scopeId, year, limit]
    );

    const entries = rows.map(r => ({
      id:          r.id,
      action:      r.action,
      recordCount: r.record_count,
      recordIds:   r.record_ids   || [],
      activities:  r.activities   || [],
      co2eDelta:   parseFloat(r.co2e_delta || 0),
      actor:       r.actor,
      hash:        r.hash,
      prevHash:    r.prev_hash,
      timestamp:   r.created_at,
    }));

    res.json({ entries, count: entries.length, year });
  } catch (err) {
    dbErr(res, 'Fetch ledger chain', err);
  }
});

// ── POST /api/audit/chain ─────────────────────────────────────────────────
// Writes a new entry to ghg_ledger_chain after every add/delete in GHGLedger.
router.post('/chain', authenticate, async (req, res) => {
  const { action, year: yearRaw, actor, recordIds, activities, co2eDelta, recordCount } = req.body;

  const year = safeYear(yearRaw, new Date().getFullYear());

  if (!['add', 'delete'].includes(action))
    return res.status(400).json({ error: "action must be 'add' or 'delete'" });
  if (yearRaw !== undefined && year === null)
    return res.status(400).json({ error: 'Invalid year — must be 2000–2100' });
  if (!Array.isArray(recordIds) || recordIds.length === 0)
    return res.status(400).json({ error: 'recordIds must be a non-empty array' });

  const cleanActor      = sanitiseText(actor || req.user.email || String(req.user.id), 200);
  const cleanActivities = (Array.isArray(activities) ? activities : []).map(a => sanitiseText(a, 200));
  const cleanCo2e       = parseFloat(co2eDelta) || 0;
  const cleanCount      = parseInt(recordCount, 10) || recordIds.length;
  const ts              = new Date().toISOString();

  try {
    const { scopeId } = await resolveScope(req.user.id);

    // Get prev hash for chain linking
    const { rows: prev } = await query(
      `SELECT hash FROM ghg_ledger_chain
       WHERE scope_id = $1 AND year = $2
       ORDER BY created_at DESC LIMIT 1`,
      [scopeId, year]
    );
    const prevHash = prev[0]?.hash || '0'.repeat(64);

    // SHA-256 hash this entry
    const hash = sha256(JSON.stringify({
      userId: req.user.id, scopeId, year, action,
      recordIds, activities: cleanActivities,
      co2eDelta: cleanCo2e, actor: cleanActor, ts, prevHash,
    }));

    const { rows } = await query(
      `INSERT INTO ghg_ledger_chain
         (user_id, scope_id, year, action, record_count, record_ids,
          activities, co2e_delta, actor, hash, prev_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        req.user.id, scopeId, year, action,
        cleanCount, recordIds, cleanActivities,
        cleanCo2e, cleanActor, hash, prevHash, ts,
      ]
    );

    const entry = rows[0];

    // Also write to full ghg_audit_log (non-blocking — fires and forgets)
    insertAuditEntry(
      req.user.id, year,
      action === 'add' ? 'CREATE' : 'DELETE',
      action === 'add'
        ? `${cleanCount} emission record${cleanCount !== 1 ? 's' : ''} added — ${cleanCo2e.toFixed(3)} tCO₂e`
        : `${cleanCount} emission record${cleanCount !== 1 ? 's' : ''} deleted — ${cleanCo2e.toFixed(3)} tCO₂e removed`,
      { record_ids: recordIds, activities: cleanActivities, co2e_delta: cleanCo2e, ledger_hash: hash }
    ).catch(err => {
      console.warn('[Audit] Full audit log write failed after chain entry:', err?.message);
    });

    res.status(201).json({
      message: 'Chain entry recorded',
      entry: {
        id:          entry.id,
        action:      entry.action,
        recordCount: entry.record_count,
        recordIds:   entry.record_ids   || [],
        activities:  entry.activities   || [],
        co2eDelta:   parseFloat(entry.co2e_delta || 0),
        actor:       entry.actor,
        hash:        entry.hash,
        prevHash:    entry.prev_hash,
        timestamp:   entry.created_at,
      },
    });
  } catch (err) {
    dbErr(res, 'Write ledger chain entry', err);
  }
});

// ── POST /api/audit/retry-chain/:id ──────────────────────────────────────
router.post('/retry-chain/:id', authenticate, async (req, res) => {
  try {
    const { scopeId } = await resolveScope(req.user.id);
    const { rows }    = await query(
      `SELECT * FROM ghg_audit_log WHERE id = $1 AND scope_id = $2`,
      [req.params.id, scopeId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Entry not found' });

    const entry = rows[0];
    if (entry.chain_status === 'confirmed')
      return res.json({ message: 'Already confirmed on-chain', entry });
    if (!chainReady)
      return res.status(503).json({ error: 'Blockchain not available' });

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
      `UPDATE ghg_audit_log SET
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
      `UPDATE ghg_audit_log SET chain_error = $2 WHERE id = $1`,
      [req.params.id, chainError]
    ).catch(() => {});
    dbErr(res, chainError, err);
  }
});

// ── GET /api/audit/verifiers ──────────────────────────────────────────────
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

// ── POST /api/audit/verifiers ─────────────────────────────────────────────
router.post('/verifiers', authenticate, async (req, res) => {
  const year = safeYear(req.body.year, new Date().getFullYear());
  if (req.body.year !== undefined && safeYear(req.body.year) === null)
    return res.status(400).json({ error: 'Invalid year — must be 2000–2100' });

  const verifier_name   = sanitiseText(req.body.verifier_name   || '', 200);
  const verifier_org    = sanitiseText(req.body.verifier_org    || '', 200);
  const verifier_email  = sanitiseText(req.body.verifier_email  || '', 200).toLowerCase();
  const assurance_level = req.body.assurance_level || 'limited';
  const scope           = sanitiseText(req.body.scope           || '1+2+3', 20);
  const engagement_ref  = sanitiseText(req.body.engagement_ref  || '', 100);
  const notes           = sanitiseText(req.body.notes           || '', 500);

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
        assurance_level, scope, engagement_ref || null, notes || null,
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

// ── PATCH /api/audit/verifiers/:id ───────────────────────────────────────
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
        status            || null,
        verification_ref  ? sanitiseText(verification_ref, 100) : null,
        verification_date || null,
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

// ── DELETE /api/audit/verifiers/:id ──────────────────────────────────────
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

// ── POST /api/audit/lock ──────────────────────────────────────────────────
router.post('/lock', authenticate, async (req, res) => {
  const year = safeYear(req.body.year, new Date().getFullYear());
  if (req.body.year !== undefined && safeYear(req.body.year) === null)
    return res.status(400).json({ error: 'Invalid year — must be 2000–2100' });

  let chainTxHash    = null;
  let chainExplorer  = null;
  let chainLockError = null;

  if (chainReady) {
    try {
      const { scopeId } = await resolveScope(req.user.id);
      const tx          = await contract.lockInventory(String(scopeId), year, { gasLimit: 100_000 });
      const receipt     = await tx.wait(1);
      chainTxHash       = receipt.hash;
      chainExplorer     = `${CHAIN_CONFIG.explorerTx}/${chainTxHash}`;
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

// ── GET /api/audit/verify-chain ───────────────────────────────────────────
router.get('/verify-chain', authenticate, async (req, res) => {
  const year = safeYear(req.query.year, new Date().getFullYear());
  if (req.query.year !== undefined && safeYear(req.query.year) === null)
    return res.status(400).json({ error: 'Invalid year — must be 2000–2100' });

  try {
    const { scopeId } = await resolveScope(req.user.id);

    const { rows } = await query(
      `SELECT id, hash, prev_hash, action, created_at, chain_status, tx_hash
       FROM ghg_audit_log
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

// ── GET /api/audit/chain-status ───────────────────────────────────────────
router.get('/chain-status', authenticate, async (req, res) => {
  if (!chainReady) {
    return res.json({
      ready:  false,
      reason: !process.env.RELAYER_PRIVATE_KEY
        ? 'RELAYER_PRIVATE_KEY not configured'
        : !process.env.AUDIT_CONTRACT_ADDRESS
        ? 'AUDIT_CONTRACT_ADDRESS not configured'
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

// ── GET /api/audit/statements ─────────────────────────────────────────────
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

// ── POST /api/audit/statements ────────────────────────────────────────────
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

module.exports = router;
module.exports.insertAuditEntry = insertAuditEntry;
module.exports.resolveScope     = resolveScope;