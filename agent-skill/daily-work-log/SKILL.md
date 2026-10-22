---
name: daily-work-log
description: Read and update the user's local Daily Work Log app (their record of tasks, meetings and workstreams) through its /agent HTTP API on localhost. Use when the user asks what is on their plate or on today, what they did this week or in a period, to log, find or update a task, to mark a task done, to add notes or a link to a task or meeting, to record a meeting or paste meeting notes, to create a task from a meeting, or to draft a standup or status update from their work log.
allowed-tools: Bash(curl *)
---

# Daily Work Log

The user's Daily Work Log is a personal app running on this machine. Talk to it only through its
`/agent` endpoints with `curl`. They take and return JSON, accept names instead of ids, and record
every change you make.

## Connect

```bash
API="${WORKLOG_API:-http://localhost:4747}"
curl -sf "$API/health"
```

If the health check fails, stop and tell the user the app isn't running (they start it with
`make dev`, or `make restart-agent` for the background service). Don't retry in a loop.

When you are unsure about an endpoint or its fields, ask the app instead of guessing:

```bash
curl -s "$API/agent/help"
```

## Rules

- **Dates** are local `YYYY-MM-DD` and default to today. Work out "yesterday", "Monday" and
  "last week" from today's date yourself. Times are 24-hour `HH:MM`.
- **Workstreams and labels by name.** A unique partial name works ("devops"). An unknown or
  ambiguous name returns `400` with the valid options: pick the intended one, or ask the user if
  it isn't clear. Never invent a workstream. The names in the examples below are only examples —
  use the user's own, from `/agent/day`, `/agent/open` or that error.
- **Task states:** `todo`, `in_progress`, `complete`, `abandoned` ("done" also works).
- **Notes are appended by default.** Only send `"mode": "replace"` when the user explicitly asked to
  replace or rewrite the notes.
- **Find before you change.** Look up the task or meeting (day view, search or list) to get its
  `id`; if several match, ask which one. Confirm with the user before making more than three changes
  at once.
- **There are no deletes.** If the user wants something removed, tell them to do it in the app.
- **After a change,** tell the user briefly what changed, in their words, not ids.
  `GET /agent/activity` lists everything changed through this API.
- Send JSON bodies with a quoted heredoc so apostrophes and newlines in notes survive:
  `curl -s -X POST "$API/…" -H 'Content-Type: application/json' --data-binary @- <<'JSON'` … `JSON`.

## Look things up

```bash
curl -s "$API/agent/day"                          # today: status, on-call, meetings, tasks by workstream
curl -s "$API/agent/day?date=2026-10-21"          # another day
curl -s "$API/agent/open"                         # everything still todo / in progress
curl -s "$API/agent/tasks?state=in_progress&workstream=devops"
curl -s "$API/agent/tasks?q=retries&date_from=2026-10-01&date_to=2026-10-31"
curl -s "$API/agent/tasks/TASK_ID"                # full task: notes, links, files, meetings, sub-tasks
curl -s "$API/agent/meetings"                     # today's meetings
curl -s "$API/agent/meetings?date_from=2026-10-19&date_to=2026-10-25&q=sync"
curl -s "$API/agent/meetings/MEETING_ID"          # full meeting: notes, tasks, links, files
curl -s "$API/agent/search?q=dynamodb"            # tasks, meetings, people, interactions
curl -s "$API/agent/summary"                      # this week so far; or ?date_from=&date_to=
```

Lists show a short `notes_preview`; fetch the single task or meeting when you need the full notes.

## Change things

Create a task (only `action`, the title, is required; `start_date` defaults to today):

```bash
curl -s -X POST "$API/agent/tasks" -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"action": "Review the team's CI changes", "workstream": "DevOps", "state": "in_progress", "labels": [], "high_impact": false}
JSON
```

Add `"parent_id": "TASK_ID"` to make it a sub-task (it takes the parent's workstream).

Update a task (send only what changes):

```bash
curl -s -X PATCH "$API/agent/tasks/TASK_ID" -H 'Content-Type: application/json' -d '{"state": "complete"}'
```

Fields: `action`, `state`, `high_impact`, `workstream` (`""` for none), `labels`, `start_date`,
`end_date`. Completing a task with open sub-tasks is refused; tell the user.

Append notes (markdown) to a task or a meeting:

```bash
curl -s -X POST "$API/agent/tasks/TASK_ID/notes" -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"text": "- Found the root cause: the retry loop didn't back off."}
JSON
```

Use `/agent/meetings/MEETING_ID/notes` for a meeting, e.g. when the user pastes AI meeting notes.

Add a link (the type — pr, issue, doc, slack, quip, other — is guessed from the URL):

```bash
curl -s -X POST "$API/agent/tasks/TASK_ID/links" -H 'Content-Type: application/json' \
  -d '{"url": "https://github.com/org/repo/pull/123", "label": "Retry fix PR"}'
```

Record a meeting, or change one (`exclude_from_stats: true` keeps parties and conferences out of
the meeting-time stats):

```bash
curl -s -X POST "$API/agent/meetings" -H 'Content-Type: application/json' \
  -d '{"title": "Platform sync", "start_time": "14:00", "duration_minutes": 30}'
curl -s -X PATCH "$API/agent/meetings/MEETING_ID" -H 'Content-Type: application/json' -d '{"exclude_from_stats": true}'
```

Create a task that came out of a meeting, or link an existing one:

```bash
curl -s -X POST "$API/agent/meetings/MEETING_ID/tasks" -H 'Content-Type: application/json' \
  -d '{"action": "Share bottleneck numbers", "workstream": "DevOps"}'
curl -s -X POST "$API/agent/meetings/MEETING_ID/tasks" -H 'Content-Type: application/json' -d '{"task_id": "TASK_ID"}'
```

## Writing summaries

For "what did I do this week" or a standup, start from `/agent/summary` (add `date_from` /
`date_to` for other periods) and `/agent/day` for single days. Group by workstream, lead with
completed and high-impact work, and mention meeting load only if it is notable. Base everything on
what the log says; if something is missing, say so instead of filling it in.
