import json
from pathlib import Path
from fastapi import APIRouter, Depends, UploadFile, File
from fastapi.responses import JSONResponse
from sqlmodel import Session, select
from datetime import datetime, date

from ..database import get_session, engine
from ..models import (
    Workstream, Task, Label, TaskLabelLink, TaskLink,
    Meeting, MeetingTaskLink, Setting, DayStatus, DayVisibility, OncallPeriod,
    Person, Interaction, InteractionTag, CompetencyDimension, CompetencyAttribute,
)

router = APIRouter(prefix="/backup", tags=["backup"])

TABLES = [
    ("workstreams", Workstream),
    ("labels", Label),
    ("tasks", Task),
    ("task_labels", TaskLabelLink),
    ("task_links", TaskLink),
    ("meetings", Meeting),
    ("meeting_tasks", MeetingTaskLink),
    ("settings", Setting),
    ("day_statuses", DayStatus),
    ("day_visibility", DayVisibility),
    ("oncall_periods", OncallPeriod),
    ("competency_dimensions", CompetencyDimension),
    ("competency_attributes", CompetencyAttribute),
    ("people", Person),
    ("interactions", Interaction),
    ("interaction_tags", InteractionTag),
]

DEFAULT_BACKUP_DIR = "~/daily-work-log-backups"
DEFAULT_RETENTION_DAYS = 14


def _serialize(obj) -> dict:
    d = {}
    for k, v in obj.__dict__.items():
        if k.startswith("_"):
            continue
        if isinstance(v, datetime):
            d[k] = v.isoformat()
        elif hasattr(v, "isoformat"):
            d[k] = v.isoformat()
        else:
            d[k] = v
    return d


def _get_backup_settings(session: Session) -> tuple[str, int]:
    backup_dir = DEFAULT_BACKUP_DIR
    retention_days = DEFAULT_RETENTION_DAYS
    row = session.get(Setting, "backup_dir")
    if row and row.value:
        backup_dir = row.value
    row = session.get(Setting, "backup_retention_days")
    if row and row.value:
        try:
            retention_days = int(row.value)
        except ValueError:
            pass
    return backup_dir, retention_days


def _export_data(session: Session) -> dict:
    data = {}
    for name, model in TABLES:
        rows = session.exec(select(model)).all()
        data[name] = [_serialize(r) for r in rows]
    data["_meta"] = {
        "exported_at": datetime.utcnow().isoformat(),
        "version": 1,
    }
    return data


def _prune_old_backups(backup_path: Path, retention_days: int) -> int:
    if not backup_path.is_dir():
        return 0
    files = sorted(backup_path.glob("worklog-backup-*.json"), reverse=True)
    removed = 0
    for f in files[retention_days:]:
        f.unlink()
        removed += 1
    return removed


@router.get("")
def export_backup(session: Session = Depends(get_session)):
    return JSONResponse(content=_export_data(session))


@router.post("")
async def import_backup(file: UploadFile = File(...), session: Session = Depends(get_session)):
    content = await file.read()
    data = json.loads(content)

    for name, model in reversed(TABLES):
        rows = session.exec(select(model)).all()
        for r in rows:
            session.delete(r)
    session.commit()

    for name, model in TABLES:
        if name not in data:
            continue
        for row_data in data[name]:
            row_data.pop("_sa_instance_state", None)
            obj = model(**row_data)
            session.add(obj)
    session.commit()

    return {"status": "ok", "tables_restored": [name for name, _ in TABLES if name in data]}


@router.post("/auto")
def run_auto_backup(session: Session = Depends(get_session)):
    backup_dir, retention_days = _get_backup_settings(session)
    backup_path = Path(backup_dir).expanduser().resolve()
    backup_path.mkdir(parents=True, exist_ok=True)

    today_str = date.today().isoformat()
    filename = f"worklog-backup-{today_str}.json"
    filepath = backup_path / filename

    data = _export_data(session)
    filepath.write_text(json.dumps(data, indent=2))

    pruned = _prune_old_backups(backup_path, retention_days)

    return {
        "status": "ok",
        "file": str(filepath),
        "date": today_str,
        "pruned": pruned,
    }


@router.get("/status")
def backup_status(session: Session = Depends(get_session)):
    backup_dir, retention_days = _get_backup_settings(session)
    backup_path = Path(backup_dir).expanduser().resolve()

    last_backup = None
    backup_count = 0
    if backup_path.is_dir():
        files = sorted(backup_path.glob("worklog-backup-*.json"), reverse=True)
        backup_count = len(files)
        if files:
            name = files[0].stem
            last_backup = name.replace("worklog-backup-", "")

    return {
        "backup_dir": backup_dir,
        "backup_dir_resolved": str(backup_path),
        "retention_days": retention_days,
        "last_backup": last_backup,
        "backup_count": backup_count,
    }
