"""Agent API, people half: the org tree, person notes and interactions (peer-feedback observations).

Same rules as api/routes/agent.py: names or references instead of ids (people are P12; a name works
if it's unique), dates default to today, notes append unless mode="replace" (snapshotted first),
no deletes, every change recorded in AgentActivity — under the person, so the app's notice opens them.
"""
from datetime import date, datetime
from datetime import date as Date
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..database import get_session
from ..models import (
    CompetencyAttribute, CompetencyDimension, Interaction, InteractionCreate, InteractionTagInput,
    InteractionUpdate, Person, PersonCreate, PersonUpdate, Sentiment,
)
from ..refs import parse_ref, person_ref
from .. import note_snapshots, org
from . import interactions as interaction_routes
from . import people as people_routes
from .agent import NOTES_VERB, NotesText, _bad, _join_notes, _preview, _record, resolve_workstream
from .review_draft import get_review_draft

router = APIRouter(prefix="/agent", tags=["agent"])

SENTIMENT_ALIASES = {
    "strength": Sentiment.STRENGTH, "positive": Sentiment.STRENGTH, "praise": Sentiment.STRENGTH, "kudos": Sentiment.STRENGTH,
    "growth": Sentiment.GROWTH, "improvement": Sentiment.GROWTH, "concern": Sentiment.GROWTH, "constructive": Sentiment.GROWTH,
    "neutral": Sentiment.NEUTRAL, "note": Sentiment.NEUTRAL, "observation": Sentiment.NEUTRAL,
}
RECENT_INTERACTIONS = 10


# ── resolving people, sentiment and tags ──────────────────────────────────────

def _label(p: Person) -> str:
    return f'{person_ref(p.number)} "{p.name}"'


def get_person(session: Session, ident: str) -> Person:
    """By reference ("P12", "p-12", "12"), id, or name (exact, else a unique partial match; current
    people are preferred over archived ones). Ambiguous → 400 listing the candidates."""
    ident = (ident or "").strip()
    ref = parse_ref(ident)
    if ref:
        if ref[0] not in (None, "P"):
            raise _bad(f"{ident!r} is not a person reference; people are P<number>")
        p = session.exec(select(Person).where(Person.number == ref[1])).first()
        if not p:
            raise HTTPException(404, detail={"error": f"No person {ident!r}"})
        return p
    p = session.get(Person, ident)
    if p:
        return p
    people = session.exec(select(Person)).all()
    w = ident.lower()
    for candidates in (
        [p for p in people if p.name.lower() == w],
        [p for p in people if w and w in p.name.lower()],
    ):
        current = [p for p in candidates if p.archived_at is None]
        pick = current if current else candidates
        if len(pick) == 1:
            return pick[0]
        if pick:
            raise _bad(f"Person {ident!r} is ambiguous; use a reference",
                       matches=[f"{person_ref(p.number)} {p.name}" + (f" ({p.role})" if p.role else "") for p in pick])
    raise HTTPException(404, detail={"error": f"No person {ident!r}. Create them with POST /agent/people."})


def _manager_id(session: Session, value: Optional[str]) -> Optional[str]:
    """None/""/"none" = no manager."""
    if value is None or not value.strip() or value.strip().lower() == "none":
        return None
    return get_person(session, value).id


def parse_sentiment(value: Optional[str]) -> Sentiment:
    if value is None:
        return Sentiment.NEUTRAL
    s = SENTIMENT_ALIASES.get(value.strip().lower())
    if not s:
        raise _bad(f"Unknown sentiment {value!r}", valid=["strength", "growth", "neutral"])
    return s


def _framework(session: Session):
    dims = session.exec(select(CompetencyDimension).order_by(CompetencyDimension.sort_order)).all()
    attrs = session.exec(select(CompetencyAttribute).order_by(CompetencyAttribute.sort_order)).all()
    return dims, attrs


def _unique(kind: str, wanted: str, options: Dict[str, object]):
    """Exact (case-insensitive), else a unique partial match; 400 otherwise."""
    w = wanted.strip().lower()
    names_for = {}  # one item can have several names (a dimension's label and key)
    for k, v in options.items():
        names_for.setdefault(id(v), (v, []))[1].append(k)
    for test in (lambda k: k.lower() == w, lambda k: w and w in k.lower()):
        hits = [(v, names) for v, names in names_for.values() if any(test(k) for k in names)]
        if len(hits) == 1:
            return hits[0][0]
        if hits:
            raise _bad(f"{kind} {wanted!r} is ambiguous", matches=sorted(names[0] for _, names in hits))
    raise _bad(f"Unknown {kind} {wanted!r}", valid=sorted(names[0] for _, names in names_for.values()))


def resolve_tags(session: Session, tags: List[str]) -> List[InteractionTagInput]:
    """Each tag is "Dimension" (the whole dimension) or "Dimension: attribute" (a unique part of the
    attribute's text is enough). Dimensions match by label or key. See GET /agent/framework."""
    dims, attrs = _framework(session)
    by_label = {d.label: d for d in dims}
    by_label.update({d.key: d for d in dims if d.key not in by_label})
    out: List[InteractionTagInput] = []
    for raw in tags:
        dim_part, _, attr_part = raw.partition(":")
        d = _unique("competency dimension", dim_part, by_label)
        attr_id = None
        if attr_part.strip():
            options = {a.text: a.id for a in attrs if a.dimension_key == d.key}
            attr_id = _unique(f"{d.label} attribute", attr_part, options)
        tag = InteractionTagInput(dimension_key=d.key, attribute_id=attr_id)
        if tag not in out:
            out.append(tag)
    return out


# ── compact shapes ────────────────────────────────────────────────────────────

def _inherited(v) -> dict:
    return {"value": v.value, "inherited_from": v.from_name} if v.from_name else {"value": v.value}


def person_brief(p: Person, by_id: Dict[str, Person]) -> dict:
    managers = org.chain(p, by_id)
    team = org.effective(p, "team", managers)
    focus = org.effective(p, "focus", managers)
    out = {
        "ref": person_ref(p.number), "id": p.id, "name": p.name, "role": p.role,
        "team": team.value, "focus": focus.value,
        "manager": {"ref": person_ref(managers[0].number), "name": managers[0].name} if managers else None,
        "relationship": p.relationship,
    }
    if team.from_name:
        out["team_inherited_from"] = team.from_name
    if focus.from_name:
        out["focus_inherited_from"] = focus.from_name
    if p.is_placeholder:
        out["placeholder"] = True
    if p.archived_at:
        out["archived"] = True
    return out


def interaction_brief(i: Interaction, session: Session, dims=None, attrs=None) -> dict:
    r = interaction_routes._enrich(i, session, dims, attrs)
    return {
        "id": i.id, "date": i.date.isoformat(), "summary": i.summary, "sentiment": i.sentiment.value,
        "tags": [f"{t.dimension_label or t.dimension_key}: {t.attribute_text}" if t.attribute_text
                 else (t.dimension_label or t.dimension_key) for t in r.tags],
        "workstream": r.workstream_name, "high_impact": i.high_impact, "notes": i.notes,
    }


def person_detail(p: Person, session: Session) -> dict:
    by_id = org.load_people(session)
    out = person_brief(p, by_id)
    out["own"] = {"team": p.team, "focus": p.focus}  # what's set on them; blank = inherited
    out["chain"] = [{"ref": person_ref(m.number), "name": m.name, "role": m.role} for m in org.chain(p, by_id)]
    out["reports"] = [{"ref": person_ref(r.number), "name": r.name, "role": r.role}
                      for r in sorted((x for x in by_id.values() if x.manager_id == p.id), key=lambda x: x.name.lower())]
    out["notes"] = p.notes
    rows = session.exec(select(Interaction).where(Interaction.person_id == p.id)
                        .order_by(Interaction.date.desc(), Interaction.created_at.desc())).all()
    dims, attrs = interaction_routes._label_maps(session)
    out["interaction_count"] = len(rows)
    out["recent_interactions"] = [interaction_brief(i, session, dims, attrs) for i in rows[:RECENT_INTERACTIONS]]
    return out


def _tree_node(n) -> dict:
    """Own values only: everyone below inherits what isn't set on them."""
    out = {"ref": person_ref(n.number), "name": n.name}
    for k in ("role", "team", "focus"):
        if getattr(n, k):
            out[k] = getattr(n, k)
    if n.is_placeholder:
        out["placeholder"] = True
    if n.archived:
        out["archived"] = True
    if n.reports:
        out["reports"] = [_tree_node(c) for c in n.reports]
    return out


# ── read ──────────────────────────────────────────────────────────────────────

@router.get("/people")
def agent_people(q: Optional[str] = None, team: Optional[str] = None, include_archived: bool = False,
                 session: Session = Depends(get_session)):
    """People, optionally matching text (name, role, notes) and/or an effective team or focus
    (inherited values count, so team=Maps finds everyone under a Maps manager)."""
    by_id = org.load_people(session)
    people = [p for p in by_id.values() if include_archived or p.archived_at is None]
    if q:
        w = q.lower()
        people = [p for p in people if any(w in (x or "").lower() for x in (p.name, p.role, p.notes))
                  or p.id in set(org.matching_ids(by_id, q))]
    if team:
        ids = set(org.matching_ids(by_id, team))
        people = [p for p in people if p.id in ids]
    people.sort(key=lambda p: p.name.lower())
    return {"count": len(people), "people": [person_brief(p, by_id) for p in people]}


@router.get("/people/tree")
def agent_people_tree(include_archived: bool = False, session: Session = Depends(get_session)):
    """The org tree. Each node shows only what's set on that person; people below inherit team and
    focus from the nearest manager who has them."""
    return {"roots": [_tree_node(n) for n in org.build_tree(session, include_archived)]}


@router.get("/people/{person_id}")
def agent_person(person_id: str, session: Session = Depends(get_session)):
    return person_detail(get_person(session, person_id), session)


@router.get("/people/{person_id}/interactions")
def agent_person_interactions(person_id: str, date_from: Optional[date] = None, date_to: Optional[date] = None,
                              sentiment: Optional[str] = None, session: Session = Depends(get_session)):
    p = get_person(session, person_id)
    rows = interaction_routes.list_interactions(
        person_id=p.id, dimension=None, sentiment=parse_sentiment(sentiment).value if sentiment else None,
        date_from=date_from, date_to=date_to, session=session)
    dims, attrs = interaction_routes._label_maps(session)
    return {"ref": person_ref(p.number), "count": len(rows),
            "interactions": [interaction_brief(session.get(Interaction, r.id), session, dims, attrs) for r in rows]}


@router.get("/people/{person_id}/review-draft")
def agent_person_review_draft(person_id: str, date_from: Optional[date] = None, date_to: Optional[date] = None,
                              session: Session = Depends(get_session)):
    """Their interactions arranged for a peer review: evidence per competency dimension split by
    sentiment, ranked continue/focus candidates, untagged notes, and a familiarity suggestion."""
    p = get_person(session, person_id)
    d = get_review_draft(p.id, date_from, date_to, session)

    def brief(items):
        return [{"date": i.date.isoformat(), "summary": i.summary, "notes": _preview(i.notes)} for i in items]

    return {
        "ref": person_ref(p.number), "name": p.name, "date_from": d.date_from, "date_to": d.date_to,
        "total_interactions": d.total_interactions, "familiarity_suggestion": d.familiarity_suggestion,
        "dimensions": [{"dimension": x.label, "strengths": brief(x.strengths), "growth": brief(x.growth),
                        "neutral": brief(x.neutral)} for x in d.dimensions
                       if x.strengths or x.growth or x.neutral],
        "continue_candidates": [c.model_dump() for c in d.continue_candidates],
        "focus_candidates": [c.model_dump() for c in d.focus_candidates],
        "other_notes": brief(d.other_notes),
    }


@router.get("/framework")
def agent_framework(session: Session = Depends(get_session)):
    """Competency dimensions and their attributes: the valid interaction tags."""
    dims, attrs = _framework(session)
    return {"dimensions": [{"dimension": d.label, "key": d.key,
                            "attributes": [a.text for a in attrs if a.dimension_key == d.key]} for d in dims],
            "tag_format": '"Dimension" or "Dimension: attribute text" (a unique part of either is enough)'}


# ── write ─────────────────────────────────────────────────────────────────────

class NewPerson(BaseModel):
    name: str
    role: Optional[str] = None
    team: Optional[str] = None  # leave out to inherit from the manager
    focus: Optional[str] = None
    manager: Optional[str] = None  # reference or name
    relationship: Optional[str] = None
    notes: Optional[str] = None
    placeholder: bool = False


class PersonChanges(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    team: Optional[str] = None  # "" clears it, so it's inherited again
    focus: Optional[str] = None
    manager: Optional[str] = None  # reference or name; "" (or null) = no manager
    relationship: Optional[str] = None
    placeholder: Optional[bool] = None
    archived: Optional[bool] = None


class NewInteraction(BaseModel):
    summary: str
    date: Optional[Date] = None  # default: today
    sentiment: Optional[str] = None  # strength | growth | neutral (default)
    tags: List[str] = []
    notes: Optional[str] = None
    workstream: Optional[str] = None
    high_impact: bool = False


class InteractionChanges(BaseModel):
    summary: Optional[str] = None
    date: Optional[Date] = None
    sentiment: Optional[str] = None
    tags: Optional[List[str]] = None  # replaces all tags
    notes: Optional[str] = None  # replaces the notes
    workstream: Optional[str] = None
    high_impact: Optional[bool] = None


def _clean(v: Optional[str]) -> Optional[str]:
    return (v or "").strip() or None


@router.post("/people", status_code=201)
def agent_create_person(body: NewPerson, session: Session = Depends(get_session)):
    if not body.name.strip():
        raise _bad("name is required")
    created = people_routes.create_person(PersonCreate(
        name=body.name.strip(), role=_clean(body.role), team=_clean(body.team), focus=_clean(body.focus),
        manager_id=_manager_id(session, body.manager), relationship=_clean(body.relationship),
        notes=_clean(body.notes), is_placeholder=body.placeholder,
    ), session)
    p = session.get(Person, created.id)
    under = f" reporting to {session.get(Person, p.manager_id).name}" if p.manager_id else ""
    _record(session, "create_person", "person", p.id, f"added {_label(p)}{under}")
    return person_detail(p, session)


@router.patch("/people/{person_id}")
def agent_update_person(person_id: str, body: PersonChanges, session: Session = Depends(get_session)):
    p = get_person(session, person_id)
    pid = p.id
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise _bad("Nothing to change", fields=list(PersonChanges.model_fields))
    update = {}
    for k in ("role", "team", "focus", "relationship"):
        if k in changes:
            update[k] = _clean(changes[k])
    if "name" in changes:
        if not (changes["name"] or "").strip():
            raise _bad("name can't be empty")
        update["name"] = changes["name"].strip()
    if "manager" in changes:
        update["manager_id"] = _manager_id(session, changes["manager"])
    if changes.get("placeholder") is not None:
        update["is_placeholder"] = changes["placeholder"]
    if changes.get("archived") is not None:
        if changes["archived"] and not p.archived_at:
            update["archived_at"] = datetime.utcnow()
        elif not changes["archived"]:
            update["archived_at"] = None
    by_id = org.load_people(session)
    before = person_brief(p, by_id)
    people_routes.update_person(pid, PersonUpdate(**update), session)
    p = session.get(Person, pid)
    after = person_brief(p, org.load_people(session))
    keys = [k for k in after if k not in ("id", "ref")] + [k for k in before if k not in after]
    diff = ", ".join(f"{k} {before.get(k)!r} → {after.get(k)!r}" for k in keys if before.get(k) != after.get(k))
    _record(session, "update_person", "person", p.id, f"updated {_label(p)}: {diff or 'no change'}")
    return person_detail(p, session)


@router.post("/people/{person_id}/notes")
def agent_person_notes(person_id: str, body: NotesText, session: Session = Depends(get_session)):
    p = get_person(session, person_id)
    backup = note_snapshots.save(person_ref(p.number), p.notes)  # before every change, in case it goes wrong
    p.notes = _join_notes(p.notes, body.text, body.mode)
    session.add(p)
    session.commit()
    _record(session, f"{body.mode}_person_notes", "person", p.id, f"{NOTES_VERB[body.mode]} notes on {_label(p)}")
    return {**person_detail(p, session), "notes_backup": backup}


@router.post("/people/{person_id}/interactions", status_code=201)
def agent_log_interaction(person_id: str, body: NewInteraction, session: Session = Depends(get_session)):
    p = get_person(session, person_id)
    if not body.summary.strip():
        raise _bad("summary is required")
    created = interaction_routes.create_interaction(InteractionCreate(
        person_id=p.id, date=body.date or Date.today(), summary=body.summary.strip(), notes=_clean(body.notes),
        sentiment=parse_sentiment(body.sentiment), workstream_id=resolve_workstream(session, body.workstream),
        high_impact=body.high_impact, tags=resolve_tags(session, body.tags),
    ), session)
    i = session.get(Interaction, created.id)
    _record(session, "log_interaction", "person", p.id,
            f'logged {i.sentiment.value} interaction with {_label(p)}: "{i.summary}"')
    return interaction_brief(i, session)


@router.patch("/interactions/{interaction_id}")
def agent_update_interaction(interaction_id: str, body: InteractionChanges, session: Session = Depends(get_session)):
    i = session.get(Interaction, interaction_id)
    if not i:
        raise HTTPException(404, detail={"error": f"No interaction {interaction_id!r}"})
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise _bad("Nothing to change", fields=list(InteractionChanges.model_fields))
    update = {}
    if "summary" in changes:
        if not (changes["summary"] or "").strip():
            raise _bad("summary can't be empty")
        update["summary"] = changes["summary"].strip()
    if changes.get("date"):
        update["date"] = changes["date"]
    if "sentiment" in changes:
        update["sentiment"] = parse_sentiment(changes["sentiment"])
    if "notes" in changes:
        update["notes"] = _clean(changes["notes"])
    if "workstream" in changes:
        update["workstream_id"] = resolve_workstream(session, changes["workstream"])
    if changes.get("high_impact") is not None:
        update["high_impact"] = changes["high_impact"]
    if changes.get("tags") is not None:
        update["tags"] = resolve_tags(session, changes["tags"])
    before = interaction_brief(i, session)
    interaction_routes.update_interaction(i.id, InteractionUpdate(**update), session)
    i = session.get(Interaction, interaction_id)
    after = interaction_brief(i, session)
    diff = ", ".join(k for k in after if before.get(k) != after.get(k))
    p = session.get(Person, i.person_id)
    _record(session, "update_interaction", "person", p.id,
            f'updated interaction with {_label(p)} "{i.summary}": {diff or "no change"}')
    return after
