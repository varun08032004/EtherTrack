# EtherTrack Production Readiness Checklist

**Version:** 1.0  
**Last Updated:** 2024  
**Status:** ACTIVE - Reference for production readiness tracking

---

## 📋 SECURITY CHECKLIST (SEC)

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| **SEC-001** | Frontend credential/configuration exposure remediation | ✅ **VERIFIED** | P0 | Firebase/Supabase config moved to env vars; Razorpay secret removed from frontend |
| **SEC-001A** | Production secret rotation & containment | 🔄 **IN_PROGRESS** | P0 | **BLOCKED** - Requires manual rotation in provider dashboards + blockchain key migrations |
| **SEC-002** | Single hot wallet controls all operator functions | ✅ **TESTNET DONE** | P0 | TimelockController deployed on Sepolia; all 6 contracts transferred to timelock |
| **SEC-003** | CSRF protection gaps on state-changing endpoints | ✅ **FIXED** | P1 | Removed 7 prefixes from CSRF_SKIP_PREFIX; 36 endpoints now protected |
| **SEC-004** | SQL injection / parameterized queries audit | ✅ **VERIFIED** | P1 | 230+ queries scanned; all parameterized; explicit whitelists added |
| **SEC-005** | XSS / input sanitization audit | ✅ **VERIFIED** | P1 | React auto-escapes; no dangerouslySetInnerHTML; sanitizeUrl() for links |
| **SEC-006** | IDOR / BOLA (Broken Object Level Authorization) | ✅ **FIXED** | P1 | Added project ownership check to /batches/:id/tokenise; all routes verified |
| **SEC-007** | Rate limiting coverage | ✅ **FIXED** | P1 | Tiered limiters: assetAction (15/min), writeLimiter (30/min), walletAction (20/min), server prefixes |
| **SEC-008** | Secrets in git history | ⚠️ **IN_PROGRESS** | P0 | Rotation matrix created; manual rotation needed |
| **SEC-009** | Firebase Auth / Supabase RLS configuration | 🔍 **OPEN** | P1 | Verify RLS policies on all tables |
| **SEC-010** | Webhook signature verification | 🔍 **OPEN** | P1 | Razorpay, Pinata, Resend webhooks |

---

## 💰 FINANCIAL CORRECTNESS CHECKLIST (FIN)

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| **FIN-001** | Double-spend prevention (concurrent trade settlement) | ✅ **COMPLETE** | P0 | Idempotency keys, advisory locks, FOR UPDATE locks in trades.js |
| **FIN-002** | Oversell prevention (credit balance checks) | ✅ **COMPLETE** | P0 | FOR UPDATE locks, advisory locks, GREATEST(0, ...) checks |
| **FIN-003** | Negative balance prevention | ✅ **COMPLETE** | P0 | DB CHECK constraints, adjustLedger validation |
| **FIN-004** | Duplicate payment prevention | ✅ **COMPLETE** | P0 | Idempotency keys on all payment operations |
| **FIN-005** | Duplicate trade prevention | ✅ **COMPLETE** | P0 | Idempotency keys + DB unique constraint on trades |
| **FIN-006** | Duplicate withdrawal prevention | ✅ **COMPLETE** | P0 | Idempotency key on withdrawal endpoint + DB check |
| **FIN-007** | Fee calculation accuracy | ✅ **VERIFIED** | P1 | calcFees(): 1% total, 50/50 split, GST 18% on fee only |
| **FIN-008** | GST/tax calculation accuracy | ✅ **VERIFIED** | P1 | getGSTType() CGST/SGST vs IGST by state code |
| **FIN-009** | Settlement atomicity (DB + blockchain) | ✅ **VERIFIED** | P0 | withTransaction, FOR UPDATE, advisory locks |
| **FIN-010** | Reconciliation (on-chain vs DB balances) | ✅ **COMPLETE** | P1 | Reconciliation cron, wallet/ledger/ledger/carbon ownership |

---

## 🏗️ ARCHITECTURE & RELIABILITY (ARC)

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| **ARC-001** | Database connection pooling & limits | ✅ **COMPLETE** | P1 | Pool size: 10 (Supabase free tier); pg Pool with health monitoring, retry logic, connection limits |
| **ARC-002** | Read replicas / query optimization | 🔍 **OPEN** | P2 | N+1 query audit; consider read replicas for read-heavy workloads |
| **ARC-003** | Circuit breakers for external APIs | 🔍 **OPEN** | P1 | Razorpay, Pinata, Alchemy, Firebase - need circuit breaker pattern |
| **ARC-004** | Graceful degradation (feature flags) | 🔍 **OPEN** | P2 | Blockchain down → INR-only mode; feature flag system needed |
| **ARC-005** | Idempotency keys on all mutations | ✅ **COMPLETE** | P0 | DB UNIQUE constraints on trades, wallet_transactions, subscription_payments, kyc_idempotency_keys; routes updated |
| **ARC-006** | Structured logging & correlation IDs | 🔍 **OPEN** | P1 | Request ID propagation via middleware |
| **ARC-007** | Health checks (DB, Redis, RPC, external APIs) | ✅ **COMPLETE** | P1 | `/health` endpoint with DB, pool, uptime checks |
| **ARC-008** | Graceful shutdown / connection draining | ✅ **COMPLETE** | P1 | SIGTERM/SIGINT handling with 10s timeout, pool.end() |
| **ARC-009** | Backup / PITR strategy | 🔍 **OPEN** | P1 | Supabase PITR enabled; need custom backup scripts |
| **ARC-010** | Disaster recovery runbook | 🔍 **OPEN** | P1 | RTO/RPO definitions; recovery procedures documentation |

---

## 📈 PERFORMANCE & SCALABILITY (PERF)

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| **PERF-001** | N+1 query elimination | 🔍 **OPEN** | P1 | N+1 in emissions, portfolio, marketplace |
| **PERF-002** | Pagination (cursor-based) | 🔍 **OPEN** | P1 | All list endpoints |
| **PERF-003** | Materialized views / caching | 🔍 **OPEN** | P1 | Market stats, emissions summaries |
| **PERF-004** | Blockchain RPC optimization | 🔍 **OPEN** | P1 | WebSocket subscriptions vs polling |
| **PERF-005** | PDF generation off main thread | 🔍 **OPEN** | P1 | Puppeteer pool / job queue |
| **PERF-006** | ERP sync batching | 🔍 **OPEN** | P2 | Batch upserts vs row-by-row |
| **PERF-007** | Bundle size optimization | 🔍 **OPEN** | P2 | 687kB gzipped main.js |
| **PERF-008** | Redis caching strategy | 🔍 **OPEN** | P1 | User cache, stats cache, price cache |

---

## 🧪 TESTING & QUALITY (TEST)

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| **TEST-001** | Unit tests (backend) | ⏳ **OPEN** | P1 | Jest + Supertest |
| **TEST-002** | Integration tests (API) | ⏳ **OPEN** | P1 | Test DB + testnet RPC |
| **TEST-003** | Frontend component tests | ⏳ **OPEN** | P2 | React Testing Library |
| **TEST-004** | E2E tests (Cypress/Playwright) | ⏳ **OPEN** | P2 | Critical user flows |
| **TEST-005** | Concurrency tests | ⏳ **OPEN** | P0 | Trade settlement race conditions |
| **TEST-005** | Load testing (k6/artillery) | ⏳ **OPEN** | P1 | 1000 concurrent users |
| **TEST-006** | Contract fuzzing (Echidna/Foundry) | ⏳ **OPEN** | P0 | Invariant testing |
| **TEST-007** | Secret scanning in CI | ✅ **VERIFIED** | P0 | Gitleaks in GitHub Actions |
| **TEST-008** | Dependency scanning (Snyk/Dependabot) | ⏳ **OPEN** | P1 | npm audit + Snyk |

---

## 📋 COMPLIANCE & OBSERVABILITY (CMP)

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| **CMP-001** | SOC 2 Type II readiness | ⏳ **OPEN** | P2 | Policies, evidence collection |
| **CMP-002** | GDPR / DPDP compliance | ⏳ **OPEN** | P2 | Data deletion, consent, DPA |
| **CMP-003** | PCI DSS (Razorpay scope) | ⏳ **OPEN** | P1 | SAQ A-EP |
| **CMP-004** | Audit logging (immutable) | 🔍 **OPEN** | P1 | AuditTrail contract + DB logs |
| **CMP-005** | Metrics (Prometheus/Grafana) | ⏳ **OPEN** | P1 | Latency, error rate, throughput |
| **CMP-006** | Alerting (PagerDuty/Slack) | ⏳ **OPEN** | P1 | P99 latency, error rate, queue depth |
| **CMP-007** | Distributed tracing (Jaeger/Zipkin) | ⏳ **OPEN** | P2 | OpenTelemetry |
| **CMP-008** | Secrets scanning in CI | ✅ **VERIFIED** | P0 | Gitleaks GitHub Actions |
| **CMP-009** | Dependency scanning | ⏳ **OPEN** | P1 | Snyk/Dependabot |
| **CMP-010** | Incident response plan | ⏳ **OPEN** | P1 | Runbook + escalation |

---

## 🚀 DEPLOYMENT & OPERATIONS (OPS)

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| **OPS-001** | Blue-green / rolling deployments | ⏳ **OPEN** | P1 | Zero-downtime deploys |
| **OPS-002** | Database migration strategy | ⏳ **OPEN** | P1 | Versioned migrations + rollback |
| **OPS-003** | Feature flags (LaunchDarkly/Unleash) | ⏳ **OPEN** | P2 | Kill switches |
| **OPS-004** | Secret rotation automation | 🔄 **IN_PROGRESS** | P0 | Runbook created, manual for now |
| **OPS-005** | Log aggregation (ELK/Loki) | ⏳ **OPEN** | P1 | Structured JSON logs |
| **OPS-006** | On-call rotation & escalation | ⏳ **OPEN** | P1 | PagerDuty / Slack |
| **OPS-007** | Capacity planning | ⏳ **OPEN** | P2 | DB connections, RPC limits |
| **OPS-008** | Cost monitoring & alerts | ⏳ **OPEN** | P2 | RPC, DB, bandwidth |

---

## 🔗 BLOCKCHAIN SPECIFIC (BC)

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| **BC-001** | Contract upgradeability (proxy pattern) | 🔍 **OPEN** | P1 | UUPS / Transparent proxy |
| **BC-002** | Multi-sig / timelock for admin functions | ⏳ **OPEN** | P0 | Gnosis Safe |
| **BC-003** | Contract verification (Etherscan/Polygonscan) | 🔍 **OPEN** | P1 | Automated in CI |
| **BC-004** | Event indexing / subgraph (The Graph) | 🔍 **OPEN** | P1 | Replace polling |
| **BC-005** | Gas optimization / estimation | 🔍 **OPEN** | P1 | ViaIR, gas reporter |
| **BC-006** | Reorg handling / confirmation depth | 🔍 **OPEN** | P1 | 2-3 block confirmations |
| **BC-007** | Private key management (HSM/KMS) | ⏳ **OPEN** | P0 | AWS KMS / HashiCorp Vault |
| **BC-008** | Emergency pause / circuit breaker | 🔍 **OPEN** | P0 | Pausable contracts |

---

## 📊 STATUS LEGEND

| Status | Meaning |
|--------|---------|
| ✅ **VERIFIED** | Completed, tested, documented |
| 🔄 **IN_PROGRESS** | Actively being worked on |
| 🔍 **OPEN** | Not started, needs work |
| ⏳ **OPEN** | Planned, not started |
| ⚠️ **IN_PROGRESS** | Partially done, blocked |
| 🚫 **BLOCKED** | Dependency not met |
| ⏭️ **DEFERRED** | Postponed to later phase |

---

## 🎯 CURRENT SPRINT FOCUS
 
 | Priority | Item | Status |
 |----------|------|--------|
 | **P0** | SEC-001A Secret Rotation (manual) | 🔄 **IN_PROGRESS** |
 | **P0** | Blockchain Key Migration (3 keys) | 🚫 **BLOCKED** |
 | **P0** | FIN-001 to FIN-009 Financial Correctness | 🔍 **OPEN** |
 | **P0** | SEC-002 Operator Wallet Decentralization | ✅ **TESTNET DONE** |
 | **P1** | FIN-001 to FIN-009 tests | ⏳ **OPEN** |
 | **P1** | SEC-003 CSRF Protection | ✅ **FIXED** |
 | **P1** | SEC-004 SQL Injection Audit | ✅ **VERIFIED** |
 | **P1** | SEC-005 XSS Audit | ✅ **VERIFIED** |
 | **P1** | SEC-006 IDOR/BOLA Audit | ✅ **FIXED** |
 | **P1** | SEC-007 Rate Limiting | ✅ **FIXED** |
 | **P1** | SEC-008 to SEC-010 audit | 🔍 **OPEN** |
 | **P1** | ARC-001 to ARC-010 reliability | 🔍 **OPEN** |
 | **P1** | PERF-001 to PERF-008 optimization | 🔍 **OPEN** |
 | **P1** | CMP-001 to CMP-010 compliance | ⏳ **OPEN** |

---

## 📝 NEXT ACTIONS (IMMEDIATE)
 
 1. **Manual Secret Rotation** - Complete SEC-001A provider dashboard rotations
 2. **Blockchain Migration** - Test Sepolia → Mainnet for 3 operator keys
 3. **FIN-001 to FIN-005** - Implement financial correctness tests
 4. **SEC-008 to SEC-010** - Complete remaining security audits
 5. **ARC-001** - Connection pool tuning, query optimization
 6. **TEST-001/002** - Unit + Integration test framework setup

---

*Last Updated: 2024-08-08*  
*Next Review: After SEC-001A completion*  
*Owner: Platform Lead*