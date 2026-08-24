require('dotenv').config();
const { ethers } = require('ethers');

async function check() {
  const RPC_URL = process.env.ALCHEMY_RPC;
  const CUSTODY_KEY = process.env.MINTER_PRIVATE_KEY;
  const CREDIT_LEDGER_ADDRESS = process.env.CREDIT_LEDGER_ADDRESS;
  
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(CUSTODY_KEY, provider);
  
  const LEDGER_ABI = [
    'function getUserBalance(bytes32 userId, uint256 tokenId) view returns (uint256)',
    'function computeUserId(string calldata userUuid) view returns (bytes32)',
  ];
  const ledger = new ethers.Contract(CREDIT_LEDGER_ADDRESS, LEDGER_ABI, wallet);
  
  const userIdHash = (uuid) => ethers.keccak256(ethers.toUtf8Bytes(uuid));
  
  const users = [
    { id: '45aced03-8164-44d8-9f39-c6bb828ba9cd', name: 'Buyer' },
    { id: '706c67a4-de98-4a9a-9287-bed77d33b1a4', name: 'Seller' },
  ];
  
  for (const u of users) {
    const hash = userIdHash(u.id);
    try {
      const bal = await ledger.getUserBalance(hash, 3);
      console.log(`${u.name} (${u.id}):`, bal.toString());
    } catch (e) {
      console.log(`${u.name}: ERROR -`, e.message);
    }
  }
  
  process.exit(0);
}

check().catch(console.error).finally(() => process.exit(1));