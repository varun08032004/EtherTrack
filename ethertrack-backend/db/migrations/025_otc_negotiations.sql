-- 025_otc_negotiations.sql
-- OTC (Over-the-Counter) Negotiations Tables

-- OTC States
CREATE TYPE otc_state AS ENUM (
    'INITIATED',
    'NEGOTIATING',
    'TERMS_AGREED',
    'ESCROW_FUNDED',
    'SETTLING',
    'SETTLED',
    'DISPUTED',
    'CANCELLED',
    'EXPIRED'
);

-- OTC Negotiations
CREATE TABLE otc_negotiations (
    negotiation_id        UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    
    -- Parties
    initiator_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    counterparty_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Asset
    batch_id              UUID NOT NULL REFERENCES carbon_batches(id) ON DELETE CASCADE,
    asset_passport_id     UUID REFERENCES carbon_asset_passports(passport_id),
    
    -- Terms
    quantity              BIGINT NOT NULL,
    price_per_credit_inr  NUMERIC(20,2) NOT NULL,
    currency              VARCHAR(3) DEFAULT 'INR',
    
    -- Terms
    payment_terms         TEXT,
    delivery_terms        TEXT,
    settlement_type       VARCHAR(20) DEFAULT 'otc_escrow',
    escrow_address        VARCHAR(100),
    escrow_tx_hash        VARCHAR(66),
    
    -- Documents
    agreement_doc_id      UUID,
    supporting_docs       UUID[],
    
    -- State Machine
    state                 otc_state DEFAULT 'INITIATED',
    current_turn          UUID REFERENCES users(id),    -- Whose turn to act
    
    -- Timing
    initiated_at          TIMESTAMP DEFAULT NOW(),
    expires_at            TIMESTAMP,
    agreed_at             TIMESTAMP,
    escrow_funded_at      TIMESTAMP,
    settled_at            TIMESTAMP,
    cancelled_at          TIMESTAMP,
    cancelled_reason      TEXT,
    
    -- Metadata
    metadata              JSONB,
    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT chk_quantity_positive CHECK (quantity > 0),
    CONSTRAINT chk_price_positive CHECK (price_per_credit_inr > 0),
    CONSTRAINT chk_different_parties CHECK (initiator_id != counterparty_id)
);

-- OTC Messages (Chat/Negotiation Log)
CREATE TABLE otc_messages (
    message_id            UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    negotiation_id        UUID NOT NULL REFERENCES otc_negotiations(negotiation_id) ON DELETE CASCADE,
    sender_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Message Content
    message_type          VARCHAR(20) DEFAULT 'text',   -- 'text', 'offer', 'counter_offer', 'document', 'system'
    content               TEXT,
    attachments           UUID[],
    
    -- Offer Details (if message_type = 'offer' or 'counter_offer')
    offer_quantity        BIGINT,
    offer_price_inr       NUMERIC(20,2),
    offer_terms           JSONB,
    
    -- Metadata
    is_system_message     BOOLEAN DEFAULT FALSE,
    created_at            TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT chk_offer_positive CHECK (offer_quantity IS NULL OR offer_quantity > 0)
);

-- OTC State Transitions Log
CREATE TABLE otc_state_transitions (
    transition_id         UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    negotiation_id        UUID NOT NULL REFERENCES otc_negotiations(negotiation_id) ON DELETE CASCADE,
    from_state            otc_state,
    to_state              otc_state NOT NULL,
    triggered_by          UUID REFERENCES users(id),
    reason                TEXT,
    metadata              JSONB,
    created_at            TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_otc_negotiations_initiator ON otc_negotiations(initiator_id);
CREATE INDEX idx_otc_negotiations_counterparty ON otc_negotiations(counterparty_id);
CREATE INDEX idx_otc_negotiations_batch ON otc_negotiations(batch_id);
CREATE INDEX idx_otc_negotiations_state ON otc_negotiations(state);
CREATE INDEX idx_otc_messages_negotiation ON otc_messages(negotiation_id);
CREATE INDEX idx_otc_state_transitions_negotiation ON otc_state_transitions(negotiation_id);

-- Triggers
CREATE OR REPLACE FUNCTION update_otc_negotiations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_otc_negotiations_updated_at
BEFORE UPDATE ON otc_negotiations
FOR EACH ROW EXECUTE FUNCTION update_otc_negotiations_updated_at();