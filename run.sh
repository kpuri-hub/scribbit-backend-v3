# show what's currently in run.sh (you'll see JSON)
nl -ba run.sh

# replace it with the correct bash script
cat > run.sh <<'EOF'
#!/usr/bin/env bash
#
# Scribbit Backend Runner

set -euo pipefail

# Ensure we're in the repo root
cd "$(dirname "$0")"

# Create venv if missing
if [ ! -d ".venv" ]; then
  echo "[setup] Creating virtual environment..."
  python3 -m venv .venv
fi

echo "[info] Activating virtual environment..."
source .venv/bin/activate

# Install dependencies if uvicorn not present
if ! command -v uvicorn >/dev/null 2>&1; then
  echo "[setup] Installing dependencies..."
  pip install -r requirements.txt
fi

echo "[run] Starting Scribbit backend on http://0.0.0.0:8000 ..."
PYTHONPATH=. uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
EOF

# ensure Unix line endings (just in case)
sed -i 's/\r$//' run.sh

# make it executable
chmod +x run.sh
