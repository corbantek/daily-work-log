import type { Attachment, MeetingLink } from '../api/types'
import { attachmentOpenUrl } from '../api/client'
import { AgentContextArea, splitAgentContext } from './AgentContext'
import { LINK_ICONS, sortLinks } from './LinkSection'

/**
 * A task's or meeting's links and attached files, read-only (Review → Meetings digest, search detail dialog).
 * Links and files sit in two columns (stacked on narrow widths); with only one kind it is a single list.
 */
export function LinkedItems({ links, attachments: allAttachments }: { links: Pick<MeetingLink, 'id' | 'url' | 'label' | 'link_type'>[]; attachments: Attachment[] }) {
  const { context, files: attachments } = splitAgentContext(allAttachments)
  if (links.length === 0 && attachments.length === 0 && !context) return null
  const both = links.length > 0 && attachments.length > 0

  const linkList = sortLinks(links as (typeof links[number] & { created_at?: string })[]).map(l => (
    <div key={l.id} className="flex items-center gap-2 text-xs">
      <span className="w-4 text-center text-muted-foreground shrink-0" aria-hidden>{LINK_ICONS[l.link_type]}</span>
      <a href={l.url} target="_blank" rel="noopener noreferrer"
        className="text-primary hover:text-primary/80 truncate transition-colors" title={l.url}>
        {l.label || l.url}
      </a>
    </div>
  ))
  const fileList = attachments.map(a => (
    <div key={a.id} className="flex items-center gap-2 text-xs">
      <span className="w-4 text-center text-muted-foreground shrink-0" aria-hidden>📎</span>
      <a href={attachmentOpenUrl(a)}
        {...(a.kind === 'other' ? { download: a.filename } : { target: '_blank', rel: 'noopener noreferrer' })}
        className="text-primary hover:text-primary/80 truncate transition-colors">
        {a.filename}
      </a>
    </div>
  ))

  const contextArea = <AgentContextArea context={context} />

  if (!both) return <div className="space-y-1">{linkList}{fileList}{contextArea}</div>

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        <div className="space-y-1 min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground">Links ({links.length})</p>
          {linkList}
        </div>
        <div className="space-y-1 min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground">Files ({attachments.length})</p>
          {fileList}
        </div>
      </div>
      {contextArea}
    </div>
  )
}
