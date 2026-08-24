# Main FastAPI Application for EtherTrack AI Service

from fastapi import FastAPI, Depends, HTTPException, status, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from contextlib import asynccontextmanager
from typing import Dict, Any
import logging
import time
import uvicorn

from app.core.config import settings
from app.api.routes import health, predictions, anomalies, liquidity, credit_risk, additionality, reversal
from app.core.config import settings
from app.core.database import init_db, close_db
from app.core.middleware import RateLimitMiddleware, LoggingMiddleware
from app.core.monitoring import setup_metrics, metrics_endpoint
from app.core.security import verify_api_key

# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

security = HTTPBearer(auto_error=False)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    logger.info("Starting EtherTrack AI Service...")
    
    # Initialize database
    await init_db()
    logger.info("Database initialized")
    
    # Initialize model registry
    # await load_models()
    logger.info("Models loaded")
    
    # Setup metrics
    setup_metrics()
    logger.info("Metrics configured")
    
    yield
    
    # Cleanup
    logger.info("Shutting down...")
    await close_db()
    logger.info("Shutdown complete")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    description="EtherTrack AI Service - Carbon Credit Intelligence API",
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
    openapi_url="/openapi.json" if settings.DEBUG else None,
    lifespan=lifespan,
)

# Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(TrustedHostMiddleware, allowed_hosts=["*"])
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(LoggingMiddleware)
app.add_middleware(RateLimitMiddleware)

# Include routers
from app.api.routes import health, predictions, anomalies, liquidity, credit_risk, additionality, reversal

app.include_router(health.router, prefix="/health", tags=["Health"])
app.include_router(predictions.router, prefix="/api/v1/predict", tags=["Predictions"])
app.include_router(anomalies.router, prefix="/api/v1/anomalies", tags=["Anomalies"])
app.include_router(liquidity.router, prefix="/api/v1/liquidity", tags=["Liquidity"])
app.include_router(credit_risk.router, prefix="/api/v1/credit-risk", tags=["Credit Risk"])
app.include_router(additionality.router, prefix="/api/v1/additionality", tags=["Additionality"])
app.include_router(reversal.router, prefix="/api/v1/reversal", tags=["Reversal Risk"])

# Metrics endpoint
from app.core.monitoring import metrics_endpoint
app.add_route("/metrics", metrics_endpoint)


# Exception handlers
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail, "status_code": exc.status_code}
    )


@app.exception_handler(Exception)
async def general_exception_handler(request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "detail": str(exc)}
    )


# Root endpoint
@app.get("/")
async def root():
    return {
        "name": "EtherTrack AI Service",
        "version": "1.0.0",
        "status": "operational",
        "docs": "/docs",
        "health": "/health"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8001,
        reload=True,
        log_level="info"
    )