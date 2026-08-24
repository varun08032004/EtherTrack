-- Migration: Add ERP Integration Tables
-- Created: 2024-01-15
-- Description: Tables for ERP connectors, sync logs, and synchronized data

-- ============================================
-- ERP Connectors
-- ============================================

CREATE TABLE IF NOT EXISTS erp_connectors (
    id BIGSERIAL PRIMARY KEY,
    connector_id VARCHAR(100) UNIQUE NOT NULL,
    entity_id VARCHAR(100) NOT NULL REFERENCES entities(entity_id),
    erp_type VARCHAR(30) NOT NULL CHECK (erp_type IN ('SAP', 'ORACLE', 'NETSUITE', 'TALLY', 'ZOHO', 'QUICKBOOKS', 'XERO', 'SAGE', 'CUSTOM')),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    credentials JSONB NOT NULL,
    sync_config JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'ERROR', 'SYNCING')),
    last_sync_at TIMESTAMP WITH TIME ZONE,
    last_sync_status VARCHAR(20) CHECK (last_sync_status IN ('SUCCESS', 'PARTIAL', 'FAILED')),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_erp_connectors_entity ON erp_connectors(entity_id);
CREATE INDEX idx_erp_connectors_status ON erp_connectors(status);
CREATE INDEX idx_erp_connectors_type ON erp_connectors(erp_type);

-- ============================================
-- ERP Sync Logs
-- ============================================

CREATE TABLE IF NOT EXISTS erp_sync_logs (
    id BIGSERIAL PRIMARY KEY,
    sync_id VARCHAR(100) UNIQUE NOT NULL,
    connector_id VARCHAR(100) NOT NULL REFERENCES erp_connectors(connector_id),
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'SYNCING' CHECK (status IN ('SYNCING', 'SUCCESS', 'PARTIAL', 'FAILED')),
    records_processed INTEGER DEFAULT 0,
    records_created INTEGER DEFAULT 0,
    records_updated INTEGER DEFAULT 0,
    records_failed INTEGER DEFAULT 0,
    errors JSONB DEFAULT '[]',
    duration_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_erp_sync_logs_connector ON erp_sync_logs(connector_id);
CREATE INDEX idx_erp_sync_logs_started ON erp_sync_logs(started_at DESC);
CREATE INDEX idx_erp_sync_logs_status ON erp_sync_logs(status);

-- ============================================
-- ERP Chart of Accounts
-- ============================================

CREATE TABLE IF NOT EXISTS erp_chart_of_accounts (
    id BIGSERIAL PRIMARY KEY,
    connector_id VARCHAR(100) NOT NULL REFERENCES erp_connectors(connector_id),
    account_code VARCHAR(50) NOT NULL,
    account_name VARCHAR(255) NOT NULL,
    account_type VARCHAR(20) CHECK (account_type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'COGS')),
    parent_account_code VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    currency VARCHAR(3) DEFAULT 'USD',
    description TEXT,
    carbon_related BOOLEAN DEFAULT FALSE,
    emission_category VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(connector_id, account_code)
);

CREATE INDEX idx_erp_coa_connector ON erp_chart_of_accounts(connector_id);
CREATE INDEX idx_erp_coa_carbon ON erp_chart_of_accounts(carbon_related) WHERE carbon_related = true;

-- ============================================
-- ERP Cost Centers
-- ============================================

CREATE TABLE IF NOT EXISTS erp_cost_centers (
    id BIGSERIAL PRIMARY KEY,
    connector_id VARCHAR(100) NOT NULL REFERENCES erp_connectors(connector_id),
    cost_center_code VARCHAR(50) NOT NULL,
    cost_center_name VARCHAR(255) NOT NULL,
    parent_cost_center_code VARCHAR(50),
    responsible_person VARCHAR(255),
    department VARCHAR(100),
    location VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    carbon_budget DECIMAL(15,3), -- tCO2e/year
    actual_emissions DECIMAL(15,3) DEFAULT 0, -- tCO2e
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(connector_id, cost_center_code)
);

CREATE INDEX idx_erp_cc_connector ON erp_cost_centers(connector_id);
CREATE INDEX idx_erp_cc_carbon_budget ON erp_cost_centers(carbon_budget) WHERE carbon_budget IS NOT NULL;

-- ============================================
-- ERP Projects
-- ============================================

CREATE TABLE IF NOT EXISTS erp_projects (
    id BIGSERIAL PRIMARY KEY,
    connector_id VARCHAR(100) NOT NULL REFERENCES erp_connectors(connector_id),
    project_code VARCHAR(50) NOT NULL,
    project_name VARCHAR(255) NOT NULL,
    description TEXT,
    start_date DATE,
    end_date DATE,
    status VARCHAR(20) DEFAULT 'PLANNING' CHECK (status IN ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED')),
    project_manager VARCHAR(255),
    budget DECIMAL(15,2),
    currency VARCHAR(3) DEFAULT 'USD',
    carbon_budget DECIMAL(15,3), -- tCO2e
    actual_emissions DECIMAL(15,3) DEFAULT 0, -- tCO2e
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(connector_id, project_code)
);

CREATE INDEX idx_erp_projects_connector ON erp_projects(connector_id);
CREATE INDEX idx_erp_projects_status ON erp_projects(status);

-- ============================================
-- ERP Journal Entries
-- ============================================

CREATE TABLE IF NOT EXISTS erp_journal_entries (
    id BIGSERIAL PRIMARY KEY,
    connector_id VARCHAR(100) NOT NULL REFERENCES erp_connectors(connector_id),
    entry_number VARCHAR(100) NOT NULL,
    entry_date DATE NOT NULL,
    posting_date DATE NOT NULL,
    description TEXT,
    reference VARCHAR(255),
    lines JSONB NOT NULL DEFAULT '[]',
    total_debit DECIMAL(15,2) NOT NULL,
    total_credit DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    status VARCHAR(20) DEFAULT 'POSTED' CHECK (status IN ('DRAFT', 'POSTED', 'REVERSED')),
    carbon_related BOOLEAN DEFAULT FALSE,
    emission_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(connector_id, entry_number)
);

CREATE INDEX idx_erp_je_connector ON erp_journal_entries(connector_id);
CREATE INDEX idx_erp_je_date ON erp_journal_entries(entry_date);
CREATE INDEX idx_erp_je_carbon ON erp_journal_entries(carbon_related) WHERE carbon_related = true;
CREATE INDEX idx_erp_je_emission ON erp_journal_entries USING GIN (emission_data);

-- ============================================
-- ERP Vendors
-- ============================================

CREATE TABLE IF NOT EXISTS erp_vendors (
    id BIGSERIAL PRIMARY KEY,
    connector_id VARCHAR(100) NOT NULL REFERENCES erp_connectors(connector_id),
    vendor_code VARCHAR(50) NOT NULL,
    vendor_name VARCHAR(255) NOT NULL,
    tax_id VARCHAR(100),
    address TEXT,
    country VARCHAR(2),
    contact_person VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    payment_terms VARCHAR(100),
    currency VARCHAR(3) DEFAULT 'USD',
    is_active BOOLEAN DEFAULT TRUE,
    carbon_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(connector_id, vendor_code)
);

CREATE INDEX idx_erp_vendors_connector ON erp_vendors(connector_id);

-- ============================================
-- ERP Customers
-- ============================================

CREATE TABLE IF NOT EXISTS erp_customers (
    id BIGSERIAL PRIMARY KEY,
    connector_id VARCHAR(100) NOT NULL REFERENCES erp_connectors(connector_id),
    customer_code VARCHAR(50) NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    tax_id VARCHAR(100),
    address TEXT,
    country VARCHAR(2),
    contact_person VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    payment_terms VARCHAR(100),
    currency VARCHAR(3) DEFAULT 'USD',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(connector_id, customer_code)
);

CREATE INDEX idx_erp_customers_connector ON erp_customers(connector_id);

-- ============================================
-- ERP Invoices
-- ============================================

CREATE TABLE IF NOT EXISTS erp_invoices (
    id BIGSERIAL PRIMARY KEY,
    connector_id VARCHAR(100) NOT NULL REFERENCES erp_connectors(connector_id),
    invoice_number VARCHAR(100) NOT NULL,
    invoice_type VARCHAR(20) CHECK (invoice_type IN ('SALES', 'PURCHASE', 'CREDIT_MEMO', 'DEBIT_MEMO')),
    invoice_date DATE NOT NULL,
    due_date DATE,
    customer_code VARCHAR(50),
    vendor_code VARCHAR(50),
    total_amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    status VARCHAR(20) DEFAULT 'OPEN' CHECK (status IN ('DRAFT', 'OPEN', 'PAID', 'CANCELLED', 'OVERDUE')),
    carbon_related BOOLEAN DEFAULT FALSE,
    emission_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(connector_id, invoice_number)
);

CREATE INDEX idx_erp_invoices_connector ON erp_invoices(connector_id);
CREATE INDEX idx_erp_invoices_date ON erp_invoices(invoice_date);
CREATE INDEX idx_erp_invoices_carbon ON erp_invoices(carbon_related) WHERE carbon_related = true;

-- ============================================
-- ERP Inventory
-- ============================================

CREATE TABLE IF NOT EXISTS erp_inventory (
    id BIGSERIAL PRIMARY KEY,
    connector_id VARCHAR(100) NOT NULL REFERENCES erp_connectors(connector_id),
    item_code VARCHAR(100) NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    description TEXT,
    unit_of_measure VARCHAR(50),
    standard_cost DECIMAL(15,4),
    currency VARCHAR(3) DEFAULT 'USD',
    is_active BOOLEAN DEFAULT TRUE,
    carbon_data JSONB, -- emission factor, category, etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(connector_id, item_code)
);

CREATE INDEX idx_erp_inventory_connector ON erp_inventory(connector_id);

-- ============================================
-- ERP Fixed Assets
-- ============================================

CREATE TABLE IF NOT EXISTS erp_fixed_assets (
    id BIGSERIAL PRIMARY KEY,
    connector_id VARCHAR(100) NOT NULL REFERENCES erp_connectors(connector_id),
    asset_code VARCHAR(100) NOT NULL,
    asset_name VARCHAR(255) NOT NULL,
    asset_category VARCHAR(100),
    acquisition_date DATE,
    acquisition_cost DECIMAL(15,2),
    currency VARCHAR(3) DEFAULT 'USD',
    useful_life_years INTEGER,
    depreciation_method VARCHAR(50),
    location VARCHAR(255),
    cost_center_code VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    carbon_data JSONB, -- embodied carbon, operational emissions
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(connector_id, asset_code)
);

CREATE INDEX idx_erp_fa_connector ON erp_fixed_assets(connector_id);

-- ============================================
-- ERP Carbon Emission Factors (pushed from our system)
-- ============================================

CREATE TABLE IF NOT EXISTS erp_emission_factors (
    id BIGSERIAL PRIMARY KEY,
    connector_id VARCHAR(100) NOT NULL REFERENCES erp_connectors(connector_id),
    factor_code VARCHAR(100) NOT NULL,
    factor_name VARCHAR(255) NOT NULL,
    description TEXT,
    scope VARCHAR(20) CHECK (scope IN ('SCOPE_1', 'SCOPE_2', 'SCOPE_3')),
    category VARCHAR(100),
    subcategory VARCHAR(100),
    activity_unit VARCHAR(50) NOT NULL,
    emission_factor DECIMAL(15,6) NOT NULL, -- tCO2e per unit
    unit VARCHAR(20) NOT NULL, -- tCO2e/unit
    region VARCHAR(100),
    source VARCHAR(255), -- e.g., 'IPCC 2006', 'CEA V20', 'EPA', 'DEFRA'
    year INTEGER,
    uncertainty DECIMAL(5,2), -- percentage
    is_active BOOLEAN DEFAULT TRUE,
    pushed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(connector_id, factor_code)
);

CREATE INDEX idx_erp_ef_connector ON erp_emission_factors(connector_id);
CREATE INDEX idx_erp_ef_scope ON erp_emission_factors(scope);
CREATE INDEX idx_erp_ef_category ON erp_emission_factors(category);

-- ============================================
-- ERP Activity Data (pushed from our system)
-- ============================================

CREATE TABLE IF NOT EXISTS erp_activity_data (
    id BIGSERIAL PRIMARY KEY,
    connector_id VARCHAR(100) NOT NULL REFERENCES erp_connectors(connector_id),
    activity_code VARCHAR(100) NOT NULL,
    activity_name VARCHAR(255) NOT NULL,
    description TEXT,
    scope VARCHAR(20) CHECK (scope IN ('SCOPE_1', 'SCOPE_2', 'SCOPE_3')),
    category VARCHAR(100),
    cost_center_code VARCHAR(50),
    project_code VARCHAR(50),
    activity_value DECIMAL(15,3) NOT NULL,
    activity_unit VARCHAR(50) NOT NULL,
    emission_factor DECIMAL(15,6) NOT NULL,
    emissions DECIMAL(15,3) NOT NULL, -- calculated tCO2e
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    data_source VARCHAR(100), -- 'ERP', 'METER', 'ESTIMATE', 'INVOICE'
    data_quality VARCHAR(20) DEFAULT 'MEDIUM' CHECK (data_quality IN ('HIGH', 'MEDIUM', 'LOW')),
    pushed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_erp_ad_connector ON erp_activity_data(connector_id);
CREATE INDEX idx_erp_ad_period ON erp_activity_data(period_start, period_end);
CREATE INDEX idx_erp_ad_scope ON erp_activity_data(scope);
CREATE INDEX idx_erp_ad_cost_center ON erp_activity_data(cost_center_code);

-- ============================================
-- ERP Carbon Credits (pushed from our system)
-- ============================================

CREATE TABLE IF NOT EXISTS erp_carbon_credits (
    id BIGSERIAL PRIMARY KEY,
    connector_id VARCHAR(100) NOT NULL REFERENCES erp_connectors(connector_id),
    credit_id VARCHAR(100) NOT NULL,
    credit_type VARCHAR(50) CHECK (credit_type IN ('VCU', 'CER', 'ERU', 'CCER', 'NZU', 'ACCU', 'OTHER')),
    registry VARCHAR(50), -- 'VERRA', 'GOLD_STANDARD', 'CDM', 'ACR', 'CAR', 'CCTS'
    project_id VARCHAR(100),
    project_name VARCHAR(255),
    vintage INTEGER,
    quantity DECIMAL(15,3) NOT NULL, -- tCO2e
    unit VARCHAR(20) DEFAULT 'tCO2e',
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED', 'TRANSFERRED', 'CANCELLED', 'EXPIRED')),
    purchase_date DATE,
    purchase_price DECIMAL(15,2),
    currency VARCHAR(3) DEFAULT 'USD',
    retirement_date DATE,
    retirement_reason VARCHAR(255),
    cost_center_code VARCHAR(50),
    project_code VARCHAR(50),
    pushed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(connector_id, credit_id)
);

CREATE INDEX idx_erp_cc_connector ON erp_carbon_credits(connector_id);
CREATE INDEX idx_erp_cc_status ON erp_carbon_credits(status);
CREATE INDEX idx_erp_cc_vintage ON erp_carbon_credits(vintage);

-- ============================================
-- ERP Carbon Prices (pushed from our system)
-- ============================================

CREATE TABLE IF NOT EXISTS erp_carbon_prices (
    id BIGSERIAL PRIMARY KEY,
    connector_id VARCHAR(100) NOT NULL REFERENCES erp_connectors(connector_id),
    price_code VARCHAR(100) NOT NULL,
    price_name VARCHAR(255) NOT NULL,
    market VARCHAR(100), -- 'EU_ETS', 'CALIFORNIA', 'RGGI', 'CCTS', 'VCM', 'INTERNAL'
    instrument VARCHAR(50), -- 'ALLOWANCE', 'CREDIT', 'OFFSET', 'TAX'
    price DECIMAL(15,4) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    unit VARCHAR(50) DEFAULT 'tCO2e',
    price_date DATE NOT NULL,
    source VARCHAR(255), -- 'ICE', 'EEX', 'CME', 'BNEF', 'INTERNAL_MODEL'
    is_forecast BOOLEAN DEFAULT FALSE,
    pushed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(connector_id, price_code, price_date)
);

CREATE INDEX idx_erp_cp_connector ON erp_carbon_prices(connector_id);
CREATE INDEX idx_erp_cp_date ON erp_carbon_prices(price_date);
CREATE INDEX idx_erp_cp_market ON erp_carbon_prices(market);

-- ============================================
-- Updated timestamps trigger
-- ============================================

DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'erp_%'
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS update_%s_updated_at ON %s', t, t);
        EXECUTE format('CREATE TRIGGER update_%s_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', t, t);
    END LOOP;
END $$;