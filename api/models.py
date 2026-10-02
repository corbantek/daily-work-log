from sqlmodel import SQLModel, Field, Relationship
from typing import Optional, List
from datetime import datetime, date
from enum import Enum
import uuid
import sqlalchemy as sa

# Alias so models with a field literally named `date` and a default value can
# annotate it without the field name shadowing the `date` type (a field such as
# `date: Optional[date] = None` otherwise resolves the annotation to NoneType).
DateType = date


def _enum_by_value(enum_cls):
    return sa.Enum(enum_cls, values_callable=lambda e: [x.value for x in e])


def new_id() -> str:
    return str(uuid.uuid4())


class TaskState(str, Enum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    COMPLETE = "complete"
    ABANDONED = "abandoned"


class LinkType(str, Enum):
    PR = "pr"
    ISSUE = "issue"
    DOC = "doc"
    SLACK = "slack"
    OTHER = "other"


# ── Junction tables ──────────────────────────────────────────────────────────

class TaskLabelLink(SQLModel, table=True):
    __tablename__ = "task_label"
    task_id: str = Field(foreign_key="task.id", primary_key=True)
    label_id: str = Field(foreign_key="label.id", primary_key=True)


class MeetingTaskLink(SQLModel, table=True):
    __tablename__ = "meeting_task"
    meeting_id: str = Field(foreign_key="meeting.id", primary_key=True)
    task_id: str = Field(foreign_key="task.id", primary_key=True)


# ── Workstream ────────────────────────────────────────────────────────────────

class WorkstreamBase(SQLModel):
    name: str
    description: Optional[str] = None


class Workstream(WorkstreamBase, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    archived_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    tasks: List["Task"] = Relationship(back_populates="workstream")


class WorkstreamCreate(WorkstreamBase):
    pass


class WorkstreamRead(WorkstreamBase):
    id: str
    archived_at: Optional[datetime]
    created_at: datetime


class WorkstreamUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    archived_at: Optional[datetime] = None


# ── Label ─────────────────────────────────────────────────────────────────────

class LabelBase(SQLModel):
    name: str
    color: str = "#6366f1"


class Label(LabelBase, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)

    tasks: List["Task"] = Relationship(back_populates="labels", link_model=TaskLabelLink)


class LabelCreate(LabelBase):
    pass


class LabelRead(LabelBase):
    id: str


# ── TaskLink ──────────────────────────────────────────────────────────────────

class TaskLinkBase(SQLModel):
    url: str
    label: Optional[str] = None
    link_type: LinkType = Field(default=LinkType.OTHER, sa_type=_enum_by_value(LinkType))


class TaskLink(TaskLinkBase, table=True):
    __tablename__ = "tasklink"
    id: str = Field(default_factory=new_id, primary_key=True)
    task_id: str = Field(foreign_key="task.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)

    task: Optional["Task"] = Relationship(back_populates="links")


class TaskLinkCreate(TaskLinkBase):
    pass


class TaskLinkRead(TaskLinkBase):
    id: str
    task_id: str
    created_at: datetime


# ── Task ──────────────────────────────────────────────────────────────────────

class TaskBase(SQLModel):
    action: str
    notes: Optional[str] = None
    state: TaskState = Field(default=TaskState.TODO, sa_type=_enum_by_value(TaskState))
    high_impact: bool = False
    workstream_id: Optional[str] = Field(default=None, foreign_key="workstream.id")
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    parent_task_id: Optional[str] = Field(default=None, foreign_key="task.id")


class Task(TaskBase, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)

    workstream: Optional[Workstream] = Relationship(back_populates="tasks")
    labels: List[Label] = Relationship(back_populates="tasks", link_model=TaskLabelLink)
    links: List[TaskLink] = Relationship(back_populates="task")
    meetings: List["Meeting"] = Relationship(back_populates="tasks", link_model=MeetingTaskLink)


class TaskCreate(TaskBase):
    label_ids: List[str] = []


class MeetingBrief(SQLModel):
    id: str
    title: str
    date: date


class TaskRead(TaskBase):
    id: str
    created_at: datetime
    labels: List[LabelRead] = []
    links: List[TaskLinkRead] = []
    meetings: List[MeetingBrief] = []
    subtask_count: int = 0
    open_subtask_count: int = 0


class TaskUpdate(SQLModel):
    action: Optional[str] = None
    notes: Optional[str] = None
    state: Optional[TaskState] = None
    high_impact: Optional[bool] = None
    workstream_id: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    label_ids: Optional[List[str]] = None
    parent_task_id: Optional[str] = None


# ── Meeting ───────────────────────────────────────────────────────────────────

class MeetingBase(SQLModel):
    date: date
    title: str
    duration_minutes: Optional[int] = None
    notes: Optional[str] = None


class Meeting(MeetingBase, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)

    tasks: List[Task] = Relationship(back_populates="meetings", link_model=MeetingTaskLink)


class MeetingCreate(MeetingBase):
    task_ids: List[str] = []


class MeetingRead(MeetingBase):
    id: str
    created_at: datetime
    tasks: List[TaskRead] = []


class MeetingUpdate(SQLModel):
    title: Optional[str] = None
    date: Optional[DateType] = None
    duration_minutes: Optional[int] = None
    notes: Optional[str] = None
    task_ids: Optional[List[str]] = None


# ── Settings ─────────────────────────────────────────────────────────────────

class Setting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str = ""


# ── Day Status ───────────────────────────────────────────────────────────────

class DayStatus(SQLModel, table=True):
    __tablename__ = "day_status"
    day: date = Field(primary_key=True)
    status: str
    note: Optional[str] = None


class DayStatusUpdate(SQLModel):
    status: str
    note: Optional[str] = None


# ── Oncall Periods ───────────────────────────────────────────────────────────

class OncallPeriod(SQLModel, table=True):
    __tablename__ = "oncall_period"
    id: str = Field(default_factory=new_id, primary_key=True)
    start_date: date
    end_date: date


class OncallPeriodCreate(SQLModel):
    start_date: date
    end_date: date


class OncallPeriodRead(SQLModel):
    id: str
    start_date: date
    end_date: date


class OncallPeriodUpdate(SQLModel):
    start_date: Optional[date] = None
    end_date: Optional[date] = None


# ── Day Visibility ──────────────────────────────────────────────────────────

class DayVisibility(SQLModel, table=True):
    __tablename__ = "day_visibility"
    day: date = Field(primary_key=True)
    visible: bool


class DayVisibilityUpdate(SQLModel):
    visible: bool


# ── Day view response ─────────────────────────────────────────────────────────

class WorkstreamWithTasks(SQLModel):
    workstream: Optional[WorkstreamRead]
    tasks: List[TaskRead]


class DayView(SQLModel):
    date: date
    status: Optional[str] = None
    status_note: Optional[str] = None
    is_oncall: bool = False
    meetings: List[MeetingRead]
    workstreams: List[WorkstreamWithTasks]


# ── Competency framework (peer feedback) ───────────────────────────────────────

class CompetencyDimension(SQLModel, table=True):
    __tablename__ = "competency_dimension"
    key: str = Field(primary_key=True)
    label: str
    sort_order: int = 0


class CompetencyAttribute(SQLModel, table=True):
    __tablename__ = "competency_attribute"
    id: str = Field(default_factory=new_id, primary_key=True)
    dimension_key: str = Field(foreign_key="competency_dimension.key")
    text: str
    sort_order: int = 0


class CompetencyAttributeRead(SQLModel):
    id: str
    text: str
    sort_order: int


class CompetencyDimensionRead(SQLModel):
    key: str
    label: str
    sort_order: int
    attributes: List[CompetencyAttributeRead] = []


# ── People ─────────────────────────────────────────────────────────────────────

class PersonBase(SQLModel):
    name: str
    role: Optional[str] = None
    team: Optional[str] = None
    relationship: Optional[str] = None
    notes: Optional[str] = None


class Person(PersonBase, table=True):
    __tablename__ = "person"
    id: str = Field(default_factory=new_id, primary_key=True)
    archived_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PersonCreate(PersonBase):
    pass


class PersonUpdate(SQLModel):
    name: Optional[str] = None
    role: Optional[str] = None
    team: Optional[str] = None
    relationship: Optional[str] = None
    notes: Optional[str] = None
    archived_at: Optional[datetime] = None


class PersonRead(PersonBase):
    id: str
    archived_at: Optional[datetime]
    created_at: datetime
    interaction_count: int = 0
    last_interaction_date: Optional[date] = None


# ── Interactions (dated observations about a person) ────────────────────────────

class Sentiment(str, Enum):
    STRENGTH = "strength"
    GROWTH = "growth"
    NEUTRAL = "neutral"


class Interaction(SQLModel, table=True):
    __tablename__ = "interaction"
    id: str = Field(default_factory=new_id, primary_key=True)
    person_id: str = Field(foreign_key="person.id")
    date: date
    summary: str
    notes: Optional[str] = None
    sentiment: Sentiment = Field(default=Sentiment.NEUTRAL, sa_type=_enum_by_value(Sentiment))
    workstream_id: Optional[str] = Field(default=None, foreign_key="workstream.id")
    high_impact: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)


class InteractionTag(SQLModel, table=True):
    __tablename__ = "interaction_tag"
    id: str = Field(default_factory=new_id, primary_key=True)
    interaction_id: str = Field(foreign_key="interaction.id")
    dimension_key: str
    attribute_id: Optional[str] = None


class InteractionTagInput(SQLModel):
    dimension_key: str
    attribute_id: Optional[str] = None


class InteractionTagRead(SQLModel):
    dimension_key: str
    dimension_label: Optional[str] = None
    attribute_id: Optional[str] = None
    attribute_text: Optional[str] = None


class InteractionBase(SQLModel):
    person_id: str
    date: date
    summary: str
    notes: Optional[str] = None
    sentiment: Sentiment = Sentiment.NEUTRAL
    workstream_id: Optional[str] = None
    high_impact: bool = False


class InteractionCreate(InteractionBase):
    tags: List[InteractionTagInput] = []


class InteractionUpdate(SQLModel):
    date: Optional[DateType] = None
    summary: Optional[str] = None
    notes: Optional[str] = None
    sentiment: Optional[Sentiment] = None
    workstream_id: Optional[str] = None
    high_impact: Optional[bool] = None
    tags: Optional[List[InteractionTagInput]] = None


class InteractionRead(InteractionBase):
    id: str
    created_at: datetime
    tags: List[InteractionTagRead] = []
    workstream_name: Optional[str] = None


# ── Review draft (aggregated peer-feedback helper) ─────────────────────────────

class ReviewDraftDimension(SQLModel):
    key: str
    label: str
    strengths: List[InteractionRead] = []
    growth: List[InteractionRead] = []
    neutral: List[InteractionRead] = []


class ReviewDraftCandidate(SQLModel):
    dimension_key: str
    dimension_label: str
    attribute_id: Optional[str] = None
    attribute_text: Optional[str] = None
    count: int = 0


class ReviewDraft(SQLModel):
    person: PersonRead
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    total_interactions: int = 0
    familiarity_suggestion: str
    dimensions: List[ReviewDraftDimension] = []
    focus_candidates: List[ReviewDraftCandidate] = []
    continue_candidates: List[ReviewDraftCandidate] = []
    comments_interactions: List[InteractionRead] = []
    other_notes: List[InteractionRead] = []


# Default framework seeded on first run (editable later via the framework editor).
DEFAULT_FRAMEWORK = [
    {
        "key": "teamwork",
        "label": "Teamwork",
        "attributes": [
            "Cultivated relationships and worked collaboratively",
            "Communicated openly and effectively",
            "Positively influenced the performance of the team",
            "Provided leadership and inspiration to others",
            "Encouraged others to share their perspectives",
        ],
    },
    {
        "key": "innovation",
        "label": "Innovation",
        "attributes": [
            "Approached problems with creativity, curiosity, and new ideas",
            "Applied expertise to find better ways to do things",
            "Focused on details that produce excellence",
            "Took smart, courageous risks",
            "Included perspectives of others in pursuit of the best approach or idea",
        ],
    },
    {
        "key": "results",
        "label": "Results",
        "attributes": [
            "Produced high-quality outcomes",
            "Accomplished goals and objectives on time",
            "Exercised good judgment and took responsibility for decisions",
            "Exemplified company values and supported a culture of inclusion for all",
            "Enriched the customer experience",
        ],
    },
]
