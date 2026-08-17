// check-token1-balance.js
// Check where Token #1's tokens are held
// Run: node check-token1-balance.js

require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-contracts\\.env' });
const { ethers } = require('ethers');

async function main() {
  const RPC_URL = process.env.SEPOLIA_RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/VdL7KSs0Tx6bb1jjs_lU9";
  
  const CARBON_CREDIT_TOKEN_ADDRESS = "0x0C72dcc5a88C66259DDB09B187F9A8392f6cf3C2";
  const OLD_WALLET = "0xE026653F4fDfe7Bd02fd1F6534Da631DD3410489";
  const CUSTODY_WALLET = "0xA3Cfbf47fb0a64c20119777d401100415c71498b";
  const MARKETPLACE_ADDRESS = "0x3cDE5d0e6A0B0955d5fb72e7E5Ba2e3070AEA19A";

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  const TOKEN_ABI = [
    "function balanceOf(address account, uint256 id) view returns (uint256)",
    "function totalSupply(uint256 id) view returns (uint256)"
  ];

  const token = new ethers.Contract(CARBON_CREDIT_TOKEN_ADDRESS, TOKEN_ABI, provider);

  console.log("🔍 Checking Token #1 balances on key addresses");
  console.log("══════════════════════════════════════════════════════");
  
  const addresses = [
    { name: "Old Wallet", address: OLD_WALLET },
    { name: "Custody Wallet", address: CUSTODY_WALLET },
    { name: "Marketplace", address: MARKETPLACE_ADDRESS },
  ];

  for (const addr of addresses) {
    const balance = await token.balanceOf(addr.address, 1);
    console.log(`  ${addr.name} (${addr.address}): ${balance}`);
  }
  
  const totalSupply = await token.totalSupply(1);
  console.log(`  Total Supply: ${totalSupply}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});