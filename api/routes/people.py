from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import List, Optional
from datetime import datetime

from ..database import get_session
from ..models import (
    Person, PersonCreate, PersonRead, PersonUpdate,
    Interaction, InteractionTag,
)

router = APIRouter(prefix="/people", tags=["people"])


def _enrich(person: Person, session: Session) -> PersonRead:
    interactions = session.exec(
        select(Interaction).where(Interaction.person_id == person.id)
    ).all()
    last = max((i.date for i in interactions), default=None)
    return PersonRead(
        **person.model_dump(),
        interaction_count=len(interactions),
        last_interaction_date=last,
    )


@router.get("", response_model=List[PersonRead])
def list_people(include_archived: bool = False, session: Session = Depends(get_session)):
    q = select(Person)
    if not include_archived:
        q = q.where(Person.archived_at == None)
    people = session.exec(q.order_by(Person.name)).all()
    return [_enrich(p, session) for p in people]


@router.post("", response_model=PersonRead, status_code=201)
def create_person(body: PersonCreate, session: Session = Depends(get_session)):
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
    for k, v in body.model_dump(exclude_unset=True).items():
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
    session.delete(person)
    session.commit()
