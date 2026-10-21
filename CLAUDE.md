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
make dev            # starts API on :4747 and Vite on :4748
make install-agent  # macOS launchd agent (runs at login, KeepAlive)
make restart-agent  # needed after backend changes (no --reload in daemon)
make logs           # tail agent stdout/stderr
make open           # open http://localhost:4748

# backend tests (stdlib unittest, no extra deps)
api/.venv/bin/python -m unittest discover -s api/tests -t .
```

## Key Architecture

- **Ports**: API `4747`, web `4748` (demo/screenshot use `4757`/`4758`) — chosen to avoid common defaults. Override with `API_PORT` / `WEB_PORT` env vars (Makefile, `scripts/start.sh`, `web/vite.config.ts` and CORS in `api/main.py` all read them). Vite uses `strictPort`. The launchd plist bakes the ports in at `make install-agent`, so changing them needs `make restart-agent`.
- **Database**: SQLite via SQLModel. DB path configurable via `WORKLOG_DB` env var (default: `worklog.db`).
- **Migrations**: `database.py` `_run_migrations()` runs guarded `ALTER TABLE` statements before `create_all`. Always copies DB to `.db.bak` first.
- **Day view**: `GET /day/{date}` returns an aggregated `DayView` with status, oncall flag, meetings, and tasks grouped by workstream.
- **Settings**: key-value `Setting` table. Frontend reads all on startup via `GET /settings` and writes individual keys via `PUT /settings/{key}`.
- **Auto-backup**: Background asyncio task in `main.py` checks hourly; writes one `worklog-backup-{date}.json` per day to the configured backup dir. Configurable via `backup_dir` and `backup_retention_days` settings.
- **Sub-tasks**: Self-referential FK on `Task.parent_task_id`. One level of nesting only — sub-tasks cannot have children.
- **Oncall**: Separate `OncallPeriod` table with date ranges. `DayView.is_oncall` computed via overlap query.
- **Day status**: `DayStatus` table with day PK, status string, optional note. Custom statuses managed in Settings (stored as JSON array in `day_status_options` setting).
- **Keyword highlighting**: `rehype-highlight-todo.ts` rehype plugin walks HAST, splits text nodes on `TODO` (red, `.todo-keyword`) and the whole word `DONE` (green, `.done-keyword`; whole-word so ABANDONED/UNDONE don't match), wrapping each in a `<span>`; it skips the spans it inserts. Applied in `ClickToEditMarkdown`, `TaskRow` (collapsed preview), `ReviewPage`, the attachment viewer and the detail/review views.
- **Theme**: Three modes — light (`:root`), dim (`.dim`), dark (`.dark`). Custom variant `@custom-variant dark (&:is(.dark *, .dim *))` for Tailwind.
- **Content width**: Four options stored as `content_width` setting: `normal` (672px), `wide` (896px), `wider` (1152px), `full` (100%).
- **Meeting order**: by `start_time`; untimed (manual) meetings after, in creation order (`MEETING_ORDER` in `routes/meetings.py`). Manual meetings can have an optional `start_time` (24-hour "HH:MM", validated); on imported meetings it's overwritten by sync.
- **Meeting links**: URLs on meetings (`MeetingLink` table, same fields and `LinkType`s as `TaskLink`; types are pr / issue / doc / slack / quip / other, and `LinkSection` guesses one from a pasted URL; separate because `tasklink.task_id` is NOT NULL). `POST /meetings/{id}/links`, `PATCH`/`DELETE /meetings/{id}/links/{link_id}`; `MeetingRead.links`; deleting a meeting deletes its links; calendar sync never touches them. The add/edit/delete UI with paste detection is the shared `LinkSection` component, used by `TaskRow` (default type `pr`) and `MeetingDetails` (default `other`).
- **Task & meeting attachments**: files attached to tasks or meetings (`TaskAttachment` and `MeetingAttachment` tables with identical columns — separate because `task_attachment.task_id` is NOT NULL; ids are UUIDs so `find_attachment()` serves both from one set of `/attachments/{id}` endpoints). Stored **on disk**, not in SQLite, in `api/<db-name>-attachments/` (override with `WORKLOG_FILES`; gitignored via `api/worklog*`) under UUID-hex names; attachment rows keep the original filename, size and the stored name (`api/attachments.py` = storage helpers, `api/routes/attachments.py` = endpoints). Upload limit 25 MB (`WORKLOG_MAX_ATTACHMENT_MB`). **Serving is allowlisted** (`serve_profile`): PDF/images and `.html`/`.htm`/`.svg` open inline, `.md`/`.txt`/`.csv`/`.json`/`.log` inline as `text/plain`, everything else (XML, scripts, archives, unknown) is forced download; always `nosniff`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store` (a browser otherwise reuses an old response, including an old `Content-Disposition`, for hours; the frontend's `attachmentFileUrl` carries a `?v=2` suffix to skip entries cached before that). **HTML, SVG and PDF are served with no CSP sandbox, by choice** (the owner only attaches files they trust): a script in an attached HTML/SVG runs on the app's own origin, so it has the same access to the API and data as the app. Re-add `Content-Security-Policy: sandbox` (via `_UNSANDBOXED` in `api/attachments.py`) if that stops being acceptable; the remaining inline/download types still carry it. The URL filename segment is cosmetic; the id decides the file. Markdown opens in a standalone rendered viewer at `/?attachment=<id>` (`main.tsx` switches to `AttachmentViewer`); other types open the file directly in a new tab. **The JSON backup holds attachment names only**: `GET/POST /attachments/archive` exports/restores a tar.gz of the files (+ `manifest.json`), only UUID-named regular files are extracted; restore the DB backup, then the archive. Auto-backup also copies new files into `<backup_dir>/attachments/` (copy-if-missing). Deleting a task, meeting or attachment deletes its files (deleting a calendar-imported meeting deletes its attachments too; if it later returns, it comes back without them). Search matches attachment filenames for tasks and meetings. Upload endpoints: `POST /tasks/{id}/attachments`, `POST /meetings/{id}/attachments`; the UI hook is `useAttachmentUpload('/tasks/<id>' | '/meetings/<id>')`.
- **Note editing (`ClickToEditMarkdown`)**: no Save button. Text saves when focus leaves the editor (outside `pointerdown` listener + `focusout`, so it works on both the Edit and Preview tabs), on ⌘/Ctrl+Enter, and when the editor is torn down mid-edit after the user has typed (collapsing a task/day, switching tabs, the `refresh()` remount). Switching between Edit and Preview never saves (`switchingTabRef` guards the textarea unmounting; tab/Cancel buttons `preventDefault` on mousedown so Safari/Firefox don't treat them as focus loss). Cancel/Esc discard. A failed save keeps the editor open with the text. After a save, "Saved ✓ · Undo" restores the previous notes for 10 s. With a `draftKey` prop (`task:<id>:notes`, `meeting:<id>:notes`, `person:<id>:notes`) the draft is also mirrored to localStorage (`worklog-draft:<key>`, `web/src/lib/drafts.ts`) every 500 ms and on `pagehide`; on the next mount it reopens with "Recovered unsaved changes · Discard" (never auto-saved), and `TaskRow` / `MeetingSection` start expanded when a draft is waiting. The Edit-task form and interaction form keep their own Save/Cancel.
- **Notes editor height**: three settings, `notes_height_task` / `notes_height_meeting` / `notes_height_person`, each `short` (120px) / `medium` (240px) / `long` (400px); defaults task=medium, meeting=long, person=medium. Chosen in Settings → Notes editor height. `ClickToEditMarkdown` takes a required `kind` prop and reads the height from `NotesHeightContext` (`web/src/lib/notes-height.ts`, provided by `App.tsx`), so no props are threaded through the day/task components. It's a minimum height; the textarea still grows and can be dragged larger.
- **Self-review cycle**: `review_cycle_start` setting, month-day `"MM-DD"` (default `01-01`), chosen in Settings → Self-review cycle starts (month + day selects; the day is clamped to the month). `SelfReviewDraft` opens on `reviewCycleStart()` (`web/src/api/date.ts`) → today: this year's start if it has arrived, else last year's (Feb 29 falls back to Feb 28 in non-leap years). Passed `App` → `ReviewPage` → `SelfReviewDraft`; the dates stay editable.
- **Time format**: `time_format` setting (`12h` default, or `24h`). Meeting `start_time` is stored as 24-hour "HH:MM"; `formatTime()` in `web/src/api/date.ts` formats it for display. State lives in `App.tsx` and is passed `DaySection` → `MeetingSection`.
- **Calendar import**: `api/calendar_source.py` reads Apple Calendar via EventKit (`pyobjc-framework-EventKit`, macOS only; all EventKit access is isolated there). `POST /calendar/sync?date=` upserts that one day's events as `Meeting` rows (`source="apple_calendar"`, `external_id` = eventIdentifier + start, `start_time` "HH:MM"). Sync only overwrites title/date/duration/start_time of imported meetings — never notes or task links. A hand-entered meeting with the same title that day is adopted instead of duplicated. Imported meetings that vanish from the calendar get `missing_from_source=true` (flagged, never auto-deleted). **Deleting an imported meeting records a `DismissedCalendarEvent`** (keyed by `external_id`, with a fingerprint of the source event's title/date/time/duration, stored on `Meeting.source_fingerprint` at each sync) so sync skips it while the event is unchanged; if the event is edited on the calendar the dismissal is cleared and it returns (notes/task links on the deleted row are gone). Rescheduling changes `external_id` (start time is part of it), so moved events also return. Controlled by the `calendar_remember_deleted` setting (default `true`; off = deletes don't stick and existing dismissals are ignored). Dismissals older than 90 days (measured from today) are pruned on sync and when listed. Settings → Apple Calendar has a "View deleted meetings" button that opens `DismissedEventsDialog` (grouped by day, Restore re-syncs that day, Clear all). Declined, cancelled and all-day events are skipped by default. Settings: `calendar_included_ids` (JSON array of calendar ids, empty = all; chosen via checkboxes in Settings → Apple Calendar, which stores `[]` when everything is checked and refuses to uncheck the last one), `calendar_skip_declined`, `calendar_skip_allday` (`"true"`/`"false"`). Manual per-day only (the "sync" button in the Meetings header) — no auto-sync. **macOS Calendar permission (TCC) is granted to the launching app**: it prompts from Terminal.app but silently denies from the VS Code terminal; `GET /calendar/status` shows the state.
- **Review insights (Review → Meetings / Links)**: read-only aggregations in `api/routes/insights.py`, no tables of their own. Both take `date_from` / `date_to`; the frontend's shared `DateRangePicker` offers This week (Mon–Sun) / Last week / This month / This quarter / This year / custom (`rangeForPreset()` in `web/src/api/date.ts`); Meetings, Links and Tasks all open on This week (Self-Review keeps its own date fields, opening on the current review cycle). **Meetings** (`GET /insights/meetings`): stats (hours, share of work week = weekdays × 8 h minus days whose status contains vacation/sick/out of office/ooo/pto/holiday; meeting count; with notes; busiest day; hours per week) are counted **only through today** (`stats_through`) so a week in progress isn't diluted; overlapping meetings count twice. Digest = every meeting in the range in time order (frontend: meetings with no notes, tasks, links or files render as one compact line, hidden by the "Empty meetings (N)" toggle button; export follows the toggle), with a preview from a heading containing "summary" if present, else the first 12 lines (`notes_preview`; AI note formats vary), plus each meeting's linked tasks, links and files listed under the notes. Outcomes = a flat list of tasks linked to meetings in the range, **each task once** with every meeting it came from (`OutcomeTask.meetings`), open first, then done, then abandoned; the open/done counts count each task once. Markdown export is built in the frontend. **Links** (`GET /insights/links`): task + meeting links and attachments whose task/meeting is dated in the range — a task's date is end, else start, else created (same rule as the Tasks review and Self-Review); URLs inside notes are deliberately not included. Links merge by URL (trimmed, trailing `/` ignored; newest label and type win), files stay individual. The frontend groups them into one section per type (PR, Issue, Doc, Slack, Quip, Other, then Files; empty sections skipped), oldest first inside each by the date a link first appeared — consistent with the other Review views.
- **People / peer feedback**: `Person` + `Interaction` (dated observations about one person). Interactions carry a `sentiment` (strength/growth/neutral) and multiple `InteractionTag` rows (dimension + optional attribute). Tags reference the `CompetencyDimension` / `CompetencyAttribute` framework, which is seeded on first run (`database.py` `_seed_framework()`) and editable via `/framework`. The `/review-draft/{person_id}` endpoint aggregates a person's interactions into the peer-review structure (per-dimension evidence split by sentiment, ranked continue/focus candidates, untagged neutral "other notes", familiarity suggestion). Deleting a person cascades its interactions + tags; deleting an attribute downgrades its tags to whole-dimension tags.

## Frontend Component Map

- `App.tsx` — main layout, header, tab switching, extended date loading, and the settings dialog, which is split into tabs (`SETTINGS_TABS`): **App** (title, theme, days, width, meeting times, notes height, weekends) · **Status / Oncall** · **Review** (self-review cycle, competency framework) · **Data** (auto-backup, backup & restore, attachments) · **Calendar** (Apple Calendar access/calendars, deleted calendar meetings). The panel has a fixed min height sized to the App tab so the centered dialog doesn't move between tabs; the last tab is remembered while the app is open
- `DaySection.tsx` — single day: status picker (two-step with note), oncall pill, meetings, workstream sections
- `WorkstreamSection.tsx` — task list for one workstream within a day
- `TaskRow.tsx` — single task: expand/collapse, state/workstream/label/link editing, sub-task add, markdown notes
- `AddTaskForm.tsx` — inline task creation form (`defaultOpen` prop for sub-task flow)
- `MeetingSection.tsx` — meeting card with task linking, optional start time, per-day calendar sync button
- `LinkSection.tsx` — link list with inline add/edit/delete and paste detection, shared by tasks and meetings (`beforeActions` / `actions` slots hold the attachment list and attach button)
- `Attachments.tsx` — attach button, drag-and-drop upload hook (`useAttachmentUpload`) and the attachment list (open in new tab, download, rename, delete); used by an expanded `TaskRow` and by `MeetingDetails` in `MeetingSection.tsx`
- `AttachmentViewer.tsx` — standalone rendered-markdown page for `/?attachment=<id>`
- `AttachmentsBackup.tsx` — Settings → Data: attachment count/size, missing-file warning, export/restore tar.gz
- `CalendarAccess.tsx` — Settings → Apple Calendar: access status/request and the calendars-to-sync checkboxes
- `DeletedCalendarMeetings.tsx` — Settings: stay-deleted/re-import toggle + button to open the deleted-meetings dialog (lives in a different Settings column than `CalendarAccess` to balance column heights)
- `DismissedEventsDialog.tsx` — deleted calendar meetings (last 90 days) grouped by day with Restore / Clear all
- `ClickToEditMarkdown.tsx` — textarea + ReactMarkdown preview tab editor; saves on blur/outside-click (no Save button), with Cancel, Undo and localStorage draft recovery
- `BackupRestore.tsx` — manual JSON export/import buttons
- `ReviewPage.tsx` — Review tab shell (Meetings | Tasks | Links | Self-Review) and the filterable task review: workstream grouping, oncall indicators, task titles open `ItemDetailDialog`, markdown export
- `StateDropdown.tsx`, `WorkstreamPicker.tsx`, `LabelPicker.tsx` — custom dropdowns (not base-ui Select)
- `HiddenDaysIndicator.tsx` — shows hidden day count between visible days
- `PeoplePage.tsx` (page) — people list, add-person, show-archived toggle; routes to detail / review
- `PersonDetail.tsx` — person header (inline edit, archive/restore/delete), editable markdown notes, interaction timeline with filters
- `InteractionForm.tsx` — log/edit an interaction (date, summary, sentiment, competency tags, markdown notes, workstream, high-impact)
- `CompetencyTagPicker.tsx` — grouped multi-select for competency tags; `dimensionColor()` helper for per-dimension colors
- `ReviewDraftView.tsx` — aggregated peer-review draft with Markdown export
- `ManageFramework.tsx` — dialog to edit competency dimensions/attributes (opened from Settings → Competency framework)
- `SelfReviewDraft.tsx` — your own year-end summary (stat tiles, high-impact highlights, tasks grouped by workstream) + Markdown export; shown via the Review tab's Tasks/Self-Review toggle
- `MeetingInsightsView.tsx` — Review → Meetings: stat tiles, hours-per-week chart (shown for ranges over one week), deduplicated outcomes list, then digest cards (preview / full notes, then the meeting's tasks, links and files), Markdown export (same order)
- `LinksView.tsx` — Review → Links: merged link/file list with search and type filter; sources open `ItemDetailDialog`
- `DateRangePicker.tsx` — preset + custom date range control used by Review → Meetings, Links and Tasks
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
| `/tasks/{id}/attachments` | POST | Upload a file to a task (multipart `file`) |
| `/meetings/{id}/attachments` | POST | Upload a file to a meeting |
| `/meetings/{id}/links` | POST | Add a link to a meeting |
| `/meetings/{id}/links/{lid}` | PATCH, DELETE | Update/remove a meeting link |
| `/attachments/{id}` | GET, PATCH, DELETE | Attachment metadata / rename / delete (file removed too) |
| `/attachments/{id}/{filename}` | GET | The file (inline for safe types, otherwise download) |
| `/attachments/archive` | GET, POST | Export / restore all files as tar.gz |
| `/attachments/stats` | GET | Count, total bytes, attachments missing their file |
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
| `/insights/meetings` | GET | Meeting stats, digest and outcomes (`?date_from&date_to`) |
| `/insights/links` | GET | Links and files on tasks/meetings in the range (`?date_from&date_to`) |
| `/search` | GET | Global search across tasks/meetings/people/interactions (`?q`) |
| `/calendar/status` | GET | Calendar permission state + available calendars |
| `/calendar/request-access` | POST | Ask macOS for Calendar access |
| `/calendar/sync` | POST | Import one day's events as meetings (`?date=`) |
| `/calendar/dismissed` | GET, DELETE | List calendar meetings you deleted (skipped on sync) / forget them all |
| `/calendar/dismissed/{external_id}` | DELETE | Restore one (returns on next sync of its day) |
| `/settings` | GET | All settings |
| `/settings/{key}` | PUT | Set one setting |
| `/backup` | GET, POST | Export/import JSON backup |
| `/backup/auto` | POST | Trigger auto-backup to file |
| `/backup/status` | GET | Backup dir, last date, count |
| `/health` | GET | Health check |

## Feature backlog

Ideas scoped but not yet built (from a 2026-10-02 planning pass):

- **Meeting series view** — group recurring meetings (1:1s, standups) and show their notes and outcomes over time in Review → Meetings. Apple Calendar identity is not a reliable series key (in the data so far only one pair of occurrences shared an event id), so: suggest series from normalized titles (case, punctuation, prefixes like "T2116 |") and let the user add/remove meetings, stored in a small table. Build after the Meetings/Links views have been in use.
- **Insights dashboard** — stat tiles + charts: time across workstreams, high-impact trend, meeting load, oncall days. (Medium–Large; some overlap with the self-review stats which already compute these counts.)
- **Restore-from-auto-backup UI** — auto-backup writes dated JSON files, but restore is only via manual upload. Add an endpoint to list backup files and restore by filename, plus a picker in Settings.
- **Open-TODO aggregator** — surface all `TODO`/`FIXME` keywords found across task/interaction notes in one "loose ends" list (the rehype plugin already identifies them for rendering).
- **Join links from the calendar** — when syncing, pull the Zoom/Teams/Meet link from the event's URL/location/notes into a link on the meeting (needs a `video` link type, the calendar reader to expose the URL, and a way to respect links the user deleted, like the deleted-meetings logic).
- **Task due dates + overdue view** — add a `due_date` to tasks and a "due soon / overdue" filter.
- **Quick-log interaction from the Log tab** + the ability to link an interaction to a specific task/meeting (not just a workstream). Interactions were intentionally kept to one person each; multi-person tagging was also deferred.

## Future Improvements

- **Markdown editor (CodeMirror 6):** `ClickToEditMarkdown` currently uses a plain `<textarea>` + `<ReactMarkdown>` preview tab. If syntax highlighting while typing becomes desirable, replace with CodeMirror 6 (`@codemirror/view` + `@codemirror/lang-markdown`). Avoid `@uiw/react-md-editor` — its overlay-textarea architecture conflicts with Tailwind v4 Preflight.
- **More highlight keywords (`web/src/lib/rehype-highlight-todo.ts`):** `TODO` (red) and `DONE` (green) are handled. To add `FIXME`, `BLOCKED`, etc., add the word to `KEYWORDS` and `CLASS_NAMES` in the plugin and a matching CSS rule in `index.css`.

## Rules

- **Never delete `worklog.db`** — always backup before schema changes. Use `ALTER TABLE ... RENAME COLUMN` for column renames. Add migration checks in `database.py` `init_db()`.
- All dates use local timezone via `todayStr()` from `web/src/api/date.ts` — never use `toISOString().split('T')[0]`.
- Custom dropdowns (StateDropdown, WorkstreamPicker, LabelPicker) instead of base-ui Select for display reliability.
- Backend builds with `api/.venv/bin/python`, frontend builds with `cd web && node_modules/.bin/vite build`.
- Git remote is `git@github-personal:corbantek/daily-work-log.git`. GPG signing enabled. Commit only when asked.
- The launchd agent runs uvicorn without `--reload`, so backend changes require `make restart-agent`.
