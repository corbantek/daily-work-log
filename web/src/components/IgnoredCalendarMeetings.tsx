import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { getSettings, setSetting, previewCalendarIgnore } from '../api/client'
import { formatShortDate, formatTime, type TimeFormat } from '../api/date'
import type { IgnorePreviewMatch } from '../api/types'

interface Rule {
  pattern: string
  regex: boolean
}

function parseRules(raw: string | undefined): Rule[] {
  try {
    const rules = JSON.parse(raw || '[]')
    return Array.isArray(rules)
      ? rules.filter(r => r && typeof r.pattern === 'string').map(r => ({ pattern: r.pattern, regex: !!r.regex }))
      : []
  } catch {
    return []
  }
}

function regexError(pattern: string): string | null {
  try {
    new RegExp(pattern, 'i')
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid regex'
  }
}

export function IgnoredCalendarMeetings() {
  const [rules, setRules] = useState<Rule[]>([])
  const [pattern, setPattern] = useState('')
  const [regex, setRegex] = useState(false)
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('12h')
  // null = nothing to preview (or still loading); a string = the preview request failed.
  const [matches, setMatches] = useState<IgnorePreviewMatch[] | string | null>(null)

  useEffect(() => {
    getSettings().then(s => {
      setRules(parseRules(s.calendar_ignore_rules))
      setTimeFormat(s.time_format === '24h' ? '24h' : '12h')
    })
  }, [])

  function save(next: Rule[]) {
    setRules(next)
    setSetting('calendar_ignore_rules', JSON.stringify(next))
  }

  const trimmed = pattern.trim()
  const error = regex && trimmed ? regexError(trimmed) : null

  // Preview what the pattern being typed would hide over the last 14 days (debounced).
  useEffect(() => {
    if (!trimmed || error) {
      setMatches(null)
      return
    }
    let stale = false
    const t = setTimeout(() => {
      previewCalendarIgnore(trimmed, regex)
        .then(m => { if (!stale) setMatches(m) })
        .catch(e => { if (!stale) setMatches(e instanceof Error ? e.message : 'Preview failed') })
    }, 400)
    return () => { stale = true; clearTimeout(t) }
  }, [trimmed, regex, error])

  function add(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!trimmed || error) return
    if (!rules.some(r => r.pattern === trimmed && r.regex === regex)) {
      save([...rules, { pattern: trimmed, regex }])
    }
    setPattern('')
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground/70 mb-2">
        Calendar events whose title matches are never imported (case-insensitive). Plain text matches
        anywhere in the title; with Regex on, the pattern is searched in the title. Meetings already
        imported show as "not on calendar" the next time you sync that day.
      </p>
      <form onSubmit={add} className="flex items-center gap-2">
        <input
          value={pattern}
          onChange={e => setPattern(e.target.value)}
          placeholder={regex ? '^(Lunch|Focus time)$' : 'Lunch'}
          className="h-8 flex-1 min-w-0 rounded-md border bg-transparent px-2 text-xs"
        />
        <label className="flex items-center gap-1 text-xs cursor-pointer">
          <input type="checkbox" checked={regex} onChange={e => setRegex(e.target.checked)} />
          Regex
        </label>
        <Button type="submit" size="sm" variant="outline" className="h-8 text-xs" disabled={!trimmed || !!error}>
          Add
        </Button>
      </form>
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      {typeof matches === 'string' && <p className="text-xs text-muted-foreground/70 mt-1">{matches}</p>}
      {Array.isArray(matches) && (
        <div className="mt-1.5 text-xs">
          <p className="text-muted-foreground/70">
            {matches.length === 0
              ? 'Matches nothing in the last 14 days.'
              : `Would hide ${matches.length} ${matches.length === 1 ? 'event' : 'events'} from the last 14 days:`}
          </p>
          {matches.length > 0 && (
            <ul className="mt-1 max-h-32 overflow-y-auto space-y-0.5">
              {matches.map((m, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-muted-foreground/70 shrink-0">
                    {formatShortDate(m.date)}{m.start_time ? ` ${formatTime(m.start_time, timeFormat)}` : ''}
                  </span>
                  <span className="truncate">{m.title}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {rules.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {rules.map((r, i) => (
            <li key={i} className="flex items-center gap-2 text-xs py-0.5">
              <span className="text-foreground truncate">{r.regex ? `/${r.pattern}/i` : r.pattern}</span>
              <button
                type="button"
                className="ml-auto text-muted-foreground hover:text-destructive"
                onClick={() => save(rules.filter((_, j) => j !== i))}
                aria-label={`Remove ${r.pattern}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
