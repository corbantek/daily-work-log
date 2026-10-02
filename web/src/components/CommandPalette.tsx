import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, CheckSquare, Calendar, User, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SearchResult, SearchResultType } from '../api/types'
import { search as searchApi } from '../api/client'

const TYPE_META: Record<SearchResultType, { icon: typeof User; label: string }> = {
  task: { icon: CheckSquare, label: 'Tasks' },
  meeting: { icon: Calendar, label: 'Meetings' },
  person: { icon: User, label: 'People' },
  interaction: { icon: MessageSquare, label: 'Interactions' },
}

const TYPE_ORDER: SearchResultType[] = ['task', 'meeting', 'person', 'interaction']

interface Props {
  open: boolean
  onClose: () => void
  onNavigate: (r: SearchResult) => void
}

export function CommandPalette({ open, onClose, onNavigate }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setSelected(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const runSearch = useCallback((q: string) => {
    if (!q.trim()) { setResults([]); return }
    searchApi(q).then(r => { setResults(r); setSelected(0) }).catch(() => setResults([]))
  }, [])

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => runSearch(query), 120)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [query, runSearch])

  // Ordered flat list (grouped by type) for keyboard navigation.
  const ordered = TYPE_ORDER.flatMap(t => results.filter(r => r.type === t))

  function choose(r: SearchResult) {
    onNavigate(r)
    onClose()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, ordered.length - 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); return }
    if (e.key === 'Enter') { e.preventDefault(); if (ordered[selected]) choose(ordered[selected]); return }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4" onClick={onClose}>
      <div
        className="w-full max-w-xl bg-popover border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 border-b border-border">
          <Search size={16} className="text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search tasks, meetings, people, interactions…"
            className="flex-1 bg-transparent py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          <kbd className="text-xs text-muted-foreground/50 border border-border rounded px-1.5 py-0.5">esc</kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto thin-scrollbar py-1">
          {query.trim() && ordered.length === 0 && (
            <p className="text-sm text-muted-foreground/50 text-center py-8">No results for "{query}"</p>
          )}
          {!query.trim() && (
            <p className="text-sm text-muted-foreground/40 text-center py-8">Type to search across everything.</p>
          )}
          {TYPE_ORDER.map(type => {
            const group = results.filter(r => r.type === type)
            if (group.length === 0) return null
            const Meta = TYPE_META[type]
            return (
              <div key={type} className="mb-1">
                <div className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground/50">{Meta.label}</div>
                {group.map(r => {
                  const idx = ordered.indexOf(r)
                  const Icon = Meta.icon
                  return (
                    <button
                      key={`${r.type}-${r.id}`}
                      onClick={() => choose(r)}
                      onMouseEnter={() => setSelected(idx)}
                      className={cn(
                        'flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors',
                        idx === selected ? 'bg-accent' : 'hover:bg-accent/50'
                      )}
                    >
                      <Icon size={14} className="text-muted-foreground shrink-0" />
                      <span className="flex-1 text-sm text-foreground truncate">{r.title}</span>
                      {r.subtitle && <span className="text-xs text-muted-foreground/60 shrink-0 max-w-40 truncate">{r.subtitle}</span>}
                      {r.date && <span className="text-xs text-muted-foreground/40 font-mono shrink-0">{r.date}</span>}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
