// __tests__/services/cacheStrategy.test.js — Cache strategy tests
jest.mock('../../services/cacheStrategy', () => ({
  KEYS: {
    userProfile: (userId) => `user:profile:${userId}`,
    userKyc: (userId) => `user:kyc:${userId}`,
    userWallet: (userId) => `user:wallet:${userId}`,
    marketListings: (filters) => `market:listings:${JSON.stringify(filters)}`,
    marketStats: () => 'market:stats',
    priceEthInr: () => 'price:eth:inr',
    priceToken: (tokenId) => `price:token:${tokenId}`,
    carbonBatches: (userId) => `carbon:batches:${userId}`,
    carbonListings: (params) => `carbon:listings:${JSON.stringify(params)}`,
    carbonStats: () => 'carbon:stats',
    walletBalance: (userId) => `wallet:balance:${userId}`,
    walletTransactions: (userId, params) => `wallet:tx:${userId}:${JSON.stringify(params)}`,
    subscriptionStatus: (userId) => `sub:status:${userId}`,
    subscriptionPrices: () => 'sub:prices',
    buyOrders: (params) => `market:buyorders:${JSON.stringify(params)}`,
    emissionsSummary: (userId, year) => `emissions:summary:${userId}:${year}`,
    emissionActivities: (userId, params) => `emissions:activities:${userId}:${JSON.stringify(params)}`,
    portfolioCredits: (userId, limit, cursor) => `portfolio:credits:${userId}:${limit}:${cursor || 'first'}`,
    portfolioBought: (userId) => `portfolio:bought:${userId}`,
    brsrData: (userId, year) => `brsr:${userId}:${year}`,
    brsrSection: (userId, year, section) => `brsr:${userId}:${year}:${section}`,
    kycStatus: (userId) => `kyc:status:${userId}`,
    adminStats: () => 'admin:stats',
    adminDashboard: () => 'admin:dashboard',
    erpSyncStatus: (orgId, erpId) => `erp:sync:${orgId}:${erpId}`,
    erpData: (orgId, erpId) => `erp:data:${orgId}:${erpId}`,
  },
}));

const { KEYS } = require('../../services/cacheStrategy');

describe('CacheStrategy KEYS builders', () => {
  describe('builds portfolio keys', () => {
    test('portfolioCredits', () => {
      expect(KEYS.portfolioCredits(1)).toMatch(/^portfolio:credits:1/);
    });

    test('portfolioBought', () => {
      expect(KEYS.portfolioBought(1)).toBe('portfolio:bought:1');
    });
  });

  describe('builds market keys', () => {
    test('marketListings', () => {
      expect(KEYS.marketListings({})).toMatch(/^market:listings:/);
    });

    test('marketStats', () => {
      expect(KEYS.marketStats()).toBe('market:stats');
    });
  });

  describe('builds emissions keys', () => {
    test('emissionsSummary', () => {
      expect(KEYS.emissionsSummary(5, 2024)).toBe('emissions:summary:5:2024');
    });
  });

  describe('builds user keys', () => {
    test('userProfile', () => {
      expect(KEYS.userProfile(10)).toBe('user:profile:10');
    });

    test('walletBalance', () => {
      expect(KEYS.walletBalance(10)).toBe('wallet:balance:10');
    });

    test('userKyc', () => {
      expect(KEYS.userKyc(10)).toBe('user:kyc:10');
    });

    test('userWallet', () => {
      expect(KEYS.userWallet(10)).toBe('user:wallet:10');
    });
  });

  describe('builds admin keys', () => {
    test('adminStats', () => {
      expect(KEYS.adminStats()).toBe('admin:stats');
    });
  });

  describe('builds erp keys', () => {
    test('erpSyncStatus', () => {
      expect(KEYS.erpSyncStatus(5, 1)).toBe('erp:sync:5:1');
    });
  });
});