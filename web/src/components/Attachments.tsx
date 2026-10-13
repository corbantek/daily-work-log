import { useRef, useState } from 'react'
import { File as FileIcon, FileImage, FileText, Download, Paperclip, Pencil, Trash2, Check, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import type { Attachment } from '../api/types'
import {
  uploadAttachment, deleteAttachment, renameAttachment, attachmentFileUrl, attachmentOpenUrl,
} from '../api/client'
import { cn } from '@/lib/utils'

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function KindIcon({ kind }: { kind: Attachment['kind'] }) {
  if (kind === 'image') return <FileImage size={12} />
  if (kind === 'markdown' || kind === 'text') return <FileText size={12} />
  return <FileIcon size={12} />
}

/** Upload state, the hidden file picker and drag-and-drop handlers for one task or meeting (`owner` = `/tasks/<id>` or `/meetings/<id>`). */
export function useAttachmentUpload(owner: string, onChanged: () => void) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload(files: FileList | File[]) {
    const list = Array.from(files)
    if (list.length === 0) return
    setUploading(true)
    setError(null)
    const failures: string[] = []
    for (const f of list) {
      try {
        await uploadAttachment(owner, f)
      } catch (e) {
        failures.push(`${f.name}: ${e instanceof Error ? e.message : 'failed'}`)
      }
    }
    setUploading(false)
    if (failures.length) setError(failures.join(' · '))
    onChanged()
  }

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      setDragging(true)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
    },
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.files.length) return
      e.preventDefault()
      setDragging(false)
      upload(e.dataTransfer.files)
    },
  }

  return { inputRef, uploading, dragging, error, upload, dropProps }
}

export type AttachmentUpload = ReturnType<typeof useAttachmentUpload>

export function AttachButton({ att }: { att: AttachmentUpload }) {
  return (
    <>
      <button
        onClick={() => att.inputRef.current?.click()}
        disabled={att.uploading}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
      >
        <Paperclip size={12} /> {att.uploading ? 'uploading…' : 'attach file'}
      </button>
      <input
        ref={att.inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={e => {
          if (e.target.files) att.upload(e.target.files)
          e.target.value = '' // allow re-picking the same file
        }}
      />
    </>
  )
}

export function AttachmentList({ attachments, att, onChanged }: { attachments: Attachment[]; att: AttachmentUpload; onChanged: () => void }) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [name, setName] = useState('')

  async function saveRename(a: Attachment) {
    if (name.trim() && name.trim() !== a.filename) await renameAttachment(a.id, name.trim())
    setRenamingId(null)
    onChanged()
  }

  async function remove(a: Attachment) {
    if (!confirm(`Delete "${a.filename}"? The file is removed from disk.`)) return
    await deleteAttachment(a.id)
    onChanged()
  }

  if (attachments.length === 0 && !att.error && !att.dragging) return null

  return (
    <div className={cn('space-y-1 rounded-md', att.dragging && 'ring-1 ring-primary/60 bg-primary/5 p-1')}>
      {att.dragging && <p className="text-xs text-primary">Drop to attach here</p>}
      {attachments.map(a => (
        renamingId === a.id ? (
          <form key={a.id} onSubmit={e => { e.preventDefault(); saveRename(a) }} className="flex items-center gap-2">
            <Input autoFocus value={name} onChange={e => setName((e.target as HTMLInputElement).value)} className="h-7 text-xs w-64" />
            <button type="submit" className="text-muted-foreground hover:text-foreground"><Check size={13} /></button>
            <button type="button" onClick={() => setRenamingId(null)} className="text-muted-foreground hover:text-foreground"><X size={13} /></button>
          </form>
        ) : (
          <div key={a.id} className="flex items-center gap-2 text-xs group/att">
            <span className="text-muted-foreground"><KindIcon kind={a.kind} /></span>
            <a
              href={attachmentOpenUrl(a)}
              {...(a.kind === 'other' ? { download: a.filename } : { target: '_blank', rel: 'noopener noreferrer' })}
              className="text-primary hover:text-primary/80 truncate max-w-xs transition-colors"
              title={a.kind === 'markdown' ? 'Open rendered in a new tab' : 'Open in a new tab'}
            >
              {a.filename}
            </a>
            <span className="text-muted-foreground/60 flex-shrink-0">{formatBytes(a.size_bytes)}</span>
            <a
              href={attachmentFileUrl(a)}
              download={a.filename}
              title="Download"
              className="opacity-0 group-hover/att:opacity-100 text-muted-foreground hover:text-foreground transition-all"
            >
              <Download size={12} />
            </a>
            <button
              onClick={() => { setRenamingId(a.id); setName(a.filename) }}
              title="Rename"
              className="opacity-0 group-hover/att:opacity-100 text-muted-foreground hover:text-foreground transition-all"
            >
              <Pencil size={11} />
            </button>
            <button
              onClick={() => remove(a)}
              title="Delete"
              className="opacity-0 group-hover/att:opacity-100 text-muted-foreground hover:text-destructive ml-auto transition-all"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )
      ))}
      {att.error && <p className="text-xs text-destructive">{att.error}</p>}
    </div>
  )
}
