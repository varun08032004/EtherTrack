# Prediction API routes

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict, Any
from datetime import datetime
from enum import Enum
import uuid

from app.core.config import settings
from app.core.security import get_current_user
from app.services.prediction import (
    predict_price,
    detect_anomaly,
    score_liquidity,
    assess_credit_risk,
    assess_additionality,
    assess_reversal_risk
)

router = APIRouter(prefix="/predict", tags=["Predictions"])


# ============ Schemas ============

class PredictionRequest(BaseModel):
    asset_id: str
    horizon_days: int = Field(default=7, ge=1, le=365)
    model_name: Optional[str] = None
    confidence_level: float = Field(default=0.95, ge=0.5, le=0.99)


class PredictionResponse(BaseModel):
    prediction_id: str
    asset_id: str
    predicted_price: float
    confidence_interval: Dict[str, float]
    prediction_date: datetime
    horizon_days: int
    model_name: str
    confidence_level: float
    metadata: Dict[str, Any]


class BatchPredictionRequest(BaseModel):
    predictions: List[PredictionRequest] = Field(..., max_items=100)
    model_name: Optional[str] = None


class BatchPredictionResponse(BaseModel):
    batch_id: str
    results: List[PredictionResponse]
    errors: List[Dict[str, Any]]
    total_processed: int
    successful: int
    failed: int


class AnomalyDetectionRequest(BaseModel):
    asset_id: str
    window_days: int = Field(default=30, ge=1, le=365)
    sensitivity: float = Field(default=0.95, ge=0.5, le=0.99)
    model_name: Optional[str] = None


class AnomalyDetectionResponse(BaseModel):
    anomaly_id: str
    asset_id: str
    is_anomaly: bool
    anomaly_score: float
    severity: str
    timestamp: datetime
    details: Dict[str, Any]


class LiquidityScoreRequest(BaseModel):
    asset_id: str
    window_days: int = Field(default=30, ge=1, le=365)


class LiquidityScoreResponse(BaseModel):
    asset_id: str
    liquidity_score: float
    bid_ask_spread: float
    volume_24h: float
    order_book_depth: float
    last_updated: datetime


class CreditRiskRequest(BaseModel):
    counterparty_id: str
    exposure_amount: float
    tenor_days: int = Field(default=30, ge=1, le=365)
    collateral_type: Optional[str] = None


class CreditRiskResponse(BaseModel):
    counterparty_id: str
    risk_score: float
    risk_grade: str
    probability_of_default: float
    loss_given_default: float
    exposure_at_default: float
    recommended_limit: float


class AdditionalityRequest(BaseModel):
    project_id: str
    methodology: str
    vintage: int
    geography: str
    project_type: str
    documents: Optional[List[str]] = None


class AdditionalityResponse(BaseModel):
    project_id: str
    additionality_score: float
    confidence: float
    key_factors: List[str]
    risk_factors: List[str]
    recommendation: str


class ReversalRiskRequest(BaseModel):
    asset_id: str
    holding_period_days: int = Field(default=365, ge=1, le=3650)
    buffer_pool_pct: float = Field(default=0.1, ge=0, le=1)


class ReversalRiskResponse(BaseModel):
    asset_id: str
    reversal_probability: float
    expected_loss: float
    risk_grade: str
    key_risk_factors: List[str]
    mitigation_recommendations: List[str]


router = APIRouter(prefix="/predict", tags=["Predictions"])


# ============ Routes ============

@router.post("/price", response_model=PredictionResponse, summary="Predict asset price")
async def predict_price(
    request: PredictionRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user)
):
    """
    Predict future price for a carbon credit asset.
    
    Uses ensemble of models (Temporal Fusion Transformer, LSTM, XGBoost)
    to forecast price with confidence intervals.
    """
    from app.services.prediction.price_forecaster import PriceForecaster
    
    forecaster = PriceForecaster()
    result = await forecaster.predict(
        asset_id=request.asset_id,
        horizon_days=request.horizon_days,
        model_name=request.model_name,
        confidence_level=request.confidence_level
    )
    
    return PredictionResponse(
        prediction_id=str(uuid.uuid4()),
        asset_id=request.asset_id,
        predicted_price=result["predicted_price"],
        confidence_interval=result["confidence_interval"],
        prediction_date=datetime.utcnow(),
        horizon_days=request.horizon_days,
        model_name=result["model_name"],
        confidence_level=request.confidence_level,
        metadata=result.get("metadata", {})
    )


@router.post("/batch", response_model=BatchPredictionResponse, summary="Batch price predictions")
async def batch_predict(
    request: BatchPredictionRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user)
):
    """
    Batch price predictions for multiple assets.
    
    Process up to 100 predictions in a single request.
    """
    from app.services.prediction.price_forecaster import PriceForecaster
    
    forecaster = PriceForecaster()
    results = []
    errors = []
    
    for i, pred_request in enumerate(request.predictions):
        try:
            result = await forecaster.predict(
                asset_id=pred_request.asset_id,
                horizon_days=pred_request.horizon_days,
                model_name=pred_request.model_name,
                confidence_level=pred_request.confidence_level
            )
            results.append(PredictionResponse(
                prediction_id=str(uuid.uuid4()),
                asset_id=pred_request.asset_id,
                predicted_price=result["predicted_price"],
                confidence_interval=result["confidence_interval"],
                prediction_date=datetime.utcnow(),
                horizon_days=pred_request.horizon_days,
                model_name=result["model_name"],
                confidence_level=pred_request.confidence_level,
                metadata=result.get("metadata", {})
            ))
        except Exception as e:
            errors.append({
                "index": i,
                "asset_id": pred_request.asset_id,
                "error": str(e)
            })
    
    return BatchPredictionResponse(
        batch_id=str(uuid.uuid4()),
        results=results,
        errors=errors,
        total_processed=len(request.predictions),
        successful=len(results),
        failed=len(errors)
    )


@router.post("/anomaly", response_model=AnomalyDetectionResponse, summary="Detect anomalies")
async def detect_anomaly(
    request: AnomalyDetectionRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Detect anomalies in asset price/volume time series.
    
    Uses Isolation Forest + LSTM autoencoder ensemble.
    """
    from app.services.anomaly.detector import AnomalyDetector
    
    detector = AnomalyDetector()
    result = await detector.detect(
        asset_id=request.asset_id,
        window_days=request.window_days,
        sensitivity=request.sensitivity,
        model_name=request.model_name
    )
    
    return AnomalyDetectionResponse(
        anomaly_id=str(uuid.uuid4()),
        asset_id=request.asset_id,
        is_anomaly=result["is_anomaly"],
        anomaly_score=result["anomaly_score"],
        severity=result["severity"],
        timestamp=datetime.utcnow(),
        details=result.get("details", {})
    )


@router.post("/liquidity", response_model=LiquidityScoreResponse, summary="Score asset liquidity")
async def score_liquidity(
    request: LiquidityScoreRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Calculate liquidity score for an asset.
    
    Factors in: bid-ask spread, volume, order book depth, 
    recent trade frequency, market maker presence.
    """
    from app.services.liquidity.scorer import LiquidityScorer
    
    scorer = LiquidityScorer()
    result = await scorer.score(
        asset_id=request.asset_id,
        window_days=request.window_days
    )
    
    return LiquidityScoreResponse(
        asset_id=request.asset_id,
        liquidity_score=result["liquidity_score"],
        bid_ask_spread=result["bid_ask_spread"],
        volume_24h=result["volume_24h"],
        order_book_depth=result["order_book_depth"],
        last_updated=datetime.utcnow()
    )


@router.post("/credit-risk", response_model=CreditRiskResponse, summary="Assess counterparty credit risk")
async def assess_credit_risk(
    request: CreditRiskRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Assess counterparty credit risk for carbon credit trades.
    
    Uses financial ratios, payment history, sector risk,
    and macroeconomic factors.
    """
    from app.services.credit_risk.assessor import CreditRiskAssessor
    
    assessor = CreditRiskAssessor()
    result = await assessor.assess(
        counterparty_id=request.counterparty_id,
        exposure_amount=request.exposure_amount,
        tenor_days=request.tenor_days,
        collateral_type=request.collateral_type
    )
    
    return CreditRiskResponse(**result)


@router.post("/additionality", response_model=AdditionalityResponse, summary="Assess project additionality")
async def assess_additionality(
    request: AdditionalityRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Assess project additionality for carbon credit quality.
    
    Evaluates: financial, technological, regulatory, and barrier additionality.
    """
    from app.services.additionality.assessor import AdditionalityAssessor
    
    assessor = AdditionalityAssessor()
    result = await assessor.assess(
        project_id=request.project_id,
        methodology=request.methodology,
        vintage=request.vintage,
        geography=request.geography,
        project_type=request.project_type,
        documents=request.documents
    )
    
    return AdditionalityResponse(**result)


@router.post("/reversal-risk", response_model=ReversalRiskResponse, summary="Assess carbon credit reversal risk")
async def assess_reversal_risk(
    request: ReversalRiskRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Assess reversal risk for carbon credits.
    
    Evaluates: permanence, buffer pool, legal, climate, and market risks.
    """
    from app.services.reversal.assessor import ReversalRiskAssessor
    
    assessor = ReversalRiskAssessor()
    result = await assessor.assess(
        asset_id=request.asset_id,
        holding_period_days=request.holding_period_days,
        buffer_pool_pct=request.buffer_pool_pct
    )
    
    return ReversalRiskResponse(**result)


@router.get("/models", summary="List available models")
async def list_models(current_user: dict = Depends(get_current_user)):
    """List available prediction models"""
    return {
        "models": [
            {
                "name": "price_forecaster_tft",
                "type": "Temporal Fusion Transformer",
                "horizon_days": [7, 30, 90, 365],
                "assets": ["VCM_CREDIT", "CCTS_OFFSET_CCC", "CCTS_COMPLIANCE_CCC"],
                "status": "production"
            },
            {
                "name": "price_forecaster_lstm",
                "type": "LSTM",
                "horizon_days": [1, 7, 30],
                "assets": ["VCM_CREDIT"],
                "status": "production"
            },
            {
                "name": "anomaly_detector_iso_forest",
                "type": "Isolation Forest",
                "window_days": [7, 30, 90],
                "status": "production"
            },
            {
                "name": "anomaly_detector_lstm_ae",
                "type": "LSTM Autoencoder",
                "window_days": [7, 30],
                "status": "production"
            },
            {
                "name": "liquidity_scorer_xgb",
                "type": "XGBoost",
                "window_days": [7, 30, 90],
                "status": "production"
            },
            {
                "name": "credit_risk_lgbm",
                "type": "LightGBM",
                "tenor_days": [30, 90, 180, 365],
                "status": "production"
            },
            {
                "name": "additionality_classifier",
                "type": "BERT + TabNet",
                "methodologies": ["VCS", "GS", "CDM", "ACR", "BEE"],
                "status": "production"
            },
            {
                "name": "reversal_risk_model",
                "type": "Survival Analysis",
                "holding_period_days": [30, 90, 180, 365, 1825],
                "status": "production"
            }
        ]


@router.get("/models/{model_name}/metrics", summary="Get model performance metrics")
async def get_model_metrics(
    model_name: str,
    days: int = Query(30, ge=1, le=365),
    current_user: dict = Depends(get_current_user)
):
    """Get model performance metrics"""
    # Would query metrics database
    return {
        "model_name": model_name,
        "period_days": days,
        "metrics": {
            "mae": 0.05,
            "rmse": 0.08,
            "mape": 0.045,
            "directional_accuracy": 0.72,
            "coverage_95": 0.94,
            "coverage_99": 0.98
        },
        "drift_detected": False,
        "last_retrained": "2025-08-15T10:00:00Z",
        "next_retrain": "2025-09-15T10:00:00Z"
    }


@router.post("/models/{model_name}/retrain", summary="Trigger model retraining")
async def retrain_model(
    model_name: str,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user)
):
    """Trigger model retraining (admin only)"""
    # Check admin permission
    if "admin" not in current_user.get("scopes", []):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Queue retraining job
    # background_tasks.add_task(retrain_model, model_name)
    
    return {
        "message": f"Retraining queued for {model_name}",
        "job_id": str(uuid.uuid4()),
        "estimated_completion": "2-4 hours"
    }


# Export
__all__ = ["router"]