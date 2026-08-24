// EtherTrack Carbon Score (ECS) Engine
// Proprietary quality scoring for carbon credits - NOT a certification

export interface QualityDimensions {
    additionality: number;           // 0-100: Project additionality assessment
    permanence: number;              // 0-100: Reversal risk (buffer pool, insurance)
    methodologyRisk: number;         // 0-100: Methodology robustness, version
    verificationQuality: number;     // 0-100: Verifier reputation, depth
    registryProvenance: number;      // 0-100: Registry credibility, transparency
    projectRisk: number;             // 0-100: Developer track record, land tenure
    countryRisk: number;             // 0-100: Political, legal, regulatory
    doubleCountingRisk: number;      // 0-100: Corresponding adjustment status
    vintage: number;                 // 0-100: Age, relevance to current claims
    transparency: number;            // 0-100: Data availability, monitoring
    coBenefits: number;              // 0-100: SDG alignment, community impact
}

export interface ECSResult {
    assetId: string;
    overallScore: number;            // Weighted aggregate (0-100)
    dimensionScores: QualityDimensions;
    percentileRank: number;          // vs all assets in registry (0-100)
    grade: 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'B' | 'C' | 'D';
    lastUpdated: string;
    dataSources: string[];
    disclaimer: string;
    factorContributions: Record<string, number>; // Contribution of each dimension to final score
}

export interface AssetForScoring {
    assetId: string;
    instrumentType: 'VCM_CREDIT' | 'CCTS_OFFSET_CCC' | 'CCTS_COMPLIANCE_CCC';
    registry: 'VCS' | 'GS' | 'CDM' | 'ACR' | 'ICM' | 'BEE';
    projectId: string;
    methodology: string;
    vintage: number;
    geography: { country: string; region?: string };
    verificationBody: string;
    issuanceDate: string;
    quantity: number;
    retiredQuantity: number;
    priceHistory: Array<{ date: string; price: number }>;
    retirementRecords: Array<{ date: string; quantity: number; beneficiary: string }>;
    complianceStatus: 'eligible' | 'ineligible' | 'pending' | 'surrendered';
    metadata: Record<string, any>;
}

// Weighting configuration (sums to 1.0)
const ECS_WEIGHTS: Record<keyof QualityDimensions, number> = {
    additionality: 0.25,
    permanence: 0.20,
    methodologyRisk: 0.15,
    verificationQuality: 0.15,
    registryProvenance: 0.10,
    projectRisk: 0.05,
    countryRisk: 0.05,
    doubleCountingRisk: 0.03,
    vintage: 0.01,
    transparency: 0.01,
    coBenefits: 0.01
};

// Grade thresholds
const GRADE_THRESHOLDS: Array<{ min: number; grade: ECSResult['grade'] }> = [
    { min: 90, grade: 'AAA' },
    { min: 80, grade: 'AA' },
    { min: 70, grade: 'A' },
    { min: 60, grade: 'BBB' },
    { min: 50, grade: 'BB' },
    { min: 40, grade: 'BB' },
    { min: 30, grade: 'B' },
    { min: 20, grade: 'C' },
    { min: 0, grade: 'D' }
];

/**
 * Calculate EtherTrack Carbon Score for an asset
 */
export function calculateECS(asset: AssetForScoring, registryData?: any): ECSResult {
    // Calculate each dimension
    const dimensions: QualityDimensions = {
        additionality: calculateAdditionality(asset, registryData),
        permanence: calculatePermanence(asset, registryData),
        methodologyRisk: calculateMethodologyRisk(asset, registryData),
        verificationQuality: calculateVerificationQuality(asset, registryData),
        registryProvenance: calculateRegistryProvenance(asset, registryData),
        projectRisk: calculateProjectRisk(asset, registryData),
        countryRisk: calculateCountryRisk(asset, registryData),
        doubleCountingRisk: calculateDoubleCountingRisk(asset, registryData),
        vintage: calculateVintageScore(asset),
        transparency: calculateTransparency(asset, registryData),
        coBenefits: calculateCoBenefits(asset, registryData)
    };

    // Calculate weighted score
    let overallScore = 0;
    const factorContributions: Record<string, number> = {};
    
    for (const [dimension, weight] of Object.entries(ECS_WEIGHTS)) {
        const score = dimensions[dimension as keyof QualityDimensions];
        overallScore += score * weight;
        factorContributions[dimension] = Math.round(score * weight * 100) / 100;
    }
    
    overallScore = Math.round(overallScore * 100) / 100;
    
    // Determine grade
    const grade = GRADE_THRESHOLDS.find(t => overallScore >= t.min)?.grade || 'D';
    
    // Calculate percentile (would need registry-wide data in production)
    const percentileRank = calculatePercentileRank(overallScore);
    
    // Data sources used
    const dataSources = getDataSources(asset);
    
    return {
        assetId: asset.assetId,
        overallScore,
        dimensionScores: dimensions,
        percentileRank,
        grade,
        lastUpdated: new Date().toISOString(),
        dataSources,
        disclaimer: "EtherTrack Carbon Score (ECS) is a proprietary analytical metric for informational purposes only. It is NOT a certification, rating, or endorsement. Scores are based on available data and proprietary methodology. Users should conduct independent due diligence.",
        factorContributions
    };
}

// ============================================================
// DIMENSION CALCULATIONS
// ============================================================

function calculateAdditionality(asset: AssetForScoring, registryData?: any): number {
    // Additionality assessment based on:
    // - Project type (renewable vs. avoidance vs. removal)
    // - Barrier analysis (financial, technological, institutional)
    // - Common practice test
    // - Regulatory surplus
    
    let score = 50; // Base
    
    // Project type bonus
    if (asset.metadata?.projectType) {
        const type = asset.metadata.projectType.toLowerCase();
        if (type.includes('renewable') || type.includes('solar') || type.includes('wind')) score += 20;
        else if (type.includes('forest') || type.includes('afforestation') || type.includes('reforestation')) score += 15;
        else if (type.includes('methane') || type.includes('waste')) score += 10;
        else if (type.includes('efficiency')) score += 5;
    }
    
    // Registry data enhancements
    if (registryData?.additionalityAssessment) {
        const assessment = registryData.additionalityAssessment;
        if (assessment.financialBarrier) score += 10;
        if (assessment.technologicalBarrier) score += 10;
        if (assessment.institutionalBarrier) score += 5;
        if (assessment.commonPracticeTest === 'pass') score += 10;
        if (assessment.regulatorySurplus) score += 10;
    }
    
    // Methodology additionality requirements
    if (asset.methodology.includes('VCS') || asset.methodology.includes('GS')) {
        score += 5; // These standards have additionality requirements
    }
    
    return Math.min(100, Math.max(0, score));
}

function calculatePermanence(asset: AssetForScoring, registryData?: any): number {
    // Permanence risk assessment:
    // - Project type (forestry = higher reversal risk)
    // - Buffer pool size
    // - Insurance coverage
    // - Legal protection (land tenure)
    // - Monitoring frequency
    
    let score = 50;
    
    // Project type risk
    if (asset.metadata?.projectType) {
        const type = asset.metadata.projectType.toLowerCase();
        if (type.includes('forest') || type.includes('afforestation') || type.includes('reforestation')) {
            score -= 20; // Higher reversal risk
            // Buffer pool mitigation
            if (registryData?.bufferPoolPercentage) {
                score += Math.min(20, registryData.bufferPoolPercentage);
            }
        } else if (type.includes('renewable') || type.includes('energy')) {
            score += 20; // Low reversal risk
        } else if (type.includes('methane') || type.includes('waste')) {
            score += 15;
        }
    }
    
    // Insurance
    if (registryData?.insuranceCoverage) {
        score += 15;
    }
    
    // Legal protection
    if (registryData?.landTenure === 'secure') {
        score += 10;
    }
    
    // Monitoring
    if (registryData?.monitoringFrequency === 'annual' || registryData?.monitoringFrequency === 'continuous') {
        score += 5;
    }
    
    return Math.min(100, Math.max(0, score));
}

function calculateMethodologyRisk(asset: AssetForScoring, registryData?: any): number {
    // Methodology robustness assessment
    let score = 50;
    
    // Standard recognition
    if (asset.methodology.includes('VCS') || asset.methodology.includes('Verra')) score += 15;
    else if (asset.methodology.includes('GS') || asset.methodology.includes('Gold Standard')) score += 20;
    else if (asset.methodology.includes('CDM')) score += 15;
    else if (asset.methodology.includes('ACR')) score += 10;
    else if (asset.methodology.includes('BEE') || asset.methodology.includes('PAT')) score += 10;
    else if (asset.methodology.includes('ICM') || asset.methodology.includes('CCTS')) score += 15;
    
    // Methodology version
    if (registryData?.methodologyVersion) {
        const version = registryData.methodologyVersion;
        if (version.includes('v3') || version.includes('v4') || version.includes('2023') || version.includes('2024')) {
            score += 10; // Recent version
        }
    }
    
    // Sector-specific methodology
    if (asset.metadata?.sector) {
        const sector = asset.metadata.sector.toLowerCase();
        if (sector.includes('renewable') || sector.includes('energy')) score += 5;
        else if (sector.includes('forest') || sector.includes('land')) score += 5;
    }
    
    return Math.min(100, Math.max(0, score));
}

function calculateVerificationQuality(asset: AssetForScoring, registryData?: any): number {
    // Verification body quality and depth
    let score = 50;
    
    // Verifier reputation
    const verifier = asset.verificationBody?.toLowerCase() || '';
    const topVerifiers = ['deloitte', 'ey', 'pwc', 'kpmg', 'bsi', 'tuv', 'sgs', 'intertek', 'bureau veritas', 'dnv'];
    if (topVerifiers.some(v => verifier.includes(v))) {
        score += 25;
    } else if (verifier) {
        score += 10; // Some verifier is better than none
    }
    
    // Verification depth
    if (registryData?.verificationDepth) {
        const depth = registryData.verificationDepth;
        if (depth === 'full') score += 15;
        else if (depth === 'desk_review') score += 5;
        else if (depth === 'site_visit') score += 10;
    }
    
    // Verification frequency
    if (registryData?.verificationFrequency) {
        if (registryData.verificationFrequency === 'annual') score += 10;
        else if (registryData.verificationFrequency === 'biennial') score += 5;
    }
    
    // Verification scope
    if (registryData?.verificationScope) {
        if (registryData.verificationScope === 'full') score += 10;
        else if (registryData.verificationScope === 'partial') score += 5;
    }
    
    return Math.min(100, Math.max(0, score));
}

function calculateRegistryProvenance(asset: AssetForScoring, registryData?: any): number {
    // Registry credibility and transparency
    let score = 50;
    
    // Registry recognition
    const registry = asset.registry.toLowerCase();
    if (registry === 'vcs' || registry === 'verra') score += 25;
    else if (registry === 'gs' || registry === 'gold standard') score += 30;
    else if (registry === 'cdm') score += 20;
    else if (registry === 'acr') score += 15;
    else if (registry === 'icm' || registry === 'ccts') score += 25;
    else if (registry === 'bee') score += 20;
    
    // Registry transparency
    if (registryData?.publicRegistry) score += 10;
    if (registryData?.apiAccess) score += 10;
    if (registryData?.historicalData) score += 5;
    
    // ICROA membership
    if (registryData?.icroaMember) score += 10;
    
    return Math.min(100, Math.max(0, score));
}

function calculateProjectRisk(asset: AssetForScoring, registryData?: any): number {
    // Developer track record, land tenure, community opposition
    let score = 50;
    
    // Developer track record
    if (registryData?.developerTrackRecord) {
        const track = registryData.developerTrackRecord;
        if (track === 'excellent') score += 20;
        else if (track === 'good') score += 10;
        else if (track === 'poor') score -= 20;
    }
    
    // Land tenure
    if (registryData?.landTenure) {
        if (registryData.landTenure === 'secure') score += 15;
        else if (registryData.landTenure === 'disputed') score -= 30;
    }
    
    // Community opposition
    if (registryData?.communityOpposition === true) score -= 20;
    else if (registryData?.communityOpposition === false) score += 10;
    
    // Financial viability
    if (registryData?.financialViability === 'strong') score += 10;
    else if (registryData?.financialViability === 'weak') score -= 15;
    
    return Math.min(100, Math.max(0, score));
}

function calculateCountryRisk(asset: AssetForScoring, registryData?: any): number {
    // Political, legal, regulatory risk
    let score = 50;
    
    const country = asset.geography?.country?.toLowerCase() || '';
    
    // Country risk ratings (simplified)
    const lowRiskCountries = ['usa', 'canada', 'uk', 'germany', 'france', 'japan', 'australia', 'new zealand', 'switzerland', 'norway', 'sweden', 'denmark', 'finland', 'netherlands', 'singapore'];
    const mediumRiskCountries = ['india', 'china', 'brazil', 'mexico', 'indonesia', 'south africa', 'thailand', 'malaysia', 'philippines', 'vietnam', 'turkey', 'poland', 'chile', 'colombia', 'peru'];
    const highRiskCountries = ['venezuela', 'zimbabwe', 'syria', 'yemen', 'afghanistan', 'sudan', 'myanmar', 'north korea'];
    
    if (lowRiskCountries.includes(country)) score += 25;
    else if (mediumRiskCountries.includes(country)) score += 10;
    else if (highRiskCountries.includes(country)) score -= 25;
    
    // Regulatory stability
    if (registryData?.regulatoryStability === 'stable') score += 10;
    else if (registryData?.regulatoryStability === 'unstable') score -= 20;
    
    // Legal enforceability
    if (registryData?.contractEnforceability === 'strong') score += 10;
    else if (registryData?.contractEnforceability === 'weak') score -= 15;
    
    return Math.min(100, Math.max(0, score));
}

function calculateDoubleCountingRisk(asset: AssetForScoring, registryData?: any): number {
    // Risk of double counting / corresponding adjustment issues
    let score = 50;
    
    // Corresponding adjustment status
    if (registryData?.correspondingAdjustment) {
        if (registryData.correspondingAdjustment === 'authorized') score += 30;
        else if (registryData.correspondingAdjustment === 'pending') score += 10;
        else if (registryData.correspondingAdjustment === 'not_required') score += 20;
        else if (registryData.correspondingAdjustment === 'rejected') score -= 30;
    }
    
    // Article 6 authorization
    if (registryData?.article6Authorized === true) score += 20;
    
    // Registry duplicate detection
    if (registryData?.duplicateDetection === 'active') score += 10;
    
    // First transfer tracking
    if (registryData?.firstTransferTracked === true) score += 10;
    
    return Math.min(100, Math.max(0, score));
}

function calculateVintageScore(asset: AssetForScoring): number {
    // Vintage relevance - newer vintages generally preferred for current claims
    let score = 50;
    const currentYear = new Date().getFullYear();
    const age = currentYear - asset.vintage;
    
    if (age <= 1) score += 30;      // Current vintage
    else if (age <= 3) score += 20; // Recent
    else if (age <= 5) score += 10; // Acceptable
    else if (age <= 10) score += 0; // Neutral
    else if (age <= 15) score -= 10; // Aging
    else score -= 20;                // Old
    
    return Math.min(100, Math.max(0, score));
}

function calculateTransparency(asset: AssetForScoring, registryData?: any): number {
    // Data availability and monitoring transparency
    let score = 50;
    
    // Monitoring data availability
    if (registryData?.monitoringData === 'public') score += 20;
    else if (registryData?.monitoringData === 'restricted') score += 10;
    
    // Project documentation
    if (registryData?.projectDocuments === 'public') score += 15;
    else if (registryData?.projectDocuments === 'summary') score += 5;
    
    // Monitoring reports
    if (registryData?.monitoringReports === 'annual') score += 10;
    else if (registryData?.monitoringReports === 'periodic') score += 5;
    
    // Third-party data verification
    if (registryData?.thirdPartyVerification) score += 10;
    
    return Math.min(100, Math.max(0, score));
}

function calculateCoBenefits(asset: AssetForScoring, registryData?: any): number {
    // SDG alignment and community/environmental co-benefits
    let score = 50;
    
    if (registryData?.sdgAlignment) {
        const sdgs = registryData.sdgAlignment;
        if (sdgs.length >= 5) score += 20;
        else if (sdgs.length >= 3) score += 15;
        else if (sdgs.length >= 1) score += 5;
    }
    
    // Community benefits
    if (registryData?.communityBenefits === 'high') score += 15;
    else if (registryData?.communityBenefits === 'medium') score += 10;
    else if (registryData?.communityBenefits === 'low') score += 5;
    
    // Biodiversity benefits
    if (registryData?.biodiversityBenefits === true) score += 10;
    
    // Gender equality
    if (registryData?.genderEquality === true) score += 5;
    
    return Math.min(100, Math.max(0, score));
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function calculatePercentileRank(score: number): number {
    // In production, this would query the database for score distribution
    // For now, use a normal distribution approximation
    // Mean ~50, StdDev ~15
    const z = (score - 50) / 15;
    const percentile = 0.5 * (1 + Math.erf(z / Math.sqrt(2))) * 100;
    return Math.round(Math.max(1, Math.min(99, percentile)));
}

function getDataSources(asset: AssetForScoring): string[] {
    const sources = ['EtherTrack Calculation Engine'];
    
    if (asset.registry) sources.push(`${asset.registry} Registry`);
    if (asset.methodology) sources.push(`${asset.methodology} Methodology`);
    if (asset.verificationBody) sources.push(`${asset.verificationBody} Verification`);
    
    return sources;
}

// ============================================================
// BATCH SCORING
// ============================================================

export async function scoreAssetBatch(assets: AssetForScoring[], registryDataMap?: Map<string, any>): Promise<ECSResult[]> {
    const results: ECSResult[] = [];
    
    for (const asset of assets) {
        const registryData = registryDataMap?.get(asset.assetId);
        const result = calculateECS(asset, registryData);
        results.push(result);
    }
    
    // Sort by score descending
    results.sort((a, b) => b.overallScore - a.overallScore);
    
    return results;
}

export async function getECSLeaderboard(limit: number = 100): Promise<ECSResult[]> {
    // In production, would query pre-computed scores from database
    // For now, return empty array
    return [];
}

export async function getAssetECSHistory(assetId: string, limit: number = 30): Promise<ECSResult[]> {
    // Would query historical scores
    return [];
}

export default {
    calculateECS,
    scoreAssetBatch,
    getECSLeaderboard,
    getAssetECSHistory,
    ECS_WEIGHTS,
    GRADE_THRESHOLDS
};