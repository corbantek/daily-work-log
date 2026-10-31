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
make install-skill  # link the Claude Code skill (agent-skill/daily-work-log) into ~/.claude/skills
make agent-smoke    # run the skill's curl recipes against a throwaway API (needs jq)

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
- **Dates on state changes** (`_state_dates` in `api/routes/tasks.py`, applied by `create_task` / `update_task` for every caller — app, agent, …): → in progress sets a missing start date; → complete sets end date (and a missing start); → abandoned sets end date; reopening clears the end date. Only when the request doesn't set that date itself (the frontend's `changeState` still sends them explicitly). Without an end date a finished task keeps showing as active in the Log.
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
- **Live updates (e.g. after the AI agent edits)**: the API keeps an **in-memory** change counter (`database.py`: bumped in an `after_commit` session hook when the commit wrote anything; never stored, not in backups) plus the newest `AgentActivity` id since start; `GET /changes` returns `{boot, version, agent_activity}`. The frontend polls it every 3 s while the tab is visible and at once on focus/visibility (`usePollForChanges`, `web/src/lib/live-updates.ts`, paused when hidden), and bumps `DataVersionContext`; data-showing parts call `useOnDataChange(reload, enabled)` to re-fetch **in place** — `DaySection` (quietly, no "Loading…"), the Review views while shown, the open `ItemDetailDialog`. `ClickToEditMarkdown` detects its note changing underneath an open editor and shows "updated elsewhere · Load latest · Keep mine"; until resolved it won't auto-save over the other change (a teardown keeps the user's text as a recoverable draft). `AgentToasts.tsx` shows brief "Agent · …" notices for agent changes made while the page is open (baseline = newest log entry at page load, so history is never replayed); clicking one opens the item.
- **Short references (T42 / M17 / P12)**: `Task.number` / `Meeting.number` / `Person.number` (unique). The migration numbers existing rows once, oldest first; new rows get the next number in a `before_flush` session hook (`database.py`), so every creation path (UI, agent, calendar sync, backup restore) is covered — restored rows keep theirs. High-water marks in settings `ref_counter_task` / `ref_counter_meeting` keep numbers from ever being reused after a delete. `api/refs.py` parses `T-42` / `t42` / `#42` / `42`. The UI shows a muted, click-to-copy `RefBadge` after titles (Log, Review views, detail dialog; plain `RefLabel` inside buttons such as ⌘K results); search puts an exact reference first; every `/agent` id parameter (path, `task_id`, `parent_id`) accepts a reference and responses carry `ref`.
- **Agent API + skill**: `api/routes/agent.py` (`/agent/*`) is a compact, name-based facade for a local AI agent, built on the existing task/meeting create/update functions so the app's rules still apply. Workstreams/labels by name (unknown or ambiguous → 400 with `valid`/`matches`), dates default to today, state aliases, notes append unless `mode: "replace"`, **no deletes**, every write logged to `AgentActivity` (`GET /agent/activity`, in backups). **Before every notes change the previous version is snapshotted** to `api/<db-name>-note-snapshots/<ref>--<UTC>.md` (`api/note_snapshots.py`, `WORKLOG_NOTE_SNAPSHOTS` to override; kept 30 days, pruned on save; deliberately not in JSON backups); responses carry `notes_backup`, and `GET /agent/notes-backups/{ref}[/{name}]` lists/reads them. The skill tells the agent to write follow-ups as `TODO:` (finished → `DONE:`, never "Next steps"; a task's What's Next holds only open TODOs, finished ones move into that day's Progress), and to rewrite a note (`mode: replace`) instead of appending when that would leave repeated information or finished TODOs, keeping every fact. Every task-note write also tidies that note (What's Next, status line, superseded Context kept with history, duplicate facts merged; never cuts past Progress, asks about apparent errors); a deeper cleanup only when the user asks ("tidy T32"), showing the cuts first. When a TODO is really its own piece of work (several sessions, its own PR/investigation, other people), the agent asks whether to split it into a sub-task; if yes, the sub-task's notes are written as a standalone handoff brief, the parent keeps a one-line `(T51)` pointer, and the agent gives a starting prompt for a fresh session. **Files**: `POST /agent/{tasks|meetings}/{ref}/files` (multipart `file`, via the app's own upload code: 25 MB limit, same serving rules), `GET …/{ref}/files` to list, `GET /agent/files/{file_id}` for details — text-like kinds (markdown/text/HTML) include `content` (capped at 200k chars, `truncated`), others return `content: null` plus the absolute `path` so Claude Code can read PDFs/images itself. Uploads are logged to `AgentActivity` (so they toast and refresh live). **People** (`api/routes/agent_people.py`, its own router under `/agent`): people by `P12`, id or unique name (an archived namesake doesn't make a name ambiguous; ambiguous → 400 with `matches`); create/update with `manager` by reference or name (`""` = none), `team`/`focus` (`""` = inherit), `placeholder`, `archived`; person notes append/replace with snapshots (`P12--….md`); `GET /agent/people/tree` shows only each node's own values; interactions with `sentiment` aliases and competency tags as `"Dimension"` / `"Dimension: attribute"` (unique partial match; `GET /agent/framework` lists them), `PATCH /agent/interactions/{id}` replaces tags/notes; `GET …/review-draft` is a compact peer-review draft. Person and interaction writes are logged with `entity_type="person"`, so the toast opens the person in the People tab. Tests point `WORKLOG_FILES` / `WORKLOG_NOTE_SNAPSHOTS` at a scratch dir (`api/tests/__init__.py`) so they never write into the app folder. `GET /agent/help` documents every endpoint (a test enforces it lists them all). The Claude Code skill is `agent-skill/daily-work-log/SKILL.md`; `make install-skill` symlinks it into `~/.claude/skills`; `make agent-smoke` (`scripts/agent_smoke.sh`) runs its curl recipes against a throwaway API. When you add or change an `/agent` endpoint, update `agent_help()` and the SKILL.md recipes together. Deferred agent features are listed in SPEC.md → Future Enhancements.
- **Navigation & URL**: the location lives in the URL hash — `""` (Log) / `#review/<meetings|tasks|links|self>` / `#people` (`parseRoute` / `routeHash` / `navigate()` in `App.tsx`; view names in `web/src/pages/review-views.ts`). `navigate()` pushes a history entry, so back/forward step between tabs and Review views and a reload returns to the same view; the Log's `?from=` stays in the query string alongside it (keep `location.hash` when rewriting the URL). The Review page is mounted on first visit and then kept hidden on other tabs, and each Review view is mounted on first visit and kept hidden behind the others, so ranges, filters and expanded cards survive switching; each view reloads its data when shown again (`useOnActivate`, `web/src/lib/use-on-activate.ts`). Review's views are an underline sub-nav pinned under the sticky header (`--app-header-h`, set from the header's measured height); it holds only the tabs — view actions like Export Markdown sit at the right of each view's filter bar, so the row has the same height on every view.
- **Exclude from stats**: `Meeting.exclude_from_stats` (bool, default false) leaves a meeting out of every meeting-utilization number — hours, share of work week, meeting count, "with notes", busiest day, hours-per-week chart (`/insights/meetings`) and Self-Review's meeting count — e.g. parties and conferences. It stays in the digest ("excluded" badge, duration struck through), outcomes and Links. Set only from the meeting edit form in the Log (`ExcludeFromStats.tsx`; Review is display-only); stats report `excluded_count` / `excluded_minutes` for the footnote. Calendar sync never changes it.
- **Passive meetings**: `Meeting.passive` (bool, default false) marks a meeting you attended without participating (worked through it). Unlike Exclude, it still counts as meeting time; `/insights/meetings` stats add `passive_count` / `passive_minutes`, `engaged_minutes` / `engaged_share` (total minus passive), per-week `passive_minutes` (the lighter top segment of the hours-per-week bars, color `--chart-passive` per theme) and `often_passive` (titles normalized by `title_key()`, passive ≥ 2 times in the range; opens the latest instance). Excluded and future meetings are ignored. Set by the one-click hover pill on a Log meeting row (`Passive.tsx` `PassiveToggle`), read-only `PassiveBadge` in Review; the agent API accepts `passive` on POST/PATCH meetings. Calendar sync never changes it.
- **Review insights (Review → Meetings / Links)**: read-only aggregations in `api/routes/insights.py`, no tables of their own. Both take `date_from` / `date_to`; the frontend's shared `DateRangePicker` offers This week (Mon–Sun) / Last week / This month / This quarter / This year / custom (`rangeForPreset()` in `web/src/api/date.ts`); Meetings, Links and Tasks share one range (state in `ReviewPage`, so it sticks as you switch between them; opens on This week); Self-Review keeps its own date fields, opening on the current review cycle. **Meetings** (`GET /insights/meetings`): stats (hours, share of work week = weekdays × 8 h minus days whose status contains vacation/sick/out of office/ooo/pto/holiday; meeting count; with notes; busiest day; hours per week) are counted **only through today** (`stats_through`) so a week in progress isn't diluted; overlapping meetings count twice. Digest = every meeting in the range in time order (frontend: meetings with no notes, tasks, links or files render as one compact line, hidden by the "Empty meetings (N)" toggle button; export follows the toggle), with a preview from a heading containing "summary" if present, else the first 12 lines (`notes_preview`; AI note formats vary), plus each meeting's linked tasks, links and files listed under the notes. Outcomes = a flat list of tasks linked to meetings in the range, **each task once** with every meeting it came from (`OutcomeTask.meetings`), open first, then done, then abandoned; the open/done counts count each task once. Markdown export is built in the frontend. **Links** (`GET /insights/links`): task + meeting links and attachments whose task/meeting is dated in the range — a task's date is end, else start, else created (same rule as the Tasks review and Self-Review); URLs inside notes are deliberately not included. Links merge by URL (trimmed, trailing `/` ignored; newest label and type win), files stay individual. The frontend groups them into one section per type (PR, Issue, Doc, Slack, Quip, Other, then Files; empty sections skipped), oldest first inside each by the date a link first appeared — consistent with the other Review views.
- **Org tree**: `Person.manager_id` links people into a personal org chart (people only, no team entities); `api/org.py` holds the logic. `team` and `focus` are **inherited**: blank (or whitespace) = the nearest manager's value, computed on read and never stored; setting one overrides it for that person and everyone below. `role` is personal. `PersonRead` carries `effective_team` / `effective_focus` (`{value, from_person_id, from_name}`), `chain` (managers, nearest first) and direct `reports`; `GET /people/tree` returns the forest (`OrgNode`, `report_count` = everyone below; archived people kept unless `include_archived=false`, then their reports hang off the nearest shown manager). The API refuses a manager that doesn't exist or would make a loop (400); deleting a person moves their reports up to the deleted person's manager. `is_placeholder` marks a stand-in for someone not identified yet. People have short refs **P12** (`Person.number`, same numbering hook and `ref_counter_person` high-water mark as T/M); search matches an explicit `P12` (a bare number stays T/M) and team/focus including inherited values.
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
- `PeoplePage.tsx` (page) — **Org tree | List** toggle (remembered in localStorage `worklog-people-view`, default tree), filter box (name/role/effective team/focus), add-person form (team/focus show the inherited value as placeholder, "Reports to" picker, "Not identified yet"; opened in context by the tree's "+ report" / "+ manager", where "+ manager" slots the new person between someone and their old manager), show-archived toggle; refreshes on live updates; routes to detail / review
- `OrgTree.tsx` — collapsible reporting-lines outline from `GET /people/tree` (collapsed ids in localStorage `worklog-org-collapsed`; people with no manager and no reports under "Unplaced"); `InheritedText` renders an inherited value muted/italic with "Inherited from X"
- `PersonPicker.tsx` — searchable custom person dropdown for "Reports to"; hides the person and everyone below them (`selfAndBelow`)
- `PersonDetail.tsx` — reporting-chain breadcrumbs, person header with P-ref and inherited team/focus ("via X"), inline edit (blank team/focus = inherit, not-identified flag), "Reports to" picker + direct reports with quick add, archive/restore/delete, editable markdown notes, interaction timeline with filters
- `InteractionForm.tsx` — log/edit an interaction (date, summary, sentiment, competency tags, markdown notes, workstream, high-impact)
- `CompetencyTagPicker.tsx` — grouped multi-select for competency tags; `dimensionColor()` helper for per-dimension colors
- `ReviewDraftView.tsx` — aggregated peer-review draft with Markdown export
- `ManageFramework.tsx` — dialog to edit competency dimensions/attributes (opened from Settings → Competency framework)
- `SelfReviewDraft.tsx` — your own year-end summary (stat tiles, high-impact highlights, tasks grouped by workstream) + Markdown export; shown via the Review tab's Tasks/Self-Review toggle
- `MeetingInsightsView.tsx` — Review → Meetings: stat tiles, hours-per-week chart (shown for ranges over one week), deduplicated outcomes list, then digest cards (preview / full notes, then the meeting's tasks, links and files), Markdown export (same order)
- `LinkedItems.tsx` — a task's/meeting's links and attached files, one per line; shared by the Review → Meetings digest and Review → Tasks cards
- `LinksView.tsx` — Review → Links: merged link/file list with search and type filter; sources open `ItemDetailDialog`
- `DateRangePicker.tsx` — preset + custom date range control used by Review → Meetings, Links and Tasks
- `CommandPalette.tsx` — ⌘K / Ctrl-K global search overlay; opens a person in the People tab, or a focused read-only detail (`ItemDetailDialog`) for a task/meeting (search opens this read-only recall dialog; its **Open in Log** button then jumps to the item)
- `Passive.tsx` — `PassiveToggle` (Log meeting row hover pill) and `PassiveBadge` (Review)
- `ItemDetailDialog.tsx` — read-only detail view for a task or meeting selected from search (state, workstream, dates, labels, links, notes, linked items)
- **Open in Log** (`web/src/lib/log-target.tsx`): `ItemDetailDialog` (opened from search and the Review views) has an *Open in Log* button that calls `openInLog` from `App.tsx` via `OpenInLogContext`. It closes the dialog, switches to the Log, extends `?from=` to the item's day if it isn't loaded, unhides the day if it is hidden (weekend / hidden by hand; creates a visibility override), and sets `LogTarget` (`LogTargetContext`, cleared after 5 s). The day (`DaySection`), workstream section (`WorkstreamSection`) and the row (`JumpTarget` wrapping `TaskRow` and each meeting card) open themselves, scroll to the middle and flash `.jump-highlight`. Day chosen by `logDateFor()`: meeting → its date; done/abandoned task → its end date (else start); open task → today. The target is never in the URL (a reload doesn't replay it).

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
| `/people/tree` | GET | Org tree (reporting lines, inherited team/focus; `?include_archived`) |
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
| `/agent/day`, `/agent/tasks`, `/agent/tasks/{id}`, `/agent/open`, `/agent/meetings`, `/agent/meetings/{id}`, `/agent/search`, `/agent/summary`, `/agent/activity`, `/agent/help` | GET | Agent API reads (compact, name-based) |
| `/agent/tasks`, `/agent/tasks/{id}/notes`, `/agent/tasks/{id}/links`, `/agent/meetings`, `/agent/meetings/{id}/notes`, `/agent/meetings/{id}/links`, `/agent/meetings/{id}/tasks` | POST | Agent API writes (create, append notes, add link, create/link task from meeting) |
| `/agent/tasks/{id}`, `/agent/meetings/{id}` | PATCH | Agent API updates |
| `/agent/tasks/{id}/files`, `/agent/meetings/{id}/files`, `/agent/files/{file_id}` | GET | List a task's/meeting's files; one file's details and text contents (or local path) |
| `/agent/tasks/{id}/files`, `/agent/meetings/{id}/files` | POST | Agent attaches a file (multipart `file`, 25 MB) |
| `/agent/notes-backups/{ref}`, `/agent/notes-backups/{ref}/{name}` | GET | Earlier versions of a note (task, meeting or person), saved before each agent notes change (30 days) |
| `/agent/people`, `/agent/people/tree`, `/agent/people/{id}`, `/agent/people/{id}/interactions`, `/agent/people/{id}/review-draft`, `/agent/framework` | GET | Agent API people reads (org tree, details, interactions, review draft, competency tags) |
| `/agent/people`, `/agent/people/{id}/notes`, `/agent/people/{id}/interactions` | POST | Agent adds a person, person notes, logs an interaction |
| `/agent/people/{id}`, `/agent/interactions/{id}` | PATCH | Agent updates a person (manager, team, focus, …) / an interaction |
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
| `/changes` | GET | In-memory change counter + newest agent activity id (polled for live updates) |
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
