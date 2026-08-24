-- 026_seller_onboarding.sql
-- Seller Onboarding Tables

-- Project States
CREATE TYPE project_state AS ENUM (
    'DRAFT',
    'SUBMITTED',
    'UNDER_REVIEW',
    'VERIFIED',
    'APPROVED',
    'REJECTED',
    'REVISION_REQUESTED',
    'ARCHIVED'
);

-- Seller Projects
CREATE TABLE seller_projects (
    project_id            UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    seller_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Project Details
    project_name          VARCHAR(300) NOT NULL,
    description           TEXT,
    project_type          VARCHAR(100),                   -- 'Forestry', 'Renewable', 'Methane', etc.
    methodology           VARCHAR(200),                   -- Methodology name
    standard              VARCHAR(50),                    -- 'VCS', 'GS', 'CDM', 'ACR', 'BEE'
    
    -- Location
    country               VARCHAR(100) NOT NULL,
    region                VARCHAR(100),
    coordinates           JSONB,                          -- {lat, lng}
    land_tenure           VARCHAR(100),                   -- 'owned', 'leased', 'community', 'government'
    land_area_hectares    NUMERIC(15,2),
    
    -- Capacity
    annual_credits_estimate BIGINT,
    vintage_start         INT,
    vintage_end           INT,
    
    -- Documentation
    pd_document_id        UUID,                           -- Project Design Document
    validation_report_id  UUID,                           -- Validation report
    monitoring_plan_id    UUID,
    
    -- Verification
    verifier_id           UUID REFERENCES users(id),
    verifier_firm         VARCHAR(200),
    verification_date     DATE,
    verification_report_id UUID,
    
    -- Registry
    registry              VARCHAR(50),
    registry_project_id   VARCHAR(100),
    
    -- State Machine
    state                 project_state DEFAULT 'DRAFT',
    submitted_at          TIMESTAMP,
    verified_at           TIMESTAMP,
    approved_at           TIMESTAMP,
    rejected_at           TIMESTAMP,
    rejection_reason      TEXT,
    
    -- Metadata
    metadata              JSONB,
    created_by            UUID REFERENCES users(id),
    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT chk_dates CHECK (vintage_end IS NULL OR vintage_end >= vintage_start)
);

-- Project Documents
CREATE TABLE project_documents (
    document_id           UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    project_id            UUID NOT NULL REFERENCES seller_projects(project_id) ON DELETE CASCADE,
    
    document_type         VARCHAR(50) NOT NULL,           -- 'pd', 'validation', 'monitoring', 'verification', 'legal', 'other'
    title                 VARCHAR(300) NOT NULL,
    description           TEXT,
    
    -- File
    ipfs_cid              VARCHAR(100),
    file_name             VARCHAR(300),
    file_size             BIGINT,
    mime_type             VARCHAR(100),
    file_hash_sha256      VARCHAR(64),
    
    -- Blockchain
    blockchain_tx_hash    VARCHAR(66),
    anchored_at           TIMESTAMP,
    
    -- Verification
    verified              BOOLEAN DEFAULT FALSE,
    verified_by           UUID REFERENCES users(id),
    verified_at           TIMESTAMP,
    
    -- Metadata
    metadata              JSONB,
    uploaded_by           UUID REFERENCES users(id),
    uploaded_at           TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT chk_ipfs_cid CHECK (ipfs_cid IS NULL OR ipfs_cid ~ '^Qm[1-9A-HJ-NP-Za-km-z]{44,}$')
);

-- Project Verification Findings
CREATE TABLE project_verification_findings (
    finding_id            UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    project_id            UUID NOT NULL REFERENCES seller_projects(project_id) ON DELETE CASCADE,
    
    severity              VARCHAR(20) NOT NULL,           -- 'CRITICAL', 'MAJOR', 'MINOR', 'OBSERVATION'
    category              VARCHAR(50) NOT NULL,           -- 'additionality', 'permanence', 'boundary', 'methodology', 'data_quality', 'other'
    title                 VARCHAR(300) NOT NULL,
    description           TEXT NOT NULL,
    recommendation        TEXT,
    
    -- Reference
    reference_section     VARCHAR(100),
    reference_document    UUID REFERENCES project_documents(document_id),
    
    -- Resolution
    status                VARCHAR(20) DEFAULT 'OPEN',     -- 'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISPUTED'
    response              TEXT,
    responded_by          UUID REFERENCES users(id),
    responded_at          TIMESTAMP,
    resolved_by           UUID REFERENCES users(id),
    resolved_at           TIMESTAMP,
    
    -- Metadata
    created_by            UUID REFERENCES users(id),
    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW()
);

-- Seller Batches (Credits ready for sale)
CREATE TABLE seller_batches (
    batch_id              UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    project_id            UUID NOT NULL REFERENCES seller_projects(project_id) ON DELETE CASCADE,
    seller_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Batch Details
    batch_name            VARCHAR(200),
    vintage               INT NOT NULL,
    quantity              BIGINT NOT NULL,
    available_quantity    BIGINT NOT NULL DEFAULT 0,
    
    -- Registry
    registry              VARCHAR(50),
    registry_serial_start VARCHAR(100),
    registry_serial_end   VARCHAR(100),
    serial_numbers        JSONB,                          -- Array of serial numbers
    
    -- Verification
    verification_report_id UUID,
    verification_date     DATE,
    verifier_firm         VARCHAR(200),
    
    -- State
    state                 VARCHAR(20) DEFAULT 'DRAFT',    -- 'DRAFT', 'VERIFIED', 'MINTED', 'LISTED', 'SOLD', 'RETIRED'
    minted_at             TIMESTAMP,
    listed_at             TIMESTAMP,
    
    -- Metadata
    metadata              JSONB,
    created_by            UUID REFERENCES users(id),
    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT chk_quantity_positive CHECK (quantity > 0),
    CONSTRAINT chk_available CHECK (available_quantity >= 0 AND available_quantity <= quantity)
);

-- Seller Payouts
CREATE TABLE seller_payouts (
    payout_id             UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    seller_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trade_id              UUID REFERENCES trades(id),
    order_id              UUID REFERENCES marketplace_orders(order_id),
    
    -- Amounts
    gross_amount_inr      NUMERIC(20,2) NOT NULL,
    fee_inr               NUMERIC(20,2) DEFAULT 0,
    tax_inr               NUMERIC(20,2) DEFAULT 0,
    net_amount_inr        NUMERIC(20,2) NOT NULL,
    
    -- Bank Details
    bank_account_number   VARCHAR(30),
    bank_ifsc             VARCHAR(20),
    bank_name             VARCHAR(100),
    account_holder_name   VARCHAR(200),
    
    -- Status
    status                VARCHAR(20) DEFAULT 'PENDING',  -- 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'
    razorpay_payout_id    VARCHAR(100),
    processed_at          TIMESTAMP,
    failed_reason         TEXT,
    
    -- Metadata
    metadata              JSONB,
    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT chk_amounts CHECK (gross_amount_inr >= 0 AND net_amount_inr >= 0)
);

-- Indexes
CREATE INDEX idx_seller_projects_seller ON seller_projects(seller_id);
CREATE INDEX idx_seller_projects_state ON seller_projects(state);
CREATE INDEX idx_seller_projects_registry ON seller_projects(registry);
CREATE INDEX idx_project_documents_project ON project_documents(project_id);
CREATE INDEX idx_project_findings_project ON project_verification_findings(project_id);
CREATE INDEX idx_seller_batches_project ON seller_batches(project_id);
CREATE INDEX idx_seller_batches_seller ON seller_batches(seller_id);
CREATE INDEX idx_seller_batches_state ON seller_batches(state);
CREATE INDEX idx_seller_payouts_seller ON seller_payouts(seller_id);
CREATE INDEX idx_seller_payouts_status ON seller_payouts(status);
CREATE INDEX idx_seller_payouts_trade ON seller_payouts(trade_id);

-- Triggers
CREATE OR REPLACE FUNCTION update_seller_projects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_seller_projects_updated_at
BEFORE UPDATE ON seller_projects
FOR EACH ROW EXECUTE FUNCTION update_seller_projects_updated_at();

CREATE OR REPLACE FUNCTION update_seller_batches_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_seller_batches_updated_at
BEFORE UPDATE ON seller_batches
FOR EACH ROW EXECUTE FUNCTION update_seller_batches_updated_at();

CREATE OR REPLACE FUNCTION update_seller_payouts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_seller_payouts_updated_at
BEFORE UPDATE ON seller_payouts
FOR EACH ROW EXECUTE FUNCTION update_seller_payouts_updated_at();