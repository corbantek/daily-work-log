import hashlib
import json
import re
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
    ignored: int = 0  # events matching an ignore rule (Settings → Calendar)


def _setting(session: Session, key: str, default: str) -> str:
    row = session.get(Setting, key)
    return row.value if row and row.value != "" else default


def _calendar_ids(session: Session) -> List[str]:
    try:
        ids = json.loads(_setting(session, "calendar_included_ids", "[]"))
    except ValueError:
        return []
    return [i for i in ids if isinstance(i, str)]


def _ignore_rules(session: Session) -> List[dict]:
    """Rules from the `calendar_ignore_rules` setting: [{"pattern": str, "regex": bool}, ...]."""
    try:
        rules = json.loads(_setting(session, "calendar_ignore_rules", "[]"))
    except ValueError:
        return []
    return [r for r in rules if isinstance(r, dict) and isinstance(r.get("pattern"), str) and r["pattern"].strip()] \
        if isinstance(rules, list) else []


def is_ignored(title: str, rules: List[dict]) -> bool:
    """Case-insensitive match: plain rules are 'title contains', regex rules use re.search.

    A rule whose regex doesn't compile never matches, so a typo can't break sync.
    """
    for r in rules:
        pattern = r["pattern"].strip()
        if r.get("regex"):
            try:
                if re.search(pattern, title, re.IGNORECASE):
                    return True
            except re.error:
                continue
        elif pattern.lower() in title.lower():
            return True
    return False


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


def importable(events: List[calendar_source.CalendarEvent], skip_declined: bool, skip_allday: bool):
    return [
        e for e in events
        if not e.cancelled
        and not (skip_declined and e.declined)
        and not (skip_allday and e.all_day)
    ]


def apply_events(session: Session, day: date, events: List[calendar_source.CalendarEvent],
                 skip_declined: bool = True, skip_allday: bool = True,
                 ignore_rules: Optional[List[dict]] = None) -> SyncResult:
    """Upsert `events` (already fetched for `day`) into Meeting rows.

    Only title/date/duration/start_time of imported meetings are ever overwritten;
    notes and task links belong to the user. Meetings that vanished from the
    calendar are flagged, never deleted.
    """
    result = SyncResult()
    dismissed = {d.external_id: d for d in session.exec(select(DismissedCalendarEvent)).all()}
    honor_dismissed = _remember_deleted(session)
    candidates = importable(events, skip_declined, skip_allday)
    # Ignored events are never created; ones imported earlier get flagged like any vanished event.
    wanted = [e for e in candidates if not is_ignored(e.title, ignore_rules or [])]
    result.ignored = len(candidates) - len(wanted)
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
        ignore_rules=_ignore_rules(session),
    )


PREVIEW_DAYS = 14


class IgnoreRule(BaseModel):
    pattern: str
    regex: bool = False


class IgnoreMatch(BaseModel):
    date: date
    title: str
    start_time: Optional[str] = None


@router.post("/ignore-preview", response_model=List[IgnoreMatch])
def ignore_preview(rule: IgnoreRule, session: Session = Depends(get_session)):
    """Events from the last 14 days (the ones sync would import) that `rule` would hide."""
    if not rule.pattern.strip():
        return []
    if rule.regex:
        try:
            re.compile(rule.pattern.strip())
        except re.error as e:
            raise HTTPException(400, f"Invalid regex: {e}")
    if calendar_source.authorization_status() != "authorized":
        raise HTTPException(403, "Calendar access not granted")
    skip_declined = _setting(session, "calendar_skip_declined", "true") == "true"
    skip_allday = _setting(session, "calendar_skip_allday", "true") == "true"
    calendar_ids = _calendar_ids(session) or None
    rules = [rule.dict()]
    today = date.today()
    events = calendar_source.fetch_range(today - timedelta(days=PREVIEW_DAYS - 1), today, calendar_ids)
    matches = [
        IgnoreMatch(date=e.start.date(), title=e.title, start_time=e.start.strftime("%H:%M"))
        for e in importable(events, skip_declined, skip_allday)
        if is_ignored(e.title, rules)
    ]
    matches.sort(key=lambda m: (m.date, m.start_time or ""), reverse=True)
    return matches


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
