import re
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import List

from ..database import get_session
from ..models import (
    CompetencyDimension, CompetencyAttribute, InteractionTag,
    CompetencyDimensionRead, CompetencyAttributeRead,
)

router = APIRouter(prefix="/framework", tags=["framework"])


def _slugify(label: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")
    return s or "dimension"


def _unique_key(base: str, session: Session) -> str:
    key = base
    n = 2
    while session.get(CompetencyDimension, key):
        key = f"{base}-{n}"
        n += 1
    return key


@router.get("", response_model=List[CompetencyDimensionRead])
def get_framework(session: Session = Depends(get_session)):
    dimensions = session.exec(
        select(CompetencyDimension).order_by(CompetencyDimension.sort_order)
    ).all()
    attributes = session.exec(
        select(CompetencyAttribute).order_by(CompetencyAttribute.sort_order)
    ).all()
    by_dim: dict[str, List[CompetencyAttributeRead]] = {}
    for a in attributes:
        by_dim.setdefault(a.dimension_key, []).append(
            CompetencyAttributeRead(id=a.id, text=a.text, sort_order=a.sort_order)
        )
    return [
        CompetencyDimensionRead(
            key=d.key, label=d.label, sort_order=d.sort_order,
            attributes=by_dim.get(d.key, []),
        )
        for d in dimensions
    ]


# ── Dimensions ─────────────────────────────────────────────────────────────────

@router.post("/dimensions", response_model=CompetencyDimensionRead, status_code=201)
def create_dimension(body: dict, session: Session = Depends(get_session)):
    label = (body.get("label") or "").strip()
    if not label:
        raise HTTPException(400, detail="label is required")
    key = _unique_key(_slugify(label), session)
    max_order = max((d.sort_order for d in session.exec(select(CompetencyDimension)).all()), default=-1)
    dim = CompetencyDimension(key=key, label=label, sort_order=max_order + 1)
    session.add(dim)
    session.commit()
    return CompetencyDimensionRead(key=dim.key, label=dim.label, sort_order=dim.sort_order, attributes=[])


@router.patch("/dimensions/{key}", response_model=CompetencyDimensionRead)
def update_dimension(key: str, body: dict, session: Session = Depends(get_session)):
    dim = session.get(CompetencyDimension, key)
    if not dim:
        raise HTTPException(404)
    if "label" in body and body["label"] is not None:
        dim.label = body["label"].strip()
    if "sort_order" in body and body["sort_order"] is not None:
        dim.sort_order = body["sort_order"]
    session.add(dim)
    session.commit()
    attrs = session.exec(
        select(CompetencyAttribute).where(CompetencyAttribute.dimension_key == key).order_by(CompetencyAttribute.sort_order)
    ).all()
    return CompetencyDimensionRead(
        key=dim.key, label=dim.label, sort_order=dim.sort_order,
        attributes=[CompetencyAttributeRead(id=a.id, text=a.text, sort_order=a.sort_order) for a in attrs],
    )


@router.delete("/dimensions/{key}", status_code=204)
def delete_dimension(key: str, session: Session = Depends(get_session)):
    dim = session.get(CompetencyDimension, key)
    if not dim:
        raise HTTPException(404)
    for a in session.exec(select(CompetencyAttribute).where(CompetencyAttribute.dimension_key == key)).all():
        session.delete(a)
    for t in session.exec(select(InteractionTag).where(InteractionTag.dimension_key == key)).all():
        session.delete(t)
    session.delete(dim)
    session.commit()


# ── Attributes ─────────────────────────────────────────────────────────────────

@router.post("/dimensions/{key}/attributes", response_model=CompetencyAttributeRead, status_code=201)
def create_attribute(key: str, body: dict, session: Session = Depends(get_session)):
    if not session.get(CompetencyDimension, key):
        raise HTTPException(404, detail="Dimension not found")
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(400, detail="text is required")
    max_order = max(
        (a.sort_order for a in session.exec(
            select(CompetencyAttribute).where(CompetencyAttribute.dimension_key == key)
        ).all()),
        default=-1,
    )
    attr = CompetencyAttribute(dimension_key=key, text=text, sort_order=max_order + 1)
    session.add(attr)
    session.commit()
    session.refresh(attr)
    return CompetencyAttributeRead(id=attr.id, text=attr.text, sort_order=attr.sort_order)


@router.patch("/attributes/{attr_id}", response_model=CompetencyAttributeRead)
def update_attribute(attr_id: str, body: dict, session: Session = Depends(get_session)):
    attr = session.get(CompetencyAttribute, attr_id)
    if not attr:
        raise HTTPException(404)
    if "text" in body and body["text"] is not None:
        attr.text = body["text"].strip()
    if "sort_order" in body and body["sort_order"] is not None:
        attr.sort_order = body["sort_order"]
    session.add(attr)
    session.commit()
    session.refresh(attr)
    return CompetencyAttributeRead(id=attr.id, text=attr.text, sort_order=attr.sort_order)


@router.delete("/attributes/{attr_id}", status_code=204)
def delete_attribute(attr_id: str, session: Session = Depends(get_session)):
    attr = session.get(CompetencyAttribute, attr_id)
    if not attr:
        raise HTTPException(404)
    # Downgrade any tags that referenced this attribute to whole-dimension tags.
    for t in session.exec(select(InteractionTag).where(InteractionTag.attribute_id == attr_id)).all():
        t.attribute_id = None
        session.add(t)
    session.delete(attr)
    session.commit()
