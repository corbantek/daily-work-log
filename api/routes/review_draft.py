from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from typing import Optional
from datetime import date
from collections import Counter

from ..database import get_session
from ..models import (
    Person, PersonRead, Interaction, InteractionTag, Sentiment,
    CompetencyDimension, CompetencyAttribute,
    ReviewDraft, ReviewDraftDimension, ReviewDraftCandidate,
)
from .interactions import _enrich, _label_maps
from .people import _enrich as _enrich_person

router = APIRouter(prefix="/review-draft", tags=["review-draft"])


def _familiarity(count: int) -> str:
    if count >= 10:
        return "Very familiar"
    if count >= 4:
        return "Somewhat familiar"
    return "Not too familiar"


def _rank_candidates(interactions, tags_by_interaction, dims, attrs):
    # Count (dimension, attribute) pairs across the given interactions.
    counter: Counter = Counter()
    for i in interactions:
        for t in tags_by_interaction.get(i.id, []):
            counter[(t.dimension_key, t.attribute_id)] += 1
    candidates = []
    for (dim_key, attr_id), count in counter.most_common():
        candidates.append(ReviewDraftCandidate(
            dimension_key=dim_key,
            dimension_label=dims.get(dim_key, dim_key),
            attribute_id=attr_id,
            attribute_text=attrs.get(attr_id) if attr_id else None,
            count=count,
        ))
    return candidates


@router.get("/{person_id}", response_model=ReviewDraft)
def get_review_draft(
    person_id: str,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    session: Session = Depends(get_session),
):
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(404)

    q = select(Interaction).where(Interaction.person_id == person_id)
    if date_from:
        q = q.where(Interaction.date >= date_from)
    if date_to:
        q = q.where(Interaction.date <= date_to)
    interactions = session.exec(q.order_by(Interaction.date.desc())).all()

    dims, attrs = _label_maps(session)

    # Tag rows grouped by interaction id (for grouping + candidate ranking).
    tags_by_interaction: dict[str, list] = {}
    for i in interactions:
        tags_by_interaction[i.id] = session.exec(
            select(InteractionTag).where(InteractionTag.interaction_id == i.id)
        ).all()

    enriched = {i.id: _enrich(i, session, dims, attrs) for i in interactions}

    # Build per-dimension buckets in framework order.
    dimension_rows = session.exec(
        select(CompetencyDimension).order_by(CompetencyDimension.sort_order)
    ).all()
    dimensions = []
    for d in dimension_rows:
        bucket = ReviewDraftDimension(key=d.key, label=d.label)
        for i in interactions:
            if any(t.dimension_key == d.key for t in tags_by_interaction.get(i.id, [])):
                read = enriched[i.id]
                if i.sentiment == Sentiment.STRENGTH:
                    bucket.strengths.append(read)
                elif i.sentiment == Sentiment.GROWTH:
                    bucket.growth.append(read)
                else:
                    bucket.neutral.append(read)
        dimensions.append(bucket)

    growth_interactions = [i for i in interactions if i.sentiment == Sentiment.GROWTH]
    strength_interactions = [i for i in interactions if i.sentiment == Sentiment.STRENGTH]

    focus_candidates = _rank_candidates(growth_interactions, tags_by_interaction, dims, attrs)
    continue_candidates = _rank_candidates(strength_interactions, tags_by_interaction, dims, attrs)

    comments = [enriched[i.id] for i in interactions if i.high_impact]
    other_notes = [
        enriched[i.id] for i in interactions
        if i.sentiment == Sentiment.NEUTRAL and not tags_by_interaction.get(i.id)
    ]

    return ReviewDraft(
        person=_enrich_person(person, session),
        date_from=date_from,
        date_to=date_to,
        total_interactions=len(interactions),
        familiarity_suggestion=_familiarity(len(interactions)),
        dimensions=dimensions,
        focus_candidates=focus_candidates,
        continue_candidates=continue_candidates,
        comments_interactions=comments,
        other_notes=other_notes,
    )
