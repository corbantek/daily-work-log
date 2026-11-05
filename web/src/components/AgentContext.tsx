import { Bot, Trash2 } from 'lucide-react'
import type { Attachment } from '../api/types'
import { attachmentOpenUrl, deleteAttachment } from '../api/client'
import { formatBytes } from './Attachments'

/** The file the AI agent reads and rewrites to hand context between sessions (see CLAUDE.md → Agent context). */
export const AGENT_CONTEXT_FILE = 'agent-context.md'

/** Splits a task's or meeting's attachments into its agent context (if any) and the ordinary files. */
export function splitAgentContext(attachments: Attachment[]): { context: Attachment | null; files: Attachment[] } {
  return {
    context: attachments.find(a => a.filename === AGENT_CONTEXT_FILE) ?? null,
    files: attachments.filter(a => a.filename !== AGENT_CONTEXT_FILE),
  }
}

/**
 * A small "Agent context" line under the links and files. It opens the rendered file in a new tab;
 * pass `onChanged` to allow deleting it (the agent recreates it when it next needs one).
 */
export function AgentContextArea({ context, onChanged }: { context: Attachment | null; onChanged?: () => void }) {
  if (!context) return null

  async function remove() {
    if (!context || !confirm('Delete the agent context? The agent will have to rebuild it.')) return
    await deleteAttachment(context.id)
    onChanged?.()
  }

  return (
    <div className="flex items-center gap-2 text-xs border-t border-border/60 pt-2 group/ctx">
      <span className="text-muted-foreground flex items-center gap-1 shrink-0"><Bot size={12} /> Agent context</span>
      <a
        href={attachmentOpenUrl(context)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:text-primary/80 transition-colors"
        title="What a fresh agent session reads first. Opens rendered in a new tab."
      >
        view
      </a>
      <span className="text-muted-foreground/60">{formatBytes(context.size_bytes)}</span>
      {onChanged && (
        <button
          onClick={remove}
          title="Delete"
          className="opacity-0 group-hover/ctx:opacity-100 text-muted-foreground hover:text-destructive ml-auto transition-all"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  )
}
