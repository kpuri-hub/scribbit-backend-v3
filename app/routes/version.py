from fastapi import APIRouter
import os
from datetime import datetime

router = APIRouter(tags=["meta"])

def _get_env(name: str, default: str = "") -> str:
    val = os.getenv(name)
    return val if val is not None else default

@router.get("/version")
def version():
    """
    Returns build/version info to confirm what's running.
    """
    return {
        "name": "scribbit-backend",
        "version": _get_env("APP_VERSION", "0.1.0"),
        "build_sha": _get_env("GIT_SHA", ""),
        "environment": _get_env("APP_ENV", "dev"),
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }
