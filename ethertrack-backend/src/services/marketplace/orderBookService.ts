// Order Book Service
// Implements price-time priority order matching for carbon credits

import { safeQuery as query, withTransaction } from '../../../db/pool.js';
import { v4 as uuidv4 } from 'uuid';

export interface Order {
    order_id: string;
    listing_id: string;
    buyer_id: string;
    seller_id: string;
    order_type: 'MARKET' | 'LIMIT';
    side: 'BUY' | 'SELL';
    state: string;
    quantity: number;
    filled_quantity: number;
    remaining_quantity: number;
    price_per_credit_inr: number | null;
    price_per_credit_usd: number | null;
    currency: string;
    rfq_id: string | null;
    quote_id: string | null;
    quote_expires_at: string | null;
    otc_negotiation_id: string | null;
    counterparty_id: string | null;
    settlement_type: string;
    settlement_status: string;
    settled_at: string | null;
    settlement_tx_hash: string | null;
    placed_at: string;
    expires_at: string | null;
    filled_at: string | null;
    cancelled_at: string | null;
}

export interface Listing {
    listing_id: string;
    seller_id: string;
    batch_id: string;
    asset_passport_id: string | null;
    quantity: number;
    remaining_quantity: number;
    price_per_credit_inr: number;
    price_per_credit_usd: number | null;
    currency: string;
    buyer_fee_bps: number;
    seller_fee_bps: number;
    min_order_qty: number;
    max_order_qty: number | null;
    listing_type: string;
    min_price_inr: number | null;
    max_price_inr: number | null;
    listed_at: string;
    expires_at: string | null;
    filled_at: string | null;
    state: string;
    filled_quantity: number;
    metadata: any;
}

export interface Trade {
    trade_id: string;
    listing_id: string;
    buyer_id: string;
    seller_id: string;
    quantity: number;
    price_per_credit_inr: number;
    total_price_inr: number;
    buyer_fee_inr: number;
    seller_fee_inr: number;
    platform_fee_inr: number;
    settlement_type: string;
    settlement_status: string;
    trade_state: string;
    created_at: string;
    settled_at: string | null;
}

export interface MarketDepth {
    bids: Array<{ price: number; quantity: number; orders: number }>;
    asks: Array<{ price: number; quantity: number; orders: number }>;
    spread: number;
    mid_price: number;
    last_price: number | null;
    volume_24h: number;
    trades_24h: number;
}

export class OrderBookService {
    // Price-time priority matching engine

    /**
     * Add a limit order to the book
     */
    static async placeLimitOrder(data: {
        listing_id: string;
        buyer_id: string;
        side: 'BUY' | 'SELL';
        quantity: number;
        price_per_credit_inr: number;
        currency?: string;
        idempotency_key: string;
    }): Promise<{ order_id: string; filled_quantity: number; state: string }> {
        const { listing_id, buyer_id, side, quantity, price_per_credit_inr, currency = 'INR', idempotency_key } = data;

        // Check for duplicate
        const { rows: existing } = await query(
            `SELECT order_id, filled_quantity, state FROM marketplace_orders 
             WHERE idempotency_key = $1 AND buyer_id = $2`,
            [idempotency_key, buyer_id]
        );

        if (existing.length > 0) {
            return {
                order_id: existing[0].order_id,
                filled_quantity: existing[0].filled_quantity,
                state: existing[0].state
            };
        }

        // Verify listing exists and is active
        const { rows: listingRows } = await query(
            `SELECT * FROM marketplace_listings WHERE listing_id = $1 AND state = 'ACTIVE'`,
            [listing_id]
        );

        if (!listingRows.length) {
            throw new Error('Listing not found or not active');
        }

        const listing = listingRows[0];

        // Check if user is seller trying to buy own listing
        if (listing.seller_id === buyer_id && side === 'BUY') {
            throw new Error('Cannot buy your own listing');
        }

        // Check available quantity
        if (listing.remaining_quantity < quantity) {
            throw new Error(`Only ${listing.remaining_quantity} credits available`);
        }

        // Price validation for limit orders
        if (side === 'BUY' && price_per_credit_inr < listing.price_per_credit_inr) {
            throw new Error(`Bid price below ask price`);
        }

        const order_id = uuidv4();
        const order_type = 'LIMIT';
        const side_type = side;
        const settlement_type = 'inr_wallet'; // Default

        await withTransaction(async (client) => {
            // Lock listing for update
            await client.query(
                `SELECT * FROM marketplace_listings WHERE listing_id = $1 FOR UPDATE`,
                [listing_id]
            );

            // Verify again under lock
            const { rows: lockedListing } = await client.query(
                `SELECT * FROM marketplace_listings WHERE listing_id = $1 AND state = 'ACTIVE'`,
                [listing_id]
            );

            if (!lockedListing.length || lockedListing[0].remaining_quantity < quantity) {
                throw new Error('Insufficient quantity available');
            }

            // Create order
            await client.query(
                `INSERT INTO marketplace_orders (
                    order_id, listing_id, buyer_id, seller_id, order_type, side, state,
                    quantity, filled_quantity, remaining_quantity,
                    price_per_credit_inr, price_per_credit_usd, currency,
                    buyer_fee_bps, seller_fee_bps, settlement_type,
                    placed_at, expires_at, idempotency_key
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
                [
                    uuidv4(), listing_id, buyer_id, listing.seller_id, 'LIMIT', side, 'OPEN',
                    quantity, 0, quantity,
                    price_per_credit_inr, null, currency,
                    listing.buyer_fee_bps, listing.seller_fee_bps, 'inr_wallet',
                    new Date(), null, idempotency_key
                ]
            );

            // Update listing remaining quantity
            await client.query(
                `UPDATE marketplace_listings 
                 SET remaining_quantity = remaining_quantity - $1, updated_at = NOW()
                 WHERE listing_id = $2`,
                [quantity, listing_id]
            );
        });

        // Try to match immediately
        const matchResult = await this.matchOrders(listing_id);

        return {
            order_id: uuidv4(),
            filled_quantity: matchResult.filledQuantity,
            state: matchResult.filledQuantity > 0 ? 'PARTIALLY_FILLED' : 'OPEN'
        };
    }

    /**
     * Place a market order (execute immediately at best price)
     */
    static async placeMarketOrder(data: {
        listing_id: string;
        buyer_id: string;
        side: 'BUY' | 'SELL';
        quantity: number;
        currency?: string;
        idempotency_key: string;
    }): Promise<{ order_id: string; filled_quantity: number; state: string }> {
        const { listing_id, buyer_id, side, quantity, currency = 'INR', idempotency_key } = data;

        // Get best available price
        const { rows: bestPriceRows } = await query(
            `SELECT price_per_credit_inr FROM marketplace_listings 
             WHERE listing_id = $1 AND state = 'ACTIVE' AND remaining_quantity > 0
             ORDER BY price_per_credit_inr ${side === 'BUY' ? 'ASC' : 'DESC'} LIMIT 1`,
            [listing_id]
        );

        if (!bestPriceRows.length) {
            throw new Error('No liquidity available for market order');
        }

        // Use limit order at best price
        return this.placeLimitOrder({
            listing_id,
            buyer_id,
            side,
            quantity,
            price_per_credit_inr: bestPriceRows[0].price_per_credit_inr,
            currency,
            idempotency_key
        });
    }

    /**
     * Match orders against listings (price-time priority)
     */
    static async matchOrders(listingId: string): Promise<{ matched: boolean; filledQuantity: number; trades: any[] }> {
        const { rows: listingRows } = await query(
            `SELECT * FROM marketplace_listings WHERE listing_id = $1`,
            [listingId]
        );

        if (!listingRows.length) return { matched: false, filledQuantity: 0, trades: [] };

        const listing = listingRows[0];
        const side = 'BUY'; // We match BUY orders against SELL listings

        // Get matching orders (price-time priority)
        const { rows: orders } = await query(
            `SELECT * FROM marketplace_orders 
             WHERE listing_id = $1 AND side = 'BUY' AND state IN ('OPEN', 'PARTIALLY_FILLED')
             AND price_per_credit_inr >= $2
             ORDER BY price_per_credit_inr DESC, placed_at ASC`,
            [listingId, listing.price_per_credit_inr]
        );

        let filledQuantity = 0;
        const trades: any[] = [];
        let remainingQuantity = listing.remaining_quantity;

        for (const order of orders) {
            if (remainingQuantity <= 0) break;

            const fillQty = Math.min(order.remaining_quantity, remainingQuantity);

            // Execute trade
            const trade = await this.executeTrade({
                listing_id: listingId,
                order_id: order.order_id,
                buyer_id: order.buyer_id,
                seller_id: listing.seller_id,
                quantity: fillQty,
                price_per_credit_inr: order.price_per_credit_inr
            });

            trades.push(trade);
            filledQuantity += fillQty;
            remainingQuantity -= fillQty;

            // Update order
            const newFilled = order.filled_quantity + fillQty;
            const newState = newFilled >= order.quantity ? 'FILLED' : 'PARTIALLY_FILLED';

            await query(
                `UPDATE marketplace_orders SET filled_quantity = $1, remaining_quantity = $2, state = $3, updated_at = NOW() WHERE order_id = $4`,
                [newFilled, order.quantity - newFilled, newState, order.order_id]
            );

            // Update listing
            await query(
                `UPDATE marketplace_listings SET remaining_quantity = $1, filled_quantity = $2, 
                 state = CASE WHEN remaining_quantity = 0 THEN 'FILLED' ELSE state END, updated_at = NOW()
                 WHERE listing_id = $3`,
                [remainingQuantity, listing.quantity - remainingQuantity, listingId]
            );
        }

        return { matched: filledQuantity > 0, filledQuantity, trades };
    }

    /**
     * Execute a trade between buyer and seller
     */
    static async executeTrade(data: {
        listing_id: string;
        order_id: string;
        buyer_id: string;
        seller_id: string;
        quantity: number;
        price_per_credit_inr: number;
    }): Promise<any> {
        const trade_id = uuidv4();
        const total_price_inr = data.quantity * data.price_per_credit_inr;
        const buyer_fee_bps = 50; // 0.5%
        const seller_fee_bps = 50;
        const buyer_fee_inr = Math.round(total_price_inr * buyer_fee_bps / 10000);
        const seller_fee_inr = Math.round(total_price_inr * seller_fee_bps / 10000);
        const platform_fee_inr = buyer_fee_inr + seller_fee_inr;

        await withTransaction(async (client) => {
            // Create trade record
            await client.query(
                `INSERT INTO trades (
                    trade_id, listing_id, buyer_id, seller_id, batch_id, token_id,
                    quantity, price_per_credit_inr, subtotal_inr,
                    buyer_fee_inr, seller_fee_inr, total_fee_inr, gst_inr,
                    buyer_pays_inr, seller_receives_inr, platform_net_inr,
                    payment_mode, status, buyer_inr_deducted, seller_inr_credited,
                    inr_settlement_at, completed_at, chain_status
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'completed',$17,$18,NOW(),$19,'pending')`,
                [
                    uuidv4(), listing_id, buyer_id, seller_id, batch_id, token_id,
                    quantity, price_per_credit_inr, total_price_inr,
                    buyer_fee_inr, seller_fee_inr, total_fee_inr, gst_inr,
                    buyer_pays_inr, seller_receives_inr, platform_net_inr,
                    'inr_wallet', true, true, new Date(), tx_hash
                ]
            );

            // Update wallet balances
            await client.query(
                `UPDATE users SET inr_balance = inr_balance - $1, updated_at = NOW() WHERE id = $2`,
                [buyer_pays_inr, buyer_id]
            );

            await client.query(
                `UPDATE users SET inr_balance = inr_balance + $1, updated_at = NOW() WHERE id = $2`,
                [seller_receives_inr, seller_id]
            );

            // Platform fee
            await client.query(
                `UPDATE users SET inr_balance = inr_balance + $1, updated_at = NOW() WHERE id = $2`,
                [platform_fee_inr, process.env.COMPANY_USER_ID]
            );

            // Record wallet transactions
            await client.query(
                `INSERT INTO wallet_transactions (transaction_id, user_id, type, method, amount, status, notes, trade_type)
                 VALUES ($1,'debit','inr',$1,'success',$2,'buy_credit')`,
                [buyer_pays_inr, buyer_id, `Purchase ${quantity} credits @ ₹${price_per_credit_inr}`]
            );

            await client.query(
                `INSERT INTO wallet_transactions (transaction_id, user_id, type, method, amount, status, notes, trade_type)
                 VALUES ($1,'credit','inr',$1,'success',$2,'sell_credit')`,
                [seller_receives_inr, seller_id, `Sale ${quantity} credits @ ₹${price_per_credit_inr}`]
            );

            // Platform fee
            await client.query(
                `INSERT INTO wallet_transactions (transaction_id, user_id, type, method, amount, status, notes, trade_type)
                 VALUES ($1,'credit','inr',$1,'success',$2,'platform_fee')`,
                [platform_fee_inr, process.env.COMPANY_USER_ID, `Platform fee: trade ${trade_id}`]
            );
        });

        return { trade_id: uuidv4(), total_price_inr, buyer_fee_inr, seller_fee_inr };
    }

    /**
     * Get market depth for a listing
     */
    static async getMarketDepth(listingId: string): Promise<any> {
        const { rows: bids } = await query(
            `SELECT price_per_credit_inr as price, SUM(remaining_quantity) as quantity, COUNT(*) as orders
             FROM marketplace_orders 
             WHERE listing_id = $1 AND side = 'BUY' AND state IN ('OPEN', 'PARTIALLY_FILLED')
             GROUP BY price_per_credit_inr ORDER BY price_per_credit_inr DESC LIMIT 20`,
            [listingId]
        );

        const { rows: asks } = await query(
            `SELECT price_per_credit_inr as price, SUM(remaining_quantity) as quantity, COUNT(*) as orders
             FROM marketplace_listings 
             WHERE batch_id = (SELECT batch_id FROM marketplace_listings WHERE listing_id = $1)
             AND state = 'ACTIVE' AND remaining_quantity > 0
             GROUP BY price_per_credit_inr ORDER BY price_per_credit_inr ASC LIMIT 20`,
            [listingId]
        );

        const { rows: lastTrade } = await query(
            `SELECT price_per_credit_inr FROM trades WHERE listing_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [listingId]
        );

        const { rows: volume24h } = await query(
            `SELECT COALESCE(SUM(quantity), 0) as volume FROM trades 
             WHERE listing_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
            [listingId]
        );

        const { rows: trades24h } = await query(
            `SELECT COUNT(*) as count FROM trades WHERE listing_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
            [listingId]
        );

        const bestBid = bids[0]?.price || 0;
        const bestAsk = asks[0]?.price || 0;
        const midPrice = (bestBid + bestAsk) / 2 || 0;
        const spread = bestAsk - bestBid || 0;

        return {
            bids: bids.map(b => ({ price: b.price, quantity: b.quantity, orders: b.orders })),
            asks: asks.map(a => ({ price: a.price, quantity: a.quantity, orders: a.orders })),
            spread: Math.round(spread * 100) / 100,
            midPrice: Math.round(midPrice * 100) / 100,
            lastPrice: lastTrade[0]?.price_per_credit_inr || null,
            volume24h: volume24h[0]?.volume || 0,
            trades24h: trades24h[0]?.count || 0
        };
    }

    /**
     * Cancel an order
     */
    static async cancelOrder(orderId: string, userId: string): Promise<void> {
        const { rows } = await query(
            `UPDATE marketplace_orders 
             SET state = 'CANCELLED', cancelled_at = NOW(), updated_at = NOW()
             WHERE order_id = $1 AND buyer_id = $2 AND state IN ('OPEN', 'PARTIALLY_FILLED')
             RETURNING *`,
            [orderId, userId]
        );

        if (!rows.length) throw new Error('Order not found or cannot be cancelled');

        const order = rows[0];

        // Restore listing quantity
        await query(
            `UPDATE marketplace_listings 
             SET remaining_quantity = remaining_quantity + $1, updated_at = NOW()
             WHERE listing_id = $2`,
            [order.remaining_quantity, order.listing_id]
        );
    }

    /**
     * Get user's open orders
     */
    static async getUserOrders(userId: string, state?: string, limit = 50) {
        let sql = `SELECT o.*, l.price_per_credit_inr, l.project_name 
                   FROM marketplace_orders o
                   JOIN marketplace_listings l ON o.listing_id = l.listing_id
                   WHERE o.buyer_id = $1`;
        const params: any[] = [userId];

        if (state) {
            sql += ` AND o.state = $2`;
        }

        sql += ` ORDER BY o.placed_at DESC LIMIT $${state ? 3 : 2}`;
        if (state) params.push(state);
        params.push(50);

        const { rows } = await query(sql, params);
        return rows;
    }

    /**
     * Get order book snapshot for a listing
     */
    static async getOrderBook(listingId: string, depth = 10) {
        const { rows: bids } = await query(
            `SELECT price_per_credit_inr as price, SUM(remaining_quantity) as quantity, COUNT(*) as orders
             FROM marketplace_orders 
             WHERE listing_id = $1 AND side = 'BUY' AND state IN ('OPEN', 'PARTIALLY_FILLED')
             GROUP BY price_per_credit_inr ORDER BY price_per_credit_inr DESC LIMIT $2`,
            [listingId, depth]
        );

        const { rows: asks } = await query(
            `SELECT price_per_credit_inr as price, SUM(remaining_quantity) as quantity, COUNT(*) as orders
             FROM marketplace_listings 
             WHERE batch_id = (SELECT batch_id FROM marketplace_listings WHERE listing_id = $1)
             AND state = 'ACTIVE' AND remaining_quantity > 0
             GROUP BY price_per_credit_inr ORDER BY price_per_credit_inr ASC LIMIT $2`,
            [listingId, depth]
        );

        return { bids, asks };
    }
}

export default OrderBookService;