"""Meeting links. Run: api/.venv/bin/python -m unittest discover -s api/tests -t ."""
import unittest
from datetime import date, datetime

from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine, select

from api.calendar_source import CalendarEvent
from api.models import Meeting, MeetingLink, Task, TaskLink, TaskLinkCreate
from api.routes.backup import _export_data
from api.routes.calendar import apply_events
from api.routes.day import get_day
from api.routes.meetings import _read_meeting, add_link, delete_meeting, remove_link, update_link
from api.routes.tasks import add_link as add_task_link

DAY = date(2026, 10, 7)


class MeetingLinkTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(self.engine)
        self.session = Session(self.engine)
        self.meeting = Meeting(date=DAY, title="Design review")
        self.session.add(self.meeting)
        self.session.commit()

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def add(self, url="https://example.com/deck", label=None, link_type="other", meeting=None):
        return add_link((meeting or self.meeting).id, TaskLinkCreate(url=url, label=label, link_type=link_type), self.session)

    def test_add_and_read_back_in_order(self):
        a = self.add("https://example.com/a", "Agenda", "doc")
        self.add("https://example.com/b")
        links = _read_meeting(self.meeting, self.session).links
        self.assertEqual([l.url for l in links], ["https://example.com/a", "https://example.com/b"])
        self.assertEqual((a.meeting_id, a.label, a.link_type.value), (self.meeting.id, "Agenda", "doc"))
        self.assertEqual(links[1].link_type.value, "other")

    def test_add_to_missing_meeting_is_404(self):
        with self.assertRaises(HTTPException) as cm:
            add_link("nope", TaskLinkCreate(url="https://x.test"), self.session)
        self.assertEqual(cm.exception.status_code, 404)
        self.assertEqual(self.session.exec(select(MeetingLink)).all(), [])

    def test_update_and_wrong_meeting(self):
        link = self.add()
        updated = update_link(self.meeting.id, link.id, TaskLinkCreate(url="https://new.test", label="New", link_type="slack"), self.session)
        self.assertEqual((updated.url, updated.label, updated.link_type.value), ("https://new.test", "New", "slack"))
        other = Meeting(date=DAY, title="Other")
        self.session.add(other)
        self.session.commit()
        with self.assertRaises(HTTPException) as cm:
            update_link(other.id, link.id, TaskLinkCreate(url="https://x.test"), self.session)
        self.assertEqual(cm.exception.status_code, 404)
        with self.assertRaises(HTTPException):
            remove_link(other.id, link.id, self.session)

    def test_remove(self):
        link = self.add()
        remove_link(self.meeting.id, link.id, self.session)
        self.assertEqual(_read_meeting(self.meeting, self.session).links, [])

    def test_deleting_a_meeting_deletes_only_its_links(self):
        other = Meeting(date=DAY, title="Other")
        self.session.add(other)
        self.session.commit()
        self.add("https://mine.test")
        self.add("https://theirs.test", meeting=other)
        delete_meeting(self.meeting.id, self.session)
        self.assertEqual([l.url for l in self.session.exec(select(MeetingLink)).all()], ["https://theirs.test"])

    def test_day_view_includes_links(self):
        self.add("https://example.com/deck", "Deck", "doc")
        day = get_day(DAY, self.session)
        self.assertEqual([l.label for l in day.meetings[0].links], ["Deck"])

    def test_links_survive_a_calendar_sync_of_an_imported_meeting(self):
        ev = CalendarEvent(external_id="a", title="Standup", start=datetime(2026, 10, 7, 9), duration_minutes=15,
                           all_day=False, declined=False, cancelled=False, calendar_id="c")
        apply_events(self.session, DAY, [ev])
        imported = self.session.exec(select(Meeting).where(Meeting.title == "Standup")).one()
        self.add("https://example.com/notes", meeting=imported)
        ev.duration_minutes = 30  # event edited on the calendar: sync updates the meeting in place
        apply_events(self.session, DAY, [ev])
        self.assertEqual(len(_read_meeting(imported, self.session).links), 1)

    def test_backup_export_includes_meeting_links(self):
        self.add("https://example.com/deck")
        exported = _export_data(self.session)
        self.assertEqual([l["url"] for l in exported["meeting_links"]], ["https://example.com/deck"])

    def test_quip_link_type_works_for_tasks_and_meetings(self):
        task = Task(action="A task")
        self.session.add(task)
        self.session.commit()
        m = self.add("https://quip-apple.com/AbCdEf", "Notes", "quip")
        t = add_task_link(task.id, TaskLinkCreate(url="https://quip.com/XyZ", link_type="quip"), self.session)
        self.assertEqual((m.link_type.value, t.link_type.value), ("quip", "quip"))
        self.assertEqual(_read_meeting(self.meeting, self.session).links[0].link_type.value, "quip")
        self.assertEqual([l.link_type.value for l in self.session.exec(select(TaskLink)).all()], ["quip"])

    def test_unknown_link_type_is_still_rejected(self):
        with self.assertRaises(ValueError):
            TaskLinkCreate(url="https://x.test", link_type="carrier-pigeon")

    def test_task_links_are_untouched(self):
        task = Task(action="A task")
        self.session.add(task)
        self.session.commit()
        add_task_link(task.id, TaskLinkCreate(url="https://t.test", link_type="pr"), self.session)
        self.assertEqual([l.url for l in self.session.exec(select(TaskLink)).all()], ["https://t.test"])
        self.assertEqual(self.session.exec(select(MeetingLink)).all(), [])


if __name__ == "__main__":
    unittest.main()
