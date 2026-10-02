import { useState, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronLeft, Download, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { rehypeHighlightTodo } from '@/lib/rehype-highlight-todo'
import type { CompetencyDimension, Interaction, ReviewDraft } from '../api/types'
import { getReviewDraft } from '../api/client'
import { todayStr } from '../api/date'
import { dimensionColor } from './CompetencyTagPicker'

function currentYearStart() {
  return `${new Date().getFullYear()}-01-01`
}

interface Props {
  personId: string
  framework: CompetencyDimension[]
  theme?: 'light' | 'dim' | 'dark'
  onBack: () => void
}

export function ReviewDraftView({ personId, framework, theme, onBack }: Props) {
  const [draft, setDraft] = useState<ReviewDraft | null>(null)
  const [from, setFrom] = useState(currentYearStart())
  const [to, setTo] = useState(todayStr())
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    getReviewDraft(personId, from, to).then(setDraft).finally(() => setLoading(false))
  }, [personId, from, to])

  useEffect(() => { load() }, [load])

  function buildMarkdown(d: ReviewDraft): string {
    const lines: string[] = []
    lines.push(`# Peer Feedback — ${d.person.name}`)
    lines.push(`_${from} → ${to} · ${d.total_interactions} interactions logged_`)
    lines.push('')
    lines.push(`**Familiarity:** ${d.familiarity_suggestion}`)
    lines.push('')

    for (const dim of d.dimensions) {
      const total = dim.strengths.length + dim.growth.length + dim.neutral.length
      if (total === 0) continue
      lines.push(`## ${dim.label}`)
      const emit = (label: string, items: Interaction[], mark: string) => {
        if (!items.length) return
        lines.push(`**${label}:**`)
        for (const it of items) {
          lines.push(`- ${mark} ${it.date} — ${it.summary}`)
          if (it.notes) {
            for (const nl of it.notes.split('\n')) lines.push(`  ${nl}`)
          }
        }
      }
      emit('Strengths', dim.strengths, '✅')
      emit('Growth', dim.growth, '🔸')
      emit('Notes', dim.neutral, '•')
      lines.push('')
    }

    if (d.continue_candidates.length) {
      const top = d.continue_candidates[0]
      lines.push(`## I'd like to see this team member continue…`)
      lines.push(`**${top.dimension_label}: ${top.attribute_text ?? ''}** (${top.count} example${top.count !== 1 ? 's' : ''})`)
      lines.push('')
    }
    if (d.focus_candidates.length) {
      const top = d.focus_candidates[0]
      lines.push(`## I'd like to see this team member focus more on…`)
      lines.push(`**${top.dimension_label}: ${top.attribute_text ?? ''}** (${top.count} example${top.count !== 1 ? 's' : ''})`)
      lines.push('')
    }

    if (d.comments_interactions.length) {
      lines.push(`## Notable moments`)
      for (const it of d.comments_interactions) {
        lines.push(`- ${it.date} — ${it.summary}`)
      }
      lines.push('')
    }

    if (d.other_notes.length) {
      lines.push(`## Other notes`)
      for (const it of d.other_notes) {
        lines.push(`- ${it.date} — ${it.summary}`)
        if (it.notes) {
          for (const nl of it.notes.split('\n')) lines.push(`  ${nl}`)
        }
      }
      lines.push('')
    }

    return lines.join('\n')
  }

  function exportMarkdown() {
    if (!draft) return
    const blob = new Blob([buildMarkdown(draft)], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `peer-feedback-${draft.person.name.replace(/\s+/g, '-').toLowerCase()}-${from}-to-${to}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  function Evidence({ items, mark }: { items: Interaction[]; mark: string }) {
    return (
      <div className="space-y-1.5">
        {items.map(it => (
          <div key={it.id} className="text-xs">
            <div className="flex items-start gap-1.5">
              <span className="shrink-0">{mark}</span>
              <span className="text-muted-foreground/60 font-mono shrink-0">{it.date}</span>
              {it.high_impact && <Zap size={11} className="text-yellow-400 shrink-0 mt-0.5" />}
              <span className="text-foreground">{it.summary}</span>
            </div>
            {it.notes && (
              <div className="prose-worklog max-w-none ml-5 mt-0.5 opacity-80">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlightTodo]}>{it.notes}</ReactMarkdown>
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4 transition-colors">
        <ChevronLeft size={14} /> Back
      </button>

      {draft && (
        <>
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Review Draft — {draft.person.name}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {draft.total_interactions} interactions · Suggested familiarity: <span className="text-foreground">{draft.familiarity_suggestion}</span>
              </p>
            </div>
            <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs shrink-0" onClick={exportMarkdown}>
              <Download size={13} /> Export Markdown
            </Button>
          </div>

          <div className="flex items-center gap-2 mb-5 p-3 rounded-lg border border-border bg-card/50">
            <Input type="date" value={from} onChange={e => setFrom((e.target as HTMLInputElement).value)}
              className="h-8 text-xs w-36" style={{ colorScheme: theme === 'light' ? 'light' : 'dark' }} />
            <span className="text-xs text-muted-foreground">→</span>
            <Input type="date" value={to} onChange={e => setTo((e.target as HTMLInputElement).value)}
              className="h-8 text-xs w-36" style={{ colorScheme: theme === 'light' ? 'light' : 'dark' }} />
            {loading && <span className="text-xs text-muted-foreground ml-2">Loading…</span>}
          </div>

          {/* Continue / Focus picks */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
            <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3">
              <p className="text-xs font-semibold text-green-400 mb-2">Continue (top strengths)</p>
              {draft.continue_candidates.length === 0 && <p className="text-xs text-muted-foreground/50">No strengths tagged yet.</p>}
              <div className="space-y-1">
                {draft.continue_candidates.slice(0, 5).map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground/50 w-5">×{c.count}</span>
                    <span className="text-foreground">{c.attribute_text ?? c.dimension_label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-xs font-semibold text-amber-400 mb-2">Focus more on (top growth areas)</p>
              {draft.focus_candidates.length === 0 && <p className="text-xs text-muted-foreground/50">No growth areas tagged yet.</p>}
              <div className="space-y-1">
                {draft.focus_candidates.slice(0, 5).map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground/50 w-5">×{c.count}</span>
                    <span className="text-foreground">{c.attribute_text ?? c.dimension_label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Per-dimension evidence */}
          <div className="space-y-4">
            {draft.dimensions.map(dim => {
              const total = dim.strengths.length + dim.growth.length + dim.neutral.length
              if (total === 0) return null
              return (
                <div key={dim.key} className="rounded-lg border border-border bg-card/40 p-3">
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className={cn('text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border', dimensionColor(framework, dim.key))}>
                      {dim.label}
                    </span>
                    <span className="text-xs text-muted-foreground/50">{total} example{total !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="space-y-3">
                    {dim.strengths.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-green-400 mb-1">Strengths</p>
                        <Evidence items={dim.strengths} mark="✅" />
                      </div>
                    )}
                    {dim.growth.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-amber-400 mb-1">Growth</p>
                        <Evidence items={dim.growth} mark="🔸" />
                      </div>
                    )}
                    {dim.neutral.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
                        <Evidence items={dim.neutral} mark="•" />
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {draft.other_notes.length > 0 && (
              <div className="rounded-lg border border-border bg-card/40 p-3">
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border text-gray-400 border-gray-500/40">
                    Other notes
                  </span>
                  <span className="text-xs text-muted-foreground/50">{draft.other_notes.length} note{draft.other_notes.length !== 1 ? 's' : ''}</span>
                </div>
                <Evidence items={draft.other_notes} mark="•" />
              </div>
            )}

            {draft.total_interactions === 0 && (
              <p className="text-sm text-muted-foreground/50 text-center py-12">
                No interactions in this date range.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
