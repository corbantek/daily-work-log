import { useState, useEffect } from 'react'
import { Pencil, Archive, Plus, Check, X, LayoutList, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import type { Workstream } from '../api/types'
import { getWorkstreamsAll, createWorkstream, updateWorkstream, archiveWorkstream, restoreWorkstream } from '../api/client'

interface Props {
  onChanged: () => void
}

export function ManageWorkstreams({ onChanged }: Props) {
  const [open, setOpen] = useState(false)
  const [workstreams, setWorkstreams] = useState<Workstream[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [addingNew, setAddingNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')

  function load() {
    getWorkstreamsAll().then(setWorkstreams)
  }

  useEffect(() => {
    if (open) load()
  }, [open])

  const active = workstreams.filter(ws => !ws.archived_at).sort((a, b) => a.name.localeCompare(b.name))
  const archived = workstreams.filter(ws => ws.archived_at).sort((a, b) => a.name.localeCompare(b.name))

  async function handleCreate(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!newName.trim()) return
    await createWorkstream({ name: newName.trim(), description: newDesc.trim() || undefined })
    setNewName('')
    setNewDesc('')
    setAddingNew(false)
    load()
    onChanged()
  }

  function startEdit(ws: Workstream) {
    setEditingId(ws.id)
    setEditName(ws.name)
    setEditDesc(ws.description ?? '')
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return
    await updateWorkstream(id, { name: editName.trim(), description: editDesc.trim() || undefined })
    setEditingId(null)
    load()
    onChanged()
  }

  async function handleArchive(id: string, name: string) {
    if (!confirm(`Archive "${name}"? It will be hidden from the daily view.`)) return
    await archiveWorkstream(id)
    load()
    onChanged()
  }

  async function handleRestore(id: string) {
    await restoreWorkstream(id)
    load()
    onChanged()
  }

  function WorkstreamRow({ ws }: { ws: Workstream }) {
    const isArchived = !!ws.archived_at
    if (editingId === ws.id) {
      return (
        <div className="space-y-2">
          <Input autoFocus value={editName}
            onChange={e => setEditName((e.target as HTMLInputElement).value)}
            className="h-8 text-sm" />
          <Input value={editDesc}
            onChange={e => setEditDesc((e.target as HTMLInputElement).value)}
            placeholder="Description (optional)" className="h-8 text-xs" />
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs gap-1" onClick={() => saveEdit(ws.id)}>
              <Check size={12} /> Save
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setEditingId(null)}>
              <X size={12} /> Cancel
            </Button>
          </div>
        </div>
      )
    }
    return (
      <div className={`flex items-center gap-2 group ${isArchived ? 'opacity-50' : ''}`}>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground truncate">{ws.name}</p>
          {ws.description && (
            <p className="text-xs text-muted-foreground truncate">{ws.description}</p>
          )}
        </div>
        {isArchived ? (
          <button
            onClick={() => handleRestore(ws.id)}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-all flex items-center gap-1 text-xs"
            title="Restore"
          >
            <RotateCcw size={13} />
          </button>
        ) : (
          <>
            <button
              onClick={() => startEdit(ws)}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={() => handleArchive(ws.id, ws.name)}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
            >
              <Archive size={13} />
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <>
      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground h-8 text-xs"
        onClick={() => setOpen(true)}>
        <LayoutList size={14} />
        Workstreams
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Workstreams</DialogTitle>
          </DialogHeader>

          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {active.length === 0 && !addingNew && (
              <p className="text-sm text-muted-foreground py-2 text-center">No active workstreams.</p>
            )}
            {active.map(ws => (
              <div key={ws.id} className="rounded-lg border border-border bg-card/50 px-3 py-2">
                <WorkstreamRow ws={ws} />
              </div>
            ))}

            {archived.length > 0 && (
              <>
                <button
                  onClick={() => setShowArchived(v => !v)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
                >
                  {showArchived ? '▾' : '▸'} {archived.length} archived
                </button>
                {showArchived && archived.map(ws => (
                  <div key={ws.id} className="rounded-lg border border-border/50 bg-card/30 px-3 py-2">
                    <WorkstreamRow ws={ws} />
                  </div>
                ))}
              </>
            )}
          </div>

          <Separator />

          {addingNew ? (
            <form onSubmit={handleCreate} className="space-y-2">
              <Input autoFocus value={newName}
                onChange={e => setNewName((e.target as HTMLInputElement).value)}
                placeholder="Workstream name…" className="h-8 text-sm" />
              <Textarea value={newDesc}
                onChange={e => setNewDesc((e.target as HTMLTextAreaElement).value)}
                placeholder="Description (optional)" className="text-xs min-h-16 resize-none" />
              <div className="flex gap-2">
                <Button type="submit" size="sm" className="h-8 gap-1">
                  <Check size={13} /> Create
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-8"
                  onClick={() => { setAddingNew(false); setNewName(''); setNewDesc('') }}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="outline" size="sm" className="w-full gap-1.5 h-8 text-xs"
              onClick={() => setAddingNew(true)}>
              <Plus size={13} /> New Workstream
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
