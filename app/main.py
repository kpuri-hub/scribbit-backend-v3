from __future__ import annotations

import logging
from fastapi import FastAPI, HTTPException, Response, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.config import settings
from app.models import AnalyzeRequest, AnalyzeResponse
from app.risk_engine import analyze_terms
from app.utils import fetch_url_text
from app.pdf_report import build_pdf

# ------------------------------------------------------------------------------
# App + Logging
# ------------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("scribbit")

app = FastAPI(title=settings.app_name, version="0.4.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------------------------------------------------------
# Basic routes
# ------------------------------------------------------------------------------
@app.get("/")
async def root():
    return {"ok": True, "name": settings.app_name, "env": settings.environment}

@app.get("/health")
async def health():
    return {"status": "healthy"}

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)

# ------------------------------------------------------------------------------
# Analyze
# ------------------------------------------------------------------------------
@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(payload: AnalyzeRequest):
    """
    Analyze T&Cs text (or fetched URL) for six risk categories and return a scorecard.
    Works even without OPENAI_API_KEY (falls back to seed heuristics).
    """
    if not (payload.text or payload.url):
        raise HTTPException(status_code=400, detail="Provide 'text' or 'url'")

    text = (payload.text or "").strip()

    if payload.url and not text:
        try:
            text = await fetch_url_text(str(payload.url))
        except Exception as e:
            logger.exception("URL fetch failed")
            raise HTTPException(status_code=422, detail=f"Failed to fetch URL: {e}")

    if not text:
        raise HTTPException(status_code=422, detail="No analyzable text found")

    try:
        resp = analyze_terms(
            text,
            doc_name=payload.doc_name,
            include_explanation=payload.include_explanation,
        )
        logger.info(
            "analyze: doc=%s total=%s tokens=%s model=%s",
            resp.doc_name,
            resp.total_risk_score,
            resp.tokens_used,
            resp.model,
        )
        return resp
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Analysis error")
        raise HTTPException(status_code=500, detail=f"Analysis error: {e}")

# ------------------------------------------------------------------------------
# PDF Scorecard
# ------------------------------------------------------------------------------
@app.post("/scorecard/pdf")
async def scorecard_pdf(payload: AnalyzeRequest = Body(...)):
    """
    Generate and download a PDF scorecard for the given request.
    Reuses the /analyze logic to maintain identical behavior.
    """
    resp: AnalyzeResponse = await analyze(payload)  # reuse route logic
    pdf_bytes = build_pdf(resp)
    filename = f"scribbit-scorecard-{(resp.doc_name or 'document').replace(' ', '_')}.pdf"
    headers = {"Content-Disposition": f'attachment; filename=\"{filename}\"'}
    return StreamingResponse(iter([pdf_bytes]), media_type="application/pdf", headers=headers)
