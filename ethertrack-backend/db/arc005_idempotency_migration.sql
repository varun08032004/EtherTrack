-- ARC-005: Add idempotency key constraints to all mutation tables
-- Run this as a migration

-- 1. wallet_transactions: add idempotency_key column + unique index
ALTER TABLE wallet_transactions 
ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100);

CREATE UNIQUE INDEX IF NOT EXISTS unq_wallet_tx_idempotency 
ON wallet_transactions(idempotency_key, user_id) 
WHERE idempotency_key IS NOT NULL;

-- 2. subscription_payments: fix unique constraint to be per-user
-- Drop the constraint first (which will drop the index)
ALTER TABLE subscription_payments 
DROP CONSTRAINT IF EXISTS subscription_payments_idempotency_key_unique;

-- Create new unique index on (idempotency_key, user_id) where not null
CREATE UNIQUE INDEX IF NOT EXISTS unq_sub_payments_idempotency 
ON subscription_payments(idempotency_key, user_id) 
WHERE idempotency_key IS NOT NULL;

-- Also add the partial index for performance
CREATE INDEX IF NOT EXISTS idx_sub_payments_idempotency 
ON subscription_payments(idempotency_key) 
WHERE idempotency_key IS NOT NULL;

-- 3. kyc_idempotency_keys: fix primary key to be (key, user_id)
-- First drop the existing primary key
ALTER TABLE kyc_idempotency_keys DROP CONSTRAINT IF EXISTS kyc_idempotency_keys_pkey;

-- Add new primary key on (key, user_id)
ALTER TABLE kyc_idempotency_keys 
ADD PRIMARY KEY (key, user_id);

-- 4. trades: improve idempotency index to include user_id + status filter
-- The existing idx_trades_idempotency is on (buyer_id, idempotency_key) WHERE status='completed'
-- This is already good, but let's also add a general idempotency index
CREATE INDEX IF NOT EXISTS idx_trades_idempotency_general 
ON trades(idempotency_key) 
WHERE idempotency_key IS NOT NULL;