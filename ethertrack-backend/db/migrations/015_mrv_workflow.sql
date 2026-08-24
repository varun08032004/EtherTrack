-- 015_mrv_workflow.sql
-- MRV (Monitoring, Reporting, Verification) Workflow Tables
-- Plan → Collect → Verify → Approve workflow for emission data

-- MRV Plan States
CREATE TYPE mrv_plan_state AS ENUM (
    'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'APPROVED', 'REJECTED', 'ARCHIVED'
);

-- Evidence States
CREATE TYPE evidence_state AS ENUM (
    'UPLOADED', 'PROCESSING', 'VERIFIED', 'REJECTED', 'ARCHIVED'
);

-- Verification Findings
CREATE TYPE finding_severity AS ENUM (
    'CRITICAL', 'MAJOR', 'MINOR', 'OBSERVATION'
);

-- MRV Plans
CREATE TABLE mrv_plans (
    plan_id             UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id              UUID,  -- Optional, references organizations when table exists
    
    -- Plan Details
    plan_name           VARCHAR(200) NOT NULL,
    description         TEXT,
    reporting_year      INT NOT NULL,
    methodology_template VARCHAR(50) NOT NULL,  -- References methodology_templates
    
    -- Scope Coverage
    covers_scope_1      BOOLEAN DEFAULT TRUE,
    covers_scope_2      BOOLEAN DEFAULT TRUE,
    covers_scope_3      BOOLEAN DEFAULT FALSE,
    
    -- Facility/Asset Coverage
    facility_ids        UUID[] DEFAULT '{}',
    asset_ids           UUID[] DEFAULT '{}',
    
    -- Timeline
    reporting_period_start DATE NOT NULL,
    reporting_period_end   DATE NOT NULL,
    submission_deadline    DATE,
    verification_deadline  DATE,
    
    -- State Machine
    state               mrv_plan_state DEFAULT 'DRAFT',
    previous_state      mrv_plan_state,
    
    -- Assignees
    submitted_by        UUID REFERENCES users(id),
    submitted_at        TIMESTAMP,
    assigned_verifier   UUID REFERENCES users(id),
    verified_by         UUID REFERENCES users(id),
    verified_at         TIMESTAMP,
    approved_by         UUID REFERENCES users(id),
    approved_at         TIMESTAMP,
    
    -- Verification Results
    verification_findings JSONB,  -- Array of findings
    overall_conclusion  VARCHAR(50),  -- 'VERIFIED', 'VERIFIED_WITH_QUALIFICATIONS', 'NOT_VERIFIED'
    
    -- Metadata
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT chk_dates CHECK (reporting_period_end >= reporting_period_start)
);

-- Evidence Documents
CREATE TABLE emission_evidence (
    evidence_id         UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    plan_id             UUID NOT NULL REFERENCES mrv_plans(plan_id) ON DELETE CASCADE,
    activity_id         UUID REFERENCES emission_activities(id) ON DELETE SET NULL,
    
    -- Evidence Details
    title               VARCHAR(300) NOT NULL,
    description         TEXT,
    evidence_type       VARCHAR(50) NOT NULL,  -- 'INVOICE', 'METER_READING', 'CONTRACT', 'CERTIFICATE', 'PHOTO', 'SPREADSHEET', 'OTHER'
    
    -- File Storage
    ipfs_cid            VARCHAR(100),          -- IPFS Content Identifier
    ipfs_gateway_url    TEXT,                  -- Gateway URL for access
    file_name           VARCHAR(300),
    file_size_bytes     BIGINT,
    mime_type           VARCHAR(100),
    file_hash_sha256    VARCHAR(64),           -- SHA256 of file content
    
    -- On-chain Anchoring
    blockchain_tx_hash  VARCHAR(66),
    blockchain_log_index INT,
    chain_id            INT,
    anchored_at         TIMESTAMP,
    
    -- Verification
    state               evidence_state DEFAULT 'UPLOADED',
    uploaded_by         UUID NOT NULL REFERENCES users(id),
    uploaded_at         TIMESTAMP DEFAULT NOW(),
    verified_by         UUID REFERENCES users(id),
    verified_at         TIMESTAMP,
    verification_notes  TEXT,
    
    -- AI Extraction Results
    ai_extracted_data   JSONB,                 -- { quantity, unit, date, amount, confidence }
    extraction_confidence NUMERIC(5,2),
    
    -- Metadata
    metadata            JSONB,
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

-- Verification Findings
CREATE TABLE verification_findings (
    finding_id          UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    plan_id             UUID NOT NULL REFERENCES mrv_plans(plan_id) ON DELETE CASCADE,
    evidence_id         UUID REFERENCES emission_evidence(evidence_id) ON DELETE SET NULL,
    
    -- Finding Details
    severity            finding_severity NOT NULL,
    category            VARCHAR(50),           -- 'COMPLETENESS', 'ACCURACY', 'CONSISTENCY', 'METHODOLOGY', 'DOCUMENTATION'
    title               VARCHAR(300) NOT NULL,
    description         TEXT NOT NULL,
    recommendation      TEXT,
    
    -- Reference
    reference_section   VARCHAR(100),          -- e.g., 'Scope 1 - Stationary Combustion'
    reference_activity  VARCHAR(100),
    reference_evidence  UUID REFERENCES emission_evidence(evidence_id),
    
    -- Resolution
    status              VARCHAR(20) DEFAULT 'OPEN',  -- 'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISPUTED'
    response            TEXT,
    responded_by        UUID REFERENCES users(id),
    responded_at        TIMESTAMP,
    resolved_by         UUID REFERENCES users(id),
    resolved_at         TIMESTAMP,
    
    -- Metadata
    created_by          UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

-- Verifier Registry
CREATE TABLE emission_verifiers (
    verifier_id         UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Accreditation
    accreditation_body  VARCHAR(200),          -- e.g., 'NABET', 'ANSI', 'CDP Accredited'
    accreditation_number VARCHAR(100),
    accreditation_scope JSONB,                 -- ['Scope 1', 'Scope 2', 'ISO 14064-1', 'GHG Protocol']
    accreditation_valid_from DATE,
    accreditation_valid_to   DATE,
    
    -- Expertise
    sectors             TEXT[],                -- ['CEMENT', 'STEEL', 'POWER', 'CHEMICAL']
    methodologies       TEXT[],                -- ['GHG_PROTOCOL', 'ISO_14064', 'BRSR', 'PAT', 'CCTS']
    
    -- Status
    is_active           BOOLEAN DEFAULT TRUE,
    is_approved         BOOLEAN DEFAULT FALSE,
    approved_by         UUID REFERENCES users(id),
    approved_at         TIMESTAMP,
    
    -- Performance
    verifications_completed INT DEFAULT 0,
    avg_turnaround_days NUMERIC(5,1),
    rating              NUMERIC(3,2),          -- 0-5 rating
    
    -- Metadata
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

-- Verification Assignments
CREATE TABLE verification_assignments (
    assignment_id       UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    plan_id             UUID NOT NULL REFERENCES mrv_plans(plan_id) ON DELETE CASCADE,
    verifier_id         UUID NOT NULL REFERENCES emission_verifiers(verifier_id) ON DELETE CASCADE,
    
    -- Assignment Details
    assigned_by         UUID REFERENCES users(id),
    assigned_at         TIMESTAMP DEFAULT NOW(),
    due_date            DATE,
    
    -- Status
    status              VARCHAR(20) DEFAULT 'ASSIGNED',  -- 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'COMPLETED', 'REASSIGNED'
    started_at          TIMESTAMP,
    completed_at        TIMESTAMP,
    
    -- Metadata
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_mrv_plans_user ON mrv_plans(user_id);
CREATE INDEX idx_mrv_plans_org ON mrv_plans(org_id);
CREATE INDEX idx_mrv_plans_state ON mrv_plans(state);
CREATE INDEX idx_mrv_plans_year ON mrv_plans(reporting_year);
CREATE INDEX idx_mrv_plans_verifier ON mrv_plans(assigned_verifier);
CREATE INDEX idx_emission_evidence_plan ON emission_evidence(plan_id);
CREATE INDEX idx_emission_evidence_activity ON emission_evidence(activity_id);
CREATE INDEX idx_emission_evidence_state ON emission_evidence(state);
CREATE INDEX idx_emission_evidence_ipfs ON emission_evidence(ipfs_cid);
CREATE INDEX idx_verification_findings_plan ON verification_findings(plan_id);
CREATE INDEX idx_verification_findings_severity ON verification_findings(severity);
CREATE INDEX idx_emission_verifiers_user ON emission_verifiers(user_id);
CREATE INDEX idx_verification_assignments_plan ON verification_assignments(plan_id);
CREATE INDEX idx_verification_assignments_verifier ON verification_assignments(verifier_id);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_mrv_plans_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_mrv_plans_updated_at
BEFORE UPDATE ON mrv_plans
FOR EACH ROW EXECUTE FUNCTION update_mrv_plans_updated_at();

CREATE OR REPLACE FUNCTION update_emission_evidence_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_emission_evidence_updated_at
BEFORE UPDATE ON emission_evidence
FOR EACH ROW EXECUTE FUNCTION update_emission_evidence_updated_at();

CREATE OR REPLACE FUNCTION update_verification_findings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_verification_findings_updated_at
BEFORE UPDATE ON verification_findings
FOR EACH ROW EXECUTE FUNCTION update_verification_findings_updated_at();

CREATE OR REPLACE FUNCTION update_emission_verifiers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_emission_verifiers_updated_at
BEFORE UPDATE ON emission_verifiers
FOR EACH ROW EXECUTE FUNCTION update_emission_verifiers_updated_at();

CREATE OR REPLACE FUNCTION update_verification_assignments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_verification_assignments_updated_at
BEFORE UPDATE ON verification_assignments
FOR EACH ROW EXECUTE FUNCTION update_verification_assignments_updated_at();