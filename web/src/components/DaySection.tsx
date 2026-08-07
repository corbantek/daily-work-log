import { useEffect, useState, useRef } from 'react'
import { ChevronDown, ChevronRight, X, Plus } from 'lucide-react'
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
}

export function DaySection({ date, isToday, defaultCollapsed = false }: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [data, setData] = useState<DayView | null>(null)
  const [loading, setLoading] = useState(false)
  const [statusPickerOpen, setStatusPickerOpen] = useState(false)
  const [statusOptions, setStatusOptions] = useState<string[]>(DEFAULT_STATUSES)
  const pickerRef = useRef<HTMLDivElement>(null)

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
          if (Array.isArray(parsed) && parsed.length > 0) setStatusOptions(parsed)
        } catch { /* use defaults */ }
      }
    })
  }, [])

  // Close picker on outside click
  useEffect(() => {
    if (!statusPickerOpen) return
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setStatusPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [statusPickerOpen])

  async function handleSetStatus(status: string) {
    await setDayStatus(date, status)
    setStatusPickerOpen(false)
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
      <div className="flex items-center px-4 py-3">
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
          <span className="group/status ml-2 inline-flex items-center gap-1 text-xs bg-amber-500/15 text-amber-400 border border-amber-500/30 px-2.5 py-0.5 rounded-full">
            <button
              onClick={(e) => { e.stopPropagation(); setStatusPickerOpen(v => !v) }}
              className="hover:text-amber-300 transition-colors"
            >
              {data.status}
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
            onClick={(e) => { e.stopPropagation(); setStatusPickerOpen(v => !v) }}
            className="ml-2 opacity-0 group-hover:opacity-100 hover:!opacity-100 text-muted-foreground/40 hover:text-muted-foreground text-xs transition-all flex items-center gap-0.5"
            title="Set day status"
          >
            <Plus size={11} /> status
          </button>
        )}

        {/* Status dropdown */}
        {statusPickerOpen && (
          <div ref={pickerRef} className="relative">
            <div className="absolute left-0 top-2 z-50 bg-popover border border-border rounded-lg shadow-xl p-1 min-w-40">
              {statusOptions.map(opt => (
                <button
                  key={opt}
                  onClick={() => handleSetStatus(opt)}
                  className="flex items-center w-full px-2.5 py-1.5 rounded text-xs text-left hover:bg-accent transition-colors"
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
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
