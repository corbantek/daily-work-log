"""Short references T<n> / M<n> (input also accepts T-<n>). Run: api/.venv/bin/python -m unittest discover -s api/tests -t ."""
import sqlite3
import tempfile
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path
from unittest import mock

from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine, select

import api.database as database
from api.calendar_source import CalendarEvent
from api.models import Meeting, Task, Workstream
from api.refs import meeting_ref, parse_ref, task_ref
from api.routes import agent as A
from api.routes.calendar import apply_events
from api.routes.search import search
from api.routes.tasks import delete_task

DAY = date(2026, 10, 22)


class Base(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(self.engine)
        self.s = Session(self.engine)

    def tearDown(self):
        self.s.close()
        self.engine.dispose()

    def task(self, action, **kw):
        t = Task(action=action, **kw)
        self.s.add(t)
        self.s.commit()
        return t


class NumberingTests(Base):
    def test_new_rows_get_sequential_numbers_per_kind(self):
        a, b = self.task("a"), self.task("b")
        m = Meeting(title="m", date=DAY)
        self.s.add(m)
        self.s.commit()
        self.assertEqual((a.number, b.number, m.number), (1, 2, 1))  # tasks and meetings count separately

    def test_many_in_one_commit_are_unique_and_follow_creation_order(self):
        base = datetime(2026, 10, 1)
        rows = [Task(action=f"t{i}", created_at=base + timedelta(minutes=10 - i)) for i in range(5)]
        self.s.add_all(rows)
        self.s.commit()
        by_created = sorted(rows, key=lambda t: t.created_at)
        self.assertEqual([t.number for t in by_created], [1, 2, 3, 4, 5])

    def test_numbers_are_never_reused_after_a_delete(self):
        self.task("a")
        newest = self.task("b")
        delete_task(newest.id, self.s)
        self.assertEqual(self.task("c").number, 3)

    def test_explicit_numbers_are_kept_and_others_continue_after_them(self):
        self.s.add(Task(action="restored", number=40))
        self.s.add(Task(action="new"))
        self.s.commit()
        self.assertEqual(sorted(t.number for t in self.s.exec(select(Task)).all()), [40, 41])

    def test_calendar_sync_numbers_imported_meetings(self):
        ev = CalendarEvent(external_id="a", title="Standup", start=datetime(2026, 10, 22, 9), duration_minutes=15,
                           all_day=False, declined=False, cancelled=False, calendar_id="c")
        apply_events(self.s, DAY, [ev])
        self.assertEqual(self.s.exec(select(Meeting)).one().number, 1)


class MigrationTests(unittest.TestCase):
    def test_existing_rows_are_numbered_oldest_first(self):
        tmp = Path(tempfile.mkdtemp()) / "old.db"
        conn = sqlite3.connect(tmp)
        conn.executescript("""
            CREATE TABLE task (id VARCHAR PRIMARY KEY, action VARCHAR, created_at DATETIME, parent_task_id VARCHAR, notes VARCHAR);
            CREATE TABLE meeting (id VARCHAR PRIMARY KEY, title VARCHAR, created_at DATETIME);
            CREATE TABLE day_status (day DATE PRIMARY KEY, status VARCHAR, note VARCHAR);
            INSERT INTO task VALUES ('b', 'second', '2026-10-02 09:00:00', NULL, NULL), ('a', 'first', '2026-10-01 09:00:00', NULL, NULL);
            INSERT INTO meeting VALUES ('m1', 'only', '2026-10-05 10:00:00');
        """)
        conn.commit()
        conn.close()
        with mock.patch.object(database, "DB_PATH", tmp):
            database._run_migrations()
            database._run_migrations()  # running again changes nothing
        conn = sqlite3.connect(tmp)
        self.assertEqual(conn.execute("SELECT id, number FROM task ORDER BY number").fetchall(), [("a", 1), ("b", 2)])
        self.assertEqual(conn.execute("SELECT number FROM meeting").fetchall(), [(1,)])
        with self.assertRaises(sqlite3.IntegrityError):  # the unique index is in place
            conn.execute("UPDATE task SET number = 1 WHERE id = 'b'")
        conn.close()
        self.assertTrue(tmp.with_suffix(".db.bak").exists())  # backed up first, as always


class ParseTests(unittest.TestCase):
    def test_parse_and_format(self):
        self.assertEqual([parse_ref(v) for v in ("T42", "T-42", "t42", "M 17", "#7", "12", " m-3 ")],
                         [("T", 42), ("T", 42), ("T", 42), ("M", 17), (None, 7), (None, 12), ("M", 3)])
        self.assertEqual([parse_ref(v) for v in ("Fix retries", "T-", "3f1c2a", "")], [None, None, None, None])
        self.assertEqual((task_ref(42), meeting_ref(17), task_ref(None)), ("T42", "M17", None))


class AgentAndSearchTests(Base):
    def setUp(self):
        super().setUp()
        self.s.add(Workstream(name="LSP"))
        self.s.commit()

    def test_agent_accepts_references_everywhere_and_returns_them(self):
        t = A.agent_create_task(A.NewTask(action="Fix retries", workstream="LSP"), self.s)
        self.assertEqual(t["ref"], "T1")
        for ref in ("T1", "T-1", "t1", "#1", "1"):
            self.assertEqual(A.agent_task(ref, self.s)["id"], t["id"])
        A.agent_update_task("T1", A.TaskChanges(state="in progress"), self.s)
        A.agent_task_notes("T1", A.NotesText(text="note"), self.s)
        A.agent_task_link("T-1", A.NewLink(url="https://github.com/o/r/pull/1"), self.s)
        sub = A.agent_create_task(A.NewTask(action="Child", parent_id="T1"), self.s)
        self.assertEqual((sub["ref"], sub["parent_id"], sub["workstream"]), ("T2", t["id"], "LSP"))
        m = A.agent_create_meeting(A.NewMeeting(title="LSP sync"), self.s)
        self.assertEqual(m["ref"], "M1")
        out = A.agent_meeting_task("M1", A.MeetingTask(task_id="T1"), self.s)
        self.assertEqual([x["ref"] for x in out["tasks"]], ["T1"])
        self.assertEqual(A.agent_task("T1", self.s)["meetings"][0]["ref"], "M1")
        self.assertIn("created T1", A.agent_activity(50, self.s)[-1]["summary"])

    def test_agent_rejects_the_wrong_kind_and_unknown_numbers(self):
        A.agent_create_task(A.NewTask(action="x"), self.s)
        with self.assertRaises(HTTPException) as cm:
            A.agent_task("M1", self.s)
        self.assertEqual(cm.exception.status_code, 400)
        with self.assertRaises(HTTPException) as cm:
            A.agent_task("T99", self.s)
        self.assertEqual(cm.exception.status_code, 404)

    def test_search_finds_a_reference_first(self):
        self.task("Fix retries")
        self.task("Mentions T-1 in notes", notes="see T-1")
        self.s.add(Meeting(title="Weekly", date=DAY))
        self.s.commit()
        self.assertEqual(search("T-1", self.s)[0].title, "Fix retries")  # the dashed form still works
        r = search("T1", self.s)
        self.assertEqual((r[0].type, r[0].title, r[0].number), ("task", "Fix retries", 1))
        self.assertEqual(len([x for x in r if x.title == "Fix retries"]), 1)  # not listed twice
        self.assertEqual(search("m1", self.s)[0].title, "Weekly")
        self.assertEqual({x.type for x in search("1", self.s)[:2]}, {"task", "meeting"})  # a bare number: both kinds


if __name__ == "__main__":
    unittest.main()
