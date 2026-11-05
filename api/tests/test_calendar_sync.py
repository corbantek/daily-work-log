"""Calendar sync behavior. Run: api/.venv/bin/python -m unittest discover -s api/tests -t ."""
import unittest
from datetime import date, datetime, timedelta

from sqlmodel import Session, SQLModel, create_engine, select

from api.calendar_source import CalendarEvent
from api.models import DismissedCalendarEvent, Meeting, MeetingCreate, MeetingUpdate, Setting
from api.routes.calendar import apply_events, clear_dismissed, list_dismissed, restore_dismissed
from api.routes.day import get_day
from api.routes.meetings import delete_meeting

DAY = date(2026, 10, 7)


def ev(ext_id, title, hour, minute=0, duration=30, **kw):
    base = dict(
        external_id=ext_id, title=title, start=datetime(2026, 10, 7, hour, minute),
        duration_minutes=duration, all_day=False, declined=False, cancelled=False, calendar_id="c",
    )
    base.update(kw)
    return CalendarEvent(**base)


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(self.engine)
        self.session = Session(self.engine)

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def titles(self):
        return [m["title"] if isinstance(m, dict) else m.title for m in self.session.exec(select(Meeting)).all()]

    def meeting(self, title):
        return self.session.exec(select(Meeting).where(Meeting.title == title)).one()

    def delete(self, title):
        delete_meeting(self.meeting(title).id, self.session)

    def test_deleted_event_stays_deleted(self):
        apply_events(self.session, DAY, [ev("a", "Standup", 9), ev("b", "Sync", 10)])
        self.delete("Sync")
        r = apply_events(self.session, DAY, [ev("a", "Standup", 9), ev("b", "Sync", 10)])
        self.assertEqual(self.titles(), ["Standup"])
        self.assertEqual((r.created, r.skipped), (0, 1))

    def test_edited_title_or_duration_brings_it_back(self):
        for changed in (ev("b", "Sync (moved room)", 10), ev("b", "Sync", 10, duration=60)):
            with self.subTest(changed=changed.title):
                self.tearDown()
                self.setUp()
                apply_events(self.session, DAY, [ev("b", "Sync", 10)])
                self.delete("Sync")
                r = apply_events(self.session, DAY, [changed])
                self.assertEqual(r.created, 1)
                self.assertEqual(self.session.exec(select(DismissedCalendarEvent)).all(), [])

    def test_rescheduled_event_returns_via_new_external_id(self):
        apply_events(self.session, DAY, [ev("b@10:00", "Sync", 10)])
        self.delete("Sync")
        r = apply_events(self.session, DAY, [ev("b@11:00", "Sync", 11)])
        self.assertEqual(r.created, 1)

    def test_rename_before_delete_still_matches_source_event(self):
        apply_events(self.session, DAY, [ev("b", "Sync", 10)])
        self.meeting("Sync").title = "my own wording"
        self.session.commit()
        self.delete("my own wording")
        r = apply_events(self.session, DAY, [ev("b", "Sync", 10)])
        self.assertEqual((r.created, r.skipped), (0, 1))

    def test_setting_off_means_deletes_do_not_stick(self):
        self.session.add(Setting(key="calendar_remember_deleted", value="false"))
        self.session.commit()
        apply_events(self.session, DAY, [ev("b", "Sync", 10)])
        self.delete("Sync")
        self.assertEqual(self.session.exec(select(DismissedCalendarEvent)).all(), [])
        r = apply_events(self.session, DAY, [ev("b", "Sync", 10)])
        self.assertEqual(r.created, 1)

    def test_turning_setting_off_ignores_existing_dismissals(self):
        apply_events(self.session, DAY, [ev("b", "Sync", 10)])
        self.delete("Sync")
        self.session.add(Setting(key="calendar_remember_deleted", value="false"))
        self.session.commit()
        r = apply_events(self.session, DAY, [ev("b", "Sync", 10)])
        self.assertEqual(r.created, 1)

    def test_manual_meeting_delete_is_not_recorded(self):
        self.session.add(Meeting(date=DAY, title="Manual"))
        self.session.commit()
        self.delete("Manual")
        self.assertEqual(self.session.exec(select(DismissedCalendarEvent)).all(), [])

    def test_restore_then_sync_brings_it_back(self):
        apply_events(self.session, DAY, [ev("b", "Sync", 10)])
        self.delete("Sync")
        listed = list_dismissed(self.session)
        self.assertEqual([d.title for d in listed], ["Sync"])
        restore_dismissed(listed[0].external_id, self.session)
        self.assertEqual(list_dismissed(self.session), [])
        r = apply_events(self.session, DAY, [ev("b", "Sync", 10)])
        self.assertEqual(r.created, 1)

    def test_old_dismissals_are_pruned(self):
        self.session.add(DismissedCalendarEvent(external_id="old", fingerprint="x", title="Old", date=date(2026, 1, 1)))
        self.session.commit()
        apply_events(self.session, DAY, [])
        self.assertEqual(list_dismissed(self.session), [])

    def test_pruning_is_relative_to_today_not_the_synced_day(self):
        today = date.today()
        self.session.add(DismissedCalendarEvent(external_id="recent", fingerprint="x", title="Recent", date=today - timedelta(days=10)))
        self.session.add(DismissedCalendarEvent(external_id="stale", fingerprint="x", title="Stale", date=today - timedelta(days=100)))
        self.session.commit()
        apply_events(self.session, today - timedelta(days=200), [])  # syncing a very old day
        self.assertEqual([d.title for d in list_dismissed(self.session)], ["Recent"])

    def test_clear_all_forgets_everything(self):
        apply_events(self.session, DAY, [ev("a", "A", 9), ev("b", "B", 10)])
        self.delete("A")
        self.delete("B")
        self.assertEqual(len(list_dismissed(self.session)), 2)
        clear_dismissed(self.session)
        self.assertEqual(list_dismissed(self.session), [])
        self.assertEqual(apply_events(self.session, DAY, [ev("a", "A", 9)]).created, 1)

    def test_day_view_orders_by_start_time_then_untimed(self):
        self.session.add(Meeting(date=DAY, title="Manual untimed"))
        self.session.commit()
        apply_events(self.session, DAY, [ev("c", "Late", 15), ev("a", "Early", 9)])
        self.delete("Early")
        apply_events(self.session, DAY, [ev("c", "Late", 15), ev("a", "Early", 9, duration=45)])  # returns, created last
        self.session.add(Meeting(date=DAY, title="Manual 10am", start_time="10:00"))
        self.session.commit()
        order = [m.title for m in get_day(DAY, self.session).meetings]
        self.assertEqual(order, ["Early", "Manual 10am", "Late", "Manual untimed"])

    def test_plain_and_regex_rules_skip_events(self):
        rules = [{"pattern": "drop off", "regex": False}, {"pattern": r"^pick[ -]?up\b", "regex": True}]
        r = apply_events(
            self.session, DAY,
            [ev("a", "Standup", 9), ev("b", "Kids DROP OFF", 8), ev("c", "Pick-up", 15), ev("d", "Backpick up", 16)],
            ignore_rules=rules,
        )
        self.assertEqual(sorted(self.titles()), ["Backpick up", "Standup"])
        self.assertEqual((r.created, r.ignored), (2, 2))

    def test_bad_regex_never_matches(self):
        r = apply_events(self.session, DAY, [ev("a", "Standup", 9)], ignore_rules=[{"pattern": "(", "regex": True}])
        self.assertEqual((r.created, r.ignored), (1, 0))

    def test_already_imported_meeting_is_flagged_not_deleted(self):
        apply_events(self.session, DAY, [ev("b", "Drop off", 8)])
        r = apply_events(self.session, DAY, [ev("b", "Drop off", 8)], ignore_rules=[{"pattern": "drop", "regex": False}])
        self.assertEqual((r.ignored, r.flagged), (1, 1))
        self.assertTrue(self.meeting("Drop off").missing_from_source)

    def test_ignore_preview_lists_matching_importable_events(self):
        from unittest import mock
        from fastapi import HTTPException
        from api.routes import calendar as cal

        events = [ev("a", "Standup", 9), ev("b", "Drop off", 8), ev("c", "Drop off", 8, declined=True)]
        with mock.patch.object(cal.calendar_source, "authorization_status", return_value="authorized"), \
                mock.patch.object(cal.calendar_source, "fetch_range", return_value=events) as fetch:
            out = cal.ignore_preview(cal.IgnoreRule(pattern="drop"), self.session)
            self.assertEqual(fetch.call_count, 1)
            self.assertEqual({m.title for m in out}, {"Drop off"})
            self.assertEqual(len(out), 1)  # the declined one is excluded
            with self.assertRaises(HTTPException):
                cal.ignore_preview(cal.IgnoreRule(pattern="(", regex=True), self.session)


class StartTimeValidationTests(unittest.TestCase):
    def test_valid_empty_and_invalid(self):
        self.assertEqual(MeetingCreate(date=DAY, title="x", start_time="09:05").start_time, "09:05")
        self.assertIsNone(MeetingCreate(date=DAY, title="x", start_time="").start_time)
        self.assertIsNone(MeetingUpdate(start_time="").start_time)
        for bad in ("9:05", "24:00", "12:60", "noon"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                MeetingCreate(date=DAY, title="x", start_time=bad)


if __name__ == "__main__":
    unittest.main()

