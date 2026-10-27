import { Laptop } from 'lucide-react'
import { cn } from '@/lib/utils'

const EXPLAIN = 'Attended without participating; worked through it'

/** Read-only marker for a meeting marked Passive (Review). */
export function PassiveBadge({ className }: { className?: string }) {
  return (
    <span
      title={`${EXPLAIN}. Counted in meeting hours, not in engaged time.`}
      className={cn('inline-flex items-center gap-1 text-[11px] text-muted-foreground border border-border rounded-full px-1.5 h-4 flex-shrink-0', className)}
    >
      <Laptop size={9} /> passive
    </span>
  )
}

/** One-click Passive flag on a Log meeting row: a badge when set, otherwise a toggle that appears on row hover. */
export function PassiveToggle({ value, onChange, className }: {
  value: boolean
  onChange: (v: boolean) => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      aria-pressed={value}
      title={value ? `Passive: ${EXPLAIN.toLowerCase()}. Click to unmark.` : `Mark passive: ${EXPLAIN.toLowerCase()}.`}
      className={cn(
        'inline-flex items-center gap-1 text-[11px] rounded-full px-1.5 h-4 border transition-all flex-shrink-0',
        value
          ? 'border-border text-muted-foreground hover:text-foreground'
          : 'border-dashed border-border text-muted-foreground/70 hover:text-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        className,
      )}
    >
      <Laptop size={9} /> passive
    </button>
  )
}
