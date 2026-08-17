// check-token3.js
require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-contracts\\.env' });
const { ethers } = require('ethers');

async function main() {
  const RPC_URL = process.env.SEPOLIA_RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/VdL7KSs0Tx6bb1jjs_lU9";
  const CARBON_CREDIT_TOKEN_ADDRESS = "0x0C72dcc5a88C66259DDB09B187F9A8392f6cf3C2";
  const CUSTODY_WALLET = "0xA3Cfbf47fb0a64c20119777d401100415c71498b";

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const TOKEN_ABI = [
    "function balanceOf(address account, uint256 id) view returns (uint256)",
    "function totalSupply(uint256 id) view returns (uint256)",
    "function creditMetadata(uint256 id) view returns (string projectName, string location, uint8 standard, string projectType, string developer, uint256 vintageYear, uint256 expiryDate, string serialNumber, string metadataURI, bool active, address registeredBy, uint256 registeredAt)"
  ];

  const token = new ethers.Contract(CARBON_CREDIT_TOKEN_ADDRESS, TOKEN_ABI, provider);

  console.log("Checking Token #3 (Mango Farms Nashik)...");
  const metadata = await token.creditMetadata(3);
  const totalSupply = await token.totalSupply(3);
  const custodyBal = await token.balanceOf(CUSTODY_WALLET, 3);
  
  console.log(`Project: ${metadata[0]}`);
  console.log(`Serial: ${metadata[7]}`);
  console.log(`Total Supply: ${totalSupply}`);
  console.log(`Custody Wallet Balance: ${custodyBal}`);
}

main().catch(console.error);