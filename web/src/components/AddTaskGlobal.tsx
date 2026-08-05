import { useState, useEffect } from 'react'
import { Plus, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StateDropdown } from './StateDropdown'
import { WorkstreamPicker } from './WorkstreamPicker'
import { LabelPicker } from './LabelPicker'
import type { TaskState, Workstream } from '../api/types'
import { createTask, getWorkstreams } from '../api/client'
import { todayStr } from '../api/date'
import { cn } from '@/lib/utils'

interface Props {
  defaultDate?: string
  onCreated: () => void
}

export function AddTaskGlobal({ defaultDate, onCreated }: Props) {
  const [open, setOpen] = useState(false)
  const [workstreams, setWorkstreams] = useState<Workstream[]>([])
  const [action, setAction] = useState('')
  const [state, setState] = useState<TaskState>('todo')
  const [workstreamId, setWorkstreamId] = useState<string>('__none__')
  const [highImpact, setHighImpact] = useState(false)
  const [labelIds, setLabelIds] = useState<string[]>([])

  useEffect(() => {
    if (open) getWorkstreams().then(setWorkstreams)
  }, [open])

  async function submit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!action.trim()) return
    await createTask({
      action: action.trim(),
      state,
      high_impact: highImpact,
      workstream_id: workstreamId === '__none__' ? undefined : workstreamId,
      start_date: state === 'in_progress' ? (defaultDate ?? todayStr()) : undefined,
      label_ids: labelIds,
    })
    setAction('')
    setState('todo')
    setWorkstreamId('__none__')
    setHighImpact(false)
    setLabelIds([])
    setOpen(false)
    onCreated()
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="gap-1 text-xs text-muted-foreground h-7"
        onClick={() => setOpen(true)}
      >
        <Plus size={13} /> Add Task
      </Button>
    )
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-border bg-card/60 p-3 space-y-2">
      <Input
        autoFocus
        value={action}
        onChange={e => setAction((e.target as HTMLInputElement).value)}
        placeholder="Task description…"
        className="h-8 text-sm"
      />
      <div className="flex flex-wrap gap-2 items-center">
        <WorkstreamPicker value={workstreamId} workstreams={workstreams} onChange={setWorkstreamId} />
        <StateDropdown value={state} onChange={setState} size="default" />
        <LabelPicker selectedIds={labelIds} onChange={setLabelIds} />

        <button
          type="button"
          onClick={() => setHighImpact(v => !v)}
          className={cn(
            'p-1.5 rounded border transition-colors',
            highImpact ? 'border-yellow-500 text-yellow-400' : 'border-border text-muted-foreground hover:text-foreground'
          )}
          title="High impact"
        >
          <Zap size={14} />
        </button>

        <div className="ml-auto flex gap-2">
          <Button type="submit" size="sm" className="h-8">Add</Button>
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  )
}
