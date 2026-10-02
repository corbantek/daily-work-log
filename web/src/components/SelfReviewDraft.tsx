import { useState, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Download, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { rehypeHighlightTodo } from '@/lib/rehype-highlight-todo'
import type { SelfReview, Task } from '../api/types'
import { getSelfReview } from '../api/client'
import { todayStr } from '../api/date'

const STATE_LABELS: Record<string, string> = {
  todo: 'TODO', in_progress: 'IN PROGRESS', complete: 'DONE', abandoned: 'ABANDONED',
}
const STATE_COLORS: Record<string, string> = {
  todo: 'text-red-400 border-red-500/40',
  in_progress: 'text-blue-400 border-blue-500/40',
  complete: 'text-green-400 border-green-500/40',
  abandoned: 'text-gray-400 border-gray-500/40',
}

function yearStart() {
  return `${new Date().getFullYear()}-01-01`
}

interface Props {
  theme?: 'light' | 'dim' | 'dark'
}

export function SelfReviewDraft({ theme }: Props) {
  const [data, setData] = useState<SelfReview | null>(null)
  const [from, setFrom] = useState(yearStart())
  const [to, setTo] = useState(todayStr())
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    getSelfReview(from, to).then(setData).finally(() => setLoading(false))
  }, [from, to])

  useEffect(() => { load() }, [load])

  function buildMarkdown(d: SelfReview): string {
    const lines: string[] = [`# Self-Review — ${from} to ${to}`, '']
    const s = d.stats
    lines.push(`**${s.tasks_completed}** completed · **${s.high_impact}** high-impact · **${s.workstreams_touched}** workstreams · **${s.in_progress}** in progress · **${s.meetings}** meetings · **${s.oncall_days}** on-call days`)
    lines.push('')
    if (d.highlights.length) {
      lines.push('## Highlights')
      for (const t of d.highlights) {
        lines.push(`- ⚡ ${t.action}`)
        if (t.notes) for (const nl of t.notes.split('\n')) lines.push(`  ${nl}`)
      }
      lines.push('')
    }
    for (const g of d.groups) {
      lines.push(`## ${g.workstream?.name ?? 'Unassigned'}`)
      for (const t of g.tasks) {
        const impact = t.high_impact ? ' ⚡' : ''
        lines.push(`- [${STATE_LABELS[t.state]}]${impact} ${t.action}`)
      }
      lines.push('')
    }
    return lines.join('\n')
  }

  function exportMarkdown() {
    if (!data) return
    const blob = new Blob([buildMarkdown(data)], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `self-review-${from}-to-${to}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const STATS = data ? [
    { label: 'Completed', value: data.stats.tasks_completed },
    { label: 'High-impact', value: data.stats.high_impact },
    { label: 'Workstreams', value: data.stats.workstreams_touched },
    { label: 'In progress', value: data.stats.in_progress },
    { label: 'Meetings', value: data.stats.meetings },
    { label: 'On-call days', value: data.stats.oncall_days },
  ] : []

  function TaskLine({ t }: { t: Task }) {
    return (
      <div className="flex items-start gap-2 text-sm">
        {t.high_impact && <Zap size={13} className="text-yellow-400 shrink-0 mt-0.5" />}
        <span className="flex-1 text-foreground">{t.action}</span>
        <span className={cn('text-xs border rounded-full px-2 h-5 flex items-center font-medium shrink-0', STATE_COLORS[t.state])}>
          {STATE_LABELS[t.state]}
        </span>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-5 p-3 rounded-lg border border-border bg-card/50">
        <Input type="date" value={from} onChange={e => setFrom((e.target as HTMLInputElement).value)}
          className="h-8 text-xs w-36" style={{ colorScheme: theme === 'light' ? 'light' : 'dark' }} />
        <span className="text-xs text-muted-foreground">→</span>
        <Input type="date" value={to} onChange={e => setTo((e.target as HTMLInputElement).value)}
          className="h-8 text-xs w-36" style={{ colorScheme: theme === 'light' ? 'light' : 'dark' }} />
        {loading && <span className="text-xs text-muted-foreground ml-1">Loading…</span>}
        <div className="flex-1" />
        <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={exportMarkdown} disabled={!data}>
          <Download size={13} /> Export Markdown
        </Button>
      </div>

      {data && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-5">
            {STATS.map(st => (
              <div key={st.label} className="rounded-lg border border-border bg-card/50 px-3 py-2 text-center">
                <div className="text-lg font-semibold text-foreground">{st.value}</div>
                <div className="text-xs text-muted-foreground">{st.label}</div>
              </div>
            ))}
          </div>

          {/* Highlights */}
          {data.highlights.length > 0 && (
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 mb-5">
              <p className="text-xs font-semibold text-yellow-400 mb-2 flex items-center gap-1.5">
                <Zap size={12} /> Highlights
              </p>
              <div className="space-y-2.5">
                {data.highlights.map(t => (
                  <div key={t.id}>
                    <TaskLine t={t} />
                    {t.notes && (
                      <div className="prose-worklog max-w-none mt-1 ml-5">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlightTodo]}>{t.notes}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* By workstream */}
          <div className="space-y-4">
            {data.groups.map((g, i) => (
              <div key={g.workstream?.id ?? `none-${i}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {g.workstream?.name ?? 'Unassigned'}
                  </span>
                  <span className="text-xs text-muted-foreground/50">{g.tasks.length}</span>
                </div>
                <div className="space-y-1.5">
                  {g.tasks.map(t => (
                    <div key={t.id} className="rounded-lg border border-border bg-card/50 px-3 py-2">
                      <TaskLine t={t} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {data.groups.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground/50 text-center py-12">No tasks in this date range.</p>
          )}
        </>
      )}
    </div>
  )
}
