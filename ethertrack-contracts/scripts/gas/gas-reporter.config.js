/**
 * Hardhat Gas Reporter Configuration
 * Provides detailed gas usage reports for contract functions
 */

module.exports = {
  enabled: process.env.REPORT_GAS !== 'false',
  currency: 'USD',
  gasPrice: 30, // gwei
  coinmarketcap: process.env.COINMARKETCAP_API_KEY,
  token: 'MATIC',
  outputFile: 'gas-report.txt',
  noColors: true,
  onlyCalled: true,
  excludeContracts: [
    'Mock*',
    'Test*',
    'ERC1155',
    'ERC1155Burnable',
    'ERC1155Supply',
    'Ownable',
    'Pausable',
    'ReentrancyGuard',
    'AccessControl',
    'ERC20',
    'ERC20Permit',
    'ERC20Votes',
    'ERC1155',
    'ERC1155Burnable',
    'ERC1155Supply'
  ],
  methodSort: 'calldesc', // Sort by call count descending
  showMethodSig: true,
  showTimeSpent: true,
  excludeSignatures: [
    'constructor()',
    'supportsInterface(bytes4)'
  ],
  L1: 'ethereum',
  L2: 'polygon',
  // Custom gas price for more accurate reporting
  gasPriceFn: (network) => {
    const prices = {
      mainnet: 30,
      sepolia: 30,
      polygon: 30,
      amoy: 30
    };
    return prices[network] || 30;
  }
}