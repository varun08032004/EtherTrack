# Phase 2: Target Architecture & Database Schema

**Date:** 2026-08-18  
**Status:** Complete

---

## 1. Target System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ETHERTRACK MARKETPLACE                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        ▼                             ▼                             ▼
┌───────────────┐            ┌───────────────┐            ┌───────────────┐
│   LISTING     │            │   MATCHING    │            │  RETIREMENT   │
│   SERVICE     │            │   SERVICE     │            │   SERVICE     │
└───────┬───────┘            └───────┬───────┘            └───────┬───────┘
        │                             │                             │
        └─────────────────────────────┼─────────────────────────────┘
                                      ▼
                         ┌───────────────────────┐
                         │  SETTLEMENT ENGINE    │
                         │  (State Machine)      │
                         └───────────┬───────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
            ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
            │  CUSTODY    │  │  PAYMENT    │  │   FEE       │
            │  ADAPTER    │  │  SERVICE    │  │  SERVICE    │
            └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
                   │                │                │
         ┌─────────┴─────────┐      │                │
         ▼                   ▼      ▼                ▼
┌─────────────────┐ ┌─────────────────┐              │
│ OnChainCustody  │ │ LedgerCustody   │              │
│ Adapter         │ │ Adapter         │              │
└────────┬────────┘ └────────┬────────┘              │
         │                   │                       │
         ▼                   ▼                       ▼
┌─────────────────┐ ┌─────────────────┐     ┌─────────────────┐
│ Marketplace.sol │ │ CreditLedger.sol│     │   Razorpay      │
│ CarbonCredit    │ │                 │     │   INR Wallet    │
│ Token.sol       │ │                 │     │                 │
└─────────────────┘ └─────────────────┘     └─────────────────┘
         │                   │                       │
         └───────────────────┼───────────────────────┘
                             ▼
                    ┌─────────────────┐
                    │  POSTGRESQL     │
                    │  (Canonical     │
                    │   Schema)       │
                    └─────────────────┘
                             │
                    ┌────────┴────────┐
                    ▼                 ▼
            ┌─────────────┐   ┌─────────────┐
            │ REDIS CACHE │   │ OUTBOX      │
            │ (Event      │   │ EVENTS      │
            │  Driven)    │   │             │
            └─────────────┘   └─────────────┘
```

---

## 2. Canonical Database Schema

### 2.1 Core Tables (Carbon Domain)

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- CARBON ASSETS (Immutable Provenance)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE carbon_assets (
    asset_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_id              BIGINT NOT NULL UNIQUE,           -- ERC-1155 token ID
    project_id            UUID NOT NULL REFERENCES projects(id),
    registry              VARCHAR(10) NOT NULL CHECK (registry IN ('VCS','GS','CDM','ACR','BEE')),
    vintage               SMALLINT NOT NULL CHECK (vintage >= 1990 AND vintage <= EXTRACT(YEAR FROM CURRENT_DATE)),
    methodology           VARCHAR(255),
    serial_number         VARCHAR(200) NOT NULL UNIQUE,     -- Registry serial
    total_supply          BIGINT NOT NULL DEFAULT 0 CHECK (total_supply >= 0),
    retired_supply        BIGINT NOT NULL DEFAULT 0 CHECK (retired_supply >= 0),
    status                VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','depleted')),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT chk_carbon_asset_supply CHECK (retired_supply <= total_supply)
);

CREATE INDEX idx_carbon_assets_token ON carbon_assets(token_id);
CREATE INDEX idx_carbon_assets_project ON carbon_assets(project_id);
CREATE INDEX idx_carbon_assets_serial ON carbon_assets(serial_number);

-- ─────────────────────────────────────────────────────────────────────────────
-- OWNERSHIP POSITIONS (Mutable State - Single Source of Truth)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE ownership_positions (
    position_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id              UUID NOT NULL REFERENCES users(id),
    asset_id              UUID NOT NULL REFERENCES carbon_assets(asset_id),
    custody_type          VARCHAR(20) NOT NULL CHECK (custody_type IN ('onchain','ledger')),
    owned_quantity        BIGINT NOT NULL DEFAULT 0 CHECK (owned_quantity >= 0),
    reserved_quantity     BIGINT NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
    -- available_quantity is DERIVED: owned_quantity - reserved_quantity
    status                VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','exhausted')),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT chk_position_reserved CHECK (owned_quantity >= reserved_quantity),
    CONSTRAINT uq_owner_asset_custody UNIQUE (owner_id, asset_id, custody_type)
);

CREATE INDEX idx_positions_owner ON ownership_positions(owner_id);
CREATE INDEX idx_positions_asset ON ownership_positions(asset_id);
CREATE INDEX idx_positions_custody ON ownership_positions(custody_type);
CREATE INDEX idx_positions_status ON ownership_positions(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- LISTINGS (First-Class Market Objects)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE listings (
    listing_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    position_id           UUID NOT NULL REFERENCES ownership_positions(position_id),
    asset_id              UUID NOT NULL REFERENCES carbon_assets(asset_id),
    seller_id             UUID NOT NULL REFERENCES users(id),
    custody_type          VARCHAR(20) NOT NULL CHECK (custody_type IN ('onchain','ledger')),
    quantity              BIGINT NOT NULL CHECK (quantity > 0),          -- Original amount
    remaining_quantity    BIGINT NOT NULL CHECK (remaining_quantity >= 0), -- Available to buy
    price_per_unit        NUMERIC(30, 0) NOT NULL CHECK (price_per_unit > 0), -- Minor units
    currency              VARCHAR(10) NOT NULL CHECK (currency IN ('INR','ETH')),
    buyer_fee_bps         SMALLINT NOT NULL DEFAULT 50 CHECK (buyer_fee_bps >= 0),   -- 50 = 0.5%
    seller_fee_bps        SMALLINT NOT NULL DEFAULT 50 CHECK (seller_fee_bps >= 0),
    status                VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','filled','cancelled','expired')),
    expires_at            TIMESTAMPTZ,
    onchain_listing_id    BIGINT,                                        -- Marketplace.sol listing ID
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT chk_listing_remaining CHECK (remaining_quantity <= quantity)
);

CREATE INDEX idx_listings_position ON listings(position_id);
CREATE INDEX idx_listings_seller ON listings(seller_id);
CREATE INDEX idx_listings_asset ON listings(asset_id);
CREATE INDEX idx_listings_status ON listings(status) WHERE status = 'active';
CREATE INDEX idx_listings_custody ON listings(custody_type);
CREATE INDEX idx_listings_market ON listings(custody_type, status, price_per_unit) WHERE status = 'active';
CREATE INDEX idx_listings_expires ON listings(expires_at) WHERE expires_at IS NOT NULL AND status = 'active';

-- ─────────────────────────────────────────────────────────────────────────────
-- RETIREMENTS (Permanent Credit Removal)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE retirements (
    retirement_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    position_id           UUID NOT NULL REFERENCES ownership_positions(position_id),
    asset_id              UUID NOT NULL REFERENCES carbon_assets(asset_id),
    owner_id              UUID NOT NULL REFERENCES users(id),
    quantity              BIGINT NOT NULL CHECK (quantity > 0),
    custody_type          VARCHAR(20) NOT NULL CHECK (custody_type IN ('onchain','ledger')),
    scope                 SMALLINT NOT NULL CHECK (scope IN (1,2,3)),        -- GHG scope
    beneficiary_name      VARCHAR(255),
    beneficiary_entity    VARCHAR(255),
    beneficiary_gstin     VARCHAR(15),
    reporting_standard    VARCHAR(50) DEFAULT 'GHG_PROTOCOL',
    purpose               VARCHAR(50) DEFAULT 'voluntary_offset',
    certificate_id        VARCHAR(100) NOT NULL UNIQUE,
    blockchain_tx_hash    VARCHAR(66),                                     -- 0x... or NULL
    blockchain_log_index  INTEGER,
    chain_id              INTEGER,
    contract_address      VARCHAR(42),
    status                VARCHAR(20) NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','completed','failed')),
    retired_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_retirements_owner ON retirements(owner_id);
CREATE INDEX idx_retirements_asset ON retirements(asset_id);
CREATE INDEX idx_retirements_cert ON retirements(certificate_id);
CREATE INDEX idx_retirements_chain ON retirements(chain_id, contract_address, blockchain_tx_hash, blockchain_log_index);

-- ─────────────────────────────────────────────────────────────────────────────
-- BLOCKCHAIN EVENTS (Idempotent Processing)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE blockchain_events (
    event_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chain_id              INTEGER NOT NULL,
    contract_address      VARCHAR(42) NOT NULL,                            -- Lowercase
    tx_hash               VARCHAR(66) NOT NULL,
    log_index             INTEGER NOT NULL,
    block_number          BIGINT NOT NULL,
    event_name            VARCHAR(100) NOT NULL,
    decoded_args          JSONB NOT NULL,
    processed_at          TIMESTAMPTZ,
    processing_status     VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (processing_status IN ('PENDING','PROCESSED','FAILED','DUPLICATE')),
    error_message         TEXT,
    idempotency_key       VARCHAR(200) GENERATED ALWAYS AS (chain_id || ':' || contract_address || ':' || tx_hash || ':' || log_index) STORED,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT uq_blockchain_event UNIQUE (chain_id, contract_address, tx_hash, log_index)
);

CREATE INDEX idx_blockchain_events_status ON blockchain_events(processing_status) WHERE processing_status = 'PENDING';
CREATE INDEX idx_blockchain_events_block ON blockchain_events(block_number);
CREATE INDEX idx_blockchain_events_contract ON blockchain_events(contract_address, event_name);
```

---

### 2.2 Financial Domain Tables

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- TRADES (Commercial Agreement)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE trades (
    trade_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id            UUID NOT NULL REFERENCES listings(listing_id),
    buyer_id              UUID NOT NULL REFERENCES users(id),
    seller_id             UUID NOT NULL REFERENCES users(id),
    asset_id              UUID NOT NULL REFERENCES carbon_assets(asset_id),
    seller_custody_type   VARCHAR(20) NOT NULL CHECK (seller_custody_type IN ('onchain','ledger')),
    buyer_custody_type    VARCHAR(20) NOT NULL CHECK (buyer_custody_type IN ('onchain','ledger')),
    quantity              BIGINT NOT NULL CHECK (quantity > 0),
    execution_price       NUMERIC(30, 0) NOT NULL CHECK (execution_price > 0), -- Minor units
    currency              VARCHAR(10) NOT NULL CHECK (currency IN ('INR','ETH')),
    
    -- Commercial terms (immutable)
    buyer_gross           NUMERIC(30, 0) NOT NULL CHECK (buyer_gross > 0),
    seller_gross          NUMERIC(30, 0) NOT NULL CHECK (seller_gross > 0),
    buyer_fee_bps         SMALLINT NOT NULL CHECK (buyer_fee_bps >= 0),
    seller_fee_bps        SMALLINT NOT NULL CHECK (seller_fee_bps >= 0),
    
    -- References to child entities
    payment_id            UUID,                                            -- payments.payment_id
    credit_transfer_id    UUID,                                            -- credit_transfers.transfer_id
    buyer_fee_id          UUID,                                            -- fees.fee_id
    seller_fee_id         UUID,                                            -- fees.fee_id
    
    settlement_state      VARCHAR(40) NOT NULL DEFAULT 'CREATED' CHECK (settlement_state IN (
        'CREATED','VALIDATED','FUNDS_RESERVED','CREDITS_RESERVED','SETTLEMENT_PENDING',
        'CREDIT_TRANSFER_SUBMITTED','CREDIT_TRANSFER_CONFIRMED','PAYMENT_SETTLED',
        'FEES_COLLECTED','SELLER_PAID','BUYER_CREDITED','SETTLED',
        'FAILED','CANCELLED','EXPIRED','REQUIRES_RECONCILIATION'
    )),
    idempotency_key       VARCHAR(200) NOT NULL UNIQUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settled_at            TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT chk_trade_gross CHECK (buyer_gross = seller_gross)
);

CREATE INDEX idx_trades_buyer ON trades(buyer_id);
CREATE INDEX idx_trades_seller ON trades(seller_id);
CREATE INDEX idx_trades_listing ON trades(listing_id);
CREATE INDEX idx_trades_asset ON trades(asset_id);
CREATE INDEX idx_trades_state ON trades(settlement_state);
CREATE INDEX idx_trades_idempotency ON trades(idempotency_key);
CREATE INDEX idx_trades_created ON trades(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- PAYMENTS (Fiat/Crypto Money Movement)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE payments (
    payment_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id              UUID NOT NULL REFERENCES trades(trade_id),
    payer_id              UUID NOT NULL REFERENCES users(id),              -- Buyer
    payee_id              UUID NOT NULL REFERENCES users(id),              -- Seller
    amount                NUMERIC(30, 0) NOT NULL CHECK (amount > 0),      -- Minor units
    currency              VARCHAR(10) NOT NULL CHECK (currency IN ('INR','ETH')),
    payment_mode          VARCHAR(30) NOT NULL CHECK (payment_mode IN ('inr_wallet','razorpay','eth','razorpay_transfer')),
    provider              VARCHAR(20) NOT NULL CHECK (provider IN ('razorpay','ethereum','internal')),
    provider_reference    VARCHAR(200),                                    -- razorpay_order_id, tx_hash, etc.
    
    status                VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN (
        'PENDING','AUTHORIZED','CAPTURED','SETTLED','FAILED','REFUNDED','REVERSED'
    )),
    idempotency_key       VARCHAR(200) NOT NULL UNIQUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at          TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE payment_attempts (
    attempt_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id            UUID NOT NULL REFERENCES payments(payment_id) ON DELETE CASCADE,
    provider_reference    VARCHAR(200),
    status                VARCHAR(20) NOT NULL CHECK (status IN ('PENDING','SUCCESS','FAILED')),
    error_message         TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at          TIMESTAMPTZ
);

CREATE INDEX idx_payments_trade ON payments(trade_id);
CREATE INDEX idx_payments_payer ON payments(payer_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_provider_ref ON payments(provider_reference) WHERE provider_reference IS NOT NULL;
CREATE INDEX idx_payment_attempts_payment ON payment_attempts(payment_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- CREDIT TRANSFERS (Ownership Movement)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE credit_transfers (
    transfer_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id              UUID NOT NULL REFERENCES trades(trade_id),
    asset_id              UUID NOT NULL REFERENCES carbon_assets(asset_id),
    quantity              BIGINT NOT NULL CHECK (quantity > 0),
    from_custody_type     VARCHAR(20) NOT NULL CHECK (from_custody_type IN ('onchain','ledger')),
    to_custody_type       VARCHAR(20) NOT NULL CHECK (to_custody_type IN ('onchain','ledger')),
    status                VARCHAR(40) NOT NULL DEFAULT 'PENDING' CHECK (status IN (
        'PENDING','SUBMITTED','CONFIRMED','FAILED','REQUIRES_RECONCILIATION'
    )),
    idempotency_key       VARCHAR(200) NOT NULL UNIQUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at          TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE credit_transfer_operations (
    operation_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id           UUID NOT NULL REFERENCES credit_transfers(transfer_id) ON DELETE CASCADE,
    type                  VARCHAR(40) NOT NULL CHECK (type IN (
        'ESCROW_RELEASE','ERC1155_TRANSFER','LEDGER_SELL','LEDGER_BUY','CUSTODY_WALLET_MOVE'
    )),
    custody_type          VARCHAR(20) NOT NULL CHECK (custody_type IN ('onchain','ledger')),
    from_address          VARCHAR(66),                                     -- Wallet address or userIdHash
    to_address            VARCHAR(66),                                     -- Wallet address or userIdHash
    blockchain_tx_hash    VARCHAR(66),
    blockchain_log_index  INTEGER,
    chain_id              INTEGER,
    contract_address      VARCHAR(42),
    status                VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SUBMITTED','CONFIRMED','FAILED')),
    error_message         TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at          TIMESTAMPTZ
);

CREATE INDEX idx_credit_transfers_trade ON credit_transfers(trade_id);
CREATE INDEX idx_credit_transfers_status ON credit_transfers(status);
CREATE INDEX idx_ct_operations_transfer ON credit_transfer_operations(transfer_id);
CREATE INDEX idx_ct_operations_chain ON credit_transfer_operations(chain_id, contract_address, blockchain_tx_hash, blockchain_log_index);

-- ─────────────────────────────────────────────────────────────────────────────
-- FEES (Platform Revenue)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE fees (
    fee_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id              UUID NOT NULL REFERENCES trades(trade_id),
    type                  VARCHAR(40) NOT NULL CHECK (type IN ('BUYER_TRANSACTION_FEE','SELLER_TRANSACTION_FEE')),
    amount                NUMERIC(30, 0) NOT NULL CHECK (amount >= 0),       -- Minor units (paise)
    currency              VARCHAR(10) NOT NULL DEFAULT 'INR',
    tax_amount            NUMERIC(30, 0) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    tax_type              VARCHAR(20) NOT NULL DEFAULT 'CGST_SGST' CHECK (tax_type IN ('CGST_SGST','IGST')),
    cgst_amount           NUMERIC(30, 0) NOT NULL DEFAULT 0,
    sgst_amount           NUMERIC(30, 0) NOT NULL DEFAULT 0,
    igst_amount           NUMERIC(30, 0) NOT NULL DEFAULT 0,
    status                VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COLLECTED','FAILED')),
    collected_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fees_trade ON fees(trade_id);
CREATE INDEX idx_fees_type ON fees(type);

-- ─────────────────────────────────────────────────────────────────────────────
-- SETTLEMENT OPERATIONS (Audit Trail)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE settlement_operations (
    operation_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id              UUID NOT NULL REFERENCES trades(trade_id),
    type                  VARCHAR(40) NOT NULL CHECK (type IN (
        'VALIDATE','RESERVE_FUNDS','RESERVE_CREDITS','SUBMIT_CHAIN','CONFIRM_CHAIN',
        'SETTLE_PAYMENT','COLLECT_FEES','PAY_SELLER','CREDIT_BUYER',
        'COMPENSATE','RECONCILE'
    )),
    custody_context       VARCHAR(20) NOT NULL CHECK (custody_context IN ('buyer','seller','platform','both')),
    status                VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED','FAILED','COMPENSATED')),
    input_data            JSONB NOT NULL DEFAULT '{}',
    output_data           JSONB,
    error_message         TEXT,
    idempotency_key       VARCHAR(200) NOT NULL,
    started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at          TIMESTAMPTZ
);

CREATE INDEX idx_settlement_ops_trade ON settlement_operations(trade_id);
CREATE INDEX idx_settlement_ops_status ON settlement_operations(status);
CREATE INDEX idx_settlement_ops_idempotency ON settlement_operations(idempotency_key);

-- ─────────────────────────────────────────────────────────────────────────────
-- WALLET TRANSACTIONS (INR Ledger)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE wallet_transactions (
    transaction_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type                  VARCHAR(10) NOT NULL CHECK (type IN ('credit','debit')),
    method                VARCHAR(20) NOT NULL CHECK (method IN ('upi','bank','inr','eth','system','razorpay','razorpay_transfer')),
    amount                NUMERIC(30, 0) NOT NULL CHECK (amount > 0),        -- Minor units (paise)
    balance_before        NUMERIC(30, 0) NOT NULL,
    balance_after         NUMERIC(30, 0) NOT NULL,
    reference             VARCHAR(100) NOT NULL UNIQUE,                    -- Idempotency key
    trade_id              UUID REFERENCES trades(trade_id),
    payment_id            UUID REFERENCES payments(payment_id),
    fee_id                UUID REFERENCES fees(fee_id),
    notes                 TEXT,
    status                VARCHAR(20) NOT NULL DEFAULT 'success' CHECK (status IN ('pending','success','failed')),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallet_tx_user ON wallet_transactions(user_id);
CREATE INDEX idx_wallet_tx_trade ON wallet_transactions(trade_id);
CREATE INDEX idx_wallet_tx_payment ON wallet_transactions(payment_id);
CREATE INDEX idx_wallet_tx_reference ON wallet_transactions(reference);
CREATE INDEX idx_wallet_tx_created ON wallet_transactions(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- PLATFORM FEES (Aggregated Fee Accounting)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE platform_fees (
    platform_fee_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id              UUID NOT NULL REFERENCES trades(trade_id) UNIQUE,
    buyer_fee_amount      NUMERIC(30, 0) NOT NULL CHECK (buyer_fee_amount >= 0),
    seller_fee_amount     NUMERIC(30, 0) NOT NULL CHECK (seller_fee_amount >= 0),
    total_fee_amount      NUMERIC(30, 0) NOT NULL CHECK (total_fee_amount >= 0),
    gst_amount            NUMERIC(30, 0) NOT NULL CHECK (gst_amount >= 0),
    platform_net_amount   NUMERIC(30, 0) NOT NULL,
    fee_eth               NUMERIC(30, 18),                                 -- ETH equivalent
    eth_rate              NUMERIC(30, 2),                                  -- INR per ETH
    payment_mode          VARCHAR(30) NOT NULL,
    status                VARCHAR(20) NOT NULL DEFAULT 'collected' CHECK (status IN ('collected','pending','failed')),
    gst_type              VARCHAR(20) DEFAULT 'CGST_SGST' CHECK (gst_type IN ('CGST_SGST','IGST')),
    cgst_amount           NUMERIC(30, 0) DEFAULT 0,
    sgst_amount           NUMERIC(30, 0) DEFAULT 0,
    igst_amount           NUMERIC(30, 0) DEFAULT 0,
    razorpay_payment_id   VARCHAR(100),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT chk_platform_fees_total CHECK (total_fee_amount = buyer_fee_amount + seller_fee_amount)
);

CREATE INDEX idx_platform_fees_trade ON platform_fees(trade_id);
CREATE INDEX idx_platform_fees_created ON platform_fees(created_at DESC);
```

---

### 2.3 Legacy Compatibility Views (For Zero-Downtime Migration)

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- COMPATIBILITY VIEWS - Map new schema to old query patterns
-- ─────────────────────────────────────────────────────────────────────────────

-- carbon_batches view (maps to ownership_positions + listings + carbon_assets)
CREATE VIEW carbon_batches_compat AS
SELECT 
    cb.id,
    cb.user_id,
    cb.project_id,
    ca.asset_id,
    ca.token_id,
    ca.project_name,
    ca.project_location,
    ca.country,
    ca.standard,
    ca.project_type,
    ca.developer,
    ca.vintage_year,
    ca.expiry_date,
    ca.registry_serial,
    ca.doc_ipfs_hash,
    cb.status,
    cb.admin_status,
    cb.custody_model,
    op.owned_quantity AS total_credits,
    op.owned_quantity - op.reserved_quantity AS available_credits,
    op.reserved_quantity AS listed_quantity,
    op.reserved_quantity AS listed_quantity,  -- For backward compat
    cb.price_per_credit_inr,
    cb.last_traded_price_inr,
    cb.listing_id_onchain,
    cb.created_at,
    cb.updated_at
FROM carbon_batches cb
JOIN carbon_assets ca ON ca.project_id = cb.project_id
LEFT JOIN ownership_positions op ON op.asset_id = ca.asset_id AND op.owner_id = cb.user_id AND op.custody_type = 
    CASE WHEN cb.custody_model = 'pooled' THEN 'ledger' ELSE 'onchain' END;

-- ledger_listings view (maps to listings where custody_type = 'ledger')
CREATE VIEW ledger_listings_compat AS
SELECT 
    l.listing_id AS id,
    l.seller_id,
    l.asset_id,
    l.position_id AS batch_id,
    l.quantity AS amount,
    l.remaining_quantity AS amount_remaining,
    l.price_per_unit AS price_per_credit_inr,
    l.expires_at,
    CASE WHEN l.status = 'active' THEN TRUE ELSE FALSE END AS active,
    l.created_at,
    l.updated_at
FROM listings l
WHERE l.custody_type = 'ledger';

-- market_listings view (UNION of onchain + ledger active listings)
CREATE VIEW market_listings_compat AS
SELECT 
    l.listing_id,
    l.asset_id,
    l.seller_id,
    l.quantity,
    l.remaining_quantity AS amount_remaining,
    l.price_per_unit AS price_per_credit_inr,
    l.custody_type,
    l.status,
    l.expires_at,
    l.onchain_listing_id
FROM listings l
WHERE l.status = 'active'
  AND (l.expires_at IS NULL OR l.expires_at > NOW());
```

---

## 3. API Contracts (Canonical)

### 3.1 Market API
```
GET  /api/v2/market/listings
    Query: { standard?, projectType?, custodyType?, sortBy?, cursor?, limit? }
    Response: { listings: Listing[], nextCursor?, hasMore: boolean }

GET  /api/v2/market/stats
    Response: { totalVolumeINR, totalTrades, activeListings, totalRetired, ethRate }

GET  /api/v2/market/listings/{listingId}
    Response: Listing (full detail)

GET  /api/v2/market/buy-orders
    Response: { orders: BuyOrder[] }
```

### 3.2 Listing API
```
POST /api/v2/listings
    Body: { positionId, quantity, pricePerUnit, currency, buyerFeeBps?, sellerFeeBps?, durationDays? }
    Response: { listingId, status: 'active', remainingQuantity }

POST /api/v2/listings/{listingId}/cancel
    Response: { success: true, releasedQuantity }

GET  /api/v2/listings/{listingId}
    Response: Listing
```

### 3.3 Trade API
```
POST /api/v2/trades/quote
    Body: { listingId, quantity, paymentMode }
    Response: { 
        quoteId, listingId, quantity, executionPrice, currency,
        buyerGross, buyerFee, buyerTax, buyerTotalDebit,
        sellerGross, sellerFee, sellerTax, sellerNetCredit,
        platformRevenue, platformTaxLiability,
        expiresAt, idempotencyKey 
    }

POST /api/v2/trades
    Body: { quoteId, idempotencyKey, paymentDetails? }
    Response: { tradeId, settlementState, paymentId?, creditTransferId? }

GET  /api/v2/trades/{tradeId}
    Response: Trade (with nested payment, creditTransfer, fees, operations)

GET  /api/v2/trades/history
    Query: { cursor?, limit?, custodyType? }
    Response: { trades: TradeSummary[], nextCursor?, hasMore: boolean }
```

### 3.4 Payment API
```
POST /api/v2/payments/{paymentId}/authorize
    Body: { razorpayOrderId?, ethTxHash? }
    Response: { paymentId, status: 'AUTHORIZED'|'CAPTURED' }

POST /api/v2/payments/{paymentId}/verify
    Body: { razorpayPaymentId, razorpaySignature }
    Response: { paymentId, status: 'SETTLED'|'FAILED' }

GET  /api/v2/payments/{paymentId}
    Response: Payment (with attempts)
```

### 3.5 Credit Transfer API (Internal)
```
POST /api/v2/internal/credit-transfers
    Body: { tradeId, fromCustodyType, toCustodyType, quantity, idempotencyKey }
    Response: { transferId, operations: CreditTransferOperation[] }

POST /api/v2/internal/credit-transfers/{transferId}/operations/{operationId}/submit
    Body: { blockchainTxHash?, chainId?, contractAddress? }
    Response: { operationId, status: 'SUBMITTED' }

POST /api/v2/internal/credit-transfers/{transferId}/operations/{operationId}/confirm
    Body: { blockchainTxHash, logIndex, blockNumber }
    Response: { operationId, status: 'CONFIRMED' }
```

### 3.6 Portfolio API
```
GET  /api/v2/portfolio/positions
    Query: { custodyType?, assetId? }
    Response: { positions: OwnershipPosition[] }

GET  /api/v2/portfolio/positions/{positionId}
    Response: OwnershipPosition (with derived availableQuantity)

GET  /api/v2/portfolio/retirements
    Response: { retirements: Retirement[] }

POST /api/v2/portfolio/retire
    Body: { positionId, quantity, scope, beneficiaryName?, purpose? }
    Response: { retirementId, certificateId, status }
```

---

## 4. Service Boundaries

| Service | Responsibility | Owns Tables | Depends On |
|---------|---------------|-------------|------------|
| **AssetService** | Carbon asset registry, provenance | `carbon_assets`, `projects` | - |
| **PositionService** | Ownership positions, reservations, derived available | `ownership_positions` | `AssetService` |
| **ListingService** | Listing CRUD, market aggregation, reservation logic | `listings` | `PositionService`, `AssetService` |
| **TradeService** | Trade lifecycle, state machine, quote generation | `trades` | `ListingService`, `PositionService`, `PaymentService`, `CreditTransferService`, `FeeService` |
| **PaymentService** | Payment authorization, capture, verification, refunds | `payments`, `payment_attempts`, `wallet_transactions` | `TradeService` |
| **CreditTransferService** | Credit movement (on-chain + ledger), operations | `credit_transfers`, `credit_transfer_operations` | `TradeService`, `CustodyAdapters` |
| **FeeService** | Fee calculation, collection, platform fee accounting | `fees`, `platform_fees` | `TradeService`, `PaymentService` |
| **SettlementEngine** | Orchestrates state machine, coordinates services | `settlement_operations` | All services |
| **CustodyAdapter (OnChain)** | Marketplace.sol, CarbonCreditToken.sol interactions | - | `blockchain_events` |
| **CustodyAdapter (Ledger)** | CreditLedger.sol interactions, ledger balances | - | `blockchain_events` |
| **EventProcessor** | Blockchain event ingestion, idempotent processing | `blockchain_events` | `CustodyAdapters`, `PositionService`, `ListingService`, `TradeService` |
| **ReconciliationEngine** | Daily invariant verification, auto-repair, alerts | - | All domain tables |
| **CacheInvalidationService** | Event-driven Redis invalidation | - | Outbox events |

---

## 5. Migration Strategy (Current → Target)

### 5.1 Phase 2a: Add New Tables (Non-Breaking)
```sql
-- Run in single migration
CREATE TABLE ownership_positions (...);
CREATE TABLE listings (...);
CREATE TABLE trades (...);
CREATE TABLE payments (...);
CREATE TABLE credit_transfers (...);
CREATE TABLE credit_transfer_operations (...);
CREATE TABLE fees (...);
CREATE TABLE platform_fees (...);
CREATE TABLE settlement_operations (...);
CREATE TABLE blockchain_events (...);
-- Add triggers for updated_at
-- Add CHECK constraints
-- Add indexes
```

### 5.2 Phase 2b: Backfill Positions
```sql
-- For each carbon_batch with admin_status='approved'
-- Create ownership_position:
INSERT INTO ownership_positions (owner_id, asset_id, custody_type, owned_quantity, reserved_quantity)
SELECT 
    cb.user_id,
    ca.asset_id,
    CASE WHEN cb.custody_model = 'pooled' THEN 'ledger' ELSE 'onchain' END,
    cb.total_credits,
    COALESCE(cb.listed_quantity, 0)
FROM carbon_batches cb
JOIN carbon_assets ca ON ca.project_id = cb.project_id
WHERE cb.admin_status = 'approved';

-- For ledger_listings, create positions from credit_ledger_balances
INSERT INTO ownership_positions (owner_id, asset_id, custody_type, owned_quantity, reserved_quantity)
SELECT 
    clb.user_id,
    ca.asset_id,
    'ledger',
    clb.balance + clb.total_retired,
    COALESCE(ll.listed_sum, 0)
FROM credit_ledger_balances clb
JOIN carbon_assets ca ON ca.token_id = clb.token_id
LEFT JOIN (
    SELECT seller_id, token_id, SUM(amount_remaining) AS listed_sum
    FROM ledger_listings WHERE active = TRUE GROUP BY seller_id, token_id
) ll ON ll.seller_id = clb.user_id AND ll.token_id = clb.token_id
WHERE clb.balance > 0 OR clb.total_retired > 0
ON CONFLICT (owner_id, asset_id, custody_type) DO UPDATE
SET owned_quantity = GREATEST(ownership_positions.owned_quantity, EXCLUDED.owned_quantity),
    reserved_quantity = GREATEST(ownership_positions.reserved_quantity, EXCLUDED.reserved_quantity);
```

### 5.3 Phase 2c: Backfill Listings
```sql
-- On-chain listings from carbon_batches
INSERT INTO listings (position_id, asset_id, seller_id, custody_type, quantity, remaining_quantity, price_per_unit, currency, buyer_fee_bps, seller_fee_bps, status, expires_at, onchain_listing_id)
SELECT 
    op.position_id,
    op.asset_id,
    cb.user_id,
    'onchain',
    cb.listed_quantity,
    cb.listed_quantity,
    cb.price_per_credit_inr,
    'INR',
    50, 50,
    'active',
    cb.expires_at,
    cb.listing_id_onchain
FROM carbon_batches cb
JOIN ownership_positions op ON op.owner_id = cb.user_id AND op.asset_id = (
    SELECT asset_id FROM carbon_assets WHERE token_id = cb.token_id
)
WHERE cb.listing_id_onchain IS NOT NULL
  AND cb.listed_quantity > 0
  AND cb.admin_status = 'approved'
  AND (cb.expires_at IS NULL OR cb.expires_at > NOW());

-- Ledger listings from ledger_listings
INSERT INTO listings (position_id, asset_id, seller_id, custody_type, quantity, remaining_quantity, price_per_unit, currency, buyer_fee_bps, seller_fee_bps, status, expires_at)
SELECT 
    op.position_id,
    op.asset_id,
    ll.seller_id,
    'ledger',
    ll.amount,
    ll.amount_remaining,
    ll.price_per_credit_inr,
    'INR',
    50, 50,
    CASE WHEN ll.active THEN 'active' ELSE 'cancelled' END,
    ll.expires_at
FROM ledger_listings ll
JOIN ownership_positions op ON op.owner_id = ll.seller_id AND op.asset_id = (
    SELECT asset_id FROM carbon_assets WHERE token_id = ll.token_id
) AND op.custody_type = 'ledger'
WHERE ll.active = TRUE;
```

### 5.4 Phase 2d: Backfill Trades
```sql
-- Map existing trades to new schema
INSERT INTO trades (trade_id, listing_id, buyer_id, seller_id, asset_id, seller_custody_type, buyer_custody_type, quantity, execution_price, currency, buyer_gross, seller_gross, buyer_fee_bps, seller_fee_bps, settlement_state, idempotency_key, created_at, settled_at)
SELECT 
    t.id,
    CASE 
        WHEN t.listing_id_onchain IS NOT NULL THEN (SELECT listing_id FROM listings WHERE onchain_listing_id = t.listing_id_onchain)
        ELSE (SELECT listing_id FROM listings WHERE listing_id = t.listing_id_onchain::uuid) -- ledger listing
    END,
    t.buyer_id,
    t.seller_id,
    ca.asset_id,
    CASE WHEN cb.custody_model = 'pooled' THEN 'ledger' ELSE 'onchain' END,
    CASE WHEN t.payment_mode IN ('inr','razorpay','direct_razorpay') AND t.buyer_wallet IS NULL THEN 'ledger' ELSE 'onchain' END,
    t.quantity,
    t.price_per_credit_inr,
    'INR',
    t.subtotal_inr,
    t.subtotal_inr,
    50, 50,
    CASE 
        WHEN t.chain_status = 'confirmed' THEN 'SETTLED'
        WHEN t.chain_status = 'failed' THEN 'FAILED'
        ELSE 'CREDIT_TRANSFER_SUBMITTED'
    END,
    t.idempotency_key,
    t.created_at,
    t.completed_at
FROM trades t
JOIN carbon_batches cb ON cb.id = t.batch_id
JOIN carbon_assets ca ON ca.project_id = cb.project_id;
```

### 5.5 Phase 2e: Switch Reads (Feature Flag)
```typescript
// Feature flag: USE_CANONICAL_SCHEMA
// Gradually migrate API endpoints:
// 1. /api/v2/market/listings → listings view
// 2. /api/v2/portfolio/positions → ownership_positions
// 3. /api/v2/trades/history → trades table
// 4. Write paths remain on legacy until Phase 4
```

### 5.6 Phase 2f: Legacy Removal (Phase 6)
```sql
-- After full validation:
DROP VIEW carbon_batches_compat;
DROP VIEW ledger_listings_compat;
DROP VIEW market_listings_compat;
-- Remove columns: carbon_batches.listed_quantity, listing_id_onchain
-- Drop tables: ledger_listings, market_listings (if exists), buy_orders
```

---

## 6. Outbox Pattern for Event-Driven Cache Invalidation

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- OUTBOX EVENTS (Transactional Event Publishing)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE outbox_events (
    event_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type        VARCHAR(50) NOT NULL,      -- 'Listing', 'Trade', 'Position', 'Payment'
    aggregate_id          UUID NOT NULL,
    event_type            VARCHAR(100) NOT NULL,     -- 'ListingCreated', 'TradeSettled', etc.
    payload               JSONB NOT NULL,
    metadata              JSONB DEFAULT '{}',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at          TIMESTAMPTZ
);

CREATE INDEX idx_outbox_unpublished ON outbox_events(published_at) WHERE published_at IS NULL;
CREATE INDEX idx_outbox_aggregate ON outbox_events(aggregate_type, aggregate_id);

-- Worker publishes to Redis/message broker, marks published_at
-- Cache invalidation subscribes to relevant event types
```

---

## 7. Redis Cache Key Schema (Event-Driven)

```typescript
// Cache Keys (Invalidated via outbox events)
const CACHE_KEYS = {
  // Market
  marketListings: (params: MarketParams) => `market:listings:v2:${hash(params)}`,     // TTL: 60s fallback
  marketStats: () => 'market:stats:v2',                                              // TTL: 60s fallback
  
  // Positions (per user)
  userPositions: (userId: string) => `positions:${userId}`,                          // Invalidate on PositionUpdated
  position: (positionId: string) => `position:${positionId}`,                        // Invalidate on PositionUpdated
  
  // Listings
  listing: (listingId: string) => `listing:${listingId}`,                            // Invalidate on ListingUpdated
  
  // Trades
  userTrades: (userId: string, cursor?: string) => `trades:${userId}:${cursor||'first'}`, // Invalidate on TradeCreated
  
  // Pricing
  ethInrRate: () => 'price:eth:inr',                                                 // TTL: 30s fallback
};

// Invalidation Events → Cache Keys
const INVALIDATION_MAP = {
  ListingCreated:    (payload) => [CACHE_KEYS.marketListings('*'), CACHE_KEYS.marketStats()],
  ListingUpdated:    (payload) => [CACHE_KEYS.marketListings('*'), CACHE_KEYS.listing(payload.listingId), CACHE_KEYS.marketStats()],
  ListingCancelled:  (payload) => [CACHE_KEYS.marketListings('*'), CACHE_KEYS.listing(payload.listingId), CACHE_KEYS.marketStats(), CACHE_KEYS.userPositions(payload.sellerId)],
  TradeSettled:      (payload) => [CACHE_KEYS.marketListings('*'), CACHE_KEYS.marketStats(), CACHE_KEYS.userTrades(payload.buyerId), CACHE_KEYS.userTrades(payload.sellerId), CACHE_KEYS.userPositions(payload.buyerId), CACHE_KEYS.userPositions(payload.sellerId)],
  PositionUpdated:   (payload) => [CACHE_KEYS.userPositions(payload.ownerId), CACHE_KEYS.position(payload.positionId)],
  PaymentSettled:    (payload) => [CACHE_KEYS.userPositions(payload.payerId), CACHE_KEYS.userPositions(payload.payeeId)],
};
```

---

## 8. Smart Contract Interface Requirements

### 8.1 Marketplace.sol (Required Functions)
```solidity
// Operator-executed (backend wallet)
function listCreditFor(address seller, uint256 tokenId, uint256 amount, uint256 pricePerUnit, uint256 pricePerUnitINR, uint256 duration) external returns (uint256 listingId);
function cancelListingFor(address seller, uint256 listingId) external;
function settleINRTrade(uint256 listingId, address buyer, uint256 amount, uint256 priceINR, bytes32 tradeId, uint8 payMode, uint256 timestamp) external returns (uint256 recordedTradeId);

// User-executed (MetaMask)
function buyCredit(uint256 listingId, uint256 amount) external payable;
function placeLimitOrder(uint256 tokenId, uint256 amount, uint256 limitPrice, uint8 side, uint256 duration) external payable returns (uint256);
function cancelOrder(uint256 orderId) external;

// Views
function listings(uint256) external view returns (Listing memory);
function getActiveListings() external view returns (Listing[] memory);
function getSellerListings(address seller) external view returns (uint256[] memory);

// Events
event CreditListed(uint256 indexed listingId, address indexed seller, uint256 indexed tokenId, uint256 amount, uint256 pricePerUnit, uint256 pricePerUnitINR);
event CreditTraded(uint256 indexed tradeId, uint256 indexed listingId, uint256 indexed buyOrderId, address buyer, address seller, uint256 tokenId, uint256 amount, uint256 pricePerUnit, uint256 pricePerUnitINR, uint256 totalPrice, uint256 buyerFee, uint256 sellerFee, uint256 totalFee, bool isAMM);
event ListingCancelled(uint256 indexed listingId, address indexed seller);
event INRTradeLogged(bytes32 indexed tradeId, uint256 indexed tokenId, uint256 quantity, uint256 priceINR, uint8 payMode, address buyer, address seller, bytes32 tradeHash, uint256 timestamp);
```

### 8.2 CreditLedger.sol (Required Functions)
```solidity
function logOwnershipChange(bytes32 userId, uint256 tokenId, int256 amountDelta, uint8 actionType, bytes32 refHash, string calldata note) external returns (uint256 logId);
function logRetirement(bytes32 userId, uint256 tokenId, uint256 amount, bytes32 refHash) external returns (uint256 logId);
function getUserBalance(bytes32 userId, uint256 tokenId) external view returns (uint256);
function getUserRetired(bytes32 userId, uint256 tokenId) external view returns (uint256);
function computeUserId(string calldata userUuid) external view returns (bytes32);

// Events
event OwnershipLogged(uint256 indexed logId, bytes32 indexed userId, uint256 indexed tokenId, int256 amountDelta, uint8 actionType, bytes32 refHash);
event CreditRetiredLogged(uint256 indexed logId, bytes32 indexed userId, uint256 tokenId, uint256 amount, bytes32 refHash);
```

### 8.3 CarbonCreditToken.sol (Required Functions)
```solidity
function mintCredit(MintParams calldata params) external returns (uint256 tokenId);
function retireCreditFor(address beneficiary, uint256 tokenId, uint256 amount) external;
function balanceOf(address account, uint256 id) external view returns (uint256);
function setApprovalForAll(address operator, bool approved) external;
function isApprovedForAll(address account, address operator) external view returns (bool);
function getCreditMetadata(uint256 tokenId) external view returns (Metadata memory);
function getTotalRetired(uint256 tokenId) external view returns (uint256);
function isExpired(uint256 tokenId) external view returns (bool);

// Events
event CreditMinted(uint256 indexed tokenId, address indexed to, uint256 amount, string projectName, uint8 standard, string serialNumber);
event CreditRetired(uint256 indexed tokenId, address indexed retiredBy, uint256 amount, string projectName);
```

---

## 9. Acceptance Criteria for Phase 2

- [ ] All canonical tables created with constraints, indexes, triggers
- [ ] Compatibility views return identical results to legacy queries
- [ ] Backfill scripts populate positions, listings, trades with 100% accuracy
- [ ] API contracts documented with request/response schemas
- [ ] Service boundaries defined with clear ownership
- [ ] Migration plan has zero-downtime steps and rollback procedures
- [ ] Outbox table and cache invalidation map defined
- [ ] Smart contract interfaces match backend requirements

---

**Next Phase:** Phase 3 — Migration Plan