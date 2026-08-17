# RUNBOOK: Cost Monitoring & Alerts

**Status:** OPERATIONAL
**Owner:** Platform Lead / FinOps
**Review:** Monthly
**Last Updated:** 2026-08-15

---

## Overview

This runbook defines cost monitoring, alerting, and optimization for EtherTrack production infrastructure.

---

## Cost Breakdown (Monthly Estimates - USD)

### Infrastructure Costs

| Component | Provider | Monthly Cost | % of Total | Billing Model |
|-----------|----------|--------------|------------|---------------|
| **PostgreSQL Primary** | AWS RDS / Supabase | $350 | 16% | On-Demand |
| **Read Replicas (2x)** | AWS RDS | $180 | 8% | On-Demand |
| **Redis (ElastiCache)** | AWS ElastiCache | $180 | 8% | On-Demand |
| **EKS Control Plane** | AWS EKS | $73 | 3% | Fixed |
| **Worker Nodes (3x m6i.large)** | AWS EC2 | $270 | 12% | On-Demand / Spot |
| **Application Load Balancer** | AWS ALB | $25 | 1% | Per LCU |
| **CloudFront CDN** | AWS CloudFront | $50 | 2% | Per Request |
| **Route53 / DNS** | AWS Route53 | $5 | <1% | Per Zone |
| **S3 Storage (Backups)** | AWS S3 | $20 | 1% | Per GB |
| **CloudWatch / Logs** | AWS CloudWatch | $50 | 2% | Per GB |
| **Data Transfer (Egress)** | AWS | $50 | 2% | Per GB |

**Subtotal Infrastructure: ~$1,228/mo (55%)**

### External Services

| Component | Provider | Monthly Cost | % of Total | Billing Model |
|-----------|----------|--------------|------------|---------------|
| **Alchemy RPC (Growth)** | Alchemy | $499 | 23% | Fixed Monthly |
| **Pinata IPFS (Enterprise)** | Pinata | $500 | 22% | Fixed Monthly |
| **Razorpay** | Razorpay | Variable | Variable | Per Transaction |
| **SendGrid / SES** | AWS SES | $20 | 1% | Per Email |
| **Sentry** | Sentry | $26 | 1% | Fixed Monthly |
| **PagerDuty** | PagerDuty | $21 | 1% | Per User |

**Subtotal External: ~$1,040/mo (45%)**

---

## Total Monthly Cost: ~$2,268/mo

### Cost by Category
| Category | Monthly | Annual | % |
|----------|---------|--------|---|
| Compute (EC2/EKS) | $343 | $4,116 | 15% |
| Database (RDS) | $530 | $6,360 | 23% |
| Cache (Redis) | $180 | $2,160 | 8% |
| Networking (ALB, CF, DNS) | $125 | $1,500 | 5% |
| Storage (S3, EBS) | $70 | $840 | 3% |
| Monitoring (CW, Loki) | $50 | $600 | 2% |
| External APIs (Alchemy, Pinata) | $999 | $11,988 | 44% |
| Payments (Razorpay) | Variable | Variable | Variable |
| **Total** | **~$2,268** | **~$27,216** | **100%** |

---

## Cost per Transaction Metrics

| Metric | Current | Target | Trend |
|--------|---------|--------|-------|
| Cost per API Request | $0.0045 | < $0.003 | ↓ |
| Cost per Trade | $0.12 | < $0.08 | ↓ |
| Cost per KYC Verification | $0.45 | < $0.30 | ↓ |
| Cost per Credit Mint | $0.08 | < $0.05 | ↓ |
| Cost per Active User/Month | $2.30 | < $1.50 | ↓ |

---

## Cost Monitoring & Alerts

### Prometheus Metrics for Cost

```yaml
# Cost metrics exposed by custom exporter
- name: aws_estimated_charges
  type: gauge
  labels: [service, linked_account]
  help: "Estimated AWS charges in USD"

- name: alchemy_rpc_usage
  type: gauge
  labels: [metric_type]
  help: "Alchemy RPC usage (requests, compute units)"

- name: pinata_storage_used_gb
  type: gauge
  help: "Pinata storage used in GB"

- name: pinata_bandwidth_used_gb
  type: gauge
  help: "Pinata bandwidth used in GB"

- name: razorpay_transaction_fees
  type: counter
  labels: [status]
  help: "Razorpay transaction fees in INR"

- name: infra_cost_per_request
  type: gauge
  help: "Estimated infrastructure cost per API request"
```

### Grafana Cost Dashboard

**Panels:**
1. **Total Monthly Spend** - Trend line with forecast
2. **Cost by Service** - Stacked bar chart
3. **Cost per Request** - Time series with alert threshold
4. **External API Spend** - Alchemy, Pinata, Razorpay
5. **Cost per Transaction** - By type (trade, KYC, mint, payment)
6. **Savings Opportunities** - RI savings, spot savings, right-sizing

### Alert Rules

```yaml
groups:
  - name: cost-alerts
    interval: 1h
    rules:
      # Monthly budget alerts
      - alert: MonthlyBudgetExceeded
        expr: |
          sum(aws_estimated_charges) > 2500
        for: 1h
        labels:
          severity: warning
          team: platform
        annotations:
          summary: "Monthly AWS spend exceeded $2,500"
          description: "Current spend: ${{ $value }} (Budget: $2,500)"
          runbook_url: "https://docs.ethertrack.in/runbooks/cost-overrun"

      - alert: MonthlyBudgetCritical
        expr: |
          sum(aws_estimated_charges) > 3000
        for: 30m
        labels:
          severity: critical
          team: platform
        annotations:
          summary: "Monthly AWS spend exceeded $3,000"
          description: "Current spend: ${{ $value }} (Critical threshold: $3,000)"
          runbook_url: "https://docs.ethertrack.in/runbooks/cost-overrun"

      # External service cost alerts
      - alert: AlchemyUsageHigh
        expr: |
          alchemy_rpc_usage{metric_type="requests_per_second"} > 80
        for: 15m
        labels:
          severity: warning
          team: platform
        annotations:
          summary: "Alchemy RPC usage > 80 req/s"
          description: "Current: ${{ $value }} req/s (Limit: 100)"
          runbook_url: "https://docs.ethertrack.in/runbooks/alchemy-usage-high"

      - alert: PinataStorageHigh
        expr: |
          pinata_storage_used_gb > 8
        for: 1h
        labels:
          severity: warning
          team: platform
        annotations:
          summary: "Pinata storage > 8 GB"
          description: "Current: ${{ $value }} GB (Limit: 10 GB)"

      - alert: PinataBandwidthHigh
        expr: |
          pinata_bandwidth_used_gb > 80
        for: 1h
        labels:
          severity: warning
          team: platform
        annotations:
          summary: "Pinata bandwidth > 80 GB/month"
          description: "Current: ${{ $value }} GB (Limit: 100 GB)"

      - alert: RazorpayFeesHigh
        expr: |
          rate(razorpay_transaction_fees[1h]) > 50000
        for: 15m
        labels:
          severity: warning
          team: finance
        annotations:
          summary: "Razorpay fees > ₹50,000/hr"
          description: "Hourly fees: ₹${{ $value }}"

      # Cost efficiency alerts
      - alert: CostPerRequestHigh
        expr: |
          infra_cost_per_request > 0.005
        for: 30m
        labels:
          severity: warning
          team: platform
        annotations:
          summary: "Infrastructure cost per request > $0.005"
          description: "Current: ${{ $value }} per request"

      - alert: CostPerTradeHigh
        expr: |
          (rate(infra_cost_total[1h]) / rate(trades_total{status="success"}[1h])) > 0.15
        for: 1h
        labels:
          severity: warning
          team: finance
        annotations:
          summary: "Cost per trade > $0.15"
          description: "Current cost per successful trade: ${{ $value }}"

      # Savings opportunities
      - alert: UnusedEBSVolumes
        expr: |
          aws_ebs_volume_size_bytes{status="available"} > 0
        for: 24h
        labels:
          severity: info
          team: platform
        annotations:
          summary: "Unattached EBS volumes detected"
          description: "Found unattached volumes incurring costs"

      - alert: IdleLoadBalancer
        expr: |
          aws_alb_request_count_total < 100
        for: 24h
        labels:
          severity: info
          team: platform
        annotations:
          summary: "Load balancer receiving < 100 requests/day"
          description: "Consider removing unused ALB"

      - alert: OverprovisionedRDS
        expr: |
          (aws_rds_cpu_utilization < 20) and (aws_rds_instance_class =~ ".*large.*|.*xlarge.*")
        for: 24h
        labels:
          severity: info
          team: platform
        annotations:
          summary: "RDS instance underutilized (< 20% CPU)"
          description: "Consider downsizing: ${{ $labels.instance_id }}"
```

---

## Cost Optimization Strategies

### 1. Reserved Instances / Savings Plans

| Resource | Current | 1-Year RI | 3-Year RI | Savings |
|----------|---------|-----------|-----------|---------|
| db.r6g.xlarge (PostgreSQL) | $350/mo | $245/mo | $175/mo | 30-50% |
| db.r6g.large (Read Replica) | $90/mo | $63/mo | $45/mo | 30-50% |
| cache.r6g.large (Redis) | $180/mo | $126/mo | $90/mo | 30-50% |
| m6i.large (EKS) | $90/mo | $63/mo | $45/mo | 30-50% |

**Action:** Purchase 1-year RI for stable workloads (DB, Redis), 3-year for stable baseline.

### 2. Spot Instances for EKS Workers

```yaml
# EKS Managed Node Group with Spot
apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig
managedNodeGroups:
  - name: spot-workers
    instanceType: m6i.large
    spot: true
    minSize: 2
    maxSize: 8
    desiredCapacity: 3
    labels:
      workload-type: spot-tolerant
    taints:
      - key: "spot"
        value: "true"
        effect: "NoSchedule"
```

**Savings:** ~60-70% vs On-Demand (~$90/mo per node)

### 3. Database Optimization

```sql
-- Identify unused indexes
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
AND schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_relation_size(indexrelid) DESC;

-- Find missing indexes
SELECT * FROM pg_stat_user_tables
WHERE seq_scan > 1000 AND idx_scan < seq_scan * 0.1;
```

### 4. Redis Optimization

```bash
# Check memory fragmentation
redis-cli INFO memory | grep fragmentation

# Check key expiration
redis-cli --scan --pattern "*" | head -100 | xargs -I {} redis-cli TTL {}

# Optimize: Use pipeline for batch operations
# Use Lua scripts for atomic operations
# Enable compression for large values
```

### 5. Alchemy RPC Optimization

```javascript
// Batch JSON-RPC calls
const batch = [
  { jsonrpc: "2.0", method: "eth_getBalance", params: [addr1, "latest"], id: 1 },
  { jsonrpc: "2.0", method: "eth_getBalance", params: [addr2, "latest"], id: 2 },
  { jsonrpc: "2.0", method: "eth_getBalance", params: [addr3, "latest"], id: 3 }
];
await provider.sendBatch(batch);

// Cache contract reads
const cache = new Map();
async function getBalanceCached(address) {
  const key = `balance:${address}`;
  if (cache.has(key) && Date.now() - cache.get(key).ts < 30000) {
    return cache.get(key).value;
  }
  const balance = await provider.getBalance(address);
  cache.set(key, { value: balance, ts: Date.now() });
  return balance;
}
```

### 5. Backup Storage Tiering

```bash
# Move backups older than 90 days to Glacier Deep Archive
aws s3 cp s3://ethertrack-backups/daily/ s3://ethertrack-backups-archive/daily/ \
  --storage-class DEEP_ARCHIVE --recursive \
  --exclude "*" --include "backup-2026-05-*" --include "backup-2026-04-*"

# Lifecycle policy
aws s3api put-bucket-lifecycle-configuration --bucket ethertrack-backups \
  --lifecycle-configuration '{
    "Rules": [
      {"ID": "ArchiveOldBackups", "Status": "Enabled", "Filter": {"Prefix": "daily/"}, "Transitions": [{"Days": 90, "StorageClass": "DEEP_ARCHIVE"}]},
      {"ID": "DeleteOldBackups", "Status": "Enabled", "Filter": {"Prefix": "daily/"}, "Expiration": {"Days": 365}}
    ]
  }'
```

---

## Budget Management

### Monthly Budget Allocation

| Category | Budget | Alert Threshold | Action |
|----------|--------|-----------------|--------|
| Infrastructure | $1,300 | $1,100 (85%) | Review scaling |
| External APIs | $1,100 | $935 (85%) | Review usage |
| Contingency | $200 | $170 (85%) | N/A |
| **Total** | **$2,500** | **$2,125 (85%)** | **Review at 85%** |

### Budget Alerts
```yaml
- alert: BudgetExceeded85Percent
  expr: |
    (sum(aws_estimated_charges) + alchemy_cost + pinata_cost) / 2500 > 0.85
  for: 1h
  labels:
    severity: warning
    team: platform
  annotations:
    summary: "Budget at 85% of monthly limit"
    description: "Current spend: ${{ $value | humanizePercentage }} of $2,500 budget"

- alert: BudgetExceeded100Percent
  expr: |
    (sum(aws_estimated_charges) + alchemy_cost + pinata_cost) > 2500
  for: 30m
  labels:
    severity: critical
    team: platform
  annotations:
    summary: "Monthly budget exceeded!"
    description: "Spend: ${{ $value }} (Budget: $2,500)"
```

---

## Cost Allocation Tags

```yaml
# Tag all resources for cost allocation
Tags:
  - Key: Project
    Value: ethertrack
  - Key: Environment
    Value: production|staging
  - Key: Team
    Value: platform|engineering|finance|security
  - Key: CostCenter
    Value: ENG-001
  - Key: Owner
    Value: platform-team
  - Key: CostCenter
    Value: ENG-001
```

### Cost Allocation Report (Monthly)
```sql
-- AWS Cost Explorer query equivalent
SELECT 
  service,
  SUM(unblended_cost) as total_cost,
  COUNT(DISTINCT resource_id) as resource_count
FROM cost_and_usage
WHERE 
  time_period_start >= '2026-08-01'
  AND time_period_end < '2026-09-01'
  AND tags.Project = 'ethertrack'
GROUP BY service
ORDER BY total_cost DESC;
```

---

## Cost Anomaly Detection

### AWS Cost Anomaly Detection
```bash
# Enable Cost Anomaly Detection
aws ce create-anomaly-monitor \
  --monitor-name "EtherTrack-Production" \
  --monitor-type "DIMENSIONAL" \
  --monitor-specification '{"Dimension":"SERVICE","Values":["AmazonEC2","AmazonRDS","AmazonElastiCache","AmazonS3"]}' \
  --monitor-dimension "LINKED_ACCOUNT"
```

### Custom Anomaly Detection (Prometheus)
```yaml
- alert: CostAnomalyDetected
  expr: |
    abs(increase(aws_estimated_charges[1h]) - 
        avg_over_time(increase(aws_estimated_charges[1h])[7d:1h])) 
      > 2 * stddev_over_time(increase(aws_estimated_charges[1h])[7d:1h])
  for: 1h
  labels:
    severity: warning
    team: platform
  annotations:
    summary: "Cost anomaly detected"
    description: "Hourly spend anomaly detected: ${{ $value }}"
```

---

## Reporting

### Monthly Cost Report Template

```markdown
# EtherTrack Monthly Cost Report - {{MONTH}} {{YEAR}}

## Executive Summary
- **Total Spend:** ${{TOTAL_SPEND}} ({{VARIANCE}}% vs budget)
- **Top 3 Drivers:** {{TOP_3_SERVICES}}
- **Anomalies:** {{ANOMALY_COUNT}} detected
- **Optimizations Applied:** {{OPTIMIZATIONS_COUNT}}

## Cost by Service
| Service | Current Month | Previous Month | Variance | % of Total |
|---------|---------------|----------------|----------|------------|
| PostgreSQL | $350 | $350 | 0% | 15% |
| Alchemy | $499 | $499 | 0% | 22% |
| ... | ... | ... | ... | ... |

## Key Metrics
- **Cost per Request:** $0.0045 (target: <$0.003)
- **Cost per Trade:** $0.12 (target: <$0.08)
- **Cost per Active User:** $2.30 (target: <$1.50)

## Anomalies Detected
| Date | Service | Expected | Actual | Variance | Root Cause |
|------|---------|----------|--------|----------|------------|
| 2026-08-15 | Alchemy | 60 req/s | 95 req/s | +58% | Traffic spike from new feature launch |

## Optimizations This Month
- [ ] Moved 2 EKS nodes to Spot (-$60/mo)
- [ ] Enabled S3 Intelligent Tiering for backups
- [ ] Optimized Alchemy batch requests (-15% CU usage)

## Recommendations
1. Purchase 1-year RI for PostgreSQL primary (-30%)
2. Enable S3 Intelligent Tiering for uploads bucket
3. Review Alchemy usage - consider Enterprise plan if >80 req/s sustained

## Next Month Forecast
- Projected Spend: $2,350
- Risk Factors: Black Friday traffic, new feature launch
```

---

## Automation

### Daily Cost Sync (Lambda/CloudWatch)
```python
# Daily cost sync to Prometheus
import boto3
import prometheus_client

def sync_costs():
    ce = boto3.client('ce')
    response = ce.get_cost_and_usage(
        TimePeriod={'Start': '2026-08-01', 'End': '2026-08-15'},
        Granularity='DAILY',
        Metrics=['UnblendedCost'],
        GroupBy=[{'Type': 'DIMENSION', 'Key': 'SERVICE'}]
    )
    
    for result in response['ResultsByTime']:
        for group in result['Groups']:
            service = group['Keys'][0]
            cost = float(group['Metrics']['UnblendedCost']['Amount'])
            aws_estimated_charges.labels(service=service).set(cost)
```

### Scheduled Reports
```yaml
# GitHub Actions / CronJob
apiVersion: batch/v1
kind: CronJob
metadata:
  name: monthly-cost-report
  namespace: ethertrack
spec:
  schedule: "0 9 1 * *"  # 1st of month, 9 AM UTC
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: cost-report
            image: ethertrack/cost-reporter:latest
            env:
            - name: AWS_REGION
              value: "us-east-1"
            - name: SLACK_WEBHOOK
              valueFrom:
                secretKeyRef:
                  name: slack-webhook
                  key: url
          restartPolicy: OnFailure
  schedule: "0 9 1 * *"
```

---

## Vendor Negotiation Checklist

### Quarterly Vendor Reviews
- [ ] **Alchemy:** Review usage vs plan, negotiate Enterprise if >80 req/s
- [ ] **Pinata:** Review storage/bandwidth growth, negotiate volume discount
- [ ] **Razorpay:** Review transaction fees, negotiate volume tiers
- [ ] **AWS:** Review RI/Savings Plans utilization, adjust commitments
- [ ] **Cloudflare:** Review bandwidth usage, optimize caching

### Negotiation Targets
| Vendor | Current Spend | Target Reduction | Strategy |
|--------|---------------|------------------|----------|
| Alchemy | $499/mo | 15% | Commit to Enterprise annual |
| Pinata | $500/mo | 20% | Volume discount + annual commit |
| AWS | $1,228/mo | 25% | 3-yr RI + Savings Plans |
| Razorpay | Variable | 10% | Volume tier negotiation |

---

## Compliance & Audit

### SOC 2 Cost Controls
- [ ] CC6.1 - Cost monitoring documented
- [ ] CC6.7 - Change management for cost-impacting changes
- [ ] CC7.2 - Anomaly detection for cost anomalies

### PCI DSS
- [ ] Req 12.10 - Incident response includes cost impact
- [ ] Req 12.10.1 - Cost tracking for security incidents

---

## Final Cost Health Check

| Metric | Status | Target |
|--------|--------|--------|
| Total Monthly Spend | $2,268 | < $2,500 |
| Cost per Request | $0.0045 | < $0.003 |
| Budget Utilization | 91% | < 85% |
| RI/Savings Plan Coverage | 45% | > 70% |
| Spot Instance Usage | 0% | > 30% |
| Anomaly Detection | Active | 100% coverage |
| Monthly Report | Generated | 1st of month |

---

*Last Updated: 2026-08-15*  
*Next Review: 2026-09-15*  
*Owner: Platform Lead / FinOps*