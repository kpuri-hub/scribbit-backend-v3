from __future__ import annotations

from typing import Optional, List, Dict

from pydantic import BaseModel, Field


# ------------------------------------------------------------------------------
# Request models
# ------------------------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    """
    Canonical request model for /analyze.
    """
    doc_name: str = Field(..., description="Human-friendly name of the document")
    text: str = Field(
        ...,
        description="Full raw T&Cs / contract text to analyze",
        min_length=1,
        max_length=50_000,  # basic guardrail against huge payloads
    )
    include_explanation: bool = Field(
        default=True,
        description="Whether to include rationale/explanation text per risk item.",
    )
    model_hint: Optional[str] = Field(
        default=None,
        description=(
            'Optional selector for analysis engine, e.g. '
            '"seed-heuristics" (default), "gpt-4o-mini" (future).'
        ),
    )


# ------------------------------------------------------------------------------
# Risk item models (engine-level)
# ------------------------------------------------------------------------------

class RiskSpan(BaseModel):
    start: int
    end: int


class RiskItem(BaseModel):
    """
    Raw risk item produced by the engine.
    """
    type: str
    severity: str
    score: float
    span: Optional[RiskSpan] = None
    snippet: Optional[str] = None
    rationale: Optional[str] = None
    evidence: List[str] = Field(
        default_factory=list,
        description="Individual evidence lines or snippets supporting this risk.",
    )


# ------------------------------------------------------------------------------
# Panel/UI-level models (for panel.js)
# ------------------------------------------------------------------------------

class PanelRiskItem(BaseModel):
    """
    Risk item formatted for the panel UI.
    """
    id: str
    category: str  # financial | data_privacy | content_ip | legal_rights
    title: str
    description: str
    severity: str
    score: float
    evidence: List[str] = Field(default_factory=list)


class PanelRiskResult(BaseModel):
    """
    Structure expected by panel.js (or compatible with its normalizeRiskResult).
    """
    risks: List[PanelRiskItem]
    categoryScores: Dict[str, float]
    riskScore: float
    overallLevel: str  # "low" | "medium" | "high" | "none"
    hasMeaningfulContent: bool
    pageMode: str = "summary"


# ------------------------------------------------------------------------------
# Response models
# ------------------------------------------------------------------------------

class AnalyzeResponse(BaseModel):
    """
    Canonical response model for /analyze and internal risk engine.
    - Core engine metrics (doc_name, total_risk_score, grade, risks, model, tokens)
    - Optional riskResult for UI consumption (panel.js).
    """
    doc_name: str
    total_risk_score: float
    grade: str
    risks: List[RiskItem]
    model: str
    tokens: int
    riskResult: Optional[PanelRiskResult] = Field(
        default=None,
        description="Optional panel-friendly riskResult structure."
    )
