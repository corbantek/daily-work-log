import { useState, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Zap, Plus, Pencil, Trash2, ChevronLeft, ChevronRight, FileText, Check, Archive, ArchiveRestore, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { rehypeHighlightTodo } from '@/lib/rehype-highlight-todo'
import type { CompetencyDimension, Interaction, Person, Sentiment, Workstream } from '../api/types'
import { getInteractions, deleteInteraction, updatePerson, deletePerson, createPerson } from '../api/client'
import { InteractionForm } from './InteractionForm'
import { ClickToEditMarkdown } from './ClickToEditMarkdown'
import { dimensionColor } from './CompetencyTagPicker'
import { PersonPicker } from './PersonPicker'
import { InheritedText } from './OrgTree'
import { RefBadge } from './RefBadge'

const RELATIONSHIPS = ['Report', 'Peer', 'Manager', 'Cross-functional', 'Other']

const SENTIMENT_BADGE: Record<Sentiment, { label: string; color: string }> = {
  strength: { label: 'Strength', color: 'text-green-400 border-green-500/40' },
  growth: { label: 'Growth', color: 'text-amber-400 border-amber-500/40' },
  neutral: { label: 'Note', color: 'text-gray-400 border-gray-500/40' },
}

interface Props {
  person: Person
  people: Person[]  // everyone (archived too), for "Reports to"
  framework: CompetencyDimension[]
  workstreams: Workstream[]
  theme?: 'light' | 'dim' | 'dark'
  onBack: () => void
  onOpenPerson: (id: string) => void
  onChanged: () => void
  onRemoved: () => void
  onOpenReview: () => void
}

export function PersonDetail({ person, people, framework, workstreams, theme, onBack, onOpenPerson, onChanged, onRemoved, onOpenReview }: Props) {
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [filterDim, setFilterDim] = useState<string>('all')
  const [filterSentiment, setFilterSentiment] = useState<Sentiment | 'all'>('all')
  const [editingPerson, setEditingPerson] = useState(false)
  const [editName, setEditName] = useState(person.name)
  const [editRole, setEditRole] = useState(person.role ?? '')
  const [editTeam, setEditTeam] = useState(person.team ?? '')
  const [editRel, setEditRel] = useState(person.relationship ?? '')
  const [editFocus, setEditFocus] = useState(person.focus ?? '')
  const [editPlaceholder, setEditPlaceholder] = useState(person.is_placeholder)
  const [orgError, setOrgError] = useState<string | null>(null)
  const [newReport, setNewReport] = useState('')
  const [addingReport, setAddingReport] = useState(false)

  // What team/focus would be with this person's own value cleared: the manager's effective value.
  const manager = people.find(p => p.id === person.manager_id)
  const inheritedTeam = manager?.effective_team.value
  const inheritedFocus = manager?.effective_focus.value

  const load = useCallback(() => {
    getInteractions({
      person_id: person.id,
      dimension: filterDim === 'all' ? undefined : filterDim,
      sentiment: filterSentiment === 'all' ? undefined : filterSentiment,
    }).then(setInteractions)
  }, [person.id, filterDim, filterSentiment])

  useEffect(() => { load() }, [load])

  async function handleDelete(id: string) {
    if (!confirm('Delete this interaction?')) return
    await deleteInteraction(id)
    load()
    onChanged()
  }

  function startEditPerson() {
    setEditName(person.name)
    setEditRole(person.role ?? '')
    setEditTeam(person.team ?? '')
    setEditRel(person.relationship ?? '')
    setEditFocus(person.focus ?? '')
    setEditPlaceholder(person.is_placeholder)
    setEditingPerson(true)
  }

  async function savePerson() {
    if (!editName.trim()) return
    await updatePerson(person.id, {
      name: editName.trim(),
      role: editRole.trim() || null,
      team: editTeam.trim() || null,
      focus: editFocus.trim() || null,
      is_placeholder: editPlaceholder,
      relationship: editRel || null,
    })
    setEditingPerson(false)
    onChanged()
  }

  async function setManager(id: string | null) {
    setOrgError(null)
    try {
      await updatePerson(person.id, { manager_id: id })
      onChanged()
    } catch (e) {
      setOrgError(e instanceof Error ? e.message : 'Could not change the manager')
    }
  }

  async function addReport() {
    const name = newReport.trim()
    if (!name) return
    await createPerson({ name, manager_id: person.id })
    setNewReport('')
    setAddingReport(false)
    onChanged()
  }

  async function saveNotes(v: string | null) {
    await updatePerson(person.id, { notes: v })
    onChanged()
  }

  async function archivePerson() {
    await updatePerson(person.id, { archived_at: new Date().toISOString() })
    onRemoved()
  }

  async function restorePerson() {
    await updatePerson(person.id, { archived_at: null })
    onChanged()
    setEditingPerson(false)
  }

  async function handleDeletePerson() {
    const moved = person.reports.length
      ? ` Their ${person.reports.length} direct report${person.reports.length === 1 ? '' : 's'} will move up to ${manager?.name ?? 'no manager'}.`
      : ''
    if (!confirm(`Delete ${person.name} and all their interactions?${moved} This cannot be undone.`)) return
    await deletePerson(person.id)
    onRemoved()
  }

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4 transition-colors">
        <ChevronLeft size={14} /> All people
      </button>

      {/* Reporting chain, top down */}
      {person.chain.length > 0 && (
        <nav className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground mb-1.5">
          {[...person.chain].reverse().map(m => (
            <span key={m.id} className="flex items-center gap-1">
              <button onClick={() => onOpenPerson(m.id)}
                className={cn('hover:text-foreground hover:underline underline-offset-2', m.is_placeholder && 'italic', m.archived && 'line-through')}>
                {m.name}
              </button>
              <ChevronRight size={11} className="text-muted-foreground/50" />
            </span>
          ))}
        </nav>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        {editingPerson ? (
          <div className="flex-1 space-y-2 mr-3">
            <div className="flex gap-2">
              <Input value={editName} onChange={e => setEditName((e.target as HTMLInputElement).value)}
                placeholder="Name" className="h-8 text-sm flex-1" />
              <Input value={editRole} onChange={e => setEditRole((e.target as HTMLInputElement).value)}
                placeholder="Role" className="h-8 text-sm flex-1" />
            </div>
            <div className="flex gap-2">
              <Input value={editTeam} onChange={e => setEditTeam((e.target as HTMLInputElement).value)}
                placeholder={inheritedTeam ? `Team: ${inheritedTeam} (inherited)` : 'Team'} className="h-8 text-sm flex-1" />
              <Input value={editFocus} onChange={e => setEditFocus((e.target as HTMLInputElement).value)}
                placeholder={inheritedFocus ? `Focus: ${inheritedFocus} (inherited)` : 'Focus: what the group works on'}
                className="h-8 text-sm flex-1" />
            </div>
            <div className="flex gap-2 items-center">
              <select value={editRel} onChange={e => setEditRel(e.target.value)}
                className="h-8 text-xs px-2 rounded-md border border-border bg-card text-foreground focus:outline-none focus:border-ring flex-1">
                <option value="">Relationship…</option>
                {RELATIONSHIPS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer flex-1"
                title="Someone you know exists but haven't identified yet">
                <input type="checkbox" checked={editPlaceholder} onChange={e => setEditPlaceholder(e.target.checked)} />
                Not identified yet
              </label>
            </div>
            <p className="text-xs text-muted-foreground/60">Leave team or focus blank to inherit it from their manager.</p>
            <div className="flex items-center gap-1.5">
              <Button size="sm" className="h-7 text-xs gap-1" onClick={savePerson} disabled={!editName.trim()}>
                <Check size={12} /> Save
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingPerson(false)}>
                Cancel
              </Button>
              <div className="flex-1" />
              {person.archived_at ? (
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground" onClick={restorePerson}>
                  <ArchiveRestore size={12} /> Restore
                </Button>
              ) : (
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground" onClick={archivePerson}>
                  <Archive size={12} /> Archive
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground hover:text-destructive" onClick={handleDeletePerson}>
                <Trash2 size={12} /> Delete
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2">
              <h2 className={cn('text-lg font-semibold text-foreground', person.is_placeholder && 'italic text-muted-foreground')}>{person.name}</h2>
              <RefBadge kind="person" number={person.number} />
              {person.is_placeholder && (
                <span className="text-xs px-1.5 py-0.5 rounded-full border border-dashed border-border text-muted-foreground">Not identified yet</span>
              )}
              {person.archived_at && (
                <span className="text-xs px-1.5 py-0.5 rounded-full border border-border text-muted-foreground">Archived</span>
              )}
              <button onClick={startEditPerson} className="text-muted-foreground/50 hover:text-foreground transition-colors">
                <Pencil size={13} />
              </button>
            </div>
            <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
              {person.role && <span>{person.role}</span>}
              {person.effective_team.value && (
                <span>· <InheritedText v={person.effective_team} />
                  {person.effective_team.from_name && <span className="text-muted-foreground/50"> (via {person.effective_team.from_name})</span>}
                </span>
              )}
              {person.relationship && <span>· {person.relationship}</span>}
            </div>
            {person.effective_focus.value && (
              <div className="text-xs text-muted-foreground mt-0.5">
                Focus: <InheritedText v={person.effective_focus} />
                {person.effective_focus.from_name && <span className="text-muted-foreground/50"> (via {person.effective_focus.from_name})</span>}
              </div>
            )}
          </div>
        )}
        <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs shrink-0" onClick={onOpenReview}>
          <FileText size={13} /> Review Draft
        </Button>
      </div>

      {/* Org: manager and direct reports */}
      <div className="mb-5 rounded-lg border border-border bg-card/40 px-3 py-2.5 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground w-20">Reports to</span>
          <PersonPicker people={people} value={person.manager_id} onChange={setManager} excludeTreeOf={person.id} />
          {manager && (
            <button onClick={() => onOpenPerson(manager.id)} className="text-xs text-muted-foreground hover:text-foreground">
              open
            </button>
          )}
          {orgError && <span className="text-xs text-destructive">{orgError}</span>}
        </div>
        <div className="flex items-start gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground w-20 pt-1">Reports</span>
          <div className="flex flex-wrap items-center gap-1.5 flex-1">
            {person.reports.map(r => (
              <button key={r.id} onClick={() => onOpenPerson(r.id)}
                className={cn(
                  'text-xs px-2 py-0.5 rounded-full border border-border hover:border-primary/40 hover:bg-accent/40 transition-colors',
                  r.is_placeholder && 'italic text-muted-foreground border-dashed',
                  r.archived && 'opacity-50',
                )}
                title={r.role ?? undefined}>
                {r.name}
              </button>
            ))}
            {person.reports.length === 0 && !addingReport && <span className="text-xs text-muted-foreground/50 pt-0.5">None yet</span>}
            {addingReport ? (
              <span className="flex items-center gap-1">
                <Input autoFocus value={newReport} onChange={e => setNewReport((e.target as HTMLInputElement).value)}
                  onKeyDown={e => { if (e.key === 'Enter') addReport(); if (e.key === 'Escape') setAddingReport(false) }}
                  placeholder="Name" className="h-6 text-xs w-40" />
                <Button size="sm" className="h-6 text-xs px-2" onClick={addReport} disabled={!newReport.trim()}>Add</Button>
                <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setAddingReport(false)}>Cancel</Button>
              </span>
            ) : (
              <button onClick={() => setAddingReport(true)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-accent">
                <UserPlus size={11} /> Add report
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Person notes */}
      <div className="mb-5">
        <p className="text-xs font-medium text-muted-foreground mb-1.5">Notes</p>
        <ClickToEditMarkdown
          value={person.notes}
          onSave={saveNotes}
          placeholder="Add notes about this person — interests, context, anything useful to remember…"
          kind="person"
          draftKey={`person:${person.id}:notes`}
        />
      </div>

      {/* Filters + add */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select
          value={filterDim}
          onChange={e => setFilterDim(e.target.value)}
          className="h-7 text-xs px-2 rounded-md border border-border bg-card text-foreground focus:outline-none focus:border-ring"
        >
          <option value="all">All dimensions</option>
          {framework.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
        {(['all', 'strength', 'growth', 'neutral'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilterSentiment(s)}
            className={cn(
              'text-xs px-2.5 py-1 rounded-md border transition-colors capitalize',
              filterSentiment === s
                ? s === 'all' ? 'border-primary text-primary bg-primary/10' : SENTIMENT_BADGE[s as Sentiment].color + ' bg-transparent'
                : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            {s === 'all' ? 'All' : SENTIMENT_BADGE[s as Sentiment].label}
          </button>
        ))}
        <div className="flex-1" />
        {!adding && (
          <Button size="sm" className="gap-1 h-7 text-xs" onClick={() => { setAdding(true); setEditingId(null) }}>
            <Plus size={12} /> Log interaction
          </Button>
        )}
      </div>

      {adding && (
        <div className="mb-4">
          <InteractionForm
            personId={person.id}
            framework={framework}
            workstreams={workstreams}
            theme={theme}
            onSaved={() => { setAdding(false); load(); onChanged() }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {/* Timeline */}
      <div className="space-y-2">
        {interactions.map(it => (
          editingId === it.id ? (
            <InteractionForm
              key={it.id}
              personId={person.id}
              framework={framework}
              workstreams={workstreams}
              existing={it}
              theme={theme}
              onSaved={() => { setEditingId(null); load(); onChanged() }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div key={it.id} className="rounded-lg border border-border bg-card/50 px-3 py-2.5 group">
              <div className="flex items-start gap-2">
                <span className="text-xs text-muted-foreground/60 font-mono pt-0.5 shrink-0 w-20">{it.date}</span>
                {it.high_impact && <Zap size={13} className="text-yellow-400 shrink-0 mt-0.5" />}
                <span className="flex-1 text-sm text-foreground">{it.summary}</span>
                <span className={cn('text-xs border rounded-full px-2 h-5 flex items-center font-medium shrink-0', SENTIMENT_BADGE[it.sentiment].color)}>
                  {SENTIMENT_BADGE[it.sentiment].label}
                </span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button onClick={() => { setEditingId(it.id); setAdding(false) }} className="text-muted-foreground hover:text-foreground p-0.5">
                    <Pencil size={12} />
                  </button>
                  <button onClick={() => handleDelete(it.id)} className="text-muted-foreground hover:text-destructive p-0.5">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              {it.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5 ml-22" style={{ marginLeft: '5.5rem' }}>
                  {it.tags.map((t, idx) => (
                    <span key={idx} className={cn('text-xs px-1.5 py-0.5 rounded-full border', dimensionColor(framework, t.dimension_key))}>
                      {t.attribute_text ?? t.dimension_label}
                    </span>
                  ))}
                </div>
              )}

              {it.notes && (
                <div className="prose-worklog max-w-none mt-1.5" style={{ marginLeft: '5.5rem' }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlightTodo]}>{it.notes}</ReactMarkdown>
                </div>
              )}

              {it.workstream_name && (
                <div className="text-xs text-muted-foreground/60 mt-1.5" style={{ marginLeft: '5.5rem' }}>
                  {it.workstream_name}
                </div>
              )}
            </div>
          )
        ))}

        {interactions.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground/50 text-center py-12">
            No interactions logged yet. Click "Log interaction" to start.
          </p>
        )}
      </div>
    </div>
  )
}
