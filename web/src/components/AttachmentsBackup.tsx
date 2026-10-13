import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ATTACHMENTS_ARCHIVE_URL, getAttachmentStats, importAttachmentsArchive } from '../api/client'
import { formatBytes } from './TaskAttachments'
import type { AttachmentStats } from '../api/types'

export function AttachmentsBackup({ onRestored }: { onRestored: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [stats, setStats] = useState<AttachmentStats | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null)

  const load = useCallback(() => getAttachmentStats().then(setStats).catch(() => setStats(null)), [])
  useEffect(() => { load() }, [load])

  async function restore(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await importAttachmentsArchive(file)
      setMsg({
        text: `Restored ${r.restored} file${r.restored === 1 ? '' : 's'}` +
          (r.missing_files ? ` · ${r.missing_files} attachment${r.missing_files === 1 ? '' : 's'} still missing files` : ''),
        error: false,
      })
      await load()
      onRestored()
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Restore failed', error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground/70 mb-1">
        {stats
          ? `${stats.count} attachment${stats.count === 1 ? '' : 's'} · ${formatBytes(stats.total_bytes)}`
          : 'Attachments'}
      </p>
      {stats && stats.missing_files > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mb-1">
          {stats.missing_files} attachment{stats.missing_files === 1 ? ' is' : 's are'} missing from disk — restore your attachments archive.
        </p>
      )}
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground h-8 text-xs"
          // The response is a Content-Disposition attachment, so this downloads without leaving the page.
          onClick={() => { window.location.href = ATTACHMENTS_ARCHIVE_URL }}
        >
          <Download size={14} /> Export files
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground h-8 text-xs"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          <Upload size={14} /> {busy ? 'Restoring…' : 'Restore files'}
        </Button>
        <input ref={fileRef} type="file" accept=".gz,.tgz,application/gzip" className="hidden" onChange={restore} />
      </div>
      <p className="text-xs text-muted-foreground/60 mt-1">
        The database backup holds attachment names only. To move or restore everything, restore the database backup and then restore this archive.
      </p>
      {msg && <p className={msg.error ? 'text-xs text-destructive mt-1' : 'text-xs text-muted-foreground mt-1'}>{msg.text}</p>}
    </div>
  )
}
