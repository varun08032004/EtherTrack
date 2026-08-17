# RUNBOOK: SEV-1 Data Breach / PII Exposure

**Severity:** SEV-1 (Critical)
**Target Resolution:** Containment < 4 hours, Full investigation < 72 hours
**Escalation:** CTO, VP Engineering, Security Lead, Legal Counsel, DPO, PR

---

## Detection
- Alert: Unusual data access patterns (high-volume queries, off-hours access)
- External report (security researcher, user, law enforcement)
- Internal discovery (audit log anomaly, SIEM alert)
- Automated DLP alert (data exfiltration attempt)

---

## Immediate Response (0-15 minutes)

### 1. Contain the Breach
```bash
# 1. Isolate affected systems
kubectl cordon <affected-node>
kubectl scale deployment <affected-service> --replicas=0 -n production

# 2. Revoke compromised credentials
# - API keys
# - Database passwords
# - JWT secrets
# - Service account tokens
kubectl create secret generic rotated-secrets --from-literal=jwt-secret=<new-secret> -n production --dry-run=client -o yaml | kubectl replace -f -

# 3. Block attacker IPs at WAF/Cloudflare
# Cloudflare: Security > WAF > IP Access Rules

# 4. Enable strict WAF rules
# Cloudflare: Security > WAF > Managed Rules > OWASP + Custom
```

### 2. Preserve Evidence
```bash
# Capture logs (last 24 hours)
kubectl logs -n production -l app=ethertrack-api --since=24h > breach-logs.txt

# Database audit dump
pg_dump --data-only --table=audit_logs production > audit_dump.sql

# Network captures (if available)
# tcpdump -i any -w breach-capture.pcap

# Memory dumps (if container compromised)
kubectl debug node/<node-name> -it --image=ubuntu -- bash -c \
  "apt update && apt install -y gdb && gdb -p <pid> -ex 'dump memory memdump.bin 0x0 0x7fffffffffff'"
```

### 3. Engage Legal & Security Immediately
- **Do NOT communicate externally** without Legal approval
- Page: Security Lead, Legal Counsel, DPO
- Legal determines: GDPR/DPDP notification requirements, law enforcement engagement

---

## Investigation (15 min - 4 hours)

### 1. Scope Assessment
| Question | Source |
|----------|--------|
| What data was accessed? | Audit logs, DB query logs, application logs |
| How many records? | Row counts from audit logs |
| Time window? | First/last access timestamps |
| Attack vector? | Logs, WAF logs, authentication logs |
| Data exfiltrated? | Network logs, DLP alerts, file access logs |

### 2. Data Classification
| Data Category | PII? | Financial? | Regulatory Impact |
|---------------|------|------------|-------------------|
| User emails/names | Yes | No | GDPR/DPDP |
| KYC documents | Yes | No | GDPR/DPDP + AML |
| Wallet addresses | Pseudonymous | Yes | PCI DSS (if linked) |
| Trade history | No | Yes | PCI DSS / Tax |
| Payment data | No | Yes (tokenized) | PCI DSS (Razorpay scope) |
| Audit logs | Metadata | No | SOC2 |

### 3. Containment Actions
```bash
# Rotate ALL credentials
# - Database passwords
kubectl exec -it postgres-0 -n production -- psql -c "ALTER USER app_user PASSWORD '<new-password>';"

# - Redis passwords
# - JWT secrets (force re-login)
kubectl create secret generic jwt-secret --from-literal=secret=<new> -n production --dry-run=client -o yaml | kubectl replace -f -

# - API keys (Razorpay, Alchemy, Pinata)
# Rotate in provider dashboards, update Kubernetes secrets

# - Service account tokens
kubectl delete secret <service-account-token> -n production

# Block attacker indicators
# - IPs at Cloudflare/WAF
# - User agents at WAF
# - API keys in application
```

---

## Regulatory Notification (within 72 hours GDPR/DPDP)

### GDPR/DPDP (Art. 33/34 GDPR, Sec. 13 DPDP)
| Authority | Deadline | Channel | Template |
|-----------|----------|---------|----------|
| DPC (Ireland - Lead SA) | 72 hours | Online Portal | Art. 33 Template |
| DPB (India - DPDP) | 72 hours | Online Portal | Sec. 13 Template |
| Affected Users | Without undue delay | Email/In-app | Art. 34 Template |

### Required Information (Art. 33 GDPR)
- Nature of breach
- Categories/number of data subjects
- Categories/number of records
- Likely consequences
- Measures taken/proposed
- DPO contact details

### RBI (Payment Data)
- Timeline: 24 hours for payment system breaches
- Portal: RBI Incident Reporting Portal
- Template: `docs/templates/rbi-incident-report.md`

### Documentation
```bash
# Record all notifications with timestamps
echo "$(date -u): Notified DPC via portal" >> breach-timeline.log
echo "$(date -u): Notified DPB via portal" >> breach-timeline.log
echo "$(date -u): Notified users via email" >> breach-timeline.log
```

---

## Post-Incident (within 5 business days)

### 1. External Forensic Investigation (MANDATORY for SEV-1 breach)
- Engage certified forensic firm
- Preserve chain of custody
- Full report for regulators

### 2. Regulatory Reporting Completion
- Submit final reports to all authorities
- Document all communications with timestamps

### 3. Customer Notification & Support
- Dedicated support channel for affected users
- Credit monitoring offer (if financial data)
- Clear communication about what happened, what data, what we're doing

### 4. Security Improvements
- Implement additional controls (WAF rules, encryption, access controls)
- Update incident response procedures
- Conduct security training

### 5. Insurance Notification
- Notify cyber insurance carrier
- Provide forensic report

---

## Key Contacts
| Role | Name | Phone | Slack | Email |
|------|------|-------|-------|-------|
| Security Lead | - | +1-xxx-xxx-xxxx | @security-lead | security@ethertrack.in |
| DPO | - | +1-xxx-xxx-xxxx | @dpo | dpo@ethertrack.in |
| Legal Counsel | - | +1-xxx-xxx-xxxx | @legal | legal@ethertrack.in |
| CTO | - | +1-xxx-xxx-xxxx | @cto | cto@ethertrack.in |
| VP Engineering | - | +1-xxx-xxx-xxxx | @vpeng | vpeng@ethertrack.in |
| PR/Comms | - | +1-xxx-xxx-xxxx | @pr | pr@ethertrack.in |
| Forensic Firm | - | +1-xxx-xxx-xxxx | - | forensics@firm.com |
| Cyber Insurance | - | +1-xxx-xxx-xxxx | - | claims@insurer.com |

---

## Templates
- GDPR Breach Notification: `docs/templates/gdpr-breach-notification.md`
- User Communication: `docs/templates/user-communication-template.md`
- RBI Incident Report: `docs/templates/rbi-incident-report.md`
- Postmortem: `docs/templates/postmortem-template.md`

---

## Runbook Maintenance
- **Review:** Quarterly
- **Last Reviewed:** 2026-08-15
- **Next Review:** 2026-11-15
- **Owner:** Security Lead / DPO