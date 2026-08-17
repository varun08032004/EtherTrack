// verify-final-state.js
// Verify final on-chain state after migration
// Run: node verify-final-state.js

require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-contracts\\.env' });
const { ethers } = require('ethers');

async function main() {
  const RPC_URL = process.env.SEPOLIA_RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/VdL7KSs0Tx6bb1jjs_lU9";
  
  const CARBON_CREDIT_TOKEN_ADDRESS = "0x0C72dcc5a88C66259DDB09B187F9A8392f6cf3C2";
  const OLD_WALLET_1 = "0x201fa552d1a22264a04a8aafa0005faf5cf31ef3";
  const OLD_WALLET_2 = "0xE026653F4fDfe7Bd02fd1F6534Da631DD3410489";
  const CUSTODY_WALLET = "0xA3Cfbf47fb0a64c20119777d401100415c71498b";

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  const TOKEN_ABI = [
    "function balanceOf(address account, uint256 id) view returns (uint256)",
    "function totalSupply(uint256 id) view returns (uint256)",
    "function creditMetadata(uint256 id) view returns (string projectName, string location, uint8 standard, string projectType, string developer, uint256 vintageYear, uint256 expiryDate, string serialNumber, string metadataURI, bool active, address registeredBy, uint256 registeredAt)"
  ];

  const token = new ethers.Contract(CARBON_CREDIT_TOKEN_ADDRESS, TOKEN_ABI, provider);

  console.log("🔍 Final On-Chain State Verification");
  console.log("══════════════════════════════════════════════════════");
  console.log(`Custody Wallet: ${CUSTODY_WALLET}`);
  console.log("");

  for (const tokenId of [1, 2]) {
    const metadata = await token.creditMetadata(tokenId);
    const totalSupply = await token.totalSupply(tokenId);
    const custodyBal = await token.balanceOf(CUSTODY_WALLET, tokenId);
    const old1Bal = await token.balanceOf(OLD_WALLET_1, tokenId);
    const old2Bal = await token.balanceOf(OLD_WALLET_2, tokenId);
    
    console.log(`Token #${tokenId}: ${metadata[0]}`);
    console.log(`  Serial: ${metadata[7]}`);
    console.log(`  Total Supply: ${totalSupply}`);
    console.log(`  Custody Wallet: ${custodyBal} ✅`);
    console.log(`  Old Wallet 1 (${OLD_WALLET_1}): ${old1Bal}`);
    console.log(`  Old Wallet 2 (${OLD_WALLET_2}): ${old2Bal}`);
    console.log(`  Status: ${custodyBal === 3000 && old1Bal === 0 && old2Bal === 0 ? '✅ MIGRATED' : '❌ ISSUE'}`);
    console.log("");
  }

  // Check contract roles
  console.log("🔐 Contract Role Verification:");
  
  const OPERATOR_ABI = ["function operator() view returns (address)"];
  const SIGNER_ABI = ["function signerWallet() view returns (address)"];
  
  const tokenContract = new ethers.Contract(CARBON_CREDIT_TOKEN_ADDRESS, OPERATOR_ABI, provider);
  const tokenOperator = await tokenContract.operator();
  console.log(`  CarbonCreditToken operator: ${tokenOperator} ${tokenOperator.toLowerCase() === CUSTODY_WALLET.toLowerCase() ? '✅' : '❌'}`);
  
  const marketplaceContract = new ethers.Contract("0x3cDE5d0e6A0B0955d5fb72e7E5Ba2e3070AEA19A", SIGNER_ABI, provider);
  const marketplaceSigner = await marketplaceContract.signerWallet();
  console.log(`  Marketplace signerWallet: ${marketplaceSigner} ${marketplaceSigner.toLowerCase() === CUSTODY_WALLET.toLowerCase() ? '✅' : '❌'}`);
  
  const ledgerContract = new ethers.Contract("0x2046625FC6181DeE411a35F160Cb00b9FEC9d830", OPERATOR_ABI, provider);
  const ledgerOperator = await ledgerContract.operator();
  console.log(`  CreditLedger operator: ${ledgerOperator} ${ledgerOperator.toLowerCase() === CUSTODY_WALLET.toLowerCase() ? '✅' : '❌'}`);

  // Check marketplace approval
  const APPROVAL_ABI = ["function isApprovedForAll(address account, address operator) view returns (bool)"];
  const approvalContract = new ethers.Contract(CARBON_CREDIT_TOKEN_ADDRESS, APPROVAL_ABI, provider);
  const isApproved = await approvalContract.isApprovedForAll(CUSTODY_WALLET, "0x3cDE5d0e6A0B0955d5fb72e7E5Ba2e3070AEA19A");
  console.log(`  Custody approved for Marketplace: ${isApproved ? '✅' : '❌'}`);

  console.log("\n══════════════════════════════════════════════════════");
  console.log("✅ VERIFICATION COMPLETE!");
  console.log("══════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});