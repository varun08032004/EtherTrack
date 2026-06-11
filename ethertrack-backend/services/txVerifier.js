// services/txVerifier.js
// On-chain transaction verification for user-submitted tx data.
//
// FIXES:
//   CRIT — /api/transactions/sync accepted any txHash from any user
//   CRIT — /api/transactions/retirements issued certificates without on-chain check
//
// verifyTrade(txHash, expectedCaller, expectedContract)
//   → confirms the tx exists, targets your contract, and caller matches wallet
//
// verifyRetirement(txHash, tokenId, credits, callerWallet)
//   → confirms a RETIRE event was emitted with matching tokenId + amount

'use strict';

const { ethers } = require('ethers');

// ── Provider with fallback ─────────────────────────────────────────

function getProvider() {
  const primary   = process.env.ALCHEMY_RPC;
  const secondary = process.env.INFURA_RPC || process.env.QUICKNODE_RPC;

  if (!primary) throw new Error('ALCHEMY_RPC env var not set');

  const providers = [new ethers.JsonRpcProvider(primary)];
  if (secondary)  providers.push(new ethers.JsonRpcProvider(secondary));

  // FallbackProvider — tries primary first, falls back automatically
  return providers.length > 1
    ? new ethers.FallbackProvider(providers, 1)
    : providers[0];
}

// ── ABI fragments — only what we need ─────────────────────────────

const MARKETPLACE_IFACE = new ethers.Interface([
  'event CreditTraded(uint256 indexed tradeId, uint256 indexed listingId, uint256 indexed buyOrderId, address buyer, address seller, uint256 tokenId, uint256 amount, uint256 pricePerUnit, uint256 pricePerUnitINR, uint256 totalPrice, uint256 buyerFee, uint256 sellerFee, uint256 totalFee, bool isAMM)',
  'event BuyOrderFilled(uint256 indexed orderId, uint256 amountFilled, uint256 amountRemaining)',
]);

const CREDIT_TOKEN_IFACE = new ethers.Interface([
  // ERC-1155 TransferSingle to zero address = retirement/burn
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
]);

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// ── Core verifier ──────────────────────────────────────────────────

/**
 * Wait for a tx receipt with a timeout.
 */
async function getReceiptWithTimeout(provider, txHash, timeoutMs = 8000) {
  return Promise.race([
    provider.getTransactionReceipt(txHash),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Receipt fetch timed out')), timeoutMs)
    ),
  ]);
}

/**
 * verifyTradeTransaction — confirms a BUY/SELL tx is real and belongs to the caller.
 *
 * @param {string} txHash
 * @param {string} callerWallet   req.user.wallet_address
 * @param {string} txType         'BUY' | 'SELL'
 * @returns {{ valid: boolean, receipt, error?: string }}
 */
async function verifyTradeTransaction(txHash, callerWallet, txType = 'BUY') {
  if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return { valid: false, error: 'Invalid tx hash format' };
  }

  const marketplaceAddr = process.env.MARKETPLACE_ADDRESS?.toLowerCase();
  if (!marketplaceAddr) return { valid: false, error: 'MARKETPLACE_ADDRESS not configured' };

  let provider;
  try { provider = getProvider(); } catch (e) {
    return { valid: false, error: e.message };
  }

  let receipt;
  try {
    receipt = await getReceiptWithTimeout(provider, txHash);
  } catch (e) {
    return { valid: false, error: `Failed to fetch receipt: ${e.message}` };
  }

  if (!receipt) return { valid: false, error: 'Transaction not found on chain' };
  if (receipt.status !== 1) return { valid: false, error: 'Transaction reverted on chain' };

  // The tx must target our marketplace contract
  const tx = await provider.getTransaction(txHash);
  if (!tx) return { valid: false, error: 'Transaction data not found' };

  if (tx.to?.toLowerCase() !== marketplaceAddr) {
    return { valid: false, error: 'Transaction does not target the EtherTrack marketplace contract' };
  }

  // The caller's wallet must match tx.from (prevents replaying someone else's tx)
  if (callerWallet && tx.from.toLowerCase() !== callerWallet.toLowerCase()) {
    return { valid: false, error: 'Transaction sender does not match your wallet address' };
  }

  // Confirm a CreditTraded event was emitted
  const creditTradedTopic = MARKETPLACE_IFACE.getEvent('CreditTraded').topicHash;
  const hasCreditTraded = receipt.logs.some(
    log => log.address.toLowerCase() === marketplaceAddr &&
           log.topics[0] === creditTradedTopic
  );

  if (!hasCreditTraded) {
    return { valid: false, error: 'No CreditTraded event found in transaction logs' };
  }

  return { valid: true, receipt };
}

/**
 * verifyRetirementTransaction — confirms credits were actually burned on-chain.
 *
 * Looks for an ERC-1155 TransferSingle to address(0) with matching tokenId and amount.
 *
 * @param {string} txHash
 * @param {number} tokenId
 * @param {number} credits      Amount retired
 * @param {string} callerWallet
 * @returns {{ valid: boolean, certifiable: boolean, error?: string }}
 */
async function verifyRetirementTransaction(txHash, tokenId, credits, callerWallet) {
  if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return { valid: false, certifiable: false, error: 'Invalid tx hash format' };
  }

  const creditTokenAddr = process.env.CREDIT_TOKEN_ADDRESS?.toLowerCase();
  if (!creditTokenAddr) return { valid: false, certifiable: false, error: 'CREDIT_TOKEN_ADDRESS not configured' };

  let provider;
  try { provider = getProvider(); } catch (e) {
    return { valid: false, certifiable: false, error: e.message };
  }

  let receipt;
  try {
    receipt = await getReceiptWithTimeout(provider, txHash);
  } catch (e) {
    return { valid: false, certifiable: false, error: `Failed to fetch receipt: ${e.message}` };
  }

  if (!receipt) return { valid: false, certifiable: false, error: 'Transaction not found on chain' };
  if (receipt.status !== 1) return { valid: false, certifiable: false, error: 'Transaction reverted' };

  // Find TransferSingle(operator, from, to=0x0, id=tokenId, value=credits)
  const transferTopic = CREDIT_TOKEN_IFACE.getEvent('TransferSingle').topicHash;
  const burnLogs = receipt.logs.filter(
    log => log.address.toLowerCase() === creditTokenAddr &&
           log.topics[0] === transferTopic
  );

  let validBurnFound = false;
  for (const log of burnLogs) {
    try {
      const parsed = CREDIT_TOKEN_IFACE.parseLog(log);
      const toAddr     = parsed.args.to.toLowerCase();
      const logTokenId = Number(parsed.args.id);
      const logAmount  = Number(parsed.args.value);

      if (toAddr === ZERO_ADDRESS &&
          logTokenId === Number(tokenId) &&
          logAmount  === Number(credits)) {
        validBurnFound = true;
        break;
      }
    } catch { continue; }
  }

  if (!validBurnFound) {
    return {
      valid:        false,
      certifiable:  false,
      error:        `No burn event found for tokenId=${tokenId} amount=${credits}. ` +
                    `Ensure the on-chain retirement matches the claimed values.`,
    };
  }

  // Verify caller wallet
  const tx = await provider.getTransaction(txHash);
  if (tx && callerWallet && tx.from.toLowerCase() !== callerWallet.toLowerCase()) {
    return { valid: false, certifiable: false, error: 'Transaction sender does not match your wallet' };
  }

  return { valid: true, certifiable: true, receipt };
}

module.exports = { verifyTradeTransaction, verifyRetirementTransaction };
