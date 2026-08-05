import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Zap, ChevronRight, ChevronDown, Plus, Trash2, Pencil, X, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { StateDropdown } from './StateDropdown'
import { WorkstreamPicker } from './WorkstreamPicker'
import { LabelPicker } from './LabelPicker'
import { ClickToEditMarkdown } from './ClickToEditMarkdown'
import type { Task, LinkType, TaskState, Workstream } from '../api/types'
import { updateTask, deleteTask, addTaskLink, updateTaskLink, deleteTaskLink, getWorkstreams } from '../api/client'
import { cn } from '@/lib/utils'
import { todayStr } from '../api/date'

const LINK_ICONS: Record<LinkType, string> = { pr: '⤴', issue: '#', doc: '📄', slack: '💬', other: '🔗' }

interface Props {
  task: Task
  onChanged: () => void
}

export function TaskRow({ task, onChanged }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [addingLink, setAddingLink] = useState(false)
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkLabel, setLinkLabel] = useState('')
  const [linkType, setLinkType] = useState<LinkType>('pr')

  const [editAction, setEditAction] = useState('')
  const [editWorkstreamId, setEditWorkstreamId] = useState<string>('')
  const [editLabelIds, setEditLabelIds] = useState<string[]>([])
  const [editHighImpact, setEditHighImpact] = useState(false)
  const [workstreams, setWorkstreams] = useState<Workstream[]>([])

  const isDone = task.state === 'complete'

  function startEdit() {
    setEditAction(task.action)
    setEditWorkstreamId(task.workstream_id ?? '__none__')
    setEditLabelIds(task.labels.map(l => l.id))
    setEditHighImpact(task.high_impact)
    getWorkstreams().then(setWorkstreams)
    setIsEditing(true)
    setExpanded(true)
  }

  async function saveEdit() {
    if (!editAction.trim()) return
    await updateTask(task.id, {
      action: editAction.trim(),
      workstream_id: editWorkstreamId === '__none__' ? null : editWorkstreamId,
      label_ids: editLabelIds,
      high_impact: editHighImpact,
    })
    setIsEditing(false)
    onChanged()
  }

  async function saveNotes(newNotes: string | null) {
    await updateTask(task.id, { notes: newNotes })
    onChanged()
  }

  async function changeState(newState: TaskState) {
    const updates: Parameters<typeof updateTask>[1] = { state: newState }
    if (newState === 'in_progress' && !task.start_date) {
      updates.start_date = todayStr()
    }
    if (newState === 'complete') {
      if (!task.start_date) updates.start_date = todayStr()
      updates.end_date = todayStr()
    } else if (task.state === 'complete') {
      updates.end_date = null
    }
    await updateTask(task.id, updates)
    onChanged()
  }

  async function handleDelete() {
    if (!confirm(`Delete "${task.action}"?`)) return
    await deleteTask(task.id)
    onChanged()
  }

  function handleLinkPaste(e: React.ClipboardEvent) {
    const html = e.clipboardData.getData('text/html')
    if (!html) return
    const match = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
    if (!match) return
    e.preventDefault()
    const [, href, text] = match
    const cleanText = text.replace(/<[^>]+>/g, '').trim()
    setLinkUrl(href)
    if (cleanText && cleanText !== href) setLinkLabel(cleanText)
    if (/github\.com\/.*\/pull\//i.test(href)) setLinkType('pr')
    else if (/github\.com\/.*\/issues\//i.test(href)) setLinkType('issue')
    else if (/slack\.com\//i.test(href)) setLinkType('slack')
    else if (/docs\.|notion\.|confluence\.|wiki\./i.test(href)) setLinkType('doc')
  }

  async function submitLink(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!linkUrl.trim()) return
    await addTaskLink(task.id, { url: linkUrl.trim(), label: linkLabel.trim() || undefined, link_type: linkType })
    setLinkUrl('')
    setLinkLabel('')
    setAddingLink(false)
    onChanged()
  }

  function startEditLink(link: Task['links'][0]) {
    setEditingLinkId(link.id)
    setLinkUrl(link.url)
    setLinkLabel(link.label || '')
    setLinkType(link.link_type)
  }

  function cancelEditLink() {
    setEditingLinkId(null)
    setLinkUrl('')
    setLinkLabel('')
    setLinkType('pr')
  }

  async function saveEditLink(linkId: string) {
    if (!linkUrl.trim()) return
    await updateTaskLink(task.id, linkId, { url: linkUrl.trim(), label: linkLabel.trim() || undefined, link_type: linkType })
    cancelEditLink()
    onChanged()
  }

  async function handleDeleteLink(linkId: string) {
    await deleteTaskLink(task.id, linkId)
    if (editingLinkId === linkId) cancelEditLink()
    onChanged()
  }

  return (
    <div className={cn(
      'group rounded-lg border border-border bg-card px-3 py-2 transition-opacity',
      isDone && 'opacity-55'
    )}>
      <div className="flex items-start gap-2">
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-muted-foreground hover:text-foreground flex-shrink-0 transition-colors mt-0.5"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        {task.high_impact && <Zap size={14} className="text-yellow-400 flex-shrink-0 mt-0.5" />}

        <span className={cn('text-sm flex-shrink-0 mt-0.5', isDone ? 'line-through text-muted-foreground' : 'text-foreground')}>
          {task.action}
        </span>

        {/* Notes preview when collapsed — fills the space between title and state */}
        {!expanded && task.notes ? (() => {
          const lineCount = task.notes.trim().split('\n').length
          const isMultiline = lineCount > 2
          return (
            <div
              className="flex-1 min-w-0 cursor-pointer relative overflow-hidden flex flex-col justify-end"
              style={{ maxHeight: '3.6em' }}
              onClick={e => { e.stopPropagation(); setExpanded(true) }}
            >
              <div className="prose-worklog prose-worklog-preview max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {task.notes}
                </ReactMarkdown>
              </div>
              <div className="absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-card to-transparent pointer-events-none" />
              {isMultiline && (
                <div className="absolute inset-x-0 top-0 h-4 bg-gradient-to-b from-card to-transparent pointer-events-none" />
              )}
            </div>
          )
        })() : (
          <div className="flex-1" />
        )}

        <StateDropdown value={task.state} onChange={changeState} />

        <button
          onClick={startEdit}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground flex-shrink-0 transition-all mt-0.5"
        >
          <Pencil size={13} />
        </button>
        <button
          onClick={handleDelete}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive flex-shrink-0 transition-all mt-0.5"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {expanded && (
        <div className="mt-2 ml-10 space-y-2">
          {isEditing ? (
            <div className="space-y-2">
              <Input
                autoFocus
                value={editAction}
                onChange={e => setEditAction((e.target as HTMLInputElement).value)}
                className="h-8 text-sm"
                placeholder="Task action…"
              />
              <div className="flex flex-wrap items-center gap-2">
                <WorkstreamPicker
                  value={editWorkstreamId}
                  workstreams={workstreams}
                  onChange={setEditWorkstreamId}
                />

                <LabelPicker selectedIds={editLabelIds} onChange={setEditLabelIds} />

                <button
                  type="button"
                  onClick={() => setEditHighImpact(v => !v)}
                  className={cn(
                    'p-1.5 rounded border transition-colors',
                    editHighImpact
                      ? 'border-yellow-500 text-yellow-400'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  )}
                  title="High impact"
                >
                  <Zap size={13} />
                </button>

                <Button size="sm" className="h-7 text-xs gap-1 ml-auto" onClick={saveEdit}>
                  <Check size={12} /> Save
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setIsEditing(false)}>
                  <X size={12} /> Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Notes — click to edit markdown, independent of pencil edit form */}
              <ClickToEditMarkdown
                value={task.notes}
                onSave={saveNotes}
                placeholder="Click to add notes..."
              />

              {task.labels.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {task.labels.map(label => (
                    <span
                      key={label.id}
                      className="text-xs px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: label.color + '33', color: label.color }}
                    >
                      {label.name}
                    </span>
                  ))}
                </div>
              )}

              {task.links.length > 0 && (
                <div className="space-y-1">
                  {task.links.map(link => (
                    editingLinkId === link.id ? (
                      <form key={link.id} onSubmit={e => { e.preventDefault(); saveEditLink(link.id) }} className="flex flex-wrap gap-2 items-end">
                        <Select value={linkType} onValueChange={(v: string | null) => { if (v) setLinkType(v as LinkType) }}>
                          <SelectTrigger className="h-7 w-24 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pr">PR</SelectItem>
                            <SelectItem value="issue">Issue</SelectItem>
                            <SelectItem value="doc">Doc</SelectItem>
                            <SelectItem value="slack">Slack</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input autoFocus value={linkUrl} onChange={e => setLinkUrl((e.target as HTMLInputElement).value)}
                          onPaste={handleLinkPaste}
                          placeholder="URL" className="h-7 text-xs w-52" />
                        <Input value={linkLabel} onChange={e => setLinkLabel((e.target as HTMLInputElement).value)}
                          placeholder="Label (optional)" className="h-7 text-xs w-36" />
                        <Button type="submit" size="sm" className="h-7 text-xs">Save</Button>
                        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={cancelEditLink}>
                          Cancel
                        </Button>
                      </form>
                    ) : (
                      <div key={link.id} className="flex items-center gap-2 text-xs group/link">
                        <span className="text-muted-foreground">{LINK_ICONS[link.link_type]}</span>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:text-primary/80 truncate max-w-xs transition-colors"
                        >
                          {link.label || link.url}
                        </a>
                        <button
                          onClick={() => startEditLink(link)}
                          className="opacity-0 group-hover/link:opacity-100 text-muted-foreground hover:text-foreground transition-all"
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          onClick={() => handleDeleteLink(link.id)}
                          className="opacity-0 group-hover/link:opacity-100 text-muted-foreground hover:text-destructive ml-auto transition-all"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )
                  ))}
                </div>
              )}

              {addingLink ? (
                <form onSubmit={submitLink} className="flex flex-wrap gap-2 items-end">
                  <Select value={linkType} onValueChange={(v: string | null) => { if (v) setLinkType(v as LinkType) }}>
                    <SelectTrigger className="h-7 w-24 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pr">PR</SelectItem>
                      <SelectItem value="issue">Issue</SelectItem>
                      <SelectItem value="doc">Doc</SelectItem>
                      <SelectItem value="slack">Slack</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input autoFocus value={linkUrl} onChange={e => setLinkUrl((e.target as HTMLInputElement).value)}
                    onPaste={handleLinkPaste}
                    placeholder="Paste link or URL…" className="h-7 text-xs w-52" />
                  <Input value={linkLabel} onChange={e => setLinkLabel((e.target as HTMLInputElement).value)}
                    placeholder="Label (optional)" className="h-7 text-xs w-36" />
                  <Button type="submit" size="sm" className="h-7 text-xs">Add</Button>
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAddingLink(false)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <button
                  onClick={() => setAddingLink(true)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                  <Plus size={12} /> add link
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
