import re
import httpx
from app.config import settings

def detect_language_simple(text: str) -> str:
    # ultra-light heuristic (you can swap with a real detector later)
    ascii_ratio = sum(1 for c in text if ord(c) < 128) / max(1, len(text))
    return "en" if ascii_ratio > 0.9 else "unknown"

def find_matches(lines: list[str], patterns: list[re.Pattern], max_hits: int = 5) -> list[str]:
    hits = []
    for i, line in enumerate(lines):
        line_slim = line.strip()
        for p in patterns:
            if p.search(line_slim):
                ctx = line_slim
                # include neighbor lines for minimal context
                if i > 0:
                    ctx = lines[i-1].strip() + " " + ctx
                if i + 1 < len(lines):
                    ctx = ctx + " " + lines[i+1].strip()
                hits.append(ctx[:300])
                break
        if len(hits) >= max_hits:
            break
    return hits

async def fetch_url_text(url: str) -> str:
    timeout = httpx.Timeout(15.0, connect=5.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        r = await client.get(url)
        r.raise_for_status()
        ctype = r.headers.get("content-type", "")
        if "text" in ctype or "json" in ctype or "xml" in ctype:
            return r.text[: settings.max_input_chars]
        return ""
