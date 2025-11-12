# app/main.py
from __future__ import annotations

import io
import logging
import re
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# --- Optional imports with safe fallbacks ---
try:
    from app.config import settings  # type: ignore
except Exception:
    class _Settings(BaseModel):
        APP_NAME: str = "scribbit-backend"
        ENV: str = "dev"
        ALLOWED_ORIGINS: list[str] = [
            "http://localhost",
            "http://localhost:8000",
            "https://*.github.dev",
            "https://*.app.github.dev",
        ]
        MODEL_HINT: str = "seed-heuristics"
    settings = _Settings()  # type: ignore

try:
    from app.version import VERSION  # type: ignore
except Exception:
    VERSION = "0.1.0"

try:
    from app.risk_engine import analyze_terms  # type: ignore
except Exception as e:
    def analyze_terms(text: str, model_hint: Optional[str] = None):
        # Minimal fallback so the app still runs if risk_engine is missing
        # Return shape must match AnalyzeResponse below.
        logging.getLogger("analyze").warning(
            f"risk_engine not available ({e}); using fallback analyzer"
        )
        findings = []
        if "non-refundable" in text.lower():
            findings.append({
                "type": "Non-Refundable",
                "severity": "high",
                "snippet": "All sales are final and non-refundable.",
                "explanation": "Non-refundable terms restrict consumer remedies.",
            })
        overall_risk = "high" if findings else "low"
        return {
            "doc_name": "Untitled",
            "overall_risk": overall_risk,
            "findings": findings,
            "token_usage": 0,
            "model_used": model_hint or "fallback",
            "generated_at": datetime.utcnow().isoformat() + "Z",
        }

try:
    from app.pdf import generate_pdf  # type: ignore
except Exception as e:
    def generate_pdf(analysis: dict, doc_name: str, include_explanation: bool = True) -> bytes:
        # Minimal fallback PDF in case app/pdf.py isn't present
        buf = io.BytesIO()
        buf.write(
            f"Scribbit Scorecard (FALLBACK)\nDoc: {doc_name}\nOverall: {analysis.get('overall_risk','n/a')}\n".encode()
        )
        return buf.getvalue()

# --- Pydantic Schemas ---
class Finding(BaseModel):
    type: str
    severity: str
    snippet: str
    explanation: Optional[str] = None

class AnalyzeRequest(BaseModel):
    doc_name: str = Field(..., description="Human-friendly name of the document")
    text: str = Field(..., description="Full contract or T&C text to analyze")

class AnalyzeResponse(BaseModel):
    doc_name: str
    overall_risk: str
    findings: list[Finding]
    token_usage: int
    model_used: str
    generated_at: str

class ScorecardPDFRequest(AnalyzeRequest):
    include_explanation: bool = Field(
        default=True,
        description="If true, include explanations in the PDF rows"
    )

# --- App init & logging ---
logger = logging.getLogger("scribbit")
analyze_logger = logging.getLogger("analyze")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = FastAPI(
    title="Scribbit Backend",
    description="Risk analysis & PDF scorecard generator for T&Cs / contracts.",
    version=VERSION,
)

# --- CORS for Codespaces & local ---
allowed_origins = getattr(settings, "ALLOWED_ORIGINS", [])
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins if allowed_origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Utils ---
_slug_rx = re.compile(r"[^a-z0-9\-]+")

def slugify(name: str) -> str:
    s = name.strip().lower().replace(" ", "-")
    s = _slug_rx.sub("-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s or "document"

# --- Routes ---
@app.get("/", response_class=JSONResponse)
def root() -> dict:
    return {
        "service": getattr(settings, "APP_NAME", "scribbit-backend"),
        "status": "ok",
        "version": VERSION,
        "env": getattr(settings, "ENV", "dev"),
        "docs": "/docs",
        "openapi": "/openapi.json",
        "health": "/health",
    }

@app.get("/health", response_class=JSONResponse)
def health() -> dict:
    return {"status": "ok", "ts": datetime.utcnow().isoformat() + "Z"}

@app.get("/version", response_class=JSONResponse)
def version() -> dict:
    return {"version": VERSION}

@app.get("/favicon.ico")
def favicon() -> Response:
    # We don’t serve one; avoid 404 noise
    return Response(status_code=204)

@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    analyze_logger.info(
        "analyze: doc=%s total=%d tokens=%d model=%s",
        req.doc_name,
        len(req.text.split()),
        0,
        getattr(settings, "MODEL_HINT", "seed-heuristics"),
    )
    result = analyze_terms(req.text, model_hint=getattr(settings, "MODEL_HINT", None))

    # Normalize to AnalyzeResponse (handles dict or already-built object)
    if isinstance(result, dict):
        payload = {
            "doc_name": req.doc_name,
            "overall_risk": result.get("overall_risk", "unknown"),
            "findings": result.get("findings", []),
            "token_usage": int(result.get("token_usage", 0)),
            "model_used": result.get("model_used", "n/a"),
            "generated_at": result.get("generated_at", datetime.utcnow().isoformat() + "Z"),
        }
    elif isinstance(result, AnalyzeResponse):
        payload = result.dict()
        payload["doc_name"] = req.doc_name
    else:
        raise HTTPException(status_code=500, detail="Unexpected analyzer return type")

    return AnalyzeResponse(**payload)

@app.post(
    "/scorecard/pdf",
    responses={
        200: {"content": {"application/pdf": {}}},
        422: {"description": "Validation error"},
        500: {"description": "Internal server error"},
    },
)
def scorecard_pdf(req: ScorecardPDFRequest):
    """
    Runs analysis, then renders a PDF scorecard and returns it as a download.
    """
    try:
        # 1) Run analysis using the same engine
        analysis = analyze(req)  # returns AnalyzeResponse (pydantic)

        # 2) Build PDF — pass a **dict** so pdf builder never expects .get on a model
        pdf_bytes = generate_pdf(
            analysis=analysis.dict(),
            doc_name=req.doc_name,
            include_explanation=req.include_explanation,
        )

        if not isinstance(pdf_bytes, (bytes, bytearray)):
            raise RuntimeError("PDF generator did not return bytes")

        filename = f"{slugify(req.doc_name)}-scorecard.pdf"

        headers = {
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
            "Pragma": "no-cache",
        }
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers=headers,
        )
    except HTTPException:
        # bubble up FastAPI-style exceptions
        raise
    except Exception as e:
        logger.exception("scorecard/pdf failed: %s", e)
        raise HTTPException(
            status_code=500,
            detail={"error": str(e), "message": "Internal server error. Please check logs."},
        )
