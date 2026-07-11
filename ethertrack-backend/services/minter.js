// services/minter.js — EtherTrack backend auto-mint service
const { ethers } = require('ethers');
const { safeQuery: query } = require('../db/pool');

const RPC_URL         = process.env.ALCHEMY_RPC;
const MINTER_KEY      = process.env.MINTER_PRIVATE_KEY;
const TOKEN_ADDRESS   = process.env.CARBON_CREDIT_TOKEN_ADDRESS;
const KYC_REG_ADDRESS = process.env.KYC_REGISTRY_ADDRESS;
const MARKETPLACE_ADDRESS = process.env.MARKETPLACE_ADDRESS;

// [NEW] Operator-only functions added to CarbonCreditToken.sol / Marketplace.sol
// so INR/Razorpay-paying users never need to open MetaMask for routine
// listing, buying, or retiring. The backend's MINTER_KEY wallet must be set
// as the `operator` on CarbonCreditToken (setOperator) and already IS the
// `signerWallet` on Marketplace (constructor arg) — see scripts/setup-operator.js.
const MARKETPLACE_ABI = [
  'function listCreditFor(address seller, uint256 tokenId, uint256 amount, uint256 pricePerUnit, uint256 pricePerUnitINR, uint256 duration) external returns (uint256 listingId)',
  'function cancelListingFor(address seller, uint256 listingId) external',
  'function settleINRTrade(uint256 listingId, address buyer, uint256 amount, uint256 priceINR, bytes32 tradeId, uint8 payMode, uint256 timestamp) external returns (uint256 recordedTradeId)',
  'function listings(uint256) view returns (uint256 listingId, address seller, uint256 tokenId, uint256 amount, uint256 amountRemaining, uint256 pricePerUnit, uint256 pricePerUnitINR, uint256 listedAt, uint256 expiresAt, bool active)',
  'event CreditListed(uint256 indexed listingId, address indexed seller, uint256 indexed tokenId, uint256 amount, uint256 pricePerUnit, uint256 pricePerUnitINR)',
  'event INRTradeLogged(bytes32 indexed tradeId, uint256 indexed tokenId, uint256 quantity, uint256 priceINR, uint8 payMode, address buyer, address seller, bytes32 tradeHash, uint256 timestamp)',
];

const MODE_INR_WALLET = 0;
const MODE_RAZORPAY   = 1;

const TOKEN_ABI = [
  'function mintCredit((address to,uint256 amount,string projectName,string location,uint8 standard,string projectType,string developer,uint256 vintageYear,uint256 expiryDate,string serialNumber,string metadataURI) p) returns (uint256)',
  'function serialRegistered(string) view returns (bool)',
  'event CreditMinted(uint256 indexed tokenId, address indexed to, uint256 amount, string projectName, uint8 standard, string serialNumber)',
  'function retireCreditFor(address beneficiary, uint256 tokenId, uint256 amount) external',
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function setOperator(address _operator) external',
  'function operator() view returns (address)',
  'event CreditRetired(uint256 indexed tokenId, address indexed retiredBy, uint256 amount, string projectName)',
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

// ── Live ETH/INR rate (cached 5 min) ─────────────────────────────
let _cachedRate    = 280000;
let _lastFetchedAt = 0;

const getLiveETHRate = async () => {
  const now = Date.now();
  if (now - _lastFetchedAt < 5 * 60 * 1000) return _cachedRate;
  try {
    const res  = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=inr');
    const data = await res.json();
    if (data?.ethereum?.inr) {
      _cachedRate    = data.ethereum.inr;
      _lastFetchedAt = now;
    }
  } catch (e) {
    console.warn('ETH rate fetch failed, using cached:', _cachedRate);
  }
  return _cachedRate;
};

// ── Build provider + contracts ────────────────────────────────────
const getContracts = () => {
  if (!RPC_URL)       throw new Error('ALCHEMY_RPC not set in .env');
  if (!MINTER_KEY)    throw new Error('MINTER_PRIVATE_KEY not set in .env');
  if (!TOKEN_ADDRESS) throw new Error('CARBON_CREDIT_TOKEN_ADDRESS not set in .env');

  const provider      = new ethers.JsonRpcProvider(RPC_URL);
  const minterWallet  = new ethers.Wallet(MINTER_KEY, provider);
  const tokenContract = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, minterWallet);
  const kycContract   = KYC_REG_ADDRESS
    ? new ethers.Contract(KYC_REG_ADDRESS, KYC_ABI, minterWallet)
    : null;
  const marketContract = MARKETPLACE_ADDRESS
    ? new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, minterWallet)
    : null;

  return { provider, minterWallet, tokenContract, kycContract, marketContract };
};

// ── Check on-chain KYC ────────────────────────────────────────────
const isWalletKYCVerified = async (kycContract, walletAddress) => {
  if (!kycContract || !walletAddress) return false;
  try { return await kycContract.isKYCVerified(walletAddress); }
  catch (e) { console.warn('KYC check failed:', e.message); return false; }
};

// ── Register KYC on-chain ─────────────────────────────────────────
const verifyKYCOnChain = async (walletAddress, kycDataHash) => {
  if (!walletAddress) throw new Error('No wallet address — user has not connected MetaMask');

  const { kycContract, minterWallet } = getContracts();
  if (!kycContract) throw new Error('KYC_REGISTRY_ADDRESS not set in .env');

  const alreadyVerified = await isWalletKYCVerified(kycContract, walletAddress);
  if (alreadyVerified) {
    console.log(`ℹ️  Wallet ${walletAddress} already KYC verified on-chain — skipping`);
    return { skipped: true };
  }

  try {
    const isOperator = await kycContract.kycOperators(minterWallet.address);
    if (!isOperator) {
      throw new Error(
        `Minter wallet ${minterWallet.address} is not a KYC operator. ` +
        `Call addKYCOperator(${minterWallet.address}) on KYCRegistry as owner.`
      );
    }
  } catch (e) {
    if (e.message.includes('not a KYC operator')) throw e;
    console.warn('Could not check operator status:', e.message);
  }

  let hashBytes32;
  try {
    hashBytes32 = kycDataHash && kycDataHash.startsWith('0x')
      ? kycDataHash.padEnd(66, '0').slice(0, 66)
      : ethers.keccak256(ethers.toUtf8Bytes(kycDataHash || 'kyc-approved'));
  } catch { hashBytes32 = ethers.ZeroHash; }

  console.log(`⛓  Registering KYC on-chain for wallet ${walletAddress}...`);
  const tx      = await kycContract.verifyKYC(walletAddress, hashBytes32);
  const receipt = await tx.wait(1);
  console.log(`   ✅ KYC registered on-chain in block ${receipt.blockNumber} (${tx.hash})`);
  return { txHash: tx.hash, blockNumber: receipt.blockNumber };
};

// ── Core mint function ────────────────────────────────────────────
const mintApprovedCredit = async (batchId, { force = false } = {}) => {
  // 1. Fetch batch + user
  const { rows } = await query(
    `SELECT cb.*, u.wallet_address, u.email, u.full_name, u.kyc_data_hash, u.id AS user_uuid
     FROM carbon_batches cb
     JOIN users u ON u.id = cb.user_id
     WHERE cb.id = $1`,
    [batchId]
  );

  if (!rows.length) throw new Error(`Batch ${batchId} not found`);
  const batch = rows[0];

  // 2. Validate batch state
  if (batch.admin_status !== 'approved')
    throw new Error(`Batch ${batchId} is not approved (admin_status: ${batch.admin_status})`);

  // ✅ FIX: Use 'status' column (not batch_status — that column doesn't exist)
  // Allow retry if status is tokenised but token_id is NULL (partial failure)
  // OR if force=true (admin retry)
  const isFullyTokenised = batch.status === 'tokenised' && batch.token_id !== null;
  if (isFullyTokenised && !force) {
    throw new Error(`Batch ${batchId} already fully tokenised (token_id: ${batch.token_id})`);
  }

  if (!batch.wallet_address)
    throw new Error(`User ${batch.user_id} has no wallet address bound`);

  // ✅ Validate amount before sending to contract
  const creditAmount = parseInt(batch.quantity || batch.total_credits || batch.available_credits || 0);
  if (!creditAmount || creditAmount <= 0)
    throw new Error(`Batch ${batchId} has invalid credit amount: ${creditAmount}`);

  const { tokenContract, kycContract } = getContracts();

  // 3. Check serial not already on-chain
  let alreadyRegistered = false;
  try {
    alreadyRegistered = await tokenContract.serialRegistered(batch.registry_serial);
  } catch (e) {
    console.warn('serialRegistered check failed:', e.message);
  }

  if (alreadyRegistered) {
    console.warn(`⚠️  Serial ${batch.registry_serial} already on-chain — updating DB only`);
    // ✅ Use 'status' not 'batch_status'
    await query(
      `UPDATE carbon_batches
       SET status     = 'tokenised',
           updated_at = NOW()
       WHERE id = $1`,
      [batchId]
    );
    return { tokenId: null, txHash: null, alreadyExisted: true };
  }

  // 4. Auto-register KYC if needed
  const userKYCed = await isWalletKYCVerified(kycContract, batch.wallet_address);
  if (!userKYCed) {
    console.log(`⚠️  Auto-registering KYC for ${batch.wallet_address}...`);
    try {
      await verifyKYCOnChain(batch.wallet_address, batch.kyc_data_hash);
      console.log(`   ✅ KYC auto-registered`);
    } catch (kycErr) {
      throw new Error(`KYC on-chain registration failed: ${kycErr.message}`);
    }
  }

  // 5. Build expiry timestamp
  const expiryTimestamp = batch.expiry_date
    ? Math.floor(new Date(batch.expiry_date).getTime() / 1000)
    : Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600;

  if (expiryTimestamp <= Math.floor(Date.now() / 1000))
    throw new Error(`Expiry date ${batch.expiry_date} is in the past — update expiry and retry`);

  // 6. Build mint params
  const mintParams = {
    to:           batch.wallet_address,
    amount:       String(creditAmount),
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

  // 7. Send mint transaction
  let tx;
  try {
    tx = await tokenContract.mintCredit(mintParams);
  } catch (e) {
    const msg = e.reason || e.shortMessage || e.message || '';
    if (msg.includes('Serial already registered')) {
      // ✅ Use 'status' not 'batch_status'
      await query(
        `UPDATE carbon_batches SET status='tokenised', updated_at=NOW() WHERE id=$1`,
        [batchId]
      );
      return { tokenId: null, txHash: null, alreadyExisted: true };
    }
    if (msg.includes('not KYC verified') || msg.includes('KYC'))
      throw new Error('Wallet not KYC verified on-chain — KYC registration may have failed');
    if (msg.includes('Expiry must be in future'))
      throw new Error('Expiry date is in the past — update expiry date and retry');
    if (msg.includes('Amount must be > 0'))
      throw new Error('Credit amount is 0 — check batch quantity in DB');
    throw e;
  }

  console.log(`   TX sent: ${tx.hash}`);
  const receipt = await tx.wait(1);
  console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);

  // 8. Parse tokenId from CreditMinted event
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

  if (tokenId === null)
    throw new Error('TX confirmed but could not parse tokenId — check CreditMinted event ABI');

  console.log(`   Token ID: ${tokenId}`);

  const ethRate = await getLiveETHRate();

  // 10. ✅ Update DB using 'status' not 'batch_status'
  await query(
    `UPDATE carbon_batches
     SET status       = 'tokenised',
         token_id     = $1,
         tx_hash_mint = $2,
         tokenised_at = NOW(),
         tokenised_by = $3,
         updated_at   = NOW()
     WHERE id = $4`,
    [tokenId, tx.hash, batch.user_uuid || null, batchId]
  );

  console.log(`   DB updated — batch ${batchId} → tokenised`);
  return { tokenId, txHash: tx.hash, ethRate };
};

// ══════════════════════════════════════════════════════════════════
// [NEW] Operator-executed functions — backend signs & pays gas, so
// INR/Razorpay-paying users never see a MetaMask popup for routine
// listing, delisting, buying, or retiring. Crypto/ETH-paying users
// continue to sign their own transactions via the frontend as before —
// these functions are NOT used for that path.
// ══════════════════════════════════════════════════════════════════

/** Retire credits on a user's behalf. beneficiary must already hold
 *  `amount` of `tokenId` on-chain — this never fabricates ownership. */
const retireCreditForOnChain = async (beneficiaryWallet, tokenId, amount) => {
  const { tokenContract } = getContracts();
  console.log(`🔥 Retiring ${amount} of token ${tokenId} for ${beneficiaryWallet} (operator-executed)...`);
  const tx = await tokenContract.retireCreditFor(beneficiaryWallet, tokenId, amount);
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error(`retireCreditFor reverted — tx: ${tx.hash}`);
  console.log(`   ✅ Retired on-chain, block ${receipt.blockNumber}, tx: ${tx.hash}`);
  return { txHash: tx.hash, blockNumber: receipt.blockNumber };
};

/** List a seller's credits on their behalf. Requires the seller to have
 *  already called creditToken.setApprovalForAll(marketplace, true) once. */
const listCreditForOnChain = async (sellerWallet, tokenId, amount, priceEth, priceINR, durationSeconds = 0) => {
  const { marketContract } = getContracts();
  if (!marketContract) throw new Error('MARKETPLACE_ADDRESS not set in .env');

  const priceWei = ethers.parseEther(String(priceEth));
  console.log(`📈 Listing ${amount} of token ${tokenId} for seller ${sellerWallet} (operator-executed)...`);

  const tx = await marketContract.listCreditFor(
    sellerWallet, tokenId, amount, priceWei, Math.round(priceINR), durationSeconds
  );
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error(`listCreditFor reverted — tx: ${tx.hash}`);

  let listingId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = marketContract.interface.parseLog(log);
      if (parsed?.name === 'CreditListed') { listingId = Number(parsed.args.listingId); break; }
    } catch { /* not our event, skip */ }
  }
  if (listingId === null) throw new Error('CreditListed event not found in receipt — listing may not have registered');

  console.log(`   ✅ Listed on-chain, listingId ${listingId}, tx: ${tx.hash}`);
  return { txHash: tx.hash, blockNumber: receipt.blockNumber, listingId };
};

/** Cancel a listing on the seller's behalf. Zero approval needed — the
 *  Marketplace already holds the escrowed tokens itself. */
const cancelListingForOnChain = async (sellerWallet, listingIdOnchain) => {
  const { marketContract } = getContracts();
  if (!marketContract) throw new Error('MARKETPLACE_ADDRESS not set in .env');

  console.log(`📉 Cancelling listing ${listingIdOnchain} for seller ${sellerWallet} (operator-executed)...`);
  const tx = await marketContract.cancelListingFor(sellerWallet, listingIdOnchain);
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error(`cancelListingFor reverted — tx: ${tx.hash}`);
  console.log(`   ✅ Delisted on-chain, tx: ${tx.hash}`);
  return { txHash: tx.hash, blockNumber: receipt.blockNumber };
};

/** THE fix for the core bug: actually transfers escrowed tokens from a
 *  listing to the buyer for an INR/Razorpay-paid purchase. Call this once
 *  payment is confirmed — this is what was missing before (logINRTrade()
 *  alone never moved any tokens). */
const settleINRTradeOnChain = async ({
  listingIdOnchain, buyerWallet, amount, priceINRPaise, dbTradeId, payMode = 'razorpay', timestamp,
}) => {
  const { marketContract } = getContracts();
  if (!marketContract) throw new Error('MARKETPLACE_ADDRESS not set in .env');

  const tradeIdHash = ethers.keccak256(ethers.toUtf8Bytes(String(dbTradeId)));
  const modeEnum    = payMode === 'inr_wallet' ? MODE_INR_WALLET : MODE_RAZORPAY;
  const ts           = timestamp || Math.floor(Date.now() / 1000);

  console.log(`💰 Settling INR trade ${dbTradeId} — listing ${listingIdOnchain}, ${amount} credits to ${buyerWallet}...`);

  const tx = await marketContract.settleINRTrade(
    listingIdOnchain, buyerWallet, amount, Math.round(priceINRPaise), tradeIdHash, modeEnum, ts
  );
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error(`settleINRTrade reverted — tx: ${tx.hash}`);

  console.log(`   ✅ Settled on-chain, block ${receipt.blockNumber}, tx: ${tx.hash}`);
  return { txHash: tx.hash, blockNumber: receipt.blockNumber };
};

module.exports = {
  mintApprovedCredit, verifyKYCOnChain, getLiveETHRate,
  retireCreditForOnChain, listCreditForOnChain, cancelListingForOnChain, settleINRTradeOnChain,
};