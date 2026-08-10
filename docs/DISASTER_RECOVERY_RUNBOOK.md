# EtherTrack Disaster Recovery Runbook
**Version:** 1.0  
**Last Updated:** 2026-08-10  
**Classification:** CONFIDENTIAL - Internal Use Only  
**Owner:** Platform Engineering  
**Review Cycle:** Quarterly  

---

## 📋 Executive Summary

This runbook defines the disaster recovery (DR) procedures for EtherTrack production systems. It establishes Recovery Time Objectives (RTO), Recovery Point Objectives (RPO), and step-by-step recovery procedures for various failure scenarios.

**Scope:** Production API, Database, Blockchain listeners, Background workers  
**Environment:** Supabase (PostgreSQL), Render (Node.js), Sepolia/Polygon RPC

---

## ⏱️ RTO / RPO Definitions

| Service Tier | Component | RTO | RPO | Backup Method |
|--------------|-----------|-----|-----|---------------|
| **Tier 1 (Critical)** | PostgreSQL Database (Supabase) | **15 min** | **< 1 min** | Supabase PITR (continuous) + Daily JSON backup |
| **Tier 1 (Critical)** | Wallet balances & transactions | **15 min** | **< 1 min** | PITR + CreditLedger reconciliation |
| **Tier 1 (Critical)** | Subscription payments | **30 min** | **< 5 min** | PITR + Daily JSON backup |
| **Tier 2 (Important)** | Trade settlements | **1 hour** | **< 15 min** | PITR + Daily JSON backup + On-chain verification |
| **Tier 2 (Important)** | KYC submissions | **2 hours** | **< 1 hour** | PITR + Daily JSON backup |
| **Tier 3 (Standard)** | User profiles, projects, batches | **4 hours** | **< 4 hours** | PITR + Daily JSON backup |
| **Tier 3 (Standard)** | Audit logs, admin actions | **24 hours** | **< 24 hours** | PITR only |
| **External** | Blockchain state (Sepolia/Polygon) | **N/A** | **N/A** | Immutable on-chain |

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     PRODUCTION ENVIRONMENT                   │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   Render     │    │  Supabase    │    │   External   │  │
│  │  (Node.js)   │◄──►│  (PostgreSQL)│    │   Services   │  │
│  │              │    │              │    │              │  │
│  │ • API        │    │ • PITR       │    │ • Razorpay   │  │
│  │ • Workers    │    │ • Replicas   │    │ • Pinata     │  │
│  │ • Cron       │    │ • Backups    │    │ • Alchemy    │  │
│  └──────────────┘    └──────────────┘    │ • Firebase   │  │
│        │                   │             └──────────────┘  │
│        └───────────────────┼──────────────────────────────┘
│                            ▼
│                  ┌──────────────────┐
│                  │  Local Backups   │
│                  │  (JSON + gzip)   │
│                  │  Supabase Storage│
│                  └──────────────────┘
└─────────────────────────────────────────────────────────────┘
```

---

## 🚨 Incident Classification

| Severity | Definition | Examples | Escalation |
|----------|------------|----------|------------|
| **SEV-1** | Complete service outage, data loss risk | DB down, PITR failed, blockchain fork | Page on-call + CTO within 5 min |
| **SEV-2** | Major functionality degraded | Payment processing down, minting stuck | Page on-call within 15 min |
| **SEV-3** | Minor degradation, workaround exists | Slow queries, non-critical cron failed | Ticket + fix in sprint |
| **SEV-4** | Cosmetic / non-prod | Dev env issue, docs outdated | Backlog |

---

## 🔄 Recovery Procedures

### Scenario 1: Database Primary Failure (Supabase Outage)

**Detection:** Health check `/health` returns 503, Supabase status page shows incident  
**RTO Target:** 15 minutes  
**RPO Target:** < 1 minute (PITR)

#### Steps:

1. **Confirm Supabase Status** (2 min)
   ```bash
   # Check Supabase status page
   curl -s https://status.supabase.com/api/v2/status.json | jq .
   
   # Verify DNS resolution
   dig +short db.xxxxx.supabase.co
   ```

2. **Activate Read Replica** (5 min)
   ```bash
   # Supabase auto-failover typically < 60s
   # Verify connection to new primary
   psql "postgresql://postgres:password@new-primary.supabase.co:5432/postgres" -c "SELECT now();"
   ```

3. **Update Application Config** (3 min)
   ```bash
   # If DNS hasn't updated, update DATABASE_URL in Render
   render env:set DATABASE_URL="postgresql://..." --app ethertrack-api
   render deploy ethertrack-api --yes
   ```

4. **Verify Data Integrity** (5 min)
   ```bash
   # Run reconciliation
   node scripts/verify-pitr.js
   
   # Check critical tables
   psql $DATABASE_URL -c "
     SELECT 'wallet_transactions' as t, count(*) FROM wallet_transactions
     UNION ALL SELECT 'subscription_payments', count(*) FROM subscription_payments
     UNION ALL SELECT 'trades', count(*) FROM trades
     UNION ALL SELECT 'credit_ledger_balances', count(*) FROM credit_ledger_balances;
   "
   ```

5. **Smoke Test Critical Flows** (10 min)
   - Wallet balance check
   - Deposit/withdrawal flow
   - Subscription purchase
   - Trade settlement

**Rollback:** If new primary has issues, Supabase supports point-in-time recovery to any second within retention window.

---

### Scenario 2: Accidental Data Deletion / Corruption

**Detection:** Application errors, missing records, audit log shows DELETE  
**RTO Target:** 30 minutes  
**RPO Target:** < 5 minutes (PITR)

#### Steps:

1. **Stop Writes to Affected Tables** (2 min)
   ```sql
   -- Temporarily revoke write access
   REVOKE INSERT, UPDATE, DELETE ON wallet_transactions FROM app_user;
   REVOKE INSERT, UPDATE, DELETE ON subscription_payments FROM app_user;
   ```

2. **Identify Deletion Time & Scope** (5 min)
   ```sql
   -- Check audit log
   SELECT * FROM admin_audit_log 
   WHERE action IN ('DELETE', 'TRUNCATE') 
   AND created_at > NOW() - INTERVAL '1 hour'
   ORDER BY created_at DESC;
   ```

3. **PITR Restore to New Database** (15 min)
   ```bash
   # In Supabase Dashboard:
   # 1. Go to Settings > Database > Point-in-Time Recovery
   # 2. Select timestamp before deletion (e.g., 5 min before)
   # 3. Restore to NEW project (not overwrite production!)
   # 4. Note new connection string
   ```

4. **Extract & Restore Affected Data** (10 min)
   ```bash
   # From restored DB, export affected tables
   pg_dump -t wallet_transactions -t subscription_payments \
     "postgresql://restored-db" > restore_data.sql
   
   # Import to production (upsert on PK)
   psql $DATABASE_URL < restore_data.sql
   ```

5. **Verify & Re-enable Writes** (5 min)
   ```sql
   GRANT INSERT, UPDATE, DELETE ON wallet_transactions TO app_user;
   GRANT INSERT, UPDATE, DELETE ON subscription_payments TO app_user;
   
   # Run reconciliation
   node -e "require('./services/creditLedger').reconcileAllBalances()"
   ```

---

### Scenario 3: Blockchain RPC / Contract Issues

**Detection:** `blockchain.enabled` feature flag false, health check fails, on-chain transactions failing  
**RTO Target:** 1 hour (fallback to INR-only)  
**RPO Target:** N/A (on-chain immutable)

#### Steps:

1. **Auto-Failover to INR-Only** (Automatic - 0 min)
   ```bash
   # Feature flag system detects unhealthy RPC/contract
   # Sets blockchain.enabled=false, inrOnlyMode=true
   # Verify via admin API:
   curl -H "Authorization: Bearer $ADMIN_TOKEN" \
     https://api.ethertrack.in/api/admin/feature-flags
   ```

2. **Diagnose RPC/Contract** (15 min)
   ```bash
   # Check RPC
   curl -X POST $ALCHEMY_RPC \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
   
   # Check contract deployment
   curl -X POST $ALCHEMY_RPC \
     -H "Content-Type: application/json" \
     -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getCode\",\"params\":[\"$MARKETPLACE_ADDRESS\",\"latest\"],\"id\":1}"
   ```

3. **If Contract Issue - Redeploy** (45 min)
   ```bash
   # Deploy new Marketplace contract
   cd contracts && npx hardhat deploy --network sepolia
   
   # Update env vars
   render env:set MARKETPLACE_ADDRESS="0xNew..." --app ethertrack-api
   render env:set CREDIT_LEDGER_ADDRESS="0xNew..." --app ethertrack-api
   
   # Re-enable blockchain
   curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
     -d '{"value":true}' \
     https://api.ethertrack.in/api/admin/feature-flags/blockchain.enabled
   ```

4. **Replay Pending Chain Logs** (10 min)
   ```bash
   node -e "require('./services/chainLogger').batchLogPending()"
   node -e "require('./services/chainLogger').retryPendingLogs()"
   ```

---

### Scenario 4: Render (API) Outage

**Detection:** Health checks fail, Render status page shows incident  
**RTO Target:** 30 minutes  
**RPO Target:** 0 (stateless API)

#### Steps:

1. **Verify Render Status** (2 min)
   - Check https://status.render.com

2. **Deploy to Backup Region** (15 min)
   ```bash
   # If using Render, deploy to different region
   render deploy ethertrack-api --region frankfurt --yes
   
   # Update DNS if needed (Cloudflare)
   # Or use Render's built-in failover
   ```

3. **Verify Environment Variables** (5 min)
   ```bash
   render env --app ethertrack-api
   # Ensure all secrets present
   ```

4. **Smoke Test** (5 min)
   - Health endpoint
   - Auth flow
   - Critical API endpoints

---

### Scenario 5: Complete Region Failure (Multi-AZ)

**Detection:** Both primary and backup regions down  
**RTO Target:** 4 hours  
**RPO Target:** < 24 hours (daily backup)

#### Steps:

1. **Provision New Infrastructure** (2 hours)
   ```bash
   # New Render service in different cloud provider (AWS/GCP)
   # New Supabase project in different region
   ```

2. **Restore from Daily Backup** (1 hour)
   ```bash
   # Download latest manifest from Supabase Storage
   # Restore critical tables using restore script
   node scripts/restore-from-backup.js --manifest latest --tables wallet_transactions,subscription_payments,trades,users,credit_ledger_balances
   ```

3. **Reconfigure DNS & Secrets** (30 min)
   ```bash
   # Update Cloudflare DNS to new API endpoint
   # Update all env vars in new Render service
   ```

4. **Full System Verification** (30 min)
   - All critical user flows
   - Blockchain listeners
   - Cron jobs

---

### Scenario 6: Secrets Compromise

**Detection:** Unauthorized access, unusual API usage, provider alerts  
**RTO Target:** 1 hour  
**RPO Target:** 0 (no data loss)

#### Steps:

1. **Immediate Rotation** (15 min)
   ```bash
   # Rotate all compromised secrets
   # Priority order:
   # 1. DATABASE_URL (Supabase)
   # 2. JWT_SECRET, JWT_REFRESH_SECRET
   # 3. RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
   # 4. PINATA_API_KEY, PINATA_SECRET_KEY
   # 5. FIREBASE_PRIVATE_KEY
   # 6. ALCHEMY_RPC (if compromised)
   # 7. Blockchain private keys (MINTER, CHAIN_SIGNER, RELAYER) - requires on-chain migration
   ```

2. **Revoke Old Credentials** (15 min)
   - Supabase: Settings > Database > Reset password
   - Razorpay: Dashboard > Settings > API Keys > Regenerate
   - Pinata: Dashboard > API Keys > Revoke & Create New
   - Firebase: Console > Project Settings > Service Accounts > Generate New Key

3. **Deploy with New Secrets** (20 min)
   ```bash
   render env:set KEY="new_value" --app ethertrack-api
   render deploy ethertrack-api --yes
   ```

4. **Audit Access Logs** (10 min)
   - Check Supabase logs for unauthorized queries
   - Check Razorpay webhook logs
   - Review admin_audit_log for suspicious activity

---

## 📦 Backup Verification Schedule

| Frequency | Check | Owner |
|-----------|-------|-------|
| **Daily** | Backup cron success (logs) | On-call |
| **Daily** | Manifest exists in Supabase Storage | On-call |
| **Weekly** | Restore test (dev environment) | Platform Eng |
| **Monthly** | Full DR drill (staging) | Platform Eng + CTO |
| **Quarterly** | RTO/RPO measurement & update | Platform Eng |

---

## 📞 Communication Plan

| Audience | Channel | Trigger | Template |
|----------|---------|---------|----------|
| **Internal (Engineering)** | Slack #incidents | SEV-1/2 declared | `INCIDENT: [SEV-X] [Component] - [Impact]` |
| **Internal (All)** | Email | SEV-1 > 30 min | Status page link + ETA |
| **Customers** | Status page + Email | SEV-1 > 1 hour | Acknowledgment + Impact + ETA |
| **Partners (Razorpay, etc.)** | Direct contact | API affecting them | Technical details + workaround |

**Status Page:** https://status.ethertrack.in (configured via PagerDuty/StatusPage.io)

---

## 📝 Post-Incident Process

1. **Incident Review Meeting** (within 48 hours)
   - Timeline reconstruction
   - Root cause analysis (5 Whys)
   - Action items with owners & deadlines

2. **Update Runbook** (within 1 week)
   - Add new scenarios
   - Improve procedures
   - Update RTO/RPO if measured different

3. **Share Learnings** (within 2 weeks)
   - Engineering blog post (internal)
   - Architecture decision record (ADR)

---

## 🔗 Related Documents

- [Production Readiness Checklist](../PRODUCTION_READINESS.md)
- [Secret Rotation Runbook](./PRODUCTION_SECRET_ROTATION_RUNBOOK.md)
- [Backup Scripts](../ethertrack-backend/scripts/backup-critical-data.js)
- [Restore Scripts](../ethertrack-backend/scripts/restore-from-backup.js)
- [Feature Flags](../ethertrack-backend/lib/featureFlags.js)

---

## ✅ Quick Reference Cards

### **SEV-1 Checklist** (First 15 min)
- [ ] Acknowledge in Slack #incidents
- [ ] Identify affected component
- [ ] Check Supabase/Render status pages
- [ ] Execute relevant recovery procedure
- [ ] Page CTO if > 10 min
- [ ] Update status page

### **PITR Restore Quick Commands**
```bash
# 1. Find timestamp
# 2. Supabase Dashboard > PITR > Restore to new project
# 3. Get new connection string
# 4. Export needed tables
pg_dump -t table1 -t table2 "new-db-url" > restore.sql
# 5. Import to production (upsert)
psql $DATABASE_URL < restore.sql
# 6. Verify reconciliation
node -e "require('./services/creditLedger').reconcileAllBalances()"
```

### **Feature Flag Emergency Toggle**
```bash
# Disable blockchain (INR-only mode)
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"value":false}' \
  https://api.ethertrack.in/api/admin/feature-flags/blockchain.enabled

# Re-enable after fix
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"value":true}' \
  https://api.ethertrack.in/api/admin/feature-flags/blockchain.enabled
```

---

**Document Control:**  
- **Author:** Platform Engineering  
- **Approved By:** CTO  
- **Next Review:** 2026-11-10  
- **Location:** GitHub `docs/DISASTER_RECOVERY_RUNBOOK.md`