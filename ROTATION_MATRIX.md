# EtherTrack Production Secret Rotation Matrix

**Version:** 1.0
**Date:** 2024
**Classification:** CONFIDENTIAL - PRODUCTION SECRETS
**Status:** READY FOR EXECUTION

---

## Legend

| Rotation Type | Description |
|---------------|-------------|
| **A** | Immediate - No application changes needed |
| **B** | Coordinated - Requires config/deploy sync |
| **C** | On-chain migration - Requires contract interaction |
| **D** | Provider-side - Requires dashboard/API action |
| **E** | Scheduled - Requires maintenance window |

| Exposure Risk | Definition |
|---------------|------------|
| **CRITICAL** | Full system compromise possible |
| **HIGH** | Major component compromise |
| **MEDIUM** | Limited scope exposure |
| **LOW** | Low impact / public by design |

---

## Rotation Matrix

### 1. DATABASE & INFRASTRUCTURE SECRETS

| # | Secret | Provider | Used By | Exposure Risk | Rotation Type | Dependencies | Production Impact | Verification Test | Rollback Plan | Status |
|---|--------|----------|---------|---------------|---------------|--------------|-------------------|-------------------|---------------|--------|
| 1 | **DATABASE_URL** (PostgreSQL) | Supabase / Neon | `server.js`, `db/pool.js`, all routes, `services/*` | **CRITICAL** | **A** | All backend services | Zero downtime (connection pool handles reconnect) | `curl /health` → 200; run `SELECT 1` via admin script | Keep old URL valid 24h; update `.env` | PENDING |
| 2 | **SUPABASE_URL** | Supabase | `services/ipfs.js`, `services/email/*`, `routes/*` | **CRITICAL** | **A** | Auth, Storage, Realtime | Zero downtime | `/health` endpoint; storage upload test | Keep old project 48h | PENDING |
| 3 | **SUPABASE_SERVICE_ROLE_KEY** | Supabase | `lib/firebaseAdmin.js`, `services/ipfs.js`, admin routes | **CRITICAL** | **D** | Admin operations, storage, auth | Requires Supabase dashboard rotation | Dashboard → Settings → API → Regenerate; test admin create user | Keep old key 24h in vault | PENDING |
| 4 | **REDIS_URL** | Upstash / Redis | `middleware/auth.js`, `services/redis.js`, `services/email/*` | **HIGH** | **A** | Caching, sessions, queues | Brief reconnect (pool handles) | Redis ping; cache hit/miss ratio | Keep old URL 1h | PENDING |
| 5 | **SENTRY_DSN** | Sentry | `server.js`, `lib/firebaseAdmin.js`, `services/logger.js` | **LOW** | **A** | Error tracking only | Zero downtime | Sentry dashboard shows events | Instant rollback (DSN swap) | PENDING |

---

### 2. AUTHENTICATION & SESSION SECRETS

| # | Secret | Provider | Used By | Exposure Risk | Rotation Type | Dependencies | Production Impact | Verification Test | Rollback Plan | Status |
|---|--------|----------|---------|---------------|---------------|--------------|-------------------|-------------------|---------------|--------|
| 6 | **JWT_SECRET** | Internal | `routes/auth.js`, `middleware/auth.js`, `services/socketServer.js` | **CRITICAL** | **B** | All auth, WebSocket | **Logout all users** (token invalidation) | Login → cookie set; `/me` returns user; WS connects | Keep old secret 1h; decode with both | PENDING |
| 7 | **JWT_REFRESH_SECRET** | Internal | `routes/auth.js` (refresh endpoint) | **CRITICAL** | **B** | Refresh tokens | **Logout all users** | Refresh flow works; old tokens rejected | Same as JWT_SECRET | PENDING |
| 8 | **TOTP_ENCRYPTION_KEY** | Internal | `lib/totpEncryption.js`, `routes/auth2fa.js` | **CRITICAL** | **E** | 2FA secrets | **Breaks 2FA for all users** | 2FA setup/verify flow; decrypt test | Keep old key; re-encrypt with new | PENDING |
| 9 | **COOKIE_SECRET** | Internal | `server.js` (cookieParser) | **CRITICAL** | **B** | Session cookies | **Logout all users** | Cookie parse; CSRF token works | Same as JWT_SECRET | PENDING |

---

### 3. PAYMENT & FINANCIAL SECRETS

| # | Secret | Provider | Used By | Exposure Risk | Rotation Type | Dependencies | Production Impact | Verification Test | Rollback Plan | Status |
|---|--------|----------|---------|---------------|---------------|--------------|-------------------|-------------------|---------------|--------|
| 10 | **RAZORPAY_KEY_SECRET** | Razorpay | `routes/wallet.js`, `routes/trades.js`, `routes/subscription.js` | **CRITICAL** | **D** | Deposits, withdrawals, trades | Brief webhook failure window | Dashboard → rotate; test deposit/withdraw | Keep old 24h; webhook verify | PENDING |
| 11 | **RAZORPAY_WEBHOOK_SECRET** | Razorpay | `routes/wallet.js` (webhook endpoint) | **CRITICAL** | **D** | Webhook verification | Brief webhook failures | Dashboard → rotate; test webhook delivery | Keep old 24h | PENDING |
| 11 | **RAZORPAY_KEY_ID** | Razorpay | Frontend + Backend | **MEDIUM** | **D** | Payment UI | None (public) | Dashboard → rotate | Instant | PENDING |

---

### 4. STORAGE & EXTERNAL SERVICES

| # | Secret | Provider | Used By | Exposure Risk | Rotation Type | Dependencies | Production Impact | Verification Test | Rollback Plan | Status |
|---|--------|----------|---------|---------------|---------------|--------------|-------------------|-------------------|---------------|--------|
| 12 | **PINATA_API_KEY** | Pinata | `services/ipfs.js` | **HIGH** | **D** | IPFS pinning | Brief upload failures | Dashboard → rotate; test pin | Keep old 24h | PENDING |
| 13 | **PINATA_SECRET_KEY** | Pinata | `services/ipfs.js` | **CRITICAL** | **D** | IPFS pinning | Brief upload failures | Dashboard → rotate; test pin | Keep old 24h | PENDING |
| 12 | **RESEND_API_KEY** | Resend | `services/email/mailer.js` | **HIGH** | **D** | Transactional emails | Brief email failures | Dashboard → rotate; test send | Keep old 24h | PENDING |
| 13 | **SMTP_PASS** | SendGrid/SES | `services/email/mailer.js` | **HIGH** | **D** | Email fallback | Brief email failures | Test send via SMTP | Keep old 24h | PENDING |
| 13 | **SENTRY_DSN** | Sentry | `server.js`, `lib/firebaseAdmin.js` | **LOW** | **A** | Error tracking | Zero downtime | Sentry dashboard | Instant | PENDING |

---

### 4. BLOCKCHAIN & INFRASTRUCTURE

| # | Secret | Provider | Used By | Exposure Risk | Rotation Type | Dependencies | Production Impact | Verification Test | Rollback Plan | Status |
|---|--------|----------|---------|---------------|---------------|--------------|-------------------|-------------------|---------------|--------|
| 14 | **ALCHEMY_RPC / SEPOLIA_RPC_URL** | Alchemy/Ankr | `services/blockchain.js`, `services/minter.js`, `services/chainLogger.js` | **HIGH** | **A** | All blockchain reads | Zero downtime | RPC call test; block number fetch | Instant | PENDING |
| 15 | **ETHERSCAN_API_KEY** | Etherscan | `hardhat.config.js`, verification scripts | **LOW** | **D** | Contract verification | Zero downtime | Verification script test | Instant | PENDING |
| 15 | **NVIDIA_API_KEY** | NVIDIA | Unused/placeholder | **LOW** | **A** | None | None | N/A | Instant | PENDING |
| 15 | **ERP_CREDS_KEY** | Internal | `routes/erp.js` (AES-256) | **CRITICAL** | **E** | ERP credentials | **Breaks ERP sync** | Re-encrypt test | Keep old key 48h | PENDING |
| 15 | **OPS_SYNC_SERVICE_TOKEN** | Internal | `routes/opsIntegration.js` | **HIGH** | **B** | ERP sync (read) | Brief sync failures | Sync test | Keep old 1h | PENDING |
| 15 | **PLATFORM_SYNC_CORPORATE_WRITE_TOKEN** | Internal | `routes/opsIntegrationCorporate.js` | **HIGH** | **B** | Corporate activation | Brief sync failures | Activation test | Keep old 1h | PENDING |
| 15 | **PLATFORM_SYNC_COUPON_WRITE_TOKEN** | Internal | `routes/opsIntegrationCoupons.js` | **HIGH** | **B** | Coupon management | Brief sync failures | Sync test | Keep old 1h | PENDING |
| 15 | **PLATFORM_SYNC_PRICING_WRITE_TOKEN** | Internal | `routes/opsIntegrationPricing.js` | **HIGH** | **B** | Pricing sync | Brief sync failures | Sync test | Keep old 1h | PENDING |

---

### 5. FIREBASE & AUTH PROVIDERS

| # | Secret | Provider | Used By | Exposure Risk | Rotation Type | Dependencies | Production Impact | Verification Test | Rollback Plan | Status |
|---|--------|----------|---------|---------------|---------------|--------------|-------------------|-------------------|---------------|--------|
| 16 | **FIREBASE_PRIVATE_KEY** | Firebase | `lib/firebaseAdmin.js` | **CRITICAL** | **D** | Auth sync, custom tokens | Brief auth failures | Dashboard → rotate; test sync | Keep old 24h | PENDING |
| 17 | **FIREBASE_PROJECT_ID** | Firebase | `lib/firebaseAdmin.js` | **MEDIUM** | **D** | Auth config | Brief auth failures | Dashboard → rotate | Instant | PENDING |
| 17 | **FIREBASE_CLIENT_EMAIL** | Firebase | `lib/firebaseAdmin.js` | **MEDIUM** | **D** | Auth config | Brief auth failures | Dashboard → rotate | Instant | PENDING |

---

### 5. BLOCKCHAIN OPERATOR KEYS (CRITICAL - REQUIRE ON-CHAIN MIGRATION)

| # | Secret | Provider | Used By | Exposure Risk | Rotation Type | Dependencies | Production Impact | Verification Test | Rollback Plan | Status |
|---|--------|----------|---------|---------------|---------------|--------------|-------------------|-------------------|---------------|--------|
| 18 | **MINTER_PRIVATE_KEY** | Ethereum/Polygon | `services/minter.js`, `deploy.js` | **CRITICAL** | **C** | **CarbonCreditToken.operator**, **Marketplace.signerWallet**, **CreditLedger.operator**, **KYCRegistry KYC operator** | **Requires on-chain migration** | `setOperator()` on 3 contracts; `addKYCOperator()` | Keep old key until migration verified | **BLOCKED** |
| 19 | **CHAIN_SIGNER_PRIVATE_KEY** | Ethereum/Polygon | `services/chainLogger.js` (logINRTrade, batchLogINRTrades, settleINRTrade) | **CRITICAL** | **C** | **Marketplace.signerWallet** (Marketplace constructor) | **Requires on-chain migration** | `setSignerWallet()` on Marketplace | Keep old key until migration verified | **BLOCKED** |
| 20 | **RELAYER_PRIVATE_KEY** | Ethereum/Polygon | `routes/audit.js`, `routes/auditor-verification.js` (AuditTrail relayer) | **CRITICAL** | **C** | **AuditTrail.relayer** (owner) | **Requires on-chain migration** | Transfer ownership of AuditTrail contract | Keep old key until migration verified | **BLOCKED** |
| 21 | **PRIVATE_KEY (DEPLOYER)** | Ethereum/Polygon | `hardhat.config.js` (deployment only) | **HIGH** | **A** | Contract deployment only | **Remove from runtime** | Not needed at runtime | Remove from production .env | **PENDING** |

---

### 6. FRONTEND CONFIGURATION (PUBLIC BY DESIGN - NO ROTATION NEEDED)

| # | Secret | Provider | Note |
|---|--------|----------|------|
| 22 | REACT_APP_FIREBASE_API_KEY | Firebase | **Public by design** - safe in bundle |
| 23 | REACT_APP_FIREBASE_AUTH_DOMAIN | Firebase | **Public by design** |
| 23 | REACT_APP_FIREBASE_PROJECT_ID | Firebase | **Public by design** |
| 23 | REACT_APP_SUPABASE_URL | Supabase | **Public by design** |
| 23 | REACT_APP_SUPABASE_ANON_KEY | Supabase | **Public by design** (RLS protects data) |
| 23 | REACT_APP_RAZORPAY_KEY_ID | Razorpay | **Public by design** (key ID only) |
| 23 | REACT_APP_SENTRY_DSN | Sentry | **Public by design** |

---

## SUMMARY STATISTICS

| Category | Total | Critical | High | Medium | Low | Blocked (On-chain) |
|----------|-------|----------|------|--------|-----|-------------------|
| **Total Secrets** | **22** | **8** | **6** | **4** | **4** | **3** |
| **Immediate (A)** | 5 | | | | | |
| **Coordinated (B)** | 5 | | | | | |
| **On-chain (C)** | **3** | | | | | |
| **Provider (D)** | 8 | | | | | |
| **Scheduled (E)** | 3 | | | | | |

---

## CRITICAL PATH DEPENDENCIES

```
MINTER_PRIVATE_KEY (C)
    ├── CarbonCreditToken.setOperator()
    ├── Marketplace.setSignerWallet()  [via CHAIN_SIGNER]
    ├── CreditLedger.setOperator()
    └── KYCRegistry.addKYCOperator()

CHAIN_SIGNER_PRIVATE_KEY (C)
    └── Marketplace.setSignerWallet()

RELAYER_PRIVATE_KEY (C)
    └── AuditTrail.transferOwnership()

ERP_CREDS_KEY (E) → TOTP_ENCRYPTION_KEY (E) → JWT_SECRET/REFRESH/COOKIE (B) → Full auth reset
```

---

## VERIFICATION CHECKLIST (PRE-ROTATION)

- [ ] All `.env` files backed up to secure vault
- [ ] All `.env.example` files updated with placeholder names only
- [ ] GitHub Actions secret scanning workflow passing
- [ ] Frontend build passes without secret leakage
- [ ] Backend starts with `REQUIRED_ENV` validation
- [ ] All provider dashboards accessible (Supabase, Razorpay, Pinata, Firebase, Alchemy, Resend, Sentry, Etherscan)
- [ ] On-chain migration scripts tested on Sepolia testnet
- [ ] Rollback procedures documented for each secret
- [ ] Incident response plan reviewed with team
- [ ] Maintenance window scheduled (if Type E required)