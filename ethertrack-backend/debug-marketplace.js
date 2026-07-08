require('dotenv').config();
const { ethers } = require('ethers');

async function main() {
  const rpcUrl = process.env.POLYGON_RPC_URL || process.env.ALCHEMY_RPC;
  console.log('RPC URL in use          :', rpcUrl);
  console.log('MARKETPLACE_ADDRESS     :', process.env.MARKETPLACE_ADDRESS);
  console.log('POLYGON_NETWORK         :', process.env.POLYGON_NETWORK || '(not set)');
  console.log('');

  if (!rpcUrl) {
    console.log('No RPC URL configured (POLYGON_RPC_URL / ALCHEMY_RPC). Stopping.');
    return;
  }
  if (!process.env.MARKETPLACE_ADDRESS) {
    console.log('MARKETPLACE_ADDRESS not set. Stopping.');
    return;
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const network = await provider.getNetwork();
  console.log('Connected chainId       :', network.chainId.toString(), '(' + network.name + ')');

  const code = await provider.getCode(process.env.MARKETPLACE_ADDRESS);
  console.log('Bytecode length at addr :', code.length);
  if (code === '0x') {
    console.log('NO CONTRACT DEPLOYED at this address on this network.');
    console.log('Either MARKETPLACE_ADDRESS is wrong, or POLYGON_RPC_URL points to the wrong chain.');
    return;
  }
  console.log('Contract bytecode found at this address.');
  console.log('');

  const iface = new ethers.Interface([
    'function logINRTrade(bytes32,uint256,uint256,uint256,uint8,address,address,uint256) external',
    'function signerWallet() view returns (address)',
  ]);
  const contract = new ethers.Contract(process.env.MARKETPLACE_ADDRESS, iface, provider);

  const selector = iface.getFunction('logINRTrade').selector;
  const hasLogINRTrade = code.includes(selector.slice(2));
  console.log('Has logINRTrade()       :', hasLogINRTrade ? 'yes' : 'NO - likely an old/stale deployment');
  console.log('');

  try {
    const onChainSigner = await contract.signerWallet();
    console.log('Contract signerWallet() :', onChainSigner);

    if (process.env.CHAIN_SIGNER_PRIVATE_KEY) {
      const wallet = new ethers.Wallet(process.env.CHAIN_SIGNER_PRIVATE_KEY);
      console.log('Your signer address     :', wallet.address);
      const match = onChainSigner.toLowerCase() === wallet.address.toLowerCase();
      console.log('Match                   :', match ? 'yes' : 'NO - wrong key or signer was rotated on-chain');
    } else {
      console.log('CHAIN_SIGNER_PRIVATE_KEY not set - cannot compare.');
    }
  } catch (e) {
    console.log('signerWallet() call failed:', e.message);
    console.log('Function likely does not exist at this address (old contract).');
  }
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
