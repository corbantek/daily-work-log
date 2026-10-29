import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export type RefKind = 'task' | 'meeting' | 'person'

const PREFIX: Record<RefKind, string> = { task: 'T', meeting: 'M', person: 'P' }

/** "T42" / "M17" / "P12": the short reference used when talking to the AI agent. */
const refText = (kind: RefKind, number: number | null | undefined) =>
  number ? `${PREFIX[kind]}${number}` : null

const baseClass = 'font-mono text-[11px] tabular-nums text-muted-foreground/60 flex-shrink-0'

/** Muted reference that copies itself (e.g. "T42") on click. Renders nothing without a number. */
export function RefBadge({ kind, number, className }: {
  kind: RefKind
  number: number | null | undefined
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(t)
  }, [copied])

  const ref = refText(kind, number)
  if (!ref) return null

  async function copy(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(ref!)
      setCopied(true)
    } catch { /* clipboard unavailable: the reference is still visible to copy by hand */ }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={`Copy ${ref} — use it to refer to this ${kind} when talking to the AI agent`}
      className={cn(baseClass, 'rounded px-1 -mx-1 hover:text-foreground hover:bg-muted transition-colors', className)}
    >
      {copied ? 'copied' : ref}
    </button>
  )
}

/** Non-interactive version, for places that are already a button (e.g. search results). */
export function RefLabel({ kind, number, className }: { kind: RefKind; number: number | null | undefined; className?: string }) {
  const ref = refText(kind, number)
  return ref ? <span className={cn(baseClass, className)}>{ref}</span> : null
}
