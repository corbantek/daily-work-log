#!/usr/bin/env bash
# Take a screenshot of the app using the sample database.
# Usage: ./scripts/take_screenshot.sh
#
# Starts a temporary API server on :4757 with sample data,
# a Vite dev server on :4758 proxied to it, then uses Puppeteer
# to interact with the page (expand tasks, open editor) before capturing.
# Does NOT touch your real worklog.db.

set -euo pipefail
cd "$(dirname "$0")/.."

API_PORT=4757
WEB_PORT=4758

cleanup() {
    kill $API_PID $VITE_PID 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Regenerate sample data
echo "📦 Generating sample database..."
./api/.venv/bin/python scripts/generate_sample.py

# Start API with sample DB on a non-conflicting port
echo "🚀 Starting sample API on :${API_PORT}..."
WORKLOG_DB=worklog-sample.db ./api/.venv/bin/uvicorn api.main:app --port "$API_PORT" --log-level warning &
API_PID=$!

# Wait for API
for _ in $(seq 1 30); do
    curl -sf "http://localhost:${API_PORT}/day/$(date +%Y-%m-%d)" > /dev/null 2>&1 && break
    sleep 0.3
done

# Start Vite dev server proxied to sample API on a separate port
echo "🌐 Starting frontend on :${WEB_PORT}..."
cd web
API_PORT=$API_PORT WEB_PORT=$WEB_PORT npm run dev &
VITE_PID=$!
cd ..

# Wait for Vite
for _ in $(seq 1 30); do
    curl -sf "http://localhost:${WEB_PORT}" > /dev/null 2>&1 && break
    sleep 0.5
done
sleep 2  # let React render

# Capture with Puppeteer (interactive — expands tasks, opens editor)
echo "📸 Capturing screenshot..."
mkdir -p docs
SCREENSHOT_URL="http://localhost:${WEB_PORT}" SCREENSHOT_OUTPUT="docs/screenshot.png" \
    node scripts/take_screenshot.mjs
