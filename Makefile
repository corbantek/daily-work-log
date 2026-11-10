.PHONY: install dev api web sample screenshot demo install-agent uninstall-agent restart-agent logs open install-skill uninstall-skill agent-smoke install-app

# Ports are deliberately off the common defaults (3000/5173/8000/8080) so this
# app doesn't collide with other dev servers. Override: make dev API_PORT=... WEB_PORT=...
API_PORT ?= 4747
WEB_PORT ?= 4748
export API_PORT WEB_PORT

# Claude Code skills for the /agent API (every folder in agent-skill/: daily-work-log, team-update, strip-slack-policy).
# Installed as symlinks so edits to the repo copy take effect without reinstalling.
SKILLS      = $(notdir $(wildcard agent-skill/*))
SKILLS_DIR  = $(HOME)/.claude/skills

PLIST_NAME  = local.daily-work-log
PLIST_DEST  = $(HOME)/Library/LaunchAgents/$(PLIST_NAME).plist
LOG_DIR     = $(HOME)/Library/Logs/daily-work-log
PROJECT_DIR = $(shell pwd)
NODE_BIN    = $(shell dirname $(shell which node))

PYTHON ?= python3.13

install:
	$(PYTHON) -m venv api/.venv
	api/.venv/bin/pip install -r api/requirements.txt
	cd web && npm install

dev:
	@trap 'kill %1 %2 2>/dev/null; exit' INT; \
	api/.venv/bin/uvicorn api.main:app --reload --port $(API_PORT) & \
	cd web && npm run dev & \
	wait

api:
	api/.venv/bin/uvicorn api.main:app --reload --port $(API_PORT)

web:
	cd web && npm run dev

sample:
	api/.venv/bin/python scripts/generate_sample.py

demo: sample
	@trap 'kill %1 %2 2>/dev/null; exit' INT; \
	WORKLOG_DB=worklog-sample.db api/.venv/bin/uvicorn api.main:app --reload --port 4757 & \
	cd web && API_PORT=4757 WEB_PORT=4758 npm run dev & \
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
		'    <key>API_PORT</key>' \
		'    <string>$(API_PORT)</string>' \
		'    <key>WEB_PORT</key>' \
		'    <string>$(WEB_PORT)</string>' \
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

restart-agent: uninstall-agent install-agent

logs:
	tail -f $(LOG_DIR)/out.log $(LOG_DIR)/err.log

open:
	open http://localhost:$(WEB_PORT)

install-app:
	@echo "Install as a Mac app (Chrome PWA):"
	@echo "  1. make open   (in Chrome)"
	@echo "  2. Chrome menu -> Cast, save and share -> Install page as app"
	@echo "  3. Move 'Daily Work Log' from ~/Applications/Chrome Apps.localized to /Applications / the Dock"
	@echo "  The install is tied to http://localhost:$(WEB_PORT); changing WEB_PORT means reinstalling."

install-skill:
	@mkdir -p $(SKILLS_DIR)
	@for s in $(SKILLS); do \
		dest="$(SKILLS_DIR)/$$s"; \
		if [ -e "$$dest" ] && [ ! -L "$$dest" ]; then \
			echo "✗ $$dest exists and is not a link to this repo; move it away first."; exit 1; fi; \
		ln -sfn "$(CURDIR)/agent-skill/$$s" "$$dest" && echo "✅ Skill linked: $$dest -> $(CURDIR)/agent-skill/$$s"; \
	done
	@if [ "$(API_PORT)" != "4747" ]; then \
		echo "   API_PORT is $(API_PORT): set WORKLOG_API=http://localhost:$(API_PORT) in your shell for the skill."; fi
	@echo "   Start a new Claude Code session (or restart it) to pick the skill up."

uninstall-skill:
	@for s in $(SKILLS); do \
		dest="$(SKILLS_DIR)/$$s"; \
		if [ -L "$$dest" ]; then rm "$$dest" && echo "✅ Skill link removed: $$s"; \
		elif [ -e "$$dest" ]; then echo "✗ $$dest is not a link; not removing it."; exit 1; \
		else echo "Skill not installed: $$s"; fi; \
	done

agent-smoke:
	./scripts/agent_smoke.sh
