import os
import shutil
import sqlite3
from datetime import datetime
from sqlalchemy import event, func, select as sa_select
from sqlalchemy.orm import Session as OrmSession
from sqlmodel import SQLModel, create_engine, Session, select
from pathlib import Path

_db_name = os.environ.get("WORKLOG_DB", "worklog.db")
DB_PATH = Path(__file__).parent / _db_name
engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)


def _run_migrations():
    if not DB_PATH.exists():
        return

    shutil.copy2(DB_PATH, DB_PATH.with_suffix(".db.bak"))

    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(task)")
    columns = {row[1] for row in cursor.fetchall()}
    if "description" in columns and "notes" not in columns:
        cursor.execute("ALTER TABLE task RENAME COLUMN description TO notes")
        conn.commit()
    if "parent_task_id" not in columns:
        cursor.execute("ALTER TABLE task ADD COLUMN parent_task_id VARCHAR")
        conn.commit()

    cursor.execute("PRAGMA table_info(day_status)")
    ds_columns = {row[1] for row in cursor.fetchall()}
    if "note" not in ds_columns:
        cursor.execute("ALTER TABLE day_status ADD COLUMN note VARCHAR")
        conn.commit()

    cursor.execute("PRAGMA table_info(meeting)")
    meeting_columns = {row[1] for row in cursor.fetchall()}
    if meeting_columns:
        for col, ddl in [
            ("source", "VARCHAR"),
            ("external_id", "VARCHAR"),
            ("start_time", "VARCHAR"),
            ("source_fingerprint", "VARCHAR"),
            ("missing_from_source", "BOOLEAN NOT NULL DEFAULT 0"),
            ("exclude_from_stats", "BOOLEAN NOT NULL DEFAULT 0"),
        ]:
            if col not in meeting_columns:
                cursor.execute(f"ALTER TABLE meeting ADD COLUMN {col} {ddl}")
        conn.commit()

    # Short reference numbers (T<n>, M<n>): add the column and number existing rows once, oldest first.
    for table in ("task", "meeting"):
        cursor.execute(f"PRAGMA table_info({table})")
        cols = {row[1] for row in cursor.fetchall()}
        if cols and "number" not in cols:
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN number INTEGER")
            ids = [r[0] for r in cursor.execute(f"SELECT id FROM {table} ORDER BY created_at, rowid")]
            cursor.executemany(f"UPDATE {table} SET number = ? WHERE id = ?", [(i + 1, rid) for i, rid in enumerate(ids)])
            cursor.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS ix_{table}_number ON {table} (number)")
            conn.commit()

    conn.close()


@event.listens_for(OrmSession, "before_flush")
def _assign_reference_numbers(session, flush_context, instances):
    """Give every new Task / Meeting the next T/M number, whatever created it (the app, the agent,
    calendar sync, a backup restore). Rows that already carry a number (a restored backup) keep it."""
    from .models import Meeting, Setting, Task
    for model, counter_key in ((Task, "ref_counter_task"), (Meeting, "ref_counter_meeting")):
        new = [o for o in session.new if isinstance(o, model)]
        missing = [o for o in new if o.number is None]
        if not missing:
            continue
        with session.no_autoflush:
            highest = session.execute(sa_select(func.max(model.number))).scalar() or 0
            # High-water mark, so deleting the newest task never frees its number for reuse.
            counter = session.get(Setting, counter_key)
        stored = int(counter.value) if counter and counter.value.isdigit() else 0
        highest = max([highest, stored] + [o.number for o in new if o.number is not None])
        for o in sorted(missing, key=lambda o: o.created_at or datetime.min):
            highest += 1
            o.number = highest
        if counter:
            counter.value = str(highest)
        else:
            session.add(Setting(key=counter_key, value=str(highest)))


def _seed_framework():
    from .models import CompetencyDimension, CompetencyAttribute, DEFAULT_FRAMEWORK

    with Session(engine) as session:
        existing = session.exec(select(CompetencyDimension)).first()
        if existing:
            return
        for d_order, dim in enumerate(DEFAULT_FRAMEWORK):
            session.add(CompetencyDimension(key=dim["key"], label=dim["label"], sort_order=d_order))
            for a_order, text in enumerate(dim["attributes"]):
                session.add(CompetencyAttribute(
                    dimension_key=dim["key"], text=text, sort_order=a_order,
                ))
        session.commit()


def init_db():
    _run_migrations()
    SQLModel.metadata.create_all(engine)
    _seed_framework()


def get_session():
    with Session(engine) as session:
        yield session
