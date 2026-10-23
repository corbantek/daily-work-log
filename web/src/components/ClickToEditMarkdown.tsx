import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { rehypeHighlightTodo } from '@/lib/rehype-highlight-todo'
import { clearDraft, readDraft, writeDraft } from '@/lib/drafts'
import { useNoteHeight, type NoteKind } from '@/lib/notes-height'

interface Props {
  value: string | null
  onSave: (value: string | null) => Promise<void>
  placeholder?: string
  /** Which kind of note this is; its editor height comes from Settings. */
  kind: NoteKind
  /** Identifies what is being edited (e.g. `task:<id>:notes`); enables recovery of unsaved text after a reload. */
  draftKey?: string
}

const normalize = (s: string | null | undefined) => (s ?? '').trim() || null
const UNDO_WINDOW_MS = 10_000

/**
 * Click-to-edit markdown. There is no Save button: the text is saved when focus leaves the
 * editor (click elsewhere or Tab away), on ⌘/Ctrl+Enter, or when the editor is torn down
 * mid-edit (e.g. the task is collapsed). Cancel / Esc discard. Switching between the Edit and
 * Preview tabs never saves.
 */
export function ClickToEditMarkdown({
  value,
  onSave,
  placeholder = 'Click to add notes...',
  kind,
  draftKey,
}: Props) {
  const minHeight = useNoteHeight(kind)
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const [recovered, setRecovered] = useState(false)
  const [undo, setUndo] = useState<{ previous: string | null } | null>(null)
  // The saved note changed underneath an open editor (e.g. the AI agent appended to it). Until the
  // user picks "Load latest" or "Keep mine", nothing auto-saves over the other change.
  const [conflict, setConflict] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  // Latest values for event handlers / cleanup, which must not capture stale state.
  const draftRef = useRef('')
  const baselineRef = useRef<string | null>(null) // the saved value when editing began
  const editingRef = useRef(false)
  const savingRef = useRef(false)
  const switchingTabRef = useRef(false)
  const typedRef = useRef(false) // the user has typed in this editing session
  const conflictRef = useRef<string | null>(null)
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  const storageKey = draftKey

  function openEditor(text: string, baseline: string | null) {
    baselineRef.current = baseline
    draftRef.current = text
    editingRef.current = true
    typedRef.current = false
    setDraft(text)
    setActiveTab('edit')
    setError(false)
    setUndo(null)
    conflictRef.current = null
    setConflict(null)
    setIsEditing(true)
  }

  function closeEditor() {
    editingRef.current = false
    conflictRef.current = null
    setConflict(null)
    setIsEditing(false)
    setRecovered(false)
    setError(false)
    if (storageKey) clearDraft(storageKey)
  }

  function startEditing() {
    openEditor(value ?? '', normalize(value))
  }

  // Reopen with the recovered text if a previous session ended mid-edit.
  useEffect(() => {
    if (!storageKey) return
    const stored = readDraft(storageKey)
    if (!stored) return
    if (normalize(stored.text) === normalize(value)) {
      clearDraft(storageKey)
      return
    }
    openEditor(stored.text, normalize(value))
    setRecovered(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The note changed elsewhere while open? Ask before anything overwrites it. (Our own saves don't
  // count: once saved, the refreshed value equals the baseline.)
  useEffect(() => {
    if (!editingRef.current || savingRef.current) return
    if (normalize(value) === baselineRef.current) return
    conflictRef.current = value ?? ''
    setConflict(value ?? '')
  }, [value])

  function loadLatest() {
    const latest = conflictRef.current ?? ''
    draftRef.current = latest
    setDraft(latest)
    baselineRef.current = normalize(latest)
    typedRef.current = false
    conflictRef.current = null
    setConflict(null)
    if (storageKey) clearDraft(storageKey)
  }

  function keepMine() {
    baselineRef.current = normalize(conflictRef.current)  // the next save replaces the other change, on purpose
    conflictRef.current = null
    setConflict(null)
  }

  // Save (if changed) and close. Idempotent: blur, outside-click and ⌘Enter can all race.
  async function commit() {
    if (!editingRef.current || savingRef.current) return
    if (conflictRef.current !== null) return  // stay open until the user resolves the notice
    const next = normalize(draftRef.current)
    const previous = baselineRef.current
    if (next === previous) {
      closeEditor()
      return
    }
    const sent = draftRef.current
    savingRef.current = true
    setSaving(true)
    setError(false)
    try {
      await onSaveRef.current(next)
      if (draftRef.current !== sent) {
        baselineRef.current = next // kept typing while it saved: stay open, the rest saves next time
      } else {
        closeEditor()
        setUndo({ previous })
      }
    } catch {
      setError(true) // stay open with the text so nothing is lost
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  function cancel() {
    if (!editingRef.current) return
    closeEditor()
  }

  async function undoLastSave() {
    if (!undo) return
    const { previous } = undo
    setUndo(null)
    try {
      await onSaveRef.current(previous)
    } catch {
      setUndo({ previous })
    }
  }

  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), UNDO_WINDOW_MS)
    return () => clearTimeout(t)
  }, [undo])

  // Focus management: the textarea on Edit, the (focusable) pane on Preview so keys still work.
  useEffect(() => {
    if (!isEditing) return
    if (activeTab === 'edit') textareaRef.current?.focus()
    else previewRef.current?.focus()
    switchingTabRef.current = false
  }, [isEditing, activeTab])

  // Save when the user clicks anywhere outside the editor (works on both tabs).
  useEffect(() => {
    if (!isEditing) return
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) commit()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing])

  // Keep a recoverable copy while typing, and write it immediately if the page is going away.
  useEffect(() => {
    if (!isEditing || !storageKey) return
    const persist = () => {
      if (!editingRef.current) return
      if (normalize(draftRef.current) === baselineRef.current) clearDraft(storageKey)
      else writeDraft(storageKey, draftRef.current)
    }
    const t = setTimeout(persist, 500)
    window.addEventListener('pagehide', persist)
    window.addEventListener('beforeunload', persist)
    return () => {
      clearTimeout(t)
      window.removeEventListener('pagehide', persist)
      window.removeEventListener('beforeunload', persist)
    }
  }, [isEditing, draft, storageKey])

  // Torn down mid-edit (task/day collapsed, tab switched, view refreshed): save instead of losing it.
  // Only after the user has typed: a recovered draft they haven't touched stays in the recovery copy
  // (this also keeps React StrictMode's simulated unmount from saving it).
  useEffect(() => {
    return () => {
      if (!editingRef.current || savingRef.current || !typedRef.current) return
      if (conflictRef.current !== null) {
        // Unresolved change from elsewhere: keep the user's text as a recoverable draft, don't overwrite.
        if (storageKey) writeDraft(storageKey, draftRef.current)
        return
      }
      const next = normalize(draftRef.current)
      if (next === baselineRef.current) return
      if (storageKey) writeDraft(storageKey, draftRef.current) // fallback if the save below fails
      onSaveRef.current(next)
        .then(() => { if (storageKey) clearDraft(storageKey) })
        .catch(() => { /* the stored draft is recovered next time */ })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      commit()
    }
  }

  // Focus leaving the editor by keyboard (Tab away). Moving between its own controls does nothing.
  function handleBlur(e: React.FocusEvent) {
    if (switchingTabRef.current) return
    if (containerRef.current?.contains(e.relatedTarget as Node | null)) return
    if (!document.hasFocus()) return // window lost focus (alt-tab): keep editing
    commit()
  }

  // Controls inside the editor must not steal focus from the textarea (Safari/Firefox on macOS
  // don't focus buttons on click, which would look like focus leaving the editor).
  const keepFocus = (e: React.MouseEvent) => e.preventDefault()

  function selectTab(tab: 'edit' | 'preview') {
    if (tab === activeTab) return
    switchingTabRef.current = true // unmounting the focused textarea must not count as leaving
    setActiveTab(tab)
  }

  const undoLine = undo && (
    <p className="text-xs text-muted-foreground/60 mt-1">
      Saved ✓ ·{' '}
      <button type="button" onClick={undoLastSave} className="underline hover:text-foreground transition-colors">
        Undo
      </button>
    </p>
  )

  if (isEditing) {
    return (
      <div ref={containerRef} className="space-y-2" onKeyDown={handleKeyDown} onBlur={handleBlur}>
        {conflict !== null && (
          <p className="text-xs text-amber-600 dark:text-amber-400" role="status">
            This note was updated elsewhere while you were editing ·{' '}
            <button type="button" onMouseDown={keepFocus} onClick={loadLatest} className="underline">Load latest</button>
            {' '}(drops your edits) ·{' '}
            <button type="button" onMouseDown={keepFocus} onClick={keepMine} className="underline">Keep mine</button>
          </p>
        )}
        {recovered && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Recovered unsaved changes ·{' '}
            <button type="button" onMouseDown={keepFocus} onClick={cancel} className="underline">Discard</button>
          </p>
        )}

        {/* Tab bar */}
        <div className="flex items-center gap-1 border-b border-border pb-1">
          {(['edit', 'preview'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onMouseDown={keepFocus}
              onClick={() => selectTab(tab)}
              className={cn(
                'text-xs px-2.5 py-1 rounded-md transition-colors',
                activeTab === tab
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab === 'edit' ? 'Edit' : 'Preview'}
            </button>
          ))}
        </div>

        {/* Edit pane */}
        {activeTab === 'edit' && (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={e => {
              typedRef.current = true
              draftRef.current = e.target.value
              setDraft(e.target.value)
            }}
            style={{ minHeight }}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring resize-y font-mono leading-relaxed"
            placeholder="Write markdown here..."
          />
        )}

        {/* Preview pane */}
        {activeTab === 'preview' && (
          <div
            ref={previewRef}
            tabIndex={-1}
            className="rounded-md border border-border bg-card/50 px-3 py-2 outline-none"
            style={{ minHeight }}
          >
            {draft.trim() ? (
              <div className="prose-worklog max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlightTodo]}>{draft}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/40 italic">Nothing to preview.</p>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onMouseDown={keepFocus}
            onClick={cancel}
          >
            Cancel
          </Button>
          {error ? (
            <span className="text-xs text-destructive ml-auto">
              Couldn't save — click away or press {/mac/i.test(navigator.userAgent) ? '⌘' : 'Ctrl'}+Enter to retry
            </span>
          ) : saving ? (
            <span className="text-xs text-muted-foreground/60 ml-auto">Saving…</span>
          ) : (
            <span className="text-xs text-muted-foreground/50 ml-auto">
              Saves when you click away · Esc to cancel · {/mac/i.test(navigator.userAgent) ? '⌘' : 'Ctrl'}+Enter to save
            </span>
          )}
        </div>
      </div>
    )
  }

  if (!value) {
    return (
      <>
        <button
          type="button"
          onClick={startEditing}
          className="w-full text-left text-xs text-muted-foreground/40 hover:text-muted-foreground py-2 px-2 rounded-md hover:bg-accent/30 cursor-text transition-colors"
        >
          {placeholder}
        </button>
        {undoLine}
      </>
    )
  }

  return (
    <>
      <div
        onClick={startEditing}
        className="prose-worklog max-w-none cursor-text rounded-md px-2 py-1.5 -mx-2 hover:ring-1 hover:ring-border transition-all"
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlightTodo]}
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
      {undoLine}
    </>
  )
}
