import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import type { WorkstreamWithTasks, Task } from '../api/types'
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

  const taskById = new Map<string, Task>(tasks.map(t => [t.id, t]))

  const topLevel = tasks.filter(t => !t.parent_task_id || !taskById.has(t.parent_task_id))
  const childrenByParent = new Map<string, Task[]>()
  for (const t of tasks) {
    if (t.parent_task_id && taskById.has(t.parent_task_id)) {
      const arr = childrenByParent.get(t.parent_task_id) ?? []
      arr.push(t)
      childrenByParent.set(t.parent_task_id, arr)
    }
  }

  const activeTasks = tasks.filter(t => t.state !== 'complete' && t.state !== 'abandoned')
  const doneTasks = tasks.filter(t => t.state === 'complete' || t.state === 'abandoned')

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
            {topLevel.map(task => {
              const children = childrenByParent.get(task.id) ?? []
              return (
                <div key={task.id}>
                  <TaskRow task={task} onChanged={onChanged} />
                  {children.length > 0 && (
                    <div className="ml-6 mt-1 space-y-1">
                      {children.map(child => (
                        <TaskRow key={child.id} task={child} onChanged={onChanged} isSubtask />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
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
