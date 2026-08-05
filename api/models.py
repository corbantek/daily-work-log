from sqlmodel import SQLModel, Field, Relationship
from typing import Optional, List
from datetime import datetime, date
from enum import Enum
import uuid
import sqlalchemy as sa


def _enum_by_value(enum_cls):
    return sa.Enum(enum_cls, values_callable=lambda e: [x.value for x in e])


def new_id() -> str:
    return str(uuid.uuid4())


class TaskState(str, Enum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    COMPLETE = "complete"


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


class TaskUpdate(SQLModel):
    action: Optional[str] = None
    notes: Optional[str] = None
    state: Optional[TaskState] = None
    high_impact: Optional[bool] = None
    workstream_id: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    label_ids: Optional[List[str]] = None


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
    date: Optional[date] = None
    duration_minutes: Optional[int] = None
    notes: Optional[str] = None
    task_ids: Optional[List[str]] = None


# ── Day view response ─────────────────────────────────────────────────────────

class WorkstreamWithTasks(SQLModel):
    workstream: Optional[WorkstreamRead]
    tasks: List[TaskRead]


class DayView(SQLModel):
    date: date
    meetings: List[MeetingRead]
    workstreams: List[WorkstreamWithTasks]
