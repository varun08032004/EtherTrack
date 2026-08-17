# RUNBOOK: SEV-2 Database Outage / Connection Pool Exhaustion

**Severity:** SEV-2 (High)
**Target Resolution:** < 4 hours
**Escalation:** Database Lead, Platform Lead, Engineering Lead

---

## Detection
- Alert: `DatabaseUnavailable` or `DatabaseConnectionPoolExhausted`
- Alert: `HighDBQueryLatency` P99 > 5s
- Alert: `HighDBErrorRate` > 5%
- Application errors: connection timeout, pool exhausted

---

## Triage (0-10 minutes)

### 1. Check Database Status
```bash
# PostgreSQL readiness
pg_isready -h postgres.production -p 5432

# Connection count
psql -h postgres.production -c "SELECT count(*) FROM pg_stat_activity;"

# Active vs idle
psql -h postgres.production -c "
  SELECT state, count(*) 
  FROM pg_stat_activity 
  GROUP BY state;
"

# Long-running queries
psql -h postgres.production -c "
  SELECT pid, now() - pg_stat_activity.query_start AS duration, 
         query, state
  FROM pg_stat_activity
  WHERE (now() - pg_stat_activity.query_start) > interval '30 seconds'
  AND state != 'idle';
"

# Check replication lag
psql -h postgres.production -c "SELECT * FROM pg_stat_replication;"
```

### 2. Check Kubernetes
```bash
# PostgreSQL pod status
kubectl get pods -n production -l app=postgres -o wide

# Check logs
kubectl logs -n production -l app=postgres --tail=100

# Check PVC status
kubectl get pvc -n production
```

### 3. Check Application
```bash
# Connection pool metrics
curl https://api.ethertrack.in/metrics | grep db_pool

# Application errors
kubectl logs -n production -l app=ethertrack-api | grep -i "pool\|connection\|timeout" | tail -20
```

---

## Common Causes & Actions

### Connection Pool Exhausted
```bash
# Immediate: Increase pool size (if resources allow)
# In application config: pool.max = 20 -> 30
# Or scale read replicas

# Immediate: Kill idle connections
psql -h postgres.production -c "
  SELECT pg_terminate_backend(pid) 
  FROM pg_stat_activity 
  WHERE state = 'idle' 
  AND now() - state_change > interval '10 minutes';
"

# Scale read replicas
kubectl scale deployment/postgres-read --replicas=5 -n production
```

### Long-Running Queries
```bash
# Identify and kill
psql -h postgres.production -c "
  SELECT pg_cancel_backend(pid)
  FROM pg_stat_activity
  WHERE (now() - query_start) > interval '5 minutes'
  AND state = 'active';
"

# Check for missing indexes
# EXPLAIN ANALYZE <slow-query>
```

### Primary Database Down
```bash
# Check if primary is down
pg_isready -h postgres-primary.production

# If down, promote replica
kubectl exec -it postgres-replica-0 -n production -- pg_ctl promote -D /var/lib/postgresql/data

# Update application connection string
kubectl set env deployment/ethertrack-api -n production \
  DATABASE_URL=postgresql://user:pass@postgres-replica:5432/db

# Update read replica config
kubectl set env deployment/ethertrack-api -n production \
  DATABASE_READ_URL=postgresql://user:pass@postgres-replica:5432/db
```

### Disk Space Full
```bash
# Check disk
kubectl exec -it postgres-0 -n production -- df -h /var/lib/postgresql/data

# Clean old WAL files
kubectl exec -it postgres-0 -n production -- pg_archivecleanup -d /var/lib/postgresql/data/pg_wal <oldest-wal>

# Expand PVC
kubectl patch pvc postgres-data -n production -p '{"spec":{"resources":{"requests":{"storage":"200Gi"}}}}'
```

---

## Containment
1. **Enable** read-only mode for non-critical operations:
   ```bash
   kubectl set env deployment/ethertrack-api -n production FEATURE_READ_ONLY=true
   ```
2. **Route** traffic to read replicas for SELECT queries
3. **Queue** write operations

---

## Resolution
1. Fix root cause
2. Restore full read-write access
4. Verify all services healthy
5. Monitor for 30 minutes

---

## Post-Incident
- Analyze query patterns that caused exhaustion
- Add missing indexes
- Implement query timeout guards
- Schedule RCA