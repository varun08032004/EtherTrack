// Emission Calculation Engine
// Server-side calculation engine: activity × factor = CO2e
// Prevents client-side manipulation

const { safeQuery: query, withTransaction } = require('../../db/pool.js');
const EmissionFactorLibrary = require('./emissionFactorLibrary.js');

class EmissionCalculationEngine {
    async calculate(input, userId) {
        const { categoryCode, methodologyTemplate, quantity, unit, date, factorCode, metadata } = input;
        
        // Get emission factor
        const factor = factorCode 
            ? await EmissionFactorLibrary.getFactorByCode(factorCode)
            : await EmissionFactorLibrary.getDefaultFactor(categoryCode, methodologyTemplate);
        
        if (!factor) {
            throw new Error(`No emission factor found for category: ${categoryCode}`);
        }
        
        // Calculate CO2e = quantity × factor
        const co2e = quantity * factor.factorValue;
        
        // Store calculation in database
        const { rows } = await query(`
            INSERT INTO emission_calculations 
            (user_id, category_code, methodology_template, quantity, unit, date, factor_code, co2e, metadata, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            RETURNING *
        `, [userId, categoryCode, methodologyTemplate, quantity, unit, date, factor.factorCode, co2e, JSON.stringify(metadata || {})]);
        
        return {
            co2e,
            factor,
            calculation: `${quantity} ${unit} × ${factor.factorValue} ${factor.unitNumerator}/${factor.unitDenominator} = ${co2e.toFixed(4)} tCO2e`,
            activity: { categoryCode, methodologyTemplate, quantity, unit, date },
            audit: {
                calculatedAt: new Date().toISOString(),
                calculatedBy: userId,
                factorCode: factor.factorCode,
                factorVersion: factor.sourceVersion
            }
        };
    }
    
    async calculateBulk(input, userId) {
        const { calculations } = input;
        const results = [];
        const errors = [];
        
        for (let i = 0; i < calculations.length; i++) {
            try {
                const result = await this.calculate(calculations[i], userId);
                results.push(result);
            } catch (error) {
                errors.push({ index: i, error: error.message });
            }
        }
        
        const totalCo2e = results.reduce((sum, r) => sum + r.co2e, 0);
        const byScope = { scope1: 0, scope2: 0, scope3: 0 };
        const byCategory = {};
        
        for (const r of results) {
            const scope = r.factor.ghgScope;
            if (scope === 1) byScope.scope1 += r.co2e;
            else if (scope === 2) byScope.scope2 += r.co2e;
            else if (scope === 3) byScope.scope3 += r.co2e;
            
            byCategory[r.activity.categoryCode] = (byCategory[r.activity.categoryCode] || 0) + r.co2e;
        }
        
        return {
            results,
            summary: { totalCo2e, byScope, byCategory },
            errors
        };
    }
    
    async recalculateWithUpdatedFactor(calculationId, newFactorCode, userId) {
        const { rows } = await query('SELECT * FROM emission_calculations WHERE calculation_id = $1 AND user_id = $2', [calculationId, userId]);
        if (!rows.length) throw new Error('Calculation not found');
        
        const oldCalc = rows[0];
        const input = {
            categoryCode: oldCalc.category_code,
            methodologyTemplate: oldCalc.methodology_template,
            quantity: oldCalc.quantity,
            unit: oldCalc.unit,
            date: oldCalc.date,
            factorCode: newFactorCode,
            metadata: oldCalc.metadata
        };
        
        return this.calculate(input, userId);
    }
    
    async getCalculationHistory(userId, options = {}) {
        let queryStr = 'SELECT * FROM emission_calculations WHERE user_id = $1';
        const params = [userId];
        let paramIndex = 2;
        
        if (options.categoryCode) {
            queryStr += ` AND category_code = $${paramIndex++}`;
            params.push(options.categoryCode);
        }
        if (options.methodologyTemplate) {
            queryStr += ` AND methodology_template = $${paramIndex++}`;
            params.push(options.methodologyTemplate);
        }
        if (options.dateFrom) {
            queryStr += ` AND date >= $${paramIndex++}`;
            params.push(options.dateFrom);
        }
        if (options.dateTo) {
            queryStr += ` AND date <= $${paramIndex++}`;
            params.push(options.dateTo);
        }
        queryStr += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
        params.push(options.limit || 100);
        
        const { rows } = await query(queryStr, params);
        return rows;
    }
}

module.exports = EmissionCalculationEngine;