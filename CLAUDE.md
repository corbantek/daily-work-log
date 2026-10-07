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
- **Calendar import**: `api/calendar_source.py` reads Apple Calendar via EventKit (`pyobjc-framework-EventKit`, macOS only; all EventKit access is isolated there). `POST /calendar/sync?date=` upserts that one day's events as `Meeting` rows (`source="apple_calendar"`, `external_id` = eventIdentifier + start, `start_time` "HH:MM"). Sync only overwrites title/date/duration/start_time of imported meetings — never notes or task links. A hand-entered meeting with the same title that day is adopted instead of duplicated. Imported meetings that vanish from the calendar get `missing_from_source=true` (flagged, never auto-deleted). Declined, cancelled and all-day events are skipped by default. Settings: `calendar_included_ids` (JSON array, empty = all), `calendar_skip_declined`, `calendar_skip_allday` (`"true"`/`"false"`). Manual per-day only (the "sync" button in the Meetings header) — no auto-sync. **macOS Calendar permission (TCC) is granted to the launching app**: it prompts from Terminal.app but silently denies from the VS Code terminal; `GET /calendar/status` shows the state.
- **People / peer feedback**: `Person` + `Interaction` (dated observations about one person). Interactions carry a `sentiment` (strength/growth/neutral) and multiple `InteractionTag` rows (dimension + optional attribute). Tags reference the `CompetencyDimension` / `CompetencyAttribute` framework, which is seeded on first run (`database.py` `_seed_framework()`) and editable via `/framework`. The `/review-draft/{person_id}` endpoint aggregates a person's interactions into the peer-review structure (per-dimension evidence split by sentiment, ranked continue/focus candidates, untagged neutral "other notes", familiarity suggestion). Deleting a person cascades its interactions + tags; deleting an attribute downgrades its tags to whole-dimension tags.

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
- `PeoplePage.tsx` (page) — people list, add-person, show-archived toggle; routes to detail / review
- `PersonDetail.tsx` — person header (inline edit, archive/restore/delete), editable markdown notes, interaction timeline with filters
- `InteractionForm.tsx` — log/edit an interaction (date, summary, sentiment, competency tags, markdown notes, workstream, high-impact)
- `CompetencyTagPicker.tsx` — grouped multi-select for competency tags; `dimensionColor()` helper for per-dimension colors
- `ReviewDraftView.tsx` — aggregated peer-review draft with Markdown export
- `ManageFramework.tsx` — dialog to edit competency dimensions/attributes (opened from Settings → Competency framework)
- `SelfReviewDraft.tsx` — your own year-end summary (stat tiles, high-impact highlights, tasks grouped by workstream) + Markdown export; shown via the Review tab's Tasks/Self-Review toggle
- `CommandPalette.tsx` — ⌘K / Ctrl-K global search overlay; opens a person in the People tab, or a focused read-only detail (`ItemDetailDialog`) for a task/meeting (tasks live inside collapsed days, so jumping the Log view to them is unreliable — a recall dialog is used instead)
- `ItemDetailDialog.tsx` — read-only detail view for a task or meeting selected from search (state, workstream, dates, labels, links, notes, linked items)

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
| `/people` | GET, POST | List/create people (`?include_archived`) |
| `/people/{id}` | GET, PATCH, DELETE | Person CRUD (PATCH sets `archived_at` to archive) |
| `/interactions` | GET, POST | List (filter person/dimension/sentiment/date) / create |
| `/interactions/{id}` | GET, PATCH, DELETE | Interaction CRUD (tags set via body) |
| `/framework` | GET | Competency dimensions + attributes |
| `/framework/dimensions` | POST | Add dimension |
| `/framework/dimensions/{key}` | PATCH, DELETE | Edit/delete dimension |
| `/framework/dimensions/{key}/attributes` | POST | Add attribute |
| `/framework/attributes/{id}` | PATCH, DELETE | Edit/delete attribute |
| `/review-draft/{person_id}` | GET | Aggregated peer-review draft (`?date_from&date_to`) |
| `/self-review` | GET | Aggregated self-review of your own work (`?date_from&date_to`) |
| `/search` | GET | Global search across tasks/meetings/people/interactions (`?q`) |
| `/calendar/status` | GET | Calendar permission state + available calendars |
| `/calendar/request-access` | POST | Ask macOS for Calendar access |
| `/calendar/sync` | POST | Import one day's events as meetings (`?date=`) |
| `/settings` | GET | All settings |
| `/settings/{key}` | PUT | Set one setting |
| `/backup` | GET, POST | Export/import JSON backup |
| `/backup/auto` | POST | Trigger auto-backup to file |
| `/backup/status` | GET | Backup dir, last date, count |
| `/health` | GET | Health check |

## Feature backlog

Ideas scoped but not yet built (from a 2026-10-02 planning pass):

- **Insights dashboard** — stat tiles + charts: time across workstreams, high-impact trend, meeting load, oncall days. (Medium–Large; some overlap with the self-review stats which already compute these counts.)
- **Restore-from-auto-backup UI** — auto-backup writes dated JSON files, but restore is only via manual upload. Add an endpoint to list backup files and restore by filename, plus a picker in Settings.
- **Open-TODO aggregator** — surface all `TODO`/`FIXME` keywords found across task/interaction notes in one "loose ends" list (the rehype plugin already identifies them for rendering).
- **Calendar picker for Apple Calendar import** — choose which calendars to sync in Settings (e.g. skip Birthdays/US Holidays). Backend already honors the `calendar_included_ids` setting and `GET /calendar/status` lists calendars; only the Settings UI is missing (`CalendarAccess.tsx` is the natural home).
- **Task due dates + overdue view** — add a `due_date` to tasks and a "due soon / overdue" filter.
- **Quick-log interaction from the Log tab** + the ability to link an interaction to a specific task/meeting (not just a workstream). Interactions were intentionally kept to one person each; multi-person tagging was also deferred.

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
