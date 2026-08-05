import { useRef, useState } from 'react'
import { todayStr } from '../api/date'
import { Download, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  onRestored: () => void
}

export function BackupRestore({ onRestored }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [restoring, setRestoring] = useState(false)

  async function handleBackup() {
    const res = await fetch('/api/backup')
    const data = await res.json()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `worklog-backup-${todayStr()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleRestore(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!confirm('This will replace all current data with the backup. Continue?')) {
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    setRestoring(true)
    const formData = new FormData()
    formData.append('file', file)
    await fetch('/api/backup', { method: 'POST', body: formData })
    setRestoring(false)
    if (fileRef.current) fileRef.current.value = ''
    onRestored()
  }

  return (
    <div className="flex gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground h-8 text-xs"
        onClick={handleBackup}
      >
        <Download size={14} />
        Backup
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground h-8 text-xs"
        onClick={() => fileRef.current?.click()}
        disabled={restoring}
      >
        <Upload size={14} />
        {restoring ? 'Restoring…' : 'Restore'}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleRestore}
      />
    </div>
  )
}
