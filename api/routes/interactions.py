from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import List, Optional
from datetime import date

from ..database import get_session
from ..models import (
    Interaction, InteractionCreate, InteractionRead, InteractionUpdate,
    InteractionTag, InteractionTagInput, InteractionTagRead,
    CompetencyDimension, CompetencyAttribute, Workstream, Person,
)

router = APIRouter(prefix="/interactions", tags=["interactions"])


def _label_maps(session: Session):
    dims = {d.key: d.label for d in session.exec(select(CompetencyDimension)).all()}
    attrs = {a.id: a.text for a in session.exec(select(CompetencyAttribute)).all()}
    return dims, attrs


def _set_tags(interaction_id: str, tags: List[InteractionTagInput], session: Session):
    for existing in session.exec(
        select(InteractionTag).where(InteractionTag.interaction_id == interaction_id)
    ).all():
        session.delete(existing)
    for t in tags:
        session.add(InteractionTag(
            interaction_id=interaction_id,
            dimension_key=t.dimension_key,
            attribute_id=t.attribute_id,
        ))


def _enrich(interaction: Interaction, session: Session, dims=None, attrs=None) -> InteractionRead:
    if dims is None or attrs is None:
        dims, attrs = _label_maps(session)
    tag_rows = session.exec(
        select(InteractionTag).where(InteractionTag.interaction_id == interaction.id)
    ).all()
    tags = [
        InteractionTagRead(
            dimension_key=t.dimension_key,
            dimension_label=dims.get(t.dimension_key),
            attribute_id=t.attribute_id,
            attribute_text=attrs.get(t.attribute_id) if t.attribute_id else None,
        )
        for t in tag_rows
    ]
    ws_name = None
    if interaction.workstream_id:
        ws = session.get(Workstream, interaction.workstream_id)
        ws_name = ws.name if ws else None
    return InteractionRead(**interaction.model_dump(), tags=tags, workstream_name=ws_name)


@router.get("", response_model=List[InteractionRead])
def list_interactions(
    person_id: Optional[str] = None,
    dimension: Optional[str] = None,
    sentiment: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    session: Session = Depends(get_session),
):
    q = select(Interaction)
    if person_id:
        q = q.where(Interaction.person_id == person_id)
    if sentiment:
        q = q.where(Interaction.sentiment == sentiment)
    if date_from:
        q = q.where(Interaction.date >= date_from)
    if date_to:
        q = q.where(Interaction.date <= date_to)
    interactions = session.exec(q.order_by(Interaction.date.desc())).all()

    if dimension:
        tagged = {
            t.interaction_id
            for t in session.exec(
                select(InteractionTag).where(InteractionTag.dimension_key == dimension)
            ).all()
        }
        interactions = [i for i in interactions if i.id in tagged]

    dims, attrs = _label_maps(session)
    return [_enrich(i, session, dims, attrs) for i in interactions]


@router.post("", response_model=InteractionRead, status_code=201)
def create_interaction(body: InteractionCreate, session: Session = Depends(get_session)):
    if not session.get(Person, body.person_id):
        raise HTTPException(400, detail="Person not found")
    data = body.model_dump(exclude={"tags"})
    interaction = Interaction(**data)
    session.add(interaction)
    session.flush()
    _set_tags(interaction.id, body.tags, session)
    session.commit()
    session.refresh(interaction)
    return _enrich(interaction, session)


@router.get("/{interaction_id}", response_model=InteractionRead)
def get_interaction(interaction_id: str, session: Session = Depends(get_session)):
    interaction = session.get(Interaction, interaction_id)
    if not interaction:
        raise HTTPException(404)
    return _enrich(interaction, session)


@router.patch("/{interaction_id}", response_model=InteractionRead)
def update_interaction(interaction_id: str, body: InteractionUpdate, session: Session = Depends(get_session)):
    interaction = session.get(Interaction, interaction_id)
    if not interaction:
        raise HTTPException(404)
    data = body.model_dump(exclude_unset=True, exclude={"tags"})
    for k, v in data.items():
        setattr(interaction, k, v)
    if body.tags is not None:
        _set_tags(interaction_id, body.tags, session)
    session.add(interaction)
    session.commit()
    session.refresh(interaction)
    return _enrich(interaction, session)


@router.delete("/{interaction_id}", status_code=204)
def delete_interaction(interaction_id: str, session: Session = Depends(get_session)):
    interaction = session.get(Interaction, interaction_id)
    if not interaction:
        raise HTTPException(404)
    for tag in session.exec(select(InteractionTag).where(InteractionTag.interaction_id == interaction_id)).all():
        session.delete(tag)
    session.delete(interaction)
    session.commit()
