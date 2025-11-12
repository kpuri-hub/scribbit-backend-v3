from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, PlainTextResponse

from app.routes.version import router as version_router
from app.routes.health import router as health_router
from app.routes.analyze import router as analyze_router
from app.routes.scorecard import router as scorecard_router

app = FastAPI(
    title="Scribbit Backend API",
    description="Backend for Scribbit Fairness Risk Analyzer",
    version="0.1.0"
)

# -----------------------------------------------------------------------------
# Middleware
# -----------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # You can restrict this later (e.g., your frontend domain)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------------------------------------------------------------
# Routers
# -----------------------------------------------------------------------------
app.include_router(version_router)
app.include_router(health_router)
app.include_router(analyze_router)
app.include_router(scorecard_router)

# -----------------------------------------------------------------------------
# Base routes
# -----------------------------------------------------------------------------
@app.get("/", tags=["root"])
def root():
    """Root endpoint — simple smoke test."""
    return {"message": "Scribbit backend is running.", "ok": True}


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    """Avoids 404 spam for favicon requests."""
    return Response(status_code=204)

# -----------------------------------------------------------------------------
# Exception handling (optional quality-of-life)
# -----------------------------------------------------------------------------
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={
            "error": str(exc),
            "message": "Internal server error. Please check logs."
        },
    )

# -----------------------------------------------------------------------------
# Run message for uvicorn
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
