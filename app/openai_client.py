from typing import Tuple
from app.config import settings

# Lazy import so Codespaces without the package/env still work
_openai = None
_client = None

def _load_openai():
    global _openai, _client
    if _openai is None:
        try:
            from openai import OpenAI
            _openai = OpenAI
        except Exception:
            _openai = False  # library missing
    if _client is None and _openai and settings.openai_api_key:
        _client = _openai(api_key=settings.openai_api_key)

def analyze_text_with_openai(prompt: str) -> Tuple[str, int]:
    """
    Returns (json_text, tokens_used). If no API key or library, returns a safe empty result.
    """
    _load_openai()
    if not (_openai and _client and settings.openai_api_key):
        # Fallback: let the risk engine rely on seed heuristics only
        return '{"risks": [], "detected_language": "en"}', 0

    resp = _client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": "You are a contract risk analyst."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.1,
        max_tokens=1400,
    )
    msg = resp.choices[0].message.content or ""
    tokens = (resp.usage and resp.usage.total_tokens) or 0
    return msg, tokens
