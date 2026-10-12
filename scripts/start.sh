#!/bin/bash
set -e
cd "$PROJECT_DIR"
api/.venv/bin/uvicorn api.main:app --port "${API_PORT:-4747}" &
cd web && npm run dev &
wait
