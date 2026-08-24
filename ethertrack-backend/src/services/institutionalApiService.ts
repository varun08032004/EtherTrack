// Institutional API Service
// Provides API access for institutional clients (banks, insurers, corporates)

import { safeQuery as query, withTransaction } from '../../db/pool.js';
import { v4 as uuidv4 } from 'uuid';

export interface APIKey {
    key_id: string;
    user_id: string;
    org_id: string | null;
    name: string;
    key_prefix: string;
    key_hash: string;
    scopes: string[];
    rate_limit_tier: string;
    requests_per_minute: number;
    requests_per_day: number;
    allowed_ips: string[];
    is_active: boolean;
    last_used_at: string | null;
    expires_at: string | null;
    metadata: any;
    created_by: string;
    created_at: string;
    updated_at: string;
}

export interface WebhookEndpoint {
    endpoint_id: string;
    user_id: string;
    api_key_id: string | null;
    url: string;
    secret: string;
    events: string[];
    retry_config: any;
    is_active: boolean;
    last_triggered_at: string | null;
    success_count: number;
    failure_count: number;
    last_failure_at: string | null;
    last_failure_reason: string | null;
    description: string;
    created_by: string;
    created_at: string;
    updated_at: string;
}

export interface WebhookDelivery {
    delivery_id: string;
    endpoint_id: string;
    event_type: string;
    event_id: string;
    payload: any;
    headers: any;
    status_code: number | null;
    response_body: string | null;
    response_headers: any;
    started_at: string;
    completed_at: string | null;
    duration_ms: number | null;
    success: boolean;
    error_message: string | null;
    attempt: number;
    next_retry_at: string | null;
    idempotency_key: string | null;
    created_at: string;
}

export interface ProcurementQuote {
    quote_id: string;
    buyer_id: string;
    asset_ids: string[];
    quantities: number[];
    total_quantity: number;
    indicative_price_inr: number;
    valid_until: string;
    terms: any;
}

export interface ProcurementOrder {
    order_id: string;
    quote_id: string;
    buyer_id: string;
    asset_ids: string[];
    quantities: number[];
    total_quantity: number;
    price_per_credit_inr: number;
    total_price_inr: number;
    status: string;
    settlement_type: string;
    created_at: string;
    settled_at: string | null;
}

export class InstitutionalAPIService {
    private static readonly RATE_LIMITS = {
        starter: { rpm: 30, rpd: 1000 },
        growth: { rpm: 60, rpd: 10000 },
        corporate: { rpm: 120, rpd: 50000 },
        enterprise: { rpm: 300, rpd: 200000 }
    };

    /**
     * Create API key for user
     */
    static async createAPIKey(data: {
        user_id: string;
        org_id?: string;
        name: string;
        scopes: string[];
        rate_limit_tier?: string;
        allowed_ips?: string[];
        expires_at?: string;
    }): Promise<{ key_id: string; api_key: string }> {
        const fullKey = `et_${uuidv4()}`;
        const keyHash = require('crypto').createHash('sha256').update(fullKey).digest('hex');
        const keyPrefix = fullKey.substring(0, 8);

        const tier = data.rate_limit_tier || 'growth';
        const limits = this.RATE_LIMITS[tier as keyof typeof this.RATE_LIMITS] || this.RATE_LIMITS.growth;

        const { rows } = await query(
            `INSERT INTO api_keys (
                key_id, user_id, org_id, name, key_prefix, key_hash,
                scopes, rate_limit_tier, requests_per_minute, requests_per_day,
                allowed_ips, is_active, expires_at, created_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$10,$11)
            RETURNING key_id`,
            [
                uuidv4(), data.user_id, data.org_id || null, data.name, keyPrefix, keyHash,
                data.scopes, tier, limits.rpm, limits.rpd,
                data.allowed_ips || [], data.expires_at || null, data.user_id
            ]
        );

        return { key_id: rows[0].key_id, api_key: fullKey };
    }

    /**
     * Validate API key and return user/org info
     */
    static async validateAPIKey(apiKey: string): Promise<{ user_id: string; org_id: string; scopes: string[]; key_id: string } | null> {
        const keyHash = require('crypto').createHash('sha256').update(apiKey).digest('hex');
        const keyPrefix = apiKey.substring(0, 8);

        const { rows } = await query(
            `SELECT key_id, user_id, org_id, scopes, is_active, expires_at
             FROM api_keys WHERE key_hash = $1 AND key_prefix = $1`,
            [keyHash, keyPrefix]
        );

        if (!rows.length) return null;
        const key = rows[0];

        if (!key.is_active) return null;
        if (key.expires_at && new Date(key.expires_at) < new Date()) return null;

        return {
            user_id: key.user_id,
            org_id: key.org_id,
            scopes: key.scopes,
            key_id: key.key_id
        };
    }

    /**
     * Revoke API key
     */
    static async revokeAPIKey(keyId: string, userId: string): Promise<void> {
        await query(
            `UPDATE api_keys SET is_active = false, updated_at = NOW()
             WHERE key_id = $1 AND user_id = $2`,
            [keyId, userId]
        );
    }

    /**
     * List user's API keys
     */
    static async listAPIKeys(userId: string) {
        const { rows } = await query(
            `SELECT key_id, name, key_prefix, scopes, rate_limit_tier, is_active, last_used_at, expires_at, created_at
             FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
            [userId]
        );
        return rows;
    }

    // ============ Webhook Management ============

    /**
     * Register webhook endpoint
     */
    static async registerWebhook(data: {
        user_id: string;
        api_key_id?: string;
        url: string;
        events: string[];
        secret: string;
        retry_config?: any;
        description?: string;
    }): Promise<{ endpoint_id: string }> {
        const endpoint_id = uuidv4();
        const secretHash = require('crypto').createHash('sha256').update(data.secret).digest('hex');

        await query(
            `INSERT INTO webhook_endpoints (
                endpoint_id, user_id, api_key_id, url, secret, events,
                retry_config, is_active, description, created_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9)
            RETURNING endpoint_id`,
            [
                uuidv4(), data.user_id, data.api_key_id || null, data.url, data.secret,
                data.events, JSON.stringify(data.retry_config || {}), data.description || null, data.user_id
            ]
        );

        return { endpoint_id: uuidv4() };
    }

    /**
     * Trigger webhook event
     */
    static async triggerWebhook(eventType: string, eventId: string, payload: any): Promise<number> {
        const { rows: subscriptions } = await query(
            `SELECT endpoint_id, url, secret_hash, events, retry_config, secret_hash
             FROM webhook_subscriptions
             WHERE is_active = true AND is_paused = false
             AND $1 = ANY(event_types)`,
            [eventType]
        );

        let delivered = 0;
        for (const sub of subscriptions) {
            if (!sub.events.includes(eventType)) continue;

            // Check filters
            if (sub.filters) {
                // Apply filters
            }

            const idempotencyKey = `${eventType}:${eventId}:${sub.subscription_id}`;
            const payload = {
                event_type: eventType,
                event_id: eventId,
                payload,
                timestamp: new Date().toISOString()
            };

            const signature = require('crypto')
                .createHmac('sha256', sub.secret_hash)
                .update(JSON.stringify(payload))
                .digest('hex');

            const headers = {
                'Content-Type': 'application/json',
                'X-EtherTrack-Signature': signature,
                'X-EtherTrack-Event': eventType,
                'X-EtherTrack-Delivery': uuidv4(),
                'X-EtherTrack-Timestamp': new Date().toISOString()
            };

            // Fire and forget with retry logic
            this.deliverWebhook(sub, payload, headers, idempotencyKey).catch(e => {
                console.error(`Webhook delivery failed for ${sub.endpoint_id}:`, e);
            });

            delivered++;
        }

        return delivered;
    }

    private static async deliverWebhook(
        subscription: any,
        payload: any,
        headers: Record<string, string>,
        idempotencyKey: string
    ): Promise<void> {
        const { endpoint_id, url, retry_config, secret_hash } = subscription;
        const maxRetries = retry_config?.max_retries || 3;
        const backoffMultiplier = retry_config?.backoff_multiplier || 2;
        const maxBackoff = retry_config?.max_backoff_seconds || 300;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const idempotencyKey = `${payload.event_type}:${payload.event_id}:${attempt}`;

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...headers,
                        'X-EtherTrack-Signature': require('crypto')
                            .createHmac('sha256', secret)
                            .update(JSON.stringify(payload))
                            .digest('hex')
                    },
                    body: JSON.stringify(payload)
                });

                await query(
                    `INSERT INTO webhook_deliveries (
                        delivery_id, endpoint_id, event_type, event_id, payload, headers,
                        status_code, response_body, response_headers, started_at,
                        completed_at, duration_ms, success, error_message, attempt, idempotency_key
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
                    [
                        uuidv4(), subscription.endpoint_id, payload.event_type, payload.event_id,
                        JSON.stringify(payload), JSON.stringify(headers),
                        response.status, response.body, JSON.stringify(response.headers),
                        new Date(), new Date(), Date.now() - Date.now(),
                        response.ok, null, attempt, idempotencyKey
                    ]
                );

                if (response.ok) return;

                // Retry logic
                if (attempt < 3) {
                    const backoff = Math.min(
                        (retry_config?.backoff_multiplier || 2) ** attempt * (retry_config?.base_backoff_seconds || 60),
                        retry_config?.max_backoff_seconds || 300
                    );
                    await new Promise(r => setTimeout(r, backoff * 1000));
                }
            } catch (error) {
                if (attempt >= 3) {
                    await query(
                        `INSERT INTO webhook_deliveries (..., success, error_message, attempt)
                         VALUES (..., false, $1, 3)`,
                        [error.message]
                    );
                }
                await new Promise(r => setTimeout(r, 1000 * attempt));
            }
        }
    }

    // ============ Market Data API ============

    /**
     * Get real-time market data
     */
    static async getMarketData(options: {
        asset_ids?: string[];
        methodology?: string;
        vintage?: number;
        limit?: number;
    }) {
        let sql = `
            SELECT a.asset_id, a.project_name, a.vintage, a.registry, a.standard,
                   a.last_traded_price, a.last_traded_at, a.price_30d_avg, a.price_30d_vol,
                   a.ecs_score, a.ecs_grade, a.available_quantity
            FROM carbon_asset_passports a
            WHERE a.state = 'ACTIVE' AND a.available_quantity > 0
        `;
        const queryParams: any[] = [];
        let paramIndex = 1;

        if (options.asset_ids?.length) {
            // Would need to join with asset_ids
        }
        if (options.methodology) {
            // Filter by methodology
        }
        if (options.vintage) {
            // Filter by vintage
        }

        sql += ` ORDER BY a.last_traded_at DESC NULLS LAST LIMIT $${paramIndex++}`;
        queryParams.push(options.limit || 50);

        const { rows } = await query(sql, queryParams);
        return rows;
    }

    /**
     * Get price indices
     */
    static async getPriceIndices(options: {
        methodology?: string;
        vintage?: number;
        geography?: string;
        days?: number;
    }) {
        let sql = `
            SELECT date, index_value, volume, methodology, vintage, geography
            FROM price_indices
            WHERE 1=1
        `;
        const queryParams: any[] = [];
        let paramIndex = 1;

        if (options.methodology) {
            sql += ` AND methodology = $${paramIndex++}`;
            queryParams.push(options.methodology);
        }
        if (options.vintage) {
            sql += ` AND vintage = $${paramIndex++}`;
            queryParams.push(options.vintage);
        }
        if (options.geography) {
            sql += ` AND geography = $${paramIndex++}`;
            queryParams.push(options.geography);
        }
        if (options.days) {
            sql += ` AND date >= CURRENT_DATE - INTERVAL '${options.days} days'`;
        }

        sql += ` ORDER BY date DESC LIMIT 1000`;

        const { rows } = await query(sql, queryParams);
        return rows;
    }

    /**
     * Get market statistics
     */
    static async getMarketStats() {
        const { rows } = await query(`
            SELECT 
                COUNT(DISTINCT a.asset_id) as total_assets,
                SUM(a.available_quantity) as total_available_credits,
                SUM(a.last_traded_price * a.available_quantity) as market_cap_inr,
                AVG(a.ecs_score) as avg_ecs_score,
                COUNT(DISTINCT a.registry) as active_registries,
                COUNT(DISTINCT a.methodology) as active_methodologies
            FROM carbon_asset_passports a
            WHERE a.state = 'ACTIVE' AND a.available_quantity > 0
        `);
        return rows[0];
    }

    // ============ Compliance API ============

    /**
     * Get CCTS compliance position for entity
     */
    static async getCompliancePosition(entityId: string) {
        const { rows } = await query(`
            SELECT 
                gei_baseline, gei_target, actual_gei,
                ccc_surplus, ccc_deficit,
                ccc_purchased, ccc_surrendered,
                compliance_status, surrender_deadline
            FROM ccts_profiles
            WHERE entity_id = $1`,
            [entityId]
        );
        return rows[0] || null;
    }

    /**
     * Get procurement plan for compliance
     */
    static async getProcurementPlan(entityId: string) {
        const profile = await this.getCompliancePosition(entityId);
        if (!profile) return null;

        if (profile.ccc_deficit > 0) {
            // Need to procure credits
            const { rows: availableCredits } = await query(`
                SELECT a.asset_id, a.project_name, a.registry, a.vintage,
                       a.standard, a.ecs_score, a.last_traded_price, a.available_quantity
                FROM carbon_asset_passports a
                WHERE a.ccts_compliance_eligible = TRUE
                  AND a.state = 'ACTIVE'
                  AND a.available_quantity > 0
                ORDER BY a.last_traded_price ASC
                LIMIT 50
            `);

            return {
                deficit: profile.ccc_deficit,
                surplus: profile.ccc_surplus,
                required_procurement: profile.ccc_deficit,
                available_options: availableCredits,
                deadline: profile.surrender_deadline
            };
        }

        return {
            deficit: 0,
            surplus: profile.ccc_surplus,
            required_procurement: 0,
            available_options: [],
            deadline: profile.surrender_deadline
        };
    }

    // ============ Webhook Management ============

    /**
     * Register webhook endpoint
     */
    static async registerWebhook(data: {
        user_id: string;
        api_key_id?: string;
        url: string;
        events: string[];
        secret: string;
        retry_config?: any;
        description?: string;
    }): Promise<{ endpoint_id: string }> {
        const endpoint_id = uuidv4();
        const secretHash = require('crypto').createHash('sha256').update(data.secret).digest('hex');

        await query(
            `INSERT INTO webhook_endpoints (
                endpoint_id, user_id, api_key_id, url, secret, events,
                retry_config, is_active, description, created_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9)
            RETURNING endpoint_id`,
            [
                uuidv4(), data.user_id, data.api_key_id || null, data.url, data.secret,
                data.events, JSON.stringify(data.retry_config || {}), data.description || null, data.user_id
            ]
        );

        return { endpoint_id: uuidv4() };
    }

    /**
     * List webhook endpoints
     */
    static async listWebhooks(userId: string) {
        const { rows } = await query(
            `SELECT endpoint_id, url, events, is_active, is_paused, success_count, failure_count,
                    last_triggered_at, last_failure_at, created_at
             FROM webhook_endpoints
             WHERE user_id = $1
             ORDER BY created_at DESC`,
            [userId]
        );
        return rows;
    }

    /**
     * Delete webhook endpoint
     */
    static async deleteWebhook(endpointId: string, userId: string): Promise<void> {
        await query(
            `DELETE FROM webhook_endpoints WHERE endpoint_id = $1 AND user_id = $2`,
            [endpointId, userId]
        );
    }

    /**
     * Get webhook delivery logs
     */
    static async getWebhookLogs(endpointId: string, limit = 100, offset = 0) {
        const { rows } = await query(
            `SELECT delivery_id, event_type, event_id, status_code, success,
                    error_message, attempt, duration_ms, created_at
             FROM webhook_delivery_logs
             WHERE endpoint_id = $1
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3`,
            [endpointId, limit, offset]
        );
        return rows;
    }

    // ============ Usage Analytics ============

    /**
     * Get API usage statistics
     */
    static async getUsageStats(keyId: string, days = 30) {
        const { rows } = await query(
            `SELECT DATE(created_at) as date, COUNT(*) as requests,
                    COUNT(*) FILTER (WHERE status_code >= 400) as errors,
                    AVG(duration_ms) as avg_latency_ms,
                    SUM(response_size_bytes) as total_bytes
             FROM api_usage_logs
             WHERE api_key_id = $1 AND created_at >= NOW() - INTERVAL '${days} days'
             GROUP BY DATE(created_at)
             ORDER BY date DESC`,
            [keyId]
        );
        return rows;
    }

    /**
     * Get rate limit status for API key
     */
    static async getRateLimitStatus(keyId: string) {
        const { rows: keyRows } = await query(
            `SELECT rate_limit_tier, requests_per_minute, requests_per_day, is_active
             FROM api_keys WHERE key_id = $1`,
            [keyId]
        );

        if (!keyRows.length) return null;

        const key = keyRows[0];
        const { rows: usageRows } = await query(
            `SELECT COUNT(*) as used_last_minute,
                    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day') as used_today
             FROM api_usage_logs
             WHERE api_key_id = $1 AND created_at > NOW() - INTERVAL '1 day'`,
            [keyId]
        );

        return {
            tier: key.rate_limit_tier,
            limits: {
                per_minute: key.requests_per_minute,
                per_day: key.requests_per_day
            },
            usage: {
                last_minute: parseInt(usageRows[0]?.used_last_minute || '0'),
                today: parseInt(usageRows[0]?.used_today || '0')
            },
            is_active: key.is_active
        };
    }

    // ============ Procurement API ============

    /**
     * Get procurement quote
     */
    static async getProcurementQuote(data: {
        buyer_id: string;
        asset_ids: string[];
        quantities: number[];
    }): Promise<any> {
        const { rows } = await query(
            `SELECT a.asset_id, a.project_name, a.registry, a.vintage, a.standard,
                    a.ecs_score, a.ecs_grade, a.last_traded_price, a.available_quantity
             FROM carbon_asset_passports a
             WHERE a.asset_id = ANY($1) AND a.state = 'ACTIVE' AND a.available_quantity > 0`,
            [data.asset_ids]
        );

        if (rows.length !== data.asset_ids.length) {
            throw new Error('Some assets not found or not available');
        }

        let totalQuantity = 0;
        let totalPrice = 0;

        for (let i = 0; i < rows.length; i++) {
            const asset = rows[i];
            const qty = data.quantities[i];
            if (qty > asset.available_quantity) {
                throw new Error(`Insufficient quantity for asset ${asset.asset_id}`);
            }
            totalQuantity += qty;
            totalPrice += qty * (asset.last_traded_price || 0);
        }

        const quoteId = uuidv4();
        const validUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min validity

        await query(
            `INSERT INTO procurement_quotes (quote_id, buyer_id, asset_ids, quantities, total_quantity,
                    indicative_price_inr, valid_until, terms, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
             RETURNING quote_id`,
            [uuidv4(), data.buyer_id, data.asset_ids, data.quantities, totalQuantity, totalPrice, validUntil, JSON.stringify({})]
        );

        return { quote_id: quoteId, total_quantity: totalQuantity, indicative_price_inr: totalPrice, valid_until: validUntil };
    }

    /**
     * Execute procurement order
     */
    static async executeProcurementOrder(data: {
        quote_id: string;
        buyer_id: string;
        payment_mode: 'inr_wallet' | 'razorpay' | 'bank_transfer';
    }): Promise<{ order_id: string }> {
        // Verify quote
        const { rows: quoteRows } = await query(
            `SELECT * FROM procurement_quotes WHERE quote_id = $1 AND buyer_id = $2 AND valid_until > NOW()`,
            [data.quote_id, data.buyer_id]
        );

        if (!quoteRows.length) throw new Error('Invalid or expired quote');

        // Execute via SettlementEngine
        // This would create orders for each asset and execute settlement

        const orderId = uuidv4();
        return { order_id: orderId };
    }
}

export default InstitutionalAPIService;