-- 023_marketplace_orders.sql
-- Marketplace Orders Table

-- Order Types
CREATE TYPE order_type AS ENUM (
    'MARKET',
    'LIMIT',
    'RFQ',
    'OTC'
);

-- Order States
CREATE TYPE order_state AS ENUM (
    'DRAFT',
    'PENDING',
    'OPEN',
    'PARTIALLY_FILLED',
    'FILLED',
    'PARTIALLY_CANCELLED',
    'CANCELLED',
    'REJECTED',
    'EXPIRED'
);

-- Order Sides
CREATE TYPE order_side AS ENUM (
    'BUY',
    'SELL'
);

-- Marketplace Orders
CREATE TABLE marketplace_orders (
    order_id              UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    listing_id            UUID NOT NULL REFERENCES marketplace_listings(listing_id) ON DELETE CASCADE,
    
    -- Parties
    buyer_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seller_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Order Details
    order_type            order_type NOT NULL,
    side                  order_side NOT NULL,
    state                 order_state DEFAULT 'DRAFT',
    side                  order_side NOT NULL,
    
    -- Quantities
    quantity              BIGINT NOT NULL,
    filled_quantity       BIGINT DEFAULT 0,
    remaining_quantity    BIGINT GENERATED ALWAYS AS (quantity - filled_quantity) STORED,
    
    -- Pricing
    price_per_credit_inr  NUMERIC(20,2),
    price_per_credit_usd  NUMERIC(20,8),
    currency              VARCHAR(3) DEFAULT 'INR',
    
    -- RFQ Specific
    rfq_id                UUID,
    quote_id              UUID,
    quote_expires_at      TIMESTAMP,
    
    -- OTC Specific
    otc_negotiation_id    UUID,
    counterparty_id       UUID REFERENCES users(id),
    
    -- Fees
    buyer_fee_bps         INT DEFAULT 50,
    seller_fee_bps        INT DEFAULT 50,
    buyer_fee_inr         NUMERIC(20,2) DEFAULT 0,
    seller_fee_inr        NUMERIC(20,2) DEFAULT 0,
    platform_fee_inr      NUMERIC(20,2) DEFAULT 0,
    
    -- Settlement
    settlement_type       VARCHAR(20) DEFAULT 'inr_wallet',  -- 'inr_wallet', 'razorpay', 'eth', 'otc_escrow'
    settlement_status     VARCHAR(20) DEFAULT 'pending',
    settled_at            TIMESTAMP,
    settlement_tx_hash    VARCHAR(66),
    
    -- Timing
    placed_at             TIMESTAMP DEFAULT NOW(),
    expires_at            TIMESTAMP,
    filled_at             TIMESTAMP,
    cancelled_at          TIMESTAMP,
    
    -- Metadata
    metadata              JSONB,
    idempotency_key       VARCHAR(100),
    
    created_by            UUID REFERENCES users(id),
    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT chk_quantity_positive CHECK (quantity > 0),
    CONSTRAINT chk_filled_not_exceed CHECK (filled_quantity <= quantity),
    CONSTRAINT chk_price_positive CHECK (price_per_credit_inr IS NULL OR price_per_credit_inr > 0)
);

-- Indexes
CREATE INDEX idx_marketplace_orders_listing ON marketplace_orders(listing_id);
CREATE INDEX idx_marketplace_orders_buyer ON marketplace_orders(buyer_id);
CREATE INDEX idx_marketplace_orders_seller ON marketplace_orders(seller_id);
CREATE INDEX idx_marketplace_orders_state ON marketplace_orders(state);
CREATE INDEX idx_marketplace_orders_type ON marketplace_orders(order_type);
CREATE INDEX idx_marketplace_orders_placed ON marketplace_orders(placed_at DESC);
CREATE INDEX idx_marketplace_orders_idempotency ON marketplace_orders(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Trigger
CREATE OR REPLACE FUNCTION update_marketplace_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_marketplace_orders_updated_at
BEFORE UPDATE ON marketplace_orders
FOR EACH ROW EXECUTE FUNCTION update_marketplace_orders_updated_at();