.PHONY: install dev api web sample screenshot demo

install:
	python3 -m venv api/.venv
	api/.venv/bin/pip install -r api/requirements.txt
	cd web && npm install

dev:
	@trap 'kill %1 %2 2>/dev/null; exit' INT; \
	api/.venv/bin/uvicorn api.main:app --reload --port 8000 & \
	cd web && npm run dev & \
	wait

api:
	api/.venv/bin/uvicorn api.main:app --reload --port 8000

web:
	cd web && npm run dev

sample:
	api/.venv/bin/python scripts/generate_sample.py

demo:
	api/.venv/bin/python scripts/generate_sample.py
	@trap 'kill %1 %2 2>/dev/null; exit' INT; \
	WORKLOG_DB=worklog-sample.db api/.venv/bin/uvicorn api.main:app --reload --port 8099 & \
	VITE_SAMPLE_API_PORT=8099 cd web && npx vite --port 4174 --strictPort & \
	wait

screenshot:
	./scripts/take_screenshot.sh
