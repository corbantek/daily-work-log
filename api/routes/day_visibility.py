from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from datetime import date
from typing import Optional

from ..database import get_session
from ..models import DayVisibility, DayVisibilityUpdate

router = APIRouter(prefix="/day-visibility", tags=["day-visibility"])


@router.get("")
def get_day_visibility(
    from_date: Optional[date] = Query(None, alias="from"),
    to_date: Optional[date] = Query(None, alias="to"),
    session: Session = Depends(get_session),
):
    query = select(DayVisibility)
    if from_date:
        query = query.where(DayVisibility.day >= from_date)
    if to_date:
        query = query.where(DayVisibility.day <= to_date)
    rows = session.exec(query).all()
    return {r.day.isoformat(): r.visible for r in rows}


@router.put("/{day}")
def set_day_visibility(day: date, body: DayVisibilityUpdate, session: Session = Depends(get_session)):
    existing = session.get(DayVisibility, day)
    if existing:
        existing.visible = body.visible
        session.add(existing)
    else:
        session.add(DayVisibility(day=day, visible=body.visible))
    session.commit()
    return {"date": day.isoformat(), "visible": body.visible}


@router.delete("/{day}", status_code=204)
def clear_day_visibility(day: date, session: Session = Depends(get_session)):
    existing = session.get(DayVisibility, day)
    if not existing:
        raise HTTPException(404)
    session.delete(existing)
    session.commit()
