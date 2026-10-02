import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { CompetencyDimension } from '../api/types'
import {
  getFramework, createDimension, updateDimension, deleteDimension,
  createAttribute, updateAttribute, deleteAttribute,
} from '../api/client'
import { dimensionColor } from './CompetencyTagPicker'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged?: () => void
}

export function ManageFramework({ open, onOpenChange, onChanged }: Props) {
  const [framework, setFramework] = useState<CompetencyDimension[]>([])
  const [editingDim, setEditingDim] = useState<string | null>(null)
  const [dimLabel, setDimLabel] = useState('')
  const [editingAttr, setEditingAttr] = useState<string | null>(null)
  const [attrText, setAttrText] = useState('')
  const [addingAttrFor, setAddingAttrFor] = useState<string | null>(null)
  const [newAttr, setNewAttr] = useState('')
  const [addingDim, setAddingDim] = useState(false)
  const [newDim, setNewDim] = useState('')

  const load = useCallback(() => {
    getFramework().then(setFramework).then(() => onChanged?.())
  }, [onChanged])

  useEffect(() => { if (open) load() }, [open, load])

  async function saveDimLabel(key: string) {
    if (!dimLabel.trim()) return
    await updateDimension(key, dimLabel.trim())
    setEditingDim(null)
    load()
  }

  async function removeDimension(key: string, label: string) {
    if (!confirm(`Delete the "${label}" dimension, its attributes, and untag it from all interactions?`)) return
    await deleteDimension(key)
    load()
  }

  async function saveAttr(id: string) {
    if (!attrText.trim()) return
    await updateAttribute(id, attrText.trim())
    setEditingAttr(null)
    load()
  }

  async function removeAttr(id: string) {
    await deleteAttribute(id)
    load()
  }

  async function addAttr(dimKey: string) {
    if (!newAttr.trim()) return
    await createAttribute(dimKey, newAttr.trim())
    setNewAttr('')
    setAddingAttrFor(null)
    load()
  }

  async function addDimension() {
    if (!newDim.trim()) return
    await createDimension(newDim.trim())
    setNewDim('')
    setAddingDim(false)
    load()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Competency framework</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          These dimensions and attributes power interaction tags and the review draft. Edit them to match your
          company's review language. Deleting an attribute downgrades existing tags to the whole dimension.
        </p>

        <div className="space-y-4 overflow-y-auto thin-scrollbar pr-1 mt-1">
          {framework.map(dim => (
            <div key={dim.key} className="rounded-lg border border-border bg-card/40 p-3">
              {/* Dimension header */}
              <div className="flex items-center gap-2 mb-2">
                {editingDim === dim.key ? (
                  <>
                    <Input autoFocus value={dimLabel} onChange={e => setDimLabel((e.target as HTMLInputElement).value)}
                      className="h-7 text-xs flex-1" onKeyDown={e => { if (e.key === 'Enter') saveDimLabel(dim.key) }} />
                    <button onClick={() => saveDimLabel(dim.key)} className="text-muted-foreground hover:text-foreground"><Check size={13} /></button>
                    <button onClick={() => setEditingDim(null)} className="text-muted-foreground hover:text-foreground"><X size={13} /></button>
                  </>
                ) : (
                  <>
                    <span className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${dimensionColor(framework, dim.key)}`}>
                      {dim.label}
                    </span>
                    <div className="flex-1" />
                    <button onClick={() => { setEditingDim(dim.key); setDimLabel(dim.label) }} className="text-muted-foreground/50 hover:text-foreground"><Pencil size={12} /></button>
                    <button onClick={() => removeDimension(dim.key, dim.label)} className="text-muted-foreground/50 hover:text-destructive"><Trash2 size={12} /></button>
                  </>
                )}
              </div>

              {/* Attributes */}
              <div className="space-y-1 ml-1">
                {dim.attributes.map(attr => (
                  <div key={attr.id} className="flex items-center gap-2 group">
                    {editingAttr === attr.id ? (
                      <>
                        <Input autoFocus value={attrText} onChange={e => setAttrText((e.target as HTMLInputElement).value)}
                          className="h-7 text-xs flex-1" onKeyDown={e => { if (e.key === 'Enter') saveAttr(attr.id) }} />
                        <button onClick={() => saveAttr(attr.id)} className="text-muted-foreground hover:text-foreground"><Check size={13} /></button>
                        <button onClick={() => setEditingAttr(null)} className="text-muted-foreground hover:text-foreground"><X size={13} /></button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-xs text-muted-foreground">{attr.text}</span>
                        <button onClick={() => { setEditingAttr(attr.id); setAttrText(attr.text) }} className="opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-foreground transition-all"><Pencil size={11} /></button>
                        <button onClick={() => removeAttr(attr.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-destructive transition-all"><Trash2 size={11} /></button>
                      </>
                    )}
                  </div>
                ))}

                {addingAttrFor === dim.key ? (
                  <div className="flex items-center gap-2 pt-1">
                    <Input autoFocus value={newAttr} onChange={e => setNewAttr((e.target as HTMLInputElement).value)}
                      placeholder="New attribute…" className="h-7 text-xs flex-1"
                      onKeyDown={e => { if (e.key === 'Enter') addAttr(dim.key); if (e.key === 'Escape') setAddingAttrFor(null) }} />
                    <button onClick={() => addAttr(dim.key)} className="text-muted-foreground hover:text-foreground"><Check size={13} /></button>
                    <button onClick={() => setAddingAttrFor(null)} className="text-muted-foreground hover:text-foreground"><X size={13} /></button>
                  </div>
                ) : (
                  <button onClick={() => { setAddingAttrFor(dim.key); setNewAttr('') }}
                    className="flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-primary transition-colors pt-1">
                    <Plus size={11} /> add attribute
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {addingDim ? (
          <div className="flex items-center gap-2">
            <Input autoFocus value={newDim} onChange={e => setNewDim((e.target as HTMLInputElement).value)}
              placeholder="New dimension name…" className="h-8 text-sm flex-1"
              onKeyDown={e => { if (e.key === 'Enter') addDimension(); if (e.key === 'Escape') setAddingDim(false) }} />
            <Button size="sm" className="h-8 text-xs" onClick={addDimension}>Add</Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setAddingDim(false)}>Cancel</Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="w-full gap-1.5 h-8 text-xs" onClick={() => setAddingDim(true)}>
            <Plus size={13} /> New dimension
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}
