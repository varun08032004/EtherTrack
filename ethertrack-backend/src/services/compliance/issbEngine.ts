// ISSB S2 Climate-related Disclosures Engine
// Implements IFRS S2 Climate-related Disclosures (effective Jan 2024)
// Based on TCFD recommendations and ISSB standards

import { safeQuery as query, withTransaction } from '../../db/pool.js';

export interface ISSBS2Report {
    reportId: string;
    entityId: string;
    reportingPeriod: { start: string; end: string };
    governance: ISSBGovernance;
    strategy: ISSBStrategy;
    riskManagement: ISSBRiskManagement;
    metricsTargets: ISSBMetricsTargets;
    status: 'DRAFT' | 'REVIEW' | 'APPROVED' | 'PUBLISHED';
    approvedAt?: string;
    publishedAt?: string;
    createdAt: string;
    updatedAt: string;
}

export interface ISSBGovernance {
    governanceBody: {
        bodyName: string;
        composition: string[];
        expertise: string[];
        meetingFrequency: string;
        climateResponsibilities: string[];
    };
    managementRole: {
        positions: string[];
        responsibilities: string[];
        reportingLine: string;
        frequency: string;
    };
    integrationWithOverallGovernance: string;
}

export interface ISSBStrategy {
    climateRelatedRisks: ISSBClimateRisk[];
    climateRelatedOpportunities: ISSBClimateOpportunity[];
    businessModelImpacts: {
        valueChain: string;
        productsServices: string;
        markets: string;
        supplyChain: string;
        adaptation: string;
    };
    strategyImpacts: {
        shortTerm: string; // < 1 year
        mediumTerm: string; // 1-5 years
        longTerm: string; // > 5 years
    };
    financialPositionImpacts: {
        assets: string;
        liabilities: string;
        equity: string;
        revenue: string;
        expenses: string;
    };
    financialPerformanceImpacts: {
        revenue: string;
        costs: string;
        profitability: string;
        cashFlows: string;
    };
    financialPlanningImpacts: {
        capitalAllocation: string;
        capitalExpenditure: string;
        acquisitions: string;
        divestments: string;
    };
    climateResilience: ClimateResilienceAssessment;
    transitionPlan: ISSBTransitionPlan;
}

export interface ISSBClimateRisk {
    riskId: string;
    category: 'PHYSICAL_ACUTE' | 'PHYSICAL_CHRONIC' | 'TRANSITION_POLICY' | 'TRANSITION_LEGAL' | 'TRANSITION_TECHNOLOGY' | 'TRANSITION_MARKET' | 'TRANSITION_REPUTATION';
    description: string;
    timeHorizon: 'SHORT' | 'MEDIUM' | 'LONG';
    likelihood: 'VIRTUALLY_CERTAIN' | 'VERY_LIKELY' | 'LIKELY' | 'ABOUT_AS_LIKELY_AS_NOT' | 'UNLIKELY' | 'VERY_UNLIKELY' | 'EXCEPTIONALLY_UNLIKELY';
    magnitude: 'HIGH' | 'MEDIUM' | 'LOW';
    financialImpact?: {
        quantitative?: {
            amountMin: number;
            amountMax: number;
            currency: string;
            metric: string;
        };
        qualitative?: string;
    };
    concentration?: {
        geography?: string;
        sector?: string;
        assetClass?: string;
    };
}

export interface ISSBClimateOpportunity {
    opportunityId: string;
    category: 'RESOURCE_EFFICIENCY' | 'ENERGY_SOURCE' | 'PRODUCTS_SERVICES' | 'MARKETS' | 'RESILIENCE';
    description: string;
    timeHorizon: 'SHORT' | 'MEDIUM' | 'LONG';
    likelihood: 'VIRTUALLY_CERTAIN' | 'VERY_LIKELY' | 'LIKELY' | 'ABOUT_AS_LIKELY_AS_NOT' | 'UNLIKELY' | 'VERY_UNLIKELY' | 'EXCEPTIONALLY_UNLIKELY';
    magnitude: 'HIGH' | 'MEDIUM' | 'LOW';
    financialImpact?: {
        quantitative?: {
            amountMin: number;
            amountMax: number;
            currency: string;
            metric: string;
        };
        qualitative?: string;
    };
}

export interface ClimateResilienceAssessment {
    assessmentMethod: string;
    scenariosUsed: ClimateScenario[];
    timeHorizons: number[];
    keyAssumptions: Record<string, string>;
    results: {
        strategyResilience: string;
        businessModelResilience: string;
        financialResilience: string;
    };
    capacityToAdjust: string;
}

export interface ClimateScenario {
    scenarioId: string;
    name: string;
    provider: 'IPCC' | 'IEA' | 'NGFS' | 'TCFD' | 'CUSTOM' | 'ISSB';
    temperatureAlignment: string; // e.g., "1.5°C with no or limited overshoot"
    transitionRiskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
    physicalRiskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
    description: string;
}

export interface ISSBTransitionPlan {
    targets: ISSBEmissionTarget[];
    actions: ISSBTransitionAction[];
    governance: string;
    capitalAllocation: {
        totalCapex: number;
        totalOpex: number;
        currency: string;
        allocationByActivity: Record<string, number>;
    };
    internalCarbonPrice?: ISSBInternalCarbonPrice;
    progress: {
        targetsOnTrack: number;
        targetsAtRisk: number;
        targetsMissed: number;
    };
}

export interface ISSBEmissionTarget {
    targetId: string;
    scope: 'SCOPE_1' | 'SCOPE_2' | 'SCOPE_3' | 'SCOPE_1_2' | 'SCOPE_1_2_3';
    targetType: 'ABSOLUTE' | 'INTENSITY' | 'NET_ZERO' | 'SCIENCE_BASED';
    baseYear: number;
    targetYear: number;
    baseYearEmissions: number;
    targetEmissions: number;
    reductionPercentage: number;
    coverage: string; // % of emissions covered
    methodology: string;
    verificationStatus: 'UNVERIFIED' | 'LIMITED_ASSURANCE' | 'REASONABLE_ASSURANCE' | 'THIRD_PARTY_VERIFIED';
    scienceBasedTarget: boolean;
    netZeroTarget: boolean;
    interimTargets: Array<{
        year: number;
        targetEmissions: number;
    }>;
}

export interface ISSBTransitionAction {
    actionId: string;
    description: string;
    category: 'ENERGY_EFFICIENCY' | 'RENEWABLE_ENERGY' | 'FUEL_SWITCHING' | 'ELECTRIFICATION' | 'CCS' | 'NATURE_BASED' | 'PRODUCT_INNOVATION' | 'SUPPLY_CHAIN' | 'OTHER';
    estimatedAnnualReduction: number; // tCO2e/year
    estimatedCumulativeReduction: number; // tCO2e
    estimatedCost: number;
    currency: string;
    startYear: number;
    endYear: number;
    status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
    dependencies: string[];
    metrics: string[];
}

export interface ISSBInternalCarbonPrice {
    price: number;
    currency: string;
    scope: string;
    type: 'SHADOW' | 'INTERNAL_FEE' | 'IMPLICIT' | 'TRADING';
    application: string;
    methodology: string;
}

export interface ISSBRiskManagement {
    identificationProcesses: {
        processes: string[];
        dataSources: string[];
        tools: string[];
        frequency: string;
    };
    assessmentProcesses: {
        processes: string[];
        criteria: string[];
        scenarioAnalysis: boolean;
        frequency: string;
    };
    managementProcesses: {
        processes: string[];
        integrationWithOverallRisk: string;
        prioritizationCriteria: string[];
    };
    monitoringProcesses: {
        kpis: string[];
        frequency: string;
        reporting: string;
    };
}

export interface ISSBMetricsTargets {
    crossIndustryMetrics: ISSBCrossIndustryMetrics;
    industryBasedMetrics: ISSBIndustryBasedMetrics;
    targets: ISSBEmissionTarget[];
    carbonCredits: ISSBCarbonCredits;
    otherMetrics: ISSBOtherMetric[];
}

export interface ISSBCrossIndustryMetrics {
    // GHG Emissions (required)
    grossScope1: number;
    grossScope2LocationBased: number;
    grossScope2MarketBased: number;
    grossScope3?: {
        total: number;
        categories: Record<string, number>;
        categoriesReported: string[];
    };
    
    // GHG Emissions Intensity (required)
    scope12Intensity?: {
        value: number;
        unit: string;
        denominator: string;
    };
    scope123Intensity?: {
        value: number;
        unit: string;
        denominator: string;
    };
    
    // Transition Risks (required)
    transitionRisks?: {
        exposureToFossilFuelAssets: number; // %
        exposureToCarbonIntensiveAssets: number; // %
        revenueFromCarbonIntensiveActivities: number; // %
        capexToCarbonIntensiveActivities: number; // %
    };
    
    // Physical Risks (required)
    physicalRisks?: {
        assetsInHighPhysicalRiskAreas: number; // %
        revenueFromHighPhysicalRiskAreas: number; // %
    };
    
    // Climate-Related Opportunities (required)
    climateOpportunities?: {
        revenueFromLowCarbonProducts: number; // %
        capexToLowCarbonActivities: number; // %
    };
    
    // Capital Deployment (required)
    capitalDeployment?: {
        capexAlignedWithTransition: number; // %
        capexToClimateSolutions: number; // %
    };
    
    // Internal Carbon Price (if applicable)
    internalCarbonPrices?: ISSBInternalCarbonPrice[];
    
    // Remuneration (required)
    remuneration?: {
        executiveRemunerationLinkedToClimate: boolean;
        percentageOfRemuneration: number;
        metricsUsed: string[];
    };
}

export interface ISSBIndustryBasedMetrics {
    industry: string; // SAICS/NAICS code
    metrics: Record<string, {
        value: number;
        unit: string;
        description: string;
    }>;
}

export interface ISSBCarbonCredits {
    creditsUsedForOffsets: {
        quantity: number; // tCO2e
        vintageRange: { start: number; end: number };
        registries: string[];
        projectTypes: string[];
        qualityCriteria: string;
    };
    creditsGenerated: {
        quantity: number; // tCO2e
        projectIds: string[];
    };
    creditsRetired: {
        quantity: number; // tCO2e
        purpose: string[];
    };
    creditsCancelled: {
        quantity: number; // tCO2e
        reason: string;
    };
}

export interface ISSBOtherMetric {
    metricId: string;
    name: string;
    value: number;
    unit: string;
    description: string;
    methodology: string;
}

export class ISSBengine {
    /**
     * Generate ISSB S2 Climate-related Disclosures report
     */
    static async generateReport(entityId: string, reportingPeriod: { start: string; end: string }): Promise<ISSBS2Report> {
        const { rows: entity } = await query(
            `SELECT * FROM entities WHERE entity_id = $1`,
            [entityId]
        );

        if (!entity.length) {
            throw new Error('Entity not found');
        }

        // Fetch all required data
        const emissions = await this.getEntityEmissions(entityId, reportingPeriod);
        const energy = await this.getEntityEnergy(entityId, reportingPeriod);
        const targets = await this.getEntityTargets(entityId);
        const risks = await this.getEntityRisks(entityId);
        const opportunities = await this.getEntityOpportunities(entityId);
        const carbonCredits = await this.getEntityCarbonCredits(entityId, reportingPeriod);
        const transitionPlan = await this.getEntityTransitionPlan(entityId);
        const remuneration = await this.getEntityRemuneration(entityId);
        const capitalDeployment = await this.getEntityCapitalDeployment(entityId, reportingPeriod);

        const report: ISSBS2Report = {
            reportId: `ISSB-S2-${entityId}-${reportingPeriod.start.split('-')[0]}-${Date.now()}`,
            entityId,
            reportingPeriod,
            governance: await this.getGovernance(entityId),
            strategy: {
                climateRelatedRisks: risks,
                climateRelatedOpportunities: opportunities,
                businessModelImpacts: await this.getBusinessModelImpacts(entityId),
                strategyImpacts: await this.getStrategyImpacts(entityId),
                financialPositionImpacts: await this.getFinancialPositionImpacts(entityId),
                financialPerformanceImpacts: await this.getFinancialPerformanceImpacts(entityId),
                financialPlanningImpacts: await this.getFinancialPlanningImpacts(entityId),
                climateResilience: await this.getClimateResilience(entityId),
                transitionPlan,
            },
            riskManagement: await this.getRiskManagement(entityId),
            metricsTargets: {
                crossIndustryMetrics: this.buildCrossIndustryMetrics(emissions, energy, risks, opportunities, capitalDeployment, remuneration, carbonCredits),
                industryBasedMetrics: await this.getIndustryBasedMetrics(entityId),
                targets,
                carbonCredits: this.buildCarbonCredits(carbonCredits),
                otherMetrics: await this.getOtherMetrics(entityId, reportingPeriod),
            },
            status: 'DRAFT',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        // Save report
        await query(
            `INSERT INTO issb_s2_reports 
             (report_id, entity_id, reporting_period_start, reporting_period_end, governance, strategy, risk_management, metrics_targets, status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', NOW(), NOW())
             RETURNING report_id`,
            [
                report.reportId, entityId, reportingPeriod.start, reportingPeriod.end,
                JSON.stringify(report.governance),
                JSON.stringify(report.strategy),
                JSON.stringify(report.riskManagement),
                JSON.stringify(report.metricsTargets),
            ]
        );

        return report;
    }

    /**
     * Build cross-industry metrics per ISSB S2 Appendix B
     */
    private buildCrossIndustryMetrics(
        emissions: any,
        energy: any,
        risks: ISSBClimateRisk[],
        opportunities: ISSBClimateOpportunity[],
        capitalDeployment: any,
        remuneration: any,
        carbonCredits: any
    ): ISSBCrossIndustryMetrics {
        const scope1 = emissions.scope1 || 0;
        const scope2LocationBased = emissions.scope2LocationBased || 0;
        const scope2MarketBased = emissions.scope2MarketBased || scope2LocationBased;
        const scope3 = emissions.scope3 || null;

        return {
            // GHG Emissions
            grossScope1: scope1,
            grossScope2LocationBased: scope2LocationBased,
            grossScope2MarketBased: scope2MarketBased,
            grossScope3: scope3 ? {
                total: scope3.total,
                categories: scope3.categories || {},
                categoriesReported: scope3.categoriesReported || [],
            } : undefined,

            // GHG Emissions Intensity
            scope12Intensity: emissions.intensity ? {
                value: emissions.intensity.scope12,
                unit: 'tCO2e/unit',
                denominator: emissions.intensity.denominator,
            } : undefined,
            scope123Intensity: emissions.intensity ? {
                value: emissions.intensity.scope123,
                unit: 'tCO2e/unit',
                denominator: emissions.intensity.denominator,
            } : undefined,

            // Transition Risks
            transitionRisks: capitalDeployment ? {
                exposureToFossilFuelAssets: capitalDeployment.fossilFuelExposure || 0,
                exposureToCarbonIntensiveAssets: capitalDeployment.carbonIntensiveExposure || 0,
                revenueFromCarbonIntensiveActivities: capitalDeployment.revenueCarbonIntensive || 0,
                capexToCarbonIntensiveActivities: capitalDeployment.capexCarbonIntensive || 0,
            } : undefined,

            // Physical Risks
            physicalRisks: risks.length > 0 ? {
                assetsInHighPhysicalRiskAreas: this.calculatePhysicalRiskExposure(risks, 'asset'),
                revenueFromHighPhysicalRiskAreas: this.calculatePhysicalRiskExposure(risks, 'revenue'),
            } : undefined,

            // Climate Opportunities
            climateOpportunities: capitalDeployment ? {
                revenueFromLowCarbonProducts: capitalDeployment.revenueLowCarbon || 0,
                capexToLowCarbonActivities: capitalDeployment.capexLowCarbon || 0,
            } : undefined,

            // Capital Deployment
            capitalDeployment: capitalDeployment ? {
                capexAlignedWithTransition: capitalDeployment.capexAligned || 0,
                capexToClimateSolutions: capitalDeployment.capexClimateSolutions || 0,
            } : undefined,

            // Remuneration
            remuneration: remuneration ? {
                executiveRemunerationLinkedToClimate: remuneration.linked || false,
                percentageOfRemuneration: remuneration.percentage || 0,
                metricsUsed: remuneration.metrics || [],
            } : undefined,
        };
    }

    private calculatePhysicalRiskExposure(risks: ISSBClimateRisk[], type: 'asset' | 'revenue'): number {
        const physicalRisks = risks.filter(r => r.category.startsWith('PHYSICAL_'));
        if (physicalRisks.length === 0) return 0;
        
        // Simplified calculation - would be more sophisticated in production
        const highRisks = physicalRisks.filter(r => r.magnitude === 'HIGH').length;
        return (highRisks / physicalRisks.length) * 100;
    }

    private buildCarbonCredits(credits: any): ISSBCarbonCredits {
        return {
            creditsUsedForOffsets: {
                quantity: credits.usedForOffsets || 0,
                vintageRange: credits.vintageRange || { start: 0, end: 0 },
                registries: credits.registries || [],
                projectTypes: credits.projectTypes || [],
                qualityCriteria: credits.qualityCriteria || 'ICVCM Core Carbon Principles',
            },
            creditsGenerated: {
                quantity: credits.generated || 0,
                projectIds: credits.projectIds || [],
            },
            creditsRetired: {
                quantity: credits.retired || 0,
                purpose: credits.purpose || ['Offsetting'],
            },
            creditsCancelled: {
                quantity: credits.cancelled || 0,
                reason: credits.cancellationReason || '',
            },
        };
    }

    /**
     * Validate ISSB S2 report
     */
    static async validateReport(reportId: string): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
        const { rows } = await query(
            `SELECT * FROM issb_s2_reports WHERE report_id = $1`,
            [reportId]
        );

        if (!rows.length) return { valid: false, errors: ['Report not found'], warnings: [] };

        const report = rows[0];
        const errors: string[] = [];
        const warnings: string[] = [];

        // Required per ISSB S2
        if (!report.governance?.governanceBody?.climateResponsibilities?.length) {
            errors.push('Governance: Climate responsibilities of governance body required');
        }

        if (!report.strategy?.climateRelatedRisks?.length && !report.strategy?.climateRelatedOpportunities?.length) {
            warnings.push('Strategy: No climate risks or opportunities disclosed');
        }

        if (!report.strategy?.climateResilience) {
            errors.push('Strategy: Climate resilience assessment required');
        }

        if (!report.strategy?.transitionPlan) {
            warnings.push('Strategy: Transition plan not disclosed (expected for entities with material risks)');
        }

        // Metrics - required cross-industry metrics
        const metrics = report.metricsTargets?.crossIndustryMetrics;
        if (!metrics) {
            errors.push('Metrics: Cross-industry metrics required');
        } else {
            if (metrics.grossScope1 === undefined || metrics.grossScope2MarketBased === undefined) {
                errors.push('Metrics: Gross Scope 1 and Scope 2 (market-based) required');
            }
            if (!metrics.grossScope3 && this.hasMaterialScope3(report)) {
                warnings.push('Metrics: Scope 3 not disclosed (required if material)');
            }
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    private hasMaterialScope3(report: ISSBS2Report): boolean {
        // Simplified - in production would assess materiality
        return true;
    }

    /**
     * Generate ISSB S2 compliant XBRL tags
     */
    static generateXBRLTags(report: ISSBS2Report): Record<string, any> {
        const tags: Record<string, any> = {
            'ifrs-s2:EntityName': report.entityId,
            'ifrs-s2:ReportingPeriodStart': report.reportingPeriod.start,
            'ifrs-s2:ReportingPeriodEnd': report.reportingPeriod.end,
            
            // Governance
            'ifrs-s2:GovernanceBodyName': report.governance.governanceBody.bodyName,
            'ifrs-s2:GovernanceBodyComposition': JSON.stringify(report.governance.governanceBody.composition),
            'ifrs-s2:GovernanceBodyExpertise': JSON.stringify(report.governance.governanceBody.expertise),
            'ifrs-s2:GovernanceBodyClimateResponsibilities': JSON.stringify(report.governance.governanceBody.climateResponsibilities),
            
            // Strategy
            'ifrs-s2:ClimateRelatedRisks': JSON.stringify(report.strategy.climateRelatedRisks),
            'ifrs-s2:ClimateRelatedOpportunities': JSON.stringify(report.strategy.climateRelatedOpportunities),
            'ifrs-s2:BusinessModelImpacts': JSON.stringify(report.strategy.businessModelImpacts),
            'ifrs-s2:StrategyImpacts': JSON.stringify(report.strategy.strategyImpacts),
            'ifrs-s2:FinancialPositionImpacts': JSON.stringify(report.strategy.financialPositionImpacts),
            'ifrs-s2:FinancialPerformanceImpacts': JSON.stringify(report.strategy.financialPerformanceImpacts),
            'ifrs-s2:FinancialPlanningImpacts': JSON.stringify(report.strategy.financialPlanningImpacts),
            'ifrs-s2:ClimateResilienceAssessment': JSON.stringify(report.strategy.climateResilience),
            'ifrs-s2:TransitionPlan': JSON.stringify(report.strategy.transitionPlan),
            
            // Risk Management
            'ifrs-s2:RiskIdentificationProcesses': JSON.stringify(report.riskManagement.identificationProcesses),
            'ifrs-s2:RiskAssessmentProcesses': JSON.stringify(report.riskManagement.assessmentProcesses),
            'ifrs-s2:RiskManagementProcesses': JSON.stringify(report.riskManagement.managementProcesses),
            'ifrs-s2:RiskMonitoringProcesses': JSON.stringify(report.riskManagement.monitoringProcesses),
            
            // Metrics & Targets
            'ifrs-s2:GrossScope1Emissions': report.metricsTargets.crossIndustryMetrics.grossScope1,
            'ifrs-s2:GrossScope2LocationBasedEmissions': report.metricsTargets.crossIndustryMetrics.grossScope2LocationBased,
            'ifrs-s2:GrossScope2MarketBasedEmissions': report.metricsTargets.crossIndustryMetrics.grossScope2MarketBased,
            'ifrs-s2:GrossScope3Emissions': report.metricsTargets.crossIndustryMetrics.grossScope3?.total || null,
            'ifrs-s2:Scope12EmissionsIntensity': report.metricsTargets.crossIndustryMetrics.scope12Intensity?.value || null,
            'ifrs-s2:Scope123EmissionsIntensity': report.metricsTargets.crossIndustryMetrics.scope123Intensity?.value || null,
            'ifrs-s2:EmissionReductionTargets': JSON.stringify(report.metricsTargets.targets),
            'ifrs-s2:CarbonCreditsUsed': JSON.stringify(report.metricsTargets.carbonCredits),
        };

        return tags;
    }

    // Helper methods
    private static async getEntityEmissions(entityId: string, period: { start: string; end: string }): Promise<any> {
        const { rows } = await query(
            `SELECT * FROM entity_emissions WHERE entity_id = $1 AND period_start = $2 AND period_end = $3`,
            [entityId, period.start, period.end]
        );
        return rows[0] || {};
    }

    private static async getEntityEnergy(entityId: string, period: { start: string; end: string }): Promise<any> {
        const { rows } = await query(
            `SELECT * FROM entity_energy WHERE entity_id = $1 AND period_start = $2 AND period_end = $3`,
            [entityId, period.start, period.end]
        );
        return rows[0] || {};
    }

    private static async getEntityTargets(entityId: string): Promise<ISSBEmissionTarget[]> {
        const { rows } = await query(
            `SELECT * FROM entity_emission_targets WHERE entity_id = $1 ORDER BY target_year`,
            [entityId]
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
            coverage: r.coverage,
            methodology: r.methodology,
            verificationStatus: r.verification_status,
            scienceBasedTarget: r.science_based_target,
            netZeroTarget: r.net_zero_target,
            interimTargets: r.interim_targets ? JSON.parse(r.interim_targets) : [],
        }));
    }

    private static async getEntityRisks(entityId: string): Promise<ISSBClimateRisk[]> {
        const { rows } = await query(
            `SELECT * FROM entity_climate_risks WHERE entity_id = $1`,
            [entityId]
        );
        return rows.map(r => ({
            riskId: r.risk_id,
            category: r.category,
            description: r.description,
            timeHorizon: r.time_horizon,
            likelihood: r.likelihood,
            magnitude: r.magnitude,
            financialImpact: r.financial_impact ? JSON.parse(r.financial_impact) : undefined,
            concentration: r.concentration ? JSON.parse(r.concentration) : undefined,
        }));
    }

    private static async getEntityOpportunities(entityId: string): Promise<ISSBClimateOpportunity[]> {
        const { rows } = await query(
            `SELECT * FROM entity_climate_opportunities WHERE entity_id = $1`,
            [entityId]
        );
        return rows.map(r => ({
            opportunityId: r.opportunity_id,
            category: r.category,
            description: r.description,
            timeHorizon: r.time_horizon,
            likelihood: r.likelihood,
            magnitude: r.magnitude,
            financialImpact: r.financial_impact ? JSON.parse(r.financial_impact) : undefined,
        }));
    }

    private static async getEntityCarbonCredits(entityId: string, period: { start: string; end: string }): Promise<any> {
        const { rows } = await query(
            `SELECT * FROM entity_carbon_credits WHERE entity_id = $1 AND period_start = $2 AND period_end = $3`,
            [entityId, period.start, period.end]
        );
        return rows[0] || {};
    }

    private static async getEntityTransitionPlan(entityId: string): Promise<ISSBTransitionPlan> {
        const { rows } = await query(
            `SELECT * FROM entity_transition_plans WHERE entity_id = $1`,
            [entityId]
        );
        return rows[0] || {
            targets: [],
            actions: [],
            governance: '',
            capitalAllocation: { totalCapex: 0, totalOpex: 0, currency: 'USD', allocationByActivity: {} },
            progress: { targetsOnTrack: 0, targetsAtRisk: 0, targetsMissed: 0 },
        };
    }

    private static async getEntityRemuneration(entityId: string): Promise<any> {
        const { rows } = await query(
            `SELECT * FROM entity_remuneration WHERE entity_id = $1`,
            [entityId]
        );
        return rows[0] || null;
    }

    private static async getEntityCapitalDeployment(entityId: string, period: { start: string; end: string }): Promise<any> {
        const { rows } = await query(
            `SELECT * FROM entity_capital_deployment WHERE entity_id = $1 AND period_start = $2 AND period_end = $3`,
            [entityId, period.start, period.end]
        );
        return rows[0] || null;
    }

    private static async getGovernance(entityId: string): Promise<ISSBGovernance> {
        const { rows } = await query(
            `SELECT * FROM entity_governance WHERE entity_id = $1`,
            [entityId]
        );
        return rows[0] || {
            governanceBody: { bodyName: '', composition: [], expertise: [], meetingFrequency: '', climateResponsibilities: [] },
            managementRole: { positions: [], responsibilities: [], reportingLine: '', frequency: '' },
            integrationWithOverallGovernance: '',
        };
    }

    private static async getBusinessModelImpacts(entityId: string): Promise<any> {
        const { rows } = await query(
            `SELECT * FROM entity_business_model_impacts WHERE entity_id = $1`,
            [entityId]
        );
        return rows[0] || {};
    }

    private static async getStrategyImpacts(entityId: string): Promise<any> {
        const { rows } = await query(
            `SELECT * FROM entity_strategy_impacts WHERE entity_id = $1`,
            [entityId]
        );
        return rows[0] || {};
    }

    private static async getFinancialPositionImpacts(entityId: string): Promise<any> {
        const { rows } = await query(
            `SELECT * FROM entity_financial_position WHERE entity_id = $1`,
            [entityId]
        );
        return rows[0] || {};
    }

    private static async getFinancialPerformanceImpacts(entityId: string): Promise<any> {
        const { rows } = await query(
            `SELECT * FROM entity_financial_performance WHERE entity_id = $1`,
            [entityId]
        );
        return rows[0] || {};
    }

    private static async getFinancialPlanningImpacts(entityId: string): Promise<any> {
        const { rows } = await query(
            `SELECT * FROM entity_financial_planning WHERE entity_id = $1`,
            [entityId]
        );
        return rows[0] || {};
    }

    private static async getClimateResilience(entityId: string): Promise<ClimateResilienceAssessment> {
        const { rows } = await query(
            `SELECT * FROM entity_climate_resilience WHERE entity_id = $1`,
            [entityId]
        );
        return rows[0] || {
            assessmentMethod: '',
            scenariosUsed: [],
            timeHorizons: [],
            keyAssumptions: {},
            results: { strategyResilience: '', businessModelResilience: '', financialResilience: '' },
            capacityToAdjust: '',
        };
    }

    private static async getRiskManagement(entityId: string): Promise<ISSBRiskManagement> {
        const { rows } = await query(
            `SELECT * FROM entity_risk_management WHERE entity_id = $1`,
            [entityId]
        );
        return rows[0] || {
            identificationProcesses: { processes: [], dataSources: [], tools: [], frequency: '' },
            assessmentProcesses: { processes: [], criteria: [], scenarioAnalysis: false, frequency: '' },
            managementProcesses: { processes: [], integrationWithOverallRisk: '', prioritizationCriteria: [] },
            monitoringProcesses: { kpis: [], frequency: '', reporting: '' },
        };
    }

    private static async getIndustryBasedMetrics(entityId: string): Promise<ISSBIndustryBasedMetrics> {
        const { rows } = await query(
            `SELECT * FROM entity_industry_metrics WHERE entity_id = $1`,
            [entityId]
        );
        return rows[0] || { industry: '', metrics: {} };
    }

    private static async getOtherMetrics(entityId: string, period: { start: string; end: string }): Promise<ISSBOtherMetric[]> {
        const { rows } = await query(
            `SELECT * FROM entity_other_metrics WHERE entity_id = $1 AND period_start = $2 AND period_end = $3`,
            [entityId, period.start, period.end]
        );
        return rows.map(r => ({
            metricId: r.metric_id,
            name: r.name,
            value: parseFloat(r.value),
            unit: r.unit,
            description: r.description,
            methodology: r.methodology,
        }));
    }
}

export default ISSBengine;