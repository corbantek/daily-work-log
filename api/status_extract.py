"""One-off migration helper: move the trailing `**Status:** …` line out of task notes into Task.status.

Dry run (default) prints what would change; `--apply` writes it (back up the DB first).
    api/.venv/bin/python -m api.status_extract [--apply]
"""
import re
import sys
from typing import Optional, Tuple

# A whole line like `**Status:** text` / `**Status**: text` (bold optional-colon placement). One line only.
_STATUS_LINE = re.compile(r"^[ \t]*\*\*Status(?::\*\*|\*\*:)[ \t]*(\S.*?)[ \t]*$", re.MULTILINE)


def extract_status(notes: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """Return (status, notes_without_the_line); (None, notes) when there is no clean status line.
    The last such line wins; blank lines left at the end of the notes are trimmed."""
    if not notes:
        return None, notes
    matches = list(_STATUS_LINE.finditer(notes))
    if not matches:
        return None, notes
    m = matches[-1]
    status = " ".join(m.group(1).split())
    rest = (notes[:m.start()] + notes[m.end():]).rstrip()
    return status, rest or None


def main(apply: bool) -> None:
    from datetime import datetime
    from sqlmodel import Session, select
    from .database import engine, init_db
    from .models import Task
    init_db()
    changed = 0
    with Session(engine) as session:
        for t in session.exec(select(Task)).all():
            if t.status:
                continue
            status, rest = extract_status(t.notes)
            if not status:
                continue
            changed += 1
            print(f"T{t.number}: {status}")
            if apply:
                t.status, t.notes, t.status_updated_at = status, rest, datetime.utcnow()
                session.add(t)
        if apply:
            session.commit()
    print(f"{changed} task(s) {'updated' if apply else 'would be updated (re-run with --apply)'}")


if __name__ == "__main__":
    main("--apply" in sys.argv)
