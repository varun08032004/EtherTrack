-- 024_rfq_quotes.sql
-- RFQ (Request for Quote) and Quotes Tables

-- RFQ States
CREATE TYPE rfq_state AS ENUM (
    'DRAFT',
    'OPEN',
    'QUOTING',
    'QUOTED',
    'ACCEPTED',
    'REJECTED',
    'EXPIRED',
    'CANCELLED'
);

-- Quote States
CREATE TYPE quote_state AS ENUM (
    'PENDING',
    'SUBMITTED',
    'ACCEPTED',
    'REJECTED',
    'WITHDRAWN',
    'EXPIRED'
);

-- RFQ (Request for Quote)
CREATE TABLE rfqs (
    rfq_id                UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    buyer_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Requirements
    title                 VARCHAR(300) NOT NULL,
    description           TEXT,
    category_code         VARCHAR(50) NOT NULL,
    methodology_template  VARCHAR(50) NOT NULL,
    
    -- Requirements
    quantity_min          BIGINT NOT NULL,
    quantity_max          BIGINT,
    vintage_min           INT,
    vintage_max           INT,
    geography_countries   TEXT[],
    methodology_codes     TEXT[],
    min_ecs_score         NUMERIC(5,2),
    max_price_inr         NUMERIC(20,2),
    
    -- Requirements Details
    required_certifications TEXT[],
    required_documents    TEXT[],
    
    -- Timing
    published_at          TIMESTAMP,
    expires_at            TIMESTAMP NOT NULL,
    quote_validity_hours  INT DEFAULT 24,
    
    -- State
    state                 rfq_state DEFAULT 'DRAFT',
    published_by          UUID REFERENCES users(id),
    
    -- Metadata
    metadata              JSONB,
    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT chk_quantity CHECK (quantity_min > 0 AND (quantity_max IS NULL OR quantity_max >= quantity_min))
);

-- Quotes (Seller responses to RFQ)
CREATE TABLE rfq_quotes (
    quote_id              UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    rfq_id                UUID NOT NULL REFERENCES rfqs(rfq_id) ON DELETE CASCADE,
    seller_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Quote Details
    quantity              BIGINT NOT NULL,
    price_per_credit_inr  NUMERIC(20,2) NOT NULL,
    currency              VARCHAR(3) DEFAULT 'INR',
    valid_until           TIMESTAMP NOT NULL,
    
    -- Asset Details
    batch_ids             UUID[] NOT NULL,              -- Batches being offered
    total_available       BIGINT NOT NULL,
    
    -- Terms
    delivery_terms        TEXT,
    payment_terms         TEXT,
    settlement_type       VARCHAR(20) DEFAULT 'inr_wallet',
    
    -- Documents
    document_ids          UUID[],
    
    -- State
    state                 quote_state DEFAULT 'PENDING',
    submitted_at          TIMESTAMP,
    accepted_at           TIMESTAMP,
    rejected_at           TIMESTAMP,
    rejected_reason       TEXT,
    
    -- Metadata
    metadata              JSONB,
    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT chk_price_positive CHECK (price_per_credit_inr > 0),
    CONSTRAINT chk_quantity_positive CHECK (quantity > 0)
);

-- Indexes
CREATE INDEX idx_rfqs_buyer ON rfqs(buyer_id);
CREATE INDEX idx_rfqs_state ON rfqs(state);
CREATE INDEX idx_rfqs_expires ON rfqs(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_rfq_quotes_rfq ON rfq_quotes(rfq_id);
CREATE INDEX idx_rfq_quotes_seller ON rfq_quotes(seller_id);
CREATE INDEX idx_rfq_quotes_state ON rfq_quotes(state);

-- Triggers
CREATE OR REPLACE FUNCTION update_rfqs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_rfqs_updated_at
BEFORE UPDATE ON rfqs
FOR EACH ROW EXECUTE FUNCTION update_rfqs_updated_at();

CREATE OR REPLACE FUNCTION update_rfq_quotes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_rfq_quotes_updated_at
BEFORE UPDATE ON rfq_quotes
FOR EACH ROW EXECUTE FUNCTION update_rfq_quotes_updated_at();