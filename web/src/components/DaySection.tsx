import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { DayView } from '../api/types'
import { getDay } from '../api/client'
import { MeetingSection } from './MeetingSection'
import { WorkstreamSection } from './WorkstreamSection'
import { AddTaskGlobal } from './AddTaskGlobal'

interface Props {
  date: string
  isToday: boolean
  defaultCollapsed?: boolean
}

export function DaySection({ date, isToday, defaultCollapsed = false }: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [data, setData] = useState<DayView | null>(null)
  const [loading, setLoading] = useState(false)

  function load() {
    setLoading(true)
    getDay(date)
      .then(setData)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [date])

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
          className="flex items-center gap-2 flex-1 text-left"
        >
          {collapsed
            ? <ChevronRight size={16} className="text-muted-foreground" />
            : <ChevronDown size={16} className="text-muted-foreground" />
          }
          <span className={`font-semibold text-sm ${isToday ? 'text-primary' : 'text-foreground'}`}>{label}</span>
          {isToday && (
            <span className="ml-1 text-xs bg-primary/15 text-primary px-2 py-0.5 rounded-full">today</span>
          )}
          {collapsed && data && (
            <span className="ml-auto text-xs text-muted-foreground/50">{summary}</span>
          )}
        </button>

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
