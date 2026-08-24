# EtherTrack Architecture Discovery Report

**Date:** 2026-08-18  
**Phase:** 0 — Architecture Discovery  
**Status:** Complete

---

## 1. Current Custody Flows

### 1.1 Wallet-Based (On-Chain) Custody

```
Minting → Listing → Buying → Settlement → Retirement
   │         │         │           │            │
   ▼         ▼         ▼           ▼            ▼
minter.js  operator-  trades.js   blockchain.js  retirementApproval.js
           trading.js  (checkout)  (event sync)
           listCredit
           ForOnChain
```

**Key Components:**
- **Minting:** `services/minter.js:mintApprovedCredit()` — mints to custody wallet, logs to CreditLedger for pooled custody
- **KYC:** `services/minter.js:verifyKYCOnChain()` — identity-keyed (userIdHash), optional wallet linking
- **Listing:** `routes/operator-trading.js:/list-credit` → `services/minter.js:listCreditForOnChain()` → Marketplace.sol `listCreditFor()`
- **Buying (INR/Razorpay):** `routes/trades.js:/checkout-order` → `/checkout-verify` → `services/minter.js:settleINRTradeOnChain()` → Marketplace.sol `settleINRTrade()`
- **Buying (ETH):** Frontend calls Marketplace.sol `buyCredit()` directly via `useMarket.js:buyCredit()`
- **Settlement:** `services/blockchain.js` event listeners (`CreditTraded`, `CreditListed`, `ListingCancelled`, `CreditRetired`) sync to DB
- **Retirement:** `routes/retirementApproval.js:approveRetirement()` (admin approval required) → `services/minter.js:retireCreditForOnChain()` → CarbonCreditToken `retireCreditFor()`

**Smart Contracts:**
- `Marketplace.sol` — listing, buying, cancellation, INR settlement, escrow
- `CarbonCreditToken.sol` — minting, retirement, balances, operator functions
- `KYCRegistry.sol` — identity-keyed KYC, wallet linking
- `CreditLedger.sol` — ownership logging for pooled custody users

---

### 1.2 Pooled/Ledger Custody (Wallet-Free)

```
Minting → Ledger Listing → Ledger Buying → Ledger Settlement → Ledger Retirement
   │           │                │                 │                  │
   ▼           ▼                ▼                 ▼                  ▼
minter.js  operator-      operator-         operator-          operator-
           trading.js     trading.js        trading.js         trading.js
           /list-credit-  /ledger-          /ledger-           /retire-credit-
           ledger         checkout-order    checkout-verify    ledger
                                                           ↓
                                                   creditLedger.js
                                                   logRetirementOnChain
```

**Key Components:**
- **Minting:** Same `mintApprovedCredit()` — all credits mint to custody wallet, ownership logged to CreditLedger via `logOwnershipChangeOnChain()` (actionType: MINT)
- **Listing:** `routes/operator-trading.js:/list-credit-ledger` — creates `ledger_listings` row, validates ledger balance, checks `verifyLedgerBalance()`
- **Buying:** `routes/operator-trading.js:/ledger-checkout-order` → `/ledger-checkout-verify` — Razorpay order, then `transferLedgerOwnership()` (CRITICAL: non-atomic SELL then BUY)
- **Settlement:** `creditLedger.js:transferLedgerOwnership()` — two separate blockchain transactions (SELL debit seller, BUY credit buyer)
- **Retirement:** `routes/operator-trading.js:/retire-credit-ledger` → `creditLedger.js:logRetirementOnChain()` — no admin approval

**Critical Flaw:** `transferLedgerOwnership()` executes SELL then BUY as **two independent transactions**. If BUY fails after SELL succeeds, seller is debited but buyer not credited — requires manual reconciliation.

---

## 2. Current Listing Flows

### 2.1 Wallet Listings (On-Chain)
- **Table:** `carbon_batches` with columns: `listing_id_onchain`, `listed_quantity`, `price_per_credit_inr`, `available_credits`
- **Contract:** Marketplace.sol `listings` mapping
- **Creation:** `operator-trading.js:/list-credit` → `minter.js:listCreditForOnChain()` → Marketplace.sol `listCreditFor()`
- **Cancellation:** `operator-trading.js:/delist-credit` → `minter.js:cancelListingForOnChain()` → Marketplace.sol `cancelListingFor()`
- **Sync:** `services/blockchain.js:handleCreditListed()`, `handleListingCancelled()` update `carbon_batches.listed_quantity`

### 2.2 Ledger Listings (Pooled Custody)
- **Table:** `ledger_listings` — `id`, `seller_id`, `token_id`, `batch_id`, `amount`, `amount_remaining`, `price_per_credit_inr`, `expires_at`, `active`
- **Creation:** `operator-trading.js:/list-credit-ledger` — INSERT into `ledger_listings`
- **Cancellation:** `operator-trading.js:/delist-credit-ledger` — UPDATE `active = FALSE`
- **No on-chain escrow** — credits stay in pooled custody, only DB listing created

### 2.3 Market Aggregation
- **Service:** `services/cacheStrategy.js:getMarketListings()` (TTL: 15s)
- **Query:** UNION of wallet listings (from `carbon_batches` WHERE `listing_id_onchain IS NOT NULL`) + ledger listings (from `ledger_listings` WHERE `active = TRUE`)
- **Frontend:** `CarbonCredits.js` consumes via `useMarket.js` hook → `/api/market/listings`

---

## 3. Current Settlement Flows

### 3.1 On-Chain (Wallet) Settlement

| Payment Mode | Flow |
|-------------|------|
| **INR Wallet** | `trades.js:/record` — atomic DB transaction: debit buyer, credit seller, credit platform, update batch |
| **Razorpay (Direct)** | `trades.js:/checkout-order` → `/checkout-verify` — Razorpay order → verify signature → `settleINRTradeOnChain()` → Marketplace.sol `settleINRTrade()` |
| **ETH (MetaMask)** | Frontend `useMarket.js:buyCredit()` → Marketplace.sol `buyCredit()` → event listener `handleCreditTraded()` |

**Fee Calculation:** `trades.js:calcFees()` — 100 bps (0.5% each side) + 18% GST

**Seller Payment (ETH path):** `blockchain.js:handleCreditTraded()` credits seller INR balance (~99.5% of price)

### 3.2 Ledger (Pooled) Settlement

| Payment Mode | Flow |
|-------------|------|
| **Razorpay (Ledger)** | `operator-trading.js:/ledger-checkout-order` → `/ledger-checkout-verify` — Razorpay order → verify → `transferLedgerOwnership()` (2 TXs) |
| **INR Wallet (Ledger)** | Not implemented — ledger buyers must use Razorpay |

**Fee Calculation:** Same `calcFees()` logic duplicated in `operator-trading.js:calcLedgerFees()`

### 3.3 Critical Settlement Issues

1. **Non-atomic ledger transfer** — `transferLedgerOwnership()` does SELL then BUY as separate TXs
2. **No cross-custody trading** — wallet seller ↔ ledger buyer not supported
3. **Duplicate fee logic** — `calcFees()` in trades.js, `calcLedgerFees()` in operator-trading.js
4. **Event-driven sync only** — `blockchain.js` listeners update DB; no outbox pattern for reliability
5. **Payment ↔ chain state gap** — `trades.chain_status` can be 'pending'/'confirmed'/'failed' but no durable state machine

---

## 4. Current Retirement Flows

### 4.1 Wallet Retirement (Admin Approval Required)
```
User requests retirement
        │
        ▼
routes/retirementApproval.js:approveRetirement()  (serializable transaction)
        │
        ├── Lock retirement_request row (FOR UPDATE)
        ├── Check serial not already retired (unique constraint)
        ├── Insert into `retirements` table
        ├── Update retirement_request status = 'approved'
        ├── Deduct from carbon_batches.available_credits
        ├── Audit log
        └── minter.js:retireCreditForOnChain() → CarbonCreditToken.retireCreditFor()
```

### 4.2 Ledger Retirement (Self-Service, No Approval)
```
User calls /retire-credit-ledger
        │
        ▼
creditLedger.js:logRetirementOnChain()
        │
        ├── Log RETIRE action to CreditLedger.sol
        ├── Update credit_ledger_balances (balance - amount, total_retired + amount)
        ├── Insert credit_ledger_entries (action_type = 'RETIRE')
        └── certificates.js:issueRetirementCertificate()
```

### 4.3 Retirement Issues
- **Two separate tables:** `retirements` (wallet) vs `credit_ledger_entries` (ledger, action_type='RETIRE')
- **Different approval models:** wallet requires admin, ledger is self-service
- **Double-retirement risk:** Same serial could be retired in both systems (unique constraint only per-table)
- **Certificate format:** Both use `CERT-<tokenId>-<random>` but from different code paths

---

## 5. Relevant Solidity Contracts

| Contract | Address Env Var | Key Functions Used |
|----------|-----------------|-------------------|
| **Marketplace** | `MARKETPLACE_ADDRESS` | `listCreditFor`, `cancelListingFor`, `settleINRTrade`, `buyCredit`, `placeLimitOrder`, `listings`, `orders` |
| **CarbonCreditToken** | `CARBON_CREDIT_TOKEN_ADDRESS` | `mintCredit`, `retireCreditFor`, `balanceOf`, `setOperator`, `serialRegistered`, `getCreditMetadata` |
| **KYCRegistry** | `KYC_REGISTRY_ADDRESS` | `isKYCVerified`, `isKYCVerifiedById`, `verifyKYC`, `linkWallet`, `userToWallet` |
| **CreditLedger** | `CREDIT_LEDGER_ADDRESS` | `logOwnershipChange`, `logRetirement`, `getUserBalance`, `getUserRetired`, `computeUserId` |

**ABIs:** Defined inline in `services/minter.js`, `services/creditLedger.js`, `services/blockchain.js`, and `ethertrack-frontend/src/config/contracts.config.js`

**Deployment:** `scripts/setup-operator.js` configures minter as operator on CarbonCreditToken and signerWallet on Marketplace

---

## 6. Relevant Database Tables

### 6.1 Core Tables (from migrations)
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `carbon_batches` | Credit batches (both custody types) | `id`, `user_id`, `token_id`, `listing_id_onchain`, `listed_quantity`, `available_credits`, `custody_model`, `status`, `admin_status` |
| `ledger_listings` | Pooled custody listings | `id`, `seller_id`, `token_id`, `batch_id`, `amount`, `amount_remaining`, `price_per_credit_inr`, `expires_at`, `active` |
| `trades` | All settled trades | `id`, `buyer_id`, `seller_id`, `batch_id`, `token_id`, `listing_id_onchain`, `quantity`, `price_per_credit_inr`, `payment_mode`, `chain_status`, `idempotency_key` |
| `wallet_transactions` | INR ledger | `id`, `user_id`, `type`, `method`, `amount`, `status`, `reference`, `trade_id` |
| `credit_ledger_entries` | Pooled custody audit trail | `id`, `user_id`, `user_id_hash`, `token_id`, `amount_delta`, `action_type`, `ref_hash`, `tx_hash`, `chain_status` |
| `credit_ledger_balances` | Pooled custody balances | `user_id`, `token_id`, `balance`, `total_retired` |
| `retirements` | Wallet retirement records | `id`, `batch_id`, `token_id`, `serial_number`, `amount`, `certificate_id`, `retired_by`, `status` |
| `buy_orders` | On-chain limit orders | `id`, `buyer_id`, `token_id`, `amount`, `limit_price`, `status`, `eth_escrowed` |
| `platform_fees` | Fee accounting | `id`, `trade_id`, `buyer_fee_inr`, `seller_fee_inr`, `total_fee_inr`, `gst_inr` |
| `pending_chain_logs` | Retry queue for chain logs | `id`, `trade_id`, `payload`, `attempts`, `next_retry_at` |
| `certificates` | Ownership + retirement certs | `cert_id`, `cert_type`, `user_id`, `trade_id`, `token_id`, `quantity`, `custody_model`, `tx_hash` |

### 6.2 Referenced but Missing Tables
| Table | Referenced In | Status |
|-------|---------------|--------|
| `market_listings` | `trades.js:249-253`, `blockchain.js:247` | **NOT IN MIGRATIONS** — likely legacy name for `carbon_batches` listings |
| `market_listings` (view?) | `cacheStrategy.js:273` queries `carbon_batches` directly | No separate table exists |

### 6.3 Schema Drift Issues
1. `market_listings` referenced in 3+ files but not created in any migration
2. `ledger_listings` unique constraint `idx_ledger_listings_unique_active` on `(seller_id, token_id)` only — doesn't prevent multiple listings with different `batch_id`
3. `carbon_batches.listed_quantity` is single column — cannot track multiple concurrent on-chain listings per batch
4. `buy_orders` has no RLS policies defined in migrations
5. `registry_transactions` referenced but migration status unclear

---

## 7. APIs & Frontend Consumers

### 7.1 Backend Routes
| Route Prefix | File | Key Endpoints |
|-------------|------|---------------|
| `/api/market` | `routes/market.js` | `GET /listings`, `/stats`, `/buy-orders`, `/trade-history`, `/eth-inr` |
| `/api/portfolio` | `routes/portfolio.js` | `POST /submit-credit`, `/confirm-listing`, `/confirm-delisting`, `GET /my-credits`, `/my-bought-credits`, `/my-ledger-credits` |
| `/api/trades` | `routes/trades.js` | `POST /record`, `/checkout-order`, `/checkout-verify`, `GET /history`, `/stats` |
| `/api/portfolio` (operator) | `routes/operator-trading.js` | `POST /list-credit`, `/delist-credit`, `/list-credit-ledger`, `/delist-credit-ledger`, `/retire-credit-ledger`, `/ledger-checkout-order`, `/ledger-checkout-verify` |
| `/api/org` | `routes/org.js` + `retirementApproval.js` | `POST /:orgId/retirement-queue/:id/approve`, `/reject` |

### 7.2 Frontend Hooks
| Hook | File | Consumes |
|------|------|----------|
| `useMarket` | `hooks/useMarket.js` | `/api/market/listings`, `/buy-orders`, `/trade-history`, `/stats`, `/eth-inr` |
| `usePortfolio` | `hooks/usePortfolio.js` | `/api/portfolio/my-credits`, `/my-bought-credits`, `/my-ledger-credits`, `/kyc-status` |
| `useContracts` | `hooks/useContracts.js` | MetaMask RPC calls to Marketplace.sol, CarbonCreditToken.sol |

### 7.3 Key Frontend Components
- `CarbonCredits.js` — Main marketplace UI (5000+ lines), consumes `useMarket`, `usePortfolio`, direct API calls
- `Portfolio.js` — User portfolio, lists credits from both custody types
- `TradingHistory.js` — Trade history from `/api/trades/history`

### 7.4 Data Contracts (Frontend ↔ Backend)
**Listing Object (from `/api/market/listings`):**
```javascript
{
  listingId, tokenId, projectName, standard, projectType, vintageYear,
  amount, pricePerUnitINR, seller, listingType ('wallet'|'ledger'),
  expiresAt, adjPrice, vintageDiscount, totalRetired
}
```

**Trade Object (from `/api/trades/history`):**
```javascript
{
  id, quantity, pricePerCreditINR, buyerPaysINR, sellerGetsINR,
  paymentMode, chainStatus, txHash, ownershipCertId, type ('Buy'|'Sell')
}
```

---

## 8. Cron Jobs & Background Workers

### 8.1 Scheduled Jobs (`cron/jobs.js`)
| Job | Schedule | Purpose |
|-----|----------|---------|
| `listingExpiryCleanup` | Every 5 min | Deactivate expired listings, return credits to `carbon_batches.available_credits` |
| `kycExpiryCheck` | Daily | Suspend trading for expired KYC, notify users |
| `reconcileCreditLedger` | Hourly | Compare `credit_ledger_balances` vs on-chain `CreditLedger.sol` |
| `processPendingChainLogs` | Every 2 min | Retry failed blockchain log submissions |
| `cleanupOldData` | Daily | Archive old notifications, audit logs |

### 8.2 Blockchain Event Listener (`services/blockchain.js`)
- **Polling:** Every 15s (or WebSocket if `USE_WS_SUBSCRIPTION=true`)
- **Events:** `CreditMinted`, `CreditListed`, `CreditTraded`, `ListingCancelled`, `CreditRetired`
- **Sync:** Background sync from last saved block on startup (capped to 2000 blocks)
- **Handlers:** Update `carbon_batches` (available_credits, listed_quantity, listing_id_onchain), `users` (inr_balance), `registry_transactions`, `trades`

### 8.3 Issues
- **Cache invalidation:** `cacheStrategy.js:invalidateEntity()` only logs, doesn't delete Redis keys (lines 144-147)
- **No outbox pattern:** DB commits and event emissions not atomic
- **Lock without TTL:** `listingExpiryCleanup` uses `pg_advisory_lock` with no timeout
- **Notification in transaction:** Email sending inside DB transaction (line 357-365 in cron)

---

## 9. Redis/Cache Logic

### 9.1 Cache Strategy (`services/cacheStrategy.js`)
| Key Pattern | TTL | Source |
|-------------|-----|--------|
| `market:listings:*` | 15s | `getMarketListings()` — UNION query |
| `market:stats` | 30s | `getMarketStats()` — aggregated counts |
| `portfolio:credits:{userId}:*` | 60s | `getOrSet` with version key |
| `portfolio:bought:{userId}` | 60s | Cached query |
| `wallet:balance:{userId}` | 10s | User INR balance |
| `price:eth:inr` | 60s | CoinGecko API |

### 9.2 Critical Cache Issues
1. **`invalidateEntity()` is a no-op** — logs patterns but doesn't call `del()` or `delPattern()` (lines 144-147, 189-229)
2. **TTL-only invalidation** — 15s TTL for market listings means stale data visible to buyers
3. **No event-driven invalidation** — trade completion doesn't invalidate `market:listings:*`
4. **Version key for portfolio** — `incrementPortfolioVersion()` used but market listings lack versioning

---

## 10. Payment Integrations

### 10.1 Razorpay
- **Order Creation:** `trades.js:/checkout-order`, `operator-trading.js:/ledger-checkout-order`
- **Verification:** `trades.js:/checkout-verify`, `operator-trading.js:/ledger-checkout-verify` — HMAC-SHA256 signature verification
- **Transfers:** Seller payout via Razorpay `transfers` API (on_hold: 0)
- **Circuit Breaker:** `lib/circuitBreaker.js` — 5 failures → open, 2 successes → close

### 10.2 INR Wallet
- **Balance:** `users.inr_balance`, `users.inr_balance_locked`
- **Operations:** Debit/credit in `trades.js:/record` and `/checkout-verify` with `FOR UPDATE` locks
- **Transactions:** `wallet_transactions` table with `reference` unique constraint

### 10.3 ETH/MetaMask
- **Direct:** Frontend calls `Marketplace.sol.buyCredit()` with `value` = price + fee
- **Settlement:** Event listener `handleCreditTraded()` credits seller INR (~99.5% of price)

---

## 11. Blockchain Event Listeners

### 11.1 Services/blockchain.js
```javascript
// Polling loop (15s interval)
pollEvents() → queryFilterChunked() → handleCreditMinted/Listed/Traded/Cancelled/Retired

// Chunked getLogs (2000 blocks/chunk, 200ms delay)
// Background sync on startup (capped to 2000 blocks lookback)
// WebSocket fallback if USE_WS_SUBSCRIPTION=true
```

### 11.2 Event Handlers
| Event | Handler | DB Updates |
|-------|---------|------------|
| `CreditMinted` | `handleCreditMinted` | `carbon_batches.token_id`, `status='tokenised'`, `registry_transactions` |
| `CreditListed` | `handleCreditListed` | `carbon_batches.listing_id_onchain`, `listed_quantity`, `price_per_credit_inr` |
| `CreditTraded` | `handleCreditTraded` | `carbon_batches.available_credits--`, `listed_quantity--`, `users.inr_balance` (seller), `trades`, `registry_transactions` |
| `ListingCancelled` | `handleListingCancelled` | `carbon_batches.listing_id_onchain=NULL`, `listed_quantity=0` |
| `CreditRetired` | `handleCreditRetired` | `carbon_batches.retired_credits++`, `available_credits--`, `projects.retired_credits++` |

### 11.3 Issues
- **No idempotency key on events** — relies on `tx_hash` unique constraint in `trades` and `registry_transactions`
- **No outbox** — if handler crashes after DB commit, event lost
- **Reorg handling:** None — assumes finality after 1 confirmation
- **Sync gap:** `CreditTraded` sync added recently (lines 311-330) but wasn't replayed historically

---

## 12. Dependency Map

```
┌─────────────────┐     ┌──────────────────┐     ┌────────────────────┐
│   Frontend      │────▶│   Backend API    │────▶│   Database         │
│  (React)        │     │  (Express)       │     │  (PostgreSQL)      │
└─────────────────┘     └────────┬─────────┘     └────────────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         ▼                       ▼                       ▼
┌─────────────────┐     ┌──────────────────┐     ┌────────────────────┐
│  Blockchain     │     │  Payment         │     │  Redis Cache       │
│  (Ethers.js)    │     │  (Razorpay)      │     │  (Upstash)         │
└────────┬────────┘     └──────────────────┘     └────────────────────┘
         │
    ┌────┴────┐
    ▼         ▼
Marketplace.sol  CarbonCreditToken.sol  KYCRegistry.sol  CreditLedger.sol
```

### Service → Service Dependencies
```
minter.js ──────▶ creditLedger.js (logOwnershipChangeOnChain for MINT)
operator-trading.js ──────▶ minter.js (listCreditForOnChain, cancelListingForOnChain, settleINRTradeOnChain)
operator-trading.js ──────▶ creditLedger.js (getLedgerBalance, verifyLedgerBalance, logRetirementOnChain, transferLedgerOwnership)
trades.js ──────▶ minter.js (settleINRTradeOnChain)
trades.js ──────▶ certificates.js (issueOwnershipCertificate)
blockchain.js ──────▶ (direct DB queries, no service layer)
cacheStrategy.js ──────▶ (direct DB queries)
retirementApproval.js ──────▶ (direct DB queries, uses withTransaction)
```

---

## 13. Critical Invariants: Enforced vs Missing

### 13.1 Currently Enforced (DB Constraints)
| Invariant | Enforcement |
|-----------|-------------|
| `carbon_batches.listed_quantity >= 0` | CHECK constraint |
| `carbon_batches.available_credits >= listed_quantity` | CHECK constraint |
| `credit_ledger_balances.balance >= 0` | CHECK constraint |
| `credit_ledger_balances.total_retired >= 0` | CHECK constraint |
| `wallet_transactions.amount > 0` | CHECK constraint |
| `trades.quantity > 0` | CHECK constraint |
| `retirements.serial_number` unique | UNIQUE constraint |
| `platform_fees.trade_id` unique | UNIQUE constraint |
| `pending_chain_logs.trade_id` unique | UNIQUE constraint |

### 13.2 Missing / Weakly Enforced
| Invariant | Status |
|-----------|--------|
| `sum(active ledger_listings.amount_remaining) <= credit_ledger_balances.balance` | Application-level only (race condition possible) |
| `ledger_listings` unique active per seller+token | Partial index `idx_ledger_listings_unique_active` but only on `(seller_id, token_id)` |
| No double-retirement across `retirements` + `credit_ledger_entries` | NOT enforced |
| `transferLedgerOwnership` atomicity | NOT enforced — two separate TXs |
| Cross-custody ownership consistency | NOT enforced |
| Market listing quantity = actual escrowed/available | NOT enforced (stale cache, dual tables) |
| Buyer payment ↔ credit transfer atomicity | NOT enforced — separate systems |
| Fee calculation consistency | Duplicated logic in 2 files |

---

## 14. File Inventory by Flow

### 14.1 Wallet Custody Flow
| File | Role |
|------|------|
| `services/minter.js` | Mint, KYC, listCreditForOnChain, cancelListingForOnChain, settleINRTradeOnChain, retireCreditForOnChain |
| `routes/operator-trading.js` | `/list-credit`, `/delist-credit` (wallet) |
| `routes/trades.js` | `/record`, `/checkout-order`, `/checkout-verify` (INR/Razorpay/ETH settlement) |
| `services/blockchain.js` | Event listeners sync on-chain state to DB |
| `hooks/useMarket.js` | Frontend: buyCredit (ETH), fetch listings/orders/history |
| `hooks/usePortfolio.js` | Frontend: listCredit, delistCredit, retireCredit (wallet) |
| `CarbonCredits.js` | Marketplace UI |

### 14.2 Ledger Custody Flow
| File | Role |
|------|------|
| `services/minter.js` | Mint + logOwnershipChangeOnChain (MINT action) |
| `services/creditLedger.js` | logOwnershipChangeOnChain, logRetirementOnChain, transferLedgerOwnership, getLedgerBalance, verifyLedgerBalance, reconcileAllBalances |
| `routes/operator-trading.js` | `/list-credit-ledger`, `/delist-credit-ledger`, `/retire-credit-ledger`, `/ledger-checkout-order`, `/ledger-checkout-verify`, `/sync-ledger-balance`, `/my-ledger-credits` |
| `routes/portfolio.js` | `/my-ledger-credits` (GET) |
| `hooks/usePortfolio.js` | Frontend: loadMyCredits includes ledger credits |
| `CarbonCredits.js` | Marketplace UI (unified listings) |

### 14.3 Shared Infrastructure
| File | Role |
|------|------|
| `services/cacheStrategy.js` | Redis caching, TTLs, invalidation (broken) |
| `services/certificates.js` | Ownership + retirement certificates |
| `services/rateService.js` | ETH/INR rate (CoinGecko) |
| `services/invoice.js` | Trade invoices/bills PDF |
| `services/chainLogger.js` | On-chain trade logging |
| `lib/circuitBreaker.js` | Razorpay/RPC resilience |
| `lib/advisoryLock.js` | PostgreSQL advisory locks for concurrency |
| `cron/jobs.js` | Background jobs |
| `db/pool.js` | Query wrapper, transactions |

---

## 15. Summary: Top Architecture Risks

| Risk | Severity | Location |
|------|----------|----------|
| Non-atomic ledger transfer (SELL then BUY) | **P0** | `creditLedger.js:197-222` |
| No cross-custody trading | **P0** | Entire marketplace |
| Cache invalidation broken | **P1** | `cacheStrategy.js:144-147` |
| Duplicate fee logic | **P1** | `trades.js:106`, `operator-trading.js:427` |
| `market_listings` table missing | **P1** | `trades.js:249`, `blockchain.js:247` |
| Dual retirement flows (approval vs self-service) | **P1** | `retirementApproval.js` vs `operator-trading.js` |
| No outbox pattern for blockchain events | **P2** | `blockchain.js` |
| Cron lock without TTL | **P2** | `cron/jobs.js:306` |
| Frontend hardcoded ETH/INR rate | **P2** | `CarbonCredits.js:28` |
| No durable settlement state machine | **P2** | `trades.chain_status` enum only |

---

**Next Phase:** Phase 1 — Financial Invariants Definition