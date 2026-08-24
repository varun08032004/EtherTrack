// Test utilities for ESM module mocking

import { jest } from '@jest/globals';

/**
 * Mock a module using Jest's unstable_mockModule for ESM
 * Usage:
 *   const { MyService } = await mockModule('../../services/my-service.js', {
 *     MyService: jest.fn().mockImplementation(() => ({ ... }))
 *   });
 */
export async function mockModule(modulePath: string, mockExports: Record<string, any>) {
  await jest.unstable_mockModule(modulePath, () => mockExports);
  const module = await import(modulePath);
  return module;
}

/**
 * Create a mock for a service with default implementations
 */
export function createServiceMock<T extends Record<string, any>>(methods: Partial<T> = {}): T {
  const mock = {} as T;
  for (const key of Object.keys(methods)) {
    mock[key] = jest.fn().mockResolvedValue(undefined);
  }
  return mock;
}

/**
 * Create a mock database pool
 */
export function createMockPool() {
  return {
    safeQuery: jest.fn(),
    withTransaction: jest.fn((fn) => fn({
      query: jest.fn()
    })),
    healthCheck: jest.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
    shutdown: jest.fn().mockResolvedValue(undefined)
  };
}

/**
 * Create a mock custody adapter
 */
export function createMockCustodyAdapter(type: 'onchain' | 'ledger') {
  return {
    custodyType: type,
    getOwnedBalance: jest.fn().mockResolvedValue(1000),
    getReservedBalance: jest.fn().mockResolvedValue(0),
    getAvailableBalance: jest.fn().mockResolvedValue(1000),
    reserveCredits: jest.fn().mockResolvedValue(undefined),
    releaseReservation: jest.fn().mockResolvedValue(undefined),
    executeSell: jest.fn().mockResolvedValue({ status: 'CONFIRMED' }),
    executeBuy: jest.fn().mockResolvedValue({ status: 'CONFIRMED' }),
    retireCredits: jest.fn().mockResolvedValue({ txHash: '0xmock', logIndex: 0 }),
    verifyBalance: jest.fn().mockResolvedValue({ matches: true, onChain: 1000, db: 1000 }),
    getAssetInfo: jest.fn().mockResolvedValue(null)
  };
}

/**
 * Create a mock payment service
 */
export function createMockPaymentService() {
  return {
    createRazorpayOrder: jest.fn().mockResolvedValue({ orderId: 'order_mock', amount: 100000, currency: 'INR' }),
    verifyRazorpayPayment: jest.fn().mockResolvedValue({ verified: true, payment: { status: 'CAPTURED' } }),
    captureRazorpayPayment: jest.fn().mockResolvedValue({ status: 'SETTLED' }),
    refundRazorpayPayment: jest.fn().mockResolvedValue({ status: 'REFUNDED' }),
    authorizeInrWalletPayment: jest.fn().mockResolvedValue(undefined),
    captureInrWalletPayment: jest.fn().mockResolvedValue(undefined),
    recordEthPayment: jest.fn().mockResolvedValue(undefined),
    confirmEthPayment: jest.fn().mockResolvedValue(undefined),
    getPayment: jest.fn().mockResolvedValue(null),
    getPaymentAttempts: jest.fn().mockResolvedValue([]),
    getPaymentsByTrade: jest.fn().mockResolvedValue([])
  };
}

/**
 * Create a mock fee service
 */
export function createMockFeeService() {
  return {
    calculateFees: jest.fn().mockImplementation((grossAmount, buyerFeeBps, sellerFeeBps) => {
      const buyerFee = Math.floor((grossAmount * buyerFeeBps) / 10000);
      const sellerFee = Math.floor((grossAmount * sellerFeeBps) / 10000);
      const totalFee = buyerFee + sellerFee;
      const gst = Math.round(totalFee * 0.18);
      const buyerTax = Math.floor(gst / 2);
      const sellerTax = gst - buyerTax;
      return {
        buyerFee,
        sellerFee,
        buyerTax: { totalTax: buyerTax, cgst: buyerTax / 2, sgst: buyerTax / 2, igst: 0, taxRate: 0.18, taxType: 'CGST_SGST', hsCode: '999799', explanation: '' },
        sellerTax: { totalTax: sellerTax, cgst: sellerTax / 2, sgst: sellerTax / 2, igst: 0, taxRate: 0.18, taxType: 'CGST_SGST', hsCode: '999799', explanation: '' },
        buyerTotalDebit: grossAmount + buyerFee + Math.floor(gst / 2),
        sellerNetCredit: grossAmount - sellerFee - Math.ceil(gst / 2),
        platformRevenue: buyerFee + sellerFee,
        platformTaxLiability: Math.round((buyerFee + sellerFee) * 0.18)
      };
    }),
    createFeeRecords: jest.fn().mockResolvedValue({ buyerFeeId: 'fee_buyer', sellerFeeId: 'fee_seller' }),
    markFeesCollected: jest.fn().mockResolvedValue(undefined),
    getTradeFees: jest.fn().mockResolvedValue([]),
    getPlatformFees: jest.fn().mockResolvedValue([]),
    getFeeReconciliation: jest.fn().mockResolvedValue({ tradeFeesTotal: 0, platformFeesTotal: 0, mismatch: 0 }),
    getUserFeeSummary: jest.fn().mockResolvedValue({ feesPaidAsBuyer: 0, feesPaidAsSeller: 0, totalTrades: 0 })
  };
}

/**
 * Create a mock event processor
 */
export function createMockEventProcessor() {
  return {
    processEvent: jest.fn().mockResolvedValue(undefined),
    processBlockRange: jest.fn().mockResolvedValue({ processed: 0, failed: 0 })
  };
}

/**
 * Create a mock fee service
 */
export function createMockSettlementEngine() {
  return {
    generateQuote: jest.fn().mockResolvedValue({
      quoteId: 'quote_test',
      listingId: 'listing_test',
      quantity: 100,
      executionPrice: 85000,
      currency: 'INR',
      buyerGross: 8500000,
      buyerFee: 42500,
      buyerTax: 7650,
      buyerTotalDebit: 8542500,
      sellerGross: 8500000,
      sellerFee: 42500,
      sellerTax: 7650,
      sellerNetCredit: 8449850,
      platformRevenue: 85000,
      platformTaxLiability: 15300,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      idempotencyKey: 'quote:test:123'
    }),
    createTradeFromQuote: jest.fn().mockResolvedValue({
      trade_id: 'trade_test',
      listing_id: 'listing_test',
      buyer_id: 'buyer_test',
      seller_id: 'seller_test',
      asset_id: 'asset_test',
      seller_custody_type: 'onchain',
      buyer_custody_type: 'onchain',
      quantity: 100,
      execution_price: 85000,
      currency: 'ETH',
      buyer_gross: 8500000,
      seller_gross: 8500000,
      buyer_fee_bps: 50,
      seller_fee_bps: 50,
      payment_id: 'pay_test',
      credit_transfer_id: 'transfer_test',
      buyer_fee_id: 'fee_buyer_test',
      seller_fee_id: 'fee_seller_test',
      settlement_state: 'CREATED',
      idempotency_key: 'idem_test',
      created_at: new Date(),
      updated_at: new Date()
    }),
    transitionToValidated: jest.fn().mockResolvedValue(undefined),
    transitionToFundsReserved: jest.fn().mockResolvedValue(undefined),
    transitionToCreditsReserved: jest.fn().mockResolvedValue(undefined),
    transitionToSettlementPending: jest.fn().mockResolvedValue(undefined),
    transitionToCreditTransferSubmitted: jest.fn().mockResolvedValue(undefined),
    transitionToCreditTransferConfirmed: jest.fn().mockResolvedValue(undefined),
    transitionToPaymentSettled: jest.fn().mockResolvedValue(undefined),
    transitionToFeesCollected: jest.fn().mockResolvedValue(undefined),
    transitionToSellerPaid: jest.fn().mockResolvedValue(undefined),
    transitionToBuyerCredited: jest.fn().mockResolvedValue(undefined),
    transitionToSettled: jest.fn().mockResolvedValue(undefined),
    compensateFailedTrade: jest.fn().mockResolvedValue(undefined),
    getValidTransitions: (state: string) => {
      const transitions: Record<string, string[]> = {
        'CREATED': ['VALIDATED', 'CANCELLED', 'EXPIRED'],
        'VALIDATED': ['FUNDS_RESERVED', 'CANCELLED', 'EXPIRED'],
        'FUNDS_RESERVED': ['CREDITS_RESERVED', 'FAILED'],
        'CREDITS_RESERVED': ['SETTLEMENT_PENDING', 'FAILED'],
        'SETTLEMENT_PENDING': ['CREDIT_TRANSFER_SUBMITTED', 'FAILED'],
        'CREDIT_TRANSFER_SUBMITTED': ['CREDIT_TRANSFER_CONFIRMED', 'FAILED', 'REQUIRES_RECONCILIATION'],
        'CREDIT_TRANSFER_CONFIRMED': ['PAYMENT_SETTLED', 'FAILED', 'REQUIRES_RECONCILIATION'],
        'PAYMENT_SETTLED': ['FEES_COLLECTED', 'FAILED', 'REQUIRES_RECONCILIATION'],
        'FEES_COLLECTED': ['SELLER_PAID', 'FAILED', 'REQUIRES_RECONCILIATION'],
        'SELLER_PAID': ['BUYER_CREDITED', 'FAILED', 'REQUIRES_RECONCILIATION'],
        'BUYER_CREDITED': ['SETTLED', 'FAILED', 'REQUIRES_RECONCILIATION'],
        'SETTLED': [],
        'FAILED': ['REQUIRES_RECONCILIATION'],
        'CANCELLED': [],
        'EXPIRED': [],
        'REQUIRES_RECONCILIATION': ['SETTLED', 'FAILED'],
      };
      return transitions[state] || [];
    }
  };
}

/**
 * Create a mock credit transfer service
 */
export function createMockCreditTransferService() {
  return {
    executeTransfer: jest.fn().mockResolvedValue([
      { operationId: 'op-1', type: 'LEDGER_SELL', status: 'CONFIRMED' },
      { operationId: 'op-2', type: 'LEDGER_BUY', status: 'CONFIRMED' }
    ]),
    getCreditTransfer: jest.fn().mockResolvedValue(null),
    getTransferOperations: jest.fn().mockResolvedValue([]),
    getTransfersByTrade: jest.fn().mockResolvedValue([])
  };
}

/**
 * Create a mock fee service
 */
export function createMockListingService() {
  return {
    createListing: jest.fn().mockResolvedValue({
      listing_id: 'listing_test',
      position_id: 'pos_test',
      asset_id: 'asset_test',
      seller_id: 'seller_test',
      custody_type: 'onchain',
      quantity: 100,
      remaining_quantity: 100,
      price_per_unit: 85000,
      currency: 'INR',
      buyer_fee_bps: 50,
      seller_fee_bps: 50,
      status: 'active',
      expires_at: null,
      onchain_listing_id: null,
      created_at: new Date(),
      updated_at: new Date()
    }),
    cancelListing: jest.fn().mockResolvedValue({ releasedQuantity: 50 }),
    updateListingPrice: jest.fn().mockResolvedValue({ listing_id: 'listing_test', price_per_unit: 90000 }),
    getListing: jest.fn().mockResolvedValue(null),
    getMarketListings: jest.fn().mockResolvedValue({ data: [], nextCursor: null, hasMore: false }),
    getSellerListings: jest.fn().mockResolvedValue([]),
    expireListings: jest.fn().mockResolvedValue(0)
  };
}

/**
 * Create a mock trade service
 */
export function createMockTradeService() {
  return {
    getQuote: jest.fn().mockResolvedValue({
      quoteId: 'quote_test',
      listingId: 'listing_test',
      quantity: 100,
      executionPrice: 85000,
      currency: 'INR',
      buyerGross: 8500000,
      buyerFee: 42500,
      buyerTax: 7650,
      buyerTotalDebit: 8542500,
      sellerGross: 8500000,
      sellerFee: 42500,
      sellerTax: 7650,
      sellerNetCredit: 8449850,
      platformRevenue: 85000,
      platformTaxLiability: 15300,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      idempotencyKey: 'quote:test:123'
    }),
    createTrade: jest.fn().mockResolvedValue({
      trade_id: 'trade_test',
      listing_id: 'listing_test',
      buyer_id: 'buyer_test',
      seller_id: 'seller_test',
      asset_id: 'asset_test',
      seller_custody_type: 'onchain',
      buyer_custody_type: 'onchain',
      quantity: 100,
      execution_price: 85000,
      currency: 'ETH',
      buyer_gross: 8500000,
      seller_gross: 8500000,
      buyer_fee_bps: 50,
      seller_fee_bps: 50,
      payment_id: 'pay_test',
      credit_transfer_id: 'transfer_test',
      buyer_fee_id: 'fee_buyer_test',
      seller_fee_id: 'fee_seller_test',
      settlement_state: 'CREATED',
      idempotency_key: 'idem_test',
      created_at: new Date(),
      updated_at: new Date()
    }),
    getTrade: jest.fn().mockResolvedValue(null),
    getTradeHistory: jest.fn().mockResolvedValue({ data: [], nextCursor: null, hasMore: false }),
    getTradeStats: jest.fn().mockResolvedValue({
      totalVolumeINR: 0,
      totalTrades: 0,
      avgPriceINR: 0,
      totalPlatformFees: 0,
      totalGSTCollected: 0,
      tradesOnChain: 0,
      ethRate: 280000
    }),
    verifyTradeOnChain: jest.fn().mockResolvedValue({ onChainVerification: { found: true } })
  };
}