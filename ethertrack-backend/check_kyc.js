require('dotenv').config();
const { safeQuery } = require('./db/pool.js');
const { ethers } = require('ethers');

async function check() {
  const userId = '45aced03-8164-44d8-9f39-c6bb828ba9cd';
  const tokenId = 3;
  
  const RPC_URL = process.env.ALCHEMY_RPC;
  const CUSTODY_KEY = process.env.MINTER_PRIVATE_KEY;
  const CREDIT_LEDGER_ADDRESS = process.env.CREDIT_LEDGER_ADDRESS;
  
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(CUSTODY_KEY, provider);
  
  const LEDGER_ABI = [
    'function getUserBalance(bytes32 userId, uint256 tokenId) view returns (uint256)',
    'function computeUserId(string calldata userUuid) view returns (bytes32)',
    'function isKYCVerifiedById(bytes32 userIdHash) view returns (bool)',
  ];
  const ledger = new ethers.Contract(CREDIT_LEDGER_ADDRESS, LEDGER_ABI, wallet);
  
  const userIdHash = ethers.keccak256(ethers.toUtf8Bytes(userId));
  
  // Check on-chain balance
  const bal = await ledger.getUserBalance(userIdHash, tokenId);
  console.log('On-chain balance for buyer:', bal.toString());
  
  // Check KYC
  const kyc = await ledger.isKYCVerifiedById(userIdHash);
  console.log('KYC verified:', kyc);
  
  // Check seller balance
  const sellerId = '706c67a4-de98-4a9a-9287-bed77d33b1a4';
  const sellerHash = ethers.keccak256(ethers.toUtf8Bytes(sellerId));
  const sellerBal = await ledger.getUserBalance(sellerHash, tokenId);
  console.log('On-chain balance for seller:', sellerBal.toString());
  
  process.exit(0);
}

check().catch(console.error).finally(() => process.exit(1));