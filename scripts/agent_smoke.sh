#!/usr/bin/env bash
# Smoke test for the /agent API, using the same curl recipes as agent-skill/daily-work-log/SKILL.md.
# Starts a throwaway API on its own port with an empty temporary database (never your worklog.db).
# Usage: make agent-smoke    (needs jq)
set -u
cd "$(dirname "$0")/.."

PORT="${SMOKE_PORT:-4796}"
TMP="$(mktemp -d)"
export WORKLOG_DB="$TMP/smoke.db" WORKLOG_FILES="$TMP/files" WORKLOG_NOTE_SNAPSHOTS="$TMP/note-snapshots"
api/.venv/bin/uvicorn api.main:app --port "$PORT" --log-level warning > "$TMP/api.log" 2>&1 < /dev/null &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; wait $SERVER 2>/dev/null; rm -rf "$TMP"' EXIT

API="http://localhost:$PORT"
for _ in $(seq 1 50); do curl -sf "$API/health" > /dev/null && break; sleep 0.2; done

pass=0; fail=0
ok() { if [ "$1" = "true" ]; then echo "PASS  $2"; pass=$((pass+1)); else echo "FAIL  $2  -> ${3:-}"; fail=$((fail+1)); fi; }
TODAY=$(date +%Y-%m-%d)

curl -sf "$API/health" > /dev/null; ok "$([ $? -eq 0 ] && echo true || echo false)" "health check"
curl -s -X POST "$API/workstreams" -H 'Content-Type: application/json' -d '{"name": "DevOps Improvements"}' > /dev/null

H=$(curl -s "$API/agent/help"); ok "$(echo "$H" | jq 'has("read") and has("write")')" "help lists read + write"

# ── writes (the SKILL.md examples) ──
C=$(curl -s -X POST "$API/agent/tasks" -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"action": "Review the team's CI changes", "workstream": "DevOps", "state": "in_progress", "labels": [], "high_impact": false}
JSON
); TASK_ID=$(echo "$C" | jq -r .ref)
ok "$(echo "$C" | jq '.action == "Review the team'"'"'s CI changes" and .workstream == "DevOps Improvements" and .state == "in_progress" and .ref == "T1"')" "create task (partial workstream name, apostrophe kept, ref T1)" "$C"
T=$(curl -s "$API/agent/tasks?state=in_progress&workstream=devops"); ok "$(echo "$T" | jq '.count == 1 and (.tasks|all(.state=="in_progress"))')" "tasks by state + workstream name" "$T"
CN=$(curl -s -X POST "$API/agent/tasks" -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"action": "Investigate duplicate acks", "notes": "**Context**\nSeen in a PR run.\n\n**What's Next**\n- TODO: pull the pod logs\n\n**Status:** just started."}
JSON
); ok "$(echo "$CN" | jq '(.notes | startswith("**Context**")) and (.notes | endswith("**Status:** just started."))')" "create a task with structured notes in one call" "$CN"
P=$(curl -s -X PATCH "$API/agent/tasks/$TASK_ID" -H 'Content-Type: application/json' -d '{"state": "complete"}'); ok "$(echo "$P" | jq '.state == "complete"')" "update task state" "$P"
N=$(curl -s -X POST "$API/agent/tasks/$TASK_ID/notes" -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"text": "- Found the root cause: the retry loop didn't back off.\n- TODO: add a backoff test"}
JSON
); ok "$(echo "$N" | jq '(.notes | contains("didn'"'"'t back off")) and (.notes | contains("TODO: add a backoff test"))')" "append task notes (with a TODO line)" "$N"
ok "$(echo "$N" | jq '.notes_backup == null')" "nothing to back up when the note was empty" "$(echo "$N" | jq -c .notes_backup)"
R=$(curl -s -X POST "$API/agent/tasks/$TASK_ID/notes" -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"text": "- Found the root cause: the retry loop didn't back off.\n- DONE: add a backoff test", "mode": "replace"}
JSON
); BACKUP=$(echo "$R" | jq -r .notes_backup)
ok "$(echo "$R" | jq '(.notes | contains("DONE: add a backoff test")) and (.notes | contains("TODO") | not) and (.notes_backup | startswith("T1--"))')" "rewrite (replace) marks the TODO done and saves a backup first" "$R"
BL=$(curl -s "$API/agent/notes-backups/$TASK_ID"); ok "$(echo "$BL" | jq --arg b "$BACKUP" '.backups[0].name == $b')" "list note backups" "$BL"
BR=$(curl -s "$API/agent/notes-backups/$TASK_ID/$BACKUP"); ok "$(echo "$BR" | jq '.notes | contains("TODO: add a backoff test")')" "read a note backup (the version before the rewrite)" "$BR"
L=$(curl -s -X POST "$API/agent/tasks/$TASK_ID/links" -H 'Content-Type: application/json' \
  -d '{"url": "https://github.com/org/repo/pull/123", "label": "Retry fix PR"}'); ok "$(echo "$L" | jq '.links[0].type == "pr"')" "add link (type guessed from the URL)" "$L"
G=$(curl -s "$API/agent/tasks/$TASK_ID"); ok "$(echo "$G" | jq '(.links|length) == 1 and (.notes|length) > 0')" "task detail"

CM=$(curl -s -X POST "$API/agent/meetings" -H 'Content-Type: application/json' \
  -d '{"title": "Platform sync", "start_time": "14:00", "duration_minutes": 30}'); MEETING_ID=$(echo "$CM" | jq -r .ref)
ok "$(echo "$CM" | jq --arg t "$TODAY" '.date == $t and .start_time == "14:00" and .ref == "M1"')" "create meeting (defaults to today, ref M1)" "$CM"
PM=$(curl -s -X PATCH "$API/agent/meetings/$MEETING_ID" -H 'Content-Type: application/json' -d '{"exclude_from_stats": true}')
ok "$(echo "$PM" | jq '.excluded_from_stats == true')" "exclude meeting from stats" "$PM"
PP=$(curl -s -X PATCH "$API/agent/meetings/$MEETING_ID" -H 'Content-Type: application/json' -d '{"passive": true}')
ok "$(echo "$PP" | jq '.passive == true and .excluded_from_stats == true')" "mark meeting passive" "$PP"
ML0=$(curl -s -X POST "$API/agent/meetings/$MEETING_ID/links" -H 'Content-Type: application/json' \
  -d '{"url": "https://docs.example.com/agenda", "label": "Agenda"}')
ok "$(echo "$ML0" | jq '.links == [{"url": "https://docs.example.com/agenda", "label": "Agenda", "type": "doc"}]')" "add a link to a meeting (type guessed)" "$ML0"
MN=$(curl -s -X POST "$API/agent/meetings/$MEETING_ID/notes" -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"text": "## Summary\nWe agreed on the rollout."}
JSON
); ok "$(echo "$MN" | jq '.notes | startswith("## Summary\nWe agreed")')" "append meeting notes (newline kept)" "$MN"
MT=$(curl -s -X POST "$API/agent/meetings/$MEETING_ID/tasks" -H 'Content-Type: application/json' \
  -d '{"action": "Share bottleneck numbers", "workstream": "DevOps"}')
ok "$(echo "$MT" | jq '.tasks|map(.action)|index("Share bottleneck numbers") != null')" "create task from meeting" "$MT"
ML=$(curl -s -X POST "$API/agent/meetings/$MEETING_ID/tasks" -H 'Content-Type: application/json' -d "{\"task_id\": \"$TASK_ID\"}")
ok "$(echo "$ML" | jq '.tasks|length == 2')" "link existing task to meeting" "$ML"

# ── files ──
printf '# Runbook\n- step one\n' > "$TMP/runbook.md"
printf '%%PDF-1.4 fake\n' > "$TMP/deck.pdf"
F=$(curl -s -X POST "$API/agent/tasks/$TASK_ID/files" -F "file=@$TMP/runbook.md")
ok "$(echo "$F" | jq '(.files|map(.filename)|index("runbook.md")) != null')" "attach a file to a task (curl -F)" "$F"
FM=$(curl -s -X POST "$API/agent/meetings/$MEETING_ID/files" -F "file=@$TMP/deck.pdf")
ok "$(echo "$FM" | jq '(.files|map(.filename)|index("deck.pdf")) != null')" "attach a file to a meeting" "$FM"
FL=$(curl -s "$API/agent/tasks/$TASK_ID/files"); FILE_ID=$(echo "$FL" | jq -r '.files[0].id')
ok "$(echo "$FL" | jq '.files[0].kind == "markdown"')" "list a task's files" "$FL"
FC=$(curl -s "$API/agent/files/$FILE_ID"); ok "$(echo "$FC" | jq '.content == "# Runbook\n- step one\n" and .attached_to.ref == "T1"')" "read a text file's contents" "$FC"
PDF_ID=$(curl -s "$API/agent/meetings/$MEETING_ID/files" | jq -r '.files[0].id')
FP=$(curl -s "$API/agent/files/$PDF_ID"); FPATH=$(echo "$FP" | jq -r .path)
ok "$( [ "$(echo "$FP" | jq -r .content)" = "null" ] && [ -f "$FPATH" ] && echo true || echo false )" "a PDF gives a readable local path instead of contents" "$FP"

# ── reads ──
D=$(curl -s "$API/agent/day"); ok "$(echo "$D" | jq --arg t "$TODAY" '.date == $t and (.meetings|length) == 1')" "day (today)" "$D"
D2=$(curl -s "$API/agent/day?date=$TODAY"); ok "$(echo "$D2" | jq --arg t "$TODAY" '.date == $t')" "day?date= (query date parsed)" "$D2"
O=$(curl -s "$API/agent/open"); ok "$(echo "$O" | jq '.count == 2')" "open (the two todo tasks)" "$O"
T2=$(curl -s "$API/agent/tasks?q=retry&date_from=$TODAY&date_to=$TODAY"); ok "$(echo "$T2" | jq '.count == 1')" "tasks by text + date range" "$T2"
M=$(curl -s "$API/agent/meetings"); ok "$(echo "$M" | jq '.count == 1')" "today's meetings" "$M"
M2=$(curl -s "$API/agent/meetings?date_from=$TODAY&date_to=$TODAY&q=sync"); ok "$(echo "$M2" | jq '.count == 1')" "meetings by range + text" "$M2"
GM=$(curl -s "$API/agent/meetings/$MEETING_ID"); ok "$(echo "$GM" | jq '(.tasks|length) == 2 and (.notes|length) > 0')" "meeting detail"
S=$(curl -s "$API/agent/search?q=bottleneck"); ok "$(echo "$S" | jq 'length >= 1')" "search" "$S"
SR=$(curl -s "$API/agent/search?q=T1"); ok "$(echo "$SR" | jq '.[0].type == "task" and .[0].number == 1')" "search by reference (T1)" "$SR"
SU=$(curl -s "$API/agent/summary"); ok "$(echo "$SU" | jq '.tasks.completed == 1 and .meetings.excluded_from_stats == 1')" "summary (this week so far)" "$SU"

# ── the guard rails the skill relies on ──
E=$(curl -s -w '\n%{http_code}' -X POST "$API/agent/tasks" -H 'Content-Type: application/json' -d '{"action": "x", "workstream": "Nope"}')
ok "$( [ "$(echo "$E" | tail -1)" = "400" ] && echo "$E" | head -1 | jq '.detail.valid == ["DevOps Improvements"]' || echo false )" "unknown workstream -> 400 with the valid names" "$E"
E2=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/agent/tasks/$TASK_ID"); ok "$( [ "$E2" = "405" ] && echo true || echo false )" "no deletes (DELETE -> 405)" "$E2"
A=$(curl -s "$API/agent/activity"); ok "$(echo "$A" | jq 'length == 15 and (map(.action) | index("attach_task_file")) != null')" "activity log records every change" "$(echo "$A" | jq -c '[.[]|.action]')"

echo; echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
