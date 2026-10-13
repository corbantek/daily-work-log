import { useCallback, useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  getDismissedCalendarEvents, restoreDismissedCalendarEvent, clearDismissedCalendarEvents, syncCalendarDay,
} from '../api/client'
import { formatTime, type TimeFormat } from '../api/date'
import type { DismissedCalendarEvent } from '../api/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  timeFormat: TimeFormat
  /** Called after changes that can bring meetings back, so day views reload. */
  onChanged: () => void
}

function dayHeading(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

export function DismissedEventsDialog({ open, onOpenChange, timeFormat, onChanged }: Props) {
  const [events, setEvents] = useState<DismissedCalendarEvent[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    () => getDismissedCalendarEvents()
      .then(setEvents)
      .catch(() => setError('Could not load deleted meetings'))
      .finally(() => setLoaded(true)),
    [],
  )

  useEffect(() => {
    if (open) {
      setError(null)
      load()
    }
  }, [open, load])

  async function restore(ev: DismissedCalendarEvent) {
    setBusyId(ev.external_id)
    setError(null)
    try {
      await restoreDismissedCalendarEvent(ev.external_id)
      // Bring it back now instead of waiting for the next manual sync of that day.
      await syncCalendarDay(ev.date).catch(() => {
        setError('Restored, but sync failed — click sync on that day to bring it back')
      })
      await load()
      onChanged()
    } catch {
      setError('Restore failed')
    } finally {
      setBusyId(null)
    }
  }

  async function clearAll() {
    if (!confirm(`Forget all ${events.length} deleted meetings? Any that are still on your calendar will come back the next time you sync their day.`)) return
    try {
      await clearDismissedCalendarEvents()
      await load()
    } catch {
      setError('Clear failed')
    }
  }

  const byDay = events.reduce<Record<string, DismissedCalendarEvent[]>>((acc, ev) => {
    ;(acc[ev.date] ||= []).push(ev)
    return acc
  }, {})

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Deleted calendar meetings</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Calendar meetings you deleted are skipped when syncing, for 90 days after their date.
          Restore one to bring it back now.
        </p>

        <div className="overflow-y-auto thin-scrollbar pr-1 space-y-3 min-h-24">
          {loaded && events.length === 0 && (
            <p className="text-xs text-muted-foreground/60">No deleted calendar meetings.</p>
          )}
          {Object.entries(byDay).map(([day, evs]) => (
            <div key={day}>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                {dayHeading(day)}
              </p>
              <ul className="space-y-1">
                {evs.map(ev => (
                  <li key={ev.external_id} className="flex items-center gap-2 text-sm">
                    <span className="w-20 flex-shrink-0 text-xs tabular-nums text-muted-foreground">
                      {ev.start_time ? formatTime(ev.start_time, timeFormat) : ''}
                    </span>
                    <span className="flex-1 truncate text-foreground" title={ev.title}>{ev.title}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs gap-1 text-muted-foreground"
                      onClick={() => restore(ev)}
                      disabled={busyId === ev.external_id}
                    >
                      <RotateCcw size={12} /> {busyId === ev.external_id ? 'Restoring…' : 'Restore'}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {events.length > 0 && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-muted-foreground/70">{events.length} deleted</span>
            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={clearAll}>
              Clear all
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
