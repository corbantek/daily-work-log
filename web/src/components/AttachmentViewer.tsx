import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Download } from 'lucide-react'
import { rehypeHighlightTodo } from '@/lib/rehype-highlight-todo'
import { getAttachment, getSettings, attachmentFileUrl } from '../api/client'
import type { TaskAttachment } from '../api/types'
import { formatBytes } from './TaskAttachments'

/** Standalone page (opened in a new tab via /?attachment=<id>) that renders a markdown attachment. */
export function AttachmentViewer({ id }: { id: string }) {
  const [meta, setMeta] = useState<TaskAttachment | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Same theme as the main app (stored in settings; default dim).
    getSettings()
      .then(s => {
        const html = document.documentElement
        html.classList.remove('dark', 'dim')
        const theme = s.theme === 'light' || s.theme === 'dark' ? s.theme : 'dim'
        if (theme !== 'light') html.classList.add(theme)
      })
      .catch(() => document.documentElement.classList.add('dim'))

    getAttachment(id)
      .then(async m => {
        setMeta(m)
        document.title = m.filename
        const res = await fetch(attachmentFileUrl(m))
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error(body?.detail ?? `${res.status} ${res.statusText}`)
        }
        setText(await res.text())
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load this attachment'))
  }, [id])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {meta && (
          <div className="flex items-center gap-3 mb-6 pb-3 border-b border-border">
            <h1 className="text-sm font-semibold flex-1 truncate">{meta.filename}</h1>
            <span className="text-xs text-muted-foreground">{formatBytes(meta.size_bytes)}</span>
            <a
              href={attachmentFileUrl(meta)}
              download={meta.filename}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              <Download size={13} /> Download
            </a>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!error && text === null && <p className="text-sm text-muted-foreground">Loading…</p>}
        {text !== null && (
          <div className="prose-worklog max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlightTodo]}
              components={{
                a: ({ children, ...props }) => (
                  <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>
                ),
              }}
            >
              {text}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
