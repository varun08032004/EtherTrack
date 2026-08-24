// Cache Invalidation Service - Event-driven Redis cache invalidation

import { safeQuery as query } from '../../../db/pool.js';
import { getRedis } from '../../../services/redis.js';
import { OutboxEvent } from '../../domain/types';

export class CacheInvalidationService {
  private redis = getRedis();
  private subscriber: any = null;

  // Cache key patterns
  private static readonly KEY_PATTERNS = {
    marketListings: (params: string) => `market:listings:v2:${params}`,
    marketStats: () => 'market:stats:v2',
    userPositions: (userId: string) => `positions:${userId}`,
    position: (positionId: string) => `position:${positionId}`,
    listing: (listingId: string) => `listing:${listingId}`,
    userTrades: (userId: string, cursor?: string) => `trades:${userId}:${cursor || 'first'}`,
    trade: (tradeId: string) => `trade:${tradeId}`,
    ethInrRate: () => 'price:eth:inr',
    userCredits: (userId: string) => `credits:${userId}`,
    userPurchases: (userId: string) => `purchases:${userId}`
  };

  // Event type to cache keys mapping
  private static readonly INVALIDATION_MAP: Record<string, (payload: any) => string[]> = {
    ListingCreated: (payload) => [
      CacheInvalidationService.KEY_PATTERNS.marketListings('*'),
      CacheInvalidationService.KEY_PATTERNS.marketStats()
    ],
    ListingUpdated: (payload) => [
      CacheInvalidationService.KEY_PATTERNS.marketListings('*'),
      CacheInvalidationService.KEY_PATTERNS.listing(payload.listingId),
      CacheInvalidationService.KEY_PATTERNS.marketStats()
    ],
    ListingCancelled: (payload) => [
      CacheInvalidationService.KEY_PATTERNS.marketListings('*'),
      CacheInvalidationService.KEY_PATTERNS.listing(payload.listingId),
      CacheInvalidationService.KEY_PATTERNS.marketStats(),
      CacheInvalidationService.KEY_PATTERNS.userPositions(payload.sellerId)
    ],
    ListingExpired: (payload) => [
      CacheInvalidationService.KEY_PATTERNS.marketListings('*'),
      CacheInvalidationService.KEY_PATTERNS.listing(payload.listingId),
      CacheInvalidationService.KEY_PATTERNS.marketStats(),
      CacheInvalidationService.KEY_PATTERNS.userPositions(payload.sellerId)
    ],
    TradeSettled: (payload) => [
      CacheInvalidationService.KEY_PATTERNS.marketListings('*'),
      CacheInvalidationService.KEY_PATTERNS.marketStats(),
      CacheInvalidationService.KEY_PATTERNS.userTrades(payload.buyerId),
      CacheInvalidationService.KEY_PATTERNS.userTrades(payload.sellerId),
      CacheInvalidationService.KEY_PATTERNS.userPositions(payload.buyerId),
      CacheInvalidationService.KEY_PATTERNS.userPositions(payload.sellerId),
      CacheInvalidationService.KEY_PATTERNS.userCredits(payload.buyerId),
      CacheInvalidationService.KEY_PATTERNS.userCredits(payload.sellerId),
      CacheInvalidationService.KEY_PATTERNS.userPurchases(payload.buyerId)
    ],
    PositionUpdated: (payload) => [
      CacheInvalidationService.KEY_PATTERNS.userPositions(payload.ownerId),
      CacheInvalidationService.KEY_PATTERNS.position(payload.positionId)
    ],
    PaymentSettled: (payload) => [
      CacheInvalidationService.KEY_PATTERNS.userPositions(payload.payerId),
      CacheInvalidationService.KEY_PATTERNS.userPositions(payload.payeeId)
    ],
    CreditTransferConfirmed: (payload) => [
      CacheInvalidationService.KEY_PATTERNS.userPositions(payload.fromUserId),
      CacheInvalidationService.KEY_PATTERNS.userPositions(payload.toUserId),
      CacheInvalidationService.KEY_PATTERNS.userCredits(payload.fromUserId),
      CacheInvalidationService.KEY_PATTERNS.userCredits(payload.toUserId)
    ],
    RetirementCompleted: (payload) => [
      CacheInvalidationService.KEY_PATTERNS.userPositions(payload.ownerId),
      CacheInvalidationService.KEY_PATTERNS.userCredits(payload.ownerId)
    ]
  };

  async initialize(): Promise<void> {
    // Subscribe to outbox events channel
    this.subscriber = this.redis.duplicate();
    await this.subscriber.subscribe('outbox_events', (err: any) => {
      if (err) console.error('Cache invalidation subscriber error:', err);
    });

    this.subscriber.on('message', async (channel: string, message: string) => {
      if (channel === 'outbox_events') {
        try {
          const event: OutboxEvent = JSON.parse(message);
          await this.handleOutboxEvent(event);
        } catch (e) {
          console.error('Failed to process outbox event for cache invalidation:', e);
        }
      }
    });

    console.log('Cache invalidation service initialized');
  }

  async shutdown(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.unsubscribe('outbox_events');
      await this.subscriber.quit();
    }
  }

  private async handleOutboxEvent(event: OutboxEvent): Promise<void> {
    const invalidator = CacheInvalidationService.INVALIDATION_MAP[event.eventType];
    if (!invalidator) return;

    const keysToInvalidate = invalidator(event.payload);
    await this.invalidateKeys(keysToInvalidate);
  }

  private async invalidateKeys(keys: string[]): Promise<void> {
    for (const key of keys) {
      if (key.includes('*')) {
        // Pattern-based invalidation
        await this.invalidatePattern(key);
      } else {
        // Direct key deletion
        await this.redis.del(key);
      }
    }
  }

  private async invalidatePattern(pattern: string): Promise<void> {
    // Convert pattern to Redis KEYS scan
    const regexPattern = pattern.replace(/\*/g, '.*').replace(/\?/g, '.');
    
    let cursor = '0';
    do {
      const [newCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = newCursor;
      
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== '0');
  }

  // Manual invalidation methods (for direct use)
  async invalidateMarketListings(): Promise<void> {
    await this.invalidatePattern('market:listings:v2:*');
    await this.redis.del('market:stats:v2');
  }

  async invalidateUserPositions(userId: string): Promise<void> {
    await this.redis.del(`positions:${userId}`);
    // Also invalidate individual position keys - would need to scan
  }

  async invalidateUserTrades(userId: string): Promise<void> {
    await this.invalidatePattern(`trades:${userId}:*`);
  }

  async invalidateListing(listingId: string): Promise<void> {
    await this.redis.del(`listing:${listingId}`);
    await this.invalidateMarketListings();
  }

  async invalidateTrade(tradeId: string): Promise<void> {
    await this.redis.del(`trade:${tradeId}`);
  }

  async invalidateEthInrRate(): Promise<void> {
    await this.redis.del('price:eth:inr');
  }

  // Warm cache methods (for proactive caching)
  async warmMarketCache(params: any): Promise<void> {
    const key = CacheInvalidationService.KEY_PATTERNS.marketListings(JSON.stringify(params));
    // Cache would be populated by the actual service call
    // This just ensures the key exists with a reasonable TTL
    await this.redis.expire(key, 60);
  }

  async warmUserPositions(userId: string): Promise<void> {
    const key = CacheInvalidationService.KEY_PATTERNS.userPositions(userId);
    await this.redis.expire(key, 60);
  }

  // Get cache stats for monitoring
  async getCacheStats(): Promise<{
    connected: boolean;
    memoryUsage: string;
    keyCount: number;
    hitRate: number;
  }> {
    try {
      const info = await this.redis.info('memory');
      const keyspace = await this.redis.info('keyspace');
      
      return {
        connected: true,
        memoryUsage: info.match(/used_memory_human:(\S+)/)?.[1] || 'unknown',
        keyCount: 0, // Would need to parse keyspace
        hitRate: 0 // Would need to track separately
      };
    } catch {
      return {
        connected: false,
        memoryUsage: 'unknown',
        keyCount: 0,
        hitRate: 0
      };
    }
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}

// Outbox event publisher (called from services after DB commit)
export class OutboxPublisher {
  private redis = getRedis();

  async publish(event: OutboxEvent): Promise<void> {
    await this.redis.publish('outbox_events', JSON.stringify(event));
  }

  async publishBatch(events: OutboxEvent[]): Promise<void> {
    const pipeline = this.redis.pipeline();
    for (const event of events) {
      pipeline.publish('outbox_events', JSON.stringify(event));
    }
    await pipeline.exec();
  }
}

// Helper to create outbox events from services
export function createOutboxEvent(
  aggregateType: string,
  aggregateId: string,
  eventType: string,
  payload: Record<string, any>,
  metadata: Record<string, any> = {}
): OutboxEvent {
  return {
    eventId: crypto.randomUUID(),
    aggregateType,
    aggregateId,
    eventType,
    payload,
    metadata,
    createdAt: new Date(),
    publishedAt: null
  };
}

import crypto from 'crypto';