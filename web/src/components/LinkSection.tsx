import { useState, type ReactNode } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import type { LinkType, TaskLink } from '../api/types'

const LINK_ICONS: Record<LinkType, string> = { pr: '⤴', issue: '#', doc: '📄', slack: '💬', quip: '📝', other: '🔗' }
const LINK_TYPE_OPTIONS: { value: LinkType; label: string }[] = [
  { value: 'pr', label: 'PR' },
  { value: 'issue', label: 'Issue' },
  { value: 'doc', label: 'Doc' },
  { value: 'slack', label: 'Slack' },
  { value: 'quip', label: 'Quip' },
  { value: 'other', label: 'Other' },
]

type LinkItem = Pick<TaskLink, 'id' | 'url' | 'label' | 'link_type'>
export interface LinkBody {
  url: string
  label?: string
  link_type: LinkType
}

interface Props {
  links: LinkItem[]
  /** Type preselected for a new link (and restored after an edit is cancelled). */
  defaultType: LinkType
  onAdd: (body: LinkBody) => Promise<unknown>
  onUpdate: (id: string, body: LinkBody) => Promise<unknown>
  onDelete: (id: string) => Promise<unknown>
  onChanged: () => void
  /** Rendered between the link list and the add form (e.g. an attachment list). */
  beforeActions?: ReactNode
  /** Extra buttons shown beside "add link" while the add form is closed. */
  actions?: ReactNode
}

/** The list of links on a task or meeting, with inline add / edit / delete and paste detection. */
export function LinkSection({ links, defaultType, onAdd, onUpdate, onDelete, onChanged, beforeActions, actions }: Props) {
  const [addingLink, setAddingLink] = useState(false)
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkLabel, setLinkLabel] = useState('')
  const [linkType, setLinkType] = useState<LinkType>(defaultType)

  // Pasting a rich-text link (e.g. from Slack or a browser) fills in the URL, label and a guessed type.
  function handleLinkPaste(e: React.ClipboardEvent) {
    const html = e.clipboardData.getData('text/html')
    if (!html) return
    const match = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
    if (!match) return
    e.preventDefault()
    const [, href, text] = match
    const cleanText = text.replace(/<[^>]+>/g, '').trim()
    setLinkUrl(href)
    if (cleanText && cleanText !== href) setLinkLabel(cleanText)
    if (/github\.com\/.*\/pull\//i.test(href)) setLinkType('pr')
    else if (/github\.com\/.*\/issues\//i.test(href)) setLinkType('issue')
    else if (/slack\.com\//i.test(href)) setLinkType('slack')
    else if (/(^|[/.])quip(-[a-z0-9]+)?\.com\//i.test(href)) setLinkType('quip')
    else if (/docs\.|notion\.|confluence\.|wiki\./i.test(href)) setLinkType('doc')
  }

  const body = (): LinkBody => ({ url: linkUrl.trim(), label: linkLabel.trim() || undefined, link_type: linkType })

  async function submitLink(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!linkUrl.trim()) return
    await onAdd(body())
    setLinkUrl('')
    setLinkLabel('')
    setAddingLink(false)
    onChanged()
  }

  function startEditLink(link: LinkItem) {
    setEditingLinkId(link.id)
    setLinkUrl(link.url)
    setLinkLabel(link.label || '')
    setLinkType(link.link_type)
  }

  function cancelEditLink() {
    setEditingLinkId(null)
    setLinkUrl('')
    setLinkLabel('')
    setLinkType(defaultType)
  }

  async function saveEditLink(linkId: string) {
    if (!linkUrl.trim()) return
    await onUpdate(linkId, body())
    cancelEditLink()
    onChanged()
  }

  async function handleDeleteLink(linkId: string) {
    await onDelete(linkId)
    if (editingLinkId === linkId) cancelEditLink()
    onChanged()
  }

  const typeSelect = (
    <Select value={linkType} onValueChange={(v: string | null) => { if (v) setLinkType(v as LinkType) }}>
      <SelectTrigger className="h-7 w-24 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LINK_TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )

  return (
    <>
      {links.length > 0 && (
        <div className="space-y-1">
          {links.map(link => (
            editingLinkId === link.id ? (
              <form key={link.id} onSubmit={e => { e.preventDefault(); saveEditLink(link.id) }} className="flex flex-wrap gap-2 items-end">
                {typeSelect}
                <Input autoFocus value={linkUrl} onChange={e => setLinkUrl((e.target as HTMLInputElement).value)}
                  onPaste={handleLinkPaste}
                  placeholder="URL" className="h-7 text-xs w-52" />
                <Input value={linkLabel} onChange={e => setLinkLabel((e.target as HTMLInputElement).value)}
                  placeholder="Label (optional)" className="h-7 text-xs w-36" />
                <Button type="submit" size="sm" className="h-7 text-xs">Save</Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={cancelEditLink}>
                  Cancel
                </Button>
              </form>
            ) : (
              <div key={link.id} className="flex items-center gap-2 text-xs group/link">
                <span className="text-muted-foreground">{LINK_ICONS[link.link_type]}</span>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:text-primary/80 truncate max-w-xs transition-colors"
                >
                  {link.label || link.url}
                </a>
                <button
                  onClick={() => startEditLink(link)}
                  className="opacity-0 group-hover/link:opacity-100 text-muted-foreground hover:text-foreground transition-all"
                >
                  <Pencil size={11} />
                </button>
                <button
                  onClick={() => handleDeleteLink(link.id)}
                  className="opacity-0 group-hover/link:opacity-100 text-muted-foreground hover:text-destructive ml-auto transition-all"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )
          ))}
        </div>
      )}

      {beforeActions}

      {addingLink ? (
        <form onSubmit={submitLink} className="flex flex-wrap gap-2 items-end">
          {typeSelect}
          <Input autoFocus value={linkUrl} onChange={e => setLinkUrl((e.target as HTMLInputElement).value)}
            onPaste={handleLinkPaste}
            placeholder="Paste link or URL…" className="h-7 text-xs w-52" />
          <Input value={linkLabel} onChange={e => setLinkLabel((e.target as HTMLInputElement).value)}
            placeholder="Label (optional)" className="h-7 text-xs w-36" />
          <Button type="submit" size="sm" className="h-7 text-xs">Add</Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAddingLink(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAddingLink(true)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            <Plus size={12} /> add link
          </button>
          {actions}
        </div>
      )}
    </>
  )
}
