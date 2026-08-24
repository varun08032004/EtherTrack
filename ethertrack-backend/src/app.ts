// Main Application Entry Point - Wires all services together

import express from 'express';
import { initializeCustodyAdaptersFromEnv, CustodyAdapterFactory } from './services/custody';
import { SettlementEngine } from './services/settlement/SettlementEngine';
import { ListingService } from './services/listing/ListingService';
import { TradeService } from './services/trade/TradeService';
import { PaymentService } from './services/payment/PaymentService';
import { FeeService } from './services/fee/FeeService';
import { CreditTransferService } from './services/credit-transfer/CreditTransferService';
import { EventProcessor } from './services/event-processor/EventProcessor';
import { ReconciliationEngine } from './services/reconciliation/ReconciliationEngine';
import { CacheInvalidationService, OutboxPublisher } from './services/cache-invalidation/CacheInvalidationService';
import { safeQuery, pool } from './db/pool';

// Global service instances
let settlementEngine: SettlementEngine;
let listingService: ListingService;
let tradeService: TradeService;
let paymentService: PaymentService;
let feeService: FeeService;
let creditTransferService: CreditTransferService;
let eventProcessor: EventProcessor;
let reconciliationEngine: ReconciliationEngine;
let cacheInvalidationService: CacheInvalidationService;
let outboxPublisher: OutboxPublisher;

async function initializeServices(): Promise<void> {
  console.log('[APP] Initializing services...');

  // 1. Initialize custody adapters
  initializeCustodyAdaptersFromEnv();
  console.log('[APP] Custody adapters initialized');

  // 2. Initialize core services
  settlementEngine = new SettlementEngine();
  listingService = new ListingService();
  tradeService = new TradeService(settlementEngine, listingService);
  paymentService = new PaymentService();
  feeService = new FeeService();
  creditTransferService = new CreditTransferService();
  eventProcessor = new EventProcessor();
  reconciliationEngine = new ReconciliationEngine();
  cacheInvalidationService = new CacheInvalidationService();
  outboxPublisher = new OutboxPublisher();

  // 3. Initialize cache invalidation subscriber
  await cacheInvalidationService.initialize();
  console.log('[APP] Cache invalidation service initialized');

  // 4. Start background jobs
  startBackgroundJobs();
  console.log('[APP] Background jobs started');

  console.log('[APP] All services initialized successfully');
}

function startBackgroundJobs(): void {
  // Reconciliation job - runs every hour
  setInterval(async () => {
    try {
      console.log('[CRON] Running reconciliation...');
      const results = await reconciliationEngine.runAllChecks();
      const { repaired, failed } = await reconciliationEngine.autoRepair(results);
      if (repaired > 0 || failed > 0) {
        console.log(`[CRON] Reconciliation auto-repair: ${repaired} repaired, ${failed} failed`);
      }
    } catch (e) {
      console.error('[CRON] Reconciliation job failed:', e);
    }
  }, 60 * 60 * 1000); // 1 hour

  // Listing expiry cleanup - runs every 5 minutes
  setInterval(async () => {
    try {
      const expiredCount = await listingService.expireListings();
      if (expiredCount > 0) {
        console.log(`[CRON] Expired ${expiredCount} listings`);
      }
    } catch (e) {
      console.error('[CRON] Listing expiry cleanup failed:', e);
    }
  }, 5 * 60 * 1000); // 5 minutes

  // Blockchain event processing - runs every 30 seconds
  setInterval(async () => {
    try {
      const currentBlock = await eventProcessor['provider'].getBlockNumber();
      // Process last 100 blocks (or use last processed block tracking)
      const fromBlock = Math.max(0, currentBlock - 100);
      const result = await eventProcessor.processBlockRange(fromBlock, currentBlock);
      if (result.processed > 0 || result.failed > 0) {
        console.log(`[CRON] Processed ${result.processed} events, ${result.failed} failed`);
      }
    } catch (e) {
      console.error('[CRON] Blockchain event processing failed:', e);
    }
  }, 30 * 1000); // 30 seconds

  // Cache warming - runs every 2 minutes
  setInterval(async () => {
    try {
      // Warm market cache for common queries
      await cacheInvalidationService.warmMarketCache({});
      console.log('[CRON] Cache warmed');
    } catch (e) {
      console.error('[CRON] Cache warming failed:', e);
    }
  }, 2 * 60 * 1000); // 2 minutes
}

// Export service getters for route handlers
export function getSettlementEngine(): SettlementEngine {
  return settlementEngine;
}

export function getListingService(): ListingService {
  return listingService;
}

export function getTradeService(): TradeService {
  return tradeService;
}

export function getPaymentService(): PaymentService {
  return paymentService;
}

export function getFeeService(): FeeService {
  return feeService;
}

export function getCreditTransferService(): CreditTransferService {
  return creditTransferService;
}

export function getEventProcessor(): EventProcessor {
  return eventProcessor;
}

export function getReconciliationEngine(): ReconciliationEngine {
  return reconciliationEngine;
}

export function getCacheInvalidationService(): CacheInvalidationService {
  return cacheInvalidationService;
}

export function getOutboxPublisher(): OutboxPublisher {
  return outboxPublisher;
}

export function getCustodyAdapterFactory(): typeof CustodyAdapterFactory {
  return CustodyAdapterFactory;
}

// Graceful shutdown
async function shutdown(): Promise<void> {
  console.log('[APP] Shutting down...');
  
  await cacheInvalidationService.shutdown();
  await pool.end();
  
  console.log('[APP] Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Initialize on module load
initializeServices().catch(e => {
  console.error('[APP] Failed to initialize services:', e);
  process.exit(1);
});