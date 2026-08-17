# Idempotency Audit Matrix
**Generated:** 2026-08-10  
**Project:** EtherTrack

---

## Endpoint Audit

| Endpoint | Mutation Type | Idempotency Required? | Application Check | DB Protection | Transaction Protection | Advisory Lock | Status |
|----------|---------------|----------------------|-------------------|---------------|------------------------|---------------|--------|
| `POST /api/trades/record` | Trade settlement | YES | ✅ (moved inside tx) | ✅ UNIQUE(buyer_id, idempotency_key) WHERE status='completed' | ✅ withTransaction + FOR UPDATE | ✅ pg_advisory_xact_lock(user:idem_key) + batch lock | ✅ PASS |
| `POST /api/wallet/withdraw` | Withdrawal | YES | ✅ (moved inside tx) | ✅ UNIQUE(user_id, idempotency_key) WHERE not null | ✅ withTransaction + FOR UPDATE | ✅ pg_advisory_xact_lock(user:idem_key) | ✅ PASS |
| `POST /api/wallet/trade-deduct` | Trade debit | YES | ✅ (moved inside tx) | ✅ UNIQUE(user_id, idempotency_key) WHERE not null | ✅ withTransaction + FOR UPDATE | ✅ pg_advisory_xact_lock(user:idem_key) | ✅ PASS |
| `POST /api/wallet/trade-refund` | Trade refund | YES | ✅ (moved inside tx) | ✅ UNIQUE(user_id, idempotency_key) WHERE not null | ✅ withTransaction + FOR UPDATE | ✅ pg_advisory_xact_lock(user:idem_key) | ✅ PASS |
| `POST /api/wallet/deposit/verify` | Deposit verification | YES | ✅ FOR UPDATE SKIP LOCKED | ✅ UNIQUE(user_id, idempotency_key) WHERE not null | ✅ withTransaction + FOR UPDATE SKIP LOCKED | N/A (Razorpay order_id used) | ✅ PASS |
| `POST /api/trades/checkout-order` | Razorpay order | YES | ⚠️ Partial (order_id check) | ❌ No constraint on order creation | ❌ No transaction | N/A | ⚠️ PARTIAL |
| `POST /api/subscription/order` | Subscription order | YES | ✅ checkIdempotency | ✅ UNIQUE(idempotency_key, user_id) | ⚠️ Order created outside tx | ❌ No advisory lock | ⚠️ PARTIAL |
| `POST /api/org/plan/create-order` | Org plan order | YES | ✅ checkIdempotency | ✅ UNIQUE(idempotency_key, user_id) | ⚠️ Order created outside tx | ❌ No advisory lock | ⚠️ PARTIAL |
| `POST /api/subscription/verify` | Subscription verify | YES | ✅ checkIdempotency | ✅ UNIQUE(idempotency_key, user_id) | ✅ withTransaction | ❌ No advisory lock | ⚠️ PARTIAL |
| `POST /api/subscription/wallet-pay` | Wallet sub pay | YES | ✅ checkIdempotency | ✅ UNIQUE(idempotency_key, user_id) | ✅ withTransaction | ❌ No advisory lock | ⚠️ PARTIAL |
| `POST /api/subscription/metamask-pay` | Metamask sub pay | YES | ✅ checkIdempotency | ✅ UNIQUE(idempotency_key, user_id) | ✅ withTransaction | ❌ No advisory lock | ⚠️ PARTIAL |
| `POST /api/kyc/submit` | KYC submission | YES | ✅ checkIdempotency | ✅ PK(key, user_id) | ✅ withTransaction + FOR UPDATE | ✅ pg_advisory_xact_lock(user_id) | ✅ PASS |
| `POST /api/org/plan/select` | Org plan select | YES | ✅ checkIdempotency | ✅ UNIQUE(idempotency_key, user_id) | ✅ withTransaction | ❌ No advisory lock | ⚠️ PARTIAL |
| `POST /api/wallet/deposit/create-order` | Deposit order | NO (Razorpay order) | N/A | N/A | N/A | N/A | N/A |
| `POST /api/wallet/bind` | Wallet bind | NO | N/A | N/A | N/A | N/A | N/A |

---

## Database Constraints Status

| Table | Constraint | Type | Status |
|-------|------------|------|--------|
| `trades` | `unq_trades_idempotency` | UNIQUE INDEX (buyer_id, idempotency_key) WHERE status='completed' | ✅ Applied |
| `wallet_transactions` | `unq_wallet_tx_idempotency` | UNIQUE INDEX (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL | ✅ Applied |
| `subscription_payments` | `unq_sub_payments_idempotency` | UNIQUE INDEX (idempotency_key, user_id) WHERE idempotency_key IS NOT NULL | ✅ Existing |
| `kyc_idempotency_keys` | `kyc_idempotency_keys_pkey` | PRIMARY KEY (key, user_id) | ✅ Existing |

---

## Advisory Lock Strategy

| Operation | Lock Key | Scope | Release |
|-----------|----------|-------|---------|
| Trade record | `hashtext(user_id:idempotency_key)` + `batch_id_hash` | Transaction | Auto on COMMIT/ROLLBACK |
| Wallet withdraw | `hashtext(user_id:idempotency_key)` | Transaction | Auto on COMMIT/ROLLBACK |
| Wallet trade-deduct | `hashtext(user_id:idempotency_key)` | Transaction | Auto on COMMIT/ROLLBACK |
| Wallet trade-refund | `hashtext(user_id:idempotency_key)` | Transaction | Auto on COMMIT/ROLLBACK |
| KYC submit | `user_id` (integer) | Transaction | Auto on COMMIT/ROLLBACK |
| Batch trade | `batch_id` (integer) | Transaction | Auto on COMMIT/ROLLBACK |

---

## Remaining Gaps (Priority Order)

1. **Subscription order creation** - Add advisory lock, move idempotency check inside transaction
2. **Org plan order creation** - Add advisory lock, move idempotency check inside transaction  
3. **Subscription verify/wallet-pay/metamask-pay** - Add advisory lock
4. **Org plan select** - Add advisory lock
5. **Checkout order (Razorpay)** - Consider idempotency for order creation

---

## Verification Commands

```bash
# Verify unique indexes exist
psql $DATABASE_URL -c "
SELECT indexname, indexdef FROM pg_indexes 
WHERE indexname LIKE '%idempotency%' ORDER BY tablename, indexname;
"

# Check for duplicates
psql $DATABASE_URL -c "
SELECT 'wallet_transactions' as table, user_id, idempotency_key, count(*)
FROM wallet_transactions WHERE idempotency_key IS NOT NULL
GROUP BY user_id, idempotency_key HAVING count(*) > 1
UNION ALL
SELECT 'trades', buyer_id, idempotency_key, count(*)
FROM trades WHERE idempotency_key IS NOT NULL AND status = 'completed'
GROUP BY buyer_id, idempotency_key HAVING count(*) > 1
UNION ALL
SELECT 'subscription_payments', user_id, idempotency_key, count(*)
FROM subscription_payments WHERE idempotency_key IS NOT NULL
GROUP BY user_id, idempotency_key HAVING count(*) > 1;
"
```