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
| **SEC-002** | Single hot wallet controls all operator functions | ⏳ **OPEN** | P0 | Requires SEC-001A completion first |
| **SEC-003** | CSRF protection gaps on state-changing endpoints | 🔍 **OPEN** | P1 | Review CSRF_SKIP_PREFIX in server.js |
| **SEC-004** | SQL injection / parameterized queries audit | 🔍 **OPEN** | P1 | Verify all routes use parameterized queries |
| **SEC-005** | XSS / input sanitization audit | 🔍 **OPEN** | P1 | Review all user inputs |
| **SEC-006** | IDOR / BOLA (Broken Object Level Authorization) | 🔍 **OPEN** | P1 | Verify org-scoped access in all routes |
| **SEC-007** | Rate limiting coverage | 🔍 **OPEN** | P1 | Verify all endpoints have appropriate limits |
| **SEC-008** | Secrets in git history | ⚠️ **IN_PROGRESS** | P0 | Rotation matrix created; manual rotation needed |
| **SEC-009** | Firebase Auth / Supabase RLS configuration | 🔍 **OPEN** | P1 | Verify RLS policies on all tables |
| **SEC-010** | Webhook signature verification | 🔍 **OPEN** | P1 | Razorpay, Pinata, Resend webhooks |

---

## 💰 FINANCIAL CORRECTNESS CHECKLIST (FIN)

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| **FIN-001** | Double-spend prevention (concurrent trade settlement) | 🔍 **OPEN** | P0 | Verify DB row locking in trade settlement |
| **FIN-002** | Oversell prevention (credit balance checks) | 🔍 **OPEN** | P0 | Verify available_credits checks |
| **FIN-003** | Negative balance prevention | 🔍 **OPEN** | P0 | Wallet/ledger balance guards |
| **FIN-004** | Duplicate payment prevention | 🔍 **OPEN** | P0 | Idempotency keys on all payments |
| **FIN-005** | Duplicate trade prevention | 🔍 **OPEN** | P0 | Idempotency keys on trades |
| **FIN-006** | Duplicate withdrawal prevention | 🔍 **OPEN** | P0 | Idempotency on withdrawals |
| **FIN-007** | Fee calculation accuracy | 🔍 **OPEN** | P1 | Verify fee math in trades.js |
| **FIN-008** | GST/tax calculation accuracy | 🔍 **OPEN** | P1 | Verify GST in invoices |
| **FIN-009** | Settlement atomicity (DB + blockchain) | 🔍 **OPEN** | P0 | withTransaction + on-chain verification |
| **FIN-010** | Reconciliation (on-chain vs DB balances) | 🔍 **OPEN** | P1 | Scheduled reconciliation job |

---

## 🏗️ ARCHITECTURE & RELIABILITY (ARC)

| ID | Task | Status | Priority | Notes |
|----|------|--------|----------|-------|
| **ARC-001** | Database connection pooling & limits | 🔍 **OPEN** | P1 | Pool size: 10 (Supabase free tier) |
| **ARC-002** | Read replicas / query optimization | 🔍 **OPEN** | P2 | N+1 query audit |
| **ARC-003** | Circuit breakers for external APIs | 🔍 **OPEN** | P1 | Razorpay, Pinata, Alchemy, Firebase |
| **ARC-004** | Graceful degradation (feature flags) | 🔍 **OPEN** | P2 | Blockchain down → INR-only mode |
| **ARC-005** | Idempotency keys on all mutations | 🔍 **OPEN** | P0 | Verify all POST/PATCH/DELETE |
| **ARC-006** | Structured logging & correlation IDs | 🔍 **OPEN** | P1 | Request ID propagation |
| **ARC-007** | Health checks (DB, Redis, RPC, external APIs) | 🔍 **OPEN** | P1 | `/health` endpoint expansion |
| **ARC-008** | Graceful shutdown / connection draining | 🔍 **OPEN** | P1 | SIGTERM handling |
| **ARC-009** | Backup / PITR strategy | 🔍 **OPEN** | P1 | Supabase PITR + custom scripts |
| **ARC-010** | Disaster recovery runbook | 🔍 **OPEN** | P1 | RTO/RPO definitions |

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
| **P0** | SEC-002 Operator Wallet Decentralization | 🚫 **BLOCKED** |
| **P1** | FIN-001 to FIN-009 tests | ⏳ **OPEN** |
| **P1** | SEC-003 to SEC-010 audit | 🔍 **OPEN** |
| **P1** | ARC-001 to ARC-010 reliability | 🔍 **OPEN** |
| **P1** | PERF-001 to PERF-008 optimization | 🔍 **OPEN** |
| **P1** | CMP-001 to CMP-010 compliance | ⏳ **OPEN** |

---

## 📝 NEXT ACTIONS (IMMEDIATE)

1. **Manual Secret Rotation** - Complete SEC-001A provider dashboard rotations
2. **Blockchain Migration** - Test Sepolia → Mainnet for 3 operator keys
2. **FIN-001 to FIN-005** - Implement financial correctness tests
3. **SEC-002** - Design multi-sig / timelock for operator functions
4. **ARC-001** - Connection pool tuning, query optimization
5. **TEST-001/002** - Unit + Integration test framework setup

---

*Last Updated: 2024-08-08*  
*Next Review: After SEC-001A completion*  
*Owner: Platform Lead*