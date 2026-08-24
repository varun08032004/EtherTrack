// Compliance Engine Index - Multi-Jurisdiction Compliance Platform
// Exports CBAM, SEC Climate, ISSB S2, and TNFD engines

export { CBAMengine, type CBAMReport, type CBAMGood, type CBAMInstallation, type CBAMReportSummary } from './cbamEngine.js';
export { SECClimateEngine, type SECClimateReport, type GovernanceDisclosure, type StrategyDisclosure, type ClimateRisk, type ClimateOpportunity, type TransitionPlan, type EmissionTarget, type TransitionAction, type RiskManagementDisclosure, type MetricsTargetsDisclosure, type GHGEmissionsDisclosure, type Scope3EmissionsDisclosure, type EnergyConsumptionDisclosure, type CarbonCreditsDisclosure, type InternalCarbonPriceDisclosure, type ScenarioAnalysisDisclosure, type ClimateScenario, type ScenarioFinancialImpact } from './secClimateEngine.js';
export { ISSBengine, type ISSBS2Report, type ISSBGovernance, type ISSBStrategy, type ISSBClimateRisk, type ISSBClimateOpportunity, type ClimateResilienceAssessment, type ClimateScenario, type ISSBTransitionPlan, type ISSBEmissionTarget, type ISSBTransitionAction, type ISSBInternalCarbonPrice, type ISSBRiskManagement, type ISSBMetricsTargets, type ISSBCrossIndustryMetrics, type ISSBIndustryBasedMetrics, type ISSBCarbonCredits, type ISSBOtherMetric } from './issbEngine.js';
export { TNFDEngine, type TNFDReport, type TNFDGovernance, type TNFDStrategy, type NatureDependency, type NatureImpact, type NatureRisk, type NatureOpportunity, type TNFDScenarioAnalysis, type TNFDScenario, type TNFDTransitionPlan, type TNFDTarget, type TNFDAction, type TNFDRiskImpactManagement, type TNFDIndicator, type TNFDMetricsTargets, type TNFDCoreGlobalIndicators, type TNFDCoreSectorIndicators } from './tnfdEngine.js';

/**
 * Unified Compliance Engine Factory
 * Creates the appropriate compliance engine based on jurisdiction/standard
 */
export class ComplianceEngineFactory {
    static createEngine(standard: 'CBAM' | 'SEC_CLIMATE' | 'ISSB_S2' | 'TNFD') {
        switch (standard) {
            case 'CBAM':
                return await import('./cbamEngine.js').then(m => m.CBAMengine);
            case 'SEC_CLIMATE':
                return await import('./secClimateEngine.js').then(m => m.SECClimateEngine);
            case 'ISSB_S2':
                return await import('./issbEngine.js').then(m => m.ISSBengine);
            case 'TNFD':
                return await import('./tnfdEngine.js').then(m => m.TNFDEngine);
            default:
                throw new Error(`Unknown compliance standard: ${standard}`);
        }
    }

    static getSupportedStandards(): string[] {
        return ['CBAM', 'SEC_CLIMATE', 'ISSB_S2', 'TNFD'];
    }

    static getStandardInfo(standard: string): {
        name: string;
        jurisdiction: string;
        effectiveDate: string;
        applicability: string;
        keyRequirements: string[];
    } {
        const info: Record<string, any> = {
            'CBAM': {
                name: 'Carbon Border Adjustment Mechanism',
                jurisdiction: 'European Union',
                effectiveDate: '2023-10-01 (transitional), 2026-01-01 (definitive)',
                applicability: 'Importers of cement, iron/steel, aluminium, fertilizers, electricity, hydrogen into EU',
                keyRequirements: [
                    'Quarterly reporting of embedded emissions',
                    'Surrender CBAM certificates',
                    'Verification by accredited verifier',
                    'Carbon price adjustment for non-EU carbon pricing',
                ],
            },
            'SEC_CLIMATE': {
                name: 'SEC Climate-Related Disclosure Rules',
                jurisdiction: 'United States',
                effectiveDate: '2024-03-06 (adopted), phased compliance dates',
                applicability: 'US public companies (accelerated filers, large accelerated filers, etc.)',
                keyRequirements: [
                    'Governance disclosure',
                    'Strategy disclosure (risks/opportunities)',
                    'Risk management disclosure',
                    'Metrics & targets (Scope 1, 2, material Scope 3)',
                    'Scenario analysis (large accelerated filers)',
                    'GHG verification (phased)',
                ],
            },
            'ISSB_S2': {
                name: 'IFRS S2 Climate-related Disclosures',
                jurisdiction: 'Global (ISSB/IFRS Foundation)',
                effectiveDate: '2024-01-01 (voluntary), mandatory per jurisdiction adoption',
                applicability: 'Entities preparing general purpose financial reports',
                keyRequirements: [
                    'Governance',
                    'Strategy (including transition plan)',
                    'Risk management',
                    'Metrics & targets (cross-industry + sector-based)',
                    'Scope 1, 2, 3 emissions',
                    'Scenario analysis',
                    'Industry-based metrics',
                ],
            },
            'TNFD': {
                name: 'Taskforce on Nature-related Financial Disclosures',
                jurisdiction: 'Global (voluntary, becoming regulatory expectation)',
                effectiveDate: '2023-09-01 (v1.0 released)',
                applicability: 'All organizations with nature dependencies/impacts',
                keyRequirements: [
                    'Governance',
                    'Strategy (LEAP assessment)',
                    'Risk & impact management',
                    'Metrics & targets (core global + sector)',
                    'Core global indicators (state, pressure, response, enabling)',
                    'Scenario analysis',
                ],
            },
        };
        return info[standard] || { name: '', jurisdiction: '', effectiveDate: '', applicability: '', keyRequirements: [] };
    }
}

/**
 * Compliance Report Generator
 * Generates unified compliance reports across multiple standards
 */
export class UnifiedComplianceReportGenerator {
    /**
     * Generate compliance reports for all applicable standards for an entity
     */
    static async generateAllReports(entityId: string, period: { start: string; end: string }): Promise<{
        cbam?: any;
        secClimate?: any;
        issbS2?: any;
        tnfd?: any;
        errors: string[];
    }> {
        const results: any = { errors: [] };
        
        // Determine applicable standards based on entity jurisdiction/activities
        const standards = await this.getApplicableStandards(entityId);
        
        for (const standard of standards) {
            try {
                const Engine = await this.createEngine(standard);
                let report;
                
                switch (standard) {
                    case 'CBAM':
                        report = await Engine.generateQuarterlyReport(entityId, 
                            Math.ceil((new Date(period.end).getMonth() + 1) / 3),
                            new Date(period.end).getFullYear()
                        );
                        results.cbam = report;
                        break;
                    case 'SEC_CLIMATE':
                        report = await Engine.generateReport(entityId, new Date(period.end).getFullYear());
                        results.secClimate = report;
                        break;
                    case 'ISSB_S2':
                        report = await Engine.generateReport(entityId, period);
                        results.issbS2 = report;
                        break;
                    case 'TNFD':
                        report = await Engine.generateReport(entityId, period);
                        results.tnfd = report;
                        break;
                }
            } catch (error) {
                results.errors.push(`${standard}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        
        return results;
    }

    private static async getApplicableStandards(entityId: string): Promise<string[]> {
        const { rows } = await query(
            `SELECT jurisdiction, activities FROM entities WHERE entity_id = $1`,
            [entityId]
        );
        
        if (!rows.length) return [];
        
        const entity = rows[0];
        const standards: string[] = [];
        
        // EU importers -> CBAM
        if (entity.jurisdiction === 'EU' || entity.activities?.importsToEU) {
            standards.push('CBAM');
        }
        
        // US public companies -> SEC Climate
        if (entity.jurisdiction === 'US' && entity.isPublicCompany) {
            standards.push('SEC_CLIMATE');
        }
        
        // ISSB S2 - global applicability
        if (entity.followsIFRS || entity.jurisdictionAdoptsISSB) {
            standards.push('ISSB_S2');
        }
        
        // TNFD - all entities with nature exposure
        if (entity.hasNatureDependencies || entity.hasNatureImpacts) {
            standards.push('TNFD');
        }
        
        return standards;
    }

    private static async createEngine(standard: string) {
        const { ComplianceEngineFactory } = await import('./index.js');
        return ComplianceEngineFactory.createEngine(standard as any);
    }
}

export default ComplianceEngineFactory;