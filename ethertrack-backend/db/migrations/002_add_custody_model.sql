-- Migration: Add custody_model to carbon_batches
-- Date: 2026-08-16
-- Description: Track whether credits are held in self-custody (user wallet) or pooled custody (EtherTrack custody wallet)

BEGIN;

-- Add custody_model column
ALTER TABLE carbon_batches
ADD COLUMN custody_model VARCHAR(20) DEFAULT 'self'
CHECK (custody_model IN ('self', 'pooled'));

-- Index for custody-based queries
CREATE INDEX idx_batches_custody_model ON carbon_batches(custody_model);

COMMIT;