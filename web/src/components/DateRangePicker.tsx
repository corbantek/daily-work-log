import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { RANGE_PRESETS, rangeForPreset, type DateRange } from '../api/date'

interface Props {
  value: DateRange
  onChange: (range: DateRange) => void
  theme?: 'light' | 'dim' | 'dark'
}

/** Preset buttons plus from/to dates; editing a date switches to a custom range. */
export function DateRangePicker({ value, onChange, theme }: Props) {
  const colorScheme = theme === 'light' ? 'light' : 'dark'
  return (
    <div className="flex flex-wrap items-center gap-2">
      {RANGE_PRESETS.map(({ preset, label }) => (
        <button
          key={preset}
          onClick={() => onChange(rangeForPreset(preset))}
          className={cn(
            'text-xs px-2.5 py-1 rounded-md border transition-colors',
            value.preset === preset
              ? 'border-primary text-primary bg-primary/10'
              : 'border-border text-muted-foreground hover:text-foreground'
          )}
        >
          {label}
        </button>
      ))}
      <Input
        type="date"
        value={value.from}
        onChange={e => {
          const from = (e.target as HTMLInputElement).value
          if (from) onChange({ from, to: value.to < from ? from : value.to, preset: 'custom' })
        }}
        className="h-8 text-xs w-36"
        style={{ colorScheme }}
        aria-label="From"
      />
      <span className="text-xs text-muted-foreground">→</span>
      <Input
        type="date"
        value={value.to}
        onChange={e => {
          const to = (e.target as HTMLInputElement).value
          if (to) onChange({ from: value.from > to ? to : value.from, to, preset: 'custom' })
        }}
        className="h-8 text-xs w-36"
        style={{ colorScheme }}
        aria-label="To"
      />
    </div>
  )
}
