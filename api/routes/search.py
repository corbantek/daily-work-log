from fastapi import APIRouter, Depends
from sqlmodel import Session, select
from typing import List

from ..database import get_session
from ..refs import parse_ref
from .. import org
from ..models import (
    Task, TaskAttachment, MeetingAttachment, Meeting, Person, Interaction, Workstream, SearchResult,
)

router = APIRouter(prefix="/search", tags=["search"])

PER_TYPE = 8


@router.get("", response_model=List[SearchResult])
def search(q: str = "", session: Session = Depends(get_session)):
    term = q.strip()
    if not term:
        return []
    like = f"%{term}%"
    results: List[SearchResult] = []

    ws_names = {w.id: w.name for w in session.exec(select(Workstream)).all()}

    # "T42" / "M17" (or "T-42") jumps straight to that task or meeting (a bare number matches both kinds).
    ref = parse_ref(term)
    if ref:
        kind, n = ref
        if kind in (None, "T"):
            t = session.exec(select(Task).where(Task.number == n)).first()
            if t:
                results.append(SearchResult(type="task", id=t.id, title=t.action, number=t.number,
                                            subtitle=ws_names.get(t.workstream_id) if t.workstream_id else None,
                                            date=t.end_date or t.start_date or t.created_at.date()))
        if kind in (None, "M"):
            m = session.exec(select(Meeting).where(Meeting.number == n)).first()
            if m:
                results.append(SearchResult(type="meeting", id=m.id, title=m.title, number=m.number,
                                            subtitle="Meeting", date=m.date))
        if kind == "P":  # only an explicit P: a bare number already means a task or meeting
            p = session.exec(select(Person).where(Person.number == n)).first()
            if p:
                results.append(SearchResult(type="person", id=p.id, title=p.name, number=p.number,
                                            subtitle=p.role or p.team, person_id=p.id))
    seen = {r.id for r in results}

    tasks = session.exec(
        select(Task).where(Task.action.ilike(like) | Task.notes.ilike(like)).limit(PER_TYPE)
    ).all()
    for t in tasks:
        if t.id in seen:
            continue
        seen.add(t.id)
        results.append(SearchResult(
            type="task", id=t.id, title=t.action, number=t.number,
            subtitle=ws_names.get(t.workstream_id) if t.workstream_id else None,
            date=t.end_date or t.start_date or t.created_at.date(),
        ))

    for att in session.exec(select(TaskAttachment).where(TaskAttachment.filename.ilike(like)).limit(PER_TYPE)).all():
        t = session.get(Task, att.task_id)
        if t and t.id not in seen:
            seen.add(t.id)
            results.append(SearchResult(
                type="task", id=t.id, title=t.action, number=t.number, subtitle=f"Attachment: {att.filename}",
                date=t.end_date or t.start_date or t.created_at.date(),
            ))

    meetings = session.exec(
        select(Meeting).where(Meeting.title.ilike(like) | Meeting.notes.ilike(like)).limit(PER_TYPE)
    ).all()
    for m in meetings:
        if m.id in seen:
            continue
        seen.add(m.id)
        results.append(SearchResult(type="meeting", id=m.id, title=m.title, number=m.number, subtitle="Meeting", date=m.date))

    for att in session.exec(select(MeetingAttachment).where(MeetingAttachment.filename.ilike(like)).limit(PER_TYPE)).all():
        m = session.get(Meeting, att.meeting_id)
        if m and m.id not in seen:
            seen.add(m.id)
            results.append(SearchResult(type="meeting", id=m.id, title=m.title, number=m.number,
                                        subtitle=f"Attachment: {att.filename}", date=m.date))

    # Team and focus match inherited values too, so "Maps data" finds everyone in that group.
    by_id = org.load_people(session)
    people = session.exec(
        select(Person).where(
            Person.name.ilike(like) | Person.role.ilike(like) | Person.notes.ilike(like)
        ).limit(PER_TYPE)
    ).all()
    team_matches = [by_id[i] for i in org.matching_ids(by_id, term)
                    if by_id[i].id not in {p.id for p in people}]
    team_matches.sort(key=lambda p: p.name.lower())
    for p in (people + team_matches)[:PER_TYPE * 2]:
        if p.id in seen:
            continue
        seen.add(p.id)
        team = org.effective(p, "team", org.chain(p, by_id)).value
        results.append(SearchResult(
            type="person", id=p.id, title=p.name, number=p.number,
            subtitle=" · ".join(x for x in (p.role, team) if x) or None, person_id=p.id,
        ))

    interactions = session.exec(
        select(Interaction).where(Interaction.summary.ilike(like) | Interaction.notes.ilike(like)).limit(PER_TYPE)
    ).all()
    person_names = {p.id: p.name for p in session.exec(select(Person)).all()}
    for it in interactions:
        results.append(SearchResult(
            type="interaction", id=it.id, title=it.summary,
            subtitle=person_names.get(it.person_id), date=it.date, person_id=it.person_id,
        ))

    return results
