// Advanced DeFi Primitives - Carbon Perpetuals, Options, Structured Products
// Implements on-chain derivatives for carbon credits

import { ethers } from 'ethers';

// ============================================
// Carbon Perpetual Futures
// ============================================

export interface CarbonPerpetualConfig {
    marketId: string;
    underlyingAsset: string; // ERC-1155 carbon credit contract
    assetId: number; // Carbon credit batch ID
    quoteAsset: string; // USDC, USDT, DAI
    fundingRateCap: number; // basis points
    fundingInterval: number; // seconds (typically 8 hours = 28800)
    markPriceSource: 'ORACLE' | 'TWAP' | 'MARKET';
    oracleAddress?: string;
    twapWindow: number; // seconds
    maintenanceMarginRatio: number; // basis points (e.g., 500 = 5%)
    initialMarginRatio: number; // basis points (e.g., 1000 = 10%)
    maxLeverage: number; // e.g., 10x
    tickSize: number; // minimum price increment
    lotSize: number; // minimum position size
    makerFeeBps: number;
    takerFeeBps: number;
    insuranceFundAddress: string;
    autoDeleveragingEnabled: boolean;
}

export interface PerpetualPosition {
    positionId: string;
    trader: string;
    marketId: string;
    side: 'LONG' | 'SHORT';
    size: number; // in quote asset (USDC)
    entryPrice: number;
    markPrice: number;
    unrealizedPnl: number;
    realizedPnl: number;
    margin: number;
    leverage: number;
    liquidationPrice: number;
    fundingPaid: number;
    lastFundingTime: number;
    openedAt: number;
    updatedAt: number;
    status: 'OPEN' | 'CLOSED' | 'LIQUIDATED' | 'ADL';
}

export interface FundingRate {
    marketId: string;
    timestamp: number;
    fundingRate: number; // basis points
    markPrice: number;
    indexPrice: number;
    premiumIndex: number;
    nextFundingTime: number;
}

export interface PerpetualOrder {
    orderId: string;
    trader: string;
    marketId: string;
    side: 'BUY' | 'SELL';
    orderType: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'STOP_LIMIT' | 'POST_ONLY' | 'IOC' | 'FOK';
    size: number;
    price?: number;
    stopPrice?: number;
    reduceOnly: boolean;
    postOnly: boolean;
    timeInForce: 'GTC' | 'IOC' | 'FOK';
    status: 'PENDING' | 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED';
    filledSize: number;
    avgFillPrice: number;
    feePaid: number;
    createdAt: number;
    updatedAt: number;
}

// ============================================
// Carbon Options
// ============================================

export interface CarbonOptionConfig {
    marketId: string;
    underlyingAsset: string; // ERC-1155 carbon credit contract
    assetId: number;
    quoteAsset: string;
    optionStyle: 'EUROPEAN' | 'AMERICAN';
    settlementType: 'PHYSICAL' | 'CASH';
    minOrderSize: number;
    tickSize: number;
    makerFeeBps: number;
    takerFeeBps: number;
    exerciseFeeBps: number;
}

export interface CarbonOption {
    optionId: string;
    marketId: string;
    optionType: 'CALL' | 'PUT';
    strikePrice: number;
    expiry: number; // Unix timestamp
    size: number; // number of contracts (1 contract = 1 tCO2e)
    premium: number; // price per contract in quote asset
    impliedVolatility: number; // annualized %
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    rho: number;
    underlyingPrice: number;
    status: 'ACTIVE' | 'EXPIRED' | 'EXERCISED' | 'CANCELLED';
    createdAt: number;
    updatedAt: number;
}

export interface OptionPosition {
    positionId: string;
    trader: string;
    optionId: string;
    side: 'LONG' | 'SHORT';
    size: number;
    entryPremium: number;
    currentPremium: number;
    unrealizedPnl: number;
    deltaExposure: number;
    gammaExposure: number;
    vegaExposure: number;
    openedAt: number;
    updatedAt: number;
}

export interface OptionOrder {
    orderId: string;
    trader: string;
    optionId: string;
    side: 'BUY' | 'SELL';
    orderType: 'MARKET' | 'LIMIT';
    size: number;
    price?: number; // premium per contract
    reduceOnly: boolean;
    status: 'PENDING' | 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED';
    filledSize: number;
    avgFillPrice: number;
    feePaid: number;
    createdAt: number;
    updatedAt: number;
}

// ============================================
// Structured Products
// ============================================

export interface StructuredProductConfig {
    productId: string;
    name: string;
    description: string;
    productType: 'PRINCIPAL_PROTECTED' | 'YIELD_ENHANCED' | 'LEVERAGED' | 'BARRIER' | 'AUTOCALLABLE' | 'BASKET' | 'CUSTOM';
    underlyingAssets: Array<{
        asset: string;
        assetId: number;
        weight: number;
    }>;
    quoteAsset: string;
    maturity: number; // Unix timestamp
    capitalProtection: number; // percentage (e.g., 100 = full protection)
    participationRate: number; // percentage of upside
    couponRate?: number; // annual %
    barrierLevel?: number; // for barrier products
    barrierType?: 'UP_IN' | 'UP_OUT' | 'DOWN_IN' | 'DOWN_OUT';
    autocallTrigger?: number;
    autocallFrequency?: number; // days
    earlyRedemptionEnabled: boolean;
    managementFeeBps: number;
    performanceFeeBps: number;
    minInvestment: number;
    maxInvestment: number;
    subscriptionPeriod: {
        start: number;
        end: number;
    };
    status: 'DRAFT' | 'OPEN' | 'CLOSED' | 'MATURED' | 'TERMINATED';
}

export interface StructuredProductPosition {
    positionId: string;
    investor: string;
    productId: string;
    investmentAmount: number; // in quote asset
    units: number;
    entryNav: number; // NAV per unit
    currentNav: number;
    unrealizedPnl: number;
    accruedCoupon: number;
    status: 'SUBSCRIBED' | 'ACTIVE' | 'REDEEMED' | 'MATURED' | 'EARLY_REDEEMED';
    subscribedAt: number;
    updatedAt: number;
}

export interface ProductNAV {
    productId: string;
    timestamp: number;
    nav: number;
    underlyingPrices: Record<string, number>;
    totalAssets: number;
    totalLiabilities: number;
    sharesOutstanding: number;
}

// ============================================
// Carbon Insurance
// ============================================

export interface CarbonInsuranceConfig {
    poolId: string;
    name: string;
    description: string;
    coveredRisks: ('REVERSAL' | 'INVALIDATION' | 'REGULATORY' | 'MARKET' | 'OPERATIONAL' | 'FORCE_MAJEURE')[];
    coverageAssets: Array<{
        asset: string;
        assetId: number;
        registry: string;
    }>;
    quoteAsset: string;
    premiumRateBps: number; // annual basis points of coverage
    coverageLimit: number; // max coverage per policy
    deductible: number; // tCO2e or percentage
    policyDuration: number; // seconds
    claimWindow: number; // seconds after event
    assessmentPeriod: number; // seconds for claim assessment
    payoutCurrency: string;
    governanceToken?: string;
    capitalRequirement: number; // minimum capital in pool
    reinsuranceEnabled: boolean;
    reinsuranceThreshold: number;
}

export interface InsurancePolicy {
    policyId: string;
    poolId: string;
    policyholder: string;
    coveredAsset: string;
    assetId: number;
    coverageAmount: number; // tCO2e
    premium: number; // in quote asset
    premiumPaid: boolean;
    startDate: number;
    endDate: number;
    deductible: number;
    status: 'ACTIVE' | 'EXPIRED' | 'CLAIMED' | 'CANCELLED' | 'LAPSED';
    createdAt: number;
    updatedAt: number;
}

export interface InsuranceClaim {
    claimId: string;
    policyId: string;
    claimant: string;
    eventType: 'REVERSAL' | 'INVALIDATION' | 'REGULATORY' | 'MARKET' | 'OPERATIONAL' | 'FORCE_MAJEURE';
    eventDescription: string;
    eventDate: number;
    affectedAmount: number; // tCO2e
    claimedAmount: number; // in quote asset
    evidence: string[]; // IPFS hashes
    status: 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'PAID' | 'DISPUTED';
    assessor?: string;
    assessmentNotes?: string;
    payoutAmount?: number;
    payoutTxHash?: string;
    submittedAt: number;
    assessedAt?: number;
    paidAt?: number;
}

export interface InsurancePoolState {
    poolId: string;
    totalCapital: number;
    availableCapital: number;
    reservedCapital: number;
    totalPremiumsCollected: number;
    totalClaimsPaid: number;
    activePolicies: number;
    totalCoverage: number; // tCO2e
    utilizationRate: number; // reserved / total
    solvencyRatio: number; // total capital / total coverage
    lastUpdated: number;
}

// ============================================
// Risk Engine for DeFi Products
// ============================================

export interface RiskMetrics {
    // Portfolio level
    var95: number; // Value at Risk 95%
    var99: number; // Value at Risk 99%
    cvar95: number; // Conditional VaR
    maxDrawdown: number;
    sharpeRatio: number;
    sortinoRatio: number;
    
    // Position level
    delta: number;
    gamma: number;
    vega: number;
    theta: number;
    rho: number;
    
    // Liquidity
    bidAskSpread: number;
    marketDepth: number;
    daysToLiquidate: number;
    
    // Counterparty
    creditExposure: number;
    cva: number; // Credit Valuation Adjustment
    
    // Operational
    modelRisk: number;
    settlementRisk: number;
}

export interface StressTestScenario {
    scenarioId: string;
    name: string;
    description: string;
    shocks: Record<string, number>; // asset -> price shock %
    correlations?: Record<string, Record<string, number>>;
    probability: number;
}

export interface StressTestResult {
    scenarioId: string;
    portfolioValue: number;
    stressedValue: number;
    pnl: number;
    pnlPercent: number;
    worstPosition: string;
    worstPositionPnl: number;
    marginCallRisk: boolean;
    liquidationRisk: boolean;
}

export class DeFiRiskEngine {
    /**
     * Calculate risk metrics for portfolio
     */
    static calculateRiskMetrics(
        positions: (PerpetualPosition | OptionPosition | StructuredProductPosition)[],
        marketData: Record<string, { price: number; volatility: number; volume: number }>
    ): RiskMetrics {
        // Simplified risk calculation
        const totalValue = positions.reduce((sum, p) => sum + (p.size * (p.markPrice || p.currentPremium || p.currentNav)), 0);
        
        return {
            var95: totalValue * 0.05,
            var99: totalValue * 0.08,
            cvar95: totalValue * 0.12,
            maxDrawdown: totalValue * 0.15,
            sharpeRatio: 1.5,
            sortinoRatio: 2.0,
            delta: positions.reduce((sum, p) => sum + (p.delta || 0), 0),
            gamma: positions.reduce((sum, p) => sum + (p.gamma || 0), 0),
            vega: positions.reduce((sum, p) => sum + (p.vega || 0), 0),
            theta: positions.reduce((sum, p) => sum + (p.theta || 0), 0),
            rho: positions.reduce((sum, p) => sum + (p.rho || 0), 0),
            bidAskSpread: 0.001,
            marketDepth: totalValue * 10,
            daysToLiquidate: 2,
            creditExposure: totalValue * 0.02,
            cva: totalValue * 0.001,
            modelRisk: 0.01,
            settlementRisk: 0.005,
        };
    }
    
    /**
     * Run stress tests
     */
    static runStressTests(
        positions: any[],
        scenarios: StressTestScenario[],
        marketData: Record<string, { price: number; volatility: number }>
    ): StressTestResult[] {
        return scenarios.map(scenario => {
            let stressedValue = 0;
            let worstPositionPnl = 0;
            let worstPosition = '';
            
            for (const position of positions) {
                const assetKey = position.marketId || position.optionId || position.productId;
                const shock = scenario.shocks[assetKey] || 0;
                const currentValue = position.size * (position.markPrice || position.currentPremium || position.currentNav);
                const stressedPositionValue = currentValue * (1 + shock / 100);
                const pnl = stressedPositionValue - currentValue;
                
                stressedValue += stressedPositionValue;
                
                if (pnl < worstPositionPnl) {
                    worstPositionPnl = pnl;
                    worstPosition = assetKey;
                }
            }
            
            const portfolioValue = positions.reduce((sum, p) => sum + (p.size * (p.markPrice || p.currentPremium || p.currentNav)), 0);
            const pnl = stressedValue - portfolioValue;
            
            return {
                scenarioId: scenario.scenarioId,
                portfolioValue,
                stressedValue,
                pnl,
                pnlPercent: (pnl / portfolioValue) * 100,
                worstPosition,
                worstPositionPnl,
                marginCallRisk: pnl < -portfolioValue * 0.1,
                liquidationRisk: pnl < -portfolioValue * 0.2,
            };
        });
    }
    
    /**
     * Calculate liquidation price for perpetual position
     */
    static calculateLiquidationPrice(
        position: PerpetualPosition,
        maintenanceMarginRatio: number
    ): number {
        const { side, size, entryPrice, margin } = position;
        const maintenanceMargin = maintenanceMarginRatio / 10000;
        
        if (side === 'LONG') {
            // Long liquidation: markPrice <= entryPrice * (1 - 1/leverage + maintenanceMargin)
            return entryPrice * (1 - 1 / position.leverage + maintenanceMargin);
        } else {
            // Short liquidation: markPrice >= entryPrice * (1 + 1/leverage - maintenanceMargin)
            return entryPrice * (1 + 1 / position.leverage - maintenanceMargin);
        }
    }
    
    /**
     * Calculate option Greeks (Black-Scholes)
     */
    static calculateOptionGreeks(
        option: CarbonOption,
        underlyingPrice: number,
        riskFreeRate: number = 0.05,
        timeToExpiry: number // years
    ): { delta: number; gamma: number; theta: number; vega: number; rho: number } {
        const { strikePrice, impliedVolatility } = option;
        const sigma = impliedVolatility / 100;
        const sqrtT = Math.sqrt(timeToExpiry);
        
        const d1 = (Math.log(underlyingPrice / strikePrice) + (riskFreeRate + sigma * sigma / 2) * timeToExpiry) / (sigma * sqrtT);
        const d2 = d1 - sigma * sqrtT;
        
        const nd1 = this.normalCDF(d1);
        const nd2 = this.normalCDF(d2);
        const pdf = this.normalPDF(d1);
        
        const delta = option.optionType === 'CALL' ? nd1 : nd1 - 1;
        const gamma = pdf / (underlyingPrice * sigma * sqrtT);
        const theta = -(underlyingPrice * pdf * sigma) / (2 * sqrtT) - 
                      (option.optionType === 'CALL' 
                        ? riskFreeRate * strikePrice * Math.exp(-riskFreeRate * timeToExpiry) * nd2
                        : -riskFreeRate * strikePrice * Math.exp(-riskFreeRate * timeToExpiry) * (1 - nd2));
        const vega = underlyingPrice * sqrtT * pdf / 100; // per 1% vol change
        const rho = option.optionType === 'CALL'
            ? strikePrice * timeToExpiry * Math.exp(-riskFreeRate * timeToExpiry) * nd2 / 100
            : -strikePrice * timeToExpiry * Math.exp(-riskFreeRate * timeToExpiry) * (1 - nd2) / 100;
        
        return { delta, gamma, theta, vega, rho };
    }
    
    private static normalCDF(x: number): number {
        return 0.5 * (1 + this.erf(x / Math.sqrt(2)));
    }
    
    private static normalPDF(x: number): number {
        return Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
    }
    
    private static erf(x: number): number {
        // Abramowitz and Stegun approximation
        const a1 = 0.254829592;
        const a2 = -0.284496736;
        const a3 = 1.421413741;
        const a4 = -1.453152027;
        const a5 = 1.061405429;
        const p = 0.3275911;
        
        const sign = x < 0 ? -1 : 1;
        x = Math.abs(x);
        
        const t = 1 / (1 + p * x);
        const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
        
        return sign * y;
    }
}

// ============================================
// Pricing Engine
// ============================================

export class DeFiPricingEngine {
    /**
     * Calculate perpetual funding rate
     */
    static calculateFundingRate(
        markPrice: number,
        indexPrice: number,
        fundingInterval: number, // hours
        interestRate: number = 0.0001 // per interval
    ): number {
        const premium = (markPrice - indexPrice) / indexPrice;
        const fundingRate = premium + interestRate;
        // Clamp to reasonable bounds
        return Math.max(-0.0075, Math.min(0.0075, fundingRate)); // ±0.75% per interval
    }
    
    /**
     * Calculate option premium (Black-Scholes)
     */
    static calculateOptionPremium(
        optionType: 'CALL' | 'PUT',
        underlyingPrice: number,
        strikePrice: number,
        timeToExpiry: number, // years
        volatility: number, // annualized %
        riskFreeRate: number = 0.05
    ): number {
        const sigma = volatility / 100;
        const sqrtT = Math.sqrt(timeToExpiry);
        
        const d1 = (Math.log(underlyingPrice / strikePrice) + (riskFreeRate + sigma * sigma / 2) * timeToExpiry) / (sigma * sqrtT);
        const d2 = d1 - sigma * sqrtT;
        
        const nd1 = DeFiRiskEngine['normalCDF'](d1);
        const nd2 = DeFiRiskEngine['normalCDF'](d2);
        
        if (optionType === 'CALL') {
            return underlyingPrice * nd1 - strikePrice * Math.exp(-riskFreeRate * timeToExpiry) * nd2;
        } else {
            return strikePrice * Math.exp(-riskFreeRate * timeToExpiry) * (1 - nd2) - underlyingPrice * (1 - nd1);
        }
    }
    
    /**
     * Calculate implied volatility from premium
     */
    static calculateImpliedVolatility(
        optionType: 'CALL' | 'PUT',
        underlyingPrice: number,
        strikePrice: number,
        timeToExpiry: number,
        premium: number,
        riskFreeRate: number = 0.05
    ): number {
        // Newton-Raphson method
        let sigma = 0.5; // initial guess
        const tolerance = 1e-6;
        const maxIterations = 100;
        
        for (let i = 0; i < maxIterations; i++) {
            const price = this.calculateOptionPremium(optionType, underlyingPrice, strikePrice, timeToExpiry, sigma * 100, riskFreeRate);
            const vega = this.calculateVega(underlyingPrice, strikePrice, timeToExpiry, sigma, riskFreeRate);
            
            const diff = price - premium;
            if (Math.abs(diff) < tolerance) break;
            
            sigma = sigma - diff / vega;
            sigma = Math.max(0.001, Math.min(5, sigma)); // clamp
        }
        
        return sigma * 100; // return as percentage
    }
    
    private static calculateVega(
        underlyingPrice: number,
        strikePrice: number,
        timeToExpiry: number,
        sigma: number,
        riskFreeRate: number
    ): number {
        const sqrtT = Math.sqrt(timeToExpiry);
        const d1 = (Math.log(underlyingPrice / strikePrice) + (riskFreeRate + sigma * sigma / 2) * timeToExpiry) / (sigma * sqrtT);
        const pdf = DeFiRiskEngine['normalPDF'](d1);
        return underlyingPrice * sqrtT * pdf;
    }
    
    /**
     * Calculate structured product NAV
     */
    static calculateStructuredProductNAV(
        config: StructuredProductConfig,
        underlyingPrices: Record<string, number>,
        initialPrices: Record<string, number>
    ): number {
        let nav = 100; // base NAV
        
        // Calculate performance of underlying basket
        let basketPerformance = 0;
        let totalWeight = 0;
        
        for (const asset of config.underlyingAssets) {
            const currentPrice = underlyingPrices[`${asset.asset}-${asset.assetId}`] || 0;
            const initialPrice = initialPrices[`${asset.asset}-${asset.assetId}`] || currentPrice;
            
            if (initialPrice > 0) {
                const performance = (currentPrice - initialPrice) / initialPrice;
                basketPerformance += performance * asset.weight;
                totalWeight += asset.weight;
            }
        }
        
        if (totalWeight > 0) {
            basketPerformance = basketPerformance / totalWeight;
        }
        
        // Apply product-specific logic
        switch (config.productType) {
            case 'PRINCIPAL_PROTECTED':
                nav = 100 * (1 + Math.max(0, basketPerformance * config.participationRate / 100));
                nav = Math.max(nav, config.capitalProtection);
                break;
                
            case 'YIELD_ENHANCED':
                nav = 100 * (1 + basketPerformance * config.participationRate / 100);
                if (config.couponRate) {
                    nav += config.couponRate * (Date.now() / 1000 - config.subscriptionPeriod.start) / (365 * 24 * 3600);
                }
                break;
                
            case 'LEVERAGED':
                nav = 100 * (1 + basketPerformance * config.participationRate / 100);
                break;
                
            case 'BARRIER':
                const barrierHit = config.barrierType?.includes('UP') 
                    ? basketPerformance >= config.barrierLevel! / 100
                    : basketPerformance <= -config.barrierLevel! / 100;
                
                if ((config.barrierType?.includes('IN') && !barrierHit) ||
                    (config.barrierType?.includes('OUT') && barrierHit)) {
                    nav = 100 * (config.capitalProtection / 100);
                } else {
                    nav = 100 * (1 + basketPerformance * config.participationRate / 100);
                }
                break;
                
            default:
                nav = 100 * (1 + basketPerformance * config.participationRate / 100);
        }
        
        // Deduct management fee
        const daysElapsed = (Date.now() / 1000 - config.subscriptionPeriod.start) / (24 * 3600);
        nav -= nav * (config.managementFeeBps / 10000) * (daysElapsed / 365);
        
        return Math.max(0, nav);
    }
}

export default {
    DeFiRiskEngine,
    DeFiPricingEngine,
};