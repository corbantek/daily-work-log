"""Note snapshots taken before every /agent notes change. Run: api/.venv/bin/python -m unittest discover -s api/tests -t ."""
import os
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine

from api import note_snapshots as N
from api.routes import agent as A


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self._prev = os.environ.get("WORKLOG_NOTE_SNAPSHOTS")
        os.environ["WORKLOG_NOTE_SNAPSHOTS"] = str(self.dir)
        self.engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(self.engine)
        self.s = Session(self.engine)

    def tearDown(self):
        self.s.close()
        self.engine.dispose()
        if self._prev is None:
            os.environ.pop("WORKLOG_NOTE_SNAPSHOTS", None)
        else:
            os.environ["WORKLOG_NOTE_SNAPSHOTS"] = self._prev
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_every_notes_change_saves_the_previous_version_first(self):
        t = A.agent_create_task(A.NewTask(action="Fix retries", notes="v1"), self.s)
        out = A.agent_task_notes(t["ref"], A.NotesText(text="v2 added"), self.s)
        self.assertTrue(out["notes_backup"].startswith("T1--"))
        out2 = A.agent_task_notes(t["ref"], A.NotesText(text="rewritten", mode="replace"), self.s)
        backups = A.agent_note_backups("T1")["backups"]
        self.assertEqual([b["name"] for b in backups], [out2["notes_backup"], out["notes_backup"]])  # newest first
        self.assertEqual(A.agent_note_backup("T1", out["notes_backup"])["notes"], "v1")
        self.assertEqual(A.agent_note_backup("t-1", out2["notes_backup"])["notes"], "v1\n\nv2 added")

    def test_meetings_too_and_nothing_saved_for_empty_notes(self):
        m = A.agent_create_meeting(A.NewMeeting(title="Sync"), self.s)
        first = A.agent_meeting_notes(m["ref"], A.NotesText(text="pasted notes"), self.s)
        self.assertIsNone(first["notes_backup"])  # there was nothing to lose
        second = A.agent_meeting_notes(m["ref"], A.NotesText(text="more"), self.s)
        self.assertEqual(A.agent_note_backup("M1", second["notes_backup"])["notes"], "pasted notes")

    def test_restore_is_a_replace_that_is_itself_backed_up(self):
        t = A.agent_create_task(A.NewTask(action="x", notes="good version"), self.s)
        bad = A.agent_task_notes(t["ref"], A.NotesText(text="oops", mode="replace"), self.s)
        good = A.agent_note_backup("T1", bad["notes_backup"])["notes"]
        restored = A.agent_task_notes(t["ref"], A.NotesText(text=good, mode="replace"), self.s)
        self.assertEqual(restored["notes"], "good version")
        self.assertEqual(A.agent_note_backup("T1", restored["notes_backup"])["notes"], "oops")

    def test_old_snapshots_are_pruned_after_the_retention_period(self):
        old = datetime.now(timezone.utc) - timedelta(days=N.RETENTION_DAYS + 1)
        (self.dir / f"T1--{old.strftime('%Y%m%dT%H%M%S%fZ')}.md").write_text("ancient")
        (self.dir / "unrelated.txt").write_text("left alone")
        N.save("T2", "recent")
        names = sorted(p.name for p in self.dir.iterdir())
        self.assertEqual(len(names), 2)
        self.assertIn("unrelated.txt", names)
        self.assertTrue(any(n.startswith("T2--") for n in names))

    def test_lookups_need_a_real_reference_and_a_well_formed_name(self):
        for bad in ("42", "nope", ""):
            with self.subTest(bad), self.assertRaises(HTTPException):
                A.agent_note_backups(bad)
        N.save("T1", "secret")
        name = N.list_for("T1")[0]["name"]
        with self.assertRaises(HTTPException):
            A.agent_note_backup("T2", name)          # another item's snapshot
        for evil in ("../../worklog.db", "T1--x.md", name.replace(".md", ".txt")):
            with self.subTest(evil), self.assertRaises(HTTPException):
                A.agent_note_backup("T1", evil)


if __name__ == "__main__":
    unittest.main()
