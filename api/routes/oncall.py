from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from datetime import date

from ..database import get_session
from ..models import OncallPeriod, OncallPeriodCreate, OncallPeriodRead, OncallPeriodUpdate

router = APIRouter(prefix="/oncall", tags=["oncall"])


@router.get("", response_model=list[OncallPeriodRead])
def list_oncall_periods(session: Session = Depends(get_session)):
    return session.exec(select(OncallPeriod).order_by(OncallPeriod.start_date.desc())).all()


@router.post("", response_model=OncallPeriodRead, status_code=201)
def create_oncall_period(body: OncallPeriodCreate, session: Session = Depends(get_session)):
    if body.end_date < body.start_date:
        raise HTTPException(400, detail="end_date must be on or after start_date")
    period = OncallPeriod(start_date=body.start_date, end_date=body.end_date)
    session.add(period)
    session.commit()
    session.refresh(period)
    return period


@router.patch("/{period_id}", response_model=OncallPeriodRead)
def update_oncall_period(period_id: str, body: OncallPeriodUpdate, session: Session = Depends(get_session)):
    period = session.get(OncallPeriod, period_id)
    if not period:
        raise HTTPException(404)
    if body.start_date is not None:
        period.start_date = body.start_date
    if body.end_date is not None:
        period.end_date = body.end_date
    if period.end_date < period.start_date:
        raise HTTPException(400, detail="end_date must be on or after start_date")
    session.add(period)
    session.commit()
    session.refresh(period)
    return period


@router.delete("/{period_id}", status_code=204)
def delete_oncall_period(period_id: str, session: Session = Depends(get_session)):
    period = session.get(OncallPeriod, period_id)
    if not period:
        raise HTTPException(404)
    session.delete(period)
    session.commit()
