import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'

/** An item to bring into view in the Log (set by "Open in Log"). `nonce` makes repeated jumps to the same item fire again. */
export interface LogTarget { type: 'task' | 'meeting'; id: string; date: string; nonce: number }

export const LogTargetContext = createContext<LogTarget | null>(null)

/** Asks the app to jump to a task/meeting in the Log: loads and unhides its day, opens it, scrolls, highlights. */
export type OpenInLog = (t: Pick<LogTarget, 'type' | 'id' | 'date'>) => void
export const OpenInLogContext = createContext<OpenInLog | null>(null)

/** The day an item is easiest to find on in the Log. Closed tasks show on every day from start to end;
 *  the day they were closed is where they were last worked on. Open tasks are on today. */
export function logDateFor(
  item: { type: 'task'; state: string; start_date: string | null; end_date: string | null } | { type: 'meeting'; date: string },
  today: string,
): string {
  if (item.type === 'meeting') return item.date
  if (item.state === 'complete' || item.state === 'abandoned') return item.end_date ?? item.start_date ?? today
  return today
}

/** True while `id` is the jump target for a day's worth of rows; `onHit` lets the row open itself. */
export function useIsLogTarget(id: string): boolean {
  return useContext(LogTargetContext)?.id === id
}

/** Wraps a Log row: when it is the jump target it opens (onHit), scrolls to the middle and flashes a highlight. */
export function JumpTarget({ id, onHit, className, children }: {
  id: string; onHit: () => void; className?: string; children: ReactNode
}) {
  const target = useContext(LogTargetContext)
  const ref = useRef<HTMLDivElement>(null)
  const nonce = target?.id === id ? target.nonce : null
  const hit = useRef(onHit)
  hit.current = onHit
  useEffect(() => {
    if (nonce === null) return
    hit.current()
    const el = ref.current
    if (el) {
      el.classList.remove('jump-highlight')
      void el.offsetWidth  // restart the animation on a repeat jump
      el.classList.add('jump-highlight')
    }
    const t = setTimeout(() => el?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 150)  // after it expands
    return () => clearTimeout(t)
  }, [nonce])
  return <div ref={ref} data-log-item={id} className={className}>{children}</div>
}
