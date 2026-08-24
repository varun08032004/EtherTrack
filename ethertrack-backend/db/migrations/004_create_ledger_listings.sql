-- Migration: Create ledger_listings table for wallet-free credit listings
-- and admin_audit_log table for audit logging
-- This table stores active listings for pooled-custody credits

BEGIN;

CREATE TABLE ledger_listings (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id             UUID NOT NULL REFERENCES users(id),
  token_id              INTEGER NOT NULL,
  batch_id              UUID REFERENCES carbon_batches(id),
  amount                INTEGER NOT NULL,
  amount_remaining      INTEGER NOT NULL,
  price_per_credit_inr  NUMERIC(20, 2) NOT NULL,
  expires_at            TIMESTAMP,
  active                BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW(),

  CONSTRAINT chk_amount_positive CHECK (amount > 0),
  CONSTRAINT chk_amount_remaining_nonneg CHECK (amount_remaining >= 0),
  CONSTRAINT chk_price_positive CHECK (price_per_credit_inr > 0)
);

-- Ensure only one active listing per seller per token
CREATE UNIQUE INDEX idx_ledger_listings_unique_active
  ON ledger_listings (seller_id, token_id)
  WHERE active = TRUE;

CREATE INDEX idx_ledger_listings_seller ON ledger_listings(seller_id);
CREATE INDEX idx_ledger_listings_token ON ledger_listings(token_id);
CREATE INDEX idx_ledger_listings_active ON ledger_listings(active) WHERE active = TRUE;

-- Trigger for updated_at
CREATE TRIGGER trg_ledger_listings_updated_at
  BEFORE UPDATE ON ledger_listings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Admin audit log table (if not exists)
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id        UUID NOT NULL REFERENCES users(id),
  action          VARCHAR(100) NOT NULL,
  target_user_id  UUID REFERENCES users(id),
  details         TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_admin_audit_log_admin ON admin_audit_log(admin_id);
CREATE INDEX idx_admin_audit_log_target ON admin_audit_log(target_user_id);
CREATE INDEX idx_admin_audit_log_action ON admin_audit_log(action);
CREATE INDEX idx_admin_audit_log_created ON admin_audit_log(created_at);

COMMIT;