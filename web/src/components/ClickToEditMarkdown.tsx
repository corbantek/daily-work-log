import { useState, useCallback, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  value: string | null
  onSave: (value: string | null) => Promise<void>
  placeholder?: string
  minHeight?: number
}

export function ClickToEditMarkdown({
  value,
  onSave,
  placeholder = 'Click to add notes...',
  minHeight = 120,
}: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit')
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function startEditing() {
    setDraft(value ?? '')
    setActiveTab('edit')
    setIsEditing(true)
  }

  useEffect(() => {
    if (isEditing && activeTab === 'edit') {
      textareaRef.current?.focus()
    }
  }, [isEditing, activeTab])

  const save = useCallback(async () => {
    setSaving(true)
    await onSave(draft.trim() || null)
    setSaving(false)
    setIsEditing(false)
  }, [draft, onSave])

  function cancel() {
    setIsEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      cancel()
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      save()
    }
  }

  if (isEditing) {
    return (
      <div className="space-y-2">
        {/* Tab bar */}
        <div className="flex items-center gap-1 border-b border-border pb-1">
          <button
            onClick={() => setActiveTab('edit')}
            className={cn(
              'text-xs px-2.5 py-1 rounded-md transition-colors',
              activeTab === 'edit'
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Edit
          </button>
          <button
            onClick={() => setActiveTab('preview')}
            className={cn(
              'text-xs px-2.5 py-1 rounded-md transition-colors',
              activeTab === 'preview'
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Preview
          </button>
        </div>

        {/* Edit pane */}
        {activeTab === 'edit' && (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ minHeight }}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring resize-y font-mono leading-relaxed"
            placeholder="Write markdown here..."
          />
        )}

        {/* Preview pane */}
        {activeTab === 'preview' && (
          <div
            className="rounded-md border border-border bg-card/50 px-3 py-2"
            style={{ minHeight }}
          >
            {draft.trim() ? (
              <div className="prose-worklog max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/40 italic">Nothing to preview.</p>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" className="h-7 text-xs" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={cancel}>
            Cancel
          </Button>
          <span className="text-xs text-muted-foreground/50 ml-auto">
            {/mac/i.test(navigator.userAgent) ? '⌘' : 'Ctrl'}+Enter to save
          </span>
        </div>
      </div>
    )
  }

  if (!value) {
    return (
      <button
        type="button"
        onClick={startEditing}
        className="w-full text-left text-xs text-muted-foreground/40 hover:text-muted-foreground py-2 px-2 rounded-md hover:bg-accent/30 cursor-text transition-colors"
      >
        {placeholder}
      </button>
    )
  }

  return (
    <div
      onClick={startEditing}
      className="prose-worklog max-w-none cursor-text rounded-md px-2 py-1.5 -mx-2 hover:ring-1 hover:ring-border transition-all"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
            >
              {children}
            </a>
          ),
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  )
}
