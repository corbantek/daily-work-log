export type TaskState = 'todo' | 'in_progress' | 'complete' | 'abandoned'
export type LinkType = 'pr' | 'issue' | 'doc' | 'slack' | 'other'

export interface Label {
  id: string
  name: string
  color: string
}

export interface TaskLink {
  id: string
  task_id: string
  url: string
  label: string | null
  link_type: LinkType
  created_at: string
}

export interface MeetingBrief {
  id: string
  title: string
  date: string
}

export interface Task {
  id: string
  action: string
  notes: string | null
  state: TaskState
  high_impact: boolean
  workstream_id: string | null
  start_date: string | null
  end_date: string | null
  created_at: string
  labels: Label[]
  links: TaskLink[]
  meetings: MeetingBrief[]
  parent_task_id: string | null
  subtask_count: number
  open_subtask_count: number
}

export interface Workstream {
  id: string
  name: string
  notes: string | null
  archived_at: string | null
  created_at: string
}

export interface Meeting {
  id: string
  date: string
  title: string
  duration_minutes: number | null
  notes: string | null
  created_at: string
  tasks: Task[]
}

export interface WorkstreamWithTasks {
  workstream: Workstream | null
  tasks: Task[]
}

export interface DayView {
  date: string
  status: string | null
  status_note: string | null
  is_oncall: boolean
  meetings: Meeting[]
  workstreams: WorkstreamWithTasks[]
}

export interface OncallPeriod {
  id: string
  start_date: string
  end_date: string
}

// ── People / Peer feedback ─────────────────────────────────────────────────────

export type Sentiment = 'strength' | 'growth' | 'neutral'

export interface CompetencyAttribute {
  id: string
  text: string
  sort_order: number
}

export interface CompetencyDimension {
  key: string
  label: string
  sort_order: number
  attributes: CompetencyAttribute[]
}

export interface Person {
  id: string
  name: string
  role: string | null
  team: string | null
  relationship: string | null
  notes: string | null
  archived_at: string | null
  created_at: string
  interaction_count: number
  last_interaction_date: string | null
}

export interface InteractionTag {
  dimension_key: string
  dimension_label: string | null
  attribute_id: string | null
  attribute_text: string | null
}

export interface InteractionTagInput {
  dimension_key: string
  attribute_id: string | null
}

export interface Interaction {
  id: string
  person_id: string
  date: string
  summary: string
  notes: string | null
  sentiment: Sentiment
  workstream_id: string | null
  high_impact: boolean
  created_at: string
  tags: InteractionTag[]
  workstream_name: string | null
}

export interface ReviewDraftCandidate {
  dimension_key: string
  dimension_label: string
  attribute_id: string | null
  attribute_text: string | null
  count: number
}

export interface ReviewDraftDimension {
  key: string
  label: string
  strengths: Interaction[]
  growth: Interaction[]
  neutral: Interaction[]
}

export interface ReviewDraft {
  person: Person
  date_from: string | null
  date_to: string | null
  total_interactions: number
  familiarity_suggestion: string
  dimensions: ReviewDraftDimension[]
  focus_candidates: ReviewDraftCandidate[]
  continue_candidates: ReviewDraftCandidate[]
  comments_interactions: Interaction[]
  other_notes: Interaction[]
}
