-- Migration: Add White-label SaaS Platform Tables
-- Created: 2024-01-15
-- Description: Tables for multi-tenancy, SSO/SCIM, RBAC, audit logs, API gateway

-- ============================================
-- Tenants
-- ============================================

CREATE TABLE IF NOT EXISTS tenants (
    id BIGSERIAL PRIMARY KEY,
    tenant_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    domain VARCHAR(255),
    subdomain VARCHAR(100) UNIQUE NOT NULL,
    logo_url VARCHAR(500),
    primary_color VARCHAR(7) DEFAULT '#0066CC',
    secondary_color VARCHAR(7) DEFAULT '#004499',
    favicon_url VARCHAR(500),
    email_from_name VARCHAR(100) DEFAULT 'EtherTrack',
    email_from_address VARCHAR(255) DEFAULT 'noreply@ethertrack.com',
    support_email VARCHAR(255) DEFAULT 'support@ethertrack.com',
    status VARCHAR(20) DEFAULT 'TRIAL' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'TRIAL', 'EXPIRED', 'PENDING_SETUP')),
    plan VARCHAR(20) DEFAULT 'STARTER' CHECK (plan IN ('STARTER', 'PROFESSIONAL', 'ENTERPRISE', 'CUSTOM')),
    billing_cycle VARCHAR(20) DEFAULT 'MONTHLY' CHECK (billing_cycle IN ('MONTHLY', 'ANNUAL')),
    trial_ends_at TIMESTAMP WITH TIME ZONE,
    subscription_ends_at TIMESTAMP WITH TIME ZONE,
    max_users INTEGER DEFAULT 10,
    max_projects INTEGER DEFAULT 50,
    max_api_calls INTEGER DEFAULT 100000,
    storage_limit_gb INTEGER DEFAULT 10,
    features JSONB NOT NULL DEFAULT '{}',
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_tenants_status ON tenants(status);
CREATE INDEX idx_tenants_plan ON tenants(plan);
CREATE INDEX idx_tenants_subdomain ON tenants(subdomain);
CREATE INDEX idx_tenants_domain ON tenants(domain);

-- ============================================
-- Tenant Users
-- ============================================

CREATE TABLE IF NOT EXISTS tenant_users (
    id BIGSERIAL PRIMARY KEY,
    user_id VARCHAR(100) UNIQUE NOT NULL,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(tenant_id),
    email VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(50),
    avatar_url VARCHAR(500),
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'PENDING_INVITE', 'SUSPENDED', 'LOCKED')),
    roles JSONB DEFAULT '[]', -- Array of role IDs
    groups JSONB DEFAULT '[]', -- Array of group IDs
    mfa_enabled BOOLEAN DEFAULT FALSE,
    mfa_secret VARCHAR(100),
    last_login_at TIMESTAMP WITH TIME ZONE,
    last_login_ip VARCHAR(50),
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP WITH TIME ZONE,
    password_changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    email_verified BOOLEAN DEFAULT FALSE,
    phone_verified BOOLEAN DEFAULT FALSE,
    invited_by VARCHAR(100),
    invited_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, email)
);

CREATE INDEX idx_tenant_users_tenant ON tenant_users(tenant_id);
CREATE INDEX idx_tenant_users_email ON tenant_users(email);
CREATE INDEX idx_tenant_users_status ON tenant_users(status);

-- ============================================
-- Tenant Roles
-- ============================================

CREATE TABLE IF NOT EXISTS tenant_roles (
    id BIGSERIAL PRIMARY KEY,
    role_id VARCHAR(100) UNIQUE NOT NULL,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(tenant_id),
    name VARCHAR(100) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    description TEXT,
    permissions JSONB NOT NULL DEFAULT '[]',
    is_system BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, name)
);

CREATE INDEX idx_tenant_roles_tenant ON tenant_roles(tenant_id);

-- ============================================
-- Tenant Groups
-- ============================================

CREATE TABLE IF NOT EXISTS tenant_groups (
    id BIGSERIAL PRIMARY KEY,
    group_id VARCHAR(100) UNIQUE NOT NULL,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(tenant_id),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    parent_group_id VARCHAR(100) REFERENCES tenant_groups(group_id),
    members JSONB DEFAULT '[]', -- Array of user IDs
    roles JSONB DEFAULT '[]', -- Array of role IDs
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, name)
);

CREATE INDEX idx_tenant_groups_tenant ON tenant_groups(tenant_id);

-- ============================================
-- API Keys
-- ============================================

CREATE TABLE IF NOT EXISTS api_keys (
    id BIGSERIAL PRIMARY KEY,
    api_key_id VARCHAR(100) UNIQUE NOT NULL,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(tenant_id),
    name VARCHAR(255) NOT NULL,
    key_prefix VARCHAR(20) NOT NULL,
    key_hash VARCHAR(100) NOT NULL,
    permissions JSONB DEFAULT '[]',
    rate_limit INTEGER DEFAULT 60,
    ip_whitelist JSONB DEFAULT '[]',
    expires_at TIMESTAMP WITH TIME ZONE,
    last_used_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX idx_api_keys_status ON api_keys(status);

-- ============================================
-- Audit Logs
-- ============================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    log_id VARCHAR(100) UNIQUE NOT NULL,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(tenant_id),
    user_id VARCHAR(100),
    api_key_id VARCHAR(100),
    action VARCHAR(100) NOT NULL,
    resource VARCHAR(100) NOT NULL,
    resource_id VARCHAR(100),
    resource_type VARCHAR(100),
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(50) NOT NULL,
    user_agent TEXT,
    request_id VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'SUCCESS' CHECK (status IN ('SUCCESS', 'FAILURE', 'PARTIAL')),
    error_message TEXT,
    duration_ms INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource, resource_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);

-- Partition by month for performance
-- CREATE TABLE audit_logs_y2024m01 PARTITION OF audit_logs FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

-- ============================================
-- SSO Configurations
-- ============================================

CREATE TABLE IF NOT EXISTS sso_configs (
    id BIGSERIAL PRIMARY KEY,
    sso_id VARCHAR(100) UNIQUE NOT NULL,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(tenant_id),
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('SAML2', 'OIDC', 'OAUTH2', 'LDAP', 'CUSTOM')),
    name VARCHAR(100) NOT NULL,
    enabled BOOLEAN DEFAULT FALSE,
    config JSONB NOT NULL DEFAULT '{}',
    attribute_mapping JSONB NOT NULL DEFAULT '{}',
    just_in_time_provisioning BOOLEAN DEFAULT TRUE,
    default_role VARCHAR(100),
    default_groups JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, provider)
);

CREATE INDEX idx_sso_configs_tenant ON sso_configs(tenant_id);

-- ============================================
-- SCIM Configurations
-- ============================================

CREATE TABLE IF NOT EXISTS scim_configs (
    id BIGSERIAL PRIMARY KEY,
    scim_id VARCHAR(100) UNIQUE NOT NULL,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(tenant_id),
    enabled BOOLEAN DEFAULT FALSE,
    base_url VARCHAR(255) NOT NULL,
    bearer_token VARCHAR(500) NOT NULL,
    schemas JSONB DEFAULT '["urn:ietf:params:scim:schemas:core:2.0:User", "urn:ietf:params:scim:schemas:core:2.0:Group"]',
    user_provisioning BOOLEAN DEFAULT TRUE,
    group_provisioning BOOLEAN DEFAULT TRUE,
    filter VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id)
);

-- ============================================
-- Custom Domains
-- ============================================

CREATE TABLE IF NOT EXISTS custom_domains (
    id BIGSERIAL PRIMARY KEY,
    domain_id VARCHAR(100) UNIQUE NOT NULL,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(tenant_id),
    domain VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'ACTIVE', 'FAILED', 'EXPIRED')),
    verification_token VARCHAR(100) NOT NULL,
    verification_record VARCHAR(500) NOT NULL,
    ssl_enabled BOOLEAN DEFAULT TRUE,
    ssl_certificate TEXT,
    ssl_private_key TEXT,
    ssl_expires_at TIMESTAMP WITH TIME ZONE,
    cname_target VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    verified_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_custom_domains_tenant ON custom_domains(tenant_id);
CREATE INDEX idx_custom_domains_status ON custom_domains(status);

-- ============================================
-- Webhooks
-- ============================================

CREATE TABLE IF NOT EXISTS webhooks (
    id BIGSERIAL PRIMARY KEY,
    webhook_id VARCHAR(100) UNIQUE NOT NULL,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(tenant_id),
    name VARCHAR(255) NOT NULL,
    url VARCHAR(500) NOT NULL,
    events JSONB NOT NULL DEFAULT '[]',
    secret VARCHAR(100) NOT NULL,
    headers JSONB DEFAULT '{}',
    retry_policy JSONB NOT NULL DEFAULT '{"maxRetries": 3, "initialDelayMs": 1000, "maxDelayMs": 60000, "backoffMultiplier": 2, "retryableStatusCodes": [408, 429, 500, 502, 503, 504]}',
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED', 'FAILED')),
    last_triggered_at TIMESTAMP WITH TIME ZONE,
    failure_count INTEGER DEFAULT 0,
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_webhooks_tenant ON webhooks(tenant_id);
CREATE INDEX idx_webhooks_status ON webhooks(status);

-- ============================================
-- Webhook Deliveries
-- ============================================

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id BIGSERIAL PRIMARY KEY,
    delivery_id VARCHAR(100) UNIQUE NOT NULL,
    webhook_id VARCHAR(100) NOT NULL REFERENCES webhooks(webhook_id),
    event VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    response_status INTEGER,
    response_body TEXT,
    attempt INTEGER DEFAULT 1,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DELIVERED', 'FAILED', 'RETRYING')),
    error_message TEXT,
    duration_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id);
CREATE INDEX idx_webhook_deliveries_status ON webhook_deliveries(status);
CREATE INDEX idx_webhook_deliveries_created ON webhook_deliveries(created_at DESC);

-- ============================================
-- Rate Limit Configurations
-- ============================================

CREATE TABLE IF NOT EXISTS rate_limit_configs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id VARCHAR(100) UNIQUE NOT NULL REFERENCES tenants(tenant_id),
    api_calls_per_minute INTEGER DEFAULT 60,
    api_calls_per_hour INTEGER DEFAULT 1000,
    api_calls_per_day INTEGER DEFAULT 10000,
    api_calls_per_month INTEGER DEFAULT 100000,
    burst_allowance INTEGER DEFAULT 10,
    custom_limits JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Tenant Subscriptions/Billing
-- ============================================

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
    id BIGSERIAL PRIMARY KEY,
    subscription_id VARCHAR(100) UNIQUE NOT NULL,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(tenant_id),
    plan VARCHAR(20) NOT NULL CHECK (plan IN ('STARTER', 'PROFESSIONAL', 'ENTERPRISE', 'CUSTOM')),
    billing_cycle VARCHAR(20) NOT NULL CHECK (billing_cycle IN ('MONTHLY', 'ANNUAL')),
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAST_DUE', 'CANCELLED', 'TRIALING', 'INCOMPLETE')),
    current_period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    current_period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    trial_start TIMESTAMP WITH TIME ZONE,
    trial_end TIMESTAMP WITH TIME ZONE,
    quantity INTEGER DEFAULT 1,
    unit_amount INTEGER, -- in cents
    currency VARCHAR(3) DEFAULT 'USD',
    payment_method_id VARCHAR(100),
    customer_id VARCHAR(100), -- Stripe customer ID
    subscription_id_external VARCHAR(100), -- Stripe subscription ID
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_tenant_subscriptions_tenant ON tenant_subscriptions(tenant_id);
CREATE INDEX idx_tenant_subscriptions_status ON tenant_subscriptions(status);

-- ============================================
-- Tenant Usage Metrics
-- ============================================

CREATE TABLE IF NOT EXISTS tenant_usage_metrics (
    id BIGSERIAL PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(tenant_id),
    date DATE NOT NULL,
    api_calls INTEGER DEFAULT 0,
    active_users INTEGER DEFAULT 0,
    projects_count INTEGER DEFAULT 0,
    storage_used_gb DECIMAL(10,2) DEFAULT 0,
    bandwidth_gb DECIMAL(10,2) DEFAULT 0,
    report_generations INTEGER DEFAULT 0,
    mrv_workflows INTEGER DEFAULT 0,
    marketplace_transactions INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, date)
);

CREATE INDEX idx_tenant_usage_tenant_date ON tenant_usage_metrics(tenant_id, date DESC);

-- ============================================
-- Updated timestamps trigger
-- ============================================

DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'tenant_%' OR tablename LIKE 'api_%' OR tablename LIKE 'audit_%' OR tablename LIKE 'sso_%' OR tablename LIKE 'scim_%' OR tablename LIKE 'custom_%' OR tablename LIKE 'webhook_%' OR tablename LIKE 'rate_%'
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS update_%s_updated_at ON %s', t, t);
        EXECUTE format('CREATE TRIGGER update_%s_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', t, t);
    END LOOP;
END $$;

-- ============================================
-- Views for SaaS Dashboard
-- ============================================

CREATE OR REPLACE VIEW tenant_dashboard AS
SELECT 
    t.tenant_id,
    t.name,
    t.display_name,
    t.status,
    t.plan,
    t.billing_cycle,
    t.subdomain,
    t.domain,
    COUNT(DISTINCT tu.user_id) as total_users,
    COUNT(DISTINCT tu.user_id) FILTER (WHERE tu.status = 'ACTIVE') as active_users,
    COUNT(DISTINCT tp.project_id) as total_projects,
    COALESCE(SUM(tum.api_calls), 0) as api_calls_this_month,
    COALESCE(SUM(tum.storage_used_gb), 0) as storage_used_gb,
    ts.status as subscription_status,
    ts.current_period_end as subscription_ends_at
FROM tenants t
LEFT JOIN tenant_users tu ON tu.tenant_id = t.tenant_id
LEFT JOIN tenant_projects tp ON tp.tenant_id = t.tenant_id
LEFT JOIN tenant_usage_metrics tum ON tum.tenant_id = t.tenant_id AND tum.date >= DATE_TRUNC('month', NOW())
LEFT JOIN tenant_subscriptions ts ON ts.tenant_id = t.tenant_id AND ts.status = 'ACTIVE'
GROUP BY t.tenant_id, t.name, t.display_name, t.status, t.plan, t.billing_cycle, t.subdomain, t.domain, ts.status, ts.current_period_end;

-- ============================================
-- Tenant Projects (link to existing projects)
-- ============================================

CREATE TABLE IF NOT EXISTS tenant_projects (
    id BIGSERIAL PRIMARY KEY,
    project_id VARCHAR(100) NOT NULL REFERENCES projects(project_id),
    tenant_id VARCHAR(100) NOT NULL REFERENCES tenants(tenant_id),
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    assigned_by VARCHAR(100) NOT NULL,
    UNIQUE(project_id, tenant_id)
);

CREATE INDEX idx_tenant_projects_tenant ON tenant_projects(tenant_id);
CREATE INDEX idx_tenant_projects_project ON tenant_projects(project_id);