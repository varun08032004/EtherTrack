// RFQ (Request for Quote) Service
// Handles Request for Quote workflow for institutional buyers

import { safeQuery as query, withTransaction } from '../../../db/pool.js';
import { v4 as uuidv4 } from 'uuid';

export interface RFQ {
    rfq_id: string;
    buyer_id: string;
    title: string;
    description: string;
    category_code: string;
    methodology_template: string;
    quantity_min: number;
    quantity_max: number | null;
    vintage_min: number | null;
    vintage_max: number | null;
    geography_countries: string[];
    methodology_codes: string[];
    min_ecs_score: number | null;
    max_price_inr: number | null;
    required_certifications: string[];
    required_documents: string[];
    published_at: string | null;
    expires_at: string;
    quote_validity_hours: number;
    state: string;
    created_at: string;
    updated_at: string;
}

export interface Quote {
    quote_id: string;
    rfq_id: string;
    seller_id: string;
    quantity: number;
    price_per_credit_inr: number;
    currency: string;
    valid_until: string;
    batch_ids: string[];
    total_available: number;
    delivery_terms: string | null;
    payment_terms: string | null;
    settlement_type: string;
    document_ids: string[];
    state: string;
    submitted_at: string | null;
    accepted_at: string | null;
    rejected_at: string | null;
    rejected_reason: string | null;
    created_at: string;
    updated_at: string;
}

export class RFQService {
    /**
     * Create a new RFQ
     */
    static async createRFQ(data: {
        buyer_id: string;
        title: string;
        description: string;
        category_code: string;
        methodology_template: string;
        quantity_min: number;
        quantity_max?: number;
        vintage_min?: number;
        vintage_max?: number;
        geography_countries?: string[];
        methodology_codes?: string[];
        min_ecs_score?: number;
        max_price_inr?: number;
        required_certifications?: string[];
        required_documents?: string[];
        quote_validity_hours?: number;
        expires_at: string;
    }): Promise<{ rfq_id: string }> {
        const rfq_id = uuidv4();
        const quote_validity_hours = 24; // default

        await query(
            `INSERT INTO rfqs (
                rfq_id, buyer_id, title, description, category_code, methodology_template,
                quantity_min, quantity_max, vintage_min, vintage_max,
                geography_countries, methodology_codes, min_ecs_score, max_price_inr,
                required_certifications, required_documents, expires_at, quote_validity_hours,
                state, published_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
            RETURNING rfq_id`,
            [
                uuidv4(), data.buyer_id, data.title, data.description,
                data.category_code, data.methodology_template,
                data.quantity_min, data.quantity_max || null,
                data.vintage_min || null, data.vintage_max || null,
                data.geography_countries || [], data.methodology_codes || [],
                data.min_ecs_score || null, data.max_price_inr || null,
                data.required_certifications || [], data.required_documents || [],
                data.expires_at, data.quote_validity_hours || 24,
                'OPEN', data.buyer_id
            ]
        );

        return { rfq_id: uuidv4() };
    }

    /**
     * Get RFQ by ID
     */
    static async getRFQ(rfqId: string) {
        const { rows } = await query(
            `SELECT r.*, u.email as buyer_email, u.full_name as buyer_name
             FROM rfqs r
             JOIN users u ON u.id = r.buyer_id
             WHERE r.rfq_id = $1`,
            [rfqId]
        );
        return rows[0] || null;
    }

    /**
     * List RFQs with filters
     */
    static async listRFQs(filters: {
        buyer_id?: string;
        state?: string;
        category_code?: string;
        methodology_template?: string;
        limit?: number;
        offset?: number;
    }) {
        let whereClause = 'WHERE 1=1';
        const params: any[] = [];
        let paramIndex = 1;

        if (filters.buyer_id) {
            whereClause += ` AND r.buyer_id = $${paramIndex++}`;
            params.push(filters.buyer_id);
        }
        if (filters.state) {
            whereClause += ` AND r.state = $${paramIndex++}`;
            params.push(filters.state);
        }
        if (filters.category_code) {
            whereClause += ` AND r.category_code = $${paramIndex++}`;
            params.push(filters.category_code);
        }
        if (filters.methodology_template) {
            whereClause += ` AND r.methodology_template = $${paramIndex++}`;
            params.push(filters.methodology_template);
        }

        params.push(filters.limit || 20);
        params.push(filters.offset || 0);

        const { rows } = await query(
            `SELECT r.*, u.email as buyer_email, u.full_name as buyer_name
             FROM rfqs r
             JOIN users u ON u.id = r.buyer_id
             ${whereClause}
             ORDER BY r.created_at DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );

        return rows;
    }

    /**
     * Submit a quote for an RFQ
     */
    static async submitQuote(data: {
        rfq_id: string;
        seller_id: string;
        quantity: number;
        price_per_credit_inr: number;
        currency?: string;
        valid_until: string;
        batch_ids: string[];
        total_available: number;
        delivery_terms?: string;
        payment_terms?: string;
        settlement_type?: string;
        document_ids?: string[];
    }): Promise<{ quote_id: string }> {
        const quote_id = uuidv4();
        const currency = 'INR';

        await query(
            `INSERT INTO rfq_quotes (
                quote_id, rfq_id, seller_id, quantity, price_per_credit_inr,
                currency, valid_until, batch_ids, total_available,
                delivery_terms, payment_terms, settlement_type, document_ids, state
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'PENDING')
            RETURNING quote_id`,
            [
                uuidv4(), data.rfq_id, data.seller_id, data.quantity,
                data.price_per_credit_inr, currency, data.valid_until,
                data.batch_ids, data.total_available,
                data.delivery_terms || null, data.payment_terms || null,
                data.settlement_type || 'inr_wallet', data.document_ids || []
            ]
        );

        return { quote_id: uuidv4() };
    }

    /**
     * Get quotes for an RFQ
     */
    static async getQuotes(rfqId: string) {
        const { rows } = await query(
            `SELECT q.*, u.email as seller_email, u.full_name as seller_name, u.company_name
             FROM rfq_quotes q
             JOIN users u ON u.id = q.seller_id
             WHERE q.rfq_id = $1
             ORDER BY q.price_per_credit_inr ASC, q.submitted_at ASC`,
            [rfqId]
        );
        return rows;
    }

    /**
     * Accept a quote (buyer accepts seller's quote)
     */
    static async acceptQuote(rfqId: string, quoteId: string, buyerId: string): Promise<{ trade_id: string }> {
        return withTransaction(async (client) => {
            // Verify quote belongs to RFQ and is in PENDING/SUBMITTED state
            const { rows: quoteRows } = await client.query(
                `SELECT * FROM rfq_quotes WHERE quote_id = $1 AND rfq_id = $2 AND state IN ('PENDING', 'SUBMITTED')`,
                [quoteId, rfqId]
            );

            if (!quoteRows.length) {
                throw new Error('Quote not found or not available for acceptance');
            }

            const quote = quoteRows[0];

            // Check if buyer owns the RFQ
            const { rows: rfqRows } = await client.query(
                `SELECT * FROM rfqs WHERE rfq_id = $1 AND buyer_id = $2 AND state = 'OPEN'`,
                [rfqId, buyerId]
            );

            if (!rfqRows.length) {
                throw new Error('RFQ not found or not open for quotes');
            }

            const rfq = rfqRows[0];

            // Check quantity
            if (quote.quantity > rfq.quantity_max || quote.quantity < rfq.quantity_min) {
                throw new Error('Quote quantity outside RFQ range');
            }

            // Update quote state
            await client.query(
                `UPDATE rfq_quotes SET state = 'ACCEPTED', accepted_at = NOW(), updated_at = NOW()
                 WHERE quote_id = $1`,
                [quoteId]
            );

            // Update RFQ state
            await client.query(
                `UPDATE rfqs SET state = 'QUOTED', updated_at = NOW() WHERE rfq_id = $1`,
                [rfqId]
            );

            // Create trade via SettlementEngine
            // This would integrate with the SettlementEngine
            const tradeId = uuidv4();

            return { trade_id: tradeId };
        });
    }

    /**
     * Reject a quote
     */
    static async rejectQuote(quoteId: string, buyerId: string, reason: string): Promise<void> {
        await query(
            `UPDATE rfq_quotes SET state = 'REJECTED', rejected_at = NOW(), rejected_reason = $1, updated_at = NOW()
             WHERE quote_id = $1 AND rfq_id IN (SELECT rfq_id FROM rfqs WHERE buyer_id = $2)`,
            [quoteId, rfqId, buyerId]
        );
    }

    /**
     * Expire RFQ (called by cron)
     */
    static async expireRFQs(): Promise<number> {
        const { rows } = await query(
            `UPDATE rfqs SET state = 'EXPIRED', updated_at = NOW()
             WHERE state = 'OPEN' AND expires_at < NOW()
             RETURNING rfq_id`
        );
        return rows.length;
    }

    /**
     * Get RFQ analytics
     */
    static async getRFQAnalytics(rfqId: string) {
        const { rows: quoteStats } = await query(
            `SELECT 
                COUNT(*) as total_quotes,
                COUNT(*) FILTER (WHERE state = 'SUBMITTED') as submitted_quotes,
                COUNT(*) FILTER (WHERE state = 'ACCEPTED') as accepted_quotes,
                MIN(price_per_credit_inr) as min_price,
                MAX(price_per_credit_inr) as max_price,
                AVG(price_per_credit_inr) as avg_price,
                SUM(quantity) as total_quantity_offered
             FROM rfq_quotes
             WHERE rfq_id = $1`,
            [rfqId]
        );

        const { rows: timeline } = await query(
            `SELECT state, COUNT(*) as count, MIN(created_at) as first_at, MAX(updated_at) as last_at
             FROM rfq_quotes WHERE rfq_id = $1 GROUP BY state`,
            [rfqId]
        );

        return {
            quoteStats: quoteStats[0],
            timeline: timeline
        };
    }
}

export default RFQService;