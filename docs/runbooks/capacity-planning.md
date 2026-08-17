# RUNBOOK: Capacity Planning

**Status:** OPERATIONAL
**Owner:** Platform Lead
**Review:** Quarterly
**Last Updated:** 2026-08-15

---

## Overview

This runbook defines capacity thresholds, scaling policies, and monitoring for all critical infrastructure components.

---

## Current Capacity Baseline (as of 2026-08-15)

### Production Environment
| Component | Current Spec | Current Utilization | Headroom |
|-----------|--------------|---------------------|----------|
| **Backend API** | 3 pods × 2 CPU / 2 GiB | CPU: 35%, Mem: 45% | 3x |
| **Frontend (Nginx)** | 3 pods × 0.5 CPU / 512 MiB | CPU: 15%, Mem: 30% | 5x |
| **PostgreSQL** | 1 primary + 2 read replicas, db.r6g.xlarge (4 vCPU, 32 GiB) | CPU: 40%, Mem: 55%, Connections: 65/100 | 1.5x |
| **Redis** | cache.r6g.large (2 vCPU, 13 GiB) | CPU: 20%, Mem: 40% | 2.5x |
| **Blockchain RPC** | Alchemy Growth (100 req/s) | 60 req/s avg, 95 req/s peak | 1.5x |
| **Pinata/IPFS** | Enterprise (10 TB/mo) | 2 TB/mo | 5x |
| **Razorpay** | Standard (1000 req/min) | 50 req/min avg | 20x |

---

## Resource Limits & Thresholds

### Kubernetes Resources

| Component | CPU Request | CPU Limit | Memory Request | Memory Limit | Replicas |
|-----------|-------------|-----------|----------------|--------------|----------|
| Backend API | 500m | 2000m | 512Mi | 2Gi | 3 (min) / 10 (max) |
| Frontend | 100m | 500m | 128Mi | 512Mi | 3 (min) / 10 (max) |
| PostgreSQL | N/A (managed) | N/A | N/A | N/A | 1 primary + 2 replicas |
| Redis | N/A (managed) | N/A | N/A | N/A | 1 primary + 1 replica |

### HPA Configuration

```yaml
# Backend HPA
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ethertrack-backend-hpa
  namespace: ethertrack
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ethertrack-backend
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 10
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 100
        periodSeconds: 30
      - type: Pods
        value: 2
        periodSeconds: 30
      selectPolicy: Max
```

---

## Database Capacity

### PostgreSQL (Supabase / AWS RDS)

| Metric | Current | Warning | Critical | Action |
|--------|---------|---------|----------|--------|
| CPU Utilization | 40% | 70% | 85% | Scale up instance |
| Memory Utilization | 55% | 75% | 90% | Scale up instance |
| Connection Count | 65 | 80 | 95 | Add pgBouncer / Scale |
| Max Connections | 100 | - | - | Increase max_connections |
| Disk Usage | 45% | 70% | 85% | Expand storage / Archive |
| Replication Lag | <1s | 5s | 30s | Investigate replica |
| Backup Age | < 24h | 24h | 48h | Investigate backup job |

### Connection Pooling (pgBouncer)

```ini
# pgBouncer config
[databases]
ethertrack = host=postgres.production port=5432 dbname=ethertrack

[pgbouncer]
pool_mode = transaction
max_client_conn = 500
default_pool_size = 25
min_pool_size = 5
reserve_pool_size = 5
reserve_pool_timeout = 5
max_db_connections = 80
max_user_connections = 80
```

**Scaling Triggers:**
- Pool utilization > 80% for 5 min → Increase pool_size
- Wait queue > 10 for 2 min → Increase max_client_conn
- Query latency P99 > 1s → Analyze slow queries, add indexes

---

## Blockchain RPC Capacity

### Alchemy / RPC Provider

| Metric | Current Limit | Usage | Threshold | Action |
|--------|---------------|-------|-----------|--------|
| Requests/second | 100 req/s | 60 avg / 95 peak | 80 req/s sustained | Upgrade plan |
| Compute Units/sec | 330 CU/s | 200 avg | 260 CU/s | Optimize queries / Upgrade |
| Archive requests | Included | Low | N/A | N/A |
| WebSocket connections | 100 | 15 | 80 | Monitor |

**Optimization Strategies:**
1. Batch RPC calls (eth_getLogs, eth_call)
2. Use WebSocket subscriptions for real-time events
3. Cache contract reads (balances, allowances) with 30s TTL
4. Batch transaction submission

**Circuit Breaker Config:**
```yaml
circuit_breaker:
  failure_threshold: 5
  success_threshold: 2
  timeout: 30s
  half_open_requests: 3
```

---

## Redis Capacity

### Current (cache.r6g.large - 13 GiB)

| Metric | Current | Warning | Critical | Action |
|--------|---------|---------|----------|--------|
| Memory Used | 5.2 GiB (40%) | 8 GiB (60%) | 10 GiB (80%) | Scale up / Evict |
| Connected Clients | 45 | 200 | 500 | Optimize / Scale |
| Keyspace Hits | 95% | < 90% | < 80% | Investigate misses |
| Evicted Keys | 0/min | 100/min | 1000/min | Increase memory |
| Expired Keys | 500/min | - | - | Normal |
| Commands/sec | 2,000 | 50,000 | 100,000 | Scale / Optimize |

**Eviction Policy:** `allkeys-lru`
**TTL Strategy:**
- Session tokens: 24h
- Cache (prices, balances): 30s - 5min
- Rate limits: 1-15 min
- Feature flags: 5 min

---

## Blockchain / RPC Limits

### Alchemy (Current: Growth Plan)
| Resource | Limit | Current Usage | Headroom |
|----------|-------|---------------|----------|
| Requests/sec | 100 | 60 avg / 95 peak | 5% |
| Compute Units/sec | 330 | 200 avg | 39% |
| Archive requests | Unlimited | Low | N/A |
| WebSockets | 100 | 15 | 85% |

**Upgrade Path:** Growth → Enterprise (300 req/s, 1000 CU/s)

### Fallback RPC Providers
| Provider | Endpoint | Capacity | Use Case |
|----------|----------|----------|----------|
| Alchemy (Primary) | https://eth-mainnet.g.alchemy.com/v2/... | 100 req/s | Primary |
| QuickNode | https://eth-mainnet.quicknode.pro/... | 50 req/s | Failover |
| Infura | https://mainnet.infura.io/v3/... | 100 req/s | Failover |
| Public RPC | https://eth.llamarpc.com | 10 req/s | Emergency |

---

## Storage Capacity

### PostgreSQL (Primary)
- Current: 500 GiB provisioned, 225 GiB used (45%)
- Growth: ~5 GiB/month
- **Projection:** 12 months until 80%
- **Action:** Enable auto-expand at 70%, alert at 80%

### Redis
- Current: 13 GiB, 5.2 GiB used
- Growth: ~0.5 GiB/month
- **Projection:** 24 months until 80%

### Object Storage (Pinata/IPFS)
- Current: 2 TB / 10 TB/month
- Growth: ~200 GB/month
- **Projection:** 40 months until limit

### Backups
- Daily: ~5 GiB compressed
- Retention: 30 days
- Storage: ~150 GiB/month
- **Action:** Move to cold storage after 90 days

---

## Network & Bandwidth

### Current Usage
| Path | Avg Bandwidth | Peak | Limit | Headroom |
|------|---------------|------|-------|----------|
| Ingress (API) | 50 Mbps | 200 Mbps | 1 Gbps | 80% |
| Egress (API) | 30 Mbps | 150 Mbps | 1 Gbps | 85% |
| Inter-service | 20 Mbps | 50 Mbps | 10 Gbps (VPC) | 99% |
| Blockchain RPC | 10 Mbps | 50 Mbps | N/A (external) | N/A |
| IPFS/Pinata | 5 Mbps | 20 Mbps | N/A (external) | N/A |

**CDN (Cloudflare):**
- Cache hit ratio: 85%
- Bandwidth saved: ~60%
- Edge locations: 200+

---

## Scaling Playbooks

### Scale Up Backend (CPU > 70%)
```bash
# Automatic via HPA, or manual:
kubectl scale deployment ethertrack-backend --replicas=5 -n ethertrack
# Verify
kubectl get pods -n ethertrack -l app=ethertrack-backend
```

### Scale Up Database
```bash
# Option 1: Vertical scale (AWS RDS)
aws rds modify-db-instance \
  --db-instance-identifier ethertrack-prod \
  --db-instance-class db.r6g.2xlarge \
  --apply-immediately

# Option 2: Add read replica
aws rds create-db-instance-read-replica \
  --db-instance-identifier ethertrack-prod-replica-3 \
  --source-db-instance-identifier ethertrack-prod
```

### Scale Up Redis
```bash
# AWS ElastiCache
aws elasticache modify-replication-group \
  --replication-group-id ethertrack-redis \
  --cache-node-type cache.r6g.xlarge \
  --apply-immediately
```

### Add Read Replica (PostgreSQL)
```bash
# Supabase / AWS RDS
# 1. Create read replica in dashboard
# 2. Update DATABASE_READ_URL in application
# 3. Restart backend pods
kubectl rollout restart deployment/ethertrack-backend -n ethertrack
```

---

## Monitoring & Alerts

### Capacity Alerts (Prometheus Rules)

```yaml
# Already defined in monitoring/prometheus/rules/ethertrack-alerts.yml
# Key alerts:
- DatabaseConnectionPoolExhausted (>90% for 2m)
- HighDBQueryLatency (P99 > 1s for 5m)
- RedisMemoryHigh (>80%)
- RedisConnectionHigh (>80%)
- BlockchainQueueBacklog (>100)
- HighRPCLatency (P99 > 5s)
- HighCPUUsage (>85%)
- HighMemoryUsage (>85%)
- DiskSpaceLow (>85%)
```

### Grafana Dashboards
- **Database:** Connection pool, query latency, replication lag
- **Redis:** Memory, hit rate, evictions, connections
- **Blockchain:** RPC latency, queue depth, circuit breaker state
- **API:** Request rate, latency, error rate, active requests
- **Infrastructure:** CPU, memory, disk, network per pod

---

## Growth Projections (12 Months)

| Component | Current | 6 Months | 12 Months | Action Required |
|-----------|---------|----------|-----------|-----------------|
| API Requests/day | 500K | 1.5M | 3M | HPA handles |
| DB Connections | 65 avg | 120 | 200 | Add pgBouncer / Scale |
| DB Storage | 225 GiB | 350 GiB | 500 GiB | Auto-expand enabled |
| Redis Memory | 5.2 GiB | 7 GiB | 9 GiB | Scale at 8 GiB |
| RPC Requests/s | 60 | 120 | 200 | Upgrade Alchemy plan |
| Bandwidth | 50 Mbps | 150 Mbps | 300 Mbps | CDN handles |
| Backup Storage | 150 GiB/mo | 200 GiB/mo | 250 GiB/mo | Move to cold storage |

---

## Cost Optimization

### Current Monthly Estimates (USD)
| Component | Current | Optimized | Savings |
|-----------|---------|-----------|---------|
| PostgreSQL (db.r6g.xlarge) | $350 | $350 | - |
| Read Replicas (2x r6g.large) | $180 | $180 | - |
| Redis (cache.r6g.large) | $180 | $180 | - |
| EKS (3x m6i.large) | $270 | $180 (spot) | $90 |
| ALB | $25 | $25 | - |
| CloudFront | $50 | $50 | - |
| Alchemy Growth | $499 | $499 | - |
| Pinata Enterprise | $500 | $500 | - |
| **Total** | **~$2,200** | **~$2,110** | **~$90 (4%)** |

### Optimization Opportunities
1. **EKS Spot Instances** - Save ~$90/mo (use for non-critical workloads)
2. **Redis** - Downsize to cache.r6g.large if memory < 8 GiB
3. **Alchemy** - Monitor usage, downgrade if < 50 req/s sustained
4. **Backup Storage** - Move >90 day backups to Glacier Deep Archive (~$1/TB/mo)
5. **Reserved Instances** - 1-year RI for PostgreSQL/Redis saves ~30%

---

## Capacity Review Process

### Monthly (Automated)
- [ ] Prometheus alerts review
- [ ] Grafana dashboard review
- [ ] Cost report review
- [ ] Capacity projection update

### Quarterly (Manual)
- [ ] Load test critical paths
- [ ] Review scaling policies
- [ ] Update projections
- [ ] Review cost optimization
- [ ] Update runbooks

### Annually
- [ ] Major version upgrades
- [ ] Architecture review
- [ ] Disaster recovery test
- [ ] Vendor contract renewal

---

## Emergency Scaling

### Immediate Actions (SEV-1)
```bash
# Scale backend to max
kubectl scale deployment ethertrack-backend --replicas=10 -n ethertrack

# Scale frontend to max
kubectl scale deployment ethertrack-frontend --replicas=10 -n ethertrack

# Enable read-only mode (feature flag)
kubectl set env deployment/ethertrack-backend -n ethertrack FEATURE_INR_ONLY_MODE=true

# Scale database (if needed)
# Requires AWS console or Terraform apply
```

---

## Capacity Review Checklist (Monthly)

- [ ] Review all Prometheus alerts for capacity-related issues
- [ ] Check Grafana dashboards for trends
- [ ] Verify HPA is functioning correctly
- [ ] Check database connection pool utilization
- [ ] Check Redis memory and eviction rates
- [ ] Review Alchemy RPC usage vs limits
- [ ] Check disk space on all persistent volumes
- [ ] Review backup storage growth
- [ ] Update capacity projections
- [ ] Document any scaling events

---

*Last Updated: 2026-08-15*  
*Next Review: 2026-11-15*  
*Owner: Platform Lead*