import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session

from .database import init_db, engine
from .routes import workstreams, tasks, meetings, labels, day, day_status, day_visibility, backup, settings, oncall, people, interactions, framework, review_draft, self_review, search
from .routes.backup import _get_backup_settings, _export_data, _prune_old_backups, DEFAULT_BACKUP_DIR

logger = logging.getLogger("daily-work-log")


async def _daily_backup_loop():
    while True:
        try:
            with Session(engine) as session:
                backup_dir, retention_days = _get_backup_settings(session)
                backup_path = Path(backup_dir).expanduser().resolve()
                today_str = date.today().isoformat()
                filepath = backup_path / f"worklog-backup-{today_str}.json"

                if not filepath.exists():
                    import json
                    backup_path.mkdir(parents=True, exist_ok=True)
                    data = _export_data(session)
                    filepath.write_text(json.dumps(data, indent=2))
                    _prune_old_backups(backup_path, retention_days)
                    logger.info("Auto-backup written to %s", filepath)
        except Exception:
            logger.exception("Auto-backup failed")

        await asyncio.sleep(3600)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    task = asyncio.create_task(_daily_backup_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Daily Work Log", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True}


app.include_router(workstreams.router)
app.include_router(tasks.router)
app.include_router(meetings.router)
app.include_router(labels.router)
app.include_router(day.router)
app.include_router(day_status.router)
app.include_router(day_visibility.router)
app.include_router(backup.router)
app.include_router(settings.router)
app.include_router(oncall.router)
app.include_router(people.router)
app.include_router(interactions.router)
app.include_router(framework.router)
app.include_router(review_draft.router)
app.include_router(self_review.router)
app.include_router(search.router)
