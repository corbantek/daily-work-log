import json
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from .. import calendar_source
from ..database import get_session
from ..models import Meeting, Setting

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


def _setting(session: Session, key: str, default: str) -> str:
    row = session.get(Setting, key)
    return row.value if row and row.value != "" else default


def _calendar_ids(session: Session) -> List[str]:
    try:
        ids = json.loads(_setting(session, "calendar_included_ids", "[]"))
    except ValueError:
        return []
    return [i for i in ids if isinstance(i, str)]


def apply_events(session: Session, day: date, events: List[calendar_source.CalendarEvent],
                 skip_declined: bool = True, skip_allday: bool = True) -> SyncResult:
    """Upsert `events` (already fetched for `day`) into Meeting rows.

    Only title/date/duration/start_time of imported meetings are ever overwritten;
    notes and task links belong to the user. Meetings that vanished from the
    calendar are flagged, never deleted.
    """
    result = SyncResult()
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
        fields = dict(
            title=e.title, date=e.start.date(), duration_minutes=e.duration_minutes,
            start_time=e.start.strftime("%H:%M"), missing_from_source=False,
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
