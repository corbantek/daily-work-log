"""In-memory change counter (GET /changes). Run: api/.venv/bin/python -m unittest discover -s api/tests -t ."""
import unittest
from datetime import date, datetime

from sqlmodel import Session, SQLModel, create_engine, select

from api.calendar_source import CalendarEvent
from api.database import BOOT_ID, data_version
from api.models import Meeting, Setting, Task, Workstream
from api.routes import agent as A
from api.routes.calendar import apply_events
from api.routes.changes import changes
from api.routes.tasks import delete_task


class ChangeCounterTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(self.engine)
        self.s = Session(self.engine)

    def tearDown(self):
        self.s.close()
        self.engine.dispose()

    def bumped(self, fn):
        before = data_version()
        fn()
        return data_version() - before

    def test_every_kind_of_write_bumps_it_once_per_commit(self):
        t = Task(action="a")
        self.assertEqual(self.bumped(lambda: (self.s.add(t), self.s.commit())), 1)              # create
        self.assertEqual(self.bumped(lambda: (setattr(t, "action", "b"), self.s.commit())), 1)  # update
        self.assertEqual(self.bumped(lambda: delete_task(t.id, self.s)), 1)                     # delete

    def test_reads_and_empty_commits_do_not(self):
        self.s.add(Task(action="a"))
        self.s.commit()
        self.assertEqual(self.bumped(lambda: (self.s.exec(select(Task)).all(), self.s.commit())), 0)

    def test_rolled_back_writes_do_not(self):
        def write_then_rollback():
            self.s.add(Task(action="never saved"))
            self.s.flush()
            self.s.rollback()
            self.s.commit()
        self.assertEqual(self.bumped(write_then_rollback), 0)

    def test_agent_and_calendar_writes_count(self):
        self.assertGreater(self.bumped(lambda: A.agent_create_task(A.NewTask(action="from the agent"), self.s)), 0)
        ev = CalendarEvent(external_id="e", title="Standup", start=datetime(2026, 10, 23, 9), duration_minutes=15,
                           all_day=False, declined=False, cancelled=False, calendar_id="c")
        self.assertGreater(self.bumped(lambda: apply_events(self.s, date(2026, 10, 23), [ev])), 0)

    def test_endpoint_reports_boot_and_version_and_is_not_stored(self):
        out = changes()
        self.assertEqual({k: out[k] for k in ("boot", "version")}, {"boot": BOOT_ID, "version": data_version()})
        self.s.add(Task(action="a"))
        self.s.commit()
        self.assertEqual(changes()["version"], out["version"] + 1)
        stored = [r.key for r in self.s.exec(select(Setting)).all()]
        self.assertFalse(any("version" in k or "change" in k for k in stored))  # nothing persisted


class AgentMarkerTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(self.engine)
        self.s = Session(self.engine)

    def tearDown(self):
        self.s.close()
        self.engine.dispose()

    def test_points_at_the_newest_agent_change_only(self):
        A.agent_create_task(A.NewTask(action="first"), self.s)
        t = A.agent_create_task(A.NewTask(action="second"), self.s)
        newest = A.agent_activity(1, self.s)[0]
        self.assertEqual(changes()["agent_activity"], newest["id"])
        self.assertIn("second", newest["summary"])
        self.s.add(Task(action="made in the app"))  # not an agent change: the marker stays put
        self.s.commit()
        self.assertEqual(changes()["agent_activity"], newest["id"])
        A.agent_update_task(t["id"], A.TaskChanges(state="done"), self.s)
        self.assertNotEqual(changes()["agent_activity"], newest["id"])


if __name__ == "__main__":
    unittest.main()
