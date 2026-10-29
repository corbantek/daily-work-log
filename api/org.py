"""Personal org tree: people linked by `Person.manager_id`.

`team` and `focus` are inherited: a person who leaves one blank shows the nearest manager's value,
so filling it in on a manager fills it in for everyone below. Computed on read, never stored.
The tree is small (one person's view of their org), so everything loads into memory at once."""
from typing import Dict, List, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from .models import InheritedValue, OrgNode, Person, PersonBrief

INHERITED = ("team", "focus")


def load_people(session: Session) -> Dict[str, Person]:
    return {p.id: p for p in session.exec(select(Person)).all()}


def chain(person: Person, by_id: Dict[str, Person]) -> List[Person]:
    """Managers from the nearest up to the top. Stops at a missing manager or a loop (which the API
    refuses to create, but a hand-edited DB or an odd backup could still contain)."""
    out: List[Person] = []
    seen = {person.id}
    cur = by_id.get(person.manager_id) if person.manager_id else None
    while cur and cur.id not in seen:
        out.append(cur)
        seen.add(cur.id)
        cur = by_id.get(cur.manager_id) if cur.manager_id else None
    return out


def _blank(v: Optional[str]) -> bool:
    return v is None or not v.strip()


def effective(person: Person, field: str, managers: List[Person]) -> InheritedValue:
    own = getattr(person, field)
    if not _blank(own):
        return InheritedValue(value=own)
    for m in managers:
        v = getattr(m, field)
        if not _blank(v):
            return InheritedValue(value=v, from_person_id=m.id, from_name=m.name)
    return InheritedValue()


def brief(p: Person) -> PersonBrief:
    return PersonBrief(id=p.id, name=p.name, number=p.number, role=p.role,
                       is_placeholder=p.is_placeholder, archived=p.archived_at is not None)


def org_fields(person: Person, by_id: Dict[str, Person]) -> dict:
    """The org-tree part of a PersonRead: effective team/focus, the chain up and direct reports."""
    managers = chain(person, by_id)
    reports = sorted((p for p in by_id.values() if p.manager_id == person.id), key=lambda p: p.name.lower())
    return {
        "effective_team": effective(person, "team", managers),
        "effective_focus": effective(person, "focus", managers),
        "chain": [brief(m) for m in managers],
        "reports": [brief(r) for r in reports],
    }


def check_manager(session: Session, person_id: Optional[str], manager_id: Optional[str]) -> None:
    """400 if `manager_id` doesn't exist, or if it would make a loop (the person themselves or
    anyone below them)."""
    if not manager_id:
        return
    by_id = load_people(session)
    manager = by_id.get(manager_id)
    if not manager:
        raise HTTPException(400, detail={"error": f"No person {manager_id!r} to report to"})
    if person_id is None:
        return
    if manager_id == person_id:
        raise HTTPException(400, detail={"error": "A person can't report to themselves"})
    if any(m.id == person_id for m in chain(manager, by_id)):
        raise HTTPException(400, detail={
            "error": f"{manager.name} reports to {by_id[person_id].name} (directly or further down), "
                     "so that would make a loop"})


def reattach_reports(session: Session, person: Person) -> None:
    """Before deleting someone: their direct reports move up to the deleted person's manager."""
    for r in session.exec(select(Person).where(Person.manager_id == person.id)).all():
        r.manager_id = person.manager_id
        session.add(r)


def build_tree(session: Session, include_archived: bool = True) -> List[OrgNode]:
    """Everyone as a forest: roots are people with no (known) manager, sorted by name at each level.
    Archived people are kept by default so the structure doesn't break when someone leaves; when
    they're excluded, their reports hang off the nearest manager who is shown."""
    by_id = load_people(session)
    shown = {pid: p for pid, p in by_id.items() if include_archived or p.archived_at is None}

    def parent_of(p: Person) -> Optional[str]:
        for m in chain(p, by_id):
            if m.id in shown:
                return m.id
        return None

    children: Dict[Optional[str], List[Person]] = {}
    for p in shown.values():
        children.setdefault(parent_of(p), []).append(p)

    placed: set = set()

    def node(p: Person, path: set) -> OrgNode:
        placed.add(p.id)
        managers = chain(p, by_id)
        kids = [node(c, path | {p.id}) for c in sorted(children.get(p.id, []), key=lambda c: c.name.lower())
                if c.id not in path]
        return OrgNode(
            id=p.id, name=p.name, number=p.number, role=p.role, team=p.team, focus=p.focus,
            is_placeholder=p.is_placeholder, archived=p.archived_at is not None,
            effective_team=effective(p, "team", managers),
            effective_focus=effective(p, "focus", managers),
            report_count=sum(1 + k.report_count for k in kids),
            reports=kids,
        )

    roots = sorted(children.get(None, []), key=lambda p: p.name.lower())
    tree = [node(r, set()) for r in roots]
    # People in a loop (only possible in data the API didn't write) have no root; show them anyway.
    for p in sorted(shown.values(), key=lambda p: p.name.lower()):
        if p.id not in placed:
            tree.append(node(p, set()))
    return tree


def matching_ids(by_id: Dict[str, Person], term: str) -> List[str]:
    """People whose effective team or focus contains `term` (case-insensitive), inherited included."""
    t = term.lower()
    out = []
    for p in by_id.values():
        managers = chain(p, by_id)
        if any(t in (effective(p, f, managers).value or "").lower() for f in INHERITED):
            out.append(p.id)
    return out
