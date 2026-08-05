import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import type { WorkstreamWithTasks } from '../api/types'
import { TaskRow } from './TaskRow'
import { AddTaskForm } from './AddTaskForm'

interface Props {
  section: WorkstreamWithTasks
  date: string
  onChanged: () => void
}

export function WorkstreamSection({ section, date, onChanged }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const { workstream, tasks } = section
  const name = workstream?.name ?? 'Unassigned'
  const activeTasks = tasks.filter(t => t.state !== 'complete')
  const doneTasks = tasks.filter(t => t.state === 'complete')

  return (
    <div className="mb-5">
      <button
        onClick={() => setCollapsed(v => !v)}
        className="flex items-center gap-2 mb-2 w-full text-left group"
      >
        <span className="text-muted-foreground group-hover:text-foreground transition-colors">
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </span>
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground group-hover:text-foreground transition-colors">
          {name}
        </span>
        {tasks.length > 0 && (
          <>
            <Badge variant="secondary" className="text-xs h-4 px-1.5 ml-0.5">
              {activeTasks.length}
            </Badge>
            {doneTasks.length > 0 && (
              <span className="text-xs text-muted-foreground/50">{doneTasks.length} done</span>
            )}
          </>
        )}
      </button>

      {!collapsed && (
        <>
          <Separator className="mb-3 ml-5" />
          <div className="ml-5 space-y-1.5">
            {tasks.map(task => (
              <TaskRow key={task.id} task={task} onChanged={onChanged} />
            ))}
            <AddTaskForm
              workstreamId={workstream?.id ?? null}
              defaultDate={date}
              onCreated={onChanged}
            />
          </div>
        </>
      )}
    </div>
  )
}
