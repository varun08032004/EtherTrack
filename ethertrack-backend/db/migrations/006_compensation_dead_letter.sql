-- Migration: Create dead letter queue for failed compensations
-- Stores failed compensation attempts for manual review and retry

BEGIN;

CREATE TABLE compensation_dead_letter (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id              UUID NOT NULL REFERENCES trades(id),
  failure_point         VARCHAR(50) NOT NULL,
  error_message         TEXT NOT NULL,
  compensation_data     JSONB,
  retry_count           INTEGER DEFAULT 0,
  last_retry_at         TIMESTAMP,
  resolved_at           TIMESTAMP,
  resolved_by           UUID REFERENCES users(id),
  resolution_notes      TEXT,
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_compensation_dlq_trade ON compensation_dead_letter(trade_id);
CREATE INDEX idx_compensation_dlq_status ON compensation_dead_letter(resolved_at) WHERE resolved_at IS NULL;

COMMIT;