from fastapi import APIRouter, Depends
from sqlmodel import Session, select
from typing import List

from ..database import get_session
from ..models import (
    Task, Meeting, Person, Interaction, Workstream, SearchResult,
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

    tasks = session.exec(
        select(Task).where(Task.action.ilike(like) | Task.notes.ilike(like)).limit(PER_TYPE)
    ).all()
    for t in tasks:
        results.append(SearchResult(
            type="task", id=t.id, title=t.action,
            subtitle=ws_names.get(t.workstream_id) if t.workstream_id else None,
            date=t.end_date or t.start_date or t.created_at.date(),
        ))

    meetings = session.exec(
        select(Meeting).where(Meeting.title.ilike(like) | Meeting.notes.ilike(like)).limit(PER_TYPE)
    ).all()
    for m in meetings:
        results.append(SearchResult(type="meeting", id=m.id, title=m.title, subtitle="Meeting", date=m.date))

    people = session.exec(
        select(Person).where(
            Person.name.ilike(like) | Person.role.ilike(like)
            | Person.team.ilike(like) | Person.notes.ilike(like)
        ).limit(PER_TYPE)
    ).all()
    for p in people:
        results.append(SearchResult(
            type="person", id=p.id, title=p.name,
            subtitle=p.role or p.team, person_id=p.id,
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
