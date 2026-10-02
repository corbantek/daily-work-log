import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Zap, Calendar, ExternalLink } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { rehypeHighlightTodo } from '@/lib/rehype-highlight-todo'
import type { SearchResult, Task, Meeting } from '../api/types'
import { getTask, getMeeting } from '../api/client'

const STATE_LABELS: Record<string, string> = {
  todo: 'TODO', in_progress: 'IN PROGRESS', complete: 'DONE', abandoned: 'ABANDONED',
}
const STATE_COLORS: Record<string, string> = {
  todo: 'text-red-400 border-red-500/40',
  in_progress: 'text-blue-400 border-blue-500/40',
  complete: 'text-green-400 border-green-500/40',
  abandoned: 'text-gray-400 border-gray-500/40',
}

interface Props {
  result: SearchResult | null
  onClose: () => void
}

export function ItemDetailDialog({ result, onClose }: Props) {
  const [task, setTask] = useState<Task | null>(null)
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setTask(null)
    setMeeting(null)
    if (!result) return
    setLoading(true)
    if (result.type === 'task') {
      getTask(result.id).then(setTask).finally(() => setLoading(false))
    } else if (result.type === 'meeting') {
      getMeeting(result.id).then(setMeeting).finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [result])

  const open = !!result && (result.type === 'task' || result.type === 'meeting')

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg flex flex-col max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
            {result?.type === 'meeting' && <Calendar size={15} className="text-muted-foreground shrink-0" />}
            {task?.high_impact && <Zap size={15} className="text-yellow-400 shrink-0" />}
            <span className="text-base">{result?.title}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto thin-scrollbar pr-1 space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

          {/* Task */}
          {task && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={cn('border rounded-full px-2.5 h-6 flex items-center font-medium', STATE_COLORS[task.state])}>
                  {STATE_LABELS[task.state]}
                </span>
                {result?.subtitle && <span className="text-muted-foreground">{result.subtitle}</span>}
                {task.start_date && (
                  <span className="text-muted-foreground/70 font-mono">
                    {task.start_date}{task.end_date && task.end_date !== task.start_date ? ` → ${task.end_date}` : ''}
                  </span>
                )}
              </div>

              {task.labels.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {task.labels.map(l => (
                    <span key={l.id} className="text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: l.color + '33', color: l.color }}>
                      {l.name}
                    </span>
                  ))}
                </div>
              )}

              {task.notes && (
                <div className="prose-worklog max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlightTodo]}>{task.notes}</ReactMarkdown>
                </div>
              )}

              {task.links.length > 0 && (
                <div className="space-y-1">
                  {task.links.map(link => (
                    <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                      <ExternalLink size={12} /> {link.label || link.url}
                    </a>
                  ))}
                </div>
              )}

              {task.meetings.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Linked meetings: {task.meetings.map(m => `${m.title} (${m.date})`).join(', ')}
                </div>
              )}
            </>
          )}

          {/* Meeting */}
          {meeting && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{meeting.date}</span>
                {meeting.duration_minutes != null && <span>· {meeting.duration_minutes} min</span>}
              </div>

              {meeting.notes && (
                <div className="prose-worklog max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlightTodo]}>{meeting.notes}</ReactMarkdown>
                </div>
              )}

              {meeting.tasks.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">Linked tasks</p>
                  <div className="space-y-1">
                    {meeting.tasks.map(t => (
                      <div key={t.id} className="flex items-center gap-2 text-sm">
                        <span className="flex-1 text-foreground">{t.action}</span>
                        <span className={cn('text-xs border rounded-full px-2 h-5 flex items-center font-medium shrink-0', STATE_COLORS[t.state])}>
                          {STATE_LABELS[t.state]}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
