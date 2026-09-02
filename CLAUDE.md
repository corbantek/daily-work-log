# Daily Work Log

Personal app for tracking daily tasks, meetings, and workstreams.

## Project Structure

```
api/           Python FastAPI backend (SQLite via SQLModel)
  models.py    All DB models + request/response types
  database.py  Engine, session, migrations
  routes/      REST endpoints
  worklog.db   SQLite database (gitignored)

web/           React + Vite + TypeScript frontend
  src/api/     API client, types, date utils
  src/components/  UI components (shadcn/ui based)
  src/pages/   Page-level views
```

## Running

```bash
make install   # first time: create venv, install pip + npm deps
make dev       # starts API on :8000 and Vite on :5173
```

## Future Improvements

- **Markdown editor (CodeMirror 6):** `ClickToEditMarkdown` currently uses a plain `<textarea>` + `<ReactMarkdown>` preview tab (Option A). If syntax highlighting while typing becomes desirable, replace with CodeMirror 6 (`@codemirror/view` + `@codemirror/lang-markdown` + `@codemirror/theme-one-dark` or similar). CodeMirror 6 manages its own DOM fully so it has no Tailwind CSS interference, and has best-in-class cursor/selection behavior. Avoid `@uiw/react-md-editor` — its overlay-textarea architecture conflicts with Tailwind v4 Preflight.

## Rules

- **Never delete `worklog.db`** — always backup before schema changes. Use `ALTER TABLE ... RENAME COLUMN` for column renames. Add migration checks in `database.py` `init_db()`.
- All dates use local timezone via `todayStr()` from `web/src/api/date.ts` — never use `toISOString().split('T')[0]`.
- Custom dropdowns (StateDropdown, WorkstreamPicker, LabelPicker) instead of base-ui Select for display reliability.
- Backend builds with `api/.venv/bin/python`, frontend builds with `cd web && node_modules/.bin/vite build`.
