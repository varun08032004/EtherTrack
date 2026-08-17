# Metrics (Prometheus/Grafana) - CMP-005

**Status:** NOT IMPLEMENTED  
**Priority:** P1  
**Implementation:** Prometheus + Grafana + Custom Metrics (PLANNED)  
**Owner:** Platform Team  
**Status:** NOT IMPLEMENTED

---

## Architecture Overview

```
Applications (Metrics) -> Prometheus (Scraping) -> Grafana (Dashboards)
        |                       |                        |
        v                       v                        v
Pushgateway (Batch Jobs)   Alertmanager (Alerting)   Alerting (Notifications)
```

---

## Prometheus Configuration

```yaml
# prometheus/prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    cluster: 'ethertrack-production'
    environment: 'production'

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']

rule_files:
  - 'rules/*.yml'

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'ethertrack-backend'
    kubernetes_sd_configs:
      - role: pod
        namespaces:
          names:
            - ethertrack-production
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: true
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
        action: replace
        target_label: __metrics_path__
        regex: (.+)
      - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
        action: replace
        regex: ([^:]+)(?:\:\d+)?;(\d+)
        replacement: $1:$2
        target_label: __address__
      - action: labelmap
        regex: __meta_kubernetes_pod_label_(.+)

  - job_name: 'ethertrack-frontend'
    static_configs:
      - targets: ['nginx-exporter:9113']

  - job_name: 'postgresql'
    static_configs:
      - targets: ['postgres-exporter:9187']

  - job_name: 'redis'
    static_configs:
      - targets: ['redis-exporter:9121']

  - job_name: 'node'
    static_configs:
      - targets: ['node-exporter:9100']

  - job_name: 'kafka'
    static_configs:
      - targets: ['kafka-exporter:9308']

  - job_name: 'ethereum-node'
    static_configs:
      - targets: ['ethereum-exporter:9090']

  - job_name: 'blackbox'
    metrics_path: /probe
    params:
      module: [http_2xx]
    static_configs:
      - targets:
        - https://api.ethertrack.in/health
        - https://api.ethertrack.in/api/health
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: blackbox-exporter:9115

  - job_name: 'pushgateway'
    honor_labels: true
    static_configs:
      - targets: ['pushgateway:9091']