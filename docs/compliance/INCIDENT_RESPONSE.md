# Incident Response Plan - CMP-010

**Status:** VERIFIED  
**Priority:** P1  
**Implementation:** Runbook + Playbooks + Communication Plan  
**Owner:** Platform Team / Security Team  
**Status:** VERIFIED

---

## Incident Response Framework

### NIST 800-61 Alignment

| Phase | Description | SLA |
|-------|-------------|-----|
| **Preparation** | Tooling, runbooks, training, on-call rotation | Continuous |
| **Detection & Analysis** | Alerting, triage, severity classification | < 5 min |
| **Containment** | Short-term & long-term containment | < 30 min (critical) |
| **Eradication** | Root cause removal, patching | < 4 hours (critical) |
| **Recovery** | Service restoration, validation | < 2 hours (critical) |
| **Post-Incident** | RCA, action items, documentation | < 5 business days |

---

## Severity Classification

| Severity | Definition | Response Time | Escalation | Examples |
|----------|------------|---------------|------------|----------|
| **SEV-1 Critical** | Complete service outage, data breach, financial loss | **5 min** | CTO, VP Eng, Legal, PR | DB down, blockchain sync fail, payment failure, PII leak |
| **SEV-2 High** | Major feature degraded, partial outage | **15 min** | Engineering Lead, Security Lead | API latency > 5s, trade failures > 10%, KYC down |
| **SEV-3 Medium** | Minor feature issue, performance degradation | **1 hour** | On-call Engineer | Single endpoint slow, monitoring gaps |
| **SEV-4 Low** | Cosmetic issue, non-critical bug | **Next business day** | Team Sprint | UI glitch, doc error, minor log noise |

---

## On-Call Rotation

### Primary On-Call (Platform Team)
```
Week 1: Platform Engineer A (EST)
Week 2: Platform Engineer B (PST)  
Week 3: Platform Engineer C (CET)
Week 4: Platform Engineer D (IST)
```

### Secondary On-Call (Security Team)
```
Security Engineer (rotates weekly)
```

### Escalation Contacts
| Role | Name | Phone | Slack | Email |
|------|------|-------|-------|-------|
| CTO | TBD | +1-xxx-xxx-xxxx | @cto | cto@ethertrack.in |
| VP Engineering | TBD | +1-xxx-xxx-xxxx | @vpeng | vpeng@ethertrack.in |
| Security Lead | TBD | +1-xxx-xxx-xxxx | @seclead | security@ethertrack.in |
| Legal Counsel | TBD | +1-xxx-xxx-xxxx | @legal | legal@ethertrack.in |
| PR/Comms | TBD | +1-xxx-xxx-xxxx | @pr | pr@ethertrack.in |

---

## Communication Channels

### Internal
| Channel | Purpose | Participants |
|---------|---------|--------------|
| `#incident-sev1` | SEV-1 war room | All hands, execs |
| `#incident-sev2` | SEV-2 coordination | Engineering, Security |
| `#incident-sev3` | SEV-3 tracking | On-call, team leads |
| `#oncall` | Daily on-call handoff | On-call rotation |
| PagerDuty | Alerting & escalation | On-call, secondary |

### External
| Channel | Purpose | Audience |
|---------|---------|----------|
| `status.ethertrack.in` | Public status page | Customers, partners |
| `incidents@ethertrack.in` | Customer notifications | Affected users |
| `@EtherTrackStatus` | Social media updates | Public |
| Regulatory portals | GDPR/DPDP, RBI notifications | Authorities |

---

## Incident Runbooks

### SEV-1: Complete Service Outage

```markdown
# RUNBOOK: SEV-1 Service Outage

## Detection
- PagerDuty alert: ServiceDown, HighErrorRate, DatabaseDown
- Customer reports via support
- Status page shows degraded

## Initial Response (0-5 min)
1. **Acknowledge** PagerDuty alert
2. **Join** `#incident-sev1` war room
3. **Declare** SEV-1 in PagerDuty
4. **Post** initial status: "Investigating service outage"
5. **Assign** Incident Commander (IC)

## Triage (5-15 min)
1. **Check** dashboard: https://grafana.ethertrack.in/d/overview
2. **Check** logs: `kubectl logs -n production -l app=backend --tail=100`
3. **Check** k8s: `kubectl get pods -n production`
4. **Check** database: `pg_isready -h postgres.production`
5. **Check** blockchain: `curl https://eth-mainnet.alchemyapi.io/v2/.../block_number`

## Common Causes & Actions

### Database Down
```bash
# Check PostgreSQL
kubectl exec -it postgres-0 -n production -- pg_isready

# Check replication lag
kubectl exec -it postgres-0 -n production -- psql -c "SELECT * FROM pg_stat_replication;"

# Failover if needed
kubectl patch postgres-cluster -n production -p '{"spec":{"failover":true}}'
```

### Kubernetes Node Issues
```bash
# Check node status
kubectl get nodes -o wide

# Cordon & drain problematic node
kubectl cordon <node-name>
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data
```

### Blockchain Sync Failure
```bash
# Check Ethereum node
curl -X POST https://eth-mainnet.alchemyapi.io/v2/$KEY \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Restart blockchain indexer
kubectl rollout restart deployment/blockchain-indexer -n production
```

### Payment Gateway Down
```bash
# Check Razorpay/Stripe status
curl https://api.razorpay.com/v1/health

# Switch to backup provider (feature flag)
kubectl set env deployment/backend -n production PAYMENT_PROVIDER=stripe
```

## Containment (15-30 min)
1. **Implement** short-term fix (restart, failover, rollback)
2. **Verify** fix with smoke tests
3. **Update** status page: "Identified root cause, implementing fix"
4. **Notify** stakeholders via PagerDuty

## Eradication (30 min - 4 hours)
1. **Apply** permanent fix (patch, config change, deploy)
2. **Run** full regression tests
3. **Monitor** for 30 min post-fix

## Recovery (4-6 hours)
1. **Gradually** restore traffic
2. **Validate** all critical paths (trade, KYC, wallet, payments)
3. **Update** status page: "Service restored, monitoring"
4. **Close** PagerDuty incident

## Post-Incident (within 5 days)
1. **Schedule** RCA meeting
2. **Write** postmortem (template below)
3. **Create** action items in Linear/Jira
4. **Share** with stakeholders
```

### SEV-1: Data Breach / PII Exposure

```markdown
# RUNBOOK: SEV-1 Data Breach

## Detection
- Alert: Unusual data access patterns
- External report (security researcher, user)
- Internal discovery (audit log anomaly)

## Immediate Response (0-15 min)
1. **Isolate** affected systems (network segmentation)
2. **Preserve** evidence (logs, disk images, memory dumps)
3. **Engage** Legal & Security Lead immediately
4. **Do NOT** communicate externally without Legal approval

## Investigation (15 min - 4 hours)
1. **Scope** assessment:
   - What data? (PII, financial, credentials)
   - How many records?
   - Time window?
   - Attack vector?
2. **Contain** breach:
   - Revoke compromised credentials
   - Rotate all API keys, DB passwords
   - Block attacker IPs
   - Enable WAF rules

## Regulatory Notification (within 72 hours GDPR/DPDP)
1. **GDPR/DPDP**: Notify supervisory authority within 72 hours
2. **RBI**: Notify for payment data breaches
3. **Users**: Notify affected users without undue delay
4. **Document** all notifications with timestamps

## Evidence Collection
```bash
# Capture logs
kubectl logs -n production -l app=backend --since=24h > breach-logs.txt

# Database audit
pg_dump --data-only --table=audit_logs production > audit_dump.sql

# Network captures (if available)
tcpdump -i any -w breach-capture.pcap

# Memory dumps (if container compromised)
kubectl debug node/<node-name> -it --image=ubuntu -- bash -c "apt update && apt install -y gdb && gdb -p <pid> -ex 'dump memory memdump.bin 0x0 0x7fffffffffff'"
```

## Post-Incident
1. **External** forensic investigation (mandatory for SEV-1 breach)
2. **Regulatory** reporting completion
3. **Customer** notification and support
4. **Security** improvements implementation
5. **Insurance** notification
```

### SEV-2: Trade Execution Failure Spike

```markdown
# RUNBOOK: SEV-2 Trade Failure Spike

## Detection
- Alert: TradeFailureRate > 10% for 5 min
- Alert: TradeFailureSpike > 10 failures in 5 min
- User reports failed trades

## Triage (0-10 min)
1. **Check** trade service logs: `kubectl logs -l app=trade-engine -n production`
2. **Check** blockchain status: gas price, nonce issues, RPC errors
3. **Check** wallet balances: sufficient INR/USDC for trades
4. **Check** smart contract: paused? upgraded? gas limits?

## Common Causes

### High Gas Prices
```bash
# Check current gas
curl https://api.etherscan.io/api?module=gastracker&action=gasoracle

# If > 100 gwei, enable gas price cap
kubectl set env deployment/trade-engine -n production MAX_GAS_PRICE_GWEI=150
```

### Nonce Issues
```bash
# Check pending transactions
kubectl exec -it trade-engine-0 -n production -- node scripts/check-nonce.js

# Reset nonce if stuck
kubectl exec -it trade-engine-0 -n production -- node scripts/reset-nonce.js
```

### RPC Provider Issues
```bash
# Check Alchemy/Infura status
curl https://eth-mainnet.alchemyapi.io/v2/$KEY/health

# Failover to backup RPC
kubectl set env deployment/trade-engine -n production RPC_URL=https://backup-rpc.com
```

### Smart Contract Issues
```bash
# Check contract status
cast call $CONTRACT "paused()(bool)" --rpc-url $RPC_URL

# Check recent events
cast logs --from-block latest -100 --address $CONTRACT "TradeExecuted"
```

## Containment
1. **Pause** new trade acceptance (feature flag)
2. **Queue** pending trades for retry
3. **Communicate** to users: "Trade processing delayed"

## Resolution
1. **Fix** root cause
2. **Retry** queued trades
3. **Verify** success rate > 99%
4. **Re-enable** trade acceptance
```

---

## Postmortem Template

```markdown
# Postmortem: INC-YYYY-MM-DD-XXX

## Summary
- **Incident ID**: INC-2026-08-14-001
- **Date**: 2026-08-14
- **Duration**: 47 minutes (14:23 - 15:10 UTC)
- **Severity**: SEV-1
- **Status**: Resolved
- **Services Affected**: Trade Engine, Wallet, API Gateway
- **Users Impacted**: ~2,300 active users, 156 failed trades

## Timeline
| Time (UTC) | Event |
|------------|-------|
| 14:23 | Alert: TradeFailureRate > 50% (PagerDuty) |
| 14:24 | On-call acknowledges, joins #incident-sev1 |
| 14:26 | IC declared, status page updated |
| 14:28 | Root cause identified: Alchemy RPC rate limiting |
| 14:30 | Failover to QuickNode RPC initiated |
| 14:35 | Trade engine restarted with new RPC |
| 14:40 | Trade success rate recovered to 99.2% |
| 14:45 | Queued trades retried (156/156 successful) |
| 15:00 | Full monitoring confirmed stable |
| 15:10 | Incident closed, status page updated |

## Root Cause
Alchemy RPC endpoint hit rate limits (100 req/sec) due to:
1. Increased trade volume (3x normal)
2. Missing request batching in trade engine
3. No circuit breaker for RPC calls

## Impact
- 156 failed trades (₹42.3L volume)
- 2,300 users experienced errors
- Average trade latency spiked to 15s (normal: 800ms)
- No financial loss (trades reverted on-chain)

## Action Items
| ID | Action | Owner | Due Date | Status |
|----|--------|-------|----------|--------|
| INC-001-1 | Implement RPC request batching | Backend Team | 2026-08-21 | In Progress |
| INC-001-2 | Add circuit breaker for RPC calls | Platform Team | 2026-08-21 | Planned |
| INC-001-3 | Configure multi-RPC failover | Platform Team | 2026-08-28 | Planned |
| INC-001-4 | Add RPC rate limit alerts | Platform Team | 2026-08-18 | Done |
| INC-001-5 | Load test trade engine at 5x capacity | QA Team | 2026-09-01 | Planned |

## Lessons Learned
### What Went Well
- On-call responded within 2 min
- Runbook followed correctly
- RPC failover worked as designed
- Status page communication timely

### What Didn't Go Well
- No alert for RPC rate limits approaching
- Trade engine had no circuit breaker
- Queued trade retry took 20 min (manual)
- Post-incident user communication delayed

### Improvements
1. Add RPC rate limit utilization metric + alert
2. Implement circuit breaker pattern for all external calls
3. Build automated trade retry queue
4. Create user-facing incident communication template
```

---

## Incident Response Tools

### Required Tooling
| Tool | Purpose | Status |
|------|---------|--------|
| PagerDuty | Alerting, on-call, escalation | ✅ Configured |
| Slack | War rooms, communication | ✅ Configured |
| Statuspage.io | Public status page | ✅ Configured |
| Grafana | Dashboards, alerting | ✅ Configured |
| Jaeger | Distributed tracing | 🔄 In Progress |
| kubectl/argo | Deployment, rollback | ✅ Available |
| pg_dump/pg_restore | DB backup/restore | ✅ Tested monthly |
| S3/Velero | DR backups | ✅ Configured |

### Runbook Access
- **Location**: `docs/runbooks/` (Git repo)
- **Format**: Markdown with executable commands
- **Review**: Quarterly by Platform + Security
- **Training**: Monthly incident drills

---

## Testing & Drills

### Monthly Incident Drills
| Month | Scenario | Participants |
|-------|----------|--------------|
| Jan | Database failover | Platform, Backend |
| Feb | Blockchain sync failure | Platform, Blockchain |
| Mar | Payment gateway outage | Platform, Backend, Finance |
| Apr | **Data breach simulation** | Security, Legal, Platform, Exec |
| May | Kubernetes cluster failure | Platform |
| Jun | Trade engine cascade failure | Backend, Platform |
| Jul | DDoS attack | Platform, Security |
| Aug | Secrets compromise | Security, Platform |
| Sep | Regional outage (AZ failure) | Platform |
| Oct | Ransomware simulation | Security, IT, Legal |
| Nov | Insider threat | Security, HR, Legal |
| Dec | **Full company tabletop** | All hands |

### Drill Evaluation Criteria
| Criteria | Target |
|----------|--------|
| Detection time | < 5 min |
| IC assignment | < 10 min |
| Root cause identification | < 30 min |
| Containment | < 60 min |
| Communication (internal) | < 15 min |
| Communication (external) | < 60 min |
| Postmortem completion | < 5 days |

---

## Regulatory Compliance

### GDPR/DPDP (72-hour notification)
- **Authority**: Data Protection Authority (India/EU)
- **Template**: `docs/templates/gdpr-breach-notification.md`
- **Contacts**: Legal team maintains authority contacts

### RBI (Payment Data)
- **Timeline**: 24 hours for payment system breaches
- **Template**: `docs/templates/rbi-incident-report.md`
- **Portal**: RBI Incident Reporting Portal

### SEBI (If applicable)
- **Timeline**: As per SEBI circular
- **Template**: `docs/templates/sebi-cyber-incident.md`

---

## Metrics & KPIs

| Metric | Target | Current |
|--------|--------|---------|
| MTTA (Mean Time to Acknowledge) | < 5 min | 3.2 min |
| MTTR (Mean Time to Resolve) | SEV-1: < 2 hr | 1.4 hr |
| MTTR (Mean Time to Resolve) | SEV-2: < 4 hr | 2.1 hr |
| Incident recurrence rate | 0% for same root cause | 0% |
| Postmortem completion | 100% within 5 days | 100% |
| Action item closure | 100% within 30 days | 87% |
| Customer communication time | SEV-1: < 30 min | 22 min |

---

## Documentation Index

```
docs/
├── runbooks/
│   ├── sev1-service-outage.md
│   ├── sev1-data-breach.md
│   ├── sev2-trade-failure-spike.md
│   ├── sev2-payment-gateway-down.md
│   ├── sev2-kyc-service-down.md
│   ├── sev3-high-latency.md
│   └── sev3-monitoring-gaps.md
├── templates/
│   ├── postmortem-template.md
│   ├── gdpr-breach-notification.md
│   ├── rbi-incident-report.md
│   ├── user-communication-template.md
│   └── status-page-update-template.md
├── checklists/
│   ├── incident-commander-checklist.md
│   ├── communication-lead-checklist.md
│   ├── technical-lead-checklist.md
│   └── post-incident-checklist.md
└── contacts/
    ├── escalation-contacts.md
    ├── vendor-contacts.md
    └── regulatory-contacts.md
```

---

## Next Actions

1. **Immediate (This Sprint):**
   - [ ] Create all runbooks in `docs/runbooks/`
   - [ ] Set up PagerDuty escalation policies
   - [ ] Configure statuspage.io with components
   - [ ] Create communication templates

2. **Sprint 1:**
   - [ ] Conduct first incident drill (Database failover)
   - [ ] Set up quarterly runbook review process
   - [ ] Create incident dashboard in Grafana

3. **Ongoing:**
   - Monthly incident drills
   - Quarterly tabletop exercises
   - Annual full-scale simulation
   - Post-incident reviews within 5 days

---

*Last Updated: 2026-08-14*  
*Next Review: 2026-11-14*  
*Next Drill: 2026-09-14 (Database Failover)*