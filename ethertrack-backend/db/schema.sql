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
-- ══════════════════════════════════════════════════════════════════

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
-- ══════════════════════════════════════════════════════════════════

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
  updated_at          TIMESTAMP DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════
-- REGISTRY — TRANSACTIONS (mirror of blockchain events)
-- ══════════════════════════════════════════════════════════════════

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
-- ══════════════════════════════════════════════════════════════════

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

-- ══════════════════════════════════════════════════════════════════
-- EMISSIONS
-- ══════════════════════════════════════════════════════════════════

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

-- ══════════════════════════════════════════════════════════════════
-- AUDIT LOG
-- ══════════════════════════════════════════════════════════════════

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

-- ══════════════════════════════════════════════════════════════════
-- INDEXES
-- ══════════════════════════════════════════════════════════════════

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

-- ══════════════════════════════════════════════════════════════════
-- TRIGGERS — auto update updated_at
-- ══════════════════════════════════════════════════════════════════

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
