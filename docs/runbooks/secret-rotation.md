# RUNBOOK: Secret Rotation

**Severity:** Routine Maintenance
**Frequency:** Per schedule below
**Owner:** Platform Engineer / Security Engineer
**Status:** AUTOMATED WITH MANUAL STEPS

---

## Overview

This runbook covers the rotation of all secrets used by EtherTrack. Some secrets can be auto-generated, while others require manual rotation in external provider dashboards.

---

## Secret Inventory & Rotation Schedule

| Secret | Type | Rotation Frequency | Auto-Generated | Provider Dashboard |
|--------|------|-------------------|----------------|-------------------|
| JWT Secret | Internal | 90 days | ✅ Yes | N/A |
| JWT Refresh Secret | Internal | 90 days | ✅ Yes | N/A |
| TOTP Encryption Key | Internal | 365 days | ✅ Yes | N/A |
| Cookie Secret | Internal | 90 days | ✅ Yes | N/A |
| Razorpay Key ID/Secret | External | 90 days | ❌ No | Razorpay Dashboard |
| Razorpay Webhook Secret | External | 90 days | ❌ No | Razorpay Dashboard |
| Pinata API Key/Secret | External | 180 days | ❌ No | Pinata Dashboard |
| Alchemy RPC Key | External | 365 days | ❌ No | Alchemy Dashboard |
| SMTP Credentials | External | 90 days | ❌ No | Email Provider |
| Chain Signer Key | External | 365 days | ❌ No | N/A (generate keypair) |
| ERP Credentials Key | External | 180 days | ❌ No | ERP System |
| ERP Write Tokens | External | 180 days | ❌ No | ERP System |

---

## Automated Rotation (Internal Secrets)

Internal secrets (JWT, TOTP, Cookie) can be fully automated:

```bash
# Rotate all internal secrets
./scripts/rotate-secrets.sh jwt

# Or rotate all internal secrets at once
./scripts/rotate-secrets.sh all --dry-run  # Test first
./scripts/rotate-secrets.sh all
```

**What happens:**
1. New cryptographically secure secrets generated
2. Kubernetes secret patched
3. Backend deployment automatically restarted (rolling update)
3. Zero-downtime rotation

**Verification:**
- Check deployment rollout: `kubectl rollout status deployment/ethertrack-backend -n ethertrack`
- Verify new secrets work: `curl https://api.ethertrack.in/health`

---

## Manual Rotation (External Secrets)

These require manual action in provider dashboards:

### 1. Razorpay (Every 90 days)

**Dashboard:** https://dashboard.razorpay.com/app/keys

**Steps:**
1. Go to Settings > API Keys
2. Click "Generate New Key" for both Key ID and Key Secret
2. Update webhook secret: Settings > Webhooks > Edit > Regenerate Secret
3. Run rotation script:

```bash
./scripts/rotate-secrets.sh razorpay
# Enter new Key ID, Key Secret, and Webhook Secret when prompted
```

**Verification:**
- Test payment flow: `curl -X POST https://api.ethertrack.in/api/subscription/order ...`
- Check webhook delivery in Razorpay Dashboard > Webhooks

### 2. Pinata (IPFS) - Every 180 days

**Dashboard:** https://app.pinata.cloud/keys

**Steps:**
1. Go to API Keys page
2. Click "New Key" > Select permissions (pinFileToIPFS, pinJSONToIPFS, etc.)
3. Copy new API Key and Secret
4. Run rotation script:

```bash
./scripts/rotate-secrets.sh pinata
# Enter new API Key and Secret when prompted
```

### 3. Alchemy RPC - Every 365 days

**Dashboard:** https://dashboard.alchemy.com/

**Steps:**
1. Go to Apps > Select App > View Key
2. Click "Regenerate Key"
3. Copy new RPC URL
4. Run rotation script:

```bash
./scripts/rotate-secrets.sh alchemy
# Enter new RPC URL when prompted
```

### 4. SMTP Credentials - Every 90 days

**Provider:** Gmail / SendGrid / AWS SES / etc.

**Steps:**
1. Generate new app password / SMTP credentials in provider
2. Run rotation script:

```bash
./scripts/rotate-secrets.sh smtp
# Enter new host, user, password, from address
```

### 5. Blockchain Signing Keys - Every 365 days

**Critical:** This invalidates all pending blockchain transactions!

**Pre-requisites:**
- No pending transactions in queue
- Maintenance window scheduled
- Team notified

**Steps:**
1. Generate new keypair:
```bash
# Generate new keypair
openssl ecparam -name secp256k1 -genkey -noout -out private_key.pem
openssl ec -in private_key.pem -pubout -out public_key.pem
# Convert to hex
openssl ec -in private_key.pem -text -noout | grep -A 5 "priv:" | tail -1 | tr -d ' :'
```

2. Update signer wallet address in contracts (if changed)

3. Run rotation script:

```bash
./scripts/rotate-secrets.sh chain
# Enter new private key (64 hex chars), wallet address, RPC URL
```

### 3. ERP Credentials - Every 180 days

**Steps:**
1. Generate new encryption key in ERP system
3. Generate new write tokens in ERP system
3. Run rotation script:

```bash
./scripts/rotate-secrets.sh erp
# Enter new credentials key and write tokens
```

---

## Emergency Rotation (Compromise)

If a secret is compromised:

```bash
# Emergency rotation - immediate
./scripts/rotate-secrets.sh <secret_type> --force

# For chain keys (highest priority)
./scripts/rotate-secrets.sh chain --force
```

**Immediate actions:**
1. Revoke compromised secret in provider dashboard immediately
2. Rotate using script above
3. Monitor for unauthorized access
4. Notify security team
5. File incident report

---

## Rotation Verification Checklist

After any rotation:

- [ ] Backend health check: `curl https://api.ethertrack.in/health`
- [ ] Frontend health check: `curl https://ethertrack.in/health`
- [ ] Test critical user flows (login, payment, trade)
- [ ] Check error rates in Grafana
- [ ] Verify no error spikes in logs
- [ ] Confirm all deployments healthy: `kubectl get pods -n ethertrack`

---

## Automation

### Scheduled Rotation (CronJob)

```yaml
# k8s/cronjobs/secret-rotation.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: secret-rotation-internal
  namespace: ethertrack
spec:
  schedule: "0 3 * * 0"  # Weekly on Sunday 3 AM
  jobTemplate:
    spec:
      template:
        spec:
          serviceAccountName: ethertrack-cron
          restartPolicy: OnFailure
          containers:
          - name: rotate-secrets
            image: ghcr.io/ethertrack/rotate-secrets:latest
            command: ["/scripts/rotate-secrets.sh", "jwt"]
            env:
              - name: KUBECONFIG
                value: "/etc/kubeconfig"
          restartPolicy: OnFailure
```

---

## Troubleshooting

### Rotation Fails
1. Check kubectl access: `kubectl auth can-i patch secrets -n ethertrack`
2. Check secret exists: `kubectl get secret ethertrack-secrets -n ethertrack -o yaml`
3. Check deployment status: `kubectl get pods -n ethertrack`

### Service Fails After Rotation
1. Check pod logs: `kubectl logs -l app=ethertrack-backend -n ethertrack --tail=100`
2. Verify secret values: `kubectl get secret ethertrack-secrets -n ethertrack -o jsonpath='{.data}' | jq -r 'to_entries[] | "\(.key)=\(.value|@base64d)"'`
3. Check if deployment rolled out: `kubectl rollout status deployment/ethertrack-backend -n ethertrack`

### Rollback
```bash
# Rollback deployment
kubectl rollout undo deployment/ethertrack-backend -n ethertrack
kubectl rollout status deployment/ethertrack-backend -n ethertrack
```

---

## Audit Trail

All rotations are logged to:
- Kubernetes audit logs
- Git history (if secrets committed to sealed-secrets or similar)
- Script output (capture in CI/CD logs)

**Retention:** 7 years for compliance

---

## Compliance

- **SOC 2:** CC6.1, CC6.7 - Secret rotation documented and automated
- **PCI DSS:** Req 8.2.3 - Cryptographic key rotation
- **GDPR:** Art. 32 - Encryption key management
- **DPDP:** Sec. 9 - Security safeguards

---

*Last Updated: 2026-08-15*  
*Next Review: 2026-11-15*  
*Owner: Platform Engineer*