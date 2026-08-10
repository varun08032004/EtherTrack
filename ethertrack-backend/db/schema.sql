-- ═══════════════════════════════════════════════════════════════
-- EtherTrack Carbon Credit Registry — Full PostgreSQL Schema
-- ═══════════════════════════════════════════════════════════════

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── ENUMS ────────────────────────────────────────────────────────

CREATE TYPE user_role        AS ENUM ('user', 'developer', 'verifier', 'admin');
CREATE TYPE kyc_status       AS ENUM ('pending', 'submitted', 'verified', 'rejected');
CREATE TYPE project_status   AS ENUM ('pending', 'under_review', 'approved', 'rejected', 'suspended');
CREATE TYPE project_type     AS ENUM ('Forestry', 'Renewable', 'Methane', 'Efficiency', 'Ocean', 'Agriculture');
CREATE TYPE credit_standard  AS ENUM ('VCS', 'GS', 'CDM', 'ACR');
CREATE TYPE batch_status     AS ENUM ('pending', 'approved', 'tokenised', 'exhausted', 'expired');
CREATE TYPE tx_type          AS ENUM ('MINT', 'LIST', 'DELIST', 'TRADE', 'RETIRE', 'TRANSFER', 'BID', 'BID_CANCEL');
CREATE TYPE retirement_reason AS ENUM ('voluntary', 'compliance', 'offset', 'other');

-- ══════════════════════════════════════════════════════════════════
-- AUTH + USERS
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email             VARCHAR(255) UNIQUE NOT NULL,
  password_hash     VARCHAR(255) NOT NULL,
  full_name         VARCHAR(255),
  company_name      VARCHAR(255),
  role              user_role DEFAULT 'user',

  -- Wallet
  wallet_address    VARCHAR(42) UNIQUE,           -- 0x... bound wallet
  wallet_bound_at   TIMESTAMP,

  -- KYC
  kyc_status        kyc_status DEFAULT 'pending',
  kyc_data_hash     VARCHAR(66),                  -- bytes32 hash stored on-chain
  kyc_verified_at   TIMESTAMP,
  kyc_verified_by   UUID REFERENCES users(id),

  -- Email verification
  email_verified    BOOLEAN DEFAULT FALSE,
  email_otp         VARCHAR(6),
  email_otp_expires TIMESTAMP,

  -- Meta
  is_active         BOOLEAN DEFAULT TRUE,
  last_login        TIMESTAMP,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMP NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════
-- REGISTRY — PROJECTS
-- ═════════════════════════════════════════════════════════════════

CREATE TABLE projects (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  developer_id      UUID NOT NULL REFERENCES users(id),

  -- Identity
  name              VARCHAR(500) NOT NULL,
  project_code      VARCHAR(50) UNIQUE,           -- e.g. ET-2024-001
  standard          credit_standard NOT NULL,
  project_type      project_type NOT NULL,

  -- Location
  location          VARCHAR(500),
  country           VARCHAR(100),
  coordinates       JSONB,                        -- { lat, lng }

  -- Details
  description       TEXT,
  methodology       VARCHAR(255),
  developer_name    VARCHAR(255),
  verifier_name     VARCHAR(255),

  -- Capacity
  total_credits     BIGINT DEFAULT 0,
  issued_credits    BIGINT DEFAULT 0,
  retired_credits   BIGINT DEFAULT 0,

  -- IPFS
  ipfs_document_hash  VARCHAR(100),               -- project documents
  ipfs_image_hash     VARCHAR(100),               -- project images

  -- Status
  status            project_status DEFAULT 'pending',
  approved_by       UUID REFERENCES users(id),
  approved_at       TIMESTAMP,
  rejection_reason  TEXT,

  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════
-- REGISTRY — CARBON BATCHES
-- ═════════════════════════════════════════════════════════════════

CREATE TABLE carbon_batches (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id          UUID NOT NULL REFERENCES projects(id),
  developer_id        UUID NOT NULL REFERENCES users(id),

  -- Identity
  batch_number        VARCHAR(100) UNIQUE NOT NULL, -- e.g. BATCH-ET-2024-001-001
  serial_number_from  VARCHAR(100),
  serial_number_to    VARCHAR(100),

  -- Credits
  vintage_year        INTEGER NOT NULL,
  total_credits       INTEGER NOT NULL,
  available_credits   INTEGER NOT NULL,
  retired_credits     INTEGER DEFAULT 0,

  -- Blockchain
  token_id            INTEGER UNIQUE,             -- ERC1155 tokenId on-chain
  tx_hash_mint        VARCHAR(66),                -- mint transaction hash
  tokenised_at        TIMESTAMP,
  tokenised_by        UUID REFERENCES users(id),

  -- IPFS
  ipfs_metadata_hash  VARCHAR(100),              -- full metadata JSON on IPFS
  metadata_uri        VARCHAR(500),              -- ipfs://Qm...

  -- Status
  status              batch_status DEFAULT 'pending',
  expires_at          TIMESTAMP,

  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW(),

  -- Financial invariants
  CONSTRAINT chk_available_credits_nonneg CHECK (available_credits >= 0),
  CONSTRAINT chk_retired_credits_nonneg CHECK (retired_credits >= 0),
  CONSTRAINT chk_total_credits_positive CHECK (total_credits > 0),
  CONSTRAINT chk_available_gte_listed CHECK (available_credits >= COALESCE(listed_quantity, 0))
);

-- ══════════════════════════════════════════════════════════════════
-- REGISTRY — TRANSACTIONS (mirror of blockchain events)
-- ════════════════════════════════════════════════════════════════

CREATE TABLE registry_transactions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type            tx_type NOT NULL,

  -- References
  token_id        INTEGER,
  batch_id        UUID REFERENCES carbon_batches(id),
  project_id      UUID REFERENCES projects(id),
  listing_id      INTEGER,                        -- on-chain listingId
  trade_id        INTEGER,                        -- on-chain tradeId

  -- Parties
  from_wallet     VARCHAR(42),
  to_wallet       VARCHAR(42),
  from_user_id    UUID REFERENCES users(id),
  to_user_id      UUID REFERENCES users(id),

  -- Amounts
  amount          INTEGER,
  price_eth       NUMERIC(20, 8),
  price_inr       NUMERIC(20, 2),
  fee_eth         NUMERIC(20, 8),

  -- Blockchain proof
  tx_hash         VARCHAR(66) UNIQUE,
  block_number    BIGINT,
  chain_id        INTEGER DEFAULT 11155111,

  -- Meta
  notes           TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════
-- REGISTRY — RETIREMENTS
-- ════════════════════════════════════════════════════════════════

CREATE TABLE retirements (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_id              INTEGER NOT NULL,
  batch_id              UUID REFERENCES carbon_batches(id),
  project_id            UUID REFERENCES projects(id),

  -- Who retired
  retired_by            UUID NOT NULL REFERENCES users(id),
  wallet_address        VARCHAR(42) NOT NULL,

  -- Details
  amount                INTEGER NOT NULL,
  reason                retirement_reason DEFAULT 'voluntary',
  beneficiary_name      VARCHAR(255),             -- "Retired on behalf of X"
  beneficiary_entity    VARCHAR(255),
  notes                 TEXT,

  -- Certificate
  certificate_id        VARCHAR(100) UNIQUE,      -- e.g. RET-2024-000001
  certificate_ipfs_hash VARCHAR(100),             -- retirement cert PDF on IPFS
  certificate_url       VARCHAR(500),

  -- Blockchain proof
  tx_hash               VARCHAR(66) UNIQUE,
  block_number          BIGINT,

  retired_at            TIMESTAMP DEFAULT NOW(),
  created_at            TIMESTAMP DEFAULT NOW()
);

-- ═════════════════════════════════════════════════════════════════
-- EMISSIONS
-- ════════════════════════════════════════════════════════════════

CREATE TABLE emission_reports (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(id),

  -- Company info
  company_name      VARCHAR(255),
  reporting_year    INTEGER NOT NULL,
  industry          VARCHAR(100),

  -- Emissions (tCO₂)
  scope1            NUMERIC(15, 2) DEFAULT 0,    -- direct emissions
  scope2            NUMERIC(15, 2) DEFAULT 0,    -- electricity
  scope3            NUMERIC(15, 2) DEFAULT 0,    -- supply chain
  total_emissions   NUMERIC(15, 2) DEFAULT 0,

  -- Offsets
  credits_offset    INTEGER DEFAULT 0,
  net_emissions     NUMERIC(15, 2) DEFAULT 0,

  -- Verification
  verified          BOOLEAN DEFAULT FALSE,
  verified_by       UUID REFERENCES users(id),
  verified_at       TIMESTAMP,
  ipfs_report_hash  VARCHAR(100),

  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

-- ═════════════════════════════════════════════════════════════════
-- AUDIT LOG
-- ══════════════════════════════════════════════════════════════

CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id),
  action      VARCHAR(100) NOT NULL,
  entity      VARCHAR(100),
  entity_id   VARCHAR(100),
  old_value   JSONB,
  new_value   JSONB,
  ip_address  VARCHAR(45),
  user_agent  TEXT,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ═════════════════════════════════════════════════════════════════
-- FINANCIAL — TRADES
-- ═════════════════════════════════════════════════════════════════

CREATE TABLE trades (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  buyer_id              UUID NOT NULL REFERENCES users(id),
  seller_id             UUID NOT NULL REFERENCES users(id),
  buyer_wallet          VARCHAR(42),
  seller_wallet         VARCHAR(42),
  batch_id              UUID NOT NULL REFERENCES carbon_batches(id),
  token_id              INTEGER NOT NULL,
  listing_id_onchain    INTEGER,
  quantity              INTEGER NOT NULL,
  price_per_credit_inr  NUMERIC(20, 2) NOT NULL,
  subtotal_inr          NUMERIC(20, 2) NOT NULL,
  buyer_fee_inr         NUMERIC(20, 2) NOT NULL,
  seller_fee_inr        NUMERIC(20, 2) NOT NULL,
  total_fee_inr         NUMERIC(20, 2) NOT NULL,
  gst_inr               NUMERIC(20, 2) NOT NULL,
  buyer_pays_inr        NUMERIC(20, 2) NOT NULL,
  seller_receives_inr   NUMERIC(20, 2) NOT NULL,
  platform_net_inr      NUMERIC(20, 2) NOT NULL,
  price_per_credit_eth  NUMERIC(20, 8),
  total_eth             NUMERIC(20, 8),
  eth_inr_rate          NUMERIC(20, 2),
  fee_eth               NUMERIC(20, 8),
  payment_mode          VARCHAR(20) NOT NULL,  -- 'inr', 'eth', 'direct_razorpay'
  status                VARCHAR(20) DEFAULT 'completed',
  tx_hash               VARCHAR(66),
  razorpay_payment_id   VARCHAR(100),
  razorpay_order_id     VARCHAR(100),
  buyer_inr_deducted    BOOLEAN DEFAULT FALSE,
  seller_inr_credited   BOOLEAN DEFAULT FALSE,
  inr_settlement_at     TIMESTAMP,
  completed_at          TIMESTAMP DEFAULT NOW(),
  idempotency_key       VARCHAR(100),
  chain_status          VARCHAR(20),  -- 'pending', 'confirmed', 'failed'
  chain_tx_hash         VARCHAR(66),
  chain_block           BIGINT,
  chain_logged_at       TIMESTAMP,
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW(),

  CONSTRAINT chk_quantity_positive CHECK (quantity > 0),
  CONSTRAINT chk_price_positive CHECK (price_per_credit_inr > 0),
  CONSTRAINT unq_trades_idempotency UNIQUE (idempotency_key) WHERE status = 'completed'
);

CREATE INDEX idx_trades_buyer ON trades(buyer_id);
CREATE INDEX idx_trades_seller ON trades(seller_id);
CREATE INDEX idx_trades_batch ON trades(batch_id);
CREATE INDEX idx_trades_status ON trades(status);
CREATE INDEX idx_trades_chain_status ON trades(chain_status);
CREATE INDEX idx_trades_idempotency ON trades(idempotency_key) WHERE status = 'completed';
CREATE INDEX idx_trades_tx_hash ON trades(tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX idx_trades_razorpay_order ON trades(razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════
-- FINANCIAL — WALLET TRANSACTIONS
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE wallet_transactions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                VARCHAR(10) NOT NULL,       -- 'credit' | 'debit'
  method              VARCHAR(20) NOT NULL,       -- 'upi', 'bank', 'inr', 'eth', 'system', 'razorpay'
  amount              NUMERIC(20, 2) NOT NULL,
  status              VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'success', 'failed'
  balance_before      NUMERIC(20, 2),
  balance_after       NUMERIC(20, 2),
  reference           VARCHAR(100) UNIQUE,
  razorpay_order_id   VARCHAR(100),
  razorpay_payment_id VARCHAR(100),
  razorpay_signature  VARCHAR(200),
  razorpay_payout_id  VARCHAR(100),
  gst_invoice_no      VARCHAR(100),
  bank_account_number VARCHAR(30),
  bank_ifsc           VARCHAR(20),
  bank_account_name   VARCHAR(100),
  notes               TEXT,
  trade_id            UUID REFERENCES trades(id),
  trade_type          VARCHAR(20),
  idempotency_key     VARCHAR(100),
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW(),

  CONSTRAINT chk_wallet_tx_amount_positive CHECK (amount > 0)
);

CREATE INDEX idx_wallet_tx_user ON wallet_transactions(user_id);
CREATE INDEX idx_wallet_tx_status ON wallet_transactions(status);
CREATE INDEX idx_wallet_tx_reference ON wallet_transactions(reference);
CREATE INDEX idx_wallet_tx_razorpay_order ON wallet_transactions(razorpay_order_id);
CREATE INDEX idx_wallet_tx_razorpay_payment ON wallet_transactions(razorpay_payment_id);
CREATE INDEX idx_wallet_tx_razorpay_payout ON wallet_transactions(razorpay_payout_id);
CREATE INDEX idx_wallet_tx_trade ON wallet_transactions(trade_id);
CREATE INDEX idx_wallet_tx_idempotency ON wallet_transactions(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════
-- FINANCIAL — SUBSCRIPTION PAYMENTS (idempotency-protected)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE subscription_payments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan                VARCHAR(20) NOT NULL,
  cycle               VARCHAR(10) NOT NULL,
  amount_paise        BIGINT NOT NULL,
  gst_amount_paise    BIGINT NOT NULL DEFAULT 0,
  total_amount_paise  BIGINT NOT NULL,
  pay_method          VARCHAR(20) NOT NULL,
  status              VARCHAR(20) DEFAULT 'pending',
  idempotency_key     VARCHAR(100),
  razorpay_order_id   VARCHAR(100),
  wallet_address      VARCHAR(42),
  signature           TEXT,
  metamask_address    VARCHAR(42),
  metamask_message    TEXT,
  gstin               VARCHAR(20),
  pan                 VARCHAR(20),
  renewal_date        DATE,
  amount              NUMERIC(20, 2),
  gst_type            VARCHAR(20) DEFAULT 'cgst_sgst',
  buyer_state_code    VARCHAR(2),
  cgst_paise          BIGINT DEFAULT 0,
  sgst_paise          BIGINT DEFAULT 0,
  igst_paise          BIGINT DEFAULT 0,
  coupon_code         VARCHAR(50),
  discount_paise      BIGINT DEFAULT 0,
  invoice_number      VARCHAR(50),
  invoice_url         TEXT,
  invoice_pdf         BYTEA,
  webhook_event_id    VARCHAR(100),
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW(),

  CONSTRAINT chk_sub_payment_amount_positive CHECK (total_amount_paise > 0)
);

CREATE INDEX idx_sub_payments_user ON subscription_payments(user_id);
CREATE INDEX idx_sub_payments_status ON subscription_payments(status);
CREATE INDEX idx_sub_payments_razorpay_order ON subscription_payments(razorpay_order_id);
CREATE INDEX idx_sub_payments_webhook_event ON subscription_payments(webhook_event_id);
CREATE INDEX idx_sub_payments_idempotency ON subscription_payments(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX unq_sub_payments_idempotency ON subscription_payments(idempotency_key, user_id) WHERE idempotency_key IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════
-- KYC — IDEMPOTENCY KEYS (replay protection)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE kyc_idempotency_keys (
  key         VARCHAR(128) NOT NULL,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  response    JSONB NOT NULL,
  expires_at  TIMESTAMP NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  created_at  TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (key, user_id)
);

CREATE INDEX idx_kyc_idempotency_expires ON kyc_idempotency_keys(expires_at);

-- ══════════════════════════════════════════════════════════════════
-- FINANCIAL — PLATFORM FEES
-- ═════════════════════════════════════════════════════════════════

CREATE TABLE platform_fees (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trade_id              UUID NOT NULL REFERENCES trades(id),
  buyer_fee_inr         NUMERIC(20, 2) NOT NULL,
  seller_fee_inr        NUMERIC(20, 2) NOT NULL,
  total_fee_inr         NUMERIC(20, 2) NOT NULL,
  gst_inr               NUMERIC(20, 2) NOT NULL,
  platform_net_inr      NUMERIC(20, 2) NOT NULL,
  fee_eth               NUMERIC(20, 8),
  eth_rate              NUMERIC(20, 2),
  payment_mode          VARCHAR(20) NOT NULL,
  status                VARCHAR(20) DEFAULT 'collected',
  gst_type              VARCHAR(20) DEFAULT 'cgst_sgst',
  cgst_inr              NUMERIC(20, 2),
  sgst_inr              NUMERIC(20, 2),
  igst_inr              NUMERIC(20, 2),
  razorpay_payment_id   VARCHAR(100),
  created_at            TIMESTAMP DEFAULT NOW(),

  CONSTRAINT unq_platform_fees_trade UNIQUE (trade_id)
);

-- ═════════════════════════════════════════════════════════════════
-- FINANCIAL — CREDIT LEDGER
-- ═════════════════════════════════════════════════════════════════

CREATE TABLE credit_ledger_entries (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  onchain_log_id        BIGINT,
  user_id               UUID NOT NULL REFERENCES users(id),
  user_id_hash          VARCHAR(66) NOT NULL,
  token_id              INTEGER NOT NULL,
  amount_delta          INTEGER NOT NULL,
  action_type           VARCHAR(20) NOT NULL,
  ref_hash              VARCHAR(66) NOT NULL,
  ref_table             VARCHAR(50),
  ref_id                UUID,
  note                  TEXT,
  tx_hash               VARCHAR(66),
  block_number          BIGINT,
  chain_status          VARCHAR(20) DEFAULT 'confirmed',
  created_at            TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_credit_ledger_user ON credit_ledger_entries(user_id);
CREATE INDEX idx_credit_ledger_token ON credit_ledger_entries(token_id);
CREATE INDEX idx_credit_ledger_ref ON credit_ledger_entries(ref_table, ref_id);
CREATE INDEX idx_credit_ledger_tx_hash ON credit_ledger_entries(tx_hash);

CREATE TABLE credit_ledger_balances (
  user_id               UUID NOT NULL REFERENCES users(id),
  token_id              INTEGER NOT NULL,
  balance               INTEGER NOT NULL DEFAULT 0,
  total_retired         INTEGER NOT NULL DEFAULT 0,
  updated_at            TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, token_id),

  CONSTRAINT chk_ledger_balance_nonneg CHECK (balance >= 0),
  CONSTRAINT chk_ledger_retired_nonneg CHECK (total_retired >= 0)
);

-- ═════════════════════════════════════════════════════════════════
-- BLOCKCHAIN — PENDING CHAIN LOGS (retry queue)
-- ════════════════════════════════════════════════════════════════

CREATE TABLE pending_chain_logs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trade_id              UUID NOT NULL REFERENCES trades(id),
  payload               JSONB NOT NULL,
  attempts              INTEGER NOT NULL DEFAULT 0,
  next_retry_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMP DEFAULT NOW(),
  UNIQUE (trade_id)
);

CREATE INDEX idx_pending_chain_logs_retry ON pending_chain_logs(next_retry_at) WHERE attempts < 5;

-- ═════════════════════════════════════════════════════════════════
-- INDEXES
-- ═════════════════════════════════════════════════════════════════

CREATE INDEX idx_users_email          ON users(email);
CREATE INDEX idx_users_wallet         ON users(wallet_address);
CREATE INDEX idx_projects_developer   ON projects(developer_id);
CREATE INDEX idx_projects_status      ON projects(status);
CREATE INDEX idx_batches_project      ON carbon_batches(project_id);
CREATE INDEX idx_batches_token_id     ON carbon_batches(token_id);
CREATE INDEX idx_batches_status       ON carbon_batches(status);
CREATE INDEX idx_txns_token_id        ON registry_transactions(token_id);
CREATE INDEX idx_txns_from_wallet     ON registry_transactions(from_wallet);
CREATE INDEX idx_txns_to_wallet       ON registry_transactions(to_wallet);
CREATE INDEX idx_txns_tx_hash         ON registry_transactions(tx_hash);
CREATE INDEX idx_txns_type            ON registry_transactions(type);
CREATE INDEX idx_retirements_user     ON retirements(retired_by);
CREATE INDEX idx_retirements_token    ON retirements(token_id);
CREATE INDEX idx_emissions_user       ON emission_reports(user_id);
CREATE INDEX idx_audit_user           ON audit_log(user_id);
CREATE INDEX idx_audit_action         ON audit_log(action);

-- ═══════════════════════════════════════════════════════════════════
-- TRIGGERS — auto update updated_at
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_batches_updated_at
  BEFORE UPDATE ON carbon_batches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_emissions_updated_at
  BEFORE UPDATE ON emission_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();