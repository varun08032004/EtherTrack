// SEC Climate Disclosure Engine - SEC Rule 33-11042 (March 2024)
// Implements SEC climate-related disclosure requirements for public companies

import { safeQuery as query, withTransaction } from '../../db/pool.js';

export interface SECClimateReport {
    reportId: string;
    companyId: string;
    filingId: string; // SEC accession number
    fiscalYear: number;
    governance: GovernanceDisclosure;
    strategy: StrategyDisclosure;
    riskManagement: RiskManagementDisclosure;
    metricsTargets: MetricsTargetsDisclosure;
    scenarioAnalysis?: ScenarioAnalysisDisclosure;
    status: 'DRAFT' | 'REVIEW' | 'FILED' | 'AMENDED';
    filedAt?: string;
    createdAt: string;
    updatedAt: string;
}

export interface GovernanceDisclosure {
    boardOversight: {
        description: string;
        committeeResponsible: string;
        meetingFrequency: string;
        expertise: string[];
    };
    managementRole: {
        description: string;
        positionsResponsible: string[];
        reportingFrequency: string;
    };
}

export interface StrategyDisclosure {
    climateRisksIdentified: ClimateRisk[];
    climateOpportunitiesIdentified: ClimateOpportunity[];
    impactOnBusiness: {
        shortTerm: string; // < 1 year
        mediumTerm: string; // 1-5 years
        longTerm: string; // > 5 years
    };
    impactOnStrategy: string;
    impactOnFinancialPlanning: string;
    transitionPlan?: TransitionPlan;
}

export interface ClimateRisk {
    riskId: string;
    type: 'PHYSICAL_ACUTE' | 'PHYSICAL_CHRONIC' | 'TRANSITION_POLICY' | 'TRANSITION_LEGAL' | 'TRANSITION_TECHNOLOGY' | 'TRANSITION_MARKET' | 'TRANSITION_REPUTATION';
    description: string;
    likelihood: 'HIGH' | 'MEDIUM' | 'LOW';
    magnitude: 'HIGH' | 'MEDIUM' | 'LOW';
    timeHorizon: 'SHORT' | 'MEDIUM' | 'LONG';
    financialImpact?: {
        estimatedCostMin: number;
        estimatedCostMax: number;
        currency: 'USD';
    };
    mitigationMeasures: string[];
}

export interface ClimateOpportunity {
    opportunityId: string;
    type: 'RESOURCE_EFFICIENCY' | 'ENERGY_SOURCE' | 'PRODUCTS_SERVICES' | 'MARKETS' | 'RESILIENCE';
    description: string;
    potentialFinancialImpact?: {
        estimatedBenefitMin: number;
        estimatedBenefitMax: number;
        currency: 'USD';
    };
    timeHorizon: 'SHORT' | 'MEDIUM' | 'LONG';
}

export interface TransitionPlan {
    targets: EmissionTarget[];
    actions: TransitionAction[];
    capexAllocation: number; // USD
    opexAllocation: number; // USD
    governance: string;
}

export interface EmissionTarget {
    targetId: string;
    scope: 'SCOPE_1' | 'SCOPE_2' | 'SCOPE_3';
    targetType: 'ABSOLUTE' | 'INTENSITY';
    baseYear: number;
    targetYear: number;
    baseYearEmissions: number; // tCO2e
    targetEmissions: number; // tCO2e
    reductionPercentage: number;
    status: 'SET' | 'IN_PROGRESS' | 'ACHIEVED' | 'MISSED';
    methodology: string;
}

export interface TransitionAction {
    actionId: string;
    description: string;
    category: 'ENERGY_EFFICIENCY' | 'RENEWABLE_ENERGY' | 'FUEL_SWITCHING' | 'ELECTRIFICATION' | 'CCS' | 'NATURE_BASED' | 'OTHER';
    estimatedReduction: number; // tCO2e/year
    estimatedCost: number; // USD
    startYear: number;
    endYear: number;
    status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED';
}

export interface RiskManagementDisclosure {
    identificationProcess: string;
    assessmentProcess: string;
    integrationIntoOverallRisk: string;
    riskManagementTools: string[];
}

export interface MetricsTargetsDisclosure {
    ghgEmissions: GHGEmissionsDisclosure;
    energyConsumption: EnergyConsumptionDisclosure;
    targets: EmissionTarget[];
    carbonCredits: CarbonCreditsDisclosure;
    internalCarbonPrice?: InternalCarbonPriceDisclosure;
}

export interface GHGEmissionsDisclosure {
    scope1: number; // tCO2e
    scope2LocationBased: number; // tCO2e
    scope2MarketBased: number; // tCO2e
    scope3?: Scope3EmissionsDisclosure;
    totalScope12: number;
    totalScope123?: number;
    methodology: string;
    verificationStatus: 'UNVERIFIED' | 'LIMITED_ASSURANCE' | 'REASONABLE_ASSURANCE';
    verifier?: string;
}

export interface Scope3EmissionsDisclosure {
    category1PurchasedGoods?: number;
    category2CapitalGoods?: number;
    category3FuelEnergy?: number;
    category4UpstreamTransport?: number;
    category5Waste?: number;
    category6BusinessTravel?: number;
    category7EmployeeCommuting?: number;
    category8UpstreamLeased?: number;
    category9DownstreamTransport?: number;
    category10ProcessingSoldProducts?: number;
    category11UseSoldProducts?: number;
    category12EndOfLife?: number;
    category13DownstreamLeased?: number;
    category14Franchises?: number;
    category15Investments?: number;
    total: number;
    categoriesReported: string[];
    methodology: string;
}

export interface EnergyConsumptionDisclosure {
    totalEnergyConsumption: number; // MWh
    renewableEnergyConsumption: number; // MWh
    renewablePercentage: number;
    electricityConsumption: number; // MWh
    fuelConsumption: number; // MWh
    steamConsumption: number; // MWh
    coolingConsumption: number; // MWh
}

export interface CarbonCreditsDisclosure {
    creditsRetired: number; // tCO2e
    creditsPurchased: number; // tCO2e
    creditsGenerated: number; // tCO2e
    registries: string[];
    vintageRange: { start: number; end: number };
    qualityCriteria: string;
}

export interface InternalCarbonPriceDisclosure {
    price: number; // USD/tCO2e
    scope: 'SCOPE_1' | 'SCOPE_2' | 'SCOPE_1_2' | 'SCOPE_1_2_3';
    application: string;
    methodology: string;
}

export interface ScenarioAnalysisDisclosure {
    scenarios: ClimateScenario[];
    methodology: string;
    timeHorizons: number[];
    keyAssumptions: Record<string, string>;
    resultsSummary: string;
    financialImpacts: ScenarioFinancialImpact[];
}

export interface ClimateScenario {
    scenarioId: string;
    name: string;
    provider: 'IPCC' | 'IEA' | 'NGFS' | 'TCFD' | 'CUSTOM';
    description: string;
    temperaturePathway: string; // e.g., "1.5°C", "2°C", "3°C"
    transitionRiskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
    physicalRiskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ScenarioFinancialImpact {
    scenarioId: string;
    revenueImpact: number; // USD
    opexImpact: number; // USD
    capexImpact: number; // USD
    assetImpairment: number; // USD
    netImpact: number; // USD
    year: number;
}

export class SECClimateEngine {
    /**
     * Generate SEC Climate Disclosure report
     */
    static async generateReport(companyId: string, fiscalYear: number): Promise<SECClimateReport> {
        const { rows: company } = await query(
            `SELECT * FROM companies WHERE company_id = $1`,
            [companyId]
        );

        if (!company.length) {
            throw new Error('Company not found');
        }

        // Fetch emissions data from our carbon calculation engine
        const emissions = await this.getCompanyEmissions(companyId, fiscalYear);
        const energy = await this.getCompanyEnergy(companyId, fiscalYear);
        const targets = await this.getCompanyTargets(companyId);
        const carbonCredits = await this.getCompanyCarbonCredits(companyId, fiscalYear);

        const report: SECClimateReport = {
            reportId: `SEC-CLIMATE-${companyId}-${fiscalYear}-${Date.now()}`,
            companyId,
            filingId: '', // Will be populated after filing
            fiscalYear,
            governance: await this.getGovernanceDisclosure(companyId),
            strategy: await this.getStrategyDisclosure(companyId, fiscalYear),
            riskManagement: await this.getRiskManagementDisclosure(companyId),
            metricsTargets: {
                ghgEmissions: this.buildGHGDisclosure(emissions),
                energyConsumption: this.buildEnergyDisclosure(energy),
                targets,
                carbonCredits: this.buildCarbonCreditsDisclosure(carbonCredits),
            },
            status: 'DRAFT',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        // Save report
        await query(
            `INSERT INTO sec_climate_reports 
             (report_id, company_id, fiscal_year, governance, strategy, risk_management, metrics_targets, status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', NOW(), NOW())
             RETURNING report_id`,
            [
                report.reportId, companyId, fiscalYear,
                JSON.stringify(report.governance),
                JSON.stringify(report.strategy),
                JSON.stringify(report.riskManagement),
                JSON.stringify(report.metricsTargets),
            ]
        );

        return report;
    }

    /**
     * Build GHG emissions disclosure per SEC requirements
     */
    private buildGHGDisclosure(emissions: any): GHGEmissionsDisclosure {
        const scope1 = emissions.scope1 || 0;
        const scope2LocationBased = emissions.scope2LocationBased || 0;
        const scope2MarketBased = emissions.scope2MarketBased || scope2LocationBased;
        const scope3 = emissions.scope3 || null;

        return {
            scope1,
            scope2LocationBased,
            scope2MarketBased,
            scope3,
            totalScope12: scope1 + scope2MarketBased,
            totalScope123: scope3 ? scope1 + scope2MarketBased + scope3.total : undefined,
            methodology: 'GHG Protocol Corporate Standard',
            verificationStatus: emissions.verified ? 'REASONABLE_ASSURANCE' : 'UNVERIFIED',
            verifier: emissions.verifier,
        };
    }

    /**
     * Build energy consumption disclosure
     */
    private buildEnergyDisclosure(energy: any): EnergyConsumptionDisclosure {
        const total = energy.total || 0;
        const renewable = energy.renewable || 0;

        return {
            totalEnergyConsumption: total,
            renewableEnergyConsumption: renewable,
            renewablePercentage: total > 0 ? (renewable / total) * 100 : 0,
            electricityConsumption: energy.electricity || 0,
            fuelConsumption: energy.fuel || 0,
            steamConsumption: energy.steam || 0,
            coolingConsumption: energy.cooling || 0,
        };
    }

    /**
     * Build carbon credits disclosure
     */
    private buildCarbonCreditsDisclosure(credits: any): CarbonCreditsDisclosure {
        return {
            creditsRetired: credits.retired || 0,
            creditsPurchased: credits.purchased || 0,
            creditsGenerated: credits.generated || 0,
            registries: credits.registries || [],
            vintageRange: credits.vintageRange || { start: 0, end: 0 },
            qualityCriteria: credits.qualityCriteria || 'Verra/Gold Standard/ICROA',
        };
    }

    /**
     * Validate SEC Climate report
     */
    static async validateReport(reportId: string): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
        const { rows } = await query(
            `SELECT * FROM sec_climate_reports WHERE report_id = $1`,
            [reportId]
        );

        if (!rows.length) return { valid: false, errors: ['Report not found'], warnings: [] };

        const report = rows[0];
        const errors: string[] = [];
        const warnings: string[] = [];

        // Required fields per SEC rule
        if (!report.governance?.boardOversight?.description) {
            errors.push('Governance: Board oversight description required');
        }

        if (!report.strategy?.climateRisksIdentified?.length) {
            warnings.push('Strategy: No climate risks identified (consider if material)');
        }

        if (!report.metricsTargets?.ghgEmissions) {
            errors.push('Metrics: GHG emissions disclosure required');
        } else {
            const ghg = report.metricsTargets.ghgEmissions;
            if (ghg.scope1 === undefined || ghg.scope2MarketBased === undefined) {
                errors.push('Metrics: Scope 1 and Scope 2 (market-based) required');
            }
            if (ghg.verificationStatus === 'UNVERIFIED') {
                warnings.push('Metrics: GHG emissions not verified (assurance recommended)');
            }
        }

        // Scope 3 - required if material
        if (report.metricsTargets?.ghgEmissions?.scope3 === undefined) {
            warnings.push('Metrics: Scope 3 not disclosed (required if material)');
        }

        // Targets
        if (!report.metricsTargets?.targets?.length) {
            warnings.push('Metrics: No emission reduction targets disclosed');
        }

        // Scenario analysis - required for accelerated filers, large accelerated filers
        if (!report.scenarioAnalysis) {
            warnings.push('Scenario analysis not included (required for large accelerated filers)');
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    /**
     * Generate XBRL tags for SEC filing
     */
    static generateXBRLTags(report: SECClimateReport): Record<string, any> {
        const tags: Record<string, any> = {
            'dei:EntityRegistrantName': report.companyId, // Would be company name
            'dei:DocumentFiscalYearFocus': report.fiscalYear.toString(),
            'dei:DocumentPeriodEndDate': `${report.fiscalYear}-12-31`,
            
            // Governance
            'climate:BoardOversightDescription': report.governance.boardOversight.description,
            'climate:CommitteeResponsible': report.governance.boardOversight.committeeResponsible,
            'climate:MeetingFrequency': report.governance.boardOversight.meetingFrequency,
            'climate:ManagementRoleDescription': report.governance.managementRole.description,
            
            // Strategy
            'climate:ClimateRisksIdentified': JSON.stringify(report.strategy.climateRisksIdentified),
            'climate:ClimateOpportunitiesIdentified': JSON.stringify(report.strategy.climateOpportunitiesIdentified),
            'climate:ImpactOnBusinessShortTerm': report.strategy.impactOnBusiness.shortTerm,
            'climate:ImpactOnBusinessMediumTerm': report.strategy.impactOnBusiness.mediumTerm,
            'climate:ImpactOnBusinessLongTerm': report.strategy.impactOnBusiness.longTerm,
            
            // Metrics
            'climate:Scope1Emissions': report.metricsTargets.ghgEmissions.scope1,
            'climate:Scope2LocationBasedEmissions': report.metricsTargets.ghgEmissions.scope2LocationBased,
            'climate:Scope2MarketBasedEmissions': report.metricsTargets.ghgEmissions.scope2MarketBased,
            'climate:TotalScope12Emissions': report.metricsTargets.ghgEmissions.totalScope12,
            'climate:Scope3Emissions': report.metricsTargets.ghgEmissions.scope3?.total || null,
            'climate:TotalScope123Emissions': report.metricsTargets.ghgEmissions.totalScope123 || null,
            'climate:GHGMethodology': report.metricsTargets.ghgEmissions.methodology,
            'climate:VerificationStatus': report.metricsTargets.ghgEmissions.verificationStatus,
            
            // Energy
            'climate:TotalEnergyConsumption': report.metricsTargets.energyConsumption.totalEnergyConsumption,
            'climate:RenewableEnergyConsumption': report.metricsTargets.energyConsumption.renewableEnergyConsumption,
            'climate:RenewableEnergyPercentage': report.metricsTargets.energyConsumption.renewablePercentage,
            
            // Targets
            'climate:EmissionReductionTargets': JSON.stringify(report.metricsTargets.targets),
            
            // Carbon credits
            'climate:CarbonCreditsRetired': report.metricsTargets.carbonCredits.creditsRetired,
            'climate:CarbonCreditsPurchased': report.metricsTargets.carbonCredits.creditsPurchased,
            'climate:CarbonCreditsGenerated': report.metricsTargets.carbonCredits.creditsGenerated,
        };

        return tags;
    }

    // Helper methods to fetch data
    private static async getCompanyEmissions(companyId: string, year: number): Promise<any> {
        const { rows } = await query(
            `SELECT * FROM company_emissions WHERE company_id = $1 AND year = $2`,
            [companyId, year]
        );
        return rows[0] || {};
    }

    private static async getCompanyEnergy(companyId: string, year: number): Promise<any> {
        const { rows } = await query(
            `SELECT * FROM company_energy WHERE company_id = $1 AND year = $2`,
            [companyId, year]
        );
        return rows[0] || {};
    }

    private static async getCompanyTargets(companyId: string): Promise<EmissionTarget[]> {
        const { rows } = await query(
            `SELECT * FROM emission_targets WHERE company_id = $1 ORDER BY target_year`,
            [companyId]
        );
        return rows.map(r => ({
            targetId: r.target_id,
            scope: r.scope,
            targetType: r.target_type,
            baseYear: r.base_year,
            targetYear: r.target_year,
            baseYearEmissions: parseFloat(r.base_year_emissions),
            targetEmissions: parseFloat(r.target_emissions),
            reductionPercentage: parseFloat(r.reduction_percentage),
            status: r.status,
            methodology: r.methodology,
        }));
    }

    private static async getCompanyCarbonCredits(companyId: string, year: number): Promise<any> {
        const { rows } = await query(
            `SELECT * FROM company_carbon_credits WHERE company_id = $1 AND year = $2`,
            [companyId, year]
        );
        return rows[0] || {};
    }

    private static async getGovernanceDisclosure(companyId: string): Promise<GovernanceDisclosure> {
        const { rows } = await query(
            `SELECT * FROM climate_governance WHERE company_id = $1`,
            [companyId]
        );
        return rows[0] || {
            boardOversight: { description: '', committeeResponsible: '', meetingFrequency: '', expertise: [] },
            managementRole: { description: '', positionsResponsible: [], reportingFrequency: '' },
        };
    }

    private static async getStrategyDisclosure(companyId: string, year: number): Promise<StrategyDisclosure> {
        const { rows } = await query(
            `SELECT * FROM climate_strategy WHERE company_id = $1 AND year = $2`,
            [companyId, year]
        );
        return rows[0] || {
            climateRisksIdentified: [],
            climateOpportunitiesIdentified: [],
            impactOnBusiness: { shortTerm: '', mediumTerm: '', longTerm: '' },
            impactOnStrategy: '',
            impactOnFinancialPlanning: '',
        };
    }

    private static async getRiskManagementDisclosure(companyId: string): Promise<RiskManagementDisclosure> {
        const { rows } = await query(
            `SELECT * FROM climate_risk_management WHERE company_id = $1`,
            [companyId]
        );
        return rows[0] || {
            identificationProcess: '',
            assessmentProcess: '',
            integrationIntoOverallRisk: '',
            riskManagementTools: [],
        };
    }
}

export default SECClimateEngine;