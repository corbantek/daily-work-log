import { useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import type { Workstream } from '../api/types'
import { cn } from '@/lib/utils'

interface Props {
  value: string
  workstreams: Workstream[]
  onChange: (v: string) => void
}

export function WorkstreamPicker({ value, workstreams, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const displayName = value === '__none__'
    ? 'Unassigned'
    : (workstreams.find(w => w.id === value)?.name ?? 'Unassigned')
  const options = [{ id: '__none__', name: 'Unassigned' }, ...workstreams.map(w => ({ id: w.id, name: w.name }))]

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="h-8 text-xs border border-border rounded-lg px-2.5 flex items-center gap-1.5 bg-transparent text-foreground hover:bg-accent transition-colors min-w-36"
      >
        <span className="flex-1 text-left truncate">{displayName}</span>
        <ChevronDown size={12} className="text-muted-foreground" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-9 z-50 bg-popover border border-border rounded-lg shadow-xl p-1 min-w-40 max-h-48 overflow-y-auto">
            {options.map(o => (
              <button
                key={o.id}
                type="button"
                onClick={() => { onChange(o.id); setOpen(false) }}
                className={cn(
                  'flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-left text-xs transition-colors',
                  o.id === value ? 'bg-accent text-accent-foreground' : 'hover:bg-accent text-foreground',
                )}
              >
                {o.id === value && <Check size={11} />}
                {o.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
