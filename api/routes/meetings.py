from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import List, Optional
from datetime import date

from ..database import get_session
from ..models import Meeting, MeetingCreate, MeetingRead, MeetingUpdate, Task, MeetingTaskLink
from .tasks import _enrich

router = APIRouter(prefix="/meetings", tags=["meetings"])


def _read_meeting(meeting: Meeting, session: Session) -> MeetingRead:
    task_links = session.exec(
        select(MeetingTaskLink).where(MeetingTaskLink.meeting_id == meeting.id)
    ).all()
    tasks = [_enrich(session.get(Task, tl.task_id), session) for tl in task_links if session.get(Task, tl.task_id)]
    return MeetingRead(**meeting.model_dump(), tasks=tasks)


@router.get("", response_model=List[MeetingRead])
def list_meetings(on_date: Optional[date] = None, session: Session = Depends(get_session)):
    q = select(Meeting)
    if on_date:
        q = q.where(Meeting.date == on_date)
    meetings = session.exec(q.order_by(Meeting.date.desc(), Meeting.created_at)).all()
    return [_read_meeting(m, session) for m in meetings]


@router.post("", response_model=MeetingRead, status_code=201)
def create_meeting(body: MeetingCreate, session: Session = Depends(get_session)):
    data = body.model_dump(exclude={"task_ids"})
    meeting = Meeting(**data)
    session.add(meeting)
    session.flush()
    for tid in body.task_ids:
        if session.get(Task, tid):
            session.add(MeetingTaskLink(meeting_id=meeting.id, task_id=tid))
    session.commit()
    session.refresh(meeting)
    return _read_meeting(meeting, session)


@router.get("/{meeting_id}", response_model=MeetingRead)
def get_meeting(meeting_id: str, session: Session = Depends(get_session)):
    meeting = session.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(404)
    return _read_meeting(meeting, session)


@router.patch("/{meeting_id}", response_model=MeetingRead)
def update_meeting(meeting_id: str, body: MeetingUpdate, session: Session = Depends(get_session)):
    meeting = session.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(404)
    data = body.model_dump(exclude_unset=True, exclude={"task_ids"})
    for k, v in data.items():
        setattr(meeting, k, v)
    if body.task_ids is not None:
        existing = session.exec(
            select(MeetingTaskLink).where(MeetingTaskLink.meeting_id == meeting_id)
        ).all()
        for link in existing:
            session.delete(link)
        for tid in body.task_ids:
            if session.get(Task, tid):
                session.add(MeetingTaskLink(meeting_id=meeting.id, task_id=tid))
    session.add(meeting)
    session.commit()
    session.refresh(meeting)
    return _read_meeting(meeting, session)


@router.delete("/{meeting_id}", status_code=204)
def delete_meeting(meeting_id: str, session: Session = Depends(get_session)):
    meeting = session.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(404)
    for link in session.exec(select(MeetingTaskLink).where(MeetingTaskLink.meeting_id == meeting_id)).all():
        session.delete(link)
    session.delete(meeting)
    session.commit()
