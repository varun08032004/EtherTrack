// scripts/check-onchain-balance.js
// ─────────────────────────────────────────────────────────────────────────────
// Checks the REAL on-chain credit balance for a wallet + tokenId, straight
// from CarbonCreditToken.balanceOf() — bypassing the database entirely.
// Use this whenever the DB/UI "held credits" number and an actual on-chain
// revert (e.g. "Insufficient credits") seem to disagree.
//
// Usage:
//   node scripts/check-onchain-balance.js <tokenId> [walletAddress]
//
// If walletAddress is omitted, defaults to the wallet below.
//
// Requires .env with: ALCHEMY_RPC, CARBON_CREDIT_TOKEN_ADDRESS
// (No private key needed — this only reads, never sends a transaction.)
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();
const { ethers } = require('ethers');

const TOKEN_ABI = [
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function getCreditMetadata(uint256 tokenId) view returns (tuple(string projectName,string location,uint8 standard,string projectType,string developer,uint256 vintageYear,uint256 expiryDate,string serialNumber,string metadataURI,bool active,address registeredBy,uint256 registeredAt))',
  'function getTotalRetired(uint256 tokenId) view returns (uint256)',
  'function isExpired(uint256 tokenId) view returns (bool)',
];

const DEFAULT_WALLET = '0x201Fa552d1A22264A04A8Aafa0005FAF5CF31eF3';

async function main() {
  const tokenIdArg = process.argv[2];
  const wallet     = process.argv[3] || DEFAULT_WALLET;

  if (!tokenIdArg) {
    console.error('❌ Usage: node scripts/check-onchain-balance.js <tokenId> [walletAddress]');
    console.error('   Example: node scripts/check-onchain-balance.js 5');
    process.exit(1);
  }

  const rpcUrl       = process.env.ALCHEMY_RPC;
  const tokenAddress = process.env.CARBON_CREDIT_TOKEN_ADDRESS;

  if (!rpcUrl || !tokenAddress) {
    console.error('❌ Missing ALCHEMY_RPC or CARBON_CREDIT_TOKEN_ADDRESS in .env');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const token    = new ethers.Contract(tokenAddress, TOKEN_ABI, provider);

  console.log(`🔍 Checking token contract: ${tokenAddress}`);
  console.log(`   Wallet:  ${wallet}`);
  console.log(`   TokenId: ${tokenIdArg}\n`);

  try {
    const [balance, totalRetired, expired] = await Promise.all([
      token.balanceOf(wallet, tokenIdArg),
      token.getTotalRetired(tokenIdArg).catch(() => null),
      token.isExpired(tokenIdArg).catch(() => null),
    ]);

    console.log(`✅ On-chain balanceOf(wallet, tokenId): ${balance.toString()} credits`);
    if (totalRetired !== null) console.log(`   Total already retired for this tokenId (all holders): ${totalRetired.toString()}`);
    if (expired !== null)      console.log(`   Is this credit expired? ${expired ? 'YES ⚠️' : 'No'}`);

    let meta = null;
    try { meta = await token.getCreditMetadata(tokenIdArg); } catch { /* ignore */ }
    if (meta) {
      console.log(`\n   Project:   ${meta.projectName}`);
      console.log(`   Developer: ${meta.developer}`);
      console.log(`   Active:    ${meta.active}`);
      console.log(`   Vintage:   ${meta.vintageYear}`);
    }

    console.log(`\n📊 Trying to retire 5? ${Number(balance) >= 5
      ? '✅ Should succeed — 5 <= your balance.'
      : `❌ Would FAIL — you only hold ${balance.toString()}, not 5. This is your DB/UI showing stale data.`}`);

  } catch (err) {
    console.error('❌ Failed to query balance:', err.message);
    console.error('   Check that tokenId and the ABI/address are correct.');
    process.exit(1);
  }
}

main();