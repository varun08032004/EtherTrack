# RUNBOOK: SEV-2 Payment Gateway Down

**Severity:** SEV-2 (High)
**Target Resolution:** < 4 hours
**Escalation:** Engineering Lead, Platform Lead, Finance Lead

---

## Detection
- Alert: `PaymentWebhookFailure` rate > 5/min
- Alert: `RazorpayAPIFailure`
- User reports payment failures
- Razorpay status page shows degraded

---

## Triage (0-10 minutes)

### 1. Check Razorpay Status
```bash
# Official status
curl https://api.razorpay.com/v1/health

# Status page
curl https://status.razorpay.com/api/v2/status.json
```

### 2. Check Webhook Delivery
```bash
# Recent webhook logs
kubectl logs -l app=ethertrack-api -n production | grep webhook | tail -50

# Check webhook endpoint
curl -X POST https://api.ethertrack.in/api/subscription/webhook/razorpay \
  -H "Content-Type: application/json" \
  -d '{"test":true}'
```

### 3. Check Payment Records
```bash
# Failed payments in last hour
psql -h postgres.production -c "
  SELECT * FROM subscription_payments 
  WHERE status = 'failed' AND created_at > NOW() - INTERVAL '1 hour';
"
```

---

## Common Causes & Actions

### Razorpay Outage
```bash
# Verify on status page
# If confirmed outage:
# 1. Enable backup provider (Stripe)
kubectl set env deployment/ethertrack-api -n production PAYMENT_PROVIDER=stripe
kubectl rollout restart deployment/ethertrack-api -n production

# 2. Communicate to users
# "Payment processing temporarily using backup provider"
```

### Webhook Signature Verification Failures
```bash
# Check webhook secret
kubectl get secret razorpay-webhook-secret -n production -o yaml

# Rotate webhook secret in Razorpay dashboard
# Update Kubernetes secret
kubectl create secret generic razorpay-webhook-secret \
  --from-literal=secret=<new-secret> -n production --dry-run=client -o yaml | kubectl replace -f -
```

### Network/DNS Issues
```bash
# Test connectivity
curl -v https://api.razorpay.com/v1/payments

# Check DNS
dig api.razorpay.com

# Check firewall/WAF rules
```

---

## Containment
1. **Pause** new payment acceptance if completely down:
   ```bash
   kubectl set env deployment/ethertrack-api -n production FEATURE_PAYMENTS_ENABLED=false
   ```
2. **Queue** pending payments for retry
3. **Communicate** to users: "Payment processing temporarily unavailable"

---

## Resolution
1. **Fix** root cause (Razorpay recovery, webhook fix, network fix)
2. **Re-enable** payments
3. **Retry** queued payments
4. **Verify** success rate > 99%
5. **Process** any manual reconciliation needed

---

## Post-Incident
- Reconcile all payments during outage
- Schedule RCA
- Write postmortem