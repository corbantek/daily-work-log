import { useState } from 'react'
import { Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { WorkstreamPicker } from './WorkstreamPicker'
import { CompetencyTagPicker } from './CompetencyTagPicker'
import type { CompetencyDimension, Interaction, InteractionTagInput, Sentiment, Workstream } from '../api/types'
import { createInteraction, updateInteraction } from '../api/client'
import { todayStr } from '../api/date'
import { cn } from '@/lib/utils'

const SENTIMENTS: { value: Sentiment; label: string; color: string }[] = [
  { value: 'strength', label: 'Strength', color: 'text-green-400 border-green-500/50 bg-green-500/10' },
  { value: 'growth', label: 'Growth area', color: 'text-amber-400 border-amber-500/50 bg-amber-500/10' },
  { value: 'neutral', label: 'Note', color: 'text-gray-400 border-gray-500/50 bg-gray-500/10' },
]

interface Props {
  personId: string
  framework: CompetencyDimension[]
  workstreams: Workstream[]
  existing?: Interaction
  theme?: 'light' | 'dim' | 'dark'
  onSaved: () => void
  onCancel: () => void
}

export function InteractionForm({ personId, framework, workstreams, existing, theme = 'dim', onSaved, onCancel }: Props) {
  const [date, setDate] = useState(existing?.date ?? todayStr())
  const [summary, setSummary] = useState(existing?.summary ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [sentiment, setSentiment] = useState<Sentiment>(existing?.sentiment ?? 'neutral')
  const [workstreamId, setWorkstreamId] = useState(existing?.workstream_id ?? '__none__')
  const [highImpact, setHighImpact] = useState(existing?.high_impact ?? false)
  const [tags, setTags] = useState<InteractionTagInput[]>(
    existing?.tags.map(t => ({ dimension_key: t.dimension_key, attribute_id: t.attribute_id })) ?? []
  )
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!summary.trim()) return
    setSaving(true)
    const body = {
      date,
      summary: summary.trim(),
      notes: notes.trim() || null,
      sentiment,
      workstream_id: workstreamId === '__none__' ? null : workstreamId,
      high_impact: highImpact,
      tags,
    }
    try {
      if (existing) {
        await updateInteraction(existing.id, body)
      } else {
        await createInteraction({ person_id: personId, ...body })
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card/60 p-3 space-y-3">
      <div className="flex gap-2 items-center">
        <Input
          type="date"
          value={date}
          onChange={e => setDate((e.target as HTMLInputElement).value)}
          className="h-8 text-xs w-36"
          style={{ colorScheme: theme === 'light' ? 'light' : 'dark' }}
        />
        <Input
          autoFocus
          value={summary}
          onChange={e => setSummary((e.target as HTMLInputElement).value)}
          placeholder="What happened? (short summary)"
          className="h-8 text-sm flex-1"
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save() }}
        />
        <button
          type="button"
          onClick={() => setHighImpact(v => !v)}
          className={cn(
            'p-1.5 rounded border transition-colors shrink-0',
            highImpact ? 'border-yellow-500 text-yellow-400' : 'border-border text-muted-foreground hover:text-foreground'
          )}
          title="Notable / high impact"
        >
          <Zap size={14} />
        </button>
      </div>

      <div className="flex gap-1.5">
        {SENTIMENTS.map(s => (
          <button
            key={s.value}
            type="button"
            onClick={() => setSentiment(s.value)}
            className={cn(
              'text-xs px-2.5 py-1 rounded-md border transition-colors flex-1',
              sentiment === s.value ? s.color : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <CompetencyTagPicker framework={framework} value={tags} onChange={setTags} />

      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Details and examples (markdown supported)…"
        className="w-full min-h-20 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring resize-y font-mono leading-relaxed"
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save() }}
      />

      <div className="flex items-center gap-2">
        <WorkstreamPicker value={workstreamId} workstreams={workstreams} onChange={setWorkstreamId} />
        <div className="flex-1" />
        <Button size="sm" className="h-8 text-xs" onClick={save} disabled={saving || !summary.trim()}>
          {saving ? 'Saving…' : existing ? 'Save' : 'Add interaction'}
        </Button>
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
