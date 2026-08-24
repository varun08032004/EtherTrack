# Configuration settings for EtherTrack AI Service
# Using Pydantic Settings for environment-based configuration

from pydantic_settings import BaseSettings
from typing import Optional, List
from functools import lru_cache

class Settings(BaseSettings):
    # Application
    APP_NAME: str = "EtherTrack AI Service"
    VERSION: str = "1.0.0"
    DEBUG: bool = False
    ENVIRONMENT: str = "development"
    
    # API
    API_PREFIX: str = "/api/v1"
    HOST: str = "0.0.0.0"
    PORT: int = 8001
    
    # Database
    DATABASE_URL: str = "postgresql+asyncpg://postgres:password@localhost:5432/ethertrack"
    DATABASE_POOL_SIZE: int = 20
    DATABASE_MAX_OVERFLOW: int = 10
    
    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_MAX_CONNECTIONS: int = 50
    
    # Celery
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"
    
    # MLflow
    MLFLOW_TRACKING_URI: str = "http://localhost:5000"
    MLFLOW_EXPERIMENT_NAME: str = "ethertrack-models"
    
    # Feast Feature Store
    FEAST_REPO_PATH: str = "./feature_store"
    FEAST_ONLINE_STORE: str = "redis"
    
    # Model Registry
    MLFLOW_TRACKING_URI: str = "http://localhost:5000"
    MLFLOW_EXPERIMENT_NAME: str = "ethertrack-models"
    MLFLOW_MODEL_REGISTRY: str = "models:/"
    MODEL_REGISTRY_STAGE: str = "Production"
    
    # Model Paths
    MODEL_STORAGE_PATH: str = "./models"
    PRICE_FORECASTER_PATH: str = "models/price_forecaster"
    ANOMALY_DETECTOR_PATH: str = "models/anomaly_detector"
    LIQUIDITY_SCORER_PATH: str = "models/liquidity_scorer"
    CREDIT_RISK_SCORER_PATH: str = "models/credit_risk_scorer"
    ADDITIONALITY_CLASSIFIER_PATH: str = "models/additionality_classifier"
    REVERSAL_RISK_MODEL_PATH: str = "models/reversal_risk_model"
    
    # Feature Store
    FEAST_ONLINE_STORE_HOST: str = "localhost"
    FEAST_ONLINE_STORE_PORT: int = 6379
    FEAST_OFFLINE_STORE: str = "postgresql"
    
    # Redis
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    REDIS_PASSWORD: str = ""
    
    # Security
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    
    # API Keys
    API_KEY_PREFIX: str = "et_"
    API_KEY_LENGTH: int = 32
    
    # Rate Limiting
    DEFAULT_RATE_LIMIT: int = 60  # requests per minute
    BURST_LIMIT: int = 100
    
    # Monitoring
    PROMETHEUS_ENABLED: bool = True
    METRICS_PORT: int = 9090
    
    # Logging
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "json"
    
    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:3001"]
    
    # MLflow
    MLFLOW_S3_ENDPOINT_URL: str = ""
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    MLFLOW_ARTIFACT_ROOT: str = ""
    
    # Feast
    FEAST_PROJECT: str = "ethertrack"
    FEAST_ENTITY: str = "carbon_asset"
    
    # Model Serving
    MODEL_SERVER_WORKERS: int = 4
    MODEL_TIMEOUT_SECONDS: int = 30
    BATCH_SIZE: int = 32
    
    # Feature Store
    FEAST_ONLINE_STORE_REDIS_URL: str = "redis://localhost:6379/0"
    FEAST_OFFLINE_STORE_POSTGRES_URL: str = ""
    
    # API
    API_PREFIX: str = "/api/v1"
    HOST: str = "0.0.0.0"
    PORT: int = 8001
    
    # Celery
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"
    
    # Logging
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "json"
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True
        extra = "allow"


@lru_cache()
def get_settings():
    return Settings()


# Create settings instance
settings = Settings()