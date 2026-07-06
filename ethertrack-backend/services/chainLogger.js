'use strict';
/**
 * services/chainLogger.js — EtherTrack v2
 * ─────────────────────────────────────────────────────────────────────────────
 * Updated to call Marketplace.logINRTrade() and Marketplace.batchLogINRTrades()
 * instead of a separate TradeRegistry contract.
 *
 * Your existing Marketplace.sol already handles ETH trades on-chain.
 * This service adds the INR + Razorpay side.
 *
 * ENV VARS NEEDED:
 *   POLYGON_RPC_URL          — e.g. https://rpc-amoy.polygon.technology
 *   CHAIN_SIGNER_PRIVATE_KEY — backend hot wallet private key (needs MATIC)
 *   MARKETPLACE_ADDRESS      — your deployed Marketplace contract address
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { ethers }    = require('ethers');
const { safeQuery } = require('../db/pool');

// ── Marketplace ABI — only the new logging functions we call ─────────────────
const MARKETPLACE_ABI = [
  // Single trade log
  'function logINRTrade(bytes32 tradeId, uint256 tokenId, uint256 quantity, uint256 priceINR, uint8 payMode, address buyer, address seller, uint256 timestamp) external',

  // Batch log (up to 20)
  'function batchLogINRTrades(bytes32[] tradeIds, uint256[] tokenIds, uint256[] quantities, uint256[] pricesINR, uint8[] payModes, address[] buyers, address[] sellers, uint256[] timestamps) external',

  // Public verification
  'function verifyTrade(bytes32 tradeId, uint256 tokenId, uint256 quantity, uint256 priceINR, uint8 payMode, address buyer, address seller, uint256 timestamp) external view returns (bool valid, bytes32 storedHash, uint256 blockLogged, uint8 loggedPayMode)',

  // Get full log entry
  'function getINRTradeLog(bytes32 tradeId) external view returns (tuple(bytes32 tradeId, uint256 tokenId, uint256 quantity, uint256 priceINR, uint8 payMode, address buyer, address seller, uint256 timestamp, bytes32 tradeHash, uint256 blockLogged))',

  // Event we listen for confirmation
  'event INRTradeLogged(bytes32 indexed tradeId, uint256 indexed tokenId, uint256 quantity, uint256 priceINR, uint8 payMode, address indexed buyer, address seller, bytes32 tradeHash, uint256 timestamp)',
];

// ── Payment mode constants (mirror contract) ─────────────────────────────────
const PAY_MODE = {
  inr:              0,
  direct_razorpay:  1,
  eth:              2,
};

// ── Lazy singleton ────────────────────────────────────────────────────────────
let _provider  = null;
let _signer    = null;
let _contract  = null;

function getContract() {
  if (_contract) return _contract;

  const rpcUrl          = process.env.POLYGON_RPC_URL || process.env.ALCHEMY_RPC || 'https://rpc.ankr.com/eth_sepolia/14786f2f0bcbc751c99d71a4f99c7dc8b2d1b4bb10274b7b9c64541b5513c471';
  const signerKey       = process.env.CHAIN_SIGNER_PRIVATE_KEY;
  const contractAddress = process.env.MARKETPLACE_ADDRESS;

  if (!rpcUrl)          throw new Error('POLYGON_RPC_URL not set');
  if (!signerKey)       throw new Error('CHAIN_SIGNER_PRIVATE_KEY not set');
  if (!contractAddress) throw new Error('MARKETPLACE_ADDRESS not set');

  _provider = new ethers.JsonRpcProvider(rpcUrl);
  _signer   = new ethers.Wallet(signerKey, _provider);
  _contract = new ethers.Contract(contractAddress, MARKETPLACE_ABI, _signer);

  return _contract;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function uuidToBytes32(uuid) {
  return ethers.keccak256(ethers.toUtf8Bytes(uuid));
}

function inrToPaise(inrFloat) {
  // Store as paise (integer) to avoid float precision issues on-chain
  return BigInt(Math.round(parseFloat(inrFloat) * 100));
}

// ─────────────────────────────────────────────────────────────────────────────
// logTrade — called from trades.js after DB commit
// ─────────────────────────────────────────────────────────────────────────────
async function logTrade(trade) {
  // ETH trades handled by buyCredit() directly — skip
  if (trade.paymentMode === 'eth') {
    return { skipped: true, reason: 'ETH trade already on-chain via buyCredit()' };
  }

  const payMode = PAY_MODE[trade.paymentMode];
  if (payMode === undefined) throw new Error(`Unknown paymentMode: ${trade.paymentMode}`);

  const tradeId32  = uuidToBytes32(trade.dbTradeId);
  const priceInPaise = inrToPaise(trade.pricePerCreditINR);
  const timestamp  = BigInt(Math.floor((trade.settledAt || new Date()).getTime() / 1000));
  const buyer      = trade.buyerWallet  || ethers.ZeroAddress;
  const seller     = trade.sellerWallet || ethers.ZeroAddress;

  try {
    const contract = getContract();

    // Estimate gas — catches revert (e.g. duplicate) before spending gas
    await contract.logINRTrade.estimateGas(
      tradeId32,
      BigInt(trade.tokenId || 0),
      BigInt(trade.quantity),
      priceInPaise,
      payMode,
      buyer,
      seller,
      timestamp
    );

    // Gas: auto-estimate on Sepolia, fixed on Polygon mainnet
    const isMainnet = (process.env.POLYGON_NETWORK === 'polygon');
    const gasOverrides = isMainnet ? {
      maxPriorityFeePerGas: ethers.parseUnits('30', 'gwei'),
      maxFeePerGas:         ethers.parseUnits('80', 'gwei'),
    } : {}; // Sepolia: let ethers auto-estimate

    const tx = await contract.logINRTrade(
      tradeId32,
      BigInt(trade.tokenId || 0),
      BigInt(trade.quantity),
      priceInPaise,
      payMode,
      buyer,
      seller,
      timestamp,
      gasOverrides
    );

    // Store pending tx hash immediately — don't wait for confirmation
    await safeQuery(
      `UPDATE trades
       SET chain_tx_hash = $1, chain_status = 'pending', chain_logged_at = NOW()
       WHERE id = $2`,
      [tx.hash, trade.dbTradeId]
    ).catch(err => console.error('[chainLogger] DB update failed:', err.message));

    console.log(`[chainLogger] ${trade.paymentMode} trade ${trade.dbTradeId} → tx ${tx.hash}`);

    // Confirm in background — 2 blocks
    tx.wait(2).then(receipt => {
      safeQuery(
        `UPDATE trades
         SET chain_status = 'confirmed', chain_block = $1
         WHERE id = $2`,
        [receipt.blockNumber, trade.dbTradeId]
      ).catch(() => {});
      console.log(`[chainLogger] confirmed block ${receipt.blockNumber} | trade ${trade.dbTradeId}`);
    }).catch(err => {
      console.error('[chainLogger] confirmation error:', err.message);
      _queueRetry(trade);
    });

    return { txHash: tx.hash, queued: false };

  } catch (err) {
    console.error('[chainLogger] logTrade failed:', err.message, { tradeId: trade.dbTradeId });
    await _queueRetry(trade);
    return { txHash: null, queued: true, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// batchLogPending — hourly cron, batches unlogged trades
// ─────────────────────────────────────────────────────────────────────────────
async function batchLogPending() {
  const { rows } = await safeQuery(
    `SELECT id, token_id, quantity, price_per_credit_inr,
            payment_mode, buyer_wallet, seller_wallet, inr_settlement_at
     FROM trades
     WHERE chain_status IS NULL
       AND payment_mode IN ('inr', 'direct_razorpay')
       AND status = 'completed'
       AND created_at > NOW() - INTERVAL '24 hours'
     ORDER BY created_at ASC
     LIMIT 20`
  );

  if (!rows.length) return { batched: 0 };

  const tradeIds   = rows.map(r => uuidToBytes32(r.id));
  const tokenIds   = rows.map(r => BigInt(r.token_id || 0));
  const quantities = rows.map(r => BigInt(r.quantity));
  const pricesINR  = rows.map(r => inrToPaise(r.price_per_credit_inr));
  const payModes   = rows.map(r => PAY_MODE[r.payment_mode] ?? 0);
  const buyers     = rows.map(r => r.buyer_wallet  || ethers.ZeroAddress);
  const sellers    = rows.map(r => r.seller_wallet || ethers.ZeroAddress);
  const timestamps = rows.map(r =>
    BigInt(Math.floor(new Date(r.inr_settlement_at || Date.now()).getTime() / 1000))
  );

  try {
    const isMainnet = (process.env.POLYGON_NETWORK === 'polygon');
    const gasOverrides = isMainnet ? {
      maxPriorityFeePerGas: ethers.parseUnits('30', 'gwei'),
      maxFeePerGas:         ethers.parseUnits('80', 'gwei'),
    } : {};

    const contract = getContract();
    const tx = await contract.batchLogINRTrades(
      tradeIds, tokenIds, quantities, pricesINR,
      payModes, buyers, sellers, timestamps,
      gasOverrides
    );

    const dbIds = rows.map(r => r.id);
    await safeQuery(
      `UPDATE trades
       SET chain_tx_hash = $1, chain_status = 'pending', chain_logged_at = NOW()
       WHERE id = ANY($2::uuid[])`,
      [tx.hash, dbIds]
    );

    console.log(`[chainLogger] batched ${rows.length} trades → tx ${tx.hash}`);
    return { batched: rows.length, txHash: tx.hash };

  } catch (err) {
    console.error('[chainLogger] batchLogPending failed:', err.message);
    return { batched: 0, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// retryPendingLogs — every 5 min cron
// ─────────────────────────────────────────────────────────────────────────────
async function retryPendingLogs() {
  const { rows } = await safeQuery(
    `SELECT cl.id, cl.trade_id, cl.payload, cl.attempts,
            t.token_id, t.quantity, t.price_per_credit_inr,
            t.payment_mode, t.buyer_wallet, t.seller_wallet, t.inr_settlement_at
     FROM pending_chain_logs cl
     JOIN trades t ON t.id = cl.trade_id
     WHERE cl.attempts < 5 AND cl.next_retry_at <= NOW()
     ORDER BY cl.next_retry_at ASC
     LIMIT 10`
  );

  for (const row of rows) {
    try {
      const result = await logTrade({
        dbTradeId:         row.trade_id,
        tokenId:           row.token_id,
        quantity:          row.quantity,
        pricePerCreditINR: row.price_per_credit_inr,
        paymentMode:       row.payment_mode,
        buyerWallet:       row.buyer_wallet,
        sellerWallet:      row.seller_wallet,
        settledAt:         row.inr_settlement_at,
      });

      if (!result.queued) {
        // Success — remove from retry queue
        await safeQuery(`DELETE FROM pending_chain_logs WHERE id = $1`, [row.id]);
      }
    } catch {
      const delay = Math.pow(2, row.attempts + 1) * 60_000; // exponential backoff
      const nextRetry = new Date(Date.now() + delay);
      await safeQuery(
        `UPDATE pending_chain_logs
         SET attempts = attempts + 1, next_retry_at = $1 WHERE id = $2`,
        [nextRetry, row.id]
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// verifyTradeOnChain — called by GET /api/trades/:id/verify
// ─────────────────────────────────────────────────────────────────────────────
async function verifyTradeOnChain({
  dbTradeId, tokenId, quantity, pricePerCreditINR,
  paymentMode, buyerWallet, sellerWallet, settledAt,
}) {
  const contract     = getContract();
  const tradeId32    = uuidToBytes32(dbTradeId);
  const priceInPaise = inrToPaise(pricePerCreditINR);
  const timestamp    = BigInt(Math.floor(new Date(settledAt).getTime() / 1000));
  const buyer        = buyerWallet  || ethers.ZeroAddress;
  const seller       = sellerWallet || ethers.ZeroAddress;
  const payMode      = PAY_MODE[paymentMode] ?? 0;

  const [valid, storedHash, loggedAtBlock, loggedPayMode] = await contract.verifyTrade(
    tradeId32,
    BigInt(tokenId || 0),
    BigInt(quantity),
    priceInPaise,
    payMode,
    buyer,
    seller,
    timestamp
  );

  const networkName  = process.env.POLYGON_NETWORK || 'sepolia';
  const explorerBase = networkName === 'polygon'
    ? 'https://polygonscan.com'
    : networkName === 'amoy'
      ? 'https://amoy.polygonscan.com'
      : 'https://sepolia.etherscan.io';

  return {
    valid,
    storedHash,
    loggedAtBlock:   loggedAtBlock.toString(),
    tradeId32,
    contractAddress: process.env.MARKETPLACE_ADDRESS,
    network:         networkName,
    explorerUrl:     `${explorerBase}/address/${process.env.MARKETPLACE_ADDRESS}`,
    txUrl:           storedHash ? `${explorerBase}/tx/${storedHash}` : null,
    payMode:         loggedPayMode,
  };
}

// ── Internal ──────────────────────────────────────────────────────────────────
async function _queueRetry(trade) {
  await safeQuery(
    `INSERT INTO pending_chain_logs
       (trade_id, payload, attempts, next_retry_at, created_at)
     VALUES ($1, $2, 0, NOW() + INTERVAL '2 minutes', NOW())
     ON CONFLICT (trade_id) DO NOTHING`,
    [trade.dbTradeId, JSON.stringify(trade)]
  ).catch(err => console.error('[chainLogger] _queueRetry failed:', err.message));
}

module.exports = {
  logTrade,
  batchLogPending,
  retryPendingLogs,
  verifyTradeOnChain,
  uuidToBytes32,
  inrToPaise,
  PAY_MODE,
};