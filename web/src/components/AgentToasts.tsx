import { useEffect, useRef, useState } from 'react'
import { Bot, X } from 'lucide-react'
import type { DetailTarget } from './ItemDetailDialog'

interface Activity {
  id: string
  action: string
  entity_type: 'task' | 'meeting'
  entity_id: string
  summary: string
}

const SHOW_MS = 7000
const MAX_VISIBLE = 3

/**
 * Brief "Agent: …" notices for changes the AI agent makes while the page is open. `latest` is the
 * newest agent activity id from GET /changes; nothing that existed when the page opened is shown.
 */
export function AgentToasts({ latest, onOpen }: { latest: string | null; onOpen: (t: DetailTarget) => void }) {
  const [toasts, setToasts] = useState<(Activity & { until: number })[]>([])
  const seen = useRef<string | null | undefined>(undefined)  // undefined = not initialised yet

  // Baseline: the newest agent change that already existed when the page opened (never toasted).
  // Read from the log itself, since the API's in-memory marker starts empty after a restart.
  useEffect(() => {
    fetch('/api/agent/activity?limit=1')
      .then(r => (r.ok ? r.json() : []))
      .then((rows: Activity[]) => { if (seen.current === undefined) seen.current = rows[0]?.id ?? null })
      .catch(() => { if (seen.current === undefined) seen.current = null })
  }, [])

  useEffect(() => {
    if (seen.current === undefined) return  // baseline not known yet
    if (!latest || latest === seen.current) return
    const since = seen.current
    seen.current = latest
    fetch('/api/agent/activity?limit=20')
      .then(r => (r.ok ? r.json() : []))
      .then((rows: Activity[]) => {
        // Everything newer than the baseline (the list is newest first). If the baseline scrolled
        // out of the last 20, show just the newest few; with no history at all, all of them are new.
        const cut = since ? rows.findIndex(r => r.id === since) : rows.length
        const fresh = (cut === -1 ? rows.slice(0, MAX_VISIBLE) : rows.slice(0, cut)).slice(0, MAX_VISIBLE).reverse()  // oldest first
        const until = Date.now() + SHOW_MS  // each notice gets its own SHOW_MS from when it appears
        if (fresh.length) setToasts(prev => [...prev, ...fresh.map(f => ({ ...f, until }))].slice(-MAX_VISIBLE))
      })
      .catch(() => {})
  }, [latest])

  useEffect(() => {
    if (!toasts.length) return
    const next = Math.min(...toasts.map(t => t.until))
    const timer = setTimeout(() => setToasts(prev => prev.filter(t => t.until > Date.now())), Math.max(0, next - Date.now()) + 50)
    return () => clearTimeout(timer)
  }, [toasts])

  if (!toasts.length) return null
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className="flex items-start gap-2 rounded-lg border border-border bg-popover/95 backdrop-blur-md px-3 py-2 text-xs shadow-lg">
          <Bot size={14} className="text-primary shrink-0 mt-0.5" />
          <button
            onClick={() => { onOpen({ type: t.entity_type, id: t.entity_id, title: '' }); setToasts(prev => prev.filter(x => x.id !== t.id)) }}
            className="flex-1 text-left text-foreground hover:underline"
            title="Open"
          >
            <span className="text-muted-foreground">Agent · </span>{t.summary}
          </button>
          <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
