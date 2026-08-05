import { useState, useEffect } from 'react'
import { Plus, Trash2, Tag, Pencil, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import type { Label } from '../api/types'
import { getLabels, createLabel, updateLabel, deleteLabel } from '../api/client'

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#0ea5e9',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#78716c', '#64748b',
]

interface Props {
  onChanged?: () => void
}

export function ManageLabels({ onChanged }: Props) {
  const [open, setOpen] = useState(false)
  const [labels, setLabels] = useState<Label[]>([])
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(PRESET_COLORS[0])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')

  function load() {
    getLabels().then(list => setLabels(list.sort((a, b) => a.name.localeCompare(b.name))))
  }

  useEffect(() => {
    if (open) load()
  }, [open])

  async function handleCreate(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!newName.trim()) return
    await createLabel({ name: newName.trim(), color: newColor })
    setNewName('')
    setNewColor(PRESET_COLORS[0])
    setAdding(false)
    load()
    onChanged?.()
  }

  function startEdit(label: Label) {
    setEditingId(label.id)
    setEditName(label.name)
    setEditColor(label.color)
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return
    await updateLabel(id, { name: editName.trim(), color: editColor })
    setEditingId(null)
    load()
    onChanged?.()
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete label "${name}"?`)) return
    await deleteLabel(id)
    load()
    onChanged?.()
  }

  function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
    return (
      <div className="flex flex-wrap gap-2">
        {PRESET_COLORS.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className="w-6 h-6 rounded-full transition-transform hover:scale-110 ring-offset-background"
            style={{
              backgroundColor: c,
              outline: value === c ? `2px solid ${c}` : 'none',
              outlineOffset: '2px',
            }}
          />
        ))}
      </div>
    )
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground h-8 text-xs"
        onClick={() => setOpen(true)}
      >
        <Tag size={14} />
        Labels
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Manage Labels</DialogTitle>
          </DialogHeader>

          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {labels.length === 0 && !adding && (
              <p className="text-sm text-muted-foreground py-3 text-center">No labels yet.</p>
            )}
            {labels.map(label => (
              <div key={label.id} className="rounded-lg border border-border bg-card/50 px-3 py-2">
                {editingId === label.id ? (
                  <div className="space-y-2">
                    <Input
                      autoFocus
                      value={editName}
                      onChange={e => setEditName((e.target as HTMLInputElement).value)}
                      className="h-8 text-sm"
                    />
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">Color</p>
                      <ColorPicker value={editColor} onChange={setEditColor} />
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="h-7 text-xs gap-1" onClick={() => saveEdit(label.id)}>
                        <Check size={12} /> Save
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setEditingId(null)}>
                        <X size={12} /> Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 group">
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: label.color }}
                    />
                    <span className="flex-1 text-sm" style={{ color: label.color }}>{label.name}</span>
                    <button
                      onClick={() => startEdit(label)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => handleDelete(label.id, label.name)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <Separator />

          {adding ? (
            <form onSubmit={handleCreate} className="space-y-3">
              <Input
                autoFocus
                value={newName}
                onChange={e => setNewName((e.target as HTMLInputElement).value)}
                placeholder="Label name…"
                className="h-8 text-sm"
              />
              <div>
                <p className="text-xs text-muted-foreground mb-2">Color</p>
                <ColorPicker value={newColor} onChange={setNewColor} />
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" className="h-8">Create</Button>
                <Button type="button" variant="ghost" size="sm" className="h-8"
                  onClick={() => { setAdding(false); setNewName('') }}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button
              variant="outline" size="sm" className="w-full gap-1.5 h-8 text-xs"
              onClick={() => setAdding(true)}
            >
              <Plus size={13} /> New Label
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
