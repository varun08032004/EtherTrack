require('@nomicfoundation/hardhat-toolbox');
require('@nomicfoundation/hardhat-verify');
require('dotenv').config();

const PRIVATE_KEY   = process.env.PRIVATE_KEY        || '0x' + '0'.repeat(64);
const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY  || '';
const SEPOLIA_RPC   = process.env.SEPOLIA_RPC_URL    || 'https://rpc.sepolia.org';
const MAINNET_RPC   = process.env.MAINNET_RPC_URL    || 'https://eth.llamarpc.com';

module.exports = {
  solidity: {
    version: '0.8.26',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'cancun',
      viaIR: true,
    },
  },

  networks: {
    localhost: { url: 'http://127.0.0.1:8545' },
    sepolia: {
      url:      SEPOLIA_RPC,
      accounts: [PRIVATE_KEY],
      chainId:  11155111,
      gasPrice: 'auto',
    },
    mainnet: {
      url:      MAINNET_RPC,
      accounts: [PRIVATE_KEY],
      chainId:  1,
      gasPrice: 'auto',
    },
  },

  etherscan: {
    apiKey: { sepolia: ETHERSCAN_KEY, mainnet: ETHERSCAN_KEY },
  },

  gasReporter: { enabled: true, currency: 'INR', token: 'ETH' },

  paths: {
    sources: './contracts', tests: './test',
    cache: './cache', artifacts: './artifacts',
  },
};