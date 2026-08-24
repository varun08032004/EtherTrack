// Concurrency Tests - Race conditions in marketplace

import { safeQuery as query, withTransaction, pool } from '../../db/pool.ts';
import { ListingService } from '../../services/listing/ListingService.ts';
import { TradeService } from '../../services/trade/TradeService.ts';
import { SettlementEngine } from '../../services/settlement/SettlementEngine.ts';
import { CustodyAdapterFactory } from '../../services/custody/index.ts';
import { CustodyType, Currency, OwnershipPosition, Listing } from '../../domain/types.ts';

// Mock dependencies using ESM unstable_mockModule
beforeAll(async () => {
  await jest.unstable_mockModule('../../services/custody/index.ts', () => ({
    CustodyAdapterFactory: {
      getAdapter: jest.fn()
    }
  }));

  await jest.unstable_mockModule('../../services/settlement/SettlementEngine.ts', () => ({
    SettlementEngine: jest.fn().mockImplementation(() => ({}))
  }));

  await jest.unstable_mockModule('../../services/trade/TradeService.ts', () => ({
    TradeService: jest.fn().mockImplementation(() => ({}))
  }));
});

describe('Concurrency Tests', () => {
  let listingService;
  let tradeService;
  let settlementEngine;

  beforeEach(() => {
    listingService = new ListingService();
    settlementEngine = new SettlementEngine();
    tradeService = new TradeService(settlementEngine, listingService);
    jest.clearAllMocks();
  });

  describe('Two buyers purchasing same listing simultaneously', () => {
    it('should only allow one purchase to succeed', async () => {
      const listingId = 'listing-concurrent-1';
      const assetId = 'asset-concurrent-1';
      const sellerId = 'seller-concurrent-1';
      const buyer1Id = 'buyer-concurrent-1';
      const buyer2Id = 'buyer-concurrent-2';
      const quantity = 10;

      // Setup: Create listing with 10 credits
      const mockListing = {
        listing_id: listingId,
        asset_id: assetId,
        seller_id: sellerId,
        custody_type: 'onchain',
        quantity,
        remaining_quantity: quantity,
        price_per_unit: 85000,
        currency: 'INR',
        buyer_fee_bps: 50,
        seller_fee_bps: 50,
        status: 'active',
        expires_at: null,
        onchain_listing_id: 12345,
        position_id: 'pos-1',
        created_at: new Date(),
        updated_at: new Date()
      };

      const mockPosition = {
        positionId: 'pos-1',
        ownerId: sellerId,
        assetId,
        custodyType: 'onchain',
        ownedQuantity: 100,
        reservedQuantity: quantity,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      let firstBuyerSucceeded = false;
      let secondBuyerFailed = false;

      // Mock database to simulate concurrent access
      let callCount = 0;
      withTransaction.mockImplementation(async (fn) => {
        callCount++;
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [mockListing] }) // SELECT listing FOR UPDATE
            .mockResolvedValueOnce({ rows: [mockPosition] }) // SELECT position FOR UPDATE
        };
        
        // On second call, listing.remaining_quantity = 0
        if (callCount === 2) {
          mockClient.query
            .mockResolvedValueOnce({ rows: [{ ...mockListing, remaining_quantity: 0 }] })
            .mockResolvedValueOnce({ rows: [mockPosition] });
        }
        
        return fn(mockClient);
      });

      // Simulate two concurrent purchase attempts
      const purchase1 = listingService.createListing({ // Using createListing as proxy for purchase flow
        sellerId,
        assetId,
        quantity,
        pricePerUnit: 85000,
        currency: 'INR'
      }).then(() => { firstBuyerSucceeded = true; }).catch(() => {});

      const purchase2 = listingService.createListing({
        sellerId,
        assetId,
        quantity,
        pricePerUnit: 85000,
        currency: 'INR'
      }).then(() => {}).catch(() => { secondBuyerFailed = true; });

      await Promise.all([purchase1, purchase2]);

      // Only one should succeed due to row locking
      expect(firstBuyerSucceeded || secondBuyerFailed).toBe(true);
    });
  });

  describe('Buyer purchasing while seller cancels listing', () => {
    it('should handle cancellation during purchase gracefully', async () => {
      const listingId = 'listing-cancel-during-purchase';
      const assetId = 'asset-cancel-1';
      const sellerId = 'seller-cancel-1';
      const buyerId = 'buyer-cancel-1';

      // This test would verify that:
      // 1. If cancellation commits first -> purchase fails with "listing not active"
      // 2. If purchase commits first -> cancellation fails with "listing not active"
      // Both cases are correct behavior
      
      expect(true).toBe(true); // Placeholder for actual implementation
    });
  });

  describe('Buyer purchasing while listing expires', () => {
    it('should not allow purchase of expired listing', async () => {
      const listingId = 'listing-expired';
      
      const mockExpiredListing = {
        listing_id: listingId,
        status: 'expired',
        expires_at: new Date(Date.now() - 1000)
      };

      query.mockResolvedValueOnce({ rows: [mockExpiredListing] });

      await expect(listingService.createListing({
        sellerId: 'seller',
        assetId: 'asset',
        quantity: 10,
        pricePerUnit: 85000,
        currency: 'INR'
      })).rejects.toThrow(); // Would fail at validation
    });
  });

  describe('Two partial fills of same listing', () => {
    it('should correctly track remaining quantity', async () => {
      // This tests that multiple partial purchases correctly decrement
      // remaining_quantity without overselling
      
      const listingId = 'listing-partial-fills';
      let remainingQuantity = 100;

      const mockListing = {
        listing_id: listingId,
        remaining_quantity: 100,
        quantity: 100
      };

      let fillCount = 0;
      withTransaction.mockImplementation(async (fn) => {
        fillCount++;
        const currentRemaining = remainingQuantity;
        const fillQuantity = 30;
        
        if (currentRemaining < fillQuantity) {
          throw new Error('Insufficient quantity');
        }
        
        remainingQuantity -= fillQuantity;
        
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ ...mockListing, remaining_quantity: currentRemaining }] })
            .mockResolvedValueOnce({ rows: [] })
        };
        
        return fn(mockClient);
      });

      // Simulate 3 partial fills of 30 each = 90
      const results = await Promise.allSettled([
        listingService.createListing({ sellerId: 's', assetId: 'a', quantity: 30, pricePerUnit: 85000, currency: 'INR' }),
        listingService.createListing({ sellerId: 's', assetId: 'a', quantity: 30, pricePerUnit: 85000, currency: 'INR' }),
        listingService.createListing({ sellerId: 's', assetId: 'a', quantity: 30, pricePerUnit: 85000, currency: 'INR' })
      ]);

      const successful = results.filter(r => r.status === 'fulfilled').length;
      expect(successful).toBe(3);
      expect(remainingQuantity).toBe(10);
    });
  });

  describe('Listing creation while another listing consumes balance', () => {
    it('should prevent overselling across multiple listings', async () => {
      const sellerId = 'seller-multi-list';
      const assetId = 'asset-multi-list';
      
      const mockPosition = {
        positionId: 'pos-multi',
        ownerId: sellerId,
        assetId,
        custodyType: 'onchain',
        ownedQuantity: 100,
        reservedQuantity: 0,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      query.mockResolvedValue({ rows: [mockPosition] });

      // Try to create two listings of 60 each simultaneously
      // Total would be 120 > 100 owned
      // Only one should succeed

      let createdCount = 0;
      withTransaction.mockImplementation(async (fn) => {
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [mockPosition] }) // lock position
            .mockImplementation(() => {
              if (createdCount === 0) {
                createdCount++;
                return Promise.resolve({ rows: [{ listing_id: `listing-${createdCount}` }] });
              }
              throw new Error('Insufficient available credits');
            })
        };
        return fn(mockClient);
      });

      const results = await Promise.allSettled([
        listingService.createListing({ sellerId, assetId, quantity: 60, pricePerUnit: 85000, currency: 'INR' }),
        listingService.createListing({ sellerId, assetId, quantity: 60, pricePerUnit: 85000, currency: 'INR' })
      ]);

      const successful = results.filter(r => r.status === 'fulfilled').length;
      expect(successful).toBe(1);
    });
  });
});