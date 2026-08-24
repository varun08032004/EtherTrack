// Report Auto-Population Service
// Auto-populates BRSR, CDP, TCFD, GHG Protocol reports from emission data

import { safeQuery as query } from '../../db/pool.js';

export interface AutoPopulateData {
    // Company Info
    companyInfo: {
        name: string;
        cin: string;
        gstin: string;
        pan: string;
        industry: string;
        address: string;
    };
    
    // GHG Emissions
    ghgEmissions: {
        scope1: number;
        scope2: number;
        scope3: number;
        total: number;
        scope1Breakdown: Record<string, number>;
        scope2Breakdown: Record<string, number>;
        scope3Breakdown: Record<string, number>;
        intensity: number; // tCO2e per crore revenue
    };
    
    // Energy Consumption
    energy: {
        totalConsumption: number; // GJ
        renewableConsumption: number; // GJ
        renewablePercentage: number;
        gridElectricity: number; // kWh
        fuelConsumption: Record<string, number>; // fuel type -> quantity
    };
    
    // Water
    water: {
        withdrawal: number; // KL
        consumption: number; // KL
        recycled: number; // KL
        intensity: number; // KL per crore revenue
    };
    
    // Waste
    waste: {
        totalGenerated: number; // tonnes
        hazardous: number;
        nonHazardous: number;
        recycled: number;
        landfilled: number;
        composted: number;
    };
    
    // Carbon Credits
    carbonCredits: {
        purchased: number; // tonnes
        retired: number; // tonnes
        netPosition: number; // tonnes
        projects: Array<{
            projectName: string;
            standard: string;
            vintage: number;
            quantity: number;
            retirementDate: string;
        }>;
    };
    
    // Targets & Progress
    targets: {
        netZeroYear: number | null;
        baseYear: number | null;
        baseYearEmissions: number | null;
        reductionTarget: number | null; // percentage
        progress: number; // percentage achieved
    };
    
    // Governance
    governance: {
        hasEsgCommittee: boolean;
        esgPolicyUrl: string | null;
        boardOversight: boolean;
    };
}

/**
 * Auto-populate report data from emission calculations and user profile
 */
export async function emitAutoPopulateData(userId: string, reportType: string, year: number): Promise<any> {
    const companyInfo = await getCompanyInfo(userId);
    const emissionsData = await getEmissionsData(userId, year);
    const energyData = await getEnergyData(userId, year);
    const carbonCredits = await getCarbonCredits(userId, year);
    const targets = await getTargets(userId);
    
    const baseData = {
        companyInfo,
        ghgEmissions: emissionsData,
        energy: energyData,
        carbonCredits,
        targets,
        generatedAt: new Date().toISOString(),
        reportType,
        year
    };
    
    // Add report-type specific data
    switch (reportType) {
        case 'BRSR':
            return {
                ...baseData,
                water: await getWaterData(userId, year),
                waste: await getWasteData(userId, year),
                governance: await getGovernanceData(userId)
            };
        case 'CDP':
            return {
                ...baseData,
                cdpSpecific: await getCDPSpecificData(userId, year)
            };
        case 'TCFD':
            return {
                ...baseData,
                tcfdSpecific: await getTCFDSpecificData(userId, year)
            };
        case 'GHG_PROTOCOL':
            return {
                ...baseData,
                ghgProtocolSpecific: await getGHGProtocolSpecificData(userId, year)
            };
        default:
            return baseData;
    }
}

/**
 * Get company info from profile
 */
async function getCompanyInfo(userId: string) {
    const { rows } = await query(
        `SELECT company_name, company_cin, company_gstin, company_pan, 
                industry_sector, company_address, company_type
         FROM emission_profiles WHERE user_id = $1`,
        [userId]
    );
    
    return rows[0] ? {
        name: rows[0].company_name,
        cin: rows[0].company_cin,
        gstin: rows[0].company_gstin,
        pan: rows[0].company_pan,
        industry: rows[0].industry_sector,
        address: rows[0].company_address,
        type: rows[0].company_type
    } : {
        name: '', cin: '', gstin: '', pan: '', industry: '', address: '', type: ''
    };
}

/**
 * Get emissions data from calculations
 */
async function getEmissionsData(userId: string, year: number) {
    const { rows } = await query(
        `SELECT 
            SUM(CASE WHEN ghg_scope = 1 THEN co2e ELSE 0 END) as scope1,
            SUM(CASE WHEN ghg_scope = 2 THEN co2e ELSE 0 END) as scope2,
            SUM(CASE WHEN ghg_scope = 3 THEN co2e ELSE 0 END) as scope3,
            SUM(co2e) as total,
            jsonb_object_agg(category_code, co2e) as breakdown
         FROM emission_calculations
         WHERE user_id = $1 AND EXTRACT(YEAR FROM date) = $2`,
        [userId, year]
    );
    
    const row = rows[0];
    const scope1 = Number(row.scope1 || 0);
    const scope2 = Number(row.scope2 || 0);
    const scope3 = Number(row.scope3 || 0);
    const total = Number(row.total || 0);
    
    // Get breakdown by category
    let scope1Breakdown = {}, scope2Breakdown = {}, scope3Breakdown = {};
    
    if (row.breakdown) {
        // Would need to join with category metadata for proper breakdown
        // Simplified for now
    }
    
    // Get profile for intensity calculation
    const { rows: profileRows } = await query(
        `SELECT revenue_cr FROM emission_profiles WHERE user_id = $1`,
        [userId]
    );
    const revenue = rowRows[0]?.revenue_cr || 1;
    const intensity = revenue > 0 ? (scope1 + scope2 + scope3) / revenue : 0;
    
    return {
        scope1,
        scope2,
        scope3,
        total,
        scope1Breakdown,
        scope2Breakdown,
        scope3Breakdown,
        intensity
    };
}

/**
 * Get energy consumption data
 */
async function getEnergyData(userId: string, year: number) {
    const { rows } = await query(
        `SELECT 
            SUM(CASE WHEN category_code = 'PURCHASED_ELECTRICITY' THEN quantity ELSE 0 END) as grid_electricity_kwh,
            SUM(CASE WHEN category_code = 'PURCHASED_HEAT' THEN quantity ELSE 0 END) as purchased_heat,
            SUM(CASE WHEN category_code IN ('DIESEL', 'PETROL', 'NATURAL_GAS', 'COAL', 'LPG', 'FURNACE_OIL') 
                THEN quantity * factor_value * 1000 / 3.6 ELSE 0 END) as fuel_gj,
            jsonb_object_agg(category_code, quantity) as fuel_quantities
         FROM emission_calculations
         WHERE user_id = $1 AND EXTRACT(YEAR FROM date) = $2
         GROUP BY user_id`,
        [userId, year]
    );
    
    const row = rows[0] || {};
    const gridElectricity = Number(row.grid_electricity_kwh || 0);
    const fuelGj = Number(row.fuel_gj || 0);
    const totalConsumption = (gridElectricity * 3.6 / 1000) + fuelGj; // Convert kWh to GJ
    
    return {
        totalConsumption,
        renewableConsumption: 0, // Would need renewable energy tracking
        renewablePercentage: 0,
        gridElectricity,
        fuelConsumption: row.fuel_quantities || {}
    };
}

/**
 * Get carbon credits data
 */
async function getCarbonCredits(userId: string, year: number) {
    const { rows: purchaseRows } = await query(
        `SELECT SUM(quantity) as purchased, jsonb_agg(jsonb_build_object(
            'projectName', cb.project_name,
            'standard', cb.standard,
            'vintage', cb.vintage_year,
            'quantity', t.quantity,
            'retirementDate', t.inr_settlement_at
        )) as projects
         FROM trades t
         JOIN carbon_batches cb ON cb.id = t.batch_id
         WHERE t.buyer_id = $1 
           AND t.status = 'completed'
           AND EXTRACT(YEAR FROM t.created_at) = $2`,
        [userId, year]
    );
    
    const { rows: retirementRows } = await query(
        `SELECT SUM(quantity) as retired FROM retirements 
         WHERE retired_by = $1 AND retire_year = $2 AND status = 'completed'`,
        [userId, year]
    );
    
    const purchased = Number(purchaseRows[0]?.purchased || 0);
    const retired = Number(retirementRows[0]?.retired || 0);
    
    return {
        purchased,
        retired,
        netPosition: purchased - retired,
        projects: purchaseRows[0]?.projects || []
    };
}

/**
 * Get emission targets
 */
async function getTargets(userId: string) {
    const { rows } = await query(
        `SELECT net_zero_year, base_year, net_zero_target_co2e, reporting_year
         FROM emission_profiles WHERE user_id = $1`,
        [userId]
    );
    
    const profile = rows[0] || {};
    
    // Calculate progress
    let progress = 0;
    if (profile.base_year && profile.net_zero_target_co2e) {
        const { rows: currentEmissions } = await query(
            `SELECT SUM(co2e) as total FROM emission_calculations 
             WHERE user_id = $1 AND EXTRACT(YEAR FROM date) = $2`,
            [userId, new Date().getFullYear()]
        );
        const current = Number(currentEmissions[0]?.total || 0);
        const target = profile.net_zero_target_co2e;
        const base = await getBaseYearEmissions(userId, profile.base_year);
        
        if (base > target && current <= base) {
            progress = Math.min(100, Math.max(0, ((base - current) / (base - target)) * 100));
        }
    }
    
    return {
        netZeroYear: profile.net_zero_year || null,
        baseYear: profile.base_year || null,
        baseYearEmissions: await getBaseYearEmissions(userId, profile.base_year || 0),
        reductionTarget: profile.net_zero_target_co2e ? 100 : null, // Simplified
        progress: Math.round(progress * 100) / 100
    };
}

async function getBaseYearEmissions(userId: string, baseYear: number) {
    const { rows } = await query(
        `SELECT SUM(co2e) as total FROM emission_calculations 
         WHERE user_id = $1 AND EXTRACT(YEAR FROM date) = $2`,
        [userId, baseYear]
    );
    return Number(rows[0]?.total || 0);
}

/**
 * Get water data for BRSR
 */
async function getWaterData(userId: string, year: number) {
    const { rows } = await query(
        `SELECT 
            SUM(CASE WHEN category_code LIKE '%WATER%' THEN quantity ELSE 0 END) as withdrawal,
            SUM(CASE WHEN category_code LIKE '%WATER_RECYCLE%' THEN quantity ELSE 0 END) as recycled,
            SUM(CASE WHEN category_code LIKE '%WATER_CONSUMPTION%' THEN quantity ELSE 0 END) as consumption
         FROM emission_calculations
         WHERE user_id = $1 AND EXTRACT(YEAR FROM date) = $2`,
        [userId, year]
    );
    
    const row = rows[0] || {};
    const withdrawal = Number(row.withdrawal || 0);
    const recycled = Number(row.recycled || 0);
    const consumption = Number(row.consumption || 0);
    
    // Get revenue for intensity
    const { rows: profileRows } = await query(
        `SELECT revenue_cr FROM emission_profiles WHERE user_id = $1`, [userId]
    );
    const revenue = profileRows[0]?.revenue_cr || 1;
    const intensity = revenue > 0 ? withdrawal / revenue : 0;
    
    return {
        withdrawal,
        consumption,
        recycled,
        intensity
    };
}

/**
 * Get waste data for BRSR
 */
async function getWasteData(userId: string, year: number) {
    const { rows } = await query(
        `SELECT 
            SUM(CASE WHEN category_code LIKE '%WASTE_HAZARDOUS%' THEN quantity ELSE 0 END) as hazardous,
            SUM(CASE WHEN category_code LIKE '%WASTE_NON_HAZARDOUS%' THEN quantity ELSE 0 END) as non_hazardous,
            SUM(CASE WHEN category_code LIKE '%WASTE_RECYCLE%' THEN quantity ELSE 0 END) as recycled,
            SUM(CASE WHEN category_code LIKE '%WASTE_LANDFILL%' THEN quantity ELSE 0 END) as landfilled,
            SUM(CASE WHEN category_code LIKE '%WASTE_COMPOST%' THEN quantity ELSE 0 END) as composted,
            SUM(quantity) as total
         FROM emission_calculations
         WHERE user_id = $1 AND EXTRACT(YEAR FROM date) = $2`,
        [userId, year]
    );
    
    const row = rows[0] || {};
    return {
        totalGenerated: Number(row.total || 0),
        hazardous: Number(row.hazardous || 0),
        nonHazardous: Number(row.non_hazardous || 0),
        recycled: Number(row.recycled || 0),
        landfilled: Number(row.landfilled || 0),
        composted: Number(row.composted || 0)
    };
}

/**
 * Get governance data
 */
async function getGovernanceData(userId: string) {
    const { rows } = await query(
        `SELECT 
            esg_committee_exists as has_esg_committee,
            esg_policy_url,
            board_oversight
         FROM governance_profiles WHERE user_id = $1`,
        [userId]
    );
    
    return rows[0] ? {
        hasEsgCommittee: rows[0].has_esg_committee || false,
        esgPolicyUrl: rows[0].esg_policy_url,
        boardOversight: rows[0].board_oversight || false
    } : {
        hasEsgCommittee: false,
        esgPolicyUrl: null,
        boardOversight: false
    };
}

/**
 * CDP-specific data
 */
async function getCDPSpecificData(userId: string, year: number) {
    return {
        governance: await getGovernanceData(userId),
        riskManagement: {
            identifiedRisks: [],
            opportunities: []
        },
        metricsTargets: {
            baseYear: null,
            targets: []
        }
    };
}

/**
 * TCFD-specific data
 */
async function getTCFDSpecificData(userId: string, year: number) {
    return {
        governance: await getGovernanceData(userId),
        strategy: {
            climateScenarios: [],
            transitionRisks: [],
            physicalRisks: [],
            opportunities: []
        },
        riskManagement: {
            processes: []
        },
        metricsTargets: {
            emissions: [],
            targets: []
        }
    };
}

/**
 * GHG Protocol specific data
 */
async function getGHGProtocolSpecificData(userId: string, year: number) {
    return {
        organizationalBoundary: 'Operational Control',
        reportingPeriod: `${year}-01-01 to ${year}-12-31`,
        baseYearRecalculationPolicy: 'Significant structural changes',
        emissionFactors: {
            sources: ['CEA V20.0', 'IPCC 2006', 'BEE PAT'],
            versions: 'Latest available at reporting date'
        }
    };
}

export default {
    emitAutoPopulateData,
    getCompanyInfo,
    getEmissionsData,
    getEnergyData,
    getCarbonCredits,
    getTargets,
    getWaterData,
    getWasteData,
    getGovernanceData,
    getCDPSpecificData,
    getTCFDSpecificData,
    getGHGProtocolSpecificData
};