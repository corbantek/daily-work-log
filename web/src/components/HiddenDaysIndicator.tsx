import { EyeOff, Eye } from 'lucide-react'

interface Props {
  hiddenDates: string[]
  onUnhide: (date: string) => void
}

function formatShortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[dt.getDay()]} ${months[dt.getMonth()]} ${d}`
}

export function HiddenDaysIndicator({ hiddenDates, onUnhide }: Props) {
  if (hiddenDates.length === 0) return null

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 text-muted-foreground/40">
      <EyeOff size={12} />
      <span className="text-xs">
        {hiddenDates.map((d, i) => (
          <span key={d}>
            {i > 0 && ', '}
            {formatShortDate(d)}
          </span>
        ))}
        {' '}hidden
      </span>
      <div className="flex gap-1 ml-1">
        {hiddenDates.map(d => (
          <button
            key={d}
            onClick={() => onUnhide(d)}
            className="inline-flex items-center gap-0.5 text-xs text-muted-foreground/50 hover:text-foreground transition-colors"
            title={`Show ${formatShortDate(d)}`}
          >
            <Eye size={10} />
            <span className="text-[10px]">show</span>
          </button>
        ))}
      </div>
    </div>
  )
}
