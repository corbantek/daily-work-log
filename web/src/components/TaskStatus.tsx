import { useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** Days since an ISO timestamp (the server stores UTC without a zone). */
function daysSince(iso: string): number {
  const then = new Date(iso.endsWith('Z') ? iso : iso + 'Z').getTime()
  return Math.floor((Date.now() - then) / 86_400_000)
}

/** "set 9 days ago" for a status that has been sitting for over a week, else null. */
export function staleNote(updatedAt: string | null): string | null {
  if (!updatedAt) return null
  const days = daysSince(updatedAt)
  return days >= 7 ? `set ${days} days ago` : null
}

/** Read-only status line (Review views, the detail dialog). */
export function StatusText({ status, className }: { status: string | null; className?: string }) {
  if (!status) return null
  return (
    <p className={cn('text-sm text-foreground', className)}>
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground mr-2">Status</span>
      {status}
    </p>
  )
}

interface Props {
  status: string | null
  updatedAt: string | null
  onSave: (status: string | null) => Promise<void>
  /** Muted for finished tasks, where "stale" is expected. */
  done?: boolean
}

/** The one-line status above a task's notes. Click to edit; Enter or leaving the field saves, Esc cancels. */
export function TaskStatus({ status, updatedAt, onSave, done }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const cancelled = useRef(false)

  function start() {
    cancelled.current = false
    setDraft(status ?? '')
    setEditing(true)
  }

  async function finish() {
    if (cancelled.current) return
    setEditing(false)
    const next = draft.trim() || null
    if (next !== (status?.trim() || null)) await onSave(next)
  }

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={e => setDraft((e.target as HTMLInputElement).value)}
        onBlur={finish}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() }
          if (e.key === 'Escape') { cancelled.current = true; setEditing(false) }
        }}
        className="h-8 text-sm"
        placeholder="Where does this stand right now? (one line)"
      />
    )
  }

  const stale = done ? null : staleNote(updatedAt)
  return (
    <button
      type="button"
      onClick={start}
      className={cn('block w-full text-left text-sm rounded px-1 -mx-1 hover:bg-muted/50 transition-colors',
        status ? 'text-foreground' : 'text-muted-foreground/60 italic')}
      title="Click to edit the status"
    >
      {status ? (
        <>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground mr-2">Status</span>
          {status}
          {stale && <span className="text-xs text-muted-foreground/70 ml-2">({stale})</span>}
        </>
      ) : 'Add a status…'}
    </button>
  )
}
