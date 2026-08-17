-- Migration: Add idempotency unique constraints
-- Date: 2026-08-10
-- Purpose: Add DB-level idempotency protection for financial mutations

-- 1. wallet_transactions: Add unique partial index on (user_id, idempotency_key) where idempotency_key is not null
CREATE UNIQUE INDEX IF NOT EXISTS unq_wallet_tx_idempotency 
ON wallet_transactions (user_id, idempotency_key) 
WHERE idempotency_key IS NOT NULL;

-- 2. trades: Update unique constraint to be on (buyer_id, idempotency_key) where status = 'completed' and idempotency_key is not null
-- First drop existing constraint/index
DROP INDEX IF EXISTS idx_trades_idempotency;

-- Add new unique partial index on (buyer_id, idempotency_key) where status = 'completed' and idempotency_key is not null
CREATE UNIQUE INDEX IF NOT EXISTS unq_trades_idempotency 
ON trades (buyer_id, idempotency_key) 
WHERE status = 'completed' AND idempotency_key IS NOT NULL;

-- Note: subscription_payments already has correct unique index
-- CREATE UNIQUE INDEX unq_sub_payments_idempotency ON subscription_payments(idempotency_key, user_id) WHERE idempotency_key IS NOT NULL;

-- Note: kyc_idempotency_keys already has PRIMARY KEY (key, user_id)