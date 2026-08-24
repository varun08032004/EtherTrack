// Analytics Engine
// Core computation engine for portfolio risk, scenario modeling, and attribution

import { safeQuery as query, withTransaction } from '../../../db/pool.js';

export interface PortfolioPosition {
    assetId: string;
    quantity: number;
    currentPrice: number;
    vintage: number;
    methodology: string;
    registry: string;
    ecsScore: number;
    assetType: 'VCM_CREDIT' | 'CCTS_OFFSET_CCC' | 'CCTS_COMPLIANCE_CCC';
    marketValue: number;
    weight: number;
}

export interface RiskMetrics {
    var95: number;           // Value at Risk 95%
    var99: number;           // Value at Risk 99%
    cvar95: number;          // Conditional VaR 95%
    cvar99: number;          // Conditional VaR 99%
    volatility: number;      // Annualized volatility
    sharpeRatio: number;     // Sharpe ratio
    maxDrawdown: number;     // Maximum drawdown
    beta: number;            // Beta vs market
    trackingError: number;   // Tracking error vs benchmark
}

export interface FactorExposure {
    factor: string;
    exposure: number;        // Factor loading
    contribution: number;    // Contribution to risk
    tStat: number;           // t-statistic
}

export interface ScenarioResult {
    scenarioId: string;
    scenarioName: string;
    portfolioValue: number;
    pnl: number;
    pnlPercent: number;
    var95: number;
    cvar95: number;
    maxDrawdown: number;
    factorExposures: FactorExposure[];
    stressDetails: StressDetail[];
}

export interface StressDetail {
    factor: string;
    shock: number;           // Shock magnitude
    portfolioImpact: number; // Portfolio P&L impact
    factorContribution: number;
}

export interface AttributionResult {
    period: { start: string; end: string };
    totalReturn: number;
    benchmarkReturn: number;
    activeReturn: number;
    attribution: AttributionBreakdown[];
}

export interface AttributionBreakdown {
    factor: string;
    allocationEffect: number;
    selectionEffect: number;
    interactionEffect: number;
    totalEffect: number;
}

export interface CorrelationMatrix {
    assets: string[];
    matrix: number[][];
    period: { start: string; end: string };
    method: 'pearson' | 'spearman' | 'kendall';
}

export interface ScenarioParameters {
    name: string;
    description: string;
    shocks: Shock[];
    correlationOverrides?: CorrelationOverride[];
    numPaths?: number;
    timeHorizonDays: number;
}

export interface Shock {
    factor: string;
    magnitude: number;       // Standard deviations
    direction: 'up' | 'down' | 'both';
}

export interface CorrelationOverride {
    factor1: string;
    factor2: string;
    correlation: number;
}

export class AnalyticsEngine {
    private static readonly RISK_FREE_RATE = 0.065; // 6.5% India risk-free
    private static readonly TRADING_DAYS = 252;

    /**
     * Calculate portfolio risk metrics (VaR, CVaR, volatility, etc.)
     */
    static async calculatePortfolioRisk(
        positions: PortfolioPosition[],
        lookbackDays = 252,
        confidenceLevels = [0.95, 0.99]
    ): Promise<RiskMetrics> {
        // Get historical prices for all assets
        const assetIds = positions.map(p => p.assetId);
        const priceHistory = await this.getPriceHistory(assetIds, lookbackDays);
        
        // Calculate returns matrix
        const returnsMatrix = this.calculateReturnsMatrix(priceHistory, assetIds);
        
        // Portfolio weights
        const totalValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
        const weights = positions.map(p => p.marketValue / totalValue);
        
        // Portfolio returns
        const portfolioReturns = this.calculatePortfolioReturns(returnsMatrix, weights);
        
        // Calculate risk metrics
        const sortedReturns = [...portfolioReturns].sort((a, b) => a - b);
        const n = sortedReturns.length;
        
        const metrics: RiskMetrics = {
            var95: 0,
            var99: 0,
            cvar95: 0,
            cvar99: 0,
            volatility: 0,
            sharpeRatio: 0,
            maxDrawdown: 0,
            beta: 1,
            trackingError: 0
        };
        
        // VaR at different confidence levels
        for (const cl of confidenceLevels) {
            const index = Math.floor((1 - cl) * n);
            const varValue = -sortedReturns[index] * Math.sqrt(this.TRADING_DAYS) * totalValue;
            const cvarValue = -sortedReturns.slice(0, index + 1).reduce((a, b) => a + b, 0) / (index + 1) * Math.sqrt(this.TRADING_DAYS) * totalValue;
            
            if (cl === 0.95) {
                metrics.var95 = varValue;
                metrics.cvar95 = cvarValue;
            } else if (cl === 0.99) {
                metrics.var99 = varValue;
                metrics.cvar99 = cvarValue;
            }
        }
        
        // Volatility (annualized)
        const meanReturn = portfolioReturns.reduce((a, b) => a + b, 0) / n;
        const variance = portfolioReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (n - 1);
        metrics.volatility = Math.sqrt(variance * this.TRADING_DAYS);
        
        // Sharpe ratio
        const portfolioReturn = Math.pow(1 + meanReturn, this.TRADING_DAYS) - 1;
        metrics.sharpeRatio = (portfolioReturn - this.RISK_FREE_RATE) / metrics.volatility;
        
        // Max drawdown
        metrics.maxDrawdown = this.calculateMaxDrawdown(portfolioReturns);
        
        // Beta and tracking error (would need benchmark data)
        // Placeholder for now
        metrics.beta = 1.0;
        metrics.trackingError = 0;
        
        return metrics;
    }

    /**
     * Run Monte Carlo scenario analysis
     */
    static async runScenarioAnalysis(
        positions: PortfolioPosition[],
        scenario: ScenarioParameters
    ): Promise<ScenarioResult> {
        const { rows: priceHistory } = await query(
            `SELECT asset_id, date, price FROM asset_price_history 
             WHERE asset_id = ANY($1) AND date >= NOW() - INTERVAL '2 years'
             ORDER BY asset_id, date`,
            [positions.map(p => p.assetId)]
        );

        const priceData = this.organizePriceData(priceHistory.rows);
        const totalValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
        const weights = positions.map(p => p.marketValue / totalValue);

        // Generate correlation matrix from historical data
        const correlationMatrix = this.calculateCorrelationMatrix(priceData);
        
        // Apply correlation overrides from scenario
        if (scenario.correlationOverrides) {
            for (const override of scenario.correlationOverrides) {
                // Apply correlation override
            }
        }

        // Cholesky decomposition for correlated random generation
        const chol = this.choleskyDecomposition(correlationMatrix);
        const numAssets = positions.length;
        const numPaths = scenario.numPaths || 10000;
        const dt = scenario.timeHorizonDays / this.TRADING_DAYS;
        const sqrtDt = Math.sqrt(dt);

        const results: number[] = [];
        const factorImpacts: Map<string, number[]> = new Map();
        scenario.shocks.forEach(s => factorImpacts.set(s.factor, []));

        for (let path = 0; path < numPaths; path++) {
            // Generate correlated random returns
            const randomShocks = this.generateCorrelatedShocks(chol, numAssets, scenario.shocks);
            
            // Calculate portfolio P&L for this path
            let pathPnL = 0;
            for (let i = 0; i < numAssets; i++) {
                const assetReturn = randomShocks[i];
                const positionValue = positions[i].marketValue;
                const assetPnL = positionValue * assetReturn;
                pathPnL += assetPnL;
                
                // Track factor impacts
                if (scenario.shocks[i]) {
                    const factorName = scenario.shocks[i].factor;
                    const impacts = factorImpacts.get(factorName) || [];
                    impacts.push(positionValue * assetReturn);
                    factorImpacts.set(factorName, impacts);
                }
            }
            results.push(pathPnL);
        }

        // Calculate statistics
        const sortedPnL = results.sort((a, b) => a - b);
        const n = results.length;
        const var95Index = Math.floor(0.05 * n);
        const var95 = -sortedPnL[var95Index];
        const cvar95 = -sortedPnL.slice(0, var95Index + 1).reduce((a, b) => a + b, 0) / (var95Index + 1);

        // Factor contributions
        const factorExposures = [];
        for (const [factor, impacts] of factorImpacts) {
            const avgImpact = impacts.reduce((a, b) => a + b, 0) / impacts.length;
            factorExposures.push({
                factor,
                exposure: avgImpact,
                contribution: avgImpact,
                tStat: avgImpact / (Math.sqrt(impacts.reduce((sum, v) => sum + Math.pow(v - avgImpact, 2), 0) / (impacts.length - 1)) / Math.sqrt(impacts.length))
            });
        }

        return {
            scenarioId: uuidv4(),
            scenarioName: scenario.name,
            portfolioValue: totalValue,
            pnl: results.reduce((a, b) => a + b, 0) / n,
            pnlPercent: (results.reduce((a, b) => a + b, 0) / n) / totalValue * 100,
            var95,
            cvar95,
            maxDrawdown: 0, // Would need path-by-path drawdown
            factorExposures,
            stressDetails: scenario.shocks.map(s => ({
                factor: s.factor,
                shock: s.magnitude,
                portfolioImpact: factorImpacts.get(s.factor)?.reduce((a, b) => a + b, 0) / factorImpacts.get(s.factor)?.length || 0,
                factorContribution: 0
            }))
        };
    }

    /**
     * Run custom stress test
     */
    static async runStressTest(
        positions: PortfolioPosition[],
        stresses: StressDetail[]
    ): Promise<{ totalImpact: number; details: StressDetail[] }> {
        let totalImpact = 0;
        const details: StressDetail[] = [];

        for (const stress of stresses) {
            // Find affected positions
            const affectedPositions = positions.filter(p => 
                p.methodology === stress.factor || 
                p.registry === stress.factor ||
                p.vintage === parseInt(stress.factor)
            );

            let positionImpact = 0;
            for (const pos of affectedPositions) {
                const positionValue = pos.marketValue;
                const shockReturn = stress.shock / 100; // Convert percentage to decimal
                positionImpact += positionValue * shockReturn;
            }

            totalImpact += positionImpact;
            details.push({
                ...stress,
                portfolioImpact: positionImpact
            });
        }

        return { totalImpact, details };
    }

    /**
     * Calculate performance attribution (Brinson-Hood-Beebower)
     */
    static async calculateAttribution(
        portfolioPositions: PortfolioPosition[],
        benchmarkPositions: PortfolioPosition[],
        startDate: string,
        endDate: string
    ): Promise<AttributionResult> {
        // Get returns for portfolio and benchmark
        const portfolioReturns = await this.getPortfolioReturns(portfolioPositions, startDate, endDate);
        const benchmarkReturns = await this.getPortfolioReturns(benchmarkPositions, startDate, endDate);

        const portfolioReturn = portfolioReturns.reduce((a, b) => a + b, 0);
        const benchmarkReturn = benchmarkReturns.reduce((a, b) => a + b, 0);
        const activeReturn = portfolioReturn - benchmarkReturn;

        // Group by factor (methodology, vintage, registry, geography)
        const factors = ['methodology', 'vintage', 'registry', 'geography_country'];
        const attribution: AttributionBreakdown[] = [];

        for (const factor of factors) {
            // Group portfolio and benchmark by factor
            const portfolioGroups = this.groupByFactor(portfolioPositions, factor);
            const benchmarkGroups = this.groupByFactor(benchmarkPositions, factor);

            let allocationEffect = 0;
            let selectionEffect = 0;
            let interactionEffect = 0;

            for (const groupName of new Set([...portfolioGroups.keys(), ...benchmarkGroups.keys()])) {
                const pWeight = portfolioGroups.get(groupName)?.weight || 0;
                const bWeight = benchmarkGroups.get(groupName)?.weight || 0;
                const pReturn = portfolioGroups.get(groupName)?.return || 0;
                const bReturn = benchmarkGroups.get(groupName)?.return || 0;

                allocationEffect += (pWeight - bWeight) * (bReturn - benchmarkReturn);
                selectionEffect += bWeight * (pReturn - bReturn);
                interactionEffect += (pWeight - bWeight) * (pReturn - bReturn);
            }

            attribution.push({
                factor,
                allocationEffect,
                selectionEffect,
                interactionEffect,
                totalEffect: allocationEffect + selectionEffect + interactionEffect
            });
        }

        const portfolioValue = portfolioPositions.reduce((sum, p) => sum + p.marketValue, 0);
        const benchmarkValue = benchmarkPositions.reduce((sum, p) => sum + p.marketValue, 0);

        return {
            period: { start: startDate, end: endDate },
            totalReturn: portfolioReturn,
            benchmarkReturn,
            activeReturn,
            attribution
        };
    }

    /**
     * Calculate dynamic correlation matrix (EWMA)
     */
    static async calculateCorrelationMatrix(
        assetIds: string[],
        lookbackDays = 126,
        lambda = 0.94
    ): Promise<CorrelationMatrix> {
        const { rows } = await query(
            `SELECT asset_id, date, price FROM asset_price_history 
             WHERE asset_id = ANY($1) AND date >= NOW() - INTERVAL '${lookbackDays} days'
             ORDER BY asset_id, date`,
            [assetIds]
        );

        // Organize price data by asset
        const priceData = this.organizePriceData(rows);
        const returnsData: Record<string, number[]> = {};

        for (const [assetId, prices] of Object.entries(priceData)) {
            returnsData[assetId] = this.calculateReturns(prices);
        }

        // EWMA correlation
        const assets = Object.keys(returnsData);
        const n = assets.length;
        const matrix: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));
        const means: number[] = [];
        const vars: number[] = [];
        const covars: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));

        // Calculate EWMA means and variances
        for (let i = 0; i < n; i++) {
            const returns = returnsData[assets[i]] || [];
            if (returns.length === 0) {
                means[i] = 0;
                vars[i] = 0;
                continue;
            }

            let ewmaMean = returns[0];
            let ewmaVar = 0;
            for (const r of returns) {
                ewmaMean = lambda * ewmaMean + (1 - lambda) * r;
                ewmaVar = lambda * ewmaVar + (1 - lambda) * Math.pow(r - ewmaMean, 2);
            }
            means[i] = ewmaMean;
            vars[i] = ewmaVar;
        }

        // Calculate EWMA covariances
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) {
                    matrix[i][j] = 1;
                    covars[i][j] = vars[i];
                    continue;
                }

                const returnsI = returnsData[assets[i]] || [];
                const returnsJ = returnsData[assets[j]] || [];
                const minLen = Math.min(returnsI.length, returnsJ.length);

                if (minLen === 0) {
                    matrix[i][j] = 0;
                    covars[i][j] = 0;
                    continue;
                }

                let ewmaCov = (returnsI[0] - means[i]) * (returnsJ[0] - means[j]);
                for (let k = 1; k < minLen; k++) {
                    ewmaCov = lambda * ewmaCov + (1 - lambda) * 
                        (returnsI[k] - means[i]) * (returnsJ[k] - means[j]);
                }
                covars[i][j] = ewmaCov;
                matrix[i][j] = ewmaCov / Math.sqrt(vars[i] * vars[j]);
            }
        }

        return {
            assets,
            matrix,
            period: { 
                start: new Date(Date.now() - lookbackDays * 86400000).toISOString(),
                end: new Date().toISOString()
            },
            method: 'ewma'
        };
    }

    // ============ HELPER METHODS ============

    private static async getPriceHistory(assetIds: string[], lookbackDays: number) {
        const { rows } = await query(
            `SELECT asset_id, date, price FROM asset_price_history 
             WHERE asset_id = ANY($1) AND date >= NOW() - INTERVAL '${lookbackDays} days'
             ORDER BY asset_id, date`,
            [assetIds]
        );
        return rows;
    }

    private static organizePriceData(rows: any[]): Record<string, {date: string, price: number}[]> {
        const data: Record<string, {date: string, price: number}[]> = {};
        for (const row of rows) {
            if (!data[row.asset_id]) data[row.asset_id] = [];
            data[row.asset_id].push({ date: row.date, price: parseFloat(row.price) });
        }
        return data;
    }

    private static calculateReturnsMatrix(priceData: Record<string, {date: string, price: number}[]>, assetIds: string[]): number[][] {
        const matrix: number[][] = [];
        for (const assetId of assetIds) {
            const prices = priceData[assetId] || [];
            const returns = this.calculateReturns(prices.map(p => p.price));
            matrix.push(returns);
        }
        return matrix;
    }

    private static calculateReturns(prices: number[]): number[] {
        const returns = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push((prices[i] - prices[i-1]) / prices[i-1]);
        }
        return returns;
    }

    private static calculatePortfolioReturns(returnsMatrix: number[][], weights: number[]): number[] {
        const n = returnsMatrix[0]?.length || 0;
        const portfolioReturns = new Array(n).fill(0);
        
        for (let i = 0; i < returnsMatrix.length; i++) {
            for (let j = 0; j < n; j++) {
                portfolioReturns[j] += returnsMatrix[i][j] * weights[i];
            }
        }
        return portfolioReturns;
    }

    private static calculateMaxDrawdown(returns: number[]): number {
        let peak = 1;
        let maxDD = 0;
        let cumulative = 1;

        for (const r of returns) {
            cumulative *= (1 + r);
            if (cumulative > peak) peak = cumulative;
            const dd = (peak - cumulative) / peak;
            if (dd > maxDD) maxDD = dd;
        }
        return maxDD;
    }

    private static calculateCorrelationMatrix(priceData: Record<string, {date: string, price: number}[]>): number[][] {
        const assets = Object.keys(priceData);
        const n = assets.length;
        const returnsData: Record<string, number[]> = {};

        for (const assetId of assets) {
            const prices = priceData[assetId].map(p => p.price);
            returnsData[assetId] = this.calculateReturns(prices);
        }

        const matrix = Array(n).fill(0).map(() => Array(n).fill(0));
        
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) {
                    matrix[i][j] = 1;
                    continue;
                }
                const returnsI = returnsData[assets[i]] || [];
                const returnsJ = returnsData[assets[j]] || [];
                const minLen = Math.min(returnsI.length, returnsJ.length);
                
                if (minLen < 2) {
                    matrix[i][j] = 0;
                    continue;
                }

                const meanI = returnsI.slice(0, minLen).reduce((a, b) => a + b, 0) / minLen;
                const meanJ = returnsJ.slice(0, minLen).reduce((a, b) => a + b, 0) / minLen;
                
                let cov = 0;
                for (let k = 0; k < minLen; k++) {
                    cov += (returnsI[k] - meanI) * (returnsJ[k] - meanJ);
                }
                cov /= minLen - 1;
                
                const stdI = Math.sqrt(returnsI.slice(0, minLen).reduce((s, v) => s + Math.pow(v - meanI, 2), 0) / (minLen - 1));
                const stdJ = Math.sqrt(returnsJ.slice(0, minLen).reduce((s, v) => s + Math.pow(v - meanJ, 2), 0) / (minLen - 1));
                
                matrix[i][j] = stdI * stdJ > 0 ? cov / (stdI * stdJ) : 0;
            }
        }

        return matrix;
    }

    private static choleskyDecomposition(matrix: number[][]): number[][] {
        const n = matrix.length;
        const L = Array(n).fill(0).map(() => Array(n).fill(0));

        for (let i = 0; i < n; i++) {
            for (let j = 0; j <= i; j++) {
                let sum = 0;
                for (let k = 0; k < j; k++) {
                    sum += L[i][k] * L[j][k];
                }
                if (i === j) {
                    L[i][j] = Math.sqrt(Math.max(0, matrix[i][i] - sum));
                } else {
                    L[i][j] = (matrix[i][j] - sum) / L[j][j];
                }
            }
        }
        return L;
    }

    private static generateCorrelatedShocks(
        chol: number[][],
        numAssets: number,
        shocks: Shock[]
    ): number[] {
        const z = Array(numAssets).fill(0).map(() => this.boxMullerTransform());
        
        // Apply shocks
        for (const shock of shocks) {
            // Find asset index for this shock factor
            // This is simplified - in production, map shock factors to asset indices
        }

        // Multiply Cholesky * z
        const correlated = Array(shock.length).fill(0);
        for (let i = 0; i < chol.length; i++) {
            let sum = 0;
            for (let j = 0; j <= i; j++) {
                sum += chol[i][j] * z[j];
            }
            correlated[i] = sum;
        }

        return correlated;
    }

    private static boxMullerTransform(): number {
        const u1 = Math.random();
        const u2 = Math.random();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }

    private static getPortfolioReturns(positions: PortfolioPosition[], startDate: string, endDate: string): Promise<number[]> {
        // Simplified - would fetch actual returns from price history
        return Promise.resolve([]);
    }

    private static groupByFactor(positions: PortfolioPosition[], factor: string): Map<string, {weight: number, return: number}> {
        const groups = new Map<string, {weight: number, return: number}>();
        const totalValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
        
        for (const pos of positions) {
            const key = (pos as any)[factor] || 'Unknown';
            if (!groups.has(key)) {
                groups.set(key, { weight: 0, return: 0 });
            }
            const group = groups.get(key)!;
            group.weight += pos.marketValue / totalValue;
            // Return would come from price history - simplified here
        }
        return groups;
    }
}

import { v4 as uuidv4 } from 'uuid';

export default AnalyticsEngine;