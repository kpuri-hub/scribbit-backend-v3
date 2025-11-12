# app/pdf.py
from io import BytesIO
from typing import List
from reportlab.lib.pagesizes import LETTER
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors

from app.schemas import AnalyzeResponse

def build_scorecard_pdf(analysis: AnalyzeResponse, doc_name: str) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=LETTER,
        title=f"{doc_name} – Scribbit Scorecard",
        author="Scribbit"
    )
    styles = getSampleStyleSheet()
    story: List = []

    # Title + doc name
    story.append(Paragraph("Scribbit Scorecard", styles["Title"]))
    story.append(Paragraph(doc_name or "Document", styles["Heading2"]))
    story.append(Spacer(1, 12))

    # Summary table (use attribute access, not .get)
    s = analysis.summary
    summary_rows = [
        ["Total Issues", str(s.total_issues)],
        ["High", str(s.high_risk_count)],
        ["Medium", str(s.medium_risk_count)],
        ["Low", str(s.low_risk_count)],
        ["Overall", s.overall_risk],
    ]
    summary_table = Table(summary_rows, hAlign="LEFT")
    summary_table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("BACKGROUND", (0, 0), (-1, 0), colors.whitesmoke),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(summary_table)
    story.append(Spacer(1, 12))

    # Issues (cap at 20 for compactness)
    if analysis.issues:
        story.append(Paragraph("Issues", styles["Heading2"]))
        rows = [["Type", "Severity", "Snippet"]]
        for issue in analysis.issues[:20]:
            itype = getattr(issue, "type", None) or getattr(issue, "category", "") or ""
            sev = getattr(issue, "severity", "") or ""
            snip = getattr(issue, "snippet", None) or getattr(issue, "reason", "") or ""
            # keep snippets short so PDFs don’t explode
            snip = snip.strip().replace("\n", " ")[:300]
            rows.append([itype, sev, snip])

        t = Table(rows, colWidths=[130, 80, 320])
        t.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("BACKGROUND", (0, 0), (-1, 0), colors.whitesmoke),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        story.append(t)

    doc.build(story)
    pdf = buf.getvalue()
    buf.close()
    return pdf
