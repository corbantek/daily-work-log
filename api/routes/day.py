from fastapi import APIRouter, Depends
from sqlmodel import Session, select
from sqlalchemy import or_, and_, cast, Date
from datetime import date
from typing import Optional

from ..database import get_session
from ..models import (
    Task, Meeting, Workstream, MeetingTaskLink, TaskState,
    DayView, WorkstreamWithTasks, WorkstreamRead, MeetingRead,
)
from .tasks import _enrich
from .meetings import _read_meeting

router = APIRouter(prefix="/day", tags=["day"])


@router.get("/{day}", response_model=DayView)
def get_day(day: date, session: Session = Depends(get_session)):
    today = date.today()
    tasks_q = select(Task).where(
        or_(
            # TODO tasks (no start_date): only show on today
            and_(Task.start_date == None, day == today),
            # Started tasks: show from start_date through end_date (or ongoing)
            and_(
                Task.start_date != None,
                Task.start_date <= day,
                or_(Task.end_date == None, Task.end_date >= day),
            ),
        )
    )
    raw_tasks = session.exec(tasks_q.order_by(Task.created_at)).all()
    enriched = [_enrich(t, session) for t in raw_tasks]

    ws_map: dict[Optional[str], list] = {}
    for t in enriched:
        ws_map.setdefault(t.workstream_id, []).append(t)

    # Only include workstreams that actually have tasks on this day.
    # Includes archived workstreams if they still have active tasks.
    ws_ids_with_tasks = [wid for wid in ws_map if wid is not None]
    all_ws = session.exec(select(Workstream)).all()
    ws_by_id = {ws.id: ws for ws in all_ws}

    ws_sections = []
    for wid in ws_ids_with_tasks:
        ws = ws_by_id.get(wid)
        if ws:
            ws_sections.append(WorkstreamWithTasks(
                workstream=WorkstreamRead.model_validate(ws),
                tasks=ws_map[wid],
            ))

    # Sort: active workstreams first, then archived — alphabetical within each group
    ws_sections.sort(key=lambda s: (
        1 if s.workstream and s.workstream.archived_at else 0,
        (s.workstream.name or '').lower() if s.workstream else '',
    ))

    unassigned = ws_map.get(None, [])
    if unassigned:
        ws_sections.append(WorkstreamWithTasks(workstream=None, tasks=unassigned))

    meetings_raw = session.exec(
        select(Meeting).where(Meeting.date == day).order_by(Meeting.created_at)
    ).all()
    meetings = [_read_meeting(m, session) for m in meetings_raw]

    return DayView(date=day, meetings=meetings, workstreams=ws_sections)
