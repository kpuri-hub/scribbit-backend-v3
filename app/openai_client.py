from typing import Tuple
from app.config import settings

_openai_cls = None
_client = None

def _load_openai():
    global _openai_cls, _client
    if _openai_cls is None:
        try:
            from openai import OpenAI
            _openai_cls = OpenAI
        except Exception:
            _openai_cls = False
    if _client is None and _openai_cls and settings.openai_api_key:
        _client = _openai_cls(api_key=settings.openai_api_key)

def analyze_text_with_openai(prompt: str) -> Tuple[str, int]:
    """
    Returns (json_text, tokens_used). If no API key or library, returns a safe empty result.
    The JSON text is expected to include a 'risks' array and 'detected_language'.
    """
    _load_openai()
    if not (_openai_cls and _client and settings.openai_api_key):
        return '{"risks": [], "detected_language": "en"}', 0

    resp = _client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": "You are a contract risk analyst. Reply ONLY with compact JSON."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.1,
        max_tokens=1400,
    )
    msg = resp.choices[0].message.content or ""
    tokens = (resp.usage and resp.usage.total_tokens) or 0
    return msg, tokens
