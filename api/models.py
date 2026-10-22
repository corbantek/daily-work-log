from sqlmodel import SQLModel, Field, Relationship
from pydantic import field_validator
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
    QUIP = "quip"
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


# ── TaskAttachment ────────────────────────────────────────────────────────────

class TaskAttachment(SQLModel, table=True):
    """A file stored on disk (see api/attachments.py); `stored_name` is its UUID-hex name."""
    __tablename__ = "task_attachment"
    id: str = Field(default_factory=new_id, primary_key=True)
    task_id: str = Field(foreign_key="task.id", index=True)
    filename: str
    stored_name: str
    content_type: Optional[str] = None
    size_bytes: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


class MeetingAttachment(SQLModel, table=True):
    """Same as TaskAttachment, but owned by a meeting (separate table: task_id is NOT NULL there)."""
    __tablename__ = "meeting_attachment"
    id: str = Field(default_factory=new_id, primary_key=True)
    meeting_id: str = Field(foreign_key="meeting.id", index=True)
    filename: str
    stored_name: str
    content_type: Optional[str] = None
    size_bytes: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AttachmentRead(SQLModel):
    id: str
    task_id: Optional[str] = None  # exactly one of task_id / meeting_id is set
    meeting_id: Optional[str] = None
    filename: str
    content_type: Optional[str] = None
    size_bytes: int
    created_at: datetime
    kind: str  # markdown | pdf | image | text | other


class AttachmentRename(SQLModel):
    filename: str


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
    attachments: List[AttachmentRead] = []
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

def _check_hhmm(v: Optional[str]) -> Optional[str]:
    """Normalize a local "HH:MM" time; empty means no time."""
    if v is None or v == "":
        return None
    try:
        h, m = v.split(":")
        if len(h) == 2 and len(m) == 2 and 0 <= int(h) < 24 and 0 <= int(m) < 60:
            return v
    except ValueError:
        pass
    raise ValueError("start_time must be HH:MM (24-hour)")


class MeetingBase(SQLModel):
    date: date
    title: str
    duration_minutes: Optional[int] = None
    notes: Optional[str] = None
    start_time: Optional[str] = None  # local "HH:MM", 24-hour
    # Left out of meeting stats (hours, share of week, count, busiest day, weekly chart, Self-Review's
    # count), e.g. parties and conferences. Calendar sync never changes it.
    exclude_from_stats: bool = False

    @field_validator("start_time")
    @classmethod
    def _validate_start_time(cls, v):
        return _check_hhmm(v)


class Meeting(MeetingBase, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    # Set for meetings imported from a calendar; null for manually entered ones.
    source: Optional[str] = None
    external_id: Optional[str] = Field(default=None, index=True)
    # Hash of the calendar event's title/time/duration at the last sync; lets a
    # dismissal tell "unchanged" from "edited since".
    source_fingerprint: Optional[str] = None
    # Imported meeting that no longer appears on the calendar (kept: it may have notes).
    missing_from_source: bool = False

    tasks: List[Task] = Relationship(back_populates="meetings", link_model=MeetingTaskLink)


class MeetingLink(TaskLinkBase, table=True):
    """A URL attached to a meeting (own table: tasklink.task_id is NOT NULL)."""
    __tablename__ = "meeting_link"
    id: str = Field(default_factory=new_id, primary_key=True)
    meeting_id: str = Field(foreign_key="meeting.id", index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class MeetingLinkRead(TaskLinkBase):
    id: str
    meeting_id: str
    created_at: datetime


class MeetingCreate(MeetingBase):
    task_ids: List[str] = []


class MeetingRead(MeetingBase):
    id: str
    created_at: datetime
    source: Optional[str] = None
    missing_from_source: bool = False
    tasks: List[TaskRead] = []
    links: List[MeetingLinkRead] = []
    attachments: List[AttachmentRead] = []


class MeetingUpdate(SQLModel):
    title: Optional[str] = None
    date: Optional[DateType] = None
    duration_minutes: Optional[int] = None
    notes: Optional[str] = None
    start_time: Optional[str] = None
    exclude_from_stats: Optional[bool] = None
    task_ids: Optional[List[str]] = None

    @field_validator("start_time")
    @classmethod
    def _validate_start_time(cls, v):
        return _check_hhmm(v)


class DismissedCalendarEvent(SQLModel, table=True):
    """A calendar event the user deleted; sync skips it while it's unchanged."""
    __tablename__ = "dismissed_calendar_event"
    external_id: str = Field(primary_key=True)
    fingerprint: str
    title: str
    date: DateType
    start_time: Optional[str] = None
    dismissed_at: datetime = Field(default_factory=datetime.utcnow)


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


# ── Self-review draft (your own year-end summary) ──────────────────────────────

class SelfReviewStats(SQLModel):
    tasks_completed: int = 0
    high_impact: int = 0
    workstreams_touched: int = 0
    in_progress: int = 0
    meetings: int = 0
    oncall_days: int = 0


class SelfReviewGroup(SQLModel):
    workstream: Optional[WorkstreamRead] = None
    tasks: List[TaskRead] = []


class SelfReview(SQLModel):
    date_from: Optional[DateType] = None
    date_to: Optional[DateType] = None
    stats: SelfReviewStats
    highlights: List[TaskRead] = []
    groups: List[SelfReviewGroup] = []


# ── Insights (Review → Meetings / Links) ──────────────────────────────────────

class InsightSource(SQLModel):
    """A task or meeting that a link or file appeared on."""
    type: str  # task | meeting
    id: str
    title: str
    date: DateType


class LinkInsight(SQLModel):
    key: str  # normalized URL for links, "file:<attachment id>" for files
    kind: str  # link | file
    url: Optional[str] = None
    label: Optional[str] = None
    link_type: str  # a LinkType value, or "file"
    attachment: Optional[AttachmentRead] = None
    sources: List[InsightSource] = []
    first_date: DateType
    last_date: DateType


class MeetingWeek(SQLModel):
    week_start: DateType  # Monday
    minutes: int


class BusiestDay(SQLModel):
    date: DateType
    minutes: int


class MeetingStats(SQLModel):
    stats_through: Optional[DateType] = None  # stats only count days up to today
    meeting_count: int = 0
    total_minutes: int = 0
    with_notes: int = 0
    capacity_minutes: int = 0  # working weekdays (minus days marked off) x 8h
    work_share: Optional[float] = None  # total_minutes / capacity_minutes
    days_off: int = 0
    busiest_day: Optional[BusiestDay] = None
    weekly: List[MeetingWeek] = []
    excluded_count: int = 0  # meetings marked "Exclude from stats" (left out of everything above)
    excluded_minutes: int = 0


class TaskBrief(SQLModel):
    id: str
    action: str
    state: TaskState
    high_impact: bool = False


class MeetingDigestEntry(SQLModel):
    id: str
    title: str
    date: DateType
    start_time: Optional[str] = None
    duration_minutes: Optional[int] = None
    exclude_from_stats: bool = False
    preview: str  # markdown: a "summary" section if the notes have one, else the first lines; "" without notes
    has_more: bool
    notes: str
    tasks: List[TaskBrief] = []
    links: List[MeetingLinkRead] = []
    attachments: List[AttachmentRead] = []


class OutcomeMeeting(SQLModel):
    id: str
    title: str
    date: DateType
    start_time: Optional[str] = None


class OutcomeTask(TaskBrief):
    """A task linked to one or more meetings in the range (listed once, with all its meetings)."""
    meetings: List[OutcomeMeeting] = []


class MeetingInsights(SQLModel):
    date_from: Optional[DateType] = None
    date_to: Optional[DateType] = None
    stats: MeetingStats
    digest: List[MeetingDigestEntry] = []
    outcomes: List[OutcomeTask] = []
    open_tasks: int = 0
    done_tasks: int = 0


# ── Global search ──────────────────────────────────────────────────────────────

class SearchResult(SQLModel):
    type: str  # task | meeting | person | interaction
    id: str
    title: str
    subtitle: Optional[str] = None
    date: Optional[DateType] = None
    person_id: Optional[str] = None


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
