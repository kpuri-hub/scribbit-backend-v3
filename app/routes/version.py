from fastapi import APIRouter
from datetime import datetime

router = APIRouter(tags=["version"])

@router.get("/version")
def get_version():
    """
    Returns basic build/version info.
    """
    return {
        "name": "scribbit-backend",
        "version": "0.1.0",
        "environment": "codespaces",
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }
