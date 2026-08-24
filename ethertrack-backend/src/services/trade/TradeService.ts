// Trade Service - High-level trade operations using SettlementEngine

import { v4 as uuidv4 } from 'uuid';
import { safeQuery as query, withTransaction } from '../../../db/pool.js';
import { SettlementEngine } from '../settlement/SettlementEngine';
import { ListingService } from '../listing/ListingService';
import { 
  Trade, 
  Quote, 
  PaymentMode, 
  TradeSettlementState,
  PaginatedResponse 
} from '../../domain/types';

export class TradeService {
  private settlementEngine: SettlementEngine;
  private listingService: ListingService;

  constructor(settlementEngine: SettlementEngine, listingService: ListingService) {
    this.settlementEngine = settlementEngine;
    this.listingService = listingService;
  }

  async getQuote(listingId: string, quantity: number, buyerId: string, paymentMode: PaymentMode): Promise<Quote> {
    return this.settlementEngine.generateQuote(listingId, quantity, buyerId, paymentMode);
  }

  async createTrade(
    quote: Quote, 
    buyerId: string, 
    paymentDetails?: { razorpayOrderId?: string; ethTxHash?: string }
  ): Promise<Trade> {
    const idempotencyKey = quote.idempotencyKey;
    return this.settlementEngine.createTradeFromQuote(quote, buyerId, idempotencyKey, paymentDetails);
  }

  async getTrade(tradeId: string): Promise<Trade | null> {
    const { rows } = await query('SELECT * FROM trades WHERE trade_id = $1', [tradeId]);
    return rows.length ? this.mapRowToTrade(rows[0]) : null;
  }

  async getTradeHistory(userId: string, params: { cursor?: string; limit?: number; custodyType?: string } = {}): Promise<PaginatedResponse<Trade>> {
    const { cursor, limit = 20, custodyType } = params;
    
    let whereClause = `WHERE t.buyer_id = $1 OR t.seller_id = $1`;
    const queryParams = [userId];
    let paramIndex = 2;

    if (custodyType) {
      whereClause += ` AND (t.seller_custody_type = $${paramIndex} OR t.buyer_custody_type = $${paramIndex})`;
      queryParams.push(custodyType);
      paramIndex++;
    }

    if (cursor) {
      const [cursorDate, cursorId] = cursor.split(':');
      whereClause += ` AND (t.created_at < $${paramIndex} OR (t.created_at = $${paramIndex} AND t.trade_id > $${paramIndex + 1}))`;
      queryParams.push(cursorDate, cursorId);
      paramIndex += 2;
    }

    queryParams.push(limit + 1);

    const { rows } = await query(
      `SELECT t.*, l.price_per_unit, ca.project_name, ca.standard, ca.project_type
       FROM trades t
       LEFT JOIN listings l ON l.listing_id = t.listing_id
       LEFT JOIN carbon_assets ca ON ca.asset_id = t.asset_id
       ${whereClause}
       ORDER BY t.created_at DESC, t.trade_id DESC
       LIMIT $${paramIndex}`,
      queryParams
    );

    const hasMore = rows.length > limit;
    const trades = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore 
      ? `${trades[trades.length - 1].created_at.toISOString()}:${trades[trades.length - 1].trade_id}`
      : null;

    return {
      data: trades.map(this.mapRowToTrade),
      nextCursor,
      hasMore
    };
  }

  async getTradeStats(userId?: string): Promise<{
    totalVolumeINR: number;
    totalTrades: number;
    avgPriceINR: number;
    totalPlatformFees: number;
    totalGSTCollected: number;
    tradesOnChain: number;
    ethRate: number;
  }> {
    let whereClause = `WHERE t.status = 'completed'`;
    const params: any[] = [];

    if (userId) {
      whereClause += ` AND (t.buyer_id = $1 OR t.seller_id = $1)`;
      params.push(userId);
    }

    const [volume, count, avgPrice, fees, chainStats, ethRate] = await Promise.all([
      query(`SELECT COALESCE(SUM(t.subtotal_inr), 0) as total FROM trades t ${whereClause}`, params),
      query(`SELECT COUNT(*) as cnt FROM trades t ${whereClause}`, params),
      query(`SELECT COALESCE(AVG(t.price_per_credit_inr), 0) as avg FROM trades t ${whereClause} AND t.created_at > NOW() - INTERVAL '30 days'`, params),
      query(`SELECT COALESCE(SUM(t.total_fee_inr), 0) as total, COALESCE(SUM(t.gst_inr), 0) as gst FROM trades t ${whereClause}`, params),
      query(`SELECT COUNT(*) as on_chain FROM trades t ${whereClause} AND t.chain_status = 'confirmed'`, params),
      query('SELECT rate FROM eth_inr_rates ORDER BY created_at DESC LIMIT 1', [])
    ]);

    return {
      totalVolumeINR: parseFloat(volume.rows[0].total),
      totalTrades: parseInt(count.rows[0].cnt),
      avgPriceINR: parseFloat(avgPrice.rows[0].avg),
      totalPlatformFees: parseFloat(fees.rows[0].total),
      totalGSTCollected: parseFloat(fees.rows[0].gst),
      tradesOnChain: parseInt(chainStats.rows[0].on_chain),
      ethRate: parseFloat(ethRate.rows[0]?.rate || '280000')
    };
  }

  async verifyTradeOnChain(tradeId: string): Promise<{
    tradeId: string;
    paymentMode: string;
    quantity: number;
    priceINR: number;
    status: string;
    chainStatus: string;
    chainTxHash: string | null;
    chainBlock: number | null;
    onChainVerification: any;
  }> {
    const { rows } = await query(
      `SELECT t.*, cb.token_id FROM trades t
       LEFT JOIN carbon_batches cb ON cb.id = t.batch_id
       WHERE t.trade_id = $1`,
      [tradeId]
    );

    if (!rows.length) throw new Error('Trade not found');
    const trade = rows[0];

    // Verify via blockchain event logs
    const { rows: events } = await query(
      `SELECT * FROM blockchain_events 
       WHERE (tx_hash = $1 OR tx_hash = $2)
         AND event_name IN ('CreditTraded', 'INRTradeLogged')
         AND processing_status = 'PROCESSED'`,
      [trade.chain_tx_hash, trade.tx_hash]
    );

    return {
      tradeId: trade.trade_id,
      paymentMode: trade.payment_mode,
      quantity: trade.quantity,
      priceINR: trade.price_per_credit_inr,
      status: trade.status,
      chainStatus: trade.chain_status,
      chainTxHash: trade.chain_tx_hash,
      chainBlock: trade.chain_block,
      onChainVerification: {
        found: events.length > 0,
        events: events.map(e => ({
          eventName: e.event_name,
          blockNumber: e.block_number,
          args: e.decoded_args
        }))
      }
    };
  }

  private mapRowToTrade(row: any): Trade {
    return {
      tradeId: row.trade_id,
      listingId: row.listing_id,
      buyerId: row.buyer_id,
      sellerId: row.seller_id,
      assetId: row.asset_id,
      sellerCustodyType: row.seller_custody_type,
      buyerCustodyType: row.buyer_custody_type,
      quantity: Number(row.quantity),
      executionPrice: Number(row.execution_price),
      currency: row.currency,
      buyerGross: Number(row.buyer_gross),
      sellerGross: Number(row.seller_gross),
      buyerFeeBps: Number(row.buyer_fee_bps),
      sellerFeeBps: Number(row.seller_fee_bps),
      paymentId: row.payment_id,
      creditTransferId: row.credit_transfer_id,
      buyerFeeId: row.buyer_fee_id,
      sellerFeeId: row.seller_fee_id,
      settlementState: row.settlement_state,
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at,
      settledAt: row.settled_at,
      updatedAt: row.updated_at
    };
  }
}