"""Short human references for tasks and meetings: T42, M17 (the `number` column). Input also
accepts "T-42", "t42", "#42" and a bare "42"."""
import re
from typing import Optional, Tuple

_REF = re.compile(r"^\s*([TtMm])?\s*[-#]?\s*(\d+)\s*$")


def task_ref(number: Optional[int]) -> Optional[str]:
    return f"T{number}" if number else None


def meeting_ref(number: Optional[int]) -> Optional[str]:
    return f"M{number}" if number else None


def parse_ref(value: str) -> Optional[Tuple[Optional[str], int]]:
    """("T" | "M" | None, number) for "T42", "T-42", "t42", "M 17", "#42", "42"; None if it isn't a reference."""
    m = _REF.match(value or "")
    if not m:
        return None
    return (m.group(1).upper() if m.group(1) else None, int(m.group(2)))
