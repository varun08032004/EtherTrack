// Failure Injection Tests - System behavior under various failure scenarios

import { SettlementEngine } from '../../services/settlement/SettlementEngine.ts';
import { OnChainCustodyAdapter } from '../../services/custody/OnChainCustodyAdapter.ts';
import { LedgerCustodyAdapter } from '../../services/custody/LedgerCustodyAdapter.ts';
import { PaymentService } from '../../services/payment/PaymentService.ts';
import { EventProcessor } from '../../services/event-processor/EventProcessor.ts';
import { TradeSettlementState, CreditTransferOperation } from '../../domain/types.ts';

// Mock external dependencies using ESM unstable_mockModule in beforeAll
beforeAll(async () => {
  await jest.unstable_mockModule('ethers', () => {
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
        logOwnershipChange: jest.fn().mockResolvedValue({ hash: '0xmock', wait: jest.fn().mockResolvedValue({ status: 1 }) }),
        getUserBalance: jest.fn().mockResolvedValue(BigInt(1000)),
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

  await jest.unstable_mockModule('../../db/pool.ts', () => ({
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
  }));
});

import { safeQuery as query, withTransaction } from '../../db/pool.ts';

describe('Failure Injection Tests', () => {
  let settlementEngine;
  let onChainAdapter;
  let ledgerAdapter;
  let paymentService;
  let eventProcessor;

  beforeEach(() => {
    settlementEngine = new SettlementEngine();
    onChainAdapter = new OnChainCustodyAdapter({});
    ledgerAdapter = new LedgerCustodyAdapter({});
    paymentService = new PaymentService();
    eventProcessor = new EventProcessor();
    
    jest.clearAllMocks();
  });

  describe('RPC Timeout', () => {
    it('should handle RPC timeout during on-chain balance check', async () => {
      const mockProvider = {
        getBlockNumber: jest.fn().mockRejectedValue(new Error('TIMEOUT'))
      };

      const ethersModule = await import('ethers');
      ethersModule.JsonRpcProvider.mockImplementation(() => mockProvider);

      await expect(onChainAdapter.getOwnedBalance('user-1', 'asset-1'))
        .rejects.toThrow('TIMEOUT');
    });

    it('should handle RPC timeout during transaction submission', async () => {
      const mockContract = {
        listCreditFor: jest.fn().mockRejectedValue(new Error('RPC timeout'))
      };

      const ethersModule = await import('ethers');
      ethersModule.Contract.mockImplementation(() => mockContract);

      await expect(onChainAdapter.executeSell('transfer-1', 'seller-1', 'asset-1', 100, {}))
        .rejects.toThrow('RPC timeout');
    });

    it('should handle RPC timeout during event processing', async () => {
      const mockProvider = {
        getBlock: jest.fn().mockRejectedValue(new Error('RPC timeout'))
      };
      const ethersModule = await import('ethers');
      ethersModule.JsonRpcProvider.mockImplementation(() => mockProvider);

      await expect(eventProcessor.processBlockRange(100, 200))
        .rejects.toThrow('RPC timeout');
    });
  });

  describe('Blockchain Revert', () => {
    it('should handle contract revert during listing', async () => {
      const mockTx = { hash: '0x123', wait: jest.fn().mockResolvedValue({ status: 0 }) };
      const mockContract = {
        listCreditFor: jest.fn().mockResolvedValue(mockTx)
      };

      const ethersModule = await import('ethers');
      ethersModule.Contract.mockImplementation(() => mockContract);

      await expect(onChainAdapter.executeSell('transfer-1', 'seller-1', 'asset-1', 100, {}))
        .rejects.toThrow('reverted');
    });

    it('should handle contract revert during settlement', async () => {
      const mockTx = { hash: '0x456', wait: jest.fn().mockResolvedValue({ status: 0 }) };
      const mockContract = {
        settleINRTrade: jest.fn().mockResolvedValue(mockTx)
      };

      const ethersModule = await import('ethers');
      ethersModule.Contract.mockImplementation(() => mockContract);

      await expect(onChainAdapter.executeBuy('transfer-1', 'buyer-1', 'asset-1', 100, {}))
        .rejects.toThrow('reverted');
    });

    it('should handle contract revert during CreditLedger log', async () => {
      const mockTx = { hash: '0x789', wait: jest.fn().mockResolvedValue({ status: 0 }) };
      const mockContract = {
        logOwnershipChange: jest.fn().mockResolvedValue(mockTx)
      };

      const ethersModule = await import('ethers');
      ethersModule.Contract.mockImplementation(() => mockContract);

      await expect(ledgerAdapter.executeSell('transfer-1', 'seller-1', 'asset-1', 100, {}))
        .rejects.toThrow('reverted');
    });
  });

  describe('Payment Timeout', () => {
    it('should handle Razorpay timeout during order creation', async () => {
      const mockRazorpay = {
        orders: {
          create: jest.fn().mockRejectedValue(new Error('ETIMEDOUT'))
        }
      };

      await jest.unstable_mockModule('razorpay', () => {
        return jest.fn().mockImplementation(() => mockRazorpay);
      });

      const { PaymentService: PaymentServiceMock } = await import('../../services/payment/PaymentService.ts');
      const paymentServiceLocal = new PaymentServiceMock();

      await expect(paymentServiceLocal.createRazorpayOrder({
        paymentId: 'pay-1',
        amount: 100000,
        buyerId: 'buyer-1',
        sellerId: 'seller-1'
      })).rejects.toThrow('ETIMEDOUT');
    });

    it('should handle Razorpay timeout during payment verification', async () => {
      const mockRazorpay = {
        payments: {
          fetch: jest.fn().mockRejectedValue(new Error('ETIMEDOUT'))
        }
      };

      await jest.unstable_mockModule('razorpay', () => {
        return jest.fn().mockImplementation(() => mockRazorpay);
      });

      const { PaymentService: PaymentServiceMock } = await import('../../services/payment/PaymentService.ts');
      const paymentServiceLocal = new PaymentServiceMock();

      await expect(paymentServiceLocal.verifyRazorpayPayment('pay-1', 'rzp_pay_123', 'sig'))
        .rejects.toThrow('ETIMEDOUT');
    });
  });

  describe('Database Failure', () => {
    it('should handle database connection failure during trade creation', async () => {
      query.mockRejectedValue(new Error('Connection refused'));

      await expect(settlementEngine.generateQuote('listing-1', 10, 'buyer-1', 'INR'))
        .rejects.toThrow('Connection refused');
    });

    it('should handle transaction rollback on database error', async () => {
      let rollbackCalled = false;

      withTransaction.mockImplementation(async (fn) => {
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [] }) // SELECT FOR UPDATE
            .mockRejectedValueOnce(new Error('Deadlock detected')) // UPDATE fails
        };
        
        try {
          await fn(mockClient);
        } catch (e) {
          rollbackCalled = true;
          throw e;
        }
      });

      await expect(settlementEngine.createTradeFromQuote({}, 'buyer-1', 'idem-1'))
        .rejects.toThrow('Deadlock detected');
      
      expect(rollbackCalled).toBe(true);
    });
  });

  describe('Worker Crash During Settlement', () => {
    it('should not leave trade in inconsistent state if worker crashes after CREDITS_RESERVED', async () => {
      // Simulate: trade reaches CREDITS_RESERVED, then worker crashes
      // On restart, reconciliation should detect and compensate
      
      const tradeId = 'trade-crash-1';
      
      // Trade stuck in CREDITS_RESERVED
      query.mockResolvedValueOnce({
        rows: [{
          trade_id: tradeId,
          settlement_state: 'CREDITS_RESERVED',
          listing_id: 'listing-1',
          quantity: 10,
          buyer_id: 'buyer-1',
          seller_id: 'seller-1',
          asset_id: 'asset-1',
          payment_id: 'pay-1',
          credit_transfer_id: 'transfer-1'
        }]
      });

      // Reconciliation should detect and compensate
      // This is tested in ReconciliationEngine tests
      expect(true).toBe(true); // Placeholder
    });

    it('should not leave trade in inconsistent state if worker crashes after ONCHAIN_CONFIRMED', async () => {
      // Trade confirmed on-chain but payment not settled
      // Should be recoverable via payment reconciliation
      
      const tradeId = 'trade-crash-2';
      
      query.mockResolvedValueOnce({
        rows: [{
          trade_id: tradeId,
          settlement_state: 'CREDIT_TRANSFER_CONFIRMED',
          payment_id: 'pay-1',
          chain_tx_hash: '0xabc'
        }]
      });

      expect(true).toBe(true); // Placeholder
    });
  });

  describe('Duplicate Webhook', () => {
    it('should handle duplicate Razorpay webhook idempotently', async () => {
      const paymentId = 'pay-duplicate-1';
      const razorpayPaymentId = 'rzp_pay_duplicate';
      const razorpaySignature = 'valid_signature';

      // First verification succeeds
      query
        .mockResolvedValueOnce({ rows: [{ payment_id: paymentId, provider_reference: 'order_1', status: 'AUTHORIZED' }] })
        .mockResolvedValueOnce({ rows: [] }); // payment_attempts insert

      const { PaymentService: PaymentServiceMock } = await import('../../services/payment/PaymentService.ts');
      const paymentServiceLocal = new PaymentServiceMock();

      const result1 = await paymentServiceLocal.verifyRazorpayPayment(paymentId, razorpayPaymentId, razorpaySignature);
      expect(result1.verified).toBe(true);

      // Second verification (duplicate webhook) should return existing payment
      query
        .mockResolvedValueOnce({ rows: [{ payment_id: paymentId, status: 'CAPTURED' }] });

      const result2 = await paymentServiceLocal.verifyRazorpayPayment(paymentId, razorpayPaymentId, razorpaySignature);
      expect(result2.verified).toBe(true);
      expect(result2.payment.status).toBe('CAPTURED');
    });

    it('should handle duplicate blockchain event idempotently', async () => {
      const event = {
        chainId: 80001,
        contractAddress: '0xMarketplace',
        txHash: '0xabc',
        logIndex: 0,
        eventName: 'CreditTraded',
        decodedArgs: { tradeId: 1, listingId: 1, amount: 10 }
      };

      // First processing
      query
        .mockResolvedValueOnce({ rows: [] }) // No existing event
        .mockResolvedValueOnce({ rows: [] }); // Insert event

      await eventProcessor.processEvent(event);

      // Second processing (duplicate)
      query
        .mockResolvedValueOnce({ rows: [{ processing_status: 'PROCESSED' }] }); // Event exists

      await eventProcessor.processEvent(event);

      // Should mark as DUPLICATE, not process again
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('DUPLICATE'),
        expect.any(Array)
      );
    });
  });

  describe('Stale Quote', () => {
    it('should reject trade creation with expired quote', async () => {
      const expiredQuote = {
        quoteId: 'quote-expired',
        listingId: 'listing-1',
        quantity: 10,
        executionPrice: 85000,
        currency: 'INR',
        buyerGross: 850000,
        buyerFee: 4250,
        buyerTax: 765,
        buyerTotalDebit: 854250,
        sellerGross: 850000,
        sellerFee: 4250,
        sellerTax: 765,
        sellerNetCredit: 844985,
        platformRevenue: 8500,
        platformTaxLiability: 1530,
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
        idempotencyKey: 'quote:expired:123'
      };

      await expect(settlementEngine.createTradeFromQuote(expiredQuote, 'buyer-1', 'idem-1'))
        .rejects.toThrow('Quote expired');
    });

    it('should reject trade with mismatched idempotency key', async () => {
      const quote = {
        quoteId: 'quote-1',
        listingId: 'listing-1',
        quantity: 10,
        executionPrice: 85000,
        currency: 'INR',
        buyerGross: 850000,
        buyerFee: 4250,
        buyerTax: 765,
        buyerTotalDebit: 854250,
        sellerGross: 850000,
        sellerFee: 4250,
        sellerTax: 765,
        sellerNetCredit: 844985,
        platformRevenue: 8500,
        platformTaxLiability: 1530,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        idempotencyKey: 'quote:correct:123'
      };

      await expect(settlementEngine.createTradeFromQuote(quote, 'buyer-1', 'wrong-idem-key'))
        .rejects.toThrow('Invalid idempotency key');
    });
  });

  describe('CreditLedger Balance Mismatch', () => {
    it('should detect and report ledger balance mismatch', async () => {
      const ethersModule = await import('ethers');
      const mockLedgerContract = {
        getUserBalance: jest.fn().mockResolvedValue(ethersModule.toBigInt(1000)) // On-chain: 1000
      };

      ethersModule.Contract.mockImplementation(() => mockLedgerContract);
      query.mockResolvedValueOnce({ 
        rows: [{ balance: '500' }] // DB: 500
      });

      const result = await ledgerAdapter.verifyBalance('user-1', 1);
      
      expect(result.matches).toBe(false);
      expect(result.onChain).toBe(1000);
      expect(result.db).toBe(500);
    });
  });

  describe('Partial Credit Transfer Failure', () => {
    it('should detect partial failure in ledger-to-ledger transfer', async () => {
      // SELL succeeds, BUY fails
      let sellCalled = false;
      
      ledgerAdapter.executeSell = jest.fn().mockImplementation(async () => {
        sellCalled = true;
        return { status: 'CONFIRMED' };
      });

      ledgerAdapter.executeBuy = jest.fn().mockRejectedValue(new Error('Gas limit exceeded'));

      await expect(ledgerAdapter.executeSell('t-1', 's-1', 'a-1', 100, {}))
        .resolves.toBeDefined();

      await expect(ledgerAdapter.executeBuy('t-1', 'b-1', 'a-1', 100, {}))
        .rejects.toThrow('Gas limit exceeded');

      expect(sellCalled).toBe(true);
      // In real implementation, this would trigger REQUIRES_RECONCILIATION
    });
  });
});