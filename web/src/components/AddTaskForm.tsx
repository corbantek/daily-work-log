import { useState } from 'react'
import { Plus, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StateDropdown } from './StateDropdown'
import { LabelPicker } from './LabelPicker'
import type { TaskState } from '../api/types'
import { createTask } from '../api/client'
import { todayStr } from '../api/date'
import { cn } from '@/lib/utils'

interface Props {
  workstreamId: string | null
  defaultDate?: string
  onCreated: () => void
}

export function AddTaskForm({ workstreamId, defaultDate, onCreated }: Props) {
  const [open, setOpen] = useState(false)
  const [action, setAction] = useState('')
  const [state, setState] = useState<TaskState>('todo')
  const [highImpact, setHighImpact] = useState(false)
  const [labelIds, setLabelIds] = useState<string[]>([])

  async function submit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!action.trim()) return
    await createTask({
      action: action.trim(),
      state,
      high_impact: highImpact,
      workstream_id: workstreamId,
      start_date: state === 'in_progress' ? (defaultDate ?? todayStr()) : undefined,
      label_ids: labelIds,
    })
    setAction('')
    setState('todo')
    setHighImpact(false)
    setLabelIds([])
    setOpen(false)
    onCreated()
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary mt-1 transition-colors"
      >
        <Plus size={12} /> add task
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="mt-2 flex flex-wrap gap-2 items-center">
      <Input
        autoFocus
        value={action}
        onChange={e => setAction((e.target as HTMLInputElement).value)}
        placeholder="Task description…"
        className="flex-1 min-w-48 h-8 text-sm"
      />
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
      <Button type="submit" size="sm" className="h-8">Add</Button>
      <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  )
}
