import { useEffect, useState, useRef } from 'react'
import { ChevronDown, ChevronRight, X, Plus, Eye, EyeOff, ArrowLeft } from 'lucide-react'
import type { DayView } from '../api/types'
import { getDay, setDayStatus, clearDayStatus, getSettings } from '../api/client'
import { MeetingSection } from './MeetingSection'
import { WorkstreamSection } from './WorkstreamSection'
import { AddTaskGlobal } from './AddTaskGlobal'

const DEFAULT_STATUSES = ['🤒 Sick', '🏠 Kid at home', '🏖️ Vacation', '⏰ Half day', '📅 Out of office']

interface Props {
  date: string
  isToday: boolean
  defaultCollapsed?: boolean
  isHiddenByDefault?: boolean
  onVisibilityChange?: (date: string, visible: boolean | null) => void
}

export function DaySection({ date, isToday, defaultCollapsed = false, isHiddenByDefault = false, onVisibilityChange }: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [data, setData] = useState<DayView | null>(null)
  const [loading, setLoading] = useState(false)
  const [statusPickerOpen, setStatusPickerOpen] = useState(false)
  const [statusOptions, setStatusOptions] = useState<string[]>(DEFAULT_STATUSES)
  // Two-step picker state: null = tag list, string = confirm step with this tag
  const [pendingTag, setPendingTag] = useState<string | null>(null)
  const [pendingNote, setPendingNote] = useState('')
  const pickerRef = useRef<HTMLDivElement>(null)
  const noteInputRef = useRef<HTMLInputElement>(null)

  function load() {
    setLoading(true)
    getDay(date)
      .then(setData)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [date])

  useEffect(() => {
    getSettings().then(s => {
      if (s.day_status_options) {
        try {
          const parsed = JSON.parse(s.day_status_options)
          if (Array.isArray(parsed)) {
            const custom = parsed.filter((v: string) => !DEFAULT_STATUSES.includes(v))
            const merged = [...DEFAULT_STATUSES, ...custom]
            if (merged.length > 0) setStatusOptions(merged)
          }
        } catch { /* use defaults */ }
      }
    })
  }, [])

  // Focus the note input when the confirm step opens
  useEffect(() => {
    if (pendingTag !== null) {
      noteInputRef.current?.focus()
    }
  }, [pendingTag])

  // Close picker on outside click
  useEffect(() => {
    if (!statusPickerOpen) return
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        closePicker()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [statusPickerOpen])

  function openPicker(existingTag?: string, existingNote?: string) {
    if (existingTag) {
      setPendingTag(existingTag)
      setPendingNote(existingNote ?? '')
    } else {
      setPendingTag(null)
      setPendingNote('')
    }
    setStatusPickerOpen(true)
  }

  function closePicker() {
    setStatusPickerOpen(false)
    setPendingTag(null)
    setPendingNote('')
  }

  function selectTag(tag: string) {
    setPendingTag(tag)
    setPendingNote('')
  }

  async function confirmStatus() {
    if (!pendingTag) return
    await setDayStatus(date, pendingTag, pendingNote.trim() || null)
    closePicker()
    load()
  }

  async function handleClearStatus() {
    await clearDayStatus(date)
    load()
  }

  const label = formatDateLabel(date)
  const taskCount = data ? data.workstreams.reduce((n, ws) => n + ws.tasks.length, 0) : 0
  const summary = data
    ? `${data.meetings.length} meeting${data.meetings.length !== 1 ? 's' : ''} · ${taskCount} task${taskCount !== 1 ? 's' : ''}`
    : ''

  return (
    <div className={`rounded-xl border ${isToday ? 'border-primary/30 bg-card' : 'border-border/60 bg-card/70'} mb-4`}>
      {/* Day header */}
      <div className="group flex items-center px-4 py-3">
        <button
          onClick={() => setCollapsed(v => !v)}
          className="flex items-center gap-2 text-left"
        >
          {collapsed
            ? <ChevronRight size={16} className="text-muted-foreground" />
            : <ChevronDown size={16} className="text-muted-foreground" />
          }
          <span className={`font-semibold text-sm ${isToday ? 'text-primary' : 'text-foreground'}`}>{label}</span>
          {isToday && (
            <span className="ml-1 text-xs bg-primary/15 text-primary px-2 py-0.5 rounded-full">today</span>
          )}
        </button>

        {/* Day status pill */}
        {data?.status ? (
          <span className="group/status ml-2 inline-flex items-center gap-1 text-xs bg-red-500/15 text-red-400 border border-red-500/30 px-2.5 py-0.5 rounded-full">
            <button
              onClick={(e) => { e.stopPropagation(); openPicker(data.status ?? undefined, data.status_note ?? undefined) }}
              className="hover:text-red-300 transition-colors"
            >
              {data.status}{data.status_note ? <span className="text-red-400/60"> · {data.status_note}</span> : null}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleClearStatus() }}
              className="opacity-0 group-hover/status:opacity-100 hover:text-destructive transition-all -mr-0.5"
              title="Clear status"
            >
              <X size={11} />
            </button>
          </span>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); openPicker() }}
            className="ml-2 opacity-0 group-hover:opacity-100 hover:!opacity-100 text-muted-foreground/40 hover:text-muted-foreground text-xs transition-all flex items-center gap-0.5"
            title="Set day status"
          >
            <Plus size={11} /> status
          </button>
        )}

        {/* Status dropdown */}
        {statusPickerOpen && (
          <div ref={pickerRef} className="relative">
            <div className="absolute left-0 top-2 z-50 bg-popover border border-border rounded-lg shadow-xl p-1 min-w-48">
              {pendingTag === null ? (
                /* Step 1: tag list */
                statusOptions.map(opt => (
                  <button
                    key={opt}
                    onClick={() => selectTag(opt)}
                    className="flex items-center w-full px-2.5 py-1.5 rounded text-xs text-left hover:bg-accent transition-colors"
                  >
                    {opt}
                  </button>
                ))
              ) : (
                /* Step 2: confirm with optional note */
                <div className="px-1 py-0.5 space-y-2">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setPendingTag(null); setPendingNote('') }}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title="Back"
                    >
                      <ArrowLeft size={13} />
                    </button>
                    <span className="text-xs font-medium text-foreground">{pendingTag}</span>
                  </div>
                  <input
                    ref={noteInputRef}
                    type="text"
                    value={pendingNote}
                    onChange={e => setPendingNote(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); confirmStatus() }
                      if (e.key === 'Escape') { e.preventDefault(); closePicker() }
                    }}
                    placeholder="Note (optional)"
                    className="w-full text-xs bg-background border border-border rounded px-2 py-1 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <div className="flex gap-1">
                    <button
                      onClick={confirmStatus}
                      className="flex-1 text-xs bg-primary text-primary-foreground rounded px-2 py-1 hover:bg-primary/90 transition-colors"
                    >
                      Apply
                    </button>
                    <button
                      onClick={closePicker}
                      className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Hide/unhide button */}
        {!isToday && onVisibilityChange && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (isHiddenByDefault) {
                onVisibilityChange(date, null)
              } else {
                onVisibilityChange(date, false)
              }
            }}
            className="ml-1 opacity-0 group-hover:opacity-100 hover:!opacity-100 text-muted-foreground/40 hover:text-muted-foreground transition-all"
            title={isHiddenByDefault ? 'Shown (click to re-hide)' : 'Hide this day'}
          >
            {isHiddenByDefault ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
        )}

        <div className="flex-1" />

        {collapsed && data && (
          <span className="text-xs text-muted-foreground/50">{summary}</span>
        )}

        {/* Top-level add task (always visible in header) */}
        {!collapsed && <AddTaskGlobal defaultDate={date} onCreated={load} />}
      </div>

      {/* Day body */}
      {!collapsed && (
        <div className="px-4 pb-4">
          {loading && <p className="text-xs text-muted-foreground/50 py-4">Loading…</p>}
          {data && (
            <>
              <MeetingSection meetings={data.meetings} date={date} onChanged={load} />
              <div>
                {data.workstreams.length > 0 && (
                  <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                    Workstreams
                  </div>
                )}
                {data.workstreams.map((ws, i) => (
                  <WorkstreamSection
                    key={ws.workstream?.id ?? `unassigned-${i}`}
                    section={ws}
                    date={date}
                    onChanged={load}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[dt.getDay()]}, ${months[dt.getMonth()]} ${d}, ${y}`
}
