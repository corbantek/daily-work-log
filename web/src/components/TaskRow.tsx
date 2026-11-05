import { useState } from 'react'
import { Zap, ChevronRight, ChevronDown, Trash2, Pencil, X, Check, CalendarDays, GitBranch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StateDropdown } from './StateDropdown'
import { WorkstreamPicker } from './WorkstreamPicker'
import { LabelPicker } from './LabelPicker'
import { TaskStatus } from './TaskStatus'
import { WinsEditor } from './TaskWins'
import { ClickToEditMarkdown } from './ClickToEditMarkdown'
import { AddTaskForm } from './AddTaskForm'
import { useAttachmentUpload } from './Attachments'
import { LinksAndFiles } from './LinksAndFiles'
import { RefBadge } from './RefBadge'
import type { Task, TaskState, Workstream } from '../api/types'
import { updateTask, deleteTask, addTaskLink, updateTaskLink, deleteTaskLink, getWorkstreams, unlinkTaskFromMeeting, getTasks } from '../api/client'
import { hasDraft } from '@/lib/drafts'
import { cn } from '@/lib/utils'
import { todayStr } from '../api/date'
import { JumpTarget } from '@/lib/log-target'

interface Props {
  task: Task
  onChanged: () => void
  isSubtask?: boolean
}

export function TaskRow({ task, onChanged, isSubtask }: Props) {
  // Open straight away if a recovered draft is waiting for this task.
  const [expanded, setExpanded] = useState(() => hasDraft(`task:${task.id}:notes`))
  const [isEditing, setIsEditing] = useState(false)
  const [addingSubtask, setAddingSubtask] = useState(false)
  const [stateBlockMsg, setStateBlockMsg] = useState<string | null>(null)
  const att = useAttachmentUpload(`/tasks/${task.id}`, onChanged)

  const [editAction, setEditAction] = useState('')
  const [editWorkstreamId, setEditWorkstreamId] = useState<string>('')
  const [editLabelIds, setEditLabelIds] = useState<string[]>([])
  const [editHighImpact, setEditHighImpact] = useState(false)
  const [editParentTaskId, setEditParentTaskId] = useState<string>('__none__')
  const [workstreams, setWorkstreams] = useState<Workstream[]>([])
  const [parentCandidates, setParentCandidates] = useState<Task[]>([])

  const isDone = task.state === 'complete' || task.state === 'abandoned'

  function startEdit() {
    setEditAction(task.action)
    setEditWorkstreamId(task.workstream_id ?? '__none__')
    setEditLabelIds(task.labels.map(l => l.id))
    setEditHighImpact(task.high_impact)
    setEditParentTaskId(task.parent_task_id ?? '__none__')
    getWorkstreams().then(setWorkstreams)
    if (task.subtask_count === 0) {
      getTasks({ workstream_id: task.workstream_id ?? undefined }).then(all => {
        setParentCandidates(
          all.filter(t =>
            t.id !== task.id &&
            t.parent_task_id === null &&
            (t.state === 'todo' || t.state === 'in_progress')
          )
        )
      })
    }
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
      parent_task_id: editParentTaskId === '__none__' ? null : editParentTaskId,
    })
    setIsEditing(false)
    onChanged()
  }

  async function saveNotes(newNotes: string | null) {
    await updateTask(task.id, { notes: newNotes })
    onChanged()
  }

  async function saveStatus(newStatus: string | null) {
    await updateTask(task.id, { status: newStatus })
    onChanged()
  }

  async function changeState(newState: TaskState) {
    if ((newState === 'complete' || newState === 'abandoned') && task.open_subtask_count > 0) {
      setStateBlockMsg('Resolve all sub-tasks first')
      setTimeout(() => setStateBlockMsg(null), 3000)
      return
    }
    const updates: Parameters<typeof updateTask>[1] = { state: newState }
    if (newState === 'in_progress' && !task.start_date) {
      updates.start_date = todayStr()
    }
    if (newState === 'complete') {
      if (!task.start_date) updates.start_date = todayStr()
      updates.end_date = todayStr()
    } else if (newState === 'abandoned') {
      updates.end_date = todayStr()
    } else if (task.state === 'complete' || task.state === 'abandoned') {
      updates.end_date = null
    }
    try {
      await updateTask(task.id, updates)
      onChanged()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('400')) {
        setStateBlockMsg('Resolve all sub-tasks first')
        setTimeout(() => setStateBlockMsg(null), 3000)
      }
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${task.action}"?`)) return
    await deleteTask(task.id)
    onChanged()
  }

  return (
    <JumpTarget id={task.id} onHit={() => setExpanded(true)} className={cn(
      'group rounded-lg border border-border bg-card px-3 py-2 transition-opacity',
      isDone && 'opacity-55',
      isSubtask && 'border-border/60 bg-card/60',
    )}>
      <div className="flex items-start gap-2">
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-muted-foreground hover:text-foreground flex-shrink-0 transition-colors mt-0.5"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        {task.high_impact && <Zap size={14} className="text-yellow-400 flex-shrink-0 mt-0.5" />}

        {/* Title, with the one-line status under it */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            <span className={cn('text-sm mt-0.5', isDone ? 'line-through text-muted-foreground' : 'text-foreground')}>
              {task.action}
            </span>
            <RefBadge kind="task" number={task.number} className="mt-1" />
          </div>
          {!expanded && task.status && (
            <div
              className="text-xs text-muted-foreground truncate cursor-pointer"
              title={task.status}
              onClick={() => setExpanded(true)}
            >
              {task.status}
            </div>
          )}
        </div>

        {task.subtask_count > 0 && (
          <span className="text-xs text-muted-foreground/60 flex items-center gap-0.5 flex-shrink-0 mt-0.5">
            <GitBranch size={11} />
            {task.open_subtask_count > 0
              ? `${task.open_subtask_count}/${task.subtask_count}`
              : task.subtask_count}
          </span>
        )}

        {stateBlockMsg && (
          <span className="text-xs text-destructive flex-shrink-0 mt-0.5">{stateBlockMsg}</span>
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
        <div className="mt-2 ml-10 space-y-2" {...att.dropProps}>
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

                {task.subtask_count === 0 && (
                  <ParentPicker
                    value={editParentTaskId}
                    candidates={parentCandidates}
                    onChange={setEditParentTaskId}
                  />
                )}

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
              <TaskStatus status={task.status} updatedAt={task.status_updated_at} onSave={saveStatus} done={isDone} />

              {/* Notes — click to edit markdown, independent of pencil edit form */}
              <ClickToEditMarkdown
                value={task.notes}
                onSave={saveNotes}
                placeholder="Click to add notes..."
                kind="task"
                draftKey={`task:${task.id}:notes`}
              />

              <WinsEditor taskId={task.id} wins={task.wins} onChanged={onChanged} />

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

              {task.meetings.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {task.meetings.map(meeting => (
                    <span
                      key={meeting.id}
                      className="group/meeting inline-flex items-center gap-1 text-xs bg-muted/50 border border-border/50 rounded-full px-2.5 py-0.5 text-muted-foreground"
                    >
                      <CalendarDays size={11} className="flex-shrink-0" />
                      <span className="truncate max-w-48">{new Date(meeting.date + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {meeting.title}</span>
                      <button
                        onClick={async () => {
                          await unlinkTaskFromMeeting(meeting.id, task.id)
                          onChanged()
                        }}
                        className="opacity-0 group-hover/meeting:opacity-100 hover:text-destructive transition-all flex-shrink-0 -mr-0.5"
                        title="Unlink from meeting"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <LinksAndFiles
                links={task.links}
                attachments={task.attachments}
                att={att}
                defaultType="pr"
                onAdd={body => addTaskLink(task.id, body)}
                onUpdate={(id, body) => updateTaskLink(task.id, id, body)}
                onDelete={id => deleteTaskLink(task.id, id)}
                onChanged={onChanged}
                extraActions={!isSubtask && (
                  <button
                    onClick={() => { setAddingSubtask(v => !v) }}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    <GitBranch size={12} /> add sub-task
                  </button>
                )}
              />

              {addingSubtask && (
                <div className="mt-1">
                  <AddTaskForm
                    workstreamId={task.workstream_id}
                    parentTaskId={task.id}
                    defaultOpen={true}
                    onCreated={() => { setAddingSubtask(false); onChanged() }}
                    onCancel={() => setAddingSubtask(false)}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </JumpTarget>
  )
}

interface ParentPickerProps {
  value: string
  candidates: Task[]
  onChange: (id: string) => void
}

function ParentPicker({ value, candidates, onChange }: ParentPickerProps) {
  return (
    <div className="flex items-center gap-1.5">
      <GitBranch size={12} className="text-muted-foreground flex-shrink-0" />
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-7 text-xs px-2 rounded-md border border-border bg-card text-foreground focus:outline-none focus:border-ring max-w-44"
      >
        <option value="__none__">No parent</option>
        {candidates.map(t => (
          <option key={t.id} value={t.id}>
            {t.action.length > 40 ? t.action.slice(0, 40) + '…' : t.action}
          </option>
        ))}
      </select>
    </div>
  )
}
