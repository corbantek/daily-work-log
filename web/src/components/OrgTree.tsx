import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, UserPlus, ArrowUpToLine, Users } from 'lucide-react'
import type { InheritedValue, OrgNode } from '../api/types'
import { cn } from '@/lib/utils'
import { RefBadge } from './RefBadge'

const COLLAPSED_KEY = 'worklog-org-collapsed'

/** An effective team/focus value: muted italic with "inherited from X" when it came from a manager. */
export function InheritedText({ v, className }: { v: InheritedValue; className?: string }) {
  if (!v.value) return null
  return (
    <span
      className={cn(v.from_name && 'italic text-muted-foreground/70', className)}
      title={v.from_name ? `Inherited from ${v.from_name}` : undefined}
    >
      {v.value}
    </span>
  )
}

function matches(n: OrgNode, term: string): boolean {
  return [n.name, n.role, n.effective_team.value, n.effective_focus.value]
    .some(x => (x ?? '').toLowerCase().includes(term))
}

/** The forest with only matching people and their managers (so each match keeps its place). */
function filterTree(nodes: OrgNode[], term: string): OrgNode[] {
  const out: OrgNode[] = []
  for (const n of nodes) {
    const kids = filterTree(n.reports, term)
    if (kids.length > 0 || matches(n, term)) out.push({ ...n, reports: kids })
  }
  return out
}

interface Props {
  tree: OrgNode[]
  filter: string
  onOpen: (id: string) => void
  onAddReport: (managerId: string) => void
  onAddManager: (personId: string) => void
}

export function OrgTree({ tree, filter, onOpen, onAddReport, onAddManager }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')) } catch { return new Set() }
  })
  useEffect(() => { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])) }, [collapsed])

  const term = filter.trim().toLowerCase()
  const shown = useMemo(() => term ? filterTree(tree, term) : tree, [tree, term])
  // People with neither a manager nor reports aren't part of any tree yet.
  const trees = shown.filter(n => n.reports.length > 0)
  const unplaced = shown.filter(n => n.reports.length === 0)

  function toggle(id: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function allIds(nodes: OrgNode[]): string[] {
    return nodes.flatMap(n => n.reports.length ? [n.id, ...allIds(n.reports)] : [])
  }

  function row(n: OrgNode, depth: number): React.ReactNode {
    const hasKids = n.reports.length > 0
    const open = hasKids && (!!term || !collapsed.has(n.id))
    return (
      <div key={n.id}>
        <div
          className={cn(
            'group flex items-center gap-1.5 py-1 pr-2 rounded-md hover:bg-accent/40 transition-colors',
            n.archived && 'opacity-50',
          )}
          style={{ paddingLeft: `${depth * 20 + 4}px` }}
        >
          {hasKids ? (
            <button onClick={() => toggle(n.id)} className="text-muted-foreground hover:text-foreground p-0.5 shrink-0"
              aria-label={open ? 'Collapse' : 'Expand'}>
              <ChevronRight size={13} className={cn('transition-transform', open && 'rotate-90')} />
            </button>
          ) : <span className="w-[17px] shrink-0" />}
          <button
            onClick={() => onOpen(n.id)}
            className={cn(
              'text-sm text-foreground hover:text-primary hover:underline underline-offset-2 truncate text-left',
              n.is_placeholder && 'italic text-muted-foreground',
              term && matches(n, term) && 'font-medium',
            )}
          >
            {n.name}
          </button>
          <RefBadge kind="person" number={n.number} />
          {n.role && <span className="text-xs text-muted-foreground truncate">{n.role}</span>}
          {n.effective_team.value && (
            <span className="text-xs px-1.5 rounded-full border border-border shrink-0 max-w-48 truncate">
              <InheritedText v={n.effective_team} />
            </span>
          )}
          {n.effective_focus.value && (
            <span className="text-xs text-muted-foreground/70 truncate min-w-0">
              — <InheritedText v={n.effective_focus} />
            </span>
          )}
          {hasKids && (
            <span className="text-xs text-muted-foreground/50 flex items-center gap-0.5 shrink-0"
              title={`${n.report_count} ${n.report_count === 1 ? 'person' : 'people'} below`}>
              <Users size={11} /> {n.report_count}
            </span>
          )}
          {n.archived && <span className="text-xs text-muted-foreground shrink-0">archived</span>}
          <div className="flex-1" />
          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <button onClick={() => onAddReport(n.id)} title={`Add someone who reports to ${n.name}`}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-accent">
              <UserPlus size={11} /> report
            </button>
            <button onClick={() => onAddManager(n.id)} title={`Add ${n.name}'s manager`}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-accent">
              <ArrowUpToLine size={11} /> manager
            </button>
          </div>
        </div>
        {open && (
          <div className="relative">
            <div className="absolute top-0 bottom-1 border-l border-border/60" style={{ left: `${depth * 20 + 12}px` }} />
            {n.reports.map(c => row(c, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  if (shown.length === 0) {
    return (
      <p className="text-sm text-muted-foreground/50 text-center py-12">
        {term ? 'Nobody matches.' : 'No people yet.'}
      </p>
    )
  }

  return (
    <div className="space-y-5">
      {trees.length > 0 && (
        <div>
          {!term && (
            <div className="flex justify-end gap-2 mb-1">
              <button onClick={() => setCollapsed(new Set())} className="text-xs text-muted-foreground hover:text-foreground">
                Expand all
              </button>
              <button onClick={() => setCollapsed(new Set(allIds(tree)))} className="text-xs text-muted-foreground hover:text-foreground">
                Collapse all
              </button>
            </div>
          )}
          <div className="rounded-lg border border-border bg-card/50 p-2 space-y-1">
            {trees.map(n => row(n, 0))}
          </div>
        </div>
      )}
      {unplaced.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5" title="No manager and no reports yet: use “manager” or “report” to place them">
            Unplaced ({unplaced.length})
          </p>
          <div className="rounded-lg border border-dashed border-border p-2">
            {unplaced.map(n => row(n, 0))}
          </div>
        </div>
      )}
    </div>
  )
}
