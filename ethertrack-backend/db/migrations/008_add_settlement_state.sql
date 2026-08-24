-- Migration: Add settlement_state column to trades table
-- This tracks the detailed settlement state machine separately from the high-level trade status

BEGIN;

ALTER TABLE trades ADD COLUMN IF NOT EXISTS settlement_state VARCHAR(50) DEFAULT 'CREATED';

-- Update existing trades to have appropriate settlement_state based on their status
UPDATE trades SET settlement_state = 'SETTLED' WHERE status = 'completed' AND settlement_state = 'CREATED';

CREATE INDEX IF NOT EXISTS idx_trades_settlement_state ON trades(settlement_state);

COMMIT;