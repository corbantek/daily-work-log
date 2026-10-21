from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import List, Optional
from datetime import date

from ..attachments import delete_meeting_attachments, read_attachment, unlink_stored
from ..database import get_session
from ..models import (
    Meeting, MeetingAttachment, MeetingCreate, MeetingLink, MeetingLinkRead, MeetingRead, MeetingUpdate,
    Task, TaskLinkCreate, MeetingTaskLink,
)
from .tasks import _enrich
from .calendar import record_dismissal

# Timed meetings first by start time; untimed (manual) ones after, in creation order.
MEETING_ORDER = (Meeting.start_time.is_(None), Meeting.start_time, Meeting.created_at)

router = APIRouter(prefix="/meetings", tags=["meetings"])


def _read_meeting(meeting: Meeting, session: Session) -> MeetingRead:
    task_links = session.exec(
        select(MeetingTaskLink).where(MeetingTaskLink.meeting_id == meeting.id)
    ).all()
    tasks = [_enrich(session.get(Task, tl.task_id), session) for tl in task_links if session.get(Task, tl.task_id)]
    attachments = session.exec(
        select(MeetingAttachment).where(MeetingAttachment.meeting_id == meeting.id).order_by(MeetingAttachment.created_at)
    ).all()
    links = session.exec(
        select(MeetingLink).where(MeetingLink.meeting_id == meeting.id).order_by(MeetingLink.created_at)
    ).all()
    return MeetingRead(
        **meeting.model_dump(), tasks=tasks, links=links,
        attachments=[read_attachment(a) for a in attachments],
    )


@router.get("", response_model=List[MeetingRead])
def list_meetings(on_date: Optional[date] = None, session: Session = Depends(get_session)):
    q = select(Meeting)
    if on_date:
        q = q.where(Meeting.date == on_date)
    meetings = session.exec(q.order_by(Meeting.date.desc(), *MEETING_ORDER)).all()
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
    record_dismissal(session, meeting)
    for link in session.exec(select(MeetingLink).where(MeetingLink.meeting_id == meeting_id)).all():
        session.delete(link)
    stored_names = delete_meeting_attachments(session, meeting_id)
    session.delete(meeting)
    session.commit()
    unlink_stored(stored_names)


# ── Meeting links ─────────────────────────────────────────────────────────────

@router.post("/{meeting_id}/links", response_model=MeetingLinkRead, status_code=201)
def add_link(meeting_id: str, body: TaskLinkCreate, session: Session = Depends(get_session)):
    if not session.get(Meeting, meeting_id):
        raise HTTPException(404)
    link = MeetingLink(meeting_id=meeting_id, **body.model_dump())
    session.add(link)
    session.commit()
    session.refresh(link)
    return link


@router.patch("/{meeting_id}/links/{link_id}", response_model=MeetingLinkRead)
def update_link(meeting_id: str, link_id: str, body: TaskLinkCreate, session: Session = Depends(get_session)):
    link = session.get(MeetingLink, link_id)
    if not link or link.meeting_id != meeting_id:
        raise HTTPException(404)
    for k, v in body.model_dump().items():
        setattr(link, k, v)
    session.add(link)
    session.commit()
    session.refresh(link)
    return link


@router.delete("/{meeting_id}/links/{link_id}", status_code=204)
def remove_link(meeting_id: str, link_id: str, session: Session = Depends(get_session)):
    link = session.get(MeetingLink, link_id)
    if not link or link.meeting_id != meeting_id:
        raise HTTPException(404)
    session.delete(link)
    session.commit()
