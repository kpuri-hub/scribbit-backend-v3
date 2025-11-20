from __future__ import annotations

import logging
import re
from typing import List, Dict, Any, Optional

from app.schemas import AnalyzeResponse, RiskItem, RiskSpan

log = logging.getLogger("scribbit.risk_engine")

# ------------------------------------------------------------------------------
# Seed heuristic patterns
# ------------------------------------------------------------------------------

PATTERNS: Dict[str, Dict[str, Any]] = {
    "Non-Refundable": {
        "regex": re.compile(
            r"\b(non[-\s]?refundable|all sales are final|no refunds?)\b",
            re.IGNORECASE,
        ),
        "severity": "High",
        "score": 9.0,
        "rationale": "Text indicates payments are non-refundable or all sales are final.",
    },
    "Auto-Renewal": {
        "regex": re.compile(
            r"\b(auto[-\s]?renew(al)?|renews? automatically|rollover)\b",
            re.IGNORECASE,
        ),
        "severity": "Medium",
        "score": 6.0,
        "rationale": "Contract renews automatically unless cancelled.",
    },
    "Arbitration": {
        "regex": re.compile(
            r"\barbitration|binding arbitration|waiver of jury trial\b",
            re.IGNORECASE,
        ),
        "severity": "Medium",
        "score": 5.0,
        "rationale": "Disputes may be forced into arbitration; rights may be limited.",
    },
    "Unilateral Changes": {
        "regex": re.compile(
            r"\bwe may (change|modify|update) (these )?(terms|fees|prices)\b",
            re.IGNORECASE,
        ),
        "severity": "High",
        "score": 8.0,
        "rationale": "One party can change terms/fees unilaterally.",
    },
    "Data Sharing": {
        "regex": re.compile(
            r"\bshare (your )?(data|information)|third[-\s]?part(y|ies)\b",
            re.IGNORECASE,
        ),
        "severity": "Medium",
        "score": 5.0,
        "rationale": "Mentions data sharing with third parties.",
    },
    "Foreign Exchange / Fees": {
        "regex": re.compile(
            r"\b(foreign exchange|fx|currency conversion|conversion fee|cross[-\s]?border fee)\b",
            re.IGNORECASE,
        ),
        "severity": "Medium",
        "score": 5.0,
        "rationale": "Mentions currency conversion or FX fees.",
    },
}


# ------------------------------------------------------------------------------
# Internal helpers
# ------------------------------------------------------------------------------

def _run_seed_heuristics(text: str) -> List[RiskItem]:
    """
    Run simple keyword/regex-based heuristics and return a list of RiskItem objects.
    Each RiskItem now also carries an `evidence` list for UI expansion.
    """
    risks: List[RiskItem] = []

    for risk_type, cfg in PATTERNS.items():
        regex = cfg["regex"]
        severity = cfg["severity"]
        score = float(cfg["score"])
        rationale = cfg["rationale"]

        for m in regex.finditer(text):
            start = m.start()
            end = m.end()

            # Grab a local snippet around the match
            window_start = max(start - 80, 0)
            window_end = min(end + 80, len(text))
            snippet = text[window_start:window_end].strip()

            span = RiskSpan(start=start, end=end)

            # For now, evidence is a single-item list containing the snippet.
            # Later you can expand this to line-based evidence or multiple hits.
            evidence = [snippet] if snippet else []

            risks.append(
                RiskItem(
                    type=risk_type,
                    severity=severity,
                    score=score,
                    span=span,
                    snippet=snippet,
                    rationale=rationale,
                    evidence=evidence,
                )
            )

    return risks


def _grade_from_score(total_risk_score: float) -> str:
    """
    Simple letter-grade mapping for now.
    This can evolve into your Risk Model v2+ mapping later.
    """
    if total_risk_score <= 5:
        return "A"
    if total_risk_score <= 12:
        return "B"
    if total_risk_score <= 20:
        return "C"
    return "D"


# ------------------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------------------

def analyze_terms(
    text: str,
    doc_name: Optional[str] = None,
    include_explanation: bool = True,
    model_hint: Optional[str] = None,
) -> AnalyzeResponse:
    """
    Canonical risk analysis function for Scribbit backend.

    - Currently uses seed heuristics (regex patterns).
    - In the future, model_hint can route to OpenAI or other engines.
    """
    engine = (model_hint or "seed-heuristics").strip().lower()

    if engine in ("seed-heuristics", "heuristics", "local", ""):
        risks = _run_seed_heuristics(text)
        model_used = "seed-heuristics"
    elif engine in ("gpt-4o-mini", "openai", "gpt"):
        # Stub for future deep AI integration
        raise NotImplementedError("OpenAI model integration not yet enabled.")
    else:
        # Unknown engine hint – fall back to heuristics
        log.warning("Unknown model_hint '%s'; falling back to seed-heuristics.", engine)
        risks = _run_seed_heuristics(text)
        model_used = f"seed-heuristics (fallback from '{engine}')"

    total_risk_score = float(sum(r.score for r in risks))
    grade = _grade_from_score(total_risk_score)

    # Very rough token estimate – can be swapped for a tokenizer later
    tokens = len(text.split())

    # NOTE: We deliberately do not log raw text here to avoid PII.
    log.info(
        "analyze_terms: doc=%s risks=%d score=%.2f grade=%s model=%s",
        doc_name or "N/A",
        len(risks),
        total_risk_score,
        grade,
        model_used,
    )

    return AnalyzeResponse(
        doc_name=doc_name or "",
        total_risk_score=total_risk_score,
        grade=grade,
        risks=risks,
        model=model_used,
        tokens=tokens,
    )
