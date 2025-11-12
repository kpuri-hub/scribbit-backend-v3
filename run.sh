#!/usr/bin/env bash
#
# Scribbit Backend Runner
# -----------------------

set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  echo "[setup] Creating virtual environment..."
  python3 -m venv .venv
fi

echo "[info] Activating virtual environment..."
source .venv/bin/activate

if ! command -v uvicorn >/dev/null 2>&1; then
  echo "[setup] Installing dependencies..."
  pip install -r requirements.txt
fi

echo "[run] Starting Scribbit backend on http://0.0.0.0:8000 ..."
PYTHONPATH=. uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
