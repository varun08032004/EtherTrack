// services/creditLedger.js
// ─────────────────────────────────────────────────────────────────────────────
// Wraps CreditLedger.sol — the wallet-free, pooled-custody audit trail. Used
// for any user who hasn't linked a personal wallet: their credit ownership
// lives entirely in the DB + this on-chain ledger, never as a personal
// ERC-1155 balance. Mirrors services/minter.js's connection/error-handling
// pattern for consistency.
// ─────────────────────────────────────────────────────────────────────────────

const { ethers } = require('ethers');
const { safeQuery: query } = require('../db/pool');

const RPC_URL             = process.env.ALCHEMY_RPC;
const MINTER_KEY           = process.env.MINTER_PRIVATE_KEY;
const CREDIT_LEDGER_ADDRESS = process.env.CREDIT_LEDGER_ADDRESS;

const LEDGER_ABI = [
  'function logOwnershipChange(bytes32 userId, uint256 tokenId, int256 amountDelta, uint8 actionType, bytes32 refHash, string calldata note) external returns (uint256 logId)',
  'function logRetirement(bytes32 userId, uint256 tokenId, uint256 amount, bytes32 refHash) external returns (uint256 logId)',
  'function getUserBalance(bytes32 userId, uint256 tokenId) view returns (uint256)',
  'function getUserRetired(bytes32 userId, uint256 tokenId) view returns (uint256)',
  'function computeUserId(string calldata userUuid) view returns (bytes32)',
  'event OwnershipLogged(uint256 indexed logId, bytes32 indexed userId, uint256 indexed tokenId, int256 amountDelta, uint8 actionType, bytes32 refHash)',
  'event CreditRetiredLogged(uint256 indexed logId, bytes32 indexed userId, uint256 tokenId, uint256 amount, bytes32 refHash)',
];

// Must match CreditLedger.sol's `enum ActionType { MINT, LIST, DELIST, BUY, SELL, RETIRE, WITHDRAW_TO_WALLET }`
const ACTION_TYPE = { MINT: 0, LIST: 1, DELIST: 2, BUY: 3, SELL: 4, RETIRE: 5, WITHDRAW_TO_WALLET: 6 };

const getLedgerContract = () => {
  if (!RPC_URL || !MINTER_KEY || !CREDIT_LEDGER_ADDRESS) {
    throw new Error('CreditLedger not configured — missing ALCHEMY_RPC, MINTER_PRIVATE_KEY, or CREDIT_LEDGER_ADDRESS');
  }
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet   = new ethers.Wallet(MINTER_KEY, provider);
  return new ethers.Contract(CREDIT_LEDGER_ADDRESS, LEDGER_ABI, wallet);
};

/** Deterministic, permanent per-user identifier — NOT a wallet. Computed
 *  once per user, stored in users.user_id_hash, reused forever. */
const computeUserIdHash = (userUuid) => ethers.keccak256(ethers.toUtf8Bytes(userUuid));

/** Fetch (and lazily backfill) a user's ledger identifier. */
const getOrCreateUserIdHash = async (userId) => {
  const { rows } = await query('SELECT user_id_hash FROM users WHERE id = $1', [userId]);
  if (rows[0]?.user_id_hash) return rows[0].user_id_hash;

  const hash = computeUserIdHash(userId);
  await query('UPDATE users SET user_id_hash = $1 WHERE id = $2', [hash, userId]);
  return hash;
};

/** Canonical hash of a ledger entry's core fields — lets anyone
 *  independently verify a DB row matches what's on-chain, same pattern as
 *  Marketplace.sol's inrTradeHashes. */
const computeRefHash = (userIdHash, tokenId, amountDelta, actionType, refTable, refId) =>
  ethers.keccak256(ethers.toUtf8Bytes(
    `${userIdHash}:${tokenId}:${amountDelta}:${actionType}:${refTable || ''}:${refId || ''}`
  ));

/**
 * Logs an ownership change (mint/list/delist/buy/sell) for a wallet-free
 * user, updates the DB balance cache, and returns the on-chain tx info.
 * Does NOT move any real tokens — pooled custody never changes here.
 */
const logOwnershipChangeOnChain = async ({
  userId, tokenId, amountDelta, actionType, refTable, refId, note = '',
}) => {
  if (!ACTION_TYPE.hasOwnProperty(actionType) || actionType === 'RETIRE') {
    throw new Error(`Invalid actionType for logOwnershipChange: ${actionType} (use logRetirementOnChain for RETIRE)`);
  }

  const userIdHash = await getOrCreateUserIdHash(userId);
  const refHash     = computeRefHash(userIdHash, tokenId, amountDelta, actionType, refTable, refId);

  const ledger = getLedgerContract();
  console.log(`📒 Logging ${actionType} for user ${userId} — token ${tokenId}, delta ${amountDelta}...`);

  const tx = await ledger.logOwnershipChange(
    userIdHash, tokenId, amountDelta, ACTION_TYPE[actionType], refHash, note
  );
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error(`logOwnershipChange reverted — tx: ${tx.hash}`);

  let onchainLogId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = ledger.interface.parseLog(log);
      if (parsed?.name === 'OwnershipLogged') { onchainLogId = Number(parsed.args.logId); break; }
    } catch { /* not our event */ }
  }

  // Update DB records — entry + balance cache
  await query(
    `INSERT INTO credit_ledger_entries
       (onchain_log_id, user_id, user_id_hash, token_id, amount_delta, action_type,
        ref_hash, ref_table, ref_id, note, tx_hash, block_number, chain_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'confirmed')`,
    [onchainLogId, userId, userIdHash, tokenId, amountDelta, actionType,
     refHash, refTable || null, refId || null, note, tx.hash, receipt.blockNumber]
  );

  await query(
    `INSERT INTO credit_ledger_balances (user_id, token_id, balance)
     VALUES ($1, $2, GREATEST($3, 0))
     ON CONFLICT (user_id, token_id)
     DO UPDATE SET balance = GREATEST(credit_ledger_balances.balance + $3, 0), updated_at = NOW()`,
    [userId, tokenId, amountDelta]
  );

  console.log(`   ✅ Logged on-chain — block ${receipt.blockNumber}, tx: ${tx.hash}`);
  return { txHash: tx.hash, blockNumber: receipt.blockNumber, onchainLogId, userIdHash };
};

/**
 * Logs a retirement for a wallet-free user — permanently reduces their
 * ledger balance, records via the dedicated retirement event/mapping.
 */
const logRetirementOnChain = async ({ userId, tokenId, amount, refTable, refId }) => {
  const userIdHash = await getOrCreateUserIdHash(userId);
  const refHash     = computeRefHash(userIdHash, tokenId, -amount, 'RETIRE', refTable, refId);

  const ledger = getLedgerContract();
  console.log(`🔥 Logging retirement for user ${userId} — token ${tokenId}, amount ${amount}...`);

  const tx = await ledger.logRetirement(userIdHash, tokenId, amount, refHash);
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error(`logRetirement reverted — tx: ${tx.hash}`);

  let onchainLogId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = ledger.interface.parseLog(log);
      if (parsed?.name === 'CreditRetiredLogged') { onchainLogId = Number(parsed.args.logId); break; }
    } catch { /* not our event */ }
  }

  await query(
    `INSERT INTO credit_ledger_entries
       (onchain_log_id, user_id, user_id_hash, token_id, amount_delta, action_type,
        ref_hash, ref_table, ref_id, tx_hash, block_number, chain_status)
     VALUES ($1,$2,$3,$4,$5,'RETIRE',$6,$7,$8,$9,$10,'confirmed')`,
    [onchainLogId, userId, userIdHash, tokenId, -amount,
     refHash, refTable || null, refId || null, tx.hash, receipt.blockNumber]
  );

  await query(
    `INSERT INTO credit_ledger_balances (user_id, token_id, balance, total_retired)
     VALUES ($1, $2, 0, $3)
     ON CONFLICT (user_id, token_id)
     DO UPDATE SET
       balance       = GREATEST(credit_ledger_balances.balance - $3, 0),
       total_retired = credit_ledger_balances.total_retired + $3,
       updated_at    = NOW()`,
    [userId, tokenId, amount]
  );

  console.log(`   ✅ Retirement logged on-chain — block ${receipt.blockNumber}, tx: ${tx.hash}`);
  return { txHash: tx.hash, blockNumber: receipt.blockNumber, onchainLogId, userIdHash };
};

/** Read a user's DB-cached ledger balance for a token (fast path — no chain call). */
const getLedgerBalance = async (userId, tokenId) => {
  const { rows } = await query(
    'SELECT balance, total_retired FROM credit_ledger_balances WHERE user_id = $1 AND token_id = $2',
    [userId, tokenId]
  );
  return rows[0] || { balance: 0, total_retired: 0 };
};

/** Reconciliation check — compares DB balance against the real on-chain
 *  value. Should always match; a scheduled job should call this
 *  periodically and alert on mismatch. */
const verifyLedgerBalance = async (userId, tokenId) => {
  const userIdHash = await getOrCreateUserIdHash(userId);
  const ledger = getLedgerContract();
  const onChainBalance = await ledger.getUserBalance(userIdHash, tokenId);
  const dbBalance = await getLedgerBalance(userId, tokenId);
  return {
    matches: Number(onChainBalance) === Number(dbBalance.balance),
    onChain: Number(onChainBalance),
    db: Number(dbBalance.balance),
  };
};

/**
 * Transfers ownership between two wallet-free (ledger) users — e.g. a sale
 * between a ledger seller and a ledger buyer. Executes as two on-chain log
 * entries (SELL debit on seller, BUY credit on buyer) rather than a single
 * atomic contract call — CreditLedger.sol doesn't have a combined transfer
 * function yet. Not atomic on-chain (two separate transactions), but each
 * individually is a real, immutable log entry; if the second call fails
 * after the first succeeds, the mismatch is caught by verifyLedgerBalance()
 * and needs manual reconciliation — same operational discipline as any
 * two-phase ledger operation.
 */
const transferLedgerOwnership = async ({
  sellerId, buyerId, tokenId, amount, refTable, refId, note = '',
}) => {
  const sellerResult = await logOwnershipChangeOnChain({
    userId: sellerId, tokenId, amountDelta: -amount, actionType: 'SELL',
    refTable, refId, note,
  });

  try {
    const buyerResult = await logOwnershipChangeOnChain({
      userId: buyerId, tokenId, amountDelta: amount, actionType: 'BUY',
      refTable, refId, note,
    });
    return { sellerResult, buyerResult };
  } catch (buyerErr) {
    // Seller's debit already succeeded on-chain and cannot be undone — this
    // is exactly the scenario verifyLedgerBalance()/the reconciliation cron
    // exists to catch. Surface it loudly rather than pretending it's fine.
    console.error(
      `[transferLedgerOwnership] CRITICAL: seller debit succeeded (tx ${sellerResult.txHash}) ` +
      `but buyer credit failed: ${buyerErr.message}. Needs manual reconciliation for ` +
      `seller=${sellerId} buyer=${buyerId} tokenId=${tokenId} amount=${amount}`
    );
    throw new Error(`Transfer partially failed — seller debited but buyer not credited. TX: ${sellerResult.txHash}. Contact support.`);
  }
};

/**

/**
 * Reconciliation cron — compares all DB cached balances against on-chain values.
 * Should be run periodically (e.g., hourly) to detect drift from partial failures,
 * manual contract interactions, or indexing gaps.
 * 
 * @returns {Promise<Array>} Array of mismatches found
 */
const reconcileAllBalances = async () => {
  const { rows } = await query(
    `SELECT user_id, token_id, balance, total_retired
     FROM credit_ledger_balances
     WHERE balance > 0 OR total_retired > 0`
  );

  const mismatches = [];

  for (const row of rows) {
    try {
      const result = await verifyLedgerBalance(row.user_id, row.token_id);
      if (!result.matches) {
        mismatches.push({
          userId: row.user_id,
          tokenId: row.token_id,
          dbBalance: row.balance,
          dbRetired: row.total_retired,
          onChainBalance: result.onChain,
          onChainRetired: result.onChainRetired,
          severity: 'P1',
        });
        console.error(`[creditLedger/reconcile] MISMATCH user=${row.user_id} token=${row.token_id} DB=${row.balance} ONCHAIN=${result.onChain}`);
      }
    } catch (e) {
      console.error(`[creditLedger/reconcile] Error checking user=${row.user_id} token=${row.token_id}:`, e.message);
      mismatches.push({
        userId: row.user_id,
        tokenId: row.token_id,
        error: e.message,
        severity: 'P2',
      });
    }
  }

  if (mismatches.length > 0) {
    // Alert via Sentry
    const Sentry = require('@sentry/node');
    Sentry.captureMessage(`CreditLedger reconciliation found ${mismatches.length} mismatches`, 'warning');
  }

  return mismatches;
};

module.exports = {
  computeUserIdHash,
  getOrCreateUserIdHash,
  logOwnershipChangeOnChain,
  logRetirementOnChain,
  transferLedgerOwnership,
  getLedgerBalance,
  verifyLedgerBalance,
  reconcileAllBalances,
  ACTION_TYPE,
};