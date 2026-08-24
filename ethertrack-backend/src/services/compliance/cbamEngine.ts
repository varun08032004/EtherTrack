// CBAM Engine - EU Carbon Border Adjustment Mechanism Compliance
// Implements EU Regulation 2023/956 for carbon border adjustment

import { safeQuery as query, withTransaction } from '../../db/pool.js';

export interface CBAMReport {
    reportId: string;
    declarantId: string;
    reportingPeriod: { start: string; end: string };
    goods: CBAMGood[];
    totalEmbeddedEmissions: number; // tonnes CO2e
    totalCBAMCertificates: number;
    status: 'DRAFT' | 'SUBMITTED' | 'VALIDATED' | 'REJECTED';
    submittedAt?: string;
    validatedAt?: string;
}

export interface CBAMGood {
    cnCode: string; // Combined Nomenclature code
    productName: string;
    countryOfOrigin: string;
    installationId?: string; // EU ETS installation ID
    productionRoute: 'DIRECT' | 'INDIRECT'; // Production route
    quantity: number; // tonnes
    embeddedEmissions: number; // tCO2e per tonne
    directEmissions: number;
    indirectEmissions: number;
    electricityConsumption: number; // MWh
    electricityEmissionsFactor: number; // tCO2/MWh
    precursorEmissions: number; // tCO2e
    totalEmbeddedEmissions: number; // tonnes CO2e
    carbonPricePaid: number; // EUR per tonne CO2e
    carbonPriceDue: number; // EUR
    carbonPriceEffective: number; // EUR after reduction
}

export interface CBAMInstallation {
    installationId: string;
    name: string;
    country: string;
    region: string;
    coordinates: { lat: number; lng: number };
    eprtrId?: string; // European Pollutant Release and Transfer Register
    etsInstallationId?: string; // EU ETS installation ID
    capacity: number; // tonnes/year
    productionRoutes: ProductionRoute[];
}

export interface ProductionRoute {
    routeId: string;
    name: string;
    description: string;
    directEmissions: number; // tCO2e/tonne
    indirectEmissions: number;
    precursors: Precursor[];
    electricityConsumption: number; // MWh/tonne
    electricityEmissionsFactor: number; // tCO2/MWh
}

export interface Precursor {
    cnCode: string;
    quantity: number; // tonnes
    embeddedEmissions: number; // tCO2e/tonne
    countryOfOrigin: string;
}

export interface CBAMReportSummary {
    reportId: string;
    declarantId: string;
    reportingPeriod: { start: string; end: string };
    status: 'DRAFT' | 'SUBMITTED' | 'VALIDATED' | 'REJECTED';
    totalGoods: number;
    totalEmbeddedEmissions: number;
    totalCBAMCertificates: number;
    carbonPriceDue: number;
    submittedAt?: string;
    validatedAt?: string;
}

export class CBAMengine {
    private static readonly EMISSION_FACTORS = {
        // Default emission factors (tCO2/MWh) - can be overridden by installation data
        electricity: {
            EU_AVERAGE: 0.276, // EU average 2023
            GERMANY: 0.380,
            POLAND: 0.720,
            FRANCE: 0.052,
            SPAIN: 0.250,
            ITALY: 0.320,
            DEFAULT: 0.450,
        },
        // Sector-specific benchmarks (tCO2/tonne product)
        benchmarks: {
            'CEMENT': 0.766, // tCO2/tonne clinker
            'STEEL': 1.910,  // tCO2/tonne crude steel
            'ALUMINIUM': 8.50, // tCO2/tonne aluminium
            'FERTILIZER': 1.50, // tCO2/tonne nitrogen
            'HYDROGEN': 0.0, // Green hydrogen benchmark
            'CEMENT_CLINKER': 0.766,
            'IRON_STEEL': 1.910,
            'ALUMINIUM': 8.50,
            'FERTILIZER': 1.50,
            'HYDROGEN': 0.0,
        },
        // Precursor emission factors (tCO2/tonne)
        precursors: {
            'CEMENT_CLINKER': 0.766,
            'IRON_ORE': 0.0,
            'SCRAP_STEEL': 0.0,
            'ALUMINA': 3.5,
            'FERTILIZER_N': 1.50,
            'HYDROGEN_NATURAL_GAS': 10.0, // tCO2/tonne H2
        }
    };

    /**
     * Calculate embedded emissions for a CBAM good
     * Implements EU Regulation 2023/956 Annex III methodology
     */
    static calculateEmbeddedEmissions(good: {
        cnCode: string;
        productType: 'CEMENT' | 'STEEL' | 'ALUMINIUM' | 'FERTILIZER' | 'HYDROGEN' | 'ELECTRICITY';
        productionRoute: 'DIRECT' | 'INDIRECT';
        quantity: number; // tonnes
        countryOfOrigin: string;
        installation?: {
            installationId: string;
            directEmissions?: number; // tCO2e
            indirectEmissions?: number; // tCO2e
            electricityConsumption?: number; // MWh
            electricityEmissionsFactor?: number; // tCO2/MWh
            precursors?: Array<{
                cnCode: string;
                quantity: number;
                embeddedEmissions: number;
            }>;
        }>): {
            directEmissions: number;
            indirectEmissions: number;
            precursorEmissions: number;
            totalEmbeddedEmissions: number;
            embeddedEmissionsPerTonne: number;
            carbonPriceDue: number; // EUR
            carbonPriceEffective: number;
        } {
            const { productType, productionRoute, quantity, countryOfOrigin, installation, precursors } = good;
            const benchmark = this.EMISSION_FACTORS.benchmarks[productType] || 0;

            // 1. Direct emissions (from installation or default benchmark)
            let directEmissions = 0;
            if (installation?.directEmissions !== undefined) {
                directEmissions = installation.directEmissions;
            } else {
                // Use benchmark * quantity
                directEmissions = benchmark * good.quantity;
            }

            // 2. Indirect emissions (electricity)
            let indirectEmissions = 0;
            if (installation?.electricityConsumption !== undefined && installation?.electricityEmissionsFactor !== undefined) {
                indirectEmissions = installation.electricityConsumption * installation.electricityEmissionsFactor;
            } else if (installation?.electricityConsumption !== undefined) {
                // Use country-specific grid factor
                const countryFactor = this.getCountryElectricityFactor(good.countryOfOrigin);
                indirectEmissions = installation.electricityConsumption * countryFactor;
            } else {
                // Default: benchmark already includes indirect for some sectors
                indirectEmissions = 0;
            }

            // 2b. For INDIRECT production route, electricity is already accounted in precursors
            if (productionRoute === 'INDIRECT') {
                indirectEmissions = 0; // Already in precursors
            }

            // 3. Precursor emissions
            let precursorEmissions = 0;
            if (precursors && precursors.length > 0) {
                for (const precursor of precursors) {
                    const precursorFactor = this.EMISSION_FACTORS.precursors[precursor.cnCode] || 0;
                    precursorEmissions += precursor.quantity * (precursor.embeddedEmissions || precursorFactor);
                }
            }

            // 4. Total embedded emissions per tonne
            const totalEmbeddedEmissions = directEmissions + indirectEmissions + precursorEmissions;
            const embeddedEmissionsPerTonne = good.quantity > 0 ? totalEmbeddedEmissions / quantity : 0;

            // 2. Carbon price calculation
            // CBAM certificate price = EU ETS allowance price (€/tonne CO2)
            const euEtsPrice = 85; // EUR/tonne CO2 - would come from market data
            const carbonPricePaid = good.carbonPricePaid || 0; // Carbon price already paid in country of origin
            const carbonPriceDue = Math.max(0, (embededEmissionsPerTonne * euEtsPrice) - carbonPricePaid);
            const carbonPriceDueTotal = carbonPriceDue * good.quantity;

            // 3. Effective carbon price after reduction
            const reductionFactor = this.getReductionFactor(good.countryOfOrigin);
            const carbonPriceEffective = carbonPriceDue * (1 - reductionFactor);

            return {
                directEmissions,
                indirectEmissions,
                precursorEmissions,
                totalEmbeddedEmissions,
                embeddedEmissionsPerTonne: embededEmissionsPerTonne,
                carbonPriceDue: carbonPriceDueTotal,
                carbonPriceEffective: carbonPriceEffective * good.quantity,
            };
        }

        private static getCountryElectricityFactor(country: string): number {
            const factors: Record<string, number> = {
                'CN': 0.550, // China
                'IN': 0.720, // India
                'US': 0.380,
                'RU': 0.450,
                'TR': 0.450,
                'ZA': 0.900,
                'BR': 0.120,
                'ID': 0.650,
                'VN': 0.500,
                'MX': 0.350,
                'DEFAULT': 0.450,
            };
            return this.EMISSION_FACTORS.electricity[country as keyof typeof this.EMISSION_FACTORS.electricity] || 
                   this.EMISSION_FACTORS.electricity.DEFAULT;
        }

        private static getReductionFactor(country: string): number {
            // Countries with linked ETS or equivalent carbon pricing
            const linkedETS = ['CH', 'NO', 'IS', 'LI', 'EU'];
            if (linkedETS.includes(country)) return 1.0; // Full reduction
            
            // Countries with carbon pricing
            const carbonPricing = ['CA', 'KR', 'JP', 'NZ', 'CN', 'GB'];
            if (carbonPricing.includes(country)) return 0.5; // Partial reduction
            
            return 0; // No reduction
        }

    /**
     * Generate CBAM quarterly report
     */
    static async generateQuarterlyReport(declarantId: string, quarter: number, year: number): Promise<CBAMReport> {
        const startDate = new Date(year, (quarter - 1) * 3, 1);
        const endDate = new Date(year, quarter * 3, 0);
        
        const { rows: goods } = await query(
            `SELECT * FROM cbam_goods 
             WHERE declarant_id = $1 
             AND reporting_period_start >= $2 
             AND reporting_period_end <= $3`,
            [declarantId, startDate.toISOString(), endDate.toISOString()]
        );

        const goodsData = goods.map(g => this.calculateEmbeddedEmissions({
            cnCode: g.cn_code,
            productType: g.product_type,
            productionRoute: g.production_route,
            quantity: g.quantity,
            countryOfOrigin: g.country_of_origin,
            installation: g.installation_data ? JSON.parse(g.installation_data) : undefined,
            precursors: g.precursors ? JSON.parse(g.precursors) : [],
        }));

        const totalEmbeddedEmissions = goodsData.reduce((sum, g) => g.totalEmbeddedEmissions, 0);
        const totalCarbonPriceDue = goodsData.reduce((sum, g) => g.carbonPriceDue, 0);

        const report: CBAMReport = {
            reportId: `CBAM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            declarantId,
            reportingPeriod: { 
                start: startDate.toISOString().split('T')[0], 
                end: endDate.toISOString().split('T')[0] 
            },
            goods: goodsData,
            totalEmbeddedEmissions: goodsData.reduce((sum, g) => g.totalEmbeddedEmissions, 0),
            totalCBAMCertificates: Math.ceil(goodsData.reduce((sum, g) => g.carbonPriceDue, 0)),
            status: 'DRAFT',
            createdAt: new Date().toISOString(),
        };

        // Save report
        await query(
            `INSERT INTO cbam_reports (report_id, declarant_id, reporting_period_start, reporting_period_end, 
             goods, total_embedded_emissions, total_cbam_certificates, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', NOW())
             RETURNING report_id`,
            [report.reportId, declarantId, startDate, endDate, 
             JSON.stringify(goodsData), totalEmbeddedEmissions, Math.ceil(totalCarbonPriceDue)]
        );

        return report;
    }

    /**
     * Validate CBAM report before submission
     */
    static async validateReport(reportId: string): Promise<{ valid: boolean; errors: string[] }> {
        const { rows } = await query(
            `SELECT * FROM cbam_reports WHERE report_id = $1`,
            [reportId]
        );
        
        if (!rows.length) return { valid: false, errors: ['Report not found'] };
        
        const report = rows[0];
        const errors: string[] = [];
        
        if (report.status !== 'DRAFT') {
            errors.push('Report is not in draft state');
        }
        
        const goods = report.goods;
        if (!goods || goods.length === 0) {
            errors.push('No goods in report');
        }
        
        for (const good of goods) {
            if (!good.cnCode || !good.quantity || !good.embeddedEmissionsPerTonne) {
                errors.push(`Good ${good.cnCode}: missing required fields`);
            }
            if (good.totalEmbeddedEmissions <= 0) {
                errors.push(`Good ${good.cnCode}: embedded emissions must be > 0`);
            }
        }
        
        return { valid: errors.length === 0, errors };
    }

    /**
     * Submit CBAM report to EU portal (simulated)
     */
    static async submitReport(reportId: string): Promise<{ success: boolean; submissionId?: string; error?: string }> {
        const validation = await this.validateReport(reportId);
        if (!validation.valid) {
            return { success: false, error: validation.errors.join('; ') };
        }

        // In production, would submit to EU CBAM portal via API
        // For now, simulate submission
        const submissionId = `CBAM-SUB-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        await query(
            `UPDATE cbam_reports 
             SET status = 'SUBMITTED', submitted_at = NOW(), submission_id = $1 
             WHERE report_id = $2`,
            [submissionId, reportId]
        );

        return { success: true, submissionId };
    }

    /**
     * Calculate CBAM certificates to surrender
     */
    static calculateCertificatesToSurrender(embeddedEmissions: number): number {
        // 1 CBAM certificate = 1 tonne CO2e
        // Round up to nearest whole certificate
        return Math.ceil(embeddedEmissions);
    }

    /**
     * Get CBAM compliance status for declarant
     */
    static async getComplianceStatus(declarantId: string, year: number): Promise<{
        reportsSubmitted: number;
        totalEmissions: number;
        certificatesSurrendered: number;
        certificatesDue: number;
        complianceStatus: 'COMPLIANT' | 'NON_COMPLIANT' | 'PENDING';
        nextDeadline: string;
    }> {
        const { rows } = await query(
            `SELECT 
                COUNT(*) as reports_submitted,
                COALESCE(SUM(total_embedded_emissions), 0) as total_emissions,
                COALESCE(SUM(total_cbam_certificates), 0) as certificates_surrendered
             FROM cbam_reports 
             WHERE declarant_id = $1 
             AND EXTRACT(YEAR FROM reporting_period_start) = $2
             AND status IN ('SUBMITTED', 'VALIDATED')`,
            [declarantId, year]
        );

        const data = rows[0];
        const totalEmissions = parseFloat(data.total_emissions || '0');
        const certificatesSurrendered = parseInt(data.certificates_surrendered || '0');
        const certificatesDue = Math.ceil(parseFloat(data.total_emissions || '0'));
        
        const compliant = certificatesSurrendered >= certificatesDue;
        
        return {
            reportsSubmitted: parseInt(data.reports_submitted || '0'),
            totalEmissions,
            certificatesSurrendered,
            certificatesDue,
            complianceStatus: compliant ? 'COMPLIANT' : 'NON_COMPLIANT',
            nextDeadline: `${new Date().getFullYear() + 1}-05-31`, // May 31 next year
        };
    }
}

export default CBAMengine;