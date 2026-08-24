-- 014_emission_calculations.sql
-- Emission Calculation Audit Trail
-- Stores all server-side calculations for audit trail

CREATE TABLE emission_calculations (
    calculation_id      UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Activity Reference
    category_code       VARCHAR(50) NOT NULL,
    methodology_template VARCHAR(50) NOT NULL,
    
    -- Input Data
    quantity            NUMERIC(20, 6) NOT NULL,
    unit                VARCHAR(50) NOT NULL,
    date                DATE NOT NULL,
    
    -- Factor Used
    factor_code         VARCHAR(50) NOT NULL,
    factor_value        NUMERIC(20, 8) NOT NULL,
    unit_numerator      VARCHAR(50) NOT NULL,
    unit_denominator    VARCHAR(50) NOT NULL,
    
    -- Result
    co2e                NUMERIC(20, 6) NOT NULL,
    ghg_scope           INT NOT NULL CHECK (ghg_scope IN (1, 2, 3)),
    
    -- Audit
    calculation_details JSONB,  -- { calculation: "...", factor: "..." }
    metadata            JSONB,  -- Additional input metadata
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_emission_calculations_user ON emission_calculations(user_id);
CREATE INDEX idx_emission_calculations_category ON emission_calculations(category_code);
CREATE INDEX idx_emission_calculations_template ON emission_calculations(methodology_template);
CREATE INDEX idx_emission_calculations_date ON emission_calculations(date);
CREATE INDEX idx_emission_calculations_factor ON emission_calculations(factor_code);
CREATE INDEX idx_emission_calculations_scope ON emission_calculations(ghg_scope);
CREATE INDEX idx_emission_calculations_created ON emission_calculations(created_at);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_emission_calculations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_emission_calculations_updated_at
BEFORE UPDATE ON emission_calculations
FOR EACH ROW EXECUTE FUNCTION update_emission_calculations_updated_at();

-- Bulk Calculation Jobs
CREATE TABLE emission_bulk_jobs (
    job_id              UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    methodology_template VARCHAR(50) NOT NULL,
    status              VARCHAR(20) DEFAULT 'PENDING',  -- PENDING, PROCESSING, COMPLETED, FAILED, PARTIAL
    total_calculations  INT DEFAULT 0,
    successful_count    INT DEFAULT 0,
    error_count         INT DEFAULT 0,
    input_data          JSONB,      -- Original input
    results_summary     JSONB,      -- { totalCo2e, byScope, byCategory }
    error_details       JSONB,      -- [{ index, error }]
    created_at          TIMESTAMP DEFAULT NOW(),
    started_at          TIMESTAMP,
    completed_at        TIMESTAMP
);

CREATE INDEX idx_emission_bulk_jobs_user ON emission_bulk_jobs(user_id);
CREATE INDEX idx_emission_bulk_jobs_status ON emission_bulk_jobs(status);