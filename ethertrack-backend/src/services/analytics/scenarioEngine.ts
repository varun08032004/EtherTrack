// Scenario Engine
// Monte Carlo simulation engine for scenario analysis and stress testing

import { v4 as uuidv4 } from 'uuid';
import { safeQuery as query, withTransaction } from '../../../db/pool.js';
import { AnalyticsEngine } from './analyticsEngine.js';

export interface Scenario {
    scenario_id: string;
    name: string;
    description: string;
    shocks: Shock[];
    correlation_overrides?: CorrelationOverride[];
    num_paths: number;
    time_horizon_days: number;
    created_by: string;
    created_at: string;
    updated_at: string;
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

export interface SimulationPath {
    path_id: number;
    returns: number[];        // Returns per asset
    portfolio_pnl: number;    // Portfolio P&L
    asset_pnls: number[];     // P&L per asset
    factor_impacts: Map<string, number>;
}

export interface SimulationResult {
    scenario_id: string;
    scenario_name: string;
    portfolio_value: number;
    paths: SimulationPath[];
    summary: {
        mean_pnl: number;
        std_pnl: number;
        var_95: number;
        var_99: number;
        cvar_95: number;
        cvar_99: number;
        max_drawdown: number;
        probability_of_loss: number;
        expected_shortfall: number;
    };
    factor_contributions: Map<string, number>;
    percentiles: Map<number, number>;
}

export interface StressTestResult {
    test_id: string;
    name: string;
    base_portfolio_value: number;
    stressed_value: number;
    total_impact: number;
    impact_percent: number;
    factor_impacts: FactorImpact[];
    worst_case_path: number[];
    recovery_time_estimate: number; // days
}

export interface FactorImpact {
    factor: string;
    shock_magnitude: number;
    portfolio_impact: number;
    affected_assets: string[];
    recovery_time_days: number;
}

export interface MonteCarloConfig {
    num_paths: number;
    time_horizon_days: number;
    confidence_levels: number[];
    random_seed?: number;
    antithetic_variates: boolean;
    control_variates: boolean;
}

export class ScenarioEngine {
    private static readonly TRADING_DAYS = 252;
    private static readonly DEFAULT_PATHS = 10000;
    private static readonly DEFAULT_HORIZON_DAYS = 30;

    /**
     * Run Monte Carlo simulation for portfolio
     */
    static async runMonteCarlo(
        portfolio: PortfolioPosition[],
        config: MonteCarloConfig = {}
    ): Promise<SimulationResult> {
        const {
            num_paths = this.DEFAULT_PATHS,
            time_horizon_days = this.DEFAULT_HORIZON_DAYS,
            confidence_levels = [0.95, 0.99],
            random_seed,
            antithetic_variates = true,
            control_variates = true
        } = config;

        // Set random seed for reproducibility
        if (random_seed) {
            Math.seedrandom(random_seed);
        }

        // Get portfolio positions with market data
        const positions = await this.enrichPositionsWithMarketData(portfolio);
        const totalValue = portfolio.reduce((sum, p) => sum + p.marketValue, 0);
        
        // Get historical returns for all assets
        const assetIds = portfolio.map(p => p.assetId);
        const { returnsMatrix, assetIds, meanReturns, covMatrix } = 
            await this.prepareReturnData(portfolio);

        // Cholesky decomposition for correlated sampling
        const chol = this.choleskyDecomposition(covMatrix);
        if (!chol) {
            throw new Error('Covariance matrix not positive definite');
        }

        const numAssets = portfolio.length;
        const dt = time_horizon_days / this.TRADING_DAYS;
        const sqrtDt = Math.sqrt(dt);

        // Pre-generate random numbers for all paths
        const randomNumbers = this.generateRandomNumbers(
            num_paths, 
            numAssets, 
            antithetic_variates
        );

        const paths: SimulationPath[] = [];
        const allPnLs: number[] = [];
        const assetPnLAccumulator: number[][] = Array(portfolio.length).fill(0).map(() => []);
        const factorImpacts = new Map<string, number[]>();

        // Initialize factor impacts tracking
        for (const pos of portfolio) {
            factorImpacts.set(pos.assetId, []);
        }

        // Run simulation
        for (let path = 0; path < num_paths; path++) {
            const pathResult = this.simulatePath(
                path,
                portfolio,
                returnsMatrix,
                chol,
                randomNumbers[path],
                dt,
                sqrtDt
            );

            paths.push(pathResult);
            allPnLs.push(pathResult.portfolio_pnl);
            
            // Accumulate asset P&Ls
            for (let i = 0; i < portfolio.length; i++) {
                assetPnLAccumulator[i].push(pathResult.asset_pnls[i]);
                
                // Track factor impacts (simplified - would map to actual factors)
                const factorImpacts = pathResult.factor_impacts || new Map();
                for (const [factor, impact] of factorImpacts) {
                    const existing = factorImpacts.get(positions[i].assetId) || [];
                    existing.push(impact);
                    factorImpacts.set(positions[i].assetId, existing);
                }
            }

            // Progress logging for long runs
            if (path % 1000 === 0) {
                console.log(`Simulation progress: ${path}/${num_paths}`);
            }
        }

        // Calculate summary statistics
        const summary = this.calculateSummaryStatistics(
            allPnLs,
            totalValue,
            confidenceLevels
        );

        // Calculate factor contributions
        const factorContributions = this.calculateFactorContributions(
            portfolio,
            paths
        );

        // Calculate percentiles
        const percentiles = this.calculatePercentiles(allPnLs);

        return {
            scenario_id: uuidv4(),
            scenario_name: 'Monte Carlo Simulation',
            portfolio_value: totalValue,
            paths,
            summary,
            factor_contributions: new Map(Object.entries(Object.fromEntries(factorContributions))),
            percentiles
        };
    }

    /**
     * Run historical scenario analysis (historical stress testing)
     */
    static async runHistoricalScenario(
        portfolio: PortfolioPosition[],
        historicalPeriod: { start: string; end: string },
        scalingFactor = 1.0
    ): Promise<ScenarioResult> {
        // Get historical returns for the period
        const { rows } = await query(
            `SELECT asset_id, date, price FROM asset_price_history 
             WHERE asset_id = ANY($1) AND date BETWEEN $2 AND $3
             ORDER BY asset_id, date`,
            [portfolio.map(p => p.assetId), historicalPeriod.start, historicalPeriod.end]
        );

        // Organize returns by asset
        const returnsByAsset = this.organizeHistoricalReturns(rows);
        
        // Simulate each historical day as a scenario path
        const paths: SimulationPath[] = [];
        const dates = this.getUniqueDates(rows);
        
        for (const date of dates) {
            const dailyReturns = this.getDailyReturns(date, rows);
            const portfolioValue = portfolio.reduce((sum, p) => sum + p.marketValue, 0);
            
            let portfolioPnL = 0;
            const assetPnLs: number[] = [];
            
            for (let i = 0; i < portfolio.length; i++) {
                const assetId = portfolio[i].assetId;
                const dailyReturn = dailyReturns[assetId] || 0;
                const assetPnL = portfolio[i].marketValue * dailyReturn;
                assetPnLs.push(assetPnL);
                portfolioPnL += assetPnL;
            }
            
            paths.push({
                path_id: paths.length,
                returns: portfolio.map(p => dailyReturns[p.assetId] || 0),
                portfolio_pnl: portfolioPnL,
                asset_pnls: assetPnLs,
                factor_impacts: new Map()
            });
        }

        // Calculate summary statistics
        const pnls = paths.map(p => p.portfolio_pnl);
        const summary = this.calculateSummaryStatistics(
            pnls.map(p => p.portfolio_pnl),
            portfolio.reduce((sum, p) => sum + p.marketValue, 0),
            [0.95, 0.99]
        );

        return {
            scenario_id: uuidv4(),
            scenario_name: `Historical: ${historicalPeriod.start} to ${historicalPeriod.end}`,
            portfolio_value: portfolio.reduce((sum, p) => sum + p.marketValue, 0),
            paths,
            summary: { ...summary },
            factor_contributions: new Map(),
            percentiles: new Map()
        };
    }

    /**
     * Run custom stress test with user-defined shocks
     */
    static async runStressTest(
        portfolio: PortfolioPosition[],
        shocks: StressShock[]
    ): Promise<StressTestResult> {
        const totalValue = portfolio.reduce((sum, p) => sum + p.marketValue, 0);
        let totalImpact = 0;
        const factorImpacts: FactorImpact[] = [];

        for (const shock of shocks) {
            // Find affected assets
            const affectedAssets = portfolio.filter(p => 
                this.assetMatchesShock(p, shock)
            );

            let factorImpact = 0;
            const affectedAssets: string[] = [];

            for (const asset of affectedAssets) {
                const positionValue = asset.marketValue;
                const shockReturn = this.calculateShockReturn(shock, asset);
                const impact = positionValue * shockReturn;
                
                factorImpact += impact;
            }

            factorImpacts.push({
                factor: shock.factor,
                shock_magnitude: shock.magnitude,
                portfolio_impact: factorImpact,
                affected_assets: affectedAssets.map(a => a.assetId),
                recovery_time_days: this.estimateRecoveryTime(shock)
            });

            totalImpact += factorImpact;
        }

        const totalValue = portfolio.reduce((sum, p) => sum + p.marketValue, 0);
        
        return {
            test_id: uuidv4(),
            name: 'Custom Stress Test',
            base_portfolio_value: totalValue,
            stressed_value: totalValue + totalImpact,
            total_impact: totalImpact,
            impact_percent: (totalImpact / totalValue) * 100,
            factor_impacts: factorImpacts,
            worst_case_path: [],
            recovery_time_estimate: Math.max(...factorImpacts.map(f => f.recovery_time_days))
        };
    }

    /**
     * Run predefined regulatory stress scenarios
     */
    static async runRegulatoryStressTests(
        portfolio: PortfolioPosition[]
    ): Promise<Record<string, StressTestResult>> {
        const scenarios = {
            'market_crash_2008': {
                name: '2008 Financial Crisis',
                shocks: [
                    { factor: 'equity_market', magnitude: -40, direction: 'down' },
                    { factor: 'credit_spreads', magnitude: 300, direction: 'up' }, // bps
                    { factor: 'liquidity', magnitude: -50, direction: 'down' }
                ]
            },
            'covid_crash_2020': {
                name: 'COVID-19 Market Crash',
                shocks: [
                    { factor: 'equity_market', magnitude: -35, direction: 'down' },
                    { factor: 'volatility', magnitude: 200, direction: 'up' }, // VIX spike
                    { factor: 'carbon_price', magnitude: -30, direction: 'down' }
                ]
            },
            'carbon_price_collapse': {
                name: 'Carbon Price Collapse',
                shocks: [
                    { factor: 'carbon_price', magnitude: -50, direction: 'down' },
                    { factor: 'demand', magnitude: -40, direction: 'down' }
                ]
            },
            'regulatory_shock': {
                name: 'Regulatory Policy Shock',
                shocks: [
                    { factor: 'policy_risk', magnitude: -25, direction: 'down' },
                    { factor: 'verification_cost', magnitude: 100, direction: 'up' }
                ]
            },
            'liquidity_crisis': {
                name: 'Liquidity Crisis',
                shocks: [
                    { factor: 'bid_ask_spread', magnitude: 500, direction: 'up' }, // bps
                    { factor: 'volume', magnitude: -60, direction: 'down' }
                ]
            }
        };

        const results: Record<string, StressTestResult> = {};

        for (const [key, scenario] of Object.entries(scenarios)) {
            const result = await this.runStressTest(portfolio, scenario.shocks);
            results[key] = { ...result, name: scenario.name };
        }

        return results;
    }

    /**
     * Calculate portfolio optimization (Mean-Variance / Risk Parity)
     */
    static async optimizePortfolio(
        currentPositions: PortfolioPosition[],
        objective: 'max_sharpe' | 'min_variance' | 'risk_parity' | 'max_return',
        constraints: {
            maxWeight?: number;
            minWeight?: number;
            maxTurnover?: number;
            sectorLimits?: Record<string, number>;
            esgConstraints?: Record<string, number>;
        } = {}
    ): Promise<{
        weights: number[];
        expectedReturn: number;
        expectedVolatility: number;
        sharpeRatio: number;
        weights: Map<string, number>;
    }> {
        // This would integrate with a proper optimization library
        // For now, return simplified equal-weight / risk parity
        
        const positions = await this.enrichPositionsWithMarketData(currentPositions);
        const n = positions.length;
        
        let weights: number[];
        
        switch (objective) {
            case 'risk_parity':
                // Risk parity: equal risk contribution
                const vols = positions.map(p => p.volatility || 0.3);
                const invVols = vols.map(v => 1 / v);
                const sumInvVol = invVols.reduce((a, b) => a + b, 0);
                weights = invVols.map(v => v / sumInvVol);
                break;
                
            case 'min_variance':
                // Simplified min variance - would use quadratic programming
                const equalWeight = 1 / n;
                weights = Array(n).fill(equalWeight);
                break;
                
            case 'max_sharpe':
                // Simplified max sharpe - would need expected returns
                const equalWeight = 1 / n;
                weights = Array(n).fill(equalWeight);
                break;
                
            default:
                weights = Array(n).fill(1 / n);
        }

        // Apply constraints
        if (constraints.maxWeight) {
            weights = weights.map(w => Math.min(w, constraints.maxWeight!));
            // Renormalize
            const sum = weights.reduce((a, b) => a + b, 0);
            weights = weights.map(w => w / sum);
        }

        // Calculate portfolio metrics
        const expectedReturn = positions.reduce((sum, p, i) => 
            sum + (p.expectedReturn || 0.08) * weights[i], 0
        );
        
        // Simplified volatility calculation
        const expectedVolatility = 0.25; // Placeholder
        const sharpeRatio = (expectedReturn - 0.065) / expectedVolatility;

        const weightMap = new Map<string, number>();
        positions.forEach((p, i) => weightMap.set(p.assetId, weights[i]));

        return {
            weights,
            expectedReturn,
            expectedVolatility,
            sharpeRatio,
            weights: weightMap
        };
    }

    // ============ PRIVATE HELPER METHODS ============

    private static async enrichPositionsWithMarketData(
        positions: PortfolioPosition[]
    ): Promise<PortfolioPosition[]> {
        const assetIds = positions.map(p => p.assetId);
        
        const { rows } = await query(
            `SELECT asset_id, last_traded_price, available_quantity, ecs_score, volatility
             FROM carbon_asset_passports
             WHERE asset_id = ANY($1)`,
            [assetIds]
        );

        const marketData = new Map(rows.map(r => [r.asset_id, r]));

        return positions.map(pos => ({
            ...pos,
            marketValue: pos.quantity * (marketData.get(pos.assetId)?.last_traded_price || 0),
            volatility: marketData.get(pos.assetId)?.volatility || 0.3,
            expectedReturn: 0.08 // Placeholder
        });
    }

    private static async prepareReturnData(portfolio: PortfolioPosition[]) {
        const assetIds = portfolio.map(p => p.assetId);
        
        const { rows } = await query(
            `SELECT asset_id, date, price FROM asset_price_history 
             WHERE asset_id = ANY($1) AND date >= NOW() - INTERVAL '2 years'
             ORDER BY asset_id, date`,
            [assetIds]
        );

        // Organize by asset
        const priceData: Record<string, {date: Date, price: number}[]> = {};
        for (const row of rows) {
            if (!priceData[row.asset_id]) priceData[row.asset_id] = [];
            priceData[row.asset_id].push({ date: row.date, price: parseFloat(row.price) });
        }

        // Calculate returns for each asset
        const assetIds = portfolio.map(p => p.assetId);
        const returnsMatrix: number[][] = [];
        const meanReturns: number[] = [];
        const assetIdsOrdered: string[] = [];

        for (const assetId of assetIds) {
            const prices = priceData[assetId] || [];
            const returns = this.calculateReturns(prices.map(p => p.price));
            
            // Pad or truncate to same length
            const minLength = Math.min(...portfolio.map(p => 
                (priceData[p.assetId] || []).length - 1
            ));
            
            const trimmedReturns = returns.slice(-250); // Last ~1 year
            assetIdsOrdered.push(assetId);
            returnsMatrix.push(trimmedReturns);
            
            const mean = trimmedReturns.reduce((a, b) => a + b, 0) / trimmedReturns.length;
            meanReturns.push(mean);
        }

        // Covariance matrix
        const n = returnsMatrix.length;
        const covMatrix = Array(n).fill(0).map(() => Array(n).fill(0));
        
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                const returnsI = returnsMatrix[i];
                const returnsJ = returnsMatrix[j];
                const minLen = Math.min(returnsI.length, returnsJ.length);
                
                let cov = 0;
                const meanI = returnsMatrix[i].reduce((a, b) => a + b, 0) / returnsMatrix[i].length;
                const meanJ = returnsMatrix[j].reduce((a, b) => a + b, 0) / returnsMatrix[j].length;
                
                for (let k = 0; k < minLen; k++) {
                    cov += (returnsMatrix[i][returnsMatrix[i].length - minLen + k] - meanReturns[i]) *
                           (returnsMatrix[j][returnsMatrix[j].length - minLen + k] - meanReturns[j]);
                }
                covMatrix[i][j] = cov / (minLen - 1);
            }
        }

        return { returnsMatrix, assetIds: assetIdsOrdered, meanReturns, covMatrix };
    }

    private static calculateReturns(prices: number[]): number[] {
        const returns = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push((prices[i] - prices[i-1]) / prices[i-1]);
        }
        return returns;
    }

    private static choleskyDecomposition(matrix: number[][]): number[][] | null {
        const n = matrix.length;
        const L = Array(matrix.length).fill(0).map(() => Array(matrix.length).fill(0));

        for (let i = 0; i < n; i++) {
            for (let j = 0; j <= i; j++) {
                let sum = 0;
                for (let k = 0; k < j; k++) {
                    sum += L[i][k] * L[j][k];
                }
                
                if (i === j) {
                    const val = matrix[i][i] - sum;
                    if (val <= 0) return null; // Not positive definite
                    L[i][j] = Math.sqrt(val);
                } else {
                    L[i][j] = (matrix[i][j] - sum) / L[j][j];
                }
            }
        }
        return L;
    }

    private static generateRandomNumbers(
        numPaths: number,
        numAssets: number,
        antithetic: boolean
    ): number[][][] {
        const randomNumbers: number[][][] = [];
        
        for (let path = 0; path < numPaths; path++) {
            const pathNumbers: number[][] = [];
            
            for (let asset = 0; asset < numAssets; asset++) {
                if (antithetic && Math.random() < 0.5) {
                    // Antithetic variate - will be paired with next path
                    const z = this.boxMullerTransform();
                    pathNumbers.push([z, -z]);
                } else {
                    pathNumbers.push([this.boxMullerTransform(), this.boxMullerTransform()]);
                }
            }
            
            randomNumbers.push(pathNumbers);
        }
        
        return randomNumbers;
    }

    private static boxMullerTransform(): number {
        const u1 = Math.random();
        const u2 = Math.random();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }

    private static simulatePath(
        path: number,
        portfolio: PortfolioPosition[],
        returnsMatrix: number[][],
        chol: number[][],
        randomNumbers: number[],
        dt: number,
        sqrtDt: number
    ): SimulationPath {
        const numAssets = portfolio.length;
        const returns: number[] = [];
        const assetPnLs: number[] = [];
        const factorImpacts = new Map<string, number>();

        // Generate correlated random shocks
        const shocks = new Array(portfolio.length).fill(0);
        for (let i = 0; i < portfolio.length; i++) {
            // Apply Cholesky decomposition for correlation
            let shock = 0;
            for (let j = 0; j <= i; j++) {
                shock += chol[i][j] * this.boxMullerTransform();
            }
            shocks[i] = shock;
        }

        // Apply shocks to generate returns
        for (let i = 0; i < portfolio.length; i++) {
            const drift = (portfolio[i].expectedReturn || 0.08) - 0.5 * Math.pow(portfolio[i].volatility || 0.3, 2);
            const diffusion = (portfolio[i].volatility || 0.3) * Math.sqrt(1/252);
            const randomShock = shocks[i];
            
            const dailyReturn = drift / 252 + diffusion * shocks[i];
            returns.push(dailyReturn);
            
            const pnl = portfolio[i].marketValue * dailyReturn;
            assetPnLs.push(pnl);
        }

        // Sum portfolio P&L
        const portfolioPnL = assetPnLs.reduce((a, b) => a + b, 0);

        return {
            path_id: path,
            returns,
            portfolio_pnl: portfolioPnL,
            asset_pnls: assetPnLs,
            factor_impacts: new Map()
        };
    }

    private static calculateSummaryStatistics(
        pnls: number[],
        totalValue: number,
        confidenceLevels: number[]
    ): SimulationResult['summary'] {
        const sorted = [...pnls].sort((a, b) => a - b);
        const n = sorted.length;
        const mean = pnls.reduce((a, b) => a + b, 0) / n;
        const variance = pnls.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / (n - 1);
        const std = Math.sqrt(variance);

        const summary: SimulationResult['summary'] = {
            mean_pnl: mean,
            std_pnl: Math.sqrt(variance),
            var_95: 0,
            var_99: 0,
            cvar_95: 0,
            cvar_99: 0,
            max_drawdown: 0,
            probability_of_loss: pnls.filter(x => x < 0).length / n,
            expected_shortfall: 0
        };

        for (const cl of confidenceLevels) {
            const index = Math.floor((1 - cl) * n);
            const varValue = -sorted[index];
            const cvarValue = -sorted.slice(0, index + 1).reduce((a, b) => a + b, 0) / (index + 1);

            if (cl === 0.95) {
                summary.var_95 = varValue;
                summary.cvar_95 = cvarValue;
            } else if (cl === 0.99) {
                summary.var_99 = varValue;
                summary.cvar_99 = cvarValue;
            }
        }

        summary.probability_of_loss = pnls.filter(x => x < 0).length / n;
        summary.expected_shortfall = summary.cvar_95;

        return summary;
    }

    private static calculateFactorContributions(
        portfolio: PortfolioPosition[],
        paths: SimulationPath[]
    ): Map<string, number> {
        const contributions = new Map<string, number>();
        
        // Simplified - in production would decompose P&L by risk factors
        // For now, return placeholder
        contributions.set('market', 0.6);
        contributions.set('carbon_price', 0.2);
        contributions.set('policy', 0.1);
        contributions.set('liquidity', 0.05);
        contributions.set('idiosyncratic', 0.05);
        
        return contributions;
    }

    private static calculatePercentiles(pnls: number[]): Map<number, number> {
        const sorted = [...pnls].sort((a, b) => a - b);
        const n = sorted.length;
        const percentiles = new Map<number, number>();
        
        const percentilesToCalc = [1, 5, 10, 25, 50, 75, 90, 95, 99];
        
        for (const p of percentilesToCalc) {
            const index = Math.floor((p / 100) * (n - 1));
            percentiles.set(p, sorted[index]);
        }
        
        return percentiles;
    }

    private static calculateShockReturn(shock: any, asset: PortfolioPosition): number {
        // Simplified shock calculation
        // In production, would map shock factors to asset sensitivities
        return shock.magnitude / 100 * (shock.direction === 'down' ? -1 : 1);
    }

    private static estimateRecoveryTime(shock: any): number {
        // Simplified recovery estimation
        const baseDays = Math.abs(shock.magnitude) * 2;
        return Math.max(30, baseDays);
    }

    private static assetMatchesShock(asset: PortfolioPosition, shock: any): boolean {
        // Check if asset is affected by this shock
        // Simplified - in production would have proper factor mapping
        if (shock.factor === 'carbon_price' && asset.instrument_type.includes('CCC')) return true;
        if (shock.factor === 'equity_market' && asset.assetType === 'VCM_CREDIT') return true;
        if (shock.factor === 'liquidity') return true; // Affects all
        return false;
    }

    private static organizeHistoricalReturns(rows: any[]): Record<string, number[]> {
        const returns: Record<string, number[]> = {};
        
        // Group by asset
        const byAsset: Record<string, {date: string, price: number}[]> = {};
        for (const row of rows) {
            if (!returns[row.asset_id]) returns[row.asset_id] = [];
        }
        
        // Calculate returns for each asset
        for (const [assetId, prices] of Object.entries(byAsset)) {
            const sorted = prices.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            const returns = [];
            for (let i = 1; i < sorted.length; i++) {
                returns.push((sorted[i].price - sorted[i-1].price) / sorted[i-1].price);
            }
            returns[assetId] = returns;
        }
        
        return returns;
    }

    private static getUniqueDates(rows: any[]): string[] {
        const dates = new Set(rows.map(r => r.date));
        return Array.from(dates).sort();
    }

    private static getDailyReturns(date: string, rows: any[]): Record<string, number> {
        const returns: Record<string, number> = {};
        const dayRows = rows.filter(r => r.date === date);
        
        // Group by asset and calculate daily return
        const byAsset: Record<string, {date: string, price: number}[]> = {};
        for (const row of dayRows) {
            if (!byAsset[row.asset_id]) byAsset[row.asset_id] = [];
            byAsset[row.asset_id].push({ date: row.date, price: row.price });
        }
        
        for (const [assetId, prices] of Object.entries(byAsset)) {
            if (prices.length >= 2) {
                const sorted = prices.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                const ret = (sorted[sorted.length-1].price - sorted[0].price) / sorted[0].price;
                returns[assetId] = ret;
            }
        }
        
        return returns;
    }

    private static getUniqueDates(rows: any[]): string[] {
        const dates = new Set(rows.map(r => r.date));
        return Array.from(dates).sort();
    }
}

export default ScenarioEngine;