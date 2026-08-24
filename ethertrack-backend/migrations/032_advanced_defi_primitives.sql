-- Migration: Add Advanced DeFi Primitives Tables
-- Created: 2024-01-15
-- Description: Tables for Carbon Perpetuals, Options, Structured Products, and Insurance

-- ============================================
-- Carbon Perpetuals
-- ============================================

CREATE TABLE IF NOT EXISTS perpetual_markets (
    id BIGSERIAL PRIMARY KEY,
    market_id VARCHAR(100) UNIQUE NOT NULL,
    underlying_asset VARCHAR(100) NOT NULL,
    asset_id BIGINT NOT NULL,
    quote_asset VARCHAR(100) NOT NULL,
    funding_rate_cap INTEGER NOT NULL, -- basis points
    funding_interval INTEGER NOT NULL, -- seconds
    mark_price_source VARCHAR(20) CHECK (mark_price_source IN ('ORACLE', 'TWAP', 'MARKET')),
    oracle_address VARCHAR(100),
    twap_window INTEGER, -- seconds
    maintenance_margin_ratio INTEGER NOT NULL, -- basis points
    initial_margin_ratio INTEGER NOT NULL, -- basis points
    max_leverage INTEGER NOT NULL,
    tick_size DECIMAL(20,8) NOT NULL,
    lot_size DECIMAL(20,8) NOT NULL,
    maker_fee_bps INTEGER NOT NULL,
    taker_fee_bps INTEGER NOT NULL,
    insurance_fund_address VARCHAR(100) NOT NULL,
    auto_deleveraging_enabled BOOLEAN DEFAULT TRUE,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_perp_markets_active ON perpetual_markets(active);

CREATE TABLE IF NOT EXISTS perpetual_positions (
    id BIGSERIAL PRIMARY KEY,
    position_id VARCHAR(100) UNIQUE NOT NULL,
    trader_address VARCHAR(100) NOT NULL,
    market_id VARCHAR(100) NOT NULL REFERENCES perpetual_markets(market_id),
    is_long BOOLEAN NOT NULL,
    size DECIMAL(30,8) NOT NULL, -- in quote asset
    entry_price DECIMAL(30,18) NOT NULL,
    mark_price DECIMAL(30,18) NOT NULL,
    unrealized_pnl DECIMAL(30,18) DEFAULT 0,
    realized_pnl DECIMAL(30,18) DEFAULT 0,
    margin DECIMAL(30,18) NOT NULL,
    leverage INTEGER NOT NULL,
    liquidation_price DECIMAL(30,18) NOT NULL,
    funding_paid DECIMAL(30,18) DEFAULT 0,
    last_funding_time BIGINT NOT NULL,
    opened_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    status VARCHAR(20) DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED', 'LIQUIDATED', 'ADL')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_perp_positions_trader ON perpetual_positions(trader_address);
CREATE INDEX idx_perp_positions_market ON perpetual_positions(market_id);
CREATE INDEX idx_perp_positions_status ON perpetual_positions(status);

CREATE TABLE IF NOT EXISTS perpetual_orders (
    id BIGSERIAL PRIMARY KEY,
    order_id VARCHAR(100) UNIQUE NOT NULL,
    trader_address VARCHAR(100) NOT NULL,
    market_id VARCHAR(100) NOT NULL REFERENCES perpetual_markets(market_id),
    is_buy BOOLEAN NOT NULL,
    order_type VARCHAR(20) CHECK (order_type IN ('MARKET', 'LIMIT', 'STOP_MARKET', 'STOP_LIMIT', 'POST_ONLY', 'IOC', 'FOK')),
    size DECIMAL(30,8) NOT NULL,
    price DECIMAL(30,18),
    stop_price DECIMAL(30,18),
    reduce_only BOOLEAN DEFAULT FALSE,
    post_only BOOLEAN DEFAULT FALSE,
    time_in_force VARCHAR(10) CHECK (time_in_force IN ('GTC', 'IOC', 'FOK')),
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED')),
    filled_size DECIMAL(30,8) DEFAULT 0,
    avg_fill_price DECIMAL(30,18),
    fee_paid DECIMAL(30,18) DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);

CREATE INDEX idx_perp_orders_trader ON perpetual_orders(trader_address);
CREATE INDEX idx_perp_orders_market ON perpetual_orders(market_id);
CREATE INDEX idx_perp_orders_status ON perpetual_orders(status);

CREATE TABLE IF NOT EXISTS perpetual_funding_rates (
    id BIGSERIAL PRIMARY KEY,
    market_id VARCHAR(100) NOT NULL REFERENCES perpetual_markets(market_id),
    timestamp BIGINT NOT NULL,
    funding_rate DECIMAL(10,4) NOT NULL, -- basis points, can be negative
    mark_price DECIMAL(30,18) NOT NULL,
    index_price DECIMAL(30,18) NOT NULL,
    premium_index DECIMAL(10,4) NOT NULL,
    next_funding_time BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_perp_funding_market_time ON perpetual_funding_rates(market_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS perpetual_price_feed (
    id BIGSERIAL PRIMARY KEY,
    market_id VARCHAR(100) UNIQUE NOT NULL REFERENCES perpetual_markets(market_id),
    mark_price DECIMAL(30,18) NOT NULL,
    index_price DECIMAL(30,18) NOT NULL,
    last_update BIGINT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Carbon Options
-- ============================================

CREATE TABLE IF NOT EXISTS option_markets (
    id BIGSERIAL PRIMARY KEY,
    market_id VARCHAR(100) UNIQUE NOT NULL,
    underlying_asset VARCHAR(100) NOT NULL,
    asset_id BIGINT NOT NULL,
    quote_asset VARCHAR(100) NOT NULL,
    option_style VARCHAR(20) CHECK (option_style IN ('EUROPEAN', 'AMERICAN')),
    settlement_type VARCHAR(20) CHECK (settlement_type IN ('PHYSICAL', 'CASH')),
    min_order_size DECIMAL(20,8) NOT NULL,
    tick_size DECIMAL(20,8) NOT NULL,
    maker_fee_bps INTEGER NOT NULL,
    taker_fee_bps INTEGER NOT NULL,
    exercise_fee_bps INTEGER NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_opt_markets_active ON option_markets(active);

CREATE TABLE IF NOT EXISTS option_series (
    id BIGSERIAL PRIMARY KEY,
    series_id VARCHAR(100) UNIQUE NOT NULL,
    market_id VARCHAR(100) NOT NULL REFERENCES option_markets(market_id),
    is_call BOOLEAN NOT NULL,
    strike_price DECIMAL(30,18) NOT NULL,
    expiry BIGINT NOT NULL,
    size DECIMAL(30,8) DEFAULT 0, -- open interest
    premium DECIMAL(30,18) DEFAULT 0,
    implied_volatility DECIMAL(30,18) DEFAULT 0, -- annualized
    delta DECIMAL(30,18) DEFAULT 0,
    gamma DECIMAL(30,18) DEFAULT 0,
    theta DECIMAL(30,18) DEFAULT 0,
    vega DECIMAL(30,18) DEFAULT 0,
    rho DECIMAL(30,18) DEFAULT 0,
    underlying_price DECIMAL(30,18) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'EXERCISED', 'CANCELLED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_opt_series_market ON option_series(market_id);
CREATE INDEX idx_opt_series_expiry ON option_series(expiry);
CREATE INDEX idx_opt_series_status ON option_series(status);

CREATE TABLE IF NOT EXISTS option_positions (
    id BIGSERIAL PRIMARY KEY,
    position_id VARCHAR(100) UNIQUE NOT NULL,
    trader_address VARCHAR(100) NOT NULL,
    series_id VARCHAR(100) NOT NULL REFERENCES option_series(series_id),
    is_long BOOLEAN NOT NULL,
    size DECIMAL(30,8) NOT NULL,
    entry_premium DECIMAL(30,18) NOT NULL,
    current_premium DECIMAL(30,18) NOT NULL,
    unrealized_pnl DECIMAL(30,18) DEFAULT 0,
    delta_exposure DECIMAL(30,18) DEFAULT 0,
    gamma_exposure DECIMAL(30,18) DEFAULT 0,
    vega_exposure DECIMAL(30,18) DEFAULT 0,
    opened_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_opt_positions_trader ON option_positions(trader_address);
CREATE INDEX idx_opt_positions_series ON option_positions(series_id);

CREATE TABLE IF NOT EXISTS option_orders (
    id BIGSERIAL PRIMARY KEY,
    order_id VARCHAR(100) UNIQUE NOT NULL,
    trader_address VARCHAR(100) NOT NULL,
    series_id VARCHAR(100) NOT NULL REFERENCES option_series(series_id),
    is_buy BOOLEAN NOT NULL,
    order_type VARCHAR(20) CHECK (order_type IN ('MARKET', 'LIMIT')),
    size DECIMAL(30,8) NOT NULL,
    price DECIMAL(30,18),
    reduce_only BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED')),
    filled_size DECIMAL(30,8) DEFAULT 0,
    avg_fill_price DECIMAL(30,18),
    fee_paid DECIMAL(30,18) DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);

CREATE INDEX idx_opt_orders_trader ON option_orders(trader_address);
CREATE INDEX idx_opt_orders_series ON option_orders(series_id);
CREATE INDEX idx_opt_orders_status ON option_orders(status);

CREATE TABLE IF NOT EXISTS option_exercises (
    id BIGSERIAL PRIMARY KEY,
    request_id VARCHAR(100) UNIQUE NOT NULL,
    holder_address VARCHAR(100) NOT NULL,
    series_id VARCHAR(100) NOT NULL REFERENCES option_series(series_id),
    size DECIMAL(30,8) NOT NULL,
    timestamp BIGINT NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_opt_exercises_holder ON option_exercises(holder_address);
CREATE INDEX idx_opt_exercises_series ON option_exercises(series_id);

-- ============================================
-- Structured Products
-- ============================================

CREATE TABLE IF NOT EXISTS structured_products (
    id BIGSERIAL PRIMARY KEY,
    product_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    product_type VARCHAR(30) CHECK (product_type IN ('PRINCIPAL_PROTECTED', 'YIELD_ENHANCED', 'LEVERAGED', 'BARRIER', 'AUTOCALLABLE', 'BASKET', 'CUSTOM')),
    quote_asset VARCHAR(100) NOT NULL,
    maturity BIGINT NOT NULL,
    capital_protection INTEGER NOT NULL, -- basis points
    participation_rate INTEGER NOT NULL, -- basis points
    coupon_rate INTEGER DEFAULT 0, -- annual basis points
    barrier_level INTEGER, -- basis points
    barrier_type VARCHAR(20) CHECK (barrier_type IN ('UP_IN', 'UP_OUT', 'DOWN_IN', 'DOWN_OUT')),
    autocall_trigger INTEGER, -- basis points
    autocall_frequency INTEGER, -- days
    early_redemption_enabled BOOLEAN DEFAULT FALSE,
    management_fee_bps INTEGER NOT NULL,
    performance_fee_bps INTEGER NOT NULL,
    min_investment DECIMAL(30,8) NOT NULL,
    max_investment DECIMAL(30,8) NOT NULL,
    subscription_start BIGINT NOT NULL,
    subscription_end BIGINT NOT NULL,
    status VARCHAR(20) DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'OPEN', 'CLOSED', 'MATURED', 'TERMINATED')),
    initial_nav DECIMAL(30,18) DEFAULT 1000000000000000000, -- 1.0
    total_subscriptions DECIMAL(30,8) DEFAULT 0,
    fee_recipient VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_struct_products_status ON structured_products(status);

CREATE TABLE IF NOT EXISTS structured_product_underlyings (
    id BIGSERIAL PRIMARY KEY,
    product_id VARCHAR(100) NOT NULL REFERENCES structured_products(product_id),
    asset VARCHAR(100) NOT NULL,
    asset_id BIGINT NOT NULL,
    weight INTEGER NOT NULL, -- basis points
    initial_price DECIMAL(30,18) DEFAULT 0,
    current_price DECIMAL(30,18) DEFAULT 0,
    barrier_hit BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(product_id, asset, asset_id)
);

CREATE INDEX idx_struct_underlyings_product ON structured_product_underlyings(product_id);

CREATE TABLE IF NOT EXISTS structured_product_subscriptions (
    id BIGSERIAL PRIMARY KEY,
    subscription_id VARCHAR(100) UNIQUE NOT NULL,
    investor_address VARCHAR(100) NOT NULL,
    product_id VARCHAR(100) NOT NULL REFERENCES structured_products(product_id),
    investment_amount DECIMAL(30,8) NOT NULL,
    units DECIMAL(30,18) NOT NULL,
    entry_nav DECIMAL(30,18) NOT NULL,
    current_nav DECIMAL(30,18) NOT NULL,
    unrealized_pnl DECIMAL(30,18) DEFAULT 0,
    accrued_coupon DECIMAL(30,18) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'SUBSCRIBED' CHECK (status IN ('SUBSCRIBED', 'ACTIVE', 'REDEEMED', 'MATURED', 'EARLY_REDEEMED')),
    subscribed_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_struct_subs_investor ON structured_product_subscriptions(investor_address);
CREATE INDEX idx_struct_subs_product ON structured_product_subscriptions(product_id);
CREATE INDEX idx_struct_subs_status ON structured_product_subscriptions(status);

CREATE TABLE IF NOT EXISTS structured_product_nav_history (
    id BIGSERIAL PRIMARY KEY,
    product_id VARCHAR(100) NOT NULL REFERENCES structured_products(product_id),
    timestamp BIGINT NOT NULL,
    nav DECIMAL(30,18) NOT NULL,
    underlying_prices JSONB NOT NULL,
    total_assets DECIMAL(30,8) DEFAULT 0,
    total_liabilities DECIMAL(30,8) DEFAULT 0,
    shares_outstanding DECIMAL(30,18) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_struct_nav_product_time ON structured_product_nav_history(product_id, timestamp DESC);

-- ============================================
-- Carbon Insurance
-- ============================================

CREATE TABLE IF NOT EXISTS insurance_pools (
    id BIGSERIAL PRIMARY KEY,
    pool_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    covered_risks INTEGER[] NOT NULL, -- 0=REVERSAL, 1=INVALIDATION, 2=REGULATORY, 3=MARKET, 4=OPERATIONAL, 5=FORCE_MAJEURE
    covered_assets VARCHAR(100)[] NOT NULL,
    asset_ids BIGINT[] NOT NULL,
    registries TEXT[] NOT NULL,
    quote_asset VARCHAR(100) NOT NULL,
    premium_rate_bps INTEGER NOT NULL, -- annual basis points
    coverage_limit DECIMAL(30,8) NOT NULL, -- tCO2e
    deductible DECIMAL(30,8) NOT NULL,
    policy_duration BIGINT NOT NULL, -- seconds
    claim_window BIGINT NOT NULL, -- seconds
    assessment_period BIGINT NOT NULL, -- seconds
    payout_currency VARCHAR(100) NOT NULL,
    governance_token VARCHAR(100),
    capital_requirement DECIMAL(30,8) NOT NULL,
    reinsurance_enabled BOOLEAN DEFAULT FALSE,
    reinsurance_threshold INTEGER NOT NULL, -- basis points
    total_capital DECIMAL(30,8) DEFAULT 0,
    available_capital DECIMAL(30,8) DEFAULT 0,
    reserved_capital DECIMAL(30,8) DEFAULT 0,
    total_premiums_collected DECIMAL(30,8) DEFAULT 0,
    total_claims_paid DECIMAL(30,8) DEFAULT 0,
    active_policies INTEGER DEFAULT 0,
    total_coverage DECIMAL(30,8) DEFAULT 0, -- tCO2e
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ins_pools_active ON insurance_pools(active);

CREATE TABLE IF NOT EXISTS insurance_policies (
    id BIGSERIAL PRIMARY KEY,
    policy_id VARCHAR(100) UNIQUE NOT NULL,
    pool_id VARCHAR(100) NOT NULL REFERENCES insurance_pools(pool_id),
    policyholder_address VARCHAR(100) NOT NULL,
    covered_asset VARCHAR(100) NOT NULL,
    asset_id BIGINT NOT NULL,
    coverage_amount DECIMAL(30,8) NOT NULL, -- tCO2e
    premium DECIMAL(30,18) NOT NULL,
    premium_paid BOOLEAN DEFAULT FALSE,
    start_date BIGINT NOT NULL,
    end_date BIGINT NOT NULL,
    deductible DECIMAL(30,8) NOT NULL,
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'CLAIMED', 'CANCELLED', 'LAPSED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ins_policies_pool ON insurance_policies(pool_id);
CREATE INDEX idx_ins_policies_holder ON insurance_policies(policyholder_address);
CREATE INDEX idx_ins_policies_status ON insurance_policies(status);

CREATE TABLE IF NOT EXISTS insurance_claims (
    id BIGSERIAL PRIMARY KEY,
    claim_id VARCHAR(100) UNIQUE NOT NULL,
    policy_id VARCHAR(100) NOT NULL REFERENCES insurance_policies(policy_id),
    claimant_address VARCHAR(100) NOT NULL,
    event_type INTEGER NOT NULL CHECK (event_type IN (0,1,2,3,4,5)), -- 0=REVERSAL, 1=INVALIDATION, 2=REGULATORY, 3=MARKET, 4=OPERATIONAL, 5=FORCE_MAJEURE
    event_description TEXT NOT NULL,
    event_date BIGINT NOT NULL,
    affected_amount DECIMAL(30,8) NOT NULL, -- tCO2e
    claimed_amount DECIMAL(30,18) NOT NULL,
    evidence TEXT[] NOT NULL,
    status VARCHAR(20) DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PAID', 'DISPUTED')),
    assessor_address VARCHAR(100),
    assessment_notes TEXT,
    payout_amount DECIMAL(30,18) DEFAULT 0,
    payout_tx_hash VARCHAR(100),
    submitted_at BIGINT NOT NULL,
    assessed_at BIGINT,
    paid_at BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ins_claims_policy ON insurance_claims(policy_id);
CREATE INDEX idx_ins_claims_claimant ON insurance_claims(claimant_address);
CREATE INDEX idx_ins_claims_status ON insurance_claims(status);

CREATE TABLE IF NOT EXISTS reinsurance_contracts (
    id BIGSERIAL PRIMARY KEY,
    contract_id VARCHAR(100) UNIQUE NOT NULL,
    reinsurer_address VARCHAR(100) NOT NULL,
    pool_id VARCHAR(100) NOT NULL REFERENCES insurance_pools(pool_id),
    max_coverage DECIMAL(30,8) NOT NULL,
    premium_share INTEGER NOT NULL, -- basis points
    attachment_point INTEGER NOT NULL, -- basis points
    exhaustion_point INTEGER NOT NULL, -- basis points
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_reinsurance_pool ON reinsurance_contracts(pool_id);
CREATE INDEX idx_reinsurance_reinsurer ON reinsurance_contracts(reinsurer_address);

-- ============================================
-- Updated timestamps trigger
-- ============================================

DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'perpetual_%' OR tablename LIKE 'option_%' OR tablename LIKE 'structured_%' OR tablename LIKE 'insurance_%' OR tablename LIKE 'reinsurance_%'
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS update_%s_updated_at ON %s', t, t);
        EXECUTE format('CREATE TRIGGER update_%s_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', t, t);
    END LOOP;
END $$;