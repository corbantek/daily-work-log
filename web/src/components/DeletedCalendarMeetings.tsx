import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { getSettings, setSetting, getDismissedCalendarEvents } from '../api/client'

interface Props {
  /** Opens the deleted-meetings dialog (the caller closes Settings first). */
  onView: () => void
}

export function DeletedCalendarMeetings({ onView }: Props) {
  const [remember, setRemember] = useState(true)
  const [count, setCount] = useState(0)

  useEffect(() => {
    getSettings().then(s => setRemember(s.calendar_remember_deleted !== 'false'))
    getDismissedCalendarEvents().then(d => setCount(d.length)).catch(() => setCount(0))
  }, [])

  function change(val: boolean) {
    setRemember(val)
    setSetting('calendar_remember_deleted', String(val))
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground/70 mb-2">
        Keep deleted calendar meetings deleted when syncing. They come back if the event is edited on your calendar.
        Deletions are remembered for 90 days.
      </p>
      <div className="flex gap-1.5">
        {([[true, 'Stay deleted'], [false, 'Re-import']] as const).map(([value, label]) => (
          <Button
            key={label}
            size="sm"
            variant={remember === value ? 'default' : 'secondary'}
            className="h-8 text-xs flex-1 px-1"
            onClick={() => change(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      <Button size="sm" variant="outline" className="h-8 text-xs mt-3" onClick={onView}>
        View deleted meetings{count > 0 ? ` (${count})` : ''}
      </Button>
    </div>
  )
}
