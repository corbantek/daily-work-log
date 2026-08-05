import { useState } from 'react'
import { ChevronDown, ChevronRight, Clock, Plus, Trash2, Pencil, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { ClickToEditMarkdown } from './ClickToEditMarkdown'
import type { Meeting } from '../api/types'
import { createMeeting, updateMeeting, deleteMeeting } from '../api/client'

interface Props {
  meetings: Meeting[]
  date: string
  onChanged: () => void
}

export function MeetingSection({ meetings, date, onChanged }: Props) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [duration, setDuration] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingMeeting, setEditingMeeting] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDuration, setEditDuration] = useState('')

  async function submitMeeting(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!title.trim()) return
    await createMeeting({
      date,
      title: title.trim(),
      duration_minutes: duration ? parseInt(duration) : null,
    })
    setTitle('')
    setDuration('')
    setAdding(false)
    onChanged()
  }

  async function handleDelete(id: string, meetingTitle: string) {
    if (!confirm(`Delete "${meetingTitle}"?`)) return
    await deleteMeeting(id)
    onChanged()
  }

  function startEditMeeting(meeting: Meeting) {
    setEditingMeeting(meeting.id)
    setEditTitle(meeting.title)
    setEditDuration(meeting.duration_minutes?.toString() ?? '')
    setExpandedId(meeting.id)
  }

  async function saveEditMeeting(id: string) {
    if (!editTitle.trim()) return
    await updateMeeting(id, {
      title: editTitle.trim(),
      duration_minutes: editDuration ? parseInt(editDuration) : null,
    })
    setEditingMeeting(null)
    onChanged()
  }

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Meetings
        </span>
        <button
          onClick={() => setAdding(v => !v)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <Plus size={12} /> add
        </button>
      </div>

      {adding && (
        <form onSubmit={submitMeeting} className="mb-3 flex flex-wrap gap-2 items-center">
          <Input
            autoFocus
            value={title}
            onChange={e => setTitle((e.target as HTMLInputElement).value)}
            placeholder="Meeting title…"
            className="flex-1 min-w-48 h-8 text-sm"
          />
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              value={duration}
              onChange={e => setDuration((e.target as HTMLInputElement).value)}
              placeholder="0"
              className="w-16 h-8 text-xs"
            />
            <span className="text-xs text-muted-foreground">min</span>
          </div>
          <Button type="submit" size="sm" className="h-8">Add</Button>
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </form>
      )}

      <div className="space-y-1.5 ml-2">
        {meetings.map(meeting => (
          <div key={meeting.id} className="group rounded-lg border border-border bg-card px-3 py-2">
            {editingMeeting === meeting.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  autoFocus
                  value={editTitle}
                  onChange={e => setEditTitle((e.target as HTMLInputElement).value)}
                  className="flex-1 min-w-40 h-8 text-sm"
                />
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    value={editDuration}
                    onChange={e => setEditDuration((e.target as HTMLInputElement).value)}
                    placeholder="0"
                    className="w-16 h-8 text-xs"
                  />
                  <span className="text-xs text-muted-foreground">min</span>
                </div>
                <Button size="sm" className="h-7 text-xs gap-1" onClick={() => saveEditMeeting(meeting.id)}>
                  <Check size={12} /> Save
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setEditingMeeting(null)}>
                  <X size={12} /> Cancel
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setExpandedId(expandedId === meeting.id ? null : meeting.id)}
                  className="text-muted-foreground hover:text-foreground flex-shrink-0 transition-colors"
                >
                  {expandedId === meeting.id
                    ? <ChevronDown size={14} />
                    : <ChevronRight size={14} />
                  }
                </button>
                <span className="flex-1 text-sm text-foreground">{meeting.title}</span>
                {meeting.duration_minutes && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                    <Clock size={12} />
                    {meeting.duration_minutes}m
                  </span>
                )}
                <button
                  onClick={() => startEditMeeting(meeting)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all flex-shrink-0"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => handleDelete(meeting.id, meeting.title)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all flex-shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}

            {expandedId === meeting.id && editingMeeting !== meeting.id && (
              <div className="mt-2 ml-6">
                <Separator className="mb-2" />
                <ClickToEditMarkdown
                  value={meeting.notes}
                  onSave={async (newNotes) => {
                    await updateMeeting(meeting.id, { notes: newNotes })
                    onChanged()
                  }}
                  placeholder="Click to add meeting notes..."
                  minHeight={200}
                />
              </div>
            )}
          </div>
        ))}

        {meetings.length === 0 && !adding && (
          <span className="text-xs text-muted-foreground/40">No meetings</span>
        )}
      </div>
    </div>
  )
}
