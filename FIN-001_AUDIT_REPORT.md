# FIN-001 Financial Correctness Audit Report
**Date**: 2026-08-09  
**Status**: AUDIT COMPLETE — REMEDIATION IN PROGRESS  
**Overall Rating**: **FAIL** — Critical concurrency and idempotency vulnerabilities found

---

## Executive Summary

A comprehensive audit of EtherTrack's financial correctness and concurrency safety revealed **17 critical financial invariants** that must be maintained, and **23 distinct vulnerabilities** across trade settlement, wallet operations, CreditLedger, chain logging, and blockchain event processing. The system relies heavily on application-level validation and lacks database-enforced constraints, making it vulnerable to race conditions, duplicate processing, and silent data corruption under concurrent load or failure scenarios.

---

## Phase 1-2: Discovery & Financial Invariants

### 17 Financial Invariants Identified

| # | Invariant | Current Enforcement |
|---|-----------|---------------------|
| 1 | A carbon credit cannot be sold twice | Application FOR UPDATE |
| 2 | `available_credits` ≥ 0 | Application only |
| 3 | `listed_quantity` ≥ 0 | Application only |
| 4 | Buyer INR balance ≥ spend | Application FOR UPDATE |
| 5 | Seller credits owned ≥ sold | Application FOR UPDATE |
| 6 | Trade settles atomically or rolls back | `withTransaction` callback |
| 7 | Platform fees created once per trade | Application + ON CONFLICT |
| 8 | Razorpay transfers idempotent | Application reference only |
| 9 | Webhook retries don't duplicate money | FOR UPDATE SKIP LOCKED |
| 10 | Blockchain events idempotent | tx_hash UNIQUE + check |
| 11 | CreditLedger mathematically balanced | Application only |
| 12 | One settlement identity per trade | Application only |
| 13 | Failed trade → no partial buyer deduction | Transaction rollback |
| 14 | Failed trade → no partial seller deduction | Transaction rollback |
| 15 | DB ↔ Payment state reconciliation | Manual / missing |
| 16 | Blockchain failure ≠ false settled | chain_status tracking |
| 17 | Concurrent = serialized result | **VIOLATED** |

---

## Phase 3: Concurrency Audit — 23 Vulnerabilities Found

### CRITICAL (9)

| # | Component | Vulnerability | Impact |
|---|-----------|---------------|--------|
| C1 | `trades.js:193-232` | FOR UPDATE acquired AFTER batch select — race window between SELECT and FOR UPDATE | Double-sell credits |
| C2 | `trades.js:180` | `checkIdempotency` only checks completed trades; concurrent requests can both pass | Duplicate trade creation |
| C3 | `creditLedger.js:197-222` | `transferLedgerOwnership` — two separate on-chain txs (seller debit, buyer credit); non-atomic | Ledger imbalance |
| C4 | `wallet.js:471-430` | Deposit verify: webhook can process same payment concurrently with verify endpoint | Double credit |
| C5 | `wallet.js:647-762` | Withdrawal reversal race: payout may succeed after reversal initiated | Funds lost or duplicated |
| C6 | `chainLogger.js:303-377` | Retry cron vs confirmation callback race on same trade | Duplicate chain logging |
| C7 | `wallet.js:370-468` | Deposit verify doesn't check webhook-processed state before lock | Double credit |
| C8 | `wallet.js:800-852` | `trade-deduct` / `trade-refund` no idempotency key at DB level | Duplicate deduction/refund |
| C9 | `wallet.js:800-852` | `trade-deduct` calls `transferNodalToMerchant` AFTER commit — no rollback if transfer fails | Money deducted, transfer fails |

### HIGH (8)

| # | Component | Vulnerability |
|---|-----------|---------------|
| H1 | `portfolio.js:338` | `confirm-listing` / `confirm-delisting` no FOR UPDATE on carbon_batches |
| H2 | `trades.js:230-349` | INR trade: buyer balance locked, seller NOT locked for credit |
| H3 | `wallet.js:800-852` | `trade-deduct` → `transferNodalToMerchant` called AFTER commit; failure = money gone |
| H4 | `wallet.js:855-910` | `trade-refund` uses LIKE on notes for idempotency — fragile |
| H5 | `blockchain.js:465-495` | `handleCreditTraded` checks tx_hash AFTER insert attempt |
| H6 | `blockchain.js:260-286` | Sync CreditListed — no idempotency for replay |
| H7 | `wallet.js:471-540` | Webhook doesn't check `status='success'` before lock |
| H8 | `chainLogger.js:206-220` | Confirmation callback runs AFTER function returns — race with retry cron |

### MEDIUM (6)

| # | Component | Vulnerability |
|---|-----------|---------------|
| M1 | `trades.js:330-332` | `platform_fees` uses ON CONFLICT DO NOTHING but no UNIQUE constraint on trade_id |
| M2 | `wallet.js:1056-1117` | KYC sync no lock on user row |
| M3 | `trades.js:283-312` | Trade insert no UNIQUE on idempotency_key |
| M4 | `blockchain.js:260-286` | Sync replay no idempotency |
| M5 | `chainLogger.js:427-438` | `_queueRetry` ON CONFLICT DO NOTHING but no UNIQUE on trade_id |
| M6 | `creditLedger.js:197-222` | No on-chain atomic transfer function |

---

## Phase 4: Database Correctness — Missing Constraints

| Table | Missing Constraint | Risk |
|-------|-------------------|------|
| `carbon_batches` | `CHECK (available_credits >= 0)` | Oversell |
| `carbon_batches` | `CHECK (listed_quantity >= 0)` | Negative listed |
| `carbon_batches` | `CHECK (available_credits >= listed_quantity)` | Inconsistent state |
| `wallet_transactions` | `CHECK (amount > 0)` | Negative amounts |
| `credit_ledger_balances` | `CHECK (balance >= 0)` | Negative ledger |
| `trades` | `UNIQUE (idempotency_key)` WHERE status='completed' | Duplicate trades |
| `platform_fees` | `UNIQUE (trade_id)` | Duplicate fees |
| `wallet_transactions` | `CHECK (amount > 0)` | Zero/negative |
| `pending_chain_logs` | `UNIQUE (trade_id)` | Duplicate retries |

---

## Phase 5-6: Trade Settlement & Idempotency

### Current Architecture
- `withTransaction` callback with explicit BEGIN/COMMIT/ROLLBACK
- Application-level `FOR UPDATE` row locking
- Application-level idempotency checks
- `FOR UPDATE SKIP LOCKED` for webhooks
- `ON CONFLICT DO NOTHING` for deduplication

### Gaps
1. No advisory locks for cross-table operations
2. Idempotency keys not enforced at DB level
3. No atomic CreditLedger transfer
4. No reconciliation job for CreditLedger
5. No trade-state machine (PENDING/PROCESSING/SUCCESS/FAILED/UNKNOWN)

---

## Phase 7: CreditLedger Findings

1. **Non-atomic transfers** — `transferLedgerOwnership` does two separate on-chain transactions
2. **No reconciliation cron** — `verifyLedgerBalance` exists but never scheduled
3. **No on-chain atomic transfer** — CreditLedger.sol lacks combined transfer function
4. **Partial failure handling** — Seller debit succeeds, buyer credit fails → manual reconciliation only

---

## Phase 8: Razorpay Findings

1. **Webhook race** — No pre-lock check for `status='success'`
2. **Checkout-verify race** — Idempotency check before transaction, but concurrent requests can both pass
3. **Transfer operations** — `transferNodalToMerchant`/`transferMerchantToNodal` no idempotency
3. **Webhook replay** — No check for already-processed events before lock

---

## Phase 9: Blockchain Findings

1. **Duplicate tx_hash check** — Done AFTER insert attempt (line 459-463)
2. **Sync replay** — No idempotency for `syncMissedEvents`
3. **Chain logger retry race** — Confirmation callback vs retry cron
4. **Event duplicate handling** — `CreditTraded` checks tx_hash AFTER insert

---

## Phase 10: Failure Matrix

| Scenario | DB | Razorpay | Blockchain | Current Behavior | Required Fix |
|----------|----|----------|------------|------------------|--------------|
| Trade INR | ✅ | ✅ | N/A | OK | Add idempotency |
| Trade INR | ✅ | ❌ | N/A | Rollback OK | Verify reversal |
| Trade INR | ❌ | ✅ | N/A | Payment captured, no trade | Reconciliation job |
| Trade ETH | ✅ | N/A | ✅ | OK | Idempotency on tx_hash |
| Trade ETH | ✅ | N/A | ❌ | Trade recorded, chain failed | Retry + alert |
| Trade ETH | ❌ | N/A | ✅ | Chain settled, no DB | Reconciliation job |
| Withdrawal | ✅ | ✅ | N/A | OK | Idempotency |
| Withdrawal | ✅ | ❌ | N/A | Reversal logic exists | Test reversal |
| Deposit | ✅ | ✅ | N/A | Race condition | Pre-lock check |
| Deposit | ✅ | ❌ | N/A | Webhook handles | Pre-lock check |

---

## Phase 13: Implementation Plan — Files to Modify

| Priority | File | Changes |
|----------|------|---------|
| CRITICAL | `db/schema.sql` | Add CHECK/UNIQUE constraints |
| CRITICAL | `routes/trades.js` | Fix FOR UPDATE order, add DB idempotency |
| CRITICAL | `routes/wallet.js` | Fix deposit/verify race, withdrawal reversal |
| CRITICAL | `services/creditLedger.js` | Add atomic transfer, reconciliation cron |
| CRITICAL | `services/chainLogger.js` | Fix retry race, add UNIQUE constraint |
| HIGH | `routes/wallet.js` | Fix withdrawal reversal, add idempotency keys |
| HIGH | `routes/trades.js` | Fix FOR UPDATE order, add DB idempotency |
| HIGH | `services/creditLedger.js` | Add atomic transfer, reconciliation cron |
| HIGH | `services/chainLogger.js` | Fix retry race, add UNIQUE constraint |
| HIGH | `routes/portfolio.js` | Add FOR UPDATE to confirm-listing/delisting |
| MEDIUM | `services/blockchain.js` | Fix duplicate tx_hash check order |
| MEDIUM | `services/chainLogger.js` | Fix retry race condition |
| MEDIUM | `routes/wallet.js` | Add idempotency keys to trade-deduct/refund |
| MEDIUM | `db/schema.sql` | Add CHECK/UNIQUE constraints |

---

## Phase 11-14: Tests & Verification Required

| Test | Status |
|------|--------|
| Double-spend concurrency test | NOT CREATED |
| Oversell concurrency test | NOT CREATED |
| Duplicate trade request test | NOT CREATED |
| Duplicate webhook test | NOT CREATED |
| Duplicate withdrawal test | NOT CREATED |
| Deposit replay test | NOT CREATED |
| Duplicate blockchain event test | NOT CREATED |
| Failed transaction rollback test | NOT CREATED |
| Razorpay timeout test | NOT CREATED |
| DB failure test | NOT CREATED |
| RPC failure test | NOT CREATED |
| Process-crash recovery test | NOT CREATED |
| Concurrent order matching test | NOT CREATED |
| Partial-fill test | NOT CREATED |
| Cancellation-vs-purchase race test | NOT CREATED |

---

## Final Status

**FIN-001: FAIL** — Critical vulnerabilities require immediate remediation before production.

### Critical Blockers
1. Double-sell race condition in `trades.js`
2. Non-atomic CreditLedger transfers
3. Wallet deposit/verify race condition
4. Withdrawal reversal race
5. Chain logger retry race

### Recommended Next Steps
1. Apply database constraints (Phase 4)
2. Fix critical concurrency bugs (Phase 3)
6. Implement idempotency at DB level
7. Add CreditLedger reconciliation cron
8. Write concurrency tests
9. Run full test suite

---

## Audit Memory Update

```markdown
## FIN-001: Financial Correctness Audit
**Date**: 2026-08-09
**Status**: FAIL — REMEDIATION REQUIRED
**Files Audited**: 12 core files, 1 schema
**Vulnerabilities Found**: 23 (9 Critical, 8 High, 6 Medium)
**Database Constraints Missing**: 9
**Tests Required**: 15 concurrency tests
**Next Phase**: Remediation implementation
```