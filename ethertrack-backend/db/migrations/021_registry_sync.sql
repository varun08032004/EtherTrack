-- 021_registry_sync.sql
-- Registry Sync Tables

-- Registry Types
CREATE TYPE registry_type AS ENUM (
    'VERRA',
    'GOLD_STANDARD',
    'CDM',
    'ACR',
    'ICM',
    'BEE'
);

-- Sync Job States
CREATE TYPE sync_job_state AS ENUM (
    'PENDING',
    'RUNNING',
    'COMPLETED',
    'FAILED',
    'PARTIAL'
);

-- Registry Projects (canonical from registries)
CREATE TABLE registry_projects (
    project_id            UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    registry              registry_type NOT NULL,
    registry_project_id   VARCHAR(100) NOT NULL,       -- Project ID in registry
    
    -- Project Details
    project_name          VARCHAR(300) NOT NULL,
    project_type          VARCHAR(100),
    methodology           VARCHAR(200),
    vintage               INT,
    geography_country     VARCHAR(100),
    geography_region      VARCHAR(100),
    verification_body     VARCHAR(200),
    verification_date     DATE,
    status                VARCHAR(50) DEFAULT 'active',
    
    -- Metadata
    registry_data         JSONB,                       -- Full registry response
    last_synced_at        TIMESTAMP,
    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW(),
    
    UNIQUE (registry, registry_project_id)
);

-- Registry Credits
CREATE TABLE registry_credits (
    credit_id             UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    project_id            UUID NOT NULL REFERENCES registry_projects(project_id) ON DELETE CASCADE,
    
    -- Credit Details
    serial_number         VARCHAR(100) NOT NULL,
    vintage               INT NOT NULL,
    quantity              BIGINT NOT NULL,
    status                VARCHAR(50) DEFAULT 'active',  -- 'active', 'retired', 'cancelled'
    
    -- Registry Metadata
    registry_serial       VARCHAR(100),
    issuance_date         DATE,
    retirement_date       DATE,
    retirement_reason     VARCHAR(100),
    
    -- Metadata
    registry_data         JSONB,
    last_synced_at        TIMESTAMP,
    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW(),
    
    UNIQUE (project_id, serial_number)
);

-- Sync Jobs
CREATE TABLE sync_jobs (
    job_id                UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    registry              registry_type NOT NULL,
    job_type              VARCHAR(50) NOT NULL,          -- 'full', 'incremental', 'delta'
    
    -- State
    state                 sync_job_state DEFAULT 'PENDING',
    started_at            TIMESTAMP,
    completed_at          TIMESTAMP,
    
    -- Progress
    total_records         INT DEFAULT 0,
    processed_records     INT DEFAULT 0,
    failed_records        INT DEFAULT 0,
    
    -- Error Tracking
    last_error            TEXT,
    error_details         JSONB,
    
    -- Metadata
    triggered_by          UUID REFERENCES users(id),     -- 'system' for cron
    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW()
);

-- Sync Conflicts (for manual resolution)
CREATE TABLE sync_conflicts (
    conflict_id           UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    job_id                UUID NOT NULL REFERENCES sync_jobs(job_id) ON DELETE CASCADE,
    
    -- Conflict Details
    entity_type           VARCHAR(50) NOT NULL,          -- 'project', 'credit'
    entity_id             VARCHAR(200) NOT NULL,         -- Registry entity ID
    registry_data         JSONB,                         -- Registry version
    local_data            JSONB,                         -- Local version
    
    -- Resolution
    resolution            VARCHAR(20) DEFAULT 'pending', -- 'pending', 'registry_wins', 'local_wins', 'merged', 'ignored'
    resolved_by           UUID REFERENCES users(id),
    resolved_at           TIMESTAMP,
    resolution_notes      TEXT,
    
    created_at            TIMESTAMP DEFAULT NOW(),
    resolved_at           TIMESTAMP
);

-- Indexes
CREATE INDEX idx_registry_projects_registry ON registry_projects(registry);
CREATE INDEX idx_registry_projects_status ON registry_projects(status);
CREATE INDEX idx_registry_credits_project ON registry_credits(project_id);
CREATE INDEX idx_registry_credits_status ON registry_credits(status);
CREATE INDEX idx_sync_jobs_registry ON sync_jobs(registry);
CREATE INDEX idx_sync_jobs_state ON sync_jobs(state);
CREATE INDEX idx_sync_jobs_created ON sync_jobs(created_at DESC);
CREATE INDEX idx_sync_conflicts_job ON sync_conflicts(job_id);
CREATE INDEX idx_sync_conflicts_resolution ON sync_conflicts(resolution);

-- Triggers
CREATE OR REPLACE FUNCTION update_registry_projects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_registry_projects_updated_at
BEFORE UPDATE ON registry_projects
FOR EACH ROW EXECUTE FUNCTION update_registry_projects_updated_at();

CREATE OR REPLACE FUNCTION update_registry_credits_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_registry_credits_updated_at
BEFORE UPDATE ON registry_credits
FOR EACH ROW EXECUTE FUNCTION update_registry_credits_updated_at();

CREATE OR REPLACE FUNCTION update_sync_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_jobs_updated_at
BEFORE UPDATE ON sync_jobs
FOR EACH ROW EXECUTE FUNCTION update_sync_jobs_updated_at();