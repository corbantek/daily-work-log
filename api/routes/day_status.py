from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session
from datetime import date

from ..database import get_session
from ..models import DayStatus, DayStatusUpdate

router = APIRouter(prefix="/day-status", tags=["day-status"])


@router.put("/{day}")
def set_day_status(day: date, body: DayStatusUpdate, session: Session = Depends(get_session)):
    existing = session.get(DayStatus, day)
    if existing:
        existing.status = body.status
        session.add(existing)
    else:
        session.add(DayStatus(day=day, status=body.status))
    session.commit()
    return {"date": day.isoformat(), "status": body.status}


@router.delete("/{day}", status_code=204)
def clear_day_status(day: date, session: Session = Depends(get_session)):
    existing = session.get(DayStatus, day)
    if not existing:
        raise HTTPException(404)
    session.delete(existing)
    session.commit()
