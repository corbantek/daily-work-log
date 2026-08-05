import { useState, useEffect, useRef } from 'react'
import { Tag, X, Plus } from 'lucide-react'
import type { Label } from '../api/types'
import { getLabels, createLabel } from '../api/client'

const DEFAULT_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#0ea5e9',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#78716c', '#64748b',
]

function pickColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return DEFAULT_COLORS[Math.abs(hash) % DEFAULT_COLORS.length]
}

interface Props {
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

export function LabelPicker({ selectedIds, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [labels, setLabels] = useState<Label[]>([])
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getLabels().then(setLabels)
  }, [])

  const selected = labels.filter(l => selectedIds.includes(l.id))
  const filtered = labels.filter(l =>
    !selectedIds.includes(l.id) &&
    l.name.toLowerCase().includes(query.toLowerCase())
  )
  const exactMatch = labels.some(l => l.name.toLowerCase() === query.trim().toLowerCase())
  const showCreate = query.trim().length > 0 && !exactMatch

  function toggle(id: string) {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter(x => x !== id)
        : [...selectedIds, id]
    )
  }

  function remove(id: string) {
    onChange(selectedIds.filter(x => x !== id))
  }

  async function handleCreate() {
    const name = query.trim()
    if (!name) return
    const label = await createLabel({ name, color: pickColor(name) })
    setLabels(prev => [...prev, label])
    onChange([...selectedIds, label.id])
    setQuery('')
  }

  async function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (showCreate) {
        await handleCreate()
      } else if (filtered.length === 1) {
        toggle(filtered[0].id)
        setQuery('')
      }
    }
    if (e.key === 'Backspace' && query === '' && selectedIds.length > 0) {
      remove(selectedIds[selectedIds.length - 1])
    }
    if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative">
      {/* Trigger area */}
      <div
        className="flex flex-wrap items-center gap-1 min-h-8 border border-border rounded-lg px-2 py-1 cursor-text bg-transparent hover:bg-accent/30 transition-colors min-w-32"
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0) }}
      >
        {selected.length === 0 && !open && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Tag size={12} /> Labels
          </span>
        )}
        {selected.map(l => (
          <span
            key={l.id}
            className="flex items-center gap-1 text-xs pl-1.5 pr-1 py-0.5 rounded-full"
            style={{ backgroundColor: l.color + '33', color: l.color }}
          >
            {l.name}
            <button
              type="button"
              onClick={e => { e.stopPropagation(); remove(l.id) }}
              className="hover:opacity-70"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        {open && (
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 min-w-16 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
            placeholder="Type to search or create…"
          />
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => { setOpen(false); setQuery('') }} />
          <div className="absolute left-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-xl p-1 min-w-44 max-h-48 overflow-y-auto">
            {filtered.map(label => (
              <button
                key={label.id}
                type="button"
                onClick={() => { toggle(label.id); setQuery('') }}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded hover:bg-accent text-left"
              >
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: label.color }} />
                <span className="text-xs flex-1" style={{ color: label.color }}>{label.name}</span>
              </button>
            ))}

            {showCreate && (
              <button
                type="button"
                onClick={handleCreate}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded hover:bg-accent text-left text-xs text-primary"
              >
                <Plus size={12} />
                Create "{query.trim()}"
              </button>
            )}

            {filtered.length === 0 && !showCreate && (
              <p className="text-xs text-muted-foreground/50 px-2.5 py-2 text-center">
                {labels.length === 0 ? 'Type to create a label' : 'No matches'}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
