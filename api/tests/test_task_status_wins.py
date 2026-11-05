"""Task status line and wins. Run: api/.venv/bin/python -m unittest discover -s api/tests -t ."""
import unittest
from datetime import date

from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine, select

from api.models import Task, TaskCreate, TaskUpdate, TaskWin, TaskWinCreate, TaskWinUpdate
from api.routes.backup import _export_data
from api.routes.search import search
from api.routes.self_review import self_review
from api.routes.tasks import add_win, create_task, delete_task, get_task, remove_win, update_task, update_win
from api.routes import agent as A
from api.status_extract import extract_status
from api.tests.test_agent import Base


class StatusWinsTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(self.engine)
        self.session = Session(self.engine)
        self.task = create_task(TaskCreate(action="Fix cache"), self.session)

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def test_status_is_one_line_and_timestamped(self):
        self.assertIsNone(self.task.status_updated_at)
        t = update_task(self.task.id, TaskUpdate(status="  fix shipped\n and measured "), self.session)
        self.assertEqual(t.status, "fix shipped and measured")
        self.assertIsNotNone(t.status_updated_at)
        stamp = t.status_updated_at
        t = update_task(self.task.id, TaskUpdate(notes="x"), self.session)  # unrelated edit keeps the stamp
        self.assertEqual(t.status_updated_at, stamp)
        t = update_task(self.task.id, TaskUpdate(status="  "), self.session)
        self.assertEqual((t.status, t.status_updated_at), (None, None))

    def test_wins_crud_and_defaults(self):
        w = add_win(self.task.id, TaskWinCreate(text="  Cut p99\n by 40% "), self.session)
        self.assertEqual((w.text, w.date, w.high_impact), ("Cut p99 by 40%", date.today(), False))
        w = update_win(self.task.id, w.id, TaskWinUpdate(high_impact=True, date=date(2026, 10, 1)), self.session)
        self.assertEqual((w.high_impact, w.date), (True, date(2026, 10, 1)))
        self.assertEqual([x.id for x in get_task(self.task.id, self.session).wins], [w.id])
        with self.assertRaises(HTTPException):
            add_win(self.task.id, TaskWinCreate(text="   "), self.session)
        remove_win(self.task.id, w.id, self.session)
        self.assertEqual(get_task(self.task.id, self.session).wins, [])

    def test_wins_ordered_by_date_and_deleted_with_task(self):
        add_win(self.task.id, TaskWinCreate(text="later", date=date(2026, 10, 5)), self.session)
        add_win(self.task.id, TaskWinCreate(text="earlier", date=date(2026, 10, 2)), self.session)
        self.assertEqual([w.text for w in get_task(self.task.id, self.session).wins], ["earlier", "later"])
        delete_task(self.task.id, self.session)
        self.assertEqual(self.session.exec(select(TaskWin)).all(), [])

    def test_self_review_wins_by_own_date(self):
        add_win(self.task.id, TaskWinCreate(text="in range", date=date(2026, 10, 10), high_impact=True), self.session)
        add_win(self.task.id, TaskWinCreate(text="out of range", date=date(2026, 7, 1)), self.session)
        sr = self_review(date(2026, 10, 1), date(2026, 10, 31), self.session)
        self.assertEqual([w.text for w in sr.wins], ["in range"])
        self.assertEqual((sr.stats.wins, sr.stats.high_impact_wins), (1, 1))
        self.assertEqual(sr.wins[0].task_action, "Fix cache")

    def test_search_and_backup(self):
        update_task(self.task.id, TaskUpdate(status="waiting on zebra review"), self.session)
        add_win(self.task.id, TaskWinCreate(text="shipped the quokka fix"), self.session)
        self.assertEqual([r.id for r in search("zebra", self.session)], [self.task.id])
        self.assertEqual([r.id for r in search("quokka", self.session)], [self.task.id])
        data = _export_data(self.session)
        self.assertEqual(data["task_wins"][0]["text"], "shipped the quokka fix")
        self.assertEqual(data["tasks"][0]["status"], "waiting on zebra review")


class AgentStatusWinsTests(Base):
    def test_status_on_create_and_patch_is_logged(self):
        t = self.new_task(action="Ship it", status="just started")
        self.assertEqual(t["status"], "just started")
        t = A.agent_update_task(t["ref"], A.TaskChanges(status="PR in review"), self.s)
        self.assertEqual(t["status"], "PR in review")
        self.assertIn("'just started' → 'PR in review'", A.agent_activity(5, self.s)[0]["summary"])
        t = A.agent_update_task(t["ref"], A.TaskChanges(status=""), self.s)
        self.assertIsNone(t["status"])

    def test_wins(self):
        t = self.new_task(action="Ship it")
        t = A.agent_task_win(t["ref"], A.NewWin(text="Cut registrations from 23 to 18 requests"), self.s)
        win = t["wins"][0]
        self.assertEqual((win["date"], win["high_impact"]), (date.today().isoformat(), False))
        t = A.agent_update_task_win(t["ref"], win["id"], A.WinChanges(high_impact=True), self.s)
        self.assertTrue(t["wins"][0]["high_impact"])
        self.assertEqual(self.activity()[:2], ["update_task_win", "add_task_win"])
        self.assert400(lambda: A.agent_task_win(t["ref"], A.NewWin(text=" "), self.s), "required")
        self.assert400(lambda: A.agent_update_task_win(t["ref"], "nope", A.WinChanges(text="x"), self.s), "no win")
        self.assertEqual(A.agent_summary(None, None, self.s)["wins"][0]["task"], t["ref"])

    def test_win_dates_parse_from_json(self):
        # `date: Optional[date]` on a model resolves to NoneType and rejects every date.
        t = self.new_task(action="Ship it")
        t = A.agent_task_win(t["ref"], A.NewWin.model_validate({"text": "Old win", "date": "2026-10-15"}), self.s)
        self.assertEqual(t["wins"][0]["date"], "2026-10-15")
        changes = A.WinChanges.model_validate({"date": "2026-10-16"})
        t = A.agent_update_task_win(t["ref"], t["wins"][0]["id"], changes, self.s)
        self.assertEqual(t["wins"][0]["date"], "2026-10-16")


class ExtractStatusTests(unittest.TestCase):
    def test_trailing_status_line(self):
        notes = "**Context**\nstuff\n\n**Status:** fix shipped; only the test is left.\n"
        self.assertEqual(extract_status(notes), ("fix shipped; only the test is left.", "**Context**\nstuff"))

    def test_colon_outside_bold_and_last_wins(self):
        notes = "**Status**: old\nbody\n**Status:** new"
        self.assertEqual(extract_status(notes), ("new", "**Status**: old\nbody"))

    def test_no_clean_line(self):
        for notes in (None, "", "no status here", "Status: plain", "**Status:**"):
            self.assertEqual(extract_status(notes), (None, notes))

    def test_only_status(self):
        self.assertEqual(extract_status("**Status:** done"), ("done", None))


if __name__ == "__main__":
    unittest.main()
