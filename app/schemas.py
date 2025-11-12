from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    doc_name: str = Field(..., description="Human-friendly name of the document")
    text: str = Field(..., description="Full text to analyze")
    include_explanation: bool = Field(True, description="Include rule/why details")
    model_hint: Optional[str] = Field(
        None,
        description='Optional selector for analysis engine, e.g. "seed-heuristics" (default), "gpt-4o-mini" (future)',
    )


class RiskItem(BaseModel):
    type: str
    severity: str
    score: int
    snippet: str
    rationale: str


class AnalyzeResponse(BaseModel):
    doc_name: str
    model_used: str
    total_risks: int
    risks: List[RiskItem]
    summary: Dict[str, Any] = {}
