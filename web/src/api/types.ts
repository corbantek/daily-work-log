export type TaskState = 'todo' | 'in_progress' | 'complete' | 'abandoned'
export type LinkType = 'pr' | 'issue' | 'doc' | 'slack' | 'quip' | 'other'

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

export interface MeetingLink {
  id: string
  meeting_id: string
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

export interface Attachment {
  id: string
  task_id: string | null
  meeting_id: string | null
  filename: string
  content_type: string | null
  size_bytes: number
  created_at: string
  kind: 'markdown' | 'pdf' | 'image' | 'html' | 'text' | 'other'
}

export interface AttachmentStats {
  count: number
  total_bytes: number
  missing_files: number
}

export interface Task {
  id: string
  number: number | null
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
  attachments: Attachment[]
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
  number: number | null
  date: string
  title: string
  duration_minutes: number | null
  notes: string | null
  created_at: string
  source: string | null
  start_time: string | null
  missing_from_source: boolean
  exclude_from_stats: boolean
  passive: boolean
  tasks: Task[]
  links: MeetingLink[]
  attachments: Attachment[]
}

export interface CalendarSyncResult {
  created: number
  updated: number
  linked: number
  flagged: number
  skipped: number
}

export interface DismissedCalendarEvent {
  external_id: string
  title: string
  date: string
  start_time: string | null
  dismissed_at: string
}

export interface CalendarStatus {
  status: 'unavailable' | 'not_determined' | 'restricted' | 'denied' | 'authorized' | 'write_only'
  calendars: { id: string; title: string; source: string }[]
}

// ── Review insights ──
export interface InsightSource {
  type: 'task' | 'meeting'
  id: string
  number: number | null
  title: string
  date: string
}

export interface LinkInsight {
  key: string
  kind: 'link' | 'file'
  url: string | null
  label: string | null
  link_type: LinkType | 'file'
  attachment: Attachment | null
  sources: InsightSource[]
  first_date: string
  last_date: string
}

export interface MeetingStats {
  stats_through: string | null
  meeting_count: number
  total_minutes: number
  with_notes: number
  capacity_minutes: number
  work_share: number | null
  days_off: number
  busiest_day: { date: string; minutes: number } | null
  weekly: { week_start: string; minutes: number; passive_minutes: number }[]
  excluded_count: number
  excluded_minutes: number
  passive_count: number
  passive_minutes: number
  engaged_minutes: number
  engaged_share: number | null
  often_passive: OftenPassive[]
}

export interface OftenPassive {
  title: string
  passive: number
  total: number
  latest_meeting_id: string
  latest_number: number | null
}

export interface MeetingDigestEntry {
  id: string
  number: number | null
  title: string
  date: string
  start_time: string | null
  duration_minutes: number | null
  exclude_from_stats: boolean
  passive: boolean
  preview: string
  has_more: boolean
  notes: string
  tasks: TaskBrief[]
  links: MeetingLink[]
  attachments: Attachment[]
}

export interface TaskBrief {
  id: string
  number: number | null
  action: string
  state: TaskState
  high_impact: boolean
}

/** A task linked to meetings in the range, listed once with every meeting it came from. */
export interface OutcomeTask extends TaskBrief {
  meetings: { id: string; number: number | null; title: string; date: string; start_time: string | null }[]
}

export interface MeetingInsights {
  date_from: string | null
  date_to: string | null
  stats: MeetingStats
  digest: MeetingDigestEntry[]
  outcomes: OutcomeTask[]
  open_tasks: number
  done_tasks: number
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

// ── Self-review ────────────────────────────────────────────────────────────────

export interface SelfReviewStats {
  tasks_completed: number
  high_impact: number
  workstreams_touched: number
  in_progress: number
  meetings: number
  oncall_days: number
}

export interface SelfReviewGroup {
  workstream: Workstream | null
  tasks: Task[]
}

export interface SelfReview {
  date_from: string | null
  date_to: string | null
  stats: SelfReviewStats
  highlights: Task[]
  groups: SelfReviewGroup[]
}

// ── Global search ──────────────────────────────────────────────────────────────

export type SearchResultType = 'task' | 'meeting' | 'person' | 'interaction'

export interface SearchResult {
  type: SearchResultType
  id: string
  title: string
  subtitle: string | null
  date: string | null
  person_id: string | null
  number?: number | null
}
