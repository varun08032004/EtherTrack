-- 027_institutional_api.sql
-- Institutional API Tables

-- API Keys
CREATE TABLE api_keys (
    key_id                UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id                UUID,                                      -- Organization ID (optional)
    
    -- Key Details
    name                  VARCHAR(100) NOT NULL,
    key_prefix            VARCHAR(20) NOT NULL,                    -- First 8 chars for display
    key_hash              VARCHAR(64) NOT NULL,                    -- SHA256 hash of full key
    
    -- Scopes
    scopes                TEXT[] NOT NULL,                         -- ['market:read', 'trade:write', 'compliance:read', ...]
    
    -- Rate Limits
    rate_limit_tier       VARCHAR(20) DEFAULT 'standard',          -- 'starter', 'growth', 'corporate', 'enterprise'
    requests_per_minute   INT DEFAULT 60,
    requests_per_day      INT DEFAULT 10000,
    
    -- IP Whitelist
    allowed_ips           INET[],
    
    -- Status
    is_active             BOOLEAN DEFAULT TRUE,
    last_used_at          TIMESTAMP,
    expires_at            TIMESTAMP,
    
    -- Metadata
    metadata              JSONB,
    created_by            UUID REFERENCES users(id),
    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW(),
    
    UNIQUE (key_hash)
);

CREATE INDEX idx_api_keys_user ON api_keys(user_id);
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX idx_api_keys_active ON api_keys(is_active) WHERE is_active = TRUE;

-- Webhook Endpoints
CREATE TABLE webhook_endpoints (
    endpoint_id           UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    api_key_id            UUID REFERENCES api_keys(key_id) ON DELETE SET NULL,
    
    -- Endpoint Config
    url                   VARCHAR(500) NOT NULL,
    secret                VARCHAR(64) NOT NULL,                    -- For signature verification
    events                TEXT[] NOT NULL,                         -- ['order.created', 'trade.settled', 'price.updated', ...]
    
    -- Retry Policy
    retry_policy          JSONB DEFAULT '{"max_retries": 3, "backoff_multiplier": 2, "max_backoff_seconds": 300}',
    
    -- Status
    is_active             BOOLEAN DEFAULT TRUE,
    last_triggered_at     TIMESTAMP,
    success_count         INT DEFAULT 0,
    failure_count         INT DEFAULT 0,
    last_failure_at       TIMESTAMP,
    last_failure_reason   TEXT,
    
    -- Metadata
    description           TEXT,
    created_by            UUID REFERENCES users(id),
    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW(),
    
    UNIQUE (user_id, url)
);

CREATE INDEX idx_webhook_endpoints_user ON webhook_endpoints(user_id);
CREATE INDEX idx_webhook_endpoints_active ON webhook_endpoints(is_active) WHERE is_active = TRUE;

-- Webhook Deliveries (Audit Log)
CREATE TABLE webhook_deliveries (
    delivery_id           UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    endpoint_id           UUID NOT NULL REFERENCES webhook_endpoints(endpoint_id) ON DELETE CASCADE,
    
    -- Request
    event_type            VARCHAR(100) NOT NULL,
    payload               JSONB NOT NULL,
    headers               JSONB,
    
    -- Response
    status_code           INT,
    response_body         TEXT,
    response_headers      JSONB,
    
    -- Timing
    started_at            TIMESTAMP NOT NULL,
    completed_at          TIMESTAMP,
    duration_ms           INT,
    
    -- Result
    success               BOOLEAN NOT NULL,
    error_message         TEXT,
    attempt               INT DEFAULT 1,
    
    -- Metadata
    idempotency_key       VARCHAR(100),
    created_at            TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_webhook_deliveries_endpoint ON webhook_deliveries(endpoint_id);
CREATE INDEX idx_webhook_deliveries_status ON webhook_deliveries(success);
CREATE INDEX idx_webhook_deliveries_created ON webhook_deliveries(created_at DESC);

-- API Usage Logs (for billing/analytics)
CREATE TABLE api_usage_logs (
    log_id                UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    api_key_id            UUID NOT NULL REFERENCES api_keys(key_id) ON DELETE CASCADE,
    
    -- Request
    method                VARCHAR(10) NOT NULL,
    path                  VARCHAR(500) NOT NULL,
    query_params          JSONB,
    request_body_hash     VARCHAR(64),
    
    -- Response
    status_code           INT NOT NULL,
    response_size_bytes   INT,
    
    -- Timing
    started_at            TIMESTAMP NOT NULL,
    completed_at          TIMESTAMP,
    duration_ms           INT,
    
    -- Context
    ip_address            INET,
    user_agent            TEXT,
    endpoint              VARCHAR(200),
    
    created_at            TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_api_usage_logs_key ON api_usage_logs(api_key_id);
CREATE INDEX idx_api_usage_logs_created ON api_usage_logs(created_at DESC);
CREATE INDEX idx_api_usage_logs_endpoint ON api_usage_logs(endpoint);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_api_keys_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_api_keys_updated_at
BEFORE UPDATE ON api_keys
FOR EACH ROW EXECUTE FUNCTION update_api_keys_updated_at();

CREATE OR REPLACE FUNCTION update_webhook_endpoints_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_webhook_endpoints_updated_at
BEFORE UPDATE ON webhook_endpoints
FOR EACH ROW EXECUTE FUNCTION update_webhook_endpoints_updated_at();