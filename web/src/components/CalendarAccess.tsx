import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  getCalendarStatus, requestCalendarAccess, getSettings, setSetting,
} from '../api/client'
import type { CalendarStatus } from '../api/types'

const LABELS: Record<CalendarStatus['status'], string> = {
  authorized: 'Access granted',
  not_determined: 'Not requested yet',
  denied: 'Access denied',
  restricted: 'Restricted by device policy',
  write_only: 'Write-only access (read access needed)',
  unavailable: 'Not available (macOS with pyobjc-framework-EventKit required)',
}

export function CalendarAccess() {
  const [status, setStatus] = useState<CalendarStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // null = sync every calendar (the stored setting is empty); otherwise only these ids.
  const [included, setIncluded] = useState<string[] | null>(null)

  useEffect(() => {
    getCalendarStatus().then(setStatus).catch(() => setError('Could not reach the API'))
    getSettings().then(s => {
      try {
        const ids = JSON.parse(s.calendar_included_ids || '[]')
        setIncluded(Array.isArray(ids) && ids.length > 0 ? ids : null)
      } catch {
        setIncluded(null)
      }
    })
  }, [])

  async function request() {
    setBusy(true)
    setError(null)
    try {
      setStatus(await requestCalendarAccess())
    } catch {
      setError('Request failed')
    } finally {
      setBusy(false)
    }
  }

  const calendars = status?.calendars ?? []
  const allIds = calendars.map(c => c.id)
  const isChecked = (id: string) => included === null || included.includes(id)

  function toggleCalendar(id: string) {
    const current = included === null ? allIds : included.filter(i => allIds.includes(i))
    const next = current.includes(id) ? current.filter(i => i !== id) : [...current, id]
    if (next.length === 0) return // an empty list would mean "all", so keep at least one
    if (next.length === allIds.length) {
      // Everything selected: store "all" so calendars added later are included too.
      setIncluded(null)
      setSetting('calendar_included_ids', '[]')
    } else {
      setIncluded(next)
      setSetting('calendar_included_ids', JSON.stringify(next))
    }
  }

  const bySource = calendars.reduce<Record<string, typeof calendars>>((acc, c) => {
    ;(acc[c.source] ||= []).push(c)
    return acc
  }, {})

  const ok = status?.status === 'authorized'

  return (
    <div>
      <p className="text-xs text-muted-foreground/70 mb-2">
        Status: <span className={ok ? 'text-foreground' : 'text-amber-600 dark:text-amber-400'}>
          {status ? LABELS[status.status] : 'Checking…'}
        </span>
        {ok && ` · ${status.calendars.length} calendars`}
      </p>
      <Button
        size="sm"
        variant="outline"
        className="h-8 text-xs"
        onClick={request}
        disabled={busy || status?.status === 'unavailable'}
      >
        {busy ? 'Waiting for macOS…' : ok ? 'Re-check access' : 'Request calendar access'}
      </Button>
      {status && !ok && status.status !== 'unavailable' && (
        <p className="text-xs text-muted-foreground/70 mt-2">
          If no macOS prompt appears, check System Settings → Privacy &amp; Security → Calendars.
          Access is tied to the Python binary, so it can need re-requesting after a Python upgrade.
        </p>
      )}

      {ok && calendars.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-muted-foreground mb-1">Calendars to sync</p>
          <p className="text-xs text-muted-foreground/70 mb-2">
            Only checked calendars are imported. Meetings already imported from an unchecked calendar
            show as "not on calendar" the next time you sync that day.
          </p>
          <div className="space-y-2">
            {Object.entries(bySource).map(([source, cals]) => (
              <div key={source}>
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground/60 mb-0.5">{source}</p>
                {cals.map(c => (
                  <label key={c.id} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isChecked(c.id)}
                      onChange={() => toggleCalendar(c.id)}
                    />
                    <span className="text-foreground">{c.title}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      {error && <p className="text-xs text-destructive mt-2">{error}</p>}
    </div>
  )
}
