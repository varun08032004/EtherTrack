-- 028_webhooks.sql
-- Webhooks Table (Generic Event Webhooks)

-- Webhook Event Types
CREATE TABLE webhook_event_types (
    event_type_id         UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    event_name            VARCHAR(100) UNIQUE NOT NULL,       -- 'order.created', 'trade.settled', etc.
    display_name          VARCHAR(200) NOT NULL,
    description           TEXT,
    category              VARCHAR(50),                        -- 'trade', 'market', 'compliance', 'wallet', 'mrv'
    payload_schema        JSONB,                              -- JSON Schema for validation
    is_active             BOOLEAN DEFAULT TRUE,
    created_at            TIMESTAMP DEFAULT NOW()
);

-- Webhook Subscriptions (User-defined endpoints for specific events)
CREATE TABLE webhook_subscriptions (
    subscription_id       UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    api_key_id            UUID REFERENCES api_keys(key_id) ON DELETE SET NULL,
    
    -- Endpoint
    url                   VARCHAR(500) NOT NULL,
    secret                VARCHAR(64) NOT NULL,
    
    -- Event Filter
    event_types           TEXT[] NOT NULL,                    -- List of event_names
    filters               JSONB,                              -- Additional filters (e.g., {asset_id: "...", min_price: 100})
    
    -- Retry Configuration
    retry_config          JSONB DEFAULT '{"max_retries": 3, "backoff_seconds": [60, 300, 900]}',
    
    -- Security
    secret_hash           VARCHAR(64) NOT NULL,               -- HMAC secret for signature verification
    
    -- Status
    is_active             BOOLEAN DEFAULT TRUE,
    is_paused             BOOLEAN DEFAULT FALSE,
    pause_reason          TEXT,
    
    -- Stats
    total_deliveries      BIGINT DEFAULT 0,
    successful_deliveries BIGINT DEFAULT 0,
    failed_deliveries     BIGINT DEFAULT 0,
    last_triggered_at     TIMESTAMP,
    last_success_at       TIMESTAMP,
    last_failure_at       TIMESTAMP,
    last_failure_reason   TEXT,
    
    -- Metadata
    description           TEXT,
    created_by            UUID REFERENCES users(id),
    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW(),
    
    UNIQUE (user_id, url)
);

CREATE INDEX idx_webhook_subscriptions_user ON webhook_subscriptions(user_id);
CREATE INDEX idx_webhook_subscriptions_active ON webhook_subscriptions(is_active) WHERE is_active = TRUE AND is_paused = FALSE;
CREATE INDEX idx_webhook_subscriptions_event ON webhook_subscriptions USING GIN(event_types);

-- Webhook Delivery Logs
CREATE TABLE webhook_delivery_logs (
    delivery_id           UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    subscription_id       UUID NOT NULL REFERENCES webhook_subscriptions(subscription_id) ON DELETE CASCADE,
    
    -- Request
    event_type            VARCHAR(100) NOT NULL,
    event_id              UUID,                                 -- Related entity ID (trade_id, order_id, etc.)
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
    next_retry_at         TIMESTAMP,
    
    -- Metadata
    idempotency_key       VARCHAR(100),
    created_at            TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_webhook_delivery_logs_subscription ON webhook_delivery_logs(subscription_id);
CREATE INDEX idx_webhook_delivery_logs_status ON webhook_delivery_logs(success);
CREATE INDEX idx_webhook_delivery_logs_created ON webhook_delivery_logs(created_at DESC);
CREATE INDEX idx_webhook_delivery_logs_next_retry ON webhook_delivery_logs(next_retry_at) WHERE next_retry_at IS NOT NULL;

-- Event Definitions (Seed Data)
INSERT INTO webhook_event_types (event_name, display_name, description, category, payload_schema) VALUES
-- Trade Events
('trade.created', 'Trade Created', 'A new trade has been created', 'trade', '{"type": "object", "properties": {"trade_id": {"type": "string"}, "quantity": {"type": "integer"}, "price_inr": {"type": "number"}}}'),
('trade.filled', 'Trade Filled', 'A trade has been fully filled', 'trade', '{"type": "object", "properties": {"trade_id": {"type": "string"}, "filled_quantity": {"type": "integer"}}}'),
('trade.partially_filled', 'Trade Partially Filled', 'A trade has been partially filled', 'trade', '{"type": "object", "properties": {"trade_id": {"type": "string"}, "filled_quantity": {"type": "integer"}}}'),
('trade.cancelled', 'Trade Cancelled', 'A trade has been cancelled', 'trade', '{"type": "object", "properties": {"trade_id": {"type": "string"}, "reason": {"type": "string"}}}'),
('trade.settled', 'Trade Settled', 'A trade has been settled on-chain', 'trade', '{"type": "object", "properties": {"trade_id": {"type": "string"}, "tx_hash": {"type": "string"}}}'),
('trade.failed', 'Trade Failed', 'A trade settlement failed', 'trade', '{"type": "object", "properties": {"trade_id": {"type": "string"}, "error": {"type": "string"}}}'),

-- Order Events
('order.created', 'Order Created', 'A new order has been placed', 'market', '{"type": "object", "properties": {"order_id": {"type": "string"}, "type": {"type": "string"}, "side": {"type": "string"}}}'),
('order.filled', 'Order Filled', 'An order has been fully filled', 'market', '{"type": "object", "properties": {"order_id": {"type": "string"}}}'),
('order.partially_filled', 'Order Partially Filled', 'An order has been partially filled', 'market', '{"type": "object", "properties": {"order_id": {"type": "string"}, "filled_quantity": {"type": "integer"}}}'),
('order.cancelled', 'Order Cancelled', 'An order has been cancelled', 'market', '{"type": "object", "properties": {"order_id": {"type": "string"}, "reason": {"type": "string"}}}'),
('order.expired', 'Order Expired', 'An order has expired', 'market', '{"type": "object", "properties": {"order_id": {"type": "string"}}}'),

-- Market Events
('market.listing_created', 'Listing Created', 'A new listing has been created', 'market', '{"type": "object", "properties": {"listing_id": {"type": "string"}, "price_inr": {"type": "number"}}}'),
('market.listing_filled', 'Listing Filled', 'A listing has been fully filled', 'market', '{"type": "object", "properties": {"listing_id": {"type": "string"}}}'),
('market.listing_expired', 'Listing Expired', 'A listing has expired', 'market', '{"type": "object", "properties": {"listing_id": {"type": "string"}}}'),
('market.price_updated', 'Price Updated', 'Market price index updated', 'market', '{"type": "object", "properties": {"index_name": {"type": "string"}, "price": {"type": "number"}}}'),

-- RFQ Events
('rfq.created', 'RFQ Created', 'A new RFQ has been created', 'market', '{"type": "object", "properties": {"rfq_id": {"type": "string"}, "quantity": {"type": "integer"}}}'),
('rfq.quote_received', 'RFQ Quote Received', 'A quote has been received for an RFQ', 'market', '{"type": "object", "properties": {"rfq_id": {"type": "string"}, "quote_id": {"type": "string"}}}'),
('rfq.accepted', 'RFQ Accepted', 'An RFQ quote has been accepted', 'market', '{"type": "object", "properties": {"rfq_id": {"type": "string"}, "quote_id": {"type": "string"}}}'),

-- OTC Events
('otc.initiated', 'OTC Initiated', 'An OTC negotiation has been initiated', 'market', '{"type": "object", "properties": {"negotiation_id": {"type": "string"}}}'),
('otc.terms_agreed', 'OTC Terms Agreed', 'OTC terms have been agreed upon', 'market', '{"type": "object", "properties": {"negotiation_id": {"type": "string"}}}'),
('otc.settled', 'OTC Settled', 'An OTC trade has been settled', 'market', '{"type": "object", "properties": {"negotiation_id": {"type": "string"}}}'),

-- MRV Events
('mrv.plan_submitted', 'MRV Plan Submitted', 'An MRV plan has been submitted for verification', 'mrv', '{"type": "object", "properties": {"plan_id": {"type": "string"}}}'),
('mrv.plan_verified', 'MRV Plan Verified', 'An MRV plan has been verified', 'mrv', '{"type": "object", "properties": {"plan_id": {"type": "string"}}}'),
('mrv.plan_approved', 'MRV Plan Approved', 'An MRV plan has been approved', 'mrv', '{"type": "object", "properties": {"plan_id": {"type": "string"}}}'),
('mrv.evidence_uploaded', 'MRV Evidence Uploaded', 'Evidence has been uploaded for an MRV plan', 'mrv', '{"type": "object", "properties": {"plan_id": {"type": "string"}, "evidence_id": {"type": "string"}}}'),
('mrv.finding_added', 'MRV Finding Added', 'A verification finding has been added', 'mrv', '{"type": "object", "properties": {"plan_id": {"type": "string"}, "finding_id": {"type": "string"}}}'),

-- Compliance Events
('compliance.position_updated', 'Compliance Position Updated', 'CCTS compliance position has been updated', 'compliance', '{"type": "object", "properties": {"entity_id": {"type": "string"}, "surplus": {"type": "integer"}, "deficit": {"type": "integer"}}}'),
('compliance.deadline_approaching', 'Compliance Deadline Approaching', 'A compliance deadline is approaching', 'compliance', '{"type": "object", "properties": {"deadline_date": {"type": "string"}, "entity_id": {"type": "string"}}}'),

-- Wallet Events
('wallet.deposit_received', 'Deposit Received', 'Funds have been deposited to wallet', 'wallet', '{"type": "object", "properties": {"amount": {"type": "number"}, "currency": {"type": "string"}}}'),
('wallet.withdrawal_initiated', 'Withdrawal Initiated', 'A withdrawal has been initiated', 'wallet', '{"type": "object", "properties": {"amount": {"type": "number"}, "currency": {"type": "string"}}}'),
('wallet.withdrawal_completed', 'Withdrawal Completed', 'A withdrawal has been completed', 'wallet', '{"type": "object", "properties": {"amount": {"type": "number"}, "currency": {"type": "string"}}}'),

-- Carbon Credit Events
('credit.minted', 'Credits Minted', 'New carbon credits have been minted', 'credit', '{"type": "object", "properties": {"batch_id": {"type": "string"}, "quantity": {"type": "integer"}}}'),
('credit.listed', 'Credits Listed', 'Credits have been listed for sale', 'credit', '{"type": "object", "properties": {"listing_id": {"type": "string"}, "quantity": {"type": "integer"}}}'),
('credit.retired', 'Credits Retired', 'Credits have been retired', 'credit', '{"type": "object", "properties": {"batch_id": {"type": "string"}, "quantity": {"type": "integer"}}}'),
('credit.transferred', 'Credits Transferred', 'Credits have been transferred', 'credit', '{"type": "object", "properties": {"from": {"type": "string"}, "to": {"type": "string"}, "quantity": {"type": "integer"}}}');