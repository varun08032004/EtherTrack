// Adversarial Test: Idempotency Replay
// Tests that duplicate requests cannot create duplicate settlements

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ethers } from 'ethers';
import { createTestUsers, cleanupTestUsers } from '../utils/test-utils.js';
import { setupTestEnvironment } from '../utils/test-env.js';
import { TradeService } from '../../../src/services/trade/TradeService.js';
import { SettlementEngine } from '../../../src/services/settlement/SettlementEngine.js';
import { ListingService } from '../../../src/services/listing/ListingService.js';

describe('Idempotency Replay Protection', () => {
  let buyer: any, seller: any;
  let listing: any;
  let tradeService: TradeService;
  let settlementEngine: SettlementEngine;
  let listingService: ListingService;

  beforeAll(async () => {
    const env = await setupTestEnvironment();
    const users = await createTestUsers(2);
    buyer = users[0];
    seller = users[1];

    listing = await setupTestListing(seller, { quantity: 10, price: 100 });
    
    settlementEngine = new SettlementEngine();
    listingService = new ListingService();
    tradeService = new TradeService(settlementEngine, listingService);
  });

  it('should reject duplicate wallet-checkout with same idempotency key', async () => {
    const idempotencyKey = `wallet:${buyer.id}:${listing.listingId}:5:${Date.now()}:test123`;
    
    // First request
    const result1 = await tradeService.walletCheckout({
      listingId: listing.listingId,
      quantity: 5,
      pricePerCreditINR: 100,
      idempotencyKey
    });
    expect(result1.success).toBe(true);
    const tradeId1 = result1.tradeId;

    // Second request with same idempotency key
    const result2 = await tradeService.walletCheckout({
      listingId: listing.listingId,
      quantity: 5,
      pricePerCreditINR: 100,
      idempotencyKey
    });
    
    // Should return same trade, not create new one
    expect(result2.success).toBe(true);
    expect(result2.tradeId).toBe(tradeId1);
    expect(result2.idempotent).toBe(true);
  });

  it('should reject duplicate checkout-verify with same idempotency key', async () => {
    // Create checkout order
    const order = await tradeService.checkoutOrder({
      listingId: listing.listingId,
      quantity: 3,
      pricePerCreditINR: 100
    });

    const idempotencyKey = `razorpay:${buyer.id}:${order.orderId}:${Date.now()}:test456`;

    // First verify
    const result1 = await tradeService.checkoutVerify({
      razorpay_order_id: order.orderId,
      razorpay_payment_id: 'pay_test123',
      razorpay_signature: 'valid_sig',
      idempotencyKey
    });
    expect(result1.success).toBe(true);
    const tradeId1 = result1.tradeId;

    // Second verify with same idempotency key
    const result2 = await tradeService.checkoutVerify({
      razorpay_order_id: order.orderId,
      razorpay_payment_id: 'pay_test123',
      razorpay_signature: 'valid_sig',
      idempotencyKey
    });

    expect(result2.success).toBe(true);
    expect(result2.tradeId).toBe(tradeId1);
    expect(result2.idempotent).toBe(true);
  });

  it('should reject duplicate wallet-checkout for ETH trades', async () => {
    const idempotencyKey = `eth:${buyer.id}:${listing.listingId}:2:${Date.now()}:test789`;
    
    // Simulate ETH trade recording
    const result1 = await tradeService.recordEthTrade({
      batchId: listing.batchId,
      listingId: listing.listingIdOnchain,
      quantity: 2,
      paymentMode: 'eth',
      txHash: '0x123...',
      pricePerCreditINR: 100,
      idempotencyKey
    });
    expect(result1.success).toBe(true);
    const tradeId1 = result1.tradeId;

    // Duplicate with same txHash
    const result2 = await tradeService.recordEthTrade({
      batchId: listing.batchId,
      listingId: listing.listingIdOnchain,
      quantity: 2,
      paymentMode: 'eth',
      txHash: '0x123...', // Same txHash
      pricePerCreditINR: 100,
      idempotencyKey
    });

    expect(result2.success).toBe(true);
    expect(result2.tradeId).toBe(tradeId1);
    expect(result2.idempotent).toBe(true);
  });
});