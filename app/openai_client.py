from typing import Tuple
from app.config import settings

_openai = None
_client = None

def _load_openai():
    global _openai, _client
    if _openai is None:
        try:
            from openai import OpenAI
            _openai = OpenAI
        except Exception:
            _openai = False
    if _client is None and _openai and settings.openai_api_key:
        _client = _openai(api_key=settings.openai_api_key)

def analyze_text_with_openai(prompt: str) -> Tuple[str, int]:
    _load_openai()
    if not (_openai and _client and settings.openai_api_key):
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
