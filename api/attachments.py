"""File storage for task attachments.

Files live on disk (not in SQLite) under UUID-hex names; the original filename
is only ever kept in the DB, so a stored name can never escape the directory.
"""
import os
import re
import shutil
import mimetypes
from pathlib import Path
from typing import Iterable, Optional, Tuple

from sqlmodel import Session, select

from .database import DB_PATH
from .models import AttachmentRead, MeetingAttachment, TaskAttachment

STORED_NAME = re.compile(r"^[0-9a-f]{32}$")  # uuid4().hex

# Types that are safe to display in a browser tab. Everything else (notably
# HTML, SVG and XML, which could run script against this origin) is download-only.
_INLINE = {
    ".pdf": "application/pdf",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp",
    ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
    ".markdown": "text/plain; charset=utf-8", ".csv": "text/plain; charset=utf-8",
    ".json": "text/plain; charset=utf-8", ".log": "text/plain; charset=utf-8",
}


def attachments_dir() -> Path:
    """Default: next to the DB, named after it, so the sample DB gets its own folder."""
    env = os.environ.get("WORKLOG_FILES")
    d = Path(env).expanduser() if env else DB_PATH.parent / f"{DB_PATH.stem}-attachments"
    d.mkdir(parents=True, exist_ok=True)
    return d


def max_bytes() -> int:
    return int(float(os.environ.get("WORKLOG_MAX_ATTACHMENT_MB", "25")) * 1024 * 1024)


def safe_filename(name: Optional[str]) -> str:
    """Display name only: strip any path, control characters and excess length."""
    base = (name or "").replace("\\", "/").split("/")[-1]
    base = re.sub(r"[\x00-\x1f\x7f]", "", base).strip().strip(".")
    if not base:
        return "file"
    if len(base) > 200:
        stem, ext = os.path.splitext(base)
        base = stem[: 200 - len(ext)] + ext
    return base


def _ext(filename: str) -> str:
    return os.path.splitext(filename)[1].lower()


def attachment_kind(filename: str) -> str:
    """How the UI should open it: markdown | pdf | image | text | other."""
    ext = _ext(filename)
    if ext in (".md", ".markdown"):
        return "markdown"
    if ext == ".pdf":
        return "pdf"
    if ext in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
        return "image"
    if ext in _INLINE:
        return "text"
    return "other"


def serve_profile(filename: str) -> Tuple[str, str, dict]:
    """(media_type, content_disposition_type, extra headers) for serving a file."""
    headers = {"X-Content-Type-Options": "nosniff"}
    ext = _ext(filename)
    if ext in _INLINE:
        if ext != ".pdf":
            # Chrome's PDF viewer doesn't work inside a CSP sandbox; PDFs are not scriptable against us.
            headers["Content-Security-Policy"] = "sandbox"
        return _INLINE[ext], "inline", headers
    headers["Content-Security-Policy"] = "sandbox"
    return "application/octet-stream", "attachment", headers


def guess_content_type(filename: str) -> str:
    return mimetypes.guess_type(filename)[0] or "application/octet-stream"


def read_attachment(a: TaskAttachment) -> AttachmentRead:
    return AttachmentRead(**a.model_dump(exclude={"stored_name"}), kind=attachment_kind(a.filename))


def unlink_stored(stored_names: Iterable[str]) -> None:
    d = attachments_dir()
    for name in stored_names:
        if STORED_NAME.match(name):
            try:
                (d / name).unlink()
            except FileNotFoundError:
                pass


def delete_task_attachments(session: Session, task_id: str) -> list:
    """Delete a task's attachment rows; returns stored names to unlink after commit."""
    rows = session.exec(select(TaskAttachment).where(TaskAttachment.task_id == task_id)).all()
    names = [r.stored_name for r in rows]
    for r in rows:
        session.delete(r)
    return names


def delete_meeting_attachments(session: Session, meeting_id: str) -> list:
    """Delete a meeting's attachment rows; returns stored names to unlink after commit."""
    rows = session.exec(select(MeetingAttachment).where(MeetingAttachment.meeting_id == meeting_id)).all()
    names = [r.stored_name for r in rows]
    for r in rows:
        session.delete(r)
    return names


def find_attachment(session: Session, attachment_id: str):
    """An attachment row from either owner table (ids are UUIDs, so they never collide)."""
    return session.get(TaskAttachment, attachment_id) or session.get(MeetingAttachment, attachment_id)


def all_attachments(session: Session) -> list:
    return [*session.exec(select(TaskAttachment)).all(), *session.exec(select(MeetingAttachment)).all()]


def mirror_attachments(dest_root: Path) -> int:
    """Copy attachment files missing from <dest_root>/attachments (names are immutable UUIDs)."""
    src = attachments_dir()
    dest = dest_root / "attachments"
    copied = 0
    for f in src.iterdir():
        if f.is_file() and STORED_NAME.match(f.name) and not (dest / f.name).exists():
            dest.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, dest / f.name)
            copied += 1
    return copied
