from __future__ import annotations

from typing import Optional, List

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
        description='Optional selector for analysis engine, e.g. "seed-heuristics" (default), '
                    '"gpt-4o-mini" (future).',
    )


# ------------------------------------------------------------------------------
# Risk item models
# ------------------------------------------------------------------------------

class RiskSpan(BaseModel):
    start: int
    end: int


class RiskItem(BaseModel):
    type: str
    severity: str
    score: float
    span: Optional[RiskSpan] = None
    snippet: Optional[str] = None
    rationale: Optional[str] = None


# ------------------------------------------------------------------------------
# Response models
# ------------------------------------------------------------------------------

class AnalyzeResponse(BaseModel):
    """
    Canonical response model for /analyze and internal risk engine.
    """
    doc_name: str
    total_risk_score: float
    grade: str
    risks: List[RiskItem]
    model: str
    tokens: int
