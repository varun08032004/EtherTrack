# EtherTrack Production Secret Rotation Runbook

**Version:** 1.0
**Date:** 2024
**Classification:** CONFIDENTIAL - OPERATIONS RUNBOOK
**Status:** READY FOR EXECUTION

---

## ⚠️ CRITICAL RULES

1. **NEVER** print, log, or expose actual secret values
2. **NEVER** commit real credentials to git
3. **NEVER** rotate blockchain keys automatically - manual on-chain verification required
3. **NEVER** run without explicit approval from Platform Lead
4. **ALWAYS** verify old credential is revoked before marking complete
5. **ALWAYS** have rollback plan ready before starting

---

## 📋 EXECUTION ORDER (MUST FOLLOW EXACTLY)

### Phase 0: PREPARATION (Day -1 to Day 0)
**Time:** 2-4 hours  
**Risk:** NONE (preparation only)

| Step | Action | Owner | Verification |
|------|--------|-------|--------------|
| 0.1 | Backup all `.env` files to encrypted vault (1Password/Bitwarden) | Platform Lead | Vault contains all current values |
| 0.2 | Verify all `.env.example` files are up-to-date with placeholder names only | DevOps | `grep -r "your_" *.env.example` returns placeholders only |
| 0.3 | Confirm GitHub secret scanning workflow passes | DevOps | GitHub Actions → Security → Secret scanning = PASS |
| 0.4 | Verify frontend build passes without secret leakage | DevOps | `npm run build` → search build output for secrets |
| 0.5 | Verify backend starts with `REQUIRED_ENV` validation | DevOps | `npm start` → health check 200 |
| 0.6 | Confirm all provider dashboards accessible with current credentials | Platform Lead | Dashboard login test for each provider |
| 0.7 | Review and approve this runbook with Platform Lead | Platform Lead | Signed approval in ticket |
| 0.8 | Schedule maintenance window for Type E rotations (if needed) | DevOps | Calendar invite sent to team |

**GO/NO-GO DECISION:** All Phase 0 checks PASS → Proceed to Phase 1

---

### Phase 1: INFRASTRUCTURE & DATABASE SECRETS (Type A - Zero Downtime)
**Time:** 30-60 minutes  
**Risk:** LOW (pool handles reconnects)

| Step | Secret | Action | Verification | Rollback |
|------|--------|--------|--------------|----------|
| 1.1 | **DATABASE_URL** | 1. Create new Supabase/Postgres password in dashboard<br>2. Update `DATABASE_URL` in `.env`<br>3. Restart backend (rolling) | `curl /health` → 200<br>`SELECT 1` via admin | Keep old password valid 24h |
| 1.2 | **SUPABASE_URL** | Same as DATABASE_URL (same connection string) | Same as 1.1 | Same |
| 1.3 | **REDIS_URL** | 1. Create new Upstash/Redis password<br>2. Update `REDIS_URL` in `.env`<br>3. Restart backend (rolling) | Redis ping → PONG<br>Cache hit/miss ratio normal | Keep old URL 1h |
| 1.4 | **SENTRY_DSN** | Sentry dashboard → Settings → Projects → DSN → Regenerate<br>Update `SENTRY_DSN` in `.env`<br>Restart backend | Sentry dashboard shows events | Instant rollback (swap DSN) |
| 1.5 | **ALCHEMY_RPC / SEPOLIA_RPC_URL** | Create new Alchemy/Ankr key<br>Update `ALCHEMY_RPC` in `.env`<br>Restart backend services | `curl $RPC_URL -X POST -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'` returns block | Instant |

**✅ Phase 1 Gate:** All health checks PASS → Proceed to Phase 2

---

### Phase 2: AUTHENTICATION & SESSION SECRETS (Type B - Requires User Logout)
**Time:** 30-60 minutes  
**Risk:** MEDIUM (Forces all users to re-login)

| Step | Secret | Action | Verification | Rollback |
|------|--------|--------|--------------|----------|
| 2.1 | **JWT_SECRET** | 1. Generate new 64-char hex: `openssl rand -hex 32`<br>2. Update `JWT_SECRET` in `.env`<br>2. Update `JWT_REFRESH_SECRET` similarly<br>3. **Rolling restart** backend (zero-downtime deploy) | 1. Login → cookie set<br>2. `/api/auth/me` returns user<br>3. WebSocket connects | Keep old secret 1h in vault; can decode with both |
| 2.2 | **JWT_REFRESH_SECRET** | Same as 2.1 (part of same deploy) | Refresh flow works; old tokens rejected | Same as above |
| 2.3 | **COOKIE_SECRET** | Same deploy as 2.1 | CSRF token works; cookie parses | Same as above |

**⚠️ CRITICAL:** This will **logout all users**. Schedule during low-traffic window.
**Notification:** Send "Planned maintenance - brief re-login required" email 1h before.

**✅ Phase 2 Gate:** All auth flows PASS → Proceed to Phase 3

---

### Phase 3: ENCRYPTION & 2FA SECRETS (Type E - Scheduled)
**Time:** 60-90 minutes  
**Risk:** HIGH (Breaks 2FA for all users)

| Step | Secret | Action | Verification | Rollback |
|------|--------|--------|--------------|----------|
| 3.1 | **TOTP_ENCRYPTION_KEY** | 1. Generate new 64-char hex: `openssl rand -hex 32`<br>2. Update `TOTP_ENCRYPTION_KEY` in `.env`<br>3. Run migration script to re-encrypt all stored TOTP secrets<br>4. Restart backend | 1. 2FA setup works<br>2. 2FA verify works<br>3. `lib/totpEncryption.js` validateEncryptionKey() passes | Keep old key in vault; re-encrypt with new if needed |

**⚠️ CRITICAL:** This **breaks 2FA for ALL users** until they re-enroll.
**Communication:** Send "Security upgrade - re-enable 2FA" email immediately after.
**Support:** Have support team ready for 2FA recovery requests.

**✅ Phase 3 Gate:** 2FA setup/verify works for test account → Proceed to Phase 4

---

### Phase 4: EXTERNAL PROVIDER SECRETS (Type D - Dashboard Rotation)
**Time:** 60-120 minutes  
**Risk:** LOW-MEDIUM (Provider-side coordination)

| Step | Secret | Provider | Action | Verification | Rollback |
|------|--------|----------|--------|--------------|----------|
| 4.1 | **SUPABASE_SERVICE_ROLE_KEY** | Supabase Dashboard → Settings → API → Regenerate | Admin create user works; Storage upload works | Keep old key 24h in vault |
| 4.2 | **RAZORPAY_KEY_SECRET** | Razorpay Dashboard → Settings → API Keys → Regenerate | Test deposit/withdraw; Webhook signature verifies | Keep old 24h |
| 4.3 | **RAZORPAY_WEBHOOK_SECRET** | Razorpay Dashboard → Webhooks → Regenerate | Test webhook delivery; signature verifies | Keep old 24h |
| 4.4 | **RAZORPAY_KEY_ID** | Razorpay Dashboard → Regenerate | Frontend payment UI loads | Instant |
| 4.5 | **PINATA_API_KEY** | Pinata Dashboard → API Keys → Regenerate | Test file pin; gateway resolves | Keep old 24h |
| 4.6 | **PINATA_SECRET_KEY** | Pinata Dashboard → Regenerate | Test file pin; gateway resolves | Keep old 24h |
| 4.7 | **RESEND_API_KEY** | Resend Dashboard → API Keys → Regenerate | Test email send | Keep old 24h |
| 4.8 | **SMTP_PASS** | SendGrid/SES Console → Regenerate | Test email send via SMTP | Keep old 24h |
| 4.9 | **FIREBASE_PRIVATE_KEY** | Firebase Console → Service Accounts → Generate new key | Download JSON; test `lib/firebaseAdmin.js` init | Keep old 24h |
| 4.10 | **FIREBASE_PROJECT_ID / CLIENT_EMAIL** | Firebase Console → Project Settings | Auth sync works | Instant |
| 4.11 | **ETHERSCAN_API_KEY** | Etherscan Dashboard → API Keys | Verification script works | Instant |
| 4.12 | **OPS_SYNC_SERVICE_TOKEN** | Internal - regenerate in vault; update ERP | ERP sync test | Keep old 1h |
| 4.13 | **PLATFORM_SYNC_*_WRITE_TOKEN** | Internal - regenerate in vault | Corporate/coupon/pricing sync tests | Keep old 1h |

**⚠️ Note:** Rotate one provider at a time. Verify each before moving to next.

**✅ Phase 4 Gate:** All provider tests PASS → Proceed to Phase 5

---

### Phase 5: BLOCKCHAIN OPERATOR KEY MIGRATION (Type C - On-Chain)
**Time:** 2-4 hours (includes on-chain verification)  
**Risk:** CRITICAL - Requires manual on-chain transactions

**⚠️ MANDATORY:** Test ALL migrations on Sepolia testnet FIRST

#### 5.1 MINTER_PRIVATE_KEY Migration
**Contracts affected:** `CarbonCreditToken`, `Marketplace`, `CreditLedger`, `KYCRegistry`

**Migration Sequence (Sepolia Testnet First):**
```bash
# 1. Generate new minter key
openssl rand -hex 32  # → NEW_MINTER_KEY

# 2. Fund new wallet with testnet ETH/MATIC
# 2. Fund new wallet with testnet ETH/MATIC

# 3. On each contract, call setOperator(newWallet)
# CarbonCreditToken:
cast send <CARBON_CREDIT_TOKEN> "setOperator(address)" <NEW_WALLET> --rpc-url $SEPOLIA_RPC --private-key $DEPLOYER_KEY

# Marketplace:
cast send <MARKETPLACE> "setSignerWallet(address)" <NEW_WALLET> --rpc-url $SEPOLIA_RPC --private-key $DEPLOYER_KEY

# CreditLedger:
cast send <CREDIT_LEDGER> "setOperator(address)" <NEW_WALLET> --rpc-url $SEPOLIA_RPC --private-key $DEPLOYER_KEY

# KYCRegistry:
cast send <KYC_REGISTRY> "addKYCOperator(address)" <NEW_WALLET> --rpc-url $SEPOLIA_RPC --private-key $DEPLOYER_KEY
```

**Verification (Sepolia):**
- [ ] `CarbonCreditToken.operator()` returns new wallet
- [ ] `Marketplace.signerWallet()` returns new wallet
- [ ] `CreditLedger.operator()` returns new wallet
- [ ] `KYCRegistry.kycOperators(newWallet)` returns true
- [ ] Test mint → list → trade → retire flow works with new operator

**Production Migration (after Sepolia success):**
```bash
# Repeat same sequence on Polygon Mainnet
# Update MINTER_PRIVATE_KEY in backend .env
# Rolling restart backend
```

**Verification (Production):**
- [ ] Mint test batch → token appears on-chain
- [ ] List credits → listing appears on Marketplace
- [ ] Settle INR trade → tokens transfer to buyer
- [ ] Retire credits → retirement recorded on-chain
- [ ] KYC approval → on-chain verification works

**Rollback:** Keep old key in vault for 48h. If issues, revert `.env` and restart.

---

#### 5.2 CHAIN_SIGNER_PRIVATE_KEY Migration
**Contracts affected:** `Marketplace` (signerWallet)

```bash
# 1. Generate new key
openssl rand -hex 32  # → NEW_CHAIN_SIGNER_KEY

# 2. Fund with testnet MATIC

# 3. Update Marketplace signer
cast send <MARKETPLACE> "setSignerWallet(address)" <NEW_WALLET> --rpc-url $POLYGON_RPC --private-key $DEPLOYER_KEY

# Update CHAIN_SIGNER_PRIVATE_KEY in backend .env
# Rolling restart backend
```

**Verification:**
- [ ] `Marketplace.signerWallet()` returns new wallet
- [ ] `logINRTrade` works (test trade settlement)
- [ ] `batchLogINRTrades` works (batch cron)
- [ ] `settleINRTrade` works (INR trade settlement)

---

#### 5.3 RELAYER_PRIVATE_KEY Migration
**Contracts affected:** `AuditTrail` (owner/relayer)

```bash
# 1. Generate new key
openssl rand -hex 32  # → NEW_RELAYER_KEY

# 2. Transfer AuditTrail ownership
cast send <AUDIT_TRAIL> "transferOwnership(address)" <NEW_WALLET> --rpc-url $SEPOLIA_RPC --private-key $DEPLOYER_KEY

# Update RELAYER_PRIVATE_KEY in backend .env
```

**Verification:**
- [ ] `AuditTrail.owner()` returns new wallet
- [ ] `logEntry()` works (audit logging)
- [ ] `lockInventory()` works
- [ ] Auditor verification flow works

---

#### 5.4 DEPLOYER PRIVATE_KEY (Runtime Removal)
**Action:** Remove from production runtime `.env` (deployment only)

```bash
# 1. Verify PRIVATE_KEY not used in any runtime code (grep -r "PRIVATE_KEY" --include="*.js" | grep -v "hardhat.config" | grep -v ".env")
# 2. Remove PRIVATE_KEY from production .env
# 3. Keep in secure vault for future deployments only
```

**Verification:** `grep -r "PRIVATE_KEY" --include="*.js" ethertrack-backend/` returns only hardhat.config.js references.

---

### Phase 6: PROVIDER CONFIGURATION (Frontend & Backend Sync)
**Time:** 30 minutes  
**Risk:** LOW

| Step | Action | Verification |
|------|--------|--------------|
| 6.1 | Update Vercel/Netlify/Cloudflare env vars for frontend (REACT_APP_*) | Frontend build passes; no console errors |
| 6.2 | Update Render/Railway/Cloud Run env vars for backend | Health check 200; all routes respond |
| 6.3 | Update GitHub Actions secrets (if any) | Workflow passes |
| 6.4 | Update any Kubernetes/Docker secrets | Pods restart cleanly |

---

### Phase 7: CLEANUP & VALIDATION
**Time:** 30 minutes  
**Risk:** LOW

| Step | Action | Verification |
|------|--------|--------------|
| 7.1 | Remove all old `.env` values from vault (keep only current) | Vault audit shows only current values |
| 7.2 | Run secret scan on repo (gitleaks) | `gitleaks detect --source . --config .gitleaks.toml` → 0 real findings |
| 7.3 | Run frontend build | `npm run build` → no secrets in build output |
| 7.4 | Run backend startup | `npm start` → health check 200 |
| 7.4 | Run smoke tests (smoke test suite) | All critical paths green |
| 7.5 | Confirm old credentials revoked in all provider dashboards | Provider dashboards show only new keys active |

---

## 🔄 ROLLBACK PROCEDURES

### Universal Rollback (Any Phase)
```bash
# 1. Restore .env from vault backup
cp /vault/backup/.env.production.backup ethertrack-backend/.env
cp /vault/backup/.env.production.frontend.backup ethertrack-frontend/.env

# 2. Restart services
pm2 restart all  # or kubectl rollout restart deployment/etherTrack-backend

# 3. Verify health
curl https://api.ethertrack.in/health
```

### Phase-Specific Rollbacks

| Phase | Rollback Trigger | Time to Rollback |
|-------|------------------|------------------|
| 1-2 | Health check fails 3x in 5 min | < 5 min |
| 3 | 2FA broken for >50% users | < 10 min (re-encrypt with old key) |
| 4 | Provider API errors >5% | < 5 min per provider |
| 5 | On-chain tx fails / reverts | < 30 min (manual tx) |
| 5 | Verification fails | Immediate (revert .env) |

---

## 📋 FINAL SIGN-OFF CHECKLIST

| Item | Owner | Status | Evidence |
|------|-------|--------|----------|
| All secrets rotated per matrix | Platform Lead | ☐ | Provider dashboard screenshots |
| Old credentials revoked | DevOps | ☐ | Provider dashboards show revoked |
| Old credentials removed from vault | Security | ☐ | Vault audit log |
| Git history scanned (gitleaks) | DevOps | ☐ | CI log |
| Frontend build clean | Frontend Lead | ☐ | Build log |
| Backend health checks pass | DevOps | ☐ | Health endpoint logs |
| Smoke tests pass | QA Lead | ☐ | Test report |
| On-chain migrations verified (Sepolia + Mainnet) | Blockchain Lead | ☐ | Tx hashes + explorer links |
| Old credentials confirmed revoked | Platform Lead | ☐ | Provider dashboards |
| Incident response plan updated | Security | ☐ | Document link |
| Team notified of completion | Platform Lead | ☐ | Slack/email |

---

## 🚨 EMERGENCY CONTACTS

| Role | Name | Contact | Escalation |
|------|------|---------|------------|
| Platform Lead | | | Immediate |
| Blockchain Lead | | | 15 min |
| DevOps Lead | | | 10 min |
| Security Lead | | | 5 min |
| Provider Support | Supabase/Razorpay/Pinata/Firebase/Alchemy | | Varies |

---

## 📝 POST-ROTATION AUDIT (Within 24h)

- [ ] All provider billing shows new keys active
- [ ] No failed auth/payment/webhook events in logs
- [ ] Carbon credit mint/list/trade/retire flow works end-to-end
- [ ] KYC approval → on-chain verification works
- [ ] Auditor verification flow works
- [ ] ERP sync completes without errors
- [ ] No 5xx errors in backend logs
- [ ] No authentication failures in Sentry
- [ ] Carbon credit balances reconcile on-chain vs DB

---

**RUNBOOK VERSION:** 1.0  
**LAST UPDATED:** 2024  
**NEXT REVIEW:** Before next rotation cycle  
**APPROVED BY:** [Platform Lead Signature]  

---

**END OF RUNBOOK**