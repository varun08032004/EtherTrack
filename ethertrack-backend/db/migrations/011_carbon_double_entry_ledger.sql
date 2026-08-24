-- 011_carbon_double_entry_ledger.sql
-- Carbon Double-Entry Ledger Tables
-- Implements double-entry accounting for carbon credits with conservation invariants

-- Carbon Account Types
CREATE TYPE carbon_account_type AS ENUM (
  'ASSET_INVENTORY',      -- Platform's custody of credits (minted, not yet owned by users)
  'OWNER_POSITION',       -- User's available credits
  'RESERVED',             -- Credits reserved for active listings
  'PENDING_SETTLEMENT',   -- Credits in transit during trade
  'RETIRED',              -- Permanently retired credits
  'TRANSFER_CLEARING'     -- Temporary holding during transfers
);

-- Carbon Accounts
CREATE TABLE carbon_accounts (
    account_id        UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    account_code      VARCHAR(50) UNIQUE NOT NULL,  -- e.g., 'ASSET:VCM:VCS:1234', 'POS:USER:ABC:TOKEN:5678'
    account_type      carbon_account_type NOT NULL,
    batch_id          UUID REFERENCES carbon_batches(id),
    owner_id          UUID REFERENCES users(id),     -- NULL for platform accounts
    custody_type      VARCHAR(20),                   -- 'onchain', 'ledger'
    is_active         BOOLEAN DEFAULT TRUE,
    created_at        TIMESTAMP DEFAULT NOW()
);

-- Carbon Journal Entries
CREATE TABLE carbon_journal_entries (
    entry_id          UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    entry_number      BIGSERIAL UNIQUE NOT NULL,
    entry_date        TIMESTAMP NOT NULL DEFAULT NOW(),
    reference_type    VARCHAR(50),                  -- 'MINT', 'LIST', 'DELIST', 'TRADE', 'RETIRE', 'TRANSFER', 'ADJUSTMENT'
    reference_id      UUID,                         -- trade_id, listing_id, retirement_id, batch_id
    description       TEXT,
    created_by        UUID REFERENCES users(id),    -- operator or system
    created_at        TIMESTAMP DEFAULT NOW()
);

-- Carbon Journal Lines
CREATE TABLE carbon_journal_lines (
    line_id           UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    entry_id          UUID NOT NULL REFERENCES carbon_journal_entries(entry_id) ON DELETE CASCADE,
    account_id        UUID NOT NULL REFERENCES carbon_accounts(account_id),
    debit_quantity    BIGINT DEFAULT 0,
    credit_quantity   BIGINT DEFAULT 0,
    description       TEXT,
    line_number       INT NOT NULL,
    
    CONSTRAINT chk_carbon_one_side CHECK (
        (debit_quantity > 0 AND credit_quantity = 0) OR
        (debit_quantity = 0 AND credit_quantity > 0)
    )
);

-- Materialized Carbon Account Balances
CREATE TABLE carbon_account_balances (
    account_id        UUID PRIMARY KEY REFERENCES carbon_accounts(account_id),
    balance           BIGINT NOT NULL DEFAULT 0,    -- credit - debit
    last_entry_id     UUID REFERENCES carbon_journal_entries(entry_id),
    updated_at        TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT chk_carbon_balance_nonneg CHECK (balance >= 0)
);

-- Indexes
CREATE INDEX idx_carbon_journal_entries_ref ON carbon_journal_entries(reference_type, reference_id);
CREATE INDEX idx_carbon_journal_lines_account ON carbon_journal_lines(account_id);
CREATE INDEX idx_carbon_journal_lines_entry ON carbon_journal_lines(entry_id);

-- Trigger to maintain carbon_account_balances
CREATE OR REPLACE FUNCTION update_carbon_account_balance()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE carbon_account_balances 
        SET balance = balance + NEW.credit_quantity - NEW.debit_quantity,
            last_entry_id = NEW.entry_id,
            updated_at = NOW()
        WHERE account_id = NEW.account_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE carbon_account_balances 
        SET balance = balance - NEW.credit_quantity + NEW.debit_quantity,
            updated_at = NOW()
        WHERE account_id = NEW.account_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_carbon_journal_lines_balance
AFTER INSERT OR DELETE ON carbon_journal_lines
FOR EACH ROW EXECUTE FUNCTION update_carbon_account_balance();

-- Carbon Asset Lifecycle State Machine
CREATE TYPE carbon_asset_state AS ENUM (
    'CREATED', 'VERIFIED', 'ISSUED', 'OWNED', 'LISTED', 'RESERVED', 
    'TRADED', 'SETTLED', 'TRANSFERRED', 'RETIRED', 'EXPIRED', 'CANCELLED'
);

CREATE TABLE carbon_asset_lifecycle (
    batch_id          UUID PRIMARY KEY REFERENCES carbon_batches(id),
    current_state     carbon_asset_state NOT NULL,
    previous_state    carbon_asset_state,
    transitioned_at   TIMESTAMP DEFAULT NOW(),
    transitioned_by   UUID REFERENCES users(id),
    reason            TEXT,
    
    CONSTRAINT chk_valid_state CHECK (current_state IN (
        'CREATED', 'VERIFIED', 'ISSUED', 'OWNED', 'LISTED', 'RESERVED', 
        'TRADED', 'SETTLED', 'TRANSFERRED', 'RETIRED', 'EXPIRED', 'CANCELLED'
    ))
);

-- State Transition Rules
CREATE TABLE carbon_state_transitions (
    from_state        carbon_asset_state NOT NULL,
    to_state          carbon_asset_state NOT NULL,
    required_role     VARCHAR(50),        -- 'owner', 'operator', 'admin', 'verifier'
    side_effect       TEXT,               -- e.g., 'mint_tokens', 'reserve_credits', 'burn_tokens'
    PRIMARY KEY (from_state, to_state)
);

INSERT INTO carbon_state_transitions (from_state, to_state, required_role, side_effect) VALUES
('CREATED', 'VERIFIED', 'verifier', 'verify_project'),
('VERIFIED', 'ISSUED', 'operator', 'mint_tokens'),
('ISSUED', 'OWNED', 'system', 'assign_to_custody'),
('OWNED', 'LISTED', 'owner', 'reserve_credits'),
('LISTED', 'OWNED', 'owner', 'release_reservation'),
('OWNED', 'RESERVED', 'system', 'trade_initiated'),
('RESERVED', 'SETTLED', 'operator', 'transfer_ownership'),
('SETTLED', 'OWNED', 'system', 'credit_buyer'),
('OWNED', 'TRANSFERRED', 'owner', 'transfer_to_wallet'),
('OWNED', 'RETIRED', 'owner', 'burn_tokens'),
('LISTED', 'EXPIRED', 'system', 'auto_cancel'),
('CREATED', 'CANCELLED', 'admin', 'admin_cancel'),
('VERIFIED', 'CANCELLED', 'admin', 'admin_cancel'),
('ISSUED', 'CANCELLED', 'admin', 'admin_cancel'),
('OWNED', 'CANCELLED', 'admin', 'admin_cancel'),
('LISTED', 'CANCELLED', 'admin', 'admin_cancel'),
('RESERVED', 'CANCELLED', 'admin', 'admin_cancel'),
('TRADED', 'CANCELLED', 'admin', 'admin_cancel'),
('SETTLED', 'CANCELLED', 'admin', 'admin_cancel'),
('TRANSFERRED', 'CANCELLED', 'admin', 'admin_cancel');