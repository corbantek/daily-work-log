export type TaskState = 'todo' | 'in_progress' | 'complete'
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
  meetings: Meeting[]
  workstreams: WorkstreamWithTasks[]
}
