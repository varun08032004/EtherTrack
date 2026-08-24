// Emission Calculation Engine
// Server-side calculation engine: activity × factor = CO2e
// Prevents client-side manipulation

import { safeQuery as query, withTransaction } from '../../db/pool.js';
import EmissionFactorLibrary, { EmissionFactor, ActivityCategory } from './emissionFactorLibrary.js';

export interface CalculationInput {
    activityId?: string;
    categoryCode: string;
    methodologyTemplate: string;
    quantity: number;
    unit: string;
    date: string;
    factorCode?: string;  // Optional override
    metadata?: Record<string, any>;
}

export interface CalculationResult {
    co2e: number;
    factor: EmissionFactor;
    calculation: string;
    activity: {
        categoryCode: string;
        methodologyTemplate: string;
        quantity: number;
        unit: string;
        date: string;
    };
    audit: {
        calculatedAt: string;
        calculatedBy: string;
        factorCode: string;
        factorVersion: string | null;
    };
}

export interface BulkCalculationInput {
    calculations: CalculationInput[];
}

export interface BulkCalculationResult {
    results: CalculationResult[];
    summary: {
        totalCo2e: number;
        byScope: { scope1: number; scope2: number; scope3: number };
        byCategory: Record<string, number>;
    };
    errors: { index: number; error: string }[];
}

export class EmissionCalculationEngine {
    /**
     * Calculate CO2e for a single activity
     * Server-side only - prevents client manipulation
     */
    static async calculate(input: CalculationInput, userId: string): Promise<CalculationResult> {
        // 1. Resolve methodology template
        const templateData = await EmissionFactorLibrary.getMethodologyTemplate(input.methodologyTemplate);
        if (!templateData) {
            throw new Error(`Methodology template not found: ${input.methodologyTemplate}`);
        }
        
        // 2. Find activity category
        const category = templateData.categories.find(c => c.categoryCode === input.categoryCode);
        if (!category) {
            throw new Error(`Activity category not found: ${input.categoryCode} in ${input.methodologyTemplate}`);
        }
        
        if (!category.isActive) {
            throw new Error(`Activity category is inactive: ${input.categoryCode}`);
        }
        
        // 3. Validate input data against category requirements
        const validation = EmissionFactorLibrary.validateActivityData(category, {
            quantity: input.quantity,
            unit: input.unit,
            ...input.metadata
        });
        
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }
        
        // 4. Resolve emission factor
        const factorCode = input.factorCode || category.suggestedFactorId;
        if (!factorCode) {
            // Try to auto-resolve based on category
            const factors = await EmissionFactorLibrary.getFactorsForActivity({
                category: category.categoryCode,
                ghgScope: category.ghgScope,
                date: input.date
            });
            
            if (!factors.length) {
                throw new Error(`No emission factor found for category: ${input.categoryCode}`);
            }
        }
        
        // 5. Calculate CO2e (server-side, tamper-proof)
        const calculation = await EmissionFactorLibrary.calculateCO2e({
            factorCode: input.factorCode || category.suggestedFactorId!,
            quantity: input.quantity,
            unit: input.unit,
            date: input.date
        });
        
        // 6. Build result
        const result: CalculationResult = {
            co2e: calculation.co2e,
            factor: calculation.factor,
            calculation: calculation.calculation,
            activity: {
                categoryCode: input.categoryCode,
                methodologyTemplate: input.methodologyTemplate,
                quantity: input.quantity,
                unit: input.unit,
                date: input.date
            },
            audit: {
                calculatedAt: new Date().toISOString(),
                calculatedBy: userId,
                factorCode: calculation.factor.factorCode,
                factorVersion: calculation.factor.sourceVersion
            }
        };
        
        // 7. Store calculation for audit trail
        await this.storeCalculation(input, result, userId);
        
        return result;
    }
    
    /**
     * Bulk calculate multiple activities
     */
    static async calculateBulk(input: BulkCalculationInput, userId: string): Promise<BulkCalculationResult> {
        const results: CalculationResult[] = [];
        const errors: { index: number; error: string }[] = [];
        const byScope = { scope1: 0, scope2: 0, scope3: 0 };
        const byCategory: Record<string, number> = {};
        
        for (let i = 0; i < input.calculations.length; i++) {
            try {
                const result = await this.calculate(input.calculations[i], userId);
                results.push(result);
                
                // Aggregate
                byScope[`scope${result.factor.ghgScope}`] += result.co2e;
                byCategory[result.activity.categoryCode] = (byCategory[result.activity.categoryCode] || 0) + result.co2e;
            } catch (error) {
                errors.push({ index: i, error: error instanceof Error ? error.message : 'Unknown error' });
            }
        }
        
        return {
            results,
            summary: {
                totalCo2e: results.reduce((sum, r) => sum + r.co2e, 0),
                byScope,
                byCategory
            },
            errors
        };
    }
    
    /**
     * Store calculation for audit trail
     */
    private static async storeCalculation(input: CalculationInput, result: CalculationResult, userId: string): Promise<void> {
        await query(
            `INSERT INTO emission_calculations (
                calculation_id, user_id, category_code, methodology_template,
                quantity, unit, date, factor_code, factor_value,
                unit_numerator, unit_denominator, co2e, ghg_scope,
                calculation_details, metadata, created_at
            ) VALUES (
                extensions.uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8,
                $9, $10, $10, $11, $12, $13, NOW()
            )`,
            [
                userId,
                input.categoryCode,
                input.methodologyTemplate,
                input.quantity,
                input.unit,
                input.date,
                result.factor.factorCode,
                result.factor.factorValue,
                result.factor.unitNumerator,
                result.factor.unitDenominator,
                result.co2e,
                result.factor.ghgScope,
                JSON.stringify({ calculation: result.calculation, factor: result.factor.factorCode }),
                JSON.stringify(input.metadata || {})
            ]
        );
    }
    
    /**
     * Get calculation history
     */
    static async getCalculationHistory(userId: string, params?: {
        categoryCode?: string;
        methodologyTemplate?: string;
        dateFrom?: string;
        dateTo?: string;
        limit?: number;
    }): Promise<any[]> {
        let sql = `
            SELECT * FROM emission_calculations
            WHERE user_id = $1
        `;
        const params: any[] = [userId];
        let paramIndex = 2;
        
        if (params?.categoryCode) {
            sql += ` AND category_code = $${paramIndex++}`;
            params.push(params.categoryCode);
        }
        if (params?.methodologyTemplate) {
            sql += ` AND methodology_template = $${paramIndex++}`;
            params.push(params.methodologyTemplate);
        }
        if (params?.dateFrom) {
            sql += ` AND date >= $${paramIndex++}`;
            params.push(params.dateFrom);
        }
        if (params?.dateTo) {
            sql += ` AND date <= $${paramIndex++}`;
            params.push(params.dateTo);
        }
        
        sql += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
        params.push(params?.limit || 100);
        
        const { rows } = await query(sql, params);
        return rows;
    }
    
    /**
     * Recalculate with updated factor (for factor updates)
     */
    static async recalculateWithUpdatedFactor(
        calculationId: string,
        newFactorCode: string,
        userId: string
    ): Promise<CalculationResult> {
        // Get original calculation
        const { rows } = await query(
            `SELECT * FROM emission_calculations WHERE calculation_id = $1 AND user_id = $2`,
            [calculationId, userId]
        );
        
        if (!rows.length) {
            throw new Error('Calculation not found');
        }
        
        const original = rows[0];
        
        // Recalculate with new factor
        const calculation = await EmissionFactorLibrary.calculateCO2e({
            factorCode: newFactorCode,
            quantity: original.quantity,
            unit: original.unit,
            date: original.date
        });
        
        const result: CalculationResult = {
            co2e: calculation.co2e,
            factor: calculation.factor,
            calculation: calculation.calculation,
            activity: {
                categoryCode: original.category_code,
                methodologyTemplate: original.methodology_template,
                quantity: original.quantity,
                unit: original.unit,
                date: original.date
            },
            audit: {
                calculatedAt: new Date().toISOString(),
                calculatedBy: userId,
                factorCode: calculation.factor.factorCode,
                factorVersion: calculation.factor.sourceVersion
            }
        };
        
        // Update record
        await query(
            `UPDATE emission_calculations
             SET factor_code = $1, factor_value = $2, co2e = $3,
                 unit_numerator = $4, unit_denominator = $5,
                 calculation_details = $6, updated_at = NOW()
             WHERE calculation_id = $7`,
            [
                calculation.factor.factorCode,
                calculation.factor.factorValue,
                calculation.co2e,
                calculation.factor.unitNumerator,
                calculation.factor.unitDenominator,
                JSON.stringify({ calculation: result.calculation, recalculated: true, originalFactorCode: original.factor_code }),
                calculationId
            ]
        );
        
        return result;
    }
}

export default EmissionCalculationEngine;