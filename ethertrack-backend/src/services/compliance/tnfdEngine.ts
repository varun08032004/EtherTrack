// TNFD Engine - Taskforce on Nature-related Financial Disclosures
// Implements TNFD recommendations (v1.0 September 2023)

import { safeQuery as query, withTransaction } from '../../db/pool.js';

export interface TNFDReport {
    reportId: string;
    entityId: string;
    reportingPeriod: { start: string; end: string };
    governance: TNFDGovernance;
    strategy: TNFDStrategy;
    riskImpactManagement: TNFDRiskImpactManagement;
    metricsTargets: TNFDMetricsTargets;
    status: 'DRAFT' | 'REVIEW' | 'APPROVED' | 'PUBLISHED';
    createdAt: string;
    updatedAt: string;
}

export interface TNFDGovernance {
    boardOversight: {
        description: string;
        committeeResponsible: string;
        expertise: string[];
        meetingFrequency: string;
    };
    managementRole: {
        description: string;
        positions: string[];
        reportingFrequency: string;
    };
    integrationWithClimateGovernance: string;
}

export interface TNFDStrategy {
    natureDependencies: NatureDependency[];
    natureImpacts: NatureImpact[];
    natureRisks: NatureRisk[];
    natureOpportunities: NatureOpportunity[];
    businessModelImpacts: {
        valueChain: string;
        productsServices: string;
        markets: string;
    };
    strategyImpacts: {
        shortTerm: string; // < 1 year
        mediumTerm: string; // 1-5 years
        longTerm: string; // > 5 years
    };
    financialPlanningImpacts: {
        capitalAllocation: string;
        operatingExpenditure: string;
    };
    scenarioAnalysis: TNFDScenarioAnalysis;
    transitionPlan: TNFDTransitionPlan;
}

export interface NatureDependency {
    dependencyId: string;
    category: 'PROVISIONING' | 'REGULATING' | 'CULTURAL' | 'SUPPORTING';
    ecosystemService: string; // e.g., "Water supply", "Pollination", "Flood regulation"
    description: string;
    businessProcesses: string[];
    geographicLocations: string[];
    magnitude: 'HIGH' | 'MEDIUM' | 'LOW';
    trend: 'INCREASING' | 'STABLE' | 'DECREASING';
    timeHorizon: 'SHORT' | 'MEDIUM' | 'LONG';
}

export interface NatureImpact {
    impactId: string;
    category: 'LAND_USE_CHANGE' | 'RESOURCE_EXPLOITATION' | 'CLIMATE_CHANGE' | 'POLLUTION' | 'INVASIVE_SPECIES' | 'OTHER';
    driver: string;
    description: string;
    affectedEcosystems: string[];
    geographicLocations: string[];
    magnitude: 'HIGH' | 'MEDIUM' | 'LOW';
    trend: 'INCREASING' | 'STABLE' | 'DECREASING';
    timeHorizon: 'SHORT' | 'MEDIUM' | 'LONG';
}

export interface NatureRisk {
    riskId: string;
    category: 'PHYSICAL' | 'TRANSITION' | 'SYSTEMIC' | 'LITIGATION' | 'REPUTATIONAL';
    subCategory: string;
    description: string;
    dependenciesImpacted: string[]; // dependency IDs
    impactsExacerbated: string[]; // impact IDs
    likelihood: 'VIRTUALLY_CERTAIN' | 'VERY_LIKELY' | 'LIKELY' | 'ABOUT_AS_LIKELY_AS_NOT' | 'UNLIKELY' | 'VERY_UNLIKELY' | 'EXCEPTIONALLY_UNLIKELY';
    magnitude: 'HIGH' | 'MEDIUM' | 'LOW';
    timeHorizon: 'SHORT' | 'MEDIUM' | 'LONG';
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
        valueChainStage?: 'DIRECT_OPERATIONS' | 'UPSTREAM' | 'DOWNSTREAM' | 'FINANCIAL';
    };
}

export interface NatureOpportunity {
    opportunityId: string;
    category: 'RESOURCE_EFFICIENCY' | 'PRODUCT_INNOVATION' | 'MARKET_ACCESS' | 'RESILIENCE' | 'FINANCING' | 'OTHER';
    description: string;
    dependenciesAddressed: string[];
    impactsMitigated: string[];
    likelihood: 'VIRTUALLY_CERTAIN' | 'VERY_LIKELY' | 'LIKELY' | 'ABOUT_AS_LIKELY_AS_NOT' | 'UNLIKELY' | 'VERY_UNLIKELY' | 'EXCEPTIONALLY_UNLIKELY';
    magnitude: 'HIGH' | 'MEDIUM' | 'LOW';
    timeHorizon: 'SHORT' | 'MEDIUM' | 'LONG';
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

export interface TNFDScenarioAnalysis {
    scenarios: TNFDScenario[];
    methodology: string;
    timeHorizons: number[];
    keyAssumptions: Record<string, string>;
    results: {
        natureDependencies: string;
        natureImpacts: string;
        natureRisks: string;
        natureOpportunities: string;
        financialResilience: string;
    };
}

export interface TNFDScenario {
    scenarioId: string;
    name: string;
    provider: 'IPBES' | 'NGFS' | 'CBD' | 'TCFD' | 'CUSTOM' | 'TNFD';
    description: string;
    biodiversityPathway: string; // e.g., "Global Biodiversity Framework 2030 targets met"
    climateAlignment: string; // e.g., "1.5°C", "2°C"
    natureRiskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface TNFDTransitionPlan {
    targets: TNFDTarget[];
    actions: TNFDAction[];
    governance: string;
    capitalAllocation: {
        totalCapex: number;
        totalOpex: number;
        currency: string;
        allocationByAction: Record<string, number>;
    };
    progress: {
        targetsOnTrack: number;
        targetsAtRisk: number;
        targetsMissed: number;
    };
}

export interface TNFDTarget {
    targetId: string;
    category: 'DEPENDENCY_REDUCTION' | 'IMPACT_REDUCTION' | 'RISK_MITIGATION' | 'OPPORTUNITY_REALIZATION' | 'NATURE_POSITIVE' | 'NO_NET_LOSS' | 'NET_GAIN' | 'ECOSYSTEM_RESTORATION';
    description: string;
    scope: 'DIRECT_OPERATIONS' | 'UPSTREAM' | 'DOWNSTREAM' | 'FULL_VALUE_CHAIN';
    baselineYear: number;
    targetYear: number;
    baselineValue: number;
    targetValue: number;
    unit: string;
    methodology: string;
    verificationStatus: 'UNVERIFIED' | 'LIMITED_ASSURANCE' | 'REASONABLE_ASSURANCE' | 'THIRD_PARTY_VERIFIED';
    alignmentWithGBF: boolean; // Global Biodiversity Framework
    alignmentWithSBTN: boolean; // Science Based Targets for Nature
}

export interface TNFDAction {
    actionId: string;
    description: string;
    category: 'AVOID' | 'REDUCE' | 'RESTORE' | 'REGENERATE' | 'TRANSFORM' | 'COMPENSATE' | 'OFFSET';
    estimatedEffectiveness: number; // % reduction/improvement
    estimatedCost: number;
    currency: string;
    startYear: number;
    endYear: number;
    status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
    dependencies: string[];
    metrics: string[];
    geographicScope: string[];
}

export interface TNFDRiskImpactManagement {
    identification: {
        processes: string[];
        dataSources: string[];
        tools: string[];
        frameworks: string[];
        frequency: string;
    };
    assessment: {
        processes: string[];
        criteria: string[];
        scenarioAnalysis: boolean;
        spatialAnalysis: boolean;
        frequency: string;
    };
    management: {
        processes: string[];
        mitigationHierarchy: 'AVOID' | 'REDUCE' | 'RESTORE' | 'OFFSET';
        integrationWithClimateRisk: string;
        prioritizationCriteria: string[];
    };
    monitoring: {
        indicators: TNFDIndicator[];
        frequency: string;
        reporting: string;
    };
}

export interface TNFDIndicator {
    indicatorId: string;
    name: string;
    category: 'STATE_OF_NATURE' | 'PRESSURE_ON_NATURE' | 'RESPONSE' | 'ENABLING_CONDITIONS';
    value: number;
    unit: string;
    trend: 'IMPROVING' | 'STABLE' | 'DETERIORATING';
    baselineYear: number;
    currentYear: number;
    targetYear?: number;
    targetValue?: number;
    methodology: string;
    spatialResolution: string;
    dataSource: string;
    verificationStatus: 'UNVERIFIED' | 'LIMITED_ASSURANCE' | 'REASONABLE_ASSURANCE' | 'THIRD_PARTY_VERIFIED';
}

export interface TNFDMetricsTargets {
    coreGlobalIndicators: TNFDCoreGlobalIndicators;
    coreSectorIndicators: TNFDCoreSectorIndicators;
    additionalIndicators: TNFDIndicator[];
    targets: TNFDTarget[];
}

export interface TNFDCoreGlobalIndicators {
    // State of nature
    ecosystemExtent?: {
        value: number; // hectares
        unit: 'hectares';
        trend: 'IMPROVING' | 'STABLE' | 'DETERIORATING';
        ecosystems: string[];
    };
    ecosystemCondition?: {
        value: number; // index 0-1
        unit: 'index';
        trend: 'IMPROVING' | 'STABLE' | 'DETERIORATING';
        ecosystems: string[];
    };
    speciesExtinctionRisk?: {
        value: number; // %
        unit: 'percentage';
        trend: 'IMPROVING' | 'STABLE' | 'DETERIORATING';
        taxa: string[];
    };
    
    // Pressure on nature
    landUseChange?: {
        value: number; // hectares
        unit: 'hectares/year';
        trend: 'IMPROVING' | 'STABLE' | 'DETERIORATING';
        drivers: string[];
    };
    waterWithdrawal?: {
        value: number; // megalitres
        unit: 'megalitres/year';
        trend: 'IMPROVING' | 'STABLE' | 'DETERIORATING';
        waterStressAreas: number; // % in high stress
    };
    pollution?: {
        nitrogen: number; // tonnes
        phosphorus: number; // tonnes
        pesticides: number; // tonnes
        plastics: number; // tonnes
        unit: 'tonnes/year';
        trend: 'IMPROVING' | 'STABLE' | 'DETERIORATING';
    };
    invasiveSpecies?: {
        value: number; // number of species
        unit: 'count';
        trend: 'IMPROVING' | 'STABLE' | 'DETERIORATING';
    };
    
    // Response
    protectedAreas?: {
        value: number; // %
        unit: 'percentage';
        trend: 'IMPROVING' | 'STABLE' | 'DETERIORATING';
    };
    restorationArea?: {
        value: number; // hectares
        unit: 'hectares';
        trend: 'IMPROVING' | 'STABLE' | 'DETERIORATING';
    };
    sustainableProduction?: {
        value: number; // % of production
        unit: 'percentage';
        trend: 'IMPROVING' | 'STABLE' | 'DETERIORATING';
        certifications: string[];
    };
    
    // Enabling conditions
    natureRelatedInvestments?: {
        value: number;
        currency: string;
        trend: 'IMPROVING' | 'STABLE' | 'DETERIORATING';
    };
    natureRelatedRevenue?: {
        value: number; // %
        unit: 'percentage';
        trend: 'IMPROVING' | 'STABLE' | 'DETERIORATING';
    };
    governance?: {
        boardOversight: boolean;
        policyCommitment: boolean;
        targetsSet: boolean;
    };
}

export interface TNFDCoreSectorIndicators {
    sector: string; // e.g., "Agriculture", "Mining", "Financial Services"
    indicators: TNFDIndicator[];
}

export class TNFDEngine {
    /**
     * Generate TNFD report
     */
    static async generateReport(entityId: string, reportingPeriod: { start: string; end: string }): Promise<TNFDReport> {
        const { rows: entity } = await query(
            `SELECT * FROM entities WHERE entity_id = $1`,
            [entityId]
        );

        if (!entity.length) {
            throw new Error('Entity not found');
        }

        const dependencies = await this.getNatureDependencies(entityId);
        const impacts = await this.getNatureImpacts(entityId);
        const risks = await this.getNatureRisks(entityId);
        const opportunities = await this.getNatureOpportunities(entityId);
        const scenarioAnalysis = await this.getScenarioAnalysis(entityId);
        const transitionPlan = await this.getTransitionPlan(entityId);
        const indicators = await this.getIndicators(entityId, reportingPeriod);
        const targets = await this.getTargets(entityId);

        const report: TNFDReport = {
            reportId: `TNFD-${entityId}-${reportingPeriod.start.split('-')[0]}-${Date.now()}`,
            entityId,
            reportingPeriod,
            governance: await this.getGovernance(entityId),
            strategy: {
                natureDependencies: dependencies,
                natureImpacts: impacts,
                natureRisks: risks,
                natureOpportunities: opportunities,
                businessModelImpacts: await this.getBusinessModelImpacts(entityId),
                strategyImpacts: await this.getStrategyImpacts(entityId),
                financialPlanningImpacts: await this.getFinancialPlanningImpacts(entityId),
                scenarioAnalysis,
                transitionPlan,
            },
            riskImpactManagement: await this.getRiskImpactManagement(entityId),
            metricsTargets: {
                coreGlobalIndicators: this.buildCoreGlobalIndicators(indicators),
                coreSectorIndicators: await this.getCoreSectorIndicators(entityId),
                additionalIndicators: indicators.filter(i => !this.isCoreGlobal(i)),
                targets,
            },
            status: 'DRAFT',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        await query(
            `INSERT INTO tnfd_reports 
             (report_id, entity_id, reporting_period_start, reporting_period_end, governance, strategy, risk_impact_management, metrics_targets, status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', NOW(), NOW())
             RETURNING report_id`,
            [
                report.reportId, entityId, reportingPeriod.start, reportingPeriod.end,
                JSON.stringify(report.governance),
                JSON.stringify(report.strategy),
                JSON.stringify(report.riskImpactManagement),
                JSON.stringify(report.metricsTargets),
            ]
        );

        return report;
    }

    private buildCoreGlobalIndicators(indicators: TNFDIndicator[]): TNFDCoreGlobalIndicators {
        const result: TNFDCoreGlobalIndicators = {};
        
        const indicatorMap = new Map(indicators.map(i => [i.name, i]));
        
        // Map indicators to core global structure
        const mappings: Record<string, keyof TNFDCoreGlobalIndicators> = {
            'Ecosystem extent': 'ecosystemExtent',
            'Ecosystem condition': 'ecosystemCondition',
            'Species extinction risk': 'speciesExtinctionRisk',
            'Land use change': 'landUseChange',
            'Water withdrawal': 'waterWithdrawal',
            'Pollution': 'pollution',
            'Invasive species': 'invasiveSpecies',
            'Protected areas': 'protectedAreas',
            'Restoration area': 'restorationArea',
            'Sustainable production': 'sustainableProduction',
            'Nature-related investments': 'natureRelatedInvestments',
            'Nature-related revenue': 'natureRelatedRevenue',
            'Governance': 'governance',
        };
        
        for (const [name, key] of Object.entries(mappings)) {
            const indicator = indicatorMap.get(name);
            if (indicator) {
                result[key] = this.formatCoreIndicator(indicator, key);
            }
        }
        
        return result;
    }

    private formatCoreIndicator(indicator: TNFDIndicator, type: string): any {
        // Format based on indicator type
        const base = {
            value: indicator.value,
            unit: indicator.unit,
            trend: indicator.trend,
        };
        
        // Add type-specific fields
        switch (type) {
            case 'ecosystemExtent':
                return { ...base, ecosystems: indicator.metadata?.ecosystems || [] };
            case 'ecosystemCondition':
                return { ...base, ecosystems: indicator.metadata?.ecosystems || [] };
            case 'speciesExtinctionRisk':
                return { ...base, taxa: indicator.metadata?.taxa || [] };
            case 'landUseChange':
                return { ...base, drivers: indicator.metadata?.drivers || [] };
            case 'waterWithdrawal':
                return { ...base, waterStressAreas: indicator.metadata?.waterStressAreas || 0 };
            case 'pollution':
                return { 
                    ...base, 
                    nitrogen: indicator.metadata?.nitrogen || 0,
                    phosphorus: indicator.metadata?.phosphorus || 0,
                    pesticides: indicator.metadata?.pesticides || 0,
                    plastics: indicator.metadata?.plastics || 0,
                };
            case 'invasiveSpecies':
                return { ...base };
            case 'protectedAreas':
                return { ...base };
            case 'restorationArea':
                return { ...base };
            case 'sustainableProduction':
                return { ...base, certifications: indicator.metadata?.certifications || [] };
            case 'natureRelatedInvestments':
                return { ...base, currency: indicator.metadata?.currency || 'USD' };
            case 'natureRelatedRevenue':
                return { ...base };
            case 'governance':
                return {
                    boardOversight: indicator.metadata?.boardOversight || false,
                    policyCommitment: indicator.metadata?.policyCommitment || false,
                    targetsSet: indicator.metadata?.targetsSet || false,
                };
            default:
                return base;
        }
    }

    private isCoreGlobal(indicator: TNFDIndicator): boolean {
        const coreNames = [
            'Ecosystem extent', 'Ecosystem condition', 'Species extinction risk',
            'Land use change', 'Water withdrawal', 'Pollution', 'Invasive species',
            'Protected areas', 'Restoration area', 'Sustainable production',
            'Nature-related investments', 'Nature-related revenue', 'Governance'
        ];
        return coreNames.includes(indicator.name);
    }

    /**
     * Validate TNFD report
     */
    static async validateReport(reportId: string): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
        const { rows } = await query(
            `SELECT * FROM tnfd_reports WHERE report_id = $1`,
            [reportId]
        );

        if (!rows.length) return { valid: false, errors: ['Report not found'], warnings: [] };

        const report = rows[0];
        const errors: string[] = [];
        const warnings: string[] = [];

        // Governance
        if (!report.governance?.boardOversight?.description) {
            errors.push('Governance: Board oversight description required');
        }

        // Strategy - LEAP assessment
        if (!report.strategy?.natureDependencies?.length) {
            warnings.push('Strategy: No nature dependencies identified (LEAP assessment incomplete)');
        }
        if (!report.strategy?.natureImpacts?.length) {
            warnings.push('Strategy: No nature impacts identified (LEAP assessment incomplete)');
        }
        if (!report.strategy?.natureRisks?.length && !report.strategy?.natureOpportunities?.length) {
            warnings.push('Strategy: No nature risks or opportunities identified');
        }
        if (!report.strategy?.scenarioAnalysis) {
            errors.push('Strategy: Scenario analysis required');
        }
        if (!report.strategy?.transitionPlan) {
            warnings.push('Strategy: Transition plan not disclosed');
        }

        // Risk & Impact Management
        if (!report.riskImpactManagement?.identification?.processes?.length) {
            errors.push('Risk Management: Identification processes required');
        }
        if (!report.riskImpactManagement?.assessment?.processes?.length) {
            errors.push('Risk Management: Assessment processes required');
        }

        // Metrics - Core global indicators
        const metrics = report.metricsTargets?.coreGlobalIndicators;
        if (!metrics) {
            errors.push('Metrics: Core global indicators required');
        } else {
            const requiredCore = ['ecosystemExtent', 'ecosystemCondition', 'landUseChange', 'waterWithdrawal'];
            for (const req of requiredCore) {
                if (!metrics[req as keyof TNFDCoreGlobalIndicators]) {
                    warnings.push(`Metrics: Core indicator ${req} not disclosed`);
                }
            }
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    /**
     * LEAP Assessment Helper
     */
    static performLEAPAssessment(entityId: string): {
        locate: string[];
        evaluate: string[];
        assess: string[];
        prepare: string[];
    } {
        // This would be a guided workflow in production
        return {
            locate: [
                'Map direct operations interfaces with nature',
                'Map upstream value chain interfaces',
                'Map downstream value chain interfaces',
                'Identify priority locations using biodiversity importance data',
            ],
            evaluate: [
                'Identify dependencies on ecosystem services at priority locations',
                'Identify impacts on nature at priority locations',
                'Assess current state of nature at priority locations',
            ],
            assess: [
                'Identify nature-related risks from dependencies and impacts',
                'Identify nature-related opportunities',
                'Assess materiality of risks and opportunities',
                'Conduct scenario analysis',
            ],
            prepare: [
                'Define strategy and resource allocation',
                'Set targets',
                'Define metrics and indicators',
                'Prepare disclosures',
            ],
        };
    }

    // Helper methods
    private static async getNatureDependencies(entityId: string): Promise<NatureDependency[]> {
        const { rows } = await query(
            `SELECT * FROM entity_nature_dependencies WHERE entity_id = $1`,
            [entityId]
        );
        return rows.map(r => ({
            dependencyId: r.dependency_id,
            category: r.category,
            ecosystemService: r.ecosystem_service,
            description: r.description,
            businessProcesses: JSON.parse(r.business_processes || '[]'),
            geographicLocations: JSON.parse(r.geographic_locations || '[]'),
            magnitude: r.magnitude,
            trend: r.trend,
            timeHorizon: r.time_horizon,
        }));
    }

    private static async getNatureImpacts(entityId: string): Promise<NatureImpact[]> {
        const { rows } = await query(
            `SELECT * FROM entity_nature_impacts WHERE entity_id = $1`,
            [entityId]
        );
        return rows.map(r => ({
            impactId: r.impact_id,
            category: r.category,
            driver: r.driver,
            description: r.description,
            affectedEcosystems: JSON.parse(r.affected_ecosystems || '[]'),
            geographicLocations: JSON.parse(r.geographic_locations || '[]'),
            magnitude: r.magnitude,
            trend: r.trend,
            timeHorizon: r.time_horizon,
        }));
    }

    private static async getNatureRisks(entityId: string): Promise<NatureRisk[]> {
        const { rows } = await query(
            `SELECT * FROM entity_nature_risks WHERE entity_id = $1`,
            [entityId]
        );
        return rows.map(r => ({
            riskId: r.risk_id,
            category: r.category,
            subCategory: r.sub_category,
            description: r.description,
            dependenciesImpacted: JSON.parse(r.dependencies_impacted || '[]'),
            impactsExacerbated: JSON.parse(r.impacts_exacerbated || '[]'),
            likelihood: r.likelihood,
            magnitude: r.magnitude,
            timeHorizon: r.time_horizon,
            financialImpact: r.financial_impact ? JSON.parse(r.financial_impact) : undefined,
            concentration: r.concentration ? JSON.parse(r.concentration) : undefined,
        }));
    }

    private static async getNatureOpportunities(entityId: string): Promise<NatureOpportunity[]> {
        const { rows } = await query(
            `SELECT * FROM entity_nature_opportunities WHERE entity_id = $1`,
            [entityId]
        );
        return rows.map(r => ({
            opportunityId: r.opportunity_id,
            category: r.category,
            description: r.description,
            dependenciesAddressed: JSON.parse(r.dependencies_addressed || '[]'),
            impactsMitigated: JSON.parse(r.impacts_mitigated || '[]'),
            likelihood: r.likelihood,
            magnitude: r.magnitude,
            timeHorizon: r.time_horizon,
            financialImpact: r.financial_impact ? JSON.parse(r.financial_impact) : undefined,
        }));
    }

    private static async getScenarioAnalysis(entityId: string): Promise<TNFDScenarioAnalysis> {
        const { rows } = await query(
            `SELECT * FROM entity_tnfd_scenarios WHERE entity_id = $1`,
            [entityId]
        );
        return rows[0] || {
            scenarios: [],
            methodology: '',
            timeHorizons: [],
            keyAssumptions: {},
            results: { natureDependencies: '', natureImpacts: '', natureRisks: '', natureOpportunities: '', financialResilience: '' },
        };
    }

    private static async getTransitionPlan(entityId: string): Promise<TNFDTransitionPlan> {
        const { rows } = await query(
            `SELECT * FROM entity_tnfd_transition_plans WHERE entity_id = $1`,
            [entityId]
        );
        return rows[0] || {
            targets: [],
            actions: [],
            governance: '',
            capitalAllocation: { totalCapex: 0, totalOpex: 0, currency: 'USD', allocationByAction: {} },
            progress: { targetsOnTrack: 0, targetsAtRisk: 0, targetsMissed: 0 },
        };
    }

    private static async getIndicators(entityId: string, period: { start: string; end: string }): Promise<TNFDIndicator[]> {
        const { rows } = await query(
            `SELECT * FROM entity_tnfd_indicators WHERE entity_id = $1 AND period_start = $2 AND period_end = $3`,
            [entityId, period.start, period.end]
        );
        return rows.map(r => ({
            indicatorId: r.indicator_id,
            name: r.name,
            category: r.category,
            value: parseFloat(r.value),
            unit: r.unit,
            trend: r.trend,
            baselineYear: r.baseline_year,
            currentYear: r.current_year,
            targetYear: r.target_year,
            targetValue: r.target_value ? parseFloat(r.target_value) : undefined,
            methodology: r.methodology,
            spatialResolution: r.spatial_resolution,
            dataSource: r.data_source,
            verificationStatus: r.verification_status,
            metadata: r.metadata ? JSON.parse(r.metadata) : {},
        }));
    }

    private static async getTargets(entityId: string): Promise<TNFDTarget[]> {
        const { rows } = await query(
            `SELECT * FROM entity_tnfd_targets WHERE entity_id = $1`,
            [entityId]
        );
        return rows.map(r => ({
            targetId: r.target_id,
            category: r.category,
            description: r.description,
            scope: r.scope,
            baselineYear: r.baseline_year,
            targetYear: r.target_year,
            baselineValue: parseFloat(r.baseline_value),
            targetValue: parseFloat(r.target_value),
            unit: r.unit,
            methodology: r.methodology,
            verificationStatus: r.verification_status,
            alignmentWithGBF: r.alignment_with_gbf,
            alignmentWithSBTN: r.alignment_with_sbtn,
        }));
    }

    private static async getGovernance(entityId: string): Promise<TNFDGovernance> {
        const { rows } = await query(
            `SELECT * FROM entity_tnfd_governance WHERE entity_id = $1`,
            [entityId]
        );
        return rows[0] || {
            boardOversight: { description: '', committeeResponsible: '', expertise: [], meetingFrequency: '' },
            managementRole: { description: '', positions: [], reportingFrequency: '' },
            integrationWithClimateGovernance: '',
        };
    }

    private static async getBusinessModelImpacts(entityId: string): Promise<any> {
        const { rows } = await query(
            `SELECT * FROM entity_tnfd_business_model WHERE entity_id = $1`,
            [entityId]
        );
        return rows[0] || {};
    }

    private static async getStrategyImpacts(entityId: string): Promise<any> {
        const { rows } = await query(
            `SELECT * FROM entity_tnfd_strategy_impacts WHERE entity_id = $1`,
            [entityId]
        );
        return rows[0] || {};
    }

    private static async getFinancialPlanningImpacts(entityId: string): Promise<any> {
        const { rows } = await query(
            `SELECT * FROM entity_tnfd_financial_planning WHERE entity_id = $1`,
            [entityId]
        );
        return rows[0] || {};
    }

    private static async getRiskImpactManagement(entityId: string): Promise<TNFDRiskImpactManagement> {
        const { rows } = await query(
            `SELECT * FROM entity_tnfd_risk_management WHERE entity_id = $1`,
            [entityId]
        );
        return rows[0] || {
            identification: { processes: [], dataSources: [], tools: [], frameworks: [], frequency: '' },
            assessment: { processes: [], criteria: [], scenarioAnalysis: false, spatialAnalysis: false, frequency: '' },
            management: { processes: [], mitigationHierarchy: 'AVOID', integrationWithClimateRisk: '', prioritizationCriteria: [] },
            monitoring: { indicators: [], frequency: '', reporting: '' },
        };
    }

    private static async getCoreSectorIndicators(entityId: string): Promise<TNFDCoreSectorIndicators> {
        const { rows } = await query(
            `SELECT * FROM entity_tnfd_sector_indicators WHERE entity_id = $1`,
            [entityId]
        );
        return rows[0] || { sector: '', indicators: [] };
    }
}

export default TNFDEngine;