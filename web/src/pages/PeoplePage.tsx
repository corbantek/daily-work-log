import { useState, useEffect, useCallback } from 'react'
import { Plus, Users, ChevronRight, Archive, List, Network, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { CompetencyDimension, OrgNode, Person, Workstream } from '../api/types'
import { getPeople, getOrgTree, createPerson, updatePerson, getFramework, getWorkstreams } from '../api/client'
import { useOnDataChange } from '../lib/live-updates'
import { PersonDetail } from '../components/PersonDetail'
import { ReviewDraftView } from '../components/ReviewDraftView'
import { OrgTree, InheritedText } from '../components/OrgTree'
import { PersonPicker } from '../components/PersonPicker'

const RELATIONSHIPS = ['Report', 'Peer', 'Manager', 'Cross-functional', 'Other']
const VIEW_KEY = 'worklog-people-view'

type View = 'list' | 'tree'

/** Where a new person goes: under someone ("+ report") or above someone ("+ manager"). */
type AddContext = { reportsTo?: string; managerOf?: string }

interface Props {
  containerClass?: string
  theme?: 'light' | 'dim' | 'dark'
  targetPersonId?: string | null
  onTargetConsumed?: () => void
}

export function PeoplePage({ containerClass = 'max-w-5xl mx-auto px-4 py-6', theme, targetPersonId, onTargetConsumed }: Props) {
  const [people, setPeople] = useState<Person[]>([])  // everyone, archived too (pickers, chains)
  const [tree, setTree] = useState<OrgNode[]>([])
  const [framework, setFramework] = useState<CompetencyDimension[]>([])
  const [workstreams, setWorkstreams] = useState<Workstream[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<'timeline' | 'review'>('timeline')
  const [view, setView] = useState<View>(() => localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'tree')
  const [adding, setAdding] = useState<AddContext | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [filter, setFilter] = useState('')

  const loadPeople = useCallback(() => {
    getPeople(true).then(setPeople)
    getOrgTree(showArchived).then(setTree)
  }, [showArchived])

  useEffect(() => {
    loadPeople()
    getFramework().then(setFramework)
    getWorkstreams().then(setWorkstreams)
  }, [loadPeople])

  useOnDataChange(loadPeople)  // e.g. the agent filled someone in

  useEffect(() => { localStorage.setItem(VIEW_KEY, view) }, [view])

  useEffect(() => {
    if (targetPersonId) {
      setSelectedId(targetPersonId)
      setMode('timeline')
      onTargetConsumed?.()
    }
  }, [targetPersonId, onTargetConsumed])

  function openPerson(id: string) {
    setSelectedId(id)
    setMode('timeline')
    window.scrollTo({ top: 0 })
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
          key={selected.id}
          person={selected}
          people={people}
          framework={framework}
          workstreams={workstreams}
          theme={theme}
          onBack={() => setSelectedId(null)}
          onOpenPerson={openPerson}
          onChanged={loadPeople}
          onRemoved={() => { setSelectedId(null); loadPeople() }}
          onOpenReview={() => setMode('review')}
        />
      </div>
    )
  }

  const term = filter.trim().toLowerCase()
  const listed = people
    .filter(p => showArchived || !p.archived_at)
    .filter(p => !term || [p.name, p.role, p.effective_team.value, p.effective_focus.value]
      .some(x => (x ?? '').toLowerCase().includes(term)))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className={containerClass}>
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Users size={16} /> People
        </h2>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            {([['tree', Network, 'Org tree'], ['list', List, 'List']] as const).map(([v, Icon, label]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  'flex items-center gap-1 text-xs px-2.5 py-1 transition-colors',
                  view === v ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowArchived(v => !v)}
            className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border transition-colors ${
              showArchived ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            <Archive size={12} /> {showArchived ? 'Showing archived' : 'Show archived'}
          </button>
          {!adding && (
            <Button size="sm" className="gap-1 h-8 text-xs" onClick={() => setAdding({})}>
              <Plus size={12} /> Add person
            </Button>
          )}
        </div>
      </div>

      <div className="relative mb-4">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
        <Input value={filter} onChange={e => setFilter((e.target as HTMLInputElement).value)}
          placeholder="Filter by name, role, team or focus…" className="h-8 text-sm pl-8" />
      </div>

      {adding && (
        <AddPersonForm
          context={adding}
          people={people}
          onCancel={() => setAdding(null)}
          onAdded={(person, context) => {
            setAdding(null)
            loadPeople()
            // From the tree you're usually mapping out several people in a row, so stay there.
            if (!context.reportsTo && !context.managerOf) openPerson(person.id)
          }}
        />
      )}

      {view === 'tree' ? (
        <OrgTree
          tree={tree}
          filter={filter}
          onOpen={openPerson}
          onAddReport={id => { setAdding({ reportsTo: id }); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
          onAddManager={id => { setAdding({ managerOf: id }); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {listed.map(p => (
            <button
              key={p.id}
              onClick={() => openPerson(p.id)}
              className={`text-left rounded-lg border border-border bg-card/50 px-3.5 py-3 hover:border-primary/40 hover:bg-accent/30 transition-colors group ${p.archived_at ? 'opacity-60' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className={cn('text-sm font-medium text-foreground flex items-center gap-1.5', p.is_placeholder && 'italic text-muted-foreground')}>
                  {p.name}
                  {p.archived_at && <span className="text-xs px-1.5 py-0 rounded-full border border-border text-muted-foreground font-normal not-italic">Archived</span>}
                </span>
                <ChevronRight size={14} className="text-muted-foreground/40 group-hover:text-primary transition-colors" />
              </div>
              <div className="flex flex-wrap gap-x-1.5 text-xs text-muted-foreground mt-0.5">
                {p.role && <span>{p.role}</span>}
                {p.effective_team.value && <span>· <InheritedText v={p.effective_team} /></span>}
                {p.chain[0] && <span>· reports to {p.chain[0].name}</span>}
              </div>
              <div className="text-xs text-muted-foreground/60 mt-2">
                {p.interaction_count} interaction{p.interaction_count !== 1 ? 's' : ''}
                {p.last_interaction_date && <span> · last {p.last_interaction_date}</span>}
              </div>
            </button>
          ))}
          {listed.length === 0 && people.length > 0 && (
            <p className="text-sm text-muted-foreground/50 col-span-full text-center py-12">Nobody matches.</p>
          )}
        </div>
      )}

      {people.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground/50 text-center py-12">
          No people yet. Add a coworker to start mapping your org and logging interactions.
        </p>
      )}
    </div>
  )
}

function AddPersonForm({ context, people, onCancel, onAdded }: {
  context: AddContext
  people: Person[]
  onCancel: () => void
  onAdded: (person: Person, context: AddContext) => void
}) {
  const below = context.managerOf ? people.find(p => p.id === context.managerOf) : undefined
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [team, setTeam] = useState('')
  const [focus, setFocus] = useState('')
  const [relationship, setRelationship] = useState('')
  // A new manager slots in between `below` and whoever `below` reported to.
  const [managerId, setManagerId] = useState<string | null>(context.reportsTo ?? below?.manager_id ?? null)
  const [placeholder, setPlaceholder] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Inherited values the new person would get, shown as input placeholders.
  const manager = people.find(p => p.id === managerId)
  const inheritedTeam = manager?.effective_team.value
  const inheritedFocus = manager?.effective_focus.value

  async function submit() {
    const n = name.trim() || (placeholder && below ? `? (${below.name}'s manager)` : '')
    if (!n) return
    setError(null)
    try {
      const person = await createPerson({
        name: n,
        role: role.trim() || null,
        team: team.trim() || null,
        focus: focus.trim() || null,
        manager_id: managerId,
        is_placeholder: placeholder,
        relationship: relationship || null,
      })
      if (below) await updatePerson(below.id, { manager_id: person.id })
      onAdded(person, context)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add')
    }
  }

  const heading = below ? `New manager for ${below.name}`
    : context.reportsTo ? `New report to ${manager?.name ?? '…'}` : 'New person'

  return (
    <div className="rounded-lg border border-border bg-card/60 p-3 mb-4 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{heading}</p>
      <div className="flex gap-2">
        <Input autoFocus value={name} onChange={e => setName((e.target as HTMLInputElement).value)}
          placeholder={placeholder && below ? `? (${below.name}'s manager)` : 'Name'} className="h-8 text-sm flex-1"
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }} />
        <Input value={role} onChange={e => setRole((e.target as HTMLInputElement).value)}
          placeholder="Role (optional)" className="h-8 text-sm flex-1" />
      </div>
      <div className="flex gap-2">
        <Input value={team} onChange={e => setTeam((e.target as HTMLInputElement).value)}
          placeholder={inheritedTeam ? `Team: ${inheritedTeam} (inherited)` : 'Team (optional)'} className="h-8 text-sm flex-1" />
        <Input value={focus} onChange={e => setFocus((e.target as HTMLInputElement).value)}
          placeholder={inheritedFocus ? `Focus: ${inheritedFocus} (inherited)` : 'Focus: what the group works on (optional)'}
          className="h-8 text-sm flex-1" />
      </div>
      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-xs text-muted-foreground">Reports to</span>
        <PersonPicker people={people} value={managerId} onChange={setManagerId} excludeTreeOf={below?.id} />
        <select value={relationship} onChange={e => setRelationship(e.target.value)}
          className="h-7 text-xs px-2 rounded-md border border-border bg-card text-foreground focus:outline-none focus:border-ring">
          <option value="">Relationship…</option>
          {RELATIONSHIPS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer"
          title="Someone you know exists but haven't identified yet; rename them once you know">
          <input type="checkbox" checked={placeholder} onChange={e => setPlaceholder(e.target.checked)} />
          Not identified yet
        </label>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2 justify-end">
        <Button size="sm" className="h-7 text-xs" onClick={submit}
          disabled={!name.trim() && !(placeholder && below)}>Add</Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}
