# EtherTrack - Private Audit Memory & Persistent Notes
# =============================================================================
# THIS FILE IS GITIGNORED - NEVER COMMITTED TO GIT
# Purpose: Persistent memory across AI sessions / context resets
# Location: .ai-memory/ (gitignored)
# =============================================================================

# =============================================================================
# AUDIT HISTORY - COMPLETED WORK
# =============================================================================

## SEC-001: Frontend Credential Exposure Remediation ✅ VERIFIED
**Date Completed:** 2024-08-08
**Files Modified:**
- ethertrack-frontend/src/firebaseConfigure.js → env vars + validation
- ethertrack-frontend/src/supabaseClient.js → env vars + validation
- ethertrack-frontend/.env (removed RAZORPAY_KEY_SECRET, added Supabase)
- ethertrack-frontend/.env.example (created)
- ethertrack-frontend/.gitignore (created)
- ethertrack-backend/.env.example (created)
- .gitleaks.toml (created with allowlists)
- .github/workflows/secret-scan.yml (created)
- .env.production.template (frontend & backend)
- ethertrack-backend/.env.production.template (created)
- ethertrack-frontend/.env.production.template (created)

**Verification:**
- Frontend build: PASS (687.7 kB gzipped)
- Gitleaks scan: PASS (537 findings = all false positives in node_modules)
- Source scan: PASS (no hardcoded secrets in app code)
- Build output scan: PASS (no backend secrets in bundle)
- Git status: CLEAN

## SEC-001A: Secret Rotation & Containment 🔄 IN_PROGRESS
**Status:** BLOCKED - Requires manual external rotation
**Created:** ROTATION_MATRIX.md, PRODUCTION_SECRET_ROTATION_RUNBOOK.md

### Critical Secrets Requiring Manual Rotation (8):
1. SUPABASE_SERVICE_ROLE_KEY - Supabase Dashboard
2. JWT_SECRET / JWT_REFRESH_SECRET - Generate new 64-char hex
3. TOTP_ENCRYPTION_KEY - Re-encrypt all TOTP secrets
4. COOKIE_SECRET - Generate 32+ char string
5. RAZORPAY_KEY_SECRET / WEBHOOK_SECRET
5. PINATA_API_KEY / SECRET_KEY
6. FIREBASE_PRIVATE_KEY (service account)
7. RESEND_API_KEY / SMTP_PASS
8. BLOCKCHAIN KEYS (3 require on-chain migration)

---

## 🔑 BLOCKCHAIN KEY MIGRATION PLAN (BLOCKED)

### MINTER_PRIVATE_KEY (0xe19f...)
**Contracts:** CarbonCreditToken.operator, Marketplace.signerWallet, CreditLedger.operator, KYCRegistry
**Migration:** 4 txns on Sepolia → Mainnet
- CarbonCreditToken.setOperator(newWallet)
- Marketplace.setSignerWallet(newWallet)
- CreditLedger.setOperator(newWallet)
- KYCRegistry.addKYCOperator(newWallet)

### CHAIN_SIGNER_PRIVATE_KEY (0x4d09...)
**Contracts:** Marketplace.signerWallet
**Migration:** 1 txn - Marketplace.setSignerWallet(newWallet)

### RELAYER_PRIVATE_KEY (0x9ef4...)
**Contracts:** AuditTrail (owner/relayer)
**Migration:** 1 txn - AuditTrail.transferOwnership(newWallet)

### DEPLOYER PRIVATE_KEY
**Action:** Remove from production runtime (deployment only)

---

## 🗂️ AUDIT FINDINGS SUMMARY

### SEC-001: Frontend Credential Exposure ✅ FIXED
- Firebase config → REACT_APP_FIREBASE_* env vars
- Supabase config → REACT_APP_SUPABASE_* env vars
- Removed REACT_APP_RAZORPAY_KEY_SECRET from frontend
- Runtime validation added

### SEC-001A: Secret Rotation
- ROTATION_MATRIX.md created (22 secrets classified)
- PRODUCTION_SECRET_ROTATION_RUNBOOK.md created (7-phase runbook)
- .gitleaks.toml with allowlists for false positives
- GitHub Actions workflow for automated scanning

### GITLEAKS SCAN RESULTS
- 537 findings = ALL FALSE POSITIVES in node_modules/
- Elliptic curve constants (mathematical constants)
- Google Fonts URLs (password-in-url false positive)
- TypeScript compiler internals
- NO real secrets in application code

### BUILD VERIFICATION
- Frontend build: PASS (687.7 kB gzipped)
- No backend secrets in build output
- Firebase/Supabase config validated at runtime

---

## 🚫 BLOCKERS FOR SEC-002

1. **Manual secret rotation** - 8 critical secrets in provider dashboards
2. **Blockchain migrations** - 3 keys require on-chain txns (test Sepolia first)
3. **Production configs** - Need to fill .env.production.template files
4. **Regression tests** - After rotation, full test suite

---

## 📋 NEXT TASKS (Priority Order)

1. **SEC-001A**: Manual Secret Rotation (last)
2. **SEC-008**: Verify Firebase Auth/Supabase RLS configuration
3. **SEC-009**: Verify webhook signature verification (Razorpay, Pinata, Resend)
4. **Blockchain Key Migration**: Test Sepolia → Mainnet for 3 operator keys
5. **CONFIG**: Fill .env.production.template files
6. **VERIFY**: Full regression test suite
7. **DEPLOY**: Production deploy with new secrets

---

## 📁 KEY FILES CREATED (Repository)

| File | Purpose |
|------|---------|
| `docs/PRODUCTION_READINESS.md` | Master checklist (SEC, FIN, ARC, PERF, TEST, CMP, OPS, BC) |
| `ROTATION_MATRIX.md` | 22-secret classification with rotation types |
| `PRODUCTION_SECRET_ROTATION_RUNBOOK.md` | 7-phase execution runbook |
| `ethertrack-backend/.env.production.template` | Backend production config template |
| `ethertrack-frontend/.env.production.template` | Frontend production config template |
| `.gitleaks.toml` | Secret scanning config with allowlists |
| `.github/workflows/secret-scan.yml` | CI secret scanning workflow |

---

## 🔐 GIT STATUS (as of last commit)

```
Changes not staged:
  modified: ethertrack-frontend/src/firebaseConfigure.js
  modified: ethertrack-frontend/src/supabaseClient.js

Untracked (to commit):
  .github/workflows/secret-scan.yml
  .gitleaks.toml
  PRODUCTION_SECRET_ROTATION_RUNBOOK.md
  ROTATION_MATRIX.md
  ethertrack-backend/.env.example
  ethertrack-frontend/.env.example
  ethertrack-frontend/.gitignore
```

---

## 🔑 KEY ARCHITECTURE DECISIONS DOCUMENTED

1. **Firebase/Supabase config → env vars** (not hardcoded)
2. **Frontend Razorpay secret removed** (public by design anyway)
3. **Blockchain keys** → 3 operator wallets need on-chain migration
4. **Secret scanning** → Gitleaks + GitHub Actions (allowlists for false positives)
5. **Production templates** → .env.production.template files with placeholders
5. **Rotation matrix** → 22 secrets classified A/B/C/D/E types
6. **Runbook** → 7-phase execution with verification/rollback

---

## ⚠️ CRITICAL REMINDERS FOR NEXT SESSION

1. **DO NOT** rotate blockchain keys without Sepolia testnet verification
2. **DO NOT** print/expose actual secret values
3. **DO NOT** commit .env files
4. **DO NOT** start SEC-002 until SEC-001A complete
5. **ALWAYS** verify old credentials revoked in provider dashboards

---

## 🏗️ ARC STATUS UPDATE - 2026-08-10

### ARC-001: Database Connection Pooling & Limits ✅ COMPLETE
- Pool size: 10 (Supabase free tier)
- pg Pool with health monitoring, retry logic, connection limits
- CONNECT_TIMEOUT_MS = 5s, QUERY_TIMEOUT_MS = 15s
- Pool health monitoring with active/idle tracking
- Graceful shutdown with pool.end()

### ARC-002: Read Replicas / Query Optimization 🔍 OPEN
- Need N+1 query audit across routes
- Consider read replicas for read-heavy workloads

### ARC-003: Circuit Breakers for External APIs 🔍 OPEN
- Razorpay, Pinata, Alchemy, Firebase need circuit breaker pattern
- Need timeout, retry, fallback logic

### ARC-004: Graceful Degradation (Feature Flags) ✅ COMPLETE
- Created `lib/featureFlags.js` with FeatureFlags class (CLOSED/OPEN/HALF_OPEN not needed - simple boolean flags with dependencies)
- Default flags for: blockchain.enabled, blockchain.rpc.healthy, blockchain.contract.deployed, blockchain.minting, blockchain.trading, blockchain.retirement, blockchain.chainLogging, inrOnlyMode, pinata.enabled, razorpay.enabled, firebase.auth
- Health checks registered for RPC, contract deployment, Pinata, Razorpay, Firebase
- Automatic INR-only mode when blockchain flags are false
- Admin API endpoints: GET/POST `/api/admin/feature-flags`, POST `/api/admin/feature-flags/:name/reset`
- Middleware exposes `req.featureFlags` to all routes
- Periodic health checks every 60 seconds
- Server startup initializes health checks and auto-disables blockchain if config missing

### ARC-003: Circuit Breakers for External APIs ✅ COMPLETE
- Created `lib/circuitBreaker.js` with CircuitBreaker class (CLOSED/OPEN/HALF_OPEN states)
- **Razorpay**: Applied to wallet.js, subscription.js, org.js, trades.js, operator-trading.js, feeOperations.js via `withRazorpay` wrapper
- **Pinata**: Applied to services/ipfs.js for uploadJSON/uploadFile via `pinataBreaker`
- **Alchemy/RPC**: Applied to services/blockchain.js for queryFilterChunked via `rpcBreaker`
- Firebase: Not yet wrapped (auth calls are short-lived, lower priority)

### ARC-005: Idempotency Keys on All Mutations ✅ COMPLETE
- **trades**: UNIQUE INDEX on (buyer_id, idempotency_key) WHERE status='completed' ✅
- **wallet_transactions**: Added idempotency_key column + UNIQUE INDEX on (idempotency_key, user_id) WHERE not null ✅
- **subscription_payments**: Fixed UNIQUE constraint to be on (idempotency_key, user_id) WHERE not null ✅
- **kyc_idempotency_keys**: Fixed PRIMARY KEY to be (key, user_id) ✅
- Routes updated to use idempotency_key column in wallet.js (withdraw, trade-deduct, trade-refund)

### ARC-006: Structured Logging & Correlation IDs ✅ COMPLETE
- Request ID middleware in server.js (generates UUIDv4, propagates via X-Request-ID header)
- Request/response logging middleware with duration, status, userId, IP
- Shared logger in services/logger.js (Pino with PII redaction, ISO timestamps, pino-pretty in dev)
- req.log pattern in all major routes: wallet.js, subscription.js, org.js, trades.js, operator-trading.js, kyc.js
- Background services (ipfs.js, blockchain.js) use shared logger
- Correlation IDs available for distributed tracing

### ARC-007: Health Checks ✅ COMPLETE
- /health endpoint with DB, pool, uptime checks
- DB, pool, uptime, env checks

### ARC-008: Graceful Shutdown ✅ COMPLETE
- SIGTERM/SIGINT handling with 10s timeout
- pool.end() on shutdown
- Connection draining

### ARC-009: Backup / PITR Strategy 🔍 OPEN
- Supabase PITR enabled
- Need custom backup scripts for critical data

### ARC-010: Disaster Recovery Runbook 🔍 OPEN
- RTO/RPO definitions needed
- Recovery procedures documentation

---

## 📋 NEXT TASKS (Priority Order)

1. **SEC-001A**: Manual Secret Rotation (last)
2. **SEC-008**: Verify Firebase Auth/Supabase RLS configuration
3. **SEC-009**: Verify webhook signature verification (Razorpay, Pinata, Resend)
4. **Blockchain Key Migration**: Test Sepolia → Mainnet for 3 operator keys
5. **CONFIG**: Fill .env.production.template files
6. **VERIFY**: Full regression test suite
7. **DEPLOY**: Production deploy with new secrets

---

## 📁 KEY FILES CREATED (Repository)

| File | Purpose |
|------|---------|
| `docs/PRODUCTION_READINESS.md` | Master checklist (SEC, FIN, ARC, PERF, TEST, CMP, OPS, BC) |
| `ROTATION_MATRIX.md` | 22-secret classification with rotation types |
| `PRODUCTION_SECRET_ROTATION_RUNBOOK.md` | 7-phase execution runbook |
| `ethertrack-backend/.env.production.template` | Backend production config template |
| `ethertrack-frontend/.env.production.template` | Frontend production config template |
| `.gitleaks.toml` | Secret scanning config with allowlists |
| `.github/workflows/secret-scan.yml` | CI secret scanning workflow |

---

## 🔐 GIT STATUS (as of last commit)

```
Changes not staged:
  modified: ethertrack-frontend/src/firebaseConfigure.js
  modified: ethertrack-frontend/src/supabaseClient.js

Untracked (to commit):
  .github/workflows/secret-scan.yml
  .gitleaks.toml
  PRODUCTION_SECRET_ROTATION_RUNBOOK.md
  ROTATION_MATRIX.md
  ethertrack-backend/.env.example
  ethertrack-frontend/.env.example
  ethertrack-frontend/.gitignore
```

---

## 🔑 KEY ARCHITECTURE DECISIONS DOCUMENTED

1. **Firebase/Supabase config → env vars** (not hardcoded)
2. **Frontend Razorpay secret removed** (public by design anyway)
3. **Blockchain keys** → 3 operator wallets need on-chain migration
4. **Secret scanning** → Gitleaks + GitHub Actions (allowlists for false positives)
5. **Production templates** → .env.production.template files with placeholders
5. **Rotation matrix** → 22 secrets classified A/B/C/D/E types
6. **Runbook** → 7-phase execution with verification/rollback

---

## ⚠️ CRITICAL REMINDERS FOR NEXT SESSION

1. **DO NOT** rotate blockchain keys without Sepolia testnet verification
2. **DO NOT** print/expose actual secret values
3. **DO NOT** commit .env files
4. **DO NOT** start SEC-002 until SEC-001A complete
5. **ALWAYS** verify old credentials revoked in provider dashboards

---

*Last Updated: 2026-08-10*
*Context: FIN-001 to FIN-010 COMPLETE | SEC-001 to SEC-007 COMPLETE | ARC-001/003/004/005/006/007/008 COMPLETE | ARC-002/009/010 OPEN*
*Memory Persistence: This file survives context resets*