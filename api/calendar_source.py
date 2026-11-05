"""Read events from the macOS Calendar database via EventKit.

All EventKit access lives here so the rest of the app only sees plain
dataclasses, and so the sync logic can be tested without macOS.
"""
import sys
import threading
import time as _time
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import List, Optional

AVAILABLE = sys.platform == "darwin"

if AVAILABLE:
    try:
        from EventKit import (
            EKEntityTypeEvent,
            EKEventStatusCanceled,
            EKEventStore,
            EKParticipantStatusDeclined,
        )
        from Foundation import NSDate
    except ImportError:  # pyobjc not installed
        AVAILABLE = False

# EKAuthorizationStatus: 0 not determined, 1 restricted, 2 denied, 3 full access
# (named "authorized" in older SDKs), 4 write-only.
_STATUS_NAMES = {0: "not_determined", 1: "restricted", 2: "denied", 3: "authorized", 4: "write_only"}


@dataclass
class CalendarInfo:
    id: str
    title: str
    source: str


@dataclass
class CalendarEvent:
    external_id: str  # stable per occurrence (recurring events share eventIdentifier)
    title: str
    start: datetime  # local, naive
    duration_minutes: int
    all_day: bool
    declined: bool
    cancelled: bool
    calendar_id: str


# One long-lived store, used by one thread at a time. A fresh EKEventStore per call
# can come back with no calendars/events while it is still loading its sources, and
# concurrent stores (the ignore preview fires several requests while typing) made
# that far more likely.
_store = None
_lock = threading.RLock()


def _get_store():
    global _store
    if _store is None:
        _store = EKEventStore.alloc().init()
    return _store


def _calendars(store):
    """All event calendars; a store that is still loading reports none, so retry briefly."""
    for attempt in range(6):
        cals = list(store.calendarsForEntityType_(EKEntityTypeEvent) or [])
        if cals:
            return cals
        store.refreshSourcesIfNecessary()
        _time.sleep(0.25)
    return []


def authorization_status() -> str:
    """One of: unavailable, not_determined, restricted, denied, authorized, write_only."""
    if not AVAILABLE:
        return "unavailable"
    raw = EKEventStore.authorizationStatusForEntityType_(EKEntityTypeEvent)
    return _STATUS_NAMES.get(int(raw), "denied")


def request_access(timeout: float = 30) -> bool:
    """Ask for access. Only shows a prompt if the host process is allowed to."""
    if not AVAILABLE:
        return False
    store = EKEventStore.alloc().init()
    done = threading.Event()
    result = {}

    def cb(granted, error):
        result["granted"] = bool(granted)
        done.set()

    if hasattr(store, "requestFullAccessToEventsWithCompletion_"):
        store.requestFullAccessToEventsWithCompletion_(cb)
    else:
        store.requestAccessToEntityType_completion_(EKEntityTypeEvent, cb)
    done.wait(timeout)
    return result.get("granted", False)


def list_calendars() -> List[CalendarInfo]:
    if authorization_status() != "authorized":
        return []
    with _lock:
        return [
            CalendarInfo(id=str(c.calendarIdentifier()), title=str(c.title()), source=str(c.source().title()))
            for c in _calendars(_get_store())
        ]


def _to_ns(d: datetime):
    return NSDate.dateWithTimeIntervalSince1970_(d.timestamp())


def _is_declined(event) -> bool:
    for a in event.attendees() or []:
        if a.isCurrentUser() and int(a.participantStatus()) == int(EKParticipantStatusDeclined):
            return True
    return False


def fetch_events(day: date, calendar_ids: Optional[List[str]] = None) -> List[CalendarEvent]:
    """Events overlapping `day` (local time). Empty/None calendar_ids means all calendars."""
    return fetch_range(day, day, calendar_ids)


def fetch_range(first: date, last: date, calendar_ids: Optional[List[str]] = None) -> List[CalendarEvent]:
    """Events from the start of `first` to the end of `last` (local time), earliest first."""
    if authorization_status() != "authorized":
        raise PermissionError("Calendar access not granted")

    with _lock:
        store = _get_store()
        store.refreshSourcesIfNecessary()
        calendars = _calendars(store)
        if calendar_ids:
            wanted = set(calendar_ids)
            calendars = [c for c in calendars if str(c.calendarIdentifier()) in wanted]
            if not calendars:
                return []

        start = datetime.combine(first, time.min)
        end = datetime.combine(last, time.min) + timedelta(days=1)
        pred = store.predicateForEventsWithStartDate_endDate_calendars_(
            _to_ns(start), _to_ns(end), calendars if calendar_ids else None
        )
        events = []
        for e in store.eventsMatchingPredicate_(pred) or []:
            s = datetime.fromtimestamp(e.startDate().timeIntervalSince1970())
            en = datetime.fromtimestamp(e.endDate().timeIntervalSince1970())
            events.append(CalendarEvent(
                external_id=f"{e.eventIdentifier()}@{s.isoformat(timespec='minutes')}",
                title=str(e.title() or "(No title)"),
                start=s,
                duration_minutes=max(int((en - s).total_seconds() // 60), 0),
                all_day=bool(e.isAllDay()),
                declined=_is_declined(e),
                cancelled=int(e.status()) == int(EKEventStatusCanceled),
                calendar_id=str(e.calendar().calendarIdentifier()),
            ))
    events.sort(key=lambda ev: ev.start)
    return events
