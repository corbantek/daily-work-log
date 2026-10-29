from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import List, Optional
from datetime import datetime

from ..database import get_session
from ..models import (
    Person, PersonCreate, PersonRead, PersonUpdate, OrgNode,
    Interaction, InteractionTag,
)
from .. import org

router = APIRouter(prefix="/people", tags=["people"])


def _enrich(person: Person, session: Session, by_id=None) -> PersonRead:
    interactions = session.exec(
        select(Interaction).where(Interaction.person_id == person.id)
    ).all()
    last = max((i.date for i in interactions), default=None)
    return PersonRead(
        **person.model_dump(),
        interaction_count=len(interactions),
        last_interaction_date=last,
        **org.org_fields(person, by_id if by_id is not None else org.load_people(session)),
    )


@router.get("", response_model=List[PersonRead])
def list_people(include_archived: bool = False, session: Session = Depends(get_session)):
    q = select(Person)
    if not include_archived:
        q = q.where(Person.archived_at == None)
    people = session.exec(q.order_by(Person.name)).all()
    by_id = org.load_people(session)
    return [_enrich(p, session, by_id) for p in people]


@router.get("/tree", response_model=List[OrgNode])
def org_tree(include_archived: bool = True, session: Session = Depends(get_session)):
    """Everyone as a forest of reporting lines, with inherited team/focus filled in."""
    return org.build_tree(session, include_archived)


@router.post("", response_model=PersonRead, status_code=201)
def create_person(body: PersonCreate, session: Session = Depends(get_session)):
    org.check_manager(session, None, body.manager_id)
    person = Person.model_validate(body)
    session.add(person)
    session.commit()
    session.refresh(person)
    return _enrich(person, session)


@router.get("/{person_id}", response_model=PersonRead)
def get_person(person_id: str, session: Session = Depends(get_session)):
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(404)
    return _enrich(person, session)


@router.patch("/{person_id}", response_model=PersonRead)
def update_person(person_id: str, body: PersonUpdate, session: Session = Depends(get_session)):
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(404)
    changes = body.model_dump(exclude_unset=True)
    if "manager_id" in changes:
        org.check_manager(session, person_id, changes["manager_id"])
    if changes.get("is_placeholder") is None:
        changes.pop("is_placeholder", None)  # NOT NULL column
    for k, v in changes.items():
        setattr(person, k, v)
    session.add(person)
    session.commit()
    session.refresh(person)
    return _enrich(person, session)


@router.delete("/{person_id}", status_code=204)
def delete_person(person_id: str, session: Session = Depends(get_session)):
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(404)
    interactions = session.exec(
        select(Interaction).where(Interaction.person_id == person_id)
    ).all()
    for i in interactions:
        for tag in session.exec(select(InteractionTag).where(InteractionTag.interaction_id == i.id)).all():
            session.delete(tag)
        session.delete(i)
    org.reattach_reports(session, person)
    session.delete(person)
    session.commit()
