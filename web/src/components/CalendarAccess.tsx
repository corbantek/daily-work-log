import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { getCalendarStatus, requestCalendarAccess } from '../api/client'
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

  useEffect(() => {
    getCalendarStatus().then(setStatus).catch(() => setError('Could not reach the API'))
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
      {error && <p className="text-xs text-destructive mt-2">{error}</p>}
    </div>
  )
}
