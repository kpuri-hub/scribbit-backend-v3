from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from io import BytesIO
from typing import Any, Dict

from app.risk_engine import analyze_terms  # re-use the same analyzer

router = APIRouter(tags=["scorecard"])

class ScorecardRequest(BaseModel):
    doc_name: str = Field(..., description="Filename/title to embed")
    text: str = Field(..., description="Raw T&Cs / contract text")
    include_explanation: bool = Field(default=False, description="Include explanation text in PDF")

def _try_import_reportlab():
    try:
        # lazy import so your server still boots if reportlab isn't installed
        from reportlab.lib.pagesizes import LETTER
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
        from reportlab.lib import colors
        return {
            "LETTER": LETTER,
            "getSampleStyleSheet": getSampleStyleSheet,
            "SimpleDocTemplate": SimpleDocTemplate,
            "Paragraph": Paragraph,
            "Spacer": Spacer,
            "Table": Table,
            "TableStyle": TableStyle,
            "colors": colors,
        }
    except Exception:  # ImportError or other reportlab init errors
        return None

def _build_pdf(doc_name: str, analysis: Dict[str, Any], include_explanation: bool) -> bytes:
    rl = _try_import_reportlab()
    if rl is None:
        # Tell the client how to fix it rather than 500
        raise HTTPException(
            status_code=501,
            detail="PDF generation requires 'reportlab'. Add 'reportlab>=4.0.0' to requirements.txt and pip install.",
        )

    buf = BytesIO()
    doc = rl["SimpleDocTemplate"](buf, pagesize=rl["LETTER"])
    styles = rl["getSampleStyleSheet"]()
    story = []

    title = f"Scribbit Risk Scorecard — {doc_name}"
    story.append(Paragraph(title, styles["Title"]))
    story.append(rl["Spacer"](1, 12))

    # Summary line
    summary = f"Total Risk Score: <b>{analysis.get('total_risk_score', 0):.2f}</b> — Grade: <b>{analysis.get('grade', 'N/A')}</b>"
    story.append(Paragraph(summary, styles["Heading2"]))
    story.append(rl["Spacer"](1, 6))

    # Risks table
    risks = analysis.get("risks", [])
    data = [["Type", "Severity", "Score", "Snippet"]]
    for r in risks:
        data.append([
            r.get("type", ""),
            r.get("severity", ""),
            f"{r.get('score', 0):.2f}",
            (r.get("snippet", "") or "")[:140].replace("\n", " "),
        ])

    table = rl["Table"](data, hAlign="LEFT")
    table.setStyle(rl["TableStyle"]([
        ("BACKGROUND", (0,0), (-1,0), rl["colors"].lightgrey),
        ("TEXTCOLOR", (0,0), (-1,0), rl["colors"].black),
        ("GRID", (0,0), (-1,-1), 0.25, rl["colors"].grey),
        ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
        ("FONTSIZE", (0,0), (-1,-1), 9),
        ("ALIGN", (2,1), (2,-1), "RIGHT"),
    ]))
    story.append(table)
    story.append(rl["Spacer"](1, 10))

    if include_explanation:
        story.append(Paragraph("Notes", styles["Heading3"]))
        for r in risks:
            if r.get("rationale"):
                story.append(Paragraph(f"<b>{r.get('type')}:</b> {r.get('rationale')}", styles["BodyText"]))
                story.append(rl["Spacer"](1, 6))

    doc.build(story)
    return buf.getvalue()

@router.post("/scorecard/pdf", response_class=StreamingResponse)
def scorecard_pdf(payload: ScorecardRequest):
    # Run the same analyzer used by /analyze
    analysis = analyze_terms(
        text=payload.text,
        doc_name=payload.doc_name,
        include_explanation=payload.include_explanation,
    )

    # Build the PDF (501 if reportlab missing)
    pdf_bytes = _build_pdf(
        doc_name=payload.doc_name,
        analysis=analysis,
        include_explanation=payload.include_explanation,
    )

    filename = f"{payload.doc_name.replace(' ', '_')}_scribbit_scorecard.pdf"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )
