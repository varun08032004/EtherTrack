// jest.setup.js — Global test setup
require('dotenv').config({ path: '.env.test' });

// Mock external services using moduleNameMapper approach
// These mocks will be applied when modules are imported
const mockEmail = {
  sendCreditSubmittedEmail: jest.fn().mockResolvedValue(true),
  sendListingConfirmedEmail: jest.fn().mockResolvedValue(true),
  sendDelistingConfirmedEmail: jest.fn().mockResolvedValue(true),
  sendPaymentFailedEmail: jest.fn().mockResolvedValue(true),
  sendPlanSelectedEmail: jest.fn().mockResolvedValue(true),
  sendSubscriptionCancelledEmail: jest.fn().mockResolvedValue(true),
  sendKycApprovedEmail: jest.fn().mockResolvedValue(true),
  sendKycRejectedEmail: jest.fn().mockResolvedValue(true),
  sendWalletWithdrawalEmail: jest.fn().mockResolvedValue(true),
};

const mockIpfs = {
  uploadJSON: jest.fn().mockResolvedValue({ IpfsHash: 'QmTest123' }),
  uploadFile: jest.fn().mockResolvedValue({ IpfsHash: 'QmTest123' }),
};

const mockBlockchain = {
  init: jest.fn(),
  stop: jest.fn(),
  initWebSocketSubscriptions: jest.fn(),
};

const mockCacheStrategy = {
  getOrSet: jest.fn((key, fn) => fn()),
  invalidate: jest.fn(),
  KEYS: {
    marketListings: () => 'market:listings',
    marketStats: () => 'market:stats',
    portfolioCredits: (userId) => `portfolio:credits:${userId}`,
    portfolioBought: (userId) => `portfolio:bought:${userId}`,
    emissionsSummary: (orgId, year) => `emissions:summary:${orgId}:${year}`,
    userProfile: (userId) => `user:profile:${userId}`,
    walletBalance: (userId) => `wallet:balance:${userId}`,
    brsrData: (orgId, year, section) => `brsr:${orgId}:${year}:${section}`,
    kycStatus: (userId) => `kyc:status:${userId}`,
    adminStats: () => 'admin:stats',
    erpConnections: (orgId) => `erp:connections:${orgId}`,
  },
};

const mockPool = {
  safeQuery: jest.fn(),
  withTransaction: jest.fn((fn) => fn({
    query: jest.fn(),
    release: jest.fn(),
  })),
  getReadPool: jest.fn(() => ({
    query: jest.fn(),
  })),
  getPrimaryPool: jest.fn(() => ({
    query: jest.fn(),
  })),
};

// Store mocks globally for tests to access
global.__mocks = {
  email: mockEmail,
  ipfs: mockIpfs,
  blockchain: mockBlockchain,
  cacheStrategy: mockCacheStrategy,
  pool: mockPool,
};

console.log('[TEST] Global setup complete');

// Global test utilities
global.testUtils = {
  createMockRequest: (overrides = {}) => ({
    body: {},
    query: {},
    params: {},
    headers: {},
    user: { id: 1, role: 'user' },
    requestId: 'test-request-id',
    log: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
    },
    ...overrides,
  }),
  createMockResponse: () => {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
    };
    return res;
  },
  createMockUser: (overrides = {}) => ({
    id: 1,
    email: 'test@example.com',
    role: 'user',
    kyc_status: 'verified',
    ...overrides,
  }),
};

console.log('[TEST] Global setup complete');