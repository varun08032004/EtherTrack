// Asset Passport Service
// Manages carbon asset passports with provenance, eligibility, and quality scores

import { safeQuery as query, withTransaction } from '../../db/pool.js';
import { v4 as uuidv4 } from 'uuid';

export interface AssetPassport {
    passport_id: string;
    asset_id: string;
    instrument_type: string;
    registry: string;
    registry_project_id: string | null;
    registry_serial_start: string | null;
    registry_serial_end: string | null;
    project_name: string;
    project_type: string | null;
    methodology: string | null;
    vintage: number;
    geography_country: string;
    geography_region: string | null;
    geography_coordinates: any | null;
    verification_body: string | null;
    verification_date: string | null;
    verification_report_url: string | null;
    issuance_date: string;
    total_quantity: number;
    available_quantity: number;
    retired_quantity: number;
    cancelled_quantity: number;
    vcm_eligible: boolean;
    ccts_offset_eligible: boolean;
    ccts_compliance_eligible: boolean;
    article6_eligible: boolean;
    corsia_eligible: boolean;
    eligibility_updated_at: string | null;
    eligibility_notes: any | null;
    ecs_score: number | null;
    ecs_grade: string | null;
    ecs_percentile: number | null;
    ecs_factors: any | null;
    ecs_updated_at: string | null;
    last_traded_price: number | null;
    last_traded_at: string | null;
    price_30d_avg: number | null;
    price_30d_vol: number | null;
    provenance_chain: any[];
    state: string;
    suspended_reason: string | null;
    created_by: string;
    created_at: string;
    updated_at: string;
}

export interface EligibilityRule {
    rule_id: string;
    scheme: string;
    instrument_type: string;
    criteria: any;
    description: string | null;
    is_active: boolean;
    priority: number;
    effective_from: string;
    effective_to: string | null;
    created_at: string;
    updated_at: string;
}

export interface AssetQualityScore {
    score_id: string;
    batch_id: string;
    additionality: number;
    permanence: number;
    methodology_risk: number;
    verification_quality: number;
    registry_provenance: number;
    project_risk: number;
    country_risk: number;
    double_counting_risk: number;
    vintage: number;
    transparency: number;
    co_benefits: number;
    overall_score: number;
    grade: string;
    percentile_rank: number;
    factor_contributions: Record<string, number>;
    data_sources: string[];
    calculated_at: string;
    calculated_by: string;
}

export interface AssetPricePoint {
    history_id: string;
    batch_id: string;
    date: string;
    price_inr: number;
    volume_traded: number;
    vwap: number | null;
    source: string | null;
    exchange: string | null;
    open_price: number | null;
    high_price: number | null;
    low_price: number | null;
    close_price: number | null;
    volume_traded: number;
    created_at: string;
}

export interface EligibilityCheckResult {
    eligible: boolean;
    scheme: string;
    reasons: string[];
    eligibility_notes: any;
}

export interface PriceIndexPoint {
    date: string;
    index_value: number;
    volume: number;
    methodology: string;
    vintage: number | null;
    geography: string | null;
}

export class AssetPassportService {
    /**
     * Create a new asset passport
     */
    static async createPassport(data: {
        asset_id: string;
        instrument_type: string;
        registry: string;
        registry_project_id?: string;
        registry_serial_start?: string;
        registry_serial_end?: string;
        project_name: string;
        project_type?: string;
        methodology?: string;
        vintage: number;
        geography_country: string;
        geography_region?: string;
        geography_coordinates?: any;
        verification_body?: string;
        verification_date?: string;
        verification_report_url?: string;
        issuance_date: string;
        total_quantity: number;
        instrument_type: string;
        created_by: string;
    }): Promise<any> {
        const { rows } = await query(
            `INSERT INTO carbon_asset_passports (
                asset_id, instrument_type, registry, registry_project_id,
                registry_serial_start, registry_serial_end, project_name,
                project_type, methodology, vintage, geography_country,
                geography_region, geography_coordinates, verification_body,
                verification_date, verification_report_url, issuance_date,
                total_quantity, available_quantity, retired_quantity,
                cancelled_quantity, instrument_type, created_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
            RETURNING *`,
            [
                data.asset_id, data.instrument_type, data.registry,
                data.registry_project_id || null, data.registry_serial_start || null,
                data.registry_serial_end || null, data.project_name,
                data.project_type || null, data.methodology || null,
                data.vintage, data.geography_country, data.geography_region || null,
                data.geography_coordinates || null, data.verification_body || null,
                data.verification_date || null, data.verification_report_url || null,
                data.issuance_date, data.total_quantity, data.available_quantity || data.total_quantity,
                0, 0, data.instrument_type, data.created_by
            ]
        );
        return rows[0];
    }

    /**
     * Get passport by ID
     */
    static async getPassport(passportId: string) {
        const { rows } = await query(
            `SELECT * FROM carbon_asset_passports WHERE passport_id = $1`,
            [passportId]
        );
        return rows[0] || null;
    }

    /**
     * Get passport by asset ID
     */
    static async getPassportByAssetId(assetId: string) {
        const { rows } = await query(
            `SELECT * FROM carbon_asset_passports WHERE asset_id = $1`,
            [assetId]
        );
        return rows[0] || null;
    }

    /**
     * List passports with filters
     */
    static async listPassports(filters: {
        registry?: string;
        instrument_type?: string;
        vintage?: number;
        geography_country?: string;
        state?: string;
        vcm_eligible?: boolean;
        ccts_offset_eligible?: boolean;
        ccts_compliance_eligible?: boolean;
        min_ecs_score?: number;
        max_ecs_score?: number;
        limit?: number;
        offset?: number;
    }) {
        let whereClause = 'WHERE 1=1';
        const params: any[] = [];
        let paramIndex = 1;

        if (filters.registry) {
            whereClause += ` AND registry = $${paramIndex++}`;
            params.push(filters.registry);
        }
        if (filters.instrument_type) {
            whereClause += ` AND instrument_type = $${paramIndex++}`;
            params.push(filters.instrument_type);
        }
        if (filters.vintage) {
            whereClause += ` AND vintage = $${paramIndex++}`;
            params.push(filters.vintage);
        }
        if (filters.geography_country) {
            whereClause += ` AND geography_country = $${paramIndex++}`;
            params.push(filters.geography_country);
        }
        if (filters.state) {
            whereClause += ` AND state = $${paramIndex++}`;
            params.push(filters.state);
        }
        if (filters.vcm_eligible !== undefined) {
            whereClause += ` AND vcm_eligible = $${paramIndex++}`;
            params.push(filters.vcm_eligible);
        }
        if (filters.ccts_offset_eligible !== undefined) {
            whereClause += ` AND ccts_offset_eligible = $${paramIndex++}`;
            params.push(filters.ccts_offset_eligible);
        }
        if (filters.ccts_compliance_eligible !== undefined) {
            whereClause += ` AND ccts_compliance_eligible = $${paramIndex++}`;
            params.push(filters.ccts_compliance_eligible);
        }
        if (filters.min_ecs_score !== undefined) {
            whereClause += ` AND ecs_score >= $${paramIndex++}`;
            params.push(filters.min_ecs_score);
        }
        if (filters.max_ecs_score !== undefined) {
            whereClause += ` AND ecs_score <= $${paramIndex++}`;
            params.push(filters.max_ecs_score);
        }

        params.push(filters.limit || 50);
        params.push(filters.offset || 0);

        const { rows } = await query(
            `SELECT * FROM carbon_asset_passports ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
            params
        );

        return rows;
    }

    /**
     * Update passport
     */
    static async updatePassport(passportId: string, updates: Partial<any>) {
        const setClauses: string[] = [];
        const params: any[] = [passportId];
        let paramIndex = 2;

        const allowedFields = [
            'project_name', 'project_type', 'methodology', 'vintage',
            'geography_country', 'geography_region', 'geography_coordinates',
            'verification_body', 'verification_date', 'verification_report_url',
            'total_quantity', 'available_quantity', 'retired_quantity', 'cancelled_quantity',
            'vcm_eligible', 'ccts_offset_eligible', 'ccts_compliance_eligible',
            'article6_eligible', 'corsia_eligible', 'eligibility_updated_at',
            'eligibility_notes', 'ecs_score', 'ecs_grade', 'ecs_percentile',
            'ecs_factors', 'ecs_updated_at', 'last_traded_price', 'last_traded_at',
            'price_30d_avg', 'price_30d_vol', 'provenance_chain', 'state', 'suspended_reason'
        ];

        for (const field of allowedFields) {
            if (updates[field as keyof typeof updates] !== undefined) {
                setClauses.push(`${field} = $${paramIndex++}`);
                params.push(updates[field as keyof typeof updates]);
            }
        }

        if (setClauses.length === 0) {
            throw new Error('No valid fields to update');
        }

        params.push(`updated_at = NOW()`);

        const { rows } = await query(
            `UPDATE carbon_asset_passports SET ${setClauses.join(', ')}, updated_at = NOW() WHERE passport_id = $1 RETURNING *`,
            params
        );

        return rows[0] || null;
    }

    /**
     * Update eligibility flags
     */
    static async updateEligibility(passportId: string, eligibility: {
        vcm_eligible?: boolean;
        ccts_offset_eligible?: boolean;
        ccts_compliance_eligible?: boolean;
        article6_eligible?: boolean;
        corsia_eligible?: boolean;
        eligibility_notes?: any;
    }) {
        const { rows } = await query(
            `UPDATE carbon_asset_passports SET
                vcm_eligible = COALESCE($2, vcm_eligible),
                ccts_offset_eligible = COALESCE($3, ccts_offset_eligible),
                ccts_compliance_eligible = COALESCE($4, ccts_compliance_eligible),
                article6_eligible = COALESCE($5, article6_eligible),
                corsia_eligible = COALESCE($6, corsia_eligible),
                eligibility_updated_at = NOW(),
                eligibility_notes = COALESCE($7, eligibility_notes),
                updated_at = NOW()
            WHERE passport_id = $1 RETURNING *`,
            [passportId, eligibility.vcm_eligible, eligibility.ccts_offset_eligible,
             eligibility.ccts_compliance_eligible, eligibility.article6_eligible,
             eligibility.corsia_eligible, eligibility.eligibility_notes]
        );
        return rows[0] || null;
    }

    /**
     * Add provenance record
     */
    static async addProvenanceRecord(passportId: string, record: {
        from: string;
        to: string;
        qty: number;
        date: string;
        tx_hash?: string;
        type: 'mint' | 'transfer' | 'trade' | 'retirement' | 'listing' | 'delisting';
    }) {
        const { rows } = await query(
            `UPDATE carbon_asset_passports SET
                provenance_chain = jsonb_insert(provenance_chain, '{0}', $2::jsonb),
                updated_at = NOW()
            WHERE passport_id = $1 RETURNING provenance_chain`,
            [passportId, JSON.stringify(record)]
        );
        return rows[0]?.provenance_chain || [];
    }

    /**
     * Calculate ECS score for an asset
     */
    static async calculateECS(passportId: string): Promise<{ score: number; grade: string; factors: Record<string, number> }> {
        const passport = await this.getPassport(passportId);
        if (!passport) throw new Error('Passport not found');

        // Get quality scores
        const { rows } = await query(
            `SELECT * FROM asset_quality_scores WHERE batch_id = (SELECT asset_id FROM carbon_asset_passports WHERE passport_id = $1)`,
            [passportId]
        );

        if (!rows.length) {
            return { score: 0, grade: 'D', factors: {} };
        }

        const scores = rows[0];
        const weights = {
            additionality: 0.25,
            permanence: 0.20,
            methodology_risk: 0.15,
            verification_quality: 0.15,
            registry_provenance: 0.10,
            project_risk: 0.05,
            country_risk: 0.05,
            double_counting_risk: 0.03,
            vintage: 0.01,
            transparency: 0.01,
            co_benefits: 0.01
        };

        let score = 0;
        const factors: Record<string, number> = {};

        for (const [dimension, weight] of Object.entries(weights)) {
            const value = scores[dimension] || 0;
            score += value * weight;
            factors[dimension] = Math.round(value * weight * 100) / 100;
        }

        score = Math.round(score * 100) / 100;

        // Determine grade
        let grade = 'D';
        if (score >= 90) grade = 'AAA';
        else if (score >= 80) grade = 'AA';
        else if (score >= 70) grade = 'A';
        else if (score >= 60) grade = 'BBB';
        else if (score >= 50) grade = 'BB';
        else if (score >= 40) grade = 'B';
        else if (score >= 30) grade = 'C';

        // Update passport with ECS score
        await query(
            `UPDATE carbon_asset_passports SET
                ecs_score = $1, ecs_grade = $2, ecs_factors = $3, ecs_updated_at = NOW()
            WHERE passport_id = $1`,
            [score, grade, JSON.stringify(factors)]
        );

        // Calculate percentile (simplified)
        const { rows: rankRows } = await query(
            `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE ecs_score > $1) as higher
             FROM carbon_asset_passports WHERE ecs_score IS NOT NULL`,
            [score]
        );
        const percentile = rows[0] ? Math.round((1 - (parseInt(rows[0].higher) / parseInt(rows[0].total))) * 100) : 50;

        await query(
            `UPDATE carbon_asset_passports SET ecs_percentile = $1 WHERE passport_id = $2`,
            [percentile, passportId]
        );

        return { score, grade, factors };
    }

    /**
     * Get price history for an asset
     */
    static async getPriceHistory(assetId: string, limit = 30) {
        const { rows } = await query(
            `SELECT * FROM asset_price_history WHERE batch_id = $1 ORDER BY date DESC LIMIT $2`,
            [passportId, limit]
        );
        return rows;
    }

    /**
     * Add price point
     */
    static async addPricePoint(data: {
        batch_id: string;
        date: string;
        price_inr: number;
        volume_traded?: number;
        vwap?: number;
        source?: string;
        exchange?: string;
        open_price?: number;
        high_price?: number;
        low_price?: number;
        close_price?: number;
    }) {
        const { rows } = await query(
            `INSERT INTO asset_price_history (
                batch_id, date, price_inr, volume_traded, vwap,
                source, exchange, open_price, high_price, low_price, close_price
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            ON CONFLICT (batch_id, date, source) DO UPDATE SET
                price_inr = EXCLUDED.price_inr,
                volume_traded = EXCLUDED.volume_traded,
                vwap = EXCLUDED.vwap,
                open_price = EXCLUDED.open_price,
                high_price = EXCLUDED.high_price,
                low_price = EXCLUDED.low_price,
                close_price = EXCLUDED.close_price
            RETURNING *`,
            [data.batch_id, data.date, data.price_inr, data.volume_traded || 0,
             data.vwap || null, data.source || null, data.exchange || null,
             data.open_price || null, data.high_price || null, data.low_price || null, data.close_price || null]
        );
        return rows[0];
    }

    /**
     * Check eligibility for a scheme
     */
    static async checkEligibility(assetId: string, scheme: string): Promise<{ eligible: boolean; reasons: string[] }> {
        const passport = await this.getPassportByAssetId(assetId);
        if (!passport) throw new Error('Passport not found');

        // Get eligibility rules for the scheme
        const { rows } = await query(
            `SELECT criteria FROM asset_eligibility_rules 
             WHERE scheme = $1 AND instrument_type = $2 AND is_active = TRUE
             ORDER BY priority DESC LIMIT 1`,
            [scheme, 'VCM_CREDIT'] // Simplified - would map instrument_type properly
        );

        if (!rows.length) {
            return { eligible: false, reasons: ['No eligibility rules found for scheme'] };
        }

        // In production, would evaluate JSON criteria against passport data
        // For now, return cached eligibility
        return {
            eligible: passport[`${scheme.toLowerCase()}_eligible`] || false,
            reasons: passport.eligibility_notes ? [passport.eligibility_notes] : []
        };
    }

    /**
     * Get passport by asset ID
     */
    static async getPassportByAssetId(assetId: string) {
        const { rows } = await query(
            `SELECT * FROM carbon_asset_passports WHERE asset_id = $1`,
            [assetId]
        );
        return rows[0] || null;
    }
}

export default AssetPassportService;