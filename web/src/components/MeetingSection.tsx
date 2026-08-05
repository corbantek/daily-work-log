import { useState, useEffect, useRef } from 'react'
import { ChevronDown, ChevronRight, Clock, Plus, Trash2, Pencil, Check, X, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { ClickToEditMarkdown } from './ClickToEditMarkdown'
import { StateDropdown } from './StateDropdown'
import { WorkstreamPicker } from './WorkstreamPicker'
import { LabelPicker } from './LabelPicker'
import type { Meeting, Task, TaskState, Workstream } from '../api/types'
import {
  createMeeting, updateMeeting, deleteMeeting,
  createTask, linkTaskToMeeting, unlinkTaskFromMeeting,
  getDay, getWorkstreams,
} from '../api/client'
import { cn } from '@/lib/utils'

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
                {meeting.tasks.length > 0 && (
                  <span className="text-xs text-muted-foreground/50 flex-shrink-0">
                    {meeting.tasks.length} task{meeting.tasks.length !== 1 ? 's' : ''}
                  </span>
                )}
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

                <MeetingTasks meeting={meeting} date={date} onChanged={onChanged} />
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


// ── Linked tasks inside a meeting ───────────────────────────────────────────

function MeetingTasks({ meeting, date, onChanged }: { meeting: Meeting; date: string; onChanged: () => void }) {
  const [creatingTask, setCreatingTask] = useState(false)
  const [linking, setLinking] = useState(false)

  return (
    <div className="mt-3">
      {meeting.tasks.length > 0 && (
        <div className="space-y-1 mb-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Tasks</span>
          {meeting.tasks.map(task => (
            <div key={task.id} className="flex items-center gap-2 text-xs group/task rounded border border-border/50 bg-card/30 px-2.5 py-1.5">
              <span className={cn('flex-1 truncate', task.state === 'complete' ? 'line-through text-muted-foreground' : 'text-foreground')}>
                {task.action}
              </span>
              <span className={cn(
                'text-xs border rounded-full px-2 py-0.5 font-medium flex-shrink-0',
                task.state === 'todo' ? 'text-red-400 border-red-500/40' :
                task.state === 'in_progress' ? 'text-blue-400 border-blue-500/40' :
                'text-green-400 border-green-500/40'
              )}>
                {task.state === 'todo' ? 'TODO' : task.state === 'in_progress' ? 'IN PROGRESS' : 'DONE'}
              </span>
              <button
                onClick={async () => {
                  await unlinkTaskFromMeeting(meeting.id, task.id)
                  onChanged()
                }}
                className="opacity-0 group-hover/task:opacity-100 text-muted-foreground hover:text-destructive transition-all flex-shrink-0"
                title="Unlink task"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        {creatingTask ? (
          <CreateTaskInMeeting meetingId={meeting.id} date={date} onDone={() => { setCreatingTask(false); onChanged() }} />
        ) : (
          <button
            onClick={() => { setCreatingTask(true); setLinking(false) }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            <Plus size={12} /> create task
          </button>
        )}

        {linking ? (
          <LinkExistingTask meetingId={meeting.id} date={date} existingTaskIds={meeting.tasks.map(t => t.id)} onDone={() => { setLinking(false); onChanged() }} />
        ) : (
          <button
            onClick={() => { setLinking(true); setCreatingTask(false) }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            <Link2 size={12} /> link existing task
          </button>
        )}
      </div>
    </div>
  )
}


// ── Inline create task form inside a meeting ────────────────────────────────

function CreateTaskInMeeting({ meetingId, date, onDone }: { meetingId: string; date: string; onDone: () => void }) {
  const [action, setAction] = useState('')
  const [state, setState] = useState<TaskState>('todo')
  const [workstreamId, setWorkstreamId] = useState('__none__')
  const [labelIds, setLabelIds] = useState<string[]>([])
  const [workstreams, setWorkstreams] = useState<Workstream[]>([])

  useEffect(() => {
    getWorkstreams().then(setWorkstreams)
  }, [])

  async function submit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!action.trim()) return
    const task = await createTask({
      action: action.trim(),
      state,
      workstream_id: workstreamId === '__none__' ? undefined : workstreamId,
      start_date: state === 'in_progress' ? date : undefined,
      label_ids: labelIds,
    })
    await linkTaskToMeeting(meetingId, task.id)
    onDone()
  }

  return (
    <form onSubmit={submit} className="flex-1 flex flex-wrap gap-2 items-center">
      <Input
        autoFocus
        value={action}
        onChange={e => setAction((e.target as HTMLInputElement).value)}
        placeholder="Task description…"
        className="flex-1 min-w-40 h-7 text-xs"
      />
      <WorkstreamPicker value={workstreamId} workstreams={workstreams} onChange={setWorkstreamId} />
      <StateDropdown value={state} onChange={setState} size="sm" />
      <LabelPicker selectedIds={labelIds} onChange={setLabelIds} />
      <Button type="submit" size="sm" className="h-7 text-xs">Add</Button>
      <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onDone}>Cancel</Button>
    </form>
  )
}


// ── Search and link an existing task ────────────────────────────────────────

function LinkExistingTask({ meetingId, date, existingTaskIds, onDone }: {
  meetingId: string; date: string; existingTaskIds: string[]; onDone: () => void
}) {
  const [query, setQuery] = useState('')
  const [tasks, setTasks] = useState<Task[]>([])
  const [open, setOpen] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getDay(date).then(day => {
      const allTasks = day.workstreams.flatMap(ws => ws.tasks)
      setTasks(allTasks)
    })
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [date])

  const filtered = tasks.filter(t =>
    !existingTaskIds.includes(t.id) &&
    t.action.toLowerCase().includes(query.toLowerCase())
  )

  async function link(taskId: string) {
    await linkTaskToMeeting(meetingId, taskId)
    onDone()
  }

  return (
    <div className="relative flex-1">
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          value={query}
          onChange={e => setQuery((e.target as HTMLInputElement).value)}
          onFocus={() => setOpen(true)}
          placeholder="Search tasks…"
          className="h-7 text-xs flex-1"
          onKeyDown={e => {
            if (e.key === 'Escape') onDone()
            if (e.key === 'Enter' && filtered.length === 1) {
              e.preventDefault()
              link(filtered[0].id)
            }
          }}
        />
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onDone}>Cancel</Button>
      </div>

      {open && filtered.length > 0 && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-8 z-50 bg-popover border border-border rounded-lg shadow-xl p-1 min-w-64 max-h-48 overflow-y-auto">
            {filtered.map(task => (
              <button
                key={task.id}
                type="button"
                onClick={() => link(task.id)}
                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded hover:bg-accent text-left text-xs"
              >
                <span className="flex-1 truncate text-foreground">{task.action}</span>
                <span className={cn(
                  'text-xs flex-shrink-0',
                  task.state === 'todo' ? 'text-red-400' :
                  task.state === 'in_progress' ? 'text-blue-400' :
                  'text-green-400'
                )}>
                  {task.state === 'todo' ? 'TODO' : task.state === 'in_progress' ? 'IN PROG' : 'DONE'}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {open && filtered.length === 0 && query && (
        <div className="absolute left-0 top-8 z-50 bg-popover border border-border rounded-lg shadow-xl p-2 min-w-48">
          <p className="text-xs text-muted-foreground/50 text-center">No matching tasks</p>
        </div>
      )}
    </div>
  )
}
