from fastapi import APIRouter, Depends, UploadFile, File
from fastapi.responses import JSONResponse
from sqlmodel import Session, select
from datetime import datetime

from ..database import get_session
from ..models import (
    Workstream, Task, Label, TaskLabelLink, TaskLink,
    Meeting, MeetingTaskLink, Setting, DayStatus,
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
]


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


@router.get("")
def export_backup(session: Session = Depends(get_session)):
    data = {}
    for name, model in TABLES:
        rows = session.exec(select(model)).all()
        data[name] = [_serialize(r) for r in rows]
    data["_meta"] = {
        "exported_at": datetime.utcnow().isoformat(),
        "version": 1,
    }
    return JSONResponse(content=data)


@router.post("")
async def import_backup(file: UploadFile = File(...), session: Session = Depends(get_session)):
    import json
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
