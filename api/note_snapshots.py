"""Temporary snapshots of task/meeting notes, taken before every /agent notes change.

They let the user (or the agent) recover a note if a rewrite goes wrong. Plain .md files in a folder
next to the database (WORKLOG_NOTE_SNAPSHOTS to override), named "<ref>--<UTC time>.md", kept for
RETENTION_DAYS and pruned on each save. Deliberately not part of the JSON backups: they are temporary.
"""
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

from .database import DB_PATH

RETENTION_DAYS = 30
_NAME = re.compile(r"^(?P<ref>[TM]\d+)--(?P<stamp>\d{8}T\d{6}\d{6}Z)\.md$")


def snapshots_dir() -> Path:
    env = os.environ.get("WORKLOG_NOTE_SNAPSHOTS")
    d = Path(env).expanduser() if env else DB_PATH.parent / f"{DB_PATH.stem}-note-snapshots"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _stamp(dt: datetime) -> str:
    return dt.strftime("%Y%m%dT%H%M%S%fZ")


def _parse(name: str):
    m = _NAME.match(name)
    if not m:
        return None
    at = datetime.strptime(m.group("stamp"), "%Y%m%dT%H%M%S%fZ").replace(tzinfo=timezone.utc)
    return m.group("ref"), at


def save(ref: Optional[str], text: Optional[str]) -> Optional[str]:
    """Save the current notes before they change; returns the snapshot name (None if nothing to save)."""
    if not ref or not (text or "").strip():
        return None
    d = snapshots_dir()
    name = f"{ref}--{_stamp(datetime.now(timezone.utc))}.md"
    (d / name).write_text(text, encoding="utf-8")
    prune(d)
    return name


def prune(d: Optional[Path] = None, now: Optional[datetime] = None) -> int:
    d = d or snapshots_dir()
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=RETENTION_DAYS)
    removed = 0
    for f in d.iterdir():
        parsed = _parse(f.name)
        if parsed and parsed[1] < cutoff:
            f.unlink(missing_ok=True)
            removed += 1
    return removed


def list_for(ref: str) -> List[dict]:
    """Snapshots of one task/meeting, newest first."""
    out = []
    for f in snapshots_dir().iterdir():
        parsed = _parse(f.name)
        if parsed and parsed[0] == ref:
            out.append({"name": f.name, "at": parsed[1].isoformat(timespec="seconds").replace("+00:00", "Z"),
                        "chars": f.stat().st_size})
    return sorted(out, key=lambda s: s["name"], reverse=True)


def read(ref: str, name: str) -> Optional[str]:
    parsed = _parse(name)
    if not parsed or parsed[0] != ref:  # only well-formed names for this item: no path tricks
        return None
    f = snapshots_dir() / name
    return f.read_text(encoding="utf-8") if f.is_file() else None
