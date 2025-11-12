from io import BytesIO
from reportlab.lib.pagesizes import LETTER
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from app.models import AnalyzeResponse

def build_pdf(resp: AnalyzeResponse) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=LETTER, leftMargin=36, rightMargin=36, topMargin=36, bottomMargin=36)
    styles = getSampleStyleSheet()
    elems = []

    title = f"Scribbit Risk Scorecard — {resp.doc_name or 'Document'}"
    elems.append(Paragraph(title, styles["Title"]))
    elems.append(Paragraph(f"Total Risk Score: <b>{resp.total_risk_score}</b> / 100", styles["Heading2"]))
    elems.append(Paragraph(f"Model: {resp.model} • Tokens: {resp.tokens_used} • Lang: {resp.detected_language}", styles["Normal"]))
    elems.append(Spacer(1, 12))

    data = [["Risk Type","Severity","Score","Confidence","Evidence (first)","Clauses (first)"]]
    for r in resp.risks:
        data.append([
            r.risk_type,
            r.severity.title(),
            str(r.score),
            f"{r.confidence}%",
            (r.evidence[0] if r.evidence else "—")[:140],
            (r.clauses[0] if r.clauses else "—")[:80],
        ])

    tbl = Table(data, repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,0), colors.HexColor("#111827")),
        ("TEXTCOLOR",(0,0),(-1,0), colors.white),
        ("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),
        ("FONTSIZE",(0,0),(-1,0),10),
        ("ALIGN",(2,1),(3,-1),"CENTER"),
        ("GRID",(0,0),(-1,-1),0.25, colors.HexColor("#e5e7eb")),
        ("ROWBACKGROUNDS",(0,1),(-1,-1), [colors.white, colors.HexColor("#f9fafb")]),
        ("BOTTOMPADDING",(0,0),(-1,0),8),
        ("TOPPADDING",(0,1),(-1,-1),4),
        ("BOTTOMPADDING",(0,1),(-1,-1),4),
    ]))
    elems.append(tbl)
    elems.append(Spacer(1, 12))

    # Detail blocks
    for r in resp.risks:
        elems.append(Paragraph(f"{r.risk_type} — {r.severity.title()} ({r.score}/100, conf {r.confidence}%)", styles["Heading3"]))
        if r.explanation:
            elems.append(Paragraph(r.explanation, styles["BodyText"]))
        if r.evidence:
            elems.append(Paragraph("<b>Evidence:</b> " + " | ".join(r.evidence[:3]), styles["BodyText"]))
        if r.clauses:
            elems.append(Paragraph("<b>Clauses:</b> " + " | ".join(r.clauses[:3]), styles["BodyText"]))
        elems.append(Spacer(1, 6))

    doc.build(elems)
    return buf.getvalue()
