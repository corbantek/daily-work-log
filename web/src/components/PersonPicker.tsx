import { useMemo, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import type { Person } from '../api/types'
import { cn } from '@/lib/utils'

/** `id` and everyone below them: the people `id` can't report to (it would make a loop). */
export function selfAndBelow(people: Person[], id: string): Set<string> {
  const out = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const p of people) {
      if (p.manager_id && out.has(p.manager_id) && !out.has(p.id)) { out.add(p.id); grew = true }
    }
  }
  return out
}

interface Props {
  people: Person[]
  value: string | null
  onChange: (id: string | null) => void
  /** Hide this person and everyone below them. */
  excludeTreeOf?: string
  noneLabel?: string
  className?: string
}

/** Searchable person dropdown (custom, like WorkstreamPicker), used for "Reports to". */
export function PersonPicker({ people, value, onChange, excludeTreeOf, noneLabel = 'No manager', className }: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const excluded = useMemo(
    () => excludeTreeOf ? selfAndBelow(people, excludeTreeOf) : new Set<string>(),
    [people, excludeTreeOf],
  )
  const current = people.find(p => p.id === value)
  const term = q.trim().toLowerCase()
  const options = people
    .filter(p => !excluded.has(p.id) && (p.archived_at === null || p.id === value))
    .filter(p => !term || p.name.toLowerCase().includes(term)
      || (p.effective_team.value ?? '').toLowerCase().includes(term))
    .sort((a, b) => a.name.localeCompare(b.name))

  function pick(id: string | null) {
    onChange(id)
    setOpen(false)
    setQ('')
  }

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="h-7 text-xs border border-border rounded-md px-2 flex items-center gap-1.5 bg-transparent text-foreground hover:bg-accent transition-colors min-w-36 max-w-60"
      >
        <span className={cn('flex-1 text-left truncate', !current && 'text-muted-foreground')}>
          {current ? current.name : noneLabel}
        </span>
        <ChevronDown size={12} className="text-muted-foreground shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => { setOpen(false); setQ('') }} />
          <div className="absolute left-0 top-8 z-50 bg-popover border border-border rounded-lg shadow-xl p-1 w-64">
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { setOpen(false); setQ('') }
                if (e.key === 'Enter' && options.length > 0) pick(options[0].id)
              }}
              placeholder="Search people or team…"
              className="w-full h-7 mb-1 px-2 text-xs rounded border border-border bg-transparent text-foreground focus:outline-none focus:border-ring"
            />
            <div className="max-h-56 overflow-y-auto">
              {!term && (
                <button
                  type="button"
                  onClick={() => pick(null)}
                  className={cn(
                    'flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-left text-xs transition-colors text-muted-foreground',
                    value === null ? 'bg-accent' : 'hover:bg-accent',
                  )}
                >
                  {value === null && <Check size={11} />}
                  {noneLabel}
                </button>
              )}
              {options.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pick(p.id)}
                  className={cn(
                    'flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-left text-xs transition-colors',
                    p.id === value ? 'bg-accent text-accent-foreground' : 'hover:bg-accent text-foreground',
                  )}
                >
                  {p.id === value && <Check size={11} className="shrink-0" />}
                  <span className={cn('truncate', p.is_placeholder && 'italic text-muted-foreground')}>{p.name}</span>
                  {p.effective_team.value && (
                    <span className="ml-auto text-muted-foreground/60 truncate max-w-28">{p.effective_team.value}</span>
                  )}
                </button>
              ))}
              {options.length === 0 && term && (
                <p className="px-2.5 py-1.5 text-xs text-muted-foreground/60">No match</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
