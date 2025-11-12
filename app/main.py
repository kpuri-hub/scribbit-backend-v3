from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Scribbit Backend", version="0.1.0")


class AnalyzeRequest(BaseModel):
    text: str


@app.get("/")
async def root():
    return {"ok": True, "service": "scribbit", "version": "0.1.0"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.post("/analyze")
async def analyze(req: AnalyzeRequest):
    # Placeholder for future OpenAI / rules engine logic
    # For now, just echo back a simple shape that your frontend can rely on.
    return {
        "risks": [
            {"type": "FX", "score": 0, "notes": "stub"},
            {"type": "Auto-Renew", "score": 0, "notes": "stub"},
            {"type": "Arbitration", "score": 0, "notes": "stub"},
            {"type": "Data-Sharing", "score": 0, "notes": "stub"},
            {"type": "Non-Refundable", "score": 0, "notes": "stub"},
            {"type": "Unilateral Changes", "score": 0, "notes": "stub"}
        ],
        "input_preview": req.text[:240]
    }
