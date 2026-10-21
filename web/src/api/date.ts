export function toLocalDateStr(dt: Date): string {
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const d = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function todayStr(): string {
  return toLocalDateStr(new Date())
}

export type TimeFormat = '12h' | '24h'

export function isTimeFormat(v: string | undefined): v is TimeFormat {
  return v === '12h' || v === '24h'
}

/** Format a local "HH:MM" string for display. */
export function formatTime(hhmm: string, format: TimeFormat): string {
  if (format === '24h') return hhmm
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`
}

export function isWeekend(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number)
  const day = new Date(y, m - 1, d).getDay()
  return day === 0 || day === 6
}

/** Local Date for a "YYYY-MM-DD" string (midnight local time). */
export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(dateStr: string, days: number): string {
  const dt = parseLocalDate(dateStr)
  dt.setDate(dt.getDate() + days)
  return toLocalDateStr(dt)
}

/** Monday of the week containing `dateStr`. */
export function weekStart(dateStr: string): string {
  const dt = parseLocalDate(dateStr)
  return addDays(dateStr, -((dt.getDay() + 6) % 7))
}

export type RangePreset = 'this_week' | 'last_week' | 'this_month' | 'this_quarter' | 'this_year' | 'custom'
export interface DateRange { from: string; to: string; preset: RangePreset }

export const RANGE_PRESETS: { preset: Exclude<RangePreset, 'custom'>; label: string }[] = [
  { preset: 'this_week', label: 'This week' },
  { preset: 'last_week', label: 'Last week' },
  { preset: 'this_month', label: 'This month' },
  { preset: 'this_quarter', label: 'This quarter' },
  { preset: 'this_year', label: 'This year' },
]

/** Weeks run Monday to Sunday; months, quarters and years are calendar ones. */
export function rangeForPreset(preset: Exclude<RangePreset, 'custom'>, today = todayStr()): DateRange {
  const t = parseLocalDate(today)
  if (preset === 'this_week' || preset === 'last_week') {
    const mon = addDays(weekStart(today), preset === 'last_week' ? -7 : 0)
    return { from: mon, to: addDays(mon, 6), preset }
  }
  if (preset === 'this_year') return { from: `${t.getFullYear()}-01-01`, to: `${t.getFullYear()}-12-31`, preset }
  const firstMonth = preset === 'this_month' ? t.getMonth() : t.getMonth() - (t.getMonth() % 3)
  const months = preset === 'this_month' ? 1 : 3
  return {
    from: toLocalDateStr(new Date(t.getFullYear(), firstMonth, 1)),
    to: toLocalDateStr(new Date(t.getFullYear(), firstMonth + months, 0)),
    preset,
  }
}

/** "Mon, Oct 20" */
export function formatShortDate(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

/** "Oct 20" */
export function formatMonthDay(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Self-review cycle ─────────────────────────────────────────────────────────
/** Month-day ("MM-DD") the self-review cycle starts on; stored in the `review_cycle_start` setting. */
export const DEFAULT_REVIEW_CYCLE_START = '01-01'

export function isMonthDay(v: string | undefined): v is string {
  const m = /^(\d{2})-(\d{2})$/.exec(v ?? '')
  if (!m) return false
  const [month, day] = [Number(m[1]), Number(m[2])]
  // Day limits use a leap year so Feb 29 is allowed (it falls back to Feb 28 when needed).
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(2024, month, 0).getDate()
}

/** The most recent cycle start on or before `today`: this year's if it has arrived, else last year's. */
export function reviewCycleStart(monthDay: string, today = todayStr()): string {
  const [month, day] = monthDay.split('-').map(Number)
  const startIn = (year: number) =>
    toLocalDateStr(new Date(year, month - 1, Math.min(day, new Date(year, month, 0).getDate())))
  const year = parseLocalDate(today).getFullYear()
  const thisYear = startIn(year)
  return thisYear <= today ? thisYear : startIn(year - 1)
}
