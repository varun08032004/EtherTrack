// investigate-existing-tokens.js
// Investigate the existing minted tokens on-chain
// Run: node investigate-existing-tokens.js

require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-contracts\\.env' });
const { ethers } = require('ethers');

async function main() {
  const RPC_URL = process.env.SEPOLIA_RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/VdL7KSs0Tx6bb1jjs_lU9";
  
  const CARBON_CREDIT_TOKEN_ADDRESS = "0x0C72dcc5a88C66259DDB09B187F9A8392f6cf3C2";
  const OLD_WALLET = "0xE026653F4fDfe7Bd02fd1F6534Da631DD3410489";
  const CUSTODY_WALLET = "0xA3Cfbf47fb0a64c20119777d401100415c71498b";

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // Simplified ABI
  const TOKEN_ABI = [
    "function balanceOf(address account, uint256 id) view returns (uint256)",
    "function totalSupply(uint256 id) view returns (uint256)",
    "function creditMetadata(uint256 id) view returns (string projectName, string location, uint8 standard, string projectType, string developer, uint256 vintageYear, uint256 expiryDate, string serialNumber, string metadataURI, bool active, address registeredBy, uint256 registeredAt)",
    "function getNextTokenId() view returns (uint256)",
    "event CreditMinted(uint256 indexed tokenId, address indexed to, uint256 amount, string projectName, uint8 standard, string serialNumber)",
    "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)"
  ];

  const token = new ethers.Contract(CARBON_CREDIT_TOKEN_ADDRESS, TOKEN_ABI, provider);

  console.log("🔍 Investigating Existing Tokens On-Chain");
  console.log("══════════════════════════════════════════════════════");
  console.log(`Contract: ${CARBON_CREDIT_TOKEN_ADDRESS}`);
  console.log(`Old Wallet: ${OLD_WALLET}`);
  console.log(`Custody Wallet: ${CUSTODY_WALLET}`);
  console.log("");

  const nextTokenId = await token.getNextTokenId();
  console.log(`Next Token ID: ${nextTokenId}`);
  console.log("");

  // Check all token IDs
  for (let tokenId = 1; tokenId < Number(nextTokenId); tokenId++) {
    console.log(`--- Token ID #${tokenId} ---`);
    
    try {
      const metadata = await token.creditMetadata(tokenId);
      const totalSupply = await token.totalSupply(tokenId);
      const oldBalance = await token.balanceOf(OLD_WALLET, tokenId);
      const custodyBalance = await token.balanceOf(CUSTODY_WALLET, tokenId);
      
      console.log(`  Project: ${metadata[0]}`);
      console.log(`  Location: ${metadata[1]}`);
      console.log(`  Standard: ${metadata[2]}`);
      console.log(`  Project Type: ${metadata[3]}`);
      console.log(`  Developer: ${metadata[4]}`);
      console.log(`  Vintage: ${metadata[5]}`);
      console.log(`  Expiry: ${new Date(Number(metadata[6]) * 1000).toISOString()}`);
      console.log(`  Serial: ${metadata[7]}`);
      console.log(`  Total Supply: ${totalSupply}`);
      console.log(`  Old Wallet Balance: ${oldBalance}`);
      console.log(`  Custody Wallet Balance: ${custodyBalance}`);
      console.log(`  Active: ${metadata[9]}`);
      console.log(`  Registered By: ${metadata[10]}`);
      console.log(`  Registered At: ${new Date(Number(metadata[11]) * 1000).toISOString()}`);
      
      // Check CreditMinted events
      const filter = token.filters.CreditMinted(tokenId, null, null, null, null, null);
      const events = await token.queryFilter(filter, 0, "latest");
      for (const event of events) {
        console.log(`  📄 CreditMinted Event:`);
        console.log(`     Block: ${event.blockNumber}`);
        console.log(`     TX: ${event.transactionHash}`);
        console.log(`     To: ${event.args.to}`);
        console.log(`     Amount: ${event.args.amount}`);
        console.log(`     Project: ${event.args.projectName}`);
        console.log(`     Serial: ${event.args.serialNumber}`);
      }
      
      console.log("");
    } catch (e) {
      console.log(`  Error reading token ${tokenId}: ${e.message}`);
      console.log("");
    }
  }

  // Also check Transfer events for the old wallet
  console.log("--- TransferSingle Events for Old Wallet ---");
  const transferFilter = token.filters.TransferSingle(null, OLD_WALLET, null);
  const transfers = await token.queryFilter(transferFilter, 0, "latest");
  console.log(`Found ${transfers.length} TransferSingle events from old wallet`);
  for (const t of transfers) {
    console.log(`  Block ${t.blockNumber}: ID=${t.args.id} Value=${t.args.value} from=${t.args.from} to=${t.args.to} TX=${t.transactionHash}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});