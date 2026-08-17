# External Dependency Matrix & Circuit Breaker Coverage Audit
**Generated:** 2026-08-10  
**Project:** EtherTrack  
**Environment:** Testnet (Sepolia)

---

## Dependency Inventory

| # | Dependency | Category | Criticality | Circuit Breaker | Timeout | Retry | Fallback | Health Check | Notes |
|---|------------|----------|-------------|-----------------|---------|-------|----------|--------------|-------|
| 1 | **Razorpay** | Payments | **CRITICAL** | ✅ `razorpay` breaker | 30s | 3 retries | `inrOnlyMode` flag | `checkRazorpayHealth` (accounts.fetch) | All calls via `withRazorpay()` wrapper |
| 2 | **Pinata** | IPFS/Storage | **CRITICAL** | ✅ `pinata` breaker | 30s | 3 retries | Local cache | `checkPinataHealth` (auth test) | `uploadJSON`, `uploadFile` via breaker |
| 3 | **Alchemy RPC** | Blockchain | **CRITICAL** | ✅ `alchemy-rpc` breaker | 60s | 3 retries | `inrOnlyMode` flag | `checkRpcHealth` (eth_blockNumber) | `queryFilter` via breaker |
| 4 | **Firebase Auth** | Auth | **CRITICAL** | ❌ None | - | - | - | `checkFirebaseHealth` (app check) | Used in auth middleware; low call volume |
| 5 | **Supabase/PostgreSQL** | Database | **CRITICAL** | N/A (pool-level) | 5s connect, 15s query | 3 retries | Read replica fallback | `/health` endpoint + pool monitor | Connection pooling + read replica |
| 6 | **CoinGecko** | Price Feed | HIGH | ❌ None (custom) | 4s | Custom circuit breaker | Stale cache fallback | Rate cache age check | Custom implementation in wallet.js |
| 6 | **Email (Resend/SMTP)** | Notifications | HIGH | ❌ None | - | - | Queue + retry | - | Fire-and-forget; non-blocking |
| 7 | **ERP APIs** (Zoho, QuickBooks, Tally, SAP, Oracle, Dynamics) | Integrations | MEDIUM | ❌ None | - | - | Partial sync logging | `/api/erp/*/test` endpoints | Per-ERP pull functions |
| 8 | **IEX/GCI/PXIL** | Market Data | LOW | ❌ None | - | - | Cached rates | - | Not yet integrated |
| 9 | **Node-Cron Jobs** | Internal | MEDIUM | N/A | - | - | Manual re-run | Scheduler health | Stopped on shutdown |
| 10 | **Socket.io** | Real-time | LOW | N/A | - | - | Polling fallback | Connection events | Graceful disconnect |

---

## Circuit Breaker Configuration Summary

| Breaker Name | Failure Threshold | Success Threshold | Timeout | Dependencies Using |
|--------------|-------------------|-------------------|---------|-------------------|
| `razorpay` | 5 | 2 | 30s | wallet, trades, subscription, org, operator-trading, feeOperations |
| `pinata` | 5 | 2 | 30s | ipfs (uploadJSON, uploadFile) |
| `alchemy-rpc` | 5 | 2 | 60s | blockchain (queryFilter) |

---

## Coverage Gaps & Risks

| Dependency | Gap | Risk Level | Mitigation |
|------------|-----|------------|------------|
| **Firebase Auth** | No circuit breaker | MEDIUM | Low call volume; auth failures surface quickly |
| **Supabase/PostgreSQL** | Pool-level only | LOW | Built-in pool exhaustion monitoring |
| **CoinGecko** | Custom implementation | MEDIUM | Custom circuit breaker in wallet.js; stale cache fallback |
| **Email (Resend)** | No breaker | LOW | Fire-and-forget; queued with retry |
| **ERP APIs** | No breaker | MEDIUM | Per-ERP test endpoints; sync logs |
| **IEX/GCI/PXIL** | Not integrated | LOW | Not yet in production |
| **Node-Cron** | N/A | LOW | Stopped on shutdown; manual re-run |

---

## Health Check Implementation Status

| Health Check | Implementation | Safe (No Side Effects) | Timeout | Used By |
|--------------|----------------|------------------------|---------|---------|
| `checkRazorpayHealth` | `rzp.accounts.fetch()` | ✅ Read-only | 5s | Feature flags |
| `checkPinataHealth` | `axios.get /data/testAuthentication` | ✅ Read-only | 5s | Feature flags |
| `checkRpcHealth` | `eth_blockNumber` | ✅ Read-only | 5s | Feature flags |
| `checkContractDeployed` | `eth_getCode` | ✅ Read-only | 5s | Feature flags |
| `checkFirebaseHealth` | `admin.app().options.projectId` | ✅ Read-only | - | Feature flags |
| `checkRpcHealth` (CoinGecko) | Custom cache age | ✅ Read-only | 4s | wallet.js rate cache |

---

## Recommendations

1. **Add Firebase Auth circuit breaker** - wrap `admin.auth()` calls with breaker
2. **Add CoinGecko circuit breaker** - formalize existing custom implementation
3. **Add ERP API circuit breakers** - per-ERP breakers for pull functions
4. **Add Email circuit breaker** - wrap Resend/SMTP calls
5. **Document CoinGecko custom breaker** - move to shared circuit breaker module
6. **Add breaker state metrics** - export `getAllStates()` to monitoring
7. **Test HALF_OPEN recovery** - verify breaker transitions under load

---

## Verification Commands

```bash
# Check all breaker states
node -e "require('./lib/featureFlags').featureFlags.getAll()"

# Verify no direct Razorpay calls bypass breaker
grep -r "razorpay\." --include="*.js" | grep -v node_modules | grep -v withRazorpay

# Verify no order creation in health checks
grep -r "orders.create" --include="*.js" lib/featureFlags.js

# Verify all external calls have timeout
grep -r "Promise.race" --include="*.js" lib/
```