import type { Attachment, MeetingLink } from '../api/types'
import { attachmentOpenUrl } from '../api/client'
import { LINK_ICONS } from './LinkSection'

/** A task's or meeting's links and attached files, one per line (Review → Meetings digest and Review → Tasks). */
export function LinkedItems({ links, attachments }: { links: Pick<MeetingLink, 'id' | 'url' | 'label' | 'link_type'>[]; attachments: Attachment[] }) {
  return (
    <>
      {links.map(l => (
        <div key={l.id} className="flex items-center gap-2 text-xs">
          <span className="w-4 text-center text-muted-foreground shrink-0" aria-hidden>{LINK_ICONS[l.link_type]}</span>
          <a href={l.url} target="_blank" rel="noopener noreferrer"
            className="text-primary hover:text-primary/80 truncate transition-colors" title={l.url}>
            {l.label || l.url}
          </a>
        </div>
      ))}
      {attachments.map(a => (
        <div key={a.id} className="flex items-center gap-2 text-xs">
          <span className="w-4 text-center text-muted-foreground shrink-0" aria-hidden>📎</span>
          <a href={attachmentOpenUrl(a)}
            {...(a.kind === 'other' ? { download: a.filename } : { target: '_blank', rel: 'noopener noreferrer' })}
            className="text-primary hover:text-primary/80 truncate transition-colors">
            {a.filename}
          </a>
        </div>
      ))}
    </>
  )
}
