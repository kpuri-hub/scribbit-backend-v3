from __future__ import annotations

import json
import re
from typing import List, Dict, Any, Tuple

from app.models import AnalyzeResponse, RiskItem, RiskType
from app.config import settings
from app.utils import detect_language_simple, find_matches
from app.openai_client import analyze_text_with_openai

# ======================================================================================
# Risk Engine — heuristic + AI blend
# - Six categories required by Scribbit
# - Seed regex patterns (evidence finders)
# - Context/mitigation patterns that down-weight risk
# - Deterministic scoring with tunable weights
# - Optional OpenAI JSON blend (fails soft when no key / network)
# ======================================================================================

CATEGORIES: List[RiskType] = [
    "FX",
    "Auto-Renew",
    "Arbitration",
    "Data-Sharing",
    "Non-Refundable",
    "Unilateral Changes",
]

# ----- Normalization map for AI outputs / loose labels
_NORMALIZE_MAP = {
    "fx": "FX",
    "foreign exchange": "FX",
    "currency conversion": "FX",
    "dcc": "FX",
    "auto-renew": "Auto-Renew",
    "auto renew": "Auto-Renew",
    "automatic renewal": "Auto-Renew",
    "arbitration": "Arbitration",
    "dispute resolution": "Arbitration",
    "data-sharing": "Data-Sharing",
    "data sharing": "Data-Sharing",
    "privacy": "Data-Sharing",
    "non-refundable": "Non-Refundable",
    "non refundable": "Non-Refundable",
    "refund policy": "Non-Refundable",
    "unilateral change": "Unilateral Changes",
    " unilateral changes ": "Unilateral Changes",
    "modify terms": "Unilateral Changes",
}

# ----- Seed / evidence regexes (positive signals)
SEED_PATTERNS: Dict[RiskType, list[re.Pattern]] = {
    "FX": [
        re.compile(r"\bforeign\s+exchange\b", re.I),
        re.compile(r"\bcurrency\s+conversion\b", re.I),
        re.compile(r"\bdynamic\s+currency\s+conversion\b|\bdcc\b", re.I),
        re.compile(r"\b(non[-\s]?local|foreign)\s+currency\b", re.I),
        re.compile(r"\bconversion\s+fee(s)?\b", re.I),
    ],
    "Auto-Renew": [
        re.compile(r"\bauto(\s|-)?renew(al)?\b", re.I),
        re.compile(r"\brenews\s+unless\s+canceled\b", re.I),
        re.compile(r"\brollover\s+term\b", re.I),
        re.compile(r"\b(ever|indefinite) term\b", re.I),
    ],
    "Arbitration": [
        re.compile(r"\bbinding\s+arbitration\b", re.I),
        re.compile(r"\barbitrat(e|ion)\b", re.I),
        re.compile(r"\bclass\s+action\s+waiver\b", re.I),
        re.compile(r"\bvenue\s+shall\s+be\b", re.I),
        re.compile(r"\bdispute\s+resolution\s+by\s+arbitration\b", re.I),
    ],
    "Data-Sharing": [
        re.compile(r"\bshare\s+(your|user)\s+data\b", re.I),
        re.compile(r"\bthird[-\s]?part(y|ies)\s+may\s+collect\b", re.I),
        re.compile(r"\bsell\s+(your|user)\s+data\b", re.I),
        re.compile(r"\banalytics\s+providers|advertising\s+partners\b", re.I),
        re.compile(r"\bdata\s+brokers?\b", re.I),
    ],
    "Non-Refundable": [
        re.compile(r"\bnon[-\s]?refundable\b|\bno\s+refunds\b", re.I),
        re.compile(r"\ball\s+sales\s+final\b", re.I),
        re.compile(r"\bcancellation\s+fee(s)?\b", re.I),
        re.compile(r"\bno\s+right\s+of\s+refund\b", re.I),
    ],
    "Unilateral Changes": [
        re.compile(r"\bwe\s+may\s+modify\s+these\s+terms\s+at\s+any\s+time\b", re.I),
        re.compile(r"\bwithout\s+notice\s+to\s+you\b", re.I),
        re.compile(r"\bat\s+our\s+sole\s+discretion\b", re.I),
        re.compile(r"\breserve\s+the\s+right\s+to\s+change\b", re.I),
    ],
}

# ----- Mitigation / softeners (negative signals)
MITIGATION_PATTERNS: Dict[RiskType, list[re.Pattern]] = {
    "FX": [
        re.compile(r"\bat\s+network\s+rate\b", re.I),
        re.compile(r"\bno\s+mark[-\s]?up\b", re.I),
        re.compile(r"\binforming\s+of\s+fees\s+prior\s+to\s+purchase\b", re.I),
    ],
    "Auto-Renew": [
        re.compile(r"\bcancel\s+anytime\b", re.I),
        re.compile(r"\badvance\s+notice\s+of\s+renewal\b", re.I),
        re.compile(r"\b(opt[-\s]?in|affirmative\s+consent)\b", re.I),
        re.compile(r"\beasy\s+to\s+cancel\b|\b1[-\s]?click\s+cancel\b", re.I),
        re.compile(r"\bpro[-\s]?rated\s+refunds?\b", re.I),
    ],
    "Arbitration": [
        re.compile(r"\bopt[-\s]?out\s+of\s+arbitration\b", re.I),
        re.compile(r"\bsmall\s+claims\s+exception\b", re.I),
        re.compile(r"\bmutual\b\s+arbitration\b", re.I),
        re.compile(r"\bcosts?\s+borne\s+by\s+company\b", re.I),
    ],
    "Data-Sharing": [
        re.compile(r"\bno\s+sale\s+of\s+personal\s+data\b", re.I),
        re.compile(r"\b(opt[-\s]?out|do\s+not\s+sell)\b", re.I),
        re.compile(r"\bdata\s+minimization\b|\bpurpose\s+limitation\b", re.I),
        re.compile(r"\baggregated\b|\banonymi[sz]ed\b", re.I),
    ],
    "Non-Refundable": [
        re.compile(r"\bstatutory\s+rights\s+unaffected\b", re.I),
        re.compile(r"\brefunds?\s+for\s+defective\b", re.I),
        re.compile(r"\b(cooling[-\s]?off|cooling\s+off)\s+period\b", re.I),
        re.compile(r"\bexceptions?\s+apply\b", re.I),
    ],
    "Unilateral Changes": [
        re.compile(r"\badvance\s+notice\s+\(\d+\s*(day|week|month)s?\)\b", re.I),
        re.compile(r"\bmaterial\s+changes\s+only\b", re.I),
        re.compile(r"\bcontinued\s+use\s+constitutes\s+acceptance\b.*\bexcept\s+for\s+material\b", re.I),
        re.compile(r"\buser\s+may\s+terminate\b|\bright\s+to\s+terminate\b", re.I),
    ],
}

# ----- Tunable weights
WEIGHTS = {
    "base": {
        "FX": 18,
        "Auto-Renew": 22,
        "Arbitration": 24,
        "Data-Sharing": 22,
        "Non-Refundable": 18,
        "Unilateral Changes": 22,
    },
    "per_hit": 9,          # add per evidence hit
    "cap_per_type": 95,    # cap per category before mitigation
    "mitigation_step": 7,  # subtract per mitigation hit (diminishing below)
    "mitigation_floor": 10 # don't let mitigation drive score below this if evidence exists
}

def _severity_from_score(score: int) -> str:
    if score >= 80: return "critical"
    if score >= 60: return "high"
    if score >= 35: return "medium"
    return "low"

def _normalize_type(rt: str) -> RiskType:
    key = rt.strip().lower()
    normalized = _NORMALIZE_MAP.get(key)
    if normalized in CATEGORIES:
        return normalized  # type: ignore[return-value]
    # try fuzzy keys
    for k, v in _NORMALIZE_MAP.items():
        if k in key and v in CATEGORIES:
            return v  # type: ignore[return-value]
    # If already a valid category, keep it
    if rt in CATEGORIES:
        return rt  # type: ignore[return-value]
    # default bucket (safest)
    return "Unilateral Changes"

# --------------------------------------------------------------------------------------
# Heuristic pass
# --------------------------------------------------------------------------------------
def _scan_category(text_lines: List[str], patterns: List[re.Pattern], mitigations: List[re.Pattern]) -> Tuple[List[str], List[str], int]:
    """Return (evidence, clauses, raw_hits) for a category."""
    evidence = find_matches(text_lines, patterns, max_hits=8)
    clauses = evidence[:3]
    raw_hits = len(evidence)
    # If no evidence, no clauses/mitigations matter
    if raw_hits == 0:
        return [], [], 0

    # gather mitigation snippets around the same vicinity, but allow global scan too
    mitigation_hits = find_matches(text_lines, mitigations, max_hits=6)
    # NOTE: we don't suppress evidence because mitigations can coexist (e.g., notice is provided
    # but still unilateral change exists). We only reduce score later.
    return evidence, clauses, len(mitigation_hits)

def _seed_scan(text: str) -> Tuple[List[RiskItem], Dict[str, Any]]:
    lines = [ln for ln in re.split(r"\r?\n", text) if ln.strip()]
    all_risks: List[RiskItem] = []
    meta: Dict[str, Any] = {"raw_hits": {}, "mitigations": {}}

    for cat in CATEGORIES:
        evidence, clauses, mitig_count = _scan_category(lines, SEED_PATTERNS[cat], MITIGATION_PATTERNS[cat])
        hits = len(evidence)
        meta["raw_hits"][cat] = hits
        meta["mitigations"][cat] = mitig_count

        if hits == 0:
            continue

        # Base + per hit, cap
        base = WEIGHTS["base"][cat]
        score = min(WEIGHTS["cap_per_type"], base + WEIGHTS["per_hit"] * max(0, hits - 1))

        # Apply mitigation steps with diminishing floor
        if mitig_count > 0:
            score -= WEIGHTS["mitigation_step"] * mitig_count
            score = max(WEIGHTS["mitigation_floor"], score)

        # Confidence grows with hits; mitigations shave a bit
        confidence = min(96, 60 + 7 * hits - 2 * mitig_count)

        all_risks.append(RiskItem(
            risk_type=cat,
            severity=_severity_from_score(score),
            score=int(score),
            confidence=int(max(40, confidence)),
            evidence=evidence[:5],
            clauses=clauses[:5],
            explanation=None
        ))

    return all_risks, meta

# --------------------------------------------------------------------------------------
# OpenAI blend (optional)
# --------------------------------------------------------------------------------------
def _blend_openai(text: str, include_explanation: bool) -> Tuple[List[RiskItem], int, str, str]:
    """
    Ask OpenAI for a compact JSON assessment and blend with seeds.
    If unavailable, returns empty list with zero tokens.
    """
    prompt = f"""
Return compact JSON with this schema (no prose, JSON only):
{{
  "risks": [
    {{
      "risk_type": "FX|Auto-Renew|Arbitration|Data-Sharing|Non-Refundable|Unilateral Changes",
      "severity": "low|medium|high|critical",
      "score": 0-100,
      "confidence": 0-100,
      "evidence": [string],
      "clauses": [string],
      "explanation": {"\"string\"" if include_explanation else "null"}
    }}
  ],
  "detected_language": "en|..."
}}
Text to analyze (truncate if long):
{text[:40000]}
"""

    raw, tokens = analyze_text_with_openai(prompt)
    if not raw.strip():
        return [], 0, "en", settings.openai_model

    # The model might sometimes wrap JSON in code fences or add stray commas.
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        # after stripping backticks, there may be 'json\n' prefix
        cleaned = re.sub(r"^\s*json\s*", "", cleaned, flags=re.I)

    try:
        data = json.loads(cleaned)
    except Exception:
        # Try to salvage: remove trailing commas
        cleaned2 = re.sub(r",\s*([}\]])", r"\1", cleaned)
        try:
            data = json.loads(cleaned2)
        except Exception:
            return [], tokens, "en", settings.openai_model

    out: List[RiskItem] = []
    lang = (data.get("detected_language") or "en") if isinstance(data, dict) else "en"

    for r in (data.get("risks") or []):
        try:
            rtype = _normalize_type(str(r.get("risk_type", "") or ""))
            score = int(max(0, min(100, int(r.get("score", 50)))))
            conf = int(max(0, min(100, int(r.get("confidence", 70)))))
            sev = _severity_from_score(score)
            ev = list(r.get("evidence", []) or [])[:5]
            cl = list(r.get("clauses", []) or [])[:5]
            exp = r.get("explanation") if include_explanation else None

            out.append(RiskItem(
                risk_type=rtype,
                severity=sev,
                score=score,
                confidence=conf,
                evidence=ev,
                clauses=cl,
                explanation=exp
            ))
        except Exception:
            # skip malformed entries
            continue

    return out, tokens, lang, settings.openai_model

# --------------------------------------------------------------------------------------
# Merge + Totals
# --------------------------------------------------------------------------------------
def _merge_seed_and_ai(seed: List[RiskItem], ai: List[RiskItem], include_explanation: bool) -> List[RiskItem]:
    by_type_seed = {r.risk_type: r for r in seed}
    # Normalize AI types and coalesce duplicates by keeping the highest scoring one
    tmp_ai: Dict[RiskType, RiskItem] = {}
    for r in ai:
        key = _normalize_type(r.risk_type)
        exists = tmp_ai.get(key)
        if not exists or r.score > exists.score:
            tmp_ai[key] = RiskItem(
                risk_type=key,
                severity=r.severity,
                score=r.score,
                confidence=r.confidence,
                evidence=r.evidence,
                clauses=r.clauses,
                explanation=r.explanation if include_explanation else None
            )

    merged: List[RiskItem] = []
    for cat in CATEGORIES:
        s = by_type_seed.get(cat)
        a = tmp_ai.get(cat)

        if not s and not a:
            continue

        if s and a:
            pick = a if a.score >= s.score else s
            other = s if pick is a else a
            # Merge evidence/clauses (uniq preserve order)
            ev = pick.evidence + [x for x in other.evidence if x not in pick.evidence]
            cl = pick.clauses + [x for x in other.clauses if x not in pick.clauses]
            score = max(s.score, a.score)
            conf = min(97, max(s.confidence, a.confidence) + (3 if a.score > s.score else 0))
            merged.append(RiskItem(
                risk_type=cat,
                severity=_severity_from_score(score),
                score=score,
                confidence=conf,
                evidence=ev[:5],
                clauses=cl[:5],
                explanation=a.explanation if include_explanation else None
            ))
        else:
            r = (a or s)
            merged.append(RiskItem(
                risk_type=cat,
                severity=_severity_from_score(r.score),
                score=r.score,
                confidence=r.confidence,
                evidence=r.evidence[:5],
                clauses=r.clauses[:5],
                explanation=r.explanation if include_explanation else None
            ))

    return merged

def _total_risk(risks: List[RiskItem]) -> int:
    if not risks:
        return 0
    # Weighted mean with mild penalty for breadth of risks present.
    # Rationale: many mediums can imply systemic risk vs a single high.
    avg = sum(r.score for r in risks) / len(risks)
    penalty = min(10, 1.5 * max(0, len(risks) - 2))  # more categories -> higher penalty
    return int(min(100, round(avg + penalty)))

# --------------------------------------------------------------------------------------
# Public entry
# --------------------------------------------------------------------------------------
def analyze_terms(text: str, doc_name: str | None, include_explanation: bool) -> AnalyzeResponse:
    detected_lang = detect_language_simple(text)

    # Seed pass
    seed_risks, meta = _seed_scan(text)

    # OpenAI pass (optional, safe to fail)
    ai_risks, tokens_used, lang_ai, model = _blend_openai(text, include_explanation)
    if lang_ai and lang_ai != "en":
        detected_lang = lang_ai

    # Merge views
    final_risks = _merge_seed_and_ai(seed_risks, ai_risks, include_explanation)
    total = _total_risk(final_risks)

    # Finalize
    return AnalyzeResponse(
        doc_name=doc_name,
        total_risk_score=total,
        risks=final_risks,
        detected_language=detected_lang,
        tokens_used=tokens_used,
        model=model if settings.openai_api_key else "seed-heuristics"
    )
