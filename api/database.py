import shutil
import sqlite3
from sqlmodel import SQLModel, create_engine, Session
from pathlib import Path

DB_PATH = Path(__file__).parent / "worklog.db"
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
    conn.close()


def init_db():
    _run_migrations()
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
