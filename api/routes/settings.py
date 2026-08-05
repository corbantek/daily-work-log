from fastapi import APIRouter, Depends
from sqlmodel import Session, select
from typing import Dict

from ..database import get_session
from ..models import Setting

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=Dict[str, str])
def get_all_settings(session: Session = Depends(get_session)):
    rows = session.exec(select(Setting)).all()
    return {r.key: r.value for r in rows}


@router.put("/{key}")
def set_setting(key: str, body: dict, session: Session = Depends(get_session)):
    value = body.get("value", "")
    existing = session.get(Setting, key)
    if existing:
        existing.value = value
        session.add(existing)
    else:
        session.add(Setting(key=key, value=value))
    session.commit()
    return {"key": key, "value": value}
