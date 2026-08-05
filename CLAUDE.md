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

## Rules

- **Never delete `worklog.db`** — always backup before schema changes. Use `ALTER TABLE ... RENAME COLUMN` for column renames. Add migration checks in `database.py` `init_db()`.
- All dates use local timezone via `todayStr()` from `web/src/api/date.ts` — never use `toISOString().split('T')[0]`.
- Custom dropdowns (StateDropdown, WorkstreamPicker, LabelPicker) instead of base-ui Select for display reliability.
- Backend builds with `api/.venv/bin/python`, frontend builds with `cd web && node_modules/.bin/vite build`.
