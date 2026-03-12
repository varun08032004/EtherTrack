// ─────────────────────────────────────────────────────────────
//  contracts.config.js
//  EtherTrack — Ethereum Network Config
// ─────────────────────────────────────────────────────────────

export const NETWORKS = {
  SEPOLIA: {
    chainId:   11155111,
    name:      'Ethereum Sepolia',
    rpcUrl:    'https://rpc.sepolia.org',
    explorer:  'https://sepolia.etherscan.io',
    currency:  'ETH',
    isTestnet: true,
  },
  MAINNET: {
    chainId:   1,
    name:      'Ethereum Mainnet',
    rpcUrl:    'https://eth.llamarpc.com',
    explorer:  'https://etherscan.io',
    currency:  'ETH',
    isTestnet: false,
  },
};

// ── Contract Addresses (filled after deploy) ──────────────
export const CONTRACT_ADDRESSES = {
  [NETWORKS.SEPOLIA.chainId]: {
    KYCRegistry:       process.env.REACT_APP_KYC_REGISTRY_ADDRESS       || '',
    CarbonCreditToken: process.env.REACT_APP_CARBON_CREDIT_TOKEN_ADDRESS || '',
    Marketplace:       process.env.REACT_APP_MARKETPLACE_ADDRESS         || '',
    EmissionRegistry:  process.env.REACT_APP_EMISSION_REGISTRY_ADDRESS   || '',
    Treasury:          process.env.REACT_APP_TREASURY_ADDRESS            || '',
  },
  [NETWORKS.MAINNET.chainId]: {
    KYCRegistry:       process.env.REACT_APP_MAINNET_KYC_REGISTRY_ADDRESS       || '',
    CarbonCreditToken: process.env.REACT_APP_MAINNET_CARBON_CREDIT_TOKEN_ADDRESS || '',
    Marketplace:       process.env.REACT_APP_MAINNET_MARKETPLACE_ADDRESS         || '',
    EmissionRegistry:  process.env.REACT_APP_MAINNET_EMISSION_REGISTRY_ADDRESS   || '',
    Treasury:          process.env.REACT_APP_MAINNET_TREASURY_ADDRESS            || '',
  },
};

// ── ABIs ─────────────────────────────────────────────────
export const ABIS = {

  KYCRegistry: [
    'function isKYCVerified(address wallet) view returns (bool)',
    'function getKYCRecord(address wallet) view returns (tuple(bool verified, uint256 verifiedAt, uint256 expiresAt, bytes32 kycDataHash, address verifiedBy))',
    'function getKYCExpiry(address wallet) view returns (uint256)',
    'event KYCVerified(address indexed wallet, address indexed operator, uint256 expiresAt)',
    'event KYCRevoked(address indexed wallet, address indexed operator, string reason)',
  ],

  CarbonCreditToken: [
    'function balanceOf(address account, uint256 id) view returns (uint256)',
    'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])',
    'function getCreditMetadata(uint256 tokenId) view returns (tuple(string projectName, string location, uint8 standard, string projectType, string developer, uint256 vintageYear, uint256 expiryDate, string serialNumber, string metadataURI, bool active, address registeredBy, uint256 registeredAt))',
    'function mintCredit(address to, uint256 amount, string projectName, string location, uint8 standard, string projectType, string developer, uint256 vintageYear, uint256 expiryDate, string serialNumber, string metadataURI) returns (uint256)',
    'function retireCredit(uint256 tokenId, uint256 amount)',
    'function isExpired(uint256 tokenId) view returns (bool)',
    'function getNextTokenId() view returns (uint256)',
    'function getTotalRetired(uint256 tokenId) view returns (uint256)',
    'function setApprovalForAll(address operator, bool approved)',
    'function isApprovedForAll(address account, address operator) view returns (bool)',
    'event CreditMinted(uint256 indexed tokenId, address indexed to, uint256 amount, string projectName, uint8 standard, string serialNumber)',
    'event CreditRetired(uint256 indexed tokenId, address indexed retiredBy, uint256 amount, string projectName)',
  ],

  Marketplace: [
    'function listCredit(uint256 tokenId, uint256 amount, uint256 pricePerUnit, uint256 duration) returns (uint256)',
    'function cancelListing(uint256 listingId)',
    'function updateListingPrice(uint256 listingId, uint256 newPrice)',
    'function buyCredit(uint256 listingId, uint256 amount) payable',
    'function placeLimitOrder(uint256 tokenId, uint256 amount, uint256 limitPrice, uint8 side, uint256 duration) payable returns (uint256)',
    'function cancelOrder(uint256 orderId)',
    'function getActiveListings() view returns (tuple(uint256 listingId, address seller, uint256 tokenId, uint256 amount, uint256 amountRemaining, uint256 pricePerUnit, uint256 listedAt, uint256 expiresAt, bool active)[])',
    'function getSellerListings(address seller) view returns (uint256[])',
    'function getTraderOrders(address trader) view returns (uint256[])',
    'function getBuyerTrades(address buyer) view returns (uint256[])',
    'function getSellerTrades(address seller) view returns (uint256[])',
    'function getTrade(uint256 tradeId) view returns (tuple(uint256 tradeId, uint256 listingId, uint256 buyOrderId, address buyer, address seller, uint256 tokenId, uint256 amount, uint256 pricePerUnit, uint256 totalPrice, uint256 fee, uint256 tradedAt))',
    'function listings(uint256) view returns (tuple(uint256 listingId, address seller, uint256 tokenId, uint256 amount, uint256 amountRemaining, uint256 pricePerUnit, uint256 listedAt, uint256 expiresAt, bool active))',
    'function orders(uint256) view returns (tuple(uint256 orderId, address trader, uint256 tokenId, uint256 amount, uint256 limitPrice, uint256 filledAmount, uint8 orderType, uint8 side, uint8 status, uint256 createdAt, uint256 expiresAt))',
    'function calculateFee(uint256 amount, uint256 pricePerUnit) view returns (uint256 fee, uint256 total)',
    'function totalListings() view returns (uint256)',
    'function totalTrades() view returns (uint256)',
    'event CreditListed(uint256 indexed listingId, address indexed seller, uint256 indexed tokenId, uint256 amount, uint256 pricePerUnit)',
    'event ListingCancelled(uint256 indexed listingId, address indexed seller)',
    'event CreditTraded(uint256 indexed tradeId, uint256 indexed listingId, address indexed buyer, address seller, uint256 tokenId, uint256 amount, uint256 pricePerUnit, uint256 totalPrice, uint256 fee)',
    'event OrderPlaced(uint256 indexed orderId, address indexed trader, uint256 indexed tokenId, uint256 amount, uint256 limitPrice, uint8 side)',
    'event OrderCancelled(uint256 indexed orderId, address indexed trader)',
  ],

  EmissionRegistry: [
    'function logEmission(uint256 period, uint256 energyKWh, uint256 transportKm, uint256 wasteKg, uint8 scope, string notes) returns (uint256)',
    'function calculateEmissions(uint256 energyKWh, uint256 transportKm, uint256 wasteKg) view returns (uint256 totalCO2e, uint256 creditsNeeded)',
    'function getEmissionLog(uint256 logId) view returns (tuple(address wallet, uint256 loggedAt, uint256 period, uint256 energyKWh, uint256 transportKm, uint256 wasteKg, uint256 totalCO2e, uint256 creditsNeeded, uint8 scope, string notes))',
    'function getUserEmissionLogs(address wallet) view returns (uint256[])',
    'function getTotalEmitted(address wallet) view returns (uint256)',
    'function getNetEmissions(address wallet) view returns (int256)',
    'event EmissionLogged(uint256 indexed logId, address indexed wallet, uint256 totalCO2e, uint256 creditsNeeded, uint256 period)',
  ],

  Treasury: [
    'function calculateFee(uint256 amount) pure returns (uint256)',
    'function getBalance() view returns (uint256)',
    'function FEE_BASIS_POINTS() view returns (uint256)',
    'function totalFeesCollected() view returns (uint256)',
  ],
};

// ── Standard enum ─────────────────────────────────────────
export const STANDARD_ENUM      = { VCS: 0, GS: 1, CDM: 2, ACR: 3 };
export const STANDARD_FROM_ENUM = { 0: 'VCS', 1: 'GS', 2: 'CDM', 3: 'ACR' };
export const ORDER_SIDE         = { BUY: 0, SELL: 1 };
export const ORDER_STATUS       = { OPEN: 0, FILLED: 1, CANCELLED: 2, EXPIRED: 3 };
export const EMISSION_SCOPE     = { SCOPE_1: 0, SCOPE_2: 1, SCOPE_3: 2 };
