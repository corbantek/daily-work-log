import type {
  DayView, Task, Workstream, Meeting, Label, TaskLink, MeetingLink,
  TaskState, LinkType, OncallPeriod,
  Person, Interaction, InteractionTagInput, Sentiment,
  CompetencyDimension, ReviewDraft, SelfReview, SearchResult,
  CalendarSyncResult, CalendarStatus, LinkInsight, MeetingInsights, DismissedCalendarEvent, Attachment, AttachmentStats,
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

// ── Attachments ───────────────────────────────────────────────────────────────
async function failMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null)
  return typeof body?.detail === 'string' ? body.detail : `${res.status} ${res.statusText}`
}

/** `owner` is the API path of whatever the file belongs to, e.g. `/tasks/<id>` or `/meetings/<id>`. */
export async function uploadAttachment(owner: string, file: File): Promise<Attachment> {
  const form = new FormData() // no JSON Content-Type header: the browser sets the multipart boundary
  form.append('file', file)
  const res = await fetch(`${BASE}${owner}/attachments`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(await failMessage(res))
  return res.json()
}

export const getAttachment = (id: string) => req<Attachment>(`/attachments/${id}`)

export const renameAttachment = (id: string, filename: string) =>
  req<Attachment>(`/attachments/${id}`, { method: 'PATCH', body: JSON.stringify({ filename }) })

export const deleteAttachment = (id: string) =>
  req<void>(`/attachments/${id}`, { method: 'DELETE' })

/**
 * The file itself (the filename segment is cosmetic: tab title / download name).
 * `?v=2` is ignored by the server; it just makes browsers skip responses cached before files
 * were sent with `Cache-Control: no-store` (an old cached "attachment" response kept HTML
 * attachments downloading). Not needed for new behavior: bump only to bust caches again.
 */
export const attachmentFileUrl = (a: Pick<Attachment, 'id' | 'filename'>) =>
  `${BASE}/attachments/${a.id}/${encodeURIComponent(a.filename)}?v=2`

/** Where a click should go: markdown opens in the rendered viewer, everything else is the file. */
export const attachmentOpenUrl = (a: Pick<Attachment, 'id' | 'filename' | 'kind'>) =>
  a.kind === 'markdown' ? `/?attachment=${a.id}` : attachmentFileUrl(a)

export const getAttachmentStats = () => req<AttachmentStats>('/attachments/stats')

export const ATTACHMENTS_ARCHIVE_URL = `${BASE}/attachments/archive`

export async function importAttachmentsArchive(file: File): Promise<{ restored: number; skipped: number; missing_files: number }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE}/attachments/archive`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(await failMessage(res))
  return res.json()
}

// ── Calendar ──────────────────────────────────────────────────────────────────
export const getCalendarStatus = () => req<CalendarStatus>('/calendar/status')

export const requestCalendarAccess = () =>
  req<CalendarStatus>('/calendar/request-access', { method: 'POST' })

export const getDismissedCalendarEvents = () =>
  req<DismissedCalendarEvent[]>('/calendar/dismissed')

export const clearDismissedCalendarEvents = () =>
  req<void>('/calendar/dismissed', { method: 'DELETE' })

export const restoreDismissedCalendarEvent = (externalId: string) =>
  req<void>(`/calendar/dismissed/${encodeURIComponent(externalId)}`, { method: 'DELETE' })

export async function syncCalendarDay(date: string): Promise<CalendarSyncResult> {
  const res = await fetch(`${BASE}/calendar/sync?date=${date}`, { method: 'POST' })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail ?? `${res.status} ${res.statusText}`)
  }
  return res.json()
}

// ── Tasks ─────────────────────────────────────────────────────────────────────
export const getTasks = (params?: { active_on?: string; workstream_id?: string | null }) => {
  const p = new URLSearchParams()
  if (params?.active_on) p.set('active_on', params.active_on)
  if (params?.workstream_id) p.set('workstream_id', params.workstream_id)
  const qs = p.toString() ? `?${p}` : ''
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
  parent_task_id?: string | null
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
  parent_task_id: string | null
}>) => req<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

export const getTask = (id: string) => req<Task>(`/tasks/${id}`)

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

// ── Meeting links ─────────────────────────────────────────────────────────────
export const addMeetingLink = (meetingId: string, body: {
  url: string
  label?: string
  link_type?: LinkType
}) => req<MeetingLink>(`/meetings/${meetingId}/links`, { method: 'POST', body: JSON.stringify(body) })

export const updateMeetingLink = (meetingId: string, linkId: string, body: {
  url: string
  label?: string
  link_type?: LinkType
}) => req<MeetingLink>(`/meetings/${meetingId}/links/${linkId}`, { method: 'PATCH', body: JSON.stringify(body) })

export const deleteMeetingLink = (meetingId: string, linkId: string) =>
  req<void>(`/meetings/${meetingId}/links/${linkId}`, { method: 'DELETE' })

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
  start_time?: string | null
  notes?: string | null
  task_ids?: string[]
}) => req<Meeting>('/meetings', { method: 'POST', body: JSON.stringify(body) })

export const updateMeeting = (id: string, body: Partial<{
  title: string
  date: string
  duration_minutes: number | null
  start_time: string | null
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
export const setDayStatus = (date: string, status: string, note?: string | null) =>
  req<{ date: string; status: string; note: string | null }>(`/day-status/${date}`, {
    method: 'PUT',
    body: JSON.stringify({ status, note: note ?? null }),
  })

export const clearDayStatus = (date: string) =>
  req<void>(`/day-status/${date}`, { method: 'DELETE' })

// ── Day Visibility ──────────────────────────────────────────────────────────
export const getDayVisibility = (from: string, to: string) =>
  req<Record<string, boolean>>(`/day-visibility?from=${from}&to=${to}`)

export const setDayVisibility = (date: string, visible: boolean) =>
  req<{ date: string; visible: boolean }>(`/day-visibility/${date}`, {
    method: 'PUT',
    body: JSON.stringify({ visible }),
  })

export const clearDayVisibility = (date: string) =>
  req<void>(`/day-visibility/${date}`, { method: 'DELETE' })

// ── Oncall Periods ────────────────────────────────────────────────────────────
export const getOncallPeriods = () => req<OncallPeriod[]>('/oncall')

export const createOncallPeriod = (start_date: string, end_date: string) =>
  req<OncallPeriod>('/oncall', {
    method: 'POST',
    body: JSON.stringify({ start_date, end_date }),
  })

export const deleteOncallPeriod = (id: string) =>
  req<void>(`/oncall/${id}`, { method: 'DELETE' })

// ── Settings ─────────────────────────────────────────────────────────────────
export const getSettings = () => req<Record<string, string>>('/settings')

export const setSetting = (key: string, value: string) =>
  req<{ key: string; value: string }>(`/settings/${key}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  })

// ── Backup ──────────────────────────────────────────────────────────────────
export interface BackupStatus {
  backup_dir: string
  backup_dir_resolved: string
  retention_days: number
  last_backup: string | null
  backup_count: number
}

export const getBackupStatus = () => req<BackupStatus>('/backup/status')

export const runAutoBackup = () =>
  req<{ status: string; file: string; date: string; pruned: number }>('/backup/auto', { method: 'POST' })

// ── People / Peer feedback ─────────────────────────────────────────────────────
export const getFramework = () => req<CompetencyDimension[]>('/framework')

export const createDimension = (label: string) =>
  req<CompetencyDimension>('/framework/dimensions', { method: 'POST', body: JSON.stringify({ label }) })

export const updateDimension = (key: string, label: string) =>
  req<CompetencyDimension>(`/framework/dimensions/${key}`, { method: 'PATCH', body: JSON.stringify({ label }) })

export const deleteDimension = (key: string) =>
  req<void>(`/framework/dimensions/${key}`, { method: 'DELETE' })

export const createAttribute = (dimensionKey: string, text: string) =>
  req<{ id: string; text: string; sort_order: number }>(`/framework/dimensions/${dimensionKey}/attributes`, { method: 'POST', body: JSON.stringify({ text }) })

export const updateAttribute = (id: string, text: string) =>
  req<{ id: string; text: string; sort_order: number }>(`/framework/attributes/${id}`, { method: 'PATCH', body: JSON.stringify({ text }) })

export const deleteAttribute = (id: string) =>
  req<void>(`/framework/attributes/${id}`, { method: 'DELETE' })

export const getPeople = (includeArchived = false) =>
  req<Person[]>(`/people${includeArchived ? '?include_archived=true' : ''}`)

export const getPerson = (id: string) => req<Person>(`/people/${id}`)

export const createPerson = (body: {
  name: string
  role?: string | null
  team?: string | null
  relationship?: string | null
  notes?: string | null
}) => req<Person>('/people', { method: 'POST', body: JSON.stringify(body) })

export const updatePerson = (id: string, body: Partial<{
  name: string
  role: string | null
  team: string | null
  relationship: string | null
  notes: string | null
  archived_at: string | null
}>) => req<Person>(`/people/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

export const deletePerson = (id: string) =>
  req<void>(`/people/${id}`, { method: 'DELETE' })

export const getInteractions = (params?: {
  person_id?: string
  dimension?: string
  sentiment?: Sentiment
  date_from?: string
  date_to?: string
}) => {
  const p = new URLSearchParams()
  if (params?.person_id) p.set('person_id', params.person_id)
  if (params?.dimension) p.set('dimension', params.dimension)
  if (params?.sentiment) p.set('sentiment', params.sentiment)
  if (params?.date_from) p.set('date_from', params.date_from)
  if (params?.date_to) p.set('date_to', params.date_to)
  const qs = p.toString() ? `?${p}` : ''
  return req<Interaction[]>(`/interactions${qs}`)
}

export const createInteraction = (body: {
  person_id: string
  date: string
  summary: string
  notes?: string | null
  sentiment?: Sentiment
  workstream_id?: string | null
  high_impact?: boolean
  tags?: InteractionTagInput[]
}) => req<Interaction>('/interactions', { method: 'POST', body: JSON.stringify(body) })

export const updateInteraction = (id: string, body: Partial<{
  date: string
  summary: string
  notes: string | null
  sentiment: Sentiment
  workstream_id: string | null
  high_impact: boolean
  tags: InteractionTagInput[]
}>) => req<Interaction>(`/interactions/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

export const deleteInteraction = (id: string) =>
  req<void>(`/interactions/${id}`, { method: 'DELETE' })

export const getReviewDraft = (personId: string, dateFrom?: string, dateTo?: string) => {
  const p = new URLSearchParams()
  if (dateFrom) p.set('date_from', dateFrom)
  if (dateTo) p.set('date_to', dateTo)
  const qs = p.toString() ? `?${p}` : ''
  return req<ReviewDraft>(`/review-draft/${personId}${qs}`)
}

export const getSelfReview = (dateFrom?: string, dateTo?: string) => {
  const p = new URLSearchParams()
  if (dateFrom) p.set('date_from', dateFrom)
  if (dateTo) p.set('date_to', dateTo)
  const qs = p.toString() ? `?${p}` : ''
  return req<SelfReview>(`/self-review${qs}`)
}

// ── Review insights ──────────────────────────────────────────────────────────
const rangeQuery = (dateFrom: string, dateTo: string) =>
  `?${new URLSearchParams({ date_from: dateFrom, date_to: dateTo })}`

export const getLinkInsights = (dateFrom: string, dateTo: string) =>
  req<LinkInsight[]>(`/insights/links${rangeQuery(dateFrom, dateTo)}`)

export const getMeetingInsights = (dateFrom: string, dateTo: string) =>
  req<MeetingInsights>(`/insights/meetings${rangeQuery(dateFrom, dateTo)}`)

export const search = (q: string) =>
  req<SearchResult[]>(`/search?q=${encodeURIComponent(q)}`)
