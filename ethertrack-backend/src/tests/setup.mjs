// Test Setup and Configuration - ESM for Jest
import { jest } from '@jest/globals';

// Mock all external dependencies using unstable_mockModule in beforeAll
beforeAll(async () => {
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.ALCHEMY_RPC = 'https://eth-mainnet.alchemyapi.io/v2/test';
  process.env.CHAIN_ID = '80001';
  process.env.MARKETPLACE_ADDRESS = '0x1234567890123456789012345678901234567890';
  process.env.CARBON_CREDIT_TOKEN_ADDRESS = '0x0987654321098765432109876543210987654321';
  process.env.KYC_REGISTRY_ADDRESS = '0x1111111111111111111111111111111111111111';
  process.env.CREDIT_LEDGER_ADDRESS = '0x2222222222222222222222222222222222222222';
  process.env.CUSTODY_WALLET_ADDRESS = '0x3333333333333333333333333333333333333333';
  process.env.ETHERTRACK_CUSTODY_PRIVATE_KEY = '0x' + '1'.repeat(64);
  process.env.MINTER_PRIVATE_KEY = '0x' + '2'.repeat(64);
  process.env.MINTER_WALLET_ADDRESS = '0x4444444444444444444444444444444444444444';
  process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
  process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';
  process.env.PLATFORM_GSTIN = '27AAAAA0000A1Z5';
  process.env.PLATFORM_FEE_BPS = '100';
  process.env.GST_RATE = '0.18';

  // Mock ethers
  await jest.unstable_mockModule('ethers', () => {
    class EventFragment {}
    class FunctionFragment {}
    class EthersError extends Error {}

    const ethers = {
      JsonRpcProvider: jest.fn().mockImplementation(() => ({
        getBlockNumber: jest.fn().mockResolvedValue(12345678),
        getBlock: jest.fn().mockResolvedValue({ timestamp: Math.floor(Date.now() / 1000) })
      })),
      Contract: jest.fn().mockImplementation(() => ({
        listCreditFor: jest.fn().mockResolvedValue({ hash: '0xmock', wait: jest.fn().mockResolvedValue({ status: 1 }) }),
        settleINRTrade: jest.fn().mockResolvedValue({ hash: '0xmock', wait: jest.fn().mockResolvedValue({ status: 1 }) }),
        cancelListingFor: jest.fn().mockResolvedValue({ hash: '0xmock', wait: jest.fn().mockResolvedValue({ status: 1 }) }),
        buyCredit: jest.fn().mockResolvedValue({ hash: '0xmock', wait: jest.fn().mockResolvedValue({ status: 1 }) }),
        on: jest.fn()
      })),
      WebSocketProvider: jest.fn().mockImplementation(() => ({
        on: jest.fn()
      })),
      toBigInt: jest.fn((val) => BigInt(val)),
      toUtf8Bytes: jest.fn((val) => new TextEncoder().encode(val)),
      keccak256: jest.fn((val) => '0x' + '0'.repeat(64)),
      formatEther: jest.fn((val) => val.toString()),
      parseEther: jest.fn((val) => BigInt(val)),
      ZeroHash: '0x' + '0'.repeat(64),
      ZeroAddress: '0x' + '0'.repeat(40),
      formatUnits: jest.fn((val, decimals) => (Number(val) / Math.pow(10, decimals)).toString()),
      parseUnits: jest.fn((val, decimals) => BigInt(Math.floor(Number(val) * Math.pow(10, decimals)))),
      Interface: jest.fn().mockImplementation(() => ({
        parseLog: jest.fn()
      })),
      EventFragment: class EventFragment {},
      FunctionFragment: class FunctionFragment {},
      Error: class EthersError extends Error {}
    };
    return { default: ethers, ...ethers };
  });

  // Mock db/pool
  const mockPool = {
    safeQuery: jest.fn().mockResolvedValue({ rows: [] }),
    withTransaction: jest.fn(async (fn) => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn()
      };
      return fn(mockClient);
    }),
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn()
    }),
    end: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    totalCount: 10,
    idleCount: 5,
    waitingCount: 0
  };

  await jest.unstable_mockModule('../../db/pool.js', () => ({
    safeQuery: mockPool.safeQuery,
    withTransaction: mockPool.withTransaction,
    pool: mockPool,
    readPool: null,
    healthCheck: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1, poolTotal: 10, poolIdle: 5, poolWaiting: 0, readPool: null }),
    shutdown: jest.fn().mockResolvedValue(undefined)
  }));

  // Mock uuid
  await jest.unstable_mockModule('uuid', () => ({
    v4: () => '00000000-0000-4000-8000-000000000000',
    v5: () => '00000000-0000-5000-8000-000000000000',
    default: { v4: () => '00000000-0000-4000-8000-000000000000' }
  }));

  // Mock pg
  await jest.unstable_mockModule('pg', () => ({
    Pool: jest.fn().mockImplementation(() => mockPool),
    Client: jest.fn().mockImplementation(() => ({
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn()
    })),
    types: {
      setTypeParser: jest.fn(),
      getTypeParser: jest.fn()
    },
    defaults: {},
    default: { Pool: jest.fn().mockImplementation(() => mockPool) }
  }));

  // Mock razorpay
  await jest.unstable_mockModule('razorpay', () => ({
    default: jest.fn().mockImplementation(() => ({
      orders: { create: jest.fn().mockResolvedValue({ id: 'order_test', amount: 10000, currency: 'INR', status: 'created' }) },
      payments: { fetch: jest.fn().mockResolvedValue({ id: 'pay_test', status: 'captured', amount: 10000, currency: 'INR' }) },
      utils: { verifyPaymentSignature: jest.fn().mockReturnValue(true) }
    }))
  }));

  // Global test utilities
  global.testUtils = {
    mockProvider: {
      getBlockNumber: jest.fn().mockResolvedValue(12345678),
      getBlock: jest.fn().mockResolvedValue({ timestamp: Math.floor(Date.now() / 1000) })
    },
    mockWallet: {
      address: '0x1234567890123456789012345678901234567890',
      signTransaction: jest.fn(),
      sendTransaction: jest.fn().mockResolvedValue({ hash: '0xtxhash', wait: jest.fn().mockResolvedValue({ status: 1 }) })
    }
  };
});

// Silence console noise in tests
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

beforeAll(() => {
  console.error = (...args) => {
    if (args[0]?.includes?.('act(...)') || args[0]?.includes?.('Warning:')) return;
    originalConsoleError.apply(console, args);
  };
  console.warn = (...args) => {
    if (args[0]?.includes?.('act(...)') || args[0]?.includes?.('Warning:')) return;
    originalConsoleWarn.apply(console, args);
  };
});

afterAll(() => {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
});