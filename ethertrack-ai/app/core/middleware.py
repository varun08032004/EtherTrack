# Middleware for EtherTrack AI Service

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, JSONResponse
from starlette.types import ASGIApp
import time
import logging
import uuid
from starlette.middleware.base import RequestResponseEndpoint

logger = logging.getLogger(__name__)


class LoggingMiddleware(BaseHTTPMiddleware):
    """Middleware for request/response logging"""
    
    async def dispatch(self, request, call_next):
        request_id = str(uuid.uuid4())
        start_time = time.time()
        
        # Add request ID to request state
        request.state.request_id = str(uuid.uuid4())
        
        # Log request
        logger.info(
            f"Request started",
            extra={
                "request_id": request.state.request_id,
                "method": request.method,
                "url": str(request.url),
                "client_ip": request.client.host if request.client else None,
            }
        )
        
        try:
            response = await call_next(request)
            process_time = time.time() - start_time
            
            # Log response
            logger.info(
                f"Request completed",
                extra={
                    "request_id": request.state.request_id,
                    "status_code": response.status_code,
                    "process_time_ms": round(process_time * 1000, 2),
                }
            )
            
            # Add headers
            response.headers["X-Request-ID"] = request.state.request_id
            response.headers["X-Process-Time"] = str(process_time)
            
            return response
            
        except Exception as e:
            process_time = time.time() - start_time
            logger.error(
                f"Request failed",
                extra={
                    "request_id": request.state.request_id,
                    "error": str(e),
                    "process_time_ms": round(process_time * 1000, 2),
                },
                exc_info=True
            )
            raise


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Rate limiting middleware with Redis backend"""
    
    def __init__(self, app, redis_client=None, default_limit: int = 60, window_seconds: int = 60):
        super().__init__(app)
        self.redis_client = None  # Would be initialized with Redis client
        self.default_limit = 60
        self.window_seconds = 60
    
    async def dispatch(self, request: Request, call_next):
        # Skip rate limiting for health checks
        if request.url.path in ["/health", "/metrics", "/docs", "/redoc", "/openapi.json"]:
            return await call_next(request)
        
        # Get client identifier
        client_ip = request.client.host if request.client else "unknown"
        api_key = request.headers.get("X-API-Key") or request.headers.get("Authorization", "").replace("Bearer ", "")
        
        identifier = api_key or f"ip:{client_ip}"
        key = f"ratelimit:{identifier}"
        
        # In production, would use Redis for distributed rate limiting
        # For now, use in-memory fallback (not suitable for production)
        if not hasattr(self, '_request_counts'):
            self._request_counts = {}
        
        current_time = time.time()
        window_start = current_time - 60  # 1 minute window
        
        # Clean old entries
        if key in self._request_counts:
            self._request_counts[key] = [
                t for t in self._request_counts[key] if t > window_start
            ]
        else:
            self._request_counts[key] = []
        
        # Check limit
        if len(self._request_counts[key]) >= 60:  # 60 requests per minute
            return JSONResponse(
                status_code=429,
                content={"error": "Rate limit exceeded", "retry_after": 60}
            )
        
        # Record request
        self._request_counts[key].append(current_time)
        
        return await call_next(request)


class RateLimitMiddleware:
    """Standalone rate limiter (for use without Starlette middleware)"""
    
    def __init__(self, redis_client=None, default_limit: int = 60, window_seconds: int = 60):
        self.redis_client = redis_client
        self.default_limit = default_limit
        self.window_seconds = window_seconds
        self._local_cache = {}
    
    async def check_rate_limit(self, identifier: str, limit: int = None, window: int = None) -> bool:
        """Check if request is within rate limit"""
        limit = limit or self.default_limit
        window = window or self.window_seconds
        key = f"ratelimit:{identifier}"
        
        current_time = time.time()
        window_start = current_time - window
        
        # In production, use Redis
        # For now, use in-memory cache (not suitable for multi-worker)
        if not hasattr(self, '_cache'):
            self._cache = {}
        
        if key not in self._cache:
            self._cache[key] = []
        
        # Clean old entries
        self._cache[key] = [t for t in self._cache[key] if t > window_start]
        
        if len(self._cache[key]) >= 60:  # Default limit
            return False
        
        self._cache[key].append(time.time())
        return True


# Global rate limiter instance
rate_limiter = RateLimitMiddleware()


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Starlette middleware for rate limiting"""
    
    def __init__(self, app, rate_limiter=None):
        super().__init__(app)
        self.rate_limiter = rate_limiter or RateLimitMiddleware()
    
    async def dispatch(self, request, call_next):
        # Skip for health checks
        if request.url.path in ["/health", "/metrics", "/docs", "/redoc", "/openapi.json"]:
            return await call_next(request)
        
        # Get identifier
        client_ip = request.client.host if request.client else "unknown"
        api_key = request.headers.get("X-API-Key") or request.headers.get("Authorization", "").replace("Bearer ", "")
        identifier = api_key or f"ip:{client_ip}"
        
        # Check rate limit
        if not await rate_limiter.check_rate_limit(identifier):
            return JSONResponse(
                status_code=429,
                content={"error": "Rate limit exceeded", "retry_after": 60},
                headers={"Retry-After": "60"}
            )
        
        return await call_next(request)


# Export
__all__ = ["LoggingMiddleware", "RateLimitMiddleware", "rate_limiter"]