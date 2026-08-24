-- Migration: Add compliance engine tables
-- Created: 2024-01-15
-- Description: Tables for CBAM, SEC Climate, ISSB S2, and TNFD compliance reporting

-- ============================================
-- CBAM Tables
-- ============================================

CREATE TABLE IF NOT EXISTS cbam_reports (
    id BIGSERIAL PRIMARY KEY,
    report_id VARCHAR(100) UNIQUE NOT NULL,
    declarant_id VARCHAR(100) NOT NULL REFERENCES users(user_id),
    reporting_period_start DATE NOT NULL,
    reporting_period_end DATE NOT NULL,
    goods JSONB NOT NULL,
    total_embedded_emissions DECIMAL(15,3) DEFAULT 0,
    total_cbam_certificates INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'VALIDATED', 'REJECTED')),
    submission_id VARCHAR(100),
    submitted_at TIMESTAMP WITH TIME ZONE,
    validated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_cbam_reports_declarant ON cbam_reports(declarant_id);
CREATE INDEX idx_cbam_reports_period ON cbam_reports(reporting_period_start, reporting_period_end);
CREATE INDEX idx_cbam_reports_status ON cbam_reports(status);

CREATE TABLE IF NOT EXISTS cbam_goods (
    id BIGSERIAL PRIMARY KEY,
    declarant_id VARCHAR(100) NOT NULL REFERENCES users(user_id),
    report_id VARCHAR(100) REFERENCES cbam_reports(report_id),
    cn_code VARCHAR(20) NOT NULL,
    product_type VARCHAR(50) NOT NULL,
    production_route VARCHAR(20) CHECK (production_route IN ('DIRECT', 'INDIRECT')),
    quantity DECIMAL(15,3) NOT NULL,
    country_of_origin VARCHAR(2) NOT NULL,
    installation_data JSONB,
    precursors JSONB,
    reporting_period_start DATE NOT NULL,
    reporting_period_end DATE NOT NULL,
    embedded_emissions_per_tonne DECIMAL(10,3),
    carbon_price_paid DECIMAL(10,2) DEFAULT 0,
    carbon_price_due DECIMAL(10,2) DEFAULT 0,
    carbon_price_effective DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_cbam_goods_declarant ON cbam_goods(declarant_id);
CREATE INDEX idx_cbam_goods_report ON cbam_goods(report_id);

CREATE TABLE IF NOT EXISTS cbam_installations (
    id BIGSERIAL PRIMARY KEY,
    installation_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    country VARCHAR(2) NOT NULL,
    region VARCHAR(100),
    coordinates JSONB,
    eprtr_id VARCHAR(50),
    ets_installation_id VARCHAR(50),
    capacity DECIMAL(15,3),
    production_routes JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- SEC Climate Disclosure Tables
-- ============================================

CREATE TABLE IF NOT EXISTS sec_climate_reports (
    id BIGSERIAL PRIMARY KEY,
    report_id VARCHAR(100) UNIQUE NOT NULL,
    company_id VARCHAR(100) NOT NULL REFERENCES companies(company_id),
    filing_id VARCHAR(50),
    fiscal_year INTEGER NOT NULL,
    governance JSONB NOT NULL,
    strategy JSONB NOT NULL,
    risk_management JSONB NOT NULL,
    metrics_targets JSONB NOT NULL,
    scenario_analysis JSONB,
    status VARCHAR(20) DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'REVIEW', 'FILED', 'AMENDED')),
    filed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sec_climate_company_year ON sec_climate_reports(company_id, fiscal_year);
CREATE INDEX idx_sec_climate_status ON sec_climate_reports(status);

CREATE TABLE IF NOT EXISTS climate_governance (
    id BIGSERIAL PRIMARY KEY,
    company_id VARCHAR(100) NOT NULL REFERENCES companies(company_id),
    board_oversight JSONB NOT NULL,
    management_role JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(company_id)
);

CREATE TABLE IF NOT EXISTS climate_strategy (
    id BIGSERIAL PRIMARY KEY,
    company_id VARCHAR(100) NOT NULL REFERENCES companies(company_id),
    year INTEGER NOT NULL,
    climate_risks JSONB DEFAULT '[]',
    climate_opportunities JSONB DEFAULT '[]',
    business_impacts JSONB NOT NULL,
    strategy_impacts JSONB NOT NULL,
    financial_planning_impacts JSONB NOT NULL,
    transition_plan JSONB,
    scenario_analysis JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(company_id, year)
);

CREATE TABLE IF NOT EXISTS climate_risk_management (
    id BIGSERIAL PRIMARY KEY,
    company_id VARCHAR(100) NOT NULL REFERENCES companies(company_id),
    identification_process TEXT NOT NULL,
    assessment_process TEXT NOT NULL,
    integration_into_overall_risk TEXT NOT NULL,
    risk_management_tools JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(company_id)
);

CREATE TABLE IF NOT EXISTS company_emissions (
    id BIGSERIAL PRIMARY KEY,
    company_id VARCHAR(100) NOT NULL REFERENCES companies(company_id),
    year INTEGER NOT NULL,
    scope1 DECIMAL(15,3) DEFAULT 0,
    scope2_location_based DECIMAL(15,3) DEFAULT 0,
    scope2_market_based DECIMAL(15,3) DEFAULT 0,
    scope3 JSONB,
    verified BOOLEAN DEFAULT FALSE,
    verifier VARCHAR(255),
    intensity JSONB,
    methodology VARCHAR(255) DEFAULT 'GHG Protocol',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(company_id, year)
);

CREATE TABLE IF NOT EXISTS company_energy (
    id BIGSERIAL PRIMARY KEY,
    company_id VARCHAR(100) NOT NULL REFERENCES companies(company_id),
    year INTEGER NOT NULL,
    total DECIMAL(15,3) DEFAULT 0,
    renewable DECIMAL(15,3) DEFAULT 0,
    electricity DECIMAL(15,3) DEFAULT 0,
    fuel DECIMAL(15,3) DEFAULT 0,
    steam DECIMAL(15,3) DEFAULT 0,
    cooling DECIMAL(15,3) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(company_id, year)
);

CREATE TABLE IF NOT EXISTS emission_targets (
    id BIGSERIAL PRIMARY KEY,
    target_id VARCHAR(50) UNIQUE NOT NULL,
    company_id VARCHAR(100) NOT NULL REFERENCES companies(company_id),
    scope VARCHAR(20) CHECK (scope IN ('SCOPE_1', 'SCOPE_2', 'SCOPE_3', 'SCOPE_1_2', 'SCOPE_1_2_3')),
    target_type VARCHAR(20) CHECK (target_type IN ('ABSOLUTE', 'INTENSITY')),
    base_year INTEGER NOT NULL,
    target_year INTEGER NOT NULL,
    base_year_emissions DECIMAL(15,3) NOT NULL,
    target_emissions DECIMAL(15,3) NOT NULL,
    reduction_percentage DECIMAL(5,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'SET' CHECK (status IN ('SET', 'IN_PROGRESS', 'ACHIEVED', 'MISSED')),
    methodology VARCHAR(255),
    science_based_target BOOLEAN DEFAULT FALSE,
    net_zero_target BOOLEAN DEFAULT FALSE,
    interim_targets JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_emission_targets_company ON emission_targets(company_id);

CREATE TABLE IF NOT EXISTS company_carbon_credits (
    id BIGSERIAL PRIMARY KEY,
    company_id VARCHAR(100) NOT NULL REFERENCES companies(company_id),
    year INTEGER NOT NULL,
    retired DECIMAL(15,3) DEFAULT 0,
    purchased DECIMAL(15,3) DEFAULT 0,
    generated DECIMAL(15,3) DEFAULT 0,
    registries JSONB DEFAULT '[]',
    vintage_range JSONB,
    quality_criteria VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(company_id, year)
);

-- ============================================
-- ISSB S2 Tables
-- ============================================

CREATE TABLE IF NOT EXISTS issb_s2_reports (
    id BIGSERIAL PRIMARY KEY,
    report_id VARCHAR(100) UNIQUE NOT NULL,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    reporting_period_start DATE NOT NULL,
    reporting_period_end DATE NOT NULL,
    governance JSONB NOT NULL,
    strategy JSONB NOT NULL,
    risk_management JSONB NOT NULL,
    metrics_targets JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED')),
    approved_at TIMESTAMP WITH TIME ZONE,
    published_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_issb_s2_entity_period ON issb_s2_reports(entity_id, reporting_period_start, reporting_period_end);
CREATE INDEX idx_issb_s2_status ON issb_s2_reports(status);

CREATE TABLE IF NOT EXISTS entity_emissions (
    id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    scope1 DECIMAL(15,3) DEFAULT 0,
    scope2_location_based DECIMAL(15,3) DEFAULT 0,
    scope2_market_based DECIMAL(15,3) DEFAULT 0,
    scope3 JSONB,
    intensity JSONB,
    methodology VARCHAR(255) DEFAULT 'GHG Protocol',
    verified BOOLEAN DEFAULT FALSE,
    verifier VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entity_id, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS entity_energy (
    id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    total DECIMAL(15,3) DEFAULT 0,
    renewable DECIMAL(15,3) DEFAULT 0,
    electricity DECIMAL(15,3) DEFAULT 0,
    fuel DECIMAL(15,3) DEFAULT 0,
    steam DECIMAL(15,3) DEFAULT 0,
    cooling DECIMAL(15,3) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entity_id, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS entity_emission_targets (
    id BIGSERIAL PRIMARY KEY,
    target_id VARCHAR(50) UNIQUE NOT NULL,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    scope VARCHAR(30) CHECK (scope IN ('SCOPE_1', 'SCOPE_2', 'SCOPE_3', 'SCOPE_1_2', 'SCOPE_1_2_3')),
    target_type VARCHAR(20) CHECK (target_type IN ('ABSOLUTE', 'INTENSITY', 'NET_ZERO', 'SCIENCE_BASED')),
    base_year INTEGER NOT NULL,
    target_year INTEGER NOT NULL,
    base_year_emissions DECIMAL(15,3) NOT NULL,
    target_emissions DECIMAL(15,3) NOT NULL,
    reduction_percentage DECIMAL(5,2) NOT NULL,
    coverage VARCHAR(50) DEFAULT '100%',
    methodology VARCHAR(255),
    verification_status VARCHAR(30) DEFAULT 'UNVERIFIED' CHECK (verification_status IN ('UNVERIFIED', 'LIMITED_ASSURANCE', 'REASONABLE_ASSURANCE', 'THIRD_PARTY_VERIFIED')),
    science_based_target BOOLEAN DEFAULT FALSE,
    net_zero_target BOOLEAN DEFAULT FALSE,
    interim_targets JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_entity_targets_entity ON entity_emission_targets(entity_id);

CREATE TABLE IF NOT EXISTS entity_climate_risks (
    id BIGSERIAL PRIMARY KEY,
    risk_id VARCHAR(50) UNIQUE NOT NULL,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    category VARCHAR(50) CHECK (category IN ('PHYSICAL_ACUTE', 'PHYSICAL_CHRONIC', 'TRANSITION_POLICY', 'TRANSITION_LEGAL', 'TRANSITION_TECHNOLOGY', 'TRANSITION_MARKET', 'TRANSITION_REPUTATION')),
    description TEXT NOT NULL,
    time_horizon VARCHAR(10) CHECK (time_horizon IN ('SHORT', 'MEDIUM', 'LONG')),
    likelihood VARCHAR(30) CHECK (likelihood IN ('VIRTUALLY_CERTAIN', 'VERY_LIKELY', 'LIKELY', 'ABOUT_AS_LIKELY_AS_NOT', 'UNLIKELY', 'VERY_UNLIKELY', 'EXCEPTIONALLY_UNLIKELY')),
    magnitude VARCHAR(10) CHECK (magnitude IN ('HIGH', 'MEDIUM', 'LOW')),
    financial_impact JSONB,
    concentration JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_entity_risks_entity ON entity_climate_risks(entity_id);

CREATE TABLE IF NOT EXISTS entity_climate_opportunities (
    id BIGSERIAL PRIMARY KEY,
    opportunity_id VARCHAR(50) UNIQUE NOT NULL,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    category VARCHAR(30) CHECK (category IN ('RESOURCE_EFFICIENCY', 'ENERGY_SOURCE', 'PRODUCTS_SERVICES', 'MARKETS', 'RESILIENCE')),
    description TEXT NOT NULL,
    time_horizon VARCHAR(10) CHECK (time_horizon IN ('SHORT', 'MEDIUM', 'LONG')),
    likelihood VARCHAR(30) CHECK (likelihood IN ('VIRTUALLY_CERTAIN', 'VERY_LIKELY', 'LIKELY', 'ABOUT_AS_LIKELY_AS_NOT', 'UNLIKELY', 'VERY_UNLIKELY', 'EXCEPTIONALLY_UNLIKELY')),
    magnitude VARCHAR(10) CHECK (magnitude IN ('HIGH', 'MEDIUM', 'LOW')),
    financial_impact JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_entity_opportunities_entity ON entity_climate_opportunities(entity_id);

CREATE TABLE IF NOT EXISTS entity_carbon_credits (
    id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    used_for_offsets DECIMAL(15,3) DEFAULT 0,
    generated DECIMAL(15,3) DEFAULT 0,
    retired DECIMAL(15,3) DEFAULT 0,
    cancelled DECIMAL(15,3) DEFAULT 0,
    vintage_range JSONB,
    registries JSONB DEFAULT '[]',
    project_types JSONB DEFAULT '[]',
    project_ids JSONB DEFAULT '[]',
    purpose JSONB DEFAULT '[]',
    quality_criteria VARCHAR(255),
    cancellation_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entity_id, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS entity_transition_plans (
    id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    targets JSONB DEFAULT '[]',
    actions JSONB DEFAULT '[]',
    governance TEXT,
    capital_allocation JSONB,
    internal_carbon_price JSONB,
    progress JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entity_id)
);

CREATE TABLE IF NOT EXISTS entity_remuneration (
    id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    linked BOOLEAN DEFAULT FALSE,
    percentage DECIMAL(5,2) DEFAULT 0,
    metrics JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entity_id)
);

CREATE TABLE IF NOT EXISTS entity_capital_deployment (
    id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    fossil_fuel_exposure DECIMAL(5,2) DEFAULT 0,
    carbon_intensive_exposure DECIMAL(5,2) DEFAULT 0,
    revenue_carbon_intensive DECIMAL(5,2) DEFAULT 0,
    capex_carbon_intensive DECIMAL(5,2) DEFAULT 0,
    revenue_low_carbon DECIMAL(5,2) DEFAULT 0,
    capex_low_carbon DECIMAL(5,2) DEFAULT 0,
    capex_aligned DECIMAL(5,2) DEFAULT 0,
    capex_climate_solutions DECIMAL(5,2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entity_id, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS entity_governance (
    id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    governance_body JSONB NOT NULL,
    management_role JSONB NOT NULL,
    integration_with_overall_governance TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entity_id)
);

CREATE TABLE IF NOT EXISTS entity_business_model_impacts (
    id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    value_chain TEXT,
    products_services TEXT,
    markets TEXT,
    supply_chain TEXT,
    adaptation TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entity_id)
);

CREATE TABLE IF NOT EXISTS entity_strategy_impacts (
    id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    short_term TEXT,
    medium_term TEXT,
    long_term TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entity_id)
);

CREATE TABLE IF NOT EXISTS entity_financial_position (
    id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    assets TEXT,
    liabilities TEXT,
    equity TEXT,
    revenue TEXT,
    expenses TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entity_id)
);

CREATE TABLE IF NOT EXISTS entity_financial_performance (
    id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    revenue TEXT,
    costs TEXT,
    profitability TEXT,
    cash_flows TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entity_id)
);

CREATE TABLE IF NOT EXISTS entity_financial_planning (
    id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    capital_allocation TEXT,
    capital_expenditure TEXT,
    acquisitions TEXT,
    divestments TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entity_id)
);

CREATE TABLE IF NOT EXISTS entity_climate_resilience (
    id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    assessment_method TEXT,
    scenarios_used JSONB DEFAULT '[]',
    time_horizons JSONB DEFAULT '[]',
    key_assumptions JSONB DEFAULT '{}',
    results JSONB,
    capacity_to_adjust TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entity_id)
);

CREATE TABLE IF NOT EXISTS entity_risk_management (
    id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    identification_processes JSONB,
    assessment_processes JSONB,
    management_processes JSONB,
    monitoring_processes JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entity_id)
);

CREATE TABLE IF NOT EXISTS entity_industry_metrics (
    id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    industry VARCHAR(50),
    metrics JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entity_id)
);

CREATE TABLE IF NOT EXISTS entity_other_metrics (
    id BIGSERIAL PRIMARY KEY,
    metric_id VARCHAR(50) UNIQUE NOT NULL,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    name VARCHAR(255) NOT NULL,
    value DECIMAL(20,6) NOT NULL,
    unit VARCHAR(50) NOT NULL,
    description TEXT,
    methodology TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_other_metrics_entity_period ON entity_other_metrics(entity_id, period_start, period_end);

-- ============================================
-- TNFD Tables
-- ============================================

CREATE TABLE IF NOT EXISTS tnfd_reports (
    id BIGSERIAL PRIMARY KEY,
    report_id VARCHAR(100) UNIQUE NOT NULL,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    reporting_period_start DATE NOT NULL,
    reporting_period_end DATE NOT NULL,
    governance JSONB NOT NULL,
    strategy JSONB NOT NULL,
    risk_impact_management JSONB NOT NULL,
    metrics_targets JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_tnfd_entity_period ON tnfd_reports(entity_id, reporting_period_start, reporting_period_end);
CREATE INDEX idx_tnfd_status ON tnfd_reports(status);

CREATE TABLE IF NOT EXISTS entity_nature_dependencies (
    id BIGSERIAL PRIMARY KEY,
    dependency_id VARCHAR(50) UNIQUE NOT NULL,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    category VARCHAR(20) CHECK (category IN ('PROVISIONING', 'REGULATING', 'CULTURAL', 'SUPPORTING')),
    ecosystem_service VARCHAR(255) NOT NULL,
    description TEXT,
    business_processes JSONB DEFAULT '[]',
    geographic_locations JSONB DEFAULT '[]',
    magnitude VARCHAR(10) CHECK (magnitude IN ('HIGH', 'MEDIUM', 'LOW')),
    trend VARCHAR(20) CHECK (trend IN ('INCREASING', 'STABLE', 'DECREASING')),
    time_horizon VARCHAR(10) CHECK (time_horizon IN ('SHORT', 'MEDIUM', 'LONG')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_nature_deps_entity ON entity_nature_dependencies(entity_id);

CREATE TABLE IF NOT EXISTS entity_nature_impacts (
    id BIGSERIAL PRIMARY KEY,
    impact_id VARCHAR(50) UNIQUE NOT NULL,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    category VARCHAR(30) CHECK (category IN ('LAND_USE_CHANGE', 'RESOURCE_EXPLOITATION', 'CLIMATE_CHANGE', 'POLLUTION', 'INVASIVE_SPECIES', 'OTHER')),
    driver VARCHAR(255) NOT NULL,
    description TEXT,
    affected_ecosystems JSONB DEFAULT '[]',
    geographic_locations JSONB DEFAULT '[]',
    magnitude VARCHAR(10) CHECK (magnitude IN ('HIGH', 'MEDIUM', 'LOW')),
    trend VARCHAR(20) CHECK (trend IN ('INCREASING', 'STABLE', 'DECREASING')),
    time_horizon VARCHAR(10) CHECK (time_horizon IN ('SHORT', 'MEDIUM', 'LONG')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_nature_impacts_entity ON entity_nature_impacts(entity_id);

CREATE TABLE IF NOT EXISTS entity_nature_risks (
    id BIGSERIAL PRIMARY KEY,
    risk_id VARCHAR(50) UNIQUE NOT NULL,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    category VARCHAR(20) CHECK (category IN ('PHYSICAL', 'TRANSITION', 'SYSTEMIC', 'LITIGATION', 'REPUTATIONAL')),
    sub_category VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    dependencies_impacted JSONB DEFAULT '[]',
    impacts_exacerbated JSONB DEFAULT '[]',
    likelihood VARCHAR(30) CHECK (likelihood IN ('VIRTUALLY_CERTAIN', 'VERY_LIKELY', 'LIKELY', 'ABOUT_AS_LIKELY_AS_NOT', 'UNLIKELY', 'VERY_UNLIKELY', 'EXCEPTIONALLY_UNLIKELY')),
    magnitude VARCHAR(10) CHECK (magnitude IN ('HIGH', 'MEDIUM', 'LOW')),
    time_horizon VARCHAR(10) CHECK (time_horizon IN ('SHORT', 'MEDIUM', 'LONG')),
    financial_impact JSONB,
    concentration JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_nature_risks_entity ON entity_nature_risks(entity_id);

CREATE TABLE IF NOT EXISTS entity_nature_opportunities (
    id BIGSERIAL PRIMARY KEY,
    opportunity_id VARCHAR(50) UNIQUE NOT NULL,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    category VARCHAR(30) CHECK (category IN ('RESOURCE_EFFICIENCY', 'PRODUCT_INNOVATION', 'MARKET_ACCESS', 'RESILIENCE', 'FINANCING', 'OTHER')),
    description TEXT NOT NULL,
    dependencies_addressed JSONB DEFAULT '[]',
    impacts_mitigated JSONB DEFAULT '[]',
    likelihood VARCHAR(30) CHECK (likelihood IN ('VIRTUALLY_CERTAIN', 'VERY_LIKELY', 'LIKELY', 'ABOUT_AS_LIKELY_AS_NOT', 'UNLIKELY', 'VERY_UNLIKELY', 'EXCEPTIONALLY_UNLIKELY')),
    magnitude VARCHAR(10) CHECK (magnitude IN ('HIGH', 'MEDIUM', 'LOW')),
    time_horizon VARCHAR(10) CHECK (time_horizon IN ('SHORT', 'MEDIUM', 'LONG')),
    financial_impact JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_nature_opps_entity ON entity_nature_opportunities(entity_id);

CREATE TABLE IF NOT EXISTS entity_tnfd_scenarios (
    id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    scenarios JSONB DEFAULT '[]',
    methodology TEXT,
    time_horizons JSONB DEFAULT '[]',
    key_assumptions JSONB DEFAULT '{}',
    results JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entity_id)
);

CREATE TABLE IF NOT EXISTS entity_tnfd_transition_plans (
    id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    targets JSONB DEFAULT '[]',
    actions JSONB DEFAULT '[]',
    governance TEXT,
    capital_allocation JSONB,
    progress JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entity_id)
);

CREATE TABLE IF NOT EXISTS entity_tnfd_indicators (
    id BIGSERIAL PRIMARY KEY,
    indicator_id VARCHAR(50) UNIQUE NOT NULL,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(30) CHECK (category IN ('STATE_OF_NATURE', 'PRESSURE_ON_NATURE', 'RESPONSE', 'ENABLING_CONDITIONS')),
    value DECIMAL(20,6) NOT NULL,
    unit VARCHAR(50) NOT NULL,
    trend VARCHAR(20) CHECK (trend IN ('IMPROVING', 'STABLE', 'DETERIORATING')),
    baseline_year INTEGER NOT NULL,
    current_year INTEGER NOT NULL,
    target_year INTEGER,
    target_value DECIMAL(20,6),
    methodology TEXT,
    spatial_resolution VARCHAR(100),
    data_source VARCHAR(255),
    verification_status VARCHAR(30) DEFAULT 'UNVERIFIED' CHECK (verification_status IN ('UNVERIFIED', 'LIMITED_ASSURANCE', 'REASONABLE_ASSURANCE', 'THIRD_PARTY_VERIFIED')),
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_tnfd_indicators_entity_period ON entity_tnfd_indicators(entity_id, period_start, period_end);

CREATE TABLE IF NOT EXISTS entity_tnfd_targets (
    id BIGSERIAL PRIMARY KEY,
    target_id VARCHAR(50) UNIQUE NOT NULL,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    category VARCHAR(40) CHECK (category IN ('DEPENDENCY_REDUCTION', 'IMPACT_REDUCTION', 'RISK_MITIGATION', 'OPPORTUNITY_REALIZATION', 'NATURE_POSITIVE', 'NO_NET_LOSS', 'NET_GAIN', 'ECOSYSTEM_RESTORATION')),
    description TEXT,
    scope VARCHAR(30) CHECK (scope IN ('DIRECT_OPERATIONS', 'UPSTREAM', 'DOWNSTREAM', 'FULL_VALUE_CHAIN')),
    baseline_year INTEGER NOT NULL,
    target_year INTEGER NOT NULL,
    baseline_value DECIMAL(20,6) NOT NULL,
    target_value DECIMAL(20,6) NOT NULL,
    unit VARCHAR(50) NOT NULL,
    methodology TEXT,
    verification_status VARCHAR(30) DEFAULT 'UNVERIFIED' CHECK (verification_status IN ('UNVERIFIED', 'LIMITED_ASSURANCE', 'REASONABLE_ASSURANCE', 'THIRD_PARTY_VERIFIED')),
    alignment_with_gbf BOOLEAN DEFAULT FALSE,
    alignment_with_sbtn BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_tnfd_targets_entity ON entity_tnfd_targets(entity_id);

CREATE TABLE IF NOT EXISTS entity_tnfd_governance (
    id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    board_oversight JSONB NOT NULL,
    management_role JSONB NOT NULL,
    integration_with_climate_governance TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entity_id)
);

CREATE TABLE IF NOT EXISTS entity_tnfd_business_model (
    id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    value_chain TEXT,
    products_services TEXT,
    markets TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entity_id)
);

CREATE TABLE IF NOT EXISTS entity_tnfd_strategy_impacts (
    id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    short_term TEXT,
    medium_term TEXT,
    long_term TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entity_id)
);

CREATE TABLE IF NOT EXISTS entity_tnfd_financial_planning (
    id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    capital_allocation TEXT,
    operating_expenditure TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entity_id)
);

CREATE TABLE IF NOT EXISTS entity_tnfd_risk_management (
    id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    identification JSONB,
    assessment JSONB,
    management JSONB,
    monitoring JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entity_id)
);

CREATE TABLE IF NOT EXISTS entity_tnfd_sector_indicators (
    id BIGSERIAL PRIMARY KEY,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    sector VARCHAR(100),
    indicators JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(entity_id)
);

-- ============================================
-- Updated timestamps trigger
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply to all new tables
DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE '%compliance%' OR tablename LIKE '%cbam%' OR tablename LIKE '%sec_climate%' OR tablename LIKE '%issb%' OR tablename LIKE '%tnfd%' OR tablename LIKE '%climate%' OR tablename LIKE '%entity_%' OR tablename LIKE '%emission%' OR tablename LIKE '%carbon%'
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS update_%s_updated_at ON %s', t, t);
        EXECUTE format('CREATE TRIGGER update_%s_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', t, t);
    END LOOP;
END $$;