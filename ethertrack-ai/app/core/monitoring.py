# Monitoring and metrics for EtherTrack AI Service

from prometheus_client import Counter, Histogram, Gauge, Summary, CollectorRegistry, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response
import time
import functools
from typing import Callable, Any
import asyncio

# Custom registry
REGISTRY = CollectorRegistry()

# Metrics
REQUEST_COUNT = Counter(
    'http_requests_total',
    'Total HTTP requests',
    ['method', 'endpoint', 'status'],
    registry=REGISTRY
)

REQUEST_DURATION = Histogram(
    'http_request_duration_seconds',
    'HTTP request duration in seconds',
    ['method', 'endpoint'],
    registry=REGISTRY,
    buckets=[0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
)

REQUEST_SIZE = Histogram(
    'http_request_size_bytes',
    'HTTP request size in bytes',
    ['method', 'endpoint'],
    registry=REGISTRY
)

RESPONSE_SIZE = Histogram(
    'http_response_size_bytes',
    'HTTP response size in bytes',
    ['method', 'endpoint'],
    registry=REGISTRY
)

# Model inference metrics
MODEL_INFERENCE_DURATION = Histogram(
    'model_inference_duration_seconds',
    'Model inference duration in seconds',
    ['model_name', 'endpoint'],
    registry=REGISTRY,
    buckets=[0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
)

MODEL_INFERENCE_COUNT = Counter(
    'model_inference_total',
    'Total model inferences',
    ['model_name', 'endpoint', 'status'],
    registry=REGISTRY
)

MODEL_PREDICTION_VALUE = Histogram(
    'model_prediction_value',
    'Model prediction values',
    ['model_name', 'endpoint'],
    registry=REGISTRY
)

# Business metrics
PREDICTION_COUNT = Counter(
    'predictions_total',
    'Total predictions made',
    ['model_name', 'endpoint', 'status'],
    registry=REGISTRY
)

PREDICTION_VALUE = Histogram(
    'prediction_value',
    'Prediction values',
    ['model_name', 'endpoint'],
    registry=REGISTRY
)

ANOMALY_DETECTED = Counter(
    'anomalies_detected_total',
    'Total anomalies detected',
    ['severity', 'model_name'],
    registry=REGISTRY
)

# Database metrics
DB_QUERY_DURATION = Histogram(
    'db_query_duration_seconds',
    'Database query duration in seconds',
    ['query_type', 'table'],
    registry=REGISTRY,
    buckets=[0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0]
)

DB_CONNECTIONS = Gauge(
    'db_connections_active',
    'Active database connections',
    registry=REGISTRY
)

DB_POOL_SIZE = Gauge(
    'db_pool_size',
    'Database pool size',
    registry=REGISTRY
)

# Cache metrics
CACHE_HITS = Counter(
    'cache_hits_total',
    'Total cache hits',
    ['cache_name'],
    registry=REGISTRY
)

CACHE_MISSES = Counter(
    'cache_misses_total',
    'Total cache misses',
    ['cache_name'],
    registry=REGISTRY
)

# Queue metrics
QUEUE_SIZE = Gauge(
    'queue_size',
    'Current queue size',
    ['queue_name'],
    registry=REGISTRY
)

TASK_PROCESSING_DURATION = Histogram(
    'task_processing_duration_seconds',
    'Task processing duration in seconds',
    ['task_type', 'status'],
    registry=REGISTRY,
    buckets=[0.1, 0.5, 1.0, 5.0, 10.0, 30.0, 60.0]
)

TASKS_QUEUED = Counter(
    'tasks_queued_total',
    'Total tasks queued',
    ['task_type'],
    registry=REGISTRY
)

TASKS_COMPLETED = Counter(
    'tasks_completed_total',
    'Total tasks completed',
    ['task_type', 'status'],
    registry=REGISTRY
)

# Model metrics
MODEL_LOAD_DURATION = Histogram(
    'model_load_duration_seconds',
    'Model loading duration in seconds',
    ['model_name'],
    registry=REGISTRY
)

MODEL_MEMORY_USAGE = Gauge(
    'model_memory_usage_bytes',
    'Model memory usage in bytes',
    ['model_name'],
    registry=REGISTRY
)

MODEL_VERSION = Gauge(
    'model_version',
    'Model version',
    ['model_name', 'version'],
    registry=REGISTRY
)

# Feature store metrics
FEATURE_STORE_READ_DURATION = Histogram(
    'feature_store_read_duration_seconds',
    'Feature store read duration',
    ['entity_type'],
    registry=REGISTRY
)

FEATURE_STORE_WRITE_DURATION = Histogram(
    'feature_store_write_duration_seconds',
    'Feature store write duration',
    ['entity_type'],
    registry=REGISTRY
)

# Setup metrics endpoint
def setup_metrics():
    """Initialize metrics collection"""
    pass  # Metrics are automatically registered with REGISTRY


def metrics_endpoint(request):
    """Prometheus metrics endpoint"""
    return Response(
        content=generate_latest(REGISTRY),
        media_type=CONTENT_TYPE_LATEST
    )


def track_request_metrics(method: str, endpoint: str, status_code: int, duration: float, request_size: int = 0, response_size: int = 0):
    """Track HTTP request metrics"""
    REQUEST_COUNT.labels(method=method, endpoint=endpoint, status=str(status_code)).inc()
    REQUEST_DURATION.labels(method=method, endpoint=endpoint).observe(duration)
    if request_size > 0:
        REQUEST_SIZE.labels(method=method, endpoint=endpoint).observe(request_size)
    if response_size > 0:
        RESPONSE_SIZE.labels(method=method, endpoint=endpoint).observe(response_size)


def track_model_inference(model_name: str, endpoint: str, duration: float, success: bool = True, prediction_value: float = None):
    """Track model inference metrics"""
    MODEL_INFERENCE_DURATION.labels(model_name=model_name, endpoint=endpoint).observe(duration)
    MODEL_INFERENCE_COUNT.labels(model_name=model_name, endpoint=endpoint, status='success' if success else 'error').inc()
    if prediction_value is not None:
        MODEL_PREDICTION_VALUE.labels(model_name=model_name, endpoint=endpoint).observe(prediction_value)


def track_prediction(model_name: str, endpoint: str, value: float, status: str = 'success'):
    """Track prediction metrics"""
    PREDICTION_COUNT.labels(model_name=model_name, endpoint=endpoint, status=status).inc()
    PREDICTION_VALUE.labels(model_name=model_name, endpoint=endpoint).observe(value)


def track_anomaly_detected(severity: str, model_name: str):
    """Track anomaly detection"""
    ANOMALY_DETECTED.labels(severity=severity, model_name=model_name).inc()


def track_db_query(query_type: str, table: str, duration: float):
    """Track database query duration"""
    DB_QUERY_DURATION.labels(query_type=query_type, table=table).observe(duration)


def track_db_connections(active: int, pool_size: int):
    """Track database connections"""
    DB_CONNECTIONS.set(active)
    DB_POOL_SIZE.set(pool_size)


def track_cache_hit(cache_name: str):
    """Track cache hit"""
    CACHE_HITS.labels(cache_name=cache_name).inc()


def track_cache_miss(cache_name: str):
    """Track cache miss"""
    CACHE_MISSES.labels(cache_name=cache_name).inc()


def track_queue_size(queue_name: str, size: int):
    """Track queue size"""
    QUEUE_SIZE.labels(queue_name=queue_name).set(size)


def track_task_processing(task_type: str, status: str, duration: float):
    """Track task processing"""
    TASK_PROCESSING_DURATION.labels(task_type=task_type, status=status).observe(duration)
    TASKS_COMPLETED.labels(task_type=task_type, status=status).inc()
    TASKS_QUEUED.labels(task_type=task_type).inc()


def track_model_load(model_name: str, duration: float, memory_bytes: int, version: str):
    """Track model loading metrics"""
    MODEL_LOAD_DURATION.labels(model_name=model_name).observe(duration)
    MODEL_MEMORY_USAGE.labels(model_name=model_name).set(memory_bytes)
    MODEL_VERSION.labels(model_name=model_name, version=version).set(1)


def track_feature_store_read(entity_type: str, duration: float):
    """Track feature store read duration"""
    FEATURE_STORE_READ_DURATION.labels(entity_type=entity_type).observe(duration)


def track_feature_store_write(entity_type: str, duration: float):
    """Track feature store write duration"""
    FEATURE_STORE_WRITE_DURATION.labels(entity_type=entity_type).observe(duration)


def track_task_queue(queue_name: str, size: int):
    """Track task queue size"""
    QUEUE_SIZE.labels(queue_name=queue_name).set(size)


def track_task_processing(task_type: str, status: str, duration: float):
    """Track task processing"""
    TASK_PROCESSING_DURATION.labels(task_type=task_type, status=status).observe(duration)
    TASKS_COMPLETED.labels(task_type=task_type, status=status).inc()
    TASKS_QUEUED.labels(task_type=task_type).inc()


def track_model_load(model_name: str, duration: float, memory_bytes: int, version: str):
    """Track model loading metrics"""
    MODEL_LOAD_DURATION.labels(model_name=model_name).observe(duration)
    MODEL_MEMORY_USAGE.labels(model_name=model_name).set(memory_bytes)
    MODEL_VERSION.labels(model_name=model_name, version=version).set(1)


def track_feature_store_read(entity_type: str, duration: float):
    """Track feature store read duration"""
    FEATURE_STORE_READ_DURATION.labels(entity_type=entity_type).observe(duration)


def track_feature_store_write(entity_type: str, duration: float):
    """Track feature store write duration"""
    FEATURE_STORE_WRITE_DURATION.labels(entity_type=entity_type).observe(duration)


def track_task_queue(queue_name: str, size: int):
    """Track task queue size"""
    QUEUE_SIZE.labels(queue_name=queue_name).set(size)


def track_task_processing(task_type: str, status: str, duration: float):
    """Track task processing"""
    TASK_PROCESSING_DURATION.labels(task_type=task_type, status=status).observe(duration)
    TASKS_COMPLETED.labels(task_type=task_type, status=status).inc()
    TASKS_QUEUED.labels(task_type=task_type).inc()


def track_model_load(model_name: str, duration: float, memory_bytes: int, version: str):
    """Track model loading metrics"""
    MODEL_LOAD_DURATION.labels(model_name=model_name).observe(duration)
    MODEL_MEMORY_USAGE.labels(model_name=model_name).set(memory_bytes)
    MODEL_VERSION.labels(model_name=model_name, version=version).set(1)


def track_feature_store_read(entity_type: str, duration: float):
    """Track feature store read duration"""
    FEATURE_STORE_READ_DURATION.labels(entity_type=entity_type).observe(duration)


def track_feature_store_write(entity_type: str, duration: float):
    """Track feature store write duration"""
    FEATURE_STORE_WRITE_DURATION.labels(entity_type=entity_type).observe(duration)


def track_task_queue(queue_name: str, size: int):
    """Track task queue size"""
    QUEUE_SIZE.labels(queue_name=queue_name).set(size)


def track_task_processing(task_type: str, status: str, duration: float):
    """Track task processing"""
    TASK_PROCESSING_DURATION.labels(task_type=task_type, status=status).observe(duration)
    TASKS_COMPLETED.labels(task_type=task_type, status=status).inc()
    TASKS_QUEUED.labels(task_type=task_type).inc()


def track_model_load(model_name: str, duration: float, memory_bytes: int, version: str):
    """Track model loading metrics"""
    MODEL_LOAD_DURATION.labels(model_name=model_name).observe(duration)
    MODEL_MEMORY_USAGE.labels(model_name=model_name).set(memory_bytes)
    MODEL_VERSION.labels(model_name=model_name, version=version).set(1)


def track_feature_store_read(entity_type: str, duration: float):
    """Track feature store read duration"""
    FEATURE_STORE_READ_DURATION.labels(entity_type=entity_type).observe(duration)


def track_feature_store_write(entity_type: str, duration: float):
    """Track feature store write duration"""
    FEATURE_STORE_WRITE_DURATION.labels(entity_type=entity_type).observe(duration)


def track_task_queue(queue_name: str, size: int):
    """Track task queue size"""
    QUEUE_SIZE.labels(queue_name=queue_name).set(size)


def track_task_processing(task_type: str, status: str, duration: float):
    """Track task processing"""
    TASK_PROCESSING_DURATION.labels(task_type=task_type, status=status).observe(duration)
    TASKS_COMPLETED.labels(task_type=task_type, status=status).inc()
    TASKS_QUEUED.labels(task_type=task_type).inc()


# Import at the end to avoid circular imports
from prometheus_client import Counter, Histogram, Gauge, Summary, CollectorRegistry, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response
import time
import functools
from typing import Callable, Any
import asyncio

# Setup metrics endpoint
def setup_metrics():
    """Initialize metrics collection"""
    pass  # Metrics are automatically registered with REGISTRY


def metrics_endpoint(request):
    """Prometheus metrics endpoint"""
    return Response(
        content=generate_latest(REGISTRY),
        media_type=CONTENT_TYPE_LATEST
    )


# Import at the end to avoid circular imports
from prometheus_client import Counter, Histogram, Gauge, Summary, CollectorRegistry, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response
import time
import functools
from typing import Callable, Any
import asyncio

# Setup metrics endpoint
def setup_metrics():
    """Initialize metrics collection"""
    pass  # Metrics are automatically registered with REGISTRY


def metrics_endpoint(request):
    """Prometheus metrics endpoint"""
    return Response(
        content=generate_latest(REGISTRY),
        media_type=CONTENT_TYPE_LATEST
    )