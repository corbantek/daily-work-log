import hashlib
import json
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from .. import calendar_source
from ..database import get_session
from ..models import DismissedCalendarEvent, Meeting, Setting

router = APIRouter(prefix="/calendar", tags=["calendar"])

SOURCE = "apple_calendar"


class CalendarOut(BaseModel):
    id: str
    title: str
    source: str


class CalendarStatus(BaseModel):
    status: str  # unavailable | not_determined | restricted | denied | authorized | write_only
    calendars: List[CalendarOut] = []


class SyncResult(BaseModel):
    created: int = 0
    updated: int = 0
    linked: int = 0   # existing manual meetings adopted by a matching calendar event
    flagged: int = 0  # imported meetings no longer on the calendar
    skipped: int = 0  # events you deleted earlier and that haven't changed since


def _setting(session: Session, key: str, default: str) -> str:
    row = session.get(Setting, key)
    return row.value if row and row.value != "" else default


def _calendar_ids(session: Session) -> List[str]:
    try:
        ids = json.loads(_setting(session, "calendar_included_ids", "[]"))
    except ValueError:
        return []
    return [i for i in ids if isinstance(i, str)]


DISMISSAL_RETENTION_DAYS = 90


def event_fingerprint(title: str, day: str, start_time: str, duration_minutes) -> str:
    """Identity of an event's visible details; a change means it was edited."""
    raw = f"{title}|{day}|{start_time}|{duration_minutes}"
    return hashlib.sha1(raw.encode()).hexdigest()


def _remember_deleted(session: Session) -> bool:
    return _setting(session, "calendar_remember_deleted", "true") == "true"


def _prune_dismissed(session: Session) -> None:
    """Drop dismissals older than the retention window, measured from today."""
    cutoff = date.today() - timedelta(days=DISMISSAL_RETENTION_DAYS)
    for d in session.exec(select(DismissedCalendarEvent).where(DismissedCalendarEvent.date < cutoff)).all():
        session.delete(d)


def record_dismissal(session: Session, meeting: Meeting) -> None:
    """Called when a meeting is deleted: remember imported ones so sync won't recreate them."""
    if meeting.source != SOURCE or not meeting.external_id or not _remember_deleted(session):
        return
    # Rows imported before fingerprints existed fall back to their own fields.
    fingerprint = meeting.source_fingerprint or event_fingerprint(
        meeting.title, meeting.date.isoformat(), meeting.start_time or "", meeting.duration_minutes
    )
    existing = session.get(DismissedCalendarEvent, meeting.external_id)
    if existing:
        session.delete(existing)
        session.flush()
    session.add(DismissedCalendarEvent(
        external_id=meeting.external_id, fingerprint=fingerprint, title=meeting.title,
        date=meeting.date, start_time=meeting.start_time,
    ))


def apply_events(session: Session, day: date, events: List[calendar_source.CalendarEvent],
                 skip_declined: bool = True, skip_allday: bool = True) -> SyncResult:
    """Upsert `events` (already fetched for `day`) into Meeting rows.

    Only title/date/duration/start_time of imported meetings are ever overwritten;
    notes and task links belong to the user. Meetings that vanished from the
    calendar are flagged, never deleted.
    """
    result = SyncResult()
    dismissed = {d.external_id: d for d in session.exec(select(DismissedCalendarEvent)).all()}
    honor_dismissed = _remember_deleted(session)
    wanted = [
        e for e in events
        if not e.cancelled
        and not (skip_declined and e.declined)
        and not (skip_allday and e.all_day)
    ]
    wanted_ids = {e.external_id for e in wanted}

    imported = session.exec(select(Meeting).where(Meeting.source == SOURCE)).all()
    by_ext = {m.external_id: m for m in imported}
    manual_today = [
        m for m in session.exec(select(Meeting).where(Meeting.date == day)).all()
        if m.source is None
    ]

    for e in wanted:
        start_time = e.start.strftime("%H:%M")
        fingerprint = event_fingerprint(e.title, e.start.date().isoformat(), start_time, e.duration_minutes)

        gone = dismissed.get(e.external_id)
        if gone and honor_dismissed:
            if gone.fingerprint == fingerprint:
                result.skipped += 1
                continue
            session.delete(gone)  # edited on the calendar since: bring it back

        fields = dict(
            title=e.title, date=e.start.date(), duration_minutes=e.duration_minutes,
            start_time=start_time, missing_from_source=False, source_fingerprint=fingerprint,
        )
        m = by_ext.get(e.external_id)
        if m:
            if any(getattr(m, k) != v for k, v in fields.items()):
                result.updated += 1
            for k, v in fields.items():
                setattr(m, k, v)
            session.add(m)
            continue

        # A hand-entered meeting with the same title: adopt it instead of duplicating.
        twin = next((x for x in manual_today if x.title.strip().lower() == e.title.strip().lower()), None)
        if twin:
            manual_today.remove(twin)
            for k, v in fields.items():
                if k == "title":
                    continue  # keep the user's wording
                setattr(twin, k, v)
            twin.source, twin.external_id = SOURCE, e.external_id
            session.add(twin)
            result.linked += 1
            continue

        session.add(Meeting(source=SOURCE, external_id=e.external_id, **fields))
        result.created += 1

    for m in imported:
        if m.date == day and m.external_id not in wanted_ids and not m.missing_from_source:
            m.missing_from_source = True
            session.add(m)
            result.flagged += 1

    _prune_dismissed(session)
    session.commit()
    return result


@router.get("/status", response_model=CalendarStatus)
def calendar_status(session: Session = Depends(get_session)):
    status = calendar_source.authorization_status()
    calendars = calendar_source.list_calendars() if status == "authorized" else []
    return CalendarStatus(status=status, calendars=[CalendarOut(**c.__dict__) for c in calendars])


@router.post("/request-access", response_model=CalendarStatus)
def request_access(session: Session = Depends(get_session)):
    calendar_source.request_access()
    return calendar_status(session)


@router.post("/sync", response_model=SyncResult)
def sync_day(date: date, session: Session = Depends(get_session)):  # noqa: A002 (query param name)
    status = calendar_source.authorization_status()
    if status == "unavailable":
        raise HTTPException(501, "Calendar sync is only available on macOS with pyobjc-framework-EventKit installed")
    if status == "not_determined":
        calendar_source.request_access()
        status = calendar_source.authorization_status()
    if status != "authorized":
        raise HTTPException(403, f"Calendar access not granted ({status})")
    events = calendar_source.fetch_events(date, _calendar_ids(session) or None)
    return apply_events(
        session, date, events,
        skip_declined=_setting(session, "calendar_skip_declined", "true") == "true",
        skip_allday=_setting(session, "calendar_skip_allday", "true") == "true",
    )


class DismissedOut(BaseModel):
    external_id: str
    title: str
    date: date
    start_time: Optional[str] = None
    dismissed_at: datetime


@router.get("/dismissed", response_model=List[DismissedOut])
def list_dismissed(session: Session = Depends(get_session)):
    _prune_dismissed(session)
    session.commit()
    rows = session.exec(
        select(DismissedCalendarEvent).order_by(DismissedCalendarEvent.date.desc(), DismissedCalendarEvent.start_time)
    ).all()
    return [DismissedOut(**r.model_dump()) for r in rows]


@router.delete("/dismissed", status_code=204)
def clear_dismissed(session: Session = Depends(get_session)):
    """Forget every dismissal; still-existing events return on the next sync of their day."""
    for row in session.exec(select(DismissedCalendarEvent)).all():
        session.delete(row)
    session.commit()


@router.delete("/dismissed/{external_id:path}", status_code=204)
def restore_dismissed(external_id: str, session: Session = Depends(get_session)):
    """Forget a dismissal; the event returns on the next sync of its day."""
    row = session.get(DismissedCalendarEvent, external_id)
    if not row:
        raise HTTPException(404)
    session.delete(row)
    session.commit()
