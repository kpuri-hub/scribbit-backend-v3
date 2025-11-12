from fastapi import APIRouter
import datetime as dt

router = APIRouter(tags=["health"])

@router.get("/health")
def health():
    return {
        "ok": True,
        "status": "healthy",
        "timestamp": dt.datetime.utcnow().isoformat() + "Z"
    }
