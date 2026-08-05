import { useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import MDEditor from '@uiw/react-md-editor'
import { Button } from '@/components/ui/button'

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
  const [saving, setSaving] = useState(false)

  function startEditing() {
    setDraft(value ?? '')
    setIsEditing(true)
  }

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
      <div className="space-y-2" data-color-mode="dark" onKeyDown={handleKeyDown}>
        <MDEditor
          value={draft}
          onChange={(v) => setDraft(v ?? '')}
          preview="edit"
          height={minHeight}
          visibleDragbar
          hideToolbar={false}
        />
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
