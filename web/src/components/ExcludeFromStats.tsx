import { CircleSlash } from 'lucide-react'
import { cn } from '@/lib/utils'

const EXPLAIN = 'Left out of meeting stats: hours, share of the work week, meeting count, busiest day and the weekly chart'

/** Shown on a meeting marked "Exclude from stats". */
export function ExcludedBadge({ className }: { className?: string }) {
  return (
    <span
      title={EXPLAIN}
      className={cn('inline-flex items-center gap-1 text-[11px] text-muted-foreground border border-border rounded-full px-1.5 h-4 flex-shrink-0', className)}
    >
      <CircleSlash size={9} /> excluded
    </span>
  )
}

/** Pill toggle for a meeting's "Exclude from stats" flag (pressed = excluded). `compact` shortens it to "Exclude". */
export function ExcludeToggle({ value, onChange, className, compact }: {
  value: boolean
  onChange: (v: boolean) => void
  className?: string
  compact?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      aria-pressed={value}
      title={value ? `Excluded. ${EXPLAIN}. Click to count it again.` : `Exclude from stats. ${EXPLAIN}.`}
      className={cn(
        'inline-flex items-center text-xs h-7 rounded-md border transition-colors flex-shrink-0',
        compact ? 'gap-1 px-2' : 'gap-1.5 px-2.5',
        value ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      <CircleSlash size={compact ? 11 : 12} /> {compact ? 'Exclude' : 'Exclude from stats'}
    </button>
  )
}
