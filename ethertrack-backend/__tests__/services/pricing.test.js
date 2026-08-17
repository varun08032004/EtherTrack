// __tests__/services/pricing.test.js — Pricing service tests
const { getEffectivePricePaise, getAllEffectivePrices } = require('../../services/pricing');

// Mock PLAN_CONFIG from routes/subscription.js
// Values match the actual config in routes/subscription.js
const PLAN_CONFIG = {
  free: { key: 'free', name: 'Free', monthly_paise: 0, annual_paise: 0 },
  starter: { key: 'starter', name: 'Starter', monthly_paise: 149900, annual_paise: 1499000 },
  growth: { key: 'growth', name: 'Growth', monthly_paise: 799900, annual_paise: 16000000 },
  corporate: { key: 'corporate', name: 'Corporate', monthly_paise: null, annual_paise: null },
};

describe('Pricing Service', () => {
  beforeEach(() => {
    // Clear cache before each test
    jest.resetModules();
  });

  describe('getAllEffectivePrices', () => {
    test('returns prices for all plans with monthly and annual', async () => {
      const prices = await getAllEffectivePrices(PLAN_CONFIG);
      
      expect(prices).toHaveProperty('free');
      expect(prices).toHaveProperty('starter');
      expect(prices).toHaveProperty('growth');
      expect(prices).toHaveProperty('corporate');
      
      expect(prices.free).toEqual({ monthly: 0, annual: 0 });
      expect(prices.starter.monthly).toBeGreaterThan(0);
      expect(prices.starter.annual).toBeGreaterThan(0);
      expect(prices.growth.monthly).toBeGreaterThan(0);
      expect(prices.growth.annual).toBeGreaterThan(0);
      expect(prices.corporate.monthly).toBeNull();
      expect(prices.corporate.annual).toBeNull();
    });
  });

  describe('getEffectivePricePaise', () => {
    test('returns monthly price for monthly cycle', async () => {
      const price = await getEffectivePricePaise('starter', 'monthly', PLAN_CONFIG);
      expect(price).toBe(PLAN_CONFIG.starter.monthly_paise);
    });

    test('returns annual price for annual cycle', async () => {
      const price = await getEffectivePricePaise('starter', 'annual', PLAN_CONFIG);
      expect(price).toBe(PLAN_CONFIG.starter.annual_paise);
    });

    test('returns 0 for free plan', async () => {
      expect(await getEffectivePricePaise('free', 'monthly', PLAN_CONFIG)).toBe(0);
      expect(await getEffectivePricePaise('free', 'annual', PLAN_CONFIG)).toBe(0);
    });

    test('returns null for corporate plan', async () => {
      expect(await getEffectivePricePaise('corporate', 'monthly', PLAN_CONFIG)).toBeNull();
      expect(await getEffectivePricePaise('corporate', 'annual', PLAN_CONFIG)).toBeNull();
    });

    test('defaults to monthly for unknown cycle', async () => {
      const price = await getEffectivePricePaise('starter', 'unknown', PLAN_CONFIG);
      expect(price).toBe(PLAN_CONFIG.starter.monthly_paise);
    });

    test('returns null for unknown plan', async () => {
      expect(await getEffectivePricePaise('unknown', 'monthly', PLAN_CONFIG)).toBeNull();
    });
  });

  describe('PLAN_CONFIG structure', () => {
    test('has correct plan structure', () => {
      expect(PLAN_CONFIG.free).toEqual({ key: 'free', name: 'Free', monthly_paise: 0, annual_paise: 0 });
      expect(PLAN_CONFIG.starter.key).toBe('starter');
      expect(PLAN_CONFIG.growth.key).toBe('growth');
      expect(PLAN_CONFIG.corporate.key).toBe('corporate');
    });
  });
});