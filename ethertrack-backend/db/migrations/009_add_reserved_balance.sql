-- 009_add_reserved_balance.sql
-- Add reserved_balance column to credit_ledger_balances for proper reservation accounting

ALTER TABLE credit_ledger_balances
ADD COLUMN IF NOT EXISTS reserved_balance BIGINT NOT NULL DEFAULT 0;

-- Add check constraint
ALTER TABLE credit_ledger_balances
ADD CONSTRAINT chk_reserved_balance_nonneg CHECK (reserved_balance >= 0);

-- Add check constraint: balance >= reserved_balance (available = balance - reserved >= 0)
ALTER TABLE credit_ledger_balances
ADD CONSTRAINT chk_balance_gte_reserved CHECK (balance >= reserved_balance);

-- Create index for reservation queries
CREATE INDEX IF NOT EXISTS idx_credit_ledger_reserved ON credit_ledger_balances(reserved_balance) WHERE reserved_balance > 0;

-- Note: Backfill of reserved_balance from active listings is handled separately
-- after the ledger_listings and market_listings tables are populated.
-- Run the backfill script separately once all listing tables are populated.