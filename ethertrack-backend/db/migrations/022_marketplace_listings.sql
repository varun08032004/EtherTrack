-- 022_marketplace_listings.sql
-- Marketplace Listings Table

-- Listing States
CREATE TYPE listing_state AS ENUM (
    'DRAFT',
    'ACTIVE',
    'FILLED',
    'PARTIALLY_FILLED',
    'CANCELLED',
    'EXPIRED',
    'SUSPENDED'
);

-- Marketplace Listings
CREATE TABLE marketplace_listings (
    listing_id            UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    seller_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Asset Reference
    batch_id              UUID NOT NULL REFERENCES carbon_batches(id) ON DELETE CASCADE,
    asset_passport_id     UUID REFERENCES carbon_asset_passports(passport_id),
    
    -- Listing Details
    quantity              BIGINT NOT NULL,
    remaining_quantity    BIGINT NOT NULL,
    price_per_credit_inr  NUMERIC(20,2) NOT NULL,
    price_per_credit_usd  NUMERIC(20,8),
    
    -- Pricing
    currency              VARCHAR(3) DEFAULT 'INR',
    min_order_qty         BIGINT DEFAULT 1,
    max_order_qty         BIGINT,
    
    -- Fees
    buyer_fee_bps         INT DEFAULT 50,               -- Basis points (0.5%)
    seller_fee_bps        INT DEFAULT 50,
    
    -- Listing Config
    listing_type          VARCHAR(20) DEFAULT 'limit',  -- 'limit', 'market', 'rfq', 'otc'
    min_price_inr         NUMERIC(20,2),
    max_price_inr         NUMERIC(20,2),
    
    -- Timing
    listed_at             TIMESTAMP DEFAULT NOW(),
    expires_at            TIMESTAMP,
    filled_at             TIMESTAMP,
    
    -- State
    state                 listing_state DEFAULT 'DRAFT',
    filled_quantity       BIGINT DEFAULT 0,
    
    -- Metadata
    metadata              JSONB,
    created_by            UUID REFERENCES users(id),
    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT chk_quantities CHECK (
        quantity > 0 AND
        remaining_quantity >= 0 AND
        remaining_quantity <= quantity AND
        filled_quantity >= 0 AND
        filled_quantity <= quantity
    ),
    CONSTRAINT chk_price_positive CHECK (price_per_credit_inr > 0)
);

-- Indexes
CREATE INDEX idx_marketplace_listings_seller ON marketplace_listings(seller_id);
CREATE INDEX idx_marketplace_listings_batch ON marketplace_listings(batch_id);
CREATE INDEX idx_marketplace_listings_state ON marketplace_listings(state);
CREATE INDEX idx_marketplace_listings_price ON marketplace_listings(price_per_credit_inr);
CREATE INDEX idx_marketplace_listings_expires ON marketplace_listings(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_marketplace_listings_type ON marketplace_listings(listing_type);

-- Trigger
CREATE OR REPLACE FUNCTION update_marketplace_listings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_marketplace_listings_updated_at
BEFORE UPDATE ON marketplace_listings
FOR EACH ROW EXECUTE FUNCTION update_marketplace_listings_updated_at();