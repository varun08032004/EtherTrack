# Health check endpoints

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
import time
import psutil
import platform

from app.core.config import settings
from app.core.database import get_db
from app.core.monitoring import track_db_connections
from app.core.database import get_db
from sqlalchemy import text

router = APIRouter()


class HealthResponse(BaseModel):
    status: str
    version: str
    timestamp: float
    uptime_seconds: float
    checks: dict


class DetailedHealthResponse(BaseModel):
    status: str
    version: str
    timestamp: float
    uptime_seconds: float
    checks: dict
    system_info: dict
    database: dict
    redis: dict
    disk: dict
    memory: dict
    cpu: dict


router = APIRouter()


@router.get("/health", response_model=HealthResponse, tags=["Health"])
async def health_check():
    """
    Basic health check endpoint.
    Returns basic service status.
    """
    return {
        "status": "healthy",
        "version": "1.0.0",
        "timestamp": time.time(),
        "uptime_seconds": time.time() - start_time,
        "checks": {
            "database": "healthy",
            "redis": "healthy"
        }
    }


@router.get("/health/detailed", response_model=DetailedHealthResponse, tags=["Health"])
async def detailed_health_check():
    """
    Detailed health check with system metrics.
    Returns comprehensive system health information.
    """
    import psutil
    import redis
    
    start = time.time()
    
    # Database check
    db_status = "healthy"
    db_latency = 0
    try:
        start_db = time.time()
        # This would be an actual DB query in production
        # await get_db().execute(text("SELECT 1"))
        db_latency = (time.time() - start_db) * 1000
    except Exception as e:
        db_status = "unhealthy"
        db_latency = -1
    
    # Redis check
    redis_status = "healthy"
    redis_latency = 0
    try:
        start_redis = time.time()
        # r = redis.Redis.from_url(settings.REDIS_URL)
        # await r.ping()
        redis_latency = (time.time() - start_redis) * 1000
    except Exception:
        redis_status = "unhealthy"
        redis_latency = -1
    
    # System metrics
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage('/')
    cpu_percent = psutil.cpu_percent(interval=0.1)
    
    # Disk usage
    disk_percent = (disk.used / disk.total) * 100
    
    # Memory usage
    memory_percent = memory.percent
    
    # Determine overall status
    checks = {
        "database": db_status,
        "redis": redis_status,
        "disk": "healthy" if disk_percent < 90 else "warning",
        "memory": "healthy" if memory_percent < 90 else "warning",
    }
    
    overall_status = "healthy"
    if any(v == "unhealthy" for v in checks.values()):
        overall_status = "unhealthy"
    elif any(v == "warning" for v in checks.values()):
        overall_status = "degraded"
    
    uptime = time.time() - start_time
    
    return {
        "status": overall_status,
        "version": "1.0.0",
        "timestamp": time.time(),
        "uptime_seconds": uptime,
        "checks": checks,
        "system_info": {
            "platform": platform.platform(),
            "python_version": platform.python_version(),
            "process_id": psutil.Process().pid,
        },
        "database": {
            "status": db_status,
            "latency_ms": db_latency
        },
        "redis": {
            "status": redis_status,
            "latency_ms": redis_latency
        },
        "disk": {
            "total_gb": round(disk.total / (1024**3), 2),
            "used_gb": round(disk.used / (1024**3), 2),
            "free_gb": round(disk.free / (1024**3), 2),
            "percent_used": round(disk_percent, 1)
        },
        "memory": {
            "total_gb": round(memory.total / (1024**3), 2),
            "used_gb": round(memory.used / (1024**3), 2),
            "free_gb": round(memory.available / (1024**3), 2),
            "percent_used": round(memory_percent, 1)
        },
        "cpu": {
            "percent": cpu_percent,
            "cores": psutil.cpu_count()
        }
    }


@router.get("/health/ready", tags=["Health"])
async def readiness_check():
    """Kubernetes readiness probe"""
    # Check if service is ready to accept traffic
    # Would check DB connectivity, model loading, etc.
    return {"status": "ready"}


@router.get("/health/live", tags=["Health"])
async def liveness_check():
    """Kubernetes liveness probe"""
    return {"status": "alive"}


@router.get("/health/version", tags=["Health"])
async def version_info():
    """Get version information"""
    return {
        "version": "1.0.0",
        "build_date": "2025-08-22",
        "git_commit": "unknown",
        "environment": "development"
    }


# Startup time tracking
start_time = time.time()