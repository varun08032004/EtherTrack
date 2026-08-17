// fund-custody.js
// Fund custody wallet with Sepolia ETH from minter wallet
// Run: node fund-custody.js

require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-contracts\\.env' });
const { ethers } = require('ethers');

async function main() {
  const RPC_URL = process.env.SEPOLIA_RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/VdL7KSs0Tx6bb1jjs_lU9";
  const MINTER_PRIVATE_KEY = process.env.PRIVATE_KEY;
  const CUSTODY_ADDRESS = "0xA3Cfbf47fb0a64c20119777d401100415c71498b";

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const minterWallet = new ethers.Wallet(MINTER_PRIVATE_KEY, provider);

  console.log("💰 Funding Custody Wallet with Sepolia ETH");
  console.log("══════════════════════════════════════════════════════");
  console.log(`Minter: ${minterWallet.address}`);
  console.log(`Custody: ${CUSTODY_ADDRESS}`);
  console.log("");

  const minterBalance = await provider.getBalance(minterWallet.address);
  const custodyBalance = await provider.getBalance(CUSTODY_ADDRESS);
  
  console.log(`Minter balance: ${ethers.formatEther(minterBalance)} ETH`);
  console.log(`Custody balance: ${ethers.formatEther(custodyBalance)} ETH`);

  if (custodyBalance >= ethers.parseEther("0.1")) {
    console.log("✅ Custody wallet already has sufficient funds.");
    return;
  }

  const amount = ethers.parseEther("0.5");
  console.log(`\n⛓  Sending ${ethers.formatEther(amount)} ETH to custody wallet...`);
  
  const tx = await minterWallet.sendTransaction({
    to: CUSTODY_ADDRESS,
    value: amount
  });
  
  console.log(`TX sent: ${tx.hash}`);
  await tx.wait();
  
  const newCustodyBalance = await provider.getBalance(CUSTODY_ADDRESS);
  console.log(`✅ Funded! New custody balance: ${ethers.formatEther(newCustodyBalance)} ETH`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});