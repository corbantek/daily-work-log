"""Agent file access: attach, list, read. Run: api/.venv/bin/python -m unittest discover -s api/tests -t ."""
import io
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlmodel import Session, SQLModel, create_engine

from api.routes import agent as A


def upload(name, data):
    return UploadFile(file=io.BytesIO(data), filename=name)


class AgentFileTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self._prev = {k: os.environ.get(k) for k in ("WORKLOG_FILES", "WORKLOG_MAX_ATTACHMENT_MB")}
        os.environ["WORKLOG_FILES"] = str(self.dir / "files")
        self.engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(self.engine)
        self.s = Session(self.engine)
        self.task = A.agent_create_task(A.NewTask(action="Fix retries"), self.s)
        self.meeting = A.agent_create_meeting(A.NewMeeting(title="LSP sync"), self.s)

    def tearDown(self):
        self.s.close()
        self.engine.dispose()
        for k, v in self._prev.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_attach_to_a_task_by_reference_and_record_it(self):
        out = A.agent_task_file("T1", upload("howto.md", b"# How to\n- step"), self.s)
        [f] = out["files"]
        self.assertEqual((f["filename"], f["kind"], f["size_bytes"]), ("howto.md", "markdown", 15))
        self.assertEqual(A.agent_activity(1, self.s)[0]["summary"], 'attached "howto.md" to T1 "Fix retries"')
        self.assertEqual(A.agent_task_files("T1", self.s)["files"], out["files"])

    def test_attach_to_a_meeting(self):
        out = A.agent_meeting_file("M1", upload("deck.pdf", b"%PDF-1.4 fake"), self.s)
        self.assertEqual([f["filename"] for f in out["files"]], ["deck.pdf"])
        self.assertEqual(A.agent_meeting_files("M1", self.s)["ref"], "M1")
        self.assertIn('to M1 "LSP sync"', A.agent_activity(1, self.s)[0]["summary"])

    def test_text_files_return_their_contents(self):
        f = A.agent_task_file("T1", upload("data.csv", b"a,b\n1,2\n"), self.s)["files"][0]
        out = A.agent_file(f["id"], self.s)
        self.assertEqual((out["content"], out["truncated"], out["attached_to"]["ref"]), ("a,b\n1,2\n", False, "T1"))
        self.assertTrue(Path(out["path"]).is_file())

    def test_binary_files_give_a_path_instead(self):
        f = A.agent_meeting_file("M1", upload("chart.png", b"\x89PNG fake"), self.s)["files"][0]
        out = A.agent_file(f["id"], self.s)
        self.assertIsNone(out["content"])
        self.assertIn("file-reading tool", out["read_with"])
        self.assertEqual(Path(out["path"]).read_bytes(), b"\x89PNG fake")
        self.assertEqual(out["attached_to"], {"type": "meeting", "ref": "M1", "title": "LSP sync"})

    def test_long_text_is_truncated(self):
        big = b"x" * (A.MAX_CONTENT_CHARS + 10)
        f = A.agent_task_file("T1", upload("big.txt", big), self.s)["files"][0]
        out = A.agent_file(f["id"], self.s)
        self.assertEqual((len(out["content"]), out["truncated"]), (A.MAX_CONTENT_CHARS, True))

    def test_same_size_limit_as_the_app(self):
        os.environ["WORKLOG_MAX_ATTACHMENT_MB"] = "0.001"
        with self.assertRaises(HTTPException) as cm:
            A.agent_task_file("T1", upload("huge.bin", b"x" * 5000), self.s)
        self.assertEqual(cm.exception.status_code, 413)
        self.assertEqual(A.agent_task_files("T1", self.s)["files"], [])

    def test_unknown_items_and_files(self):
        for fn in (lambda: A.agent_task_file("T99", upload("a.txt", b"a"), self.s),
                   lambda: A.agent_file("no-such-id", self.s)):
            with self.assertRaises(HTTPException) as cm:
                fn()
            self.assertEqual(cm.exception.status_code, 404)

    def test_missing_on_disk_is_reported(self):
        f = A.agent_task_file("T1", upload("gone.txt", b"bye"), self.s)["files"][0]
        for p in (self.dir / "files").iterdir():
            p.unlink()
        with self.assertRaises(HTTPException) as cm:
            A.agent_file(f["id"], self.s)
        self.assertIn("missing", str(cm.exception.detail))


if __name__ == "__main__":
    unittest.main()
