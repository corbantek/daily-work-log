import { useState, useEffect, useCallback } from 'react'
import { Plus, Users, ChevronRight, Archive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { CompetencyDimension, Person, Workstream } from '../api/types'
import { getPeople, createPerson, getFramework, getWorkstreams } from '../api/client'
import { PersonDetail } from '../components/PersonDetail'
import { ReviewDraftView } from '../components/ReviewDraftView'

const RELATIONSHIPS = ['Report', 'Peer', 'Manager', 'Cross-functional', 'Other']

interface Props {
  containerClass?: string
  theme?: 'light' | 'dim' | 'dark'
}

export function PeoplePage({ containerClass = 'max-w-5xl mx-auto px-4 py-6', theme }: Props) {
  const [people, setPeople] = useState<Person[]>([])
  const [framework, setFramework] = useState<CompetencyDimension[]>([])
  const [workstreams, setWorkstreams] = useState<Workstream[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<'timeline' | 'review'>('timeline')
  const [adding, setAdding] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [team, setTeam] = useState('')
  const [relationship, setRelationship] = useState('')

  const loadPeople = useCallback(() => { getPeople(showArchived).then(setPeople) }, [showArchived])

  useEffect(() => {
    loadPeople()
    getFramework().then(setFramework)
    getWorkstreams().then(setWorkstreams)
  }, [loadPeople])

  async function handleAdd() {
    if (!name.trim()) return
    const person = await createPerson({
      name: name.trim(),
      role: role.trim() || null,
      team: team.trim() || null,
      relationship: relationship || null,
    })
    setName(''); setRole(''); setTeam(''); setRelationship(''); setAdding(false)
    await loadPeople()
    setSelectedId(person.id)
    setMode('timeline')
  }

  const selected = people.find(p => p.id === selectedId) ?? null

  if (selected && mode === 'review') {
    return (
      <div className={containerClass}>
        <ReviewDraftView
          personId={selected.id}
          framework={framework}
          theme={theme}
          onBack={() => setMode('timeline')}
        />
      </div>
    )
  }

  if (selected) {
    return (
      <div className={containerClass}>
        <PersonDetail
          person={selected}
          framework={framework}
          workstreams={workstreams}
          theme={theme}
          onBack={() => setSelectedId(null)}
          onChanged={loadPeople}
          onRemoved={() => { setSelectedId(null); loadPeople() }}
          onOpenReview={() => setMode('review')}
        />
      </div>
    )
  }

  return (
    <div className={containerClass}>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Users size={16} /> People
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowArchived(v => !v)}
            className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border transition-colors ${
              showArchived ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            <Archive size={12} /> {showArchived ? 'Showing archived' : 'Show archived'}
          </button>
          {!adding && (
            <Button size="sm" className="gap-1 h-8 text-xs" onClick={() => setAdding(true)}>
              <Plus size={12} /> Add person
            </Button>
          )}
        </div>
      </div>

      {adding && (
        <div className="rounded-lg border border-border bg-card/60 p-3 mb-4 space-y-2">
          <div className="flex gap-2">
            <Input autoFocus value={name} onChange={e => setName((e.target as HTMLInputElement).value)}
              placeholder="Name" className="h-8 text-sm flex-1"
              onKeyDown={e => { if (e.key === 'Enter') handleAdd() }} />
            <Input value={role} onChange={e => setRole((e.target as HTMLInputElement).value)}
              placeholder="Role (optional)" className="h-8 text-sm flex-1" />
          </div>
          <div className="flex gap-2">
            <Input value={team} onChange={e => setTeam((e.target as HTMLInputElement).value)}
              placeholder="Team (optional)" className="h-8 text-sm flex-1" />
            <select value={relationship} onChange={e => setRelationship(e.target.value)}
              className="h-8 text-xs px-2 rounded-md border border-border bg-card text-foreground focus:outline-none focus:border-ring flex-1">
              <option value="">Relationship…</option>
              {RELATIONSHIPS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" className="h-7 text-xs" onClick={handleAdd} disabled={!name.trim()}>Add</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {people.map(p => (
          <button
            key={p.id}
            onClick={() => { setSelectedId(p.id); setMode('timeline') }}
            className={`text-left rounded-lg border border-border bg-card/50 px-3.5 py-3 hover:border-primary/40 hover:bg-accent/30 transition-colors group ${p.archived_at ? 'opacity-60' : ''}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
                {p.name}
                {p.archived_at && <span className="text-xs px-1.5 py-0 rounded-full border border-border text-muted-foreground font-normal">Archived</span>}
              </span>
              <ChevronRight size={14} className="text-muted-foreground/40 group-hover:text-primary transition-colors" />
            </div>
            <div className="flex flex-wrap gap-x-1.5 text-xs text-muted-foreground mt-0.5">
              {p.role && <span>{p.role}</span>}
              {p.team && <span>· {p.team}</span>}
            </div>
            <div className="text-xs text-muted-foreground/60 mt-2">
              {p.interaction_count} interaction{p.interaction_count !== 1 ? 's' : ''}
              {p.last_interaction_date && <span> · last {p.last_interaction_date}</span>}
            </div>
          </button>
        ))}
      </div>

      {people.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground/50 text-center py-12">
          No people yet. Add a coworker to start logging interactions.
        </p>
      )}
    </div>
  )
}
