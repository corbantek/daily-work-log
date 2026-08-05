import { useState, useEffect, useCallback } from 'react'
import { Download, Zap } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { Task, Workstream, Label } from '../api/types'
import { todayStr } from '../api/date'
import { getLabels, getWorkstreams } from '../api/client'

const STATE_LABELS: Record<string, string> = {
  todo: 'TODO',
  in_progress: 'IN PROGRESS',
  complete: 'DONE',
}

const STATE_COLORS: Record<string, string> = {
  todo: 'text-red-400 border-red-500/40',
  in_progress: 'text-blue-400 border-blue-500/40',
  complete: 'text-green-400 border-green-500/40',
}

function currentYear() {
  return new Date().getFullYear()
}

export function ReviewPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [workstreams, setWorkstreams] = useState<Workstream[]>([])
  const [labels, setLabels] = useState<Label[]>([])
  const [loading, setLoading] = useState(false)

  // Filters
  const [filterState, setFilterState] = useState<string>('all')
  const [filterWorkstream, setFilterWorkstream] = useState<string>('all')
  const [filterLabel, setFilterLabel] = useState<string>('all')
  const [filterHighImpact, setFilterHighImpact] = useState(false)
  const [filterFrom, setFilterFrom] = useState(`${currentYear()}-01-01`)
  const [filterTo, setFilterTo] = useState(todayStr())

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterState !== 'all') params.set('state', filterState)
    if (filterWorkstream !== 'all') params.set('workstream_id', filterWorkstream)
    if (filterHighImpact) params.set('high_impact', 'true')
    const res = await fetch(`/api/tasks?${params}`)
    const data: Task[] = await res.json()
    setTasks(data)
    setLoading(false)
  }, [filterState, filterWorkstream, filterHighImpact])

  useEffect(() => {
    fetchTasks()
    getWorkstreams().then(setWorkstreams)
    getLabels().then(setLabels)
  }, [fetchTasks])

  // Client-side filtering for date range and label (avoids extra API params)
  const filtered = tasks.filter(t => {
    if (filterLabel !== 'all' && !t.labels.some(l => l.id === filterLabel)) return false
    const taskDate = t.end_date ?? t.start_date ?? t.created_at.split('T')[0]
    if (filterFrom && taskDate < filterFrom) return false
    if (filterTo && taskDate > filterTo) return false
    return true
  })

  // Group by workstream for display
  const grouped = filtered.reduce<Record<string, Task[]>>((acc, t) => {
    const key = t.workstream_id ?? '__none__'
    ;(acc[key] ??= []).push(t)
    return acc
  }, {})

  const wsMap = Object.fromEntries(workstreams.map(w => [w.id, w]))

  function wsName(id: string | null) {
    if (!id) return 'Unassigned'
    return wsMap[id]?.name ?? id
  }

  function exportMarkdown() {
    const lines: string[] = [`# Work Log Export — ${filterFrom} to ${filterTo}`, '']

    const orderedKeys = [
      ...workstreams.map(w => w.id).filter(id => grouped[id]),
      ...(grouped['__none__'] ? ['__none__'] : []),
    ]

    for (const key of orderedKeys) {
      const wsTasks = grouped[key]
      if (!wsTasks?.length) continue
      lines.push(`## ${wsName(key === '__none__' ? null : key)}`)
      for (const t of wsTasks) {
        const impact = t.high_impact ? ' ⚡' : ''
        const state = `[${STATE_LABELS[t.state]}]`
        const linkStr = t.links.map(l => `[${l.label || l.link_type}](${l.url})`).join(' ')
        lines.push(`- ${state}${impact} ${t.action}${linkStr ? ' ' + linkStr : ''}`)
      }
      lines.push('')
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `work-log-${filterFrom}-to-${filterTo}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const orderedGroupKeys = [
    ...workstreams.map(w => w.id).filter(id => grouped[id]),
    ...(grouped['__none__'] ? ['__none__'] : []),
  ]

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header row */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base font-semibold text-foreground">Review</h2>
        <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={exportMarkdown}>
          <Download size={13} /> Export Markdown
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-5 p-3 rounded-lg border border-border bg-card/50">
        {/* Date range */}
        <Input
          type="date"
          value={filterFrom}
          onChange={e => setFilterFrom((e.target as HTMLInputElement).value)}
          className="h-8 text-xs w-36"
        />
        <span className="text-xs text-muted-foreground self-center">→</span>
        <Input
          type="date"
          value={filterTo}
          onChange={e => setFilterTo((e.target as HTMLInputElement).value)}
          className="h-8 text-xs w-36"
        />

        <Separator orientation="vertical" className="h-8" />

        {/* State filter */}
        {(['all', 'todo', 'in_progress', 'complete'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilterState(s)}
            className={cn(
              'text-xs px-2.5 py-1 rounded-md border transition-colors',
              filterState === s
                ? s === 'all'
                  ? 'border-primary text-primary bg-primary/10'
                  : `${STATE_COLORS[s]} bg-transparent`
                : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            {s === 'all' ? 'All' : STATE_LABELS[s]}
          </button>
        ))}

        <Separator orientation="vertical" className="h-8" />

        {/* Workstream filter */}
        <select
          value={filterWorkstream}
          onChange={e => setFilterWorkstream(e.target.value)}
          className="h-8 text-xs px-2 rounded-md border border-border bg-card text-foreground focus:outline-none focus:border-ring"
        >
          <option value="all">All Workstreams</option>
          {workstreams.map(ws => (
            <option key={ws.id} value={ws.id}>{ws.name}</option>
          ))}
        </select>

        {/* Label filter */}
        {labels.length > 0 && (
          <select
            value={filterLabel}
            onChange={e => setFilterLabel(e.target.value)}
            className="h-8 text-xs px-2 rounded-md border border-border bg-card text-foreground focus:outline-none focus:border-ring"
          >
            <option value="all">All Labels</option>
            {labels.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        )}

        {/* High impact toggle */}
        <button
          onClick={() => setFilterHighImpact(v => !v)}
          className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border transition-colors ${
            filterHighImpact
              ? 'border-yellow-500 text-yellow-400 bg-yellow-500/10'
              : 'border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          <Zap size={12} /> High Impact
        </button>
      </div>

      {/* Results count */}
      <p className="text-xs text-muted-foreground mb-4">
        {loading ? 'Loading…' : `${filtered.length} task${filtered.length !== 1 ? 's' : ''}`}
      </p>

      {/* Task list grouped by workstream */}
      <div className="space-y-6">
        {orderedGroupKeys.map(key => {
          const wsTasks = grouped[key]
          if (!wsTasks?.length) return null
          return (
            <div key={key}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {wsName(key === '__none__' ? null : key)}
                </span>
                <Badge variant="secondary" className="text-xs h-4 px-1.5">{wsTasks.length}</Badge>
              </div>
              <div className="space-y-1.5">
                {wsTasks.map(task => (
                  <div
                    key={task.id}
                    className={`rounded-lg border border-border bg-card/50 px-3 py-2 ${
                      task.state === 'complete' ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {task.high_impact && <Zap size={13} className="text-yellow-400 flex-shrink-0 mt-0.5" />}
                      <span className="flex-1 text-sm text-foreground">
                        {task.action}
                      </span>
                      <span className={cn('text-xs border rounded-full px-2.5 h-6 flex items-center font-medium flex-shrink-0', STATE_COLORS[task.state])}>
                        {STATE_LABELS[task.state]}
                      </span>
                    </div>
                    {task.notes && (
                      <div className="prose-worklog max-w-none mt-1.5">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {task.notes}
                        </ReactMarkdown>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      {task.start_date && (
                        <span className="text-xs text-muted-foreground/60">
                          {task.start_date}{task.end_date && task.end_date !== task.start_date ? ` → ${task.end_date}` : ''}
                        </span>
                      )}
                      {task.labels.map(l => (
                        <span
                          key={l.id}
                          className="text-xs px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: l.color + '33', color: l.color }}
                        >
                          {l.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}

        {filtered.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground/50 text-center py-12">No tasks match the current filters.</p>
        )}
      </div>
    </div>
  )
}
