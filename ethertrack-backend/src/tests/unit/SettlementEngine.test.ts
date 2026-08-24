// Unit Tests - Settlement State Machine

import { SettlementEngine } from '../../services/settlement/SettlementEngine.ts';
import { defaultTaxCalculator } from '../../domain/types.ts';

describe('SettlementEngine - State Machine', () => {
  let engine;

  beforeEach(() => {
    engine = new SettlementEngine();
  });

  describe('Valid State Transitions', () => {
    it('should define all valid transitions from CREATED', () => {
      const transitions = engine.getValidTransitions('CREATED');
      expect(transitions).toContain('VALIDATED');
      expect(transitions).toContain('CANCELLED');
      expect(transitions).toContain('EXPIRED');
      expect(transitions).not.toContain('SETTLED');
    });

    it('should define all valid transitions from VALIDATED', () => {
      const transitions = engine.getValidTransitions('VALIDATED');
      expect(transitions).toContain('FUNDS_RESERVED');
      expect(transitions).toContain('CANCELLED');
      expect(transitions).toContain('EXPIRED');
    });

    it('should define all valid transitions from FUNDS_RESERVED', () => {
      const transitions = engine.getValidTransitions('FUNDS_RESERVED');
      expect(transitions).toContain('CREDITS_RESERVED');
      expect(transitions).toContain('FAILED');
    });

    it('should define all valid transitions from CREDITS_RESERVED', () => {
      const transitions = engine.getValidTransitions('CREDITS_RESERVED');
      expect(transitions).toContain('SETTLEMENT_PENDING');
      expect(transitions).toContain('FAILED');
    });

    it('should define all valid transitions from SETTLEMENT_PENDING', () => {
      const transitions = engine.getValidTransitions('SETTLEMENT_PENDING');
      expect(transitions).toContain('CREDIT_TRANSFER_SUBMITTED');
      expect(transitions).toContain('FAILED');
    });

    it('should define all valid transitions from CREDIT_TRANSFER_SUBMITTED', () => {
      const transitions = engine.getValidTransitions('CREDIT_TRANSFER_SUBMITTED');
      expect(transitions).toContain('CREDIT_TRANSFER_CONFIRMED');
      expect(transitions).toContain('FAILED');
      expect(transitions).toContain('REQUIRES_RECONCILIATION');
    });

    it('should define all valid transitions from CREDIT_TRANSFER_CONFIRMED', () => {
      const transitions = engine.getValidTransitions('CREDIT_TRANSFER_CONFIRMED');
      expect(transitions).toContain('PAYMENT_SETTLED');
      expect(transitions).toContain('FAILED');
      expect(transitions).toContain('REQUIRES_RECONCILIATION');
    });

    it('should define all valid transitions from PAYMENT_SETTLED', () => {
      const transitions = engine.getValidTransitions('PAYMENT_SETTLED');
      expect(transitions).toContain('FEES_COLLECTED');
      expect(transitions).toContain('FAILED');
      expect(transitions).toContain('REQUIRES_RECONCILIATION');
    });

    it('should define all valid transitions from FEES_COLLECTED', () => {
      const transitions = engine.getValidTransitions('FEES_COLLECTED');
      expect(transitions).toContain('SELLER_PAID');
      expect(transitions).toContain('FAILED');
      expect(transitions).toContain('REQUIRES_RECONCILIATION');
    });

    it('should define all valid transitions from SELLER_PAID', () => {
      const transitions = engine.getValidTransitions('SELLER_PAID');
      expect(transitions).toContain('BUYER_CREDITED');
      expect(transitions).toContain('FAILED');
      expect(transitions).toContain('REQUIRES_RECONCILIATION');
    });

    it('should define all valid transitions from BUYER_CREDITED', () => {
      const transitions = engine.getValidTransitions('BUYER_CREDITED');
      expect(transitions).toContain('SETTLED');
      expect(transitions).toContain('FAILED');
      expect(transitions).toContain('REQUIRES_RECONCILIATION');
    });

    it('should have no transitions from SETTLED', () => {
      const transitions = engine.getValidTransitions('SETTLED');
      expect(transitions).toHaveLength(0);
    });

    it('should allow REQUIRES_RECONCILIATION to go to SETTLED or FAILED', () => {
      const transitions = engine.getValidTransitions('REQUIRES_RECONCILIATION');
      expect(transitions).toContain('SETTLED');
      expect(transitions).toContain('FAILED');
    });
  });

  describe('Quote Generation', () => {
    it('should generate quote with correct financial breakdown', () => {
      const quote = createMockQuote();
      
      expect(quote.buyerGross).toBe(quote.quantity * quote.executionPrice);
      expect(quote.sellerGross).toBe(quote.buyerGross);
      expect(quote.buyerTotalDebit).toBe(quote.buyerGross + quote.buyerFee + quote.buyerTax);
      expect(quote.sellerNetCredit).toBe(quote.sellerGross - quote.sellerFee - quote.sellerTax);
      expect(quote.platformRevenue).toBe(quote.buyerFee + quote.sellerFee);
      expect(quote.platformTaxLiability).toBe(quote.buyerTax + quote.sellerTax);
    });

    it('should generate unique idempotency key', () => {
      const quote1 = createMockQuote();
      const quote2 = createMockQuote();
      
      expect(quote1.idempotencyKey).not.toBe(quote2.idempotencyKey);
    });

    it('should set expiry to 15 minutes from now', () => {
      const quote = createMockQuote();
      const now = Date.now();
      const fifteenMinutes = 15 * 60 * 1000;
      
      expect(quote.expiresAt.getTime()).toBeGreaterThan(now);
      expect(quote.expiresAt.getTime()).toBeLessThanOrEqual(now + fifteenMinutes + 1000); // small buffer
    });
  });
});

function createMockQuote() {
  return {
    quoteId: 'test-quote-1',
    listingId: 'test-listing-1',
    quantity: 100,
    executionPrice: 85000, // ₹850.00 per credit
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
    idempotencyKey: 'quote:test:1234567890'
  };
}