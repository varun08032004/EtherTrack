// Emission Factor Library Service
// Server-side emission factor management with versioning and audit trail

import { safeQuery as query, withTransaction } from '../../db/pool.js';

export interface EmissionFactor {
    factorId: string;
    factorCode: string;
    name: string;
    description: string;
    category: string;
    subCategory: string;
    factorValue: number;
    unitNumerator: string;
    unitDenominator: string;
    ghgScope: 1 | 2 | 3;
    geography: string;
    region: string | null;
    sector: string | null;
    source: string;
    sourceVersion: string | null;
    sourceDocumentUrl: string | null;
    effectiveFrom: string;
    effectiveTo: string | null;
    uncertaintyPct: number | null;
    qualityRating: string | null;
    isActive: boolean;
    isCustom: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface EmissionFactorVersion {
    versionId: string;
    factorId: string;
    factorValue: number;
    unitNumerator: string;
    unitDenominator: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    changeReason: string | null;
    changedBy: string | null;
    createdAt: string;
}

export interface MethodologyTemplate {
    templateId: string;
    templateCode: string;
    name: string;
    description: string;
    version: string;
    standardBody: string;
    coversScope1: boolean;
    coversScope2: boolean;
    coversScope3: boolean;
    structure: any;
    validationRules: any | null;
}

export interface ActivityCategory {
    categoryId: string;
    templateId: string;
    categoryCode: string;
    name: string;
    description: string;
    ghgScope: 1 | 2 | 3;
    parentCategoryId: string | null;
    suggestedFactorId: string | null;
    requiredFields: string[];
    unitOptions: string[];
    isActive: boolean;
}

export class EmissionFactorLibrary {
    /**
     * Get applicable emission factors for an activity
     */
    static async getFactorsForActivity(params: {
        category: string;
        subCategory?: string;
        ghgScope: 1 | 2 | 3;
        geography?: string;
        region?: string;
        sector?: string;
        date?: string;
    }): Promise<EmissionFactor[]> {
        const { category, subCategory, ghgScope, geography = 'INDIA', region, sector, date = new Date().toISOString().split('T')[0] } = params;
        
        let sql = `
            SELECT * FROM emission_factors
            WHERE category = $1
              AND ghg_scope = $2
              AND geography = $3
              AND is_active = TRUE
              AND effective_from <= $4
              AND (effective_to IS NULL OR effective_to >= $4)
        `;
        const params_sql = [category, ghgScope, geography, date];
        let paramIndex = 5;
        
        if (subCategory) {
            sql += ` AND sub_category = $${paramIndex}`;
            params_sql.push(subCategory);
            paramIndex++;
        }
        if (region) {
            sql += ` AND region = $${paramIndex}`;
            params_sql.push(region);
        }
        if (sector) {
            sql += ` AND sector = $${paramIndex}`;
            params_sql.push(sector);
        }
        
        sql += ` ORDER BY source_version DESC, effective_from DESC`;
        
        const { rows } = await query(sql, params_sql);
        return rows.map(this.mapFactorRow);
    }
    
    /**
     * Get a specific factor by code with version history
     */
    static async getFactorByCode(factorCode: string, date?: string): Promise<EmissionFactor | null> {
        const effectiveDate = date || new Date().toISOString().split('T')[0];
        
        const { rows } = await query(
            `SELECT * FROM emission_factors
             WHERE factor_code = $1
               AND is_active = TRUE
               AND effective_from <= $2
               AND (effective_to IS NULL OR effective_to >= $2)
             ORDER BY source_version DESC, effective_from DESC
             LIMIT 1`,
            [factorCode, effectiveDate]
        );
        
        return rows[0] ? this.mapFactorRow(rows[0]) : null;
    }
    
    /**
     * Calculate CO2e from activity data using server-side factor
     * This prevents client-side manipulation
     */
    static async calculateCO2e(params: {
        factorCode: string;
        quantity: number;
        unit?: string;
        date?: string;
    }): Promise<{ co2e: number; factor: EmissionFactor; calculation: string }> {
        const { factorCode, quantity, unit, date } = params;
        
        const factor = await this.getFactorByCode(factorCode, date);
        if (!factor) {
            throw new Error(`Emission factor not found: ${factorCode}`);
        }
        
        // Validate unit matches
        if (unit && unit !== factor.unitDenominator) {
            throw new Error(`Unit mismatch: expected ${factor.unitDenominator}, got ${unit}`);
        }
        
        // Calculate: quantity * factor_value
        // factorValue is in tCO2 per unit_denominator
        const co2e = quantity * factor.factorValue;
        
        return {
            co2e: Number(co2e.toFixed(6)),
            factor,
            calculation: `${quantity} ${factor.unitDenominator} × ${factor.factorValue} tCO2/${factor.unitDenominator} = ${co2e.toFixed(6)} tCO2e`
        };
    }
    
    /**
     * Get methodology template with activity categories
     */
    static async getMethodologyTemplate(templateCode: string): Promise<{ template: MethodologyTemplate; categories: ActivityCategory[] } | null> {
        const { rows: templateRows } = await query(
            `SELECT * FROM methodology_templates WHERE template_code = $1 AND is_active = TRUE`,
            [templateCode]
        );
        
        if (!templateRows.length) return null;
        
        const template = templateRows[0];
        
        const { rows: categoryRows } = await query(
            `SELECT * FROM activity_categories
             WHERE template_id = $1 AND is_active = TRUE
             ORDER BY ghg_scope, sort_order`,
            [template.template_id]
        );
        
        return {
            template: this.mapTemplateRow(template),
            categories: categoryRows.map(this.mapCategoryRow)
        };
    }
    
    /**
     * Validate activity data against methodology template
     */
    static validateActivityData(category: ActivityCategory, data: Record<string, any>): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        
        // Check required fields
        for (const field of category.requiredFields) {
            if (!data[field] && data[field] !== 0) {
                errors.push(`Missing required field: ${field}`);
            }
        }
        
        // Validate unit
        if (data.unit && category.unitOptions && !category.unitOptions.includes(data.unit)) {
            errors.push(`Invalid unit: ${data.unit}. Allowed: ${category.unitOptions.join(', ')}`);
        }
        
        return { valid: errors.length === 0, errors };
    }
    
    /**
     * Seed default emission factors (CEA, IPCC, BEE)
     */
    static async seedDefaultFactors(userId: string): Promise<void> {
        const defaultFactors = this.getIndiaDefaultFactors(userId);
        
        await withTransaction(async (client) => {
            for (const factor of defaultFactors) {
                await client.query(
                    `INSERT INTO emission_factors (
                        factor_code, name, description, category, sub_category,
                        factor_value, unit_numerator, unit_denominator, ghg_scope,
                        geography, region, sector, source, source_version,
                        source_document_url, effective_from, effective_to,
                        uncertainty_pct, quality_rating, is_active, is_custom,
                        created_by
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19,$20)
                    ON CONFLICT (factor_code) DO UPDATE SET
                        factor_value = EXCLUDED.factor_value,
                        unit_numerator = EXCLUDED.unit_numerator,
                        unit_denominator = EXCLUDED.unit_denominator,
                        source_version = EXCLUDED.source_version,
                        effective_from = EXCLUDED.effective_from,
                        effective_to = EXCLUDED.effective_to,
                        uncertainty_pct = EXCLUDED.uncertainty_pct,
                        quality_rating = EXCLUDED.quality_rating,
                        is_active = EXCLUDED.is_active,
                        updated_at = NOW()`,
                    [
                        factor.factorCode, factor.name, factor.description,
                        factor.category, factor.subCategory,
                        factor.factorValue, factor.unitNumerator, factor.unitDenominator,
                        factor.ghgScope, factor.geography, factor.region,
                        factor.sector, factor.source, factor.sourceVersion,
                        factor.sourceDocumentUrl, factor.effectiveFrom,
                        factor.effectiveTo, factor.uncertaintyPct,
                        factor.qualityRating, factor.isActive, factor.isCustom,
                        userId
                    ]
                );
            }
        });
    }
    
    /**
     * Seed methodology templates (GHG Protocol, ISO 14064, BRSR, PAT, CCTS)
     */
    static async seedMethodologyTemplates(): Promise<void> {
        const templates = this.getDefaultMethodologyTemplates();
        
        await withTransaction(async (client) => {
            for (const template of templates) {
                const { rows } = await client.query(
                    `INSERT INTO methodology_templates (
                        template_code, name, description, version, standard_body,
                        covers_scope_1, covers_scope_2, covers_scope_3,
                        structure, validation_rules
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                    ON CONFLICT (template_code) DO UPDATE SET
                        name = EXCLUDED.name,
                        description = EXCLUDED.description,
                        version = EXCLUDED.version,
                        structure = EXCLUDED.structure,
                        validation_rules = EXCLUDED.validation_rules,
                        updated_at = NOW()
                    RETURNING template_id`,
                    [
                        template.templateCode, template.name, template.description,
                        template.version, template.standardBody,
                        template.coversScope1, template.coversScope2, template.coversScope3,
                        JSON.stringify(template.structure),
                        template.validationRules ? JSON.stringify(template.validationRules) : null
                    ]
                );
                
                const templateId = rows[0].template_id;
                
                // Seed activity categories for this template
                for (const category of template.categories) {
                    await client.query(
                        `INSERT INTO activity_categories (
                            template_id, category_code, name, description, ghg_scope,
                            parent_category_id, suggested_factor_id, required_fields,
                            unit_options, is_active, sort_order
                        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                        ON CONFLICT (template_id, category_code) DO UPDATE SET
                            name = EXCLUDED.name,
                            description = EXCLUDED.description,
                            required_fields = EXCLUDED.required_fields,
                            unit_options = EXCLUDED.unit_options,
                            is_active = EXCLUDED.is_active,
                            sort_order = EXCLUDED.sort_order`,
                        [
                            templateId, category.categoryCode, category.name,
                            category.description, category.ghgScope,
                            category.parentCategoryId, category.suggestedFactorId,
                            JSON.stringify(category.requiredFields),
                            JSON.stringify(category.unitOptions),
                            category.isActive, category.sortOrder
                        ]
                    );
                }
            }
        });
    }
    
    // ============ PRIVATE HELPERS ============
    
    private static mapFactorRow(row: any): EmissionFactor {
        return {
            factorId: row.factor_id,
            factorCode: row.factor_code,
            name: row.name,
            description: row.description,
            category: row.category,
            subCategory: row.sub_category,
            factorValue: Number(row.factor_value),
            unitNumerator: row.unit_numerator,
            unitDenominator: row.unit_denominator,
            ghgScope: row.ghg_scope,
            geography: row.geography,
            region: row.region,
            sector: row.sector,
            source: row.source,
            sourceVersion: row.source_version,
            sourceDocumentUrl: row.source_document_url,
            effectiveFrom: row.effective_from,
            effectiveTo: row.effective_to,
            uncertaintyPct: row.uncertainty_pct ? Number(row.uncertainty_pct) : null,
            qualityRating: row.quality_rating,
            isActive: row.is_active,
            isCustom: row.is_custom,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
    
    private static mapTemplateRow(row: any): MethodologyTemplate {
        return {
            templateId: row.template_id,
            templateCode: row.template_code,
            name: row.name,
            description: row.description,
            version: row.version,
            standardBody: row.standard_body,
            coversScope1: row.covers_scope_1,
            coversScope2: row.covers_scope_2,
            coversScope3: row.covers_scope_3,
            structure: row.structure,
            validationRules: row.validation_rules
        };
    }
    
    private static mapCategoryRow(row: any): ActivityCategory {
        return {
            categoryId: row.category_id,
            templateId: row.template_id,
            categoryCode: row.category_code,
            name: row.name,
            description: row.description,
            ghgScope: row.ghg_scope,
            parentCategoryId: row.parent_category_id,
            suggestedFactorId: row.suggested_factor_id,
            requiredFields: row.required_fields || [],
            unitOptions: row.unit_options || [],
            isActive: row.is_active
        };
    }
    
    // ============ DEFAULT DATA ============
    
    private static getIndiaDefaultFactors(userId: string): any[] {
        return [
            // CEA Grid Electricity Factors (India)
            {
                factorCode: 'ELEC_GRID_IN_CEA_2024',
                name: 'India Grid Electricity - CEA V20.0 (FY 2023-24)',
                description: 'Weighted average grid emission factor for India per CEA V20.0 Dec 2024',
                category: 'ELECTRICITY',
                subCategory: 'GRID',
                factorValue: 0.000727,
                unitNumerator: 'tCO2',
                unitDenominator: 'kWh',
                ghgScope: 2,
                geography: 'INDIA',
                region: null,
                sector: 'ALL',
                source: 'CEA_V20_0',
                sourceVersion: 'V20.0',
                sourceDocumentUrl: 'https://cea.nic.in/grid-emission-factors',
                effectiveFrom: '2024-04-01',
                effectiveTo: null,
                uncertaintyPct: 5.0,
                qualityRating: 'HIGH',
                isActive: true,
                isCustom: false,
                createdBy: userId
            },
            // CEA T&D Losses
            {
                factorCode: 'ELEC_TD_LOSSES_IN_CEA_2024',
                name: 'India T&D Losses - CEA V20.0',
                description: 'Transmission & Distribution losses factor',
                category: 'ELECTRICITY',
                subCategory: 'TD_LOSSES',
                factorValue: 0.000073,
                unitNumerator: 'tCO2',
                unitDenominator: 'kWh',
                ghgScope: 2,
                geography: 'INDIA',
                region: null,
                sector: 'ALL',
                source: 'CEA_V20_0',
                sourceVersion: 'V20.0',
                sourceDocumentUrl: 'https://cea.nic.in/grid-emission-factors',
                effectiveFrom: '2024-04-01',
                effectiveTo: null,
                uncertaintyPct: 10.0,
                qualityRating: 'MEDIUM',
                isActive: true,
                isCustom: false,
                createdBy: userId
            },
            // Diesel
            {
                factorCode: 'FUEL_DIESEL_IPCC_2006',
                name: 'Diesel - IPCC 2006',
                description: 'Diesel combustion emission factor per IPCC 2006 Guidelines',
                category: 'FUEL_COMBUSTION',
                subCategory: 'DIESEL',
                factorValue: 2.68,
                unitNumerator: 'tCO2',
                unitDenominator: 'L',
                ghgScope: 1,
                geography: 'GLOBAL',
                region: null,
                sector: 'ALL',
                source: 'IPCC_2006',
                sourceVersion: '2006',
                sourceDocumentUrl: 'https://www.ipcc-nggip.iges.or.jp/public/2006gl/',
                effectiveFrom: '2006-01-01',
                effectiveTo: null,
                uncertaintyPct: 5.0,
                qualityRating: 'HIGH',
                isActive: true,
                isCustom: false,
                createdBy: userId
            },
            // Petrol
            {
                factorCode: 'FUEL_PETROL_IPCC_2006',
                name: 'Petrol/Gasoline - IPCC 2006',
                description: 'Petrol combustion emission factor per IPCC 2006 Guidelines',
                category: 'FUEL_COMBUSTION',
                subCategory: 'PETROL',
                factorValue: 2.31,
                unitNumerator: 'tCO2',
                unitDenominator: 'L',
                ghgScope: 1,
                geography: 'GLOBAL',
                region: null,
                sector: 'ALL',
                source: 'IPCC_2006',
                sourceVersion: '2006',
                sourceDocumentUrl: 'https://www.ipcc-nggip.iges.or.jp/public/2006gl/',
                effectiveFrom: '2006-01-01',
                effectiveTo: null,
                uncertaintyPct: 5.0,
                qualityRating: 'HIGH',
                isActive: true,
                isCustom: false,
                createdBy: userId
            },
            // Natural Gas
            {
                factorCode: 'FUEL_NATURAL_GAS_IPCC_2006',
                name: 'Natural Gas - IPCC 2006',
                description: 'Natural gas combustion emission factor per IPCC 2006 Guidelines',
                category: 'FUEL_COMBUSTION',
                subCategory: 'NATURAL_GAS',
                factorValue: 2.02,
                unitNumerator: 'tCO2',
                unitDenominator: 'm3',
                ghgScope: 1,
                geography: 'GLOBAL',
                region: null,
                sector: 'ALL',
                source: 'IPCC_2006',
                sourceVersion: '2006',
                sourceDocumentUrl: 'https://www.ipcc-nggip.iges.or.jp/public/2006gl/',
                effectiveFrom: '2006-01-01',
                effectiveTo: null,
                uncertaintyPct: 5.0,
                qualityRating: 'HIGH',
                isActive: true,
                isCustom: false,
                createdBy: userId
            },
            // Coal
            {
                factorCode: 'FUEL_COAL_IPCC_2006',
                name: 'Coal - IPCC 2006',
                description: 'Coal combustion emission factor per IPCC 2006 Guidelines',
                category: 'FUEL_COMBUSTION',
                subCategory: 'COAL',
                factorValue: 2.42,
                unitNumerator: 'tCO2',
                unitDenominator: 'kg',
                ghgScope: 1,
                geography: 'GLOBAL',
                region: null,
                sector: 'ALL',
                source: 'IPCC_2006',
                sourceVersion: '2006',
                sourceDocumentUrl: 'https://www.ipcc-nggip.iges.or.jp/public/2006gl/',
                effectiveFrom: '2006-01-01',
                effectiveTo: null,
                uncertaintyPct: 10.0,
                qualityRating: 'MEDIUM',
                isActive: true,
                isCustom: false,
                createdBy: userId
            },
            // LPG
            {
                factorCode: 'FUEL_LPG_IPCC_2006',
                name: 'LPG - IPCC 2006',
                description: 'LPG combustion emission factor per IPCC 2006 Guidelines',
                category: 'FUEL_COMBUSTION',
                subCategory: 'LPG',
                factorValue: 2.98,
                unitNumerator: 'tCO2',
                unitDenominator: 'kg',
                ghgScope: 1,
                geography: 'GLOBAL',
                region: null,
                sector: 'ALL',
                source: 'IPCC_2006',
                sourceVersion: '2006',
                sourceDocumentUrl: 'https://www.ipcc-nggip.iges.or.jp/public/2006gl/',
                effectiveFrom: '2006-01-01',
                effectiveTo: null,
                uncertaintyPct: 5.0,
                qualityRating: 'HIGH',
                isActive: true,
                isCustom: false,
                createdBy: userId
            },
            // Furnace Oil
            {
                factorCode: 'FUEL_FURNACE_OIL_IPCC_2006',
                name: 'Furnace Oil - IPCC 2006',
                description: 'Furnace oil combustion emission factor per IPCC 2006 Guidelines',
                category: 'FUEL_COMBUSTION',
                subCategory: 'FURNACE_OIL',
                factorValue: 3.18,
                unitNumerator: 'tCO2',
                unitDenominator: 'L',
                ghgScope: 1,
                geography: 'GLOBAL',
                region: null,
                sector: 'ALL',
                source: 'IPCC_2006',
                sourceVersion: '2006',
                sourceDocumentUrl: 'https://www.ipcc-nggip.iges.or.jp/public/2006gl/',
                effectiveFrom: '2006-01-01',
                effectiveTo: null,
                uncertaintyPct: 10.0,
                qualityRating: 'MEDIUM',
                isActive: true,
                isCustom: false,
                createdBy: userId
            },
            // Refrigerants
            {
                factorCode: 'REFRIGERANT_R410A_IPCC_2006',
                name: 'Refrigerant R-410A - IPCC 2006',
                description: 'R-410A GWP 2088 per IPCC 2006',
                category: 'FUGITIVE',
                subCategory: 'REFRIGERANT_R410A',
                factorValue: 2088,
                unitNumerator: 'tCO2e',
                unitDenominator: 'kg',
                ghgScope: 1,
                geography: 'GLOBAL',
                region: null,
                sector: 'ALL',
                source: 'IPCC_2006',
                sourceVersion: '2006',
                sourceDocumentUrl: 'https://www.ipcc-nggip.iges.or.jp/public/2006gl/',
                effectiveFrom: '2006-01-01',
                effectiveTo: null,
                uncertaintyPct: 0.0,
                qualityRating: 'HIGH',
                isActive: true,
                isCustom: false,
                createdBy: userId
            },
            {
                factorCode: 'REFRIGERANT_R22_IPCC_2006',
                name: 'Refrigerant R-22 - IPCC 2006',
                description: 'R-22 GWP 1810 per IPCC 2006',
                category: 'FUGITIVE',
                subCategory: 'REFRIGERANT_R22',
                factorValue: 1810,
                unitNumerator: 'tCO2e',
                unitDenominator: 'kg',
                ghgScope: 1,
                geography: 'GLOBAL',
                region: null,
                sector: 'ALL',
                source: 'IPCC_2006',
                sourceVersion: '2006',
                sourceDocumentUrl: 'https://www.ipcc-nggip.iges.or.jp/public/2006gl/',
                effectiveFrom: '2006-01-01',
                effectiveTo: null,
                uncertaintyPct: 0.0,
                qualityRating: 'HIGH',
                isActive: true,
                isCustom: false,
                createdBy: userId
            },
            {
                factorCode: 'REFRIGERANT_R32_IPCC_2006',
                name: 'Refrigerant R-32 - IPCC 2006',
                description: 'R-32 GWP 675 per IPCC 2006',
                category: 'FUGITIVE',
                subCategory: 'REFRIGERANT_R32',
                factorValue: 675,
                unitNumerator: 'tCO2e',
                unitDenominator: 'kg',
                ghgScope: 1,
                geography: 'GLOBAL',
                region: null,
                sector: 'ALL',
                source: 'IPCC_2006',
                sourceVersion: '2006',
                sourceDocumentUrl: 'https://www.ipcc-nggip.iges.or.jp/public/2006gl/',
                effectiveFrom: '2006-01-01',
                effectiveTo: null,
                uncertaintyPct: 0.0,
                qualityRating: 'HIGH',
                isActive: true,
                isCustom: false,
                createdBy: userId
            },
            // BEE PAT Sectoral Factors (placeholders - to be updated per BEE notification)
            {
                factorCode: 'BEE_PAT_CEMENT_CLINKER',
                name: 'Cement Clinker - BEE PAT Sectoral',
                description: 'Cement sector PAT baseline factor per BEE notification',
                category: 'INDUSTRIAL_PROCESS',
                subCategory: 'CEMENT_CLINKER',
                factorValue: 0.54, // tCO2/tonne clinker (example)
                unitNumerator: 'tCO2',
                unitDenominator: 'tonne',
                ghgScope: 1,
                geography: 'INDIA',
                region: null,
                sector: 'CEMENT',
                source: 'BEE_PAT',
                sourceVersion: '2024',
                sourceDocumentUrl: 'https://beeindia.gov.in/',
                effectiveFrom: '2024-04-01',
                effectiveTo: null,
                uncertaintyPct: 10.0,
                qualityRating: 'MEDIUM',
                isActive: true,
                isCustom: false,
                createdBy: userId
            },
            {
                factorCode: 'BEE_PAT_IRON_STEEL',
                name: 'Iron & Steel - BEE PAT Sectoral',
                description: 'Iron & steel sector PAT baseline factor per BEE notification',
                category: 'INDUSTRIAL_PROCESS',
                subCategory: 'IRON_STEEL',
                factorValue: 1.8, // tCO2/tonne crude steel (example)
                unitNumerator: 'tCO2',
                unitDenominator: 'tonne',
                ghgScope: 1,
                geography: 'INDIA',
                region: null,
                sector: 'IRON_STEEL',
                source: 'BEE_PAT',
                sourceVersion: '2024',
                sourceDocumentUrl: 'https://beeindia.gov.in/',
                effectiveFrom: '2024-04-01',
                effectiveTo: null,
                uncertaintyPct: 10.0,
                qualityRating: 'MEDIUM',
                isActive: true,
                isCustom: false,
                createdBy: userId
            },
            {
                factorCode: 'BEE_PAT_ALUMINIUM',
                name: 'Aluminium - BEE PAT Sectoral',
                description: 'Aluminium sector PAT baseline factor per BEE notification',
                category: 'INDUSTRIAL_PROCESS',
                subCategory: 'ALUMINIUM',
                factorValue: 1.6, // tCO2/tonne aluminium (example)
                unitNumerator: 'tCO2',
                unitDenominator: 'tonne',
                ghgScope: 1,
                geography: 'INDIA',
                region: null,
                sector: 'ALUMINIUM',
                source: 'BEE_PAT',
                sourceVersion: '2024',
                sourceDocumentUrl: 'https://beeindia.gov.in/',
                effectiveFrom: '2024-04-01',
                effectiveTo: null,
                uncertaintyPct: 10.0,
                qualityRating: 'MEDIUM',
                isActive: true,
                isCustom: false,
                createdBy: userId
            },
            {
                factorCode: 'BEE_PAT_FERTILIZER_UREA',
                name: 'Fertilizer (Urea) - BEE PAT Sectoral',
                description: 'Urea sector PAT baseline factor per BEE notification',
                category: 'INDUSTRIAL_PROCESS',
                subCategory: 'FERTILIZER_UREA',
                factorValue: 0.5, // tCO2/tonne urea (example)
                unitNumerator: 'tCO2',
                unitDenominator: 'tonne',
                ghgScope: 1,
                geography: 'INDIA',
                region: null,
                sector: 'FERTILIZER',
                source: 'BEE_PAT',
                sourceVersion: '2024',
                sourceDocumentUrl: 'https://beeindia.gov.in/',
                effectiveFrom: '2024-04-01',
                effectiveTo: null,
                uncertaintyPct: 10.0,
                qualityRating: 'MEDIUM',
                isActive: true,
                isCustom: false,
                createdBy: userId
            }
        ];
    }
    
    private static getDefaultMethodologyTemplates(): any[] {
        return [
            {
                templateCode: 'GHG_PROTOCOL_CORPORATE',
                name: 'GHG Protocol Corporate Standard',
                description: 'GHG Protocol Corporate Accounting and Reporting Standard (2004) with Scope 2 Guidance (2015)',
                version: '2015',
                standardBody: 'GHG_PROTOCOL',
                coversScope1: true,
                coversScope2: true,
                coversScope3: true,
                structure: {
                    scope1: {
                        name: 'Scope 1 - Direct Emissions',
                        categories: [
                            { code: 'STATIONARY_COMBUSTION', name: 'Stationary Combustion', description: 'Boilers, furnaces, generators' },
                            { code: 'MOBILE_COMBUSTION', name: 'Mobile Combustion', description: 'Company-owned vehicles' },
                            { code: 'FUGITIVE_EMISSIONS', name: 'Fugitive Emissions', description: 'Refrigerants, SF6, CH4 leaks' },
                            { code: 'PROCESS_EMISSIONS', name: 'Process Emissions', description: 'Chemical reactions, cement, steel' }
                        ]
                    },
                    scope2: {
                        name: 'Scope 2 - Indirect Energy Emissions',
                        categories: [
                            { code: 'PURCHASED_ELECTRICITY', name: 'Purchased Electricity', description: 'Grid electricity consumption' },
                            { code: 'PURCHASED_HEAT', name: 'Purchased Heat/Steam', description: 'District heating, process steam' },
                            { code: 'PURCHASED_COOLING', name: 'Purchased Cooling', description: 'District cooling' }
                        ]
                    },
                    scope3: {
                        name: 'Scope 3 - Value Chain Emissions',
                        categories: [
                            { code: 'PURCHASED_GOODS_SERVICES', name: 'Purchased Goods & Services' },
                            { code: 'CAPITAL_GOODS', name: 'Capital Goods' },
                            { code: 'FUEL_ENERGY_ACTIVITIES', name: 'Fuel & Energy Related Activities' },
                            { code: 'UPSTREAM_TRANSPORT', name: 'Upstream Transportation & Distribution' },
                            { code: 'WASTE_GENERATED', name: 'Waste Generated in Operations' },
                            { code: 'BUSINESS_TRAVEL', name: 'Business Travel' },
                            { code: 'EMPLOYEE_COMMUTING', name: 'Employee Commuting' },
                            { code: 'UPSTREAM_LEASED', name: 'Upstream Leased Assets' },
                            { code: 'DOWNSTREAM_TRANSPORT', name: 'Downstream Transportation' },
                            { code: 'PROCESSING_SOLD_PRODUCTS', name: 'Processing of Sold Products' },
                            { code: 'USE_SOLD_PRODUCTS', name: 'Use of Sold Products' },
                            { code: 'END_OF_LIFE', name: 'End-of-Life Treatment' },
                            { code: 'DOWNSTREAM_LEASED', name: 'Downstream Leased Assets' },
                            { code: 'FRANCHISES', name: 'Franchises' },
                            { code: 'INVESTMENTS', name: 'Investments' }
                        ]
                    }
                },
                categories: [
                    // Scope 1
                    { categoryCode: 'STATIONARY_COMBUSTION', name: 'Stationary Combustion', description: 'Boilers, furnaces, generators', ghgScope: 1, requiredFields: ['fuelType', 'quantity', 'unit'], unitOptions: ['L', 'kg', 'm3', 'MWh'], suggestedFactorId: null, sortOrder: 1, isActive: true },
                    { categoryCode: 'MOBILE_COMBUSTION', name: 'Mobile Combustion', description: 'Company-owned vehicles', ghgScope: 1, requiredFields: ['fuelType', 'quantity', 'unit'], unitOptions: ['L', 'kg'], suggestedFactorId: null, sortOrder: 2, isActive: true },
                    { categoryCode: 'FUGITIVE_EMISSIONS', name: 'Fugitive Emissions', description: 'Refrigerants, SF6, CH4 leaks', ghgScope: 1, requiredFields: ['gasType', 'quantity', 'unit'], unitOptions: ['kg'], suggestedFactorId: null, sortOrder: 3, isActive: true },
                    { categoryCode: 'PROCESS_EMISSIONS', name: 'Process Emissions', description: 'Chemical reactions, cement, steel', ghgScope: 1, requiredFields: ['processType', 'quantity', 'unit'], unitOptions: ['tonne', 'kg'], suggestedFactorId: null, sortOrder: 4, isActive: true },
                    // Scope 2
                    { categoryCode: 'PURCHASED_ELECTRICITY', name: 'Purchased Electricity', description: 'Grid electricity consumption', ghgScope: 2, requiredFields: ['quantity', 'unit'], unitOptions: ['kWh', 'MWh'], suggestedFactorId: 'ELEC_GRID_IN_CEA_2024', sortOrder: 1, isActive: true },
                    { categoryCode: 'PURCHASED_HEAT', name: 'Purchased Heat/Steam', description: 'District heating, process steam', ghgScope: 2, requiredFields: ['quantity', 'unit'], unitOptions: ['MWh', 'GJ'], suggestedFactorId: null, sortOrder: 2, isActive: true },
                    // Scope 3 (key categories)
                    { categoryCode: 'PURCHASED_GOODS_SERVICES', name: 'Purchased Goods & Services', description: 'Upstream supply chain emissions', ghgScope: 3, requiredFields: ['category', 'spend', 'currency'], unitOptions: ['INR', 'USD'], suggestedFactorId: null, sortOrder: 1, isActive: true },
                    { categoryCode: 'BUSINESS_TRAVEL', name: 'Business Travel', description: 'Air, rail, road travel', ghgScope: 3, requiredFields: ['mode', 'distance', 'unit'], unitOptions: ['km', 'miles'], suggestedFactorId: null, sortOrder: 2, isActive: true },
                    { categoryCode: 'EMPLOYEE_COMMUTING', name: 'Employee Commuting', description: 'Daily commute emissions', ghgScope: 3, requiredFields: ['mode', 'distance', 'days', 'employees'], unitOptions: ['km', 'days'], suggestedFactorId: null, sortOrder: 3, isActive: true },
                    { categoryCode: 'UPSTREAM_TRANSPORT', name: 'Upstream Transportation', description: 'Inbound logistics', ghgScope: 3, requiredFields: ['mode', 'weight', 'distance'], unitOptions: ['tonne-km'], suggestedFactorId: null, sortOrder: 4, isActive: true },
                    { categoryCode: 'WASTE_GENERATED', name: 'Waste Generated', description: 'Operational waste disposal', ghgScope: 3, requiredFields: ['wasteType', 'quantity', 'unit', 'disposalMethod'], unitOptions: ['tonne', 'kg'], suggestedFactorId: null, sortOrder: 5, isActive: true }
                ]
            },
            {
                templateCode: 'ISO_14064_1',
                name: 'ISO 14064-1:2018',
                description: 'ISO 14064-1 Greenhouse gases - Part 1: Organization level quantification and reporting',
                version: '2018',
                standardBody: 'ISO',
                coversScope1: true,
                coversScope2: true,
                coversScope3: true,
                structure: {
                    direct: { name: 'Direct GHG Emissions (Scope 1)', categories: [] },
                    energyIndirect: { name: 'Energy Indirect GHG Emissions (Scope 2)', categories: [] },
                    otherIndirect: { name: 'Other Indirect GHG Emissions (Scope 3)', categories: [] }
                },
                categories: [
                    { categoryCode: 'ISO_STATIONARY', name: 'Stationary Combustion', description: 'Fixed source combustion', ghgScope: 1, requiredFields: ['fuelType', 'quantity', 'unit'], unitOptions: ['L', 'kg', 'm3', 'MWh'], sortOrder: 1, isActive: true },
                    { categoryCode: 'ISO_MOBILE', name: 'Mobile Combustion', description: 'Transport combustion', ghgScope: 1, requiredFields: ['fuelType', 'quantity', 'unit'], unitOptions: ['L', 'kg'], sortOrder: 2, isActive: true },
                    { categoryCode: 'ISO_ELECTRICITY', name: 'Purchased Electricity', description: 'Grid electricity', ghgScope: 2, requiredFields: ['quantity', 'unit'], unitOptions: ['kWh', 'MWh'], suggestedFactorId: 'ELEC_GRID_IN_CEA_2024', sortOrder: 1, isActive: true }
                ]
            },
            {
                templateCode: 'BRSR_CORE',
                name: 'SEBI BRSR Core',
                description: 'SEBI Business Responsibility and Sustainability Reporting Core Format',
                version: '2024',
                standardBody: 'SEBI',
                coversScope1: true,
                coversScope2: true,
                coversScope3: false,
                structure: {
                    principle6: {
                        name: 'Principle 6 - Environment',
                        categories: {
                            energy: { name: 'Energy', description: 'Energy consumption and intensity' },
                            water: { name: 'Water', description: 'Water withdrawal, consumption, recycling' },
                            waste: { name: 'Waste', description: 'Waste generation and management' },
                            emissions: { name: 'GHG Emissions', description: 'Scope 1 & 2 emissions' }
                        }
                    }
                },
                categories: [
                    { categoryCode: 'BRSR_ELEC_GRID', name: 'Grid Electricity', description: 'Purchased grid electricity', ghgScope: 2, requiredFields: ['quantity', 'unit'], unitOptions: ['kWh', 'MWh'], suggestedFactorId: 'ELEC_GRID_IN_CEA_2024', sortOrder: 1, isActive: true },
                    { categoryCode: 'BRSR_DIESEL', name: 'Diesel', description: 'Diesel consumption', ghgScope: 1, requiredFields: ['quantity', 'unit'], unitOptions: ['L'], suggestedFactorId: 'FUEL_DIESEL_IPCC_2006', sortOrder: 2, isActive: true },
                    { categoryCode: 'BRSR_COAL', name: 'Coal', description: 'Coal consumption', ghgScope: 1, requiredFields: ['quantity', 'unit'], unitOptions: ['kg', 'tonne'], suggestedFactorId: 'FUEL_COAL_IPCC_2006', sortOrder: 3, isActive: true },
                    { categoryCode: 'BRSR_FURNACE_OIL', name: 'Furnace Oil', description: 'Furnace oil consumption', ghgScope: 1, requiredFields: ['quantity', 'unit'], unitOptions: ['L'], suggestedFactorId: 'FUEL_FURNACE_OIL_IPCC_2006', sortOrder: 4, isActive: true }
                ]
            },
            {
                templateCode: 'PAT',
                name: 'PAT (Perform, Achieve, Trade)',
                description: 'BEE Perform, Achieve and Trade Scheme - Sectoral Baseline & Target',
                version: '2024',
                standardBody: 'BEE',
                coversScope1: true,
                coversScope2: true,
                coversScope3: false,
                structure: {
                    gate_to_gate: {
                        name: 'Gate-to-Gate Specific Energy Consumption',
                        categories: []
                    }
                },
                categories: [
                    { categoryCode: 'PAT_SEC', name: 'Specific Energy Consumption', description: 'Energy per unit of output', ghgScope: 1, requiredFields: ['energyConsumed', 'production', 'energyUnit', 'productionUnit'], unitOptions: ['GJ/tonne', 'MWh/tonne', 'kcal/kg'], sortOrder: 1, isActive: true },
                    { categoryCode: 'PAT_COAL', name: 'Coal', description: 'Coal consumption', ghgScope: 1, requiredFields: ['quantity', 'unit', 'gcv'], unitOptions: ['tonne', 'kg'], suggestedFactorId: 'BEE_PAT_CEMENT_CLINKER', sortOrder: 2, isActive: true },
                    { categoryCode: 'PAT_ELECTRICITY', name: 'Electricity', description: 'Grid electricity', ghgScope: 2, requiredFields: ['quantity', 'unit'], unitOptions: ['kWh', 'MWh'], suggestedFactorId: 'ELEC_GRID_IN_CEA_2024', sortOrder: 3, isActive: true }
                ]
            },
            {
                templateCode: 'CCTS',
                name: 'CCTS (Carbon Credit Trading Scheme)',
                description: 'India Carbon Credit Trading Scheme - GEI Compliance & CCC Surrender',
                version: '2024',
                standardBody: 'BEE_CCTS',
                coversScope1: true,
                coversScope2: true,
                coversScope3: false,
                structure: {
                    gei: {
                        name: 'GHG Emission Intensity (GEI)',
                        categories: []
                    }
                },
                categories: [
                    { categoryCode: 'CCTS_GRID_ELECTRICITY', name: 'Grid Electricity', description: 'Purchased grid electricity for GEI', ghgScope: 2, requiredFields: ['quantity', 'unit'], unitOptions: ['kWh', 'MWh'], suggestedFactorId: 'ELEC_GRID_IN_CEA_2024', sortOrder: 1, isActive: true },
                    { categoryCode: 'CCTS_COAL', name: 'Coal', description: 'Coal for GEI calculation', ghgScope: 1, requiredFields: ['quantity', 'unit', 'gcv'], unitOptions: ['tonne', 'kg'], suggestedFactorId: 'BEE_PAT_CEMENT_CLINKER', sortOrder: 2, isActive: true },
                    { categoryCode: 'CCTS_PRODUCTION', name: 'Production Volume', description: 'Annual production for GEI denominator', ghgScope: 1, requiredFields: ['quantity', 'unit'], unitOptions: ['tonne', 'MWh', 'units'], sortOrder: 3, isActive: true }
                ]
            }
        ];
    }
}

export default EmissionFactorLibrary;