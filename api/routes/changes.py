from fastapi import APIRouter

from ..database import BOOT_ID, data_version, latest_agent_activity

router = APIRouter(tags=["changes"])


@router.get("/changes")
def changes():
    """Cheap "has anything changed?" check, polled by the frontend. In memory only."""
    return {"boot": BOOT_ID, "version": data_version(), "agent_activity": latest_agent_activity()}
