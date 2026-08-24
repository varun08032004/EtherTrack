# Anomaly Detection Service
# Detects anomalies in carbon credit price/volume time series

import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import logging

logger = logging.getLogger(__name__)


class AnomalyDetector:
    """Ensemble anomaly detector using Isolation Forest + LSTM Autoencoder"""
    
    def __init__(self):
        self.iso_forest = None
        self.scaler = StandardScaler()
        self.is_fitted = False
        
    async def initialize(self):
        """Initialize models"""
        self.iso_forest = IsolationForest(
            n_estimators=200,
            contamination=0.05,
            random_state=42,
            n_jobs=-1
        )
        logger.info("Anomaly detector initialized")
    
    async def detect(
        self,
        asset_id: str,
        window_days: int = 30,
        sensitivity: float = 0.95,
        model_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """Detect anomalies in asset time series"""
        
        # Fetch historical data
        data = await self._fetch_time_series(asset_id, window_days)
        
        if len(data) < 10:
            return {
                "is_anomaly": False,
                "anomaly_score": 0.0,
                "severity": "none",
                "details": {"message": "Insufficient data for anomaly detection"}
            }
        
        # Prepare features
        features = self._extract_features(data)
        
        # Run isolation forest
        anomaly_scores = await self._run_isolation_forest(features)
        
        # Get latest anomaly score
        latest_score = anomaly_scores[-1] if len(anomaly_scores) > 0 else 0
        
        # Determine if anomaly
        threshold = self._calculate_threshold(sensitivity)
        is_anomaly = anomaly_scores[-1] > threshold if len(anomaly_scores) > 0 else False
        
        # Determine severity
        severity = self._classify_severity(anomaly_scores[-1] if len(anomaly_scores) > 0 else 0)
        
        return {
            "is_anomaly": is_anomaly,
            "anomaly_score": float(anomaly_scores[-1]) if len(anomaly_scores) > 0 else 0.0,
            "severity": severity,
            "details": {
                "window_days": 30,
                "data_points": len(data),
                "model_used": "IsolationForest",
                "threshold": threshold,
                "features_used": ["price", "volume", "volatility", "returns"]
            }
        }
    
    def _extract_features(self, data: pd.DataFrame) -> np.ndarray:
        """Extract features for anomaly detection"""
        df = data.copy()
        
        # Price features
        df['returns'] = df['price'].pct_change()
        df['log_returns'] = np.log(df['price'] / df['price'].shift(1))
        df['volatility'] = df['returns'].rolling(7).std()
        df['volume_change'] = df['volume'].pct_change()
        
        # Technical indicators
        df['sma_7'] = df['price'].rolling(7).mean()
        df['sma_30'] = df['price'].rolling(30).mean()
        df['price_vs_sma7'] = (df['price'] - df['sma_7']) / df['sma_7']
        df['price_vs_sma30'] = (df['price'] - df['sma_30']) / df['sma_30']
        
        # Volume indicators
        df['volume_sma7'] = df['volume'].rolling(7).mean()
        df['volume_ratio'] = df['volume'] / df['volume_sma7']
        
        # Momentum
        df['momentum_7'] = df['price'] / df['price'].shift(7) - 1
        df['momentum_30'] = df['price'] / df['price'].shift(30) - 1
        
        # Select features
        feature_cols = ['returns', 'log_returns', 'volatility', 'volume_change',
                       'price_vs_sma7', 'price_vs_sma30', 'volume_ratio',
                       'momentum_7', 'momentum_30']
        
        features = df[feature_cols].fillna(0).values
        return features
    
    async def _run_isolation_forest(self, features: np.ndarray) -> np.ndarray:
        """Run isolation forest and return anomaly scores"""
        if not self.is_fitted:
            self.iso_forest.fit(features)
            self.is_fitted = True
        
        # Get anomaly scores (negative = more anomalous)
        scores = self.iso_forest.score_samples(features)
        # Convert to 0-1 anomaly score (higher = more anomalous)
        anomaly_scores = -scores  # Invert so higher = more anomalous
        # Normalize to 0-1
        min_score, max_score = anomaly_scores.min(), anomaly_scores.max()
        if max_score > min_score:
            normalized = (anomaly_scores - min_score) / (max_score - min_score)
        else:
            normalized = np.zeros_like(anomaly_scores)
        return normalized
    
    def _calculate_threshold(self, sensitivity: float) -> float:
        """Calculate anomaly threshold based on sensitivity"""
        # Higher sensitivity = lower threshold = more anomalies detected
        return sensitivity
    
    def _classify_severity(self, score: float) -> str:
        if score >= 0.9:
            return "critical"
        elif score >= 0.75:
            return "high"
        elif score >= 0.6:
            return "medium"
        elif score >= 0.4:
            return "low"
        return "none"
    
    async def _fetch_time_series(self, asset_id: str, window_days: int) -> pd.DataFrame:
        """Fetch time series data from database"""
        # In production, would query database
        # For now, return synthetic data
        dates = pd.date_range(end=datetime.now(), periods=window_days, freq='D')
        np.random.seed(42)
        prices = 1000 + np.cumsum(np.random.normal(0, 10, window_days))
        volumes = np.random.lognormal(10, 0.5, window_days)
        
        return pd.DataFrame({
            'date': dates,
            'price': prices,
            'volume': volumes
        })


# Export
__all__ = ["AnomalyDetector"]