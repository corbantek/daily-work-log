import io
import json
import os
import tarfile
import tempfile
import uuid
from datetime import date
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import Session, select
from starlette.background import BackgroundTask

from ..attachments import (
    STORED_NAME, attachments_dir, guess_content_type, max_bytes, read_attachment,
    safe_filename, serve_profile, unlink_stored,
)
from ..database import get_session
from ..models import AttachmentRead, AttachmentRename, Task, TaskAttachment

router = APIRouter(tags=["attachments"])

CHUNK = 1024 * 1024


def _too_big() -> HTTPException:
    return HTTPException(413, f"File is larger than the {max_bytes() // (1024 * 1024) or 1} MB limit")


def _write_stream(src, dest_dir, limit: int) -> tuple:
    """Stream `src` into a new UUID-named file; returns (stored_name, size). Enforces `limit`."""
    stored = uuid.uuid4().hex
    part = dest_dir / f"{stored}.part"
    size = 0
    try:
        with open(part, "wb") as out:
            while chunk := src.read(CHUNK):
                size += len(chunk)
                if size > limit:
                    raise _too_big()
                out.write(chunk)
        part.rename(dest_dir / stored)
    except BaseException:
        part.unlink(missing_ok=True)
        raise
    return stored, size


@router.post("/tasks/{task_id}/attachments", response_model=AttachmentRead, status_code=201)
def upload_attachment(task_id: str, file: UploadFile = File(...), session: Session = Depends(get_session)):
    if not session.get(Task, task_id):
        raise HTTPException(404, "Task not found")
    filename = safe_filename(file.filename)
    stored, size = _write_stream(file.file, attachments_dir(), max_bytes())
    row = TaskAttachment(
        task_id=task_id, filename=filename, stored_name=stored,
        content_type=guess_content_type(filename), size_bytes=size,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return read_attachment(row)


# ── Whole-folder export / import (pairs with a database backup) ──────────────

@router.get("/attachments/stats")
def attachment_stats(session: Session = Depends(get_session)):
    d = attachments_dir()
    rows = session.exec(select(TaskAttachment)).all()
    return {
        "count": len(rows),
        "total_bytes": sum(r.size_bytes for r in rows),
        "missing_files": sum(1 for r in rows if not (d / r.stored_name).is_file()),
    }


@router.get("/attachments/archive")
def export_archive(session: Session = Depends(get_session)):
    """tar.gz of every stored file plus a manifest.json mapping ids to original names."""
    d = attachments_dir()
    tasks = {t.id: t.action for t in session.exec(select(Task)).all()}
    manifest = [
        {"id": r.id, "task_id": r.task_id, "task": tasks.get(r.task_id), "filename": r.filename,
         "stored_name": r.stored_name, "size_bytes": r.size_bytes}
        for r in session.exec(select(TaskAttachment)).all()
    ]
    fd, tmp = tempfile.mkstemp(suffix=".tar.gz")
    os.close(fd)
    try:
        with tarfile.open(tmp, "w:gz") as tar:
            for f in sorted(d.iterdir()):
                if f.is_file() and STORED_NAME.match(f.name):
                    tar.add(f, arcname=f.name)
            data = json.dumps(manifest, indent=2).encode()
            info = tarfile.TarInfo("manifest.json")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    except BaseException:
        os.unlink(tmp)
        raise
    return FileResponse(
        tmp, media_type="application/gzip", filename=f"worklog-attachments-{date.today().isoformat()}.tar.gz",
        background=BackgroundTask(os.unlink, tmp),
    )


@router.post("/attachments/archive")
def import_archive(file: UploadFile = File(...), session: Session = Depends(get_session)):
    """Restore files from an exported tar.gz. Only UUID-named regular files are extracted."""
    d = attachments_dir()
    limit = max_bytes()
    restored = skipped = 0
    try:
        with tarfile.open(fileobj=file.file, mode="r:gz") as tar:
            for member in tar:
                name = member.name[2:] if member.name.startswith("./") else member.name
                if name == "manifest.json":
                    continue  # informational only; the database is the source of truth
                if not member.isreg() or not STORED_NAME.match(name) or member.size > limit:
                    skipped += 1
                    continue
                src = tar.extractfile(member)
                if src is None:
                    skipped += 1
                    continue
                part = d / f"{name}.part"
                try:
                    with open(part, "wb") as out:
                        while chunk := src.read(CHUNK):
                            out.write(chunk)
                    part.replace(d / name)
                finally:
                    part.unlink(missing_ok=True)
                restored += 1
    except (tarfile.TarError, EOFError, OSError) as e:
        raise HTTPException(400, f"Not a valid attachments archive: {e}")
    rows = session.exec(select(TaskAttachment)).all()
    return {
        "restored": restored,
        "skipped": skipped,
        "missing_files": sum(1 for r in rows if not (d / r.stored_name).is_file()),
    }


# ── Single attachment ────────────────────────────────────────────────────────

def _get(session: Session, attachment_id: str) -> TaskAttachment:
    row = session.get(TaskAttachment, attachment_id)
    if not row:
        raise HTTPException(404, "Attachment not found")
    return row


@router.get("/attachments/{attachment_id}", response_model=AttachmentRead)
def get_attachment(attachment_id: str, session: Session = Depends(get_session)):
    return read_attachment(_get(session, attachment_id))


@router.get("/attachments/{attachment_id}/{filename}")
def get_attachment_file(attachment_id: str, filename: str, session: Session = Depends(get_session)):
    """The `filename` segment is cosmetic (tab title / download name); the id decides the file."""
    row = _get(session, attachment_id)
    path = attachments_dir() / row.stored_name
    if not STORED_NAME.match(row.stored_name) or not path.is_file():
        raise HTTPException(404, "File is missing from the attachments folder (restore your attachments archive?)")
    media_type, disposition, headers = serve_profile(row.filename)
    return FileResponse(
        path, media_type=media_type, filename=row.filename,
        content_disposition_type=disposition, headers=headers,
    )


@router.patch("/attachments/{attachment_id}", response_model=AttachmentRead)
def rename_attachment(attachment_id: str, body: AttachmentRename, session: Session = Depends(get_session)):
    row = _get(session, attachment_id)
    row.filename = safe_filename(body.filename)
    session.add(row)
    session.commit()
    session.refresh(row)
    return read_attachment(row)


@router.delete("/attachments/{attachment_id}", status_code=204)
def delete_attachment(attachment_id: str, session: Session = Depends(get_session)):
    row = _get(session, attachment_id)
    stored = row.stored_name
    session.delete(row)
    session.commit()
    unlink_stored([stored])
