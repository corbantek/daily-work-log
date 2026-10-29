"""Agent API: a compact, name-based facade over the app for a local AI agent (the Claude Code skill
in agent-skill/daily-work-log). It reuses the app's own create/update logic, so the same rules apply.

Design rules:
- Names, not ids, for workstreams and labels; an unknown or ambiguous name is a 400 that lists the options.
- Dates default to today (local); responses are small and flat.
- Notes are appended by default; replacing them must be asked for (mode="replace").
- No deletes. Every change is recorded in AgentActivity (GET /agent/activity).
"""
import re
from datetime import date, timedelta
from datetime import date as Date  # `date` is also a query-parameter name below
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, field_validator
from sqlmodel import Session, select

from ..database import get_session, note_agent_activity
from ..models import (
    AgentActivity, Label, LinkType, Meeting, MeetingAttachment, MeetingCreate, MeetingLink, MeetingTaskLink,
    MeetingUpdate, Task, TaskAttachment, TaskCreate, TaskLabelLink, TaskLink, TaskLinkCreate, TaskState,
    TaskUpdate, Workstream, _check_hhmm,
)
from . import day as day_routes
from . import meetings as meeting_routes
from . import search as search_routes
from . import tasks as task_routes
from .insights import build_meeting_insights, task_date
from .self_review import self_review
from ..refs import meeting_ref, parse_ref, task_ref
from .. import note_snapshots
from ..attachments import STORED_NAME, attachment_kind, attachments_dir, find_attachment
from . import attachments as attachment_routes

router = APIRouter(prefix="/agent", tags=["agent"])

PREVIEW_CHARS = 280
STATE_ALIASES = {  # keys are normalized: lower case, "_"/"-" as spaces
    "todo": TaskState.TODO, "to do": TaskState.TODO, "open": TaskState.TODO,
    "in progress": TaskState.IN_PROGRESS, "doing": TaskState.IN_PROGRESS, "started": TaskState.IN_PROGRESS,
    "complete": TaskState.COMPLETE, "completed": TaskState.COMPLETE, "done": TaskState.COMPLETE,
    "abandoned": TaskState.ABANDONED, "dropped": TaskState.ABANDONED, "cancelled": TaskState.ABANDONED,
}


# ── helpers ───────────────────────────────────────────────────────────────────

def _bad(msg: str, **extra) -> HTTPException:
    return HTTPException(400, detail={"error": msg, **extra})


def parse_state(value: str) -> TaskState:
    s = STATE_ALIASES.get(" ".join(value.strip().lower().replace("-", " ").replace("_", " ").split()))
    if not s:
        raise _bad(f"Unknown state {value!r}", valid=["todo", "in_progress", "complete", "abandoned"])
    return s


def _match_one(kind: str, wanted: str, options: Dict[str, str]) -> str:
    """Resolve a name to an id: exact (case-insensitive), else a unique prefix/substring match."""
    w = wanted.strip().lower()
    exact = [i for n, i in options.items() if n.lower() == w]
    if len(exact) == 1:
        return exact[0]
    partial = [n for n in options if w and (n.lower().startswith(w) or w in n.lower())]
    if len(partial) == 1:
        return options[partial[0]]
    if partial:
        raise _bad(f"{kind} {wanted!r} is ambiguous", matches=sorted(partial))
    raise _bad(f"Unknown {kind} {wanted!r}", valid=sorted(options))


def resolve_workstream(session: Session, name: Optional[str]) -> Optional[str]:
    """None/"" means no workstream (Unassigned)."""
    if name is None or not name.strip() or name.strip().lower() in ("none", "unassigned"):
        return None
    options = {w.name: w.id for w in session.exec(select(Workstream)).all() if w.archived_at is None}
    return _match_one("workstream", name, options)


def resolve_labels(session: Session, names: List[str]) -> List[str]:
    options = {l.name: l.id for l in session.exec(select(Label)).all()}
    return [_match_one("label", n, options) for n in names]


def detect_link_type(url: str) -> LinkType:
    """Same rules as pasting a link in the app (LinkSection.tsx)."""
    if re.search(r"github\.com/.*/pull/", url, re.I) or re.search(r"/pull/\d+", url):
        return LinkType.PR
    if re.search(r"github\.com/.*/issues/", url, re.I):
        return LinkType.ISSUE
    if re.search(r"slack\.com/", url, re.I):
        return LinkType.SLACK
    if re.search(r"(^|[/.])quip(-[a-z0-9]+)?\.com/", url, re.I):
        return LinkType.QUIP
    if re.search(r"docs\.|notion\.|confluence\.|wiki\.", url, re.I):
        return LinkType.DOC
    return LinkType.OTHER


def _record(session: Session, action: str, entity_type: str, entity_id: str, summary: str) -> None:
    row = AgentActivity(action=action, entity_type=entity_type, entity_id=entity_id, summary=summary)
    session.add(row)
    session.commit()
    note_agent_activity(row.id)  # lets the open app show "Agent: …" (see GET /changes)


def _preview(text: Optional[str]) -> Optional[str]:
    t = (text or "").strip()
    if not t:
        return None
    return t if len(t) <= PREVIEW_CHARS else t[:PREVIEW_CHARS].rstrip() + "…"


def _week_bounds(today: date):
    mon = today - timedelta(days=today.weekday())
    return mon, today


# ── compact shapes ────────────────────────────────────────────────────────────

TEXT_KINDS = {"markdown", "text", "html"}  # file kinds whose contents are returned as text
MAX_CONTENT_CHARS = 200_000


def file_brief(a) -> dict:
    return {"id": a.id, "filename": a.filename, "kind": attachment_kind(a.filename), "size_bytes": a.size_bytes,
            "added": a.created_at.date().isoformat()}


def _ws_names(session: Session) -> Dict[str, str]:
    return {w.id: w.name for w in session.exec(select(Workstream)).all()}


def task_brief(t: Task, ws: Dict[str, str], session: Session, notes_preview: bool = True) -> dict:
    labels = session.exec(
        select(Label).join(TaskLabelLink, TaskLabelLink.label_id == Label.id).where(TaskLabelLink.task_id == t.id)
    ).all()
    out = {
        "ref": task_ref(t.number), "id": t.id, "action": t.action, "state": t.state.value, "high_impact": t.high_impact,
        "workstream": ws.get(t.workstream_id) if t.workstream_id else None,
        "labels": [l.name for l in labels],
        "start_date": t.start_date.isoformat() if t.start_date else None,
        "end_date": t.end_date.isoformat() if t.end_date else None,
    }
    if t.parent_task_id:
        out["parent_id"] = t.parent_task_id
    if notes_preview:
        out["notes_preview"] = _preview(t.notes)
    return out


def task_detail(t: Task, session: Session) -> dict:
    ws = _ws_names(session)
    out = task_brief(t, ws, session, notes_preview=False)
    out["notes"] = t.notes
    out["links"] = [{"url": l.url, "label": l.label, "type": l.link_type.value}
                    for l in session.exec(select(TaskLink).where(TaskLink.task_id == t.id)).all()]
    out["files"] = [file_brief(a) for a in session.exec(select(TaskAttachment).where(TaskAttachment.task_id == t.id)).all()]
    meeting_ids = [ml.meeting_id for ml in session.exec(select(MeetingTaskLink).where(MeetingTaskLink.task_id == t.id)).all()]
    out["meetings"] = [{"ref": meeting_ref(m.number), "id": m.id, "title": m.title, "date": m.date.isoformat(), "start_time": m.start_time}
                       for m in (session.get(Meeting, i) for i in meeting_ids) if m]
    out["subtasks"] = [{"ref": task_ref(c.number), "id": c.id, "action": c.action, "state": c.state.value}
                       for c in session.exec(select(Task).where(Task.parent_task_id == t.id)).all()]
    return out


def meeting_brief(m: Meeting, session: Session) -> dict:
    task_ids = [ml.task_id for ml in session.exec(select(MeetingTaskLink).where(MeetingTaskLink.meeting_id == m.id)).all()]
    return {
        "ref": meeting_ref(m.number), "id": m.id, "date": m.date.isoformat(), "start_time": m.start_time, "title": m.title,
        "duration_minutes": m.duration_minutes, "excluded_from_stats": m.exclude_from_stats, "passive": m.passive,
        "from_calendar": m.source is not None, "notes_preview": _preview(m.notes),
        "tasks": [{"ref": task_ref(t.number), "id": t.id, "action": t.action, "state": t.state.value}
                  for t in (session.get(Task, i) for i in task_ids) if t],
    }


def meeting_detail(m: Meeting, session: Session) -> dict:
    out = meeting_brief(m, session)
    out.pop("notes_preview")
    out["notes"] = m.notes
    out["links"] = [{"url": l.url, "label": l.label, "type": l.link_type.value}
                    for l in session.exec(select(MeetingLink).where(MeetingLink.meeting_id == m.id)).all()]
    out["files"] = [file_brief(a) for a in session.exec(select(MeetingAttachment).where(MeetingAttachment.meeting_id == m.id)).all()]
    return out


def _get_task(session: Session, task_id: str) -> Task:
    """By id, or by reference: "T42" (also "T-42", "t42", "#42", "42")."""
    ref = parse_ref(task_id)
    if ref and ref[0] in (None, "T"):
        t = session.exec(select(Task).where(Task.number == ref[1])).first()
    elif ref:
        raise _bad(f"{task_id!r} is not a task reference; tasks are T<number>")
    else:
        t = session.get(Task, task_id)
    if not t:
        raise HTTPException(404, detail={"error": f"No task {task_id!r}"})
    return t


def _get_meeting(session: Session, meeting_id: str) -> Meeting:
    """By id, or by reference: "M17" (also "M-17", "m17", "#17", "17")."""
    ref = parse_ref(meeting_id)
    if ref and ref[0] in (None, "M"):
        m = session.exec(select(Meeting).where(Meeting.number == ref[1])).first()
    elif ref:
        raise _bad(f"{meeting_id!r} is not a meeting reference; meetings are M<number>")
    else:
        m = session.get(Meeting, meeting_id)
    if not m:
        raise HTTPException(404, detail={"error": f"No meeting {meeting_id!r}"})
    return m


# ── read ──────────────────────────────────────────────────────────────────────

@router.get("/day")
def agent_day(date: Optional[date] = None, session: Session = Depends(get_session)):  # noqa: A002
    """One day at a glance: status, on-call, meetings, and tasks by workstream."""
    day = date or Date.today()
    view = day_routes.get_day(day, session)
    ws = _ws_names(session)
    return {
        "date": day.isoformat(), "status": view.status, "status_note": view.status_note, "oncall": view.is_oncall,
        "meetings": [meeting_brief(session.get(Meeting, m.id), session) for m in view.meetings],
        "workstreams": [
            {"workstream": g.workstream.name if g.workstream else "Unassigned",
             "tasks": [task_brief(session.get(Task, t.id), ws, session) for t in g.tasks]}
            for g in view.workstreams
        ],
    }


@router.get("/tasks")
def agent_tasks(
    state: Optional[str] = None, workstream: Optional[str] = None, q: Optional[str] = None,
    date_from: Optional[date] = None, date_to: Optional[date] = None, limit: int = 50,
    session: Session = Depends(get_session),
):
    """Tasks filtered by state (comma-separated), workstream name, text, and date range (task date =
    end, else start, else created — the Review rule). Newest first."""
    query = select(Task)
    if state:
        query = query.where(Task.state.in_([parse_state(s) for s in state.split(",") if s.strip()]))
    if workstream is not None:
        query = query.where(Task.workstream_id == resolve_workstream(session, workstream))
    tasks = session.exec(query).all()
    if q:
        needle = q.lower()
        tasks = [t for t in tasks if needle in t.action.lower() or needle in (t.notes or "").lower()]
    tasks = [t for t in tasks if (not date_from or task_date(t) >= date_from) and (not date_to or task_date(t) <= date_to)]
    tasks.sort(key=lambda t: (task_date(t), t.created_at), reverse=True)
    ws = _ws_names(session)
    return {"count": len(tasks), "tasks": [task_brief(t, ws, session) for t in tasks[: max(1, min(limit, 500))]]}


@router.get("/tasks/{task_id}")
def agent_task(task_id: str, session: Session = Depends(get_session)):
    return task_detail(_get_task(session, task_id), session)


@router.get("/open")
def agent_open(session: Session = Depends(get_session)):
    """Everything still todo or in progress, grouped by workstream (oldest first)."""
    open_tasks = session.exec(select(Task).where(Task.state.in_([TaskState.TODO, TaskState.IN_PROGRESS]))).all()
    ws = _ws_names(session)
    groups: Dict[str, list] = {}
    for t in sorted(open_tasks, key=lambda t: (task_date(t), t.created_at)):
        groups.setdefault(ws.get(t.workstream_id, "Unassigned") if t.workstream_id else "Unassigned", []).append(
            task_brief(t, ws, session))
    return {"count": len(open_tasks), "workstreams": [{"workstream": k, "tasks": v} for k, v in sorted(groups.items())]}


@router.get("/meetings")
def agent_meetings(
    date: Optional[date] = None, date_from: Optional[date] = None, date_to: Optional[date] = None,  # noqa: A002
    q: Optional[str] = None, session: Session = Depends(get_session),
):
    """Meetings on a day (default today) or in a range, optionally matching text in title/notes."""
    if date or not (date_from or date_to):
        date_from = date_to = date or Date.today()
    query = select(Meeting)
    if date_from:
        query = query.where(Meeting.date >= date_from)
    if date_to:
        query = query.where(Meeting.date <= date_to)
    meetings = session.exec(query.order_by(Meeting.date, *meeting_routes.MEETING_ORDER)).all()
    if q:
        needle = q.lower()
        meetings = [m for m in meetings if needle in m.title.lower() or needle in (m.notes or "").lower()]
    return {"count": len(meetings), "meetings": [meeting_brief(m, session) for m in meetings]}


@router.get("/meetings/{meeting_id}")
def agent_meeting(meeting_id: str, session: Session = Depends(get_session)):
    return meeting_detail(_get_meeting(session, meeting_id), session)


@router.get("/search")
def agent_search(q: str, session: Session = Depends(get_session)):
    """Search tasks, meetings, people and interactions (same as the app's ⌘K search)."""
    return [r.model_dump(exclude_none=True) for r in search_routes.search(q, session)]


@router.get("/summary")
def agent_summary(date_from: Optional[date] = None, date_to: Optional[date] = None, session: Session = Depends(get_session)):
    """What I did in a period (default: this week so far): completed / high-impact / in-progress tasks
    by workstream, and meeting stats with the tasks that came out of meetings."""
    today = Date.today()
    if not date_from and not date_to:
        date_from, date_to = _week_bounds(today)
    date_from = date_from or date_to
    date_to = date_to or today
    sr = self_review(date_from, date_to, session)
    mi = build_meeting_insights(session, date_from, date_to, today)
    by_ws = {}
    for g in sr.groups:
        name = g.workstream.name if g.workstream else "Unassigned"
        by_ws[name] = [{"id": t.id, "action": t.action, "state": t.state.value, "high_impact": t.high_impact} for t in g.tasks]
    st = mi.stats
    return {
        "date_from": date_from.isoformat(), "date_to": date_to.isoformat(),
        "tasks": {
            "completed": sr.stats.tasks_completed, "in_progress": sr.stats.in_progress, "high_impact": sr.stats.high_impact,
            "by_workstream": by_ws,
        },
        "meetings": {
            "count": st.meeting_count, "hours": round(st.total_minutes / 60, 1),
            "share_of_work_week": round(st.work_share, 3) if st.work_share is not None else None,
            "busiest_day": st.busiest_day.date.isoformat() if st.busiest_day else None,
            "excluded_from_stats": st.excluded_count,
            "outcomes": [{"task": o.action, "state": o.state.value, "from": [m.title for m in o.meetings]} for o in mi.outcomes],
        },
    }


@router.get("/activity")
def agent_activity(limit: int = 50, session: Session = Depends(get_session)):
    """Changes the agent has made, newest first."""
    rows = session.exec(select(AgentActivity).order_by(AgentActivity.created_at.desc()).limit(max(1, min(limit, 500)))).all()
    return [{"id": r.id, "at": r.created_at.isoformat(timespec="seconds") + "Z", "action": r.action, "entity_type": r.entity_type,
             "entity_id": r.entity_id, "summary": r.summary} for r in rows]


# ── write ─────────────────────────────────────────────────────────────────────

class NewTask(BaseModel):
    action: str
    workstream: Optional[str] = None
    state: Optional[str] = None
    notes: Optional[str] = None
    high_impact: bool = False
    labels: List[str] = []
    start_date: Optional[date] = None  # default: today
    end_date: Optional[date] = None
    parent_id: Optional[str] = None


class TaskChanges(BaseModel):
    action: Optional[str] = None
    state: Optional[str] = None
    high_impact: Optional[bool] = None
    workstream: Optional[str] = None  # "" or "unassigned" clears it
    labels: Optional[List[str]] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    parent_id: Optional[str] = None  # make it a sub-task of this task; "" (or null) makes it top-level again


class NotesText(BaseModel):
    text: str
    mode: str = "append"  # append | replace

    @field_validator("mode")
    @classmethod
    def _mode(cls, v):
        if v not in ("append", "replace"):
            raise ValueError('mode must be "append" or "replace"')
        return v


class NewLink(BaseModel):
    url: str
    label: Optional[str] = None
    type: Optional[str] = None  # pr | issue | doc | slack | quip | other; guessed from the URL when omitted


class NewMeeting(BaseModel):
    title: str
    date: Optional[Date] = None  # default: today (annotated as Date: a field named `date` shadows the type)
    start_time: Optional[str] = None  # "HH:MM", 24-hour
    duration_minutes: Optional[int] = None
    notes: Optional[str] = None
    exclude_from_stats: bool = False
    passive: bool = False

    @field_validator("start_time")
    @classmethod
    def _t(cls, v):
        return _check_hhmm(v)


class MeetingChanges(BaseModel):
    title: Optional[str] = None
    date: Optional[Date] = None
    start_time: Optional[str] = None
    duration_minutes: Optional[int] = None
    exclude_from_stats: Optional[bool] = None
    passive: Optional[bool] = None

    @field_validator("start_time")
    @classmethod
    def _t(cls, v):
        return _check_hhmm(v)


class MeetingTask(BaseModel):
    """Link an existing task (task_id), or create one from the meeting (action + optional fields)."""
    task_id: Optional[str] = None
    action: Optional[str] = None
    workstream: Optional[str] = None
    state: Optional[str] = None
    notes: Optional[str] = None
    high_impact: bool = False
    parent_id: Optional[str] = None  # create the new task as a sub-task of this one


NOTES_VERB = {"append": "appended", "replace": "replaced"}


def _join_notes(current: Optional[str], text: str, mode: str) -> Optional[str]:
    text = text.strip()
    if mode == "replace":
        return text or None
    return f"{current.rstrip()}\n\n{text}" if (current or "").strip() else (text or None)


def _create_task(session: Session, body: NewTask) -> Task:
    ws_id = resolve_workstream(session, body.workstream)
    parent_id = None
    if body.parent_id:
        parent = _get_task(session, body.parent_id)
        parent_id = parent.id
        if body.workstream is None:
            ws_id = parent.workstream_id  # a sub-task lives in its parent's workstream
        _check_parent(session, parent, ws_id)
    try:
        created = task_routes.create_task(TaskCreate(
            action=body.action.strip(), workstream_id=ws_id,
            state=parse_state(body.state) if body.state else TaskState.TODO,
            notes=(body.notes or "").strip() or None, high_impact=body.high_impact,
            start_date=body.start_date or Date.today(), end_date=body.end_date,
            parent_task_id=parent_id, label_ids=resolve_labels(session, body.labels),
        ), session)
    except HTTPException as e:
        if e.status_code == 400 and isinstance(e.detail, str):
            raise _bad(e.detail)
        raise
    return session.get(Task, created.id)


def _check_parent(session: Session, parent: Task, workstream_id: Optional[str]):
    """Explain, in the agent's terms, why a task can't go under `parent`."""
    ref = task_ref(parent.number)
    if parent.parent_task_id:
        top = session.get(Task, parent.parent_task_id)
        raise _bad(f"{ref} is itself a sub-task, and sub-tasks can't have sub-tasks (one level only). "
                   f"Use its parent {task_ref(top.number)} as parent_id instead.")
    if workstream_id != parent.workstream_id:
        ws = _ws_names(session).get(parent.workstream_id) or "no workstream"
        raise _bad(f"A sub-task must be in its parent's workstream ({ws}, for {ref}). "
                   "Leave workstream out and it will use it.")


@router.post("/tasks", status_code=201)
def agent_create_task(body: NewTask, session: Session = Depends(get_session)):
    if not body.action.strip():
        raise _bad("action (the task title) is required")
    t = _create_task(session, body)
    _record(session, "create_task", "task", t.id, f'created {task_ref(t.number)} "{t.action}"')
    return task_detail(t, session)


@router.patch("/tasks/{task_id}")
def agent_update_task(task_id: str, body: TaskChanges, session: Session = Depends(get_session)):
    t = _get_task(session, task_id)
    task_id = t.id
    before = task_brief(t, _ws_names(session), session, notes_preview=False)
    changes = body.model_dump(exclude_unset=True)
    update = {}
    if "action" in changes:
        update["action"] = changes["action"].strip()
    if "state" in changes:
        update["state"] = parse_state(changes["state"])
    if "high_impact" in changes:
        update["high_impact"] = changes["high_impact"]
    if "workstream" in changes:
        update["workstream_id"] = resolve_workstream(session, changes["workstream"])
    if "labels" in changes:
        update["label_ids"] = resolve_labels(session, changes["labels"] or [])
    for k in ("start_date", "end_date"):
        if k in changes:
            update[k] = changes[k]
    if "parent_id" in changes:
        if changes["parent_id"]:
            parent = _get_task(session, changes["parent_id"])
            if parent.id == t.id:
                raise _bad("A task can't be its own parent")
            if "workstream_id" not in update:
                update["workstream_id"] = parent.workstream_id  # a sub-task moves into its parent's workstream
            if session.exec(select(Task).where(Task.parent_task_id == t.id)).first():
                raise _bad(f"{task_ref(t.number)} has sub-tasks of its own, so it can't become a sub-task (one level only)")
            _check_parent(session, parent, update["workstream_id"])
            update["parent_task_id"] = parent.id
        else:
            update["parent_task_id"] = None
    if not update:
        raise _bad("Nothing to change", fields=list(TaskChanges.model_fields))
    try:
        task_routes.update_task(task_id, TaskUpdate(**update), session)
    except HTTPException as e:
        raise _bad(e.detail if isinstance(e.detail, str) else str(e.detail))
    t = session.get(Task, task_id)
    after = task_brief(t, _ws_names(session), session, notes_preview=False)
    diff = ", ".join(f"{k} {before.get(k)!r} → {after.get(k)!r}" for k in [*after, *(k for k in before if k not in after)] if before.get(k) != after.get(k))
    _record(session, "update_task", "task", t.id, f'updated {task_ref(t.number)} "{t.action}": {diff or "no change"}')
    return task_detail(t, session)


@router.post("/tasks/{task_id}/notes")
def agent_task_notes(task_id: str, body: NotesText, session: Session = Depends(get_session)):
    t = _get_task(session, task_id)
    backup = note_snapshots.save(task_ref(t.number), t.notes)  # before every change, in case it goes wrong
    t.notes = _join_notes(t.notes, body.text, body.mode)
    session.add(t)
    session.commit()
    _record(session, f"{body.mode}_task_notes", "task", t.id, f'{NOTES_VERB[body.mode]} notes on {task_ref(t.number)} "{t.action}"')
    return {**task_detail(t, session), "notes_backup": backup}


@router.post("/tasks/{task_id}/links", status_code=201)
def agent_task_link(task_id: str, body: NewLink, session: Session = Depends(get_session)):
    t = _get_task(session, task_id)
    task_id = t.id
    link_type = _link_type(body)
    task_routes.add_link(task_id, TaskLinkCreate(url=body.url.strip(), label=body.label, link_type=link_type), session)
    _record(session, "add_task_link", "task", t.id, f'added {link_type.value} link to {task_ref(t.number)} "{t.action}": {body.url.strip()}')
    return task_detail(t, session)


@router.post("/meetings/{meeting_id}/links", status_code=201)
def agent_meeting_link(meeting_id: str, body: NewLink, session: Session = Depends(get_session)):
    """Add a link to a meeting (type guessed from the URL unless given), e.g. an agenda or a recording."""
    m = _get_meeting(session, meeting_id)
    link_type = _link_type(body)
    meeting_routes.add_link(m.id, TaskLinkCreate(url=body.url.strip(), label=body.label, link_type=link_type), session)
    _record(session, "add_meeting_link", "meeting", m.id, f'added {link_type.value} link to {meeting_ref(m.number)} "{m.title}": {body.url.strip()}')
    return meeting_detail(m, session)


def _link_type(body: NewLink) -> LinkType:
    if not body.url.strip():
        raise _bad("url is required")
    if body.type:
        try:
            return LinkType(body.type.strip().lower())
        except ValueError:
            raise _bad(f"Unknown link type {body.type!r}", valid=[x.value for x in LinkType])
    return detect_link_type(body.url)


@router.post("/meetings", status_code=201)
def agent_create_meeting(body: NewMeeting, session: Session = Depends(get_session)):
    if not body.title.strip():
        raise _bad("title is required")
    created = meeting_routes.create_meeting(MeetingCreate(
        title=body.title.strip(), date=body.date or Date.today(), start_time=body.start_time,
        duration_minutes=body.duration_minutes, notes=(body.notes or "").strip() or None,
        exclude_from_stats=body.exclude_from_stats, passive=body.passive,
    ), session)
    m = session.get(Meeting, created.id)
    _record(session, "create_meeting", "meeting", m.id, f'created {meeting_ref(m.number)} "{m.title}" on {m.date.isoformat()}')
    return meeting_detail(m, session)


@router.patch("/meetings/{meeting_id}")
def agent_update_meeting(meeting_id: str, body: MeetingChanges, session: Session = Depends(get_session)):
    m = _get_meeting(session, meeting_id)
    meeting_id = m.id
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise _bad("Nothing to change", fields=list(MeetingChanges.model_fields))
    before = {k: getattr(m, k) for k in changes}
    meeting_routes.update_meeting(meeting_id, MeetingUpdate(**changes), session)
    m = session.get(Meeting, meeting_id)
    diff = ", ".join(f"{k} {before[k]!r} → {getattr(m, k)!r}" for k in changes if before[k] != getattr(m, k))
    _record(session, "update_meeting", "meeting", m.id, f'updated {meeting_ref(m.number)} "{m.title}": {diff or "no change"}')
    return meeting_detail(m, session)


@router.post("/meetings/{meeting_id}/notes")
def agent_meeting_notes(meeting_id: str, body: NotesText, session: Session = Depends(get_session)):
    m = _get_meeting(session, meeting_id)
    backup = note_snapshots.save(meeting_ref(m.number), m.notes)  # before every change, in case it goes wrong
    m.notes = _join_notes(m.notes, body.text, body.mode)
    session.add(m)
    session.commit()
    _record(session, f"{body.mode}_meeting_notes", "meeting", m.id, f'{NOTES_VERB[body.mode]} notes on {meeting_ref(m.number)} "{m.title}"')
    return {**meeting_detail(m, session), "notes_backup": backup}


@router.post("/meetings/{meeting_id}/tasks", status_code=201)
def agent_meeting_task(meeting_id: str, body: MeetingTask, session: Session = Depends(get_session)):
    m = _get_meeting(session, meeting_id)
    if bool(body.task_id) == bool(body.action and body.action.strip()):
        raise _bad("Give either task_id (link an existing task) or action (create a new task)")
    if body.task_id:
        t = _get_task(session, body.task_id)
        verb = "linked"
    else:
        t = _create_task(session, NewTask(action=body.action, workstream=body.workstream, state=body.state,
                                          notes=body.notes, high_impact=body.high_impact, start_date=m.date,
                                          parent_id=body.parent_id))
        verb = "created"
    if not session.get(MeetingTaskLink, (m.id, t.id)):
        session.add(MeetingTaskLink(meeting_id=m.id, task_id=t.id))
        session.commit()
    _record(session, "meeting_task", "meeting", m.id, f'{verb} task "{t.action}" from meeting "{m.title}"')
    return meeting_detail(m, session)


# ── files: attach, list, read ─────────────────────────────────────────────────

@router.post("/tasks/{task_id}/files", status_code=201)
def agent_task_file(task_id: str, file: UploadFile = File(...), session: Session = Depends(get_session)):
    """Attach a file (multipart field "file"); same 25 MB limit and serving rules as the app."""
    t = _get_task(session, task_id)
    a = attachment_routes.upload_attachment(t.id, file, session)
    _record(session, "attach_task_file", "task", t.id, f'attached "{a.filename}" to {task_ref(t.number)} "{t.action}"')
    return task_detail(t, session)


@router.post("/meetings/{meeting_id}/files", status_code=201)
def agent_meeting_file(meeting_id: str, file: UploadFile = File(...), session: Session = Depends(get_session)):
    m = _get_meeting(session, meeting_id)
    a = attachment_routes.upload_meeting_attachment(m.id, file, session)
    _record(session, "attach_meeting_file", "meeting", m.id, f'attached "{a.filename}" to {meeting_ref(m.number)} "{m.title}"')
    return meeting_detail(m, session)


@router.get("/tasks/{task_id}/files")
def agent_task_files(task_id: str, session: Session = Depends(get_session)):
    t = _get_task(session, task_id)
    return {"ref": task_ref(t.number), "files": task_detail(t, session)["files"]}


@router.get("/meetings/{meeting_id}/files")
def agent_meeting_files(meeting_id: str, session: Session = Depends(get_session)):
    m = _get_meeting(session, meeting_id)
    return {"ref": meeting_ref(m.number), "files": meeting_detail(m, session)["files"]}


@router.get("/files/{file_id}")
def agent_file(file_id: str, session: Session = Depends(get_session)):
    """A file's details. Text-like files (markdown, text, CSV, JSON, HTML) include their contents;
    for others (PDF, images, …) use `path` with a local file-reading tool."""
    a = find_attachment(session, file_id)
    if not a:
        raise HTTPException(404, detail={"error": f"No file with id {file_id!r}"})
    if getattr(a, "task_id", None):
        owner_row = session.get(Task, a.task_id)
        owner = {"type": "task", "ref": task_ref(owner_row.number), "title": owner_row.action} if owner_row else None
    else:
        owner_row = session.get(Meeting, a.meeting_id)
        owner = {"type": "meeting", "ref": meeting_ref(owner_row.number), "title": owner_row.title} if owner_row else None
    path = attachments_dir() / a.stored_name
    if not STORED_NAME.match(a.stored_name) or not path.is_file():
        raise HTTPException(404, detail={"error": f"{a.filename!r} is missing from the attachments folder"})
    out = {**file_brief(a), "attached_to": owner, "path": str(path.resolve())}
    if out["kind"] in TEXT_KINDS:
        text = path.read_text(encoding="utf-8", errors="replace")
        out["content"] = text[:MAX_CONTENT_CHARS]
        out["truncated"] = len(text) > MAX_CONTENT_CHARS
    else:
        out["content"] = None
        out["read_with"] = "Not text: open `path` with a file-reading tool (PDFs and images can be read directly)."
    return out


# ── note backups (taken automatically before every notes change) ─────────────

def _backup_ref(ref: str) -> str:
    parsed = parse_ref(ref)
    if not parsed or parsed[0] is None:
        raise _bad("Give a task, meeting or person reference like T42, M17 or P12")
    return f"{parsed[0]}{parsed[1]}"


@router.get("/notes-backups/{ref}")
def agent_note_backups(ref: str):
    """Saved earlier versions of a task's, meeting's or person's notes (newest first; kept 30 days)."""
    r = _backup_ref(ref)
    return {"ref": r, "backups": note_snapshots.list_for(r)}


@router.get("/notes-backups/{ref}/{name}")
def agent_note_backup(ref: str, name: str):
    r = _backup_ref(ref)
    text = note_snapshots.read(r, name)
    if text is None:
        raise HTTPException(404, detail={"error": f"No backup {name!r} for {r}"})
    return {"ref": r, "name": name, "notes": text}


# ── self-description ──────────────────────────────────────────────────────────

@router.get("/help")
def agent_help():
    """Every agent endpoint with its parameters, so the skill can stay short."""
    return {
        "notes": [
            "Dates are local YYYY-MM-DD and default to today. Times are 24-hour HH:MM.",
            "Workstreams and labels are given by name (case-insensitive; a unique partial match works). "
            "An unknown or ambiguous name returns 400 with the valid options.",
            "Task states: todo, in_progress, complete, abandoned (aliases like 'done' work).",
            "Tasks and meetings have short references, T42 and M17 (the 'ref' field, shown in the app). "
            "Use a reference or the id wherever an {id}, task_id or parent_id is expected.",
            "Notes endpoints append by default; mode='replace' rewrites the whole note (e.g. to merge repeated "
            "information or mark finished TODOs DONE). Before every notes change the previous version is saved "
            "(response field notes_backup; list them with GET /agent/notes-backups/{ref}).",
            "People have references like P12; a person's name also works where {person} is expected if it's "
            "unique (ambiguous → 400 with matches). Each person can have a manager, forming an org tree: team and "
            "focus left blank are inherited from the nearest manager who has them (responses say team_inherited_from), "
            "so set them on the highest person they apply to; role is personal.",
            "Interactions are dated observations about one person: summary, sentiment (strength | growth | neutral), "
            "competency tags as \"Dimension\" or \"Dimension: attribute\" (GET /agent/framework lists them), notes.",
            "There are no delete endpoints. Every change is recorded in GET /agent/activity.",
        ],
        "read": {
            "GET /agent/day?date=": "One day: status, on-call, meetings, tasks by workstream.",
            "GET /agent/tasks?state=&workstream=&q=&date_from=&date_to=&limit=": "Tasks (state may be comma-separated).",
            "GET /agent/tasks/{id}": "Full task: notes, links, files, meetings, sub-tasks.",
            "GET /agent/open": "Everything todo or in progress, by workstream.",
            "GET /agent/meetings?date= | ?date_from=&date_to=&q=": "Meetings on a day (default today) or range.",
            "GET /agent/meetings/{id}": "Full meeting: notes, tasks, links, files.",
            "GET /agent/search?q=": "Search tasks, meetings, people, interactions.",
            "GET /agent/summary?date_from=&date_to=": "What I did in a period (default this week so far).",
            "GET /agent/activity?limit=": "Changes made through /agent, newest first.",
            "GET /agent/tasks/{id}/files": "A task's files (id, name, kind, size).",
            "GET /agent/meetings/{id}/files": "A meeting's files (id, name, kind, size).",
            "GET /agent/files/{file_id}": "One file: text contents for markdown/text/CSV/JSON/HTML; otherwise a local `path` to read.",
            "GET /agent/notes-backups/{ref}": "Saved earlier versions of a task/meeting's notes (newest first, kept 30 days).",
            "GET /agent/notes-backups/{ref}/{name}": "One saved version's text (restore it with POST …/notes mode=replace).",
            "GET /agent/people?q=&team=&include_archived=": "People (team matches inherited teams/focus too).",
            "GET /agent/people/tree?include_archived=": "Org tree; each node shows only what's set on it (the rest is inherited).",
            "GET /agent/people/{person}": "One person: effective team/focus, manager chain, reports, notes, recent interactions.",
            "GET /agent/people/{person}/interactions?date_from=&date_to=&sentiment=": "A person's interactions, newest first.",
            "GET /agent/people/{person}/review-draft?date_from=&date_to=": "Interactions arranged for a peer review (per dimension, candidates).",
            "GET /agent/framework": "Competency dimensions and attributes (valid interaction tags).",
        },
        "write": {
            "POST /agent/tasks": "{action, workstream?, state?, notes?, high_impact?, labels?, start_date?, end_date?, parent_id?}",
            "PATCH /agent/tasks/{id}": "{action?, state?, high_impact?, workstream?, labels?, start_date?, end_date?, parent_id? (\"\" makes it top-level)}",
            "POST /agent/tasks/{id}/notes": "{text, mode?: append|replace}",
            "POST /agent/tasks/{id}/links": "{url, label?, type?: pr|issue|doc|slack|quip|other}",
            "POST /agent/meetings": "{title, date?, start_time?, duration_minutes?, notes?, exclude_from_stats?, passive?}",
            "PATCH /agent/meetings/{id}": "{title?, date?, start_time?, duration_minutes?, exclude_from_stats?, passive?}",
            "POST /agent/meetings/{id}/notes": "{text, mode?: append|replace}",
            "POST /agent/tasks/{id}/files": "multipart form field 'file' (curl -F 'file=@/path/to/file'); 25 MB max",
            "POST /agent/meetings/{id}/links": "{url, label?, type?: pr|issue|doc|slack|quip|other}",
            "POST /agent/meetings/{id}/files": "multipart form field 'file'; 25 MB max",
            "POST /agent/meetings/{id}/tasks": "{task_id} to link, or {action, workstream?, state?, notes?, high_impact?, parent_id?} to create",
            "POST /agent/people": "{name, role?, team?, focus?, manager? (ref or name), relationship?, notes?, placeholder?}",
            "PATCH /agent/people/{person}": "{name?, role?, team? (\"\" = inherit), focus?, manager? (\"\" = none), relationship?, placeholder?, archived?}",
            "POST /agent/people/{person}/notes": "{text, mode?: append|replace}",
            "POST /agent/people/{person}/interactions": "{summary, date?, sentiment?, tags?: [\"Dimension: attribute\"], notes?, workstream?, high_impact?}",
            "PATCH /agent/interactions/{interaction_id}": "{summary?, date?, sentiment?, tags? (replaces), notes? (replaces), workstream?, high_impact?}",
        },
    }
