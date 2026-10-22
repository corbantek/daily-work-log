"""Read-only aggregations for the Review tab's Meetings and Links views."""
import re
from datetime import date, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from ..attachments import read_attachment
from ..database import get_session
from ..models import (
    BusiestDay, DayStatus, InsightSource, LinkInsight, Meeting, MeetingAttachment, MeetingDigestEntry,
    MeetingInsights, MeetingLink, MeetingStats, MeetingTaskLink, MeetingWeek, OutcomeMeeting,
    OutcomeTask, Task, TaskAttachment, TaskBrief, TaskLink, TaskState,
)
from .meetings import MEETING_ORDER

router = APIRouter(prefix="/insights", tags=["insights"])

WORKDAY_MINUTES = 8 * 60
# A day whose status contains one of these words is not a working day (matched case-insensitively,
# so custom statuses like "🌴 PTO" count too).
DAY_OFF_WORDS = ("vacation", "sick", "out of office", "ooo", "pto", "holiday")
PREVIEW_MAX_LINES = 12
# Outcomes list open tasks first, then done, then abandoned.
OUTCOME_ORDER = {TaskState.TODO: 0, TaskState.IN_PROGRESS: 0, TaskState.COMPLETE: 1, TaskState.ABANDONED: 2}


def task_date(t: Task) -> date:
    """Same rule as the Tasks review and Self-Review: end date, else start date, else created."""
    return t.end_date or t.start_date or t.created_at.date()


def _in_range(d: date, date_from: Optional[date], date_to: Optional[date]) -> bool:
    return (date_from is None or d >= date_from) and (date_to is None or d <= date_to)


# ── Links ─────────────────────────────────────────────────────────────────────

def normalize_url(url: str) -> str:
    """Key used to merge the same link added in several places."""
    return url.strip().rstrip("/")


@router.get("/links", response_model=List[LinkInsight])
def link_insights(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    session: Session = Depends(get_session),
):
    """Every link and file on tasks and meetings dated in the range, merged by URL, oldest first
    (by the date a link first appeared), like the other Review views."""
    tasks: Dict[str, Task] = {t.id: t for t in session.exec(select(Task)).all()}
    meetings: Dict[str, Meeting] = {m.id: m for m in session.exec(select(Meeting)).all()}

    def task_source(task_id: str) -> Optional[InsightSource]:
        t = tasks.get(task_id)
        return InsightSource(type="task", id=t.id, title=t.action, date=task_date(t)) if t else None

    def meeting_source(meeting_id: str) -> Optional[InsightSource]:
        m = meetings.get(meeting_id)
        return InsightSource(type="meeting", id=m.id, title=m.title, date=m.date) if m else None

    # (source, created_at, url, label, link_type) for every link occurrence
    occurrences = [
        (task_source(l.task_id), l.created_at, l.url, l.label, l.link_type.value)
        for l in session.exec(select(TaskLink)).all()
    ] + [
        (meeting_source(l.meeting_id), l.created_at, l.url, l.label, l.link_type.value)
        for l in session.exec(select(MeetingLink)).all()
    ]

    merged: Dict[str, dict] = {}
    for source, created_at, url, label, link_type in occurrences:
        if source is None or not _in_range(source.date, date_from, date_to):
            continue
        entry = merged.setdefault(normalize_url(url), {"occurrences": [], "sources": {}})
        entry["occurrences"].append((source.date, created_at, url, label, link_type))
        entry["sources"][(source.type, source.id)] = source

    results: List[LinkInsight] = []
    for key, entry in merged.items():
        occ = sorted(entry["occurrences"], key=lambda o: (o[0], o[1]))
        latest = occ[-1]
        # The most recent non-empty label wins; the type follows the most recent occurrence.
        label = next((o[3] for o in reversed(occ) if o[3]), None)
        sources = sorted(entry["sources"].values(), key=lambda s: (s.date, s.title.lower()))
        results.append(LinkInsight(
            key=key, kind="link", url=latest[2], label=label, link_type=latest[4], sources=sources,
            first_date=occ[0][0], last_date=latest[0],
        ))

    files = [(task_source(a.task_id), a) for a in session.exec(select(TaskAttachment)).all()] + \
            [(meeting_source(a.meeting_id), a) for a in session.exec(select(MeetingAttachment)).all()]
    for source, a in files:
        if source is None or not _in_range(source.date, date_from, date_to):
            continue
        results.append(LinkInsight(
            key=f"file:{a.id}", kind="file", label=a.filename, link_type="file",
            attachment=read_attachment(a), sources=[source], first_date=source.date, last_date=source.date,
        ))

    results.sort(key=lambda r: (r.first_date, r.last_date, (r.label or r.url or "").lower()))
    return results


# ── Meetings ──────────────────────────────────────────────────────────────────

_HEADING = re.compile(r"^\s*(#{1,6})\s+(.+?)\s*#*\s*$")


def notes_preview(notes: str) -> tuple:
    """(preview markdown, has_more). Uses a section whose heading mentions "summary" when the
    notes have one (AI note formats vary, so this is only a preference), else the first lines."""
    lines = notes.strip().splitlines()
    section: Optional[List[str]] = None
    for i, line in enumerate(lines):
        h = _HEADING.match(line)
        if h and "summary" in h.group(2).lower():
            level = len(h.group(1))
            body = []
            for nxt in lines[i + 1:]:
                nh = _HEADING.match(nxt)
                if nh and len(nh.group(1)) <= level:
                    break
                body.append(nxt)
            section = body
            break
    chosen = section if section is not None and any(l.strip() for l in section) else lines
    chosen = list(chosen)  # copy: trimmed in place below
    # Trim blank lines at both ends, then cap the length.
    while chosen and not chosen[0].strip():
        chosen.pop(0)
    while chosen and not chosen[-1].strip():
        chosen.pop()
    capped = chosen[:PREVIEW_MAX_LINES]
    preview = "\n".join(capped).strip()
    return preview, preview != notes.strip()


def _outcome_sort_key(t: Task):
    return (OUTCOME_ORDER.get(t.state, 9), t.created_at)


def _brief(t: Task) -> TaskBrief:
    return TaskBrief(id=t.id, action=t.action, state=t.state, high_impact=t.high_impact)


def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def is_day_off(status: str) -> bool:
    s = status.lower()
    return any(w in s for w in DAY_OFF_WORDS)


@router.get("/meetings", response_model=MeetingInsights)
def meeting_insights(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    session: Session = Depends(get_session),
):
    return build_meeting_insights(session, date_from, date_to, date.today())


def build_meeting_insights(
    session: Session, date_from: Optional[date], date_to: Optional[date], today: date,
) -> MeetingInsights:
    q = select(Meeting)
    if date_from:
        q = q.where(Meeting.date >= date_from)
    if date_to:
        q = q.where(Meeting.date <= date_to)
    meetings = session.exec(q.order_by(Meeting.date, *MEETING_ORDER)).all()
    ids = [m.id for m in meetings]

    def rows_for(model, column):
        return session.exec(select(model).where(column.in_(ids)).order_by(model.created_at)).all() if ids else []

    task_links = session.exec(select(MeetingTaskLink).where(MeetingTaskLink.meeting_id.in_(ids))).all() if ids else []
    tasks: Dict[str, Task] = {}
    tasks_by_meeting: Dict[str, List[Task]] = {}
    for tl in task_links:
        t = tasks.get(tl.task_id) or session.get(Task, tl.task_id)
        if t:
            tasks[t.id] = t
            tasks_by_meeting.setdefault(tl.meeting_id, []).append(t)
    for lst in tasks_by_meeting.values():
        lst.sort(key=_outcome_sort_key)
    links_by_meeting: Dict[str, list] = {}
    for l in rows_for(MeetingLink, MeetingLink.meeting_id):
        links_by_meeting.setdefault(l.meeting_id, []).append(l)
    files_by_meeting: Dict[str, list] = {}
    for a in rows_for(MeetingAttachment, MeetingAttachment.meeting_id):
        files_by_meeting.setdefault(a.meeting_id, []).append(read_attachment(a))

    # ── stats: only days up to today, so a week in progress isn't diluted by days not yet lived
    through = min(date_to, today) if date_to else today
    lived = [m for m in meetings if m.date <= through]
    counted = [m for m in lived if not m.exclude_from_stats]  # "Exclude from stats" meetings are left out
    excluded = [m for m in lived if m.exclude_from_stats]
    start = date_from or (min((m.date for m in lived), default=through))
    off_days = {
        ds.day for ds in session.exec(select(DayStatus)).all()
        if start <= ds.day <= through and is_day_off(ds.status)
    }
    capacity = 0
    d = start
    while d <= through:
        if d.weekday() < 5 and d not in off_days:
            capacity += WORKDAY_MINUTES
        d += timedelta(days=1)

    per_day: Dict[date, int] = {}
    per_week: Dict[date, int] = {}
    for m in counted:
        mins = m.duration_minutes or 0
        per_day[m.date] = per_day.get(m.date, 0) + mins
        per_week[_week_start(m.date)] = per_week.get(_week_start(m.date), 0) + mins
    total = sum(per_day.values())
    busiest = max(per_day.items(), key=lambda kv: (kv[1], kv[0]), default=None)
    weekly = []
    if start <= through:
        w = _week_start(start)
        while w <= through:
            weekly.append(MeetingWeek(week_start=w, minutes=per_week.get(w, 0)))
            w += timedelta(days=7)

    stats = MeetingStats(
        stats_through=through,
        meeting_count=len(counted),
        total_minutes=total,
        with_notes=sum(1 for m in counted if (m.notes or "").strip()),
        capacity_minutes=capacity,
        work_share=(total / capacity) if capacity else None,
        days_off=len([d for d in off_days if d.weekday() < 5]),
        busiest_day=BusiestDay(date=busiest[0], minutes=busiest[1]) if busiest and busiest[1] > 0 else None,
        weekly=weekly,
        excluded_count=len(excluded),
        excluded_minutes=sum(m.duration_minutes or 0 for m in excluded),
    )

    # ── digest: every meeting in the range, in time order (the UI shows ones with nothing attached compactly)
    digest = []
    for m in meetings:
        notes = (m.notes or "").strip()
        preview, has_more = notes_preview(notes) if notes else ("", False)
        digest.append(MeetingDigestEntry(
            id=m.id, title=m.title, date=m.date, start_time=m.start_time, duration_minutes=m.duration_minutes,
            exclude_from_stats=m.exclude_from_stats, preview=preview, has_more=has_more, notes=notes,
            tasks=[_brief(t) for t in tasks_by_meeting.get(m.id, [])],
            links=links_by_meeting.get(m.id, []),
            attachments=files_by_meeting.get(m.id, []),
        ))

    # ── outcomes: each task linked to a meeting in the range, once, with every meeting it came from
    meetings_by_task: Dict[str, List[OutcomeMeeting]] = {}
    for m in meetings:  # already in date/time order, so each task's meetings are too
        for t in tasks_by_meeting.get(m.id, []):
            meetings_by_task.setdefault(t.id, []).append(
                OutcomeMeeting(id=m.id, title=m.title, date=m.date, start_time=m.start_time))
    first_seen = {tid: i for i, tid in enumerate(meetings_by_task)}  # order of first meeting
    outcome_tasks = sorted((tasks[tid] for tid in meetings_by_task),
                           key=lambda t: (OUTCOME_ORDER.get(t.state, 9), first_seen[t.id]))
    outcomes = [OutcomeTask(**_brief(t).model_dump(), meetings=meetings_by_task[t.id]) for t in outcome_tasks]
    open_tasks = sum(1 for t in outcome_tasks if t.state in (TaskState.TODO, TaskState.IN_PROGRESS))
    done_tasks = sum(1 for t in outcome_tasks if t.state == TaskState.COMPLETE)

    return MeetingInsights(
        date_from=date_from, date_to=date_to, stats=stats, digest=digest, outcomes=outcomes,
        open_tasks=open_tasks, done_tasks=done_tasks,
    )
