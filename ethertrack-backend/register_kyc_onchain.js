require('dotenv').config();
const { ethers } = require('ethers');
const { safeQuery } = require('./db/pool.js');

async function registerKYC() {
  const buyerId = '45aced03-8164-44d8-9f39-c6bb828ba9cd';
  
  const RPC_URL = process.env.ALCHEMY_RPC;
  const MINTER_KEY = process.env.MINTER_PRIVATE_KEY;
  const KYC_REG_ADDRESS = process.env.KYC_REGISTRY_ADDRESS;
  
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const minterWallet = new ethers.Wallet(MINTER_KEY, provider);
  
  const KYC_ABI = [
    'function isKYCVerifiedById(bytes32 userIdHash) view returns (bool)',
    'function verifyKYC(bytes32 userIdHash, bytes32 kycDataHash) external',
    'function kycOperators(address) view returns (bool)',
  ];
  const kycContract = new ethers.Contract(KYC_REG_ADDRESS, KYC_ABI, minterWallet);
  
  const userIdHash = ethers.keccak256(ethers.toUtf8Bytes(buyerId));
  
  // Check if already verified
  const verified = await kycContract.isKYCVerifiedById(userIdHash);
  console.log('Already KYC verified on-chain:', verified);
  
  if (!verified) {
    // Check if minter is operator
    const isOp = await kycContract.kycOperators(minterWallet.address);
    console.log('Minter is KYC operator:', isOp);
    
    if (isOp) {
      // Get kyc_data_hash from DB
      const { rows } = await safeQuery('SELECT kyc_data_hash FROM users WHERE id = $1', [buyerId]);
      const kycDataHash = rows[0]?.kyc_data_hash || ethers.keccak256(ethers.toUtf8Bytes('kyc-approved'));
      console.log('Using kycDataHash:', kycDataHash);
      
      // Register KYC
      const tx = await kycContract.verifyKYC(userIdHash, kycDataHash);
      const receipt = await tx.wait();
      console.log('✅ KYC registered on-chain:', tx.hash, 'block:', receipt.blockNumber);
    } else {
      console.log('❌ Minter is not KYC operator - need to call addKYCOperator on KYCRegistry');
    }
  }
  
  process.exit(0);
}

registerKYC().catch(console.error).finally(() => process.exit(1));