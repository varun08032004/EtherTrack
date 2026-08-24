# Phase 3: Migration Plan

**Date:** 2026-08-18  
**Status:** Complete

---

## 1. Migration Overview

### 1.1 Strategy: Parallel Run with Feature Flags
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        MIGRATION PHASES                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  PHASE 3A: Schema Deploy          PHASE 3B: Backfill & Validate             │
│  ───────────────────────          ───────────────────────                   │
│  • Add canonical tables           • Backfill ownership_positions            │
│  • Add compatibility views        • Backfill listings                       │
│  • Add outbox table               • Backfill trades                         │
│  • Add triggers, indexes          • Backfill payments/fees                  │
│  • Deploy feature flags           • Validate reconciliation = 0             │
│  • Zero downtime                  • Run parallel read comparison            │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  PHASE 3C: Read Path Switch        PHASE 3D: Write Path Migration           │
│  ───────────────────────          ───────────────────────                   │
│  • Switch GET APIs to v2          • Implement v2 write services             │
│  • Compare responses (legacy=v1)  • Shadow write to both schemas            │
│  • Monitor error rates            • Validate writes match                   │
│  • Gradual rollout (10% → 100%)   • Switch writes to v2                     │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  PHASE 3E: Legacy Removal          PHASE 3F: Contract Upgrade (if needed)   │
│  ───────────────────────          ───────────────────────                   │
│  • Remove v1 read paths           • Deploy upgraded contracts               │
│  • Remove v1 write paths          • Migrate on-chain state                  │
│  • Drop compatibility views       • Verify end-to-end                       │
│  • Drop legacy columns/tables     • Update ABIs                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Success Criteria (Must Pass Before Each Phase Gate)

| Phase Gate | Criteria |
|------------|----------|
| **3A → 3B** | All tables created, indexes built, triggers active, feature flags working |
| **3B → 3C** | **All 7 reconciliation checks = 0 mismatches** (see §4) |
| **3C → 3D** | v2 read APIs return identical data to v1 for 100% of traffic |
| **3D → 3E** | v2 write APIs pass all idempotency, concurrency, failure-injection tests |
| **3E → 3F** | No legacy write path active, zero errors in production for 72h |
| **3F → Done** | Contract upgrade complete, all acceptance criteria met |

---

## 2. Detailed Migration Steps

### 2.1 Phase 3A: Schema Deployment (Day 1-2)

#### 2.1.1 Migration Script: `migrations/20260819000001_canonical_schema.sql`
```sql
-- 1. Create canonical tables (see Phase 2 for full DDL)
--    carbon_assets, ownership_positions, listings, retirements, blockchain_events
--    trades, payments, payment_attempts, credit_transfers, credit_transfer_operations
--    fees, platform_fees, settlement_operations, wallet_transactions, outbox_events

-- 2. Add triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply to all tables with updated_at column
-- (ownership_positions, listings, trades, payments, credit_transfers, fees, platform_fees, settlement_operations)

-- 3. Create compatibility views
--    carbon_batches_compat, ledger_listings_compat, market_listings_compat

-- 4. Create outbox_events table with indexes

-- 5. Add feature flag infrastructure
CREATE TABLE IF NOT EXISTS feature_flags (
    flag_name     VARCHAR(100) PRIMARY KEY,
    enabled       BOOLEAN NOT NULL DEFAULT FALSE,
    rollout_pct   SMALLINT NOT NULL DEFAULT 0 CHECK (rollout_pct BETWEEN 0 AND 100),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO feature_flags (flag_name, enabled, rollout_pct) VALUES
    ('USE_CANONICAL_SCHEMA_READS', FALSE, 0),
    ('USE_CANONICAL_SCHEMA_WRITES', FALSE, 0),
    ('ENABLE_OUTBOX_PUBLISHER', FALSE, 0),
    ('ENABLE_RECONCILIATION_JOBS', FALSE, 0)
ON CONFLICT (flag_name) DO NOTHING;
```

#### 2.1.2 Deployment Checklist
- [ ] Run migration in staging
- [ ] Verify all tables exist with correct constraints
- [ ] Verify compatibility views return data
- [ ] Verify feature flags table seeded
- [ ] Run `pg_dump --schema-only` to capture schema state
- [ ] Deploy to production with **zero-downtime** (migration is additive only)

---

### 2.2 Phase 3B: Backfill & Validation (Day 2-5)

#### 2.2.1 Backfill Scripts (Run in Order, Idempotent)

**Script 1: `scripts/backfill-01-carbon-assets.ts`**
```typescript
// Source: carbon_batches (admin_status='approved') + projects
// Target: carbon_assets
// Key: project_id → asset_id (1:1)
// Idempotent: ON CONFLICT (token_id) DO UPDATE
```

**Script 2: `scripts/backfill-02-ownership-positions.ts`**
```typescript
// Source A: carbon_batches (wallet custody)
//   - owner_id = user_id
//   - asset_id from carbon_assets WHERE token_id = carbon_batches.token_id
//   - custody_type = 'onchain'
//   - owned_quantity = total_credits
//   - reserved_quantity = COALESCE(listed_quantity, 0)

// Source B: credit_ledger_balances (ledger custody)
//   - owner_id = user_id
//   - asset_id from carbon_assets WHERE token_id = credit_ledger_balances.token_id
//   - custody_type = 'ledger'
//   - owned_quantity = balance + total_retired
//   - reserved_quantity = SUM(ledger_listings.amount_remaining WHERE active)

// Merge: ON CONFLICT (owner_id, asset_id, custody_type) DO UPDATE
//   SET owned_quantity = GREATEST(EXCLUDED.owned_quantity, ownership_positions.owned_quantity),
//       reserved_quantity = GREATEST(EXCLUDED.reserved_quantity, ownership_positions.reserved_quantity)
```

**Script 3: `scripts/backfill-03-listings.ts`**
```typescript
// Source A: carbon_batches (on-chain listings)
//   - WHERE listing_id_onchain IS NOT NULL AND listed_quantity > 0
//   - position_id from ownership_positions (owner_id, asset_id, custody_type='onchain')
//   - quantity = listed_quantity
//   - remaining_quantity = listed_quantity
//   - onchain_listing_id = listing_id_onchain

// Source B: ledger_listings (ledger listings)
//   - WHERE active = TRUE
//   - position_id from ownership_positions (owner_id, asset_id, custody_type='ledger')
//   - quantity = amount
//   - remaining_quantity = amount_remaining
//   - onchain_listing_id = NULL
```

**Script 4: `scripts/backfill-04-trades.ts`**
```typescript
// Source: trades (all completed)
//   - Map batch_id → asset_id via carbon_batches → carbon_assets
//   - Determine seller_custody_type from carbon_batches.custody_model
//   - Determine buyer_custody_type: 
//       IF payment_mode IN ('inr','razorpay','direct_razorpay') AND buyer_wallet IS NULL → 'ledger'
//       ELSE 'onchain'
//   - listing_id: 
//       IF listing_id_onchain is numeric → listings WHERE onchain_listing_id = listing_id_onchain
//       ELSE → listings WHERE listing_id = listing_id_onchain::uuid (ledger)
//   - settlement_state mapping:
//       'confirmed' → 'SETTLED'
//       'failed' → 'FAILED'
//       'pending' → 'CREDIT_TRANSFER_SUBMITTED'
//   - idempotency_key = trades.idempotency_key OR 'migrated:' + trades.id
```

**Script 5: `scripts/backfill-05-payments-fees.ts`**
```typescript
// Source: trades (completed) + wallet_transactions + platform_fees (legacy)
//   - Create payments record per trade
//   - payment_mode mapping: 'inr'→'inr_wallet', 'razorpay'→'razorpay', 'direct_razorpay'→'razorpay_transfer', 'eth'→'eth'
//   - status: 'SETTLED' for completed trades
//   - Create fees records (buyer + seller)
//   - Create platform_fees aggregate record
//   - Create wallet_transactions from existing table (reference = idempotency_key)
```

**Script 6: `scripts/backfill-06-credit-transfers.ts`**
```typescript
// Source: trades (completed) + blockchain event logs
//   - For each trade, create credit_transfer
//   - from_custody_type = trade.seller_custody_type
//   - to_custody_type = trade.buyer_custody_type
//   - Create operations:
//       IF both onchain: ESCROW_RELEASE + ERC1155_TRANSFER
//       IF ledger→ledger: LEDGER_SELL + LEDGER_BUY
//       IF cross: appropriate combination
//   - Link blockchain_tx_hash from trades.chain_tx_hash
```

**Script 7: `scripts/backfill-07-retirements.ts`**
```typescript
// Source: retirements (wallet) + credit_ledger_entries (ledger, action_type='RETIRE')
//   - Map to retirements table with custody_type
//   - certificate_id from existing data
//   - blockchain_tx_hash from chain_tx_hash
```

**Script 8: `scripts/backfill-08-blockchain-events.ts`**
```typescript
// Source: registry_transactions + trades.chain_tx_hash + credit_ledger_entries.tx_hash
//   - Deduplicate by (chain_id, contract_address, tx_hash, log_index)
//   - decoded_args from event data
//   - processing_status = 'PROCESSED'
```

#### 2.2.2 Validation Queries (Run After Each Script)

```sql
-- Position Reconciliation
SELECT 'position_mismatch' AS check_type, COUNT(*) AS mismatches
FROM ownership_positions op
JOIN carbon_batches cb ON cb.user_id = op.owner_id
JOIN carbon_assets ca ON ca.project_id = cb.project_id
WHERE op.custody_type = CASE WHEN cb.custody_model = 'pooled' THEN 'ledger' ELSE 'onchain' END
  AND op.owned_quantity != cb.total_credits;

-- Listing Reconciliation
SELECT 'listing_mismatch' AS check_type, COUNT(*) AS mismatches
FROM (
  SELECT l.*, op.reserved_quantity
  FROM listings l
  JOIN ownership_positions op ON op.position_id = l.position_id
  WHERE l.status = 'active'
) x
WHERE x.remaining_quantity != x.reserved_quantity;

-- Trade Reconciliation
SELECT 'trade_financial_mismatch' AS check_type, COUNT(*) AS mismatches
FROM trades t
WHERE t.buyer_gross != t.seller_gross
   OR t.buyer_gross != t.quantity * t.execution_price;

-- Payment Reconciliation
SELECT 'payment_mismatch' AS check_type, COUNT(*) AS mismatches
FROM trades t
JOIN payments p ON p.trade_id = t.trade_id
WHERE p.amount != t.buyer_gross + t.buyer_fee + t.buyer_tax; -- buyerTotalDebit

-- Fee Reconciliation
SELECT 'fee_mismatch' AS check_type, COUNT(*) AS mismatches
FROM trades t
JOIN platform_fees pf ON pf.trade_id = t.trade_id
WHERE pf.total_fee_amount != t.buyer_fee + t.seller_fee;

-- Retirement Reconciliation
SELECT 'retirement_mismatch' AS check_type, COUNT(*) AS mismatches
FROM retirements r
JOIN ownership_positions op ON op.owner_id = r.owner_id AND op.asset_id = r.asset_id AND op.custody_type = r.custody_type
WHERE op.owned_quantity < r.quantity; -- Should have been deducted

-- Blockchain Event Reconciliation
SELECT 'blockchain_event_mismatch' AS check_type, COUNT(*) AS mismatches
FROM (
  SELECT be.*, t.trade_id
  FROM blockchain_events be
  LEFT JOIN trades t ON t.chain_tx_hash = be.tx_hash
  WHERE be.processing_status = 'PROCESSED'
) x
WHERE x.trade_id IS NULL AND x.event_name IN ('CreditTraded', 'INRTradeLogged');
```

#### 2.2.3 Automated Validation Pipeline
```bash
#!/bin/bash
# scripts/validate-backfill.sh

set -e

echo "=== Running Backfill Validation ==="

# Run all 7 reconciliation checks
for check in position listing trade payment fee retirement blockchain_event; do
  echo "Checking $check reconciliation..."
  MISMATCHES=$(psql -t -c "SELECT COUNT(*) FROM validation_${check}_results WHERE mismatches > 0")
  if [ "$MISMATCHES" -gt 0 ]; then
    echo "❌ FAIL: $check has $MISMATCHES mismatches"
    exit 1
  fi
  echo "✅ PASS: $check = 0 mismatches"
done

echo "=== All 7 Reconciliation Checks Passed ==="
```

---

### 2.3 Phase 3C: Read Path Switch (Day 5-8)

#### 2.3.1 API Versioning Strategy
```typescript
// Middleware: routes based on feature flag
app.use('/api/v2/*', (req, res, next) => {
  const flag = await getFeatureFlag('USE_CANONICAL_SCHEMA_READS');
  if (!flag.enabled || Math.random() * 100 > flag.rollout_pct) {
    return res.setHeader('X-API-Version', 'v1-legacy');
  }
  return res.setHeader('X-API-Version', 'v2-canonical');
});

// Legacy routes remain at /api/* (v1)
// New routes at /api/v2/* (v2)
```

#### 2.3.2 Shadow Comparison (Automated)
```typescript
// Shadow comparison middleware (runs on 100% traffic, logs only)
app.use('/api/v2/market/listings', async (req, res, next) => {
  const v2Response = await getCanonicalListings(req.query);
  const v1Response = await getLegacyListings(req.query);
  
  const diff = deepDiff(v1Response, v2Response);
  if (diff) {
    await logComparisonDiff({
      endpoint: '/api/market/listings',
      query: req.query,
      v1: v1Response,
      v2: v2Response,
      diff
    });
  }
  
  return res.json(v2Response); // Serve v2
});
```

#### 2.3.3 Rollout Schedule
| Day | Rollout % | Action |
|-----|-----------|--------|
| 5   | 10%       | Enable for internal users |
| 6   | 25%       | Enable for beta users |
| 7   | 50%       | Enable for 50% traffic |
| 8   | 100%      | Full rollout, monitor 4h |

#### 2.3.4 Rollback Trigger
```sql
-- Immediate rollback if:
-- 1. Error rate > 1% on v2 endpoints
-- 2. Data mismatch rate > 0.1% in shadow comparison
-- 3. P99 latency increase > 2x

UPDATE feature_flags SET enabled = FALSE, rollout_pct = 0 
WHERE flag_name = 'USE_CANONICAL_SCHEMA_READS';
```

---

### 2.4 Phase 3D: Write Path Migration (Day 8-15)

#### 2.4.1 New Write Services (Implement in Parallel)
| Service | New Methods | Legacy Equivalent |
|---------|-------------|-------------------|
| `ListingService` | `createListing()`, `cancelListing()` | `operator-trading.js:/list-credit*`, `/delist-credit*` |
| `TradeService` | `createTradeFromQuote()`, `settleTrade()` | `trades.js:/record`, `/checkout-verify` |
| `PaymentService` | `authorizePayment()`, `verifyPayment()` | `trades.js:/checkout-order`, `/checkout-verify` |
| `CreditTransferService` | `executeTransfer()`, `confirmOperation()` | `blockchain.js` handlers + `creditLedger.js` |
| `FeeService` | `calculateFees()`, `collectFees()` | `trades.js:calcFees()`, `operator-trading.js:calcLedgerFees()` |

#### 2.4.2 Shadow Write Pattern
```typescript
// Every v2 write also writes to legacy tables (dual-write)
class TradeServiceV2 {
  async createTrade(input: CreateTradeInput): Promise<Trade> {
    // 1. Validate using canonical tables
    const trade = await this.validateAndCreateCanonical(input);
    
    // 2. Dual-write to legacy tables (async, non-blocking)
    this.writeToLegacy(trade).catch(err => {
      logger.error('Legacy dual-write failed', { tradeId: trade.tradeId, error: err });
      alertOnCall('LEGACY_DUAL_WRITE_FAILED');
    });
    
    // 3. Publish outbox events
    await this.publishOutboxEvents(trade);
    
    return trade;
  }
}
```

#### 2.4.3 Write Migration Checklist
- [ ] All v2 write services implemented with unit tests
- [ ] Shadow dual-write running for 48h with zero data mismatches
- [ ] Concurrency tests pass (simultaneous buyers, seller cancel, expiry)
- [ ] Failure-injection tests pass (RPC timeout, revert, payment timeout, DB failure)
- [ ] Feature flag `USE_CANONICAL_SCHEMA_WRITES` at 100%
- [ ] Legacy write paths return 410 Gone

---

### 2.5 Phase 3E: Legacy Removal (Day 15-18)

#### 2.5.1 Removal Order
```sql
-- 1. Disable legacy API routes (return 410)
-- 2. Drop compatibility views
DROP VIEW carbon_batches_compat;
DROP VIEW ledger_listings_compat;
DROP VIEW market_listings_compat;

-- 3. Remove legacy columns from carbon_batches
ALTER TABLE carbon_batches 
  DROP COLUMN IF EXISTS listed_quantity,
  DROP COLUMN IF EXISTS listing_id_onchain,
  DROP COLUMN IF EXISTS price_per_credit_inr,
  DROP COLUMN IF EXISTS last_traded_price_inr;

-- 4. Drop legacy tables (after 72h verification)
DROP TABLE IF EXISTS ledger_listings;
DROP TABLE IF EXISTS market_listings; -- if exists
DROP TABLE IF EXISTS buy_orders;
DROP TABLE IF EXISTS razorpay_checkout_orders; -- migrate to payments first
DROP TABLE IF EXISTS pending_seller_credits;

-- 5. Remove legacy routes from server.js
--    /api/trades/record, /checkout-order, /checkout-verify
--    /api/portfolio/list-credit, /delist-credit, /list-credit-ledger, etc.
--    /api/market/listings (v1), /buy-orders, /trade-history
```

#### 2.5.2 Data Preservation
```sql
-- Archive legacy data before dropping
CREATE TABLE legacy_carbon_batches_archive AS SELECT * FROM carbon_batches;
CREATE TABLE legacy_ledger_listings_archive AS SELECT * FROM ledger_listings;
CREATE TABLE legacy_trades_archive AS SELECT * FROM trades;
-- Keep for 1 year for audit/compliance
```

---

### 2.6 Phase 3F: Contract Upgrade (If Required)

#### 2.6.1 Required Contract Changes
| Current Limitation | Required Upgrade |
|-------------------|------------------|
| `listCreditFor` only supports single listing per seller/token | Support multiple concurrent listings per token |
| `settleINRTrade` doesn't emit buyer/seller fee breakdown | Add fee fields to `INRTradeLogged` event |
| `CreditLedger.sol` no atomic transfer | Add `transferOwnership(userId from, userId to, tokenId, amount, refHash)` |
| No cross-custody settlement primitives | Add `settleCrossCustodyTrade(...)` |

#### 2.6.2 Upgrade Procedure
```bash
# 1. Deploy new contracts to testnet
# 2. Run full integration test suite against new contracts
# 3. Deploy to mainnet (proxy upgrade pattern)
# 4. Update contract addresses in .env
# 5. Update ABIs in services/minter.js, creditLedger.js, blockchain.js
# 6. Update frontend contracts.config.js
# 7. Run smoke tests
# 8. Monitor for 24h
```

---

## 3. Rollback Procedures

### 3.1 Phase 3A Rollback (Schema Deploy)
```bash
# If migration fails:
pg_restore --clean --if-exists -d ethertrack pre-migration-schema.dump
# Feature flags remain disabled, no user impact
```

### 3.2 Phase 3B Rollback (Backfill)
```bash
# Truncate canonical tables, keep legacy intact
TRUNCATE ownership_positions, listings, trades, payments, 
         credit_transfers, fees, platform_fees, settlement_operations,
         credit_transfer_operations, blockchain_events RESTART IDENTITY CASCADE;
# Re-run backfill scripts after fixing issues
```

### 3.3 Phase 3C Rollback (Read Switch)
```bash
# Instant: disable feature flag
UPDATE feature_flags SET enabled = FALSE, rollout_pct = 0 
WHERE flag_name = 'USE_CANONICAL_SCHEMA_READS';
# All traffic routes to v1 legacy within 1s (flag cached in memory)
```

### 3.4 Phase 3D Rollback (Write Switch)
```bash
# 1. Disable write feature flag
UPDATE feature_flags SET enabled = FALSE, rollout_pct = 0 
WHERE flag_name = 'USE_CANONICAL_SCHEMA_WRITES';

# 2. Wait for in-flight v2 writes to complete (max 30s)

# 3. If dual-write caused data divergence:
#    Run reconciliation repair from canonical → legacy
```

### 3.5 Phase 3E Rollback (Legacy Removal)
```bash
# Restore from archive tables
INSERT INTO carbon_batches (SELECT * FROM legacy_carbon_batches_archive 
   ON CONFLICT (id) DO UPDATE SET ...);
INSERT INTO ledger_listings (SELECT * FROM legacy_ledger_listings_archive ...);
# Re-enable legacy API routes
```

---

## 4. Reconciliation Validation Gates

### 4.1 Gate 1: Post-Backfill (Phase 3B → 3C)
```bash
# Must pass ALL 7 checks with 0 mismatches
./scripts/validate-backfill.sh
# Output:
# ✅ PASS: position = 0 mismatches
# ✅ PASS: listing = 0 mismatches
# ✅ PASS: trade = 0 mismatches
# ✅ PASS: payment = 0 mismatches
# ✅ PASS: fee = 0 mismatches
# ✅ PASS: retirement = 0 mismatches
# ✅ PASS: blockchain_event = 0 mismatches
```

### 4.2 Gate 2: Post-Read-Switch (Phase 3C → 3D)
```bash
# Shadow comparison mismatch rate < 0.1%
# Error rate on v2 endpoints < 0.1%
# P99 latency v2 <= 1.5x v1
```

### 4.3 Gate 3: Post-Write-Switch (Phase 3D → 3E)
```bash
# All test suites pass:
# - Unit tests: 100% pass
# - Integration tests: 100% pass
# - Concurrency tests: 100% pass (1000 iterations each)
# - Failure-injection tests: 100% pass
# - End-to-end settlement test: PASS
```

### 4.4 Gate 4: Post-Legacy-Removal (Phase 3E → 3F)
```bash
# 72h production monitoring:
# - Zero errors on canonical APIs
# - Zero reconciliation alerts
# - All acceptance criteria verified
```

---

## 5. Timeline & Resources

| Phase | Duration | Team | Dependencies |
|-------|----------|------|--------------|
| 3A: Schema Deploy | 2 days | 1 DBA + 1 Backend | None |
| 3B: Backfill & Validate | 4 days | 2 Backend | 3A complete |
| 3C: Read Path Switch | 4 days | 2 Backend + 1 Frontend | 3B gates pass |
| 3D: Write Path Migration | 7 days | 3 Backend | 3C gates pass |
| 3E: Legacy Removal | 4 days | 1 Backend + 1 DBA | 3D gates pass |
| 3F: Contract Upgrade | 5 days | 1 Smart Contract + 1 Backend | 3E gates pass |
| **Total** | **26 days** | **4-5 engineers** | Sequential |

---

## 6. Monitoring & Alerting During Migration

### 6.1 Key Metrics
| Metric | Normal | Alert Threshold |
|--------|--------|-----------------|
| Reconciliation mismatches | 0 | > 0 |
| API error rate (v2) | < 0.1% | > 1% |
| Shadow comparison diff rate | 0% | > 0.1% |
| P99 latency (v2 vs v1) | ~1x | > 1.5x |
| Dual-write failure rate | 0% | > 0% |
| Outbox publish lag | < 1s | > 10s |

### 6.2 Dashboards
- **Migration Overview**: Phase status, gate results, mismatch counts
- **Data Quality**: 7 reconciliation checks trend
- **API Health**: v1 vs v2 error rates, latency, throughput
- **Write Path**: Dual-write success, shadow write validation

---

## 7. Communication Plan

| Audience | Channel | Frequency | Content |
|----------|---------|-----------|---------|
| Engineering | Slack #migration | Daily standup | Phase status, blockers, gate results |
| Product | Email | Weekly | Timeline, user impact, feature flags |
| Support | Slack #support-escalation | On gate change | Known issues, rollback status |
| Leadership | Email | Bi-weekly | Progress, risks, go/no-go decisions |

---

**Next Phase:** Phase 4 — Implementation