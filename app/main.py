from __future__ import annotations

import io
import logging
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from fastapi.openapi.docs import get_swagger_ui_html

from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas

from app.schemas import AnalyzeRequest, AnalyzeResponse
from app.risk_engine import analyze_terms

log = logging.getLogger("uvicorn")
app = FastAPI(title="Scribbit Backend", version="0.1.0")

# CORS (adjust as needed)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", response_class=PlainTextResponse, include_in_schema=False)
def root() -> str:
    return "Scribbit API is running. Visit /docs for the Swagger UI."


@app.get("/health", response_class=PlainTextResponse, tags=["System"])
def health() -> str:
    return "ok"


@app.get("/docs", include_in_schema=False)
def custom_docs():
    return get_swagger_ui_html(
        openapi_url="/openapi.json",
        title="Scribbit API Docs",
        swagger_favicon_url=None,  # no favicon
    )


@app.post("/analyze", response_model=AnalyzeResponse, tags=["Analyze"])
def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    res = analyze_terms(req.text, model_hint=req.model_hint)
    # fill doc_name after the fact so the engine stays pure
    res.doc_name = req.doc_name
    log.info("analyze: doc=%s total=%s model=%s", req.doc_name, res.total_risks, res.model_used)
    return res


@app.post("/scorecard/pdf", tags=["Analyze"])
def scorecard_pdf(req: AnalyzeRequest):
    """
    Returns a generated PDF scorecard (Content-Type: application/pdf)
    based on the same analysis used by /analyze.
    """
    try:
        result = analyze_terms(req.text, model_hint=req.model_hint)
        result.doc_name = req.doc_name

        # Generate a simple PDF in-memory
        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=LETTER)
        width, height = LETTER

        y = height - 72
        c.setFont("Helvetica-Bold", 14)
        c.drawString(72, y, f"Scribbit Scorecard — {result.doc_name}")
        y -= 18
        c.setFont("Helvetica", 10)
        c.drawString(72, y, f"Model: {result.model_used} | Total Risks: {result.total_risks}")
        y -= 14

        c.drawString(72, y, f"Overall Level: {result.summary.get('risk_level', 'N/A')} (Score={result.summary.get('total_score', 0)})")
        y -= 20

        c.setFont("Helvetica-Bold", 11)
        c.drawString(72, y, "Findings:")
        y -= 16
        c.setFont("Helvetica", 10)

        for idx, r in enumerate(result.risks, start=1):
            lines = [
                f"{idx}. [{r.severity}] {r.type} — score {r.score}",
                f"   Why: {r.rationale}",
                f"   Snippet: {r.snippet[:200].replace('\\n', ' ')}"  # clamp
            ]
            for line in lines:
                if y < 72:
                    c.showPage()
                    y = height - 72
                    c.setFont("Helvetica", 10)
                c.drawString(72, y, line)
                y -= 14
            y -= 6

        c.showPage()
        c.save()
        pdf_bytes = buf.getvalue()
        buf.close()

        headers = {
            "Content-Disposition": f'inline; filename="{req.doc_name.lower().replace(" ", "-")}-scorecard.pdf"'
        }
        return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        log.exception("PDF generation failed: %s", e)
        raise HTTPException(status_code=500, detail={"error": str(e), "message": "Internal server error. Please check logs."})
