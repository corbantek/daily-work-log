.PHONY: install dev api web sample screenshot demo install-agent uninstall-agent logs open

PLIST_NAME  = local.daily-work-log
PLIST_DEST  = $(HOME)/Library/LaunchAgents/$(PLIST_NAME).plist
LOG_DIR     = $(HOME)/Library/Logs/daily-work-log
PROJECT_DIR = $(shell pwd)
NODE_BIN    = $(shell dirname $(shell which node))

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

demo: sample
	@trap 'kill %1 %2 2>/dev/null; exit' INT; \
	WORKLOG_DB=worklog-sample.db api/.venv/bin/uvicorn api.main:app --reload --port 8099 & \
	cd web && VITE_SAMPLE_API_PORT=8099 npx vite --port 4174 --strictPort & \
	wait

screenshot:
	./scripts/take_screenshot.sh

install-agent:
	mkdir -p $(LOG_DIR)
	@printf '%s\n' \
		'<?xml version="1.0" encoding="UTF-8"?>' \
		'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' \
		'<plist version="1.0">' \
		'<dict>' \
		'  <key>Label</key>' \
		'  <string>$(PLIST_NAME)</string>' \
		'  <key>EnvironmentVariables</key>' \
		'  <dict>' \
		'    <key>PROJECT_DIR</key>' \
		'    <string>$(PROJECT_DIR)</string>' \
		'    <key>PATH</key>' \
		'    <string>$(NODE_BIN):/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>' \
		'  </dict>' \
		'  <key>ProgramArguments</key>' \
		'  <array>' \
		'    <string>/bin/bash</string>' \
		'    <string>$(PROJECT_DIR)/scripts/start.sh</string>' \
		'  </array>' \
		'  <key>RunAtLoad</key>' \
		'  <true/>' \
		'  <key>KeepAlive</key>' \
		'  <true/>' \
		'  <key>StandardOutPath</key>' \
		'  <string>$(LOG_DIR)/out.log</string>' \
		'  <key>StandardErrorPath</key>' \
		'  <string>$(LOG_DIR)/err.log</string>' \
		'</dict>' \
		'</plist>' \
		> $(PLIST_DEST)
	launchctl load $(PLIST_DEST)
	@echo "✅ Agent installed and started. Run 'make open' to open the app."

uninstall-agent:
	-launchctl unload $(PLIST_DEST)
	rm -f $(PLIST_DEST)
	@echo "✅ Agent uninstalled."

logs:
	tail -f $(LOG_DIR)/out.log $(LOG_DIR)/err.log

open:
	open http://localhost:5173
