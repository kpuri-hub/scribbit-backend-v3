from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from app.health import router as health_router
from app.analyze import router as analyze_router
from app.scorecard import router as scorecard_router
from app.version import router as version_router

# ------------------------------------------------------------------------------
# App metadata
# ------------------------------------------------------------------------------

APP_NAME = "Scribbit Backend"
APP_VERSION = "0.1.0"
APP_DESCRIPTION = "Analyze T&Cs for consumer-risk signals and build risk scorecards."

logger = logging.getLogger("scribbit")
logging.basicConfig(level=logging.INFO)


# ------------------------------------------------------------------------------
# FastAPI app
# ------------------------------------------------------------------------------

app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description=APP_DESCRIPTION,
)

# CORS – keep permissive for now; tighten before going public
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------------------
# Root & favicon
# ------------------------------------------------------------------------------

@app.get("/")
def root():
    """
    Simple root endpoint that reports basic info and available top-level routes.
    """
    return {
        "name": APP_NAME,
        "version": APP_VERSION,
        "routes": [
            "/health",
            "/analyze",
            "/scorecard/pdf",
            "/version",
        ],
    }


@app.get("/favicon.ico")
def favicon():
    """
    We are not serving a real favicon yet; return 204 so browsers stop nagging.
    """
    return Response(status_code=204)


# ------------------------------------------------------------------------------
# Routers
# ------------------------------------------------------------------------------

app.include_router(health_router)
app.include_router(analyze_router)
app.include_router(scorecard_router)
app.include_router(version_router)
