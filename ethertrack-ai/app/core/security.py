# Security utilities for EtherTrack AI Service

from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from jose import jwt, JWTError
from passlib.context import CryptContext
from fastapi import HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.config import settings

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# JWT settings
ALGORITHM = settings.ALGORITHM
SECRET_KEY = settings.SECRET_KEY
ACCESS_TOKEN_EXPIRE_MINUTES = settings.ACCESS_TOKEN_EXPIRE_MINUTES
REFRESH_TOKEN_EXPIRE_DAYS = settings.REFRESH_TOKEN_EXPIRE_DAYS

# Security scheme
security = HTTPBearer(auto_error=False)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash"""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Hash a password"""
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: timedelta = None) -> str:
    """Create JWT access token"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {**to_encode, "exp": expire}
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def create_refresh_token(data: dict) -> str:
    """Create refresh token"""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode = {**data, "exp": expire, "type": "refresh"}
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def verify_token(token: str) -> dict:
    """Verify JWT token and return payload"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


def decode_token(token: str) -> dict:
    """Decode JWT token without verification (for debugging)"""
    try:
        payload = jwt.decode(token, options={"verify_signature": False})
        return payload
    except JWTError:
        return None


def create_api_key(user_id: str, scopes: list = None) -> tuple[str, str]:
    """Generate API key and return (key, key_hash)"""
    import secrets
    import hashlib
    
    # Generate random key
    key = f"et_{secrets.token_urlsafe(32)}"
    key_hash = hashlib.sha256(key.encode()).hexdigest()
    return key, key_hash


def verify_api_key(api_key: str) -> dict:
    """Verify API key and return user info"""
    if not api_key or not api_key.startswith("et_"):
        return None
    
    key_hash = hashlib.sha256(api_key.encode()).hexdigest()
    
    # In production, would look up in database
    # For now, return mock data
    return {
        "user_id": "test_user",
        "scopes": ["read", "write"],
        "key_id": "test_key_id"
    }


def hash_api_key(api_key: str) -> str:
    """Hash API key for storage"""
    import hashlib
    return hashlib.sha256(api_key.encode()).hexdigest()


def create_access_token_for_user(user_id: str, scopes: list = None, org_id: str = None) -> str:
    """Create access token for user"""
    data = {"sub": user_id}
    if scopes:
        data["scopes"] = scopes
    if org_id:
        data["org_id"] = org_id
    return create_access_token(data)


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer(auto_error=False))):
    """Get current user from JWT token"""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    token = credentials.credentials
    payload = verify_token(token)
    
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return payload


def get_current_user_optional(credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer(auto_error=False))):
    """Get current user if authenticated, otherwise return None"""
    if not credentials:
        return None
    
    payload = verify_token(credentials.credentials)
    if not payload:
        return None
    
    return payload


def require_scopes(required_scopes: list):
    """Dependency to check required scopes"""
    def scope_checker(payload: dict = Depends(get_current_user)):
        user_scopes = payload.get("scopes", [])
        for scope in required_scopes:
            if scope not in user_scopes:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Missing required scope: {scope}"
                )
        return payload
    return scope_checker


def require_admin(payload: dict = Depends(get_current_user)):
    """Require admin role"""
    if "admin" not in payload.get("scopes", []):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return payload


def create_email_verification_token(email: str) -> str:
    """Create email verification token"""
    data = {"sub": email, "type": "email_verification"}
    return create_access_token(data, timedelta(hours=24))


def create_password_reset_token(email: str) -> str:
    """Create password reset token"""
    data = {"sub": email, "type": "password_reset"}
    return create_access_token(data, timedelta(hours=1))


def verify_email_token(token: str) -> str:
    """Verify email verification token and return email"""
    payload = verify_token(token)
    if not payload or payload.get("type") != "email_verification":
        return None
    return payload.get("sub")


def verify_password_reset_token(token: str) -> str:
    """Verify password reset token and return email"""
    payload = verify_token(token)
    if not payload or payload.get("type") != "password_reset":
        return None
    return payload.get("sub")


# API Key verification
async def verify_api_key(api_key: str = Depends(HTTPBearer(auto_error=False))):
    """Verify API key from header"""
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # In production, would validate against database
    # For now, accept any key starting with "et_"
    if not api_key.credentials.startswith("et_"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key format",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return api_key.credentials


def get_current_user_id(api_key: str = Depends(verify_api_key)) -> str:
    """Get user ID from API key"""
    # In production, would lookup in database
    # For now, return a mock user ID
    return "user_123"


def check_scopes(required_scopes: list):
    """Dependency to check required scopes"""
    def scope_checker(payload: dict = Depends(get_current_user)):
        user_scopes = payload.get("scopes", [])
        for scope in required_scopes:
            if scope not in user_scopes:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Missing required scope: {scope}"
                )
        return payload
    return scope_checker


# API Key management
class APIKeyManager:
    @staticmethod
    def create_key(user_id: str, name: str, scopes: list, expires_days: int = 365) -> tuple[str, str]:
        """Create new API key"""
        import secrets
        import hashlib
        
        raw_key = f"et_{secrets.token_urlsafe(32)}"
        key_hash = hashlib.sha256(key.encode()).hexdigest()
        
        # In production, would save to database
        return key, key_hash
    
    @staticmethod
    def verify_key(key: str) -> dict:
        """Verify API key and return key info"""
        if not key or not key.startswith("et_"):
            return None
        
        key_hash = hashlib.sha256(key.encode()).hexdigest()
        
        # In production, would lookup in database
        # For now, return mock data
        return {
            "key_id": "test_key",
            "user_id": "user_123",
            "scopes": ["read", "write"],
            "is_active": True
        }
    
    @staticmethod
    def revoke_key(key: str) -> bool:
        """Revoke API key"""
        # In production, would update database
        return True


# Rate limiting helpers
class RateLimiter:
    def __init__(self, redis_client=None):
        self.redis = redis_client
        self.local_cache = {}
    
    async def check_rate_limit(self, key: str, limit: int, window: int) -> bool:
        """Check if request is within rate limit"""
        # Simplified - would use Redis in production
        return True
    
    async def increment(self, key: str, window: int, limit: int) -> tuple[bool, int]:
        """Increment counter and return (allowed, remaining)"""
        # Simplified implementation
        return True, 100


# Input validation
def validate_pagination(page: int = 1, size: int = 20, max_size: int = 100) -> tuple[int, int]:
    """Validate pagination parameters"""
    page = max(1, page)
    size = min(max(1, size), 1000)
    return page, size


def validate_date_range(start_date: str = None, end_date: str = None) -> tuple:
    """Validate date range"""
    from datetime import datetime
    
    start = None
    end = None
    
    if start_date:
        try:
            start = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start_date format")
    
    if end_date:
        try:
            end = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end_date format")
    
    if start and end and start > end:
        raise HTTPException(status_code=400, detail="start_date must be before end_date")
    
    return start, end


# Data sanitization
def sanitize_string(value: str, max_length: int = 1000) -> str:
    """Sanitize string input"""
    if not isinstance(value, str):
        return ""
    # Remove control characters
    cleaned = ''.join(char for char in value if ord(char) >= 32 or char in '\n\r\t')
    return cleaned[:max_length]


def sanitize_filename(filename: str) -> str:
    """Sanitize filename for safe storage"""
    import re
    # Remove path traversal attempts
    filename = os.path.basename(filename)
    # Remove special characters
    filename = re.sub(r'[<>:"/\\|?*]', '', filename)
    # Limit length
    return filename[:255]


# Error handling
class EtherTrackException(Exception):
    """Base exception for EtherTrack"""
    def __init__(self, message: str, code: str = "INTERNAL_ERROR", status_code: int = 500):
        self.message = message
        self.code = code
        self.status_code = status_code
        super().__init__(message)


class ValidationError(EtherTrackException):
    def __init__(self, message: str, field: str = None):
        super().__init__(message, "VALIDATION_ERROR", 400)
        self.field = field


class NotFoundError(EtherTrackException):
    def __init__(self, resource: str, identifier: str):
        super().__init__(f"{resource} not found: {identifier}", "NOT_FOUND", 404)
        self.resource = resource
        self.identifier = identifier


class AuthorizationError(EtherTrackException):
    def __init__(self, message: str = "Insufficient permissions"):
        super().__init__(message, "FORBIDDEN", 403)


class RateLimitError(EtherTrackException):
    def __init__(self, retry_after: int = 60):
        super().__init__(f"Rate limit exceeded. Retry after {retry_after} seconds", "RATE_LIMITED", 429)
        self.retry_after = retry_after


# Export
__all__ = [
    "verify_password",
    "get_password_hash",
    "create_access_token",
    "create_refresh_token",
    "verify_token",
    "decode_token",
    "create_api_key",
    "verify_api_key",
    "hash_api_key",
    "create_access_token_for_user",
    "get_current_user",
    "get_current_user_optional",
    "require_scopes",
    "require_admin",
    "create_email_verification_token",
    "create_password_reset_token",
    "verify_email_token",
    "verify_password_reset_token",
    "APIKeyManager",
    "RateLimiter",
    "validate_pagination",
    "validate_date_range",
    "sanitize_string",
    "sanitize_filename",
    "EtherTrackException",
    "ValidationError",
    "NotFoundError",
    "AuthorizationError",
    "RateLimitError",
]