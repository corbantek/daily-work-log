from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import List
from datetime import datetime

from ..database import get_session
from ..models import Workstream, WorkstreamCreate, WorkstreamRead, WorkstreamUpdate

router = APIRouter(prefix="/workstreams", tags=["workstreams"])


@router.get("", response_model=List[WorkstreamRead])
def list_workstreams(include_archived: bool = False, session: Session = Depends(get_session)):
    q = select(Workstream)
    if not include_archived:
        q = q.where(Workstream.archived_at == None)
    return session.exec(q.order_by(Workstream.name)).all()


@router.post("", response_model=WorkstreamRead, status_code=201)
def create_workstream(body: WorkstreamCreate, session: Session = Depends(get_session)):
    ws = Workstream.model_validate(body)
    session.add(ws)
    session.commit()
    session.refresh(ws)
    return ws


@router.patch("/{ws_id}", response_model=WorkstreamRead)
def update_workstream(ws_id: str, body: WorkstreamUpdate, session: Session = Depends(get_session)):
    ws = session.get(Workstream, ws_id)
    if not ws:
        raise HTTPException(404)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(ws, k, v)
    session.add(ws)
    session.commit()
    session.refresh(ws)
    return ws


@router.delete("/{ws_id}", status_code=204)
def archive_workstream(ws_id: str, session: Session = Depends(get_session)):
    ws = session.get(Workstream, ws_id)
    if not ws:
        raise HTTPException(404)
    ws.archived_at = datetime.utcnow()
    session.add(ws)
    session.commit()
