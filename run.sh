{
  "name": "scribbit-backend",
  "image": "mcr.microsoft.com/devcontainers/python:3.11-bookworm",
  "forwardPorts": [8000],
  "portsAttributes": {
    "8000": { "label": "Scribbit API", "onAutoForward": "openBrowser" }
  },
  "postCreateCommand": "python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt",
  "runArgs": ["--init"],
  "overrideCommand": false,
  "postStartCommand": ". .venv/bin/activate && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
}
