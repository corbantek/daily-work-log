import { useState } from 'react'
import { Zap, X, Plus, Trophy } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { addTaskWin, updateTaskWin, deleteTaskWin } from '../api/client'
import { formatMonthDay, todayStr } from '../api/date'
import { cn } from '@/lib/utils'
import type { TaskWin } from '../api/types'

/** Read-only wins list (Review views, the detail dialog). */
export function WinsList({ wins, className }: { wins: TaskWin[]; className?: string }) {
  if (wins.length === 0) return null
  return (
    <div className={className}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
        <Trophy size={11} /> Wins ({wins.length})
      </div>
      <ul className="space-y-0.5">
        {wins.map(w => (
          <li key={w.id} className="text-sm flex items-start gap-1.5">
            {w.high_impact
              ? <Zap size={12} className="text-yellow-400 flex-shrink-0 mt-1" />
              : <span className="w-3 flex-shrink-0" />}
            <span>{w.text}</span>
            <span className="text-xs text-muted-foreground/70 flex-shrink-0 mt-0.5">{formatMonthDay(w.date)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface Props {
  taskId: string
  wins: TaskWin[]
  onChanged: () => void
}

/** Editable wins list for the Log: edit text/date in place, toggle ⚡ per win, add several in a row. */
export function WinsEditor({ taskId, wins, onChanged }: Props) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  async function add() {
    const text = draft.trim()
    if (!text) { setAdding(false); return }
    setDraft('')
    await addTaskWin(taskId, { text })
    onChanged()
  }

  return (
    <div>
      {wins.length > 0 && (
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
          <Trophy size={11} /> Wins ({wins.length})
        </div>
      )}
      <ul className="space-y-0.5">
        {wins.map(w => <WinRow key={w.id} taskId={taskId} win={w} onChanged={onChanged} />)}
      </ul>
      {adding ? (
        <Input
          autoFocus
          value={draft}
          onChange={e => setDraft((e.target as HTMLInputElement).value)}
          onBlur={add}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); add() }
            if (e.key === 'Escape') { setDraft(''); setAdding(false) }
          }}
          className="h-8 text-sm mt-1"
          placeholder="What was achieved? Enter adds it, Esc closes"
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors mt-0.5"
        >
          <Plus size={12} /> add win
        </button>
      )}
    </div>
  )
}

function WinRow({ taskId, win, onChanged }: { taskId: string; win: TaskWin; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(win.text)

  async function patch(body: Parameters<typeof updateTaskWin>[2]) {
    await updateTaskWin(taskId, win.id, body)
    onChanged()
  }

  async function saveText() {
    setEditing(false)
    const text = draft.trim()
    if (text && text !== win.text) await patch({ text })
    else setDraft(win.text)
  }

  return (
    <li className="group/win flex items-start gap-1.5 text-sm">
      <button
        onClick={() => patch({ high_impact: !win.high_impact })}
        className={cn('flex-shrink-0 mt-1 transition-colors',
          win.high_impact ? 'text-yellow-400' : 'text-muted-foreground/30 hover:text-muted-foreground')}
        title={win.high_impact ? 'High impact' : 'Mark high impact'}
      >
        <Zap size={12} />
      </button>
      {editing ? (
        <Input
          autoFocus
          value={draft}
          onChange={e => setDraft((e.target as HTMLInputElement).value)}
          onBlur={saveText}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() }
            if (e.key === 'Escape') { setDraft(win.text); setEditing(false) }
          }}
          className="h-7 text-sm flex-1"
        />
      ) : (
        <span className="flex-1 cursor-text" onClick={() => { setDraft(win.text); setEditing(true) }}>{win.text}</span>
      )}
      <label className="relative flex-shrink-0 mt-0.5 text-xs text-muted-foreground/70 hover:text-foreground cursor-pointer" title="Change the date">
        {formatMonthDay(win.date)}
        <input
          type="date"
          value={win.date}
          max={todayStr()}
          onChange={e => e.target.value && patch({ date: e.target.value })}
          className="absolute inset-0 opacity-0 cursor-pointer w-full"
        />
      </label>
      <button
        onClick={async () => { await deleteTaskWin(taskId, win.id); onChanged() }}
        className="opacity-0 group-hover/win:opacity-100 text-muted-foreground hover:text-destructive transition-all flex-shrink-0 mt-1"
        title="Delete win"
      >
        <X size={12} />
      </button>
    </li>
  )
}
