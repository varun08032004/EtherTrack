# PCI DSS Compliance (Razorpay Scope)

**Status:** VERIFIED  
**Priority:** P1  
**Scope:** SAQ A-EP (E-commerce with Payment Gateway Redirect)  
**Payment Processor:** Razorpay  
**Cardholder Data:** Never stored, transmitted, or processed by EtherTrack  
**Owner:** Security Lead  
**Target Completion:** Q4 2026

---

## SAQ A-EP Applicability

EtherTrack qualifies for **SAQ A-EP** because:
- ✅ All cardholder data handled by Razorpay (PCI DSS Level 1 provider)
- ✅ No cardholder data stored, processed, or transmitted on EtherTrack systems
- ✅ Payment page redirected to Razorpay hosted payment page
- ✅ No cardholder data touches EtherTrack servers
- ✅ E-commerce with payment gateway redirect

---

## SAQ A-EP Requirements Mapping

### Requirement 1: Firewall Configuration
| Req | Requirement | Status | Implementation |
|-----|-------------|--------|----------------|
| 1.1 | Firewall configuration standards | ✅ | AWS Security Groups, VPC |
| 1.2 | Firewall between DMZ and internal | ✅ | ALB → Private Subnets |
| 1.3 | Prohibit direct public access | ✅ | No public SSH, ALB only |
| 1.4 | Personal firewall on mobile | ✅ | MDM policy |
| 1.5 | Firewall documentation | ✅ | Infrastructure as Code (Terraform) |

### Requirement 2: Default Passwords
| Req | Requirement | Status | Implementation |
|-----|-------------|--------|----------------|
| 2.1 | Change vendor defaults | ✅ | No default creds, secrets manager |
| 2.2 | Secure configuration standards | ✅ | CIS Benchmarks, Terraform |

### Requirement 3: Protect Stored Cardholder Data
| Req | Requirement | Status | Implementation |
|-----|-------------|--------|----------------|
| 3.1 | Minimize storage | ✅ | **No cardholder data stored** |
| 3.2 | No sensitive authentication data | ✅ | **No CVV, PIN, magnetic stripe** |
| 3.3 | Mask PAN | ✅ | N/A - no storage |
| 3.4 | Render PAN unreadable | ✅ | N/A - no storage |
| 3.5 | Key management | ✅ | N/A - no encryption keys for CHD |
| 3.6 | Key management documentation | ✅ | N/A |

### Requirement 4: Encrypt Transmission
| Req | Requirement | Status | Implementation |
|-----|-------------|--------|----------------|
| 4.1 | Strong cryptography | ✅ | TLS 1.2+ everywhere, TLS 1.3 |
| 4.2 | No WEP/WPA | ✅ | No wireless in scope |
| 4.3 | No SSL/TLS 1.0/1.1 | ✅ | TLS 1.2+ only |

### Requirement 5: Anti-Virus
| Req | Requirement | Status | Implementation |
|-----|-------------|--------|----------------|
| 5.1 | Deploy AV | ✅ | EDR on all endpoints |
| 5.2 | Keep updated | ✅ | Automated updates |
| 5.3 | Periodic scans | ✅ | Scheduled weekly |

### Requirement 6: Secure Systems
| Req | Requirement | Status | Implementation |
|-----|-------------|--------|----------------|
| 6.1 | Security patches | ✅ | Automated patching, 30-day SLA |
| 6.2 | Secure development | ✅ | SDLC, SAST/DAST, code review |
| 6.3 | Change control | ✅ | PR review, staging, approval gates |
| 6.4 | Secure coding | ✅ | OWASP Top 10 training |
| 6.5 | Public-facing web apps | ✅ | WAF, DAST, pen test annually |

### Requirement 7: Restrict Access
| Req | Requirement | Status | Implementation |
|-----|-------------|--------|----------------|
| 7.1 | Need-to-know access | ✅ | RBAC, least privilege |
| 7.2 | Access control systems | ✅ | RBAC, ABAC |
| 7.3 | Secure authentication | ✅ | MFA, SSO, session management |

### Requirement 8: Authentication
| Req | Requirement | Status | Implementation |
|-----|-------------|--------|----------------|
| 8.1 | Unique IDs | ✅ | Unique user IDs |
| 8.2 | Strong authentication | ✅ | MFA, password policy |
| 8.3 | MFA for remote access | ✅ | MFA required for all |
| 8.4 | MFA for admin access | ✅ | MFA + hardware keys |
| 8.5 | MFA for CDE access | N/A | No CDE access |
| 8.6 | Service account auth | ✅ | Short-lived tokens, rotation |

### Requirement 9: Physical Access
| Req | Requirement | Status | Implementation |
|-----|-------------|--------|----------------|
| 9.1 | Physical access controls | ✅ | AWS data centers (SOC 2) |
| 9.2 | Visitor controls | ✅ | AWS responsibility |
| 9.3 | Media handling | N/A | No physical media |
| 9.4 | Media disposal | N/A | No physical media |

### Requirement 10: Logging & Monitoring
| Req | Requirement | Status | Implementation |
|-----|-------------|--------|----------------|
| 10.1 | Audit trails | ✅ | Immutable audit logs |
| 10.2 | Automated audit trails | ✅ | Structured logging, SIEM |
| 10.3 | Protect audit trails | ✅ | Immutable, append-only |
| 10.4 | Time synchronization | ✅ | NTP, AWS Time Sync |
| 10.5 | Log retention | ✅ | 1 year hot, 7 years archive |
| 10.6 | Log review | ✅ | Daily automated, weekly manual |
| 10.7 | Exceptions | ✅ | Alerting on anomalies |

### Requirement 11: Testing
| Req | Requirement | Status | Implementation |
|-----|-------------|--------|----------------|
| 11.1 | Wireless analyzer | N/A | No wireless in scope |
| 11.2 | Vulnerability scans | ✅ | Weekly automated, quarterly manual |
| 11.3 | External penetration test | ✅ | Annual third-party |
| 11.4 | Internal penetration test | ✅ | Semi-annual internal |
| 11.5 | IDS/IPS | ✅ | AWS GuardDuty, WAF |
| 11.6 | Change detection | ✅ | File integrity monitoring |

### Requirement 12: Policy
| Req | Requirement | Status | Implementation |
|-----|-------------|--------|----------------|
| 12.1 | Security policy | ✅ | Documented, annual review |
| 12.2 | Risk assessment | ✅ | Annual, quarterly reviews |
| 12.3 | Usage policies | ✅ | AUP, email, internet |
| 12.4 | Roles & responsibilities | ✅ | RACI matrix |
| 12.5 | Third-party management | ✅ | Vendor risk program |
| 12.6 | Incident response | ✅ | IR plan, quarterly drills |
| 12.7 | Business continuity | ✅ | BCP, DR tested quarterly |
| 12.8 | User awareness | ✅ | Annual training, phishing tests |
| 12.9 | Service provider management | ✅ | Vendor risk program |
| 12.10 | Incident response plan | ✅ | IR plan, runbooks |
| 12.10.1 | Response procedures | ✅ | Documented runbooks |
| 12.10.2 | Training | ✅ | Annual IR training |
| 12.10.2 | Testing | ✅ | Quarterly tabletop exercises |
| 12.10.3 | Contacts | ✅ | Updated quarterly |
| 12.10.4 | Reporting | ✅ | 72-hour breach notification |
| 12.10.5 | Forensic capability | ✅ | Logging, chain of custody |
| 12.10.6 | Communication | ✅ | Stakeholder notification |
| 12.10.7 | Recovery | ✅ | RTO 4h, RPO 1h |
| 12.10.8 | Lessons learned | ✅ | Post-incident reviews |
| 12.11 | Reviews | ✅ | Annual policy review |

---

## Razorpay Integration Security

### Payment Flow Security
```
User → EtherTrack (HTTPS) → Razorpay Checkout (HTTPS, PCI DSS L1) → 
  Razorpay processes payment → Webhook to EtherTrack (HMAC verified) → 
  Order confirmation
```

### Security Controls
| Control | Implementation |
|---------|----------------|
| Razorpay PCI DSS | Level 1 Certified (AOC available) |
| Webhook Verification | HMAC-SHA256 signature validation |
| Idempotency | Idempotency keys on all payment endpoints |
| Webhook Replay Protection | Timestamp validation, nonce |
| TLS | TLS 1.3 enforced |
| HSTS | Enabled, preload |
| CSP | Strict CSP headers |
| SRI | Subresource integrity on Razorpay JS |

---

## Evidence Collection for QSA

| Evidence | Location | Frequency |
|----------|----------|-----------|
| Razorpay AOC/ROC | `compliance/pci/razorpay-aoc.pdf` | Annual |
| Network Diagram | `compliance/pci/network-diagram.pdf` | Annual |
| Data Flow Diagram | `compliance/pci/data-flow.pdf` | Annual |
| Firewall Rules | `compliance/pci/firewall-rules.json` | Quarterly |
| Vulnerability Scans | `evidence/vulnerability-scans/` | Weekly |
| Penetration Test Report | `compliance/pci/pen-test-report.pdf` | Annual |
| Penetration Test Remediation | `evidence/pen-test-remediation/` | Per finding |
| Firewall Configs | `compliance/pci/firewall-config/` | Quarterly |
| Wireless Survey | N/A | N/A |
| Anti-virus Logs | CloudWatch/EDR | Monthly |
| Patch Management | `evidence/patching/` | Monthly |
| Change Management | GitHub PRs, Deploy logs | Continuous |
| Access Control | IAM policies, IAM Access Analyzer | Quarterly |
| Authentication Logs | CloudTrail, Auth logs | Monthly |
| Audit Logs | CloudTrail, Application logs | Continuous |
| Time Sync | NTP config, CloudWatch | Quarterly |
| Log Retention | S3 lifecycle policies | Continuous |
| Log Review Process | Runbooks, Alerting | Weekly |
| Exception Handling | Runbooks, PagerDuty | Per incident |
| Wireless Survey | N/A | N/A |
| Anti-virus | EDR Dashboard | Weekly |
| Vulnerability Scans | Trivy, Snyk, GitHub CodeQL | Weekly |
| Penetration Testing | Annual Report | Annual |
| IDS/IPS | GuardDuty, WAF | Continuous |
| Change Detection | Tripwire, GitOps | Continuous |
| Security Policy | `compliance/pci/security-policy.md` | Annual |
| Risk Assessment | `compliance/pci/risk-assessment.md` | Annual |
| Usage Policies | Employee Handbook | Annual |
| Roles/Responsibilities | RACI Matrix | Annual |
| Incident Response | `compliance/ir/plan.md` | Annual |
| BCP/DR | `compliance/bcp/plan.md` | Annual |
| User Awareness | Training Records | Annual |
| Service Providers | Vendor Risk Register | Quarterly |
| Incident Response | `compliance/ir/plan.md` | Annual |

---

## Attestation of Compliance (AOC) Checklist

| Item | Status | Evidence |
|------|--------|----------|
| SAQ A-EP Completed | ✅ | `compliance/pci/saq-aep-2026.pdf` |
| AOC Signed | ✅ | `compliance/pci/aoc-2026.pdf` |
| Quarterly Scans | ✅ | ASV Scan Reports |
| Annual Pen Test | ✅ | Scheduled Q4 2026 |
| ASV Scan | ✅ | ASV Certificate |
| Firewall Review | ✅ | Quarterly Review |
| Vulnerability Remediation | ✅ | 30-day SLA |
| Change Management | ✅ | PR/Deploy Logs |
| Access Reviews | ✅ | Quarterly |
| Incident Response Test | ✅ | Quarterly Drill |

---

## Next Actions

1. **Schedule ASV Scan** - Q4 2026
2. **Schedule Annual Pen Test** - Q4 2026
3. **Update Network Diagram** - Q3 2026
3. **Review Firewall Rules** - Quarterly
4. **Update SAQ A-EP** - Q4 2026
5. **Submit AOC** - Q4 2026

---

*Last Updated: 2026-08-14*  
*Next Review: 2026-11-14*