"""Dates implied by task state changes, for every caller. Run: api/.venv/bin/python -m unittest discover -s api/tests -t ."""
import unittest
from datetime import date, timedelta

from sqlmodel import Session, SQLModel, create_engine

from api.models import Task, TaskCreate, TaskState, TaskUpdate
from api.routes import agent as A
from api.routes.tasks import create_task, update_task

TODAY = date.today()
EARLIER = TODAY - timedelta(days=5)


class StateDateTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(self.engine)
        self.s = Session(self.engine)

    def tearDown(self):
        self.s.close()
        self.engine.dispose()

    def task(self, **kw):
        return create_task(TaskCreate(action="t", **kw), self.s)

    def move(self, t, **kw):
        return update_task(t.id, TaskUpdate(**kw), self.s)

    def test_in_progress_sets_a_missing_start_date_only(self):
        self.assertEqual(self.move(self.task(), state=TaskState.IN_PROGRESS).start_date, TODAY)
        self.assertEqual(self.move(self.task(start_date=EARLIER), state=TaskState.IN_PROGRESS).start_date, EARLIER)

    def test_complete_sets_end_and_a_missing_start(self):
        t = self.move(self.task(), state=TaskState.COMPLETE)
        self.assertEqual((t.start_date, t.end_date), (TODAY, TODAY))
        t = self.move(self.task(start_date=EARLIER), state=TaskState.COMPLETE)
        self.assertEqual((t.start_date, t.end_date), (EARLIER, TODAY))

    def test_abandoned_sets_end(self):
        t = self.move(self.task(start_date=EARLIER), state=TaskState.ABANDONED)
        self.assertEqual((t.start_date, t.end_date), (EARLIER, TODAY))

    def test_reopening_clears_the_end_date(self):
        for reopened in (TaskState.TODO, TaskState.IN_PROGRESS):
            with self.subTest(reopened):
                t = self.move(self.task(start_date=EARLIER), state=TaskState.COMPLETE)
                t = self.move(t, state=reopened)
                self.assertEqual((t.start_date, t.end_date), (EARLIER, None))

    def test_explicit_dates_win(self):
        t = self.move(self.task(), state=TaskState.COMPLETE, end_date=EARLIER, start_date=EARLIER)
        self.assertEqual((t.start_date, t.end_date), (EARLIER, EARLIER))

    def test_no_state_change_changes_no_dates(self):
        t = self.move(self.task(start_date=EARLIER), state=TaskState.COMPLETE, end_date=EARLIER)
        t = self.move(t, state=TaskState.COMPLETE)  # same state again
        self.assertEqual(t.end_date, EARLIER)
        t = self.move(t, action="renamed")
        self.assertEqual(t.end_date, EARLIER)

    def test_created_already_complete_or_in_progress(self):
        t = self.task(state=TaskState.COMPLETE)
        self.assertEqual((t.start_date, t.end_date), (TODAY, TODAY))
        t = self.task(state=TaskState.IN_PROGRESS)
        self.assertEqual((t.start_date, t.end_date), (TODAY, None))
        t = self.task(state=TaskState.ABANDONED, end_date=EARLIER)
        self.assertEqual(t.end_date, EARLIER)
        t = self.task()
        self.assertEqual((t.start_date, t.end_date), (None, None))

    def test_the_agent_gets_the_same_dates(self):
        t = A.agent_create_task(A.NewTask(action="via agent", start_date=EARLIER), self.s)
        done = A.agent_update_task(t["ref"], A.TaskChanges(state="done"), self.s)
        self.assertEqual((done["start_date"], done["end_date"]), (EARLIER.isoformat(), TODAY.isoformat()))
        reopened = A.agent_update_task(t["ref"], A.TaskChanges(state="in progress"), self.s)
        self.assertIsNone(reopened["end_date"])
        created_done = A.agent_create_task(A.NewTask(action="already done", state="complete"), self.s)
        self.assertEqual(created_done["end_date"], TODAY.isoformat())


if __name__ == "__main__":
    unittest.main()
