-- 017_carbon_asset_passports.sql
-- Carbon Asset Passport Tables
-- Full provenance, eligibility, and quality tracking for carbon credits

-- Instrument Types
CREATE TYPE carbon_instrument_type AS ENUM (
    'VCM_CREDIT',
    'CCTS_OFFSET_CCC',
    'CCTS_COMPLIANCE_CCC',
    'ARTICLE_6_ITMO',
    'CORSIA_ELIGIBLE'
);

-- Asset Passport States
CREATE TYPE asset_passport_state AS ENUM (
    'DRAFT',
    'ACTIVE',
    'RETIRED',
    'CANCELLED',
    'EXPIRED',
    'SUSPENDED'
);

-- Eligibility Schemes
CREATE TYPE eligibility_scheme AS ENUM (
    'VCM',
    'CCTS_OFFSET',
    'CCTS_COMPLIANCE',
    'ARTICLE_6',
    'CORSIA'
);

-- Carbon Asset Passports
CREATE TABLE carbon_asset_passports (
    passport_id           UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    asset_id              UUID NOT NULL REFERENCES carbon_batches(id) ON DELETE CASCADE,
    CONSTRAINT uq_carbon_asset_passports_asset UNIQUE (asset_id),
    
    -- Identity
    instrument_type       carbon_instrument_type NOT NULL DEFAULT 'VCM_CREDIT',
    registry              VARCHAR(50) NOT NULL,           -- 'VCS', 'GS', 'CDM', 'ACR', 'ICM', 'BEE'
    registry_project_id   VARCHAR(100),                   -- Project ID in registry
    registry_serial_start VARCHAR(100),                   -- First serial number
    registry_serial_end   VARCHAR(100),                   -- Last serial number
    
    -- Project Details
    project_name          VARCHAR(300) NOT NULL,
    project_type          VARCHAR(100),                   -- 'Forestry', 'Renewable', 'Methane', etc.
    methodology           VARCHAR(200),                   -- Methodology name/version
    vintage               INT NOT NULL,                   -- Vintage year
    geography_country     VARCHAR(100) NOT NULL,
    geography_region      VARCHAR(100),                   -- State/province
    geography_coordinates JSONB,                          -- {lat, lng}
    
    -- Verification
    verification_body     VARCHAR(200),                   -- Verifier name
    verification_date     DATE,
    verification_report_url TEXT,                         -- URL to verification report
    
    -- Issuance
    issuance_date         DATE NOT NULL,
    total_quantity        BIGINT NOT NULL,                -- Total credits issued
    available_quantity    BIGINT NOT NULL DEFAULT 0,      -- Currently available
    retired_quantity      BIGINT NOT NULL DEFAULT 0,      -- Retired
    cancelled_quantity    BIGINT NOT NULL DEFAULT 0,      -- Cancelled
    
    -- Eligibility (computed, cached)
    vcm_eligible          BOOLEAN DEFAULT TRUE,
    ccts_offset_eligible  BOOLEAN DEFAULT FALSE,
    ccts_compliance_eligible BOOLEAN DEFAULT FALSE,
    article6_eligible     BOOLEAN DEFAULT FALSE,
    corsia_eligible       BOOLEAN DEFAULT FALSE,
    eligibility_updated_at TIMESTAMP,
    eligibility_notes     JSONB,                          -- Detailed eligibility reasoning
    
    -- Quality Score (ECS)
    ecs_score             NUMERIC(5,2),                   -- 0-100
    ecs_grade             VARCHAR(10),                    -- 'AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'C', 'D'
    ecs_percentile        INT,                            -- 1-99
    ecs_factors           JSONB,                          -- Per-dimension scores
    ecs_updated_at        TIMESTAMP,
    
    -- Market Data
    last_traded_price     NUMERIC(20,2),                  -- Last traded price (INR)
    last_traded_at        TIMESTAMP,
    price_30d_avg         NUMERIC(20,2),
    price_30d_vol         BIGINT,
    
    -- Provenance Chain (JSON array of ownership transfers)
    provenance_chain      JSONB DEFAULT '[]'::jsonb,      -- [{from, to, qty, date, tx_hash, type}]
    
    -- Status
    state                 asset_passport_state DEFAULT 'DRAFT',
    suspended_reason      TEXT,
    
    -- Metadata
    created_by            UUID NOT NULL REFERENCES users(id),
    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT chk_quantities CHECK (
        available_quantity >= 0 AND
        retired_quantity >= 0 AND
        cancelled_quantity >= 0 AND
        total_quantity = available_quantity + retired_quantity + cancelled_quantity
    ),
    CONSTRAINT chk_quantities_positive CHECK (
        total_quantity > 0 AND
        available_quantity >= 0 AND
        retired_quantity >= 0 AND
        cancelled_quantity >= 0
    )
);

-- Asset Eligibility Rules (per scheme)
CREATE TABLE asset_eligibility_rules (
    rule_id               UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    scheme                eligibility_scheme NOT NULL,
    instrument_type       carbon_instrument_type NOT NULL,
    
    -- Criteria (JSON rules engine)
    criteria              JSONB NOT NULL,                 -- Rule engine format
    
    -- Metadata
    description           TEXT,
    is_active             BOOLEAN DEFAULT TRUE,
    priority              INT DEFAULT 0,                  -- Higher = more specific
    effective_from        DATE NOT NULL,
    effective_to          DATE,
    
    created_by            UUID REFERENCES users(id),
    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW(),
    
    UNIQUE (scheme, instrument_type, priority)
);

-- Asset Quality Scores (ECS breakdown)
CREATE TABLE asset_quality_scores (
    score_id              UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    batch_id              UUID NOT NULL REFERENCES carbon_batches(id) ON DELETE CASCADE,
    
    -- Dimension Scores (0-100)
    additionality         NUMERIC(5,2),
    permanence            NUMERIC(5,2),
    methodology_risk      NUMERIC(5,2),
    verification_quality  NUMERIC(5,2),
    registry_provenance   NUMERIC(5,2),
    project_risk          NUMERIC(5,2),
    country_risk          NUMERIC(5,2),
    double_counting_risk  NUMERIC(5,2),
    vintage               NUMERIC(5,2),
    transparency          NUMERIC(5,2),
    co_benefits           NUMERIC(5,2),
    
    -- Overall
    overall_score         NUMERIC(5,2),                   -- Weighted aggregate
    grade                 VARCHAR(10),                    -- 'AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'C', 'D'
    percentile_rank       INT,                            -- 1-99
    
    -- Factor contributions to final score
    factor_contributions  JSONB,                          -- {"additionality": 25.0, ...}
    
    -- Data sources
    data_sources          TEXT[],                         -- ['Verra Registry', 'Gold Standard', ...]
    
    calculated_at         TIMESTAMP DEFAULT NOW(),
    calculated_by         UUID REFERENCES users(id),
    
    UNIQUE (asset_id)
);

-- Asset Price History
CREATE TABLE asset_price_history (
    history_id            UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    batch_id              UUID NOT NULL REFERENCES carbon_batches(id) ON DELETE CASCADE,
    
    -- Price Point
    date                  DATE NOT NULL,
    price_inr             NUMERIC(20,2) NOT NULL,         -- INR per credit
    volume                BIGINT DEFAULT 0,               -- Volume traded
    vwap                  NUMERIC(20,2),                  -- Volume-weighted avg price
    
    -- Source
    source                VARCHAR(50),                    -- 'exchange', 'otc', 'rfq', 'index'
    exchange              VARCHAR(50),                    -- 'IEX', 'PXIL', 'OTC', 'EtherTrack'
    
    -- OHLCV
    open_price            NUMERIC(20,2),
    high_price            NUMERIC(20,2),
    low_price             NUMERIC(20,2),
    close_price           NUMERIC(20,2),
    volume                BIGINT DEFAULT 0,
    
    created_at            TIMESTAMP DEFAULT NOW(),
    
    UNIQUE (asset_id, date, source)
);

-- Indexes
CREATE INDEX idx_carbon_asset_passports_asset ON carbon_asset_passports(asset_id);
CREATE INDEX idx_carbon_asset_passports_registry ON carbon_asset_passports(registry);
CREATE INDEX idx_carbon_asset_passports_instrument ON carbon_asset_passports(instrument_type);
CREATE INDEX idx_carbon_asset_passports_vintage ON carbon_asset_passports(vintage);
CREATE INDEX idx_carbon_asset_passports_geography ON carbon_asset_passports(geography_country, geography_region);
CREATE INDEX idx_carbon_asset_passports_state ON carbon_asset_passports(state);
CREATE INDEX idx_carbon_asset_passports_ecs ON carbon_asset_passports(ecs_score DESC);
CREATE INDEX idx_carbon_asset_passports_price ON carbon_asset_passports(last_traded_price);
CREATE INDEX idx_carbon_asset_passports_vcm ON carbon_asset_passports(vcm_eligible) WHERE vcm_eligible = TRUE;
CREATE INDEX idx_carbon_asset_passports_ccts_offset ON carbon_asset_passports(ccts_offset_eligible) WHERE ccts_offset_eligible = TRUE;
CREATE INDEX idx_carbon_asset_passports_ccts_compliance ON carbon_asset_passports(ccts_compliance_eligible) WHERE ccts_compliance_eligible = TRUE;

CREATE INDEX idx_asset_eligibility_rules_scheme ON asset_eligibility_rules(scheme);
CREATE INDEX idx_asset_eligibility_rules_active ON asset_eligibility_rules(is_active) WHERE is_active = TRUE;

CREATE INDEX idx_asset_quality_scores_asset ON asset_quality_scores(asset_id);
CREATE INDEX idx_asset_quality_scores_score ON asset_quality_scores(overall_score DESC);
CREATE INDEX idx_asset_quality_scores_grade ON asset_quality_scores(grade);

CREATE INDEX idx_asset_price_history_asset ON asset_price_history(asset_id);
CREATE INDEX idx_asset_price_history_date ON asset_price_history(date DESC);
CREATE INDEX idx_asset_price_history_source ON asset_price_history(source);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_carbon_asset_passports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_carbon_asset_passports_updated_at
BEFORE UPDATE ON carbon_asset_passports
FOR EACH ROW EXECUTE FUNCTION update_carbon_asset_passports_updated_at();