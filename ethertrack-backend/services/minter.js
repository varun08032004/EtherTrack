// services/minter.js — EtherTrack backend auto-mint service
const { ethers } = require('ethers');
const { safeQuery: query } = require('../db/pool');

const RPC_URL         = process.env.ALCHEMY_RPC;
const MINTER_KEY      = process.env.MINTER_PRIVATE_KEY;
const TOKEN_ADDRESS   = process.env.CARBON_CREDIT_TOKEN_ADDRESS;
const KYC_REG_ADDRESS = process.env.KYC_REGISTRY_ADDRESS;

// ── ABIs ──────────────────────────────────────────────────────────
const TOKEN_ABI = [
  'function mintCredit((address to,uint256 amount,string projectName,string location,uint8 standard,string projectType,string developer,uint256 vintageYear,uint256 expiryDate,string serialNumber,string metadataURI) p) returns (uint256)',
  'function serialRegistered(string) view returns (bool)',
  'event CreditMinted(uint256 indexed tokenId, address indexed to, uint256 amount, string projectName, uint8 standard, string serialNumber)',
];

const KYC_ABI = [
  'function isKYCVerified(address wallet) view returns (bool)',
  'function verifyKYC(address wallet, bytes32 kycDataHash) external',
  'function kycOperators(address) view returns (bool)',
];

const STANDARD_ENUM = { VCS: 0, GS: 1, CDM: 2, ACR: 3, BEE: 0 };

const normaliseProjectType = (pt) => {
  const map = {
    Renewable:   'Renewable',
    Forestry:    'Forestry',
    Methane:     'Methane',
    Efficiency:  'Efficiency',
    Ocean:       'Ocean',
    Agriculture: 'Agriculture',
  };
  if (map[pt]) return map[pt];
  for (const [k, v] of Object.entries(map)) {
    if (pt?.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return 'Renewable';
};

// ── Build provider + contracts ────────────────────────────────────
const getContracts = () => {
  if (!RPC_URL)       throw new Error('ALCHEMY_RPC not set in .env');
  if (!MINTER_KEY)    throw new Error('MINTER_PRIVATE_KEY not set in .env');
  if (!TOKEN_ADDRESS) throw new Error('CARBON_CREDIT_TOKEN_ADDRESS not set in .env');

  const provider      = new ethers.JsonRpcProvider(RPC_URL);
  const minterWallet  = new ethers.Wallet(MINTER_KEY, provider);
  const tokenContract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, minterWallet);

  // kycContract uses minterWallet as signer so it can call verifyKYC()
  const kycContract = KYC_REG_ADDRESS
    ? new ethers.Contract(KYC_REG_ADDRESS, KYC_ABI, minterWallet)
    : null;

  return { provider, minterWallet, tokenContract, kycContract };
};

// ── Check on-chain KYC status ─────────────────────────────────────
const isWalletKYCVerified = async (kycContract, walletAddress) => {
  if (!kycContract || !walletAddress) return false;
  try {
    return await kycContract.isKYCVerified(walletAddress);
  } catch (e) {
    console.warn('KYC on-chain check failed:', e.message);
    return false;
  }
};

// ── Register user wallet as KYC verified on-chain ─────────────────
const verifyKYCOnChain = async (walletAddress, kycDataHash) => {
  if (!walletAddress) throw new Error('No wallet address — user has not connected MetaMask');

  const { kycContract, minterWallet } = getContracts();
  if (!kycContract) throw new Error('KYC_REGISTRY_ADDRESS not set in .env');

  // Skip if already verified
  const alreadyVerified = await isWalletKYCVerified(kycContract, walletAddress);
  if (alreadyVerified) {
    console.log(`ℹ️  Wallet ${walletAddress} already KYC verified on-chain — skipping`);
    return { skipped: true };
  }

  // Check minter is a KYC operator
  try {
    const isOperator = await kycContract.kycOperators(minterWallet.address);
    if (!isOperator) {
      throw new Error(
        `Minter wallet ${minterWallet.address} is not a KYC operator. ` +
        `Call addKYCOperator(${minterWallet.address}) on the KYCRegistry contract as owner.`
      );
    }
  } catch (e) {
    if (e.message.includes('not a KYC operator')) throw e;
    console.warn('Could not check operator status:', e.message);
  }

  // Build kycDataHash bytes32
  let hashBytes32;
  try {
    hashBytes32 = kycDataHash && kycDataHash.startsWith('0x')
      ? kycDataHash.padEnd(66, '0').slice(0, 66)
      : ethers.keccak256(ethers.toUtf8Bytes(kycDataHash || 'kyc-approved'));
  } catch {
    hashBytes32 = ethers.ZeroHash;
  }

  console.log(`⛓  Registering KYC on-chain for wallet ${walletAddress}...`);

  const tx      = await kycContract.verifyKYC(walletAddress, hashBytes32);
  const receipt = await tx.wait(1);

  console.log(`   ✅ KYC registered on-chain in block ${receipt.blockNumber} (${tx.hash})`);

  return { txHash: tx.hash, blockNumber: receipt.blockNumber };
};

// ── Core mint function ────────────────────────────────────────────
const mintApprovedCredit = async (batchId) => {
  // 1. Fetch batch + user from DB
  const { rows } = await query(
    `SELECT cb.*, u.wallet_address, u.email, u.full_name, u.kyc_data_hash, u.id AS user_uuid
     FROM carbon_batches cb
     JOIN users u ON u.id = cb.user_id
     WHERE cb.id = $1`,
    [batchId]
  );

  if (!rows.length) throw new Error(`Batch ${batchId} not found`);
  const batch = rows[0];

  if (batch.admin_status !== 'approved')
    throw new Error(`Batch ${batchId} is not approved (status: ${batch.admin_status})`);
  if (batch.status === 'tokenised')
    throw new Error(`Batch ${batchId} already tokenised (token_id: ${batch.token_id})`);
  if (!batch.wallet_address)
    throw new Error(`User ${batch.user_id} has no wallet address bound`);

  const { tokenContract, kycContract } = getContracts();

  // 2. Check serial not already on-chain
  const alreadyRegistered = await tokenContract.serialRegistered(batch.registry_serial);
  if (alreadyRegistered) {
    console.warn(`Serial ${batch.registry_serial} already on-chain. Updating DB only.`);
    await query(
      `UPDATE carbon_batches SET
         status     = 'tokenised',
         updated_at = NOW()
       WHERE id = $1`,
      [batchId]
    );
    return { tokenId: null, txHash: null, alreadyExisted: true };
  }

  // 3. Auto-register KYC on-chain if not already done
  const userKYCed = await isWalletKYCVerified(kycContract, batch.wallet_address);
  if (!userKYCed) {
    console.log(`⚠️  User wallet ${batch.wallet_address} not KYC verified on-chain. Auto-registering...`);
    try {
      await verifyKYCOnChain(batch.wallet_address, batch.kyc_data_hash);
      console.log(`   ✅ KYC auto-registered for wallet ${batch.wallet_address}`);
    } catch (kycErr) {
      throw new Error(`KYC on-chain registration failed: ${kycErr.message}`);
    }
  }

  // 4. Build mint params
  const expiryTimestamp = batch.expiry_date
    ? Math.floor(new Date(batch.expiry_date).getTime() / 1000)
    : Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600;

  if (expiryTimestamp <= Math.floor(Date.now() / 1000))
    throw new Error(`Expiry date ${batch.expiry_date} is in the past — cannot mint`);

  const mintParams = {
    to:           batch.wallet_address,
    amount:       String(batch.quantity || batch.total_credits),
    projectName:  batch.project_name,
    location:     batch.project_location || batch.country || 'India',
    standard:     STANDARD_ENUM[batch.standard] ?? 0,
    projectType:  normaliseProjectType(batch.project_type),
    developer:    batch.developer || '',
    vintageYear:  String(batch.vintage_year || new Date().getFullYear()),
    expiryDate:   String(expiryTimestamp),
    serialNumber: batch.registry_serial,
    metadataURI:  batch.ipfs_metadata_hash
      ? `ipfs://${batch.ipfs_metadata_hash}`
      : batch.doc_ipfs_hash
        ? `ipfs://${batch.doc_ipfs_hash}`
        : '',
  };

  console.log(`⛓  Minting batch ${batchId} for wallet ${batch.wallet_address}...`);
  console.log(`   Project: ${mintParams.projectName}`);
  console.log(`   Serial:  ${mintParams.serialNumber}`);
  console.log(`   Amount:  ${mintParams.amount} tCO₂`);

  // 5. Send mint transaction
  let tx;
  try {
    tx = await tokenContract.mintCredit(mintParams);
  } catch (e) {
    const msg = e.reason || e.message || '';
    if (msg.includes('Serial already registered')) throw new Error('Serial number already registered on-chain');
    if (msg.includes('not KYC verified') || msg.includes('KYC')) throw new Error('Wallet not KYC verified on-chain');
    if (msg.includes('Expiry must be in future')) throw new Error('Expiry date is in the past');
    throw e;
  }

  console.log(`   TX sent: ${tx.hash}`);
  const receipt = await tx.wait(1);
  console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);

  // 6. Parse tokenId from CreditMinted event
  let tokenId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = tokenContract.interface.parseLog(log);
      if (parsed?.name === 'CreditMinted') {
        tokenId = Number(parsed.args.tokenId);
        break;
      }
    } catch {}
  }

  if (tokenId === null) throw new Error('Could not parse tokenId from CreditMinted event');
  console.log(`   Token ID: ${tokenId}`);

  // 7. ✅ FIX: tokenised_by uses user_uuid (UUID) not wallet address string
  await query(
    `UPDATE carbon_batches SET
       status       = 'tokenised',
       token_id     = $1,
       tx_hash_mint = $2,
       tokenised_at = NOW(),
       tokenised_by = $3,
       updated_at   = NOW()
     WHERE id = $4`,
    [
      tokenId,
      tx.hash,
      batch.user_uuid || null,  // ✅ UUID of the user, not wallet address
      batchId,
    ]
  );

  console.log(`   DB updated — batch ${batchId} → tokenised`);
  return { tokenId, txHash: tx.hash };
};

module.exports = { mintApprovedCredit, verifyKYCOnChain };