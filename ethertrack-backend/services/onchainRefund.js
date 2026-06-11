// services/onchainRefund.js — On-chain ETH refund for cancelled buy orders
// Call this from admin route after DB cancel to actually release escrowed ETH

const { ethers } = require('ethers');

// Minimal ABI — only the cancelBuyOrder function
const MARKETPLACE_ABI = [
  'function cancelBuyOrder(uint256 orderId) external',
  'function getBuyOrder(uint256 orderId) external view returns (address buyer, uint256 tokenId, uint256 amount, uint256 amountFilled, uint256 limitPriceInr, uint256 ethEscrowed, uint8 status)',
  'event BuyOrderCancelled(uint256 indexed orderId, address indexed buyer, uint256 ethRefunded)',
];

const getProvider = () => new ethers.JsonRpcProvider(process.env.ALCHEMY_RPC);
const getAdminWallet = (provider) => new ethers.Wallet(process.env.MINTER_PRIVATE_KEY, provider);
const getMarketplace = (provider) => new ethers.Contract(process.env.MARKETPLACE_ADDRESS, MARKETPLACE_ABI, getAdminWallet(provider));

/**
 * Cancel a buy order on-chain and trigger ETH refund to buyer wallet.
 * @param {number|string} orderId - The on-chain order ID
 * @returns {object} { txHash, ethRefunded, gasUsed }
 */
const cancelBuyOrderOnChain = async (orderId) => {
  const provider = getProvider();
  const marketplace = getMarketplace(provider);

  // Verify order exists and is still open on-chain
  let onChainOrder;
  try {
    onChainOrder = await marketplace.getBuyOrder(orderId);
  } catch (e) {
    throw new Error(`Order #${orderId} not found on-chain: ${e.message}`);
  }

  const statusMap = { 0: 'open', 1: 'filled', 2: 'cancelled' };
  const currentStatus = statusMap[Number(onChainOrder.status)] || 'unknown';
  if (currentStatus === 'cancelled') throw new Error(`Order #${orderId} already cancelled on-chain`);
  if (currentStatus === 'filled')    throw new Error(`Order #${orderId} already filled on-chain — cannot cancel`);

  const ethEscrowed = ethers.formatEther(onChainOrder.ethEscrowed);

  // Estimate gas
  const gasEstimate = await marketplace.cancelBuyOrder.estimateGas(orderId);
  const gasLimit = gasEstimate * 130n / 100n; // 30% buffer

  // Send TX
  const tx = await marketplace.cancelBuyOrder(orderId, { gasLimit });
  const receipt = await tx.wait();

  return {
    txHash: receipt.hash,
    ethRefunded: ethEscrowed,
    gasUsed: receipt.gasUsed.toString(),
    blockNumber: receipt.blockNumber,
  };
};

/**
 * Check if an order is still open on-chain (before attempting cancel)
 */
const getBuyOrderOnChainStatus = async (orderId) => {
  try {
    const provider = getProvider();
    const marketplace = getMarketplace(provider);
    const order = await marketplace.getBuyOrder(orderId);
    const statusMap = { 0: 'open', 1: 'filled', 2: 'cancelled' };
    return {
      exists: true,
      status: statusMap[Number(order.status)] || 'unknown',
      buyer: order.buyer,
      ethEscrowed: ethers.formatEther(order.ethEscrowed),
      amount: order.amount.toString(),
      amountFilled: order.amountFilled.toString(),
    };
  } catch (e) {
    return { exists: false, error: e.message };
  }
};

module.exports = { cancelBuyOrderOnChain, getBuyOrderOnChainStatus };