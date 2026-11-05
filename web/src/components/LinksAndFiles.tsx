import type { ReactNode } from 'react'
import type { Attachment } from '../api/types'
import { AttachButton, AttachmentList, type AttachmentUpload } from './Attachments'
import { AgentContextArea, splitAgentContext } from './AgentContext'
import { LinkSection, type LinkBody } from './LinkSection'
import type { LinkType, TaskLink } from '../api/types'

interface Props {
  links: Pick<TaskLink, 'id' | 'url' | 'label' | 'link_type'>[]
  attachments: Attachment[]
  att: AttachmentUpload
  defaultType: LinkType
  onAdd: (body: LinkBody) => Promise<unknown>
  onUpdate: (id: string, body: LinkBody) => Promise<unknown>
  onDelete: (id: string) => Promise<unknown>
  onChanged: () => void
  /** Extra buttons (e.g. "add sub-task"), in a row above the links and files, set off by a divider. */
  extraActions?: ReactNode
}

/**
 * The editable links and files of a task or meeting: two columns (Links | Files, stacked on narrow
 * widths), or one compact row of add buttons while there are neither. The agent's context file
 * (agent-context.md) is not a "file": it gets its own small line below.
 */
export function LinksAndFiles({ links, attachments: allAttachments, att, defaultType, onAdd, onUpdate, onDelete, onChanged, extraActions }: Props) {
  const { context, files: attachments } = splitAgentContext(allAttachments)
  const linkSection = (
    <LinkSection links={links} defaultType={defaultType} onAdd={onAdd} onUpdate={onUpdate} onDelete={onDelete} onChanged={onChanged} />
  )
  const fileList = <AttachmentList attachments={attachments} att={att} onChanged={onChanged} />

  const empty = links.length === 0 && attachments.length === 0

  return (
    <div className="space-y-2">
      {extraActions && <div className="flex flex-wrap items-center gap-x-3 gap-y-1">{extraActions}</div>}
      <div className={extraActions ? 'border-t border-border/60 pt-2' : undefined}>
        {empty ? (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {linkSection}
              <AttachButton att={att} />
            </div>
            {fileList}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            <div className="space-y-1 min-w-0">
              <p className="text-[11px] font-medium text-muted-foreground">Links ({links.length})</p>
              {linkSection}
            </div>
            <div className="space-y-1 min-w-0">
              <p className="text-[11px] font-medium text-muted-foreground">Files ({attachments.length})</p>
              {fileList}
              <AttachButton att={att} />
            </div>
          </div>
        )}
      </div>
      <AgentContextArea context={context} onChanged={onChanged} />
    </div>
  )
}
