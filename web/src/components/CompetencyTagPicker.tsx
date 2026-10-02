import { useState } from 'react'
import { ChevronDown, Check, Tag, X } from 'lucide-react'
import type { CompetencyDimension, InteractionTagInput } from '../api/types'
import { cn } from '@/lib/utils'

export const DIMENSION_COLORS = [
  'text-blue-400 border-blue-500/40 bg-blue-500/10',
  'text-purple-400 border-purple-500/40 bg-purple-500/10',
  'text-green-400 border-green-500/40 bg-green-500/10',
  'text-amber-400 border-amber-500/40 bg-amber-500/10',
  'text-pink-400 border-pink-500/40 bg-pink-500/10',
]

export function dimensionColor(framework: CompetencyDimension[], key: string): string {
  const idx = framework.findIndex(d => d.key === key)
  return DIMENSION_COLORS[(idx < 0 ? 0 : idx) % DIMENSION_COLORS.length]
}

function tagKey(t: InteractionTagInput): string {
  return `${t.dimension_key}:${t.attribute_id ?? ''}`
}

interface Props {
  framework: CompetencyDimension[]
  value: InteractionTagInput[]
  onChange: (tags: InteractionTagInput[]) => void
}

export function CompetencyTagPicker({ framework, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const selectedKeys = new Set(value.map(tagKey))

  function toggle(t: InteractionTagInput) {
    const k = tagKey(t)
    if (selectedKeys.has(k)) {
      onChange(value.filter(v => tagKey(v) !== k))
    } else {
      onChange([...value, t])
    }
  }

  function labelFor(t: InteractionTagInput): string {
    const dim = framework.find(d => d.key === t.dimension_key)
    if (!dim) return t.dimension_key
    if (!t.attribute_id) return dim.label
    const attr = dim.attributes.find(a => a.id === t.attribute_id)
    return attr ? `${dim.label}: ${attr.text}` : dim.label
  }

  return (
    <div className="relative">
      <div
        className="flex flex-wrap items-center gap-1 min-h-8 border border-border rounded-lg px-2 py-1 cursor-pointer bg-transparent hover:bg-accent/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        {value.length === 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Tag size={12} /> Tag competencies
          </span>
        )}
        {value.map(t => (
          <span
            key={tagKey(t)}
            className={cn('flex items-center gap-1 text-xs pl-1.5 pr-1 py-0.5 rounded-full border', dimensionColor(framework, t.dimension_key))}
          >
            <span className="max-w-64 truncate">{labelFor(t)}</span>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); toggle(t) }}
              className="hover:opacity-70"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <ChevronDown size={13} className="text-muted-foreground ml-auto" />
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-xl p-1 w-full max-h-72 overflow-y-auto thin-scrollbar">
            {framework.map(dim => (
              <div key={dim.key} className="mb-1 last:mb-0">
                <button
                  type="button"
                  onClick={() => toggle({ dimension_key: dim.key, attribute_id: null })}
                  className={cn(
                    'flex items-center gap-2 w-full px-2 py-1.5 rounded text-left text-xs font-semibold uppercase tracking-wide transition-colors',
                    selectedKeys.has(`${dim.key}:`) ? 'bg-accent' : 'hover:bg-accent',
                  )}
                >
                  {selectedKeys.has(`${dim.key}:`) && <Check size={11} />}
                  {dim.label}
                </button>
                {dim.attributes.map(attr => {
                  const t = { dimension_key: dim.key, attribute_id: attr.id }
                  return (
                    <button
                      key={attr.id}
                      type="button"
                      onClick={() => toggle(t)}
                      className={cn(
                        'flex items-start gap-2 w-full pl-5 pr-2 py-1 rounded text-left text-xs transition-colors',
                        selectedKeys.has(tagKey(t)) ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      <span className="w-3 flex-shrink-0 pt-0.5">
                        {selectedKeys.has(tagKey(t)) && <Check size={11} />}
                      </span>
                      {attr.text}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
