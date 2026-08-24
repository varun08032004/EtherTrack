// Emission Factor Library Service
// Server-side emission factor management with versioning and audit trail

const { safeQuery: query, withTransaction } = require('../../db/pool.js');

class EmissionFactorLibrary {
    async getFactorByCode(factorCode) {
        const { rows } = await query('SELECT * FROM emission_factors WHERE factor_code = $1 AND is_active = true', [factorCode]);
        return rows[0] || null;
    }

    async getDefaultFactor(categoryCode, methodologyTemplate) {
        const { rows } = await query(`
            SELECT ef.* FROM emission_factors ef
            JOIN emission_factor_categories efc ON ef.category_id = efc.category_id
            WHERE efc.category_code = $1 AND ef.methodology_template = $2 AND ef.is_active = true AND ef.is_custom = false
            ORDER BY ef.effective_from DESC LIMIT 1
        `, [categoryCode, methodologyTemplate]);
        return rows[0] || null;
    }

    async getAllFactors(filters = {}) {
        let queryStr = 'SELECT ef.*, efc.category_code FROM emission_factors ef JOIN emission_factor_categories efc ON ef.category_id = efc.category_id WHERE ef.is_active = true';
        const params = [];
        let paramIndex = 1;

        if (filters.categoryCode) {
            queryStr += ` AND efc.category_code = $${paramIndex++}`;
            params.push(filters.categoryCode);
        }
        if (filters.methodologyTemplate) {
            queryStr += ` AND ef.methodology_template = $${paramIndex++}`;
            params.push(filters.methodologyTemplate);
        }
        if (filters.ghgScope) {
            queryStr += ` AND ef.ghg_scope = $${paramIndex++}`;
            params.push(filters.ghgScope);
        }
        if (filters.isCustom !== undefined) {
            queryStr += ` AND ef.is_custom = $${paramIndex++}`;
            params.push(filters.isCustom);
        }
        if (filters.search) {
            queryStr += ` AND (ef.factor_code ILIKE $${paramIndex} OR ef.name ILIKE $${paramIndex})`;
            params.push(`%${filters.search}%`);
        }
        queryStr += ' ORDER BY ef.factor_code';
        if (filters.limit) {
            queryStr += ` LIMIT $${paramIndex++}`;
            params.push(filters.limit);
        }
        if (filters.offset) {
            queryStr += ` OFFSET $${paramIndex}`;
            params.push(filters.offset);
        }

        const { rows } = await query(queryStr, params);
        return rows;
    }

    async createFactor(data) {
        const { factorCode, name, description, categoryId, subCategory, factorValue, unitNumerator, unitDenominator, ghgScope, geography, region, sector, source, sourceVersion, sourceDocumentUrl, effectiveFrom, effectiveTo, uncertaintyPct, qualityRating, isCustom, methodologyTemplate, categoryCode } = data;

        let categoryIdFinal = categoryId;
        if (!categoryIdFinal && categoryCode) {
            const { rows } = await query('SELECT category_id FROM emission_factor_categories WHERE category_code = $1', [categoryCode]);
            if (rows.length) categoryIdFinal = rows[0].category_id;
        }

        const { rows } = await query(`
            INSERT INTO emission_factors 
            (factor_code, name, description, category_id, sub_category, factor_value, unit_numerator, unit_denominator, ghg_scope, geography, region, sector, source, source_version, source_document_url, effective_from, effective_to, uncertainty_pct, quality_rating, is_active, is_custom, methodology_template, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW(), NOW())
            RETURNING *
        `, [factorCode, name, description, categoryIdFinal, subCategory, factorValue, unitNumerator, unitDenominator, ghgScope, geography, region, sector, source, sourceVersion, sourceDocumentUrl, effectiveFrom, effectiveTo, uncertaintyPct, qualityRating, true, isCustom, methodologyTemplate]);

        // Log version
        await query(`
            INSERT INTO emission_factor_versions 
            (factor_id, factor_value, unit_numerator, unit_denominator, effective_from, effective_to, change_reason, changed_by)
            VALUES ($1, $2, $3, $4, $5, $6, 'Initial version', $7)
        `, [rows[0].factor_id, factorValue, unitNumerator, unitDenominator, effectiveFrom, effectiveTo, rows[0].created_by]);

        return rows[0];
    }

    async updateFactor(factorId, data) {
        const { factorValue, unitNumerator, unitDenominator, effectiveFrom, effectiveTo, uncertaintyPct, qualityRating, isActive, changeReason } = data;

        // Get current factor for versioning
        const { rows: current } = await query('SELECT * FROM emission_factors WHERE factor_id = $1', [factorId]);
        if (!current.length) throw new Error('Factor not found');

        const { rows } = await query(`
            UPDATE emission_factors SET
                factor_value = $1, unit_numerator = $2, unit_denominator = $3,
                effective_from = $4, effective_to = $5, uncertainty_pct = $5,
                quality_rating = $7, is_active = $8, updated_at = NOW()
            WHERE factor_id = $9
            RETURNING *
        `, [factorValue, unitNumerator, unitDenominator, effectiveFrom, effectiveTo, uncertaintyPct, qualityRating, isActive, factorId]);

        // Log version
        await query(`
            INSERT INTO emission_factor_versions 
            (factor_id, factor_value, unit_numerator, unit_denominator, effective_from, effective_to, change_reason, changed_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [factorId, factorValue, unitNumerator, unitDenominator, effectiveFrom, effectiveTo, changeReason, current[0].created_by]);

        return rows[0];
    }

    async getFactorVersions(factorId) {
        const { rows } = await query('SELECT * FROM emission_factor_versions WHERE factor_id = $1 ORDER BY created_at DESC', [factorId]);
        return rows;
    }

    async getMethodologyTemplate(templateCode) {
        const { rows } = await query('SELECT * FROM methodology_templates WHERE template_code = $1 AND is_active = true', [templateCode]);
        return rows[0] || null;
    }

    async getAllMethodologyTemplates() {
        const { rows } = await query('SELECT * FROM methodology_templates WHERE is_active = true ORDER BY template_code');
        return rows;
    }

    async createMethodologyTemplate(data) {
        const { templateCode, name, description, version, categories } = data;
        const { rows } = await query(`
            INSERT INTO methodology_templates (template_code, name, description, version, categories, is_active, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW())
            RETURNING *
        `, [templateCode, name, description, version, JSON.stringify(categories)]);
        return rows[0];
    }

    async getCategoryByCode(categoryCode) {
        const { rows } = await query('SELECT * FROM emission_factor_categories WHERE category_code = $1', [categoryCode]);
        return rows[0] || null;
    }

    async validateActivityData(category, data) {
        const errors = [];
        const required = category.requiredFields || [];
        for (const field of required) {
            if (!data[field] && data[field] !== 0) {
                errors.push(`Required field missing: ${field}`);
            }
        }
        if (category.unitOptions && data.unit && !category.unitOptions.includes(data.unit)) {
            errors.push(`Invalid unit: ${data.unit}. Allowed: ${category.unitOptions.join(', ')}`);
        }
        return { valid: errors.length === 0, errors };
    }
}

module.exports = new EmissionFactorLibrary();