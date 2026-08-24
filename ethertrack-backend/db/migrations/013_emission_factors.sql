-- 013_emission_factors.sql
-- Emission Factor Library with versioning and source audit trail
-- India-specific factors (CEA, BEE) + International (IPCC 2006/2019)

-- Emission Factor Categories
CREATE TYPE emission_factor_category AS ENUM (
    'ELECTRICITY', 'FUEL_COMBUSTION', 'FUGITIVE', 'INDUSTRIAL_PROCESS',
    'WASTE', 'AGRICULTURE', 'LULUCF', 'TRANSPORT', 'OTHER'
);

-- Emission Factor Sources
CREATE TYPE emission_factor_source AS ENUM (
    'CEA_V20_0', 'CEA_V19_0', 'IPCC_2006', 'IPCC_2019',
    'BEE_PAT', 'BEE_STANDARDS_LABELING', 'GHG_PROTOCOL',
    'CUSTOM', 'USER_PROVIDED'
);

-- Emission Factors Table
CREATE TABLE emission_factors (
    factor_id           UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    factor_code         VARCHAR(50) UNIQUE NOT NULL,  -- e.g., 'ELEC_GRID_IN_CEA_2024', 'DIESEL_IPCC_2006'
    name                VARCHAR(200) NOT NULL,
    description         TEXT,
    category            emission_factor_category NOT NULL,
    sub_category        VARCHAR(100),               -- e.g., 'GRID', 'CAPTIVE', 'TRANSPORT'
    
    -- Factor Value
    factor_value        NUMERIC(20, 8) NOT NULL,    -- e.g., 0.000727 (tCO2/kWh)
    unit_numerator      VARCHAR(50) NOT NULL,       -- 'tCO2', 'kgCO2', 'tCO2e'
    unit_denominator    VARCHAR(50) NOT NULL,       -- 'kWh', 'MWh', 'L', 'kg', 'tonne', 'km'
    
    -- Scope & Applicability
    ghg_scope           INT NOT NULL CHECK (ghg_scope IN (1, 2, 3)),
    geography           VARCHAR(100) DEFAULT 'INDIA', -- Country/Region
    region              VARCHAR(100),               -- State/Province
    sector              VARCHAR(100),               -- 'POWER', 'MANUFACTURING', 'TRANSPORT', etc.
    
    -- Versioning & Source
    source              emission_factor_source NOT NULL,
    source_version      VARCHAR(50),                -- e.g., 'V20.0', '2006', '2019'
    source_document_url TEXT,
    effective_from      DATE NOT NULL,
    effective_to        DATE,
    
    -- Uncertainty & Quality
    uncertainty_pct     NUMERIC(5, 2),              -- Percentage uncertainty
    quality_rating      VARCHAR(20),                -- 'HIGH', 'MEDIUM', 'LOW'
    
    -- Metadata
    is_active           BOOLEAN DEFAULT TRUE,
    is_custom           BOOLEAN DEFAULT FALSE,
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT chk_effective_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- Emission Factor Versions (for historical calculations)
CREATE TABLE emission_factor_versions (
    version_id          UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    factor_id           UUID NOT NULL REFERENCES emission_factors(factor_id) ON DELETE CASCADE,
    factor_value        NUMERIC(20, 8) NOT NULL,
    unit_numerator      VARCHAR(50) NOT NULL,
    unit_denominator    VARCHAR(50) NOT NULL,
    effective_from      DATE NOT NULL,
    effective_to        DATE,
    change_reason       TEXT,
    changed_by          UUID REFERENCES users(id),
    created_at          TIMESTAMP DEFAULT NOW()
);

-- Methodology Templates
CREATE TABLE methodology_templates (
    template_id         UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    template_code       VARCHAR(50) UNIQUE NOT NULL, -- 'GHG_PROTOCOL_CORPORATE', 'ISO_14064_1', 'BRSR_CORE', 'PAT', 'CCTS'
    name                VARCHAR(200) NOT NULL,
    description         TEXT,
    version             VARCHAR(50) NOT NULL,
    standard_body       VARCHAR(100),               -- 'GHG_PROTOCOL', 'ISO', 'SEBI', 'BEE', 'BEE_CCTS'
    
    -- Applicable scopes
    covers_scope_1      BOOLEAN DEFAULT TRUE,
    covers_scope_2      BOOLEAN DEFAULT TRUE,
    covers_scope_3      BOOLEAN DEFAULT FALSE,
    
    -- Structure (JSON)
    structure           JSONB NOT NULL,             -- Category hierarchy with required fields
    
    -- Validation rules
    validation_rules    JSONB,                      -- Required fields, cross-checks
    
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

-- Activity Categories (linked to methodology)
CREATE TABLE activity_categories (
    category_id         UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    template_id         UUID NOT NULL REFERENCES methodology_templates(template_id) ON DELETE CASCADE,
    category_code       VARCHAR(50) NOT NULL,
    name                VARCHAR(200) NOT NULL,
    description         TEXT,
    ghg_scope           INT NOT NULL CHECK (ghg_scope IN (1, 2, 3)),
    parent_category_id  UUID REFERENCES activity_categories(category_id),
    sort_order          INT DEFAULT 0,
    
    -- Default factor suggestion (optional)
    suggested_factor_id UUID REFERENCES emission_factors(factor_id),
    
    -- Validation
    required_fields     JSONB,                      -- e.g., ['quantity', 'unit', 'date']
    unit_options        JSONB,                      -- e.g., ['kWh', 'MWh', 'L', 'kg']
    
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_emission_factors_category ON emission_factors(category);
CREATE INDEX idx_emission_factors_scope ON emission_factors(ghg_scope);
CREATE INDEX idx_emission_factors_geography ON emission_factors(geography);
CREATE INDEX idx_emission_factors_active ON emission_factors(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_emission_factors_dates ON emission_factors(effective_from, effective_to);
CREATE INDEX idx_emission_factor_versions_factor ON emission_factor_versions(factor_id);
CREATE INDEX idx_activity_categories_template ON activity_categories(template_id);
CREATE INDEX idx_activity_categories_scope ON activity_categories(ghg_scope);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_emission_factors_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_emission_factors_updated_at
BEFORE UPDATE ON emission_factors
FOR EACH ROW EXECUTE FUNCTION update_emission_factors_updated_at();