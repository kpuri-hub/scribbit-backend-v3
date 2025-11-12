from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Scribbit Backend", version="0.1.0")

# CORS (tighten allow_origins later)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class AnalyzeRequest(BaseModel):
    text: str

@app.get("/")
async def root():
    return {"ok": True, "service": "scribbit", "version": "0.1.0"}

@app.get("/health")
async def health():
    return {"status": "healthy"}

@app.get("/version")
async def version():
    return {"version": "0.1.0"}

MAX_LEN = 100_000
@app.post("/analyze")
async def analyze(req: AnalyzeRequest):
    if len(req.text) > MAX_LEN:
        raise HTTPException(status_code=413, detail="Text too large")
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
