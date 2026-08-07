import type {
  DayView, Task, Workstream, Meeting, Label, TaskLink,
  TaskState, LinkType,
} from './types'

const BASE = '/api'

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  if (res.status === 204) return undefined as T
  return res.json()
}

// ── Day ───────────────────────────────────────────────────────────────────────
export const getDay = (date: string) => req<DayView>(`/day/${date}`)

// ── Tasks ─────────────────────────────────────────────────────────────────────
export const getTasks = (params?: { active_on?: string }) => {
  const qs = params?.active_on ? `?active_on=${params.active_on}` : ''
  return req<Task[]>(`/tasks${qs}`)
}

export const createTask = (body: {
  action: string
  notes?: string
  state?: TaskState
  high_impact?: boolean
  workstream_id?: string | null
  start_date?: string | null
  label_ids?: string[]
}) => req<Task>('/tasks', { method: 'POST', body: JSON.stringify(body) })

export const updateTask = (id: string, body: Partial<{
  action: string
  notes: string | null
  state: TaskState
  high_impact: boolean
  workstream_id: string | null
  start_date: string | null
  end_date: string | null
  label_ids: string[]
}>) => req<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

export const deleteTask = (id: string) =>
  req<void>(`/tasks/${id}`, { method: 'DELETE' })

// ── Task links ────────────────────────────────────────────────────────────────
export const addTaskLink = (taskId: string, body: {
  url: string
  label?: string
  link_type?: LinkType
}) => req<TaskLink>(`/tasks/${taskId}/links`, { method: 'POST', body: JSON.stringify(body) })

export const updateTaskLink = (taskId: string, linkId: string, body: {
  url: string
  label?: string
  link_type?: LinkType
}) => req<TaskLink>(`/tasks/${taskId}/links/${linkId}`, { method: 'PATCH', body: JSON.stringify(body) })

export const deleteTaskLink = (taskId: string, linkId: string) =>
  req<void>(`/tasks/${taskId}/links/${linkId}`, { method: 'DELETE' })

// ── Workstreams ───────────────────────────────────────────────────────────────
export const getWorkstreams = () => req<Workstream[]>('/workstreams')

export const createWorkstream = (body: { name: string; description?: string }) =>
  req<Workstream>('/workstreams', { method: 'POST', body: JSON.stringify(body) })

export const updateWorkstream = (id: string, body: Partial<{ name: string; description: string; archived_at: string | null }>) =>
  req<Workstream>(`/workstreams/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

export const restoreWorkstream = (id: string) =>
  req<Workstream>(`/workstreams/${id}`, { method: 'PATCH', body: JSON.stringify({ archived_at: null }) })

export const getWorkstreamsAll = () => req<Workstream[]>('/workstreams?include_archived=true')

export const archiveWorkstream = (id: string) =>
  req<void>(`/workstreams/${id}`, { method: 'DELETE' })

// ── Meetings ──────────────────────────────────────────────────────────────────
export const createMeeting = (body: {
  date: string
  title: string
  duration_minutes?: number | null
  notes?: string | null
  task_ids?: string[]
}) => req<Meeting>('/meetings', { method: 'POST', body: JSON.stringify(body) })

export const updateMeeting = (id: string, body: Partial<{
  title: string
  date: string
  duration_minutes: number | null
  notes: string | null
  task_ids: string[]
}>) => req<Meeting>(`/meetings/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

export const getMeeting = (id: string) => req<Meeting>(`/meetings/${id}`)

export const deleteMeeting = (id: string) =>
  req<void>(`/meetings/${id}`, { method: 'DELETE' })

export async function linkTaskToMeeting(meetingId: string, taskId: string) {
  const meeting = await getMeeting(meetingId)
  const taskIds = meeting.tasks.map(t => t.id)
  if (!taskIds.includes(taskId)) {
    await updateMeeting(meetingId, { task_ids: [...taskIds, taskId] })
  }
}

export async function unlinkTaskFromMeeting(meetingId: string, taskId: string) {
  const meeting = await getMeeting(meetingId)
  const taskIds = meeting.tasks.map(t => t.id).filter(id => id !== taskId)
  await updateMeeting(meetingId, { task_ids: taskIds })
}

// ── Labels ────────────────────────────────────────────────────────────────────
export const getLabels = () => req<Label[]>('/labels')

export const createLabel = (body: { name: string; color: string }) =>
  req<Label>('/labels', { method: 'POST', body: JSON.stringify(body) })

export const updateLabel = (id: string, body: { name: string; color: string }) =>
  req<Label>(`/labels/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

export const deleteLabel = (id: string) =>
  req<void>(`/labels/${id}`, { method: 'DELETE' })

// ── Day Status ───────────────────────────────────────────────────────────────
export const setDayStatus = (date: string, status: string) =>
  req<{ date: string; status: string }>(`/day-status/${date}`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  })

export const clearDayStatus = (date: string) =>
  req<void>(`/day-status/${date}`, { method: 'DELETE' })

// ── Settings ─────────────────────────────────────────────────────────────────
export const getSettings = () => req<Record<string, string>>('/settings')

export const setSetting = (key: string, value: string) =>
  req<{ key: string; value: string }>(`/settings/${key}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  })
