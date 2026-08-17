# RUNBOOK: SEV-1 Service Outage

**Severity:** SEV-1 (Critical)
**Target Resolution:** < 2 hours
**Escalation:** CTO, VP Engineering, Security Lead, Legal, PR

---

## Detection
- PagerDuty alert: `ServiceDown`, `HighErrorRate`, `DatabaseUnavailable`, `DatabaseConnectionPoolExhausted`
- Customer reports via support channels
- Status page shows degraded
- Monitoring dashboards show red

---

## Initial Response (0-5 minutes)
1. **Acknowledge** PagerDuty alert immediately
2. **Join** `#incident-sev1` war room channel on Slack
3. **Declare** SEV-1 in PagerDuty
4. **Post** initial status: "Investigating service outage - will update within 15 minutes"
5. **Assign** Incident Commander (IC) - typically on-call platform engineer

---

## Triage (5-15 minutes)

### Quick Checks (run in parallel)
```bash
# 1. Check overall health
curl https://api.ethertrack.in/health

# 2. Check backend logs (last 100 lines)
kubectl logs -n production -l app=ethertrack-api --tail=100

# 3. Check Kubernetes pods
kubectl get pods -n production -o wide

# 4. Check database connectivity
pg_isready -h postgres.production

# 5. Check blockchain/RPC
curl -X POST https://eth-mainnet.alchemyapi.io/v2/$ALCHEMY_KEY \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# 6. Check Grafana dashboard
# https://grafana.ethertrack.in/d/overview
```

### Common Causes & Actions

#### Database Down
```bash
# Check PostgreSQL status
kubectl exec -it postgres-0 -n production -- pg_isready

# Check replication lag
kubectl exec -it postgres-0 -n production -- psql -c "SELECT * FROM pg_stat_replication;"

# Check connection pool
kubectl exec -it postgres-0 -n production -- psql -c "SELECT count(*) FROM pg_stat_activity;"

# If primary down, trigger failover
kubectl patch postgres-cluster -n production -p '{"spec":{"failover":true}}'
```

#### Kubernetes Node Issues
```bash
# Check node status
kubectl get nodes -o wide

# Check events
kubectl get events -n production --sort-by='.lastTimestamp'

# Cordon & drain problematic node
kubectl cordon <node-name>
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data --force
```

#### Blockchain/RPC Failure
```bash
# Check Alchemy/Infura status page
curl https://status.alchemy.com/api/v2/status.json

# Check RPC endpoint directly
curl -X POST https://eth-mainnet.alchemyapi.io/v2/$KEY \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Check circuit breaker state
curl https://api.ethertrack.in/metrics | grep circuit_breaker

# Restart blockchain indexer if sync stuck
kubectl rollout restart deployment/blockchain-indexer -n production

# Failover to backup RPC
kubectl set env deployment/ethertrack-api -n production \
  ALCHEMY_RPC=https://backup-rpc.example.com
```

#### Payment Gateway Down
```bash
# Check Razorpay status
curl https://api.razorpay.com/v1/health

# Check webhook delivery logs
kubectl logs -n production -l app=ethertrack-api | grep webhook

# Switch to backup payment provider (feature flag)
kubectl set env deployment/ethertrack-api -n production \
  FEATURE_RAZORPAY_ENABLED=false
```

---

## Containment (15-30 minutes)
1. **Implement** short-term fix (restart, failover, rollback, feature flag)
2. **Verify** fix with smoke tests:
   ```bash
   curl -X POST https://api.ethertrack.in/api/trades \
     -H "Authorization: Bearer $TEST_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"plan":"starter","cycle":"monthly","idempotency_key":"test-123"}'
   ```
3. **Update** status page: "Identified root cause, implementing fix"
4. **Notify** stakeholders via PagerDuty

---

## Eradication (30 min - 4 hours)
1. **Apply** permanent fix (code patch, config change, database migration)
2. **Deploy** fix through CI/CD pipeline
3. **Run** full regression test suite
4. **Monitor** for 30 minutes post-deployment

---

## Recovery (4-6 hours)
1. **Gradually** restore traffic (if traffic was shifted)
2. **Validate** all critical paths:
   - Trade execution (buy/sell)
   - KYC verification
   - Wallet deposits/withdrawals
   - Payment processing (Razorpay)
   - Subscription management
   - Carbon credit minting
2. **Update** status page: "Service restored, monitoring"
3. **Close** PagerDuty incident
4. **Schedule** post-incident review (within 5 business days)

---

## Post-Incident (within 5 business days)
1. **Schedule** RCA meeting with all responders
2. **Write** postmortem using template: `docs/templates/postmortem-template.md`
3. **Create** action items in Linear/Jira with owners and due dates
4. **Share** with stakeholders (internal + affected customers if applicable)
5. **Update** runbooks if new failure mode discovered

---

## Key Contacts
| Role | Name | Phone | Slack | Email |
|------|------|-------|-------|-------|
| Incident Commander | On-call Platform | +1-xxx-xxx-xxxx | @platform-oncall | platform@ethertrack.in |
| Database Lead | - | +1-xxx-xxx-xxxx | @db-lead | db@ethertrack.in |
| Blockchain Lead | - | +1-xxx-xxx-xxxx | @blockchain-lead | blockchain@ethertrack.in |
| Security Lead | - | +1-xxx-xxx-xxxx | @security-lead | security@ethertrack.in |
| CTO | - | +1-xxx-xxx-xxxx | @cto | cto@ethertrack.in |
| VP Engineering | - | +1-xxx-xxx-xxxx | @vpeng | vpeng@ethertrack.in |
| Legal Counsel | - | +1-xxx-xxx-xxxx | @legal | legal@ethertrack.in |
| PR/Comms | - | +1-xxx-xxx-xxxx | @pr | pr@ethertrack.in |

---

## Runbook Maintenance
- **Review:** Quarterly
- **Last Reviewed:** 2026-08-15
- **Next Review:** 2026-11-15
- **Owner:** Platform Lead