#!/usr/bin/env bash
set -euo pipefail

# Run Uvicorn in reload mode for dev inside Codespaces
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
