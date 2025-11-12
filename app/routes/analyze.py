from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import List, Optional

from app.risk_engine import analyze_terms  # uses your existing heuristic engine

router = APIRouter(tags=["analyze"])

class AnalyzeRequest(BaseModel):
    doc_name: str = Field(..., description="Document name for tracking")
    text: str = Field(..., description="Raw T&Cs / contract text to analyze")
    include_explanation: bool = Field(default=True, description="Include explanation strings")

class RiskItem(BaseModel):
    type: str
    severity: str
    score: float
    start: Optional[int] = None
    end: Optional[int] = None
    snippet: Optional[str] = None
    rationale: Optional[str] = None

class AnalyzeResponse(BaseModel):
    doc_name: str
    total_risk_score: float
    grade: str
    risks: List[RiskItem]
    model: str
    tokens: int

@router.post("/analyze", response_model=AnalyzeResponse)
def analyze(payload: AnalyzeRequest):
    result = analyze_terms(
        text=payload.text,
        doc_name=payload.doc_name,
        include_explanation=payload.include_explanation,
    )
    # ensure FastAPI-compatible schema
    resp = {
        "doc_name": result.get("doc_name"),
        "total_risk_score": result.get("total_risk_score"),
        "grade": result.get("grade"),
        "model": result.get("model"),
        "tokens": result.get("tokens", 0),
        "risks": [
            {
                "type": r.get("type"),
                "severity": r.get("severity"),
                "score": r.get("score"),
                "start": r.get("span", {}).get("start"),
                "end": r.get("span", {}).get("end"),
                "snippet": r.get("snippet"),
                "rationale": r.get("rationale"),
            }
            for r in result.get("risks", [])
        ],
    }
    return resp
