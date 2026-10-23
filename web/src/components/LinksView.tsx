import { useCallback, useEffect, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import type { LinkInsight, LinkType } from '../api/types'
import { attachmentOpenUrl, getLinkInsights } from '../api/client'
import { formatMonthDay, rangeForPreset, type DateRange } from '../api/date'
import { DateRangePicker } from './DateRangePicker'
import { ItemDetailDialog, type DetailTarget } from './ItemDetailDialog'
import { LINK_ICONS, LINK_TYPE_OPTIONS } from './LinkSection'
import { useOnActivate } from '@/lib/use-on-activate'
import { RefLabel } from './RefBadge'

type TypeFilter = 'all' | LinkType | 'file'

const typeLabel = (t: LinkInsight['link_type']) =>
  t === 'file' ? 'Files' : LINK_TYPE_OPTIONS.find(o => o.value === t)?.label ?? t
const typeIcon = (t: LinkInsight['link_type']) => (t === 'file' ? '📎' : LINK_ICONS[t] ?? '🔗')

/** Review → Links: every link and file on tasks and meetings dated in the range. */
export function LinksView({ theme, active = true }: {
  theme?: 'light' | 'dim' | 'dark'
  /** False while hidden behind another view; the data reloads when it turns true again. */
  active?: boolean
}) {
  const [range, setRange] = useState<DateRange>(() => rangeForPreset('this_week'))
  const [links, setLinks] = useState<LinkInsight[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [type, setType] = useState<TypeFilter>('all')
  const [detail, setDetail] = useState<DetailTarget | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    getLinkInsights(range.from, range.to).then(setLinks).finally(() => setLoading(false))
  }, [range.from, range.to])

  useEffect(() => { load() }, [load])
  useOnActivate(active, load)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return links.filter(l =>
      (type === 'all' || l.link_type === type) &&
      (!q || [l.label, l.url, ...l.sources.map(s => s.title)].some(v => v?.toLowerCase().includes(q))),
    )
  }, [links, query, type])

  // One section per type, in the type dropdown's order with files last; oldest-first order is kept inside each.
  const sections = useMemo(() => {
    const order: LinkInsight['link_type'][] = [...LINK_TYPE_OPTIONS.map(o => o.value), 'file']
    for (const l of shown) if (!order.includes(l.link_type)) order.push(l.link_type)
    return order
      .map(type => ({ type, label: typeLabel(type), items: shown.filter(l => l.link_type === type) }))
      .filter(sec => sec.items.length > 0)
  }, [shown])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-5 p-3 rounded-lg border border-border bg-card/50">
        <DateRangePicker value={range} onChange={setRange} theme={theme} />
        <div className="flex-1" />
        <Input
          value={query}
          onChange={e => setQuery((e.target as HTMLInputElement).value)}
          placeholder="Search links…"
          className="h-8 text-xs w-48"
        />
        <select
          value={type}
          onChange={e => setType(e.target.value as TypeFilter)}
          className="h-8 text-xs px-2 rounded-md border border-border bg-card text-foreground focus:outline-none focus:border-ring"
          aria-label="Link type"
        >
          <option value="all">All types</option>
          {LINK_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          <option value="file">Files</option>
        </select>
      </div>

      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
        Links ({shown.length}{shown.length !== links.length ? ` of ${links.length}` : ''})
        {loading && <span className="normal-case tracking-normal font-normal ml-2">Loading…</span>}
      </p>

      {!loading && shown.length === 0 && (
        <p className="text-sm text-muted-foreground/50 text-center py-12">
          {links.length === 0 ? 'No links or files on tasks or meetings in this date range.' : 'Nothing matches the filter.'}
        </p>
      )}

      {sections.map(section => (
        <section key={section.type} className="mb-5">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
            <span className="normal-case tracking-normal" aria-hidden>{typeIcon(section.type)}</span>
            {section.label} ({section.items.length})
          </h3>
          <div className="divide-y divide-border/60 rounded-lg border border-border bg-card">
            {section.items.map(l => {
              const href = l.kind === 'file' && l.attachment ? attachmentOpenUrl(l.attachment) : l.url ?? '#'
              const opensFile = l.kind === 'file' && l.attachment?.kind === 'other'
              return (
                <div key={l.key} className="flex items-start gap-3 px-3 py-2 text-xs">
                  <div className="flex-1 min-w-0">
                    <a
                      href={href}
                      {...(opensFile ? { download: l.attachment!.filename } : { target: '_blank', rel: 'noopener noreferrer' })}
                      className="text-sm text-primary hover:text-primary/80 break-words transition-colors"
                      title={l.url ?? l.label ?? undefined}
                    >
                      {l.label || l.url}
                    </a>
                    {l.label && l.url && <p className="text-muted-foreground/60 truncate">{l.url}</p>}
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5 text-muted-foreground">
                      {l.sources.map(s => (
                        <button
                          key={`${s.type}:${s.id}`}
                          onClick={() => setDetail({ type: s.type, id: s.id, title: s.title })}
                          className="hover:text-foreground hover:underline text-left"
                          title={`Open ${s.type}`}
                        >
                          {s.type === 'meeting' ? '📅' : '✓'} {s.title}
                          <RefLabel kind={s.type} number={s.number} className="ml-1" />
                        </button>
                      ))}
                    </div>
                  </div>
                  <span className="text-muted-foreground shrink-0 w-28 text-right tabular-nums">
                    {l.first_date === l.last_date
                      ? formatMonthDay(l.last_date)
                      : `${formatMonthDay(l.first_date)} – ${formatMonthDay(l.last_date)}`}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      ))}

      <ItemDetailDialog result={detail} onClose={() => setDetail(null)} />
    </div>
  )
}
