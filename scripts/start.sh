#!/bin/bash
set -e
cd "$PROJECT_DIR"
api/.venv/bin/uvicorn api.main:app --port 8000 &
cd web && npm run dev &
wait
