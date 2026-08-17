# Alerting (PagerDuty/Slack) - CMP-006

**Status:** NOT IMPLEMENTED  
**Priority:** P1  
**Implementation:** Alertmanager + PagerDuty + Slack (PLANNED)  
**Owner:** Platform Team  
**Status:** NOT IMPLEMENTED

---

## Alertmanager Configuration

```yaml
# alertmanager/alertmanager.yml
global:
  resolve_timeout: 5m
  smtp_smarthost: 'smtp.gmail.com:587'
  smtp_from: 'alerts@ethertrack.in'
  smtp_auth_username: 'alerts@ethertrack.in'
  smtp_auth_password: '${SMTP_PASSWORD}'

route:
  group_by: ['alertname', 'severity']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: 'default'
  routes:
    - match:
        severity: critical
      receiver: 'critical-alerts'
      continue: true
    - match:
        severity: warning
      receiver: 'warning-alerts'

receivers:
  - name: 'default'
    email_configs:
      - to: 'alerts@ethertrack.in'
        send_resolved: true
    slack_configs:
      - api_url: '${SLACK_WEBHOOK_URL}'
        channel: '#alerts'
        send_resolved: true
        title: 'EtherTrack Alert'
        text: '{{ range .Alerts }}{{ .Annotations.summary }}\n{{ end }}'
  
  - name: 'critical-alerts'
    email_configs:
      - to: 'critical-alerts@ethertrack.in'
        send_resolved: true
    slack_configs:
      - api_url: '${SLACK_WEBHOOK_URL}'
        channel: '#critical-alerts'
        send_resolved: true
        title: '🚨 CRITICAL ALERT'
        text: '{{ range .Alerts }}{{ .Annotations.summary }}\n{{ end }}'
    pagerduty_configs:
      - service_key: '${PAGERDUTY_KEY}'
        severity: critical
        description: '{{ range .Alerts }}{{ .Annotations.summary }}{{ end }}'
  
  - name: 'warning-alerts'
    email_configs:
      - to: 'warnings@ethertrack.in'
        send_resolved: true
    slack_configs:
      - api_url: '${SLACK_WEBHOOK_URL}'
        channel: '#warnings'
        send_resolved: true
        title: '⚠️ WARNING'
        text: '{{ range .Alerts }}{{ .Annotations.summary }}\n{{ end }}'

inhibit_rules:
  - source_match:
      severity: 'critical'
    target_match:
      severity: 'warning'
    equal: ['alertname', 'instance']
```

---

## Alert Rules

```yaml
# prometheus/rules/alerts.yml
groups:
  - name: etherTrack-alerts
    interval: 30s
    rules:
      # Service health
      - alert: ServiceDown
        expr: up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Service {{ $labels.job }} is down"
          description: "{{ $labels.job }} has been down for more than 1 minute"
      
      # High-level alerts
      - alert: HighErrorRate
        expr: sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.05
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "High error rate on {{ $labels.service }}"
          description: "Error rate is {{ $value | humanizePercentage }} for {{ $labels.service }}"
      
      - alert: HighLatency
        expr: histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service)) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High P99 latency on {{ $labels.service }}"
          description: "P99 latency is {{ $value }}s for {{ $labels.service }}"
      
      - alert: HighErrorRate
        expr: sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.05
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "High error rate on {{ $labels.service }}"
          description: "Error rate is {{ $value | humanizePercentage }} for {{ $labels.service }}"
      
      # Business metric alerts
      - alert: TradeVolumeDrop
        expr: increase(trade_volume_credits[1h]) < 10
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Trade volume dropped significantly"
          description: "Trade volume in last hour is {{ $value }} credits"
      
      - alert: TradeFailureRate
        expr: sum(rate(trades_total{status="failed"}[5m])) / sum(rate(trades_total[5m])) > 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High trade failure rate"
          description: "Trade failure rate is {{ $value | humanizePercentage }}"
      
      - alert: KYCBacklog
        expr: kyc_verification_duration_seconds_count / kyc_verification_duration_seconds_count > 100
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "KYC verification backlog"
          description: "KYC queue has {{ $value }} pending verifications"
      
      - alert: WalletBalanceLow
        expr: wallet_balance_inr < 1000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "User {{ $labels.user_id }} wallet balance low"
          description: "Balance is ₹{{ $value }}"
      
      - alert: MarketPriceStale
        expr: time() - market_price_inr_per_credit > 300
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Market price feed stale for {{ $labels.token_id }}"
          description: "Last update was {{ $value }} seconds ago"
      
      # Infrastructure alerts
      - alert: HighCPUUsage
        expr: 100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High CPU usage on {{ $labels.instance }}"
          description: "CPU usage is {{ $value }}%"
      
      - alert: HighMemoryUsage
        expr: (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100 > 85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage on {{ $labels.instance }}"
          description: "Memory usage is {{ $value }}%"
      
      - alert: DiskSpaceLow
        expr: (node_filesystem_size_bytes - node_filesystem_free_bytes) / node_filesystem_size_bytes * 100 > 85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Disk space low on {{ $labels.instance }} {{ $labels.mountpoint }}"
          description: "Disk usage is {{ $value }}%"
      
      - alert: DatabaseConnectionsHigh
        expr: db_connections_active / pg_settings_max_connections * 100 > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Database connections high on {{ $labels.pool }}"
          description: "{{ $value }}% of max connections used"
      
      - alert: DatabaseSlowQueries
        expr: histogram_quantile(0.99, sum(rate(db_query_duration_seconds_bucket[5m])) by (le, query_type)) > 5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Slow database queries detected"
          description: "P99 query duration is {{ $value }}s for {{ $labels.query_type }}"
      
      - alert: RedisMemoryHigh
        expr: redis_memory_used_bytes / redis_memory_max_bytes * 100 > 85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Redis memory usage high"
          description: "Redis memory usage is {{ $value }}%"
      
      - alert: KafkaConsumerLag
        expr: kafka_consumer_lag > 10000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Kafka consumer lag high"
          description: "Consumer lag is {{ $value }} for {{ $labels.topic }} {{ $labels.partition }}"
      
      - alert: BlockchainSyncLag
        expr: blockchain_sync_status == 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Blockchain sync lag detected"
          description: "Blockchain is syncing, current height {{ $value }}"
      
      - alert: GasPriceHigh
        expr: gas_price_gwei > 100
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Gas price high on {{ $labels.chain }}"
          description: "Gas price is {{ $value }} gwei"
      
      - alert: TradeFailureSpike
        expr: increase(trades_total{status="failed"}[5m]) > 10
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Trade failure spike detected"
          description: "{{ $value }} trades failed in last 5 minutes"