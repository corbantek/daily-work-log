from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import List

from ..database import get_session
from ..models import Label, LabelCreate, LabelRead, TaskLabelLink

router = APIRouter(prefix="/labels", tags=["labels"])


@router.get("", response_model=List[LabelRead])
def list_labels(session: Session = Depends(get_session)):
    return session.exec(select(Label).order_by(Label.name)).all()


@router.post("", response_model=LabelRead, status_code=201)
def create_label(body: LabelCreate, session: Session = Depends(get_session)):
    label = Label.model_validate(body)
    session.add(label)
    session.commit()
    session.refresh(label)
    return label


@router.patch("/{label_id}", response_model=LabelRead)
def update_label(label_id: str, body: LabelCreate, session: Session = Depends(get_session)):
    label = session.get(Label, label_id)
    if not label:
        raise HTTPException(404)
    label.name = body.name
    label.color = body.color
    session.add(label)
    session.commit()
    session.refresh(label)
    return label


@router.delete("/{label_id}", status_code=204)
def delete_label(label_id: str, session: Session = Depends(get_session)):
    label = session.get(Label, label_id)
    if not label:
        raise HTTPException(404)
    for link in session.exec(select(TaskLabelLink).where(TaskLabelLink.label_id == label_id)).all():
        session.delete(link)
    session.delete(label)
    session.commit()
