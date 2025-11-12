from typing import List, Optional, Literal
from pydantic import BaseModel, HttpUrl, Field

RiskType = Literal["FX","Auto-Renew","Arbitration","Data-Sharing","Non-Refundable","Unilateral Changes"]

class AnalyzeRequest(BaseModel):
    text: Optional[str] = None
    url: Optional[HttpUrl] = None
    doc_name: Optional[str] = None
    language: str = "en"
    include_explanation: bool = True

class RiskItem(BaseModel):
    risk_type: RiskType
    severity: Literal["low","medium","high","critical"]
    score: int = Field(ge=0, le=100)
    confidence: int = Field(ge=0, le=100)
    evidence: List[str]
    clauses: List[str]
    explanation: Optional[str] = None

class AnalyzeResponse(BaseModel):
    doc_name: Optional[str]
    total_risk_score: int = Field(ge=0, le=100)
    risks: List[RiskItem]
    detected_language: str
    tokens_used: int
    model: str
