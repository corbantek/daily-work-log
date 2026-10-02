from fastapi import APIRouter, Depends
from sqlmodel import Session, select
from typing import Optional, List
from datetime import date, timedelta

from ..database import get_session
from ..models import (
    Task, TaskState, Workstream, WorkstreamRead, Meeting, OncallPeriod,
    SelfReview, SelfReviewStats, SelfReviewGroup,
)
from .tasks import _enrich, STATE_ORDER

router = APIRouter(prefix="/self-review", tags=["self-review"])


def _eff_date(t: Task) -> date:
    return t.end_date or t.start_date or t.created_at.date()


@router.get("", response_model=SelfReview)
def self_review(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    session: Session = Depends(get_session),
):
    all_tasks = session.exec(select(Task)).all()

    def in_range(t: Task) -> bool:
        d = _eff_date(t)
        if date_from and d < date_from:
            return False
        if date_to and d > date_to:
            return False
        return True

    ranged = [t for t in all_tasks if in_range(t)]
    # Exclude abandoned from the narrative; keep for completeness nowhere.
    relevant = [t for t in ranged if t.state != TaskState.ABANDONED]
    enriched = {t.id: _enrich(t, session) for t in relevant}

    # Group by workstream: named workstreams by name, unassigned last.
    workstreams = session.exec(select(Workstream)).all()
    ws_by_id = {w.id: w for w in workstreams}
    grouped: dict = {}
    for t in relevant:
        grouped.setdefault(t.workstream_id, []).append(t)

    def sort_key(t: Task):
        return (0 if t.high_impact else 1, STATE_ORDER.get(t.state, 9), _eff_date(t))

    named_ids = sorted(
        [wid for wid in grouped if wid and wid in ws_by_id],
        key=lambda wid: ws_by_id[wid].name.lower(),
    )
    ordered_ids = named_ids + [wid for wid in grouped if wid not in ws_by_id or wid is None]

    groups: List[SelfReviewGroup] = []
    seen = set()
    for wid in ordered_ids:
        if wid in seen:
            continue
        seen.add(wid)
        tasks = sorted(grouped[wid], key=sort_key)
        ws = ws_by_id.get(wid)
        groups.append(SelfReviewGroup(
            workstream=WorkstreamRead(**ws.model_dump()) if ws else None,
            tasks=[enriched[t.id] for t in tasks],
        ))

    highlights = sorted(
        [enriched[t.id] for t in relevant if t.high_impact],
        key=lambda tr: _eff_date_read(tr),
        reverse=True,
    )

    meetings_q = select(Meeting)
    if date_from:
        meetings_q = meetings_q.where(Meeting.date >= date_from)
    if date_to:
        meetings_q = meetings_q.where(Meeting.date <= date_to)
    meetings_count = len(session.exec(meetings_q).all())

    oncall_days = 0
    if date_from and date_to:
        periods = session.exec(select(OncallPeriod)).all()
        d = date_from
        while d <= date_to:
            if any(p.start_date <= d <= p.end_date for p in periods):
                oncall_days += 1
            d += timedelta(days=1)

    stats = SelfReviewStats(
        tasks_completed=sum(1 for t in ranged if t.state == TaskState.COMPLETE),
        high_impact=sum(1 for t in relevant if t.high_impact),
        workstreams_touched=len({t.workstream_id for t in relevant if t.workstream_id}),
        in_progress=sum(1 for t in relevant if t.state == TaskState.IN_PROGRESS),
        meetings=meetings_count,
        oncall_days=oncall_days,
    )

    return SelfReview(
        date_from=date_from,
        date_to=date_to,
        stats=stats,
        highlights=highlights,
        groups=groups,
    )


def _eff_date_read(tr) -> date:
    return tr.end_date or tr.start_date or tr.created_at.date()
