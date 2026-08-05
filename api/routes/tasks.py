from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import List, Optional
from datetime import date

from ..database import get_session
from ..models import (
    Task, TaskCreate, TaskRead, TaskUpdate,
    TaskLink, TaskLinkCreate, TaskLinkRead,
    Label, TaskLabelLink,
)

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _attach_labels(task: Task, label_ids: List[str], session: Session):
    existing = session.exec(
        select(TaskLabelLink).where(TaskLabelLink.task_id == task.id)
    ).all()
    for link in existing:
        session.delete(link)
    for lid in label_ids:
        if session.get(Label, lid):
            session.add(TaskLabelLink(task_id=task.id, label_id=lid))


@router.get("", response_model=List[TaskRead])
def list_tasks(
    workstream_id: Optional[str] = None,
    state: Optional[str] = None,
    high_impact: Optional[bool] = None,
    active_on: Optional[date] = None,
    session: Session = Depends(get_session),
):
    q = select(Task)
    if workstream_id:
        q = q.where(Task.workstream_id == workstream_id)
    if state:
        q = q.where(Task.state == state)
    if high_impact is not None:
        q = q.where(Task.high_impact == high_impact)
    if active_on:
        q = q.where(
            (Task.start_date == None) | (Task.start_date <= active_on)
        ).where(
            (Task.end_date == None) | (Task.end_date >= active_on)
        )
    tasks = session.exec(q.order_by(Task.created_at)).all()
    return [_enrich(t, session) for t in tasks]


@router.post("", response_model=TaskRead, status_code=201)
def create_task(body: TaskCreate, session: Session = Depends(get_session)):
    data = body.model_dump(exclude={"label_ids"})
    task = Task(**data)
    session.add(task)
    session.flush()
    _attach_labels(task, body.label_ids, session)
    session.commit()
    session.refresh(task)
    return _enrich(task, session)


@router.get("/{task_id}", response_model=TaskRead)
def get_task(task_id: str, session: Session = Depends(get_session)):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(404)
    return _enrich(task, session)


@router.patch("/{task_id}", response_model=TaskRead)
def update_task(task_id: str, body: TaskUpdate, session: Session = Depends(get_session)):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(404)
    data = body.model_dump(exclude_unset=True, exclude={"label_ids"})
    for k, v in data.items():
        setattr(task, k, v)
    if body.label_ids is not None:
        _attach_labels(task, body.label_ids, session)
    session.add(task)
    session.commit()
    session.refresh(task)
    return _enrich(task, session)


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: str, session: Session = Depends(get_session)):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(404)
    session.delete(task)
    session.commit()


# ── Task links ────────────────────────────────────────────────────────────────

@router.post("/{task_id}/links", response_model=TaskLinkRead, status_code=201)
def add_link(task_id: str, body: TaskLinkCreate, session: Session = Depends(get_session)):
    if not session.get(Task, task_id):
        raise HTTPException(404)
    link = TaskLink(task_id=task_id, **body.model_dump())
    session.add(link)
    session.commit()
    session.refresh(link)
    return link


@router.patch("/{task_id}/links/{link_id}", response_model=TaskLinkRead)
def update_link(task_id: str, link_id: str, body: TaskLinkCreate, session: Session = Depends(get_session)):
    link = session.get(TaskLink, link_id)
    if not link or link.task_id != task_id:
        raise HTTPException(404)
    for k, v in body.model_dump().items():
        setattr(link, k, v)
    session.add(link)
    session.commit()
    session.refresh(link)
    return link


@router.delete("/{task_id}/links/{link_id}", status_code=204)
def remove_link(task_id: str, link_id: str, session: Session = Depends(get_session)):
    link = session.get(TaskLink, link_id)
    if not link or link.task_id != task_id:
        raise HTTPException(404)
    session.delete(link)
    session.commit()


# ── Helper ────────────────────────────────────────────────────────────────────

def _enrich(task: Task, session: Session) -> TaskRead:
    labels = session.exec(
        select(Label)
        .join(TaskLabelLink, TaskLabelLink.label_id == Label.id)
        .where(TaskLabelLink.task_id == task.id)
    ).all()
    links = session.exec(
        select(TaskLink).where(TaskLink.task_id == task.id)
    ).all()
    return TaskRead(
        **task.model_dump(),
        labels=labels,
        links=links,
    )
