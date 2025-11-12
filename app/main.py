# app/main.py
from __future__ import annotations

import io
import logging
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ---- Optional version import (safe fallback) ---------------------------------
try:
    from app.version import VERSION as APP_VERSION  # type: ignore
except Exception:
    APP_VERSION = "dev"

# ---- Risk engine import ------------------------------------------------------
# Must provide: analyze_terms(text: str, doc_name: str | None = None) -> AnalyzeResponse
try:
    from app.risk_engine import analyze_terms
except Exception as e:
    # If import fails, we still let the app boot so you can hit /health
    logging.exception("risk_engine import failed: %s", e)
    analyze_terms = None  # type: ignore

# ---- PDF libs ----------------------------------------------------------------
# (Make sure reportlab is installed; we use SimpleDocTemplate/Paragraph/ListFlowable)
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, ListFlowable, ListItem

# ------------------------------------------------------------------------------
# Pydantic models
# ------------------------------------------------------------------------------
class Issue(BaseModel):
    type: str
    severity: str
    text: str
    explanation: Optional[str] = None

class AnalyzeResponse(BaseModel):
    doc_name: Optional[str] = None
    total_clauses: int
    issues: List[Issue] = Field(default_factory=list)
    summary: Optional[str] = None

class AnalyzeRequest(BaseModel):
    doc_name: Optional[str] = "Sample T&Cs"
    text: str = Field(..., min_length=1)

class PdfRequest(BaseModel):
    doc_name: Optional[str] = "Scorecard"
    text: str = Field(..., min_length=1)
    include_explanation: bool = False

# ------------------------------------------------------------------------------
# App
# ------------------------------------------------------------------------------
app = FastAPI(
    title="Scribbit Backend",
    version=APP_VERSION,
    description="Analyze T&Cs for consumer-risk signals and build a scorecard PDF.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten before going public
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = logging.getLogger("scribbit")
logging.basicConfig(level=logging.INFO)

# ------------------------------------------------------------------------------
# Routes
# ------------------------------------------------------------------------------

@app.get("/")
def root():
    return {
        "name": "Scribbit Backend",
        "version": APP_VERSION,
        "routes": ["/health", "/analyze (POST)", "/scorecard/pdf (POST)"],
    }

@app.get("/health")
def health():
    return {"status": "ok", "version": APP_VERSION}

@app.get("/favicon.ico")
def favicon():
    # We’re not serving a real icon yet; return 204 so browsers stop nagging.
    return Response(status_code=204)

# ---- Analyze -----------------------------------------------------------------

@app.post("/analyze", response_model=AnalyzeResponse)
def analyze_endpoint(req: AnalyzeRequest):
    if analyze_terms is None:
        raise HTTPException(status_code=500, detail="risk_engine not loaded")

    # Call the engine (no model_hint; you chose option B earlier)
    try:
        result: AnalyzeResponse = analyze_terms(text=req.text, doc_name=req.doc_name)
    except TypeError as te:
        # If you still have an older signature, adapt gracefully
        logger.warning("analyze_terms signature mismatch, retrying without doc_name: %s", te)
        result = analyze_terms(req.text)  # type: ignore[arg-type]

    # Log safely without f-strings that include braces/backslashes
    logger.info("analyze: doc=%s total=%s", result.doc_name or "N/A", result.total_clauses)
    return result

# ---- PDF ---------------------------------------------------------------------

@app.post("/scorecard/pdf")
def scorecard_pdf(req: PdfRequest):
    if analyze_terms is None:
        raise HTTPException(status_code=500, detail="risk_engine not loaded")

    try:
        analysis: AnalyzeResponse = analyze_terms(text=req.text, doc_name=req.doc_name)
    except TypeError as te:
        logger.warning("analyze_terms signature mismatch, retrying without doc_name: %s", te)
        analysis = analyze_terms(req.text)  # type: ignore

    # Build PDF in-memory
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=LETTER)
    styles = getSampleStyleSheet()

    story: List = []
    title = req.doc_name or "Scorecard"
    story.append(Paragraph(title, styles["Title"]))
    story.append(Spacer(1, 12))

    # Summary
    summary_text = analysis.summary or "Automated analysis summary."
    story.append(Paragraph(summary_text, styles["BodyText"]))
    story.append(Spacer(1, 12))

    # Totals
    totals_line = "Total Clauses: {}&nbsp;&nbsp;&nbsp;Issues Found: {}".format(
        analysis.total_clauses, len(analysis.issues)
    )
    story.append(Paragraph(totals_line, styles["BodyText"]))
    story.append(Spacer(1, 12))

    # Issues list
    if analysis.issues:
        items = []
        for iss in analysis.issues:
            if req.include_explanation and iss.explanation:
                text = "<b>{}</b> [{}] — {}<br/>{}".format(
                    iss.type, iss.severity.upper(), iss.text, iss.explanation
                )
            else:
                text = "<b>{}</b> [{}] — {}".format(iss.type, iss.severity.upper(), iss.text)
            items.append(ListItem(Paragraph(text, styles["BodyText"]), leftIndent=12))
        story.append(ListFlowable(items, bulletType="1"))
    else:
        story.append(Paragraph("No material issues detected.", styles["BodyText"]))

    doc.build(story)

    pdf_bytes = buf.getvalue()
    buf.close()

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'inline; filename="scorecard.pdf"'},
    )
