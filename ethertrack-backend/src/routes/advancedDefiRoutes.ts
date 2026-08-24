// Advanced DeFi Primitives API Routes
// Carbon Perpetuals, Options, Structured Products, Insurance endpoints

import { Router, Request, Response } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { query } from '../db/pool.js';

const router = Router();

// ============================================
// Carbon Perpetuals Routes
// ============================================

/**
 * Create perpetual market
 * POST /api/defi/perpetuals/markets
 */
router.post('/perpetuals/markets', requireAuth, requireRole(['ADMIN', 'DEFI_ADMIN']), async (req: Request, res: Response) => {
    try {
        const config = req.body;
        // Validation would go here
        
        const { rows } = await query(
            `INSERT INTO perpetual_markets 
             (market_id, underlying_asset, asset_id, quote_asset, funding_rate_cap, funding_interval,
              mark_price_source, oracle_address, twap_window, maintenance_margin_ratio, initial_margin_ratio,
              max_leverage, tick_size, lot_size, maker_fee_bps, taker_fee_bps, insurance_fund_address,
              auto_deleveraging_enabled, active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, true)
             RETURNING *`,
            [
                config.marketId, config.underlyingAsset, config.assetId, config.quoteAsset,
                config.fundingRateCap, config.fundingInterval, config.markPriceSource,
                config.oracleAddress, config.twapWindow, config.maintenanceMarginRatio,
                config.initialMarginRatio, config.maxLeverage, config.tickSize, config.lotSize,
                config.makerFeeBps, config.takerFeeBps, config.insuranceFundAddress,
                config.autoDeleveragingEnabled
            ]
        );
        
        res.status(201).json(rows[0]);
    } catch (error) {
        console.error('Perpetual market creation error:', error);
        res.status(500).json({ error: 'Failed to create perpetual market' });
    }
});

/**
 * Get perpetual markets
 * GET /api/defi/perpetuals/markets
 */
router.get('/perpetuals/markets', requireAuth, async (req: Request, res: Response) => {
    try {
        const { active, limit = 50, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM perpetual_markets';
        const params: any[] = [];
        let paramIndex = 1;
        
        if (active !== undefined) {
            sql += ` WHERE active = $${paramIndex++}`;
            params.push(active === 'true');
        }
        
        sql += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(parseInt(limit as string), parseInt(offset as string));
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('Perpetual markets fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch perpetual markets' });
    }
});

/**
 * Get perpetual market by ID
 * GET /api/defi/perpetuals/markets/:marketId
 */
router.get('/perpetuals/markets/:marketId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { marketId } = req.params;
        const { rows } = await query('SELECT * FROM perpetual_markets WHERE market_id = $1', [marketId]);
        
        if (!rows.length) {
            return res.status(404).json({ error: 'Market not found' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        console.error('Perpetual market fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch perpetual market' });
    }
});

/**
 * Get perpetual positions for trader
 * GET /api/defi/perpetuals/positions
 */
router.get('/perpetuals/positions', requireAuth, async (req: Request, res: Response) => {
    try {
        const { trader, marketId, status, limit = 50, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM perpetual_positions WHERE 1=1';
        const params: any[] = [];
        let paramIndex = 1;
        
        if (trader) {
            sql += ` AND trader_address = $${paramIndex++}`;
            params.push(trader);
        }
        
        if (marketId) {
            sql += ` AND market_id = $${paramIndex++}`;
            params.push(marketId);
        }
        
        if (status) {
            sql += ` AND status = $${paramIndex++}`;
            params.push(status);
        }
        
        sql += ` ORDER BY opened_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(parseInt(limit as string), parseInt(offset as string));
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('Perpetual positions fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch perpetual positions' });
    }
});

/**
 * Get perpetual funding rates
 * GET /api/defi/perpetuals/funding/:marketId
 */
router.get('/perpetuals/funding/:marketId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { marketId } = req.params;
        const { limit = 100 } = req.query;
        
        const { rows } = await query(
            'SELECT * FROM perpetual_funding_rates WHERE market_id = $1 ORDER BY timestamp DESC LIMIT $2',
            [marketId, parseInt(limit as string)]
        );
        
        res.json(rows);
    } catch (error) {
        console.error('Perpetual funding rates fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch funding rates' });
    }
});

/**
 * Get perpetual price feed
 * GET /api/defi/perpetuals/price/:marketId
 */
router.get('/perpetuals/price/:marketId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { marketId } = req.params;
        const { rows } = await query('SELECT * FROM perpetual_price_feed WHERE market_id = $1', [marketId]);
        
        if (!rows.length) {
            return res.status(404).json({ error: 'Price feed not found' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        console.error('Perpetual price fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch price feed' });
    }
});

// ============================================
// Carbon Options Routes
// ============================================

/**
 * Create option market
 * POST /api/defi/options/markets
 */
router.post('/options/markets', requireAuth, requireRole(['ADMIN', 'DEFI_ADMIN']), async (req: Request, res: Response) => {
    try {
        const config = req.body;
        
        const { rows } = await query(
            `INSERT INTO option_markets 
             (market_id, underlying_asset, asset_id, quote_asset, option_style, settlement_type,
              min_order_size, tick_size, maker_fee_bps, taker_fee_bps, exercise_fee_bps, active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
             RETURNING *`,
            [
                config.marketId, config.underlyingAsset, config.assetId, config.quoteAsset,
                config.optionStyle, config.settlementType, config.minOrderSize,
                config.tickSize, config.makerFeeBps, config.takerFeeBps, config.exerciseFeeBps
            ]
        );
        
        res.status(201).json(rows[0]);
    } catch (error) {
        console.error('Option market creation error:', error);
        res.status(500).json({ error: 'Failed to create option market' });
    }
});

/**
 * Create option series
 * POST /api/defi/options/series
 */
router.post('/options/series', requireAuth, requireRole(['ADMIN', 'DEFI_ADMIN']), async (req: Request, res: Response) => {
    try {
        const config = req.body;
        
        const { rows } = await query(
            `INSERT INTO option_series 
             (series_id, market_id, is_call, strike_price, expiry, status)
             VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
             RETURNING *`,
            [config.seriesId, config.marketId, config.isCall, config.strikePrice, config.expiry]
        );
        
        res.status(201).json(rows[0]);
    } catch (error) {
        console.error('Option series creation error:', error);
        res.status(500).json({ error: 'Failed to create option series' });
    }
});

/**
 * Get option series
 * GET /api/defi/options/series
 */
router.get('/options/series', requireAuth, async (req: Request, res: Response) => {
    try {
        const { marketId, isCall, status, expiryBefore, expiryAfter, limit = 50, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM option_series WHERE 1=1';
        const params: any[] = [];
        let paramIndex = 1;
        
        if (marketId) {
            sql += ` AND market_id = $${paramIndex++}`;
            params.push(marketId);
        }
        
        if (isCall !== undefined) {
            sql += ` AND is_call = $${paramIndex++}`;
            params.push(isCall === 'true');
        }
        
        if (status) {
            sql += ` AND status = $${paramIndex++}`;
            params.push(status);
        }
        
        if (expiryBefore) {
            sql += ` AND expiry <= $${paramIndex++}`;
            params.push(parseInt(expiryBefore as string));
        }
        
        if (expiryAfter) {
            sql += ` AND expiry >= $${paramIndex++}`;
            params.push(parseInt(expiryAfter as string));
        }
        
        sql += ` ORDER BY expiry ASC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(parseInt(limit as string), parseInt(offset as string));
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('Option series fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch option series' });
    }
});

/**
 * Get option positions for trader
 * GET /api/defi/options/positions
 */
router.get('/options/positions', requireAuth, async (req: Request, res: Response) => {
    try {
        const { trader, seriesId, limit = 50, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM option_positions WHERE 1=1';
        const params: any[] = [];
        let paramIndex = 1;
        
        if (trader) {
            sql += ` AND trader_address = $${paramIndex++}`;
            params.push(trader);
        }
        
        if (seriesId) {
            sql += ` AND series_id = $${paramIndex++}`;
            params.push(seriesId);
        }
        
        sql += ` ORDER BY opened_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(parseInt(limit as string), parseInt(offset as string));
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('Option positions fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch option positions' });
    }
});

// ============================================
// Structured Products Routes
// ============================================

/**
 * Create structured product
 * POST /api/defi/structured-products
 */
router.post('/structured-products', requireAuth, requireRole(['ADMIN', 'DEFI_ADMIN', 'PRODUCT_MANAGER']), async (req: Request, res: Response) => {
    try {
        const config = req.body;
        
        const { rows } = await query(
            `INSERT INTO structured_products 
             (product_id, name, description, product_type, quote_asset, maturity, capital_protection,
              participation_rate, coupon_rate, barrier_level, barrier_type, autocall_trigger,
              autocall_frequency, early_redemption_enabled, management_fee_bps, performance_fee_bps,
              min_investment, max_investment, subscription_start, subscription_end, fee_recipient)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
             RETURNING *`,
            [
                config.productId, config.name, config.description, config.productType,
                config.quoteAsset, config.maturity, config.capitalProtection,
                config.participationRate, config.couponRate, config.barrierLevel,
                config.barrierType, config.autocallTrigger, config.autocallFrequency,
                config.earlyRedemptionEnabled, config.managementFeeBps, config.performanceFeeBps,
                config.minInvestment, config.maxInvestment, config.subscriptionStart,
                config.subscriptionEnd, config.feeRecipient
            ]
        );
        
        res.status(201).json(rows[0]);
    } catch (error) {
        console.error('Structured product creation error:', error);
        res.status(500).json({ error: 'Failed to create structured product' });
    }
});

/**
 * Get structured products
 * GET /api/defi/structured-products
 */
router.get('/structured-products', requireAuth, async (req: Request, res: Response) => {
    try {
        const { status, productType, limit = 50, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM structured_products WHERE 1=1';
        const params: any[] = [];
        let paramIndex = 1;
        
        if (status) {
            sql += ` AND status = $${paramIndex++}`;
            params.push(status);
        }
        
        if (productType) {
            sql += ` AND product_type = $${paramIndex++}`;
            params.push(productType);
        }
        
        sql += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(parseInt(limit as string), parseInt(offset as string));
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('Structured products fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch structured products' });
    }
});

/**
 * Get structured product with underlyings
 * GET /api/defi/structured-products/:productId
 */
router.get('/structured-products/:productId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { productId } = req.params;
        
        const [product, underlyings] = await Promise.all([
            query('SELECT * FROM structured_products WHERE product_id = $1', [productId]),
            query('SELECT * FROM structured_product_underlyings WHERE product_id = $1', [productId])
        ]);
        
        if (!product.rows.length) {
            return res.status(404).json({ error: 'Product not found' });
        }
        
        res.json({ ...product.rows[0], underlyings: underlyings.rows });
    } catch (error) {
        console.error('Structured product fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch structured product' });
    }
});

/**
 * Subscribe to structured product
 * POST /api/defi/structured-products/:productId/subscribe
 */
router.post('/structured-products/:productId/subscribe', requireAuth, async (req: Request, res: Response) => {
    try {
        const { productId } = req.params;
        const { amount } = req.body;
        
        // In production, would call smart contract
        // For now, create subscription record
        const subscriptionId = `SUB-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        const { rows: product } = await query('SELECT * FROM structured_products WHERE product_id = $1', [productId]);
        if (!product.rows.length) {
            return res.status(404).json({ error: 'Product not found' });
        }
        
        const p = product.rows[0];
        const units = (amount * 1e18) / p.initial_nav;
        
        const { rows } = await query(
            `INSERT INTO structured_product_subscriptions 
             (subscription_id, investor_address, product_id, investment_amount, units, entry_nav, current_nav, status, subscribed_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $6, 'SUBSCRIBED', $7, $7)
             RETURNING *`,
            [subscriptionId, req.user.id, productId, amount, units, p.initial_nav, Date.now()]
        );
        
        res.status(201).json(rows[0]);
    } catch (error) {
        console.error('Structured product subscription error:', error);
        res.status(500).json({ error: 'Failed to subscribe' });
    }
});

/**
 * Get structured product subscriptions
 * GET /api/defi/structured-products/subscriptions
 */
router.get('/structured-products/subscriptions', requireAuth, async (req: Request, res: Response) => {
    try {
        const { investor, productId, status, limit = 50, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM structured_product_subscriptions WHERE 1=1';
        const params: any[] = [];
        let paramIndex = 1;
        
        if (investor) {
            sql += ` AND investor_address = $${paramIndex++}`;
            params.push(investor);
        } else {
            sql += ` AND investor_address = $${paramIndex++}`;
            params.push(req.user.id);
        }
        
        if (productId) {
            sql += ` AND product_id = $${paramIndex++}`;
            params.push(productId);
        }
        
        if (status) {
            sql += ` AND status = $${paramIndex++}`;
            params.push(status);
        }
        
        sql += ` ORDER BY subscribed_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(parseInt(limit as string), parseInt(offset as string));
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('Structured product subscriptions fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch subscriptions' });
    }
});

/**
 * Get NAV history
 * GET /api/defi/structured-products/:productId/nav
 */
router.get('/structured-products/:productId/nav', requireAuth, async (req: Request, res: Response) => {
    try {
        const { productId } = req.params;
        const { limit = 100 } = req.query;
        
        const { rows } = await query(
            'SELECT * FROM structured_product_nav_history WHERE product_id = $1 ORDER BY timestamp DESC LIMIT $2',
            [productId, parseInt(limit as string)]
        );
        
        res.json(rows);
    } catch (error) {
        console.error('NAV history fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch NAV history' });
    }
});

// ============================================
// Carbon Insurance Routes
// ============================================

/**
 * Create insurance pool
 * POST /api/defi/insurance/pools
 */
router.post('/insurance/pools', requireAuth, requireRole(['ADMIN', 'DEFI_ADMIN', 'INSURANCE_ADMIN']), async (req: Request, res: Response) => {
    try {
        const config = req.body;
        
        const { rows } = await query(
            `INSERT INTO insurance_pools 
             (pool_id, name, description, covered_risks, covered_assets, asset_ids, registries,
              quote_asset, premium_rate_bps, coverage_limit, deductible, policy_duration,
              claim_window, assessment_period, payout_currency, governance_token,
              capital_requirement, reinsurance_enabled, reinsurance_threshold, active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, true)
             RETURNING *`,
            [
                config.poolId, config.name, config.description, config.coveredRisks,
                config.coveredAssets, config.assetIds, config.registries,
                config.quoteAsset, config.premiumRateBps, config.coverageLimit,
                config.deductible, config.policyDuration, config.claimWindow,
                config.assessmentPeriod, config.payoutCurrency, config.governanceToken,
                config.capitalRequirement, config.reinsuranceEnabled, config.reinsuranceThreshold
            ]
        );
        
        res.status(201).json(rows[0]);
    } catch (error) {
        console.error('Insurance pool creation error:', error);
        res.status(500).json({ error: 'Failed to create insurance pool' });
    }
});

/**
 * Get insurance pools
 * GET /api/defi/insurance/pools
 */
router.get('/insurance/pools', requireAuth, async (req: Request, res: Response) => {
    try {
        const { active, limit = 50, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM insurance_pools WHERE 1=1';
        const params: any[] = [];
        let paramIndex = 1;
        
        if (active !== undefined) {
            sql += ` AND active = $${paramIndex++}`;
            params.push(active === 'true');
        }
        
        sql += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(parseInt(limit as string), parseInt(offset as string));
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('Insurance pools fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch insurance pools' });
    }
});

/**
 * Get pool solvency
 * GET /api/defi/insurance/pools/:poolId/solvency
 */
router.get('/insurance/pools/:poolId/solvency', requireAuth, async (req: Request, res: Response) => {
    try {
        const { poolId } = req.params;
        const { rows } = await query('SELECT * FROM insurance_pools WHERE pool_id = $1', [poolId]);
        
        if (!rows.length) {
            return res.status(404).json({ error: 'Pool not found' });
        }
        
        const pool = rows[0];
        const solvency = pool.total_coverage > 0 
            ? (pool.total_capital * 10000) / pool.total_coverage 
            : 10000;
        
        res.json({
            poolId,
            totalCapital: pool.total_capital,
            availableCapital: pool.available_capital,
            reservedCapital: pool.reserved_capital,
            totalCoverage: pool.total_coverage,
            solvencyRatio: solvency,
            solvencyPercent: (solvency / 100).toFixed(2) + '%',
            capitalRequirement: pool.capital_requirement,
            meetsRequirement: solvency >= pool.capital_requirement
        });
    } catch (error) {
        console.error('Pool solvency fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch pool solvency' });
    }
});

/**
 * Create insurance policy
 * POST /api/defi/insurance/policies
 */
router.post('/insurance/policies', requireAuth, async (req: Request, res: Response) => {
    try {
        const config = req.body;
        
        // Calculate premium
        const { rows: pool } = await query('SELECT * FROM insurance_pools WHERE pool_id = $1', [config.poolId]);
        if (!pool.length) {
            return res.status(404).json({ error: 'Pool not found' });
        }
        
        const p = pool[0];
        const premium = (config.coverageAmount * p.premium_rate_bps * p.policy_duration) / (10000 * 365 * 24 * 3600);
        
        const policyId = `POL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const startDate = Date.now();
        const endDate = startDate + p.policy_duration;
        
        const { rows } = await query(
            `INSERT INTO insurance_policies 
             (policy_id, pool_id, policyholder_address, covered_asset, asset_id, coverage_amount,
              premium, premium_paid, start_date, end_date, deductible, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, $10, 'ACTIVE')
             RETURNING *`,
            [
                policyId, config.poolId, req.user.id, config.coveredAsset, config.assetId,
                config.coverageAmount, premium, startDate, endDate, config.deductible || p.deductible
            ]
        );
        
        res.status(201).json(rows[0]);
    } catch (error) {
        console.error('Insurance policy creation error:', error);
        res.status(500).json({ error: 'Failed to create insurance policy' });
    }
});

/**
 * Get insurance policies
 * GET /api/defi/insurance/policies
 */
router.get('/insurance/policies', requireAuth, async (req: Request, res: Response) => {
    try {
        const { policyholder, poolId, status, limit = 50, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM insurance_policies WHERE 1=1';
        const params: any[] = [];
        let paramIndex = 1;
        
        if (policyholder) {
            sql += ` AND policyholder_address = $${paramIndex++}`;
            params.push(policyholder);
        } else {
            sql += ` AND policyholder_address = $${paramIndex++}`;
            params.push(req.user.id);
        }
        
        if (poolId) {
            sql += ` AND pool_id = $${paramIndex++}`;
            params.push(poolId);
        }
        
        if (status) {
            sql += ` AND status = $${paramIndex++}`;
            params.push(status);
        }
        
        sql += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(parseInt(limit as string), parseInt(offset as string));
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('Insurance policies fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch insurance policies' });
    }
});

/**
 * Submit insurance claim
 * POST /api/defi/insurance/claims
 */
router.post('/insurance/claims', requireAuth, async (req: Request, res: Response) => {
    try {
        const config = req.body;
        
        const claimId = `CLM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        const { rows } = await query(
            `INSERT INTO insurance_claims 
             (claim_id, policy_id, claimant_address, event_type, event_description, event_date,
              affected_amount, claimed_amount, evidence, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'SUBMITTED')
             RETURNING *`,
            [
                claimId, config.policyId, req.user.id, config.eventType,
                config.eventDescription, config.eventDate, config.affectedAmount,
                config.claimedAmount, config.evidence
            ]
        );
        
        // Update policy status
        await query(
            "UPDATE insurance_policies SET status = 'CLAIMED' WHERE policy_id = $1",
            [config.policyId]
        );
        
        res.status(201).json(rows[0]);
    } catch (error) {
        console.error('Insurance claim submission error:', error);
        res.status(500).json({ error: 'Failed to submit insurance claim' });
    }
});

/**
 * Get insurance claims
 * GET /api/defi/insurance/claims
 */
router.get('/insurance/claims', requireAuth, async (req: Request, res: Response) => {
    try {
        const { claimant, policyId, status, limit = 50, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM insurance_claims WHERE 1=1';
        const params: any[] = [];
        let paramIndex = 1;
        
        if (claimant) {
            sql += ` AND claimant_address = $${paramIndex++}`;
            params.push(claimant);
        } else {
            sql += ` AND claimant_address = $${paramIndex++}`;
            params.push(req.user.id);
        }
        
        if (policyId) {
            sql += ` AND policy_id = $${paramIndex++}`;
            params.push(policyId);
        }
        
        if (status) {
            sql += ` AND status = $${paramIndex++}`;
            params.push(status);
        }
        
        sql += ` ORDER BY submitted_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(parseInt(limit as string), parseInt(offset as string));
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('Insurance claims fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch insurance claims' });
    }
});

/**
 * Assess claim (assessor only)
 * POST /api/defi/insurance/claims/:claimId/assess
 */
router.post('/insurance/claims/:claimId/assess', requireAuth, requireRole(['ADMIN', 'CLAIMS_ASSESSOR']), async (req: Request, res: Response) => {
    try {
        const { claimId } = req.params;
        const { status, notes, payoutAmount } = req.body;
        
        const { rows } = await query(
            `UPDATE insurance_claims 
             SET status = $1, assessor_address = $2, assessment_notes = $3, 
                 payout_amount = $4, assessed_at = $5, updated_at = NOW()
             WHERE claim_id = $6
             RETURNING *`,
            [status, req.user.id, notes, payoutAmount, Date.now(), claimId]
        );
        
        if (!rows.length) {
            return res.status(404).json({ error: 'Claim not found' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        console.error('Claim assessment error:', error);
        res.status(500).json({ error: 'Failed to assess claim' });
    }
});

/**
 * Pay claim (assessor only)
 * POST /api/defi/insurance/claims/:claimId/pay
 */
router.post('/insurance/claims/:claimId/pay', requireAuth, requireRole(['ADMIN', 'CLAIMS_ASSESSOR']), async (req: Request, res: Response) => {
    try {
        const { claimId } = req.params;
        
        const { rows } = await query(
            `UPDATE insurance_claims 
             SET status = 'PAID', paid_at = $1, updated_at = NOW()
             WHERE claim_id = $2 AND status = 'APPROVED'
             RETURNING *`,
            [Date.now(), claimId]
        );
        
        if (!rows.length) {
            return res.status(404).json({ error: 'Claim not found or not approved' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        console.error('Claim payment error:', error);
        res.status(500).json({ error: 'Failed to pay claim' });
    }
});

// ============================================
// DeFi Risk Analytics
// ============================================

/**
 * Get portfolio risk metrics
 * GET /api/defi/risk/portfolio
 */
router.get('/risk/portfolio', requireAuth, async (req: Request, res: Response) => {
    try {
        const { trader } = req.query;
        const targetTrader = trader || req.user.id;
        
        // Fetch all positions
        const [perpPositions, optPositions, structSubs] = await Promise.all([
            query('SELECT * FROM perpetual_positions WHERE trader_address = $1 AND status = $2', [targetTrader, 'OPEN']),
            query('SELECT * FROM option_positions WHERE trader_address = $1 AND size > 0', [targetTrader]),
            query('SELECT * FROM structured_product_subscriptions WHERE investor_address = $1 AND status IN ($2, $3)', [targetTrader, 'ACTIVE', 'SUBSCRIBED'])
        ]);
        
        // Calculate aggregate risk metrics (simplified)
        const totalNotional = 
            perpPositions.rows.reduce((sum, p) => sum + parseFloat(p.size), 0) +
            optPositions.rows.reduce((sum, p) => sum + parseFloat(p.size) * parseFloat(p.current_premium) / 1e18, 0) +
            structSubs.rows.reduce((sum, s) => sum + parseFloat(s.investment_amount), 0);
        
        const totalMargin = perpPositions.rows.reduce((sum, p) => sum + parseFloat(p.margin), 0);
        
        res.json({
            trader: targetTrader,
            totalNotional,
            totalMargin,
            leverage: totalMargin > 0 ? totalNotional / totalMargin : 0,
            positionCounts: {
                perpetuals: perpPositions.rows.length,
                options: optPositions.rows.length,
                structuredProducts: structSubs.rows.length
            },
            // Simplified risk metrics
            var95: totalNotional * 0.05,
            var99: totalNotional * 0.08,
            maxDrawdown: totalNotional * 0.15,
            sharpeRatio: 1.5,
            positions: {
                perpetuals: perpPositions.rows,
                options: optPositions.rows,
                structuredProducts: structSubs.rows
            }
        });
    } catch (error) {
        console.error('Portfolio risk fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch portfolio risk' });
    }
});

/**
 * Run stress test
 * POST /api/defi/risk/stress-test
 */
router.post('/risk/stress-test', requireAuth, async (req: Request, res: Response) => {
    try {
        const { trader, scenarios } = req.body;
        const targetTrader = trader || req.user.id;
        
        // Default scenarios
        const defaultScenarios = [
            { name: 'Carbon Price -50%', shocks: { 'CARBON': -50 } },
            { name: 'Carbon Price +100%', shocks: { 'CARBON': 100 } },
            { name: 'Market Crash', shocks: { 'CARBON': -30, 'EQUITY': -40 } },
            { name: 'Regulatory Shock', shocks: { 'CARBON': -60 } },
            { name: 'Liquidity Crisis', shocks: { 'CARBON': -20, 'SPREAD': 500 } }
        ];
        
        const testScenarios = scenarios || defaultScenarios;
        
        // Fetch positions
        const [perpPositions, optPositions, structSubs] = await Promise.all([
            query('SELECT * FROM perpetual_positions WHERE trader_address = $1 AND status = $2', [targetTrader, 'OPEN']),
            query('SELECT * FROM option_positions WHERE trader_address = $1 AND size > 0', [targetTrader]),
            query('SELECT * FROM structured_product_subscriptions WHERE investor_address = $1 AND status IN ($2, $3)', [targetTrader, 'ACTIVE', 'SUBSCRIBED'])
        ]);
        
        const results = testScenarios.map(scenario => {
            let stressedPnl = 0;
            
            // Perpetual PnL
            for (const pos of perpPositions.rows) {
                const shock = scenario.shocks['CARBON'] || 0;
                const pnl = pos.is_long ? pos.size * shock / 100 : -pos.size * shock / 100;
                stressedPnl += pnl;
            }
            
            // Option PnL (simplified)
            for (const pos of optPositions.rows) {
                const shock = scenario.shocks['CARBON'] || 0;
                const delta = pos.delta_exposure || 0;
                const pnl = delta * shock / 100;
                stressedPnl += pnl;
            }
            
            // Structured products
            for (const sub of structSubs.rows) {
                const shock = scenario.shocks['CARBON'] || 0;
                const participation = 0.5; // Default 50%
                const pnl = sub.investment_amount * shock / 100 * participation;
                stressedPnl += pnl;
            }
            
            return {
                scenario: scenario.name,
                portfolioValue: totalNotional,
                stressedPnl,
                stressedValue: totalNotional + stressedPnl,
                pnlPercent: totalNotional > 0 ? (stressedPnl / totalNotional) * 100 : 0,
                marginCallRisk: stressedPnl < -totalNotional * 0.1,
                liquidationRisk: stressedPnl < -totalNotional * 0.2
            };
        });
        
        res.json({ trader: targetTrader, results });
    } catch (error) {
        console.error('Stress test error:', error);
        res.status(500).json({ error: 'Failed to run stress test' });
    }
});

export default router;