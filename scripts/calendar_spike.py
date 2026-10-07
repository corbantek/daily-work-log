"""Spike: can this process read today's Apple Calendar events via EventKit?

Run from a terminal:   api/.venv/bin/python scripts/calendar_spike.py [YYYY-MM-DD]
Then run it again under launchd (see the plist note in the output) to check
whether the background agent can get Calendar permission.
"""
import sys
import threading
from datetime import date, datetime, time, timedelta

from EventKit import (
    EKEntityTypeEvent,
    EKEventStore,
    EKAuthorizationStatusNotDetermined,
)
from Foundation import NSDate

STATUS = {0: "not determined", 1: "restricted", 2: "denied", 3: "full access", 4: "write only"}

store = EKEventStore.alloc().init()
status = EKEventStore.authorizationStatusForEntityType_(EKEntityTypeEvent)
print(f"authorization status: {STATUS.get(status, status)}")

if status == EKAuthorizationStatusNotDetermined:
    done = threading.Event()
    result = {}

    def cb(granted, error):
        result["granted"], result["error"] = granted, error
        done.set()

    if hasattr(store, "requestFullAccessToEventsWithCompletion_"):
        store.requestFullAccessToEventsWithCompletion_(cb)
    else:
        store.requestAccessToEntityType_completion_(EKEntityTypeEvent, cb)
    if not done.wait(60):
        print("no response to permission request within 60s (prompt likely never shown)")
        sys.exit(1)
    print(f"permission request result: {result}")

day = date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else date.today()
start = datetime.combine(day, time.min)
end = start + timedelta(days=1)
to_ns = lambda d: NSDate.dateWithTimeIntervalSince1970_(d.timestamp())

calendars = store.calendarsForEntityType_(EKEntityTypeEvent)
print(f"calendars visible: {len(calendars)}")
for c in calendars:
    print(f"  - {c.title()} [{c.source().title()}]")

pred = store.predicateForEventsWithStartDate_endDate_calendars_(to_ns(start), to_ns(end), None)
events = sorted(store.eventsMatchingPredicate_(pred) or [], key=lambda e: e.startDate().timeIntervalSince1970())
print(f"events on {day}: {len(events)}")
for e in events:
    s, en = e.startDate().timeIntervalSince1970(), e.endDate().timeIntervalSince1970()
    print(f"  {datetime.fromtimestamp(s):%H:%M} ({int((en - s) // 60)}m) {e.title()}"
          f"{' [all-day]' if e.isAllDay() else ''} id={e.eventIdentifier()}")
