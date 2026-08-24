-- Migration: Create credit_transfers and credit_transfer_operations tables
-- These tables track credit transfers between users across custody types

BEGIN;

-- Credit transfers table
CREATE TABLE credit_transfers (
  transfer_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id              UUID NOT NULL REFERENCES trades(id),
  batch_id              UUID REFERENCES carbon_batches(id),
  quantity              INTEGER NOT NULL,
  from_custody_type     VARCHAR(20) NOT NULL,  -- 'onchain' or 'ledger'
  to_custody_type       VARCHAR(20) NOT NULL,  -- 'onchain' or 'ledger'
  status                VARCHAR(20) NOT NULL DEFAULT 'PENDING',  -- 'PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED'
  idempotency_key       VARCHAR(100),
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW(),
  completed_at          TIMESTAMP,

  CONSTRAINT chk_quantity_positive CHECK (quantity > 0)
);

CREATE INDEX idx_credit_transfers_trade ON credit_transfers(trade_id);
CREATE INDEX idx_credit_transfers_status ON credit_transfers(status);
CREATE INDEX idx_credit_transfers_batch ON credit_transfers(batch_id);

-- Credit transfer operations table
CREATE TABLE credit_transfer_operations (
  operation_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id           UUID NOT NULL REFERENCES credit_transfers(transfer_id),
  type                  VARCHAR(30) NOT NULL,  -- 'ERC1155_TRANSFER', 'LEDGER_SELL', 'LEDGER_BUY', 'ESCROW_RELEASE'
  custody_type          VARCHAR(20) NOT NULL,  -- 'onchain' or 'ledger'
  from_address          VARCHAR(42),
  to_address            VARCHAR(42),
  blockchain_tx_hash    VARCHAR(66),
  blockchain_log_index  INTEGER,
  chain_id              INTEGER,
  contract_address      VARCHAR(42),
  status                VARCHAR(20) NOT NULL DEFAULT 'PENDING',  -- 'PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED'
  error_message         TEXT,
  created_at            TIMESTAMP DEFAULT NOW(),
  confirmed_at          TIMESTAMP
);

CREATE INDEX idx_cto_transfer ON credit_transfer_operations(transfer_id);
CREATE INDEX idx_cto_status ON credit_transfer_operations(status);

-- Trigger for updated_at on credit_transfers
CREATE TRIGGER trg_credit_transfers_updated_at
  BEFORE UPDATE ON credit_transfers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;