# RUNBOOK: On-Call Rotation & Escalation

**Status:** OPERATIONAL
**Owner:** Platform Lead
**Review:** Quarterly
**Last Updated:** 2026-08-15

---

## On-Call Schedule

### Primary On-Call (Platform Team)
| Week | Engineer | Timezone | Slack | Phone |
|------|----------|----------|-------|-------|
| 1    | Engineer A | EST (UTC-5) | @engineer-a | +1-xxx-xxx-xxxx |
| 2    | Engineer B | PST (UTC-8) | @engineer-b | +1-xxx-xxx-xxxx |
| 3    | Engineer C | CET (UTC+1) | @engineer-c | +1-xxx-xxx-xxxx |
| 4    | Engineer D | IST (UTC+5:30) | @engineer-d | +1-xxx-xxx-xxxx |

**Rotation:** Every Monday 00:00 UTC
**Handoff:** Friday 5 PM local time of outgoing engineer

### Secondary On-Call (Security Team)
| Week | Engineer | Timezone | Slack | Phone |
|------|----------|----------|-------|-------|
| 1-2  | Security Engineer A | EST | @sec-eng-a | +1-xxx-xxx-xxxx |
| 3-4  | Security Engineer B | CET | @sec-eng-b | +1-xxx-xxx-xxxx |

**Escalation:** After 15 min no response from primary

---

## Escalation Matrix

| Severity | Primary Response | Escalation (if no response) | Executive Notification |
|----------|------------------|----------------------------|------------------------|
| **SEV-1 Critical** | 5 min | 15 min → Engineering Lead | 30 min → CTO, VP Eng |
| **SEV-2 High** | 15 min | 30 min → Engineering Lead | 1 hour → VP Eng |
| **SEV-3 Medium** | 1 hour | 2 hours → Team Lead | Next business day |
| **SEV-4 Low** | Next business day | N/A | N/A |

### Escalation Contacts

| Role | Name | Phone | Slack | Email |
|------|------|-------|-------|-------|
| CTO | TBD | +1-xxx-xxx-xxxx | @cto | cto@ethertrack.in |
| VP Engineering | TBD | +1-xxx-xxx-xxxx | @vpeng | vpeng@ethertrack.in |
| Engineering Lead | TBD | +1-xxx-xxx-xxxx | @englead | englead@ethertrack.in |
| Security Lead | TBD | +1-xxx-xxx-xxxx | @seclead | security@ethertrack.in |
| Platform Lead | TBD | +1-xxx-xxx-xxxx | @platformlead | platform@ethertrack.in |
| Legal Counsel | TBD | +1-xxx-xxx-xxxx | @legal | legal@ethertrack.in |
| PR/Comms | TBD | +1-xxx-xxx-xxxx | @pr | pr@ethertrack.in |

---

## PagerDuty Configuration

### Services
| Service | Escalation Policy | Alert Urgency |
|---------|------------------|---------------|
| EtherTrack API | Critical Escalation | High |
| EtherTrack Frontend | Critical Escalation | High |
| Database | Critical Escalation | High |
| Blockchain | High Escalation | High |
| Payments | High Escalation | High |
| Security | Critical Escalation | High |

### Escalation Policies

#### Critical Escalation (SEV-1)
1. **Immediate** → Primary On-Call (SMS + Call + Push)
2. **5 min** → Secondary On-Call (SMS + Call + Push)
3. **15 min** → Engineering Lead (Call + Slack)
4. **30 min** → CTO + VP Engineering (Call)
5. **1 hour** → VP Engineering + Legal (Call)

#### High Escalation (SEV-2)
1. **Immediate** → Primary On-Call (Push + SMS)
2. **15 min** → Secondary On-Call (Push + SMS)
3. **30 min** → Engineering Lead (Slack + Call)
4. **1 hour** → VP Engineering (Slack)

#### High Escalation (SEV-3)
1. **Immediate** → Primary On-Call (Push)
2. **1 hour** → Team Lead (Slack)
3. **4 hours** → Engineering Lead (Slack)

---

## Slack Channels

| Channel | Purpose | Participants |
|---------|---------|--------------|
| `#incident-sev1` | SEV-1 War Room | All hands, execs |
| `#incident-sev2` | SEV-2 Coordination | Engineering, Security |
| `#incident-sev3` | SEV-3 Tracking | On-call, Team leads |
| `#oncall` | Daily handoff | On-call rotation |
| `#alerts` | All alerts | Engineering, Security |
| `#critical-alerts` | Critical only | On-call, Engineering Lead |
| `#security-alerts` | Security events | Security, Legal, Eng Lead |
| `#finance-alerts` | Payment/Finance | Finance, Eng Lead |
| `#blockchain-alerts` | Blockchain | Blockchain, Platform |
| `#platform-alerts` | Infra/Platform | Platform, Eng Lead |

---

## On-Call Handoff Procedure

### Friday Handoff (Outgoing → Incoming)
**Time:** Friday 5 PM local time of outgoing engineer

**Checklist:**
1. [ ] Review active incidents in PagerDuty
2. [ ] Review open PRs/deployments in progress
4. [ ] Share context on ongoing issues
5. [ ] Update on-call schedule in PagerDuty
5. [ ] Post handoff summary in `#oncall` channel

**Handoff Template:**
```
## On-Call Handoff - Week of YYYY-MM-DD

**Outgoing:** @engineer-name
**Incoming:** @engineer-name

### Active Incidents
- INC-123: Brief description, status, next steps

### Ongoing Work
- PR #456: Description, status
- Deployment: Version X.Y.Z scheduled for Tuesday

### Known Issues
- Issue: Description, workaround, owner

### Upcoming
- Monday: Scheduled maintenance 2-4 AM UTC
- Wednesday: Release v1.2.3

### Contacts
- Engineering Lead: @englead
- Security: @seclead
```

---

## Response Procedures

### Acknowledging Alerts
1. **Acknowledge** in PagerDuty within SLA (5 min SEV-1, 15 min SEV-2)
2. **Join** appropriate Slack channel (`#incident-sev1`, `#incident-sev2`, etc.)
3. **Post** initial status: "Acknowledged, investigating"
4. **Assign** Incident Commander (IC) if SEV-1/SEV-2

### During Incident
1. **Investigate** using dashboards, logs, traces
2. **Communicate** updates every 15 min (SEV-1) / 30 min (SEV-2)
5. **Escalate** per escalation matrix if needed
5. **Document** timeline in incident channel

### Resolution
1. **Verify** fix with smoke tests
2. **Update** status page: "Resolved"
3. **Close** PagerDuty incident
5. **Schedule** postmortem (within 5 business days)
5. **Post** resolution in Slack channel

---

## On-Call Best Practices

### Before Shift
- [ ] Review PagerDuty schedule
- [ ] Check laptop/phone charged, notifications on
- [ ] Verify kubectl access to production
- [ ] Review recent incidents (last 7 days)
- [ ] Confirm access to all dashboards (Grafana, PagerDuty, Grafana)

### During Shift
- [ ] Stay within 15 min of laptop
- [ ] Keep phone on loud + vibration
- [ ] Respond to pages within SLA
- [ ] Document all actions in incident channel
- [ ] Take breaks but stay reachable

### After Shift
- [ ] Complete handoff to next engineer
- [ ] Update any runbooks with new learnings
- [ ] Ensure all incidents handed off or resolved
- [ ] Rest! 

---

## Compensation

| Shift Type | Compensation |
|------------|--------------|
| Weekday (Mon-Fri) | $300/week |
| Weekend (Sat-Sun) | $500/weekend |
| Holiday | $200/day additional |
| SEV-1 Response | $100/incident |
| SEV-2 Response | $50/incident |

---

## Tools & Access

### Required Access
- [ ] PagerDuty (Full access)
- [ ] Grafana (Admin)
- [ ] kubectl (Production cluster)
- [ ] AWS Console (ReadOnly)
- [ ] Cloudflare (ReadOnly)
- [ ] Razorpay Dashboard (ReadOnly)
- [ ] Alchemy Dashboard (ReadOnly)
- [ ] Pinata Dashboard (ReadOnly)
- [ ] Sentry (Admin)
- [ ] GitHub (Admin)

### Useful Commands
```bash
# Check deployment status
kubectl rollout status deployment/ethertrack-backend -n ethertrack

# View recent logs
kubectl logs -l app=ethertrack-backend -n ethertrack --tail=100 -f

# Check pod status
kubectl get pods -n ethertrack -o wide

# Check service endpoints
kubectl get endpoints -n ethertrack

# Port forward for debugging
kubectl port-forward -n ethertrack svc/ethertrack-backend 5000:5000

# Check secret values (redacted)
kubectl get secret ethertrack-secrets -n ethertrack -o jsonpath='{.data}' | jq -r 'to_entries[] | "\(.key)=\(.value|@base64d)"'

# Check secret rotation status
kubectl get secret ethertrack-secrets -n ethertrack -o jsonpath='{.metadata.annotations}'
```

---

## Runbook Maintenance

- **Review:** Quarterly (aligned with on-call rotation)
- **Last Reviewed:** 2026-08-15
- **Next Review:** 2026-11-15
- **Owner:** Platform Lead

---

*Last Updated: 2026-08-15*  
*Next Review: 2026-11-15*  
*Owner: Platform Lead*