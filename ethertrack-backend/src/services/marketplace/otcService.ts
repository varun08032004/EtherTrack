// OTC (Over-the-Counter) Negotiation Service
// Handles bilateral negotiated trades for large volumes

import { safeQuery as query, withTransaction } from '../../../db/pool.js';
import { v4 as uuidv4 } from 'uuid';

export interface OTCNegotiation {
    negotiation_id: string;
    initiator_id: string;
    counterparty_id: string;
    batch_id: string;
    asset_passport_id: string | null;
    quantity: number;
    price_per_credit_inr: number;
    currency: string;
    payment_terms: string | null;
    delivery_terms: string | null;
    settlement_type: string;
    escrow_address: string | null;
    escrow_tx_hash: string | null;
    agreement_doc_id: string | null;
    supporting_docs: string[];
    state: string;
    current_turn: string | null;
    initiated_at: string;
    expires_at: string | null;
    agreed_at: string | null;
    escrow_funded_at: string | null;
    settled_at: string | null;
    cancelled_at: string | null;
    cancelled_reason: string | null;
    metadata: any;
    created_at: string;
    updated_at: string;
}

export interface OTCMessage {
    message_id: string;
    negotiation_id: string;
    sender_id: string;
    message_type: 'text' | 'offer' | 'counter_offer' | 'document' | 'system';
    content: string;
    attachments: string[];
    offer_quantity: number | null;
    offer_price_inr: number | null;
    offer_terms: any | null;
    is_system_message: boolean;
    created_at: string;
}

export interface OTCStateTransition {
    transition_id: string;
    negotiation_id: string;
    from_state: string;
    to_state: string;
    triggered_by: string;
    reason: string | null;
    metadata: any;
    created_at: string;
}

export class OTCService {
    private static readonly STATES = [
        'INITIATED',
        'NEGOTIATING',
        'TERMS_AGREED',
        'ESCROW_FUNDED',
        'SETTLING',
        'SETTLED',
        'DISPUTED',
        'CANCELLED',
        'EXPIRED'
    ];

    private static readonly VALID_TRANSITIONS: Record<string, string[]> = {
        'INITIATED': ['NEGOTIATING', 'CANCELLED'],
        'NEGOTIATING': ['TERMS_AGREED', 'CANCELLED', 'INITIATED'],
        'TERMS_AGREED': ['ESCROW_FUNDED', 'CANCELLED', 'NEGOTIATING'],
        'ESCROW_FUNDED': ['SETTLING', 'CANCELLED', 'TERMS_AGREED'],
        'SETTLING': ['SETTLED', 'DISPUTED', 'CANCELLED'],
        'SETTLED': [],
        'DISPUTED': ['SETTLING', 'CANCELLED'],
        'CANCELLED': [],
        'EXPIRED': []
    };

    /**
     * Initiate an OTC negotiation
     */
    static async initiateNegotiation(data: {
        initiator_id: string;
        counterparty_id: string;
        batch_id: string;
        asset_passport_id?: string;
        quantity: number;
        price_per_credit_inr: number;
        currency?: string;
        payment_terms?: string;
        delivery_terms?: string;
        settlement_type?: string;
        escrow_address?: string;
        agreement_doc_id?: string;
        supporting_docs?: string[];
        expires_at?: string;
        metadata?: any;
    }): Promise<{ negotiation_id: string }> {
        const negotiation_id = uuidv4();
        const currency = data.currency || 'INR';
        const settlement_type = data.settlement_type || 'otc_escrow';
        const expires_at = data.expires_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        // Validate parties are different
        if (data.initiator_id === data.counterparty_id) {
            throw new Error('Cannot initiate negotiation with yourself');
        }

        // Check batch exists and belongs to counterparty
        const { rows: batchRows } = await query(
            `SELECT * FROM carbon_batches WHERE id = $1 AND user_id = $2`,
            [data.batch_id, data.counterparty_id]
        );

        if (!batchRows.length) {
            throw new Error('Batch not found or does not belong to counterparty');
        }

        // Check available quantity
        const batch = batchRows[0];
        if (batch.available_quantity < data.quantity) {
            throw new Error(`Insufficient quantity. Available: ${batch.available_quantity}`);
        }

        const negotiation_id = uuidv4();

        await query(
            `INSERT INTO otc_negotiations (
                negotiation_id, initiator_id, counterparty_id, batch_id, asset_passport_id,
                quantity, price_per_credit_inr, currency, payment_terms, delivery_terms,
                settlement_type, escrow_address, agreement_doc_id, supporting_docs,
                state, current_turn, initiated_at, expires_at, metadata
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'INITIATED',$15,$16,$17)
            RETURNING negotiation_id`,
            [
                uuidv4(), data.initiator_id, data.counterparty_id, data.batch_id,
                data.asset_passport_id || null, data.quantity, data.price_per_credit_inr,
                data.currency || 'INR', data.payment_terms || null, data.delivery_terms || null,
                data.settlement_type || 'otc_escrow', data.escrow_address || null,
                data.agreement_doc_id || null, data.supporting_docs || [],
                data.initiator_id, expires_at, data.metadata || {}
            ]
        );

        // Create initial system message
        await query(
            `INSERT INTO otc_messages (message_id, negotiation_id, sender_id, message_type, content, created_at)
             VALUES ($1,$2,$3,'system','OTC negotiation initiated',NOW())`,
            [uuidv4(), uuidv4(), 'system']
        );

        return { negotiation_id: uuidv4() };
    }

    /**
     * Send a message in negotiation
     */
    static async sendMessage(data: {
        negotiation_id: string;
        sender_id: string;
        message_type: 'text' | 'offer' | 'counter_offer' | 'document';
        content: string;
        attachments?: string[];
        offer_quantity?: number;
        offer_price_inr?: number;
        offer_terms?: any;
    }): Promise<{ message_id: string }> {
        const { negotiation_id, sender_id, message_type, content, attachments, offer_quantity, offer_price_inr, offer_terms } = data;

        // Verify sender is part of negotiation
        const { rows: negRows } = await query(
            `SELECT * FROM otc_negotiations WHERE negotiation_id = $1 AND (initiator_id = $1 OR counterparty_id = $1)`,
            [data.negotiation_id, data.sender_id]
        );

        if (!negRows.length) {
            throw new Error('Not authorized to send messages in this negotiation');
        }

        const negotiation = negRows[0];

        // Check if negotiation is in a state that allows messages
        const activeStates = ['INITIATED', 'NEGOTIATING', 'TERMS_AGREED'];
        if (!activeStates.includes(negotiation.state)) {
            throw new Error(`Cannot send messages in state: ${negotiation.state}`);
        }

        // Verify sender is the current turn (if applicable)
        if (negotiation.current_turn && negotiation.current_turn !== sender_id && message_type !== 'text') {
            throw new Error('Not your turn to act');
        }

        const message_id = uuidv4();

        await query(
            `INSERT INTO otc_messages (
                message_id, negotiation_id, sender_id, message_type, content, attachments,
                offer_quantity, offer_price_inr, offer_terms, is_system_message
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
                uuidv4(), data.negotiation_id, data.sender_id, data.message_type,
                data.content, data.attachments || [], data.offer_quantity || null,
                data.offer_price_inr || null, data.offer_terms || null, false
            ]
        );

        // Update current turn if this was an offer/counter-offer
        if (['offer', 'counter_offer'].includes(message_type)) {
            const nextTurn = negotiation.initiator_id === sender_id ? negotiation.counterparty_id : negotiation.initiator_id;
            await query(
                `UPDATE otc_negotiations SET current_turn = $1, updated_at = NOW() WHERE negotiation_id = $2`,
                [nextTurn, data.negotiation_id]
            );
        }

        return { message_id: uuidv4() };
    }

    /**
     * Make an offer or counter-offer
     */
    static async makeOffer(data: {
        negotiation_id: string;
        sender_id: string;
        quantity: number;
        price_per_credit_inr: number;
        terms?: any;
    }): Promise<void> {
        const { negotiation_id, sender_id, quantity, price_per_credit_inr, terms } = data;

        const { rows: negRows } = await query(
            `SELECT * FROM otc_negotiations WHERE negotiation_id = $1`,
            [negotiation_id]
        );

        if (!negRows.length) throw new Error('Negotiation not found');

        const negotiation = negRows[0];

        if (!['INITIATED', 'NEGOTIATING'].includes(negotiation.state)) {
            throw new Error(`Cannot make offer in state: ${negotiation.state}`);
        }

        if (negotiation.current_turn !== sender_id) {
            throw new Error('Not your turn to make an offer');
        }

        // Record the offer as a message
        await query(
            `INSERT INTO otc_messages (
                message_id, negotiation_id, sender_id, message_type, content,
                offer_quantity, offer_price_inr, offer_terms
            ) VALUES ($1,$2,$3,'offer','Offer: ${quantity} credits @ ₹${price_per_credit_inr}', $2,$3,$4)`,
            [uuidv4(), negotiation_id, sender_id, quantity, price_per_credit_inr, terms || {}]
        );

        // Switch turn
        const nextTurn = negotiation.initiator_id === sender_id ? negotiation.counterparty_id : negotiation.initiator_id;
        await query(
            `UPDATE otc_negotiations SET current_turn = $1, updated_at = NOW() WHERE negotiation_id = $2`,
            [nextTurn, negotiation_id]
        );

        // Log state transition if this is the first offer
        if (negotiation.state === 'INITIATED') {
            await this.transitionState(negotiation_id, 'INITIATED', 'NEGOTIATING', sender_id, 'First offer made');
        }
    }

    /**
     * Accept terms and move to escrow
     */
    static async acceptTerms(negotiationId: string, userId: string): Promise<void> {
        const { rows } = await query(
            `SELECT * FROM otc_negotiations WHERE negotiation_id = $1`,
            [negotiationId]
        );

        if (!rows.length) throw new Error('Negotiation not found');

        const negotiation = rows[0];

        if (negotiation.state !== 'TERMS_AGREED') {
            throw new Error(`Cannot accept terms in state: ${negotiation.state}`);
        }

        if (negotiation.counterparty_id !== userId && negotiation.initiator_id !== userId) {
            throw new Error('Not authorized to accept terms');
        }

        // Transition to ESCROW_FUNDED
        await this.transitionState(negotiationId, 'TERMS_AGREED', 'ESCROW_FUNDED', userId, 'Terms accepted, awaiting escrow funding');
    }

    /**
     * Fund escrow
     */
    static async fundEscrow(data: {
        negotiation_id: string;
        funder_id: string;
        escrow_tx_hash: string;
        escrow_address: string;
    }): Promise<void> {
        const { rows } = await query(
            `SELECT * FROM otc_negotiations WHERE negotiation_id = $1`,
            [data.negotiation_id]
        );

        if (!rows.length) throw new Error('Negotiation not found');

        const negotiation = rows[0];

        if (negotiation.state !== 'ESCROW_FUNDED') {
            throw new Error(`Cannot fund escrow in state: ${negotiation.state}`);
        }

        // Verify transaction on-chain (would integrate with blockchain service)
        // For now, just update state
        await query(
            `UPDATE otc_negotiations 
             SET state = 'SETTLING', escrow_address = $1, escrow_tx_hash = $2, 
                 escrow_funded_at = NOW(), updated_at = NOW()
             WHERE negotiation_id = $1`,
            [data.negotiation_id, data.escrow_address, data.escrow_tx_hash]
        );

        // Log state transition
        await this.logTransition(data.negotiation_id, 'ESCROW_FUNDED', 'SETTLING', data.funder_id, 'Escrow funded');

        // Notify counterparty
        await this.addSystemMessage(data.negotiation_id, 'Escrow has been funded. Proceeding to settlement.');
    }

    /**
     * Complete settlement
     */
    static async completeSettlement(data: {
        negotiation_id: string;
        settler_id: string;
        settlement_tx_hash: string;
    }): Promise<void> {
        const { rows } = await query(
            `SELECT * FROM otc_negotiations WHERE negotiation_id = $1`,
            [data.negotiation_id]
        );

        if (!rows.length) throw new Error('Negotiation not found');

        const negotiation = rows[0];

        if (negotiation.state !== 'SETTLING') {
            throw new Error(`Cannot settle in state: ${negotiation.state}`);
        }

        // Execute settlement via SettlementEngine
        // This would integrate with the settlement engine
        const settlementTxHash = data.settlement_tx_hash;

        await query(
            `UPDATE otc_negotiations 
             SET state = 'SETTLED', settled_at = NOW(), updated_at = NOW()
             WHERE negotiation_id = $1`,
            [data.negotiation_id]
        );

        await this.logTransition(data.negotiation_id, 'SETTLING', 'SETTLED', data.settler_id, 'Settlement completed on-chain');
        
        // Record trade in trades table
        const { rows: batchRows } = await query(
            `SELECT batch_id, quantity, price_per_credit_inr, initiator_id, counterparty_id
             FROM otc_negotiations WHERE negotiation_id = $1`,
            [data.negotiation_id]
        );

        if (batchRows.length) {
            const batch = batchRows[0];
            await query(
                `INSERT INTO trades (
                    trade_id, listing_id, buyer_id, seller_id, batch_id, token_id,
                    quantity, price_per_credit_inr, subtotal_inr,
                    buyer_fee_inr, seller_fee_inr, total_fee_inr, gst_inr,
                    buyer_pays_inr, seller_receives_inr, platform_net_inr,
                    payment_mode, status, buyer_inr_deducted, seller_inr_credited,
                    inr_settlement_at, completed_at, chain_status, chain_tx_hash
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13,$14,$15,'completed',
                        true,true,NOW(),$16,'confirmed')`,
                [
                    uuidv4(), null, negotiation.initiator_id, negotiation.counterparty_id,
                    negotiation.batch_id, null, negotiation.quantity,
                    negotiation.price_per_credit_inr, negotiation.quantity * negotiation.price_per_credit_inr,
                    0, 0, 0, 0, // fees - OTC typically has different fee structure
                    negotiation.quantity * negotiation.price_per_credit_inr, // buyer pays
                    0, 0, // platform fees
                    'otc', 'completed', true, true, new Date(), data.settlement_tx_hash
                ]
            );
        }

        await this.addSystemMessage(negotiationId, 'OTC trade settled successfully.');
    }

    /**
     * Cancel negotiation
     */
    static async cancelNegotiation(negotiationId: string, userId: string, reason: string): Promise<void> {
        const { rows } = await query(
            `SELECT * FROM otc_negotiations WHERE negotiation_id = $1`,
            [negotiationId]
        );

        if (!rows.length) throw new Error('Negotiation not found');

        const negotiation = rows[0];

        if (!['INITIATED', 'NEGOTIATING', 'TERMS_AGREED'].includes(negotiation.state)) {
            throw new Error(`Cannot cancel in state: ${negotiation.state}`);
        }

        if (negotiation.initiator_id !== userId && negotiation.counterparty_id !== userId) {
            throw new Error('Not authorized to cancel this negotiation');
        }

        await query(
            `UPDATE otc_negotiations 
             SET state = 'CANCELLED', cancelled_at = NOW(), cancelled_reason = $1, updated_at = NOW()
             WHERE negotiation_id = $2`,
            [reason, negotiationId]
        );

        await this.logTransition(negotiationId, negotiation.state, 'CANCELLED', userId, reason);
        await this.addSystemMessage(negotiationId, `Negotiation cancelled: ${reason}`);
    }

    /**
     * Get negotiation details
     */
    static async getNegotiation(negotiationId: string) {
        const { rows } = await query(
            `SELECT n.*, 
                    u1.email as initiator_email, u1.full_name as initiator_name,
                    u2.email as counterparty_email, u2.full_name as counterparty_name,
                    b.project_name, b.vintage, b.standard
             FROM otc_negotiations n
             JOIN users u1 ON u1.id = n.initiator_id
             JOIN users u2 ON u2.id = n.counterparty_id
             LEFT JOIN carbon_batches b ON b.id = n.batch_id
             WHERE n.negotiation_id = $1`,
            [negotiationId]
        );
        return rows[0] || null;
    }

    /**
     * Get negotiation messages
     */
    static async getMessages(negotiationId: string, limit = 100, offset = 0) {
        const { rows } = await query(
            `SELECT m.*, u.email as sender_email, u.full_name as sender_name
             FROM otc_messages m
             JOIN users u ON u.id = m.sender_id
             WHERE m.negotiation_id = $1
             ORDER BY m.created_at ASC
             LIMIT $2 OFFSET $3`,
            [negotiationId, limit, offset]
        );
        return rows;
    }

    /**
     * Get user's negotiations
     */
    static async getUserNegotiations(userId: string, state?: string, limit = 50) {
        let sql = `
            SELECT n.*, 
                   u1.email as initiator_email, u1.full_name as initiator_name,
                   u2.email as counterparty_email, u2.full_name as counterparty_name,
                   b.project_name, b.vintage, b.standard
            FROM otc_negotiations n
            JOIN users u1 ON u1.id = n.initiator_id
            JOIN users u2 ON u2.id = n.counterparty_id
            LEFT JOIN carbon_batches b ON b.id = n.batch_id
            WHERE n.initiator_id = $1 OR n.counterparty_id = $1
        `;
        const params: any[] = [userId];
        let paramIndex = 2;

        if (state) {
            sql += ` AND n.state = $${paramIndex++}`;
            params.push(state);
        }

        sql += ` ORDER BY n.updated_at DESC LIMIT $${paramIndex}`;
        params.push(limit);

        const { rows } = await query(sql, params);
        return rows;
    }

    /**
     * Add a system message to negotiation
     */
    static async addSystemMessage(negotiationId: string, content: string): Promise<void> {
        await query(
            `INSERT INTO otc_messages (message_id, negotiation_id, sender_id, message_type, content, is_system_message)
             VALUES ($1,$2,$3,'system',$4,true)`,
            [uuidv4(), negotiationId, 'system', content]
        );
    }

    /**
     * Log state transition
     */
    static async logTransition(
        negotiationId: string,
        fromState: string,
        toState: string,
        triggeredBy: string,
        reason?: string
    ): Promise<void> {
        await query(
            `INSERT INTO otc_state_transitions (transition_id, negotiation_id, from_state, to_state, triggered_by, reason)
             VALUES ($1,$2,$3,$4,$5)`,
            [uuidv4(), negotiationId, fromState, toState, triggeredBy, reason || null]
        );
    }

    /**
     * Add system message to negotiation
     */
    static async addSystemMessage(negotiationId: string, content: string): Promise<void> {
        await query(
            `INSERT INTO otc_messages (message_id, negotiation_id, sender_id, message_type, content, is_system_message)
             VALUES ($1,$2,$3,'system',$4,true)`,
            [uuidv4(), negotiationId, 'system', content]
        );
    }

    /**
     * Validate state transition
     */
    private static validateTransition(fromState: string, toState: string): boolean {
        const validTransitions = this.VALID_TRANSITIONS[fromState] || [];
        return validTransitions.includes(toState);
    }

    /**
     * Execute state transition
     */
    static async transitionState(
        negotiationId: string,
        fromState: string,
        toState: string,
        triggeredBy: string,
        reason?: string
    ): Promise<void> {
        if (!this.validateTransition(fromState, toState)) {
            throw new Error(`Invalid state transition: ${fromState} -> ${toState}`);
        }

        await query(
            `UPDATE otc_negotiations SET state = $1, updated_at = NOW() WHERE negotiation_id = $2`,
            [toState, negotiationId]
        );

        await this.logTransition(negotiationId, fromState, toState, triggeredBy, reason);
    }
}

export default OTCService;