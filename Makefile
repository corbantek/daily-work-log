.PHONY: install dev api web

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
