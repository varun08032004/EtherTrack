// Adversarial Test: Concurrent Settlement - Double Spend Prevention
// Tests that concurrent buy attempts for the same credits cannot both succeed

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { createTestUsers, cleanupTestUsers, setupTestListing, teardownTestListing } from '../utils/test-utils.js';
import { SettlementEngine } from '../../../src/services/settlement/SettlementEngine.js';
import { TradeService } from '../../../src/services/trade/TradeService.js';
import { ListingService } from '../../../src/services/listing/ListingService.js';
import { safeQuery as query } from '../../../db/pool.js';

describe('Concurrent Settlement - Double Spend Prevention', () => {
  let buyer1: any, buyer2: any, seller: any;
  let listing: any;
  let settlementEngine: SettlementEngine;
  let tradeService: TradeService;
  let listingService: ListingService;

  beforeAll(async () => {
    const users = await createTestUsers(3);
    buyer1 = users[0];
    buyer2 = users[1];
    seller = users[2];

    listing = await setupTestListing(seller, { quantity: 10, price: 100 });
    
    settlementEngine = new SettlementEngine();
    listingService = new ListingService();
    tradeService = new TradeService(settlementEngine, listingService);
  });

  afterAll(async () => {
    await teardownTestListing(listing.listingId);
    await cleanupTestUsers([buyer1, buyer2, seller]);
  });

  it('should prevent double-spend when two buyers simultaneously purchase the last available credits', async () => {
    const availableBefore = await query(
      `SELECT available_credits FROM carbon_batches WHERE id = $1`,
      [listing.batchId]
    );
    expect(availableBefore.rows[0].available_credits).toBe(10);

    // Both buyers attempt to buy 6 credits each (total 12 > 10 available)
    const promises = [
      tradeService.createTrade(listing.listingId, 6, buyer1.id, 'inr_wallet'),
      tradeService.createTrade(listing.listingId, 6, buyer2.id, 'inr_wallet')
    ];

    const results = await Promise.allSettled(promises);
    
    // Exactly one should succeed, one should fail
    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');
    
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    
    // Verify final available credits = 4 (10 - 6)
    const availableAfter = await query(
      `SELECT available_credits FROM carbon_batches WHERE id = $1`,
      [listing.batchId]
    );
    expect(availableAfter.rows[0].available_credits).toBe(4);
  });

  it('should handle rapid sequential purchases correctly', async () => {
    // Create a new listing with 20 credits
    const listing2 = await setupTestListing(seller, { quantity: 20, price: 50 });
    
    // Sequential rapid purchases
    const results = [];
    for (let i = 0; i < 5; i++) {
      const result = await tradeService.createTrade(listing2.listingId, 4, buyer1.id, 'inr_wallet');
      results.push(result);
    }
    
    // All 5 should succeed (5 * 4 = 20)
    expect(results.every(r => r.success)).toBe(true);
    
    // Available should be 0
    const available = await query(
      `SELECT available_credits FROM carbon_batches WHERE id = $1`,
      [listing2.batchId]
    );
    expect(available.rows[0].available_credits).toBe(0);
    
    // 6th attempt should fail
    await expect(
      tradeService.createTrade(listing2.listingId, 1, buyer1.id, 'inr_wallet')
    ).rejects.toThrow('Insufficient');
  });
});