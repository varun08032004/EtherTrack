require('@nomicfoundation/hardhat-toolbox');
require('@nomicfoundation/hardhat-verify');
require('dotenv').config();

const PRIVATE_KEY        = process.env.PRIVATE_KEY           || '0x' + '0'.repeat(64);
const ETHERSCAN_KEY      = process.env.ETHERSCAN_API_KEY     || '';
const POLYGONSCAN_KEY    = process.env.POLYGONSCAN_API_KEY   || '';
const SEPOLIA_RPC        = process.env.SEPOLIA_RPC_URL       || 'https://rpc.sepolia.org';
const MAINNET_RPC        = process.env.MAINNET_RPC_URL       || 'https://eth.llamarpc.com';
const POLYGON_RPC        = process.env.POLYGON_RPC_URL       || 'https://polygon-rpc.com';
const AMOY_RPC           = process.env.AMOY_RPC_URL          || 'https://rpc-amoy.polygon.technology';

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

    // ── Ethereum ───────────────────────────────────────────────────────────
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

    // ── Polygon — production target ────────────────────────────────────────
    // Migration: redeploy all contracts with --network polygon
    // No contract changes needed — same Solidity, different chain.
    // Gas cost drops to fractions of ₹1 per audit entry vs Ethereum.
    polygon: {
      url:      POLYGON_RPC,
      accounts: [PRIVATE_KEY],
      chainId:  137,
      gasPrice: 'auto',
    },

    // ── Polygon Amoy testnet — Polygon equivalent of Sepolia ───────────────
    // Free MATIC: https://faucet.polygon.technology
    amoy: {
      url:      AMOY_RPC,
      accounts: [PRIVATE_KEY],
      chainId:  80002,
      gasPrice: 'auto',
    },
  },

  etherscan: {
    apiKey: {
      // Ethereum
      sepolia: ETHERSCAN_KEY,
      mainnet: ETHERSCAN_KEY,
      // Polygon — get key at https://polygonscan.com/myapikey
      polygon:      POLYGONSCAN_KEY,
      polygonAmoy:  POLYGONSCAN_KEY,
    },
    customChains: [
      {
        network: 'polygonAmoy',
        chainId: 80002,
        urls: {
          apiURL:     'https://api-amoy.polygonscan.com/api',
          browserURL: 'https://amoy.polygonscan.com',
        },
      },
    ],
  },

  gasReporter: {
    enabled:  true,
    currency: 'INR',
    token:    'ETH',
  },

  paths: {
    sources:   './contracts',
    tests:     './test',
    cache:     './cache',
    artifacts: './artifacts',
  },
};