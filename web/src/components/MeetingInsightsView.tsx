import { useCallback, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Download, Eye, EyeOff, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { rehypeHighlightTodo } from '@/lib/rehype-highlight-todo'
import type { MeetingDigestEntry, MeetingInsights, MeetingStats, TaskBrief } from '../api/types'
import { getMeetingInsights } from '../api/client'
import {
  formatMonthDay, formatShortDate, formatTime, type DateRange, type TimeFormat,
} from '../api/date'
import { DateRangePicker } from './DateRangePicker'
import { ItemDetailDialog, type DetailTarget } from './ItemDetailDialog'
import { LinkedItems } from './LinkedItems'
import { useOnActivate } from '@/lib/use-on-activate'
import { useOnDataChange } from '@/lib/live-updates'
import { ExcludedBadge } from './ExcludeFromStats'
import { PassiveBadge } from './Passive'
import { RefBadge } from './RefBadge'

const STATE_LABELS: Record<string, string> = {
  todo: 'TODO', in_progress: 'IN PROGRESS', complete: 'DONE', abandoned: 'ABANDONED',
}
const STATE_COLORS: Record<string, string> = {
  todo: 'text-red-400 border-red-500/40',
  in_progress: 'text-blue-400 border-blue-500/40',
  complete: 'text-green-400 border-green-500/40',
  abandoned: 'text-gray-400 border-gray-500/40',
}

const hours = (minutes: number) => {
  const h = minutes / 60
  return `${h < 10 ? h.toFixed(1).replace(/\.0$/, '') : Math.round(h)} h`
}

/** A meeting with nothing attached: shown as one compact line, and hidden with the "Show empty meetings" toggle. */
const isEmpty = (m: MeetingDigestEntry) => !m.notes && !m.tasks.length && !m.links.length && !m.attachments.length

const markdownLinks = {
  a: ({ children, ...props }: React.ComponentProps<'a'>) => (
    <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>
  ),
}

interface Props {
  theme?: 'light' | 'dim' | 'dark'
  timeFormat: TimeFormat
  /** False while hidden behind another view; the data reloads when it turns true again. */
  active?: boolean
  /** The date range, shared by every Review view (owned by ReviewPage so it sticks between them). */
  range: DateRange
  onRangeChange: (range: DateRange) => void
}

/** Review → Meetings: meeting load, a digest of meeting notes, and the tasks that came out of them. */
export function MeetingInsightsView({ theme, timeFormat, active = true, range, onRangeChange }: Props) {
  const [data, setData] = useState<MeetingInsights | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showEmpty, setShowEmpty] = useState(true)
  const [detail, setDetail] = useState<DetailTarget | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    getMeetingInsights(range.from, range.to).then(setData).finally(() => setLoading(false))
  }, [range.from, range.to])

  useEffect(() => { load() }, [load])
  useOnActivate(active, load)
  useOnDataChange(load, active)

  const when = (m: { date: string; start_time: string | null }) =>
    [formatShortDate(m.date), m.start_time && formatTime(m.start_time, timeFormat)].filter(Boolean).join(' · ')

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function buildMarkdown(d: MeetingInsights): string {
    const s = d.stats
    const lines = [`# Meetings — ${range.from} to ${range.to}`, '']
    const share = s.work_share != null ? ` · **${Math.round(s.work_share * 100)}%** of the work week` : ''
    const engaged = s.passive_minutes && s.engaged_share != null ? ` (${Math.round(s.engaged_share * 100)}% engaged)` : ''
    const passive = s.passive_count ? ` · ${hours(s.passive_minutes)} passive in ${s.passive_count}` : ''
    const excl = s.excluded_count ? ` · ${s.excluded_count} excluded (${hours(s.excluded_minutes)})` : ''
    lines.push(`**${hours(s.total_minutes)}** in **${s.meeting_count}** meetings${share}${engaged}${passive} · **${s.with_notes}** with notes${excl}`, '')
    if (s.often_passive.length) {
      lines.push('## Often passive', '')
      for (const o of s.often_passive) lines.push(`- ${o.title}: passive ${o.passive} of ${o.total}`)
      lines.push('')
    }
    if (d.outcomes.length) {
      lines.push('## Outcomes', '')
      for (const t of d.outcomes) {
        const from = t.meetings.map(m => `${m.title} (${formatShortDate(m.date)})`).join(', ')
        lines.push(`- [${STATE_LABELS[t.state]}]${t.high_impact ? ' ⚡' : ''} ${t.action} — from ${from}`)
      }
      lines.push('')
    }
    const digest = showEmpty ? d.digest : d.digest.filter(m => !isEmpty(m))  // export what is on screen
    if (digest.length) {
      lines.push('## Digest', '')
      for (const m of digest) {
        const dur = m.duration_minutes ? ` (${m.duration_minutes}m)` : ''
        lines.push(`### ${when(m)} · ${m.title}${dur}${m.passive ? ' — passive' : ''}${m.exclude_from_stats ? ' — excluded from stats' : ''}`, '')
        if (m.preview) lines.push(m.preview, '')
        for (const t of m.tasks) lines.push(`- [${STATE_LABELS[t.state]}]${t.high_impact ? ' ⚡' : ''} ${t.action}`)
        for (const l of m.links) lines.push(`- [${l.label || l.url}](${l.url})`)
        for (const a of m.attachments) lines.push(`- 📎 ${a.filename}`)
        if (m.tasks.length || m.links.length || m.attachments.length) lines.push('')
      }
    }
    return lines.join('\n')
  }

  function exportMarkdown() {
    if (!data) return
    const blob = new Blob([buildMarkdown(data)], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `meetings-${range.from}-to-${range.to}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const s = data?.stats
  const tiles = s ? [
    {
      label: 'In meetings',
      value: hours(s.total_minutes),
      sub: s.passive_minutes ? `${hours(s.passive_minutes)} passive` : undefined,
      title: s.passive_minutes
        ? `${hours(s.engaged_minutes)} engaged + ${hours(s.passive_minutes)} passive (${s.passive_count} meeting${s.passive_count === 1 ? '' : 's'} you worked through)`
        : undefined,
    },
    {
      label: 'Of work week',
      value: s.work_share != null ? `${Math.round(s.work_share * 100)}%` : '—',
      sub: s.passive_minutes && s.engaged_share != null ? `${Math.round(s.engaged_share * 100)}% engaged` : undefined,
      title: `${hours(s.total_minutes)} of ${hours(s.capacity_minutes)} working time (weekdays × 8 h${s.days_off ? `, ${s.days_off} day${s.days_off === 1 ? '' : 's'} off excluded` : ''})`
        + (s.passive_minutes && s.engaged_share != null ? `; ${hours(s.engaged_minutes)} engaged without passive meetings` : ''),
    },
    ...(s.passive_minutes ? [{
      label: 'Engaged',
      value: hours(s.engaged_minutes),
      title: 'Meeting time minus passive meetings (ones you attended without participating)',
    }] : []),
    { label: 'Meetings', value: String(s.meeting_count) },
    { label: 'With notes', value: String(s.with_notes) },
    {
      label: 'Busiest day',
      value: s.busiest_day ? formatMonthDay(s.busiest_day.date) : '—',
      title: s.busiest_day ? `${formatShortDate(s.busiest_day.date)} · ${hours(s.busiest_day.minutes)}` : undefined,
      sub: s.busiest_day ? `${formatShortDate(s.busiest_day.date).split(',')[0]} · ${hours(s.busiest_day.minutes)}` : undefined,
    },
  ] : []
  const statsCutShort = !!(s?.stats_through && s.stats_through < range.to)
  const emptyCount = data ? data.digest.filter(isEmpty).length : 0
  const shownDigest = data ? (showEmpty ? data.digest : data.digest.filter(m => !isEmpty(m))) : []

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-5 p-3 rounded-lg border border-border bg-card/50">
        <DateRangePicker value={range} onChange={onRangeChange} theme={theme} />
        {loading && <span className="text-xs text-muted-foreground ml-1">Loading…</span>}
        <div className="flex-1" />
        <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={exportMarkdown} disabled={!data}>
          <Download size={13} /> Export Markdown
        </Button>
      </div>

      {s && (
        <>
          <div className={cn('grid grid-cols-2 gap-2 mb-1', tiles.length > 5 ? 'sm:grid-cols-3 md:grid-cols-6' : 'sm:grid-cols-5')}>
            {tiles.map(t => (
              <div key={t.label} className="rounded-lg border border-border bg-card px-3 py-2" title={t.title}>
                <div className="text-xl font-semibold text-foreground tabular-nums">
                  {t.value}
                  {t.sub && <span className="text-xs font-normal text-muted-foreground ml-1.5">{t.sub}</span>}
                </div>
                <div className="text-xs text-muted-foreground">{t.label}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground/60 mb-5">
            {statsCutShort && <>Stats count days through {formatShortDate(s.stats_through!)}. </>}
            Work week = weekdays × 8 h{s.days_off ? `, minus ${s.days_off} day${s.days_off === 1 ? '' : 's'} marked off` : ''}.
            {s.excluded_count > 0 && <> {s.excluded_count} excluded ({hours(s.excluded_minutes)}).</>}
          </p>
          {s.weekly.length > 1 && <WeeklyHoursChart weeks={s.weekly} rangeFrom={range.from} />}
          {s.often_passive.length > 0 && (
            <OftenPassiveList items={s.often_passive} onOpen={o => setDetail({ type: 'meeting', id: o.latest_meeting_id, title: o.title })} />
          )}
        </>
      )}

      {data && (
        <>
          <section className="mb-6">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              Outcomes
              {data.outcomes.length > 0 && (
                <span className="normal-case tracking-normal font-normal ml-2">
                  {data.open_tasks} open · {data.done_tasks} done
                </span>
              )}
            </h2>
            {data.outcomes.length === 0 ? (
              <p className="text-sm text-muted-foreground/50 py-4">No tasks are linked to meetings in this date range.</p>
            ) : (
              <div className="divide-y divide-border/60 rounded-lg border border-border bg-card">
                {data.outcomes.map(t => (
                  <div key={t.id} className="px-3 py-2">
                    <TaskLine t={t} onOpen={() => setDetail({ type: 'task', id: t.id, title: t.action })} />
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 ml-1 text-xs text-muted-foreground">
                      <span className="text-muted-foreground/60">from</span>
                      {t.meetings.map(m => (
                        <button
                          key={m.id}
                          onClick={() => setDetail({ type: 'meeting', id: m.id, title: m.title })}
                          className="hover:text-foreground hover:underline text-left"
                        >
                          📅 {m.title} · {when(m)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Digest ({shownDigest.length})
                {emptyCount > 0 && !showEmpty && (
                  <span className="normal-case tracking-normal font-normal ml-2">{emptyCount} empty hidden</span>
                )}
              </h2>
              {emptyCount > 0 && (
                <button
                  onClick={() => setShowEmpty(v => !v)}
                  aria-pressed={showEmpty}
                  title={showEmpty ? 'Hide meetings with nothing attached' : 'Show meetings with nothing attached'}
                  className={cn(
                    'ml-auto flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border transition-colors',
                    showEmpty
                      ? 'border-primary text-primary bg-primary/10'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  {showEmpty ? <Eye size={12} /> : <EyeOff size={12} />}
                  Empty meetings ({emptyCount})
                </button>
              )}
            </div>
            {data.digest.length === 0 ? (
              <p className="text-sm text-muted-foreground/50 py-4">No meetings in this date range.</p>
            ) : shownDigest.length === 0 ? (
              <p className="text-sm text-muted-foreground/50 py-4">
                All {data.digest.length} meetings in this range have no notes, tasks, links or files.
              </p>
            ) : (
              <div className="space-y-2">
                {shownDigest.map(m => isEmpty(m) ? (
                  <div key={m.id} className="group flex flex-wrap items-center gap-x-2 px-3 py-0.5">
                    <span className="text-xs text-muted-foreground tabular-nums">{when(m)}</span>
                    <button
                      onClick={() => setDetail({ type: 'meeting', id: m.id, title: m.title })}
                      className="text-sm text-muted-foreground hover:text-foreground hover:underline text-left"
                    >
                      {m.title}
                    </button>
                    <RefBadge kind="meeting" number={m.number} />
                    {m.duration_minutes ? (
                      <span className={cn('text-xs text-muted-foreground/60', m.exclude_from_stats && 'line-through')}>{m.duration_minutes}m</span>
                    ) : null}
                    {m.passive && <PassiveBadge />}
                    {m.exclude_from_stats && <ExcludedBadge />}
                  </div>
                ) : (
                  <DigestCard
                    key={m.id}
                    m={m}
                    when={when(m)}
                    open={expanded.has(m.id)}
                    onToggle={() => toggle(m.id)}
                    onOpen={() => setDetail({ type: 'meeting', id: m.id, title: m.title })}
                    onOpenTask={t => setDetail({ type: 'task', id: t.id, title: t.action })}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <ItemDetailDialog result={detail} onClose={() => setDetail(null)} />
    </div>
  )
}

/** A task's state, impact flag and title (the title opens its detail). */
function TaskLine({ t, onOpen }: { t: TaskBrief; onOpen: () => void }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={cn('text-xs border rounded-full px-2 h-5 flex items-center font-medium shrink-0', STATE_COLORS[t.state])}>
        {STATE_LABELS[t.state]}
      </span>
      {t.high_impact && <Zap size={13} className="text-yellow-400 shrink-0" />}
      <button onClick={onOpen} className="text-foreground hover:underline text-left">{t.action}</button>
      <RefBadge kind="task" number={t.number} />
    </div>
  )
}

function DigestCard({ m, when, open, onToggle, onOpen, onOpenTask }: {
  m: MeetingDigestEntry; when: string; open: boolean; onToggle: () => void; onOpen: () => void
  onOpenTask: (t: TaskBrief) => void
}) {
  const hasItems = m.tasks.length > 0 || m.links.length > 0 || m.attachments.length > 0
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs text-muted-foreground tabular-nums">{when}</span>
        <button onClick={onOpen} className="text-sm font-medium text-foreground hover:underline text-left">
          {m.title}
        </button>
        <RefBadge kind="meeting" number={m.number} />
        {m.duration_minutes ? (
          <span className={cn('text-xs text-muted-foreground', m.exclude_from_stats && 'line-through opacity-60')}>{m.duration_minutes}m</span>
        ) : null}
        {m.passive && <PassiveBadge className="self-center" />}
        {m.exclude_from_stats && <ExcludedBadge className="self-center" />}
      </div>
      {m.notes ? (
        <div className="prose-worklog max-w-none mt-1.5 text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlightTodo]} components={markdownLinks}>
            {open ? m.notes : m.preview}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/50 italic mt-1">No notes</p>
      )}
      {m.has_more && (
        <button onClick={onToggle} className="text-xs text-primary hover:text-primary/80 mt-1">
          {open ? 'Show less' : 'Show full notes'}
        </button>
      )}
      {hasItems && (
        <div className="mt-2 pt-2 border-t border-border/60 space-y-1">
          {m.tasks.map(t => <TaskLine key={t.id} t={t} onOpen={() => onOpenTask(t)} />)}
          <LinkedItems links={m.links} attachments={m.attachments} />
        </div>
      )}
    </div>
  )
}

/** Recurring meetings (same title) you were passive in at least twice: candidates to skip. */
function OftenPassiveList({ items, onOpen }: { items: MeetingStats['often_passive']; onOpen: (o: MeetingStats['often_passive'][number]) => void }) {
  return (
    <section className="mb-6">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
        Often passive
        <span className="normal-case tracking-normal font-normal ml-2">recurring meetings you mostly worked through</span>
      </h2>
      <div className="divide-y divide-border/60 rounded-lg border border-border bg-card">
        {items.map(o => (
          <div key={o.latest_meeting_id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
            <button onClick={() => onOpen(o)} className="text-foreground hover:underline text-left" title="Open the most recent one">
              {o.title}
            </button>
            <RefBadge kind="meeting" number={o.latest_number} />
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">passive {o.passive} of {o.total}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

type Week = MeetingStats['weekly'][number]

/**
 * Hours in meetings per week. With no passive meetings it is one series (no legend); otherwise each bar stacks
 * engaged (primary, at the baseline) under passive (muted tint), split by a 2px surface gap, with a legend.
 * Each bar is focusable and labeled, with a hover/focus tooltip.
 */
function WeeklyHoursChart({ weeks, rangeFrom }: { weeks: Week[]; rangeFrom: string }) {
  // A range that starts mid-week makes the first week partial: label it by the range start instead.
  const label = (weekStart: string) => formatMonthDay(weekStart < rangeFrom ? rangeFrom : weekStart)
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(...weeks.map(w => w.minutes), 1)
  const maxIndex = weeks.findIndex(w => w.minutes === max)
  const labelEvery = weeks.length > 8 ? 2 : 1
  const split = weeks.some(w => w.passive_minutes > 0)
  const PLOT = 96
  const describe = (w: Week) => split && w.passive_minutes
    ? `${hours(w.minutes)} (${hours(w.minutes - w.passive_minutes)} engaged, ${hours(w.passive_minutes)} passive)`
    : hours(w.minutes)

  return (
    <figure className="mb-6">
      <figcaption className="flex items-center gap-4 mb-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Hours per week</span>
        {split && (
          <span className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary" /> Engaged</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-chart-passive" /> Passive</span>
          </span>
        )}
      </figcaption>
      <div className="relative">
        <div className="flex items-end gap-1 border-b border-border" style={{ height: PLOT + 18 }} role="group" aria-label="Hours in meetings per week">
          {weeks.map((w, i) => {
            const total = Math.max(Math.round((w.minutes / max) * PLOT), w.minutes > 0 ? 2 : 0)
            const passive = w.passive_minutes ? Math.max(Math.round((w.passive_minutes / max) * PLOT), 2) : 0
            const engaged = w.minutes - w.passive_minutes > 0 ? Math.max(total - passive, 2) : 0
            return (
              <div
                key={w.week_start}
                tabIndex={0}
                aria-label={`Week of ${label(w.week_start)}: ${describe(w)}`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(a => (a === i ? null : a))}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(a => (a === i ? null : a))}
                className="relative flex-1 flex flex-col items-center justify-end h-full outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
              >
                {i === maxIndex && w.minutes > 0 && (
                  <span className="text-[11px] text-muted-foreground tabular-nums mb-0.5" aria-hidden>{hours(w.minutes)}</span>
                )}
                <div className={cn('w-full max-w-6 flex flex-col gap-[2px] transition-opacity', active !== null && active !== i && 'opacity-60')}>
                  {passive > 0 && <div className="rounded-t bg-chart-passive" style={{ height: passive }} />}
                  {engaged > 0 && <div className={cn('bg-primary', !passive && 'rounded-t')} style={{ height: engaged }} />}
                </div>
                {active === i && (
                  <div className="absolute bottom-full mb-1 z-10 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-sm" aria-hidden>
                    <span className="font-semibold text-foreground tabular-nums">{hours(w.minutes)}</span>
                    {split && w.passive_minutes > 0 && (
                      <span className="text-muted-foreground tabular-nums"> ({hours(w.minutes - w.passive_minutes)} engaged, {hours(w.passive_minutes)} passive)</span>
                    )}
                    <span className="text-muted-foreground"> · week of {label(w.week_start)}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="flex gap-1 mt-1" aria-hidden>
          {weeks.map((w, i) => (
            <span key={w.week_start} className="flex-1 text-center text-[11px] text-muted-foreground tabular-nums">
              {i % labelEvery === 0 ? label(w.week_start) : ''}
            </span>
          ))}
        </div>
      </div>
    </figure>
  )
}
