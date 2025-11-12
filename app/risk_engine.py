from __future__ import annotations

from typing import List, Dict, Any, Optional
import re
import logging
from app.schemas import AnalyzeResponse, RiskItem

log = logging.getLogger("analyze")

# Simple keyword patterns for the seed heuristic engine
PATTERNS: Dict[str, Dict[str, Any]] = {
    "Non-Refundable": {
        "regex": re.compile(r"\b(non[-\s]?refundable|all sales are final|no refunds?)\b", re.I),
        "severity": "High",
        "score": 9,
        "rationale": "Text indicates payments are non-refundable or all sales are final.",
    },
    "Auto-Renewal": {
        "regex": re.compile(r"\b(auto[-\s]?renew(al)?|renews? automatically|rollover)\b", re.I),
        "severity": "Medium",
        "score": 6,
        "rationale": "Contract renews automatically unless cancelled.",
    },
    "Arbitration": {
        "regex": re.compile(r"\barbitration|binding arbitration|waiver of jury trial\b", re.I),
        "severity": "Medium",
        "score": 5,
        "rationale": "Disputes may be forced into arbitration; rights may be limited.",
    },
    "Unilateral Changes": {
        "regex": re.compile(r"\bwe may (change|modify|update) (these )?(terms|fees|prices)\b", re.I),
        "severity": "High",
        "score": 8,
        "rationale": "One party can change terms/fees unilaterally.",
    },
    "Data Sharing": {
        "regex": re.compile(r"\bshare (your )?(data|information)|third[-\s]?part(y|ies)\b", re.I),
        "severity": "Medium",
        "score": 5,
        "rationale": "Mentions data sharing with third parties.",
    },
    "Foreign Exchange / Fees": {
        "regex": re.compile(r"\b(foreign exchange|fx|currency conversion|conversion fee|cross[-\s]?border fee)\b", re.I),
        "severity": "Medium",
        "score": 5,
        "rationale": "Mentions currency conversion or FX fees.",
    },
}


def _run_seed_heuristics(text: str) -> List[RiskItem]:
    risks: List[RiskItem] = []
    for risk_type, cfg in PATTERNS.items():
        hits = list(cfg["regex"].finditer(text))
        for m in hits:
            snippet = text[max(m.start() - 80, 0): m.end() + 80]
            risks.append(
                RiskItem(
                    type=risk_type,
                    severity=cfg["severity"],
                    score=int(cfg["score"]),
                    snippet=snippet.strip(),
                    rationale=cfg["rationale"],
                )
            )
    return risks


def _summarize(risks: List[RiskItem]) -> Dict[str, Any]:
    by_type: Dict[str, int] = {}
    total_score = 0
    for r in risks:
        by_type[r.type] = by_type.get(r.type, 0) + 1
        total_score += r.score
    return {
        "by_type": by_type,
        "total_score": total_score,
        "risk_level": (
            "High" if total_score >= 15
            else "Medium" if total_score >= 7
            else "Low"
        ),
    }


def analyze_terms(text: str, model_hint: Optional[str] = None) -> AnalyzeResponse:
    """
    Option B:
    - Accept an optional model_hint
    - Default to 'seed-heuristics'
    - Stub for future GPT path
    """
    engine = (model_hint or "seed-heuristics").strip().lower()

    if engine in ("seed-heuristics", "heuristics", "local"):
        risks = _run_seed_heuristics(text)
        summary = _summarize(risks)
        model_used = "seed-heuristics"
    elif engine in ("gpt-4o-mini", "openai", "gpt"):
        # Stub: fill in later with OpenAI call
        raise NotImplementedError("OpenAI model integration not yet enabled.")
    else:
        # Unknown hint -> fall back to heuristics
        risks = _run_seed_heuristics(text)
        summary = _summarize(risks)
        model_used = f"seed-heuristics (fallback from '{engine}')"

    return AnalyzeResponse(
        doc_name="",
        model_used=model_used,
        total_risks=len(risks),
        risks=risks,
        summary=summary,
    )
