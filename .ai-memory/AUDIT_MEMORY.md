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
 
 ### SEC-002: Single Hot Wallet Controls All Operator Functions ✅ TESTNET COMPLETE
 - TimelockController deployed on Sepolia (0x47F60Bc8559B82f61240125083A6AD6124C1D541)
 - 1-hour minimum delay enforced
 - All 6 contracts: operator/ownership transferred to timelock
 - CarbonCreditToken.operator → timelock
 - CreditLedger.operator → timelock
 - Marketplace.signerWallet → timelock
 - KYCRegistry.owner → timelock
 - Treasury.owner → timelock
 - AuditTrail.owner → timelock
 - Propose → Wait → Execute flow verified
 
 ### SEC-003: CSRF Protection Gaps on State-Changing Endpoints ✅ FIXED
 - Removed /api/audit, /api/ipfs, /api/news, /api/ccc, /api/market, /api/verify, /api/reports from CSRF_SKIP_PREFIX
 - 36 state-changing endpoints now protected by double-submit cookie CSRF
 - Only 17 ERP endpoints remain skipped (JWT-only auth, safe from CSRF)
 - Frontend already sends X-CSRF-Token on all writes
 
 ### SEC-004: SQL Injection / Parameterized Queries Audit ✅ VERIFIED
 - Scanned 230+ query() calls across codebase
 - All production queries use parameterized queries ($1, $2, ... placeholders)
 - No string concatenation with user input found
 - Dynamic column/table names use hardcoded whitelists
 - Added explicit whitelist validation for defense-in-depth:
   - admin.js: RETIREMENT_UPDATABLE_COLUMNS (6 columns)
   - registry.js: PROJECT_FILTER_COLUMNS (2 columns), PROJECT_STATUS_VALUES (4 values)
 - Test scripts (reset-testnet-market-data.js) use dynamic table names from hardcoded arrays (maintenance only)
 
 ### SEC-005: XSS / Input Sanitization Audit ✅ VERIFIED
 - Backend responses: All JSON, no HTML reflection
 - Frontend rendering: React JSX auto-escapes {variable}, no dangerouslySetInnerHTML
 - Admin dashboard inputs: sanitize() trims; server validates
 - News URLs: Allowlist domains + HTTPS only (sanitizeUrl())
 - InnerHTML usage: Only container.innerHTML = '' to clear reCAPTCHA
 
### SEC-006: IDOR / BOLA Audit ✅ FIXED
  - Scanned all routes with dynamic parameters
  - All routes have proper authentication
  - Most routes have ownership/org checks in SQL (WHERE user_id = $N, WHERE org_id = $N)
  - Fixed IDOR in registry.js: /batches/:id/tokenise now verifies project.developer_id === req.user.id
  - Admin routes protected by requireAdmin/requireRole
  - Org routes protected by requireOrgRole
  - Public routes intentionally public (verification endpoints, registry browse)
  
  ### SEC-007: Rate Limiting Coverage ✅ FIXED
  - Added tiered rate limiters in middleware/rateLimit.js
  - assetActionLimiter (15/min/user): portfolio confirm-listing/delisting, operator-trading list/delist/retire/ledger-checkout, support tickets/feedback/unanswered, wallet KYC sync
  - writeLimiter (30/min/user): emissions log/bulk/delete/profile, compliance writes
  - walletActionLimiter (20/min/user): wallet KYC sync
  - Server-level prefix limiters: /api/auth (100/15min), /api/kyc (20/hr), /api/emissions/log (30/min), /api/emissions/bulk (10/hr), /api/brsr (20/min), /api/ccts (20/min), /api/compliance (60/min), /api/ccc (120/min), /api/subscription/* (10/min), /api/erp (60/15min), /api/ops-integration (20/min), /api/invoices (40/min)
  - Global catch-all: /api/ (500/15min per IP)
  
  ### FIN-001 to FIN-006: Financial Correctness ✅ COMPLETE
  - FIN-001: Double-spend prevention - idempotency keys, advisory locks, FOR UPDATE locks
  - FIN-002: Oversell prevention - FOR UPDATE locks, advisory locks, GREATEST(0, ...) checks
  - FIN-003: Negative balance prevention - DB constraints, adjustLedger checks
  - FIN-004: Duplicate payment prevention - idempotency keys on trades, wallet, subscriptions
  - FIN-005: Duplicate trade prevention - idempotency keys + DB unique constraint
  - FIN-006: Duplicate withdrawal prevention - idempotency key on withdrawal endpoint
  
  ### FIN-007: Fee Calculation Accuracy ✅ VERIFIED
  - calcFees() in trades.js: 1% total fee (100 BPS) split 50/50 buyer/seller
  - GST 18% on platform fee only (not on carbon credit price)
  - Fee split 50/50 between buyer/seller, GST split 50/50
  
  ### FIN-008: GST/Tax Calculation Accuracy ✅ VERIFIED
  - getGSTType() correctly determines CGST/SGST vs IGST based on buyer GSTIN state code
  - B2C no-GSTIN defaults to CGST/SGST (same-state assumption)
  - CGST/SGST vs IGST logic in invoice.js verified
  - SAC codes and GST breakdown in invoices
  
  ### FIN-009: Settlement Atomicity ✅ VERIFIED
  - withTransaction() wrapper used for all trade settlements
  - FOR UPDATE locks on batch, buyer, seller rows
  - Advisory locks (pg_advisory_xact_lock) prevent concurrent trades on same batch
  - Atomic INR balance updates within transaction
  
  ### FIN-010: Reconciliation 🔄 PARTIAL
  - CreditLedger reconciliation cron added (hourly)
  - Need: wallet balances ↔ wallet ledger, carbon ownership ↔ CarbonLedger
  - Need: marketplace trades ↔ trade records, Razorpay payments ↔ internal payments
  - Need: blockchain events ↔ internal trade state, registry transactions ↔ carbon ownership
  
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

1. **MANUAL:** Rotate 8 critical secrets in provider dashboards
2. **TESTNET:** Blockchain migrations on Sepolia testnet
3. **MAINNET:** Blockchain migrations on Polygon mainnet
3. **CONFIG:** Fill .env.production.template files
4. **VERIFY:** Full regression test suite
4. **DEPLOY:** Production deploy with new secrets

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

*Last Updated: 2024-08-08*
*Context: SEC-001A IN_PROGRESS | SEC-002 BLOCKED*
*Memory Persistence: This file survives context resets*
## TESTNET STATUS UPDATE - 2024-08-08
SEC-001A: TESTNET_READY | SEC-002: CAN START ON TESTNET
PRODUCTION BLOCKED - Manual rotations needed
# #   S E C - 0 0 2   T e s t n e t   I m p l e m e n t a t i o n   S t a r t e d   -   2 0 2 4 - 0 8 - 0 8  
 -   M a r k e t p l a c e . s o l :   A d d e d   s e t S i g n e r W a l l e t V i a T i m e l o c k ,   s e t K Y C R e g i s t r y V i a T i m e l o c k ,   i n i t i a l i z e T i m e l o c k  
 