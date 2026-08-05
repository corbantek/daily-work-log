import { useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import type { TaskState } from '../api/types'
import { cn } from '@/lib/utils'

const STATES: { value: TaskState; label: string; color: string }[] = [
  { value: 'todo',        label: 'TODO',        color: 'text-red-400 border-red-500/40' },
  { value: 'in_progress', label: 'IN PROGRESS', color: 'text-blue-400 border-blue-500/40' },
  { value: 'complete',    label: 'DONE',        color: 'text-green-400 border-green-500/40' },
]

function stateInfo(v: string) {
  return STATES.find(s => s.value === v) ?? STATES[0]
}

interface Props {
  value: TaskState
  onChange: (v: TaskState) => void
  size?: 'sm' | 'default'
}

export function StateDropdown({ value, onChange, size = 'sm' }: Props) {
  const [open, setOpen] = useState(false)
  const current = stateInfo(value)
  const h = size === 'sm' ? 'h-6' : 'h-8'

  return (
    <div className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={cn(h, 'text-xs border rounded-full px-2.5 font-medium flex items-center gap-1 bg-transparent transition-colors', current.color)}
      >
        {current.label}
        <ChevronDown size={11} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-7 z-50 bg-popover border border-border rounded-lg shadow-xl p-1 min-w-28">
            {STATES.map(s => (
              <button
                key={s.value}
                type="button"
                onClick={() => { onChange(s.value); setOpen(false) }}
                className={cn(
                  'flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-left text-xs font-medium transition-colors',
                  s.value === value ? 'bg-accent' : 'hover:bg-accent',
                  s.color,
                )}
              >
                {s.value === value && <Check size={11} />}
                {s.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
