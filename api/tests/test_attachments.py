"""Task attachments. Run: api/.venv/bin/python -m unittest discover -s api/tests -t ."""
import io
import os
import shutil
import tarfile
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlmodel import Session, SQLModel, create_engine, select

from api.attachments import attachment_kind, mirror_attachments, safe_filename, serve_profile
from api.models import Task, TaskAttachment
from api.routes.attachments import (
    attachment_stats, delete_attachment, export_archive, get_attachment_file, import_archive,
    rename_attachment, upload_attachment,
)
from api.routes.search import search
from api.routes.tasks import _enrich, delete_task
from api.models import AttachmentRename


def upload(name, data=b"hello"):
    return UploadFile(file=io.BytesIO(data), filename=name)


class AttachmentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        os.environ["WORKLOG_FILES"] = str(self.tmp / "files")
        os.environ.pop("WORKLOG_MAX_ATTACHMENT_MB", None)
        self.engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(self.engine)
        self.session = Session(self.engine)
        self.task = Task(action="Write how-to")
        self.session.add(self.task)
        self.session.commit()
        self.files = self.tmp / "files"

    def tearDown(self):
        self.session.close()
        self.engine.dispose()
        os.environ.pop("WORKLOG_FILES", None)
        os.environ.pop("WORKLOG_MAX_ATTACHMENT_MB", None)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def add(self, name="howto.md", data=b"# Hi"):
        return upload_attachment(self.task.id, upload(name, data), self.session)

    def stored(self):
        return sorted(p.name for p in self.files.iterdir()) if self.files.exists() else []

    # ── upload ──
    def test_upload_stores_file_and_reports_kind(self):
        a = self.add("howto.md", b"# Hi")
        self.assertEqual((a.filename, a.size_bytes, a.kind), ("howto.md", 4, "markdown"))
        self.assertEqual(len(self.stored()), 1)
        self.assertEqual((self.files / self.stored()[0]).read_bytes(), b"# Hi")
        self.assertEqual([x.filename for x in _enrich(self.task, self.session).attachments], ["howto.md"])

    def test_upload_to_missing_task_is_404_and_stores_nothing(self):
        with self.assertRaises(HTTPException) as cm:
            upload_attachment("nope", upload("a.txt"), self.session)
        self.assertEqual(cm.exception.status_code, 404)
        self.assertEqual(self.stored(), [])

    def test_size_limit_rejects_and_leaves_no_partial_file(self):
        os.environ["WORKLOG_MAX_ATTACHMENT_MB"] = "0.001"  # ~1 KB
        with self.assertRaises(HTTPException) as cm:
            self.add("big.pdf", b"x" * 5000)
        self.assertEqual(cm.exception.status_code, 413)
        self.assertEqual(self.stored(), [])
        self.assertEqual(self.session.exec(select(TaskAttachment)).all(), [])

    def test_filename_is_sanitized(self):
        self.assertEqual(safe_filename("../../etc/passwd"), "passwd")
        self.assertEqual(safe_filename("C:\\Users\\me\\notes.md"), "notes.md")
        self.assertEqual(safe_filename("a\x00b\nc.txt"), "abc.txt")
        self.assertEqual(safe_filename(""), "file")
        self.assertEqual(safe_filename(None), "file")
        self.assertLessEqual(len(safe_filename("x" * 500 + ".pdf")), 200)
        self.assertTrue(safe_filename("x" * 500 + ".pdf").endswith(".pdf"))

    # ── serving ──
    def test_serve_profiles(self):
        media, disp, headers = serve_profile("howto.md")
        self.assertEqual((media, disp), ("text/plain; charset=utf-8", "inline"))
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertIn("sandbox", headers["Content-Security-Policy"])

        media, disp, headers = serve_profile("spec.pdf")
        self.assertEqual((media, disp), ("application/pdf", "inline"))
        self.assertNotIn("Content-Security-Policy", headers)  # would break Chrome's PDF viewer

        for risky in ("page.html", "pic.svg", "feed.xml", "run.js", "noext", "archive.zip"):
            with self.subTest(risky):
                media, disp, headers = serve_profile(risky)
                self.assertEqual((media, disp), ("application/octet-stream", "attachment"))
                self.assertIn("sandbox", headers["Content-Security-Policy"])

    def test_kinds(self):
        self.assertEqual(
            [attachment_kind(n) for n in ("a.MD", "a.markdown", "a.pdf", "a.PNG", "a.csv", "a.html", "a")],
            ["markdown", "markdown", "pdf", "image", "text", "other", "other"],
        )

    def test_get_file_serves_by_id_ignoring_url_filename(self):
        a = self.add("page.html", b"<script>alert(1)</script>")
        r = get_attachment_file(a.id, "whatever.png", self.session)
        self.assertEqual(r.media_type, "application/octet-stream")
        self.assertIn("attachment", r.headers["content-disposition"])
        self.assertIn("page.html", r.headers["content-disposition"])

    def test_get_file_missing_on_disk_is_404(self):
        a = self.add()
        (self.files / self.stored()[0]).unlink()
        with self.assertRaises(HTTPException) as cm:
            get_attachment_file(a.id, "howto.md", self.session)
        self.assertEqual(cm.exception.status_code, 404)

    # ── rename / delete ──
    def test_rename_sanitizes(self):
        a = self.add()
        self.assertEqual(rename_attachment(a.id, AttachmentRename(filename="../x/new name.md"), self.session).filename, "new name.md")

    def test_delete_attachment_removes_row_and_file(self):
        a = self.add()
        delete_attachment(a.id, self.session)
        self.assertEqual(self.stored(), [])
        self.assertEqual(self.session.exec(select(TaskAttachment)).all(), [])

    def test_delete_task_removes_its_files_only(self):
        other = Task(action="Other")
        self.session.add(other)
        self.session.commit()
        self.add("mine.md")
        upload_attachment(other.id, upload("theirs.md"), self.session)
        delete_task(self.task.id, self.session)
        remaining = self.session.exec(select(TaskAttachment)).all()
        self.assertEqual([r.filename for r in remaining], ["theirs.md"])
        self.assertEqual(self.stored(), [remaining[0].stored_name])

    # ── stats, archive ──
    def test_stats_counts_missing_files(self):
        self.add("a.md", b"12345")
        self.add("b.md", b"123")
        (self.files / self.stored()[0]).unlink()
        s = attachment_stats(self.session)
        self.assertEqual((s["count"], s["total_bytes"], s["missing_files"]), (2, 8, 1))

    def export_to(self, path):
        resp = export_archive(self.session)
        shutil.copy(resp.path, path)
        os.unlink(resp.path)

    def test_archive_round_trip_restores_deleted_files(self):
        a = self.add("a.md", b"alpha")
        b = self.add("b.pdf", b"bravo")
        archive = self.tmp / "out.tar.gz"
        self.export_to(archive)
        with tarfile.open(archive) as tar:
            names = tar.getnames()
        self.assertIn("manifest.json", names)
        self.assertEqual(len([n for n in names if n != "manifest.json"]), 2)

        shutil.rmtree(self.files)  # lose the files, keep the DB (the "restored db" scenario)
        self.assertEqual(attachment_stats(self.session)["missing_files"], 2)
        with open(archive, "rb") as f:
            result = import_archive(UploadFile(file=f, filename="out.tar.gz"), self.session)
        self.assertEqual((result["restored"], result["missing_files"]), (2, 0))
        self.assertEqual(Path(get_attachment_file(a.id, "a.md", self.session).path).read_bytes(), b"alpha")
        self.assertEqual(Path(get_attachment_file(b.id, "b.pdf", self.session).path).read_bytes(), b"bravo")

    def test_import_ignores_unsafe_members(self):
        bad = self.tmp / "bad.tar.gz"
        with tarfile.open(bad, "w:gz") as tar:
            def add(name, data=b"x", **kw):
                info = tarfile.TarInfo(name)
                info.size = len(data)
                for k, v in kw.items():
                    setattr(info, k, v)
                tar.addfile(info, io.BytesIO(data) if not kw.get("type") else None)
            add("../evil")
            add("/abs/evil")
            add("not-a-uuid.txt")
            add("manifest.json", b"[]")
            link = tarfile.TarInfo("a" * 32)
            link.type, link.linkname = tarfile.SYMTYPE, "/etc/passwd"
            tar.addfile(link)
            add("b" * 32, b"fine")
        with open(bad, "rb") as f:
            result = import_archive(UploadFile(file=f, filename="bad.tar.gz"), self.session)
        self.assertEqual(result["restored"], 1)
        self.assertEqual(result["skipped"], 4)  # manifest.json is ignored, not counted
        self.assertEqual(self.stored(), ["b" * 32])
        self.assertFalse((self.tmp / "evil").exists())

    def test_import_rejects_non_archive(self):
        with self.assertRaises(HTTPException) as cm:
            import_archive(UploadFile(file=io.BytesIO(b"not a tarball"), filename="x.tar.gz"), self.session)
        self.assertEqual(cm.exception.status_code, 400)

    def test_mirror_copies_only_missing_files(self):
        self.add("a.md")
        dest = self.tmp / "backups"
        self.assertEqual(mirror_attachments(dest), 1)
        self.assertEqual(mirror_attachments(dest), 0)
        self.add("b.md")
        self.assertEqual(mirror_attachments(dest), 1)
        self.assertEqual(len(list((dest / "attachments").iterdir())), 2)

    # ── search ──
    def test_search_finds_task_by_attachment_filename(self):
        self.add("runbook-failover.md")
        results = search("failover", self.session)
        self.assertEqual([(r.type, r.title) for r in results], [("task", "Write how-to")])
        self.assertIn("runbook-failover.md", results[0].subtitle)


if __name__ == "__main__":
    unittest.main()
