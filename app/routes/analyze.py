from __future__ import annotations

import logging
from typing import Dict

from fastapi import APIRouter, HTTPException

from app.schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    PanelRiskItem,
    PanelRiskResult,
)
from app.risk_engine import analyze_terms

router = APIRouter(tags=["analyze"])

log = logging.getLogger("scribbit.api.analyze")


# ------------------------------------------------------------------------------
# Mapping from engine risk types → panel categories/cards (Option A)
# ------------------------------------------------------------------------------

RISK_TYPE_MAPPING: Dict[str, Dict[str, str]] = {
    "Non-Refundable": {
        "id": "non_refundable",
        "category": "financial",
        "title": "Non-refundable payments",
        "description": "Payments are non-refundable or all sales are final.",
    },
    "Auto-Renewal": {
        "id": "auto_renewal",
        "category": "financial",
        "title": "Auto-renewing subscription",
        "description": "Charges may continue automatically unless you cancel.",
    },
    "Foreign Exchange / Fees": {
        "id": "fx_fees",
        "category": "financial",
        "title": "Foreign exchange & conversion fees",
        "description": "Extra FX or conversion fees may apply to your payment.",
    },
    "Data Sharing": {
        "id": "data_sharing",
        "category": "data_privacy",
        "title": "Data sharing with third parties",
        "description": "Your personal data may be shared with third parties.",
    },
    "Arbitration": {
        "id": "arbitration",
        "category": "legal_rights",
        "title": "Forced arbitration",
        "description": "Disputes may be forced into arbitration instead of court.",
    },
    "Unilateral Changes": {
        "id": "unilateral_changes",
        "category": "legal_rights",
        "title": "Provider can change terms/fees",
        "description": "The provider can change terms or fees without your consent.",
    },
}


def _map_overall_level(score_0_to_100: float) -> str:
    """
    Map a 0–100 riskScore into 'low' | 'medium' | 'high' | 'none'.
    Mirrors panel.js severityFromScore thresholds.
    """
    if score_0_to_100 >= 70:
        return "high"
    if score_0_to_100 >= 40:
        return "med"
    if score_0_to_100 > 0:
        return "low"
    return "none"


def _build_panel_risk_result(engine_result: AnalyzeResponse) -> PanelRiskResult:
    """
    Convert the engine-level AnalyzeResponse into the panel.js-friendly structure.
    """
    panel_risks = []

    # Start category scores at 0 for all known categories
    category_scores: Dict[str, float] = {
        "financial": 0.0,
        "data_privacy": 0.0,
        "content_ip": 0.0,
        "legal_rights": 0.0,
    }

    for r in engine_result.risks:
        # Look up mapping, fallback to a generic financial card
        mapping = RISK_TYPE_MAPPING.get(
            r.type,
            {
                "id": r.type.lower().replace(" ", "_"),
                "category": "financial",
                "title": r.type,
                "description": r.rationale
                or "This term may create financial or contract risk.",
            },
        )

        category = mapping.get("category", "financial")
        # Accumulate category score
        if category in category_scores:
            category_scores[category] += float(r.score)
        else:
            category_scores[category] = float(r.score)

        description = mapping.get("description") or r.rationale or ""
        panel_risk = PanelRiskItem(
            id=mapping.get("id", "risk"),
            category=category,
            title=mapping.get("title", r.type),
            description=description,
            severity=r.severity,
            score=float(r.score),
            evidence=list(r.evidence or []),
        )
        panel_risks.append(panel_risk)

    # Scale raw scores into 0–100
    # Using a simple linear scale: total_score * 10, clamped at 100.
    # You can refine this once Risk Model v2/3 is finalized.
    scaled_category_scores: Dict[str, float] = {}
    for cat, raw in category_scores.items():
        scaled = max(0.0, min(100.0, float(raw) * 10.0))
        scaled_category_scores[cat] = scaled

    # Global riskScore: base on total_risk_score from engine
    raw_total = float(engine_result.total_risk_score)
    risk_score = max(0.0, min(100.0, raw_total * 10.0))

    overall_level = _map_overall_level(risk_score)

    return PanelRiskResult(
        risks=panel_risks,
        categoryScores=scaled_category_scores,
        riskScore=risk_score,
        overallLevel=overall_level,
        hasMeaningfulContent=len(panel_risks) > 0,
        pageMode="summary",
    )


@router.post("/analyze", response_model=AnalyzeResponse)
def analyze(payload: AnalyzeRequest) -> AnalyzeResponse:
    """
    Analyze raw T&Cs text and return a structured risk summary.

    - Engine-level metrics come from analyze_terms (total_risk_score, grade, risks, etc.)
    - riskResult is attached for panel.js / UI consumption.
    """
    try:
        engine_result = analyze_terms(
            text=payload.text,
            doc_name=payload.doc_name,
            include_explanation=payload.include_explanation,
            model_hint=payload.model_hint,
        )
    except NotImplementedError as nie:
        # AI deep-dive path not yet implemented
        log.warning("Requested model not implemented: %s", nie)
        raise HTTPException(status_code=501, detail=str(nie))
    except Exception as exc:
        # Defensive catch-all – we do NOT expose internal details
        log.exception("analyze_terms failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Analysis failed due to an internal error.",
        )

    # Attach panel-friendly riskResult for the UI
    try:
        panel_result = _build_panel_risk_result(engine_result)
        engine_result.riskResult = panel_result
    except Exception as exc:
        # Log but do not break the core response if panel formatting fails
        log.exception("Failed to build panel riskResult: %s", exc)

    return engine_result
