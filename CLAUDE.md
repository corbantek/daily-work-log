# Daily Work Log

Personal app for tracking daily tasks, meetings, and workstreams.

## Project Structure

```
api/           Python FastAPI backend (SQLite via SQLModel)
  main.py      App setup, lifespan context manager, daily auto-backup loop
  models.py    All DB models + request/response types
  database.py  Engine, session, migrations (always backs up DB before migrating)
  routes/      REST endpoints (backup, day, day_status, day_visibility,
               labels, meetings, oncall, settings, tasks, workstreams)
  worklog.db   SQLite database (gitignored)

web/           React + Vite + TypeScript frontend (Tailwind CSS v4)
  src/api/     API client, types, date utils
  src/components/  UI components (shadcn/ui based, base-ui not Radix)
  src/pages/   Page-level views (ReviewPage)
  src/lib/     rehype-highlight-todo plugin
```

## Running

```bash
make install        # first time: create venv, install pip + npm deps
make dev            # starts API on :8000 and Vite on :5173
make install-agent  # macOS launchd agent (runs at login, KeepAlive)
make restart-agent  # needed after backend changes (no --reload in daemon)
make logs           # tail agent stdout/stderr
make open           # open http://localhost:5173
```

## Key Architecture

- **Database**: SQLite via SQLModel. DB path configurable via `WORKLOG_DB` env var (default: `worklog.db`).
- **Migrations**: `database.py` `_run_migrations()` runs guarded `ALTER TABLE` statements before `create_all`. Always copies DB to `.db.bak` first.
- **Day view**: `GET /day/{date}` returns an aggregated `DayView` with status, oncall flag, meetings, and tasks grouped by workstream.
- **Settings**: key-value `Setting` table. Frontend reads all on startup via `GET /settings` and writes individual keys via `PUT /settings/{key}`.
- **Auto-backup**: Background asyncio task in `main.py` checks hourly; writes one `worklog-backup-{date}.json` per day to the configured backup dir. Configurable via `backup_dir` and `backup_retention_days` settings.
- **Sub-tasks**: Self-referential FK on `Task.parent_task_id`. One level of nesting only — sub-tasks cannot have children.
- **Oncall**: Separate `OncallPeriod` table with date ranges. `DayView.is_oncall` computed via overlap query.
- **Day status**: `DayStatus` table with day PK, status string, optional note. Custom statuses managed in Settings (stored as JSON array in `day_status_options` setting).
- **TODO highlighting**: `rehype-highlight-todo.ts` rehype plugin walks HAST, splits text nodes on `TODO`, wraps in `<span class="todo-keyword">`. Applied in `ClickToEditMarkdown`, `TaskRow` (collapsed preview), and `ReviewPage`.
- **Theme**: Three modes — light (`:root`), dim (`.dim`), dark (`.dark`). Custom variant `@custom-variant dark (&:is(.dark *, .dim *))` for Tailwind.
- **Content width**: Four options stored as `content_width` setting: `normal` (672px), `wide` (896px), `wider` (1152px), `full` (100%).

## Frontend Component Map

- `App.tsx` — main layout, settings dialog, header, tab switching, extended date loading
- `DaySection.tsx` — single day: status picker (two-step with note), oncall pill, meetings, workstream sections
- `WorkstreamSection.tsx` — task list for one workstream within a day
- `TaskRow.tsx` — single task: expand/collapse, state/workstream/label/link editing, sub-task add, markdown notes
- `AddTaskForm.tsx` — inline task creation form (`defaultOpen` prop for sub-task flow)
- `MeetingSection.tsx` — meeting card with task linking
- `ClickToEditMarkdown.tsx` — textarea + ReactMarkdown preview tab editor
- `BackupRestore.tsx` — manual JSON export/import buttons
- `ReviewPage.tsx` — filterable task review with workstream grouping, oncall indicators, markdown export
- `StateDropdown.tsx`, `WorkstreamPicker.tsx`, `LabelPicker.tsx` — custom dropdowns (not base-ui Select)
- `HiddenDaysIndicator.tsx` — shows hidden day count between visible days

## API Routes

| Route | Methods | Purpose |
|-------|---------|---------|
| `/day/{date}` | GET | Aggregated day view |
| `/tasks` | GET, POST | List/create tasks |
| `/tasks/{id}` | GET, PATCH, DELETE | Task CRUD |
| `/tasks/{id}/links` | POST | Add link to task |
| `/tasks/{id}/links/{lid}` | PATCH, DELETE | Update/remove link |
| `/meetings` | GET, POST | List/create meetings |
| `/meetings/{id}` | GET, PATCH, DELETE | Meeting CRUD |
| `/workstreams` | GET, POST | List/create workstreams |
| `/workstreams/{id}` | PATCH, DELETE | Update/archive workstream |
| `/labels` | GET, POST | List/create labels |
| `/labels/{id}` | PATCH, DELETE | Update/delete label |
| `/day-status/{date}` | PUT, DELETE | Set/clear day status |
| `/day-visibility` | GET | Get visibility overrides |
| `/day-visibility/{date}` | PUT, DELETE | Set/clear visibility |
| `/oncall` | GET, POST | List/create oncall periods |
| `/oncall/{id}` | PATCH, DELETE | Update/delete oncall period |
| `/settings` | GET | All settings |
| `/settings/{key}` | PUT | Set one setting |
| `/backup` | GET, POST | Export/import JSON backup |
| `/backup/auto` | POST | Trigger auto-backup to file |
| `/backup/status` | GET | Backup dir, last date, count |
| `/health` | GET | Health check |

## Future Improvements

- **Markdown editor (CodeMirror 6):** `ClickToEditMarkdown` currently uses a plain `<textarea>` + `<ReactMarkdown>` preview tab. If syntax highlighting while typing becomes desirable, replace with CodeMirror 6 (`@codemirror/view` + `@codemirror/lang-markdown`). Avoid `@uiw/react-md-editor` — its overlay-textarea architecture conflicts with Tailwind v4 Preflight.
- **Keyword highlighting in markdown (`web/src/lib/rehype-highlight-todo.ts`):** Currently highlights `TODO` in red. To extend to `FIXME`, `BLOCKED`, etc., update the plugin to split on each keyword and assign distinct class names, then add CSS rules in `index.css`.

## Rules

- **Never delete `worklog.db`** — always backup before schema changes. Use `ALTER TABLE ... RENAME COLUMN` for column renames. Add migration checks in `database.py` `init_db()`.
- All dates use local timezone via `todayStr()` from `web/src/api/date.ts` — never use `toISOString().split('T')[0]`.
- Custom dropdowns (StateDropdown, WorkstreamPicker, LabelPicker) instead of base-ui Select for display reliability.
- Backend builds with `api/.venv/bin/python`, frontend builds with `cd web && node_modules/.bin/vite build`.
- Git remote is `git@github-personal:corbantek/daily-work-log.git`. GPG signing enabled. Commit only when asked.
- The launchd agent runs uvicorn without `--reload`, so backend changes require `make restart-agent`.
