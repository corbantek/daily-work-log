# Daily Work Log — Design Specification

## Overview

A local-first personal productivity app for tracking daily tasks, meetings, and workstreams. Built as a Python FastAPI + SQLite backend with a React + TypeScript + Tailwind CSS v4 frontend. Designed to run as a macOS launchd service that starts at login.

## Data Model

### Core Entities

**Task** — the primary work unit.
- `id` (UUID string PK), `action` (title), `notes` (markdown), `state` (todo/in_progress/complete/abandoned), `high_impact` (bool), `workstream_id` (FK nullable), `start_date`, `end_date`, `parent_task_id` (self-FK, one level only), `created_at`
- Relations: belongs to Workstream (optional), has many Labels (M2M via `task_label`), has many TaskLinks, has many Meetings (M2M via `meeting_task`)
- Sub-tasks: `parent_task_id` references another Task. Only one level — sub-tasks cannot have children. Parent picker filters to active tasks in the same workstream that are not already sub-tasks.

**Meeting** — a calendar event.
- `id`, `date`, `title`, `duration_minutes`, `notes` (markdown), `created_at`
- Relations: has many Tasks (M2M via `meeting_task`)

**Workstream** — a work area/project.
- `id`, `name`, `description`, `archived_at` (soft delete), `created_at`
- Relations: has many Tasks

**Label** — a colored tag.
- `id`, `name`, `color` (hex string)
- Relations: has many Tasks (M2M via `task_label`)

**TaskLink** — a URL attached to a task.
- `id`, `task_id` (FK), `url`, `label`, `link_type` (pr/issue/doc/slack/other), `created_at`

### Supporting Entities

**Setting** — key-value config store.
- `key` (string PK), `value` (string)
- Used settings: `app_title`, `theme`, `days_to_show`, `hide_weekends`, `content_width`, `day_status_options` (JSON array), `backup_dir`, `backup_retention_days`

**DayStatus** — per-day status tag.
- `day` (date PK), `status` (string), `note` (optional string)

**DayVisibility** — per-day show/hide override.
- `day` (date PK), `visible` (bool)

**OncallPeriod** — date range for on-call tracking.
- `id`, `start_date`, `end_date`

### Junction Tables
- `task_label` — Task ↔ Label
- `meeting_task` — Meeting ↔ Task

### Peer Feedback Entities

**Person** — a coworker you track.
- `id`, `name`, `role`, `team`, `relationship` (Report/Peer/Manager/Cross-functional/Other), `notes` (markdown), `archived_at` (soft delete), `created_at`
- Relations: has many Interactions (one-way; interaction holds `person_id`)

**Interaction** — a dated observation about one person.
- `id`, `person_id` (FK), `date`, `summary`, `notes` (markdown), `sentiment` (strength/growth/neutral), `workstream_id` (FK, optional context), `high_impact` (bool), `created_at`
- Relations: has many InteractionTags

**InteractionTag** — links an interaction to a competency (multi-tag).
- `id`, `interaction_id` (FK), `dimension_key`, `attribute_id` (nullable — null = whole-dimension tag)

**CompetencyDimension / CompetencyAttribute** — the editable framework.
- Dimension: `key` (slug PK), `label`, `sort_order`
- Attribute: `id`, `dimension_key` (FK), `text`, `sort_order`
- Seeded on first run from a default (Teamwork / Innovation / Results, 5 attributes each); fully editable via `/framework`

**Sentiment semantics:** sentiment is per-interaction (an observation reads as positive, constructive, or neutral as a whole); competency tags are many-per-interaction since one story often demonstrates multiple dimensions.

## Frontend Architecture

### Layout

Single-page app with three tabs: **Log** (main view), **Review** (task analysis), and **People** (peer feedback).

**Log tab:**
- Sticky header with app title (click to reset URL), tab switcher, workstream/label management, settings gear
- Rolling list of `DaySection` components from today backwards
- Each day shows: date header, status pill (with optional note), oncall pill, meetings, then workstream sections with tasks
- Today is expanded; past days collapsed by default (click to expand)
- "Load N more days" and "Go to date" controls at the bottom for viewing historical data

**Review tab:** a Tasks / Self-Review toggle.
- *Tasks*: filter bar (date range, state, workstream, label, high-impact), tasks grouped by workstream with state badges, labels, oncall indicators, Markdown export
- *Self-Review*: year-end summary of your own work — stat tiles (completed, high-impact, workstreams, in-progress, meetings, oncall days), high-impact highlights with notes, tasks grouped by workstream, Markdown export

**Global search (⌘K):** a command-palette overlay (opened by ⌘K/Ctrl-K or the header Search button) that searches tasks, meetings, people, and interactions; selecting a person/interaction opens that person in the People tab, while a task/meeting opens a focused read-only detail dialog (recall view) — tasks live inside collapsed days nested in workstreams, so jumping the Log view to them is unreliable.

**People tab:**
- People list (cards with interaction counts); add-person form; show-archived toggle
- Person detail: inline-editable header (name/role/team/relationship, archive/restore/delete), editable markdown notes, and a filterable interaction timeline
- Log interaction form: date, summary, sentiment, competency tags, markdown notes, optional workstream, high-impact
- Review Draft (per person + date range): ranked continue/focus candidates, per-dimension evidence (strengths/growth/notes), general "other notes", familiarity suggestion, and Markdown export
- Competency framework editor (from Settings → Competency framework): edit dimension labels and attributes, add/remove dimensions and attributes

**Settings dialog:**
- App title, theme (Dark/Dim/Light), days to show, content width, weekends, day statuses, on-call periods, auto-backup config, manual backup/restore
- Scrollable with thin styled scrollbar (`max-w-md`, `max-h-[90vh]`)

### Theme System

Three themes applied via CSS class on `<html>`:
- **Light** — default `:root` variables
- **Dim** — `.dim` class, softer dark with subtle dot grid + gradient background
- **Dark** — `.dark` class, deeper contrast

Custom Tailwind variant: `@custom-variant dark (&:is(.dark *, .dim *))` lets `dark:` classes work for both dark themes.

Native date inputs use `colorScheme: theme === 'light' ? 'light' : 'dark'` for proper theming.

### Content Width

Four responsive options stored as `content_width` setting:
- `normal` — `max-w-2xl` (672px)
- `wide` — `max-w-4xl` (896px)
- `wider` — `max-w-6xl` (1152px)
- `full` — `max-w-full`

Applied to both Log and Review containers.

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| App | `App.tsx` | Root layout, settings, state management |
| DaySection | `DaySection.tsx` | One day: status, oncall, meetings, workstreams |
| TaskRow | `TaskRow.tsx` | Task display with expand/collapse, inline editing |
| AddTaskForm | `AddTaskForm.tsx` | Inline task creation (`defaultOpen` for sub-tasks) |
| ClickToEditMarkdown | `ClickToEditMarkdown.tsx` | Textarea edit + ReactMarkdown preview |
| ReviewPage | `ReviewPage.tsx` | Filterable task review and export |
| StateDropdown | `StateDropdown.tsx` | Custom task state picker |
| WorkstreamPicker | `WorkstreamPicker.tsx` | Custom workstream selector |
| LabelPicker | `LabelPicker.tsx` | Custom multi-label selector |
| PeoplePage | `pages/PeoplePage.tsx` | People list + routing to detail/review |
| PersonDetail | `PersonDetail.tsx` | Person header, notes, interaction timeline |
| InteractionForm | `InteractionForm.tsx` | Log/edit an interaction |
| CompetencyTagPicker | `CompetencyTagPicker.tsx` | Grouped multi-select competency tags |
| ReviewDraftView | `ReviewDraftView.tsx` | Aggregated peer-review draft + export |
| ManageFramework | `ManageFramework.tsx` | Edit competency dimensions/attributes |
| SelfReviewDraft | `SelfReviewDraft.tsx` | Your own year-end summary + export |
| CommandPalette | `CommandPalette.tsx` | ⌘K global search overlay |
| ItemDetailDialog | `ItemDetailDialog.tsx` | Read-only recall view for a searched task/meeting |

### Markdown Rendering

All markdown rendered via `<ReactMarkdown>` with `remark-gfm` and `rehypeHighlightTodo`.

The `rehypeHighlightTodo` plugin (`web/src/lib/rehype-highlight-todo.ts`) walks the HAST tree, splits text nodes containing `TODO`, and wraps matches in `<span class="todo-keyword">` (styled red/bold in `index.css`).

Two prose classes:
- `.prose-worklog` — full markdown styling for expanded notes
- `.prose-worklog-preview` — compact, muted styling for collapsed task previews

## Backend Architecture

### Server Lifecycle

`api/main.py` uses FastAPI's `lifespan` context manager:
1. `init_db()` — run migrations then `create_all`
2. Start `_daily_backup_loop` background task (asyncio)
3. Yield (serve requests)
4. Cancel backup task on shutdown

### Migrations

`database.py` `_run_migrations()`:
1. Copy DB to `.db.bak`
2. Run guarded `ALTER TABLE` statements (check column existence before altering)
3. Then `SQLModel.metadata.create_all()` handles new tables

### Auto-Backup

Background asyncio task runs every hour:
- Reads `backup_dir` and `backup_retention_days` from Settings (defaults: `~/daily-work-log-backups`, 14)
- If today's backup file doesn't exist, writes `worklog-backup-{date}.json`
- Prunes files beyond retention count (keeps N most recent by filename sort)
- Manual trigger: `POST /backup/auto`

### Backup/Restore (Manual)

- `GET /backup` — returns full JSON export of all tables
- `POST /backup` — accepts JSON file upload, deletes all data, re-imports

Table order matters for FK constraints. Export/import uses a fixed `TABLES` list.

### Review Draft Aggregation

`GET /review-draft/{person_id}` builds a `ReviewDraft` for a person + date range:
1. Fetch the person's interactions in range, with their tags
2. Group into per-dimension buckets (framework order), each split into strengths / growth / notes by sentiment
3. Rank "continue" candidates (attributes most-tagged on strength interactions) and "focus more on" candidates (on growth interactions)
4. Collect "other notes" — neutral interactions with no competency tags (pure general notes)
5. Suggest familiarity from interaction volume
6. The frontend renders this and can export it as Markdown mirroring the peer-review form

### Self-Review & Search

`GET /self-review?date_from&date_to` aggregates *your own* tasks (by effective date = end/start/created): high-impact highlights, tasks grouped by workstream (high-impact first, abandoned excluded), and summary stats (completed, high-impact, workstreams, in-progress, meetings, oncall days). `GET /search?q=` runs case-insensitive LIKE across tasks, meetings, people, and interactions, capped per type. Both are read-only derived endpoints (no new tables).

### Day View Aggregation

`GET /day/{date}` builds a `DayView`:
1. Query `DayStatus` for the date
2. Query `OncallPeriod` for overlap with the date
3. Query Meetings for the date (with linked tasks)
4. Query Tasks active on the date (via `start_date`/`end_date` range + state logic)
5. Group tasks by workstream, compute subtask counts
6. Return aggregated response

## macOS Deployment

The Makefile generates a launchd plist at install time:
- Captures nvm's node binary path via `$(shell dirname $(shell which node))`
- Sets `PROJECT_DIR` env var for the start script
- `RunAtLoad: true`, `KeepAlive: true`
- Logs to `~/Library/Logs/daily-work-log/`

`scripts/start.sh` runs uvicorn (port 8000) and Vite dev server in parallel.

**Important:** The agent runs without `--reload`, so backend code changes require `make restart-agent`.

## Dependencies

### Python (`api/requirements.txt`)
- fastapi 0.115.0
- uvicorn[standard] 0.30.6
- sqlmodel 0.0.39
- python-multipart 0.0.9

### Node (`web/package.json` — key deps)
- react 19, react-dom 19
- tailwindcss 4, @tailwindcss/vite
- shadcn (base-ui, not Radix)
- react-markdown, remark-gfm
- lucide-react (icons)
- vite 5, typescript 6

## Design Decisions

- **Plain textarea over rich editor**: `@uiw/react-md-editor` was removed because its overlay-textarea architecture conflicts with Tailwind v4 Preflight (`padding: 0` reset breaks cursor alignment). Plain textarea + preview tab is reliable.
- **Custom dropdowns over base-ui Select**: base-ui Select had display reliability issues. Custom dropdown components are simpler and consistent.
- **rehype over remark for TODO highlighting**: rehype operates on the HTML AST (post-parse), catching all contexts. `unist-util-visit` was already available as a transitive dependency.
- **Settings in DB not config file**: All settings stored in the `Setting` table so they persist across machines when the DB is copied.
- **One backup per day**: Auto-backup writes one file per calendar day (overwrites on re-run). Retention is by file count, not age — simpler and predictable.
- **Oncall separate from day status**: On-call is a date range (often spanning many days) while day status is a per-day tag. Separate models avoid coupling.
- **Peer feedback modeling**: One person per interaction (keeps sentiment/tags unambiguous and the review rollup clean); multiple competency tags per interaction (one story shows several dimensions); sentiment per interaction (positive/constructive/neutral as a whole). The competency framework is seeded but DB-backed and editable so review language can be customized per company without a code change.
- **Framework edits preserve tag references**: tags reference attributes by stable `id`. Deleting an attribute downgrades its tags to whole-dimension tags (sets `attribute_id` null) rather than dropping the signal; deleting a dimension removes its tags.

## Future Improvements

- **Calendar picker for Apple Calendar import**: Let the user choose which calendars sync in Settings (e.g. exclude Birthdays and US Holidays). The backend already honors the `calendar_included_ids` setting (JSON array of calendar identifiers; empty = all) and `GET /calendar/status` returns the available calendars (id, title, source). Remaining work is the Settings UI, likely a checklist grouped by account inside `CalendarAccess.tsx`, saved via `PUT /settings/calendar_included_ids`.
